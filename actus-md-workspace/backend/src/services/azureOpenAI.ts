import fs from 'fs/promises';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from 'openai/resources/chat/completions';

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
function getClient(): AzureOpenAI {
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

const JSON_SHAPE_RULES = `Respond with ONLY minified JSON matching this shape:
{"sections":[{"heading":string,"content":string}, ...],
"icd10Suggestions":[{"code":string,"description":string}],"followUp":string,"redFlags":[string]}
Rules:
- Do not invent findings that are not supported by the transcript, images, or provided context.
- Use "Not documented" for any section with no supporting information.
- Keep clinical language concise and professional.`;

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

/**
 * Send the multimodal payload to Azure OpenAI and parse the JSON medical document,
 * using the system prompt for the requested `templateType`.
 */
export async function generateMedicalDocument(
  req: MedicalDocumentRequest,
): Promise<MedicalDocument> {
  const oai = getClient();

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

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt(req.templateType) },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await oai.chat.completions.create({
      model: DEPLOYMENT,
      messages: messages,
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const raw = result.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as GeneratedDocumentBody;
    return { ...parsed, templateType: req.templateType };
  } catch (err: unknown) {
    throw new Error('Azure OpenAI returned content that was not valid JSON or API request failed.');
  }
}

export default generateMedicalDocument;
