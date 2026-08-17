import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { EnvironmentVariables } from '../config/env.validation';
import {
  buildAdvisorBriefEmail,
  type BriefEmailLine,
} from './templates/advisor-brief-email.template';
import { buildOtpEmail, MailBrand } from './templates/otp-email.template';
import {
  buildSupplierDecisionEmail,
  type SupplierDecision,
} from './templates/supplier-decision-email.template';
import { buildSupplierRequestEmail } from './templates/supplier-request-email.template';

export type OtpPurpose = 'verify-email' | 'reset-password';

export interface SendOtpEmailCommand {
  readonly to: string;
  readonly otp: string;
  readonly purpose: OtpPurpose;
  readonly brand: MailBrand;
}

export interface SendAdvisorBriefCommand {
  readonly to: string;
  readonly brand: MailBrand;
  readonly headline: string;
  readonly lines: readonly BriefEmailLine[];
  readonly dashboardUrl: string;
}

export interface SendSupplierRequestCommand {
  readonly to: string;
  readonly brand: MailBrand;
  readonly supplierName: string;
  readonly subject: string;
  readonly body: string;
  /** The owner's address — where a reply has to land. */
  readonly replyToEmail: string;
}

export interface SendSupplierDecisionCommand {
  readonly to: string;
  readonly brand: MailBrand;
  readonly supplierName: string;
  readonly outcome: SupplierDecision;
  readonly itemLabel: string;
  /** Already formatted; empty for a decline. */
  readonly terms: readonly string[];
  readonly replyToEmail: string;
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

  /**
   * The Daily AI Advisor's brief — the platform's first non-OTP mail.
   *
   * A method of its own rather than a widening of `OtpPurpose`: that union is
   * about verification codes, and a brief shares the branded shell with it and
   * nothing else.
   */
  async sendAdvisorBrief({
    to,
    brand,
    headline,
    lines,
    dashboardUrl,
  }: SendAdvisorBriefCommand): Promise<void> {
    const { html, text } = buildAdvisorBriefEmail({
      brand,
      headline,
      lines,
      dashboardUrl,
    });

    await this.transporter.sendMail({
      from: this.configService.get('MAIL_FROM', { infer: true }),
      to,
      // The headline is the subject: an owner deciding whether to open this on
      // a phone should not have to.
      subject: `${headline} — ${brand.name}`,
      text,
      html,
    });
  }

  /**
   * A purchase request, on its way to one supplier.
   *
   * `replyTo` is the point of this method: the platform's mailbox sends it, and
   * a supplier who hits reply must reach the **owner**, not `MAIL_FROM`. Until
   * inbound ingestion exists, that reply is what the owner pastes back into the
   * dashboard.
   */
  async sendSupplierRequest({
    to,
    brand,
    supplierName,
    subject,
    body,
    replyToEmail,
  }: SendSupplierRequestCommand): Promise<void> {
    const { html, text } = buildSupplierRequestEmail({
      brand,
      supplierName,
      body,
      replyToEmail,
    });

    await this.transporter.sendMail({
      from: this.configService.get('MAIL_FROM', { infer: true }),
      to,
      replyTo: replyToEmail,
      subject,
      text,
      html,
    });
  }

  /** The two mails that close a deal: the confirmation, and the declines. */
  async sendSupplierDecision({
    to,
    brand,
    supplierName,
    outcome,
    itemLabel,
    terms,
    replyToEmail,
  }: SendSupplierDecisionCommand): Promise<void> {
    const { html, text } = buildSupplierDecisionEmail({
      brand,
      supplierName,
      outcome,
      itemLabel,
      terms,
      replyToEmail,
    });

    await this.transporter.sendMail({
      from: this.configService.get('MAIL_FROM', { infer: true }),
      to,
      replyTo: replyToEmail,
      subject:
        outcome === 'confirmed'
          ? `Order confirmed: ${itemLabel} — ${brand.name}`
          : `Thank you for your quote: ${itemLabel} — ${brand.name}`,
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
