import { randomBytes } from 'node:crypto';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hashPurposeBoundSecret, verifyPurposeBoundSecret } from '../../../../packages/technical/src/security/secret-hash';
import type { PepperSet } from '../../../../packages/technical/src/security/secret-hash';

export const DONATION_SECRET_CONFIG = Symbol('DONATION_SECRET_CONFIG');
const DONATION_SECRET_PURPOSE = 'donation-delivery';

export interface DonationSecretConfig {
  peppers: PepperSet;
  currentPepperVersion: string;
}

export function loadDonationSecretConfig(env: Record<string, string | undefined> = process.env): DonationSecretConfig {
  const pepper = env.SECRET_HASH_PEPPER_DONATION ?? '';
  if (pepper.length < 32 || pepper.length > 256) {
    throw new Error('Invalid Logistics configuration: SECRET_HASH_PEPPER_DONATION');
  }
  return { peppers: { v1: pepper }, currentPepperVersion: 'v1' };
}

export function donationCapabilityHash(secret: string | undefined, config: DonationSecretConfig): string | null {
  if (secret === undefined) return null;
  validateDonationSecret(secret);
  return hashPurposeBoundSecret(secret, DONATION_SECRET_PURPOSE, config.peppers, config.currentPepperVersion);
}

export function verifyDonationCapability(secret: string | undefined, storedHash: string | null, config: DonationSecretConfig): boolean {
  if (!secret || !storedHash) return false;
  try {
    validateDonationSecret(secret);
  } catch {
    return false;
  }
  return verifyPurposeBoundSecret(secret, DONATION_SECRET_PURPOSE, storedHash, config.peppers, config.currentPepperVersion).valid;
}

export function generateDonationSecret(): string {
  return randomBytes(32).toString('base64url');
}

function validateDonationSecret(secret: string): void {
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(secret)) throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
  const bytes = Buffer.from(secret, 'base64url');
  if (bytes.length < 32 || bytes.length > 64 || bytes.toString('base64url') !== secret) {
    throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
  }
}
