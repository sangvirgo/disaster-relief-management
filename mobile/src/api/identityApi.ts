import { apiClient } from './client';
import { NativeLoginResponse, User, RoleGrant, RegionItem } from '../types/api';
import { generateUUID, StorageService } from '../utils/secureStore';

export const IdentityApi = {
  // Đăng ký tài khoản công dân mới (POST /identity/auth/register)
  async register(
    email: string,
    username: string,
    password: string,
    displayName: string,
    idempotencyKey = generateUUID(),
  ): Promise<{
    user: { id: string; username: string; display_name: string };
    verification: { challenge_id: string };
    email_sent: boolean;
  }> {
    const response = await apiClient.post<{
      user: { id: string; username: string; display_name: string };
      verification: { challenge_id: string };
      email_sent: boolean;
    }>('/identity/auth/register', {
      username: username.trim(),
      password,
      display_name: displayName.trim().normalize('NFC'),
      email: email.trim().toLowerCase(),
    }, { headers: { 'Idempotency-Key': idempotencyKey } });
    return response.data;
  },

  async verifyEmail(challengeId: string, code: string, idempotencyKey = generateUUID()): Promise<{ verified: true }> {
    const response = await apiClient.post<{ verified: true }>('/identity/auth/email/verify', {
      challenge_id: challengeId,
      code: code.trim(),
    }, { headers: { 'Idempotency-Key': idempotencyKey } });
    return response.data;
  },

  async resendEmailOtp(challengeId: string, idempotencyKey = generateUUID()): Promise<{ challenge_id: string | null; email_sent: boolean }> {
    const response = await apiClient.post<{ challenge_id: string | null; email_sent: boolean }>(
      '/identity/auth/email/resend',
      { challenge_id: challengeId },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return response.data;
  },

  // Đăng nhập Native (dành cho Tình nguyện viên, Đội cứu hộ, Công dân)
  async login(username: string, password: string): Promise<NativeLoginResponse> {
    const response = await apiClient.post<NativeLoginResponse>('/identity/auth/login', {
      username: username.trim(),
      password,
      client_kind: 'NATIVE',
    });

    const data = response.data;
    await StorageService.saveTokens(data.access_token, data.refresh_token);
    await StorageService.saveUser(data.user);

    return data;
  },

  async googleLogin(idToken: string): Promise<NativeLoginResponse> {
    const response = await apiClient.post<NativeLoginResponse>('/identity/auth/google', {
      id_token: idToken,
      client_kind: 'NATIVE',
    });
    const data = response.data;
    await StorageService.saveTokens(data.access_token, data.refresh_token);
    await StorageService.saveUser(data.user);
    return data;
  },

  // Lấy thông tin tài khoản và danh sách quyền hạn
  async getMe(): Promise<{ user: User; grants: RoleGrant[] }> {
    const response = await apiClient.get<{
      id: string;
      username: string;
      display_name: string;
      must_change_password?: boolean;
      grants: RoleGrant[];
    }>('/identity/me');

    const { id, username, display_name, must_change_password, grants } = response.data;
    return {
      user: { id, username, display_name, must_change_password },
      grants: grants || [],
    };
  },

  // Đổi mật khẩu
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/identity/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  // Đăng xuất
  async logout(): Promise<void> {
    try {
      await apiClient.post('/identity/auth/logout');
    } finally {
      await StorageService.clearTokens();
    }
  },

  // Liên kết tài khoản Google cho phiên đang đăng nhập (POST /identity/auth/google/link)
  async linkGoogle(idToken: string): Promise<{ linked: true }> {
    const response = await apiClient.post<{ linked: true }>('/identity/auth/google/link', {
      id_token: idToken,
    });
    return response.data;
  },

  // Danh mục khu vực hành chính (GET /identity/regions)
  async getRegions(): Promise<{ items: RegionItem[]; next_cursor?: string }> {
    const response = await apiClient.get<{ items: RegionItem[]; next_cursor?: string }>('/identity/regions');
    return response.data;
  },
};
