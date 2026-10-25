import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig, create } from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { StorageService, generateUUID } from '../utils/secureStore';
import { ApiErrorEnvelope } from '../types/api';

function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) {
    return configured;
  }

  // Tự động nhận diện IP của máy tính host khi chạy Expo Go trên thiết bị thật (cùng mạng Wi-Fi LAN)
  if (__DEV__) {
    const hostUri = Constants.expoConfig?.hostUri
      ?? (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost
      ?? (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } }).manifest2?.extra?.expoClient?.hostUri;

    if (hostUri) {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:8080/api/v1`;
      }
    }
  }

  return Platform.select({
    android: 'http://10.0.2.2:8080/api/v1',
    default: 'http://127.0.0.1:8080/api/v1',
  }) as string;
}

export const API_BASE_URL = resolveApiBaseUrl();

if (__DEV__) {
  console.log('[Reliva Mobile API] API_BASE_URL:', API_BASE_URL);
}

if (!__DEV__ && !API_BASE_URL.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_API_BASE_URL phải dùng HTTPS khi phát hành ứng dụng.');
}

export class MobileApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly correlationId?: string;

  constructor(message: string, details: { code?: string; status?: number; correlationId?: string } = {}) {
    super(message);
    this.name = 'MobileApiError';
    this.code = details.code;
    this.status = details.status;
    this.correlationId = details.correlationId;
  }
}

const codeMessages: Record<string, string> = {
  USERNAME_TAKEN: 'Tên đăng nhập này đã có người sử dụng. Vui lòng chọn tên khác.',
  PASSWORD_WEAK: 'Mật khẩu chưa đủ mạnh. Vui lòng chọn mật khẩu khác theo yêu cầu.',
  INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.',
  SOS_RATE_CEILING: 'Thiết bị gửi quá nhiều yêu cầu. Nếu đang nguy hiểm, hãy gọi 112, 113, 114 hoặc 115.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Tài khoản không có quyền thực hiện thao tác này.',
  VALIDATION_FAILED: 'Thông tin gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.',
  IDEMPOTENCY_KEY_INVALID: 'Không thể xác nhận yêu cầu an toàn. Vui lòng thử lại.',
  IDEMPOTENCY_KEY_REUSED: 'Yêu cầu đang chờ được xác nhận với nội dung khác. Hãy tải lại và thử lại.',
  VERSION_CONFLICT: 'Dữ liệu đã thay đổi. Vui lòng tải lại trước khi tiếp tục.',
  STATE_TRANSITION_INVALID: 'Trạng thái hiện tại không cho phép thực hiện thao tác này.',
  TRACKING_SECRET_INVALID: 'Mã tra cứu hoặc khóa bí mật không chính xác.',
  DONATION_SECRET_INVALID: 'Mã quyên góp hoặc khóa bí mật không chính xác.',
  DRIVE_NOT_OPEN: 'Đợt tiếp nhận này hiện không nhận bàn giao hàng hóa.',
  CAMPAIGN_NOT_ACTIVE: 'Chiến dịch liên kết hiện không hoạt động.',
  ITEM_NOT_ON_DRIVE: 'Mặt hàng này không thuộc đợt tiếp nhận đã chọn.',
  QUANTITY_SCALE_INVALID: 'Số lượng có quá nhiều chữ số thập phân theo đơn vị tiếp nhận.',
  EVIDENCE_LIMIT_REACHED: 'Đã đạt giới hạn tệp minh chứng cho hồ sơ này.',
  PAYLOAD_TOO_LARGE: 'Tệp vượt quá dung lượng cho phép.',
  UNSUPPORTED_MEDIA: 'Định dạng tệp này chưa được hỗ trợ.',
  STORAGE_UNAVAILABLE: 'Dịch vụ lưu trữ tạm thời không khả dụng. Hồ sơ vẫn được giữ nguyên.',
  CURSOR_INVALID: 'Danh sách đã thay đổi. Vui lòng tải lại từ đầu.',
  NOT_FOUND: 'Không tìm thấy dữ liệu hoặc thông tin tra cứu chưa chính xác.',
};

const statusMessages: Record<number, string> = {
  400: 'Thông tin gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.',
  401: 'Phiên đăng nhập đã hết hạn hoặc thông tin xác thực chưa chính xác.',
  403: 'Tài khoản không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy dữ liệu hoặc thông tin tra cứu chưa chính xác.',
  409: 'Dữ liệu hoặc trạng thái đã thay đổi. Vui lòng tải lại rồi thử lại.',
  413: 'Tệp hoặc dữ liệu gửi lên vượt quá giới hạn cho phép.',
  429: 'Hệ thống đang nhận nhiều yêu cầu. Vui lòng thử lại sau.',
  500: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
  502: 'Không thể kết nối tới dịch vụ xử lý. Vui lòng thử lại sau.',
  503: 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.',
};

function messageForStatus(status?: number): string {
  return (status && statusMessages[status]) || 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

export function formatApiError(error: unknown): MobileApiError {
  if (error instanceof MobileApiError) return error;

  const axiosError = error as AxiosError<ApiErrorEnvelope>;
  const envelope = axiosError?.response?.data;
  const code = typeof envelope?.code === 'string' ? envelope.code : undefined;
  const status = axiosError?.response?.status;
  const message = code ? codeMessages[code] || messageForStatus(status) : messageForStatus(status);
  const fallback = axiosError?.code === 'ECONNABORTED' || axiosError?.message?.toLowerCase().includes('timeout')
    ? 'Kết nối máy chủ quá thời gian. Vui lòng kiểm tra mạng rồi thử lại.'
    : !axiosError?.response
      ? 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và địa chỉ dịch vụ.'
      : message;

  return new MobileApiError(fallback, {
    code,
    status,
    correlationId: envelope?.correlation_id,
  });
}

export function getApiErrorMessage(error: unknown, fallback = 'Đã xảy ra lỗi. Vui lòng thử lại.'): string {
  if (error instanceof MobileApiError) return error.message;
  if (error instanceof Error && error.name === 'MobileApiError') return error.message;
  return typeof error === 'string' ? error : fallback;
}

export function isApiErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof MobileApiError && !!error.code && codes.includes(error.code);
}

export const apiClient: AxiosInstance = create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { Accept: 'application/json' },
});

let isRefreshing = false;
let failedQueue: {
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}[] = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((pending) => {
    if (error) pending.reject(error);
    else pending.resolve(token);
  });
  failedQueue = [];
};

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await StorageService.getAccessToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const method = config.method?.toLowerCase();
    const exemptPost = config.url?.includes('/auth/login') || config.url?.includes('/auth/refresh') ||
      config.url?.includes('/auth/logout') || config.url?.endsWith('/notices/') || config.url?.includes('/notices/') && config.url.endsWith('/read');
    if (['post', 'put', 'patch', 'delete'].includes(method || '') && !exemptPost && !config.headers['Idempotency-Key']) {
      config.headers['Idempotency-Key'] = generateUUID();
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorEnvelope>) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') || originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry || isAuthEndpoint) {
      return Promise.reject(formatApiError(error));
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => failedQueue.push({ resolve, reject }))
        .then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        })
        .catch((refreshError) => Promise.reject(refreshError));
    }

    originalRequest._retry = true;
    isRefreshing = true;
    const refreshToken = await StorageService.getRefreshToken();
    if (!refreshToken) {
      processQueue(formatApiError(error));
      await StorageService.clearTokens();
      isRefreshing = false;
      return Promise.reject(formatApiError(error));
    }

    try {
      const refreshResponse = await axios.post(`${API_BASE_URL}/identity/auth/refresh`, {
        refresh_token: refreshToken,
        client_kind: 'NATIVE',
      }, { timeout: 15000, headers: { Accept: 'application/json' } });

      const { access_token, refresh_token: newRefreshToken } = refreshResponse.data;
      await StorageService.saveTokens(access_token, newRefreshToken);
      originalRequest.headers.Authorization = `Bearer ${access_token}`;
      processQueue(null, access_token);
      return apiClient(originalRequest);
    } catch (refreshError) {
      const formattedError = formatApiError(refreshError);
      processQueue(formattedError);
      await StorageService.clearTokens();
      return Promise.reject(formattedError);
    } finally {
      isRefreshing = false;
    }
  }
);
