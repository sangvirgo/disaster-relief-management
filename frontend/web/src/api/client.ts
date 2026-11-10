export type Service = 'identity' | 'response' | 'logistics';
export type ApiErrorCode = string;
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public status: number,
    message: string,
    public fieldErrors: Record<string, string[]> = {},
    public correlationId?: string
  ) {
    super(message);
  }
}

type ErrorEnvelope = {
  code?: string;
  message?: string;
  field_errors?: Record<string, string[]>;
  correlation_id?: string;
};
const serviceNames: Record<Service, string> = {
  identity: 'Tài khoản',
  response: 'SOS và điều phối',
  logistics: 'Quyên góp và vật phẩm',
};
const fieldNames: Record<string, string> = {
  username: 'Tên đăng nhập',
  password: 'Mật khẩu',
  current_password: 'Mật khẩu hiện tại',
  new_password: 'Mật khẩu mới',
  temporary_password: 'Mật khẩu tạm',
  display_name: 'Họ và tên',
  donor_name: 'Tên người đóng góp',
  donor_phone: 'Số điện thoại người đóng góp',
  reporter_contact_phone: 'Số điện thoại người gửi',
  beneficiary_contact_phone: 'Số điện thoại người cần hỗ trợ',
  incident_category_code: 'Loại sự cố',
  people_affected: 'Số người cần hỗ trợ',
  location: 'Vị trí cần hỗ trợ',
  coordinates: 'Tọa độ',
  longitude: 'Kinh độ',
  latitude: 'Vĩ độ',
  relationship: 'Quan hệ với người cần hỗ trợ',
  information_source: 'Nguồn tin',
  last_known_situation_at: 'Thời điểm nhận tin',
  contactability: 'Khả năng liên hệ',
  description: 'Mô tả tình hình',
  reason: 'Lý do',
  quantity: 'Số lượng',
  counted_quantity: 'Số đã đếm',
  accepted_quantity: 'Số tiếp nhận',
  held_quantity: 'Số tạm giữ',
  rejected_quantity: 'Số từ chối',
  item_id: 'Vật phẩm',
  lines: 'Danh sách vật phẩm',
  tracking_code: 'Mã theo dõi',
  public_code: 'Mã bản khai',
};
const fieldLabel = (path: string) =>
  fieldNames[path.split('.').filter(Boolean).at(-1) || ''] || `Trường ${path}`;
