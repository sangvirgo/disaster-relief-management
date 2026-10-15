import { jest } from '@jest/globals';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { AttachmentLifecycleService } from '../src/attachments/attachment-lifecycle.service';
import { DonationAttachmentsService } from '../src/drives/donation-attachments.service';
import { HandoffAttachmentsService } from '../src/distributions/handoff-attachments.service';

const deliveryId = '44444444-4444-4444-8444-444444444444';
const donorId = '11111111-1111-4111-8111-111111111111';
const attachmentId = '55555555-5555-4555-8555-555555555555';
const distributionId = '66666666-6666-4666-8666-666666666666';
const handoffId = '77777777-7777-4777-8777-777777777777';
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

function makeInfrastructure(options: {
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
  const lifecycle = new AttachmentLifecycleService(dataSource as never, idempotency as never, storage as never);
  return { lifecycle, dataSource, sessions, storage, idempotency };
}

function makeService(options: Parameters<typeof makeInfrastructure>[0] = {}) {
  const infrastructure = makeInfrastructure(options);
  return {
    ...infrastructure,
    service: new DonationAttachmentsService(
      infrastructure.dataSource as never, infrastructure.sessions as never, secretConfig, infrastructure.lifecycle,
    ),
  };
}

function makeHandoffService(options: Parameters<typeof makeInfrastructure>[0] = {}) {
  const infrastructure = makeInfrastructure(options);
  return {
    ...infrastructure,
    service: new HandoffAttachmentsService(
      infrastructure.dataSource as never, infrastructure.sessions as never, infrastructure.lifecycle,
    ),
  };
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

  it('allows a scoped loss reviewer to download handoff evidence', async () => {
    const handoffAttachment = {
      ...attachment,
      attachment_delivery_id: null,
      attachment_dispute_id: null,
      attachment_handoff_id: handoffId,
      handoff_id: handoffId,
      handoff_kind: 'LOSS',
      organization_id: attachment.organization_id,
      warehouse_region_code: 'R1',
      donor_user_id: null,
      capability_hash: null,
    };
    const sessions = {
      require: jest.fn(async () => ({
        userId: donorId,
        grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: attachment.organization_id }],
        identityHeaders: {},
      })),
    };
    const { service, storage } = makeHandoffService({ query: jest.fn(async () => [handoffAttachment]), sessions });

    await expect(service.download(attachmentId, undefined, request('Bearer reviewer-session')))
      .resolves.toEqual({ url: 'https://objects.example.test/signed', expires_in: 60 });
    expect(storage.signedGetUrl).toHaveBeenCalledWith(attachment.object_key, 'image/png', 60);
  });

  it('denies a loss reviewer whose current warehouse scope does not cover the handoff', async () => {
    const handoffAttachment = {
      ...attachment,
      attachment_delivery_id: null,
      attachment_dispute_id: null,
      attachment_handoff_id: handoffId,
      handoff_id: handoffId,
      handoff_kind: 'LOSS',
      organization_id: attachment.organization_id,
      warehouse_region_code: 'R1',
      donor_user_id: null,
      capability_hash: null,
    };
    const sessions = {
      require: jest.fn(async () => ({
        userId: donorId,
        grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'REGION', organization_id: attachment.organization_id, region_code: 'R2' }],
        identityHeaders: {},
      })),
    };
    const { service, storage } = makeHandoffService({ query: jest.fn(async () => [handoffAttachment]), sessions });

    await expect(service.download(attachmentId, undefined, request('Bearer reviewer-session')))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(storage.signedGetUrl).not.toHaveBeenCalled();
  });

  it('uploads scoped handoff evidence to its handoff owner', async () => {
    const owner = {
      id: handoffId,
      distribution_id: distributionId,
      handoff_kind: 'DIRECT_HOUSEHOLD',
      organization_id: attachment.organization_id,
      warehouse_region_code: 'R1',
    };
    const manager = {
      query: jest.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes('FROM handoff_record')) return [owner];
        if (sql.includes('SELECT count(*)::int AS count')) return [{ count: 0, used: '0' }];
        if (sql.includes('INSERT INTO logistics_attachment')) return [{ id: values[0] }];
        return [];
      }),
    };
    const query = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM handoff_record')) return [owner];
      if (sql.includes("UPDATE logistics_attachment SET state='READY'")) {
        return [[{
          id: values[0], handoff_id: handoffId, delivery_id: null, dispute_id: null,
          object_key: `handoff/${handoffId}/${String(values[0])}`, state: 'READY', declared_bytes: 20,
          size_bytes: 20, detected_mime: 'image/png', checksum: 'b'.repeat(64), created_at: new Date('2026-10-15T12:00:00.000Z'),
        }], 1];
      }
      return [];
    });
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: {
        execute(manager: never): Promise<{ status: number; value: Record<string, unknown>; resource: { type: string; id: string } }>;
      }) => ({ ...(await command.execute(manager as never)), replay: false })),
    };
    const sessions = {
      require: jest.fn(async () => ({
        userId: donorId,
        grants: [{ role_code: 'DISTRIBUTION_STAFF', scope_type: 'ORGANIZATION', organization_id: attachment.organization_id }],
        identityHeaders: {},
      })),
    };
    const storage = {
      putObject: jest.fn(async () => {}), deleteObject: jest.fn(async () => {}), signedGetUrl: jest.fn(async () => 'https://objects.example.test/signed'),
    };
    const { service } = makeHandoffService({ query, idempotency, sessions, storage });
    const result = await service.uploadHandoff(distributionId, handoffId, multipartRequest());

    expect(result).toMatchObject({ status: 201, replay: false, value: { id: expect.any(String), state: 'READY', detected_mime: 'image/png' } });
    expect(result.value).not.toHaveProperty('object_key');
    const insert = manager.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO logistics_attachment'));
    expect(String(insert?.[0])).toContain('handoff_id');
    expect(insert?.[1]?.[1]).toBe(handoffId);
  });

  it('rejects a handoff upload when the supplied distribution does not own the handoff', async () => {
    const sessions = {
      require: jest.fn(async () => ({
        userId: donorId,
        grants: [{ role_code: 'DISTRIBUTION_STAFF', scope_type: 'ORGANIZATION', organization_id: attachment.organization_id }],
        identityHeaders: {},
      })),
    };
    const query = jest.fn(async () => []);
    const idempotency = { execute: jest.fn() };
    const { service } = makeHandoffService({ query, idempotency, sessions });

    await expect(service.uploadHandoff(deliveryId, handoffId, multipartRequest()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it.each([
    [5, '0'],
    [4, String(100 * 1024 * 1024 - 10)],
  ])('rejects a handoff upload at its attachment count or byte quota', async (count, used) => {
    const owner = {
      id: handoffId,
      distribution_id: distributionId,
      handoff_kind: 'DIRECT_HOUSEHOLD',
      organization_id: attachment.organization_id,
      warehouse_region_code: 'R1',
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM handoff_record')) return [owner];
        if (sql.includes('SELECT count(*)::int AS count')) return [{ count, used }];
        return [];
      }),
    };
    const query = jest.fn(async (sql: string) => sql.includes('FROM handoff_record') ? [owner] : []);
    const idempotency = {
      execute: jest.fn(async (_source: unknown, command: {
        execute(manager: never): Promise<{ status: number; value: Record<string, unknown>; resource: { type: string; id: string } }>;
      }) => command.execute(manager as never)),
    };
    const sessions = {
      require: jest.fn(async () => ({
        userId: donorId,
        grants: [{ role_code: 'DISTRIBUTION_STAFF', scope_type: 'ORGANIZATION', organization_id: attachment.organization_id }],
        identityHeaders: {},
      })),
    };
    const { service, storage } = makeHandoffService({ query, idempotency, sessions });

    await expect(service.uploadHandoff(distributionId, handoffId, multipartRequest()))
      .rejects.toMatchObject({ code: 'EVIDENCE_LIMIT_REACHED', status: 409 });
    expect(storage.putObject).not.toHaveBeenCalled();
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
