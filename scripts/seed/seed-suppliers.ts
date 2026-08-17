import { DataSource, Repository } from 'typeorm';
import { ProductVariant } from '../../src/catalog/entities/product-variant.entity';
import { ProductService } from '../../src/catalog/product.service';
import { PurchaseRequest } from '../../src/suppliers/entities/purchase-request.entity';
import { Supplier } from '../../src/suppliers/entities/supplier.entity';
import { SupplierOffer } from '../../src/suppliers/entities/supplier-offer.entity';
import { DraftStatus } from '../../src/suppliers/enums/draft-status.enum';
import { OfferExtractionStatus } from '../../src/suppliers/enums/offer-extraction-status.enum';
import { PurchaseRequestStatus } from '../../src/suppliers/enums/purchase-request-status.enum';
import { SupplierOfferStatus } from '../../src/suppliers/enums/supplier-offer-status.enum';
import { buildFallbackRequestEmail } from '../../src/suppliers/utils/fallback-request-email.util';
import { SeedOffer, SeedPurchaseRequest } from './fixtures';
import { SeededStore } from './seed-stores';

/** What the report prints per store. */
export interface SeededSuppliers {
  readonly storeSlug: string;
  readonly suppliers: readonly Supplier[];
  readonly request: PurchaseRequest | null;
  readonly offers: readonly SupplierOffer[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The request went out three days ago; the replies came the day after. */
const SENT_DAYS_AGO = 3;
const REPLIED_DAYS_AGO = 2;

/**
 * The supplier book, and one request per live store seeded straight into
 * `replied`.
 *
 * Written through the repositories like the rest of the seed — the services
 * resolve a store from a JWT and there is no request here — with one
 * deliberate exception: the email body comes from
 * `buildFallbackRequestEmail`, the same template the app falls back to. A seed
 * that wrote its own wording would be a second copy of the mail nobody
 * maintains, and running the seed must not spend a Gemini call per store.
 */
export async function seedSuppliers(
  dataSource: DataSource,
  productService: ProductService,
  stores: readonly SeededStore[],
): Promise<SeededSuppliers[]> {
  const supplierRepository = dataSource.getRepository(Supplier);
  const requestRepository = dataSource.getRepository(PurchaseRequest);
  const offerRepository = dataSource.getRepository(SupplierOffer);
  const variantRepository = dataSource.getRepository(ProductVariant);
  const seeded: SeededSuppliers[] = [];

  for (const { store, definition } of stores) {
    const suppliers = await supplierRepository.save(
      definition.suppliers.map((supplier) =>
        supplierRepository.create({
          storeId: store.id,
          name: supplier.name,
          contactEmail: supplier.contactEmail.toLowerCase(),
          phone: supplier.phone ?? null,
          leadTimeDays: supplier.leadTimeDays,
          notes: supplier.notes ?? null,
          isActive: supplier.isActive ?? true,
        }),
      ),
    );

    const fixture = definition.purchaseRequest;
    if (!fixture) {
      seeded.push({
        storeSlug: definition.slug,
        suppliers,
        request: null,
        offers: [],
      });
      continue;
    }

    const request = await writeRequest({
      productService,
      requestRepository,
      variantRepository,
      storeId: store.id,
      storeName: store.name,
      fixture,
    });
    const offers = await offerRepository.save(
      fixture.offers.map((offer) =>
        offerRepository.create(
          buildOffer(
            store.id,
            request.id,
            offer,
            findSupplier(suppliers, offer),
          ),
        ),
      ),
    );

    seeded.push({ storeSlug: definition.slug, suppliers, request, offers });
  }

  return seeded;
}

async function writeRequest({
  productService,
  requestRepository,
  variantRepository,
  storeId,
  storeName,
  fixture,
}: {
  productService: ProductService;
  requestRepository: Repository<PurchaseRequest>;
  variantRepository: Repository<ProductVariant>;
  storeId: string;
  storeName: string;
  fixture: SeedPurchaseRequest;
}): Promise<PurchaseRequest> {
  const variant = await variantRepository.findOne({
    where: { storeId, sku: fixture.sku },
  });
  if (!variant) {
    throw new Error(`seed: no seeded variant with SKU ${fixture.sku}`);
  }

  // Through the catalog's own reader, so the snapshot the seed writes is the
  // snapshot a real request would take.
  const level = await productService.findStockLevel(storeId, variant.id);
  if (!level) {
    throw new Error(`seed: variant ${fixture.sku} has no product`);
  }

  const draft = buildFallbackRequestEmail({
    storeName,
    productTitle: level.productTitle,
    variantLabel: level.variantLabel,
    quantity: fixture.quantity,
    neededWithinDays: fixture.neededWithinDays,
    note: fixture.note ?? null,
  });

  return requestRepository.save(
    requestRepository.create({
      storeId,
      productId: level.productId,
      variantId: level.variantId,
      productTitle: level.productTitle,
      variantLabel: level.variantLabel,
      quantity: fixture.quantity,
      neededWithinDays: fixture.neededWithinDays,
      subject: draft.subject,
      body: draft.body,
      note: fixture.note ?? null,
      status: PurchaseRequestStatus.Replied,
      draftStatus: DraftStatus.Fallback,
      sentAt: daysAgo(SENT_DAYS_AGO),
    }),
  );
}

function buildOffer(
  storeId: string,
  purchaseRequestId: string,
  fixture: SeedOffer,
  supplier: Supplier,
): Partial<SupplierOffer> {
  const hasReplied = fixture.unitAmount !== undefined;

  return {
    storeId,
    purchaseRequestId,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierEmail: supplier.contactEmail,
    status: hasReplied
      ? SupplierOfferStatus.Received
      : SupplierOfferStatus.Awaiting,
    unitAmount: fixture.unitAmount ?? null,
    quantity: fixture.quantity ?? null,
    deliveryDays: fixture.deliveryDays ?? null,
    notes: fixture.notes ?? null,
    rawReply: fixture.rawReply ?? null,
    extractionStatus: hasReplied ? OfferExtractionStatus.Parsed : null,
    sentAt: daysAgo(SENT_DAYS_AGO),
    repliedAt: hasReplied ? daysAgo(REPLIED_DAYS_AGO) : null,
  };
}

function findSupplier(
  suppliers: readonly Supplier[],
  offer: SeedOffer,
): Supplier {
  const supplier = suppliers.find(
    (candidate) => candidate.contactEmail === offer.supplierEmail.toLowerCase(),
  );
  if (!supplier) {
    throw new Error(
      `seed: no seeded supplier with email ${offer.supplierEmail}`,
    );
  }
  return supplier;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}
