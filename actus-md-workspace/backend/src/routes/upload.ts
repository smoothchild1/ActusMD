import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { auditPHIAccess } from '../middleware/auditMiddleware';

/**
 * Image upload router.
 *
 * POST /            multipart/form-data, field name "images" (1-10 files)
 * Files are written to <cwd>/uploads and served back as /uploads/<filename>.
 */

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB per file
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const router = Router();

router.post(
  '/',
  upload.array('images', 10),
  auditPHIAccess({
    action: 'CREATE',
    resource: 'UploadedImage',
    // Uploads happen before a patient is selected client-side (see
    // socketManager's generateDocument flow), so no patientId is known yet.
  }),
  (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    if (files.length === 0) {
      return res
        .status(400)
        .json({ error: 'No image files received. Use multipart field name "images".' });
    }

    res.status(201).json({
      count: files.length,
      files: files.map((f) => ({
        id: path.parse(f.filename).name,
        filename: f.filename,
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        url: `/uploads/${f.filename}`,
        storedPath: f.path,
      })),
    });
  },
);

// Translate multer / filter errors into JSON responses.
router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message =
    err instanceof multer.MulterError
      ? `${err.code}: ${err.message}`
      : err instanceof Error
        ? err.message
        : 'Upload failed';
  res.status(400).json({ error: message });
});

export default router;
