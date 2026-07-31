import { StoreStatus } from '../enums/store-status.enum';

export class PublishSiteResponseDto {
  slug!: string;
  status!: StoreStatus;
  storeUrl!: string;
}
