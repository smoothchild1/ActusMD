import type { PcmChunkHandler, PcmRecorder } from './pcmRecorder';

/**
 * Web raw-PCM recorder (Expo web build).
 *
 * `getUserMedia` + a Web Audio graph captures Float32 samples at the browser's
 * native rate; each block is downsampled to 16 kHz, converted to signed 16-bit
 * little-endian PCM, and handed to the caller as an `ArrayBuffer`. That matches
 * the backend's Azure Speech push-stream format and is emitted verbatim over
 * Socket.io as an `audioChunk`.
 */

export type { PcmChunkHandler, PcmRecorder } from './pcmRecorder';

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 4096;

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;

/** Average-decimate `input` from `inputRate` down to `TARGET_SAMPLE_RATE`. */
function downsample(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate <= TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.round(input.length / ratio);
  const output = new Float32Array(outLength);
  let outIndex = 0;
  let inIndex = 0;
  while (outIndex < outLength) {
    const nextInIndex = Math.round((outIndex + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = inIndex; i < nextInIndex && i < input.length; i += 1) {
      sum += input[i];
      count += 1;
    }
    output[outIndex] = count > 0 ? sum / count : 0;
    outIndex += 1;
    inIndex = nextInIndex;
  }
  return output;
}

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
      },
    });

    audioContext = new AudioContext();
    // Some browsers start the context suspended until a user gesture resumes it.
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(FRAME_SIZE, 1, 1);

    const inputRate = audioContext.sampleRate;
    processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const channel = event.inputBuffer.getChannelData(0);
      onChunk(floatTo16BitPcm(downsample(channel, inputRate)));
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
