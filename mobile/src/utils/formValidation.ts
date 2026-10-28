export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s()-]/g, '');
}

export function isValidPhone(value: string): boolean {
  return /^\+?[0-9]{8,15}$/.test(normalizePhone(value));
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function isValidTrackingCode(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{10}$/i.test(value.trim());
}

export function isValidTrackingSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value.trim());
}

export function getTrackingCodeError(value: string, label = 'Mã tra cứu'): string | undefined {
  if (value.length > 10) return `${label} không được vượt quá 10 ký tự.`;
  const code = value.trim();
  if (!code) return undefined;
  if (code.length < 10) return `${label} phải có ít nhất 10 ký tự.`;
  return isValidTrackingCode(code) ? undefined : `${label} chứa ký tự không hợp lệ.`;
}

export function getTrackingSecretError(value: string, label = 'Khóa bí mật'): string | undefined {
  if (value.length > 43) return `${label} không được vượt quá 43 ký tự.`;
  const secret = value.trim();
  if (!secret) return undefined;
  if (secret.length < 43) return `${label} phải có ít nhất 43 ký tự.`;
  return isValidTrackingSecret(secret) ? undefined : `${label} chứa ký tự không hợp lệ.`;
}

const commonPasswords = new Set([
  'password123', 'password1', '1234567890', 'qwerty1234', 'qwertyuiop', 'letmein123', 'iloveyou', 'welcome123',
  'admin12345', 'abc1234567', '1111111111', '0000000000', 'changeme123', 'monkey12345', 'dragon12345', 'football1',
  'sunshine123', 'princess123', 'trustno123', 'password!', 'passw0rd123', 'p@ssword123',
]);

export function isCommonPassword(value: string): boolean {
  return commonPasswords.has(value.toLowerCase());
}

