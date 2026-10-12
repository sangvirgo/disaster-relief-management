import { jest } from '@jest/globals';
import { DonationPhoneThrottle } from '../src/drives/donation-phone-throttle.service';

describe('Donation phone throttle', () => {
  it('limits repeated declarations for one phone and resets after the window', () => {
    const throttle = new DonationPhoneThrottle();

    for (let attempt = 0; attempt < 5; attempt++) throttle.assertAllowed('0901234567', 1_000 + attempt);
    expect(() => throttle.assertAllowed('0901234567', 2_000)).toThrow(expect.objectContaining({ code: 'RATE_LIMITED', status: 429 }));
    expect(() => throttle.assertAllowed('0907654321', 2_000)).not.toThrow();
    expect(() => throttle.assertAllowed('0901234567', 16 * 60_000)).not.toThrow();
  });
});
