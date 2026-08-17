import { BadRequestException } from '@nestjs/common';
import { PurchaseRequestStatus } from '../enums/purchase-request-status.enum';
import { assertRequestTransition } from './request-transition.util';

describe('assertRequestTransition', () => {
  it.each([
    [PurchaseRequestStatus.Draft, PurchaseRequestStatus.Sent],
    [PurchaseRequestStatus.Draft, PurchaseRequestStatus.Cancelled],
    [PurchaseRequestStatus.Sent, PurchaseRequestStatus.Replied],
    [PurchaseRequestStatus.Sent, PurchaseRequestStatus.Cancelled],
    [PurchaseRequestStatus.Replied, PurchaseRequestStatus.Confirmed],
    [PurchaseRequestStatus.Replied, PurchaseRequestStatus.Cancelled],
  ])('allows %s → %s', (from, to) => {
    expect(() => assertRequestTransition({ from, to })).not.toThrow();
  });

  it('rejects a jump from draft straight to confirmed', () => {
    expect(() =>
      assertRequestTransition({
        from: PurchaseRequestStatus.Draft,
        to: PurchaseRequestStatus.Confirmed,
      }),
    ).toThrow(BadRequestException);
  });

  it('names both states so the dashboard can show the message', () => {
    expect(() =>
      assertRequestTransition({
        from: PurchaseRequestStatus.Draft,
        to: PurchaseRequestStatus.Confirmed,
      }),
    ).toThrow(/from draft to confirmed/);
  });

  it('treats confirmed as final', () => {
    expect(() =>
      assertRequestTransition({
        from: PurchaseRequestStatus.Confirmed,
        to: PurchaseRequestStatus.Cancelled,
      }),
    ).toThrow(/confirmed is final/);
  });

  it('treats cancelled as final', () => {
    expect(() =>
      assertRequestTransition({
        from: PurchaseRequestStatus.Cancelled,
        to: PurchaseRequestStatus.Sent,
      }),
    ).toThrow(/cancelled is final/);
  });

  it('rejects a no-op transition', () => {
    expect(() =>
      assertRequestTransition({
        from: PurchaseRequestStatus.Sent,
        to: PurchaseRequestStatus.Sent,
      }),
    ).toThrow(/already sent/);
  });
});
