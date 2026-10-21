# AI data-integration, decision and prediction pipelines

This document describes the pipeline that lives in `backend/src/ai/pipeline/`, the
Firebase layout it uses, and — most importantly — **how it stays compatible with
the prediction data that already exists in the database**.

---

## 1. The existing `aiPredictions` node (the contract, verified against the code)

The node holds prediction history with four fields per record. This is the
structure the pipeline reads and appends to:

```json
{
  "aiPredictions": {
    "3001": {
      "type": "rainfall",
      "predictedValue": "after 2 days afternoon",
      "confidence": 0.85,
      "predictionTime": 1791867600000
    },
    "3002": {
      "type": "air_temp",
      "predictedValue": 30.0,
      "confidence": 0.9,
      "predictionTime": 1791867600000
    }
  }
}
```

### Where it lives, and what is actually in the database today

`npm run inspect:legacy` (read-only, `backend/scripts/inspect-legacy-predictions.ts`)
prints the database root, the keys under `/Sensoura`, and the parsed contents of
the prediction node. Last run (2026-10-21, project `on-an-official-team`):

```
database root keys: Sensoura
/Sensoura keys: aiSuggestions, commandResults, commands, sensorData, system
/Sensoura/aiPredictions: the node does not exist.
/aiPredictions: the node does not exist.
```

So in *this* project the node is currently empty — the pipeline creates it the
first time it appends a record, and it never touches the other nodes. The
reader is written for the full node either way: a missing node reads as
`present: false` with zero records, which is not an error and produces no
warning beyond the count in the cycle statistics.

Properties of the structure:

| Property | Value | Consequence for the pipeline |
| --- | --- | --- |
| Path | `/Sensoura/aiPredictions` | Never renamed, never replaced. |
| Record keys | Numeric strings (`"3001"`) | New records also use numeric string keys. |
| `type` | Free-form string (`rainfall`, `air_temp`) | Kept as the primary "what is this" field. |
| `predictedValue` | **String *or* number** depending on the type | The representation is type-specific and documented below. |
| `confidence` | Number in `0..1` | Never fabricated. See §4. |
| `predictionTime` | Numeric Unix timestamp in **milliseconds** | Preserved as-is; never converted to seconds or ISO on write. |

### Consumers of the existing nodes

| Component | Reads `aiPredictions`? | Reads `aiSuggestions`? |
| --- | --- | --- |
| `backend/src/services/realtime.ts` | No | **Yes** — `/Sensoura/aiSuggestions` is subscribed and `approveSuggestion()` turns an approval into a real `pump ON` command. |
| `backend/src/socket/index.ts` | No | Yes (same node). |
| `frontend/src/*` | No | Yes (socket subscription, approve/reject buttons). |
| `firmware/src/main.ino` | No | No — the firmware only listens for `commands`. |
| `backend/src/ai/engine.ts` (legacy tfjs) | No | Writes suggestions through the realtime service. |

Two consequences, and they drive the whole design:

1. **`/Sensoura/aiSuggestions` is never written by the pipeline.** It is wired to
   an approval flow that actuates the pump. Injecting advisory AI records there
   would let an operator (or the dashboard) approve a recommendation and switch
   the pump on. The pipeline writes its own suggestions to
   `/Sensoura/AI_Suggestions` instead.
2. **`/Sensoura/aiPredictions` has no in-repo consumer**, so appending to it is
   safe — provided existing records are never touched. That is guaranteed below.

---

## 2. Compatibility plan

The plan has five rules. Each one is enforced in code and covered by tests in
`backend/__tests__/ai-pipeline-legacy.test.ts`.

1. **Read with the real structure.** `readLegacyPredictions()` parses the node
   with the verified four-field contract, and keeps the raw record verbatim so
   nothing about a historical record is lost on a round trip.
2. **Preserve the field names.** Every record the pipeline appends uses
   `type`, `predictedValue`, `confidence` and `predictionTime` with the same
   meanings as the existing records.
