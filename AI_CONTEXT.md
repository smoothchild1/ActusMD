# ActusMD AI Context & State

This file serves as the living memory for AI agents working across multiple workstations. It documents the tech stack, current state, and immediate next steps to prevent context collapse.

## 1. Overall Project Blueprint & Scope
**ActusMD** is a cross-platform (iOS and Web) medical charting and ambient dictation application. 
**Core Value Proposition:** ActusMD aims to eliminate manual medical scribing by allowing healthcare providers to passively dictate patient encounters and seamlessly upload unstructured clinical data (images, old charts). The system synthesizes this multimodal input into a wide variety of structured, compliant clinical documents (progress notes, HPIs, clinic notes, operative reports) and tailored communications (messages to team members, patients, and families) with zero-latency.

**Core Application Features:**
*   **Passive Ambient Dictation:** iOS and Web apps capture raw microphone audio and stream it via WebSockets to a local Node.js backend for zero-latency transcription. **Critical Rule:** Transcriptions must be highly medically accurate with absolutely zero inference, summarization, or hallucination of the raw audio.
*   **Real-Time Cross-Device Sync:** Dictation on a mobile phone instantly broadcasts transcript and UI state updates to the web app in real-time, allowing fluid device switching.
*   **Multimodal Web App Input:** Providers can paste unstructured clinical data and upload images (e.g., ECGs, patient charts).
*   **Charting Copilot:** A multimodal AI agent synthesizes final transcripts, images, and text into diverse, highly-structured clinical outputs using strict, dynamic JSON Schema enforcement based on the requested document type. **Critical Rule:** The prompt architecture must enforce strict grounding to prevent hallucination—outputs must be derived *only* from the provided data. The codebase must remain highly modular to easily accommodate increased clinical functionality in the future.

## 2. Tech Stack (Local Pilot Phase)
*   **Frontend (iOS & Web):** Expo (React Native), Expo Router, NativeWind.
*   **Backend:** Node.js (TypeScript), Express, Socket.io (for real-time streaming and cross-device UI sync).
*   **Database & Storage:** SQLite via Prisma ORM, local file storage (`fs`/multer) for image uploads.
*   **AI Models:** Azure AI Speech (real-time dictation) and Azure OpenAI **GPT-5.4 Mini** (multimodal synthesis for diverse clinical documentation and communications). Formal HIPAA compliance (including ZDR configuration and BAA execution) is deferred for the local pilot phase. However, the architecture must maintain clean data boundaries so it can seamlessly transition to strict HIPAA compliance for production, retaining the flexibility to pivot to Google Cloud if Azure introduces unnecessary friction.
*   **Development Environment:** Development occurs across both Mac and Windows. iOS Simulator testing is strictly for Mac, while Windows development will rely on Web browser testing. The AI should check the OS environment before suggesting native build commands.

## 3. Current State
*   **Phase 1 (Backend Scaffold) is COMPLETE.**
*   The Node.js backend exists at `./backend/`. 
*   Prisma schema is defined (`User`, `Session`, `ClinicalNote`) and the SQLite `dev.db` is initialized.
*   Draft services for Azure Speech (`azureSpeech.ts`), Azure OpenAI (`azureOpenAI.ts`), and WebSockets (`socketManager.ts`) have been created.
*   A local `.env` file exists with real Azure API keys (currently untracked by git).

## 4. What is Working
*   Backend dependencies are installed (224 packages).
*   TypeScript compilation (`tsc --noEmit`) passes cleanly with 0 errors in strict mode.
*   Database schema successfully pushed to `dev.db`.

## 5. What is Broken / Needs Adjustment
*   **Azure OpenAI SDK Mismatch:** The code is using the retired `@azure/openai@1.0.0-beta.12`. It may fail if the endpoint is an Azure AI Foundry project URL. This needs to be reconciled.
*   **Incomplete AI Wiring:** The backend AI logic is scaffolded but not "deeply wired" (i.e., the current draft function `generateClinicalDocument()` does not yet persist rows to the DB or emit the final note to the socket client).
*   **Missing Frontend:** The Expo app has not been scaffolded yet.

## 6. Next Immediate Steps (Implementation Plan)
The human developer will feed the "Phases 2 & 3" prompt to Claude Code to execute the following:

- [ ] **Step 1 (Phase 2):** Fix the Azure OpenAI SDK mismatch/endpoint logic to ensure it can successfully hit the API.
- [ ] **Step 2 (Phase 2):** Update `socketManager.ts` and the AI services to persist the generated `ClinicalNote` to SQLite via Prisma, and broadcast the UI state updates back to the client.
- [ ] **Step 3 (Phase 3):** Scaffold the Expo frontend in `./frontend/` with NativeWind.
- [ ] **Step 4 (Phase 3):** Build the `AudioDictation.tsx` component to stream 16kHz/16-bit/mono PCM audio over Socket.io, and the `WebUpload.tsx` component to POST images to `/api/upload`.
- [ ] **Step 5:** Commit the Phase 2 & 3 changes.

## 7. Workflow Rules
*   **Antigravity (Architect/Orchestrator):** Never writes application code. Its sole deliverables are generating granular technical blueprints (maintained in `BLUEPRINT.md`) and outputting actionable 'worker prompts'.
*   **Claude Code (Builder):** Executes the actual code generation and terminal commands.
*   **The Human:** Manually passes the worker prompts from Antigravity to Claude Code.