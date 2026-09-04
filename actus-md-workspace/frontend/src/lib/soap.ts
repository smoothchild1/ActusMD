/**
 * Shapes for the clinical note the backend pushes over the `uiStateChange`
 * socket event. Mirrors `backend/src/services/azureOpenAI.ts` (`SoapNote`) and
 * the Prisma `ClinicalNote` row emitted by `socketManager.ts`.
 */

export interface Icd10Suggestion {
  code: string;
  description: string;
}

export interface SoapNote {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  icd10Suggestions?: Icd10Suggestion[];
  followUp?: string;
  redFlags?: string[];
  [key: string]: unknown;
}

/** The Prisma `ClinicalNote` row as serialized onto the socket. */
export interface ClinicalNoteRow {
  id: string;
  sessionId: string;
  /** JSON string of a {@link SoapNote}. */
  content: string;
  createdAt?: string;
}

/** Payload of the backend `uiStateChange` broadcast. */
export interface UiStateChangeEvent {
  type?: string;
  note?: ClinicalNoteRow;
  [key: string]: unknown;
}

/** Parse the serialized note content, returning null on malformed input. */
export function parseSoapNote(note: ClinicalNoteRow | undefined | null): SoapNote | null {
  if (!note?.content) return null;
  try {
    return JSON.parse(note.content) as SoapNote;
  } catch {
    return null;
  }
}
