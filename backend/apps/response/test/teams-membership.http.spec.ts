import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import { ApiExceptionFilter, loadErrorCatalog } from '../../../packages/technical/src';
import { TeamsController } from '../src/teams/teams.controller';
import { TeamsService } from '../src/teams/teams.service';

const teamId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const actorId = '30000000-0000-4000-8000-000000000001';
const key = '40000000-0000-4000-8000-000000000001';

describe('Teams membership HTTP routes', () => {
  let app: INestApplication;
  const teams = {
    addMember: jest.fn(async () => ({ status: 201, replay: true, value: {
      team_id: teamId, user_id: userId, member_role: 'MEMBER', joined_at: '2026-10-14T01:00:00.000Z',
    } })),
    removeMember: jest.fn(async () => ({ status: 204, replay: true, value: null })),
    transferLeader: jest.fn(async () => ({ status: 200, replay: false, value: {
      team_id: teamId, leader_user_id: userId, version: 8,
    } })),
  };

  beforeEach(() => jest.clearAllMocks());

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TeamsController],
      providers: [{ provide: TeamsService, useValue: teams }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/response');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'response'));
    await app.init();
  });

  afterAll(async () => app.close());

  it('adds or rejoins a member with the documented response and replay headers', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/response/teams/${teamId}/members`)
      .set('Idempotency-Key', key)
      .send({ user_id: userId })
      .expect(201)
      .expect('cache-control', 'no-store')
      .expect('idempotent-replay', 'true')
      .expect(({ body }) => expect(body).toEqual({
        team_id: teamId, user_id: userId, member_role: 'MEMBER', joined_at: '2026-10-14T01:00:00.000Z',
      }));

    expect(teams.addMember).toHaveBeenCalledWith(teamId, { user_id: userId }, key, expect.any(Object));
  });

  it('removes a member with no response body and preserves no-store/replay headers', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/response/teams/${teamId}/members/${userId}/remove`)
      .set('Idempotency-Key', key)
      .expect(204)
      .expect('cache-control', 'no-store')
      .expect('idempotent-replay', 'true');

    expect(teams.removeMember).toHaveBeenCalledWith(teamId, userId, key, expect.any(Object));
  });

  it('transfers a leader with the expected team version', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/response/teams/${teamId}/leader`)
      .set('Idempotency-Key', key)
      .send({ user_id: userId, expected_version: 7 })
      .expect(200)
      .expect('cache-control', 'no-store')
      .expect(({ body }) => expect(body).toEqual({ team_id: teamId, leader_user_id: userId, version: 8 }));

    expect(teams.transferLeader).toHaveBeenCalledWith(teamId, { user_id: userId, expected_version: 7 }, key, expect.any(Object));
  });

  it('validates membership command bodies before calling the service', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/response/teams/${teamId}/leader`)
      .set('Idempotency-Key', key)
      .send({ user_id: actorId, expected_version: 0, unexpected: true })
      .expect(400);

    expect(teams.transferLeader).not.toHaveBeenCalled();
  });
});
