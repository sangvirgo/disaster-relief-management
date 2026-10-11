import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { Request } from 'express';
import { AppError } from '../../../packages/technical/src/errors';
import { stageEvidenceMultipart } from '../src/evidence/evidence-upload';

function multipart(file: Buffer, filename = 'photo.png', declaredType = 'application/octet-stream') {
  const boundary = '----c48-evidence-test';
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${declaredType}\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([prefix, file, suffix]) };
}

describe('Response multipart evidence staging', () => {
  it('streams the one file, hashes bytes, and ignores client MIME metadata', async () => {
    const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic')]);
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
    for (let attempt = 0; attempt < 100 && request.listenerCount('aborted') === 0; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(request.listenerCount('aborted')).toBeGreaterThan(0);
    request.write(form.body.subarray(0, Math.floor(form.body.length / 2)));
    await new Promise((resolve) => setImmediate(resolve));
    request.emit('aborted');

    const settled = await Promise.race([
      upload.then(() => true, () => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    if (!settled) request.end();
    expect(settled).toBe(true);
    await expect(upload).rejects.toMatchObject<AppError>({ code: 'VALIDATION_FAILED' });
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
    for (let attempt = 0; attempt < 100 && request.listenerCount('aborted') === 0; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(request.listenerCount('aborted')).toBeGreaterThan(0);
    const directory = (await readdir(tmpdir())).find((name) => name.startsWith('c48-evidence-') && !before.has(name));
    expect(directory).toBeDefined();
    await rm(join(tmpdir(), directory!), { recursive: true, force: true });
    request.end(form.body);

    await expect(upload).rejects.toMatchObject<AppError>({ code: 'STORAGE_UNAVAILABLE' });
  });
});
