/**
 * Ambient type declarations for `react-native-audio-record`.
 *
 * The package ships no types and has no `@types/` counterpart, so this shim
 * describes just the surface ActusMD uses: init/start/stop plus the `data`
 * event that streams base64-encoded raw PCM frames.
 */
declare module 'react-native-audio-record' {
  export interface AudioRecordOptions {
    /** Samples per second. ActusMD captures at 16000 for Azure Speech. */
    sampleRate: number;
    /** Channel count. 1 = mono. */
    channels: number;
    /** Sample width in bits. 16 for signed little-endian PCM. */
    bitsPerSample: number;
    /**
     * Android `AudioSource` constant. 6 = VOICE_RECOGNITION, which disables
     * most device-side processing and is closest to a raw stream.
     */
    audioSource?: number;
    /** Optional on-disk WAV file name the native side also writes. */
    wavFile?: string;
    /** Optional native ring-buffer size in bytes. */
    bufferSize?: number;
  }

  export interface AudioRecordStatic {
    init(options: AudioRecordOptions): void;
    start(): void;
    /** Resolves with the path of the WAV file written during the session. */
    stop(): Promise<string>;
    /** Fires repeatedly with a base64 string of raw PCM bytes. */
    on(event: 'data', callback: (data: string) => void): void;
  }

  const AudioRecord: AudioRecordStatic;
  export default AudioRecord;
}