function formatFieldErrors(errors: Record<string, string[]> | undefined): string {
  if (!errors) return '';
  const fields = Object.keys(errors).slice(0, 3).map(fieldLabel);
  return fields.length ? ` Kiểm tra: ${fields.join(', ')}.` : '';
}
function serverError(
  service: Service,
  status: number,
  payload: ErrorEnvelope,
  fallback: string
): ApiError {
  const code = payload.code || (status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED');
  const reason =
    messages[code] || (typeof payload.message === 'string' && payload.message.trim()) || fallback;
  const reference = payload.correlation_id ? ` Mã tham chiếu lỗi: ${payload.correlation_id}.` : '';
  return new ApiError(
    code,
    status,
    `${serviceNames[service]}: ${reason}${formatFieldErrors(payload.field_errors)}${reference}`,
    payload.field_errors,
    payload.correlation_id
  );
}

const messages: Record<string, string> = {
  GOOGLE_ACCOUNT_LINK_REQUIRED: 'Email này đã có tài khoản Reliva. Đăng nhập bằng tên đăng nhập và mật khẩu Reliva hiện có, rồi mở trình đơn tài khoản → Xem hồ sơ → Bảo mật và liên kết Google.',
  SESSION_REAUTH_REQUIRED: 'Để liên kết Google, hãy đăng xuất rồi đăng nhập lại tài khoản Reliva hiện có. Sau đó mở Xem hồ sơ → Bảo mật và liên kết Google trong vòng 15 phút.',
  GOOGLE_IDENTITY_IN_USE: 'Google vừa chọn đã liên kết với một tài khoản Reliva khác. Hãy chọn đúng Google của bạn hoặc đăng nhập bằng Google đó để sử dụng tài khoản đã liên kết.',
  GOOGLE_ALREADY_LINKED: 'Tài khoản Reliva này đã liên kết với một Google khác. Không thể thay thế liên kết bằng thao tác này.',
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
  CYCLE_SEALED: 'Đợt xử lý SOS này đã kết thúc nên không thể thay đổi nhu cầu hoặc cam kết vật tư. Nếu phát sinh nhu cầu mới, cần điều phối viên mở lại hồ sơ SOS và ghi nhận nhu cầu cho đợt xử lý mới.',
  RESOLUTION_BLOCKED: 'Chưa thể kết thúc SOS. Hãy kiểm tra nhiệm vụ đang giao, kết quả cứu hộ và việc bàn giao vật tư trong hồ sơ.',
  RESOLUTION_BASIS_INVALID: 'Căn cứ kết thúc chưa phù hợp với kết quả nhiệm vụ hoặc vật tư hiện tại.',
  IDENTITY_UNAVAILABLE: 'Dịch vụ tài khoản tạm thời không khả dụng. Vui lòng thử lại.',
  PASSWORD_WEAK:
    'Mật khẩu chưa đủ mạnh. Mật khẩu phải từ 10 ký tự, khác tên tài khoản và không dùng mật khẩu phổ biến (như password123, 1234567890...).',
  INVALID_CREDENTIALS: 'Không thể xác thực tài khoản. Vui lòng kiểm tra thông tin đăng nhập; nếu thông tin đã đúng, hãy nhờ quản trị viên kiểm tra trạng thái tài khoản.',
};
let csrfToken: string | null = null;
let refreshPromise: Promise<void> | null = null;
const expiredSessionCodes = new Set(['UNAUTHENTICATED', 'SESSION_EXPIRED', 'REFRESH_REUSED']);
function notifyExpiredSession(error: ApiError): void {
  if (error.status === 401 || expiredSessionCodes.has(error.code)) {
    window.dispatchEvent(new Event('c48:session-expired'));
  }
}

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
      'Tài khoản: Không thể kết nối tới máy chủ. Yêu cầu chưa được xác nhận.'
    );
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    throw serverError('identity', response.status, payload, messages.CSRF_INVALID);
  }
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
        throw new ApiError(
          'NETWORK_UNAVAILABLE',
          0,
          'Tài khoản: Không thể làm mới phiên vì mất kết nối.'
        );
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ErrorEnvelope;
        throw serverError('identity', response.status, payload, messages.SESSION_EXPIRED);
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
  retryCsrf?: boolean;
  credentials?: RequestCredentials;
}
export async function api<T>(
  service: Service,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const method = options.method || 'GET';
  const credentials = options.credentials || 'include';
  if (method !== 'GET' && credentials !== 'omit' && !csrfToken) await csrf();
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && credentials !== 'omit') headers['X-CSRF-Token'] = csrfToken!;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`/api/v1/${service}${path}`, {
      method,
      credentials,
      cache: 'no-store',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      0,
      `${serviceNames[service]}: Không thể kết nối tới máy chủ. Yêu cầu chưa được xác nhận.`
    );
  }
  if (
    response.status === 401 &&
    credentials !== 'omit' &&
    options.retryAuth !== false &&
    path !== '/auth/login' &&
    path !== '/auth/refresh'
  ) {
    try {
      await refresh();
      return api<T>(service, path, { ...options, retryAuth: false });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'REFRESH_RACE') throw cause;
      if (cause instanceof ApiError) notifyExpiredSession(cause);
    }
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    if (payload.code === 'CSRF_INVALID' && method !== 'GET' && credentials !== 'omit' && options.retryCsrf !== false) {
      await csrf();
      return api<T>(service, path, { ...options, retryCsrf: false });
    }
    const error = serverError(
      service,
      response.status,
      payload,
      'Yêu cầu chưa hoàn tất. Vui lòng thử lại.'
    );
    if (credentials !== 'omit' && options.retryAuth === false && path !== '/auth/login') notifyExpiredSession(error);
    throw error;
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const newCommandKey = () => crypto.randomUUID();

export async function upload<T>(
  service: Service,
  path: string,
  file: File,
  options: {
    headers?: Record<string, string>;
    idempotencyKey: string;
    credentials?: RequestCredentials;
  },
  retryAuth = true,
  retryCsrf = true
): Promise<T> {
  const credentials = options.credentials || 'include';
  if (credentials !== 'omit' && !csrfToken) await csrf();
  const body = new FormData();
  body.append('file', file);
  let response: Response;
  try {
    response = await fetch(`/api/v1/${service}${path}`, {
      method: 'POST',
      credentials,
      cache: 'no-store',
      body,
      headers: {
        ...options.headers,
        'Idempotency-Key': options.idempotencyKey,
        ...(credentials !== 'omit' ? { 'X-CSRF-Token': csrfToken! } : {}),
      },
    });
  } catch {
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      0,
      `${serviceNames[service]}: Không thể tải tệp lên. Chưa có xác nhận từ máy chủ.`
    );
  }
  if (response.status === 401 && retryAuth && credentials !== 'omit') {
    try {
      await refresh();
      return upload<T>(service, path, file, options, false, retryCsrf);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'REFRESH_RACE') throw cause;
      if (cause instanceof ApiError) notifyExpiredSession(cause);
    }
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    if (payload.code === 'CSRF_INVALID' && credentials !== 'omit' && retryCsrf) {
      await csrf();
      return upload<T>(service, path, file, options, retryAuth, false);
    }
    const error = serverError(
      service,
      response.status,
      payload,
      'Không thể tải tệp lên. Vui lòng kiểm tra tệp và thử lại.'
    );
    if (credentials !== 'omit' && !retryAuth) notifyExpiredSession(error);
    throw error;
  }
  return response.json() as Promise<T>;
}
