import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDriveDto } from '../src/drives/drives.dto';
import { CreateDonationDeliveryDto } from '../src/drives/donations.dto';

describe('Logistics donation DTOs', () => {
  it('accepts valid drive and delivery payloads with decimal strings', async () => {
    const drive = plainToInstance(CreateDriveDto, {
      title: 'Nước uống vùng lũ', intake_warehouse_id: '11111111-1111-4111-8111-111111111111',
      items: [{ item_id: '22222222-2222-4222-8222-222222222222', target_quantity: '12.5' }],
    });
    const delivery = plainToInstance(CreateDonationDeliveryDto, {
      donor_name: 'Người quyên góp', donor_phone: '0901234567',
      lines: [{ item_id: '22222222-2222-4222-8222-222222222222', declared_quantity: '1.25' }],
    });

    await expect(validate(drive)).resolves.toHaveLength(0);
    await expect(validate(delivery)).resolves.toHaveLength(0);
  });

  it('rejects non-decimal quantity syntax, malformed phones, and oversized item sets', async () => {
    const delivery = plainToInstance(CreateDonationDeliveryDto, {
      donor_name: 'Người quyên góp', donor_phone: 'not-a-phone',
      lines: [{ item_id: '22222222-2222-4222-8222-222222222222', declared_quantity: '1e3' }],
    });
    const drive = plainToInstance(CreateDriveDto, {
      title: 'Đợt quyên góp', intake_warehouse_id: '11111111-1111-4111-8111-111111111111',
      items: Array.from({ length: 51 }, () => ({ item_id: '22222222-2222-4222-8222-222222222222', target_quantity: '1' })),
    });

    expect(await validate(delivery)).not.toHaveLength(0);
    expect(await validate(drive)).not.toHaveLength(0);
  });
});