3. **Preserve millisecond timestamps.** `predictionTime` is a numeric Unix
   timestamp in milliseconds, exactly like `1791867600000`. The pipeline's own
   records use the same convention, so one reader handles both.
4. **Never delete or overwrite.** The pipeline only ever *appends*. A new record
   is written under an id that is verified to be free
   (`saveLegacyPredictionIfAbsent()`); an existing key is left byte-for-byte
   unchanged. The existing `3001` / `3002` records are never rewritten,
   re-keyed or removed, during normal operation, deployment or migration.
5. **New metadata is additive and optional.** Anything extra the pipeline needs
   (`unit`, `forecastStart`, `forecastEnd`, `precipitationMm`, `riskLevel`,
   `stages`, `source`, `confidenceNote`, `previousPrediction`, `predictionId`,
   `schemaVersion`) is an optional field on top of the legacy four. A consumer
   that only knows the four legacy fields keeps working unchanged.

### Where the pipeline writes

| Path | Owner | Written by the pipeline? |
| --- | --- | --- |
| `/Sensoura/sensorData` | legacy backend / firmware | Read-only |
| `/Sensoura/system` | legacy backend / firmware | Read-only |
| `/Sensoura/commands` | legacy backend | Never |
| `/Sensoura/aiSuggestions` | legacy dashboard (auto-executes) | **Never** |
| `/Sensoura/aiPredictions` | pre-existing data | **Append-only** (new ids only) |
| `/Sensoura/AI_Predictions` | this pipeline | Yes (rich, versioned records) |
| `/Sensoura/AI_Suggestions` | this pipeline | Yes (rich, versioned records) |
| `/Sensoura/AI_Data/**` | this pipeline | Yes (series, observations, executions, locks) |

The `AI_Predictions` path is kept because the compatibility plan above is
implemented: the legacy node is read, extended and preserved, so the pipeline's
own versioned records do not replace anything.

---

## 3. Representation per prediction type

`predictedValue` is type-specific, so the type of the value is never mixed
inside one field. The full table:

| Legacy `type` | `predictedValue` | Unit | Optional fields added | Source prediction |
| --- | --- | --- | --- | --- |
| `rainfall` | **string** — the forecast period, e.g. `"after 1 day"` | `mm` | `precipitationMm`, `forecastStart`, `forecastEnd` | `outdoor_precipitation_<h>h` |
| `air_temp` | **number** — mean air temperature | `degC` | `forecastStart`, `forecastEnd` | `outdoor_air_temperature_<h>h` |
| `humidity` | **number** — mean relative humidity | `%` | `forecastStart`, `forecastEnd` | `outdoor_relative_humidity_<h>h` |
| `solar_radiation` | **number** — mean shortwave radiation | `W/m2` | `forecastStart`, `forecastEnd` | `outdoor_shortwave_radiation_<h>h` |
| `indoor_air_temp` | **number** — persistence baseline | `degC` | `forecastStart`, `forecastEnd` | `air_temperature_<h>h` |
| `indoor_soil_moisture` | **number** — persistence baseline | `%` | `forecastStart`, `forecastEnd` | `soil_moisture_index_<h>h` |
| `growth_stage` | **number** — accumulated GDD so far | `degC·day` | `accumulatedGdd`, `stages[]` (projected dates) | `potato_gdd_stages` |
| `disease_risk` | **string** — overall risk level (`low`/`moderate`/`high`) | — | `riskLevel`, `riskDays[]` (per-day detail) | `late_blight_smith_period` |

`rainfall`, `air_temp` are the pre-existing types. The rest are documented
extensions of the same vocabulary.

### Why rainfall keeps a string

The existing record stores `"after 2 days afternoon"` — a period description,
not a quantity. Keeping `predictedValue` a string for `type: "rainfall"` is
therefore the backward-compatible contract, and the *quantity* is published in
the optional `precipitationMm` field (millimetres, summed over the forecast
window) together with `forecastStart` / `forecastEnd`. Nothing is lost, and no
consumer has to parse a string to get a number.

