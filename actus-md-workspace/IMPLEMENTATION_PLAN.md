# Implementation Plan & State Tracker

## Current Objective
- **Phase 6:** Data Storage & Retrieval Exploration + AI Output Expansion (Handling multimodal inputs/pictures and expanding generation capabilities).

## Active Dependencies & Architecture
- **Backend:** Node.js/Express, TypeScript, Prisma (SQLite), Socket.io, `azure-cognitiveservices-speech-sdk`, `openai`.
- **Frontend:** Expo (React Native Web), NativeWind, Socket.io-client.
- **Two-Tier Clinical Databank Architecture:**
  1. **Tier 1 (Immutable Artifact Store):** Append-only raw inputs (audio, text, images).
  2. **Tier 2 (Living Patient Profile):** Background synthesized JSONB in Postgres representing active problems, etc.
  3. **Context Retrieval:** New encounters fetch the Living Profile and recent artifacts to inject into the LLM prompt.

## Failed Approaches & Gotchas
- **React Native Web State Loops:** Do not put `setState` in a render closure that depends on an incoming socket payload without a `useEffect` buffer, or it triggers an infinite re-render loop (Fixed in `AudioDictation.tsx`).
- **Web Audio Quality:** The default `AudioContext` downsamples heavily in the browser. Always request `16000Hz` directly in the `getUserMedia` constraints (`pcmRecorder.web.ts`) for Azure STT.
- **Azure OpenAI Markdown:** Azure OpenAI frequently wraps JSON objects in markdown (```json). Always regex strip this before `JSON.parse` (`azureOpenAI.ts`).
- **OpenAI Token Limits:** Use `max_completion_tokens` instead of `max_tokens` for newer models like `gpt-4o-mini`.

## Completed Milestones
- [x] **Phase 1 (Agent 1):** Workspace & Backend Setup (Node.js/Express scaffold, SQLite/Prisma schema, `fs` image upload middleware).
- [x] **Phase 2 (Agent 2):** WebSockets & AI Integration (Socket.io rooms, Azure AI Speech routing, Azure OpenAI multimodal handling).
- [x] **Phase 3 (Agent 3):** Frontend Scaffold & Sync (Expo/React Native setup, NativeWind layout, Socket.io client, AudioDictation, WebUpload).
- [x] **Phase 4 (Agent 4):** UI Upgrades, Decoupled AI, & Patient Assignment. Added `Patient` model, decoupled `socketManager.ts`, added UI patient picker and WebUpload free-text support.
- [x] **Phase 5 (Agent 5):** HIPAA-Compliant Context Retrieval and Data Storage Architecture (Two-Tier Clinical Databank integration + debugging STT/OpenAI connections).
