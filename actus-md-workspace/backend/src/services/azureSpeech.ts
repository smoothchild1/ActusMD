import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

/**
 * Azure AI Speech - continuous streaming recognition.
 *
 * NOTE: the task brief names the package `@azure/cognitiveservices-speech`, which
 * does not exist on npm. The official Speech SDK for Node is
 * `microsoft-cognitiveservices-speech-sdk` and is used here.
 *
 * Audio contract: callers push raw 16 kHz / 16-bit / mono PCM frames via
 * `pushAudio()`. That is the format `createPushStream()` assumes by default and
 * what the mobile client is expected to capture.
 */

const SPEECH_KEY = process.env.SPEECH_KEY ?? '';
const SPEECH_REGION = process.env.SPEECH_REGION ?? '';
const SPEECH_LANGUAGE = process.env.SPEECH_LANGUAGE ?? 'en-US';

export interface SpeechStreamHandlers {
  /** Fired repeatedly with the in-progress hypothesis for the current utterance. */
  onPartial?: (text: string) => void;
  /** Fired once per finalized utterance. */
  onFinal?: (text: string) => void;
  /** Fired on recognition / connection errors. */
  onError?: (message: string) => void;
}

export interface SpeechStreamSession {
  /** Feed one chunk of PCM audio into the recognizer. */
  pushAudio: (chunk: Buffer | Uint8Array | ArrayBuffer) => void;
  /** Stop recognition and release the recognizer + stream. */
  stop: () => Promise<void>;
}

export function isSpeechConfigured(): boolean {
  return Boolean(SPEECH_KEY && SPEECH_REGION);
}

function toArrayBuffer(chunk: Buffer | Uint8Array | ArrayBuffer): ArrayBuffer {
  if (chunk instanceof ArrayBuffer) return chunk;
  const view = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

/**
 * Open a streaming recognition session. Throws if Azure Speech is not configured.
 */
export function createSpeechStream(
  handlers: SpeechStreamHandlers,
): SpeechStreamSession {
  if (!isSpeechConfigured()) {
    throw new Error(
      'Azure Speech is not configured. Set SPEECH_KEY and SPEECH_REGION in .env.',
    );
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  speechConfig.speechRecognitionLanguage = SPEECH_LANGUAGE;
  speechConfig.outputFormat = sdk.OutputFormat.Simple;

  const pushStream = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
  );
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
      handlers.onPartial?.(e.result.text);
    }
  };

  recognizer.recognized = (_s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
      handlers.onFinal?.(e.result.text);
    }
  };

  recognizer.canceled = (_s, e) => {
    if (e.reason === sdk.CancellationReason.Error) {
      handlers.onError?.(
        e.errorDetails || `Azure Speech canceled (code ${e.errorCode}).`,
      );
    }
  };

  recognizer.sessionStopped = () => {
    // Recognizer stopped on its own (e.g. stream closed); nothing to do.
  };

  recognizer.startContinuousRecognitionAsync(undefined, (err) =>
    handlers.onError?.(typeof err === 'string' ? err : String(err)),
  );

  return {
    pushAudio: (chunk) => {
      pushStream.write(toArrayBuffer(chunk));
    },
    stop: () =>
      new Promise<void>((resolve) => {
        const cleanup = () => {
          try {
            pushStream.close();
          } catch {
            /* already closed */
          }
          recognizer.close();
          resolve();
        };
        recognizer.stopContinuousRecognitionAsync(cleanup, cleanup);
      }),
  };
}

export default createSpeechStream;
