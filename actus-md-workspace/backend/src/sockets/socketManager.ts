import type { Server, Socket } from 'socket.io';
import {
  createSpeechStream,
  isSpeechConfigured,
  type SpeechStreamSession,
} from '../services/azureSpeech';
import { prisma } from '../services/db';
import { generateMedicalDocument, type DocumentImageInput, type TemplateType } from '../services/azureOpenAI';

/**
 * Socket.io wiring for ActusMD.
 *
 *  - Every connection must present a `userId` (handshake auth or query).
 *  - The socket joins a room named after that `userId` so all of a clinician's
 *    devices share one channel.
 *  - `audioChunk`          -> streamed to Azure Speech; transcripts are broadcast
 *                             back to the room as `transcriptUpdate`.
 *  - `audioStop`           -> finalizes the transcript only, emitting
 *                             `transcriptFinalized`. Does not call the AI.
 *  - `generateDocument`    -> takes a finalized payload (transcript, images,
 *                             free text, template, patient) and produces +
 *                             persists the AI document, emitting `uiStateChange`.
 *  - `uiStateChange`       -> relayed to the user's *other* devices to keep the UI
 *                             in sync across phone / tablet / web.
 */

interface HandshakeAuth {
  userId?: string;
}

interface AudioStopPayload {
  sessionId?: string;
}

interface GenerateDocumentPayload {
  transcript?: string;
  images?: DocumentImageInput[];
  freeText?: string;
  templateType?: TemplateType;
  patientIdentifier?: string;
  sessionId?: string;
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

    // Stops the STT session and hands the finalized transcript back to the
    // client. No AI call and no persistence happens here - that is entirely
    // deferred to `generateDocument`, which the client triggers explicitly
    // once it has a patient identifier and template selected.
    const finalizeTranscript = async (payload?: AudioStopPayload): Promise<void> => {
      if (speech) {
        const sessionObj = speech;
        speech = null;
        await sessionObj.stop().catch(() => undefined);
      }

      const transcript = fullTranscript.trim();
      fullTranscript = '';

      io.to(userId).emit('transcriptFinalized', {
        transcript,
        sessionId: payload?.sessionId,
      });
    };

    const generateDocument = async (payload: GenerateDocumentPayload): Promise<void> => {
      const transcript = payload?.transcript?.trim() ?? '';
      const freeText = payload?.freeText?.trim();
      const patientIdentifier = payload?.patientIdentifier?.trim();
      const templateType = payload?.templateType?.trim();

      if (!patientIdentifier) {
        io.to(userId).emit('transcriptError', 'A patient identifier is required to generate a document.');
        return;
      }
      if (!templateType) {
        io.to(userId).emit('transcriptError', 'A template type is required to generate a document.');
        return;
      }
      if (!transcript && !freeText && !(payload?.images?.length)) {
        io.to(userId).emit('transcriptError', 'Nothing to generate a document from.');
        return;
      }

      try {
        const document = await generateMedicalDocument({
          transcript,
          patientContext: freeText,
          images: payload?.images,
          templateType,
        });

        const patient = await prisma.patient.upsert({
          where: { patientIdentifier },
          update: {},
          create: { patientIdentifier },
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
            patientId: patient.id,
            content: JSON.stringify(document),
          },
        });

        io.to(userId).emit('uiStateChange', { type: 'documentGenerated', note, patient });
      } catch (err) {
        io.to(userId).emit('transcriptError', 'Failed to generate clinical document.');
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

    socket.on('audioStop', (payload: AudioStopPayload) => finalizeTranscript(payload));

    // --- AI document generation (patient/template selected client-side) ---
    socket.on('generateDocument', (payload: GenerateDocumentPayload) => generateDocument(payload));

    // --- Cross-device UI state sync -------------------------------------
    socket.on('uiStateChange', (state: unknown) => {
      // Relay to the user's other devices only (not the sender).
      socket.to(userId).emit('uiStateChange', state);
    });

    // --- Teardown -------------------------------------------------------
    socket.on('disconnect', async (reason) => {
      // eslint-disable-next-line no-console
      console.log(`[socket] ${socket.id} disconnected (${reason})`);
      await finalizeTranscript();
    });
  });
}

export default setupSockets;
