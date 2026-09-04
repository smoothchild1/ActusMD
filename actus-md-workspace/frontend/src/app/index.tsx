import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioDictation } from '@/components/AudioDictation';
import { WebUpload } from '@/components/WebUpload';
import { connectSocket, socket } from '@/lib/socket';
import { parseSoapNote, type SoapNote, type UiStateChangeEvent } from '@/lib/soap';

/**
 * Main pilot screen: ambient dictation + image upload, plus a global
 * `uiStateChange` listener that renders the final SOAP note the backend pushes
 * once a dictation is stopped and synthesized.
 */
export default function HomeScreen() {
  const [note, setNote] = useState<SoapNote | null>(null);
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    connectSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onUiStateChange = (event: UiStateChangeEvent) => {
      const parsed = parseSoapNote(event?.note);
      if (parsed) setNote(parsed);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('uiStateChange', onUiStateChange);
    setIsConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('uiStateChange', onUiStateChange);
    };
  }, []);

  const sections = useMemo(
    () =>
      note
        ? ([
            ['Subjective', note.subjective],
            ['Objective', note.objective],
            ['Assessment', note.assessment],
            ['Plan', note.plan],
            ['Follow-up', note.followUp],
          ] as const)
        : [],
    [note],
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-white">ActusMD</Text>
          <View className="flex-row items-center gap-2">
            <View
              className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-slate-600'}`}
            />
            <Text className="text-xs text-slate-400">
              {isConnected ? 'Connected to backend' : 'Offline'}
            </Text>
          </View>
        </View>

        <AudioDictation />
        <WebUpload />

        <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <Text className="text-base font-semibold text-slate-100">Generated SOAP Note</Text>

          {!note ? (
            <Text className="text-sm text-slate-500">
              The final note pushed from the backend will appear here after a dictation is
              stopped.
            </Text>
          ) : (
            <View className="gap-3">
              {sections.map(([label, value]) => (
                <View key={label} className="gap-1">
                  <Text className="text-xs uppercase tracking-wide text-blue-300">{label}</Text>
                  <Text className="text-sm text-slate-100">{value || 'Not documented'}</Text>
                </View>
              ))}

              {note.icd10Suggestions && note.icd10Suggestions.length > 0 ? (
                <View className="gap-1">
                  <Text className="text-xs uppercase tracking-wide text-blue-300">
                    ICD-10 Suggestions
                  </Text>
                  {note.icd10Suggestions.map((suggestion) => (
                    <Text key={suggestion.code} className="text-sm text-slate-100">
                      {suggestion.code} — {suggestion.description}
                    </Text>
                  ))}
                </View>
              ) : null}

              {note.redFlags && note.redFlags.length > 0 ? (
                <View className="gap-1">
                  <Text className="text-xs uppercase tracking-wide text-red-400">Red Flags</Text>
                  {note.redFlags.map((flag) => (
                    <Text key={flag} className="text-sm text-red-300">{`• ${flag}`}</Text>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
