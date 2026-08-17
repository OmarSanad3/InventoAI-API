import { Supplier } from '../entities/supplier.entity';

/**
 * The dashboard's view of a supplier. `storeId` is omitted, as everywhere else:
 * the caller already knows their store, and exposing it only invites the
 * mistake of accepting it back on write.
 */
export class SupplierResponseDto {
  id!: string;
  name!: string;
  contactEmail!: string;
  phone!: string | null;
  leadTimeDays!: number;
  notes!: string | null;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(supplier: Supplier): SupplierResponseDto {
    const dto = new SupplierResponseDto();
    dto.id = supplier.id;
    dto.name = supplier.name;
    dto.contactEmail = supplier.contactEmail;
    dto.phone = supplier.phone;
    dto.leadTimeDays = supplier.leadTimeDays;
    dto.notes = supplier.notes;
    dto.isActive = supplier.isActive;
    dto.createdAt = supplier.createdAt;
    dto.updatedAt = supplier.updatedAt;
    return dto;
  }
}
