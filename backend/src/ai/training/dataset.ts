/**
 * Paired reference datasets for sensor calibration.
 *
 * A calibration dataset is a set of (timestamp, local reading, reference
 * reading) triples where the reference comes from a calibrated, co-located
 * instrument. Two on-disk formats are supported:
 *
 *   <variable>.json
 *     {
 *       "variable": "air_temperature",
 *       "unit": "degC",
 *       "instrument": "Testo 410i thermo-hygrometer",
 *       "description": "Paired indoor readings ...",
 *       "samples": [ { "timestamp": "2026-01-01T00:00:00Z", "local": 21.2, "reference": 22.1 } ]
 *     }
 *
 *   <variable>.csv + <variable>.meta.json
 *     timestamp,local,reference
 *     2026-01-01T00:00:00Z,21.2,22.1
 *
 * The metadata (reference instrument, unit, description) is MANDATORY: a
 * calibration without a documented reference instrument is not defensible, so
 * such a dataset is rejected instead of being fitted.
 */
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { z } from 'zod';
import { detectTimestamp } from '../pipeline/utils/time.js';

export interface PairedRow {
  atMs: number;
  local: number;
  reference: number;
  /** Original timestamp text as it appeared in the dataset. */
  rawTimestamp: string;
}

export interface PairedDataset {
  variable: string;
  unit: string;
  instrument: string;
  description: string;
  rows: PairedRow[];
  /** Rows that could not be used, with the reason why. */
  rejected: Array<{ row: string; reason: string }>;
  sourcePath: string;
}

export type DatasetLoadResult =
  | { ok: true; dataset: PairedDataset }
  | { ok: false; path: string; reason: string };

/**
 * Sample shape at the file level. The numeric fields are intentionally loose:
 * a single unusable row must not discard the whole dataset, so every row is
 * validated individually below and the rejected ones are reported.
 */
const sampleSchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  local: z.unknown(),
  reference: z.unknown(),
});

const jsonDatasetSchema = z.object({
  variable: z.string().min(1),
  unit: z.string().min(1),
  instrument: z.string().min(1),
  description: z.string().min(1),
  samples: z.array(sampleSchema),
});

