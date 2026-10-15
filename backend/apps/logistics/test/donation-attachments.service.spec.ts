import { jest } from '@jest/globals';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { DonationAttachmentsService } from '../src/drives/donation-attachments.service';

const deliveryId = '44444444-4444-4444-8444-444444444444';
const donorId = '11111111-1111-4111-8111-111111111111';
const attachmentId = '55555555-5555-4555-8555-555555555555';
const secretConfig = { peppers: { v1: 'test-donation-secret-pepper-that-is-long-enough' }, currentPepperVersion: 'v1' };

const attachment = {
  attachment_id: attachmentId,
  attachment_delivery_id: deliveryId,
  attachment_dispute_id: null,
  object_key: `donation/${deliveryId}/${attachmentId}`,
  state: 'READY' as const,
  size_bytes: 16,
  detected_mime: 'image/png' as const,
  checksum: 'a'.repeat(64),
  created_at: new Date('2026-10-15T12:00:00.000Z'),
  id: deliveryId,
  public_code: 'ABCDEFGH',
  donor_user_id: donorId,
  capability_hash: null,
  organization_id: '22222222-2222-4222-8222-222222222222',
  region_code: 'R1',
  campaign_id: null,
};

function request(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

function makeService(options: {
  query?: jest.Mock;
  sessions?: { require: jest.Mock };
  storage?: { putObject: jest.Mock; deleteObject: jest.Mock; signedGetUrl: jest.Mock };
  idempotency?: { execute: jest.Mock };
} = {}) {
  const dataSource = { query: options.query ?? jest.fn(async () => [attachment]) };
  const sessions = options.sessions ?? {
    require: jest.fn(async () => ({ userId: donorId, grants: [], identityHeaders: {} })),
  };
  const storage = options.storage ?? {
    putObject: jest.fn(async () => {}),
    deleteObject: jest.fn(async () => {}),
    signedGetUrl: jest.fn(async () => 'https://objects.example.test/signed'),
  };
  const idempotency = options.idempotency ?? { execute: jest.fn() };
  const service = new DonationAttachmentsService(
    dataSource as never, idempotency as never, sessions as never, secretConfig, storage as never,
  );
  return { service, dataSource, sessions, storage, idempotency };
}

function multipartRequest(): Request & { idempotencyKey: string } {
  const boundary = 'c48-t12-boundary';
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('c48-t12-file'),
  ]);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return Object.assign(Readable.from([body]), {
    headers: {
      authorization: 'Bearer donor-session',
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as Request & { idempotencyKey: string };
}

describe('donation attachment access and upload', () => {
  it('does not sign a private download until the caller is reauthorized', async () => {
    const { service, sessions, storage } = makeService();

    await expect(service.download(attachmentId, undefined, request()))
      .rejects.toMatchObject({ code: 'DONATION_SECRET_INVALID', status: 400 });
    expect(sessions.require).not.toHaveBeenCalled();
    expect(storage.signedGetUrl).not.toHaveBeenCalled();

    const result = await service.download(attachmentId, undefined, request('Bearer donor-session'));
    expect(result).toEqual({ url: 'https://objects.example.test/signed', expires_in: 60 });
    expect(storage.signedGetUrl).toHaveBeenCalledWith(attachment.object_key, 'image/png', 60);
  });

  it('reserves quota and persists declared bytes from the file, then marks it ready', async () => {
    const delivery = {
      id: deliveryId, public_code: 'ABCDEFGH', donor_user_id: donorId, capability_hash: null,
      organization_id: attachment.organization_id, region_code: 'R1', campaign_id: null,
    };
    const readyAttachment = {
      id: attachmentId, delivery_id: deliveryId, dispute_id: null,
      object_key: `donation/${deliveryId}/${attachmentId}`, state: 'READY', declared_bytes: 20,
      size_bytes: 20, detected_mime: 'image/png', checksum: 'b'.repeat(64), created_at: new Date('2026-10-15T12:00:00.000Z'),
    };
    let createdAttachmentId = '';
    let insertedDeclaredBytes = 0;
    let storedObjectKey = '';
    const manager = {
      query: jest.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes('SELECT count(*)::int AS count')) return [{ count: 0, used: String(100 * 1024 * 1024 - 20) }];
        if (sql.includes('FROM donation_delivery dd')) return [delivery];
        if (sql.includes('INSERT INTO logistics_attachment')) {
          createdAttachmentId = String(values[0]);
          insertedDeclaredBytes = Number(values[4]);
        }
        return [];
      }),
    };
    const query = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM donation_delivery dd')) return [delivery];
      if (sql.includes("UPDATE logistics_attachment SET state='READY'")) {
        return [[{
          ...readyAttachment,
          id: String(values[0]),
          object_key: `donation/${deliveryId}/${String(values[0])}`,
        }], 1];
      }
      return [];
    });
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: {
        execute(manager: never): Promise<{ status: number; value: Record<string, unknown>; resource: { type: string; id: string } }>;
      }) => ({ ...(await command.execute(manager as never)), replay: false })),
    };
    const storage = {
      putObject: jest.fn(async (key: string) => { storedObjectKey = key; }),
      deleteObject: jest.fn(async () => {}),
      signedGetUrl: jest.fn(async () => 'https://objects.example.test/signed'),
    };
    const { service } = makeService({ query, idempotency, storage });

    const result = await service.upload(deliveryId, undefined, undefined, multipartRequest());

    expect(result).toMatchObject({ status: 201, replay: false, value: { id: expect.any(String), state: 'READY', detected_mime: 'image/png' } });
    expect(createdAttachmentId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(result.value.id).toBe(createdAttachmentId);
    expect(insertedDeclaredBytes).toBe(20);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('SELECT count(*)::int AS count'), [deliveryId]);
    expect(storage.putObject).toHaveBeenCalledWith(
      `donation/${deliveryId}/${createdAttachmentId}`, expect.any(String), 20, 'image/png', expect.any(String),
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE logistics_attachment SET state='READY'"), [
      createdAttachmentId, 20, 'image/png', expect.any(String),
    ]);
    expect(storedObjectKey).toBe(`donation/${deliveryId}/${createdAttachmentId}`);
  });

  it('retains the object when the READY update throws after the row is committed', async () => {
    const delivery = {
      id: deliveryId, public_code: 'ABCDEFGH', donor_user_id: donorId, capability_hash: null,
      organization_id: attachment.organization_id, region_code: 'R1', campaign_id: null,
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM donation_delivery dd')) return [delivery];
        if (sql.includes('SELECT count(*)::int AS count')) return [{ count: 0, used: '0' }];
        return [];
      }),
    };
    const objects = new Set<string>();
    let persistedState = 'PENDING';
    let storedObjectKey = '';
    const query = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM donation_delivery dd')) return [delivery];
      if (sql.includes("UPDATE logistics_attachment SET state='READY'")) {
        persistedState = 'READY';
        throw new Error('connection lost after READY commit');
      }
      return [];
    });
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: {
        execute(manager: never): Promise<{ status: number; value: Record<string, unknown>; resource: { type: string; id: string } }>;
      }) => ({ ...(await command.execute(manager as never)), replay: false })),
    };
    const storage = {
      putObject: jest.fn(async (key: string) => { storedObjectKey = key; objects.add(key); }),
      deleteObject: jest.fn(async (key: string) => { objects.delete(key); }),
      signedGetUrl: jest.fn(async () => 'https://objects.example.test/signed'),
    };
    const { service } = makeService({ query, idempotency, storage });

    await expect(service.upload(deliveryId, undefined, undefined, multipartRequest()))
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 503 });

    expect(persistedState).toBe('READY');
    expect(objects.has(storedObjectKey)).toBe(true);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
