# Implementation Plan & State Tracker

**Current Sync:** Last action: Completed Phase 6 - Outpatient Dashboard grid, deterministic PatientProfile REST APIs, and the "Human-in-the-Loop Write / Deterministic Read" Validation Gate (generateDocument now proposes `{draftNote, profileDiff}`; new `commitDocument` persists on Sign & Accept). Backend verified end-to-end against live Azure OpenAI + Postgres; frontend type-checks clean. Next immediate action: exercise the new dashboard + Validation Gate in the running Expo web app and wire the placeholder Images/Labs/Cardiac routes to real data.
## Current Objective
- **Phase 6 (DONE):** Outpatient Dashboard Grid & Deterministic Storage. "Human-in-the-Loop Write, Deterministic Read": grid hydrates from one decrypted GET; every write is either a clinician PATCH or a clinician-accepted AI `profileDiff`.

## Active Dependencies & Architecture
- **Backend:** Node.js/Express, TypeScript, Prisma (SQLite), Socket.io, `azure-cognitiveservices-speech-sdk`, `openai`.
- **Frontend:** Expo (React Native Web), NativeWind, Socket.io-client.
- **Two-Tier Clinical Databank Architecture:**
  1. **Tier 1 (Immutable Artifact Store):** Append-only raw inputs (audio, text, images).
  2. **Tier 2 (Living Patient Profile):** Background synthesized JSONB in Postgres representing active problems, etc.
  3. **Context Retrieval:** New encounters fetch the Living Profile and recent artifacts to inject into the LLM prompt.
- **Phase 6 - Human-in-the-Loop Write / Deterministic Read:**
  - **Read path (deterministic, no AI):** `GET /api/patients/:identifier/dashboard` -> decrypt `PatientProfile.synthesizedData` -> return `PatientProfileSchema` JSON for the grid.
  - **Write path (human-gated):** either `PATCH /api/patients/:identifier/profile` (manual per-module override) or the Validation Gate - socket `generateDocument` -> `documentProposed {draftNote, profileDiff}` (nothing saved) -> clinician "Sign & Accept" -> socket `commitDocument` -> `ClinicalNote` insert + `PatientProfile` upsert -> `documentCommitted`.
  - `PatientProfileSchema` lives in the existing encrypted `synthesizedData` column; `backend/src/types/patientProfile.ts` is the single source of truth and bridges the legacy `LivingProfile` shape.

