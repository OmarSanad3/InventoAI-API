/**
 * The port a forecast arrives through.
 *
 * It exists for the same reason `EmbeddingProvider` and the payment provider do:
 * the adapter is a third party, and the seam is worth having before one is
 * swapped rather than after. One adapter ships — `OpenMeteoWeatherProvider`,
 * which needs no key and no signup.
 */

/** One day of forecast, reduced to what a shop needs to know. */
export interface DailyForecast {
  /** `YYYY-MM-DD` in the store's own timezone. */
  date: string;
  maxTempC: number;
  minTempC: number;
  precipitationMm: number;
}

export interface ForecastQuery {
  latitude: number;
  longitude: number;
  timezone: string;
  days: number;
}

export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');

export interface WeatherProvider {
  readonly name: string;
  /**
   * Days ordered soonest first. **Throws** on anything it cannot trust — a
   * non-2xx, a timeout, a body it cannot parse — because the collector above it
   * turns a failure into a missing section, and a half-parsed forecast would
   * turn it into a wrong sentence instead.
   */
  fetchDailyForecast(query: ForecastQuery): Promise<DailyForecast[]>;
}
