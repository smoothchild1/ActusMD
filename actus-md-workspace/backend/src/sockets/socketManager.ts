import type { Server, Socket } from 'socket.io';
import {
  createSpeechStream,
  isSpeechConfigured,
  type SpeechStreamSession,
} from '../services/azureSpeech';
import { prisma } from '../services/db';
import { generateSoapNote } from '../services/azureOpenAI';

/**
 * Socket.io wiring for ActusMD.
 *
 *  - Every connection must present a `userId` (handshake auth or query).
 *  - The socket joins a room named after that `userId` so all of a clinician's
 *    devices share one channel.
 *  - `audioChunk`      -> streamed to Azure Speech; transcripts are broadcast
 *                         back to the room as `transcriptUpdate`.
 *  - `uiStateChange`   -> relayed to the user's *other* devices to keep the UI
 *                         in sync across phone / tablet / web.
 */

interface HandshakeAuth {
  userId?: string;
}

export function setupSockets(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const auth = socket.handshake.auth as HandshakeAuth;
    const userId =
      auth?.userId ?? (socket.handshake.query.userId as string | undefined);

    if (!userId) {
      socket.emit('connectionError', {
        message: 'Missing userId in handshake auth; disconnecting.',
      });
      socket.disconnect(true);
      return;
    }

    socket.join(userId);
    socket.data.userId = userId;
    // eslint-disable-next-line no-console
    console.log(`[socket] ${socket.id} joined room "${userId}"`);

    let speech: SpeechStreamSession | null = null;
    let fullTranscript = '';

    const ensureSpeech = (): SpeechStreamSession | null => {
      if (speech) return speech;
      if (!isSpeechConfigured()) {
        socket.emit('transcriptError', 'Azure Speech is not configured on the server.');
        return null;
      }
      speech = createSpeechStream({
        onPartial: (text) =>
          io.to(userId).emit('transcriptUpdate', { text, final: false }),
        onFinal: (text) => {
          fullTranscript += (fullTranscript ? ' ' : '') + text;
          io.to(userId).emit('transcriptUpdate', { text, final: true });
        },
        onError: (message) => io.to(userId).emit('transcriptError', message),
      });
      return speech;
    };

    const stopSpeech = async (payload?: { sessionId?: string, patientContext?: string, images?: any[] }) => {
      if (!speech) return;
      const sessionObj = speech;
      speech = null;
      await sessionObj.stop().catch(() => undefined);

      const transcript = fullTranscript.trim();
      fullTranscript = '';

      if (!transcript && !(payload?.images?.length)) {
        return;
      }

      try {
        const soapNote = await generateSoapNote({
          transcript,
          patientContext: payload?.patientContext,
          images: payload?.images,
        });

        let sessionId = payload?.sessionId;
        if (!sessionId) {
          await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId, email: `${userId}@dummy.local` },
          });
          const newSession = await prisma.session.create({
            data: { userId },
          });
          sessionId = newSession.id;
        }

        const note = await prisma.clinicalNote.create({
          data: {
            sessionId,
            content: JSON.stringify(soapNote),
          },
        });

        io.to(userId).emit('uiStateChange', { type: 'noteGenerated', note });
      } catch (err) {
        io.to(userId).emit('transcriptError', 'Failed to generate clinical note.');
      }
    };

    // --- Ambient dictation -------------------------------------------------
    socket.on(
      'audioChunk',
      (chunk: ArrayBuffer | Buffer | Uint8Array) => {
        const session = ensureSpeech();
        if (!session) return;
        try {
          session.pushAudio(chunk);
        } catch (err) {
          socket.emit('transcriptError', (err as Error).message);
        }
      },
    );

    socket.on('audioStop', (payload) => stopSpeech(payload));

    // --- Cross-device UI state sync -------------------------------------
    socket.on('uiStateChange', (state: unknown) => {
      // Relay to the user's other devices only (not the sender).
      socket.to(userId).emit('uiStateChange', state);
    });

    // --- Teardown -------------------------------------------------------
    socket.on('disconnect', async (reason) => {
      // eslint-disable-next-line no-console
      console.log(`[socket] ${socket.id} disconnected (${reason})`);
      await stopSpeech();
    });
  });
}

export default setupSockets;
