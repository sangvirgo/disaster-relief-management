export type Service = 'identity' | 'response' | 'logistics';
export type ApiErrorCode = string;
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const messages: Record<string, string> = {
  UNAUTHENTICATED: 'Bạn cần đăng nhập để tiếp tục.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  REFRESH_REUSED: 'Phiên đăng nhập không còn an toàn. Vui lòng đăng nhập lại.',
  REFRESH_RACE: 'Phiên đang được làm mới ở cửa sổ khác. Vui lòng thử lại.',
  FORBIDDEN: 'Bạn không có quyền xem hoặc thực hiện thao tác này.',
  CSRF_INVALID: 'Phiên bảo vệ đã hết hạn. Vui lòng thử lại.',
  VALIDATION_FAILED: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường đã nhập.',
  VERSION_CONFLICT: 'Dữ liệu đã thay đổi. Vui lòng tải lại trước khi tiếp tục.',
  NOT_FOUND: 'Không tìm thấy dữ liệu hoặc bạn không có quyền xem.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
  IDEMPOTENCY_KEY_REUSED:
    'Yêu cầu gửi lại đã thay đổi nội dung. Vui lòng tải lại và thực hiện thao tác mới.',
  SELF_APPROVAL_FORBIDDEN: 'Bạn không thể tự duyệt bản ghi do mình lập hoặc kiểm đếm.',
  APPROVAL_STALE: 'Bản kiểm đếm đã thay đổi. Vui lòng tải lại trước khi duyệt.',
  STATE_TRANSITION_INVALID: 'Trạng thái hiện tại không cho phép thao tác này.',
  IDENTITY_UNAVAILABLE: 'Dịch vụ tài khoản tạm thời không khả dụng. Vui lòng thử lại.',
  PASSWORD_WEAK:
    'Mật khẩu mới chưa đủ mạnh. Mật khẩu phải từ 10 ký tự, khác tên tài khoản, khác mật khẩu hiện tại và không dùng mật khẩu phổ biến (như password123, 1234567890...).',
  INVALID_CREDENTIALS: 'Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại.',
};
let csrfToken: string | null = null;
let refreshPromise: Promise<void> | null = null;

export async function csrf(): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/v1/identity/auth/csrf', {
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      0,
      'Không thể kết nối tới hệ thống. Yêu cầu chưa được xác nhận.'
    );
  }
  if (!response.ok) throw new ApiError('CSRF_INVALID', response.status, messages.CSRF_INVALID);
  const body = (await response.json()) as { csrf_token: string };
  csrfToken = body.csrf_token;
}
export function invalidateCsrf(): void {
  csrfToken = null;
}

async function refresh(): Promise<void> {
  if (!refreshPromise)
    refreshPromise = (async () => {
      await csrf();
      const response = await fetch('/api/v1/identity/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken! },
        body: '{}',
      }).catch(() => {
        throw new ApiError('NETWORK_UNAVAILABLE', 0, 'Không thể làm mới phiên vì mất kết nối.');
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { code?: string };
        throw new ApiError(
          body.code || 'SESSION_EXPIRED',
          response.status,
          messages[body.code || ''] || messages.SESSION_EXPIRED
        );
      }
      csrfToken = null;
    })().finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  retryAuth?: boolean;
}
export async function api<T>(
  service: Service,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method || 'GET';
  if (method !== 'GET' && !csrfToken) await csrf();
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken!;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`/api/v1/${service}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      0,
      'Không thể kết nối tới hệ thống. Yêu cầu chưa được xác nhận.'
    );
  }
  if (
    response.status === 401 &&
    options.retryAuth !== false &&
    path !== '/auth/login' &&
    path !== '/auth/refresh'
  ) {
    try {
      await refresh();
      return api<T>(service, path, { ...options, retryAuth: false });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'REFRESH_RACE') throw cause;
    }
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    const code = body.code || (response.status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED');
    const msg =
      messages[code] ||
      (typeof body.message === 'string' && body.message
        ? body.message
        : 'Yêu cầu chưa hoàn tất. Vui lòng thử lại.');
    throw new ApiError(code, response.status, msg);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const newCommandKey = () => crypto.randomUUID();

export async function upload<T>(
  service: Service,
  path: string,
  file: File,
  options: { headers?: Record<string, string>; idempotencyKey: string },
  retryAuth = true
): Promise<T> {
  if (!csrfToken) await csrf();
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetch(`/api/v1/${service}${path}`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      body,
      headers: {
        ...options.headers,
        'Idempotency-Key': options.idempotencyKey,
        'X-CSRF-Token': csrfToken!,
      },
    });
  } catch {
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      0,
      'Không thể tải tệp lên. Chưa có xác nhận từ máy chủ.'
    );
  }
  if (response.status === 401 && retryAuth) {
    try {
      await refresh();
      return upload<T>(service, path, file, options, false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'REFRESH_RACE') throw cause;
    }
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { code?: string };
    const code = payload.code || 'UPLOAD_FAILED';
    throw new ApiError(
      code,
      response.status,
      messages[code] || 'Không thể tải tệp lên. Vui lòng kiểm tra tệp và thử lại.'
    );
  }
  return response.json() as Promise<T>;
}
