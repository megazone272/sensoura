/**
 * Calibration and mapping policy.
 *
 * Rules encoded here (and enforced by the pipeline):
 *  1. A provider variable is only ever compared with a local sensor when both
 *     the physical quantity and the environment match. Indoor greenhouse air
 *     is not outdoor 2 m air; a pot's relative moisture index is not
 *     volumetric soil moisture over a 0-1 cm model layer.
 *  2. Unit conversion happens before any comparison and preserves the raw value.
 *  3. No calibration coefficient is applied unless a model was fitted on
 *     reference measurements and evaluated on an independent (chronological)
 *     holdout. The pipeline has no such paired dataset today, so it applies no
 *     bias correction.
 *  4. There is NO VOC equivalence. The MQ135 raw index is stored as-is;
 *     atmospheric indicators keep their own names.
 */

export type MappingClassification =
  | 'direct_match'
  | 'unit_comparable_outdoor_reference'
  | 'derived_estimate'
  | 'unsupported'
  | 'external_only';

export interface VariableMapping {
  localVariable: string;
  localUnit: string;
  externalSource: 'open-meteo' | 'nasa-power';
  externalVariable: string;
  externalUnit: string;
  classification: MappingClassification;
  /** True only when a numeric comparison is scientifically meaningful as-is. */
  comparable: boolean;
  calibrationStatus: 'none' | 'not_applicable';
  reason: string;
  caveats: string[];
}

