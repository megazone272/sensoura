/**
 * Unit handling.
 *
 * Conversions only happen between genuinely equivalent units. There is no
 * function here that turns an uncalibrated photoresistor count into lux, or a
 * raw MQ135 ADC reading into ppm/VOC — those would require on-site
 * calibration data that the repository does not contain.
 */

export interface ConversionResult {
  value: number;
  steps: string[];
}

const aliases: Record<string, string> = {
  c: 'degC',
  '°c': 'degC',
  celsius: 'degC',
  degc: 'degC',
  f: 'degF',
  '°f': 'degF',
  fahrenheit: 'degF',
  k: 'K',
  kelvin: 'K',
  hpa: 'hPa',
  mbar: 'hPa',
  millibar: 'hPa',
  pa: 'Pa',
  kpa: 'kPa',
  'w/m2': 'W/m2',
  'w/m²': 'W/m2',
  'kw/m2': 'kW/m2',
  'mj/hr': 'MJ/hr',
  'mj/h': 'MJ/hr',
  'mj/m2/day': 'MJ/m2/day',
  'mj/m²/day': 'MJ/m2/day',
  '%': '%',
  pct: '%',
  'm3/m3': 'm3/m3',
  'm³/m³': 'm3/m3',
  'm/s': 'm/s',
  'km/h': 'km/h',
  mm: 'mm',
  'mm/hour': 'mm/hour',
  'mm/hr': 'mm/hour',
  counts: 'counts',
  adc_counts: 'counts',
  '': '',
};

function canonical(unit: string): string {
  const key = unit.trim().toLowerCase();
  return aliases[key] ?? unit.trim();
}

/**
 * Convert a value between units. Returns null for an unsupported pair so the
 * caller can mark the observation instead of silently mislabelling it.
 */
export function convert(value: number, fromUnit: string, toUnit: string): ConversionResult | null {
  if (!Number.isFinite(value)) return null;
  const from = canonical(fromUnit);
  const to = canonical(toUnit);
  if (from === to) return { value, steps: ['no conversion (identical units)'] };

  const steps: string[] = [];
  let v = value;

  // Temperature (affine, so handled explicitly).
  if (from === 'degC' || from === 'degF' || from === 'K') {
    let celsius: number;
    if (from === 'degC') celsius = v;
    else if (from === 'degF') {
      celsius = (v - 32) / 1.8;
      steps.push('°F -> °C: (x - 32) / 1.8');
    } else {
      celsius = v - 273.15;
      steps.push('K -> °C: x - 273.15');
    }
    if (to === 'degC') return { value: celsius, steps };
    if (to === 'degF') {
      steps.push('°C -> °F: x * 1.8 + 32');
      return { value: celsius * 1.8 + 32, steps };
    }
    if (to === 'K') {
      steps.push('°C -> K: x + 273.15');
      return { value: celsius + 273.15, steps };
    }
    return null;
  }

  // Pressure.
  if (from === 'Pa' || from === 'hPa' || from === 'kPa') {
    const pascals = from === 'Pa' ? v : from === 'hPa' ? v * 100 : v * 1000;
    steps.push(`${from} -> Pa`);
    if (to === 'Pa') return { value: pascals, steps };
    if (to === 'hPa') return { value: pascals / 100, steps: [...steps, 'Pa -> hPa'] };
    if (to === 'kPa') return { value: pascals / 1000, steps: [...steps, 'Pa -> kPa'] };
    return null;
  }

  // Radiation / irradiance.
  if (from === 'MJ/hr') {
    // 1 MJ over 3600 s = 277.78 W/m² (hourly mean irradiance).
    const wm2 = (v * 1_000_000) / 3600;
    steps.push('MJ/hr -> W/m2: x * 1e6 / 3600');
    if (to === 'W/m2') return { value: wm2, steps };
    if (to === 'kW/m2') return { value: wm2 / 1000, steps: [...steps, 'W/m2 -> kW/m2'] };
    return null;
  }
  if (from === 'MJ/m2/day') {
    const wm2 = (v * 1_000_000) / 86_400;
    steps.push('MJ/m2/day -> W/m2: x * 1e6 / 86400');
    if (to === 'W/m2') return { value: wm2, steps };
    if (to === 'kW/m2') return { value: wm2 / 1000, steps: [...steps, 'W/m2 -> kW/m2'] };
    return null;
  }
  if (from === 'kW/m2') {
    if (to === 'W/m2') return { value: v * 1000, steps: ['kW/m2 -> W/m2: x * 1000'] };
    if (to === 'MJ/hr') return { value: (v * 1000 * 3600) / 1_000_000, steps: ['kW/m2 -> MJ/hr'] };
    return null;
  }
  if (from === 'W/m2') {
    if (to === 'kW/m2') return { value: v / 1000, steps: ['W/m2 -> kW/m2: x / 1000'] };
    if (to === 'MJ/hr') return { value: (v * 3600) / 1_000_000, steps: ['W/m2 -> MJ/hr'] };
    return null;
  }

  // Volumetric water content fraction <-> percent.
  if (from === 'm3/m3' && to === '%') return { value: v * 100, steps: ['m3/m3 -> %: x * 100'] };
  if (from === '%' && to === 'm3/m3') return { value: v / 100, steps: ['% -> m3/m3: x / 100'] };

  // Wind speed.
  if (from === 'm/s' && to === 'km/h') return { value: v * 3.6, steps: ['m/s -> km/h: x * 3.6'] };
  if (from === 'km/h' && to === 'm/s') return { value: v / 3.6, steps: ['km/h -> m/s: x / 3.6'] };

  // Precipitation depth per hour <-> depth per hour (identity handled above).
  return null;
}

export function roundTo(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Saturation vapour pressure (kPa), Magnus formula over water. */
export function saturationVapourPressureKpa(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/** Actual vapour pressure (kPa) from temperature and relative humidity (%). */
export function vapourPressureKpa(tempC: number, rhPct: number): number {
  return saturationVapourPressureKpa(tempC) * (Math.max(0, Math.min(100, rhPct)) / 100);
}

export function vpdKpa(tempC: number, rhPct: number): number {
  const svp = saturationVapourPressureKpa(tempC);
  return Math.max(0, svp - vapourPressureKpa(tempC, rhPct));
}

/** Absolute humidity in g/m³ from temperature (°C) and relative humidity (%). */
export function absoluteHumidityGm3(tempC: number, rhPct: number): number {
  const vapourPressurePa = vapourPressureKpa(tempC, rhPct) * 1000;
  return (2.16679 * vapourPressurePa) / (273.15 + tempC);
}

/** Dew point (°C) from temperature and relative humidity. */
export function dewPointC(tempC: number, rhPct: number): number {
  const rh = Math.max(1e-6, Math.min(100, rhPct)) / 100;
  const a = 17.27;
  const b = 237.3;
  const gamma = Math.log(rh) + (a * tempC) / (b + tempC);
  return (b * gamma) / (a - gamma);
}

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Percentage change, null when the baseline is zero/undefined. */
export function percentChange(baseline: number, current: number): number | null {
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline === 0) return null;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}
