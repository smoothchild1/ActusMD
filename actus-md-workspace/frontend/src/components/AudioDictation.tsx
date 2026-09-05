import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { pcmRecorder } from '@/lib/pcmRecorder';
import { connectSocket, socket } from '@/lib/socket';

/**
 * Ambient dictation control.
 *
 *  - Captures raw 16 kHz / 16-bit / mono PCM via {@link pcmRecorder}.
 *  - Streams each chunk to the backend as a binary `audioChunk` socket event.
 *  - Emits `audioStop` when the clinician stops; the backend only finalizes
 *    the transcript at that point (no AI call).
 *  - Renders `transcriptUpdate` events (partial + final) as an editable
 *    `TextInput` so the clinician can correct the transcript live or after
 *    stopping. `onTranscriptChange` keeps the parent's transcript state in
 *    sync with whatever is currently in the box (streamed text or manual
 *    edits), so it reflects exactly what will be sent to `generateDocument`.
 */

interface TranscriptUpdate {
  text: string;
  final: boolean;
}

interface TranscriptFinalized {
  transcript: string;
}

interface AudioDictationProps {
  /** Called with the current transcript text every time it changes. */
  onTranscriptChange?: (transcript: string) => void;
}

export function AudioDictation({ onTranscriptChange }: AudioDictationProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState('');
  const [partialText, setPartialText] = useState('');
  const chunkCount = useRef(0);

  // Kept in a ref so the socket listener effect below doesn't need to
  // re-subscribe every time the parent passes a new callback identity.
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  onTranscriptChangeRef.current = onTranscriptChange;

  useEffect(() => {
    function onTranscriptUpdate(update: TranscriptUpdate) {
      if (update?.final) {
        // Functional update so this merges onto whatever is currently in the
        // box - including any manual edits the clinician has already made -
        // rather than a stale `finalText` closed over when the listener was
        // registered.
        setFinalText((prev) => prev ? `${prev} ${update.text}` : update.text);
        setPartialText('');
      } else {
        // Partial (non-final) text is only ever shown separately below the
        // input, never written into `finalText`, so it can never clobber a
        // manual edit in progress.
        setPartialText(update?.text ?? '');
      }
    }
    function onTranscriptError(message: unknown) {
      setError(typeof message === 'string' ? message : 'Transcription error.');
    }
    function onTranscriptFinalized(payload: TranscriptFinalized) {
      // The server rebuilds this transcript from the same final chunks
      // already streamed and merged into `finalText` above, so it would
      // normally just repeat what's already in the box. Only fall back to it
      // when the box is still empty (e.g. a `transcriptUpdate` was missed) -
      // otherwise this would silently overwrite any manual edits the
      // clinician made during or after recording.
      setFinalText((prev) => {
        if (prev.trim()) return prev;
        const fallback = payload?.transcript ?? '';
        onTranscriptChangeRef.current?.(fallback);
        return fallback;
      });
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

  useEffect(() => {
    onTranscriptChangeRef.current?.(finalText);
  }, [finalText]);

  const handleFinalTextChange = useCallback((text: string) => {
    setFinalText(text);
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setFinalText('');
    setPartialText('');
    onTranscriptChangeRef.current?.('');
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
        <TextInput
          multiline
          scrollEnabled
          textAlignVertical="top"
          value={finalText}
          onChangeText={handleFinalTextChange}
          placeholder="Transcription will appear here as you speak… you can edit it at any time."
          placeholderTextColor="#64748b"
          className="max-h-40 min-h-24 rounded-lg bg-black/30 p-3 text-sm text-slate-100"
        />
        {partialText ? (
          <Text className="text-xs italic text-slate-400">{`Listening… ${partialText}`}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default AudioDictation;
