import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  EMPTY_PROFILE,
  LIST_MODULES,
  fetchDashboard,
  linesToList,
  listToLines,
  patchProfile,
  type PatientDemographics,
  type PatientProfileModule,
  type PatientProfileSchema,
} from '@/lib/patientProfile';

/**
 * Outpatient Dashboard (Phase 6).
 *
 * "Deterministic Read": the whole grid is hydrated from a single
 * `GET /api/patients/:identifier/dashboard` (decrypted JSON, no AI).
 * "Human-in-the-Loop Write": every card has inline editing that PATCHes its
 * module back through `patchProfile` - the clinician's manual override.
 *
 * Layout: a fixed left column (Demographics on top, Allergies on the bottom),
 * a top navigation row to the other patient pages, and a 2x3 grid of the
 * remaining modules (Medical / Surgical history, Meds / Social history, and
 * the Specialty Snapshot).
 */

const NAV_LINKS = [
  { href: '/notes', label: 'Notes' },
  { href: '/images', label: 'Images' },
  { href: '/labs', label: 'Labs' },
  { href: '/cardiac', label: 'Cardiac' },
] as const;

const DEMOGRAPHIC_FIELDS: { key: keyof PatientDemographics; label: string }[] = [
  { key: 'fullName', label: 'Name' },
  { key: 'dateOfBirth', label: 'Date of Birth' },
  { key: 'age', label: 'Age' },
  { key: 'sex', label: 'Sex' },
  { key: 'mrn', label: 'MRN' },
  { key: 'phone', label: 'Phone' },
  { key: 'preferredLanguage', label: 'Preferred Language' },
];

