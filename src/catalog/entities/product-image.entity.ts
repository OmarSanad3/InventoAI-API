import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Product } from './product.entity';

/**
 * One image of a product's gallery. A table rather than a `jsonb` array on
 * `Product`, because images are reordered and deleted individually and a jsonb
 * array turns both into read-modify-write races between two dashboard tabs.
 */
@Entity('product_images')
@Index('IDX_product_images_product_position', ['productId', 'position'])
export class ProductImage {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Product, (product) => product.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column('uuid')
  productId!: string;

  @Column()
  url!: string;

  /** Required to destroy the Cloudinary asset. */
  @Column()
  publicId!: string;

  /** `position = 0` is the primary image. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  altText!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
