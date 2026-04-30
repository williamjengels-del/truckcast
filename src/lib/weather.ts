import type { WeatherType } from "./database.types";
import { US_STATE_NAMES } from "./constants";

/**
 * Normalize a city name before sending to Open-Meteo's geocoding API.
 *
 * Open-Meteo stores "St Louis, Missouri" but NOT "Saint Louis, Missouri".
 * Searching "saint louis" returns Saint Louis, Michigan (pop 7K) first.
 * Searching "st louis" returns St Louis, Missouri (pop 315K) first.
 *
 * This also strips trailing state abbreviations (", MO") so we're just
 * sending the city name.
 */
export function normalizeCityForGeocoding(city: string): string {
  return city
    .replace(/\bsaint\b/gi, "St") // "Saint Louis" → "St Louis"
    .replace(/,\s*[A-Za-z]{2}$/, "") // strip ", MO" / ", IL" etc.
    .trim();
}

/**
 * Geocode a city name to latitude/longitude using Open-Meteo's free geocoding API.
 * Returns null if the city can't be found.
 *
 * When a US state code is provided (e.g. "MO", "IL"), results are
 * narrowed to that state via Open-Meteo's `admin1` field before the
 * population-weighted pick. Disambiguates "Saint Louis, Missouri"
 * from "Saint Louis Park, Minnesota" etc. — historically the highest-
 * population-first fallback picked correctly for major cities but
 * silently returned wrong coordinates for smaller cities that share
 * their name with a major one in another state.
 * When state is omitted / "OTHER" / unknown code, the original
 * country-wide population-weighted pick is used (preserves existing
 * behavior for historical callers).
 */
export async function geocodeCity(
  city: string,
  state?: string | null
): Promise<{ latitude: number; longitude: number } | null> {
  if (!city.trim()) return null;
  try {
    const normalized = normalizeCityForGeocoding(city);
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalized)}&count=10&country_code=us&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const allResults = data.results as
      | Array<{
          latitude: number;
          longitude: number;
          population?: number;
          admin1?: string;
          feature_code?: string;
        }>
      | undefined;
    if (!allResults || allResults.length === 0) return null;

    // State filter — HARD CONSTRAINT when a known US code is provided.
    // Open-Meteo doesn't support server-side admin1 filtering, so we
    // filter client-side. If the filter eliminates all candidates we
    // return null — silent cross-state fallback (the prior behavior)
    // produced incorrect coordinates when the operator's city input
    // was a typo or didn't exist in the target state. Better to show
    // "no weather" than to silently mis-populate with another state's
    // data. See Issue 1 from Commit A smoke test for the bug this
    // fixes: city="Bellville" + state=IL → Open-Meteo returns
    // Bellville, Texas → old code silently picked Texas → weather
    // for the wrong event.
    let candidates = allResults;
    if (state && state !== "OTHER") {
      const fullName = US_STATE_NAMES[state.toUpperCase()];
      if (fullName) {
        candidates = allResults.filter(
          (r) => r.admin1?.toLowerCase() === fullName.toLowerCase()
        );
        if (candidates.length === 0) return null;
      }
    }

    // Prefer populated-place (PPL*) feature codes over airports,
    // landmarks, etc. Open-Meteo's feature_code field uses GeoNames
    // codes: PPL, PPLA, PPLA2..PPLA4, PPLC, PPLL, PPLS, PPLF all
    // denote populated places; AIRP, PRK, HTL, etc. do not. A city
    // with a small airport nearby sometimes returns the airport first
    // on population. See Issue 1 smoke test: city="Saint Charles" +
    // state=MO → returned "St Charles County Smartt Airport" instead
    // of the city. Falling back to all state-matched candidates if no
    // PPL match (airport is still state-correct — better than null).
    const pplMatches = candidates.filter((r) =>
      r.feature_code?.startsWith("PPL")
    );
    const ranked = pplMatches.length > 0 ? pplMatches : candidates;

    // Pick highest-population match — avoids small towns over major cities
    const best = ranked.reduce((a, b) =>
      (b.population ?? 0) > (a.population ?? 0) ? b : a
    );
    return { latitude: best.latitude, longitude: best.longitude };
  } catch {
    return null;
  }
}

/**
 * Given a city, state, and date, resolve coordinates and return the
 * weather classification. Returns null if geocoding fails or weather
 * is unavailable (e.g. > 16 days out). Uses Supabase client for
 * weather_cache reads/writes.
 *
 * state is optional for backward compatibility, but callers from the
 * event save path should always provide it — the state filter inside
 * geocodeCity is what makes weather classification reliable.
 */
export async function autoClassifyWeather(
  city: string,
  date: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  state?: string | null
): Promise<{ classification: WeatherType; latitude: number; longitude: number } | null> {
  const coords = await geocodeCity(city, state);
  if (!coords) return null;
  const result = await getWeatherForEvent(coords.latitude, coords.longitude, date, supabase);
  if (!result) return null;
  return { classification: result.classification, ...coords };
}