### What is deliberately not published

* `voc_estimate` — the pipeline explicitly does **not** estimate VOC; publishing
  a placeholder would imply a measurement that does not exist.
* `source_comparison` — a diagnostic, not a forecast.
* Any prediction whose status is `error`, `insufficient_data`,
  `insufficient_configuration` or `unsupported` — no value was produced, so no
  record is written.

---

## 4. `confidence`: never invented

The pipeline does not produce calibrated confidence values. The Open-Meteo
deterministic endpoint returns no ensemble spread, the late-blight rule is a
documented heuristic, and the persistence baseline is a walk-forward backtest,
not a probability of being right.

So for every record the pipeline appends:

```json
"confidence": null,
"confidenceNote": "confidence is null: this pipeline does not produce calibrated confidence scores and never invents one."
```

`confidence` is therefore:

* **a finite number in `0..1`** for the existing records (validated on read; a
  value outside the range is reported as an issue and treated as absent), and
* **`null`** for records the pipeline writes — "not computed", never a
  fabricated number.

**Consumer migration note (one required change):** a consumer that hard-requires
`confidence` to be a number must accept `null` for the new records. A tolerant
consumer (`confidence ?? fallback`, `confidence != null`) needs no change at all.
Records that already exist are untouched, so a consumer that has never seen a
`null` keeps working on them.

---

## 5. Record ids

Existing keys are numeric strings (`"3001"`). New records keep that shape and
are guaranteed not to collide with the existing range:

```
<13-digit Unix ms><4-digit index>      e.g. 17918676000000000, 17918676000000001
```

* 17 digits, so it can never equal a 4-digit legacy key.
* Both parts have a fixed width, so an id splits back into its
  `(timestamp, index)` pair without ambiguity and two different pairs can never
  produce the same string.
* Deterministic: the same predictions and the same run timestamp always produce
  the same ids, whatever order the predictions arrive in (the projections are
  sorted by `(type, target)` before the index is assigned).
* A key that is already taken is skipped, never overwritten — so replaying a
  run with the same timestamp is a no-op instead of a duplicate.
* A *later* run legitimately appends a new record: the node is a history of
  issued predictions, one record per run per type, each with its own
  `predictionTime`.

---

## 6. Reading the node back

The pipeline reads the legacy node on every prediction cycle. Each record is
parsed into:

```ts
{
  key: '3001',
  type: 'rainfall',
  predictedValue: 'after 2 days afternoon',
  confidence: 0.85,
  predictionTime: 1791867600000,
  predictionTimeIso: '2026-10-13T05:00:00.000Z',
  raw: { /* the record exactly as stored */ },
  valid: true,
  issues: []
}
```

The most recent earlier record of the same type is attached to each new
projection as the optional `previousPrediction` field, so the node shows its
own history. The parsed view is also available over HTTP:

```
GET http://localhost:3100/predictions/legacy
```

---

## 7. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_LEGACY_PREDICTIONS_PATH` | `/Sensoura/aiPredictions` | The pre-existing node. Point it elsewhere to disable the compatibility target. |
| `AI_LEGACY_PREDICTIONS_WRITE` | `true` | Set to `false` to keep the pipeline read-only against the legacy node. |
| `AI_PREDICTIONS_PATH` | `/Sensoura/AI_Predictions` | The pipeline's own rich prediction records. |
| `AI_SUGGESTIONS_PATH` | `/Sensoura/AI_Suggestions` | The pipeline's own rich recommendation records. |
| `AI_DATA_ROOT` | `/Sensoura/AI_Data` | Series, observations, executions, locks. |

With `AI_LEGACY_PREDICTIONS_WRITE=true` the startup log carries an explicit
warning that new predictions are appended to the existing node and that
existing records are never modified.

---

## 8. Local sensor ↔ external variable mapping

