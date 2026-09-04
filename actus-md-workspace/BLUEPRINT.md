# Phase 4 Technical Blueprint: UI Upgrades, Decoupled AI, and Patient Assignment

## Objective
Update the architecture to decouple transcription from AI generation, introduce a `Patient` schema for data assignment, implement a `.env.template` to prevent API key loss during git clones, and add platform-specific UI enhancements (web drag-and-drop & free text).

## Steps

### 1. Database Schema & Secrets Management
- **Environment**: Configure the backend `server.ts` (or equivalent entrypoint) to load secrets from `azure_stt_openai.env` using `dotenv`. Create `backend/azure_stt_openai.env.template` containing the required Azure environment variables (empty values) so git tracks the schema.
- **Prisma Schema**: Update `backend/prisma/schema.prisma` to include a `Patient` model.
  - `Patient` should have `id` (String, uuid), `patientIdentifier` (String), and `createdAt` (DateTime).
  - Update `ClinicalNote` (or `Session`) to relate to `Patient`.
- **Database Push**: Run `npx prisma db push` in the backend directory.

### 2. Backend Socket & AI Refactor
- **Decouple Generation (`socketManager.ts`)**: 
  - Modify `audioStop` so it only finalizes the transcription and emits `transcriptFinalized`. Remove the `generateSoapNote` call here.
  - Add a new socket listener `generateDocument` that receives `{ transcript, images, freeText, templateType, patientIdentifier }`.
- **AI Service (`azureOpenAI.ts`)**:
  - Rename `generateSoapNote` to `generateMedicalDocument`.
  - Accept `templateType` ("SOAP Note" or "Clinic Note") and swap the `SYSTEM_PROMPT` dynamically based on the requested template.
  - The `generateDocument` socket listener should call this, save the output linking the `Patient`, and emit `uiStateChange`.

### 3. Frontend Platform-Specific Enhancements
- **Web UI (`WebUpload.tsx`)**:
  - Add drag-and-drop capabilities for web image uploads.
  - Add a `<TextInput multiline={true} />` for free-text input.
  - *Note*: Use React Native's `Platform.OS === 'web'` to conditionally render these web-only features.
- **Patient Assignment UI**:
  - Add a text input to capture a `Patient Identifier` (e.g., MRN or Name).
- **Generation Flow (`app/index.tsx`)**:
  - Add a dropdown/picker to select `templateType` ("SOAP Note" or "Clinic Note").
  - Add a "Generate Output" button that bundles the `transcript`, `patientIdentifier`, `templateType`, `images`, and `freeText`, emitting the `generateDocument` event to the backend.
