import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { ProductStatus } from '../src/catalog/enums/product-status.enum';
import { ProductService } from '../src/catalog/product.service';
import {
  Environment,
  EnvironmentVariables,
} from '../src/config/env.validation';
import { RedisService } from '../src/redis/redis.service';
import { StoreStatus } from '../src/site-builder/enums/store-status.enum';
import { UserRole } from '../src/users/enums/user-role.enum';
import { SEED_PASSWORD } from './seed/fixtures';
import { resetDatabase, resetRedis } from './seed/reset';
import {
  seedAttributes,
  seedCategories,
  SeededAttribute,
  SeededCategory,
  SeededProduct,
  seedProducts,
} from './seed/seed-catalog';
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
    const categories = await seedCategories(dataSource, stores);
    const attributes = await seedAttributes(dataSource, stores);
    const products = await seedProducts(
      dataSource,
      app.get(ProductService, { strict: false }),
      stores,
      categories,
      attributes,
    );
    log(
      `seeded ${stores.length} stores, ` +
        `${stores.reduce((sum, s) => sum + s.accounts.length, 0)} accounts, ` +
        `${categories.length} categories, ` +
        `${attributes.length} attributes ` +
        `(${attributes.reduce((sum, a) => sum + a.attribute.values.length, 0)} values), ` +
        `${products.length} products ` +
        `(${products.reduce((sum, p) => sum + p.product.variantCount, 0)} variants)`,
    );

    printReport(await buildReport(stores, tokenService));
    printCatalog(stores, categories, attributes, products);
    printTryIt();
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

  console.log(
    '\n  Tokens expire per JWT_ACCESS_EXPIRES_IN. Re-run the seed for fresh ones,\n' +
      '  or raise it in your local .env — see SETUP.md.',
  );
}

/**
 * The row ids an API client needs to call `/:id` routes without listing first —
 * the whole reason to run this before building a dashboard screen.
 */
function printCatalog(
  stores: readonly SeededStore[],
  categories: readonly SeededCategory[],
  attributes: readonly SeededAttribute[],
  products: readonly SeededProduct[],
): void {
  const line = '─'.repeat(78);
  console.log(
    `\n${line}\n  Catalog — ids to paste into an API client\n${line}`,
  );

  for (const { store, definition } of stores) {
    console.log(`\n  ${definition.slug}  (store ${store.id})`);

    console.log('    categories');
    for (const { category } of categories.filter(
      (entry) => entry.storeSlug === definition.slug,
    )) {
      const draft = category.isPublished ? '' : '  (unpublished)';
      console.log(`      ${category.id}  ${category.slug}${draft}`);
    }

    const storeAttributes = attributes.filter(
      (entry) => entry.storeSlug === definition.slug,
    );
    if (storeAttributes.length === 0) {
      console.log(
        '    attributes — none, this store filters on built-ins only',
      );
    } else {
      console.log('    attributes');
      for (const { attribute } of storeAttributes) {
        const kind = attribute.isVariantAxis ? 'axis' : 'descriptive';
        const hidden = attribute.isFilterable ? '' : ', not filterable';
        console.log(
          `      ${attribute.id}  ${attribute.key.padEnd(14)} ` +
            `${attribute.displayStyle.padEnd(9)} ${kind}${hidden}`,
        );
        console.log(
          `        ${attribute.values.map((value) => value.slug).join(', ')}`,
        );
      }
    }

    console.log('    products');
    for (const { product } of products.filter(
      (entry) => entry.storeSlug === definition.slug,
    )) {
      const state =
        product.status === ProductStatus.Active ? '' : `  (${product.status})`;
      console.log(
        `      ${product.id}  ${product.slug.padEnd(28)} ` +
          `${String(product.variantCount).padStart(2)} variants, ` +
          `${product.totalStock} in stock${state}`,
      );
    }
  }
}

function printTryIt(): void {
  const line = '─'.repeat(78);
  console.log(`\n${line}\n  Try it\n${line}`);
  console.log('  TOKEN=<owner.layali access token from above>\n');
  console.log('  # dashboard — the commerce layer');
  console.log(
    '  curl localhost:3000/products -H "Authorization: Bearer $TOKEN"',
  );
  console.log(
    '  curl "localhost:3000/products?search=ABA-CRP&lowStock=true" -H "Authorization: Bearer $TOKEN"',
  );
  console.log(
    '  curl localhost:3000/product-attributes -H "Authorization: Bearer $TOKEN"',
  );
  console.log(
    '  curl localhost:3000/categories -H "Authorization: Bearer $TOKEN"',
  );
  console.log('\n  # storefront — public, no token');
  console.log('  curl localhost:3000/site/layali');
  console.log('  curl localhost:3000/site/layali/categories');
  console.log('  curl "localhost:3000/site/layali/products?sort=price_asc"');
  console.log('  curl "localhost:3000/site/layali/products/chiffon-hijab"');
  console.log('  curl localhost:3000/site/layali/filters');
  console.log('\n  # search — ranked, stemmed, typo-tolerant');
  console.log(
    '  curl "localhost:3000/site/layali/products?search=abaya"          # ranked',
  );
  console.log(
    '  curl "localhost:3000/site/layali/products?search=abya"           # fuzzy + didYouMean',
  );
  console.log(
    '  curl "localhost:3000/site/layali/products/suggest?search=chif"   # autocomplete',
  );
  console.log(
    '  curl "localhost:3000/site/layali/products?attributes=color:black,navy;size:m"',
  );
  console.log(
    '\n  curl localhost:3000/site/draftco   # 404 — the store is a draft\n',
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
