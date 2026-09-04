import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { pcmRecorder } from '@/lib/pcmRecorder';
import { connectSocket, socket } from '@/lib/socket';

/**
 * Ambient dictation control.
 *
 *  - Captures raw 16 kHz / 16-bit / mono PCM via {@link pcmRecorder}.
 *  - Streams each chunk to the backend as a binary `audioChunk` socket event.
 *  - Emits `audioStop` when the clinician stops; the backend only finalizes
 *    the transcript at that point (no AI call) and replies with
 *    `transcriptFinalized`, which is handed to the parent via
 *    `onTranscriptFinalized` so it can be bundled into a later
 *    `generateDocument` request.
 *  - Renders `transcriptUpdate` events (partial + finalized) as live feedback.
 */

interface TranscriptUpdate {
  text: string;
  final: boolean;
}

interface TranscriptFinalized {
  transcript: string;
}

interface AudioDictationProps {
  /** Called with the authoritative transcript once the backend finalizes it. */
  onTranscriptFinalized?: (transcript: string) => void;
}

export function AudioDictation({ onTranscriptFinalized }: AudioDictationProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState('');
  const [partialText, setPartialText] = useState('');
  const chunkCount = useRef(0);

  // Kept in a ref so the socket listener effect below doesn't need to
  // re-subscribe every time the parent passes a new callback identity.
  const onTranscriptFinalizedRef = useRef(onTranscriptFinalized);
  onTranscriptFinalizedRef.current = onTranscriptFinalized;

  useEffect(() => {
    function onTranscriptUpdate(update: TranscriptUpdate) {
      if (update?.final) {
        setFinalText((prev) => (prev ? `${prev} ${update.text}` : update.text));
        setPartialText('');
      } else {
        setPartialText(update?.text ?? '');
      }
    }
    function onTranscriptError(message: unknown) {
      setError(typeof message === 'string' ? message : 'Transcription error.');
    }
    function onTranscriptFinalized(payload: TranscriptFinalized) {
      onTranscriptFinalizedRef.current?.(payload?.transcript ?? '');
    }
    function onConnectError(err: Error) {
      setError(`Cannot reach the server (${err.message}). Recording will not be transcribed.`);
    }

    socket.on('transcriptUpdate', onTranscriptUpdate);
    socket.on('transcriptError', onTranscriptError);
    socket.on('transcriptFinalized', onTranscriptFinalized);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('transcriptUpdate', onTranscriptUpdate);
      socket.off('transcriptError', onTranscriptError);
      socket.off('transcriptFinalized', onTranscriptFinalized);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setFinalText('');
    setPartialText('');
    chunkCount.current = 0;

    if (!pcmRecorder.isSupported) {
      setError('Raw audio capture is not available in this build.');
      return;
    }

    setIsBusy(true);
    try {
      connectSocket();
      await pcmRecorder.start((chunk) => {
        chunkCount.current += 1;
        socket.emit('audioChunk', chunk);
      });
      setIsRecording(true);
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to start recording.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setIsBusy(true);
    try {
      await pcmRecorder.stop();
      socket.emit('audioStop', {});
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to stop recording.');
    } finally {
      setIsRecording(false);
      setIsBusy(false);
    }
  }, []);

  const hasTranscript = Boolean(finalText || partialText);

  return (
    <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-slate-100">Ambient Dictation</Text>
        <View
          className={`h-2.5 w-2.5 rounded-full ${isRecording ? 'bg-red-500' : 'bg-slate-500'}`}
        />
      </View>

      <Pressable
        disabled={isBusy}
        onPress={isRecording ? handleStop : handleStart}
        className={`items-center rounded-xl px-4 py-3 active:opacity-80 ${
          isRecording ? 'bg-red-600' : 'bg-blue-600'
        } ${isBusy ? 'opacity-60' : ''}`}>
        <Text className="font-semibold text-white">
          {isBusy ? 'Working…' : isRecording ? 'Stop Recording' : 'Start Recording'}
        </Text>
      </Pressable>

      {isBusy ? <ActivityIndicator color="#93c5fd" /> : null}
      {error ? <Text className="text-sm text-red-400">{error}</Text> : null}

      <View className="gap-1">
        <Text className="text-xs uppercase tracking-wide text-slate-400">Live transcript</Text>
        <ScrollView className="max-h-40 rounded-lg bg-black/30 p-3">
          {hasTranscript ? (
            <Text className="text-sm text-slate-100">
              {finalText}
              {partialText ? <Text className="text-slate-400">{` ${partialText}`}</Text> : null}
            </Text>
          ) : (
            <Text className="text-sm text-slate-500">
              Transcription will appear here as you speak…
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

export default AudioDictation;