The mapping is declared once, in `backend/src/ai/pipeline/calibration/registry.ts`
(`VARIABLE_MAPPINGS`), and is enforced by the observation builder. The
classifications mean:

| Classification | Meaning |
| --- | --- |
| `direct_match` | Same physical quantity, same environment — a numeric comparison is meaningful as-is. |
| `unit_comparable_outdoor_reference` | Same physical quantity in a **different** environment (open air vs greenhouse interior). Comparable for ventilation physics; **not** a calibration reference. |
| `derived_estimate` | The provider value is a model estimate of a related quantity (e.g. earth skin temperature), not the same measurement. |
| `unsupported` | No defensible relationship. Never converted, never compared numerically, never relabelled. |
| `external_only` | No local sensor exists; the variable is external context only. |

### The seven local sensors

| Local field (repo name) | Alias | Unit | External variable | Provider | Unit | Classification | Comparable? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `temperature` | `AirTemp` | °C | `temperature_2m` | Open-Meteo | °C | `unit_comparable_outdoor_reference` | yes |
| `temperature` | `AirTemp` | °C | `T2M` | NASA POWER | °C | `unit_comparable_outdoor_reference` | yes |
| `soilTemperature` | `SoilTemp` | °C | `soil_temperature_0cm` | Open-Meteo | °C | `derived_estimate` | no |
| `soilTemperature` | `SoilTemp` | °C | `TS` | NASA POWER | °C | `derived_estimate` | no |
| `humidity` | `AirHumidity` | % | `relative_humidity_2m` | Open-Meteo | % | `unit_comparable_outdoor_reference` | yes |
| `humidity` | `AirHumidity` | % | `RH2M` | NASA POWER | % | `unit_comparable_outdoor_reference` | yes |
| `soilMoisture` | `SoilMoisture` | % (ADC index) | `soil_moisture_0_to_1cm` | Open-Meteo | m³/m³ | `unsupported` | no |
| `gas` | `VOC` | counts / VOC Index | `pm2_5`, `pm10`, `carbon_monoxide`, `nitrogen_dioxide`, `ozone`, `aerosol_optical_depth` | Open-Meteo | µg/m³ / 1 | `unsupported` | no |
| `light` | `Light` | counts (or % on the alias field) | `shortwave_radiation` | Open-Meteo | W/m² | `unsupported` | no |
| `light` | `Light` | counts | `ALLSKY_SFC_SW_DWN` | NASA POWER | MJ/hr | `unsupported` | no |
| `airPressure` | `Barometricpressure` | hPa | `surface_pressure` | Open-Meteo | hPa | `unit_comparable_outdoor_reference` | yes |
| — | — | — | `PRECTOTCORR` | NASA POWER | mm/hour | `external_only` | no |
| — | — | — | `WS2M` | NASA POWER | m/s | `external_only` | no |

### The four mappings that are deliberately refused

| Refused conversion | Why |
| --- | --- |
| `VOC` index → any external variable | No provider here measures a VOC-equivalent quantity. The MQ135 also has no R0/load-resistor calibration, so its reading is not a concentration at all. `assertNotVocTarget()` rejects any VOC-named calibration target. |
| `light` counts → lux / PAR / W/m² | The photoresistor's spectral response and circuit gain are uncalibrated. The external irradiance is broadband on a horizontal plane. A daylight recommendation is therefore never issued from the local light value. |
| `soilMoisture` index → m³/m³ | The local value is an ADC-derived relative index (3200…1200 → 0…100); the provider value is modeled volumetric water content for open soil. Converting one to the other would need substrate-specific calibration that does not exist. |
| `soilTemperature` → `TS` / `soil_temperature_0cm` | Earth skin temperature and modeled 0 cm soil temperature are neither the probe reading nor its depth equivalent; the DS18B20 insertion depth is undocumented in the firmware. |

