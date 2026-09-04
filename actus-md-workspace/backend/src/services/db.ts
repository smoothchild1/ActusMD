import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client for the whole process.
 *
 * We cache it on `globalThis` so that nodemon / ts-node hot-reloads during
 * development do not open a new SQLite connection pool on every restart.
 */
declare global {
  // eslint-disable-next-line no-var
  var __actusPrisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__actusPrisma__ ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__actusPrisma__ = prisma;
}

export default prisma;
