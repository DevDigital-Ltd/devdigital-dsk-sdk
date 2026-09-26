export interface DskVposErrorDetails {
  httpStatus?: number;
  endpoint?: string;
  cause?: unknown;
}

export class DskVposError extends Error {
  readonly errorCode: string;
  readonly httpStatus?: number;
  readonly endpoint?: string;

  constructor(errorCode: string, errorMessage: string, details: DskVposErrorDetails = {}) {
    super(errorMessage, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'DskVposError';
    this.errorCode = errorCode;
    this.httpStatus = details.httpStatus;
    this.endpoint = details.endpoint;
  }
}

export function parseGatewayResponse<T extends Record<string, unknown>>(
  body: T & { errorCode?: string; errorMessage?: string },
  endpoint?: string
): T {
  const errorCode = body.errorCode === undefined ? undefined : String(body.errorCode);
  if (errorCode !== undefined && errorCode !== '0') {
    throw new DskVposError(errorCode, body.errorMessage ?? 'Unknown DSK VPOS error', { endpoint });
  }
  return body;
}
