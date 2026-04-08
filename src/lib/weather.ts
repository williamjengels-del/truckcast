import type { WeatherType } from "./database.types";

/**
 * Geocode a city name to latitude/longitude using Open-Meteo's free geocoding API.
 * Returns null if the city can't be found.
 */
export async function geocodeCity(
  city: string
): Promise<{ latitude: number; longitude: number } | null> {
  if (!city.trim()) return null;
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results as Array<{ latitude: number; longitude: number }> | undefined;
    if (!results || results.length === 0) return null;
    return { latitude: results[0].latitude, longitude: results[0].longitude };
  } catch {
    return null;
  }
}

/**
 * Given a city and date, resolve coordinates and return the weather classification.
 * Returns null if geocoding fails or weather is unavailable (e.g. > 16 days out).
 * Uses Supabase client for weather_cache reads/writes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function autoClassifyWeather(
  city: string,
  date: string,
  supabase: any
): Promise<{ classification: WeatherType; latitude: number; longitude: number } | null> {
  const coords = await geocodeCity(city);
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

/**
 * Fetch weather and classify it, with caching via Supabase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getWeatherForEvent(
  latitude: number,
  longitude: number,
  date: string,
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