export const VARIABLE_MAPPINGS: readonly VariableMapping[] = [
  {
    localVariable: 'air_temperature',
    localUnit: 'degC',
    externalSource: 'open-meteo',
    externalVariable: 'temperature_2m',
    externalUnit: 'degC',
    classification: 'unit_comparable_outdoor_reference',
    comparable: true,
    calibrationStatus: 'none',
    reason:
      'Same physical quantity (°C) but different environments: open-air 2 m model value vs greenhouse interior. ' +
      'Comparable for ventilation physics, not a calibration reference.',
    caveats: ['No co-located outdoor reference sensor exists; no bias model is applied.'],
  },
  {
    localVariable: 'air_temperature',
    localUnit: 'degC',
    externalSource: 'nasa-power',
    externalVariable: 'T2M',
    externalUnit: 'C',
    classification: 'unit_comparable_outdoor_reference',
    comparable: true,
    calibrationStatus: 'none',
    reason: 'Open-air 2 m reanalysis temperature; same unit, different environment.',
    caveats: ['Grid resolution (MERRA-2 ~0.5° x 0.625°) is much coarser than the greenhouse.'],
  },
  {
    localVariable: 'relative_humidity',
    localUnit: '%',
    externalSource: 'open-meteo',
    externalVariable: 'relative_humidity_2m',
    externalUnit: '%',
    classification: 'unit_comparable_outdoor_reference',
    comparable: true,
    calibrationStatus: 'none',
    reason: 'Same quantity (%) in a different environment; used for absolute-humidity comparison only.',
    caveats: ['DHT11 accuracy ~±5 %; provider is a model value for a grid cell.'],
  },
  {
    localVariable: 'relative_humidity',
    localUnit: '%',
    externalSource: 'nasa-power',
    externalVariable: 'RH2M',
    externalUnit: '%',
    classification: 'unit_comparable_outdoor_reference',
    comparable: true,
    calibrationStatus: 'none',
    reason: 'Open-air reanalysis relative humidity at 2 m.',
    caveats: ['No paired local/outdoor humidity dataset exists for bias estimation.'],
  },
  {
    localVariable: 'air_pressure',
    localUnit: 'hPa',
    externalSource: 'open-meteo',
    externalVariable: 'surface_pressure',
    externalUnit: 'hPa',
    classification: 'unit_comparable_outdoor_reference',
    comparable: true,
    calibrationStatus: 'none',
    reason:
      'Same unit, but the provider value is model surface pressure for the grid-cell elevation while the BMP180 ' +
      'reports absolute station pressure at the greenhouse. Differences include altitude and weather.',
    caveats: ['Not reduced to sea level; no altitude correction is applied because the site elevation is unknown.'],
  },
  {
    localVariable: 'soil_temperature',
    localUnit: 'degC',
    externalSource: 'open-meteo',
    externalVariable: 'soil_temperature_0cm',
    externalUnit: 'degC',
    classification: 'derived_estimate',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason:
      'Provider value is modeled open-soil temperature at 0 cm; the DS18B20 probe depth inside a greenhouse bed is ' +
      'not documented. Not an equivalent measurement.',
    caveats: ['Use only as outdoor context, never as a calibration reference.'],
  },
  {
    localVariable: 'soil_temperature',
    localUnit: 'degC',
    externalSource: 'nasa-power',
    externalVariable: 'TS',
    externalUnit: 'C',
    classification: 'derived_estimate',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'Earth skin temperature is a modeled surface radiometric temperature, not soil temperature at depth.',
    caveats: ['No conversion to probe-depth soil temperature is attempted.'],
  },
  {
    localVariable: 'soil_moisture_index',
    localUnit: '%',
    externalSource: 'open-meteo',
    externalVariable: 'soil_moisture_0_to_1cm',
    externalUnit: 'm3/m3',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason:
      'Local value is an uncalibrated ADC-derived relative index (3200..1200 -> 0..100), not volumetric water content. ' +
      'Provider value is modeled volumetric water content (m³/m³) for open soil at 0-1 cm. ' +
      'Converting one to the other would require substrate-specific calibration that does not exist.',
    caveats: ['Do not convert, compare numerically, or use as a label for the local index.'],
  },
  {
    localVariable: 'light_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'shortwave_radiation',
    externalUnit: 'W/m2',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason:
      'Photoresistor ADC counts have an unknown spectral response and circuit gain; provider value is broadband ' +
      'shortwave irradiance on a horizontal plane. No lux/PAR conversion exists in the firmware or repo.',
    caveats: ['Daylight context may come from provider sunrise/sunset, never from converting the local counts.'],
  },
  {
    localVariable: 'light_raw',
    localUnit: 'counts',
    externalSource: 'nasa-power',
    externalVariable: 'ALLSKY_SFC_SW_DWN',
    externalUnit: 'MJ/hr',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'Satellite-derived broadband irradiance is not equivalent to an uncalibrated photoresistor count.',
    caveats: ['No conversion is attempted.'],
  },
  {
    localVariable: 'mq135_gas_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'pm2_5',
    externalUnit: 'μg/m³',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'PM2.5 mass concentration is not a VOC index and is not equivalent to MQ135 raw ADC counts.',
    caveats: ['Stored under its own name as an atmospheric indicator.'],
  },
  {
    localVariable: 'mq135_gas_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'pm10',
    externalUnit: 'μg/m³',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'PM10 mass concentration is not a VOC index.',
    caveats: ['Stored under its own name as an atmospheric indicator.'],
  },
  {
    localVariable: 'mq135_gas_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'carbon_monoxide',
    externalUnit: 'μg/m³',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'CO concentration is a specific pollutant, not a VOC index or MQ135 output.',
    caveats: ['Stored under its own name as an atmospheric indicator.'],
  },
  {
    localVariable: 'mq135_gas_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'nitrogen_dioxide',
    externalUnit: 'μg/m³',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'NO₂ concentration is not a VOC index.',
    caveats: ['Stored under its own name as an atmospheric indicator.'],
  },
  {
    localVariable: 'mq135_gas_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'ozone',
    externalUnit: 'μg/m³',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'Ozone concentration is not a VOC index.',
    caveats: ['Stored under its own name as an atmospheric indicator.'],
  },
  {
    localVariable: 'mq135_gas_raw',
    localUnit: 'counts',
    externalSource: 'open-meteo',
    externalVariable: 'aerosol_optical_depth',
    externalUnit: '1',
    classification: 'unsupported',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'Aerosol optical depth is a column optical property, not a VOC measurement.',
    caveats: ['Stored under its own name as an atmospheric indicator.'],
  },
  {
    localVariable: '(none)',
    localUnit: '',
    externalSource: 'nasa-power',
    externalVariable: 'PRECTOTCORR',
    externalUnit: 'mm/hour',
    classification: 'external_only',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'No local rain sensor exists; precipitation is external context used only to avoid ventilation advice during rain.',
    caveats: [],
  },
  {
    localVariable: '(none)',
    localUnit: '',
    externalSource: 'nasa-power',
    externalVariable: 'WS2M',
    externalUnit: 'm/s',
    classification: 'external_only',
    comparable: false,
    calibrationStatus: 'not_applicable',
    reason: 'No local wind sensor exists; wind speed is external context.',
    caveats: [],
  },
];

