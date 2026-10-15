import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { AttachmentLifecycleService } from '../src/attachments/attachment-lifecycle.service';
import { DonationAttachmentsService } from '../src/drives/donation-attachments.service';
import { HandoffAttachmentsService } from '../src/distributions/handoff-attachments.service';
import { EvidenceController } from '../src/evidence/evidence.controller';

describe('Logistics evidence download routing', () => {
  let app: INestApplication;
  const lifecycle = { ownerKind: jest.fn<() => Promise<'DONATION' | 'HANDOFF'>>() };
  const donations = { download: jest.fn(async () => ({ url: 'https://objects.example.test/donation', expires_in: 60 })) };
  const handoffs = { download: jest.fn(async () => ({ url: 'https://objects.example.test/handoff', expires_in: 60 })) };
  const id = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [EvidenceController] })
      .useMocker((token) => {
        if (token === AttachmentLifecycleService) return lifecycle;
        if (token === DonationAttachmentsService) return donations;
        if (token === HandoffAttachmentsService) return handoffs;
        return undefined;
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/logistics');
    await app.init();
  });

  afterAll(async () => app?.close());

  beforeEach(() => {
    lifecycle.ownerKind.mockReset();
    donations.download.mockClear();
    handoffs.download.mockClear();
  });

  it('delegates donation evidence to the donation capability and permission checks', async () => {
    lifecycle.ownerKind.mockResolvedValue('DONATION');
    const result = await request(app.getHttpServer())
      .get(`/api/v1/logistics/evidence/${id}/download`)
      .set('X-Donation-Secret', 'donation-capability')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(result.body).toEqual({ url: 'https://objects.example.test/donation', expires_in: 60 });
    expect(donations.download).toHaveBeenCalledWith(id, 'donation-capability', expect.any(Object));
    expect(handoffs.download).not.toHaveBeenCalled();
  });

  it('delegates handoff evidence to the scoped handoff permission checks', async () => {
    lifecycle.ownerKind.mockResolvedValue('HANDOFF');
    const result = await request(app.getHttpServer())
      .get(`/api/v1/logistics/evidence/${id}/download`)
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(result.body).toEqual({ url: 'https://objects.example.test/handoff', expires_in: 60 });
    expect(handoffs.download).toHaveBeenCalledWith(id, expect.any(Object));
    expect(donations.download).not.toHaveBeenCalled();
  });
});
