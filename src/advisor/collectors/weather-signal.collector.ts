import { Inject, Injectable } from '@nestjs/common';
import {
  COLD_SNAP_TEMP_C,
  HEATWAVE_TEMP_C,
  HEAVY_RAIN_MM,
  WEATHER_LOOKAHEAD_DAYS,
} from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import type {
  AdvisorSignal,
  WeatherAnomaly,
} from '../types/advisor-signal.type';
import {
  WEATHER_PROVIDER,
  type DailyForecast,
  type WeatherProvider,
} from '../providers/weather.provider';
import type {
  CollectorContext,
  SignalCollector,
} from './signal-collector.interface';

/**
 * The week's weather, but only when it is worth a sentence.
 *
 * "It will be 24°C on Thursday" is not advice. Only the anomalies are: a
 * heatwave moves cold drinks and summer wear to the homepage, a cold snap does
 * the opposite, and heavy rain moves the traffic to delivery.
 *
 * **A store with no coordinates gets no weather section and no outbound
 * request.** That is the whole feature's rule in one line — a signal that
 * cannot be computed is absent, never guessed — and it is also why the location
 * is asked for rather than inferred from customers' shipping addresses.
 */
@Injectable()
export class WeatherSignalCollector implements SignalCollector {
  readonly name = 'weather';

  constructor(
    @Inject(WEATHER_PROVIDER)
    private readonly weatherProvider: WeatherProvider,
  ) {}

  async collect({
    settings,
    timezone,
  }: CollectorContext): Promise<AdvisorSignal[]> {
    const { latitude, longitude } = settings;
    if (latitude === null || longitude === null) {
      return [];
    }

    const forecasts = await this.weatherProvider.fetchDailyForecast({
      latitude,
      longitude,
      timezone,
      days: WEATHER_LOOKAHEAD_DAYS,
    });

    const found = new Map<WeatherAnomaly, AdvisorSignal>();

    for (const forecast of forecasts) {
      const anomaly = classify(forecast);
      // One line per kind of anomaly, and the first — soonest — day wins. Three
      // hot days in a row is one heatwave, not three insights.
      if (!anomaly || found.has(anomaly)) {
        continue;
      }
      found.set(anomaly, buildSignal(anomaly, forecast));
    }

    return [...found.values()];
  }
}

function classify(forecast: DailyForecast): WeatherAnomaly | null {
  if (forecast.maxTempC >= HEATWAVE_TEMP_C) {
    return 'heatwave';
  }
  if (forecast.minTempC <= COLD_SNAP_TEMP_C) {
    return 'cold_snap';
  }
  if (forecast.precipitationMm >= HEAVY_RAIN_MM) {
    return 'rain';
  }
  return null;
}

function buildSignal(
  anomaly: WeatherAnomaly,
  forecast: DailyForecast,
): AdvisorSignal {
  return {
    kind: AdvisorInsightKind.Weather,
    severity: AdvisorSeverity.Info,
    // The date is in the key: yesterday's heatwave and next week's are two
    // different pieces of advice, and dismissing one must not hide the other.
    dedupeKey: `weather:${anomaly}:${forecast.date}`,
    impactAmount: 0,
    payload: {
      anomaly,
      maxTempC: forecast.maxTempC,
      minTempC: forecast.minTempC,
      precipitationMm: forecast.precipitationMm,
      onDate: forecast.date,
    },
  };
}
