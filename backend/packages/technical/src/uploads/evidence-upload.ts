import Busboy from 'busboy';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request } from 'express';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors/errors';
import { detectEvidenceMime, evidenceSizeLimit, EvidenceMime } from '../media/evidence-media';

const maxMultipartBytes = 55 * 1024 * 1024;
const maxFileBytes = 50 * 1024 * 1024;
const fileSystemErrors = new Set(['EACCES', 'EBADF', 'EEXIST', 'EIO', 'EMFILE', 'ENFILE', 'ENOENT', 'ENOTDIR', 'ENOSPC', 'EROFS']);

export interface StagedEvidenceFile {
  path: string;
  size: number;
  mime: EvidenceMime;
  checksum: string;
  cleanup(): Promise<void>;
}

function asUploadError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined;
  if (code && fileSystemErrors.has(code)) return new AppError('STORAGE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1, cause: error });
  return new AppError('UNSUPPORTED_MEDIA', { status: 415, cause: error });
}

export async function stageEvidenceMultipart(request: Request, declaredBodyBytes: number): Promise<StagedEvidenceFile> {
  if (!Number.isSafeInteger(declaredBodyBytes) || declaredBodyBytes < 1) throw new AppError('LENGTH_REQUIRED', { status: 411 });
  if (declaredBodyBytes > maxMultipartBytes) throw new AppError('PAYLOAD_TOO_LARGE', { status: 413 });
  let directory: string;
  try {
    directory = await mkdtemp(join(tmpdir(), 'c48-evidence-'));
  } catch (error) {
    throw asUploadError(error);
  }
  const path = join(directory, 'upload');
  const checksum = createHash('sha256');
  let receivedBodyBytes = 0;
  let fileCount = 0;
  let fileSize = 0;
  let mime: EvidenceMime | undefined;
  let prefix = Buffer.alloc(0);
  let fileStream: import('node:stream').Readable | undefined;
  let fileTask: Promise<void> | undefined;
  let bodyError: AppError | undefined;
  const counter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback: TransformCallback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBodyBytes += buffer.length;
      if (receivedBodyBytes > declaredBodyBytes || receivedBodyBytes > maxMultipartBytes) {
        bodyError = new AppError('PAYLOAD_TOO_LARGE', { status: 413 });
        callback(bodyError);
        return;
      }
      callback(null, buffer);
    },
  });

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({ headers: request.headers, limits: { files: 2, fields: 1, parts: 2, fileSize: maxFileBytes } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw asUploadError(error);
  }

  const parserDone = new Promise<void>((resolve, reject) => {
    parser.once('finish', resolve);
    parser.once('error', reject);
  });
  const onAborted = () => {
    request.unpipe(counter);
    counter.destroy();
    const error = new AppError('VALIDATION_FAILED', { status: 400 });
    fileStream?.destroy(error);
    parser.destroy(error);
  };
  const onClose = () => {
    if (request.complete === false) onAborted();
  };
  request.once('aborted', onAborted);
  request.once('close', onClose);
  if (request.aborted || (request.complete === false && request.destroyed)) onAborted();
  parser.on('field', () => parser.destroy(new AppError('UNSUPPORTED_MEDIA', { status: 415 })));
  parser.on('filesLimit', () => parser.destroy(new AppError('UNSUPPORTED_MEDIA', { status: 415 })));
  parser.on('fieldsLimit', () => parser.destroy(new AppError('UNSUPPORTED_MEDIA', { status: 415 })));
  parser.on('partsLimit', () => parser.destroy(new AppError('UNSUPPORTED_MEDIA', { status: 415 })));
  parser.on('file', (fieldName, stream) => {
    fileCount++;
    fileStream = stream;
    if (fieldName !== 'file' || fileCount > 1) {
      stream.resume();
      parser.destroy(new AppError('UNSUPPORTED_MEDIA', { status: 415 }));
      return;
    }
    stream.once('limit', () => parser.destroy(new AppError('PAYLOAD_TOO_LARGE', { status: 413 })));
    const inspect = new Transform({
      transform(chunk: Buffer | string, _encoding, callback: TransformCallback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        fileSize += buffer.length;
        if (fileSize > maxFileBytes) {
          callback(new AppError('PAYLOAD_TOO_LARGE', { status: 413 }));
          return;
        }
        checksum.update(buffer);
        if (mime) {
          if (fileSize > evidenceSizeLimit(mime)) {
            callback(new AppError('PAYLOAD_TOO_LARGE', { status: 413 }));
            return;
          }
          callback(null, buffer);
          return;
        }
        const take = Math.min(4_096 - prefix.length, buffer.length);
        prefix = Buffer.concat([prefix, buffer.subarray(0, take)]);
        if (prefix.length === 4_096) {
          mime = detectEvidenceMime(prefix);
          if (!mime) {
            callback(new AppError('UNSUPPORTED_MEDIA', { status: 415 }));
            return;
          }
          if (fileSize > evidenceSizeLimit(mime)) {
            callback(new AppError('PAYLOAD_TOO_LARGE', { status: 413 }));
            return;
          }
          this.push(prefix);
          if (take < buffer.length) this.push(buffer.subarray(take));
        }
        callback();
      },
      flush(callback: TransformCallback) {
        if (!mime) mime = detectEvidenceMime(prefix);
        if (!mime) {
          callback(new AppError('UNSUPPORTED_MEDIA', { status: 415 }));
          return;
        }
        if (fileSize > evidenceSizeLimit(mime)) {
          callback(new AppError('PAYLOAD_TOO_LARGE', { status: 413 }));
          return;
        }
        if (prefix.length < 4_096) this.push(prefix);
        callback();
      },
    });
    fileTask = pipeline(stream, inspect, createWriteStream(path, { flags: 'wx' })).catch((error: unknown) => {
      parser.destroy(error instanceof Error ? error : new Error('Upload failed'));
      throw error;
    });
    void fileTask.catch(() => undefined);
  });
  counter.once('error', () => parser.destroy(bodyError ?? new AppError('PAYLOAD_TOO_LARGE', { status: 413 })));

  try {
    request.pipe(counter).pipe(parser);
    await parserDone;
    if (fileTask) await fileTask;
    if (receivedBodyBytes !== declaredBodyBytes) throw new AppError('PAYLOAD_TOO_LARGE', { status: 413 });
    if (fileCount !== 1 || !mime || fileSize === 0 || fileSize > declaredBodyBytes) throw new AppError('UNSUPPORTED_MEDIA', { status: 415 });
    return {
      path, size: fileSize, mime, checksum: checksum.digest('hex'),
      cleanup: async () => {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (error) {
          throw asUploadError(error);
        }
      },
    };
  } catch (error) {
    request.unpipe(counter);
    counter.destroy();
    fileStream?.destroy();
    parser.destroy();
    if (fileTask) await fileTask.catch(() => undefined);
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (cleanupError) {
      throw asUploadError(cleanupError);
    }
    throw asUploadError(error);
  } finally {
    request.removeListener('aborted', onAborted);
    request.removeListener('close', onClose);
  }
}
