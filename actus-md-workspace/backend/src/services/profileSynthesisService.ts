import prisma from './db';
import { getOpenAIClient, isOpenAIConfigured, OPENAI_DEPLOYMENT } from './azureOpenAI';
import { EMPTY_LIVING_PROFILE, parseSynthesizedData, getLivingProfile, type LivingProfile } from './patientContext';

export { getLivingProfile, type LivingProfile };

/**
 * Tier 2: Living Patient Profile synthesis.
 *
 * Whenever a new Artifact (Tier 1 raw input) is ingested, `synthesizePatientProfile`
 * merges it into the patient's existing Living Profile by asking Azure OpenAI to
 * fold the new information into the prior JSON snapshot. The result replaces
 * `PatientProfile.synthesizedData` (stored as encrypted JSON text, not a
 * previous-version log - Tier 1 artifacts remain the append-only source of truth
 * for "what was actually said/written and when").
 *
 * This is intentionally decoupled from any HTTP request: callers (an artifact
 * ingestion route, a queue worker, etc.) invoke it after an Artifact is
 * persisted, in the background, so encounter creation is never blocked on an
 * LLM round-trip.
 */

const SYSTEM_PROMPT = `You maintain a single, longitudinal clinical summary ("Living Profile") for a patient.

You will be given:
1. The patient's current Living Profile as JSON (may be empty for a new patient).
2. The text of one new clinical artifact (a dictation transcript, clinician note, or scanned chart OCR).

Merge the new artifact into the profile:
- Add new active problems, surgical history, medications, allergies, or baseline findings.
- Update or resolve existing entries the new artifact clearly supersedes (e.g. a resolved problem, a discontinued medication) rather than duplicating them.
- Do not delete history the new artifact does not contradict.
- Keep "summary" as a short (2-4 sentence) narrative overview of the patient's overall clinical picture.
- Do not invent facts that are not supported by the profile or the new artifact.

Respond with ONLY minified JSON matching this exact shape:
{"activeProblems":[string],"surgicalHistory":[string],"medications":[string],"allergies":[string],"recentBaselines":[string],"summary":string}`;

/**
 * Fold one new Artifact into the patient's Living Profile and persist the result.
 * Returns the updated, parsed profile.
 */
export async function synthesizePatientProfile(artifactId: string): Promise<LivingProfile> {
  const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: artifactId } });

  if (!artifact.rawText?.trim()) {
    throw new Error(`Artifact ${artifactId} has no text content to synthesize from.`);
  }

  const existingProfile = await prisma.patientProfile.findUnique({
    where: { patientId: artifact.patientId },
  });

  const currentProfile = parseSynthesizedData(existingProfile?.synthesizedData);

  const updatedProfile = isOpenAIConfigured()
    ? await callSynthesisModel(currentProfile, artifact.type, artifact.rawText)
    : currentProfile;

  await prisma.patientProfile.upsert({
    where: { patientId: artifact.patientId },
    create: {
      patientId: artifact.patientId,
      synthesizedData: JSON.stringify(updatedProfile),
      lastArtifactId: artifact.id,
    },
    update: {
      synthesizedData: JSON.stringify(updatedProfile),
      lastArtifactId: artifact.id,
    },
  });

  return updatedProfile;
}

async function callSynthesisModel(
  currentProfile: LivingProfile,
  artifactType: string,
  artifactText: string,
): Promise<LivingProfile> {
  const oai = getOpenAIClient();

  const result = await oai.chat.completions.create({
    model: OPENAI_DEPLOYMENT,
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Current Living Profile:\n${JSON.stringify(currentProfile)}\n\n` +
          `New artifact (type: ${artifactType}):\n${artifactText.trim()}`,
      },
    ],
  });

  const raw = result.choices[0]?.message?.content ?? '';
  try {
    return { ...EMPTY_LIVING_PROFILE, ...JSON.parse(raw) };
  } catch {
    throw new Error('Azure OpenAI returned content that was not valid JSON while synthesizing the profile.');
  }
}
