import { createHmac, timingSafeEqual } from 'node:crypto';

export type PepperSet = Readonly<Record<string, string>>;

function digest(secret: string, purpose: string, pepper: string): string {
  return createHmac('sha256', pepper).update(purpose).update('\0').update(secret).digest('hex');
}

export function hashPurposeBoundSecret(secret: string, purpose: string, peppers: PepperSet, currentVersion: string): string {
  const pepper = peppers[currentVersion];
  if (!secret || !purpose || !pepper || !/^v[1-9][0-9]*$/.test(currentVersion)) throw new Error('Secret purpose and current pepper are required');
  return `${currentVersion}:${digest(secret, purpose, pepper)}`;
}

export interface SecretVerification {
  valid: boolean;
  needsRebind: boolean;
  replacement?: string;
}

export function verifyPurposeBoundSecret(
  secret: string,
  purpose: string,
  storedHash: string,
  peppers: PepperSet,
  currentVersion: string,
): SecretVerification {
  const separator = storedHash.indexOf(':');
  if (separator <= 0) return { valid: false, needsRebind: false };
  const version = storedHash.slice(0, separator);
  const expected = storedHash.slice(separator + 1);
  const pepper = peppers[version];
  if (!/^v[1-9][0-9]*$/.test(version) || !pepper || !/^[0-9a-f]{64}$/.test(expected)) return { valid: false, needsRebind: false };
  const actual = digest(secret, purpose, pepper);
  const valid = timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  const needsRebind = valid && version !== currentVersion && /^v[1-9][0-9]*$/.test(currentVersion) && Boolean(peppers[currentVersion]);
  return {
    valid,
    needsRebind,
    ...(needsRebind ? { replacement: hashPurposeBoundSecret(secret, purpose, peppers, currentVersion) } : {}),
  };
}
