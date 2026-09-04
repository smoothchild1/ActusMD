import fs from 'fs/promises';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';

/**
 * Azure OpenAI - multimodal (image + text) -> structured JSON SOAP note.
 *
 * Uses the `@azure/openai` `OpenAIClient` against an Azure deployment. Keys and
 * endpoint come from environment variables loaded by dotenv in server.ts.
 */

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT ?? '';
const API_KEY = process.env.AZURE_OPENAI_API_KEY ?? '';
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? '';
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION ?? '2024-06-01';

export function isOpenAIConfigured(): boolean {
  return Boolean(ENDPOINT && API_KEY && DEPLOYMENT);
}

let client: OpenAIClient | null = null;
function getClient(): OpenAIClient {
  if (!isOpenAIConfigured()) {
    throw new Error(
      'Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, ' +
        'AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT_NAME in .env.',
    );
  }
  if (!client) {
    client = new OpenAIClient(ENDPOINT, new AzureKeyCredential(API_KEY), {
      apiVersion: API_VERSION,
    });
  }
  return client;
}

export interface SoapImageInput {
  /** Path to an image file on disk (e.g. something saved by the upload route). */
  path?: string;
  /** OR an already-formed URL / data URL. */
  url?: string;
  /** MIME type, used when reading from `path`. Defaults to image/jpeg. */
  mimeType?: string;
}

export interface SoapNoteRequest {
  /** Ambient dictation transcript for the encounter. */
  transcript: string;
  /** Optional supporting images (paper notes, wounds, monitors, lab printouts). */
  images?: SoapImageInput[];
  /** Optional free-text context (known history, reason for visit, etc.). */
  patientContext?: string;
}

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icd10Suggestions?: Array<{ code: string; description: string }>;
  followUp?: string;
  redFlags?: string[];
  [key: string]: unknown;
}

const SYSTEM_PROMPT = `You are a clinical documentation assistant for a licensed clinician.
Convert the ambient visit transcript and any attached images into a structured SOAP note.
Respond with ONLY minified JSON matching this shape:
{"subjective":string,"objective":string,"assessment":string,"plan":string,
"icd10Suggestions":[{"code":string,"description":string}],"followUp":string,"redFlags":[string]}
Rules:
- Do not invent findings that are not supported by the transcript or images.
- Use "Not documented" for any section with no supporting information.
- Keep clinical language concise and professional.`;

async function toImagePart(img: SoapImageInput) {
  if (img.url) {
    return { type: 'image_url' as const, imageUrl: { url: img.url } };
  }
  if (img.path) {
    const buf = await fs.readFile(img.path);
    const mime = img.mimeType ?? 'image/jpeg';
    return {
      type: 'image_url' as const,
      imageUrl: { url: `data:${mime};base64,${buf.toString('base64')}` },
    };
  }
  throw new Error('Image input requires either "path" or "url".');
}

/**
 * Send the multimodal payload to Azure OpenAI and parse the JSON SOAP note.
 */
export async function generateSoapNote(
  req: SoapNoteRequest,
): Promise<SoapNote> {
  const oai = getClient();

  const userContent: unknown[] = [
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

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const result = await oai.getChatCompletions(
    DEPLOYMENT,
    // The beta typings do not model multimodal content parts; cast is expected.
    messages as never,
    {
      temperature: 0.2,
      maxTokens: 1500,
      responseFormat: { type: 'json_object' },
    },
  );

  const raw = result.choices[0]?.message?.content ?? '';
  try {
    return JSON.parse(raw) as SoapNote;
  } catch {
    throw new Error(
      `Azure OpenAI returned content that was not valid JSON: ${raw.slice(0, 500)}`,
    );
  }
}

export default generateSoapNote;
