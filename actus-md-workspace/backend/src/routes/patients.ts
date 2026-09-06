import { Router, type Request, type Response, type NextFunction } from 'express';
import prisma from '../services/db';
import { writeAuditLog } from '../middleware/auditMiddleware';
import {
  emptyProfile,
  isPatientProfileModule,
  mergeProfileModules,
  parsePatientProfile,
  serializePatientProfile,
  PATIENT_PROFILE_MODULES,
  type PatientProfileSchema,
} from '../types/patientProfile';

/**
 * Patient dashboard / profile router (Phase 6).
 *
 *   GET   /api/patients/:identifier/dashboard   -> deterministic read of the
 *         decrypted PatientProfile JSON for the 6-module grid.
 *   PATCH /api/patients/:identifier/profile     -> human-in-the-loop write:
 *         a clinician's manual, deterministic override of one or more grid
 *         modules. No LLM in this path.
 *
 * Every handler writes a HIPAA AuditLog row through `writeAuditLog` using the
 * resolved internal `patient.id` (not the URL identifier), matching the
 * pattern already used in `socketManager.ts`.
 */

const router = Router();

/** Acting clinician id. The local pilot has no auth yet; the client sends `x-user-id`. */
function actingUserId(req: Request): string {
  return (req.header('x-user-id') || '').trim() || 'unknown';
}

function normalizedIdentifier(req: Request): string {
  return String(req.params.identifier ?? '').trim();
}

// --- GET /:identifier/dashboard ----------------------------------------------
router.get('/:identifier/dashboard', async (req: Request, res: Response) => {
  const identifier = normalizedIdentifier(req);
  if (!identifier) {
    return res.status(400).json({ error: 'A patient identifier is required.' });
  }

  const patient = await prisma.patient.findUnique({
    where: { patientIdentifier: identifier },
    include: { profile: true },
  });

  if (!patient) {
    return res.status(404).json({ error: `No patient found for identifier "${identifier}".` });
  }

  // READ of PHI - log the access itself as the event.
  void writeAuditLog({
    userId: actingUserId(req),
    action: 'READ',
    resource: 'PatientProfile',
    patientId: patient.id,
  });

  const profile: PatientProfileSchema = patient.profile
    ? parsePatientProfile(patient.profile.synthesizedData)
    : emptyProfile();

  return res.json({
    patient: {
      id: patient.id,
      patientIdentifier: patient.patientIdentifier,
      createdAt: patient.createdAt,
    },
    profile,
    hasProfile: Boolean(patient.profile),
  });
});

// --- PATCH /:identifier/profile ---------------------------------------------
interface ProfilePatchBody {
  /** Preferred: a partial profile keyed by module name. */
  modules?: Partial<PatientProfileSchema>;
  /** Convenience: a single module override. */
  module?: string;
  value?: unknown;
}

router.patch('/:identifier/profile', async (req: Request, res: Response) => {
  const identifier = normalizedIdentifier(req);
  if (!identifier) {
    return res.status(400).json({ error: 'A patient identifier is required.' });
  }

  const body = (req.body ?? {}) as ProfilePatchBody;

  // Build the patch object from either `modules` or a single `module`/`value`.
  let patch: Partial<PatientProfileSchema> = {};
  if (body.modules && typeof body.modules === 'object' && !Array.isArray(body.modules)) {
    patch = { ...body.modules };
  }
  if (typeof body.module === 'string') {
    patch = { ...patch, [body.module]: body.value } as Partial<PatientProfileSchema>;
  }

  const requestedKeys = Object.keys(patch);
  if (requestedKeys.length === 0) {
    return res.status(400).json({
      error: 'Provide `modules` (a partial profile) or `module` + `value`.',
      allowedModules: PATIENT_PROFILE_MODULES,
    });
  }

  const invalid = requestedKeys.filter((k) => !isPatientProfileModule(k));
  if (invalid.length > 0) {
    return res.status(400).json({
      error: `Unknown profile module(s): ${invalid.join(', ')}.`,
      allowedModules: PATIENT_PROFILE_MODULES,
    });
  }

  // Manual overrides target an existing patient; create the row if the
  // clinician is charting a brand-new identifier, matching socketManager.
  const patient = await prisma.patient.upsert({
    where: { patientIdentifier: identifier },
    update: {},
    create: { patientIdentifier: identifier },
    include: { profile: true },
  });

  const current = patient.profile
    ? parsePatientProfile(patient.profile.synthesizedData)
    : emptyProfile();

  const merged = mergeProfileModules(current, patch);
  const synthesizedData = serializePatientProfile(merged);

  await prisma.patientProfile.upsert({
    where: { patientId: patient.id },
    create: { patientId: patient.id, synthesizedData },
    update: { synthesizedData },
  });

  void writeAuditLog({
    userId: actingUserId(req),
    action: 'UPDATE',
    resource: 'PatientProfile',
    patientId: patient.id,
    metadata: { modules: requestedKeys, source: 'manual-patch' },
  });

  return res.json({
    patient: {
      id: patient.id,
      patientIdentifier: patient.patientIdentifier,
      createdAt: patient.createdAt,
    },
    profile: merged,
  });
});

// Translate unexpected errors into JSON (mirrors the upload router).
router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Request failed';
  // eslint-disable-next-line no-console
  console.error('[actus-md] patients router error:', message);
  res.status(500).json({ error: message });
});

export default router;
