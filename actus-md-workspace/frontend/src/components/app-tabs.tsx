import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

/**
 * Native tab bar for ActusMD - the Phase 6 destinations: the Outpatient
 * Dashboard plus the charting / imaging / labs / cardiac pages. Icons use
 * SF Symbols (iOS) / Material Symbols (Android) so no bundled asset is needed.
 */
const DESTINATIONS = [
  { name: 'index', label: 'Dashboard', sf: 'square.grid.2x2.fill', md: 'dashboard' },
  { name: 'notes', label: 'Notes', sf: 'square.and.pencil', md: 'edit_note' },
  { name: 'images', label: 'Images', sf: 'photo.on.rectangle', md: 'image' },
  { name: 'labs', label: 'Labs', sf: 'testtube.2', md: 'science' },
  { name: 'cardiac', label: 'Cardiac', sf: 'heart.text.square', md: 'cardiology' },
] as const;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {DESTINATIONS.map((d) => (
        <NativeTabs.Trigger key={d.name} name={d.name}>
          <NativeTabs.Trigger.Label>{d.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={d.sf} md={d.md} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
