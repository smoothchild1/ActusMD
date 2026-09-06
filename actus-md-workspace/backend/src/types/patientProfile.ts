/**
 * PatientProfileSchema - the strict shape of a patient's Living Profile as it
 * is consumed by the Outpatient Dashboard grid (Phase 6).
 *
 * "Human-in-the-Loop Write, Deterministic Read":
 *  - READ  is deterministic: `GET /api/patients/:identifier/dashboard` decrypts
 *          and returns this JSON verbatim - no LLM in the request path.
 *  - WRITE is human-gated: either a clinician PATCH (manual grid override) or a
 *          clinician-accepted AI `profileDiff` committed via `commitDocument`.
 *
 * Persistence: this object is JSON-serialized into the existing
 * `PatientProfile.synthesizedData` column (schema.prisma), which is already
 * `/// @encrypted` via prisma-field-encryption. The grid simply uses a richer
 * JSON shape in that same encrypted string field, so no column migration is
 * required.
 */

export interface PatientDemographics {
  fullName?: string;
  dateOfBirth?: string;
  age?: string;
  sex?: string;
  mrn?: string;
  phone?: string;
  preferredLanguage?: string;
  [key: string]: unknown;
}

export interface SpecialtySnapshot {
  /**
   * Short label describing which specialty this snapshot covers
   * (e.g. "Cardiology", "Nephrology"). Optional.
   */
  focus?: string;
  /** Free-form specialty context lines shown as a list on the dashboard. */
  items: string[];
  [key: string]: unknown;
}

export interface PatientProfileSchema {
  demographics: PatientDemographics;
  allergies: string[];
  medicalHistory: string[];
  surgicalHistory: string[];
  medications: string[];
  socialHistory: string[];
  specialtySnapshot: SpecialtySnapshot;
  /** Short narrative overview shown at the top of the dashboard. */
  summary: string;
  /** ISO timestamp of the last write (manual PATCH or accepted AI commit). */
  lastUpdated?: string;
}

/** The grid modules a clinician can override via PATCH, plus the narrative summary. */
export const PATIENT_PROFILE_MODULES = [
  'demographics',
  'allergies',
  'medicalHistory',
  'surgicalHistory',
  'medications',
  'socialHistory',
  'specialtySnapshot',
  'summary',
] as const;

export type PatientProfileModule = (typeof PATIENT_PROFILE_MODULES)[number];

export function isPatientProfileModule(value: string): value is PatientProfileModule {
  return (PATIENT_PROFILE_MODULES as readonly string[]).includes(value);
}

export const EMPTY_PATIENT_PROFILE: PatientProfileSchema = {
  demographics: {},
  allergies: [],
  medicalHistory: [],
  surgicalHistory: [],
  medications: [],
  socialHistory: [],
  specialtySnapshot: { items: [] },
  summary: '',
};

/** Deep clone so callers can never mutate the shared `EMPTY_PATIENT_PROFILE`. */
export function emptyProfile(): PatientProfileSchema {
  return {
    demographics: {},
    allergies: [],
    medicalHistory: [],
    surgicalHistory: [],
    medications: [],
    socialHistory: [],
    specialtySnapshot: { items: [] },
    summary: '',
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
    .filter((v) => v.length > 0);
}

function toDemographics(value: unknown): PatientDemographics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: PatientDemographics = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : v;
  }
  return out;
}

function toSpecialtySnapshot(value: unknown): SpecialtySnapshot {
  if (Array.isArray(value)) {
    // Tolerate a bare string[] (older synthesis output).
    return { items: toStringArray(value) };
  }
  if (!value || typeof value !== 'object') return { items: [] };
  const obj = value as Record<string, unknown>;
  const snapshot: SpecialtySnapshot = { items: toStringArray(obj.items) };
  if (typeof obj.focus === 'string' && obj.focus.trim()) snapshot.focus = obj.focus.trim();
  return snapshot;
}

/**
 * Normalize an arbitrary parsed object into a well-formed `PatientProfileSchema`.
 * Also bridges the legacy `LivingProfile` shape written by earlier phases
 * (`activeProblems` / `recentBaselines`) so existing rows render on the grid.
 */
export function normalizePatientProfile(input: unknown): PatientProfileSchema {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const legacyActiveProblems = toStringArray(raw.activeProblems);
  const legacyRecentBaselines = toStringArray(raw.recentBaselines);

  const medicalHistory = raw.medicalHistory !== undefined
    ? toStringArray(raw.medicalHistory)
    : legacyActiveProblems;

  const specialtySnapshot = raw.specialtySnapshot !== undefined
    ? toSpecialtySnapshot(raw.specialtySnapshot)
    : { items: legacyRecentBaselines };

  const profile: PatientProfileSchema = {
    demographics: toDemographics(raw.demographics),
    allergies: toStringArray(raw.allergies),
    medicalHistory,
    surgicalHistory: toStringArray(raw.surgicalHistory),
    medications: toStringArray(raw.medications),
    socialHistory: toStringArray(raw.socialHistory),
    specialtySnapshot,
    summary: typeof raw.summary === 'string' ? raw.summary.trim() : '',
  };

  if (typeof raw.lastUpdated === 'string' && raw.lastUpdated.trim()) {
    profile.lastUpdated = raw.lastUpdated.trim();
  }

  return profile;
}

