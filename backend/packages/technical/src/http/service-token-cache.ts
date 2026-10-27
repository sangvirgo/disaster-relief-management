import { AppError } from '../errors/errors';
import type { ServiceName } from '../security/service-token';
import { CircuitBreakerClient } from './service-client';

/** Per-client transport cache; user/session introspection is deliberately never cached. */
export class ServiceTokenCache {
  private readonly tokens = new Map<ServiceName, { value: string; refreshAt: number }>();
  private readonly requests = new Map<ServiceName, Promise<string>>();

  constructor(
    private readonly client: CircuitBreakerClient,
    private readonly credentials: { clientId: string; clientSecret: string },
  ) {}

  get(audience: ServiceName = 'identity'): Promise<string> {
    const cached = this.tokens.get(audience);
    if (cached && cached.refreshAt > Date.now()) return Promise.resolve(cached.value);
    const pending = this.requests.get(audience);
    if (pending) return pending;
    const unavailable = () => new AppError('IDENTITY_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
    const operation = this.client.post<unknown>('/api/v1/identity/internal/token', {
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      audience,
    }).then((result) => {
      if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
      const value = result.body as { access_token?: unknown; expires_in?: unknown };
      if (typeof value.access_token !== 'string' || !Number.isInteger(value.expires_in) || Number(value.expires_in) < 1) throw unavailable();
      this.tokens.set(audience, { value: value.access_token, refreshAt: Date.now() + Math.max(1, Number(value.expires_in) - 30) * 1_000 });
      return value.access_token;
    }).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }).finally(() => { this.requests.delete(audience); });
    this.requests.set(audience, operation);
    return operation;
  }
}
