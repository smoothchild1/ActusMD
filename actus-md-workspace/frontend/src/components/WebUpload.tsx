import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { API_URL } from '@/lib/socket';
import type { DocumentImageRef } from '@/lib/soap';

/**
 * Clinical image upload + (web-only) drag-and-drop and free-text context.
 *
 * Picks/drops images and POSTs them as multipart/form-data to the backend
 * `/api/upload` endpoint (multer field name `images`). The backend responds
 * with `{ count, files: [...] }`; uploaded files are reported to the parent
 * via `onImagesChange` so they can be bundled into a `generateDocument`
 * request.
 *
 * Per the Phase 4 blueprint, the drag-and-drop dropzone and the multiline
 * free-text input are web-only (`Platform.OS === 'web'`) - the mobile build
 * stays focused on audio capture + transcript, with only the existing
 * cross-platform image picker button available.
 */

interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  storedPath: string;
}

interface UploadResponse {
  count?: number;
  files?: UploadedFile[];
  error?: string;
}

interface WebUploadProps {
  /** Called whenever the set of successfully uploaded images changes. */
  onImagesChange?: (images: DocumentImageRef[]) => void;
  /** Called whenever the (web-only) free-text context input changes. */
  onFreeTextChange?: (text: string) => void;
}

const isWeb = Platform.OS === 'web';

export function WebUpload({ onImagesChange, onFreeTextChange }: WebUploadProps) {
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [freeText, setFreeText] = useState('');

  useEffect(() => {
    onImagesChange?.(
      uploaded.map((f) => ({ path: f.storedPath, url: `${API_URL}${f.url}` })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploaded]);

  const uploadFiles = useCallback(async (form: FormData) => {
    setError(null);
    setIsBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as UploadResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? `Upload failed (${response.status}).`);
      }
      setUploaded((prev) => [...prev, ...(payload.files ?? [])]);
    } catch (err) {
      setError((err as Error)?.message ?? 'Upload failed.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const pickAndUpload = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission was denied.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    const fileName = asset.fileName ?? `upload-${Date.now()}.jpg`;
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const form = new FormData();

    if (asset.file) {
      // Web: expo-image-picker hands back a real File object.
      form.append('images', asset.file, fileName);
    } else {
      // Native: React Native's FormData accepts a { uri, name, type } part.
      form.append('images', {
        uri: asset.uri,
        name: fileName,
        type: mimeType,
      } as unknown as Blob);
    }

    await uploadFiles(form);
  }, [uploadFiles]);

  // --- Web-only drag & drop --------------------------------------------
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  }, []);
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);
  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length === 0) return;

      const form = new FormData();
      files.forEach((f) => form.append('images', f, f.name));
      void uploadFiles(form);
    },
    [uploadFiles],
  );

  // react-native-web's <View> forwards unrecognized props straight through as
  // DOM attributes, so plain HTML5 drag-and-drop event handlers work here -
  // this whole block only ever mounts when Platform.OS === 'web'.
  const dropzoneWebProps = isWeb
    ? ({
        onDragEnter: handleDragEnter,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
      } as Record<string, unknown>)
    : {};

  return (
    <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <Text className="text-base font-semibold text-slate-100">Clinical Image Upload</Text>

      <Pressable
        disabled={isBusy}
        onPress={pickAndUpload}
        className={`items-center rounded-xl bg-blue-600 px-4 py-3 active:opacity-80 ${
          isBusy ? 'opacity-60' : ''
        }`}>
        <Text className="font-semibold text-white">{isBusy ? 'Uploading…' : 'Pick an Image'}</Text>
      </Pressable>

      {isWeb ? (
        <View
          {...dropzoneWebProps}
          className={`items-center justify-center rounded-xl border-2 border-dashed p-6 ${
            isDragOver ? 'border-blue-400 bg-blue-500/10' : 'border-white/20'
          }`}>
          <Text className="text-sm text-slate-300">
            {isDragOver ? 'Drop images to upload' : 'Or drag & drop images here (web only)'}
          </Text>
        </View>
      ) : null}

      {isBusy ? <ActivityIndicator color="#93c5fd" /> : null}
      {error ? <Text className="text-sm text-red-400">{error}</Text> : null}

      {uploaded.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs uppercase tracking-wide text-slate-400">
            Uploaded to backend ({uploaded.length})
          </Text>
          {uploaded.map((f) => (
            <View key={f.id} className="gap-1">
              <Image
                source={{ uri: `${API_URL}${f.url}` }}
                resizeMode="contain"
                className="h-32 w-full rounded-lg bg-black/30"
              />
              <Text className="text-xs text-slate-400" numberOfLines={1}>
                {f.filename} · {(f.size / 1024).toFixed(0)} KB
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {isWeb ? (
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wide text-slate-400">
            Free-text context (web only)
          </Text>
          <TextInput
            multiline
            numberOfLines={4}
            value={freeText}
            onChangeText={(text) => {
              setFreeText(text);
              onFreeTextChange?.(text);
            }}
            placeholder="Known history, reason for visit, additional context…"
            placeholderTextColor="#64748b"
            className="min-h-24 rounded-lg bg-black/30 p-3 text-sm text-slate-100"
            style={{ textAlignVertical: 'top' }}
          />
        </View>
      ) : null}
    </View>
  );
}

export default WebUpload;
