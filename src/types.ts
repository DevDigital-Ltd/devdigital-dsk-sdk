export type DskVposEnvironment = 'uat' | 'production';

export interface RegisterOrderParams {
  orderNumber: string;
  amountCents: number;
  currency: string;
  returnUrl: string;
  failUrl?: string;
  description?: string;
}

export type RegisterOrderResult = {
  orderId: string;
  formUrl: string;
};

export type DskOrderStatus = 'created' | 'preAuthorized' | 'charged' | 'refunded' | 'other';

export interface PaymentAmountInfo {
  paymentState: string;
  approvedAmount: number;
  depositedAmount: number;
  refundedAmount: number;
  feeAmount: number;
  totalAmount: number;
}

export type OrderStatusResult = {
  orderNumber: string;
  orderStatus: number;
  status: DskOrderStatus;
  actionCode: number;
  actionCodeDescription: string;
  amount: number;
  currency: string;
  date: number;
  orderDescription: string;
  paymentAmountInfo: PaymentAmountInfo;
};

export type GatewayAckResult = {
  errorCode: string;
  errorMessage: string;
};

export interface WaitForFinalStatusOptions {
  /** Give up polling after this long and return the last status. Default 120000. */
  timeoutMs?: number;
  /** Delay between polls. Default 3000. */
  intervalMs?: number;
}
