import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditListQueryDto } from '../src/audit/audit.dto';

describe('Logistics audit query contract', () => {
  it('requires a safe entity type and bounds pagination', async () => {
    const valid = plainToInstance(AuditListQueryDto, { entity_type: 'distribution', entity_id: 'dist-1', limit: '25' });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.limit).toBe(25);

    const missingType = await validate(plainToInstance(AuditListQueryDto, { limit: '101' }));
    expect(missingType.some((error) => error.property === 'entity_type')).toBe(true);
    expect(missingType.some((error) => error.property === 'limit')).toBe(true);
  });

  it('bounds entity and cursor filters', async () => {
    const invalid = plainToInstance(AuditListQueryDto, {
      entity_type: 'Invalid-Type', entity_id: 'x'.repeat(201), cursor: 'x'.repeat(2049),
    });

    expect((await validate(invalid)).map((error) => error.property).sort())
      .toEqual(['cursor', 'entity_id', 'entity_type']);
  });
});
