# Current Feature

Site building — the onboarding flow that turns a free-form brainstorm into a
live store. Spec: [features/site-building.md](./features/site-building.md).

## Status

In Progress — implemented on `feature/site-building`, not yet verified against a
running API.

Done: build passes, lint clean, 25 unit tests for the pure helpers pass.
Pending: endpoint verification (needs Postgres/Redis up plus real Gemini and
Cloudinary keys), then commit and merge.

## Goals

AI pre-fills the onboarding questionnaire from the owner's brainstorm, the owner
edits it, confirms a domain, picks one of four AI-generated themes and
publishes. The published store is served at `GET /site/:slug`.

## Notes

New modules: `src/site-builder/` (the flow, `Store`, `StoreTheme`,
`SiteBuildDraft`), `src/ai/` (global `GeminiService`), `src/storage/` (global
`CloudinaryService`), plus `RolesGuard` + `@Roles()` in `src/common/`.

New env vars — the app will not boot until they are in `.env`:
`SITE_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER`.

To verify:

```bash
docker compose up -d
npm run start:dev
# POST /site-builder/brainstorm (multipart) -> /answers -> /domain -> /themes -> /publish
# GET  /site/:slug
```

## History

<!-- Keep this updated> Earliest to latest -->

| Date | Feature | Status | Commit |
| --- | --- | --- | --- |
| 2026-07-15 | Project setup — NestJS 11 scaffold, ESLint/Prettier, Jest + e2e config | Completed | `7bc6196` |
| 2026-07-18 | Database — TypeORM/Postgres `DatabaseModule`, Docker Compose (Postgres, Redis, Adminer) | Completed | `e8b87c9` |
| 2026-07-18 | Config — typed & validated env via `EnvironmentVariables` + `validate`, global `ConfigModule` | Completed | `c894d63` |
| 2026-07-20 | Config fix — definite assignment assertions on env variables | Completed | `887f518` |
| 2026-07-23 | Auth & users — `User` entity, register (owner/user), login, JWT access + rotating single-use refresh tokens, `JwtAuthGuard`, `@CurrentUser()`, global `RedisModule`/`MailModule`, OTP email verification & password reset, change password, DTOs + `@Match` validator | Completed | `d523672` |
| 2026-07-29 | Site building — feature spec written ([features/site-building.md](./features/site-building.md)) | Completed | `c7f043b` |
| 2026-07-30 | Site building — `RolesGuard`, `Store`/`StoreTheme`/`SiteBuildDraft`, Gemini + Cloudinary services, the five flow endpoints and the public `GET /site/:slug` | In Progress | — |

### Known gaps

- Unverified accounts get permanently locked out — tracked in [TODO.md](../TODO.md).
- No tests for the auth/user logic; the site-builder tests cover only the pure
  helpers (theme CSS, oklch, slug, monogram).
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for
  `AppService`. Pre-existing, unrelated to this branch.
