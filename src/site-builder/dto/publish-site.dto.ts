import { IsUUID } from 'class-validator';

export class PublishSiteDto {
  @IsUUID()
  themeId!: string;
}