export function mappingsFor(localVariable: string): readonly VariableMapping[] {
  return VARIABLE_MAPPINGS.filter((m) => m.localVariable === localVariable);
}

export function mappingFor(sourceId: string, externalVariable: string): VariableMapping | null {
  return (
    VARIABLE_MAPPINGS.find((m) => m.externalSource === sourceId && m.externalVariable === externalVariable) ?? null
  );
}

/** Names that would imply a VOC equivalence. */
const FORBIDDEN_VOC_TARGETS = ['voc', 'voc_index', 'voc_equivalent', 'tvoc', 'voc_estimate_from_gas'];

export class UnsupportedVocMappingError extends Error {
  constructor(externalVariable: string, reasons: readonly string[]) {
    super(
      `Refusing to relabel "${externalVariable}" as a VOC measurement. ` + reasons.join(' ')
    );
    this.name = 'UnsupportedVocMappingError';
  }
}

/**
 * Hard guard used by observation building and model registration: no external
 * variable may be given a VOC target name.
 */
export function assertNotVocTarget(targetName: string, externalVariable: string): void {
  const key = targetName.trim().toLowerCase();
  if (FORBIDDEN_VOC_TARGETS.includes(key) || key.includes('voc')) {
    throw new UnsupportedVocMappingError(externalVariable, [
      'The MQ135 reports raw ADC counts, not a VOC index.',
      'No provider in this integration measures an equivalent VOC quantity.',
      'No reference VOC measurements exist for training an estimator.',
    ]);
  }
}

export interface VocSupportRequest {
  /** Count of paired reference VOC measurements available for training. */
  referenceVocSamples: number;
  referenceInstrument: string | null;
  /** Count of paired samples with the local MQ135 reading at the same time. */
  pairedLocalSamples: number;
  hasR0Calibration: boolean;
  hasTemperatureHumidityCompensation: boolean;
}

export interface VocSupportDecision {
  supported: boolean;
  reasons: string[];
  requiredBeforeEstimating: string[];
}

/**
 * VOC estimates are only possible with reference measurements and an
 * MQ135 calibration. Today: not supported, and this is surfaced in the
 * prediction output rather than hidden.
 */
export function evaluateVocEstimationSupport(req: VocSupportRequest): VocSupportDecision {
  const reasons: string[] = [];
  if (!req.hasR0Calibration) {
    reasons.push('MQ135 has no R0 / load-resistor calibration in the firmware, so readings are not a concentration.');
  }
  if (!req.hasTemperatureHumidityCompensation) {
    reasons.push('MQ135 readings are not compensated for temperature or humidity.');
  }
  if (!req.referenceInstrument) {
    reasons.push('No reference VOC instrument is configured for the greenhouse.');
  }
  if (req.referenceVocSamples < 100 || req.pairedLocalSamples < 100) {
    reasons.push(
      `Insufficient paired reference data (${req.pairedLocalSamples} paired samples, ` +
        `${req.referenceVocSamples} reference measurements; at least 100 paired samples are required for a defensible model).`
    );
  }
  return {
    supported: reasons.length === 0,
    reasons,
    requiredBeforeEstimating: [
      'Calibrate the MQ135 against a known reference gas (R0 and load resistor) and compensate for temperature/humidity.',
      'Collect co-located reference VOC measurements with documented instrument, range and detection limit.',
      'Collect at least 100 paired samples spanning the greenhouse conditions of interest.',
      'Hold out a chronological validation set and report MAE/RMSE and bias before using the estimate.',
      'Label every output as a model prediction with uncertainty and validation metrics.',
    ],
  };
}

export const VOC_POLICY = {
  localVariable: 'mq135_gas_raw',
  localUnit: 'counts',
  equivalentExternalVariable: null,
  classification: 'unsupported' as const,
  statement:
    'No satellite or atmospheric-composition variable in this integration is a VOC index. Atmospheric indicators are ' +
    'stored under their own names and are never relabelled as VOC.',
  currentSupport: evaluateVocEstimationSupport({
    referenceVocSamples: 0,
    referenceInstrument: null,
    pairedLocalSamples: 0,
    hasR0Calibration: false,
    hasTemperatureHumidityCompensation: false,
  }),
};

