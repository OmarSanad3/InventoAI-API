import { ProductImage } from '../entities/product-image.entity';

/**
 * The gallery's primary image — the one at `position = 0`, falling back to the
 * first row loaded so a product whose positions drifted still shows a picture
 * rather than a gap.
 */
export function findPrimaryImage(
  images: readonly ProductImage[] = [],
): ProductImage | null {
  if (images.length === 0) {
    return null;
  }
  return images.find((image) => image.position === 0) ?? images[0];
}
