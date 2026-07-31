import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import { EnvironmentVariables } from '../config/env.validation';

export interface UploadImageOptions {
  readonly buffer: Buffer;
  readonly subfolder: string;
  /** Format of the buffer, when it should not be sniffed from the bytes. */
  readonly uploadFormat?: string;
  /** Delivery format to convert to, e.g. `png` for an uploaded SVG. */
  readonly deliveryFormat?: string;
}

export interface UploadedImage {
  readonly url: string;
  readonly publicId: string;
}

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME', {
        infer: true,
      }),
      api_key: this.configService.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET', {
        infer: true,
      }),
      secure: true,
    });
  }

  /**
   * Uploads an image buffer and returns its delivery URL and public id. The
   * public id is what makes a later replace or delete possible.
   */
  async uploadImage({
    buffer,
    subfolder,
    uploadFormat,
    deliveryFormat,
  }: UploadImageOptions): Promise<UploadedImage> {
    const uploaded = await this.upload(
      buffer,
      this.buildFolder(subfolder),
      uploadFormat,
    );
    return {
      publicId: uploaded.public_id,
      url: deliveryFormat
        ? cloudinary.url(uploaded.public_id, {
            secure: true,
            format: deliveryFormat,
          })
        : uploaded.secure_url,
    };
  }

  /** Best-effort delete — a leaked asset must never fail the request. */
  async destroyImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      this.logger.warn(`Could not delete asset ${publicId}: ${String(err)}`);
    }
  }

  private async upload(
    buffer: Buffer,
    folder: string,
    format?: string,
  ): Promise<UploadApiResponse> {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image', format },
        (error, result) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload failed: ${error?.message ?? 'no result returned'}`,
            );
            reject(
              new ServiceUnavailableException(
                'Could not upload the image, please try again later',
              ),
            );
            return;
          }
          resolve(result);
        },
      );
      stream.end(buffer);
    });
  }

  private buildFolder(subfolder: string): string {
    const root = this.configService.get('CLOUDINARY_FOLDER', { infer: true });
    return `${root}/${subfolder}`;
  }
}
