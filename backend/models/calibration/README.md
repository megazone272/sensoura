# Calibration artifacts

Trained calibration models land here, one JSON file per variable:

```
models/calibration/air_temperature.json
```

The directory is **empty in the repository**: no calibration artifact ships with
Sensoura, because the project has no paired reference measurements yet. Until an
operator supplies reference data and runs `npm run ai:train`, the pipeline uses
the raw sensor values and reports `indoorSensorStatus: "none"`.

The artifacts are generated output, so they are git-ignored. To reproduce one:

```bash
# from backend/
npm run ai:train
```

See `backend/datasets/calibration/README.md` for the dataset format and
`docs/ai-pipeline.md` for how the artifacts are applied at inference time.
