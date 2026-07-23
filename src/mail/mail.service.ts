import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EnvironmentVariables } from '../config/env.validation';

export type OtpPurpose = 'verify-email' | 'reset-password';

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

  async sendOtpEmail(
    to: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const { subject, intro } = this.buildContent(purpose);
    const expiresInMinutes = Math.round(
      this.configService.get('OTP_EXPIRES_IN_SECONDS', { infer: true }) / 60,
    );

    await this.transporter.sendMail({
      from: this.configService.get('MAIL_FROM', { infer: true }),
      to,
      subject,
      text: `${intro}\n\nYour verification code is: ${otp}\n\nThis code expires in ${expiresInMinutes} minute(s).`,
      html: `<p>${intro}</p><p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in ${expiresInMinutes} minute(s).</p>`,
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
