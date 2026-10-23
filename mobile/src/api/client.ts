import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { StorageService, generateUUID } from '../utils/secureStore';
import { ApiErrorEnvelope } from '../types/api';

// Cấu hình URL backend. Khi test trên Android Emulator: dùng 10.0.2.2, trên máy thật dùng IP LAN
export const API_BASE_URL = 'http://192.168.1.2:8080/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10 giây timeout trong tình huống khẩn cấp
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Request Interceptor: Tự động đính kèm Token và Idempotency-Key
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await StorageService.getAccessToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Tự động sinh Idempotency-Key cho các request thay đổi trạng thái
    if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() || '')) {
      if (!config.headers['Idempotency-Key']) {
        config.headers['Idempotency-Key'] = generateUUID();
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Tự động refresh token và xử lý lỗi tiếng Việt
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorEnvelope>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Bắt lỗi 401 do token hết hạn và thực hiện Refresh Token tự động
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/refresh')) {
        return Promise.reject(formatApiError(error));
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = await StorageService.getRefreshToken();
      if (!refreshToken) {
        isRefreshing = false;
        await StorageService.clearTokens();
        return Promise.reject(formatApiError(error));
      }

      try {
        const refreshResponse = await axios.post(`${API_BASE_URL}/identity/auth/refresh`, {
          refresh_token: refreshToken,
          client_kind: 'NATIVE',
        });

        const { access_token, refresh_token: newRefreshToken } = refreshResponse.data;
        await StorageService.saveTokens(access_token, newRefreshToken);

        apiClient.defaults.headers.common.Authorization = `Bearer ${access_token}`;
        originalRequest.headers.Authorization = `Bearer ${access_token}`;

        processQueue(null, access_token);
        return apiClient(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        await StorageService.clearTokens();
        return Promise.reject(formatApiError(error));
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(formatApiError(error));
  }
);

// Chuẩn hóa lỗi hiển thị thân thiện tiếng Việt cho người dùng
export function formatApiError(error: AxiosError<ApiErrorEnvelope>): string {
  const code = error.response?.data?.code;
  const message = error.response?.data?.message;

  // Bản đồ mã lỗi trực tiếp từ danh mục mã lỗi Backend (07-error-catalog.md)
  const codeMap: Record<string, string> = {
    USERNAME_TAKEN: 'Tên đăng nhập này đã có người sử dụng. Vui lòng chọn tên khác.',
    PASSWORD_WEAK: 'Mật khẩu chưa đủ mạnh (yêu cầu tối thiểu 10 ký tự và không dùng mật khẩu phổ biến).',
    INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không chính xác.',
    RATE_LIMITED: 'Bạn đã thao tác quá nhiều lần. Vui lòng đợi trong giây lát rồi thử lại.',
    UNAUTHENTICATED: 'Bạn cần đăng nhập tài khoản để thực hiện thao tác này.',
    SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
    VALIDATION_FAILED: 'Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra lại các trường thông tin.',
    IDEMPOTENCY_KEY_INVALID: 'Mã phiên giao dịch không hợp lệ.',
    SOS_RATE_CEILING: 'Hệ thống đang quá tải yêu cầu từ thiết bị của bạn. Nếu đang nguy hiểm, hãy gọi ngay 113/114/115.',
  };

  if (code && codeMap[code]) {
    return codeMap[code];
  }

  if (message && typeof message === 'string') {
    return message;
  }

  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return 'Kết nối mạng máy chủ quá thời gian. Vui lòng kiểm tra lại sóng điện thoại.';
  }
  if (!error.response) {
    return 'Không thể kết nối đến máy chủ điều phối cứu hộ. Vui lòng kiểm tra kết nối mạng.';
  }
  switch (error.response.status) {
    case 400:
      return 'Dữ liệu yêu cầu chưa hợp lệ. Vui lòng kiểm tra lại thông tin đã nhập.';
    case 401:
      return 'Phiên đăng nhập đã hết hạn hoặc thông tin đăng nhập không đúng.';
    case 403:
      return 'Bạn không có quyền thực hiện thao tác này.';
    case 404:
      return 'Không tìm thấy thông tin yêu cầu hoặc dữ liệu không tồn tại.';
    case 409:
      return 'Dữ liệu đã bị trùng lặp hoặc trạng thái đã thay đổi.';
    case 429:
      return 'Hệ thống đang nhận quá nhiều lượt yêu cầu. Vui lòng thử lại sau giây lát.';
    case 500:
    case 502:
    case 503:
      return 'Máy chủ cứu hộ đang bận xử lý dữ liệu. Vui lòng thử lại sau giây lát.';
    default:
      return 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
  }
}
