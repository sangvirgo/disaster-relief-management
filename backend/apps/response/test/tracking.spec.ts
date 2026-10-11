import { supplementAllowed } from '../src/tracking/tracking.service';
import { trackingCodeMatches } from '../src/tracking/reporter-access.service';

describe('Response reporter tracking rules', () => {
  it('compares public tracking codes without accepting malformed values', () => {
    expect(trackingCodeMatches('01HJKMNPQR', '01HJKMNPQR')).toBe(true);
    expect(trackingCodeMatches('01HJKMNPQR', '01HJKMNPQS')).toBe(false);
    expect(trackingCodeMatches('01HJKMNPQR', '01HJK')).toBe(false);
    expect(trackingCodeMatches('01HJKMNPQR', '01HJKMNPQO')).toBe(false);
  });

  it('allows supplements only on normal, active requests', () => {
    for (const status of ['SUBMITTED', 'VERIFYING', 'VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS']) {
      expect(supplementAllowed(status, 'NORMAL')).toBe(true);
      expect(supplementAllowed(status, 'RATE_LIMITED_REVIEW')).toBe(false);
      expect(supplementAllowed(status, 'PROXY_QUOTA_REVIEW')).toBe(false);
    }
    for (const status of ['RESOLVING', 'RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE', 'CANCELLED']) {
      expect(supplementAllowed(status, 'NORMAL')).toBe(false);
    }
  });
});