interface WeatherData {
  maxTempF: number;
  minTempF: number;
  precipitationIn: number;
  prevDayPrecipIn: number;
}

/**
 * Classify weather based on the algorithm in truckcast-technical-spec.json.
 * Priority-based classification.
 */
export function classifyWeather(data: WeatherData): WeatherType {
  // Priority 1: Snow
  if (data.maxTempF <= 32 && data.precipitationIn > 0.1) {
    return "Snow";
  }
  // Priority 2: Storms
  if (data.precipitationIn >= 1.0) {
    return "Storms";
  }
  // Priority 3: Rain During Event
  if (data.precipitationIn >= 0.25) {
    return "Rain During Event";
  }
  // Priority 4: Hot
  if (data.maxTempF >= 90) {
    return "Hot";
  }
  // Priority 5: Cold
  if (data.maxTempF <= 40) {
    return "Cold";
  }
  // Priority 6: Light rain
  if (data.precipitationIn >= 0.05 && data.precipitationIn < 0.25) {
    return "Rain Before Event";
  }
  // Priority 7: Previous day rain
  if (data.prevDayPrecipIn >= 0.25 && data.precipitationIn < 0.05) {
    return "Rain Before Event";
  }
  // Priority 8: Default
  return "Clear";
}

/**
 * Fetch weather data from Open-Meteo API (free, no API key required).
 * Returns weather for a given latitude/longitude and date.
 */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  date: string
): Promise<WeatherData | null> {
  try {
    // For dates in the past, use historical API. For future dates within 16 days, use forecast.
    const today = new Date();
    const targetDate = new Date(date);
    const daysDiff = Math.ceil(
      (targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    let url: string;
    if (daysDiff > 16) {
      // Too far in the future for weather forecast
      return null;
    } else if (daysDiff > 0) {
      // Future: use forecast API
      url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&start_date=${date}&end_date=${date}&timezone=auto`;
    } else {
      // Past or today: use historical/archive API
      // Calculate previous day for prev_day_precip
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().split("T")[0];

      url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&start_date=${prevDateStr}&end_date=${date}&timezone=auto`;
    }

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const daily = data.daily;

    if (!daily || !daily.time || daily.time.length === 0) return null;

    // For historical, we may have 2 days (prev + target)
    const targetIdx = daily.time.indexOf(date);
    if (targetIdx === -1) return null;

    const maxTempF = daily.temperature_2m_max[targetIdx];
    const minTempF = daily.temperature_2m_min[targetIdx];
    const precipitationIn = daily.precipitation_sum[targetIdx];

    // Previous day precipitation
    let prevDayPrecipIn = 0;
    if (targetIdx > 0) {
      prevDayPrecipIn = daily.precipitation_sum[targetIdx - 1] ?? 0;
    }

    return {
      maxTempF: maxTempF ?? 70,
      minTempF: minTempF ?? 50,
      precipitationIn: precipitationIn ?? 0,
      prevDayPrecipIn,
    };
  } catch {
    return null;
  }
}

export interface HourlyWeatherEntry {
  hour: number; // 0..23 operator-local
  tempF: number;
  weatherCode: number; // WMO code
  windMph: number;
  precipIn: number;
}

/**
 * Fetch hourly weather for a given lat/lon/date from Open-Meteo.
 *
 * Open-Meteo's `&timezone=auto` makes the returned `time` array land
 * in the location's local time, so positions 0-23 in the response
 * correspond to operator-local hours 0-23. We don't need to do tz
 * math on the client — the API hands us aligned data.
 *
 * Free tier, no API key. Same endpoint as the daily fetch (we just
 * pass `hourly=...` instead of / alongside `daily=...`).
 *
 * Returns null when:
 *  - The date is > 16 days out (no forecast available)
 *  - The request fails or returns malformed data
 *
 * Cache is populated lazily via getHourlyWeatherForEvent below; this
 * raw-fetch helper is exported for tests / direct calls but is not
 * the recommended call path.
 */
export async function fetchHourlyWeather(
  latitude: number,
  longitude: number,
  date: string
): Promise<HourlyWeatherEntry[] | null> {
  try {
    const today = new Date();
    const targetDate = new Date(date);
    const daysDiff = Math.ceil(
      (targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff > 16 || daysDiff < -7) {
      // Forecast horizon is 16 days; archive API supports historical
      // hourly but we don't need it for the day-of card. Cap at -7
      // days to give a small grace window for stale-cache reads.
      return null;
    }

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}` +
      `&longitude=${longitude}` +
      `&hourly=temperature_2m,weather_code,wind_speed_10m,precipitation` +
      `&temperature_unit=fahrenheit` +
      `&wind_speed_unit=mph` +
      `&precipitation_unit=inch` +
      `&start_date=${date}` +
      `&end_date=${date}` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const h = data.hourly;
    if (!h || !Array.isArray(h.time) || h.time.length === 0) return null;

    const out: HourlyWeatherEntry[] = [];
    for (let i = 0; i < h.time.length; i++) {
      const ts = String(h.time[i] ?? "");
      // h.time entries look like "2026-04-29T11:00"; the hour is at
      // position 11-12 in that string. timezone=auto puts these in
      // operator-local time so direct slicing is correct.
      const hourPart = ts.slice(11, 13);
      const hour = Number.parseInt(hourPart, 10);
      if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
      out.push({
        hour,
        tempF: Number(h.temperature_2m?.[i] ?? 0),
        weatherCode: Number(h.weather_code?.[i] ?? 0),
        windMph: Number(h.wind_speed_10m?.[i] ?? 0),
        precipIn: Number(h.precipitation?.[i] ?? 0),
      });
    }
    if (out.length === 0) return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * Fetch hourly weather with caching via the weather_cache.hourly_data
 * jsonb column (migration 20260430000002). Reuses the same
 * (date, lat, lon) row as the daily cache.
 */
export async function getHourlyWeatherForEvent(
  latitude: number,
  longitude: number,
  date: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<HourlyWeatherEntry[] | null> {
  // Reuse the same geographic-radius match as getWeatherForEvent.
  const { data: cached } = await supabase
    .from("weather_cache")
    .select("hourly_data")
    .eq("date", date)
    .gte("latitude", latitude - 0.1)
    .lte("latitude", latitude + 0.1)
    .gte("longitude", longitude - 0.1)
    .lte("longitude", longitude + 0.1)
    .maybeSingle();

  if (cached?.hourly_data && Array.isArray(cached.hourly_data) && cached.hourly_data.length > 0) {
    return cached.hourly_data as HourlyWeatherEntry[];
  }

  const fetched = await fetchHourlyWeather(latitude, longitude, date);
  if (!fetched) return null;

  // Upsert. If the row exists from an earlier daily fetch, we just
  // populate the new column; if not, the daily fields stay null and
  // a future daily fetch will fill them. The unique constraint is on
  // (date, latitude, longitude), so the upsert key matches.
  await supabase.from("weather_cache").upsert(
    {
      date,
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
      hourly_data: fetched,
      fetched_hourly_at: new Date().toISOString(),
    },
    { onConflict: "date,latitude,longitude" }
  );

  return fetched;
}

/**
 * Map a WMO weather code to a short condition label.
 * https://open-meteo.com/en/docs#weathervariables — WMO Weather
 * interpretation codes. We collapse to 6 short buckets so the UI
 * label stays compact at small widths.
 */
export function wmoCodeToCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code >= 45 && code <= 48) return "Fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "Rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 95) return "Storm";
  return "—";
}

/**
 * Slice an hourly array down to the operator's service window.
 * start/end are HH:MM wall-clock strings (events.start_time /
 * end_time). Inclusive of both endpoints' hour bucket — i.e. an
 * 11:30-13:30 service window returns hours 11, 12, 13.
 */
export function sliceHourlyToServiceWindow(
  hourly: HourlyWeatherEntry[],
  startTime: string | null,
  endTime: string | null
): HourlyWeatherEntry[] {
  if (!startTime && !endTime) return hourly;
  const startHour = startTime ? Number(startTime.split(":")[0]) : 0;
  const endHour = endTime ? Number(endTime.split(":")[0]) : 23;
  if (Number.isNaN(startHour) || Number.isNaN(endHour)) return hourly;
  return hourly.filter((h) => h.hour >= startHour && h.hour <= endHour);
}

/**
 * Fetch weather and classify it, with caching via Supabase.
 */
export async function getWeatherForEvent(
  latitude: number,
  longitude: number,
  date: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ classification: WeatherType; data: WeatherData } | null> {
  // Check cache first
  const { data: cached } = await supabase
    .from("weather_cache")
    .select("*")
    .eq("date", date)
    .gte("latitude", latitude - 0.1)
    .lte("latitude", latitude + 0.1)
    .gte("longitude", longitude - 0.1)
    .lte("longitude", longitude + 0.1)
    .maybeSingle();

  if (cached) {
    return {
      classification: cached.weather_classification as WeatherType,
      data: {
        maxTempF: cached.max_temp_f,
        minTempF: cached.min_temp_f,
        precipitationIn: cached.precipitation_in,
        prevDayPrecipIn: cached.prev_day_precip_in,
      },
    };
  }

  // Fetch from API
  const weatherData = await fetchWeather(latitude, longitude, date);
  if (!weatherData) return null;

  const classification = classifyWeather(weatherData);

  // Cache it
  await supabase.from("weather_cache").upsert(
    {
      date,
      latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100,
      max_temp_f: weatherData.maxTempF,
      min_temp_f: weatherData.minTempF,
      precipitation_in: weatherData.precipitationIn,
      prev_day_precip_in: weatherData.prevDayPrecipIn,
      weather_classification: classification,
    },
    { onConflict: "date,latitude,longitude" }
  );

  return { classification, data: weatherData };
}