## Failed Approaches & Gotchas
- **[Error]:** React infinite render loop in `AudioDictation.tsx` caused by calling `setState` inside a render closure that depends on incoming socket payloads. **[Solution/Rule]:** Do not use `setState` directly on incoming socket props; always use a `useEffect` buffer to decouple local state from parent state.
- **[Error]:** Poor speech-to-text accuracy caused by default `AudioContext` browser downsampling. **[Solution/Rule]:** Always request `16000Hz` directly in the `getUserMedia` constraints (e.g., in `pcmRecorder.web.ts`) when piping audio to Azure STT.
- **[Error]:** Backend JSON parsing crash caused by Azure OpenAI wrapping JSON objects in markdown (```json). **[Solution/Rule]:** Always use a regex replacement to strip markdown formatting before attempting `JSON.parse` on LLM outputs (e.g., in `azureOpenAI.ts`).
- **[Error]:** Azure OpenAI 400 Bad Request error caused by using deprecated `max_tokens` parameter on newer models (e.g., gpt-4o-mini). **[Solution/Rule]:** Always use `max_completion_tokens` instead of `max_tokens` when configuring OpenAI API calls.
- **[Error]:** Stale TypeScript / IDE "Property 'patient' does not exist on PrismaClient" errors after editing `schema.prisma` in an earlier phase, caused by an out-of-date generated client in `node_modules/.prisma`. **[Solution/Rule]:** Run `npx prisma generate` in `backend/` before trusting `tsc`/IDE diagnostics on any code that touches new models or fields.
- **[Error]:** Running `npx expo lint` in `frontend/` silently installs `eslint` + `eslint-config-expo`, rewrites `package.json` / `package-lock.json`, and drops an `eslint.config.js` - then still fails with "Cannot find module 'eslint'". **[Solution/Rule]:** Do not run `expo lint` for verification; use `npx tsc --noEmit` in `frontend/`. If lint setup is ever wanted, do it as its own committed change, not as a side effect.
- **[Gotcha]:** `PatientProfileSchema` (the 6-module dashboard profile) is stored as JSON in the existing `PatientProfile.synthesizedData` `/// @encrypted` column - NOT a new table/column. `backend/src/types/patientProfile.ts` normalizes both the new shape and the legacy `LivingProfile` (`activeProblems` -> `medicalHistory`, `recentBaselines` -> `specialtySnapshot.items`). No Prisma migration was needed for Phase 6.
- **[Gotcha]:** Expo Router typed routes: adding `app/*.tsx` files does not update `.expo/types/router.d.ts` until `expo start` runs, so `tsc` fails on new `href`s. The file was hand-updated for the Phase 6 routes; it will be regenerated automatically on the next `expo start`.

## Completed Milestones
- [x] **Phase 1 (Agent 1):** Workspace & Backend Setup (Node.js/Express scaffold, SQLite/Prisma schema, `fs` image upload middleware).
- [x] **Phase 2 (Agent 2):** WebSockets & AI Integration (Socket.io rooms, Azure AI Speech routing, Azure OpenAI multimodal handling).
- [x] **Phase 3 (Agent 3):** Frontend Scaffold & Sync (Expo/React Native setup, NativeWind layout, Socket.io client, AudioDictation, WebUpload).
- [x] **Phase 4 (Agent 4):** UI Upgrades, Decoupled AI, & Patient Assignment. Added `Patient` model, decoupled `socketManager.ts`, added UI patient picker and WebUpload free-text support.
- [x] **Phase 5 (Agent 5):** HIPAA-Compliant Context Retrieval and Data Storage Architecture (Two-Tier Clinical Databank integration + debugging STT/OpenAI connections).
- [x] **Phase 6 (Agent 6):** Outpatient Dashboard Grid & Deterministic Storage.
  - **Backend types:** `backend/src/types/patientProfile.ts` - strict `PatientProfileSchema` (demographics, allergies, medical/surgical history, medications, social history, specialty snapshot, summary), plus deterministic `mergeProfileModules` / `parse` / `serialize` / `buildProfileContextBlock` helpers. Persisted in the existing encrypted `synthesizedData` column (no migration).
  - **Backend REST:** `backend/src/routes/patients.ts` wired at `/api/patients` - `GET /:identifier/dashboard` (deterministic decrypted read) and `PATCH /:identifier/profile` (manual per-module clinician override). Both write HIPAA `AuditLog` rows via `writeAuditLog` with the resolved internal `patient.id`.
  - **Context injection + Validation Gate:** `generateMedicalDocument()` now accepts `existingProfile` and returns `{ draftNote, profileDiff }`; it no longer persists. `socketManager.ts`: `generateDocument` emits `documentProposed` (nothing saved); new `commitDocument` listener creates the `ClinicalNote` and upserts the `PatientProfile` (deterministic merge of the accepted `profileDiff`) then emits `documentCommitted` + `uiStateChange`.
  - **Frontend routing:** Expo Router routes `notes.tsx` (charting - moved dictation + web upload here), plus placeholders `images.tsx` / `labs.tsx` / `cardiac.tsx`; `explore.tsx` removed; `app-tabs` (web + native) rebuilt around the five destinations.
  - **Frontend dashboard:** `index.tsx` redesigned as a Flexbox grid - fixed left column (Demographics top / Allergies bottom), top nav row, 2x3 module grid + Specialty Snapshot + Summary, with inline per-card editing that PATCHes its module. `frontend/src/lib/patientProfile.ts` holds the client schema mirror + `fetchDashboard` / `patchProfile`.
  - **Frontend Validation Gate:** `notes.tsx` renders the proposed `draftNote` and a per-module diff of `profileDiff` vs the existing profile; "Sign & Accept" fires `commitDocument`.
  - **Verified:** backend `tsc` clean; frontend `tsc` clean; live socket round-trip against Azure OpenAI + Postgres confirmed propose-then-commit ordering, deterministic REST read-back, encryption round-trip, and audit-log writes (all synthetic "Test Patient" data, since removed).
