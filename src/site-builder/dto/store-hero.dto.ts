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

  static fromEntity(store: Store): StoreHeroDto {
    const dto = new StoreHeroDto();
    dto.imageUrl = store.heroImageUrl;
    dto.headline = store.heroHeadline;
    dto.subtitle = store.heroSubtitle;
    dto.ctaLabel = store.heroCtaLabel;
    dto.ctaHref = store.heroCtaHref;
    return dto;
  }
}
