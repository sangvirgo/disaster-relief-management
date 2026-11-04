import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  CreateProxySOSPayload,
  CreateSOSPayload,
  DonationDeclarationPayload,
  DonationEvidenceReference,
} from '../types/api';

const KEYS = {
  ACCESS_TOKEN: 'c48_access_token',
  REFRESH_TOKEN: 'c48_refresh_token',
  USER_INFO: 'c48_user_info',
  GUEST_TRACKING_SECRETS: 'c48_guest_tracking_secrets', // Map tracking_code -> secret
  GUEST_DONATION_SECRETS: 'c48_guest_donation_secrets', // Map public_code -> secret
  GUEST_DONATION_EVIDENCE: 'c48_guest_donation_evidence', // Map donation ID -> evidence references
  PENDING_SOS: 'c48_pending_sos_command',
  PENDING_PROXY_SOS: 'c48_pending_proxy_sos_command',
  PENDING_DONATION: 'c48_pending_donation_command',
  PENDING_SUPPLEMENT: 'c48_pending_supplement_command',
};

const SECURE_JSON_CHUNK_BYTES = 1200;
const SECURE_JSON_MAX_CHUNKS = 16;

interface SecureJsonChunkManifest {
  __c48_secure_chunks: 1;
  id: string;
  count: number;
}

function isSecureJsonChunkManifest(value: unknown): value is SecureJsonChunkManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SecureJsonChunkManifest>;
  return candidate.__c48_secure_chunks === 1 &&
    typeof candidate.id === 'string' &&
    Number.isInteger(candidate.count) &&
    (candidate.count as number) > 0 &&
    (candidate.count as number) <= SECURE_JSON_MAX_CHUNKS;
}

function splitUtf8String(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (current && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }

  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

function secureJsonChunkKey(key: string, id: string, index: number): string {
  return `${key}__${id}_${index}`;
}

async function deleteSecureJsonChunks(key: string, id: string, count: number): Promise<void> {
  await Promise.allSettled(
    Array.from({ length: count }, (_, index) =>
      SecureStore.deleteItemAsync(secureJsonChunkKey(key, id, index))
    )
  );
}

async function readSecureJson<T>(key: string): Promise<T | null> {
  const stored = await SecureStore.getItemAsync(key);
  if (!stored) return null;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    await SecureStore.deleteItemAsync(key);
    return null;
  }

  if (!isSecureJsonChunkManifest(value)) return value as T;

  const chunks = await Promise.all(
    Array.from({ length: value.count }, (_, index) =>
      SecureStore.getItemAsync(secureJsonChunkKey(key, value.id, index))
    )
  );
  if (chunks.some((chunk) => chunk === null)) {
    await SecureStore.deleteItemAsync(key);
    await deleteSecureJsonChunks(key, value.id, value.count);
    return null;
  }

  try {
    return JSON.parse((chunks as string[]).join('')) as T;
  } catch {
    await SecureStore.deleteItemAsync(key);
    await deleteSecureJsonChunks(key, value.id, value.count);
    return null;
  }
}

async function saveSecureJson(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  const chunks = splitUtf8String(serialized, SECURE_JSON_CHUNK_BYTES);
  if (chunks.length > SECURE_JSON_MAX_CHUNKS) throw new Error('PENDING_COMMAND_TOO_LARGE');

  const previousStored = await SecureStore.getItemAsync(key);
  let previousManifest: SecureJsonChunkManifest | null = null;
  if (previousStored) {
    try {
      const parsed: unknown = JSON.parse(previousStored);
      if (isSecureJsonChunkManifest(parsed)) previousManifest = parsed;
    } catch {
      // Legacy or malformed values are replaced by the new complete command.
    }
  }

  const id = generateUUID();
  try {
    for (const [index, chunk] of chunks.entries()) {
      await SecureStore.setItemAsync(secureJsonChunkKey(key, id, index), chunk);
    }
    await SecureStore.setItemAsync(key, JSON.stringify({
      __c48_secure_chunks: 1,
      id,
      count: chunks.length,
    } satisfies SecureJsonChunkManifest));
  } catch (error) {
    await deleteSecureJsonChunks(key, id, chunks.length);
    throw error;
  }

  if (previousManifest) {
    await deleteSecureJsonChunks(key, previousManifest.id, previousManifest.count);
  }
}

