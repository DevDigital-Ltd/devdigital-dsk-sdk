import { describe, expect, it } from 'vitest';
import { DskVposError, parseGatewayResponse } from '../src/errors.js';

describe('parseGatewayResponse', () => {
  it('returns the body when errorCode is absent', () => {
    const body = {
      orderId: '385aca7f-a29c-70ec-b71a-2d422efa1c13',
      formUrl:
        'https://uat.dskbank.bg/payment/merchants/multiecom/payment.html?mdOrder=385aca7f-a29c-70ec-b71a-2d422efa1c13'
    };
    expect(parseGatewayResponse(body)).toBe(body);
  });

  it('returns the body when errorCode is "0"', () => {
    const body = { errorCode: '0', errorMessage: 'Success', orderStatus: 0 };
    expect(parseGatewayResponse(body)).toBe(body);
  });

  it('throws DskVposError with the code and message on a business error', () => {
    const body = {
      errorCode: '1',
      errorMessage: 'Order number is duplicated, order with given order number is processed already'
    };
    try {
      parseGatewayResponse(body);
      throw new Error('expected parseGatewayResponse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DskVposError);
      expect((error as DskVposError).errorCode).toBe('1');
      expect((error as DskVposError).message).toBe(
        'Order number is duplicated, order with given order number is processed already'
      );
    }
  });

  it('throws DskVposError for an auth failure', () => {
    expect(() => parseGatewayResponse({ errorCode: '5', errorMessage: 'Access denied' })).toThrow('Access denied');
  });

  it('returns the body when errorCode is the numeric 0', () => {
    const body = { errorCode: 0, errorMessage: 'Success', orderStatus: 0 };
    expect(parseGatewayResponse(body)).toBe(body);
  });

  it('throws DskVposError with a string errorCode when errorCode is a numeric non-zero value', () => {
    const body = { errorCode: 7, errorMessage: 'Deposit is impossible for current transaction state' };
    try {
      parseGatewayResponse(body);
      throw new Error('expected parseGatewayResponse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DskVposError);
      expect((error as DskVposError).errorCode).toBe('7');
      expect((error as DskVposError).message).toBe('Deposit is impossible for current transaction state');
    }
  });
});
