import prisma from './db';

/**
 * Context Retrieval (Streamlined Output).
 *
 * Shared by `profileSynthesisService` (which writes the Living Profile) and
 * `azureOpenAI` (which reads it back, along with recent raw Artifacts, to
 * inject longitudinal patient context into the system prompt before
 * generating a new clinical document). Kept in its own module - rather than
 * defined in either of those - so the two can depend on this without
 * creating a circular import between them.
 */

export interface LivingProfile {
  activeProblems: string[];
  surgicalHistory: string[];
  medications: string[];
  allergies: string[];
  recentBaselines: string[];
  summary: string;
  [key: string]: unknown;
}

export const EMPTY_LIVING_PROFILE: LivingProfile = {
  activeProblems: [],
  surgicalHistory: [],
  medications: [],
  allergies: [],
  recentBaselines: [],
  summary: '',
};

export function parseSynthesizedData(raw: string | null | undefined): LivingProfile {
  if (!raw) return { ...EMPTY_LIVING_PROFILE };
  try {
    return { ...EMPTY_LIVING_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_LIVING_PROFILE };
  }
}

/** Fetch and parse a patient's current Living Profile, if one exists. */
export async function getLivingProfile(patientId: string): Promise<LivingProfile | null> {
  const profile = await prisma.patientProfile.findUnique({ where: { patientId } });
  return profile ? parseSynthesizedData(profile.synthesizedData) : null;
}

const DEFAULT_RECENT_ARTIFACT_LIMIT = 5;
/** Cap how much raw artifact text gets pulled into a prompt, per artifact. */
const ARTIFACT_SNIPPET_LENGTH = 500;

export async function getRecentArtifacts(patientId: string, limit = DEFAULT_RECENT_ARTIFACT_LIMIT) {
  return prisma.artifact.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Fetch the Living Profile + recent Artifacts for a patient and format them
 * into a text block for injection into an LLM system prompt. Returns an
 * empty string if there is no prior context (e.g. a brand-new patient), so
 * callers can append it unconditionally without special-casing.
 */
export async function buildPatientContextBlock(patientId: string): Promise<string> {
  const [profile, recentArtifacts] = await Promise.all([
    getLivingProfile(patientId),
    getRecentArtifacts(patientId),
  ]);

  if (!profile && recentArtifacts.length === 0) {
    return '';
  }

  const lines: string[] = [
    'PATIENT CONTEXT (from prior records - use for continuity of care; ' +
      'do not restate verbatim, and do not let it override findings from the current encounter):',
  ];

  if (profile) {
    if (profile.summary) lines.push(`Summary: ${profile.summary}`);
    if (profile.activeProblems.length) lines.push(`Active problems: ${profile.activeProblems.join('; ')}`);
    if (profile.surgicalHistory.length) lines.push(`Surgical history: ${profile.surgicalHistory.join('; ')}`);
    if (profile.medications.length) lines.push(`Medications: ${profile.medications.join('; ')}`);
    if (profile.allergies.length) lines.push(`Allergies: ${profile.allergies.join('; ')}`);
    if (profile.recentBaselines.length) lines.push(`Recent baselines: ${profile.recentBaselines.join('; ')}`);
  }

  const snippets = recentArtifacts
    .filter((a) => a.rawText?.trim())
    .map((a) => `- [${a.createdAt.toISOString().slice(0, 10)}] (${a.type}) ${a.rawText!.trim().slice(0, ARTIFACT_SNIPPET_LENGTH)}`);

  if (snippets.length) {
    lines.push('Recent artifacts:', ...snippets);
  }

  return lines.join('\n');
}
