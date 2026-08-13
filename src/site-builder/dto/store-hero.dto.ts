import { Store } from '../entities/store.entity';

/**
 * The landing page's hero block. Drafted by the AI during site building, then
 * owned by the dashboard — every field is nullable because the owner may clear
 * any of them.
 */
export class StoreHeroDto {
  imageUrl!: string | null;
  headline!: string | null;
  subtitle!: string | null;
  ctaLabel!: string | null;
  ctaHref!: string | null;

  /**
   * `withDefaults` fills an unset CTA with the store's products page — the
   * storefront needs a working button, and the products page finally exists.
   * The dashboard editor asks for the raw row instead, so the owner is never
   * shown a value they did not choose and cannot save one by accident.
   */
  static fromEntity(
    store: Store,
    { withDefaults = false }: { withDefaults?: boolean } = {},
  ): StoreHeroDto {
    const dto = new StoreHeroDto();
    dto.imageUrl = store.heroImageUrl;
    dto.headline = store.heroHeadline;
    dto.subtitle = store.heroSubtitle;
    dto.ctaLabel = store.heroCtaLabel;
    dto.ctaHref =
      store.heroCtaHref ?? (withDefaults ? `/${store.slug}/products` : null);
    return dto;
  }
}
