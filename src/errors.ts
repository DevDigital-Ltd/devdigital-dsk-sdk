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
  const errorCode = body.errorCode === undefined ? undefined : String(body.errorCode);
  if (errorCode !== undefined && errorCode !== '0') {
    throw new DskVposError(errorCode, body.errorMessage ?? 'Unknown DSK VPOS error');
  }
  return body;
}