The outdoor comparison is still **useful** even where it is not a calibration
reference: the decision engine compares indoor and outdoor air temperature and
absolute humidity to decide whether ventilating would actually help. That is a
comparison of two measurements, not a correction applied to one of them.

---

## 9. Sensor calibration: training offline, applying at inference

Calibration is **not** part of the scheduled runs. The pipeline only *reads*
artifacts that the training workflow produced; it never fits a model at run
time.

### The separation

| Stage | Where | What it does |
| --- | --- | --- |
| 1. Dataset load | `npm run ai:train` | Reads the paired reference measurements from `backend/datasets/calibration`. |
| 2. Row validation | `npm run ai:train` | Rejects individual unusable rows (non-numeric value, unparseable timestamp, duplicate timestamp) and reports them. |
| 3. Fit | `npm run ai:train` | Ordinary least squares on the earliest 70 % of the samples: `reference = intercept + slope * local`. |
| 4. Evaluation | `npm run ai:train` | The most recent 30 % are an independent chronological holdout; MAE / RMSE / bias are computed on it. |
| 5. Artifact | `npm run ai:train` | A versioned JSON artifact with the coefficients, the applicability range, the training provenance and the validation metrics. |
| 6. Application | decision + prediction cycle | The artifact is applied **only** inside the value range it was trained on, and the raw reading is always preserved next to the calibrated one. |

A model that failed its holdout is never written. `npm run ai:train` exits
non-zero and says so when no dataset is available, rather than producing a
model from nothing.

### What the artifact guarantees

* `status: "validated"` — the model passed its holdout. An `unvalidated`
  artifact is ignored by the pipeline.
* `applicability.minLocalValue` / `maxLocalValue` — the range covered by the
  training split. Outside it the calibration is **not** applied; there is no
  silent extrapolation.
* `training.instrument` — the reference instrument, mandatory. A dataset
  without one is rejected.
* `validation.metrics` — required for a `validated` artifact; an artifact
  that claims validation without metrics is rejected by the loader.

### The VOC rule, enforced in code

A calibration target may never be a VOC name. `assertNotVocTarget()` rejects
it in the training workflow **and** in the artifact loader, so a hand-written
`voc_index.json` in the artifact directory is refused with a reason instead of
being applied. No source in this integration measures an equivalent VOC
quantity, so there is nothing defensible to fit against. The MQ135 reading
stays an uncalibrated raw count and the `VOC` field stays an index.

### What the records show

`calibration.applied` is `true` **only** when a documented model or coefficient
was actually used. A reading that was merely passed through in its original
unit reports `applied: false` with `status: "none"` — the schema reserves
`true` for a real calibration.

The recommendation records carry the summary:

```json
"calibration": {
  "indoorSensorStatus": "none",
  "outdoorComparisonStatus": "unit_conversion",
  "notes": [
    "Local sensors have no reference-based calibration applied; readings are raw/unit-normalized only.",
    "Outdoor comparisons are like-for-like physical quantities (temperature, humidity, pressure) across different environments.",
    "<the VOC policy statement>"
  ]
}
```

`indoorSensorStatus` becomes `bias_corrected` only when an artifact was
actually applied to at least one variable.

### Current status

**No calibration artifact ships with the repository.** The project has no
co-located reference instrument, so:

* the pipeline uses the raw sensor values unchanged,
* recommendations report `indoorSensorStatus: "none"`,
* the stored series keeps the raw values, so adding a calibration later does
  not make the history inhomogeneous.

---

## 10. What the pipeline will not do

* It never writes `/Sensoura/commands` and never actuates the pump, the
  buzzer, the LEDs or any other device.
* It never writes `/Sensoura/aiSuggestions`, because that node is connected to
  an approval flow that actuates the pump.
* It never modifies or deletes an existing `/Sensoura/aiPredictions` record.
* It never reports a confidence it did not compute.
* It never calibrates a reading without a trained, validated artifact.
* It never converts a VOC index into a concentration, and never relabels an
  external atmospheric indicator as VOC.
