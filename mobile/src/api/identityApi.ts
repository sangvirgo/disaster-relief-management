import { apiClient } from './client';
import { NativeLoginResponse, User, RoleGrant } from '../types/api';
import { StorageService } from '../utils/secureStore';

export const IdentityApi = {
  // Đăng ký tài khoản công dân mới (POST /identity/auth/register)
  async register(username: string, password: string, displayName: string): Promise<{ user: { id: string; username: string; display_name: string } }> {
    const response = await apiClient.post<{ user: { id: string; username: string; display_name: string } }>('/identity/auth/register', {
      username: username.trim(),
      password,
      display_name: displayName.trim().normalize('NFC'),
    });
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
      user: { id, username, display_name, status: 'ACTIVE', must_change_password },
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
};
