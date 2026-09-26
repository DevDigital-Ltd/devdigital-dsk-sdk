import { DskVposError, parseGatewayResponse } from './errors.js';
import type {
  DskVposEnvironment,
  RegisterOrderParams,
  RegisterOrderResult,
  OrderStatusResult,
  DskOrderStatus,
  GatewayAckResult,
  WaitForFinalStatusOptions
} from './types.js';
import { assertCurrency, assertHttpUrl, assertNonEmptyString, assertNonNegativeInteger } from './validation.js';
import { VERSION } from './version.js';

const BASE_URLS: Record<DskVposEnvironment, string> = {
  uat: 'https://uat.dskbank.bg/payment/rest/',
  production: 'https://epg.dskbank.bg/payment/rest/'
};

function toOrderStatus(orderStatus: number): DskOrderStatus {
  if (orderStatus === 0) return 'created';
  if (orderStatus === 1) return 'preAuthorized';
  if (orderStatus === 2) return 'charged';
  if (orderStatus === 4) return 'refunded';
  return 'other';
}

export interface DskVposLogEvent {
  endpoint: string;
  attempt: number;
  durationMs: number;
  outcome: 'ok' | 'error';
  errorCode?: string;
  httpStatus?: number;
}

export interface DskVposClientOptions {
  apiLogin: string;
  apiPassword: string;
  environment: DskVposEnvironment;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Retries for idempotent reads (order status) on network errors, timeouts, HTTP 429/5xx. Default 2. */
  maxNetworkRetries?: number;
  /** Base delay for exponential backoff between retries, in milliseconds. Default 250. */
  retryBaseDelayMs?: number;
  /** Custom fetch implementation (proxies, instrumentation, tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Structured request log hook. Never receives credentials or request parameters. */
  logger?: (event: DskVposLogEvent) => void;
  /** Identifies your application in the User-Agent header. */
  appInfo?: { name: string; version?: string };
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_NETWORK_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 2000;

function isRetryable(error: unknown): boolean {
  if (!(error instanceof DskVposError)) return false;
  if (error.errorCode === 'network' || error.errorCode === 'timeout') return true;
  return error.httpStatus === 429 || (error.httpStatus !== undefined && error.httpStatus >= 500);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DskVposClient {
  readonly #apiLogin: string;
  readonly #apiPassword: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxNetworkRetries: number;
  readonly #retryBaseDelayMs: number;
  readonly #fetch?: typeof fetch;
  readonly #logger?: (event: DskVposLogEvent) => void;
  readonly #userAgent: string;

  constructor(options: DskVposClientOptions) {
    assertNonEmptyString(options.apiLogin, 'apiLogin');
    assertNonEmptyString(options.apiPassword, 'apiPassword');
    if (!Object.hasOwn(BASE_URLS, options.environment)) {
      throw new TypeError(`environment must be 'uat' or 'production', got: ${String(options.environment)}`);
    }
    this.#apiLogin = options.apiLogin;
    this.#apiPassword = options.apiPassword;
    this.#baseUrl = BASE_URLS[options.environment];
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxNetworkRetries = options.maxNetworkRetries ?? DEFAULT_MAX_NETWORK_RETRIES;
    this.#retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.#fetch = options.fetch;
    this.#logger = options.logger;
    const app = options.appInfo
      ? ` ${options.appInfo.name}${options.appInfo.version ? `/${options.appInfo.version}` : ''}`
      : '';
    this.#userAgent = `devdigital-dsk-sdk/${VERSION}${app}`;
  }

  private async callOnce<T extends Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | undefined>
  ): Promise<T> {
    const body = new URLSearchParams();
    body.set('userName', this.#apiLogin);
    body.set('password', this.#apiPassword);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) body.set(key, String(value));
    }

    let response: Response;
    try {
      response = await (this.#fetch ?? globalThis.fetch)(`${this.#baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.#userAgent },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'DSK VPOS gateway request failed';
      throw new DskVposError(isTimeout(error) ? 'timeout' : 'network', message, { endpoint, cause: error });
    }

    if (!response.ok) {
      throw new DskVposError(`http_${response.status}`, `DSK VPOS gateway returned HTTP ${response.status}`, {
        endpoint,
        httpStatus: response.status
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new DskVposError('invalid_response', 'DSK VPOS gateway returned a response that was not valid JSON', {
        endpoint,
        httpStatus: response.status,
        cause: error
      });
    }

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new DskVposError('invalid_response', 'DSK VPOS gateway returned an unexpected response shape', {
        endpoint,
        httpStatus: response.status
      });
    }

    return parseGatewayResponse(json as T & { errorCode?: string; errorMessage?: string }, endpoint);
  }

  /**
   * Retries only when `retry` is true (idempotent reads). Money-moving calls are never
   * retried automatically: a timeout leaves the outcome unknown, so reconcile with getOrderStatus.
   */
  private async call<T extends Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | undefined>,
    retry = false
  ): Promise<T> {
    const maxAttempts = retry ? this.#maxNetworkRetries + 1 : 1;
    for (let attempt = 1; ; attempt++) {
      const startedAt = Date.now();
      try {
        const result = await this.callOnce<T>(endpoint, params);
        this.#logger?.({ endpoint, attempt, durationMs: Date.now() - startedAt, outcome: 'ok' });
        return result;
      } catch (error) {
        const dskError = error instanceof DskVposError ? error : undefined;
        this.#logger?.({
          endpoint,
          attempt,
          durationMs: Date.now() - startedAt,
          outcome: 'error',
          errorCode: dskError?.errorCode,
          httpStatus: dskError?.httpStatus
        });
        if (attempt >= maxAttempts || !isRetryable(error)) throw error;
        const backoff = Math.min(this.#retryBaseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
        await sleep(backoff === 0 ? 0 : backoff / 2 + Math.random() * (backoff / 2));
      }
    }
  }

  async registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult> {
    assertNonEmptyString(params.orderNumber, 'orderNumber');
    assertNonNegativeInteger(params.amountCents, 'amountCents');
    assertCurrency(params.currency);
    assertHttpUrl(params.returnUrl, 'returnUrl');
    if (params.failUrl !== undefined) assertHttpUrl(params.failUrl, 'failUrl');
    return this.call<RegisterOrderResult>('register.do', {
      orderNumber: params.orderNumber,
      amount: params.amountCents,
      currency: params.currency,
      returnUrl: params.returnUrl,
      failUrl: params.failUrl,
      description: params.description
    });
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    assertNonEmptyString(orderId, 'orderId');
    const raw = await this.call<Omit<OrderStatusResult, 'status'>>('getOrderStatusExtended.do', { orderId }, true);
    return { ...raw, status: toOrderStatus(raw.orderStatus) };
  }

  /**
   * Polls getOrderStatus until the order leaves 'created' or timeoutMs elapses.
   * On timeout it resolves with the last status ('created'); it does not throw.
   */
  async waitForFinalStatus(orderId: string, options: WaitForFinalStatusOptions = {}): Promise<OrderStatusResult> {
    const { timeoutMs = 120000, intervalMs = 3000 } = options;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await this.getOrderStatus(orderId);
      if (result.status !== 'created' || Date.now() + intervalMs > deadline) return result;
      await sleep(intervalMs);
    }
  }

  async capture(orderId: string, amountCents: number): Promise<GatewayAckResult> {
    assertNonEmptyString(orderId, 'orderId');
    assertNonNegativeInteger(amountCents, 'amountCents');
    return this.call<GatewayAckResult>('deposit.do', { orderId, amount: amountCents });
  }

  async refund(orderId: string, amountCents: number): Promise<GatewayAckResult> {
    assertNonEmptyString(orderId, 'orderId');
    assertNonNegativeInteger(amountCents, 'amountCents');
    return this.call<GatewayAckResult>('refund.do', { orderId, amount: amountCents });
  }

  async reverse(orderId: string): Promise<GatewayAckResult> {
    assertNonEmptyString(orderId, 'orderId');
    return this.call<GatewayAckResult>('reverse.do', { orderId });
  }
}
