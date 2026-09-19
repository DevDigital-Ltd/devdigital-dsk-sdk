import { DskVposError, parseGatewayResponse } from './errors.js';
import type { DskVposEnvironment, RegisterOrderParams, RegisterOrderResult, OrderStatusResult, DskOrderStatus } from './types.js';

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
}

export class DskVposClient {
  private readonly apiLogin: string;
  private readonly apiPassword: string;
  private readonly baseUrl: string;

  constructor(options: DskVposClientOptions) {
    this.apiLogin = options.apiLogin;
    this.apiPassword = options.apiPassword;
    this.baseUrl = BASE_URLS[options.environment];
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

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!response.ok) {
      throw new DskVposError(String(response.status), `DSK VPOS gateway returned HTTP ${response.status}`);
    }

    const json = (await response.json()) as T & { errorCode?: string; errorMessage?: string };
    return parseGatewayResponse(json);
  }

  async registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult> {
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
}
