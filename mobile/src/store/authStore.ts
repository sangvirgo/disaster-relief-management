import { create } from 'zustand';
import { User, RoleGrant } from '../types/api';
import { StorageService } from '../utils/secureStore';
import { IdentityApi } from '../api/identityApi';

interface AuthState {
  user: User | null;
  grants: RoleGrant[];
  isLoading: boolean;
  isAuthenticated: boolean;
  register: (email: string, username: string, password: string, displayName: string) => Promise<{
    verification: { challenge_id: string };
    email_sent: boolean;
  }>;
  login: (username: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  isVolunteerOrLeader: () => boolean;
  isCitizen: () => boolean;
  getUserRoleName: () => string;
  refreshMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  grants: [],
  isLoading: true,
  isAuthenticated: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true });
    try {
      const response = await IdentityApi.login(username, password);
      // Lấy chi tiết grants
      try {
        const me = await IdentityApi.getMe();
        set({
          user: me.user,
          grants: me.grants,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        set({
          user: response.user,
          grants: [],
          isAuthenticated: true,
          isLoading: false,
        });
      }
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  loginWithGoogle: async (idToken: string) => {
    set({ isLoading: true });
    try {
      const response = await IdentityApi.googleLogin(idToken);
      try {
        const me = await IdentityApi.getMe();
        set({ user: me.user, grants: me.grants, isAuthenticated: true, isLoading: false });
      } catch {
        set({ user: response.user, grants: [], isAuthenticated: true, isLoading: false });
      }
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await IdentityApi.logout();
    } finally {
      set({
        user: null,
        grants: [],
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  restoreSession: async () => {
    set({ isLoading: true });
    try {
      const token = await StorageService.getAccessToken();
      if (!token) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const me = await IdentityApi.getMe();
      set({
        user: me.user,
        grants: me.grants,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      await StorageService.clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  register: async (email: string, username: string, password: string, displayName: string) => {
    set({ isLoading: true });
    try {
      return await IdentityApi.register(email, username, password, displayName);
    } catch (error) {
      set({ isLoading: false });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  refreshMe: async () => {
    try {
      const me = await IdentityApi.getMe();
      set({ user: me.user, grants: me.grants });
    } catch {
      // Bỏ qua nếu lỗi mạng tạm thời
    }
  },

  isVolunteerOrLeader: () => {
    const { grants } = get();
    return grants.some((g) => g.role_code === 'VOLUNTEER');
  },

  isCitizen: () => {
    const { grants, isAuthenticated } = get();
    if (!isAuthenticated) return false;
    // Nếu có role CITIZEN hoặc không có role đặc biệt (cứu hộ/điều phối)
    const hasSpecialRole = grants.some((g) => ['VOLUNTEER', 'COORDINATOR', 'ADMIN', 'DISPATCHER'].includes(g.role_code));
    return grants.some((g) => g.role_code === 'CITIZEN') || !hasSpecialRole;
  },

  getUserRoleName: () => {
    const { grants, isAuthenticated } = get();
    if (!isAuthenticated) return 'Khách vãng lai';
    if (grants.some((g) => g.role_code === 'VOLUNTEER')) return 'Đội cứu hộ / Tình nguyện';
    if (grants.some((g) => g.role_code === 'COORDINATOR')) return 'Điều phối viên cứu trợ';
    if (grants.some((g) => g.role_code === 'ADMIN')) return 'Quản trị viên hệ thống';
    return 'Công dân';
  },
}));
