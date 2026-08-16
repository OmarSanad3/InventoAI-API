import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { WEATHER_TIMEOUT_MS } from '../advisor.constants';
import type {
  DailyForecast,
  ForecastQuery,
  WeatherProvider,
} from './weather.provider';

/** Exactly the fields asked for, and nothing is trusted until it is checked. */
interface OpenMeteoResponse {
  daily?: {
    time?: unknown;
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    precipitation_sum?: unknown;
  };
}

/**
 * Open-Meteo: free, no signup, no key, no attribution requirement.
 *
 * That is why it was chosen over OpenWeather or WeatherAPI, which are both fine
 * services that would each add a secret, a signup and a rate limit to a feature
 * that degrades to nothing without them.
 *
 * Everything here fails loudly and quickly. `AbortSignal.timeout` caps the call
 * at `WEATHER_TIMEOUT_MS`, because a brief that is late is a brief nobody reads
 * — and the collector above turns any throw into a missing weather section
 * rather than a missing brief.
 */
@Injectable()
export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly name = 'open-meteo';
  private readonly logger = new Logger(OpenMeteoWeatherProvider.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async fetchDailyForecast({
    latitude,
    longitude,
    timezone,
    days,
  }: ForecastQuery): Promise<DailyForecast[]> {
    const url = this.buildUrl({ latitude, longitude, timezone, days });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Open-Meteo answered ${response.status} for ${latitude},${longitude}`,
      );
    }

    const body = (await response.json()) as OpenMeteoResponse;
    return this.parseDaily(body);
  }

  private buildUrl({
    latitude,
    longitude,
    timezone,
    days,
  }: ForecastQuery): string {
    const base = this.configService
      .get('ADVISOR_WEATHER_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      // Asking the API for the store's zone is what makes a `date` here the
      // same calendar day the rest of the brief is measured in.
      timezone,
      forecast_days: String(Math.max(1, Math.min(16, days))),
    });

    return `${base}/forecast?${params.toString()}`;
  }

  /**
   * Four parallel arrays, which is the shape Open-Meteo answers in. A row is
   * kept only when all four of its values are present and numeric: a partial
   * day is a sentence with a hole in it.
   */
  private parseDaily(body: OpenMeteoResponse): DailyForecast[] {
    const dates = body.daily?.time;
    const maxima = body.daily?.temperature_2m_max;
    const minima = body.daily?.temperature_2m_min;
    const rain = body.daily?.precipitation_sum;

    if (
      !Array.isArray(dates) ||
      !Array.isArray(maxima) ||
      !Array.isArray(minima) ||
      !Array.isArray(rain)
    ) {
      throw new Error('Open-Meteo returned a body without a daily forecast');
    }

    const forecasts: DailyForecast[] = [];

    for (const [index, date] of (dates as unknown[]).entries()) {
      const maxTempC: unknown = (maxima as unknown[])[index];
      const minTempC: unknown = (minima as unknown[])[index];
      const precipitationMm: unknown = (rain as unknown[])[index];

      if (
        typeof date !== 'string' ||
        typeof maxTempC !== 'number' ||
        typeof minTempC !== 'number' ||
        typeof precipitationMm !== 'number'
      ) {
        this.logger.debug(`Skipping an incomplete forecast day at ${index}`);
        continue;
      }

      forecasts.push({ date, maxTempC, minTempC, precipitationMm });
    }

    return forecasts;
  }
}
