import { DskVposError, parseGatewayResponse } from './errors.js';
import type { DskVposEnvironment, RegisterOrderParams, RegisterOrderResult, OrderStatusResult, DskOrderStatus, GatewayAckResult } from './types.js';

const BASE_URLS: Record<DskVposEnvironment, string> = {
  uat: 'https://uat.dskbank.bg/payment/rest/',
  production: 'https://epg.dskbank.bg/payment/rest/'
};

function toOrderStatus(orderStatus: number): DskOrderStatus {
  if (orderStatus === 0) return 'created';
  if (orderStatus === 1) return 'preAuthorized';
  if (orderStatus === 2) return 'charged';
  return 'other';
}

export interface DskVposClientOptions {
  apiLogin: string;
  apiPassword: string;
  environment: DskVposEnvironment;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

export class DskVposClient {
  private readonly apiLogin: string;
  private readonly apiPassword: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: DskVposClientOptions) {
    this.apiLogin = options.apiLogin;
    this.apiPassword = options.apiPassword;
    this.baseUrl = BASE_URLS[options.environment];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private assertNonNegativeInteger(value: number, paramName: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`${paramName} must be a non-negative integer, got: ${value}`);
    }
  }

  private async call<T extends Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | undefined>
  ): Promise<T> {
    const body = new URLSearchParams();
    body.set('userName', this.apiLogin);
    body.set('password', this.apiPassword);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) body.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new DskVposError('network', error instanceof Error && error.message ? error.message : 'DSK VPOS gateway request failed');
    }

    if (!response.ok) {
      throw new DskVposError(`http_${response.status}`, `DSK VPOS gateway returned HTTP ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new DskVposError('invalid_response', 'DSK VPOS gateway returned a response that was not valid JSON');
    }

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new DskVposError('invalid_response', 'DSK VPOS gateway returned an unexpected response shape');
    }

    return parseGatewayResponse(json as T & { errorCode?: string; errorMessage?: string });
  }

  async registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult> {
    this.assertNonNegativeInteger(params.amountCents, 'amountCents');
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
    const raw = await this.call<Omit<OrderStatusResult, 'status'>>('getOrderStatusExtended.do', { orderId });
    return { ...raw, status: toOrderStatus(raw.orderStatus) };
  }

  async capture(orderId: string, amountCents: number): Promise<GatewayAckResult> {
    this.assertNonNegativeInteger(amountCents, 'amountCents');
    return this.call<GatewayAckResult>('deposit.do', { orderId, amount: amountCents });
  }

  async refund(orderId: string, amountCents: number): Promise<GatewayAckResult> {
    this.assertNonNegativeInteger(amountCents, 'amountCents');
    return this.call<GatewayAckResult>('refund.do', { orderId, amount: amountCents });
  }

  async reverse(orderId: string): Promise<GatewayAckResult> {
    return this.call<GatewayAckResult>('reverse.do', { orderId });
  }
}
