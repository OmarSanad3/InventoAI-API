import {
  appendSignOff,
  buildFallbackRequestEmail,
  describeItem,
  type RequestEmailFacts,
} from './fallback-request-email.util';

function buildFacts(
  overrides: Partial<RequestEmailFacts> = {},
): RequestEmailFacts {
  return {
    storeName: 'Layali',
    productTitle: 'Linen Summer Abaya',
    variantLabel: 'Size: M, Colour: Navy',
    quantity: 18,
    neededWithinDays: 10,
    note: null,
    ...overrides,
  };
}

describe('buildFallbackRequestEmail', () => {
  it('names the store and the item in the subject', () => {
    const actual = buildFallbackRequestEmail(buildFacts());

    expect(actual.subject).toBe(
      'Purchase request from Layali — Linen Summer Abaya (Size: M, Colour: Navy)',
    );
  });

  it('asks the three questions the extraction later looks for', () => {
    const actual = buildFallbackRequestEmail(buildFacts());

    expect(actual.body).toContain('unit price');
    expect(actual.body).toContain('available');
    expect(actual.body).toContain('delivery');
  });

  it('carries the quantity and signs off as the store', () => {
    const actual = buildFallbackRequestEmail(buildFacts());

    expect(actual.body).toContain('18 units');
    expect(actual.body.trimEnd().endsWith('Layali')).toBe(true);
  });

  it('greets nobody — one body goes to every recipient', () => {
    const actual = buildFallbackRequestEmail(buildFacts());

    expect(actual.body).not.toContain('Dear');
  });

  it('states the deadline when there is one', () => {
    const actual = buildFallbackRequestEmail(buildFacts());

    expect(actual.body).toContain('within 10 days');
  });

  it('says nothing about a deadline when none was set', () => {
    const actual = buildFallbackRequestEmail(
      buildFacts({ neededWithinDays: null }),
    );

    expect(actual.body).not.toContain('within');
  });

  it("appends the owner's own note", () => {
    const actual = buildFallbackRequestEmail(
      buildFacts({ note: '  Please quote for a repeat monthly order.  ' }),
    );

    expect(actual.body).toContain('Please quote for a repeat monthly order.');
  });
});

describe('appendSignOff', () => {
  it('puts the sign-off on its own lines', () => {
    const actual = appendSignOff('We need 20 units.', 'Layali');

    expect(actual).toBe('We need 20 units.\n\nThank you,\nLayali');
  });

  it('unwelds a store name the model stuck onto the last sentence', () => {
    const actual = appendSignOff(
      'Please confirm within 10 days. Layali',
      'Layali',
    );

    expect(actual).toBe('Please confirm within 10 days.\n\nThank you,\nLayali');
  });

  it('strips a closing the model wrote anyway rather than doubling it', () => {
    const actual = appendSignOff(
      'Please confirm.\n\nBest regards,\nLayali',
      'Layali',
    );

    expect(actual).toBe('Please confirm.\n\nThank you,\nLayali');
  });

  it('matches the store name whatever case it was written in', () => {
    expect(appendSignOff('Please confirm. LAYALI', 'Layali')).toBe(
      'Please confirm.\n\nThank you,\nLayali',
    );
  });

  it('leaves a body that ends in an ordinary sentence alone', () => {
    expect(
      appendSignOff('We would like 20 units of the abaya.', 'Layali'),
    ).toBe('We would like 20 units of the abaya.\n\nThank you,\nLayali');
  });
});

describe('describeItem', () => {
  it('adds the variant in brackets', () => {
    expect(describeItem('Linen Summer Abaya', 'Size: M')).toBe(
      'Linen Summer Abaya (Size: M)',
    );
  });

  it('leaves a product sold one way alone', () => {
    expect(describeItem('Handmade Fokhar Mug', null)).toBe(
      'Handmade Fokhar Mug',
    );
  });
});
