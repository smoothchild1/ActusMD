import { io, type Socket } from 'socket.io-client';

/**
 * Socket.io client for the ActusMD local pilot.
 *
 * The backend (see `backend/src/sockets/socketManager.ts`) requires every
 * connection to present a `userId` during the handshake, either via
 * `socket.handshake.auth.userId` or `socket.handshake.query.userId`. A
 * connection without one is immediately disconnected. For the local pilot we
 * pass a hardcoded mock id; a real auth flow will replace this later.
 */

/** Base URL of the backend HTTP + WebSocket server. */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Mock clinician id used for the local pilot handshake. */
export const MOCK_USER_ID =
  process.env.EXPO_PUBLIC_USER_ID ?? 'pilot-user-001';

export const socket: Socket = io(API_URL, {
  // Let the app decide when to open the connection.
  autoConnect: false,
  // React Native has no long-polling fallback worth keeping; go straight to WS.
  transports: ['websocket'],
  // Primary handshake channel the backend reads.
  auth: { userId: MOCK_USER_ID },
  // Redundant fallback the backend also accepts.
  query: { userId: MOCK_USER_ID },
});

/** Open the shared connection if it is not already connected. */
export function connectSocket(): Socket {
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

/** Close the shared connection if it is currently open. */
export function disconnectSocket(): void {
  if (socket.connected) {
    socket.disconnect();
  }
}

export default socket;
