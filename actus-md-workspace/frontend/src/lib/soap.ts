/**
 * Shapes for the clinical document the backend pushes over the `uiStateChange`
 * socket event. Mirrors `backend/src/services/azureOpenAI.ts`
 * (`MedicalDocument`) and the Prisma `ClinicalNote` row emitted by
 * `socketManager.ts`.
 */

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

/** Parse the serialized document content, returning null on malformed input. */
export function parseMedicalDocument(note: ClinicalNoteRow | undefined | null): MedicalDocument | null {
  if (!note?.content) return null;
  try {
    return JSON.parse(note.content) as MedicalDocument;
  } catch {
    return null;
  }
}
