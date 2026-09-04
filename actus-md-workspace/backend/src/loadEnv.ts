import dotenv from 'dotenv';
import path from 'path';

/**
 * Explicit env loading, imported for its side effect as the very first thing
 * `server.ts` requires so downstream modules (e.g. `services/azureOpenAI.ts`,
 * which reads `process.env.AZURE_OPENAI_*` at import time) see populated vars.
 *
 * Local/non-secret config (PORT, DATABASE_URL, CORS_ORIGIN) still comes from
 * the standard `.env`. Azure credentials live in `azure_stt_openai.env`, a
 * separate file (see `azure_stt_openai.env.template`) so they can be rotated
 * independently of the rest of the local config.
 */
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), 'azure_stt_openai.env') });
