# ActusMD AI Context & State

This file serves as the living memory for AI agents working across multiple workstations. It documents the tech stack, current state, and immediate next steps to prevent context collapse.

## 1. Overall Project Blueprint & Scope
**ActusMD** is a cross-platform (iOS and Web) medical charting and ambient dictation application. 
**Core Value Proposition:** ActusMD aims to eliminate manual medical scribing by allowing healthcare providers to passively dictate patient encounters and seamlessly upload unstructured clinical data (images, old charts). The system synthesizes this multimodal input into a wide variety of structured, compliant clinical documents (progress notes, HPIs, clinic notes, operative reports) and tailored communications (messages to team members, patients, and families) with zero-latency.

**Core Application Features:**
*   **Passive Ambient Dictation:** iOS and Web apps capture raw microphone audio and stream it via WebSockets to a local Node.js backend for zero-latency transcription. **Critical Rule:** Transcriptions must be highly medically accurate with absolutely zero inference, summarization, or hallucination of the raw audio.
*   **Real-Time Cross-Device Sync:** Dictation on a mobile phone instantly broadcasts transcript and UI state updates to the web app in real-time, allowing fluid device switching.
*   **Multimodal Web App Input:** Providers can paste unstructured clinical data and upload images (e.g., ECGs, patient charts).
*   **Charting Copilot:** A multimodal AI agent synthesizes final transcripts, images, and text into diverse, highly-structured clinical outputs using strict, dynamic JSON Schema enforcement based on the requested document type. **Critical Rule:** The prompt architecture must enforce strict grounding to prevent hallucination—outputs must be derived *only* from the provided data.
*   **Patient Management & EHR Interoperability (Future):** Outputs and transcripts are tied to specific Patient Identifiers. The architecture is being built to support future automated syncs to Epic and other major EHRs.

## 2. Tech Stack (Local Pilot Phase)
*   **Frontend (iOS & Web):** Expo (React Native), Expo Router, NativeWind.
*   **Backend:** Node.js (TypeScript), Express, Socket.io (for real-time streaming and cross-device UI sync).
*   **Database & Storage:** SQLite via Prisma ORM, local file storage (`fs`/multer) for image uploads.
*   **AI Models:** Azure AI Speech (real-time dictation) and Azure OpenAI **GPT-5.4 Mini** (multimodal synthesis for diverse clinical documentation and communications). Formal HIPAA compliance is deferred for the local pilot phase, but the architecture must maintain clean data boundaries.
*   **Development Environment:** Development occurs across both Mac and Windows. The `dotenv` configuration expects the secrets to live in `azure_stt_openai.env` instead of a standard `.env` to prevent cross-contamination and ensure proper tracking across OS setups.

## 3. Current State
*   **Phases 1, 2, and 3 are COMPLETE.**
*   The Node.js backend exists at `./backend/` and successfully handles WebSocket connections, Azure AI Speech routing, and multimodal OpenAI queries.
*   The Expo frontend exists at `./frontend/` and successfully records raw PCM audio, streaming it to the backend for processing.

## 4. Next Immediate Steps (Phase 4)
The current focus is **Phase 4**, which will upgrade the UI, decouple the AI generation step, and introduce Patient Assignment. The human developer will feed the Phase 4 prompt to Claude Code based on the `BLUEPRINT.md`.

## 5. Workflow Rules
*   **Antigravity (Architect/Orchestrator):** Never writes application code. Its sole deliverables are generating granular technical blueprints (maintained in `BLUEPRINT.md`) and outputting actionable 'worker prompts'. Must actively ask clarifying questions to nail down scope.
*   **Claude Code (Builder):** Executes the actual code generation and terminal commands.
*   **The Human:** Manually passes the worker prompts from Antigravity to Claude Code.