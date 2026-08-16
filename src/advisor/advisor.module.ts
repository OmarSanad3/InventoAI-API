import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrdersModule } from '../orders/orders.module';
import { Store } from '../site-builder/entities/store.entity';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { User } from '../users/entities/user.entity';
import { AdvisorController } from './advisor.controller';
import { AdvisorBriefService } from './advisor-brief.service';
import { AdvisorMailService } from './advisor-mail.service';
import { AdvisorNarrator } from './advisor-narrator.service';
import { AdvisorScheduler } from './advisor-scheduler.service';
import { AdvisorService } from './advisor.service';
import { AdvisorSettingsService } from './advisor-settings.service';
import { CalendarSignalCollector } from './collectors/calendar-signal.collector';
import { DemandGapCollector } from './collectors/demand-gap.collector';
import { SalesSignalCollector } from './collectors/sales-signal.collector';
import { StockSignalCollector } from './collectors/stock-signal.collector';
import { WeatherSignalCollector } from './collectors/weather-signal.collector';
import { AdvisorBrief } from './entities/advisor-brief.entity';
import { AdvisorInsight } from './entities/advisor-insight.entity';
import { AdvisorSettings } from './entities/advisor-settings.entity';
import { OpenMeteoWeatherProvider } from './providers/open-meteo-weather.provider';
import { WEATHER_PROVIDER } from './providers/weather.provider';

/**
 * The Daily AI Advisor: the reader that turns what the rest of the platform
 * already recorded into a short brief an owner acts on.
 *
 * **Nothing imports this module.** It is the leaf of the dependency graph, and
 * keeping it there is what stops the next feature from reaching into a brief
 * instead of into the signal it actually wants. No `forwardRef` is needed
 * anywhere here, and none should ever appear.
 *
 * Every import is for a service that already owns the rule being asked about —
 * `OrderAnalyticsService` knows what counts as a sale, `ProductService` knows
 * which products are sellable, `ChatInsightsService` knows what shoppers asked
 * for. This module owns three entities and not one rule about products, orders
 * or conversations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdvisorBrief,
      AdvisorInsight,
      AdvisorSettings,
      Store,
      User,
    ]),
    AuthModule,
    SiteBuilderModule,
    CatalogModule,
    OrdersModule,
    ChatbotModule,
    AiModule,
  ],
  controllers: [AdvisorController],
  providers: [
    AdvisorBriefService,
    AdvisorMailService,
    AdvisorNarrator,
    AdvisorScheduler,
    AdvisorService,
    AdvisorSettingsService,
    CalendarSignalCollector,
    DemandGapCollector,
    SalesSignalCollector,
    StockSignalCollector,
    WeatherSignalCollector,
    RolesGuard,
    // One adapter behind the port, so a test can swap it for a stub without
    // touching the collector that reads it.
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoWeatherProvider },
  ],
})
export class AdvisorModule {}
