# Implementation Plan & State Tracker

- [x] **Phase 1 (Agent 1):** Workspace & Backend Setup (Node.js/Express scaffold, SQLite/Prisma schema, `fs` image upload middleware). Backend scaffolded at `actus-md-workspace/backend`; deps installed, Prisma client generated, `dev.db` created via `prisma db push`, `tsc --noEmit` passes. Server not started per instructions.
- [x] **Phase 2 (Agent 2):** WebSockets & AI Integration (Socket.io rooms, Azure AI Speech routing, Azure OpenAI multimodal handling).
- [x] **Phase 3 (Agent 3):** Frontend Scaffold & Sync (Expo/React Native setup, NativeWind layout, Socket.io client, AudioDictation, WebUpload).
- [x] **Phase 4 (Agent 4):** UI Upgrades, Decoupled AI, & Patient Assignment. `Patient` model added and pushed to SQLite; `azure_stt_openai.env` loaded explicitly via `loadEnv.ts`; `generateSoapNote` renamed to `generateMedicalDocument` with per-template prompts; `socketManager.ts` decoupled (`audioStop` -> `transcriptFinalized`, new `generateDocument` listener persists + emits `uiStateChange`); frontend adds patient identifier input, template picker, "Generate Output" flow, and web-only drag-and-drop/free-text in `WebUpload.tsx`. `tsc --noEmit` passes in both `backend/` and `frontend/`.
- [x] **Phase 5 (Agent 5):** HIPAA-Compliant Context Retrieval and Data Storage Architecture (Two-Tier Clinical Databank).
  - **System Rules: Two-Tier Clinical Databank Architecture**
    - **1. Tier 1: The Immutable Artifact Store (Raw Input)**
      - **Inputs:** Dictated audio, clinician free-text, and scanned patient charts (images/OCR).
      - **Storage Rule:** Append-only databank. No overwrites/deletions. Corrections via appended addenda.
      - **Backend:** Azure Blob Storage for raw files; Azure PostgreSQL for artifact metadata/content.
    - **2. Tier 2: The Living Patient Profile (Synthesized Context)**
      - **Behavior:** On new artifact, background AI process updates a "Living Profile".
      - **Structure:** JSONB in Postgres representing structured active problems, surgical history, etc.
    - **3. Context Retrieval (Streamlined Output)**
      - **Behavior:** New encounter fetches Living Profile AND recent relevant artifacts.
      - **Injection:** Fetched context automatically injected into LLM prompt for new clinical output.
    - **4. HIPAA & Security Invariants**
      - **Compliance:** Azure data storage must use field-level encryption for PHI and strict audit logging for all read/write actions.
