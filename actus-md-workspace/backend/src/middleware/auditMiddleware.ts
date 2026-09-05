import type { Request, Response, NextFunction } from 'express';
import prisma from '../services/db';

/**
 * HIPAA audit trail: one AuditLog row per read/write access to PHI, per the
 * "strict audit logging for every read/write action on patient data"
 * invariant. `AuditLog` rows are themselves append-only (created here, never
 * updated or deleted by application code).
 */

export type AuditAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';

export interface WriteAuditLogInput {
  userId: string;
  action: AuditAction;
  resource: string;
  patientId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write one audit trail entry directly. Exported (not just used internally
 * by `auditPHIAccess`) so any code path that touches PHI outside of an
 * Express request - e.g. the `generateDocument` Socket.io handler, which is
 * currently where all patient context reads and clinical note writes
 * actually happen - can log through the same table and shape.
 *
 * Failures here are logged to stderr but never thrown: an audit-logging
 * outage must not be able to block clinical workflows, though it must stay
 * visible so it gets investigated and fixed.
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        resource: input.resource,
        patientId: input.patientId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write audit log entry', { ...input, metadata: undefined }, err);
  }
}

export interface AuditPHIAccessOptions {
  /** What kind of access this route represents. */
  action: AuditAction;
  /** Human-readable resource name, e.g. "Artifact" or "PatientProfile". */
  resource: string | ((req: Request) => string);
  /** Extract the patientId this request touches, if any (params/body/query). */
  patientId?: (req: Request) => string | undefined;
  /** Extract the acting user's id. Defaults to the `x-user-id` header. */
  userId?: (req: Request) => string | undefined;
}

/**
 * Express middleware factory that logs one AuditLog entry per request to a
 * PHI-touching route. Mount it per-route (not globally) since the action and
 * resource name are specific to what the route actually does:
 *
 *   router.get('/:patientId/profile', auditPHIAccess({
 *     action: 'READ',
 *     resource: 'PatientProfile',
 *     patientId: (req) => req.params.patientId,
 *   }), handler);
 *
 * READ accesses are logged immediately (the access itself is the event).
 * CREATE/UPDATE/DELETE are logged after the response finishes, and only on a
 * 2xx status, so failed writes are not recorded as if they succeeded.
 */
export function auditPHIAccess(options: AuditPHIAccessOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = options.userId?.(req) ?? req.header('x-user-id') ?? 'unknown';
    const resource = typeof options.resource === 'function' ? options.resource(req) : options.resource;
    const patientId = options.patientId?.(req);

    if (options.action === 'READ') {
      void writeAuditLog({ userId, action: options.action, resource, patientId });
      next();
      return;
    }

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void writeAuditLog({
          userId,
          action: options.action,
          resource,
          patientId,
          metadata: { statusCode: res.statusCode, method: req.method, path: req.originalUrl },
        });
      }
    });
    next();
  };
}
