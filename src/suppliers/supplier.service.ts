import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Not, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StoreService } from '../site-builder/store.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Supplier } from './entities/supplier.entity';
import { MAX_SUPPLIERS_PER_STORE } from './suppliers.constants';

/**
 * Owns the `Supplier` row, and nothing else. Every method resolves the caller's
 * store first and scopes its query by that id, so a supplier of another store is
 * invisible rather than forbidden.
 *
 * Deliberately plain: this half of the feature is a contact book, and the
 * interesting rules all live one file over in `PurchaseRequestService`.
 */
@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    private readonly storeService: StoreService,
  ) {}

  async create(user: JwtPayload, dto: CreateSupplierDto): Promise<Supplier> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.assertRoomForOneMore(store.id);

    const contactEmail = normalizeEmail(dto.contactEmail);
    await this.assertEmailIsFree(store.id, contactEmail);

    const supplier = this.supplierRepository.create({
      storeId: store.id,
      name: dto.name.trim(),
      contactEmail,
      phone: dto.phone?.trim() || null,
      leadTimeDays: dto.leadTimeDays,
      notes: dto.notes?.trim() || null,
      isActive: dto.isActive ?? true,
    });

    return this.supplierRepository.save(supplier);
  }

  async list(
    user: JwtPayload,
    query: ListSuppliersQueryDto,
  ): Promise<{ items: Supplier[]; total: number }> {
    const store = await this.storeService.resolveCallerStore(user);

    const where = {
      storeId: store.id,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    // Two `where` objects rather than one: TypeORM ORs an array, which is what
    // "the name or the email matches" needs.
    const search = query.search?.trim();

    const [items, total] = await this.supplierRepository.findAndCount({
      where: search
        ? [
            { ...where, name: ILike(`%${search}%`) },
            { ...where, contactEmail: ILike(`%${search}%`) },
          ]
        : where,
      order: { name: 'ASC', createdAt: 'ASC' },
      skip: query.offset,
      take: query.limit,
    });

    return { items, total };
  }

  async getById(user: JwtPayload, id: string): Promise<Supplier> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.getScoped(store.id, id);
  }

  async update(
    user: JwtPayload,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<Supplier> {
    const store = await this.storeService.resolveCallerStore(user);
    const supplier = await this.getScoped(store.id, id);

    if (dto.name !== undefined) {
      supplier.name = dto.name.trim();
    }
    if (dto.contactEmail !== undefined) {
      const contactEmail = normalizeEmail(dto.contactEmail);
      await this.assertEmailIsFree(store.id, contactEmail, supplier.id);
      supplier.contactEmail = contactEmail;
    }
    if (dto.phone !== undefined) {
      supplier.phone = dto.phone?.trim() || null;
    }
    if (dto.leadTimeDays !== undefined) {
      supplier.leadTimeDays = dto.leadTimeDays;
    }
    if (dto.notes !== undefined) {
      supplier.notes = dto.notes?.trim() || null;
    }
    if (dto.isActive !== undefined) {
      supplier.isActive = dto.isActive;
    }

    return this.supplierRepository.save(supplier);
  }

  /**
   * Soft delete: a purchase request points at this row, and removing a supplier
   * must not take last quarter's deals with them. The offer's own snapshot is
   * what keeps those readable; this keeps the link.
   */
  async remove(user: JwtPayload, id: string): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);
    const supplier = await this.getScoped(store.id, id);
    await this.supplierRepository.softRemove(supplier);
  }

  /**
   * The recipients of a request, resolved from the ids the owner picked.
   *
   * Store-scoped and **active only**: an inactive supplier is one the owner has
   * stopped dealing with, and a stale dashboard tab must not mail them. The
   * caller passes a `storeId` it has already resolved, so this method resolves
   * no caller of its own.
   */
  async findActiveByIds(
    storeId: string,
    ids: readonly string[],
  ): Promise<Supplier[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.supplierRepository.find({
      where: { storeId, isActive: true, id: In([...ids]) },
    });
  }

  /** A supplier of another store must look missing, never forbidden. */
  private async getScoped(storeId: string, id: string): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({
      where: { id, storeId },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  private async assertRoomForOneMore(storeId: string): Promise<void> {
    const total = await this.supplierRepository.count({ where: { storeId } });
    if (total >= MAX_SUPPLIERS_PER_STORE) {
      throw new BadRequestException(
        `A store cannot have more than ${MAX_SUPPLIERS_PER_STORE} suppliers`,
      );
    }
  }

  /**
   * One address, one supplier — otherwise a request mails the same inbox twice
   * and the comparison table shows the same firm competing with itself. The
   * partial unique index enforces it; this is what turns the violation into a
   * sentence.
   */
  private async assertEmailIsFree(
    storeId: string,
    contactEmail: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.supplierRepository.findOne({
      where: {
        storeId,
        contactEmail,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        `A supplier with the email ${contactEmail} already exists`,
      );
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
