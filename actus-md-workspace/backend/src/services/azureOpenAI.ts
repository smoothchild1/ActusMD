import fs from 'fs/promises';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { buildPatientContextBlock } from './patientContext';
import {
  buildProfileContextBlock,
  normalizePatientProfile,
  type PatientProfileSchema,
} from '../types/patientProfile';

/**
 * Azure OpenAI - multimodal (image + text) -> structured JSON medical document.
 *
 * Uses the official `openai` package's `AzureOpenAI` client against an Azure
 * deployment. Keys and endpoint come from environment variables loaded by
 * `loadEnv.ts` (see `azure_stt_openai.env`) in server.ts.
 */

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT ?? '';
const API_KEY = process.env.AZURE_OPENAI_API_KEY ?? '';
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? '';
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION ?? '2024-06-01';

export function isOpenAIConfigured(): boolean {
  return Boolean(ENDPOINT && API_KEY && DEPLOYMENT);
}

let client: AzureOpenAI | null = null;

/** Shared Azure OpenAI client, reused by any service that needs chat completions. */
export function getOpenAIClient(): AzureOpenAI {
  if (!isOpenAIConfigured()) {
    throw new Error(
      'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, ' +
        'AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT_NAME in azure_stt_openai.env.',
    );
  }
  if (!client) {
    client = new AzureOpenAI({
      endpoint: ENDPOINT,
      apiKey: API_KEY,
      apiVersion: API_VERSION,
      deployment: DEPLOYMENT,
    });
  }
  return client;
}

/** Deployment name for the shared client, needed as the `model` param on each call. */
export const OPENAI_DEPLOYMENT = DEPLOYMENT;

export interface DocumentImageInput {
  /** Path to an image file on disk (e.g. something saved by the upload route). */
  path?: string;
  /** OR an already-formed URL / data URL. */
  url?: string;
  /** MIME type, used when reading from `path`. Defaults to image/jpeg. */
  mimeType?: string;
}

/** The output template a clinician can request. New types just need an entry in `TEMPLATE_PROMPTS`. */
export type TemplateType = 'SOAP Note' | 'Clinic Note' | (string & {});

export interface MedicalDocumentRequest {
  /** Ambient dictation transcript for the encounter. */
  transcript: string;
  /** Optional supporting images (paper notes, wounds, monitors, lab printouts). */
  images?: DocumentImageInput[];
  /** Optional free-text context (known history, reason for visit, etc.). */
  patientContext?: string;
  /** Which output format/template to generate. */
  templateType: TemplateType;
  /**
   * If provided, the patient's Living Profile and recent Artifacts are
   * fetched from Postgres and injected into the system prompt, giving the
   * model longitudinal context beyond this single encounter.
   */
  patientId?: string;
  /**
   * The patient's existing `PatientProfileSchema` (the 6-module dashboard
   * profile). When present it is injected into the system prompt as
   * historical context and the model returns a proposed `profileDiff`
   * folding this encounter into it. Takes precedence over `patientId`'s
   * `buildPatientContextBlock` when both are supplied.
   */
  existingProfile?: PatientProfileSchema;
}

export interface MedicalDocumentSection {
  heading: string;
  content: string;
}

interface GeneratedDocumentBody {
  sections: MedicalDocumentSection[];
  icd10Suggestions?: Array<{ code: string; description: string }>;
  followUp?: string;
  redFlags?: string[];
  [key: string]: unknown;
}

export interface MedicalDocument extends GeneratedDocumentBody {
  templateType: TemplateType;
}

/**
 * The Validation Gate payload. The model never writes to the database - it
 * proposes a `draftNote` (the structured clinical document) plus a
 * `profileDiff` (the patient's `PatientProfileSchema` with this encounter
 * folded in). Both are emitted to the client for review; nothing is persisted
 * until the clinician accepts via `commitDocument`.
 */
export interface DraftAndProfileDiff {
  draftNote: MedicalDocument;
  profileDiff: PatientProfileSchema;
}

const PROFILE_DIFF_SHAPE =
  '{"demographics":{"fullName":string,"dateOfBirth":string,"age":string,"sex":string,' +
  '"mrn":string,"phone":string,"preferredLanguage":string},' +
  '"allergies":[string],"medicalHistory":[string],"surgicalHistory":[string],' +
  '"medications":[string],"socialHistory":[string],' +
  '"specialtySnapshot":{"focus":string,"items":[string]},"summary":string}';

const JSON_SHAPE_RULES = `Respond with ONLY minified JSON matching this exact shape:
{"draftNote":{"sections":[{"heading":string,"content":string}, ...],
"icd10Suggestions":[{"code":string,"description":string}],"followUp":string,"redFlags":[string]},
"profileDiff":${PROFILE_DIFF_SHAPE}}
Rules for "draftNote":
- Do not invent findings that are not supported by the transcript, images, or provided context.
- Use "Not documented" for any section with no supporting information.
- Keep clinical language concise and professional.
Rules for "profileDiff":
- Start from the EXISTING PATIENT PROFILE block if one is provided and return the FULL updated
  profile, not just the changes: carry every existing entry forward unless this encounter
  clearly supersedes or resolves it.
- Add only new problems, medications, allergies, surgical/social history, or demographics that
  this encounter actually establishes. Never fabricate.
- If no existing profile is provided, populate it solely from what this encounter supports and
  leave the rest empty ([] or "").
- Keep "summary" to 2-4 sentences describing the patient's overall clinical picture.`;

