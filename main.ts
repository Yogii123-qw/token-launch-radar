// Token launch radar: reads the sealed snapshot, ranks the pre-token
// protocols by implied value, and writes the board, the dashboard and
// the dossier. Standard library only; deterministic: the only randomness
// is the seeded bootstrap, and no output carries a clock reading.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  selectBoard,
  selectComps,
  fitModel,
  predictLog,
  loo,
  ablation,
  rangeHonesty,
  bootstrap,
  clockBands,
  auditCounts,
  farmSteps,
  farmCost,
  breakEven,
  ageDays,
  ASSUMED_SHARE,
  DEFAULT_HAND,
  type Snapshot,
} from './lib/model.ts';

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const inputPath = argValue('--input') ?? '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const rootDir = dirname(fileURLToPath(import.meta.url));

const snap = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const asOf = snap.as_of;

const board = selectBoard(snap.protocols);
const comps = selectComps(snap.protocols);
const model = fitModel(comps, DEFAULT_HAND);

const looAdopted = loo(comps, asOf, DEFAULT_HAND, 'adopted');
const ranges = rangeHonesty(looAdopted.residuals);
const ablationRows = ablation(comps, asOf, DEFAULT_HAND);
const boot = bootstrap(comps, board, asOf, DEFAULT_HAND);
const clock = clockBands(snap.protocols, asOf);
const audit = auditCounts(snap, board, comps);
const watchSet = new Set(snap.watchlist);

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

const scored = board.map((p) => {
  const pred = predictLog(p, model, asOf, true, true);
  const value = Math.max(1, Math.round(Math.pow(10, pred)));
  return { p, pred, value };
});
scored.sort((a, b) => b.value - a.value || a.p.slug.localeCompare(b.p.slug));

const rows: BoardRow[] = scored.map(({ p, value }, i) => ({
  slug: p.slug,
  name: p.name,
  rank: i + 1,
  implied_value_usd: value,
  farm_steps: farmSteps(p, asOf),
}));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ as_of: asOf, rows }, null, 1) + '\n');

cpSync(join(rootDir, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
cpSync(join(rootDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

// Dashboard data: compact rows, one array each. The page regenerates the
// farm steps from the same templates the board was built with.
const dataRows = scored.map(({ p, pred, value }, i) => {
  const cost = farmCost(p);
  const be = breakEven(value, cost);
  const b = boot.rows.get(p.slug) as { rankLo: number; rankHi: number; top20Share: number };
  return [
    p.slug,
    p.name,
    p.category,
    p.tvl_usd,
    value,
    Math.max(1, Math.round(Math.pow(10, pred + ranges.q25))),
    Math.max(1, Math.round(Math.pow(10, pred + ranges.q75))),
    ageDays(p, asOf),
    p.change_7d,
    p.chains.length,
    p.chains[0] ?? null,
    watchSet.has(p.slug) ? 1 : 0,
    b.rankLo,
    b.rankHi,
    Math.round(b.top20Share * 100) / 100,
    cost,
    Math.round(be.slice),
    Math.round(be.odds * 100) / 100,
    i + 1,
  ];
});

const data = {
  meta: {
    asOf,
    floor: snap.floor_usd,
    fit: {
      intercept: Math.round(model.fit.intercept * 1000) / 1000,
      slope: Math.round(model.fit.slope * 1000) / 1000,
      r2: Math.round(model.fit.r2 * 1000) / 1000,
      n: model.fit.n,
    },
    hand: DEFAULT_HAND,
    shrink: { k: 8, min: 3 },
    compFilter: [0.01, 5],
    ablation: ablationRows.map((r) => [
      r.label,
      Math.round(r.loo.median * 100) / 100,
      Math.round(r.loo.within3 * 100),
      Math.round(r.loo.within10 * 100),
      Math.round(r.old.median * 100) / 100,
      Math.round(r.fresh.median * 100) / 100,
    ]),
    range: {
      q25: Math.round(ranges.q25 * 1000) / 1000,
      q75: Math.round(ranges.q75 * 1000) / 1000,
      q10: Math.round(ranges.q10 * 1000) / 1000,
      q90: Math.round(ranges.q90 * 1000) / 1000,
      cover50: ranges.cover50,
      cover80: ranges.cover80,
      n: ranges.n,
    },
    bootstrap: { stable: boot.top20Stable, refits: 200, seed: 20261114 },
    clock: {
      byYear: clock.byYear.map((b) => [b.label, b.total, Math.round(b.tokenShare * 100)]),
      byAge: clock.byAge.map((b) => [b.label, b.total, Math.round(b.tokenShare * 100)]),
    },
    audit,
    assumedShare: ASSUMED_SHARE,
  },
  rows: dataRows,
};
writeFileSync(join(outDir, 'dashboard', 'data.js'), 'window.RADAR = ' + JSON.stringify(data) + ';\n');

const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log(
  `board ${rows.length} rows, comps ${comps.length}, dossier ${dossier.length} bytes, ` +
    `top value $${rows[0].implied_value_usd}, LOO x${Math.round(looAdopted.median * 100) / 100}`,
);
