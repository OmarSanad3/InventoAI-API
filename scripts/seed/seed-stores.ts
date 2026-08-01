import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Store } from '../../src/site-builder/entities/store.entity';
import { StoreTheme } from '../../src/site-builder/entities/store-theme.entity';
import { LogoSource } from '../../src/site-builder/enums/logo-source.enum';
import { StoreStatus } from '../../src/site-builder/enums/store-status.enum';
import { User } from '../../src/users/entities/user.entity';
import { UserRole } from '../../src/users/enums/user-role.enum';
import { BCRYPT_SALT_ROUNDS } from '../../src/users/users.constants';
import { SeedStaff, SeedStore, SEED_PASSWORD, SEED_STORES } from './fixtures';

export interface SeededAccount {
  readonly user: User;
  readonly storeSlug: string | null;
}

export interface SeededStore {
  readonly store: Store;
  readonly definition: SeedStore;
  readonly accounts: readonly SeededAccount[];
}

/**
 * Placeholder branding. A real logo is a Cloudinary upload, and the seed
 * deliberately makes no network calls — it must work without credentials.
 */
const LOGO_URL = 'https://placehold.co/512x512/png';
const LOGO_PUBLIC_ID = 'seed/placeholder-logo';
const HERO_IMAGE_URL = 'https://placehold.co/1600x900/png';

export async function seedStores(
  dataSource: DataSource,
): Promise<SeededStore[]> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_SALT_ROUNDS);
  const seeded: SeededStore[] = [];

  for (const definition of SEED_STORES) {
    seeded.push(await seedStore(dataSource, definition, passwordHash));
  }
  return seeded;
}

async function seedStore(
  dataSource: DataSource,
  definition: SeedStore,
  passwordHash: string,
): Promise<SeededStore> {
  const userRepository = dataSource.getRepository(User);
  const storeRepository = dataSource.getRepository(Store);

  // The owner exists before the store, since Store.ownerId points at it.
  const owner = await userRepository.save(
    buildUser(definition.owner, passwordHash, null),
  );

  const isLive = definition.status === StoreStatus.Live;
  const store = await storeRepository.save(
    storeRepository.create({
      ownerId: owner.id,
      name: definition.name,
      slug: definition.slug,
      description: definition.description,
      status: definition.status,
      locale: definition.locale,
      currency: definition.currency,
      nextOrderNumber: 1,
      logoUrl: isLive ? LOGO_URL : null,
      logoPublicId: isLive ? LOGO_PUBLIC_ID : null,
      logoSource: isLive ? LogoSource.Uploaded : null,
      heroImageUrl: isLive ? HERO_IMAGE_URL : null,
      heroHeadline: definition.hero.headline,
      heroSubtitle: definition.hero.subtitle,
      heroCtaLabel: definition.hero.ctaLabel,
      heroCtaHref: null,
    }),
  );

  const members: SeededAccount[] = [];
  for (const member of definition.members) {
    const user = await userRepository.save(
      buildUser(member, passwordHash, store.id),
    );
    members.push({ user, storeSlug: definition.slug });
  }

  if (definition.theme) {
    const themeRepository = dataSource.getRepository(StoreTheme);
    await themeRepository.save(
      themeRepository.create({
        storeId: store.id,
        ...definition.theme,
        isSelected: true,
        generation: 1,
      }),
    );
  }

  return {
    store,
    definition,
    accounts: [{ user: owner, storeSlug: null }, ...members],
  };
}

/** An OWNER is a platform account and carries `storeId: null` by design. */
function buildUser(
  staff: SeedStaff,
  passwordHash: string,
  storeId: string | null,
): User {
  const user = new User();
  user.firstName = staff.firstName;
  user.lastName = staff.lastName;
  user.email = staff.email;
  user.password = passwordHash;
  user.role = staff.role;
  user.storeId = staff.role === UserRole.OWNER ? null : storeId;
  user.isEmailVerified = staff.isEmailVerified ?? true;
  user.image = null;
  return user;
}
