import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';

/**
 * Single shared Prisma client for the whole process.
 *
 * We cache it on `globalThis` so that nodemon / ts-node hot-reloads during
 * development do not open a new Postgres connection pool on every restart.
 *
 * The `fieldEncryptionExtension` transparently encrypts/decrypts any field
 * annotated `/// @encrypted` in schema.prisma (e.g. Artifact.rawText,
 * PatientProfile.synthesizedData) using PRISMA_FIELD_ENCRYPTION_KEY.
 */
function createClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'warn', 'error'],
  }).$extends(fieldEncryptionExtension());
}

type ActusPrismaClient = ReturnType<typeof createClient>;

declare global {
  // eslint-disable-next-line no-var
  var __actusPrisma__: ActusPrismaClient | undefined;
}

export const prisma: ActusPrismaClient =
  globalThis.__actusPrisma__ ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__actusPrisma__ = prisma;
}

export default prisma;
