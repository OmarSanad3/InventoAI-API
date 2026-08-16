import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import { MailService } from '../mail/mail.service';
import type { BriefEmailLine } from '../mail/templates/advisor-brief-email.template';
import { Store } from '../site-builder/entities/store.entity';
import { AdvisorBrief } from './entities/advisor-brief.entity';
import { AdvisorInsight } from './entities/advisor-insight.entity';

/**
 * Turns a brief into the email of it.
 *
 * A thin service rather than code inside the scheduler, for one reason worth
 * the file: the brand a brief is sent under is the **store's**, not the
 * platform's, and working that out — the store's own name and logo, falling
 * back to a text header when the logo is missing — is a decision, not a
 * parameter.
 */
@Injectable()
export class AdvisorMailService {
  constructor(
    private readonly mailService: MailService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async sendBriefEmail({
    to,
    store,
    brief,
    insights,
  }: {
    to: string;
    store: Store;
    brief: AdvisorBrief;
    insights: readonly AdvisorInsight[];
  }): Promise<void> {
    const lines: BriefEmailLine[] = [...insights]
      .sort((a, b) => a.position - b.position)
      .map((insight) => ({
        title: insight.title,
        body: insight.body,
        severity: insight.severity,
      }));

    await this.mailService.sendAdvisorBrief({
      to,
      // The owner's own shop, because that is whose numbers these are.
      brand: { name: store.name, logoUrl: store.logoUrl },
      headline: brief.headline,
      lines,
      dashboardUrl: this.buildDashboardUrl(store.slug),
    });
  }

  private buildDashboardUrl(slug: string): string {
    const base = this.configService
      .get('SITE_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    return `${base}/${slug}/dashboard/advisor`;
  }
}
