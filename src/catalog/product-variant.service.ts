import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StoreService } from '../site-builder/store.service';
import { MAX_VARIANTS_PER_PRODUCT } from './catalog.constants';
import { CreateVariantDto } from './dto/create-variant.dto';
import {
  GenerateVariantsDto,
  VariantAxisDto,
} from './dto/generate-variants.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductAttributeService } from './product-attribute.service';
import { ProductService } from './product.service';
import { assertComparePrice } from './utils/compare-price.util';
import { buildOptionsKey } from './utils/options-key.util';
import {
  insertVariants,
  replaceVariantOptions,
  VariantRowInput,
} from './utils/variant-rows.util';

/** A variant reduced to what the matrix rules care about. */
interface MatrixEntry {
  readonly attributeValueIds: string[];
  readonly priceAmount: number;
  readonly compareAtAmount: number | null;
}

/**
 * Owns `ProductVariant`. Every write validates the product's **whole** matrix,
 * existing rows included — adding a Colour to one variant of six is just as
 * broken as submitting the mismatch in a single create — and finishes by asking
 * `ProductService` to recalculate the four aggregates in the same transaction.
 */
@Injectable()
export class ProductVariantService {
  constructor(
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    private readonly productService: ProductService,
    private readonly productAttributeService: ProductAttributeService,
    private readonly storeService: StoreService,
  ) {}

  async addVariant(
    user: JwtPayload,
    productId: string,
    dto: CreateVariantDto,
  ): Promise<Product> {
    const { storeId, product, existing } = await this.resolveProduct(
      user,
      productId,
    );

    const rows: VariantRowInput[] = [dto];
    await this.productService.assertVariantsAreValid(storeId, [
      ...this.toMatrix(existing),
      this.toMatrixEntry(dto),
    ]);

    await this.productService.runUnique(() =>
      this.variantRepository.manager.transaction(async (manager) => {
        await insertVariants({
          manager,
          productId: product.id,
          storeId,
          rows,
          startPosition: existing.length,
        });
        await this.productService.recalculateAggregates(product.id, manager);
      }),
    );

    return this.productService.loadFull(storeId, product.id);
  }

  async updateVariant(
    user: JwtPayload,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ): Promise<Product> {
    const { storeId, product, existing } = await this.resolveProduct(
      user,
      productId,
    );
    const variant = this.findVariant(existing, variantId);

    const priceAmount = dto.priceAmount ?? variant.priceAmount;
    const compareAtAmount =
      dto.compareAtAmount !== undefined
        ? dto.compareAtAmount
        : variant.compareAtAmount;
    assertComparePrice(priceAmount, compareAtAmount);

    const attributeValueIds =
      dto.attributeValueIds ?? variant.attributeValues.map((value) => value.id);
    await this.productService.assertVariantsAreValid(
      storeId,
      existing.map((row) =>
        row.id === variant.id
          ? { attributeValueIds, priceAmount, compareAtAmount }
          : this.toMatrixEntry(row),
      ),
    );

    variant.priceAmount = priceAmount;
    variant.compareAtAmount = compareAtAmount;
    if (dto.sku !== undefined) {
      variant.sku = dto.sku;
    }
    if (dto.stockQuantity !== undefined) {
      variant.stockQuantity = dto.stockQuantity;
    }
    if (dto.lowStockThreshold !== undefined) {
      variant.lowStockThreshold = dto.lowStockThreshold;
    }

    await this.productService.runUnique(() =>
      this.variantRepository.manager.transaction(async (manager) => {
        if (dto.attributeValueIds !== undefined) {
          await replaceVariantOptions(manager, variant, attributeValueIds);
          // A variant that gained options is no longer the invisible default
          // the dashboard hides behind a plain price/stock form.
          variant.isDefault = attributeValueIds.length === 0;
        }
        await manager.save(variant);
        await this.productService.recalculateAggregates(product.id, manager);
      }),
    );

    return this.productService.loadFull(storeId, product.id);
  }

  /**
   * A product with no variants has no price and no stock; it is not a product.
   * Removing the last one is a 400 pointing at archiving, which is what the
   * owner meant.
   */
  async removeVariant(
    user: JwtPayload,
    productId: string,
    variantId: string,
  ): Promise<Product> {
    const { storeId, product, existing } = await this.resolveProduct(
      user,
      productId,
    );
    const variant = this.findVariant(existing, variantId);

    if (existing.length === 1) {
      throw new BadRequestException(
        'A product needs at least one variant. Archive the product instead.',
      );
    }

    await this.variantRepository.manager.transaction(async (manager) => {
      await manager.softRemove(variant);
      await this.productService.recalculateAggregates(product.id, manager);
    });

    return this.productService.loadFull(storeId, product.id);
  }