async function clearSecureJson(key: string): Promise<void> {
  const stored = await SecureStore.getItemAsync(key);
  await SecureStore.deleteItemAsync(key);
  if (!stored) return;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (isSecureJsonChunkManifest(parsed)) {
      await deleteSecureJsonChunks(key, parsed.id, parsed.count);
    }
  } catch {
    // Older versions stored the JSON value directly under the main key.
  }
}

// Sinh UUID v4 chuẩn cho Idempotency-Key
export function generateUUID(): string {
  return Crypto.randomUUID();
}

// Chuyển mảng byte sang chuỗi base64url chuẩn (không padding '=' và thay + -> -, / -> _)
export function bytesToBase64Url(bytes: Uint8Array): string {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let b64 = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    const b2 = i < bytes.length ? bytes[i++] : NaN;
    const b3 = i < bytes.length ? bytes[i++] : NaN;
    const u24 = (b1 << 16) | ((isNaN(b2) ? 0 : b2) << 8) | (isNaN(b3) ? 0 : b3);
    b64 += base64Chars[(u24 >> 18) & 63];
    b64 += base64Chars[(u24 >> 12) & 63];
    b64 += isNaN(b2) ? '=' : base64Chars[(u24 >> 6) & 63];
    b64 += isNaN(b3) ? '=' : base64Chars[u24 & 63];
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Sinh chuỗi bí mật chuẩn backend Reliva (Đúng 32 bytes raw, độ dài chuẩn 43 ký tự base64url)
export async function generateRandomSecret(): Promise<string> {
  return bytesToBase64Url(await Crypto.getRandomBytesAsync(32));
}

export interface PendingSOSCommand {
  idempotencyKey: string;
  trackingSecret: string;
  payload: CreateSOSPayload;
}

export interface PendingDonationCommand {
  idempotencyKey: string;
  donationSecret: string;
  driveId: string;
  driveTitle: string;
  payload: DonationDeclarationPayload;
}

export interface PendingProxySOSCommand {
  idempotencyKey: string;
  payload: CreateProxySOSPayload;
}

export interface PendingSupplementCommand {
  requestId: string;
  payload: { expected_version: number; description: string };
  idempotencyKey: string;
}

function samePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const StorageService = {
  // === TOKEN NATIVE AUTH ===
  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken);
    await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refreshToken);
  },

  async getAccessToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
  },

  async getRefreshToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
  },

  async clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN);
    await SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN);
    await SecureStore.deleteItemAsync(KEYS.USER_INFO);
  },

  async clearAuth(): Promise<void> {
    await this.clearTokens();
  },

  // === USER INFO ===
  async saveUser(user: any): Promise<void> {
    await SecureStore.setItemAsync(KEYS.USER_INFO, JSON.stringify(user));
  },

  async getUser(): Promise<any | null> {
    const data = await SecureStore.getItemAsync(KEYS.USER_INFO);
    return data ? JSON.parse(data) : null;
  },

  // === GUEST SOS TRACKING SECRETS ===
  async saveGuestTrackingSecret(trackingCode: string, secret: string): Promise<void> {
    const key = `${KEYS.GUEST_TRACKING_SECRETS}_${trackingCode.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await SecureStore.setItemAsync(key, secret);
  },

  async getSecretForTrackingCode(trackingCode: string): Promise<string | null> {
    const key = `${KEYS.GUEST_TRACKING_SECRETS}_${trackingCode.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return SecureStore.getItemAsync(key);
  },

  async deleteGuestTrackingSecret(trackingCode: string): Promise<void> {
    const key = `${KEYS.GUEST_TRACKING_SECRETS}_${trackingCode.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await SecureStore.deleteItemAsync(key);
  },

  async savePendingSOS(command: PendingSOSCommand): Promise<void> {
    await saveSecureJson(KEYS.PENDING_SOS, command);
  },

  async getPendingSOS(): Promise<PendingSOSCommand | null> {
    return readSecureJson<PendingSOSCommand>(KEYS.PENDING_SOS);
  },

  async getOrCreatePendingSOS(payload: CreateSOSPayload): Promise<PendingSOSCommand> {
    const existing = await this.getPendingSOS();
    if (existing) {
      if (!samePayload(existing.payload, payload)) {
        throw new Error('PENDING_SOS_MUST_BE_RESUMED');
      }
      return existing;
    }
    const command = {
      idempotencyKey: generateUUID(),
      trackingSecret: await generateRandomSecret(),
      payload,
    };
    await this.savePendingSOS(command);
    return command;
  },

  async clearPendingSOS(): Promise<void> {
    await clearSecureJson(KEYS.PENDING_SOS);
  },

  async getPendingProxySOS(): Promise<PendingProxySOSCommand | null> {
    return readSecureJson<PendingProxySOSCommand>(KEYS.PENDING_PROXY_SOS);
  },

  async savePendingProxySOS(command: PendingProxySOSCommand): Promise<void> {
    await saveSecureJson(KEYS.PENDING_PROXY_SOS, command);
  },

  async getOrCreatePendingProxySOS(payload: CreateProxySOSPayload): Promise<PendingProxySOSCommand> {
    const existing = await this.getPendingProxySOS();
    if (existing) {
      if (!samePayload(existing.payload, payload)) throw new Error('PENDING_PROXY_SOS_MUST_BE_RESUMED');
      return existing;
    }
    const command = { idempotencyKey: generateUUID(), payload };
    await this.savePendingProxySOS(command);
    return command;
  },

  async clearPendingProxySOS(): Promise<void> {
    await clearSecureJson(KEYS.PENDING_PROXY_SOS);
  },

  async getOrCreatePendingDonation(
    driveId: string,
    payload: DonationDeclarationPayload,
    driveTitle: string
  ): Promise<PendingDonationCommand> {
    const existing = await this.getPendingDonation();
    if (existing) {
      if (existing.driveId !== driveId || !samePayload(existing.payload, payload)) {
        throw new Error('PENDING_DONATION_MUST_BE_RESUMED');
      }
      return existing;
    }
    const command = {
      idempotencyKey: generateUUID(),
      donationSecret: await generateRandomSecret(),
      driveId,
      driveTitle,
      payload,
    };
    await this.savePendingDonation(command);
    return command;
  },

  // === GUEST DONATION RECEIPTS & SECRETS ===
  async saveDonationReceipt(receipt: {
    id: string;
    public_code: string;
    secret?: string;
    drive_title?: string;
    created_at?: string;
    evidence?: DonationEvidenceReference[];
  }): Promise<void> {
    const existing = await this.getSavedDonationReceipts();
    const previous = existing.find((item) => item.id === receipt.id || item.public_code === receipt.public_code);
    const evidence = receipt.evidence ?? previous?.evidence ?? [];
    const metadata = {
      id: receipt.id,
      public_code: receipt.public_code,
      drive_title: receipt.drive_title || previous?.drive_title || 'Chiến dịch quyên góp cứu trợ',
      created_at: receipt.created_at || previous?.created_at || new Date().toISOString(),
    };
    const updated = [
      metadata,
      ...existing
        .filter((item) => item.id !== receipt.id && item.public_code !== receipt.public_code)
        .map(({ id, public_code, drive_title, created_at }) => ({ id, public_code, drive_title, created_at })),
    ].slice(0, 10);
    const sanitizedId = receipt.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const sanitizedCode = receipt.public_code.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (receipt.secret) {
      await SecureStore.setItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_${sanitizedId}`, receipt.secret);
      await SecureStore.setItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_${sanitizedCode}`, receipt.secret);
    }
    const evidenceKey = `${KEYS.GUEST_DONATION_EVIDENCE}_${sanitizedId}`;
    if (evidence.length > 0) {
      await SecureStore.setItemAsync(evidenceKey, JSON.stringify(evidence.slice(-5)));
    } else {
      await SecureStore.deleteItemAsync(evidenceKey);
    }
    const retainedIds = new Set(updated.map((item) => item.id));
    await Promise.allSettled(existing
      .filter((item) => !retainedIds.has(item.id))
      .map((item) => SecureStore.deleteItemAsync(
        `${KEYS.GUEST_DONATION_EVIDENCE}_${item.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      )));
    await SecureStore.setItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_index`, JSON.stringify(updated));
  },

  async getSavedDonationReceipts(): Promise<{
    id: string;
    public_code: string;
    drive_title?: string;
    created_at: string;
    evidence?: DonationEvidenceReference[];
  }[]> {
    try {
      const data = await SecureStore.getItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_index`);
      const receipts = data ? JSON.parse(data) as {
        id: string;
        public_code: string;
        drive_title?: string;
        created_at: string;
        evidence?: DonationEvidenceReference[];
      }[] : [];
      return await Promise.all(receipts.map(async (receipt) => {
        try {
          const sanitizedId = receipt.id.replace(/[^a-zA-Z0-9._-]/g, '_');
          const savedEvidence = await SecureStore.getItemAsync(`${KEYS.GUEST_DONATION_EVIDENCE}_${sanitizedId}`);
          const evidence = savedEvidence ? JSON.parse(savedEvidence) as DonationEvidenceReference[] : receipt.evidence;
          return { ...receipt, ...(Array.isArray(evidence) ? { evidence } : {}) };
        } catch {
          return receipt;
        }
      }));
    } catch {
      return [];
    }
  },

  async getSecretForDonation(idOrCode: string): Promise<string | null> {
    const sanitized = idOrCode.replace(/[^a-zA-Z0-9._-]/g, '_');
    const direct = await SecureStore.getItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_${sanitized}`);
    if (direct) return direct;
    const list = await this.getSavedDonationReceipts();
    const found = list.find((item) => item.public_code.toUpperCase() === idOrCode.toUpperCase());
    return found ? SecureStore.getItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_${found.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`) : null;
  },

  async getPendingDonation(): Promise<PendingDonationCommand | null> {
    return readSecureJson<PendingDonationCommand>(KEYS.PENDING_DONATION);
  },

  async savePendingDonation(command: PendingDonationCommand): Promise<void> {
    await saveSecureJson(KEYS.PENDING_DONATION, command);
  },

  async clearPendingDonation(): Promise<void> {
    await clearSecureJson(KEYS.PENDING_DONATION);
  },

  async getOrCreatePendingSupplement(
    requestId: string,
    payload: { expected_version: number; description: string }
  ): Promise<PendingSupplementCommand> {
    const key = `${KEYS.PENDING_SUPPLEMENT}_${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const existing = await readSecureJson<PendingSupplementCommand>(key);
    if (existing) {
      if (existing.requestId === requestId && existing.payload?.description === payload.description) return existing;
      throw new Error('PENDING_SUPPLEMENT_MUST_BE_RESUMED');
    }

    const command: PendingSupplementCommand = {
      requestId,
      payload,
      idempotencyKey: generateUUID(),
    };
    await saveSecureJson(key, command);
    return command;
  },

  async getPendingSupplement(requestId: string): Promise<PendingSupplementCommand | null> {
    const key = `${KEYS.PENDING_SUPPLEMENT}_${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const command = await readSecureJson<PendingSupplementCommand>(key);
    return command?.requestId === requestId ? command : null;
  },

  async clearPendingSupplement(requestId: string): Promise<void> {
    const key = `${KEYS.PENDING_SUPPLEMENT}_${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await clearSecureJson(key);
  },
};
