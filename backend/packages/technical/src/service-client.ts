import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { getCorrelationId } from './correlation';

export type UnavailableCode = 'IDENTITY_UNAVAILABLE' | 'RESPONSE_UNAVAILABLE' | 'LOGISTICS_UNAVAILABLE' | 'STORAGE_UNAVAILABLE';

export interface ServiceRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  singleFlightKey?: string;
}

export interface ServiceResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

interface CircuitOptions {
  timeoutMs?: number;
  maxSockets?: number;
  failureThreshold?: number;
  failureWindowMs?: number;
  openMs?: number;
  now?: () => number;
}

export class CircuitBreakerClient {
  private readonly baseUrl: URL;
  private readonly agent: HttpAgent | HttpsAgent;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly openMs: number;
  private readonly now: () => number;
  private readonly failures: number[] = [];
  private readonly inFlight = new Map<string, Promise<ServiceResponse>>();
  private openUntil = 0;

  constructor(baseUrl: string, private readonly unavailableCode: UnavailableCode, options: CircuitOptions = {}) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) throw new TypeError('Service URL must use HTTP or HTTPS');
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.failureWindowMs = options.failureWindowMs ?? 10_000;
    this.openMs = options.openMs ?? 5_000;
    this.now = options.now ?? Date.now;
    const agentOptions = { keepAlive: true, maxSockets: options.maxSockets ?? 50 };
    this.agent = this.baseUrl.protocol === 'https:' ? new HttpsAgent(agentOptions) : new HttpAgent(agentOptions);
  }

  get<T = unknown>(path: string, options: Omit<ServiceRequestOptions, 'method' | 'body'> = {}): Promise<ServiceResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T = unknown>(path: string, body: unknown, options: Omit<ServiceRequestOptions, 'method'> = {}): Promise<ServiceResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  request<T = unknown>(path: string, options: ServiceRequestOptions = {}): Promise<ServiceResponse<T>> {
    const method = (options.method ?? 'GET').toUpperCase();
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headerIdentity = Object.entries(options.headers ?? {})
      .map(([name, value]) => [name.toLowerCase(), value])
      .sort(([a], [b]) => a!.localeCompare(b!));
    const flightKey = options.singleFlightKey
      ? `${method}:${path}:${options.singleFlightKey}:${createHash('sha256').update(JSON.stringify([body ?? null, headerIdentity, getCorrelationId() ?? null])).digest('hex')}`
      : undefined;
    if (flightKey) {
      const existing = this.inFlight.get(flightKey);
      if (existing) return existing as Promise<ServiceResponse<T>>;
    }
    const operation = this.perform<T>(path, method, body, options.headers ?? {});
    if (!flightKey) return operation;
    this.inFlight.set(flightKey, operation as Promise<ServiceResponse>);
    void operation.finally(() => this.inFlight.delete(flightKey)).catch(() => undefined);
    return operation;
  }

  close(): void {
    this.agent.destroy();
  }

  private async perform<T>(path: string, method: string, body: string | undefined, headers: Record<string, string>): Promise<ServiceResponse<T>> {
    const retryAfter = Math.ceil(Math.max(0, this.openUntil - this.now()) / 1_000);
    if (this.openUntil > this.now()) throw this.unavailable(retryAfter);
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !path.startsWith('/') || path.startsWith('//')) {
      throw new TypeError('Service request path must be local to its configured base URL');
    }

    try {
      const result = await this.send(url, method, body, headers);
      if (result.status >= 500) {
        this.recordFailure();
        throw this.unavailable(this.openUntil > this.now() ? Math.ceil(this.openMs / 1_000) : 1);
      }
      this.failures.length = 0;
      this.openUntil = 0;
      return result as ServiceResponse<T>;
    } catch (error) {
      if (error instanceof AppError || error instanceof TypeError) throw error;
      this.recordFailure();
      throw this.unavailable(this.openUntil > this.now() ? Math.ceil(this.openMs / 1_000) : 1, error);
    }
  }

  private send(url: URL, method: string, body: string | undefined, headers: Record<string, string>): Promise<ServiceResponse> {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const correlationId = getCorrelationId();
    const requestHeaders: Record<string, string> = {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    };

    return new Promise((resolve, reject) => {
      const request = transport(url, { method, headers: requestHeaders, agent: this.agent }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = raw;
          if (raw && (response.headers['content-type']?.includes('application/json') || response.headers['content-type']?.includes('+json'))) {
            try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
          }
          resolve({ status: response.statusCode ?? 502, headers: response.headers, body: parsed });
        });
      });
      const timer = setTimeout(() => request.destroy(new Error('Service request timed out')), this.timeoutMs);
      timer.unref();
      request.on('close', () => clearTimeout(timer));
      request.on('error', reject);
      request.end(body);
    });
  }

  private recordFailure(): void {
    const now = this.now();
    while (this.failures.length && this.failures[0]! <= now - this.failureWindowMs) this.failures.shift();
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.openUntil = now + this.openMs;
      this.failures.length = 0;
    }
  }

  private unavailable(retryAfterSeconds: number, cause?: unknown): AppError {
    return new AppError(this.unavailableCode, { status: 503, retryAfterSeconds, ...(cause === undefined ? {} : { cause }) });
  }
}