export default function DashboardScreen() {
  const router = useRouter();

  const [identifierInput, setIdentifierInput] = useState('');
  const [loadedIdentifier, setLoadedIdentifier] = useState<string | null>(null);
  const [profile, setProfile] = useState<PatientProfileSchema>(EMPTY_PROFILE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingModule, setSavingModule] = useState<PatientProfileModule | null>(null);

  const load = useCallback(async (identifier: string) => {
    const id = identifier.trim();
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchDashboard(id);
      setProfile({ ...EMPTY_PROFILE, ...res.profile });
      setLoadedIdentifier(res.patient.patientIdentifier);
    } catch (err) {
      setError((err as Error).message);
      setLoadedIdentifier(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(
    async (module: PatientProfileModule, value: unknown) => {
      if (!loadedIdentifier) return;
      setSavingModule(module);
      setError(null);
      try {
        const res = await patchProfile(loadedIdentifier, {
          [module]: value,
        } as Partial<PatientProfileSchema>);
        setProfile({ ...EMPTY_PROFILE, ...res.profile });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSavingModule(null);
      }
    },
    [loadedIdentifier],
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
        {/* Header + patient loader */}
        <View className="gap-2">
          <Text className="text-2xl font-bold text-white">Outpatient Dashboard</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <TextInput
              value={identifierInput}
              onChangeText={setIdentifierInput}
              onSubmitEditing={() => load(identifierInput)}
              placeholder="Patient identifier (MRN)"
              placeholderTextColor="#64748b"
              autoCapitalize="characters"
              className="min-w-[200px] flex-1 rounded-lg bg-black/30 p-3 text-sm text-slate-100"
            />
            <Pressable
              onPress={() => load(identifierInput)}
              disabled={isLoading}
              className={`items-center rounded-lg bg-blue-600 px-4 py-3 ${
                isLoading ? 'opacity-60' : ''
              }`}>
              <Text className="text-sm font-semibold text-white">
                {isLoading ? 'Loading…' : 'Load'}
              </Text>
            </Pressable>
          </View>
          {loadedIdentifier ? (
            <Text className="text-xs text-slate-400">
              Showing {loadedIdentifier}
              {profile.lastUpdated
                ? ` · updated ${new Date(profile.lastUpdated).toLocaleString()}`
                : ''}
            </Text>
          ) : (
            <Text className="text-xs text-slate-500">
              Enter a patient identifier to load the dashboard. New identifiers start empty and
              can be filled in inline.
            </Text>
          )}
          {error ? <Text className="text-sm text-red-400">{error}</Text> : null}
        </View>

        {/* Top navigation row */}
        <View className="flex-row flex-wrap gap-2">
          <View className="rounded-lg bg-blue-600 px-3 py-2">
            <Text className="text-sm font-semibold text-white">Dashboard</Text>
          </View>
          {NAV_LINKS.map((link) => (
            <Pressable
              key={link.href}
              onPress={() => router.push(link.href)}
              className="rounded-lg bg-white/10 px-3 py-2 active:opacity-70">
              <Text className="text-sm font-medium text-slate-200">{link.label}</Text>
            </Pressable>
          ))}
        </View>

        {isLoading && !loadedIdentifier ? <ActivityIndicator color="#93c5fd" /> : null}

        {loadedIdentifier ? (
          <View className="gap-4" style={rowOnWideStyle}>
            {/* Fixed left column: Demographics (top) + Allergies (bottom) */}
            <View className="gap-4" style={leftColumnStyle}>
              <DemographicsCard
                demographics={profile.demographics}
                saving={savingModule === 'demographics'}
                onSave={(next) => save('demographics', next)}
              />
              <ListCard
                title="Allergies"
                accent="text-red-300"
                items={profile.allergies}
                saving={savingModule === 'allergies'}
                onSave={(next) => save('allergies', next)}
              />
            </View>

            {/* 2x3 grid of the remaining modules */}
            <View className="flex-1 flex-row flex-wrap gap-4">
              {LIST_MODULES.map((m) => (
                <View key={m.key} style={gridCellStyle}>
                  <ListCard
                    title={m.label}
                    items={profile[m.key]}
                    saving={savingModule === m.key}
                    onSave={(next) => save(m.key, next)}
                  />
                </View>
              ))}
              <View style={fullRowCellStyle}>
                <SpecialtyCard
                  snapshot={profile.specialtySnapshot}
                  saving={savingModule === 'specialtySnapshot'}
                  onSave={(next) => save('specialtySnapshot', next)}
                />
              </View>
            </View>
          </View>
        ) : null}

        {loadedIdentifier ? (
          <SummaryCard
            summary={profile.summary}
            saving={savingModule === 'summary'}
            onSave={(next) => save('summary', next)}
          />
        ) : null}

        <Link href="/notes" className="pt-2 text-sm font-semibold text-blue-400">
          Go to charting →
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Layout styles (flexbox math kept out of NativeWind arbitrary values) ---

const rowOnWideStyle: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap' };
const leftColumnStyle: ViewStyle = { flexGrow: 0, flexShrink: 0, flexBasis: 280, minWidth: 260 };
const gridCellStyle: ViewStyle = { flexGrow: 1, flexBasis: 260, minWidth: 240 };
const fullRowCellStyle: ViewStyle = { flexGrow: 1, flexBasis: '100%' };

// --- Cards ----------------------------------------------------------------

function CardShell({
  title,
  accent,
  editing,
  saving,
  onToggleEdit,
  onSave,
  onCancel,
  children,
}: {
  title: string;
  accent?: string;
  editing: boolean;
  saving: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <View className="flex-row items-center justify-between">
        <Text className={`text-sm font-semibold ${accent ?? 'text-slate-100'}`}>{title}</Text>
        {editing ? (
          <View className="flex-row gap-2">
            <Pressable onPress={onCancel} disabled={saving}>
              <Text className="text-xs text-slate-400">Cancel</Text>
            </Pressable>
            <Pressable onPress={onSave} disabled={saving}>
              <Text className="text-xs font-semibold text-emerald-400">
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onToggleEdit}>
            <Text className="text-xs font-semibold text-blue-400">Edit</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function ListCard({
  title,
  items,
  accent,
  saving,
  onSave,
}: {
  title: string;
  items: string[];
  accent?: string;
  saving: boolean;
  onSave: (next: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const beginEdit = () => {
    setDraft(listToLines(items));
    setEditing(true);
  };
  const commit = () => {
    onSave(linesToList(draft));
    setEditing(false);
  };

  return (
    <CardShell
      title={title}
      accent={accent}
      editing={editing}
      saving={saving}
      onToggleEdit={beginEdit}
      onSave={commit}
      onCancel={() => setEditing(false)}>
      {editing ? (
        <TextInput
          multiline
          value={draft}
          onChangeText={setDraft}
          placeholder="One entry per line"
          placeholderTextColor="#64748b"
          className="min-h-24 rounded-lg bg-black/30 p-3 text-sm text-slate-100"
          style={{ textAlignVertical: 'top' }}
        />
      ) : items.length === 0 ? (
        <Text className="text-sm text-slate-500">Not documented</Text>
      ) : (
        <View className="gap-1">
          {items.map((item, i) => (
            <Text key={`${item}-${i}`} className="text-sm text-slate-100">
              {`• ${item}`}
            </Text>
          ))}
        </View>
      )}
    </CardShell>
  );
}

function DemographicsCard({
  demographics,
  saving,
  onSave,
}: {
  demographics: PatientDemographics;
  saving: boolean;
  onSave: (next: PatientDemographics) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const beginEdit = () => {
    const seed: Record<string, string> = {};
    DEMOGRAPHIC_FIELDS.forEach((f) => {
      seed[f.key as string] = String(demographics?.[f.key] ?? '');
    });
    setDraft(seed);
    setEditing(true);
  };
  const commit = () => {
    const next: PatientDemographics = {};
    DEMOGRAPHIC_FIELDS.forEach((f) => {
      next[f.key] = (draft[f.key as string] ?? '').trim();
    });
    onSave(next);
    setEditing(false);
  };

  return (
    <CardShell
      title="Demographics"
      editing={editing}
      saving={saving}
      onToggleEdit={beginEdit}
      onSave={commit}
      onCancel={() => setEditing(false)}>
      <View className="gap-2">
        {DEMOGRAPHIC_FIELDS.map((f) => (
          <View key={f.key as string} className="gap-1">
            <Text className="text-xs uppercase tracking-wide text-slate-400">{f.label}</Text>
            {editing ? (
              <TextInput
                value={draft[f.key as string] ?? ''}
                onChangeText={(t) => setDraft((d) => ({ ...d, [f.key as string]: t }))}
                placeholder="—"
                placeholderTextColor="#64748b"
                className="rounded-lg bg-black/30 p-2 text-sm text-slate-100"
              />
            ) : (
              <Text className="text-sm text-slate-100">
                {String(demographics?.[f.key] ?? '') || '—'}
              </Text>
            )}
          </View>
        ))}
      </View>
    </CardShell>
  );
}

function SpecialtyCard({
  snapshot,
  saving,
  onSave,
}: {
  snapshot: PatientProfileSchema['specialtySnapshot'];
  saving: boolean;
  onSave: (next: { focus: string; items: string[] }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [focusDraft, setFocusDraft] = useState('');
  const [itemsDraft, setItemsDraft] = useState('');

  const beginEdit = () => {
    setFocusDraft(snapshot?.focus ?? '');
    setItemsDraft(listToLines(snapshot?.items));
    setEditing(true);
  };
  const commit = () => {
    onSave({ focus: focusDraft.trim(), items: linesToList(itemsDraft) });
    setEditing(false);
  };

  return (
    <CardShell
      title="Specialty Snapshot"
      editing={editing}
      saving={saving}
      onToggleEdit={beginEdit}
      onSave={commit}
      onCancel={() => setEditing(false)}>
      {editing ? (
        <View className="gap-2">
          <TextInput
            value={focusDraft}
            onChangeText={setFocusDraft}
            placeholder="Focus (e.g. Cardiology)"
            placeholderTextColor="#64748b"
            className="rounded-lg bg-black/30 p-2 text-sm text-slate-100"
          />
          <TextInput
            multiline
            value={itemsDraft}
            onChangeText={setItemsDraft}
            placeholder="One entry per line"
            placeholderTextColor="#64748b"
            className="min-h-24 rounded-lg bg-black/30 p-3 text-sm text-slate-100"
            style={{ textAlignVertical: 'top' }}
          />
        </View>
      ) : (
        <View className="gap-1">
          {snapshot?.focus ? (
            <Text className="text-xs uppercase tracking-wide text-blue-300">{snapshot.focus}</Text>
          ) : null}
          {(snapshot?.items ?? []).length === 0 ? (
            <Text className="text-sm text-slate-500">Not documented</Text>
          ) : (
            (snapshot?.items ?? []).map((item, i) => (
              <Text key={`${item}-${i}`} className="text-sm text-slate-100">{`• ${item}`}</Text>
            ))
          )}
        </View>
      )}
    </CardShell>
  );
}

function SummaryCard({
  summary,
  saving,
  onSave,
}: {
  summary: string;
  saving: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const beginEdit = () => {
    setDraft(summary ?? '');
    setEditing(true);
  };
  const commit = () => {
    onSave(draft.trim());
    setEditing(false);
  };

  return (
    <CardShell
      title="Summary"
      editing={editing}
      saving={saving}
      onToggleEdit={beginEdit}
      onSave={commit}
      onCancel={() => setEditing(false)}>
      {editing ? (
        <TextInput
          multiline
          value={draft}
          onChangeText={setDraft}
          placeholder="Short narrative overview"
          placeholderTextColor="#64748b"
          className="min-h-20 rounded-lg bg-black/30 p-3 text-sm text-slate-100"
          style={{ textAlignVertical: 'top' }}
        />
      ) : (
        <Text className="text-sm text-slate-100">{summary || 'Not documented'}</Text>
      )}
    </CardShell>
  );
}
