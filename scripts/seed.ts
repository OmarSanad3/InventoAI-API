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
import { seedFaqs, SeededFaq } from './seed/seed-faqs';
import { seedKnowledge, SeededKnowledge } from './seed/seed-knowledge';
import { seedOrders, SeededOrder } from './seed/seed-orders';
import { seedStores, SeededStore } from './seed/seed-stores';
import { KnowledgeIndexer } from '../src/knowledge/knowledge-indexer.service';

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
    const productService = app.get(ProductService, { strict: false });
    const knowledgeIndexer = app.get(KnowledgeIndexer, { strict: false });

    const tableCount = await resetDatabase(dataSource);
    const keyCount = await resetRedis(redisService);
    log(`cleared ${tableCount} tables and ${keyCount} redis keys`);

    const stores = await seedStores(dataSource);
    const categories = await seedCategories(dataSource, stores);
    const attributes = await seedAttributes(dataSource, stores);
    const products = await seedProducts(
      dataSource,
      productService,
      stores,
      categories,
      attributes,
    );
    const faqs = await seedFaqs(dataSource, stores);
    const orders = await seedOrders(dataSource, productService, stores);
    log(
      `seeded ${stores.length} stores, ` +
        `${stores.reduce((sum, s) => sum + s.accounts.length, 0)} accounts, ` +
        `${categories.length} categories, ` +
        `${attributes.length} attributes ` +
        `(${attributes.reduce((sum, a) => sum + a.attribute.values.length, 0)} values), ` +
        `${products.length} products ` +
        `(${products.reduce((sum, p) => sum + p.product.variantCount, 0)} variants), ` +
        `${faqs.length} FAQ entries, ` +
        `${orders.length} orders`,
    );

    // Last, and deliberately non-fatal: an unreachable Gemini key must not cost
    // a seed whose every other row is already usable.
    const knowledge = await seedKnowledge(knowledgeIndexer, stores).catch(
      (err: unknown) => {
        log(`knowledge base not indexed: ${String(err)}`);
        return [] as SeededKnowledge[];
      },
    );
    if (knowledge.length > 0) {
      log(
        `indexed ${knowledge.reduce((sum, k) => sum + k.indexed, 0)} of ` +
          `${knowledge.reduce((sum, k) => sum + k.documents, 0)} knowledge documents`,
      );
    }

    printReport(await buildReport(stores, tokenService));
    printCatalog(
      stores,
      categories,
      attributes,
      products,
      faqs,
      orders,
      knowledge,
    );
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
  faqs: readonly SeededFaq[],
  orders: readonly SeededOrder[],
  knowledge: readonly SeededKnowledge[],
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

    console.log('    faqs');
    for (const { faq } of faqs.filter(
      (entry) => entry.storeSlug === definition.slug,
    )) {
      const hidden = faq.isPublished ? '' : '  (unpublished)';
      console.log(`      ${faq.id}  ${truncate(faq.question, 44)}${hidden}`);
    }

    printKnowledgeLine(knowledge, definition.slug);

    const storeOrders = orders.filter(
      (entry) => entry.storeSlug === definition.slug,
    );
    if (storeOrders.length === 0) {
      console.log('    orders — none, a draft store cannot take orders');
      continue;
    }
    console.log('    orders');
    for (const { order } of storeOrders) {
      console.log(
        `      ${order.id}  #${String(order.orderNumber).padEnd(3)} ` +
          `${order.status.padEnd(9)} ${order.paymentStatus.padEnd(6)} ` +
          `${order.totalAmount} ${order.currency}`,
      );
    }
  }
}

/** What the chatbot will retrieve from, once branch 2 lands. */
function printKnowledgeLine(
  knowledge: readonly SeededKnowledge[],
  storeSlug: string,
): void {
  const entry = knowledge.find((row) => row.storeSlug === storeSlug);
  if (!entry) {
    console.log('    knowledge — not indexed');
    return;
  }

  const failed = entry.failed > 0 ? `, ${entry.failed} failed` : '';
  console.log(
    `    knowledge — ${entry.indexed}/${entry.documents} documents embedded${failed}`,
  );
}

/** Keeps a long question on one line of the report. */
function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength
    ? text.padEnd(maxLength)
    : `${text.slice(0, maxLength - 1)}…`;
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
  console.log('  curl localhost:3000/faqs -H "Authorization: Bearer $TOKEN"');
  console.log(
    '  curl localhost:3000/knowledge/status -H "Authorization: Bearer $TOKEN"',
  );
  console.log(
    '  curl "localhost:3000/orders?status=pending" -H "Authorization: Bearer $TOKEN"',
  );
  console.log('\n  # storefront — checkout, as a customer of the store');
  console.log('  SHOPPER=<shopper.layali access token from above>\n');
  console.log(
    '  curl localhost:3000/site/layali/orders/me -H "Authorization: Bearer $SHOPPER"',
  );
  console.log(
    '  curl -X POST localhost:3000/site/layali/orders -H "Authorization: Bearer $SHOPPER" \\\n' +
      "    -H 'content-type: application/json' -d '{\n" +
      '      "items": [{ "variantId": "<a variant id>", "quantity": 1 }],\n' +
      '      "shippingAddress": { "line1": "18 Talaat Harb St", "city": "Cairo", "country": "EG" },\n' +
      '      "contactPhone": "+201001234567"\n' +
      "    }'",
  );
  console.log('\n  # storefront — public, no token');
  console.log('  curl localhost:3000/site/layali');
  console.log('  curl localhost:3000/site/layali/categories');
  console.log('  curl "localhost:3000/site/layali/products?sort=price_asc"');
  console.log('  curl "localhost:3000/site/layali/products/chiffon-hijab"');
  console.log('  curl localhost:3000/site/layali/filters');
  console.log(
    '  curl localhost:3000/site/layali/faqs   # published entries only',
  );
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
