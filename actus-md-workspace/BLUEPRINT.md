# Phase 3 Technical Blueprint: Frontend Scaffold & Sync

## Objective
Scaffold the Expo (React Native) frontend application, configure NativeWind for styling, and implement the core components for streaming audio via WebSockets and uploading images.

## Steps

### 1. Scaffold the Expo Frontend
- **Initialize Expo**: In the `actus-md-workspace` directory, create a new Expo project named `frontend` using the default template.
  - Command: `npx create-expo-app frontend` (or equivalent non-interactive script).
- **Dependencies**: 
  - Navigate to `./frontend/` and install `socket.io-client`, `axios`, and audio recording dependencies (e.g., `expo-av` or `react-native-audio-record` if raw PCM extraction is needed).
  - Install and configure **NativeWind** (Tailwind CSS for React Native) following its official Expo setup guide.

### 2. Implement Socket.io Client
- **Configuration**: Create a utility module (e.g., `src/lib/socket.ts`) to initialize and export the `socket.io-client` connection.
- **Connection Details**: Ensure the client connects to the backend running on port 3000 (or `process.env.EXPO_PUBLIC_API_URL`).
- **Auth/Query**: Ensure the connection payload provides a `userId` during handshake (e.g., a hardcoded or randomly generated dummy user ID for local pilot testing).

### 3. Build `AudioDictation.tsx` Component
- **Location**: `src/components/AudioDictation.tsx`.
- **Functionality**:
  - Implement a UI with a "Start Recording" / "Stop Recording" button styled with NativeWind.
  - When recording starts, capture raw microphone audio at **16kHz / 16-bit / mono PCM** format.
  - Stream chunks of this raw audio to the backend via the `audioChunk` Socket.io event.
  - When stopped, emit the `audioStop` event (optionally sending `patientContext` or `sessionId`).
  - Listen for `transcriptUpdate` socket events to display real-time transcription feedback to the user.

### 4. Build `WebUpload.tsx` Component
- **Location**: `src/components/WebUpload.tsx`.
- **Functionality**:
  - Implement an image selection UI (using `expo-image-picker`).
  - Upon selection, upload the image file via HTTP POST to the backend's `/api/upload` endpoint using `axios` or `fetch`.
  - Handle success/failure states and display the uploaded image preview using NativeWind styling.

### 5. Application Assembly & Sync
- **Main Screen**: Assemble `AudioDictation` and `WebUpload` into the main `app/index.tsx` (or `App.tsx` depending on routing).
- **Global Sync**: Add a listener for `uiStateChange` socket events to react to generated SOAP notes pushed from the backend, displaying the final note in the UI when received.

### 6. Verification & Commit
- Run `npx tsc --noEmit` in `./frontend/` to ensure no TypeScript errors.
- Stage and commit Phase 3 changes to the current feature branch.
