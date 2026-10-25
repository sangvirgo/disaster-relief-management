import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { CreateProxySOSPayload, CreateSOSPayload, DonationDeclarationPayload } from '../types/api';

const KEYS = {
  ACCESS_TOKEN: 'c48_access_token',
  REFRESH_TOKEN: 'c48_refresh_token',
  USER_INFO: 'c48_user_info',
  GUEST_TRACKING_SECRETS: 'c48_guest_tracking_secrets', // Map tracking_code -> secret
  GUEST_DONATION_SECRETS: 'c48_guest_donation_secrets', // Map public_code -> secret
  PENDING_SOS: 'c48_pending_sos_command',
  PENDING_PROXY_SOS: 'c48_pending_proxy_sos_command',
  PENDING_DONATION: 'c48_pending_donation_command',
  PENDING_SUPPLEMENT: 'c48_pending_supplement_command',
};

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

  async savePendingSOS(command: PendingSOSCommand): Promise<void> {
    const serialized = JSON.stringify(command);
    if (serialized.length > 1800) {
      throw new Error('PENDING_COMMAND_TOO_LARGE');
    }
    await SecureStore.setItemAsync(KEYS.PENDING_SOS, serialized);
  },

  async getPendingSOS(): Promise<PendingSOSCommand | null> {
    const data = await SecureStore.getItemAsync(KEYS.PENDING_SOS);
    if (!data) return null;
    try {
      return JSON.parse(data) as PendingSOSCommand;
    } catch {
      await SecureStore.deleteItemAsync(KEYS.PENDING_SOS);
      return null;
    }
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
    await SecureStore.deleteItemAsync(KEYS.PENDING_SOS);
  },

  async getPendingProxySOS(): Promise<PendingProxySOSCommand | null> {
    const data = await SecureStore.getItemAsync(KEYS.PENDING_PROXY_SOS);
    if (!data) return null;
    try {
      return JSON.parse(data) as PendingProxySOSCommand;
    } catch {
      await SecureStore.deleteItemAsync(KEYS.PENDING_PROXY_SOS);
      return null;
    }
  },

  async savePendingProxySOS(command: PendingProxySOSCommand): Promise<void> {
    const serialized = JSON.stringify(command);
    if (serialized.length > 1800) throw new Error('PENDING_COMMAND_TOO_LARGE');
    await SecureStore.setItemAsync(KEYS.PENDING_PROXY_SOS, serialized);
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
    await SecureStore.deleteItemAsync(KEYS.PENDING_PROXY_SOS);
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
    secret: string;
    drive_title?: string;
    created_at?: string;
  }): Promise<void> {
    const metadata = {
      id: receipt.id,
      public_code: receipt.public_code,
      drive_title: receipt.drive_title || 'Chiến dịch quyên góp cứu trợ',
      created_at: receipt.created_at || new Date().toISOString(),
    };
    const existing = await this.getSavedDonationReceipts();
    const updated = [metadata, ...existing.filter((item) => item.id !== receipt.id && item.public_code !== receipt.public_code)].slice(0, 10);
    const sanitizedId = receipt.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    const sanitizedCode = receipt.public_code.replace(/[^a-zA-Z0-9._-]/g, '_');
    await SecureStore.setItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_${sanitizedId}`, receipt.secret);
    await SecureStore.setItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_${sanitizedCode}`, receipt.secret);
    await SecureStore.setItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_index`, JSON.stringify(updated));
  },

  async getSavedDonationReceipts(): Promise<{
    id: string;
    public_code: string;
    drive_title?: string;
    created_at: string;
  }[]> {
    try {
      const data = await SecureStore.getItemAsync(`${KEYS.GUEST_DONATION_SECRETS}_index`);
      return data ? JSON.parse(data) : [];
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
    const data = await SecureStore.getItemAsync(KEYS.PENDING_DONATION);
    if (!data) return null;
    try {
      return JSON.parse(data) as PendingDonationCommand;
    } catch {
      await SecureStore.deleteItemAsync(KEYS.PENDING_DONATION);
      return null;
    }
  },

  async savePendingDonation(command: PendingDonationCommand): Promise<void> {
    const serialized = JSON.stringify(command);
    if (serialized.length > 1800) {
      throw new Error('PENDING_COMMAND_TOO_LARGE');
    }
    await SecureStore.setItemAsync(KEYS.PENDING_DONATION, serialized);
  },

  async clearPendingDonation(): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS.PENDING_DONATION);
  },

  async getOrCreatePendingSupplement(
    requestId: string,
    payload: { expected_version: number; description: string }
  ): Promise<PendingSupplementCommand> {
    const key = `${KEYS.PENDING_SUPPLEMENT}_${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const data = await SecureStore.getItemAsync(key);
    if (data) {
      try {
        const existing = JSON.parse(data) as PendingSupplementCommand;
        if (existing.requestId === requestId && existing.payload?.description === payload.description) {
          return existing;
        }
        throw new Error('PENDING_SUPPLEMENT_MUST_BE_RESUMED');
      } catch (error) {
        if (error instanceof Error && error.message === 'PENDING_SUPPLEMENT_MUST_BE_RESUMED') throw error;
        await SecureStore.deleteItemAsync(key);
      }
    }

    const command: PendingSupplementCommand = {
      requestId,
      payload,
      idempotencyKey: generateUUID(),
    };
    await SecureStore.setItemAsync(key, JSON.stringify(command));
    return command;
  },

  async getPendingSupplement(requestId: string): Promise<PendingSupplementCommand | null> {
    const key = `${KEYS.PENDING_SUPPLEMENT}_${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const data = await SecureStore.getItemAsync(key);
    if (!data) return null;
    try {
      const command = JSON.parse(data) as PendingSupplementCommand;
      return command.requestId === requestId ? command : null;
    } catch {
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },

  async clearPendingSupplement(requestId: string): Promise<void> {
    const key = `${KEYS.PENDING_SUPPLEMENT}_${requestId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await SecureStore.deleteItemAsync(key);
  },
};
