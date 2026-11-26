import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { DonationAttachmentsService } from '../src/drives/donation-attachments.service';
import { EvidenceController } from '../src/evidence/evidence.controller';

describe('Logistics evidence download routing', () => {
  let app: INestApplication;
  const donations = { download: jest.fn(async () => ({ url: 'https://objects.example.test/donation', expires_in: 60 })) };
  const id = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [EvidenceController] })
      .useMocker((token) => (token === DonationAttachmentsService ? donations : undefined))
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/logistics');
    await app.init();
  });

  afterAll(async () => app?.close());

  beforeEach(() => donations.download.mockClear());

  it('delegates donation evidence to the donation capability and permission checks', async () => {
    const result = await request(app.getHttpServer())
      .get(`/api/v1/logistics/evidence/${id}/download`)
      .set('X-Donation-Secret', 'donation-capability')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(result.body).toEqual({ url: 'https://objects.example.test/donation', expires_in: 60 });
    expect(donations.download).toHaveBeenCalledWith(id, 'donation-capability', expect.any(Object));
  });
});
