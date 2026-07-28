# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context Files:

Read the following files to get the full context of the project

- @context/project-overview.md
- @context/coding-standards.md
- @context/ai-interactions.md
- @context/current-feature.md

## Commands

```bash
npm run start:dev          # watch-mode dev server
npm run build              # nest build -> dist/
npm run lint               # eslint --fix over src, test
npm run format             # prettier --write

npm test                   # jest, rootDir=src, matches *.spec.ts
npm test -- users.service  # single suite by path/name substring
npm test -- -t "verifies"  # single test by name
npm run test:e2e           # jest --config ./test/jest-e2e.json (rootDir=test)

docker compose up -d       # postgres:5432, redis:6379, adminer:8080
```

Postgres/Redis come from [docker-compose.yml](docker-compose.yml). Note the compose file reads `POSTGRES_USER/PASSWORD/DB` from `.env` while the app reads `DATABASE_USER/PASSWORD/NAME` — both sets live in the same `.env` and must agree. Copy [.env.example](.env.example) to `.env` before anything runs.

## Architecture

NestJS 11 + TypeORM/Postgres + ioredis + nodemailer. Currently only auth/user management exists; [TODO.md](TODO.md) tracks the known gap (unverified accounts get permanently locked out).

### Config is validated and fully typed

[src/config/env.validation.ts](src/config/env.validation.ts) declares every env var on the `EnvironmentVariables` class with class-validator decorators; `validate` runs at boot via `ConfigModule.forRoot({ isGlobal: true, validate })` and **throws on any missing or mistyped var**. Adding a new env var means adding a field here plus `.env.example`, otherwise the app won't start.

Everywhere config is read it uses the generic + infer form, which gives compile-time key checking and correct return types (numbers come back as numbers thanks to `enableImplicitConversion`):

```ts
private readonly configService: ConfigService<EnvironmentVariables, true>
this.configService.get('JWT_ACCESS_SECRET', { infer: true })
```

Keep that pattern — dropping `{ infer: true }` silently degrades the type to `string`.

### Module wiring

- `RedisModule` and `MailModule` are `@Global()` — inject `RedisService`/`MailService` without importing anything.
- `DatabaseModule` sets `synchronize: true` **only** when `NODE_ENV === 'development'`. There is no migration setup yet; schema changes in dev apply by restarting.
- `AuthModule` exports `TokenService` + `JwtAuthGuard`; feature modules import `AuthModule` to protect routes.
- `JwtModule.register({})` is intentionally empty — secrets and expiry are passed per-`sign`/`verify` call in `TokenService` because access and refresh tokens use different secrets.

### Auth flow

[src/auth/token.service.ts](src/auth/token.service.ts) owns all token logic:

- Access token: signed with `JWT_ACCESS_SECRET`, stateless.
- Refresh token: carries a random `jti`; its SHA-256 hash is stored at Redis key `refresh:<userId>:<jti>` with a TTL derived from the token's own `exp`. `rotateRefreshToken` verifies, compares the hash, **deletes the key**, and issues a fresh pair — refresh tokens are single-use, and replay fails.
- `JwtAuthGuard` is a hand-rolled `CanActivate` (no passport). It parses `Authorization: Bearer <token>` and assigns `request.user`. Apply per-route with `@UseGuards(JwtAuthGuard)`; read the payload with `@CurrentUser()` ([src/common/decorators/current-user.decorator.ts](src/common/decorators/current-user.decorator.ts)). The `Request.user` augmentation lives in [src/common/types/express.d.ts](src/common/types/express.d.ts).

### OTP flow

Email verification and password reset share one mechanism in [src/users/users.service.ts](src/users/users.service.ts): a 6-digit `randomInt` code stored at `otp:<purpose>:<email>` with `OTP_EXPIRES_IN_SECONDS` TTL, mailed by `MailService.sendOtpEmail`. `purpose` is the `OtpPurpose` union (`'verify-email' | 'reset-password'`) defined in [src/mail/mail.service.ts](src/mail/mail.service.ts) — extending it means updating `buildContent` too.

Deliberate behaviours to preserve when editing this service:

- `createUser` deletes the just-created row and throws 503 if the OTP mail fails, so a user can never exist without a way to verify.
- `forgotPassword` returns the same generic message whether or not the account exists (anti-enumeration); `verifyEmail`/`resetPassword` return the same "invalid or expired" message for a bad code and an unknown email.
- `login` distinguishes 401 (bad credentials) from 403 (unverified email).

### Entity and DTO conventions

- `User.password` is `@Column({ select: false })`. Plain `findOne` will not load it — use the query builder with `.addSelect('user.password')`, as `login` and `changePassword` do.
- `User.id` is a `@PrimaryColumn('uuid')` filled by a `@BeforeInsert` hook calling `randomUUID()`, not a DB-generated column. `repository.create()` + `save()` works; raw inserts must supply an id.
- The global `ValidationPipe` in [src/main.ts](src/main.ts) uses `whitelist: true, forbidNonWhitelisted: true, transform: true` — any field not decorated on the DTO causes a 400, so every accepted field needs a validator.
- Responses are hand-mapped through static `fromEntity` factories (e.g. `UserResponseDto.fromEntity`) rather than a serializer interceptor. New response shapes should follow the same pattern so the `select: false` password can never leak.
- Cross-field validation uses the custom `@Match('otherField')` decorator in [src/common/validators/match.decorator.ts](src/common/validators/match.decorator.ts).
- Roles are `UserRole` (`OWNER | ADMIN | USER`). `POST /users/register/owner` and `POST /users/register` differ only in the role assigned; there is no role guard yet.

## Notes

- `README.md` is the untouched NestJS starter README — it describes nothing project-specific.
- Test coverage is essentially the generated `app.controller.spec.ts`; there are no tests for the auth/user logic yet.
- No `@nestjs/swagger`, no global prefix, no CORS config — routes are exactly what the controllers declare.
