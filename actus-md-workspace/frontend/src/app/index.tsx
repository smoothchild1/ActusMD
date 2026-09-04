import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioDictation } from '@/components/AudioDictation';
import { WebUpload } from '@/components/WebUpload';
import { connectSocket, socket } from '@/lib/socket';
import {
  parseMedicalDocument,
  type DocumentImageRef,
  type MedicalDocument,
  type UiStateChangeEvent,
} from '@/lib/soap';

/** Output templates the clinician can pick from. Must match `TEMPLATE_PROMPTS` in the backend. */
const TEMPLATE_TYPES = ['SOAP Note', 'Clinic Note'] as const;
type TemplateType = (typeof TEMPLATE_TYPES)[number];

/**
 * Main pilot screen: ambient dictation + image/context capture, patient +
 * template selection, and a "Generate Output" action that emits
 * `generateDocument`. A global `uiStateChange` listener renders whatever
 * document the backend pushes back once generation finishes.
 */
export default function HomeScreen() {
  const [generatedDocument, setGeneratedDocument] = useState<MedicalDocument | null>(null);
  const [isConnected, setIsConnected] = useState(socket.connected);

  const [transcript, setTranscript] = useState('');
  const [freeText, setFreeText] = useState('');
  const [images, setImages] = useState<DocumentImageRef[]>([]);
  const [patientIdentifier, setPatientIdentifier] = useState('');
  const [templateType, setTemplateType] = useState<TemplateType>('SOAP Note');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    connectSocket();

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onUiStateChange = (event: UiStateChangeEvent) => {
      setIsGenerating(false);
      const parsed = parseMedicalDocument(event?.note);
      if (parsed) setGeneratedDocument(parsed);
    };
    const onTranscriptError = (message: unknown) => {
      setIsGenerating(false);
      setGenerateError(typeof message === 'string' ? message : 'Failed to generate document.');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('uiStateChange', onUiStateChange);
    socket.on('transcriptError', onTranscriptError);
    setIsConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('uiStateChange', onUiStateChange);
      socket.off('transcriptError', onTranscriptError);
    };
  }, []);

  const handleGenerate = useCallback(() => {
    setGenerateError(null);

    if (!patientIdentifier.trim()) {
      setGenerateError('Enter a patient identifier (e.g. MRN) before generating.');
      return;
    }
    if (!transcript.trim() && !freeText.trim() && images.length === 0) {
      setGenerateError('Record a dictation, add context, or attach an image first.');
      return;
    }

    setIsGenerating(true);
    connectSocket();
    socket.emit('generateDocument', {
      transcript,
      freeText,
      images,
      templateType,
      patientIdentifier: patientIdentifier.trim(),
    });
  }, [transcript, freeText, images, templateType, patientIdentifier]);

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

        <AudioDictation onTranscriptFinalized={setTranscript} />
        <WebUpload onImagesChange={setImages} onFreeTextChange={setFreeText} />

        <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <Text className="text-base font-semibold text-slate-100">Generate Output</Text>

          <View className="gap-1">
            <Text className="text-xs uppercase tracking-wide text-slate-400">
              Patient Identifier (MRN)
            </Text>
            <TextInput
              value={patientIdentifier}
              onChangeText={setPatientIdentifier}
              placeholder="e.g. MRN-10293"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              className="rounded-lg bg-black/30 p-3 text-sm text-slate-100"
            />
          </View>

          <View className="gap-1">
            <Text className="text-xs uppercase tracking-wide text-slate-400">Output Template</Text>
            <View className="flex-row gap-2">
              {TEMPLATE_TYPES.map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setTemplateType(type)}
                  className={`flex-1 items-center rounded-lg px-3 py-2 ${
                    templateType === type ? 'bg-blue-600' : 'bg-white/10'
                  }`}>
                  <Text
                    className={`text-sm font-medium ${
                      templateType === type ? 'text-white' : 'text-slate-300'
                    }`}>
                    {type}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            disabled={isGenerating}
            onPress={handleGenerate}
            className={`items-center rounded-xl bg-emerald-600 px-4 py-3 active:opacity-80 ${
              isGenerating ? 'opacity-60' : ''
            }`}>
            <Text className="font-semibold text-white">
              {isGenerating ? 'Generating…' : 'Generate Output'}
            </Text>
          </Pressable>

          {isGenerating ? <ActivityIndicator color="#6ee7b7" /> : null}
          {generateError ? <Text className="text-sm text-red-400">{generateError}</Text> : null}
        </View>

        <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <Text className="text-base font-semibold text-slate-100">
            {generatedDocument?.templateType ?? 'Generated Document'}
          </Text>

          {!generatedDocument ? (
            <Text className="text-sm text-slate-500">
              The final document pushed from the backend will appear here after you generate it.
            </Text>
          ) : (
            <View className="gap-3">
              {(generatedDocument.sections ?? []).map((section) => (
                <View key={section.heading} className="gap-1">
                  <Text className="text-xs uppercase tracking-wide text-blue-300">
                    {section.heading}
                  </Text>
                  <Text className="text-sm text-slate-100">
                    {section.content || 'Not documented'}
                  </Text>
                </View>
              ))}

              {generatedDocument.icd10Suggestions && generatedDocument.icd10Suggestions.length > 0 ? (
                <View className="gap-1">
                  <Text className="text-xs uppercase tracking-wide text-blue-300">
                    ICD-10 Suggestions
                  </Text>
                  {generatedDocument.icd10Suggestions.map((suggestion) => (
                    <Text key={suggestion.code} className="text-sm text-slate-100">
                      {suggestion.code} — {suggestion.description}
                    </Text>
                  ))}
                </View>
              ) : null}

              {generatedDocument.redFlags && generatedDocument.redFlags.length > 0 ? (
                <View className="gap-1">
                  <Text className="text-xs uppercase tracking-wide text-red-400">Red Flags</Text>
                  {generatedDocument.redFlags.map((flag) => (
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