// ---------------------------------------------------------------------------
// Bias / drift calibration — only when reference measurements exist.
// ---------------------------------------------------------------------------

export interface PairedSample {
  atMs: number;
  /** Reference (co-located, calibrated) value in the same unit. */
  reference: number;
  /** Local sensor value in the same unit (convert before calling). */
  local: number;
}

export interface CalibrationMetrics {
  MAE: number;
  RMSE: number;
  bias: number;
  sampleSize: number;
}

export interface CalibrationFit {
  status: 'validated' | 'insufficient_data';
  methodId: string;
  unitNote: string;
  slope: number | null;
  intercept: number | null;
  trainSamples: number;
  validationSamples: number;
  validationMetrics: CalibrationMetrics | null;
  /**
   * Range of local values seen in the TRAINING split. The model may only be
   * applied inside this range; outside it the fit is an extrapolation.
   */
  trainLocalRange: { min: number; max: number } | null;
  reasons: string[];
}

/**
 * Fit `reference = intercept + slope * local` and evaluate on the most recent
 * chronological holdout. Training and validation never share samples.
 * This is never applied automatically; it returns a model for review.
 */
export function fitBiasCalibration(
  samples: readonly PairedSample[],
  opts: { minTrainSamples?: number; minValidationSamples?: number; unitNote: string }
): CalibrationFit {
  const minTrain = opts.minTrainSamples ?? 60;
  const minValidation = opts.minValidationSamples ?? 20;
  const clean = samples
    .filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.reference) && Number.isFinite(s.local))
    .sort((a, b) => a.atMs - b.atMs);

  const base: CalibrationFit = {
    status: 'insufficient_data',
    methodId: 'ols_bias_v1',
    unitNote: opts.unitNote,
    slope: null,
    intercept: null,
    trainSamples: 0,
    validationSamples: 0,
    validationMetrics: null,
    trainLocalRange: null,
    reasons: [],
  };

  if (clean.length < minTrain + minValidation) {
    return {
      ...base,
      trainSamples: clean.length,
      reasons: [
        `need at least ${minTrain + minValidation} paired samples (${minTrain} train + ${minValidation} validation); have ${clean.length}`,
      ],
    };
  }

  const split = Math.floor(clean.length * 0.7);
  const train = clean.slice(0, split);
  const validation = clean.slice(split);
  if (train.length < minTrain || validation.length < minValidation) {
    return {
      ...base,
      trainSamples: train.length,
      validationSamples: validation.length,
      reasons: [`chronological split produced ${train.length} train / ${validation.length} validation samples`],
    };
  }

  const n = train.length;
  const meanX = train.reduce((a, s) => a + s.local, 0) / n;
  const meanY = train.reduce((a, s) => a + s.reference, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of train) {
    num += (s.local - meanX) * (s.reference - meanY);
    den += (s.local - meanX) ** 2;
  }
  if (den === 0) {
    return { ...base, trainSamples: train.length, validationSamples: validation.length, reasons: ['local values have no variance'] };
  }
  const slope = num / den;
  const intercept = meanY - slope * meanX;

  const residuals = validation.map((s) => intercept + slope * s.local - s.reference);
  const mae = residuals.reduce((a, r) => a + Math.abs(r), 0) / residuals.length;
  const rmse = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length);
  const bias = residuals.reduce((a, r) => a + r, 0) / residuals.length;

  const trainLocalValues = train.map((s) => s.local);

  return {
    status: 'validated',
    methodId: 'ols_bias_v1',
    unitNote: opts.unitNote,
    slope,
    intercept,
    trainSamples: train.length,
    validationSamples: validation.length,
    trainLocalRange: {
      min: Math.min(...trainLocalValues),
      max: Math.max(...trainLocalValues),
    },
    validationMetrics: {
      MAE: round(mae, 4),
      RMSE: round(rmse, 4),
      bias: round(bias, 4),
      sampleSize: validation.length,
    },
    reasons: [
      'coefficients are fitted on the earlier 70% and evaluated on the most recent 30% (chronological holdout)',
      'model is returned for review and is not applied automatically',
    ],
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
