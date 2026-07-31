import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EnvironmentVariables } from '../config/env.validation';
import { buildOtpEmail, MailBrand } from './templates/otp-email.template';

export type OtpPurpose = 'verify-email' | 'reset-password';

export interface SendOtpEmailCommand {
  readonly to: string;
  readonly otp: string;
  readonly purpose: OtpPurpose;
  readonly brand: MailBrand;
}

@Injectable()
export class MailService implements OnModuleInit {
  private transporter!: Transporter;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    const port = this.configService.get('MAIL_PORT', { infer: true });
    this.transporter = createTransport({
      host: this.configService.get('MAIL_HOST', { infer: true }),
      port,
      secure: port === 465,
      auth: {
        user: this.configService.get('MAIL_USER', { infer: true }),
        pass: this.configService.get('MAIL_PASSWORD', { infer: true }),
      },
    });
  }

  /** Sends the OTP branded as `brand` — InventoAI, or the recipient's store. */
  async sendOtpEmail({
    to,
    otp,
    purpose,
    brand,
  }: SendOtpEmailCommand): Promise<void> {
    const { subject, intro } = this.buildContent(purpose);
    const expiresInMinutes = Math.round(
      this.configService.get('OTP_EXPIRES_IN_SECONDS', { infer: true }) / 60,
    );
    const { html, text } = buildOtpEmail({
      brand,
      intro,
      otp,
      expiresInMinutes,
    });

    await this.transporter.sendMail({
      from: this.configService.get('MAIL_FROM', { infer: true }),
      to,
      subject: `${subject} — ${brand.name}`,
      text,
      html,
    });
  }

  private buildContent(purpose: OtpPurpose): {
    subject: string;
    intro: string;
  } {
    if (purpose === 'verify-email') {
      return {
        subject: 'Verify your email',
        intro: 'Use the code below to verify your email address.',
      };
    }
    return {
      subject: 'Reset your password',
      intro: 'Use the code below to reset your password.',
    };
  }
}
