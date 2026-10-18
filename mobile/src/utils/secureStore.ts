import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ACCESS_TOKEN: 'c48_access_token',
  REFRESH_TOKEN: 'c48_refresh_token',
  USER_INFO: 'c48_user_info',
  GUEST_TRACKING_SECRETS: 'c48_guest_tracking_secrets', // Map tracking_code -> secret
  GUEST_DONATION_SECRETS: 'c48_guest_donation_secrets', // Map public_code -> secret
};

// Sinh UUID v4 chuẩn cho Idempotency-Key
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

// Sinh chuỗi bí mật chuẩn Backend C48 (Đúng 32 bytes raw, độ dài chuẩn 43 ký tự base64url)
export function generateRandomSecret(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToBase64Url(bytes);
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
    try {
      const existing = await this.getGuestTrackingSecrets();
      existing[trackingCode] = secret;
      await SecureStore.setItemAsync(KEYS.GUEST_TRACKING_SECRETS, JSON.stringify(existing));
    } catch (e) {
      console.warn('Lỗi lưu tracking secret:', e);
    }
  },

  async getGuestTrackingSecrets(): Promise<Record<string, string>> {
    try {
      const data = await SecureStore.getItemAsync(KEYS.GUEST_TRACKING_SECRETS);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },

  async getSecretForTrackingCode(trackingCode: string): Promise<string | null> {
    const secrets = await this.getGuestTrackingSecrets();
    return secrets[trackingCode] || null;
  },

  // === GUEST DONATION RECEIPTS & SECRETS ===
  async saveDonationReceipt(receipt: {
    id: string;
    public_code: string;
    secret: string;
    drive_title?: string;
    created_at?: string;
  }): Promise<void> {
    try {
      const existing = await this.getSavedDonationReceipts();
      const updated = [
        {
          id: receipt.id,
          public_code: receipt.public_code,
          secret: receipt.secret,
          drive_title: receipt.drive_title || 'Chiến dịch quyên góp cứu trợ',
          created_at: receipt.created_at || new Date().toISOString(),
        },
        ...existing.filter((item) => item.id !== receipt.id && item.public_code !== receipt.public_code),
      ];
      await SecureStore.setItemAsync(KEYS.GUEST_DONATION_SECRETS, JSON.stringify(updated));
    } catch (e) {
      console.warn('Lỗi lưu biên nhận quyên góp:', e);
    }
  },

  async getSavedDonationReceipts(): Promise<
    Array<{
      id: string;
      public_code: string;
      secret: string;
      drive_title?: string;
      created_at: string;
    }>
  > {
    try {
      const data = await SecureStore.getItemAsync(KEYS.GUEST_DONATION_SECRETS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  async getSecretForDonation(idOrCode: string): Promise<string | null> {
    const list = await this.getSavedDonationReceipts();
    const found = list.find(
      (item) => item.id === idOrCode || item.public_code.toUpperCase() === idOrCode.toUpperCase()
    );
    return found ? found.secret : null;
  },
};
