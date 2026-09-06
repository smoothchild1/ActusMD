import type { Server, Socket } from 'socket.io';
import {
  createSpeechStream,
  isSpeechConfigured,
  type SpeechStreamSession,
} from '../services/azureSpeech';
import { prisma } from '../services/db';
import { generateMedicalDocument, type DocumentImageInput, type MedicalDocument, type TemplateType } from '../services/azureOpenAI';
import { writeAuditLog } from '../middleware/auditMiddleware';
import {
  emptyProfile,
  mergeProfileModules,
  parsePatientProfile,
  serializePatientProfile,
  type PatientProfileSchema,
} from '../types/patientProfile';

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
 *  - `generateDocument`    -> "Human-in-the-Loop Write" step 1: reads the
 *                             patient's existing PatientProfile for historical
 *                             context, calls the AI, and emits the proposed
 *                             `{ draftNote, profileDiff }` back as
 *                             `documentProposed`. NOTHING is persisted here.
 *  - `commitDocument`      -> step 2, fired when the clinician clicks
 *                             "Sign & Accept": creates the ClinicalNote and
 *                             upserts the PatientProfile, then emits
 *                             `documentCommitted` (+ `uiStateChange`).
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

interface CommitDocumentPayload {
  patientIdentifier?: string;
  templateType?: TemplateType;
  /** The structured note the clinician reviewed (and possibly edited). */
  draftNote?: MedicalDocument;
  /** The proposed profile the clinician reviewed (and possibly edited). */
  profileDiff?: PatientProfileSchema;
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
    let chunkCounter = 0;

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

    // --- Validation Gate step 1: propose, do not persist ------------------
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
        const patient = await prisma.patient.upsert({
          where: { patientIdentifier },
          update: {},
          create: { patientIdentifier },
          include: { profile: true },
        });

        const existingProfile: PatientProfileSchema = patient.profile
          ? parsePatientProfile(patient.profile.synthesizedData)
          : emptyProfile();

        // generateMedicalDocument reads the patient's existing profile for
        // historical context before calling the LLM - log that PHI read here,
        // at the request boundary where we know `userId`.
        void writeAuditLog({
          userId,
          action: 'READ',
          resource: 'PatientProfile',
          patientId: patient.id,
        });

        const { draftNote, profileDiff } = await generateMedicalDocument({
          transcript,
          patientContext: freeText,
          images: payload?.images,
          templateType,
          existingProfile,
        });

        // Nothing persisted. The client renders the draft + the proposed
        // profile updates and echoes them back on `commitDocument`.
        io.to(userId).emit('documentProposed', {
          draftNote,
          profileDiff,
          existingProfile,
          patient: { id: patient.id, patientIdentifier: patient.patientIdentifier },
          templateType,
          sessionId: payload?.sessionId,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[socket] generateDocument failed:', err);
        io.to(userId).emit('transcriptError', 'Failed to generate clinical document.');
      }
    };

    // --- Validation Gate step 2: persist on "Sign & Accept" -------------
    const commitDocument = async (payload: CommitDocumentPayload): Promise<void> => {
      const patientIdentifier = payload?.patientIdentifier?.trim();
      const templateType = payload?.templateType?.trim() || 'SOAP Note';
      const draftNote = payload?.draftNote;
      const profileDiff = payload?.profileDiff;

      if (!patientIdentifier) {
        io.to(userId).emit('transcriptError', 'A patient identifier is required to commit a document.');
        return;
      }
      if (!draftNote || !Array.isArray(draftNote.sections)) {
        io.to(userId).emit('transcriptError', 'A valid draft note is required to commit.');
        return;
      }

      try {
        const patient = await prisma.patient.upsert({
          where: { patientIdentifier },
          update: {},
          create: { patientIdentifier },
          include: { profile: true },
        });

        let sessionId = payload?.sessionId;
        if (!sessionId) {
          await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId, email: `${userId}@dummy.local` },
          });
          const newSession = await prisma.session.create({ data: { userId } });
          sessionId = newSession.id;
        }

        const note = await prisma.clinicalNote.create({
          data: {
            sessionId,
            patientId: patient.id,
            content: JSON.stringify({ ...draftNote, templateType }),
          },
        });

        void writeAuditLog({
          userId,
          action: 'CREATE',
          resource: 'ClinicalNote',
          patientId: patient.id,
          metadata: { clinicalNoteId: note.id, templateType },
        });

        // Deterministically fold the clinician-accepted profileDiff into the
        // patient's current profile (pure merge, no LLM).
        let profile: PatientProfileSchema | null = null;
        if (profileDiff && typeof profileDiff === 'object') {
          const current = patient.profile
            ? parsePatientProfile(patient.profile.synthesizedData)
            : emptyProfile();
          profile = mergeProfileModules(current, profileDiff);
          const synthesizedData = serializePatientProfile(profile);

          await prisma.patientProfile.upsert({
            where: { patientId: patient.id },
            create: { patientId: patient.id, synthesizedData },
            update: { synthesizedData },
          });

          void writeAuditLog({
            userId,
            action: 'UPDATE',
            resource: 'PatientProfile',
            patientId: patient.id,
            metadata: { source: 'ai-commit', clinicalNoteId: note.id },
          });
        }

        const result = { type: 'documentCommitted', note, patient, profile };
        io.to(userId).emit('documentCommitted', result);
        io.to(userId).emit('uiStateChange', result);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[socket] commitDocument failed:', err);
        io.to(userId).emit('transcriptError', 'Failed to commit clinical document.');
      }
    };

    // --- Ambient dictation -------------------------------------------------
    socket.on(
      'audioChunk',
      (chunk: ArrayBuffer | Buffer | Uint8Array) => {
        chunkCounter += 1;
        // eslint-disable-next-line no-console
        if (chunkCounter % 20 === 0) console.log(`[socket] Received ${chunkCounter} audio chunks from ${socket.id}`);

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

    // --- AI document generation + commit (Validation Gate) -------------
    socket.on('generateDocument', (payload: GenerateDocumentPayload) => generateDocument(payload));
    socket.on('commitDocument', (payload: CommitDocumentPayload) => commitDocument(payload));

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