  /**
   * The matrix builder: the cross product of the named axes, skipping the
   * combinations that already exist, in one transaction. Without it the
   * dashboard issues six creates and has to reconcile a partial failure.
   */
  async generateVariants(
    user: JwtPayload,
    productId: string,
    dto: GenerateVariantsDto,
  ): Promise<Product> {
    const { storeId, product, existing } = await this.resolveProduct(
      user,
      productId,
    );
    await this.assertAxesAreValid(storeId, dto.axes);
    assertComparePrice(dto.priceAmount, null);

    const combinations = this.buildCombinations(dto.axes);
    const taken = new Set(existing.map((variant) => variant.optionsKey));
    const rows: VariantRowInput[] = combinations
      .filter((valueIds) => !taken.has(buildOptionsKey(valueIds)))
      .map((valueIds) => ({
        priceAmount: dto.priceAmount,
        stockQuantity: dto.stockQuantity ?? 0,
        attributeValueIds: valueIds,
      }));

    if (rows.length === 0) {
      return this.productService.loadFull(storeId, product.id);
    }

    await this.productService.assertVariantsAreValid(storeId, [
      ...this.toMatrix(existing),
      ...rows.map((row) => this.toMatrixEntry(row)),
    ]);

    await this.productService.runUnique(() =>
      this.variantRepository.manager.transaction(async (manager) => {
        await insertVariants({
          manager,
          productId: product.id,
          storeId,
          rows,
          startPosition: existing.length,
        });
        await this.productService.recalculateAggregates(product.id, manager);
      }),
    );

    return this.productService.loadFull(storeId, product.id);
  }

  private async resolveProduct(
    user: JwtPayload,
    productId: string,
  ): Promise<{
    storeId: string;
    product: Product;
    existing: ProductVariant[];
  }> {
    const store = await this.storeService.resolveCallerStore(user);
    const product = await this.productService.getScoped(store.id, productId);
    const existing = await this.variantRepository.find({
      where: { productId: product.id },
      relations: { attributeValues: true },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return { storeId: store.id, product, existing };
  }

  private findVariant(
    existing: readonly ProductVariant[],
    variantId: string,
  ): ProductVariant {
    const variant = existing.find((row) => row.id === variantId);
    if (!variant) {
      throw new BadRequestException('Variant not found on this product');
    }
    return variant;
  }

  private toMatrix(variants: readonly ProductVariant[]): MatrixEntry[] {
    return variants.map((variant) => this.toMatrixEntry(variant));
  }

  private toMatrixEntry(row: {
    attributeValues?: readonly { id: string }[];
    attributeValueIds?: readonly string[];
    priceAmount: number;
    compareAtAmount?: number | null;
  }): MatrixEntry {
    return {
      attributeValueIds:
        row.attributeValueIds !== undefined
          ? [...row.attributeValueIds]
          : (row.attributeValues ?? []).map((value) => value.id),
      priceAmount: row.priceAmount,
      compareAtAmount: row.compareAtAmount ?? null,
    };
  }

  /** Each axis must be a real variant axis of this store, with its own values. */
  private async assertAxesAreValid(
    storeId: string,
    axes: readonly VariantAxisDto[],
  ): Promise<void> {
    const attributeIds = new Set(axes.map((axis) => axis.attributeId));
    if (attributeIds.size !== axes.length) {
      throw new BadRequestException('axes: each attribute may appear once');
    }

    const values = await this.productAttributeService.loadValuesByIds(
      storeId,
      axes.flatMap((axis) => axis.valueIds),
    );

    for (const axis of axes) {
      for (const valueId of axis.valueIds) {
        const value = values.get(valueId);
        if (!value || value.attributeId !== axis.attributeId) {
          throw new BadRequestException(
            `axes: "${valueId}" is not a value of that attribute`,
          );
        }
        if (!value.attribute?.isVariantAxis) {
          throw new BadRequestException(
            `axes: "${value.attribute?.name ?? valueId}" does not define variants`,
          );
        }
      }
    }
  }

  /**
   * The cross product, capped **before** it is built: three axes of ten values
   * is a thousand rows from one request, and materialising them only to reject
   * the array afterwards is work nobody asked for.
   */
  private buildCombinations(axes: readonly VariantAxisDto[]): string[][] {
    const total = axes.reduce((size, axis) => size * axis.valueIds.length, 1);
    if (total > MAX_VARIANTS_PER_PRODUCT) {
      throw new BadRequestException(
        `Those axes would produce ${total} variants; the limit is ${MAX_VARIANTS_PER_PRODUCT}`,
      );
    }

    return axes.reduce<string[][]>(
      (combinations, axis) =>
        combinations.flatMap((combination) =>
          axis.valueIds.map((valueId) => [...combination, valueId]),
        ),
      [[]],
    );
  }
}
