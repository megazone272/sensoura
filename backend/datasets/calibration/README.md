# Paired reference datasets for sensor calibration

This directory holds the **paired reference measurements** that `npm run ai:train`
needs to fit a calibration model. It is intentionally empty in the repository:
the project has no co-located reference instrument yet, so no calibration model
exists and the pipeline uses the raw sensor values.

**Nothing in this directory is production telemetry.** These are lab/reference
readings collected next to the greenhouse node, used offline to fit a model.
The real-time sensor data stays in Firebase.

## What a dataset looks like

A dataset is a list of `(timestamp, local reading, reference reading)` triples,
where *local* is what the greenhouse sensor reported and *reference* is what a
calibrated instrument measured at the same place and time. Both values must
express the **same physical quantity in the same unit** — the model is a
same-unit bias model (`reference = intercept + slope * local`), not a unit
conversion.

### JSON form — `<variable>.json`

```json
{
  "variable": "air_temperature",
  "unit": "degC",
  "instrument": "Testo 410i thermo-hygrometer (serial 4471, calibrated 2026-09-01)",
  "description": "Paired indoor readings, DHT11 next to the reference, 5 min apart, 2026-09.",
  "samples": [
    { "timestamp": "2026-09-01T00:00:00Z", "local": 21.2, "reference": 22.1 },
    { "timestamp": "2026-09-01T00:05:00Z", "local": 21.4, "reference": 22.2 }
  ]
}
```

### CSV form — `<variable>.csv` + `<variable>.meta.json`

The metadata file is **mandatory** for CSV input: a calibration without a
documented reference instrument is not defensible, so such a dataset is rejected
instead of being fitted.

`<variable>.csv`:

```csv
timestamp,local,reference
2026-09-01T00:00:00Z,21.2,22.1
2026-09-01T00:05:00Z,21.4,22.2
```

`<variable>.meta.json`:

```json
{
  "variable": "air_temperature",
  "unit": "degC",
  "instrument": "Testo 410i thermo-hygrometer (serial 4471, calibrated 2026-09-01)",
  "description": "Paired indoor readings, DHT11 next to the reference, 5 min apart, 2026-09."
}
```

## Rules the loader enforces

| Rule | Behaviour |
| --- | --- |
| Missing reference instrument | Dataset rejected; nothing is fitted. |
| Non-numeric `local` / `reference` | That **row** is rejected and reported; the rest of the dataset is still used. |
| Unparseable timestamp | Row rejected and reported. |
| Duplicate timestamp | The second occurrence is rejected; the first is kept. |
| Too few samples | Reported as `insufficient_data`; **no artifact is written**. |
| Target is a VOC name | Rejected outright (see below). |

Timestamps may be ISO-8601, Unix seconds or Unix milliseconds; the loader
detects the format instead of guessing silently.

## VOC is not calibratable here

A dataset whose `variable` names a VOC quantity is **rejected**, both in the
loader and in the artifact loader. No external source in this integration
measures an equivalent VOC quantity, so there is nothing defensible to fit
against. The MQ135 reading stays an uncalibrated raw count, and the `VOC`
index stays an index.

## Running the training

```bash
# from backend/
npm run ai:train                              # datasets/calibration -> models/calibration
npm run ai:train -- --dataset-dir ../my-data  # explicit dataset directory
npm run ai:train -- --dry-run                 # build the artifacts, write nothing
```

The workflow splits the samples chronologically (earliest 70 % for fitting, most
recent 30 % as an independent holdout), evaluates the model on the holdout, and
writes a versioned artifact to `models/calibration/<variable>.json` with the
coefficients, the training provenance and the validation metrics.

With no datasets present the command reports that and exits non-zero. It never
invents a model.
