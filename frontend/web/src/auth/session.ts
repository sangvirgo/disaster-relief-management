import { api, csrf, invalidateCsrf, newCommandKey } from '../api/client';
import type { components as IdentityComponents } from '../api/generated/identity';

export type Grant = IdentityComponents['schemas']['MeGrant'];
export type Me = IdentityComponents['schemas']['MeResponse'];
export const me = () => api<Me>('identity', '/me');
export async function login(username: string, password: string): Promise<Me> {
  await csrf();
  await api('identity', '/auth/login', {
    method: 'POST',
    body: { username, password, client_kind: 'WEB' },
    retryAuth: false,
  });
  invalidateCsrf();
  return me();
}
export async function register(
  username: string,
  password: string,
  display_name: string,
  email: string
): Promise<{ verification: { challenge_id: string }; email_sent: boolean }> {
  return api('identity', '/auth/register', {
    method: 'POST',
    body: { username, password, display_name, email },
    idempotencyKey: newCommandKey(),
    retryAuth: false,
  });
}
export const verifyEmail = (challenge_id: string, code: string) =>
  api('identity', '/auth/email/verify', {
    method: 'POST',
    body: { challenge_id, code },
    retryAuth: false,
  });
export const resendEmailOtp = (challenge_id: string) =>
  api<{ challenge_id: string | null; email_sent: boolean }>('identity', '/auth/email/resend', {
    method: 'POST',
    body: { challenge_id },
    retryAuth: false,
  });
export async function googleLogin(id_token: string): Promise<Me> {
  await csrf();
  await api('identity', '/auth/google', {
    method: 'POST',
    body: { id_token, client_kind: 'WEB' },
    retryAuth: false,
  });
  invalidateCsrf();
  return me();
}
export async function logout(): Promise<void> {
  await api<void>('identity', '/auth/logout', { method: 'POST', retryAuth: false });
  invalidateCsrf();
}
export async function changePassword(current_password: string, new_password: string): Promise<Me> {
  await api<void>('identity', '/auth/change-password', {
    method: 'POST',
    body: { current_password, new_password },
    idempotencyKey: newCommandKey(),
  });
  return me();
}
export const roles = (user: Me | null) =>
  new Set(user?.grants.map((grant) => grant.role_code) || []);
