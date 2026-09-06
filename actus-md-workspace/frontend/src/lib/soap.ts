/**
 * Shapes for the clinical document the backend pushes over the `uiStateChange`
 * socket event. Mirrors `backend/src/services/azureOpenAI.ts`
 * (`MedicalDocument`) and the Prisma `ClinicalNote` row emitted by
 * `socketManager.ts`.
 */

import type { PatientProfileSchema } from '@/lib/patientProfile';

export interface Icd10Suggestion {
  code: string;
  description: string;
}

/** A supporting image already uploaded to the backend, ready to bundle into a `generateDocument` request. */
export interface DocumentImageRef {
  /** Server-local filesystem path (read directly by the backend's AI service). */
  path: string;
  /** Publicly reachable URL, kept for display / fallback. */
  url: string;
}

export interface MedicalDocumentSection {
  heading: string;
  content: string;
}

export interface MedicalDocument {
  templateType?: string;
  sections?: MedicalDocumentSection[];
  icd10Suggestions?: Icd10Suggestion[];
  followUp?: string;
  redFlags?: string[];
  [key: string]: unknown;
}

/** The Prisma `ClinicalNote` row as serialized onto the socket. */
export interface ClinicalNoteRow {
  id: string;
  sessionId: string;
  patientId: string;
  /** JSON string of a {@link MedicalDocument}. */
  content: string;
  createdAt?: string;
}

export interface PatientRow {
  id: string;
  patientIdentifier: string;
  createdAt?: string;
}

/** Payload of the backend `uiStateChange` broadcast. */
export interface UiStateChangeEvent {
  type?: string;
  note?: ClinicalNoteRow;
  patient?: PatientRow;
  [key: string]: unknown;
}

/**
 * Validation Gate step 1: the backend's `documentProposed` payload. Nothing is
 * persisted yet - the client renders the draft + the proposed profile updates
 * and echoes them back on `commitDocument`.
 */
export interface DocumentProposedEvent {
  draftNote: MedicalDocument;
  /** The model's proposed FULL updated profile for this patient. */
  profileDiff: PatientProfileSchema;
  /** The profile as it stands today, for side-by-side review. */
  existingProfile: PatientProfileSchema;
  patient: { id: string; patientIdentifier: string };
  templateType?: string;
  sessionId?: string;
}

/** Validation Gate step 2: the backend's `documentCommitted` payload. */
export interface DocumentCommittedEvent {
  type?: string;
  note?: ClinicalNoteRow;
  patient?: PatientRow;
  profile?: PatientProfileSchema | null;
}

/** Parse the serialized document content, returning null on malformed input. */
export function parseMedicalDocument(note: ClinicalNoteRow | undefined | null): MedicalDocument | null {
  if (!note?.content) return null;
  try {
    return JSON.parse(note.content) as MedicalDocument;
  } catch {
    return null;
  }
}