/** Parse the encrypted JSON string from `PatientProfile.synthesizedData`. */
export function parsePatientProfile(raw: string | null | undefined): PatientProfileSchema {
  if (!raw) return emptyProfile();
  try {
    return normalizePatientProfile(JSON.parse(raw));
  } catch {
    return emptyProfile();
  }
}

/** Serialize for storage back into `PatientProfile.synthesizedData`. */
export function serializePatientProfile(profile: PatientProfileSchema): string {
  return JSON.stringify(profile);
}

/**
 * Deterministically merge a partial patch into a base profile.
 *
 *  - Array modules (`allergies`, `medicalHistory`, ...) are REPLACED wholesale
 *    when present in the patch - the clinician sees and edits the full list, so
 *    the submitted list is authoritative.
 *  - `demographics` is shallow-merged key by key (a patch that only sets
 *    `phone` leaves the rest intact); pass an explicit empty string to clear a
 *    field.
 *  - `specialtySnapshot` is shallow-merged (`focus` / `items`).
 *  - `summary` is replaced when present.
 *  - `lastUpdated` is always stamped to now.
 *
 * No LLM, no network - pure function, so "Deterministic Read" holds and a
 * commit/PATCH always produces the same result for the same inputs.
 */
export function mergeProfileModules(
  base: PatientProfileSchema,
  patch: Partial<PatientProfileSchema>,
): PatientProfileSchema {
  const next = normalizePatientProfile(base);

  if (patch.demographics !== undefined) {
    next.demographics = { ...next.demographics, ...toDemographics(patch.demographics) };
  }
  if (patch.allergies !== undefined) next.allergies = toStringArray(patch.allergies);
  if (patch.medicalHistory !== undefined) next.medicalHistory = toStringArray(patch.medicalHistory);
  if (patch.surgicalHistory !== undefined) next.surgicalHistory = toStringArray(patch.surgicalHistory);
  if (patch.medications !== undefined) next.medications = toStringArray(patch.medications);
  if (patch.socialHistory !== undefined) next.socialHistory = toStringArray(patch.socialHistory);
  if (patch.specialtySnapshot !== undefined) {
    const patched = toSpecialtySnapshot(patch.specialtySnapshot);
    next.specialtySnapshot = { ...next.specialtySnapshot, ...patched };
  }
  if (patch.summary !== undefined && typeof patch.summary === 'string') {
    next.summary = patch.summary.trim();
  }

  next.lastUpdated = new Date().toISOString();
  return next;
}

/**
 * Render a profile into a compact text block for injection into an LLM system
 * prompt (historical context for `generateMedicalDocument`). Returns '' when
 * the profile carries no information, so callers can append unconditionally.
 */
export function buildProfileContextBlock(profile: PatientProfileSchema): string {
  const d = profile.demographics ?? {};
  const demoParts = [
    d.fullName && `name ${d.fullName}`,
    d.age && `age ${d.age}`,
    d.sex && `sex ${d.sex}`,
    d.dateOfBirth && `DOB ${d.dateOfBirth}`,
  ].filter(Boolean);

  const lines: string[] = [];
  if (demoParts.length) lines.push(`Demographics: ${demoParts.join(', ')}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);
  if (profile.allergies.length) lines.push(`Allergies: ${profile.allergies.join('; ')}`);
  if (profile.medicalHistory.length) lines.push(`Medical history: ${profile.medicalHistory.join('; ')}`);
  if (profile.surgicalHistory.length) lines.push(`Surgical history: ${profile.surgicalHistory.join('; ')}`);
  if (profile.medications.length) lines.push(`Medications: ${profile.medications.join('; ')}`);
  if (profile.socialHistory.length) lines.push(`Social history: ${profile.socialHistory.join('; ')}`);
  if (profile.specialtySnapshot.items.length) {
    const focus = profile.specialtySnapshot.focus ? `${profile.specialtySnapshot.focus}: ` : '';
    lines.push(`Specialty snapshot: ${focus}${profile.specialtySnapshot.items.join('; ')}`);
  }

  if (!lines.length) return '';

  return [
    'EXISTING PATIENT PROFILE (longitudinal context from prior encounters - use for ' +
      'continuity; do not restate verbatim and do not let it override findings from the ' +
      'current encounter):',
    ...lines,
  ].join('\n');
}
