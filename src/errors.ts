export class DskVposError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, errorMessage: string) {
    super(errorMessage);
    this.name = 'DskVposError';
    this.errorCode = errorCode;
  }
}

export function parseGatewayResponse<T extends Record<string, unknown>>(
  body: T & { errorCode?: string; errorMessage?: string }
): T {
  if (body.errorCode !== undefined && body.errorCode !== '0') {
    throw new DskVposError(body.errorCode, body.errorMessage ?? 'Unknown DSK VPOS error');
  }
  return body;
}
