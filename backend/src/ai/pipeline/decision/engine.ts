/**
 * AI Decision Engine (rule-based, deterministic).
 *
 * Pipeline stages, in order:
 *   1. data validation (done by the caller; invalid/stale input produces a
 *      diagnostic record, never a recommendation)
 *   2. crop-specific constraint evaluation
 *   3. candidate action evaluation (only installed hardware)
 *   4. recommendation generation
 *   5. safety validation
 *   6. storage (done by the cycle)
 *   7. outcome tracking (done by the cycle; observational, not causal)
 *
 * The engine cannot execute anything: it returns advisory records with
 * `requestedCommand: null`, `executableByBackend: false`, and
 * `requiresHumanApproval: true`. It never touches `/Sensoura/commands`.
 */
import type { EquipmentCapabilities, PipelineConfig } from '../config.js';
import {
  RULESET_VERSION,
  type IndoorSeriesPoint,
  type SuggestionV1,
} from '../schema.js';
import { sanitizePathKey } from '../schema.js';
import type { ValidatedIndoorSnapshot } from '../utils/quality.js';
import { INDOOR_VARIABLES, computeTrend, seriesValues } from '../utils/quality.js';
import type { OutdoorContext } from '../processing/external.js';
import { absoluteHumidityGm3, percentChange, roundTo } from '../utils/units.js';
import { addHours, toIsoUtc } from '../utils/time.js';
import { VOC_POLICY } from '../calibration/registry.js';

export type ConstraintStatus = 'ok' | 'below' | 'above' | 'critical' | 'unknown';

export interface ConstraintReport {
  id: string;
  variable: string;
  status: ConstraintStatus;
  value: number | null;
  unit: string;
  bounds: { min: number | null; max: number | null } | null;
  reasons: string[];
}

export interface TrendReport {
  variable: string;
  slopePerHour: number | null;
  delta: number | null;
  samples: number;
  windowMinutes: number;
  percentChange: number | null;
}

type Priority = 'low' | 'medium' | 'high' | 'critical';
const PRIORITY_ORDER: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface ActionDefinition {
  id: string;
  category: 'ventilation' | 'humidity' | 'lighting' | 'irrigation' | 'monitoring' | 'notify';
  targetDevice:
    | 'ventilation'
    | 'ventilation_fan'
    | 'humidifier_fan'
    | 'supplemental_light'
    | 'pump'
    | 'buzzer'
    | 'none';
  capability: keyof EquipmentCapabilities | null;
  requiresIrrigationApproval: boolean;
  requiresCalibratedLight: boolean;
  description: string;
}

export const ACTION_CATALOG: readonly ActionDefinition[] = [
  {
    id: 'ventilation.open',
    category: 'ventilation',
    targetDevice: 'ventilation',
    capability: 'ventilation',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Open greenhouse ventilation',
  },
  {
    id: 'ventilation.close',
    category: 'ventilation',
    targetDevice: 'ventilation',
    capability: 'ventilation',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Close greenhouse ventilation',
  },
  {
    id: 'ventilation_fan.on',
    category: 'ventilation',
    targetDevice: 'ventilation_fan',
    capability: 'ventilationFan',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Activate the ventilation fan',
  },
  {
    id: 'ventilation_fan.off',
    category: 'ventilation',
    targetDevice: 'ventilation_fan',
    capability: 'ventilationFan',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Deactivate the ventilation fan',
  },
  {
    id: 'humidifier_fan.on',
    category: 'humidity',
    targetDevice: 'humidifier_fan',
    capability: 'humidifierFan',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Activate the humidification fan',
  },
  {
    id: 'humidifier_fan.off',
    category: 'humidity',
    targetDevice: 'humidifier_fan',
    capability: 'humidifierFan',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Deactivate the humidification fan',
  },
  {
    id: 'supplemental_light.on',
    category: 'lighting',
    targetDevice: 'supplemental_light',
    capability: 'supplementalLight',
    requiresIrrigationApproval: false,
    requiresCalibratedLight: true,
    description: 'Activate supplemental lighting',
  },
  {
    id: 'irrigation.pump_on',
    category: 'irrigation',
    targetDevice: 'pump',
    capability: 'pump',
    requiresIrrigationApproval: true,
    requiresCalibratedLight: false,
    description: 'Start the irrigation pump',
  },
  {
    id: 'operator.alert',
    category: 'notify',
    targetDevice: 'none',
    capability: null,
    requiresIrrigationApproval: false,
    requiresCalibratedLight: false,
    description: 'Notify the operator (no actuator action)',
  },
] as const;