const metaSchema = z.object({
  variable: z.string().min(1),
  unit: z.string().min(1),
  instrument: z.string().min(1),
  description: z.string().min(1),
});

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/** Coerce a dataset cell into a finite number, or null when that is impossible. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildRows(
  variable: string,
  unit: string,
  sourcePath: string,
  // `local` / `reference` are optional in the parsed type because Zod's
  // `z.unknown()` also accepts `undefined`; an absent value is rejected as an
  // unusable row below, not silently treated as zero.
  samples: ReadonlyArray<{ timestamp: string | number; local?: unknown; reference?: unknown }>
): { rows: PairedRow[]; rejected: Array<{ row: string; reason: string }> } {
  const rows: PairedRow[] = [];
  const rejected: Array<{ row: string; reason: string }> = [];
  const seen = new Set<number>();

  samples.forEach((sample, index) => {
    const label = `row ${index + 1}`;
    const local = toFiniteNumber(sample.local);
    if (local === null) {
      rejected.push({ row: label, reason: `local value is not a finite number (${String(sample.local)})` });
      return;
    }
    const reference = toFiniteNumber(sample.reference);
    if (reference === null) {
      rejected.push({ row: label, reason: `reference value is not a finite number (${String(sample.reference)})` });
      return;
    }
    const detected = detectTimestamp(sample.timestamp);
    if (detected.ms === null) {
      rejected.push({ row: label, reason: `timestamp could not be parsed (${String(sample.timestamp)})` });
      return;
    }
    if (seen.has(detected.ms)) {
      rejected.push({ row: label, reason: `duplicate timestamp ${detected.ms} (first occurrence kept)` });
      return;
    }
    seen.add(detected.ms);
    rows.push({
      atMs: detected.ms,
      local,
      reference,
      rawTimestamp: String(sample.timestamp),
    });
  });

  rows.sort((a, b) => a.atMs - b.atMs);
  void variable;
  void unit;
  void sourcePath;
  return { rows, rejected };
}

async function loadJsonDataset(path: string): Promise<DatasetLoadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    return { ok: false, path, reason: `dataset could not be read: ${(error as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, path, reason: `dataset is not valid JSON: ${(error as Error).message}` };
  }

  const result = jsonDatasetSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, path, reason: `dataset failed schema validation: ${issues.join('; ')}` };
  }

  const { rows, rejected } = buildRows(
    result.data.variable,
    result.data.unit,
    path,
    result.data.samples
  );

  return {
    ok: true,
    dataset: {
      variable: result.data.variable,
      unit: result.data.unit,
      instrument: result.data.instrument,
      description: result.data.description,
      rows,
      rejected,
      sourcePath: path,
    },
  };
}

async function loadCsvDataset(path: string): Promise<DatasetLoadResult> {
  const metaPath = path.replace(/\.csv$/i, '.meta.json');

  let metaText: string;
  try {
    metaText = await readFile(metaPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      path,
      reason:
        `CSV dataset requires a metadata file (${basename(metaPath)}) describing the reference instrument: ` +
        `${(error as Error).message}`,
    };
  }

  let metaUnknown: unknown;
  try {
    metaUnknown = JSON.parse(metaText);
  } catch (error) {
    return { ok: false, path: metaPath, reason: `metadata is not valid JSON: ${(error as Error).message}` };
  }
  const meta = metaSchema.safeParse(metaUnknown);
  if (!meta.success) {
    const issues = meta.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return { ok: false, path: metaPath, reason: `metadata failed schema validation: ${issues.join('; ')}` };
  }

  let csvText: string;
  try {
    csvText = await readFile(path, 'utf8');
  } catch (error) {
    return { ok: false, path, reason: `dataset could not be read: ${(error as Error).message}` };
  }

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    return { ok: false, path, reason: 'CSV dataset has no data rows' };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const required = ['timestamp', 'local', 'reference'];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      path,
      reason: `CSV header must contain ${required.join(', ')} (missing: ${missing.join(', ')})`,
    };
  }
  const idx = {
    timestamp: header.indexOf('timestamp'),
    local: header.indexOf('local'),
    reference: header.indexOf('reference'),
  };

  const samples: Array<{ timestamp: string | number; local: number; reference: number }> = [];
  const rejected: Array<{ row: string; reason: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const timestamp = cells[idx.timestamp];
    const local = Number(cells[idx.local]);
    const reference = Number(cells[idx.reference]);
    if (timestamp === undefined || timestamp === '') {
      rejected.push({ row: `line ${i + 1}`, reason: 'timestamp is empty' });
      continue;
    }
    samples.push({ timestamp, local, reference });
  }

  const built = buildRows(meta.data.variable, meta.data.unit, path, samples);

  return {
    ok: true,
    dataset: {
      variable: meta.data.variable,
      unit: meta.data.unit,
      instrument: meta.data.instrument,
      description: meta.data.description,
      rows: built.rows,
      rejected: [...rejected, ...built.rejected],
      sourcePath: path,
    },
  };
}

/** Load one dataset file; the format is chosen by its extension. */
export async function loadPairedDataset(path: string): Promise<DatasetLoadResult> {
  if (extname(path).toLowerCase() === '.csv') {
    return loadCsvDataset(path);
  }
  return loadJsonDataset(path);
}

/** Load every dataset in a directory (`*.json` and `*.csv`). */
export async function loadPairedDatasets(directory: string): Promise<{
  datasets: PairedDataset[];
  failures: Array<{ path: string; reason: string }>;
}> {
  const { readdir } = await import('node:fs/promises');
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    return {
      datasets: [],
      failures: [
        {
          path: directory,
          reason:
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'training dataset directory does not exist'
              : `training dataset directory could not be read: ${(error as Error).message}`,
        },
      ],
    };
  }

  const datasets: PairedDataset[] = [];
  const failures: Array<{ path: string; reason: string }> = [];

  for (const entry of entries.sort()) {
    const lower = entry.toLowerCase();
    if (!lower.endsWith('.json') && !lower.endsWith('.csv')) continue;
    if (lower.endsWith('.meta.json')) continue;
    const path = join(directory, entry);
    const result = await loadPairedDataset(path);
    if (result.ok) datasets.push(result.dataset);
    else failures.push({ path, reason: result.reason });
  }

  return { datasets, failures };
}
