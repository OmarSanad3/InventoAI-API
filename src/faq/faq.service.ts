import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReorderDto } from '../common/dto/reorder.dto';
import { StoreService } from '../site-builder/store.service';
import { CreateFaqDto } from './dto/create-faq.dto';
import { UpdateFaqDto } from './dto/update-faq.dto';
import { Faq } from './entities/faq.entity';
import { MAX_FAQS_PER_STORE } from './faq.constants';

/**
 * Owns the `Faq` row. Every method resolves the caller's store first and scopes
 * its query by that id, so an entry of another store is invisible rather than
 * forbidden.
 */
@Injectable()
export class FaqService {
  constructor(
    @InjectRepository(Faq)
    private readonly faqRepository: Repository<Faq>,
    private readonly storeService: StoreService,
  ) {}

  async create(user: JwtPayload, dto: CreateFaqDto): Promise<Faq> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.assertRoomForOneMore(store.id);

    const faq = this.faqRepository.create({
      storeId: store.id,
      question: dto.question.trim(),
      answer: dto.answer.trim(),
      position: await this.findNextPosition(store.id),
      isPublished: dto.isPublished ?? true,
    });

    return this.faqRepository.save(faq);
  }

  /**
   * The dashboard list — unpublished entries included, that is the point. Not
   * paginated: `MAX_FAQS_PER_STORE` keeps the whole list one screen of JSON.
   */
  async list(user: JwtPayload): Promise<Faq[]> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.listOrdered(store.id);
  }

  async getById(user: JwtPayload, id: string): Promise<Faq> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.getScoped(store.id, id);
  }

  async update(user: JwtPayload, id: string, dto: UpdateFaqDto): Promise<Faq> {
    const store = await this.storeService.resolveCallerStore(user);
    const faq = await this.getScoped(store.id, id);

    if (dto.question !== undefined) {
      faq.question = dto.question.trim();
    }
    if (dto.answer !== undefined) {
      faq.answer = dto.answer.trim();
    }
    if (dto.isPublished !== undefined) {
      faq.isPublished = dto.isPublished;
    }

    return this.faqRepository.save(faq);
  }

  /** Hard delete: nothing references an FAQ row, so there is nothing to keep. */
  async remove(user: JwtPayload, id: string): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);
    const faq = await this.getScoped(store.id, id);
    await this.faqRepository.remove(faq);
  }

  /**
   * Applies the whole re-ordered list in one transaction. Every id is checked
   * against the store first: a partial reorder is worse than a rejected one.
   */
  async reorder(user: JwtPayload, dto: ReorderDto): Promise<Faq[]> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.assertIdsBelongToStore(
      store.id,
      dto.items.map((item) => item.id),
    );

    await this.faqRepository.manager.transaction(async (manager) => {
      for (const item of dto.items) {
        await manager.update(
          Faq,
          { id: item.id, storeId: store.id },
          { position: item.position },
        );
      }
    });

    return this.listOrdered(store.id);
  }

  /**
   * The storefront page: published entries of a live store, in the order the
   * owner arranged them. A draft slug 404s, because `resolvePublicStore` hides
   * it.
   */
  async listPublished(slug: string): Promise<Faq[]> {
    const { store } = await this.storeService.resolvePublicStore(slug);
    return this.listOrdered(store.id, { publishedOnly: true });
  }

  private async listOrdered(
    storeId: string,
    { publishedOnly = false }: { publishedOnly?: boolean } = {},
  ): Promise<Faq[]> {
    return this.faqRepository.find({
      where: publishedOnly ? { storeId, isPublished: true } : { storeId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  /** An FAQ entry of another store must look missing, never forbidden. */
  private async getScoped(storeId: string, id: string): Promise<Faq> {
    const faq = await this.faqRepository.findOne({ where: { id, storeId } });
    if (!faq) {
      throw new NotFoundException('FAQ entry not found');
    }
    return faq;
  }

  private async assertRoomForOneMore(storeId: string): Promise<void> {
    const total = await this.faqRepository.count({ where: { storeId } });
    if (total >= MAX_FAQS_PER_STORE) {
      throw new BadRequestException(
        `A store cannot have more than ${MAX_FAQS_PER_STORE} FAQ entries`,
      );
    }
  }

  private async assertIdsBelongToStore(
    storeId: string,
    ids: string[],
  ): Promise<void> {
    const found = await this.faqRepository.find({
      where: { storeId, id: In(ids) },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'Every FAQ entry must belong to your store and appear once',
      );
    }
  }

  /** A new entry lands at the end of the owner's list. */
  private async findNextPosition(storeId: string): Promise<number> {
    const row = await this.faqRepository
      .createQueryBuilder('faq')
      .select('MAX(faq.position)', 'max')
      .where('faq.storeId = :storeId', { storeId })
      .getRawOne<{ max: number | null }>();
    return Number(row?.max ?? -1) + 1;
  }
}
