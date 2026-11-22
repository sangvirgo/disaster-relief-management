import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { stageEvidenceMultipart, type StagedEvidenceFile } from '@c48/technical/uploads/evidence-upload';

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function multipart(file: Buffer, filename = 'photo.png', declaredType = 'application/octet-stream') {
  const boundary = '----c48-evidence-test';
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${declaredType}\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([prefix, file, suffix]) };
}

async function waitForAbortedListener(request: Request): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (request.listenerCount('aborted') === 0) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the multipart abort listener');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function cleanupPendingUpload(
  request: Request,
  upload: Promise<StagedEvidenceFile>,
  timeoutMs = 500,
): Promise<boolean> {
  const settled = upload.then(async (staged) => {
    await staged.cleanup();
    return true;
  }, () => true).catch(() => false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  request.aborted = true;
  request.end();
  request.destroy();
  try {
    return await Promise.race([
      settled,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('Response multipart evidence staging', () => {
  it('bounds cleanup when staging never settles', async () => {
    const stream = new PassThrough();
    const request = stream as unknown as Request;
    const upload = new Promise<StagedEvidenceFile>(() => undefined);

    await expect(cleanupPendingUpload(request, upload, 20)).resolves.toBe(false);
    expect(stream.destroyed).toBe(true);
    expect(stream.writableEnded).toBe(true);
  }, 1_000);

  it('streams the one file, hashes bytes, and ignores client MIME metadata', async () => {
    const file = Buffer.concat([validPng, Buffer.from('synthetic')]);
    const form = multipart(file, 'report.jpg', 'image/jpeg');
    const request = Readable.from([form.body]) as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    const staged = await stageEvidenceMultipart(request, form.body.length);
    try {
      expect(staged.mime).toBe('image/png');
      expect(staged.size).toBe(file.length);
      expect(staged.checksum).toBe(createHash('sha256').update(file).digest('hex'));
    } finally {
      await staged.cleanup();
    }
  });

  it('rejects unsupported content even when the filename and MIME claim to be an image', async () => {
    const form = multipart(Buffer.from('<svg/>'), 'safe.png', 'image/png');
    const request = Readable.from([form.body]) as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    await expect(stageEvidenceMultipart(request, form.body.length)).rejects.toMatchObject<AppError>({ code: 'UNSUPPORTED_MEDIA' });
  });

  it('aborts when the multipart stream exceeds its declared Content-Length', async () => {
    const form = multipart(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const request = Readable.from([form.body]) as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    await expect(stageEvidenceMultipart(request, form.body.length - 1)).rejects.toMatchObject<AppError>({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('settles and cleans up when the client aborts a multipart stream', async () => {
    const form = multipart(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8_192)]));
    const request = new PassThrough() as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    request.complete = false;
    const upload = stageEvidenceMultipart(request, form.body.length);
    try {
      await waitForAbortedListener(request);
      expect(request.listenerCount('aborted')).toBeGreaterThan(0);
      request.write(form.body.subarray(0, Math.floor(form.body.length / 2)));
      await new Promise((resolve) => setImmediate(resolve));
      request.emit('aborted');

      const settled = await Promise.race([
        upload.then(() => true, () => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
      if (!settled) {
        request.aborted = true;
        request.end();
      }
      expect(settled).toBe(true);
      await expect(upload).rejects.toMatchObject<AppError>({ code: 'VALIDATION_FAILED' });
    } finally {
      const cleaned = await cleanupPendingUpload(request, upload);
      if (!cleaned) throw new Error('Timed out waiting for multipart upload cleanup after destroying the request');
    }
  });

  it('rejects a request that aborted before local staging started', async () => {
    const form = multipart(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const request = Readable.from([]) as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    request.aborted = true;
    request.complete = false;

    await expect(stageEvidenceMultipart(request, form.body.length)).rejects.toMatchObject<AppError>({ code: 'VALIDATION_FAILED' });
  });

  it('reports temporary-file write failures separately from invalid media', async () => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('c48-evidence-')));
    const form = multipart(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8_192)]));
    const request = new PassThrough() as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    const upload = stageEvidenceMultipart(request, form.body.length);
    let directory: string | undefined;
    try {
      await waitForAbortedListener(request);
      expect(request.listenerCount('aborted')).toBeGreaterThan(0);
      const createdDirectories = (await readdir(tmpdir())).filter((name) => name.startsWith('c48-evidence-') && !before.has(name));
      expect(createdDirectories).toHaveLength(1);
      directory = createdDirectories[0];
      await rm(join(tmpdir(), directory!), { recursive: true, force: true });
      request.end(form.body);

      await expect(upload).rejects.toMatchObject<AppError>({ code: 'STORAGE_UNAVAILABLE' });
    } finally {
      const cleaned = await cleanupPendingUpload(request, upload);
      if (!cleaned) throw new Error('Timed out waiting for multipart upload cleanup after destroying the request');
      if (directory) await rm(join(tmpdir(), directory), { recursive: true, force: true });
    }
  });
});

describe('Evidence image decoding and downscaling', () => {
  async function stage(file: Buffer): Promise<StagedEvidenceFile> {
    const form = multipart(file);
    const request = Readable.from([form.body]) as unknown as Request;
    request.headers = { 'content-type': `multipart/form-data; boundary=${form.boundary}` };
    return stageEvidenceMultipart(request, form.body.length);
  }

  it('reduces an oversized-resolution image and reports the stored size and checksum', async () => {
    const { default: sharp } = await import('sharp');
    const { readFile, stat } = await import('node:fs/promises');
    const large = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .jpeg({ quality: 90 }).toBuffer();

    const staged = await stage(large);
    try {
      const metadata = await sharp(staged.path).metadata();
      expect(staged.mime).toBe('image/jpeg');
      expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(2048);
      expect(metadata.width).toBeGreaterThan(metadata.height ?? 0);
      expect(staged.size).toBe((await stat(staged.path)).size);
      expect(staged.checksum).toBe(createHash('sha256').update(await readFile(staged.path)).digest('hex'));
    } finally {
      await staged.cleanup();
    }
  });

  it('keeps an image that is already within the resolution cap byte for byte', async () => {
    const staged = await stage(validPng);
    try {
      expect(staged.size).toBe(validPng.length);
      expect(staged.checksum).toBe(createHash('sha256').update(validPng).digest('hex'));
    } finally {
      await staged.cleanup();
    }
  });

  it('rejects content that has an image signature but cannot be decoded', async () => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('c48-evidence-')));
    await expect(stage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not an image')])))
      .rejects.toMatchObject<AppError>({ code: 'UNSUPPORTED_MEDIA' });
    const leftover = (await readdir(tmpdir())).filter((name) => name.startsWith('c48-evidence-') && !before.has(name));
    expect(leftover).toHaveLength(0);
  });
});
