import './loadEnv';

import http from 'http';
import path from 'path';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';

import uploadRouter from './routes/upload';
import { setupSockets } from './sockets/socketManager';
import { prisma } from './services/db';

/**
 * ActusMD local pilot server: Express (HTTP + REST) with Socket.io attached to
 * the same HTTP server.
 */

// The task brief says port 3000; the provided .env sets PORT=3001. We honor the
// environment and fall back to 3000.
const PORT = Number(process.env.PORT) || 3000;

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : '*';

const app = express();

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images statically.
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// REST routes.
app.use('/api/upload', uploadRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'actus-md-backend',
    time: new Date().toISOString(),
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: corsOrigin },
  maxHttpBufferSize: 1e7, // 10 MB - room for base64 audio / image frames
});

setupSockets(io);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[actus-md] HTTP + WebSocket server listening on http://localhost:${PORT}`,
  );
});

// Graceful shutdown.
async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n[actus-md] ${signal} received - shutting down`);
  io.close();
  server.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((sig) =>
  process.on(sig, () => {
    void shutdown(sig);
  }),
);

export { app, server, io };
