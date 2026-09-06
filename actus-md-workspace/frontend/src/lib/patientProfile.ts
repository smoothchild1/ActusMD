/**
 * Client mirror of the backend `PatientProfileSchema`
 * (`backend/src/types/patientProfile.ts`) plus the deterministic REST helpers
 * the Outpatient Dashboard uses.
 *
 * "Deterministic Read": `fetchDashboard` is a plain GET of decrypted JSON.
 * "Human-in-the-Loop Write": `patchProfile` is the clinician's manual override
 * of one or more grid modules - no AI in this path.
 */

import { API_URL, MOCK_USER_ID } from '@/lib/socket';

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
  focus?: string;
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
  summary: string;
  lastUpdated?: string;
}

export type PatientProfileModule = keyof Omit<PatientProfileSchema, 'lastUpdated'>;

/** The 2x3 list-module grid cells, in render order. */
export const LIST_MODULES: {
  key: Extract<
    PatientProfileModule,
    'medicalHistory' | 'surgicalHistory' | 'medications' | 'socialHistory'
  >;
  label: string;
}[] = [
  { key: 'medicalHistory', label: 'Medical History' },
  { key: 'surgicalHistory', label: 'Surgical History' },
  { key: 'medications', label: 'Medications' },
  { key: 'socialHistory', label: 'Social History' },
];

export const EMPTY_PROFILE: PatientProfileSchema = {
  demographics: {},
  allergies: [],
  medicalHistory: [],
  surgicalHistory: [],
  medications: [],
  socialHistory: [],
  specialtySnapshot: { items: [] },
  summary: '',
};

export interface DashboardResponse {
  patient: { id: string; patientIdentifier: string; createdAt?: string };
  profile: PatientProfileSchema;
  hasProfile: boolean;
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  'x-user-id': MOCK_USER_ID,
};

/** Deterministic read of a patient's dashboard profile. */
export async function fetchDashboard(identifier: string): Promise<DashboardResponse> {
  const res = await fetch(
    `${API_URL}/api/patients/${encodeURIComponent(identifier.trim())}/dashboard`,
    { headers: { 'x-user-id': MOCK_USER_ID } },
  );
  const payload = (await res.json()) as DashboardResponse & { error?: string };
  if (!res.ok) {
    throw new Error(payload.error ?? `Failed to load dashboard (${res.status}).`);
  }
  return payload;
}

/**
 * Human-in-the-loop write: PATCH one or more grid modules. Pass a partial
 * profile keyed by module name; arrays replace the module wholesale,
 * `demographics` / `specialtySnapshot` are shallow-merged server-side.
 */
export async function patchProfile(
  identifier: string,
  modules: Partial<PatientProfileSchema>,
): Promise<{ patient: DashboardResponse['patient']; profile: PatientProfileSchema }> {
  const res = await fetch(
    `${API_URL}/api/patients/${encodeURIComponent(identifier.trim())}/profile`,
    { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ modules }) },
  );
  const payload = (await res.json()) as {
    patient: DashboardResponse['patient'];
    profile: PatientProfileSchema;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(payload.error ?? `Failed to save changes (${res.status}).`);
  }
  return payload;
}

/** Split a multiline text block into a trimmed, non-empty string[] (grid editing). */
export function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Join a string[] into an editable multiline block. */
export function listToLines(list: string[] | undefined): string {
  return (list ?? []).join('\n');
}
