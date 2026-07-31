import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { SpartanPreset } from '../enums/spartan-preset.enum';
import { ThemeFont } from '../enums/theme-font.enum';
import type { Palette, Theme } from '../types/theme';
import { Store } from './store.entity';

/**
 * One AI-suggested theme. The structured palette is stored rather than the CSS,
 * so changing the token set never needs a data migration — the CSS is derived on
 * read by `buildThemeCss`.
 */
@Entity('store_themes')
export class StoreTheme implements Theme {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, (store) => store.themes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column({ type: 'enum', enum: SpartanPreset })
  style!: SpartanPreset;

  @Column({ type: 'enum', enum: ThemeFont })
  font!: ThemeFont;

  @Column()
  radius!: string;

  @Column({ type: 'jsonb' })
  light!: Palette;

  @Column({ type: 'jsonb' })
  dark!: Palette;

  @Column({ default: false })
  isSelected!: boolean;

  @Column({ type: 'int', default: 1 })
  generation!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
