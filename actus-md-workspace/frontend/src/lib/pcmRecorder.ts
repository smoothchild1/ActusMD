import { PermissionsAndroid, Platform } from 'react-native';
import AudioRecord from 'react-native-audio-record';

/**
 * Native (iOS / Android) raw-PCM recorder.
 *
 * `react-native-audio-record` streams the microphone as base64 chunks of raw
 * 16 kHz / 16-bit / mono little-endian PCM - exactly the contract the backend's
 * Azure Speech push stream expects (`getWaveFormatPCM(16000, 16, 1)`). Each
 * chunk is decoded to an `ArrayBuffer` before being handed to the caller so it
 * can be emitted straight over Socket.io as a binary `audioChunk`.
 *
 * Requires a custom dev client / prebuild - the native module is not part of
 * Expo Go. The web build uses `pcmRecorder.web.ts` instead.
 */

export type PcmChunkHandler = (chunk: ArrayBuffer) => void;

export interface PcmRecorder {
  /** Whether raw PCM capture is available in the current runtime. */
  readonly isSupported: boolean;
  /** Begin streaming PCM chunks to `onChunk`. Rejects if permission is denied. */
  start(onChunk: PcmChunkHandler): Promise<void>;
  /** Stop the microphone and release native resources. */
  stop(): Promise<void>;
}

const RECORD_OPTIONS = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  // Android AudioSource.VOICE_RECOGNITION - minimal device-side processing.
  audioSource: 6,
  wavFile: 'actusmd-dictation.wav',
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

let dataListenerAttached = false;
let currentHandler: PcmChunkHandler | null = null;

async function ensureMicPermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone access',
      message: 'ActusMD needs the microphone to transcribe the visit.',
      buttonPositive: 'Allow',
    },
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Microphone permission was denied.');
  }
}

export const pcmRecorder: PcmRecorder = {
  isSupported: true,

  async start(onChunk: PcmChunkHandler): Promise<void> {
    await ensureMicPermission();

    currentHandler = onChunk;
    AudioRecord.init(RECORD_OPTIONS);

    // The native `on('data')` subscription cannot be removed, so attach it once
    // and route through the mutable `currentHandler`.
    if (!dataListenerAttached) {
      AudioRecord.on('data', (data: string) => {
        currentHandler?.(base64ToArrayBuffer(data));
      });
      dataListenerAttached = true;
    }

    AudioRecord.start();
  },

  async stop(): Promise<void> {
    currentHandler = null;
    await AudioRecord.stop();
  },
};

export default pcmRecorder;
