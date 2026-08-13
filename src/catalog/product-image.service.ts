import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReorderDto } from '../common/dto/reorder.dto';
import { StoreService } from '../site-builder/store.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import { MAX_PRODUCT_IMAGES, PRODUCT_SUBFOLDER } from './catalog.constants';
import { UpdateImageDto } from './dto/update-image.dto';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductService } from './product.service';

/** Owns `ProductImage` and the Cloudinary assets behind it. */
@Injectable()
export class ProductImageService {
  constructor(
    @InjectRepository(ProductImage)
    private readonly imageRepository: Repository<ProductImage>,
    private readonly productService: ProductService,
    private readonly storeService: StoreService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * The cap is checked **before** the first upload, so a rejected batch never
   * leaves orphaned assets on Cloudinary paid for by nobody.
   */
  async addImages(
    user: JwtPayload,
    productId: string,
    files: readonly Express.Multer.File[],
  ): Promise<Product> {
    const { storeId, product } = await this.resolveProduct(user, productId);
    if (files.length === 0) {
      throw new BadRequestException('Attach at least one image');
    }

    const existing = await this.imageRepository.count({
      where: { productId: product.id },
    });
    if (existing + files.length > MAX_PRODUCT_IMAGES) {
      throw new BadRequestException(
        `A product may have at most ${MAX_PRODUCT_IMAGES} images; this one already has ${existing}`,
      );
    }

    const uploaded = await Promise.all(
      files.map((file) =>
        this.cloudinaryService.uploadImage({
          buffer: file.buffer,
          subfolder: PRODUCT_SUBFOLDER,
        }),
      ),
    );

    await this.imageRepository.save(
      uploaded.map((image, index) =>
        this.imageRepository.create({
          productId: product.id,
          url: image.url,
          publicId: image.publicId,
          position: existing + index,
        }),
      ),
    );

    return this.productService.loadFull(storeId, product.id);
  }

  async reorderImages(
    user: JwtPayload,
    productId: string,
    dto: ReorderDto,
  ): Promise<Product> {
    const { storeId, product } = await this.resolveProduct(user, productId);
    const owned = await this.imageRepository.find({
      where: { productId: product.id },
      select: { id: true },
    });

    const ids = dto.items.map((item) => item.id);
    const ownedIds = new Set(owned.map((image) => image.id));
    const isComplete =
      new Set(ids).size === ids.length && ids.every((id) => ownedIds.has(id));
    if (!isComplete) {
      throw new BadRequestException(
        'Every image must belong to this product and appear once',
      );
    }

    await this.imageRepository.manager.transaction(async (manager) => {
      for (const item of dto.items) {
        await manager.update(
          ProductImage,
          { id: item.id, productId: product.id },
          { position: item.position },
        );
      }
    });

    return this.productService.loadFull(storeId, product.id);
  }

  async updateImage(
    user: JwtPayload,
    productId: string,
    imageId: string,
    dto: UpdateImageDto,
  ): Promise<Product> {
    const { storeId, product } = await this.resolveProduct(user, productId);
    const image = await this.getImage(product.id, imageId);

    if (dto.altText !== undefined) {
      image.altText = dto.altText === null ? null : toNullableText(dto.altText);
    }
    await this.imageRepository.save(image);

    return this.productService.loadFull(storeId, product.id);
  }

  /** Unlike a category's, a deleted product image takes its asset with it. */
  async removeImage(
    user: JwtPayload,
    productId: string,
    imageId: string,
  ): Promise<Product> {
    const { storeId, product } = await this.resolveProduct(user, productId);
    const image = await this.getImage(product.id, imageId);

    await this.imageRepository.remove(image);
    await this.cloudinaryService.destroyImage(image.publicId);

    return this.productService.loadFull(storeId, product.id);
  }

  private async resolveProduct(
    user: JwtPayload,
    productId: string,
  ): Promise<{ storeId: string; product: Product }> {
    const store = await this.storeService.resolveCallerStore(user);
    const product = await this.productService.getScoped(store.id, productId);
    return { storeId: store.id, product };
  }

  private async getImage(
    productId: string,
    imageId: string,
  ): Promise<ProductImage> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException('Image not found on this product');
    }
    return image;
  }
}

/** Treats an empty edit as "clear this field" rather than "set it to blank". */
function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