/** System prompt per template type. Each defines the section headings the model must produce. */
const TEMPLATE_PROMPTS: Record<string, string> = {
  'SOAP Note': `You are a clinical documentation assistant for a licensed clinician.
Convert the ambient visit transcript and any attached images into a structured SOAP note with
exactly these sections, in order: "Subjective", "Objective", "Assessment", "Plan".
${JSON_SHAPE_RULES}`,
  'Clinic Note': `You are a clinical documentation assistant for a licensed clinician.
Convert the ambient visit transcript and any attached images into a structured outpatient clinic
note with exactly these sections, in order: "Chief Complaint", "History of Present Illness",
"Exam & Findings", "Assessment & Plan".
${JSON_SHAPE_RULES}`,
};

const DEFAULT_TEMPLATE: TemplateType = 'SOAP Note';

function getSystemPrompt(templateType: TemplateType): string {
  return TEMPLATE_PROMPTS[templateType] ?? TEMPLATE_PROMPTS[DEFAULT_TEMPLATE];
}

async function toImagePart(img: DocumentImageInput): Promise<ChatCompletionContentPart> {
  if (img.url) {
    return { type: 'image_url', image_url: { url: img.url } };
  }
  if (img.path) {
    const buf = await fs.readFile(img.path);
    const mime = img.mimeType ?? 'image/jpeg';
    return {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buf.toString('base64')}` },
    };
  }
  throw new Error('Image input requires either "path" or "url".');
}

interface ParsedGeneration {
  draftNote?: Partial<GeneratedDocumentBody>;
  profileDiff?: unknown;
  // Tolerate a model that forgets the wrapper and returns a bare note body.
  sections?: MedicalDocumentSection[];
}

/**
 * Send the multimodal payload to Azure OpenAI and parse the Validation Gate
 * response, using the system prompt for the requested `templateType`.
 *
 * Historical context injection (Step 2): when `req.existingProfile` is set, the
 * patient's `PatientProfileSchema` is rendered into the system prompt so the
 * model can (a) write a better-informed `draftNote` and (b) return a
 * `profileDiff` that folds this encounter into the existing profile. When only
 * `req.patientId` is set, the older `buildPatientContextBlock` (Living Profile
 * + recent Artifacts) is used instead.
 *
 * Nothing is persisted here - the caller (`socketManager`) emits the result to
 * the client and only writes to the database on `commitDocument`.
 */
export async function generateMedicalDocument(
  req: MedicalDocumentRequest,
): Promise<DraftAndProfileDiff> {
  const oai = getOpenAIClient();

  const userContent: ChatCompletionContentPart[] = [
    {
      type: 'text',
      text:
        `Visit transcript:\n${req.transcript?.trim() || '(no transcript captured)'}\n` +
        (req.patientContext
          ? `\nAdditional context:\n${req.patientContext.trim()}\n`
          : ''),
    },
  ];

  for (const img of req.images ?? []) {
    userContent.push(await toImagePart(img));
  }

  let contextBlock = '';
  if (req.existingProfile) {
    contextBlock = buildProfileContextBlock(req.existingProfile);
  } else if (req.patientId) {
    contextBlock = await buildPatientContextBlock(req.patientId);
  }
  const systemPrompt = contextBlock
    ? `${getSystemPrompt(req.templateType)}\n\n${contextBlock}`
    : getSystemPrompt(req.templateType);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await oai.chat.completions.create({
      model: DEPLOYMENT,
      messages: messages,
      temperature: 0.2,
      max_completion_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const raw = result.choices[0]?.message?.content ?? '';
    // Strip markdown fences before JSON.parse (see IMPLEMENTATION_PLAN gotcha).
    const rawCleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(rawCleaned) as ParsedGeneration;

    const noteBody: Partial<GeneratedDocumentBody> = parsed.draftNote
      ?? (parsed.sections ? { sections: parsed.sections } : {});

    const draftNote: MedicalDocument = {
      sections: Array.isArray(noteBody.sections) ? noteBody.sections : [],
      icd10Suggestions: noteBody.icd10Suggestions,
      followUp: noteBody.followUp,
      redFlags: noteBody.redFlags,
      templateType: req.templateType,
    };

    // Fold onto the existing profile so the diff is always the FULL updated
    // profile even if the model only returned changed fields.
    const base = req.existingProfile ?? {};
    const profileDiff = normalizePatientProfile({ ...base, ...(parsed.profileDiff as object ?? {}) });

    return { draftNote, profileDiff };
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[azureOpenAI] generateMedicalDocument failed:', err?.message || err);
    throw new Error(`Azure OpenAI Error: ${err?.message || String(err)}`);
  }
}

export default generateMedicalDocument;
