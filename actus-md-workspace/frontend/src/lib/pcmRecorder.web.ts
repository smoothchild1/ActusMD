import type { PcmChunkHandler, PcmRecorder } from './pcmRecorder';

/**
 * Web raw-PCM recorder (Expo web build).
 *
 * `getUserMedia` + a Web Audio graph captures Float32 samples. The
 * `AudioContext` is requested directly at 16 kHz, so the browser's native
 * (anti-aliased) resampler produces the target rate instead of a manual
 * decimation loop. Each block is converted to signed 16-bit little-endian
 * PCM and handed to the caller as an `ArrayBuffer`, matching the backend's
 * Azure Speech push-stream format, and is emitted verbatim over Socket.io
 * as an `audioChunk`.
 */

export type { PcmChunkHandler, PcmRecorder } from './pcmRecorder';

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 4096;

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;

/** Float [-1, 1] -> signed 16-bit little-endian PCM. */
function floatTo16BitPcm(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

export const pcmRecorder: PcmRecorder = {
  isSupported:
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (globalThis as { AudioContext?: unknown }).AudioContext !== 'undefined',

  async start(onChunk: PcmChunkHandler): Promise<void> {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: TARGET_SAMPLE_RATE,
      },
    });

    // Requesting the context at 16 kHz directly makes the browser's own
    // (anti-aliased) sample-rate converter produce the target rate, instead
    // of resampling with a manual decimation loop after the fact.
    audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    // Some browsers start the context suspended until a user gesture resumes it.
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (audioContext.sampleRate !== TARGET_SAMPLE_RATE) {
      // A browser that ignores the requested rate would otherwise silently
      // hand Azure Speech audio sampled at the wrong rate.
      throw new Error(
        `AudioContext ignored the requested ${TARGET_SAMPLE_RATE}Hz sample rate ` +
          `(got ${audioContext.sampleRate}Hz); this browser is not supported.`
      );
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(FRAME_SIZE, 1, 1);

    processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const channel = event.inputBuffer.getChannelData(0);
      onChunk(floatTo16BitPcm(channel));
    };

    sourceNode.connect(processorNode);
    // ScriptProcessorNode only runs while connected to a destination.
    processorNode.connect(audioContext.destination);
  },

  async stop(): Promise<void> {
    processorNode?.disconnect();
    sourceNode?.disconnect();
    mediaStream?.getTracks().forEach((track) => track.stop());
    await audioContext?.close();
    processorNode = null;
    sourceNode = null;
    mediaStream = null;
    audioContext = null;
  },
};

export default pcmRecorder;
