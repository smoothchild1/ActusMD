import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';

import { API_URL } from '@/lib/socket';

/**
 * Clinical image upload.
 *
 * Picks an image with `expo-image-picker` and POSTs it as multipart/form-data to
 * the backend `/api/upload` endpoint (multer field name `images`). The backend
 * responds with `{ count, files: [...] }`; the stored URL is shown as a preview.
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

export function WebUpload() {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndUpload = useCallback(async () => {
    setError(null);
    setUploaded(null);

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
    setLocalUri(asset.uri);
    setIsBusy(true);

    try {
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

      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as UploadResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? `Upload failed (${response.status}).`);
      }
      setUploaded(payload.files?.[0] ?? null);
    } catch (err) {
      setError((err as Error)?.message ?? 'Upload failed.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const previewUri = uploaded ? `${API_URL}${uploaded.url}` : localUri;

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

      {isBusy ? <ActivityIndicator color="#93c5fd" /> : null}
      {error ? <Text className="text-sm text-red-400">{error}</Text> : null}

      {previewUri ? (
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wide text-slate-400">
            {uploaded ? 'Uploaded to backend' : 'Selected (not yet uploaded)'}
          </Text>
          <Image
            source={{ uri: previewUri }}
            resizeMode="contain"
            className="h-48 w-full rounded-lg bg-black/30"
          />
          {uploaded ? (
            <Text className="text-xs text-slate-400" numberOfLines={1}>
              {uploaded.filename} · {(uploaded.size / 1024).toFixed(0)} KB
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default WebUpload;
