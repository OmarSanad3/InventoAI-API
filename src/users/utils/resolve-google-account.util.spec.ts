import {
  GoogleAccountAction,
  resolveGoogleAccount,
} from './resolve-google-account.util';

interface FakeUser {
  readonly id: string;
}

const mockByGoogleId: FakeUser = { id: 'user-by-google-id' };
const mockByEmail: FakeUser = { id: 'user-by-email' };

describe('resolveGoogleAccount', () => {
  it('logs in when the identity is already on a row', () => {
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: mockByGoogleId,
      existingByEmail: null,
      isGoogleEmailVerified: true,
    });

    expect(actual).toEqual({
      action: GoogleAccountAction.Login,
      user: mockByGoogleId,
    });
  });

  it('logs in on a googleId hit even when another row holds that address', () => {
    // The address moved — a renamed Workspace mailbox. `sub` did not, so this is
    // the same person and the row found by email is somebody else's.
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: mockByGoogleId,
      existingByEmail: mockByEmail,
      isGoogleEmailVerified: true,
    });

    expect(actual).toEqual({
      action: GoogleAccountAction.Login,
      user: mockByGoogleId,
    });
  });

  it('logs in on a googleId hit even when Google no longer vouches for the address', () => {
    // The identity was proven when it was linked; the claim is only needed to
    // decide whether to trust an address for the *first* time.
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: mockByGoogleId,
      existingByEmail: null,
      isGoogleEmailVerified: false,
    });

    expect(actual).toEqual({
      action: GoogleAccountAction.Login,
      user: mockByGoogleId,
    });
  });

  it('links a verified address onto the local row that owns it', () => {
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: null,
      existingByEmail: mockByEmail,
      isGoogleEmailVerified: true,
    });

    expect(actual).toEqual({
      action: GoogleAccountAction.Link,
      user: mockByEmail,
    });
  });

  it('refuses to link an unverified address', () => {
    // Free account takeover otherwise, for anyone who can make a Google account
    // claiming an address.
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: null,
      existingByEmail: mockByEmail,
      isGoogleEmailVerified: false,
    });

    expect(actual).toEqual({ action: GoogleAccountAction.Refuse });
  });

  it('creates when nothing matches and the address is verified', () => {
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: null,
      existingByEmail: null,
      isGoogleEmailVerified: true,
    });

    expect(actual).toEqual({ action: GoogleAccountAction.Create });
  });

  it('refuses to create on an unverified address', () => {
    const actual = resolveGoogleAccount<FakeUser>({
      existingByGoogleId: null,
      existingByEmail: null,
      isGoogleEmailVerified: false,
    });

    expect(actual).toEqual({ action: GoogleAccountAction.Refuse });
  });

  it('never reports link or create without a verified address', () => {
    const decidingInputs = [
      { existingByGoogleId: null, existingByEmail: mockByEmail },
      { existingByGoogleId: null, existingByEmail: null },
    ];

    for (const input of decidingInputs) {
      const actual = resolveGoogleAccount<FakeUser>({
        ...input,
        isGoogleEmailVerified: false,
      });
      expect(actual.action).toBe(GoogleAccountAction.Refuse);
    }
  });
});
