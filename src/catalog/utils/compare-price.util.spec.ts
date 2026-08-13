import { BadRequestException } from '@nestjs/common';
import { assertComparePrice } from './compare-price.util';

describe('assertComparePrice', () => {
  it('accepts a "was" price above the current price', () => {
    expect(() => assertComparePrice(24900, 29900)).not.toThrow();
  });

  it('accepts an absent "was" price', () => {
    expect(() => assertComparePrice(24900, null)).not.toThrow();
  });

  it('rejects a "was" price below the current price', () => {
    expect(() => assertComparePrice(24900, 19900)).toThrow(BadRequestException);
  });

  it('rejects a "was" price equal to the current price', () => {
    expect(() => assertComparePrice(24900, 24900)).toThrow(BadRequestException);
  });
});
