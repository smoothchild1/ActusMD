import { Link } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Shared "coming soon" scaffold for the Phase 6 routes that are wired into
 * navigation but not yet built out (images, labs, cardiac). Keeps the shell,
 * header and back-to-dashboard affordance consistent across them.
 */
export function PlaceholderScreen({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-white">{title}</Text>
          <Text className="text-xs text-slate-400">Placeholder route — Phase 6 scaffold</Text>
        </View>

        <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <Text className="text-sm text-slate-300">{blurb}</Text>
          <Link href="/" className="text-sm font-semibold text-blue-400">
            ← Back to dashboard
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default PlaceholderScreen;