function actionById(id: string): ActionDefinition {
  const found = ACTION_CATALOG.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown action definition: ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// 2. Crop constraint evaluation
// ---------------------------------------------------------------------------

export function evaluateConstraints(indoor: ValidatedIndoorSnapshot, cfg: PipelineConfig): ConstraintReport[] {
  const v = indoor.values;
  const q = indoor.variableQuality;
  const out: ConstraintReport[] = [];

  const temp = v.air_temperature;
  if (temp === undefined || temp === null) {
    out.push({
      id: 'air_temperature',
      variable: 'air_temperature',
      status: 'unknown',
      value: null,
      unit: 'degC',
      bounds: { min: cfg.POTATO_AIR_TEMP_OPTIMAL_MIN_C, max: cfg.POTATO_AIR_TEMP_OPTIMAL_MAX_C },
      reasons: ['air temperature is missing'],
    });
  } else {
    const reasons: string[] = [];
    let status: ConstraintStatus = 'ok';
    if (temp < cfg.POTATO_AIR_TEMP_CRITICAL_MIN_C) {
      status = 'critical';
      reasons.push(`air temperature ${temp} °C is below the critical minimum ${cfg.POTATO_AIR_TEMP_CRITICAL_MIN_C} °C (frost risk)`);
    } else if (temp > cfg.POTATO_AIR_TEMP_CRITICAL_MAX_C) {
      status = 'critical';
      reasons.push(`air temperature ${temp} °C is above the critical maximum ${cfg.POTATO_AIR_TEMP_CRITICAL_MAX_C} °C`);
    } else if (temp < cfg.POTATO_AIR_TEMP_OPTIMAL_MIN_C) {
      status = 'below';
      reasons.push(`air temperature ${temp} °C is below the potato optimal minimum ${cfg.POTATO_AIR_TEMP_OPTIMAL_MIN_C} °C`);
    } else if (temp > cfg.POTATO_AIR_TEMP_OPTIMAL_MAX_C) {
      status = 'above';
      reasons.push(`air temperature ${temp} °C is above the potato optimal maximum ${cfg.POTATO_AIR_TEMP_OPTIMAL_MAX_C} °C`);
    }
    if (q.air_temperature !== 'valid') reasons.push(`air temperature quality is ${q.air_temperature}`);
    reasons.push('thresholds are configurable initial agronomic defaults, not greenhouse-specific validated values');
    out.push({
      id: 'air_temperature',
      variable: 'air_temperature',
      status,
      value: temp,
      unit: 'degC',
      bounds: { min: cfg.POTATO_AIR_TEMP_OPTIMAL_MIN_C, max: cfg.POTATO_AIR_TEMP_OPTIMAL_MAX_C },
      reasons,
    });
  }

  const rh = v.relative_humidity;
  if (rh === undefined || rh === null) {
    out.push({
      id: 'relative_humidity',
      variable: 'relative_humidity',
      status: 'unknown',
      value: null,
      unit: '%',
      bounds: { min: cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT, max: cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT },
      reasons: ['relative humidity is missing'],
    });
  } else {
    const status: ConstraintStatus =
      rh < cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT
        ? 'below'
        : rh > cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT
          ? 'above'
          : 'ok';
    out.push({
      id: 'relative_humidity',
      variable: 'relative_humidity',
      status,
      value: rh,
      unit: '%',
      bounds: { min: cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT, max: cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT },
      reasons: [
        status === 'ok'
          ? 'within the configured potato humidity range'
          : `relative humidity ${rh} % is outside the configured ${cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT}-${cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT} % range`,
        `DHT11 uncertainty (~±5 %) is larger than the smallest margin to the bound`,
      ],
    });
  }

  const soilT = v.soil_temperature;
  out.push({
    id: 'soil_temperature',
    variable: 'soil_temperature',
    status: 'unknown',
    value: soilT ?? null,
    unit: 'degC',
    bounds: null,
    reasons: [
      'no soil-temperature bounds are configured; probe depth is undocumented so no crop threshold is applied',
    ],
  });

  const moisture = v.soil_moisture_index;
  out.push({
    id: 'soil_moisture_index',
    variable: 'soil_moisture_index',
    status:
      moisture === undefined || moisture === null
        ? 'unknown'
        : moisture < cfg.POTATO_SOIL_MOISTURE_INDEX_MIN
          ? 'below'
          : moisture > cfg.POTATO_SOIL_MOISTURE_INDEX_MAX
            ? 'above'
            : 'ok',
    value: moisture ?? null,
    unit: '%',
    bounds: { min: cfg.POTATO_SOIL_MOISTURE_INDEX_MIN, max: cfg.POTATO_SOIL_MOISTURE_INDEX_MAX },
    reasons: [
      'relative ADC-derived index (0-100), NOT volumetric water content; bounds are relative operating points',
      'irrigation pump threshold logic remains independent of this pipeline',
    ],
  });

  const gas = v.mq135_gas_raw;
  if (cfg.GAS_RAW_ALERT_THRESHOLD !== undefined && gas !== undefined && gas !== null) {
    out.push({
      id: 'mq135_gas_raw',
      variable: 'mq135_gas_raw',
      status: gas >= cfg.GAS_RAW_ALERT_THRESHOLD ? 'above' : 'ok',
      value: gas,
      unit: 'counts',
      bounds: { min: null, max: cfg.GAS_RAW_ALERT_THRESHOLD },
      reasons: [
        `configured raw-count alert threshold ${cfg.GAS_RAW_ALERT_THRESHOLD}; raw counts are uncalibrated and not ppm`,
      ],
    });
  } else {
    out.push({
      id: 'mq135_gas_raw',
      variable: 'mq135_gas_raw',
      status: 'unknown',
      value: gas ?? null,
      unit: 'counts',
      bounds: null,
      reasons: ['no absolute threshold configured: raw MQ135 counts have no defensible ppm/VOC interpretation'],
    });
  }

  out.push({
    id: 'light',
    variable: 'light_raw',
    status: 'unknown',
    value: v.light_raw ?? null,
    unit: 'counts',
    bounds: null,
    reasons: ['photoresistor counts are uncalibrated (no lux/PAR conversion); no light constraint is applied'],
  });

  return out;
}

export function evaluateTrends(
  series: readonly IndoorSeriesPoint[],
  cfg: PipelineConfig
): { trends: TrendReport[]; windowMinutes: number } {
  const values = seriesValues([...series]);
  const out: TrendReport[] = [];
  let windowMinutes = 0;
  for (const spec of INDOOR_VARIABLES) {
    const points = values[spec.normalizedName] ?? [];
    const trend = computeTrend(points);
    windowMinutes = Math.max(windowMinutes, trend.windowMinutes);
    const first = points[0]?.value;
    const last = points[points.length - 1]?.value;
    const pc = first !== undefined && last !== undefined ? percentChange(first, last) : null;
    out.push({
      variable: spec.normalizedName,
      slopePerHour: trend.slopePerHour,
      delta: trend.delta,
      samples: trend.samples,
      windowMinutes: trend.windowMinutes,
      percentChange: pc === null ? null : roundTo(pc, 2),
    });
  }
  // cfg is accepted so future trend thresholds stay configurable in one place.
  void cfg;
  return { trends: out, windowMinutes };
}

// ---------------------------------------------------------------------------
// 3. Candidate evaluation
// ---------------------------------------------------------------------------

interface Candidate {
  actionId: string;
  priority: Priority;
  reasons: string[];
  metric: string | null;
  expectedEffect: {
    description: string;
    direction: 'increase' | 'decrease' | 'maintain' | 'unknown';
    metric: string | null;
    magnitude: string | null;
  };
  requiresOutdoorEvidence: boolean;
}

export interface SkippedAction {
  actionId: string;
  reason: string;
}

export interface DecisionInput {
  cfg: PipelineConfig;
  greenhouseId: string;
  nowMs: number;
  indoor: ValidatedIndoorSnapshot;
  outdoor: OutdoorContext | null;
  series: readonly IndoorSeriesPoint[];
  previous: readonly SuggestionV1[];
  equipment: EquipmentCapabilities;
}

export interface DecisionEvaluation {
  recommendations: SuggestionV1[];
  diagnostics: SuggestionV1[];
  skipped: SkippedAction[];
  constraints: ConstraintReport[];
  trends: TrendReport[];
  dataQuality: { status: 'ok' | 'degraded' | 'invalid' | 'stale'; reasons: string[] };
  suppressedByCooldown: number;
}

function capabilityLabel(capability: keyof EquipmentCapabilities): string {
  switch (capability) {
    case 'ventilation':
      return 'ventilation vents';
    case 'ventilationFan':
      return 'ventilation fan';
    case 'humidifierFan':
      return 'humidification fan';
    case 'supplementalLight':
      return 'supplemental lighting';
    case 'pump':
      return 'irrigation pump';
    case 'buzzer':
      return 'buzzer';
  }
}

function mergeCandidate(map: Map<string, Candidate>, candidate: Candidate): void {
  const existing = map.get(candidate.actionId);
  if (!existing) {
    map.set(candidate.actionId, candidate);
    return;
  }
  existing.reasons = [...new Set([...existing.reasons, ...candidate.reasons])];
  if (PRIORITY_ORDER[candidate.priority] > PRIORITY_ORDER[existing.priority]) {
    existing.priority = candidate.priority;
  }
  existing.requiresOutdoorEvidence = existing.requiresOutdoorEvidence || candidate.requiresOutdoorEvidence;
}

export function buildCandidates(input: DecisionInput): {
  candidates: Candidate[];
  skipped: SkippedAction[];
} {
  const { indoor, outdoor, equipment, cfg } = input;
  const candidates = new Map<string, Candidate>();
  const skipped: SkippedAction[] = [];
  const constraints = new Map(evaluateConstraints(indoor, cfg).map((c) => [c.id, c]));

  const temp = indoor.values.air_temperature ?? null;
  const rh = indoor.values.relative_humidity ?? null;
  const soilMoisture = indoor.values.soil_moisture_index ?? null;

  const outdoorTemp = outdoor?.values.outdoor_air_temperature ?? null;
  const outdoorRh = outdoor?.values.outdoor_relative_humidity ?? null;
  const rain = outdoor?.values.outdoor_precipitation ?? null;
  const outdoorUsable = outdoor !== null && outdoor.quality !== 'invalid' && outdoor.quality !== 'stale';
  const outdoorAh =
    outdoorTemp !== null && outdoorRh !== null ? absoluteHumidityGm3(outdoorTemp, outdoorRh) : null;
  const indoorAh = temp !== null && rh !== null ? absoluteHumidityGm3(temp, rh) : null;
  const canVentilate = equipment.ventilation || equipment.ventilationFan;
  const ventActionId = equipment.ventilation ? 'ventilation.open' : 'ventilation_fan.on';

  // --- Temperature above optimal ------------------------------------------
  const tempConstraint = constraints.get('air_temperature');
  if (temp !== null && (tempConstraint?.status === 'above' || tempConstraint?.status === 'critical')) {
    const critical = tempConstraint.status === 'critical';
    const basePriority: Priority = critical ? 'critical' : 'high';
    if (outdoorUsable && outdoorTemp !== null && outdoorTemp < temp - 1) {
      const rainRisk = rain !== null && rain > 0.1;
      const humidityRisk = outdoorRh !== null && outdoorRh > cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT + 5;
      if (!rainRisk && !humidityRisk) {
        if (canVentilate) {
          mergeCandidate(candidates, {
            actionId: ventActionId,
            priority: basePriority,
            reasons: [
              `indoor air ${temp} °C exceeds the potato optimal maximum ${cfg.POTATO_AIR_TEMP_OPTIMAL_MAX_C} °C`,
              `outdoor air is cooler (${outdoorTemp} °C vs ${temp} °C) with outdoor RH ${outdoorRh ?? 'unknown'} % and precipitation ${rain ?? 'unknown'} mm`,
              `opening/activating ${capabilityLabel(equipment.ventilation ? 'ventilation' : 'ventilationFan')} should move indoor temperature toward outdoor conditions`,
            ],
            metric: 'air_temperature',
            expectedEffect: {
              description: 'Exchange greenhouse air with cooler outdoor air',
              direction: 'decrease',
              metric: 'air_temperature',
              magnitude: `${roundTo(temp - outdoorTemp, 1)} °C outdoor-indoor difference`,
            },
            requiresOutdoorEvidence: true,
          });
        } else {
          mergeCandidate(candidates, {
            actionId: 'operator.alert.temperature_high',
            priority: 'critical',
            reasons: [
              `indoor air ${temp} °C exceeds the optimal maximum and no ventilation hardware is declared`,
              'no cooling hardware is installed; manual intervention is required',
            ],
            metric: 'air_temperature',
            expectedEffect: {
              description: 'Operator action required; the backend cannot cool the greenhouse',
              direction: 'unknown',
              metric: 'air_temperature',
              magnitude: null,
            },
            requiresOutdoorEvidence: false,
          });
        }
      } else {
        mergeCandidate(candidates, {
          actionId: 'operator.alert.temperature_high',
          priority: basePriority,
          reasons: [
            `indoor air ${temp} °C is above the optimal maximum`,
            `outdoor air is cooler (${outdoorTemp} °C) but ${rainRisk ? `rain (${rain} mm)` : ''}${rainRisk && humidityRisk ? ' and ' : ''}${humidityRisk ? `high outdoor humidity (${outdoorRh} %)` : ''} makes ventilation a disease-risk trade-off`,
            'no recommendation to open ventilation is emitted without a humidity/rain assessment',
          ],
          metric: 'air_temperature',
          expectedEffect: {
            description: 'Manual judgement required: cooling benefit vs humidity/disease risk',
            direction: 'unknown',
            metric: 'air_temperature',
            magnitude: null,
          },
          requiresOutdoorEvidence: false,
        });
      }
    } else if (outdoorUsable && outdoorTemp !== null) {
      mergeCandidate(candidates, {
        actionId: 'operator.alert.temperature_high',
        priority: basePriority,
        reasons: [
          `indoor air ${temp} °C is above the optimal maximum`,
          `outdoor air (${outdoorTemp} °C) is not cooler than indoor air (${temp} °C), so ventilation would not reduce temperature`,
          canVentilate ? 'ventilation is available but not recommended under these conditions' : 'no ventilation hardware is declared',
        ],
        metric: 'air_temperature',
        expectedEffect: {
          description: 'Do not ventilate for cooling: outdoor air is not cooler',
          direction: 'maintain',
          metric: 'air_temperature',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    } else {
      mergeCandidate(candidates, {
        actionId: 'operator.alert.temperature_high',
        priority: critical ? 'critical' : 'medium',
        reasons: [
          `indoor air ${temp} °C is above the optimal maximum`,
          outdoor === null ? 'outdoor data is unavailable (source disabled, failed, or coordinates unset), so no ventilation benefit can be established' : `outdoor data quality is ${outdoor.quality}: ${outdoor.reasons.join('; ')}`,
          'no cooling action is recommended without evidence that outdoor conditions are better',
        ],
        metric: 'air_temperature',
        expectedEffect: {
          description: 'Escalate to the operator; insufficient outdoor evidence',
          direction: 'unknown',
          metric: 'air_temperature',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    }
  }

  // --- Temperature below optimal ------------------------------------------
  if (temp !== null && (tempConstraint?.status === 'below' || tempConstraint?.status === 'critical')) {
    if (tempConstraint.status === 'critical') {
      mergeCandidate(candidates, {
        actionId: 'operator.alert.temperature_low',
        priority: 'critical',
        reasons: [
          `indoor air ${temp} °C is below the critical minimum ${cfg.POTATO_AIR_TEMP_CRITICAL_MIN_C} °C (frost risk)`,
          'no heating hardware is declared; manual protection is required',
        ],
        metric: 'air_temperature',
        expectedEffect: {
          description: 'Operator action required; the backend cannot heat the greenhouse',
          direction: 'increase',
          metric: 'air_temperature',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    } else if (equipment.ventilation) {
      mergeCandidate(candidates, {
        actionId: 'ventilation.close',
        priority: 'medium',
        reasons: [
          `indoor air ${temp} °C is below the optimal minimum ${cfg.POTATO_AIR_TEMP_OPTIMAL_MIN_C} °C`,
          'closing vents conserves heat; opening them would only help if outdoor air were warmer, which is not assumed',
        ],
        metric: 'air_temperature',
        expectedEffect: {
          description: 'Reduce heat loss by closing ventilation',
          direction: 'increase',
          metric: 'air_temperature',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    } else {
      mergeCandidate(candidates, {
        actionId: 'operator.alert.temperature_low',
        priority: 'medium',
        reasons: [
          `indoor air ${temp} °C is below the optimal minimum and no heating/ventilation hardware is declared`,
        ],
        metric: 'air_temperature',
        expectedEffect: {
          description: 'Operator action required',
          direction: 'increase',
          metric: 'air_temperature',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    }
  }

  // --- Humidity above optimal --------------------------------------------
  const rhConstraint = constraints.get('relative_humidity');
  if (rh !== null && rhConstraint?.status === 'above') {
    if (
      canVentilate &&
      outdoorUsable &&
      outdoorAh !== null &&
      indoorAh !== null &&
      outdoorAh < indoorAh - 1 &&
      (rain === null || rain <= 0.1)
    ) {
      mergeCandidate(candidates, {
        actionId: ventActionId,
        priority: rh >= 95 ? 'high' : 'medium',
        reasons: [
          `indoor RH ${rh} % exceeds the optimal maximum ${cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT} %`,
          `outdoor absolute humidity ${roundTo(outdoorAh, 1)} g/m³ is lower than indoor ${roundTo(indoorAh, 1)} g/m³`,
          'ventilation should remove moisture without importing more water vapour',
        ],
        metric: 'relative_humidity',
        expectedEffect: {
          description: 'Replace humid indoor air with drier outdoor air',
          direction: 'decrease',
          metric: 'relative_humidity',
          magnitude: `${roundTo(indoorAh - outdoorAh, 1)} g/m³ absolute-humidity difference`,
        },
        requiresOutdoorEvidence: true,
      });
    } else {
      const why =
        !canVentilate
          ? 'no ventilation hardware is declared'
          : !outdoorUsable
            ? 'outdoor data is unavailable or not fresh'
            : outdoorAh === null || indoorAh === null
              ? 'absolute humidity cannot be computed'
              : (rain ?? 0) > 0.1
                ? `rain is expected (${rain} mm)`
                : `outdoor absolute humidity (${roundTo(outdoorAh, 1)} g/m³) is not lower than indoor (${roundTo(indoorAh, 1)} g/m³)`;
      mergeCandidate(candidates, {
        actionId: 'operator.alert.humidity_high',
        priority: rh >= 95 ? 'high' : 'medium',
        reasons: [
          `indoor RH ${rh} % exceeds the optimal maximum ${cfg.POTATO_HUMIDITY_OPTIMAL_MAX_PCT} %`,
          `${why}; ventilation would not reliably reduce humidity`,
          'no dehumidifier is declared, so this is an operator decision',
        ],
        metric: 'relative_humidity',
        expectedEffect: {
          description: 'Manual humidity management required',
          direction: 'unknown',
          metric: 'relative_humidity',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    }
  }

  // --- Humidity below optimal --------------------------------------------
  if (rh !== null && rhConstraint?.status === 'below') {
    if (equipment.humidifierFan) {
      mergeCandidate(candidates, {
        actionId: 'humidifier_fan.on',
        priority: 'medium',
        reasons: [
          `indoor RH ${rh} % is below the optimal minimum ${cfg.POTATO_HUMIDITY_OPTIMAL_MIN_PCT} %`,
          'a humidification fan is declared; activating it should raise humidity',
        ],
        metric: 'relative_humidity',
        expectedEffect: {
          description: 'Increase greenhouse humidity',
          direction: 'increase',
          metric: 'relative_humidity',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    } else {
      mergeCandidate(candidates, {
        actionId: 'operator.alert.humidity_low',
        priority: 'low',
        reasons: [
          `indoor RH ${rh} % is below the optimal minimum and no humidification hardware is declared`,
        ],
        metric: 'relative_humidity',
        expectedEffect: {
          description: 'Operator action required',
          direction: 'increase',
          metric: 'relative_humidity',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    }
  }

  // --- Soil moisture: irrigation stays independent by default --------------
  if (soilMoisture !== null && constraints.get('soil_moisture_index')?.status === 'below') {
    if (cfg.AI_ALLOW_IRRIGATION_RECOMMENDATIONS && equipment.pump) {
      mergeCandidate(candidates, {
        actionId: 'irrigation.pump_on',
        priority: 'high',
        reasons: [
          `soil moisture index ${soilMoisture} is below the configured relative minimum ${cfg.POTATO_SOIL_MOISTURE_INDEX_MIN}`,
          'the index is uncalibrated (relative ADC scale), so this is advisory only',
          'irrigation recommendations were explicitly enabled; the ESP32 retains its own safety thresholds',
        ],
        metric: 'soil_moisture_index',
        expectedEffect: {
          description: 'Increase substrate moisture',
          direction: 'increase',
          metric: 'soil_moisture_index',
          magnitude: null,
        },
        requiresOutdoorEvidence: false,
      });
    } else {
      skipped.push({
        actionId: 'irrigation.pump_on',
        reason:
          'suppressed: AI_ALLOW_IRRIGATION_RECOMMENDATIONS=false (existing pump threshold logic must stay independent)',
      });
    }
  }

  // --- Gas trend (raw counts only) ---------------------------------------
  const gasTrend = evaluateTrends(input.series, cfg).trends.find((t) => t.variable === 'mq135_gas_raw');
  const gasThresholdReached =
    cfg.GAS_RAW_ALERT_THRESHOLD !== undefined &&
    indoor.values.mq135_gas_raw !== null &&
    indoor.values.mq135_gas_raw !== undefined &&
    indoor.values.mq135_gas_raw >= cfg.GAS_RAW_ALERT_THRESHOLD;
  const gasRising =
    gasTrend !== undefined &&
    gasTrend.samples >= 6 &&
    gasTrend.windowMinutes >= cfg.GAS_RAW_TREND_MIN_MINUTES &&
    gasTrend.percentChange !== null &&
    gasTrend.percentChange >= cfg.GAS_RAW_TREND_ALERT_PERCENT;

  if (gasThresholdReached || gasRising) {
    mergeCandidate(candidates, {
      actionId: 'operator.alert.gas_trend',
      priority: gasThresholdReached ? 'high' : 'medium',
      reasons: [
        gasThresholdReached
          ? `MQ135 raw counts (${indoor.values.mq135_gas_raw}) reached the configured raw alert threshold ${cfg.GAS_RAW_ALERT_THRESHOLD}`
          : `MQ135 raw counts rose ${gasTrend?.percentChange} % over ${Math.round(gasTrend?.windowMinutes ?? 0)} min`,
        'raw MQ135 counts are uncalibrated and are NOT a VOC index or ppm value; inspect the sensor and ventilate manually if appropriate',
      ],
      metric: 'mq135_gas_raw',
      expectedEffect: {
        description: 'Operator inspection of the gas sensor and greenhouse air',
        direction: 'unknown',
        metric: 'mq135_gas_raw',
        magnitude: null,
      },
      requiresOutdoorEvidence: false,
    });
  }

  // --- Lighting is never recommended from an uncalibrated photoresistor ----
  if (equipment.supplementalLight) {
    skipped.push({
      actionId: 'supplemental_light.on',
      reason:
        'suppressed: light_raw is an uncalibrated photoresistor count (no lux/PAR model); a lighting recommendation would be unjustified',
    });
  } else {
    skipped.push({
      actionId: 'supplemental_light.on',
      reason: 'not applicable: no supplemental lighting hardware is declared in the firmware',
    });
  }

  return { candidates: [...candidates.values()], skipped };
}

// ---------------------------------------------------------------------------
// 4-5. Recommendation generation + safety validation
// ---------------------------------------------------------------------------

function buildChecks(params: {
  candidate: Candidate;
  action: ActionDefinition;
  equipment: EquipmentCapabilities;
  cfg: PipelineConfig;
  indoor: ValidatedIndoorSnapshot;
  outdoor: OutdoorContext | null;
}): SuggestionV1['safety'] {
  const { candidate, action, equipment, cfg, indoor, outdoor } = params;
  const capabilityPresent = action.capability === null ? true : equipment[action.capability];
  const outdoorEvidenceOk =
    !candidate.requiresOutdoorEvidence ||
    (outdoor !== null && (outdoor.quality === 'ok' || outdoor.quality === 'degraded'));

  const checks = [
    {
      id: 'advisory_only',
      passed: true,
      detail: 'Recommendation is advisory; the pipeline never writes actuator commands or bypasses ESP32 safety controls.',
    },
    {
      id: 'human_approval',
      passed: true,
      detail: 'A human must approve and execute any action through the existing command path.',
    },
    {
      id: 'hardware_capability',
      passed: capabilityPresent,
      detail:
        action.capability === null
          ? 'No physical actuator is targeted.'
          : `${capabilityLabel(action.capability)} is ${capabilityPresent ? 'declared installed' : 'NOT declared installed'}.`,
    },
    {
      id: 'input_quality',
      passed: indoor.overallQuality !== 'invalid' && indoor.overallQuality !== 'stale',
      detail: `indoor data quality is ${indoor.overallQuality}`,
    },
    {
      id: 'outdoor_evidence',
      passed: outdoorEvidenceOk,
      detail: candidate.requiresOutdoorEvidence
        ? `outdoor evidence quality is ${outdoor?.quality ?? 'unavailable'}`
        : 'action does not depend on outdoor evidence',
    },
    {
      id: 'irrigation_independence',
      passed: !action.requiresIrrigationApproval || cfg.AI_ALLOW_IRRIGATION_RECOMMENDATIONS,
      detail: action.requiresIrrigationApproval
        ? `AI irrigation recommendations are ${cfg.AI_ALLOW_IRRIGATION_RECOMMENDATIONS ? 'explicitly enabled' : 'disabled by default'}`
        : 'action is independent of the irrigation pump logic',
    },
  ];

  const blockedReasons = checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail}`);
  return {
    passed: blockedReasons.length === 0,
    checks,
    blockedReasons,
    executesActuator: false,
    requiresHumanApproval: true,
  };
}

function suggestionId(greenhouseId: string, observedAtMs: number, actionId: string): string {
  return `sug_${sanitizePathKey(greenhouseId)}_${observedAtMs}_${sanitizePathKey(actionId)}`;
}

export function evaluateDecision(input: DecisionInput): DecisionEvaluation {
  const { cfg, greenhouseId, nowMs, indoor, outdoor, previous, equipment } = input;
  const constraints = evaluateConstraints(indoor, cfg);
  const { trends, windowMinutes } = evaluateTrends(input.series, cfg);
  const outdoorSummary = outdoor
    ? {
        sourceId: outdoor.sourceId,
        observedAt: outdoor.observedAt,
        ageMinutes: outdoor.ageMinutes,
        timeDeltaSeconds: outdoor.timeDeltaSeconds,
        distanceKm: outdoor.distanceKm,
        values: outdoor.values,
        units: outdoor.units,
        quality: outdoor.quality,
        reasons: outdoor.reasons,
        comparisonCaveats: [...outdoor.caveats, ...outdoor.reasons],
      }
    : null;

  const baseInputSummary = {
    indoor: {
      observedAt: indoor.observedAt,
      ageMinutes: indoor.ageMinutes,
      quality: indoor.overallQuality,
      values: indoor.values,
      rawValues: indoor.rawValues,
      units: indoor.units,
      variableQuality: indoor.variableQuality,
      reasons: indoor.reasons,
    },
    outdoor: outdoorSummary,
    constraints,
    history: {
      samples: input.series.length,
      windowMinutes,
      trends: Object.fromEntries(trends.map((t) => [t.variable, t.slopePerHour])),
    },
    equipment: { ...equipment },
    dataQuality: {
      status: indoor.overallQuality,
      reasons: indoor.reasons,
    },
  };

  const appliedCalibrations = Object.values(indoor.calibration ?? {}).filter((c) => c.applied);
  const baseCalibration = {
    indoorSensorStatus: appliedCalibrations.length > 0 ? ('bias_corrected' as const) : ('none' as const),
    outdoorComparisonStatus: outdoor ? ('unit_conversion' as const) : ('not_applicable' as const),
    notes: [
      appliedCalibrations.length > 0
        ? `Reference-based calibration applied to: ${appliedCalibrations.map((c) => c.variable).join(', ')}. ` +
          'The raw sensor values are preserved next to the calibrated values.'
        : 'Local sensors have no reference-based calibration applied; readings are raw/unit-normalized only.',
      'Outdoor comparisons are like-for-like physical quantities (temperature, humidity, pressure) across different environments.',
      VOC_POLICY.statement,
    ],
  };

  const dataQuality = {
    status:
      indoor.overallQuality === 'ok' && (!outdoor || outdoor.quality === 'ok')
        ? ('ok' as const)
        : indoor.overallQuality === 'invalid'
          ? ('invalid' as const)
          : indoor.overallQuality === 'stale'
            ? ('stale' as const)
            : ('degraded' as const),
    reasons: [...indoor.reasons, ...(outdoor?.reasons ?? [])],
  };

  // Invalid or stale essential inputs => diagnostic only.
  if (indoor.overallQuality === 'invalid' || indoor.overallQuality === 'stale') {
    const diagnostic: SuggestionV1 = {
      schemaVersion: 'ai-suggestion/v1',
      recommendationId: `diag_${sanitizePathKey(greenhouseId)}_${indoor.observedAtMs}`,
      recordType: 'diagnostic',
      greenhouseId,
      createdAt: toIsoUtc(nowMs),
      createdAtMs: nowMs,
      expiresAt: toIsoUtc(addHours(nowMs, 1)),
      expiresAtMs: addHours(nowMs, 1),
      status: 'diagnostic',
      action: {
        id: 'none',
        category: 'notify',
        targetDevice: 'none',
        requestedCommand: null,
        executionMode: 'advisory_only',
        executableByBackend: false,
        requiresHumanApproval: true,
      },
      reason:
        `No recommendation generated: essential indoor data is ${indoor.overallQuality}. ` +
        indoor.reasons.join('; '),
      priority: 'high',
      confidence: null,
      confidenceNote: 'Diagnostic record; no decision was made.',
      expectedEffect: {
        description: 'Restore fresh, valid sensor telemetry before expecting recommendations',
        direction: 'unknown',
        metric: null,
        magnitude: null,
      },
      inputSummary: baseInputSummary,
      calibration: baseCalibration,
      safety: {
        passed: false,
        checks: [
          { id: 'input_quality', passed: false, detail: `indoor data quality is ${indoor.overallQuality}` },
          { id: 'advisory_only', passed: true, detail: 'No actuator command was generated.' },
        ],
        blockedReasons: [`indoor data quality is ${indoor.overallQuality}: ${indoor.reasons.join('; ')}`],
        executesActuator: false,
        requiresHumanApproval: true,
      },
      ruleVersion: RULESET_VERSION,
      modelVersion: null,
      outcome: null,
    };
    return {
      recommendations: [],
      diagnostics: [diagnostic],
      skipped: [{ actionId: 'all', reason: 'essential indoor data invalid or stale' }],
      constraints,
      trends,
      dataQuality,
      suppressedByCooldown: 0,
    };
  }

  const { candidates, skipped } = buildCandidates(input);
  const recommendations: SuggestionV1[] = [];
  let suppressedByCooldown = 0;

  const sorted = candidates.sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);

  for (const candidate of sorted) {
    if (recommendations.length >= cfg.MAX_RECOMMENDATIONS_PER_RUN) {
      skipped.push({ actionId: candidate.actionId, reason: `per-run recommendation cap (${cfg.MAX_RECOMMENDATIONS_PER_RUN}) reached` });
      continue;
    }
    // Alerts use ids like `operator.alert.gas_trend`; their catalog entry is `operator.alert`.
    const actualAction = candidate.actionId.startsWith('operator.alert')
      ? actionById('operator.alert')
      : actionById(candidate.actionId);

    const safety = buildChecks({ candidate, action: actualAction, equipment, cfg, indoor, outdoor });
    if (!safety.passed) {
      skipped.push({ actionId: candidate.actionId, reason: `safety validation failed: ${safety.blockedReasons.join('; ')}` });
      continue;
    }

    const duplicate = previous.find(
      (p) =>
        p.action.id === actualAction.id &&
        p.status === 'open' &&
        nowMs - p.createdAtMs < cfg.RECOMMENDATION_COOLDOWN_MS
    );

    // Alert ids are more specific than the catalog id; treat them separately.
    const duplicateAlert = previous.find(
      (p) =>
        p.action.id === actualAction.id &&
        p.reason.includes(candidate.reasons[0] ?? '') &&
        p.status === 'open' &&
        nowMs - p.createdAtMs < cfg.RECOMMENDATION_COOLDOWN_MS
    );

    if ((actualAction.id !== 'operator.alert' && duplicate) || (actualAction.id === 'operator.alert' && duplicateAlert)) {
      suppressedByCooldown++;
      skipped.push({
        actionId: candidate.actionId,
        reason: `deduplicated: an equivalent recommendation is still open (cooldown ${Math.round(cfg.RECOMMENDATION_COOLDOWN_MS / 60_000)} min)`,
      });
      continue;
    }

    recommendations.push({
      schemaVersion: 'ai-suggestion/v1',
      recommendationId: suggestionId(greenhouseId, indoor.observedAtMs, candidate.actionId),
      recordType: 'recommendation',
      greenhouseId,
      createdAt: toIsoUtc(nowMs),
      createdAtMs: nowMs,
      expiresAt: toIsoUtc(nowMs + cfg.SUGGESTION_TTL_MS),
      expiresAtMs: nowMs + cfg.SUGGESTION_TTL_MS,
      status: 'open',
      action: {
        id: actualAction.id,
        category: actualAction.category,
        targetDevice: actualAction.targetDevice,
        requestedCommand: null,
        executionMode: 'advisory_only',
        executableByBackend: false,
        requiresHumanApproval: true,
      },
      reason: candidate.reasons.join(' '),
      priority: candidate.priority,
      confidence: null,
      confidenceNote: 'Deterministic rule evaluation, not a statistical probability; no validated outcome model exists yet.',
      expectedEffect: candidate.expectedEffect,
      inputSummary: baseInputSummary,
      calibration: baseCalibration,
      safety,
      ruleVersion: RULESET_VERSION,
      modelVersion: null,
      outcome: null,
    });
  }

  return {
    recommendations,
    diagnostics: [],
    skipped,
    constraints,
    trends,
    dataQuality,
    suppressedByCooldown,
  };
}

/** Map a candidate action category to the metric used for outcome tracking. */
export function outcomeMetricFor(actionId: string): string | null {
  if (actionId.startsWith('ventilation')) return 'air_temperature';
  if (actionId.startsWith('humidifier')) return 'relative_humidity';
  if (actionId.startsWith('irrigation')) return 'soil_moisture_index';
  if (actionId.startsWith('operator.alert.gas')) return 'mq135_gas_raw';
  return null;
}
