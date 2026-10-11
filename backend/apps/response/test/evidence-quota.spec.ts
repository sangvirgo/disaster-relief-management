import { EvidenceService } from '../src/evidence/evidence.service';

const requestId = '00000000-0000-4000-8000-000000000001';
const mib = 1024 * 1024;

function service() {
  return new EvidenceService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

describe('Response evidence byte quotas', () => {
  it('rejects an upload that would exceed the per-request byte cap', async () => {
    const reserve = (service() as unknown as { reserveQuota: (manager: unknown, requestId: string, ipHash: string | null, bytes: number) => Promise<void> }).reserveQuota;
    const manager = { query: async () => [{ count: 1, used: String(100 * mib - 1) }] };

    await expect(reserve(manager, requestId, null, 2 * mib)).rejects.toMatchObject({ code: 'EVIDENCE_LIMIT_REACHED' });
  });

  it('rejects a guest upload that would exceed the hourly IP byte cap', async () => {
    const reserve = (service() as unknown as { reserveQuota: (manager: unknown, requestId: string, ipHash: string | null, bytes: number) => Promise<void> }).reserveQuota;
    const manager = {
      query: async (sql: string) => sql.includes('upload_source_ip_hash')
        ? [{ used: String(200 * mib - 1) }]
        : [{ count: 1, used: '0' }],
    };

    await expect(reserve(manager, requestId, 'v1:purpose-bound-ip-hash', 2 * mib)).rejects.toMatchObject({ code: 'EVIDENCE_LIMIT_REACHED' });
  });
});
