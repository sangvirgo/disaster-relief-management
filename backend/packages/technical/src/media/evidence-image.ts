import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { AppError } from '../errors/errors';
import type { EvidenceMime } from './evidence-media';

/** Longest edge kept for stored evidence images; larger photos are reduced to fit inside this square. */
export const evidenceImageMaxEdge = 2048;
const jpegQuality = 82;
/** Bounds decoder memory: refuse images that would decode to more than this many pixels. */
const maxInputPixels = 80_000_000;
const maxConcurrentConversions = 2;

sharp.cache(false);
sharp.concurrency(1);

let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < maxConcurrentConversions) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface OptimizedImage {
  size: number;
  checksum: string;
}

/**
 * Validates that an accepted JPEG or PNG really decodes, then, only when its longest edge exceeds
 * {@link evidenceImageMaxEdge}, re-encodes it at the capped resolution (EXIF orientation applied, metadata dropped,
 * mime type unchanged). Returns `null` when the original bytes are already small enough and are kept as they are.
 * Undecodable input or an image above the pixel budget is reported as unsupported media.
 */
export async function downscaleEvidenceImage(inputPath: string, outputPath: string, mime: EvidenceMime): Promise<OptimizedImage | null> {
  if (mime === 'video/mp4') throw new AppError('UNSUPPORTED_MEDIA', { status: 415 });
  await acquire();
  try {
    const { width, height } = await sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error' }).metadata();
    if (!width || !height) throw new AppError('UNSUPPORTED_MEDIA', { status: 415 });
    if (Math.max(width, height) <= evidenceImageMaxEdge) return null;
    const pipeline = sharp(inputPath, { limitInputPixels: maxInputPixels, failOn: 'error' })
      .rotate()
      .resize({ width: evidenceImageMaxEdge, height: evidenceImageMaxEdge, fit: 'inside', withoutEnlargement: true });
    await (mime === 'image/jpeg'
      ? pipeline.jpeg({ quality: jpegQuality, mozjpeg: false })
      : pipeline.png({ compressionLevel: 9 })).toFile(outputPath);
  } catch (error) {
    throw error instanceof AppError ? error : new AppError('UNSUPPORTED_MEDIA', { status: 415, cause: error });
  } finally {
    release();
  }
  const { size } = await stat(outputPath);
  if (size < 1) throw new AppError('UNSUPPORTED_MEDIA', { status: 415 });
  return { size, checksum: await sha256(outputPath) };
}
