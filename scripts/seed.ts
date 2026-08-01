import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import {
  Environment,
  EnvironmentVariables,
} from '../src/config/env.validation';
import { RedisService } from '../src/redis/redis.service';
import { StoreStatus } from '../src/site-builder/enums/store-status.enum';
import { UserRole } from '../src/users/enums/user-role.enum';
import { SEED_PASSWORD } from './seed/fixtures';
import { resetDatabase, resetRedis } from './seed/reset';
import { seedCategories } from './seed/seed-catalog';
import { seedStores, SeededStore } from './seed/seed-stores';

const FORCE_FLAG = '--force';
const DEVELOPMENT = 'development';

interface AccountReport {
  readonly email: string;
  readonly role: UserRole;
  readonly store: string;
  readonly accessToken: string | null;
  readonly note: string;
}

/**
 * Wipes the database and refills it with a catalog the frontend can develop
 * against, then prints working credentials and tokens.
 *
 * Destructive by design, so it refuses to run outside development and requires
 * an explicit `--force`.
 */
async function main(): Promise<void> {
  assertForced();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const configService =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    assertDevelopment(configService.get('NODE_ENV', { infer: true }));

    const dataSource = app.get(DataSource, { strict: false });
    const redisService = app.get(RedisService, { strict: false });
    const tokenService = app.get(TokenService, { strict: false });

    const tableCount = await resetDatabase(dataSource);
    const keyCount = await resetRedis(redisService);
    log(`cleared ${tableCount} tables and ${keyCount} redis keys`);

    const stores = await seedStores(dataSource);
    const categoryCount = await seedCategories(dataSource, stores);
    log(
      `seeded ${stores.length} stores, ` +
        `${stores.reduce((sum, s) => sum + s.accounts.length, 0)} accounts, ` +
        `${categoryCount} categories`,
    );

    printReport(await buildReport(stores, tokenService));
  } finally {
    await app.close();
  }
}

function assertForced(): void {
  if (!process.argv.includes(FORCE_FLAG)) {
    fail(
      'this deletes every row in the database. Re-run with --force if that is what you want:\n' +
        '  npm run seed -- --force',
    );
  }
}

/**
 * Read from the validated config rather than `process.env`, because `NODE_ENV`
 * lives in `.env` and is only loaded once the app has booted.
 */
function assertDevelopment(environment: Environment): void {
  if (environment !== Environment.Development) {
    fail(
      `refusing to run with NODE_ENV="${environment}". This script deletes ` +
        `every row in the database and only runs in ${DEVELOPMENT}.`,
    );
  }
}

async function buildReport(
  stores: readonly SeededStore[],
  tokenService: TokenService,
): Promise<AccountReport[]> {
  const report: AccountReport[] = [];

  for (const { definition, accounts } of stores) {
    for (const { user } of accounts) {
      // An unverified account cannot log in (403), so handing out a token for
      // it would contradict the very rule it exists to demonstrate.
      const canLogIn = user.isEmailVerified;
      const tokens = canLogIn ? await tokenService.issueTokenPair(user) : null;

      report.push({
        email: user.email,
        role: user.role,
        store: definition.slug,
        accessToken: tokens?.accessToken ?? null,
        note: describeAccount(user.role, canLogIn, definition.status),
      });
    }
  }
  return report;
}

function describeAccount(
  role: UserRole,
  canLogIn: boolean,
  storeStatus: StoreStatus,
): string {
  if (!canLogIn) {
    return 'unverified — login returns 403';
  }
  if (role === UserRole.OWNER) {
    return storeStatus === StoreStatus.Draft
      ? 'owner of a draft store'
      : 'dashboard';
  }
  return role === UserRole.ADMIN ? 'dashboard' : 'storefront customer';
}

function printReport(report: readonly AccountReport[]): void {
  const line = '─'.repeat(78);

  console.log(
    `\n${line}\n  Seeded accounts — password for all: ${SEED_PASSWORD}\n${line}`,
  );
  for (const account of report) {
    console.log(
      `  ${account.email.padEnd(36)} ${account.role.padEnd(6)} ` +
        `${account.store.padEnd(9)} ${account.note}`,
    );
  }

  console.log(
    `\n${line}\n  Access tokens (paste as: Authorization: Bearer <token>)\n${line}`,
  );
  for (const account of report.filter((entry) => entry.accessToken)) {
    console.log(`\n  ${account.email}\n  ${account.accessToken}`);
  }

  console.log(`\n${line}\n  Try it\n${line}`);
  console.log('  curl localhost:3000/site/layali');
  console.log('  curl localhost:3000/site/layali/categories');
  console.log(
    '  curl localhost:3000/site/draftco   # 404 — the store is a draft',
  );
  console.log(
    '  curl localhost:3000/categories -H "Authorization: Bearer <owner token>"\n',
  );
  console.log(
    '  Tokens expire per JWT_ACCESS_EXPIRES_IN. Re-run the seed for fresh ones,\n' +
      '  or raise it in your local .env — see SETUP.md.\n',
  );
}

function log(message: string): void {
  console.log(`  seed: ${message}`);
}

function fail(message: string): never {
  console.error(`\n  seed: ${message}\n`);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('\n  seed failed:', err);
  process.exit(1);
});
