# Google Sign-In — one-tap login and signup

> Feature 7 of the [project overview](../project-overview.md), the half still
> marked *planned*: "Email + password — implemented. Google OAuth — planned."
> Also the open `## OAuth` line in [TODO.md](../../TODO.md).
>
> **This is identity only.** It is not the Gmail integration the supplier
> feature wants. The two share a Google Cloud project and a client id, and
> nothing else — see [Not this feature](#not-this-feature) before writing a line
> of it.

## Overview

Today every account starts with a password and an OTP: register → receive a
code → verify → log in. That is three screens and an email round trip before a
shopper has bought anything, and `createUser` deletes the row and 503s if the
mail fails, so a flaky SMTP is a failed signup.

Google Sign-In collapses all of it into one button. The user taps, Google hands
the frontend a signed **ID token**, we verify it, and either find the account or
create it — already verified, no password, no OTP, no mail. The reply is
byte-for-byte the existing `LoginResponseDto`, so every screen after the button
is unchanged.

It applies to both halves of the platform, and the split the routes already make
is the split it keeps: a **store shopper** signs in against a slug, a **platform
owner** signs in against nothing.

## Goals

- A shopper can sign up and log in to a store with one tap, and lands verified.
- An owner can do the same for the platform account that owns their store.
- An existing password account signs in with Google **without creating a second
  row**, when Google says the address is verified.
- The response is the same `{ accessToken, refreshToken, user }` the password
  routes return — the frontend keeps one session code path.
- Nothing about the password flow changes for the people already using it.

## Non-goals

- **Any Google scope beyond identity.** `openid email profile`, nothing else.
- **Gmail, Calendar, Drive, offline access, refresh tokens from Google.** We
  never store a Google token of any kind. See below.
- **Other providers.** Facebook and Apple are the same shape and can copy this;
  no abstraction is built for them until the second one exists.
- **Account merging across stores.** A person shopping at three stores has three
  `User` rows today, exactly as with passwords. That is the tenancy model, not a
  bug.
- **A backend-rendered redirect flow** (`GET /auth/google` → 302 → callback).
  The frontend is a separate SPA; it can talk to Google itself. See decision 1.

## Not this feature

The supplier branch wants to read the owner's Gmail
([suppliers-purchasing.md](./suppliers-purchasing.md), decision 1). It is a
different animal and mixing them is the one way to get this wrong:

| | Sign-In (this spec) | Gmail ingestion (later) |
| --- | --- | --- |
| Scope | `openid email profile` — **basic** | `gmail.readonly` — **restricted** |
| Google review | none | verification + annual security assessment |
| Flow | ID token, verified once | authorization code + `access_type=offline` |
| What we store | **nothing from Google** | a refresh token, encrypted, forever |
| Belongs to | the **user** — identity | the **store** — a capability |
| Lives in | `AuthModule` / `UsersModule` | its own module beside `src/suppliers` |

A user may sign in with Google and never grant Gmail access, or grant it and
later revoke it while staying signed in. **One row cannot hold both facts**, so
`User.googleId` is not a credential and no Gmail token ever lands on `User`.

Doing this feature first is still right: it stands up the Cloud project, the
consent screen and the client id, and it turns the Gmail ask into an
*incremental* consent on an account the owner has already connected rather than
a cold "give this app your inbox".

## Decisions

### 1. The frontend talks to Google; we verify an ID token

Two shapes exist:

```
  (a) redirect flow, backend-driven          (b) ID token, frontend-driven
  ─────────────────────────────────          ────────────────────────────
  GET /auth/google → 302 to Google           GIS button renders in the SPA
  user consents                              user consents
  Google → GET /auth/google/callback?code    Google → SPA receives credential
  backend exchanges code (client secret)     SPA POSTs { idToken } to us
  backend redirects to the SPA with…what?    we verify and reply with our JWTs
  (a fragment? a cookie? a one-time code?)
```

(b) wins for this codebase, for three reasons that are all about what already
exists:

- **We are a JSON API with no session cookies and no server-rendered pages.**
  (a) ends with the problem of getting a token from a redirect into an SPA,
  which is a whole design (one-time codes, fragments, or cookies we do not use).
- **No client secret on the API for login.** Verifying an ID token needs only
  the public JWKS and the client id. The secret arrives later, with Gmail, and
  belongs to that feature.
- **`CORS_ORIGINS` already exists and nothing else does.** (a) would need a
  redirect-URI allowlist per environment on top.

The trade: the frontend integrates Google Identity Services. That is a script
tag and a callback.

### 2. Verification is not optional, and it is not a decode

`jwt.decode()` on an ID token is a security hole with a friendly name — anyone
can mint that JSON. The token must be **verified** with `google-auth-library`:

```ts
const ticket = await this.client.verifyIdToken({
  idToken,
  audience: this.configService.get('GOOGLE_CLIENT_ID', { infer: true }),
});
const payload = ticket.getPayload();
```

That checks the RS256 signature against Google's rotating JWKS, `iss`
(`accounts.google.com`), `exp`, and — the one people forget — **`aud`, that the
token was minted for *our* client id**. Without the audience check, a token
issued for any other Google app is accepted here, which is account takeover with
extra steps.

`google-auth-library` is the one new dependency. It caches the JWKS itself.

### 3. `sub` is the identity; `email` is only a hint

Google's `sub` is the stable, immutable user id. An email address is **not**: a
Workspace user can change theirs, and a released consumer address can in
principle be re-registered. So:

- `User.googleId` stores `sub`, and that is what a returning user is found by.
- `email` is stored for display and for the *first* link, never used to find a
  returning Google user.
- `email_verified: false` in the payload → **refuse to link or create**. That
  claim is the entire basis for trusting the address.

### 4. Linking rules — the security core of this feature

Three cases, and the middle one is where the bugs live:

```
  ┌─ googleId matches a row in this scope? ──▶ YES ──▶ log them in. Done.
  │
  ├─ no googleId, but email matches a row? ──▶ LINK, but only if:
  │        • Google says email_verified: true
  │        → set googleId, set isEmailVerified = true, issue tokens
  │        (the password, if any, keeps working — this is a link, not a swap)
  │
  └─ neither ──▶ create: googleId, email, names and picture from the payload,
                 password NULL, isEmailVerified = true, role by route
```

Why linking on a verified email is safe here: Google asserted control of that
mailbox, and control of the mailbox is already enough to take the account over
through `forgot-password`. Linking grants nothing new. **Linking on an
unverified email would**, which is why case 2 is gated.

An unverified *local* account (registered, never entered the OTP) that signs in
with Google is linked and flipped to verified — Google verified the same address
the OTP was going to.

### 5. Scope follows the routes that already exist

Every auth route in this project is paired — `/users/login` takes a `storeSlug`,
`/users/login/owner` does not — and this adds one more pair, no new pattern:

```
  POST /users/google         { idToken, storeSlug }   → shopper, role USER
  POST /users/google/owner   { idToken }              → platform, role OWNER
```

Uniqueness mirrors the email indexes exactly, for the same reason: one person is
one platform account **and** one account per store they shop at.

```ts
@Index('UQ_users_google_platform', ['googleId'], {
  unique: true,
  where: '"googleId" IS NOT NULL AND "storeId" IS NULL',
})
@Index('UQ_users_google_store', ['googleId', 'storeId'], {
  unique: true,
  where: '"googleId" IS NOT NULL AND "storeId" IS NOT NULL',
})
```

An `ADMIN` is created by an owner, never self-signup, so there is no
`/users/google/admin`. An admin whose row already exists may link Google by
signing in through the store route — the role on an existing row is never
changed by a login.

### 6. `User.password` becomes nullable, and everything that reads it must cope

This is the only change to merged code, and it is the one that will bite:

```ts
@Column({ type: 'varchar', select: false, nullable: true })
password!: string | null;
```

Three call sites already load it and must be checked:

| Path | Today | With a Google-only account |
| --- | --- | --- |
| `login` / store login | `bcrypt.compare(dto.password, user.password)` | password is `null` → **401 with the ordinary bad-credentials message**, never a 500 and never a hint that the account exists |
| `changePassword` | compares the current password | **400: "This account signs in with Google. Set a password first."** |
| `resetPassword` (OTP) | writes a new hash | **allowed** — it is a legitimate way to add a password to a Google account, and the OTP proves the mailbox |

`forgotPassword` keeps returning its generic message either way; anti-enumeration
does not get an exception for this.

## Data model

### `User` (existing) — three new columns

| Column | Type | Notes |
| --- | --- | --- |
| `googleId` | `varchar(255)`, nullable | Google's `sub`. Unique per scope, see decision 5 |
| `authProvider` | `enum(local, google)`, default `local` | What **created** the row. Display and analytics only — never a permission check |
| `password` | now nullable | Decision 6 |

`authProvider` is deliberately not the source of truth for "can this account use
a password": a linked account is `local` **and** has a `googleId`, and a Google
account that later set a password through the OTP flow is `google` **and** has a
hash. The columns answer that question between them; the enum only records where
the row came from.

No new entity. A `UserIdentity` table (one row per provider per user) is the
textbook shape and is the right refactor **when the second provider lands** —
recorded under [Considered and rejected](#considered-and-rejected).

## Endpoints — `src/users/users.controller.ts`

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/users/google` | `GoogleStoreLoginDto` | `LoginResponseDto` (200) |
| `POST` | `/users/google/owner` | `GoogleLoginDto` | `LoginResponseDto` (200) |

200, not 201, on both: the caller cannot know in advance whether this is a
signup or a login, and neither can the status code sensibly.

Errors:

| Case | Status |
| --- | --- |
| Malformed / expired / wrong-audience token | **401** `Google sign-in failed` |
| `email_verified: false` | **403** `Your Google account's email is not verified` |
| Unknown or draft `storeSlug` | **404** (as `resolvePublicStore` already does) |
| Google unreachable (JWKS fetch fails) | **503**, worded like `AI_UNAVAILABLE_MESSAGE` |

## DTOs — `src/users/dto/`

| File | Shape |
| --- | --- |
| `google-login.dto.ts` | `idToken` (`@IsString() @IsNotEmpty() @MaxLength(4096)`) |
| `google-store-login.dto.ts` | extends it with `storeSlug` (`@IsSlug()`) — the same extension `StoreLoginDto` makes of `LoginDto` |

No new response DTO. `LoginResponseDto` is the point.

## Module wiring

`AuthModule` gains the verifier and exports it; `UsersModule` already imports
`AuthModule` for `TokenService`, so nothing else moves:

```ts
// src/auth/google-token.verifier.ts
@Injectable()
export class GoogleTokenVerifier {
  /** Verified claims, or throws. Never returns an unverified payload. */
  async verify(idToken: string): Promise<GoogleIdentity>;
}

export interface GoogleIdentity {
  readonly googleId: string;   // sub
  readonly email: string;
  readonly emailVerified: boolean;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly picture: string | null;
}
```

Why in `AuthModule` and not `UsersModule`: it is the same kind of thing
`TokenService` is — it turns a credential into a verified claim about who is
calling, and it touches no table. `UsersService.signInWithGoogle` does the
find-link-or-create and calls `issueTokenPair`, next to `login`, because that is
where the account rules already live.

**`GoogleTokenVerifier` is a port in everything but name.** When Apple or
Facebook arrives it gets a sibling and a small resolver; it does not get a
generic `OAuthService` written for it in advance.

## Environment

```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
```

One variable, declared on `EnvironmentVariables` with `@IsString()` and added to
`.env.example` — the app will not boot without it, as with every other var here.

**No `GOOGLE_CLIENT_SECRET`.** Verifying an ID token does not need one. The
secret arrives with the Gmail feature, which uses the authorization-code flow,
and it belongs to that feature's config block.

The same Cloud project and the same OAuth client serve both features later;
`GOOGLE_CLIENT_ID` is therefore named for the project, not for this route.

## Implementation order

1. `GOOGLE_CLIENT_ID` in `env.validation.ts` + `.env.example`;
   `npm i google-auth-library`.
2. `User.googleId`, `User.authProvider`, `password` nullable, the two partial
   unique indexes. Restart applies it (`synchronize: true`).
3. Fix the three password call sites (decision 6) **before** any Google account
   can exist — a null password reaching `bcrypt.compare` is a 500.
4. `GoogleTokenVerifier` in `AuthModule`, exported.
5. `UsersService.signInWithGoogle({ identity, storeSlug? })` — find by
   `googleId`, else link by verified email, else create.
6. The two DTOs and the two routes.
7. Seed: one Google-created shopper on `layali` with `password: null`, so the
   null-password paths are reachable without a real Google account.

## Tests

Unit — the linking rule is the thing worth extracting. `resolveGoogleAccount`
is a pure function over `{ existingByGoogleId, existingByEmail, identity }`
returning `login | link | create | refuse`, and it gets its own spec:

- googleId hit → `login`, even when the email now differs (decision 3).
- email hit + `emailVerified: true` → `link`.
- email hit + `emailVerified: false` → `refuse`.
- nothing + verified → `create`.
- nothing + unverified → `refuse`.

Endpoint:

- New user through `/users/google` → 201-equivalent 200, `isEmailVerified: true`,
  a working access token, and **no OTP mail sent**.
- The same token twice → one row, second call is a plain login.
- Password account with the same email → linked; the **password still works**
  afterwards, and so does Google.
- Unverified local account + Google → linked and verified.
- A token minted for a different `aud` → 401. An expired token → 401. A
  hand-crafted unsigned JWT → 401.
- `email_verified: false` → 403 and **no row created**.
- Store A's Google shopper against store B's slug → a **separate row** for store
  B, and the two tokens are scoped to their own stores.
- Draft store slug → 404.
- `login` with a password against a Google-only account → 401, the same message
  as a wrong password.
- `changePassword` on a Google-only account → 400 naming the reason.
- `resetPassword` on a Google-only account → sets a password; both methods then
  work.
- `storeId` or `role` in either body → 400 `should not exist`.

## Considered and rejected

- **A `UserIdentity` table now.** Correct, and premature at one provider: it
  turns every login into a join for a column two indexes already answer. It is
  the first refactor the second provider forces, and the migration is
  mechanical.
- **The redirect flow.** Decision 1 — it ends with the token-into-an-SPA
  problem, and this API has no cookies or sessions to solve it with.
- **Trusting `email` instead of `sub`.** Emails move between people; `sub` does
  not.
- **Auto-linking on an unverified Google email.** Free account takeover for
  anyone who can create a Google account claiming an address.
- **Making `authProvider` the permission check** ("google accounts cannot use
  passwords"). A linked account is both, and the column that answers "can they
  log in with a password" is `password IS NOT NULL`.
- **Asking for `gmail.readonly` here, while the user is already consenting.**
  Tempting — one consent screen instead of two — and wrong: it drags *every*
  signup, including every shopper, through a restricted scope that needs an
  annual security assessment, to serve a feature only owners use. Incremental
  authorization exists for exactly this.
- **One route with an optional `storeSlug`.** The password routes are paired for
  a reason: an omitted slug must not silently mean "the platform".

## Deferred

- **Apple and Facebook sign-in**, and the `UserIdentity` refactor they justify.
- **Unlinking Google** from an account that also has a password.
- **`GET /users/me/identities`** so a settings screen can show what is linked.
- **Gmail ingestion for suppliers** — the authorization-code flow, the stored
  refresh token, and the Google review that comes with it. Different feature,
  different module, same Cloud project.
