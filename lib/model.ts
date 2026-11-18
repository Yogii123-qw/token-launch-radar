// Value model and evidence for the token launch radar.
//
// Everything here is computed from the sealed snapshot at run time: the
// comparable set, the curve fit, the category effects, the holdout
// measurements, the bootstrap rank ranges, the audit counts and the clock
// bands. Nothing is keyed to a protocol name or slug.

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSION_SUFFIX = / (V\d+|v\d+|\d+\.\d+.*)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export type ScreenReason = 'category' | 'version' | 'word' | 'exchange';

export function isPreToken(p: Proto): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is left off the board, or null when it stays. */
export function screenReason(p: Proto): ScreenReason | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return 'category';
  if (VERSION_SUFFIX.test(p.name)) return 'version';
  if (WRAPPED_WORD.test(p.name)) return 'word';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange';
  return null;
}

export function selectBoard(protocols: Proto[]): Proto[] {
  return protocols.filter((p) => isPreToken(p) && screenReason(p) === null);
}

/** Traded protocols with a recorded market cap, no CEX, sane mcap/TVL. */
export function selectComps(protocols: Proto[], lo = 0.01, hi = 5): Proto[] {
  return protocols.filter((p) => {
    if (isPreToken(p) || p.mcap_usd === null || p.category === 'CEX') return false;
    const ratio = p.mcap_usd / p.tvl_usd;
    return ratio >= lo && ratio <= hi;
  });
}

export function ageDays(p: Proto, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const ms = Date.parse(asOf) - Date.parse(p.listed_at);
  return Math.max(0, ms / 86400000);
}

const log10 = (x: number): number => Math.log10(x);

export interface CurveFit {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
}

export function ols(points: Array<[number, number]>): CurveFit {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, r2, n };
}

/** Least squares for a design matrix with an explicit intercept column. */
export function olsMulti(rows: number[][], y: number[]): number[] {
  const k = rows[0].length;
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const aty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      aty[a] += rows[i][a] * y[i];
      for (let b = 0; b < k; b++) ata[a][b] += rows[i][a] * rows[i][b];
    }
  }
  // Gaussian elimination with partial pivoting.
  const m = ata.map((row, i) => [...row, aty[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) continue;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= k; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[k] / row[i]));
}

export const SHRINK_K = 8;
export const SHRINK_MIN = 3;

export interface HandRule {
  growth: number;
  season: number;
  center: number;
  cap: number;
}

/** Bounded hand momentum/seasoning. Coefficients are round and fixed by
 *  hand, never fitted; the holdouts below validate the rule as a whole.
 *  Seasoning is a discount only: a protocol listed recently with no token
 *  yet is marked down for its short record, while a seasoned protocol
 *  earns no bonus from age alone — the curve already prices its TVL. */
export const DEFAULT_HAND: HandRule = { growth: 0.3, season: 0.2, center: 2.5, cap: 0.075 };

export function handAdjustment(p: Proto, asOf: string, hand: HandRule): number {
  const g = p.change_7d === null ? 0 : hand.growth * (p.change_7d / 100);
  const age = ageDays(p, asOf);
  const s = age === null ? 0 : hand.season * Math.min(0, log10(age + 1) - hand.center);
  return Math.max(-hand.cap, Math.min(hand.cap, g + s));
}

export interface Model {
  fit: CurveFit;
  effects: Map<string, number>;
  hand: HandRule;
}

export function fitModel(comps: Proto[], hand: HandRule): Model {
  const fit = ols(comps.map((p) => [log10(p.tvl_usd), log10(p.mcap_usd as number)]));
  const sums = new Map<string, { total: number; n: number }>();
  for (const p of comps) {
    if (p.category === null) continue;
    const resid = log10(p.mcap_usd as number) - (fit.intercept + fit.slope * log10(p.tvl_usd));
    const acc = sums.get(p.category) ?? { total: 0, n: 0 };
    acc.total += resid;
    acc.n += 1;
    sums.set(p.category, acc);
  }
  const effects = new Map<string, number>();
  for (const [cat, acc] of sums) {
    if (acc.n >= SHRINK_MIN) effects.set(cat, (acc.total / acc.n) * (acc.n / (acc.n + SHRINK_K)));
  }
  return { fit, effects, hand };
}

export function predictLog(p: Proto, model: Model, asOf: string, useHand: boolean, useCat: boolean): number {
  let v = model.fit.intercept + model.fit.slope * log10(p.tvl_usd);
  if (useCat && p.category !== null) v += model.effects.get(p.category) ?? 0;
  if (useHand) v += handAdjustment(p, asOf, model.hand);
  return v;
}

export interface Holdout {
  median: number;
  within3: number;
  within10: number;
  n: number;
}

function summarize(misses: number[]): Holdout {
  const sorted = [...misses].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    median,
    within3: sorted.filter((m) => m <= 3).length / sorted.length,
    within10: sorted.filter((m) => m <= 10).length / sorted.length,
    n: sorted.length,
  };
}

export type Variant = 'curve' | 'curveCat' | 'adopted' | 'fitGrowthAge' | 'fitGrowthAgeChains' | 'fitAge';

function fittedFeatures(p: Proto, asOf: string, meanLogAge: number, variant: Variant): number[] {
  const g = p.change_7d === null ? 0 : p.change_7d / 100;
  const age = ageDays(p, asOf);
  const la = age === null ? meanLogAge : log10(age + 1);
  const row = [1, log10(p.tvl_usd)];
  if (variant === 'fitGrowthAge' || variant === 'fitGrowthAgeChains') row.push(g, la);
  if (variant === 'fitAge') row.push(la);
  if (variant === 'fitGrowthAgeChains') row.push(log10(p.chains.length));
  return row;
}

function fitVariant(train: Proto[], asOf: string, hand: HandRule, variant: Variant): (p: Proto) => number {
  if (variant === 'curve' || variant === 'curveCat' || variant === 'adopted') {
    const model = fitModel(train, hand);
    return (p) => predictLog(p, model, asOf, variant === 'adopted', variant !== 'curve');
  }
  const ages = train.map((p) => ageDays(p, asOf)).filter((a): a is number => a !== null);
  const meanLogAge = ages.reduce((s, a) => s + log10(a + 1), 0) / Math.max(1, ages.length);
  const coef = olsMulti(
    train.map((p) => fittedFeatures(p, asOf, meanLogAge, variant)),
    train.map((p) => log10(p.mcap_usd as number)),
  );
  return (p) => {
    const row = fittedFeatures(p, asOf, meanLogAge, variant);
    return row.reduce((s, v, i) => s + v * coef[i], 0);
  };
}

/** Leave-one-out over the comparables; each fold refits from scratch. */
export function loo(comps: Proto[], asOf: string, hand: HandRule, variant: Variant): Holdout & { residuals: number[] } {
  const misses: number[] = [];
  const residuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const predict = fitVariant(train, asOf, hand, variant);
    const actual = log10(comps[i].mcap_usd as number);
    const pred = predict(comps[i]);
    misses.push(Math.pow(10, Math.abs(pred - actual)));
    residuals.push(actual - pred);
  }
  return { ...summarize(misses), residuals };
}

/** Time split over dated comparables only. OLD fits the newest two thirds
 *  and tests the oldest third; NEW is the walk-forward direction. */
export function timeSplit(
  comps: Proto[],
  asOf: string,
  hand: HandRule,
  variant: Variant,
  which: 'OLD' | 'NEW',
): Holdout {
  const dated = comps.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const k = Math.floor(dated.length / 3);
  const test = which === 'OLD' ? dated.slice(0, k) : dated.slice(dated.length - k);
  const train = which === 'OLD' ? dated.slice(k) : dated.slice(0, dated.length - k);
  const predict = fitVariant(train, asOf, hand, variant);
  const misses = test.map((p) => Math.pow(10, Math.abs(predict(p) - log10(p.mcap_usd as number))));
  return summarize(misses);
}

export interface AblationRow {
  variant: Variant;
  label: string;
  loo: Holdout;
  old: Holdout;
  fresh: Holdout;
}

export function ablation(comps: Proto[], asOf: string, hand: HandRule): AblationRow[] {
  const defs: Array<[Variant, string]> = [
    ['curve', 'curve only'],
    ['curveCat', 'curve + category'],
    ['adopted', 'curve + category + hand'],
    ['fitGrowthAge', '+ fitted growth + age'],
    ['fitGrowthAgeChains', '+ fitted growth + age + chains'],
    ['fitAge', '+ fitted age only'],
  ];
  return defs.map(([variant, label]) => ({
    variant,
    label,
    loo: loo(comps, asOf, hand, variant),
    old: timeSplit(comps, asOf, hand, variant, 'OLD'),
    fresh: timeSplit(comps, asOf, hand, variant, 'NEW'),
  }));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export interface RangeHonesty {
  q25: number;
  q75: number;
  q10: number;
  q90: number;
  cover50: number;
  cover80: number;
  n: number;
}

export function rangeHonesty(residuals: number[]): RangeHonesty {
  const sorted = [...residuals].sort((a, b) => a - b);
  const q25 = quantile(sorted, 0.25);
  const q75 = quantile(sorted, 0.75);
  const q10 = quantile(sorted, 0.1);
  const q90 = quantile(sorted, 0.9);
  return {
    q25,
    q75,
    q10,
    q90,
    cover50: residuals.filter((r) => r >= q25 && r <= q75).length,
    cover80: residuals.filter((r) => r >= q10 && r <= q90).length,
    n: residuals.length,
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapRow {
  rankLo: number;
  rankHi: number;
  top20Share: number;
}

/** Seeded refits: resample the comparables, refit, re-rank the board. */
export function bootstrap(
  comps: Proto[],
  board: Proto[],
  asOf: string,
  hand: HandRule,
  refits = 200,
  seed = 20261114,
): { rows: Map<string, BootstrapRow>; top20Stable: number } {
  const rand = mulberry32(seed);
  const ranks = new Map<string, number[]>();
  for (const p of board) ranks.set(p.slug, []);
  const full = fitModel(comps, hand);
  const fullOrder = [...board]
    .map((p) => ({ slug: p.slug, v: predictLog(p, full, asOf, true, true) }))
    .sort((a, b) => b.v - a.v || a.slug.localeCompare(b.slug));
  const fullTop20 = new Set(fullOrder.slice(0, 20).map((r) => r.slug));
  for (let r = 0; r < refits; r++) {
    const sample: Proto[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rand() * comps.length)]);
    const model = fitModel(sample, hand);
    const order = [...board]
      .map((p) => ({ slug: p.slug, v: predictLog(p, model, asOf, true, true) }))
      .sort((a, b) => b.v - a.v || a.slug.localeCompare(b.slug));
    order.forEach((row, idx) => ranks.get(row.slug)?.push(idx + 1));
  }
  const rows = new Map<string, BootstrapRow>();
  let top20Stable = 0;
  for (const [slug, list] of ranks) {
    const sorted = [...list].sort((a, b) => a - b);
    const top20Share = list.filter((rk) => rk <= 20).length / list.length;
    if (fullTop20.has(slug) && top20Share >= 0.5) top20Stable++;
    rows.set(slug, { rankLo: quantile(sorted, 0.05), rankHi: quantile(sorted, 0.95), top20Share });
  }
  return { rows, top20Stable };
}

export interface ClockBand {
  label: string;
  total: number;
  tokenShare: number;
}

export function clockBands(protocols: Proto[], asOf: string): { byYear: ClockBand[]; byAge: ClockBand[] } {
  const dated = protocols.filter((p) => p.listed_at !== null);
  const byYear: ClockBand[] = [];
  for (let year = 2021; year <= 2026; year++) {
    const bucket = dated.filter((p) => (p.listed_at as string).startsWith(String(year)));
    if (bucket.length === 0) continue;
    byYear.push({
      label: String(year),
      total: bucket.length,
      tokenShare: bucket.filter((p) => !isPreToken(p)).length / bucket.length,
    });
  }
  const bands: Array<[string, number, number]> = [
    ['0–180d', 0, 180],
    ['180–365d', 180, 365],
    ['365–730d', 365, 730],
    ['730–1095d', 730, 1095],
    ['1095–1460d', 1095, 1460],
    ['1460d+', 1460, Infinity],
  ];
  const byAge: ClockBand[] = bands.map(([label, lo, hi]) => {
    const bucket = dated.filter((p) => {
      const age = ageDays(p, asOf) as number;
      return age >= lo && age < hi;
    });
    return {
      label,
      total: bucket.length,
      tokenShare: bucket.length === 0 ? 0 : bucket.filter((p) => !isPreToken(p)).length / bucket.length,
    };
  });
  return { byYear, byAge };
}

export interface Audit {
  total: number;
  preToken: number;
  traded: number;
  tradedWithMcap: number;
  tradedWithoutMcap: number;
  screenedCategory: number;
  screenedVersion: number;
  screenedWord: number;
  screenedExchange: number;
  boardRows: number;
  comps: number;
  watchlist: number;
  watchlistOnBoard: number;
}

export function auditCounts(snap: Snapshot, board: Proto[], comps: Proto[]): Audit {
  const screened = { category: 0, version: 0, word: 0, exchange: 0 };
  for (const p of snap.protocols) {
    if (!isPreToken(p)) continue;
    const reason = screenReason(p);
    if (reason !== null) screened[reason]++;
  }
  const boardSlugs = new Set(board.map((p) => p.slug));
  return {
    total: snap.protocols.length,
    preToken: snap.protocols.filter(isPreToken).length,
    traded: snap.protocols.filter((p) => !isPreToken(p)).length,
    tradedWithMcap: snap.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null).length,
    tradedWithoutMcap: snap.protocols.filter((p) => !isPreToken(p) && p.mcap_usd === null).length,
    screenedCategory: screened.category,
    screenedVersion: screened.version,
    screenedWord: screened.word,
    screenedExchange: screened.exchange,
    boardRows: board.length,
    comps: comps.length,
    watchlist: snap.watchlist.length,
    watchlistOnBoard: snap.watchlist.filter((s) => boardSlugs.has(s)).length,
  };
}

// ---- Farm economics: honest arithmetic on stated assumptions. ----

/** Estimated all-in cost of farming one protocol, in whole dollars. */
export function farmCost(p: Proto): number {
  const chainCost = 4 * Math.min(p.chains.length, 5);
  return 18 + chainCost + (p.chains.length > 1 ? 10 : 0);
}

export const ASSUMED_SHARE = 0.0005; // 0.05% of the implied value

export function breakEven(valueUsd: number, costUsd: number, share = ASSUMED_SHARE): { slice: number; odds: number } {
  const slice = share * valueUsd;
  return { slice, odds: slice / Math.max(1, costUsd) };
}

// ---- Farm plans: five concrete steps per protocol, from templates. ----

function groupOf(category: string | null): string {
  if (category === null) return 'other';
  if (['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Interest Rate Derivatives'].includes(category)) return 'lend';
  if (['Dexs', 'Derivatives', 'Options Vault', 'Prediction Market', 'OTC Marketplace'].includes(category)) return 'dex';
  if (['Yield', 'Yield Aggregator', 'Leveraged Farming', 'Basis Trading', 'Liquidity Manager', 'Farm', 'Dual-Token Stablecoin'].includes(category)) return 'yield';
  if (['Staking Pool', 'Restaking', 'Risk Curators', 'Anchor BTC', 'Decentralized BTC', 'Governance Incentives'].includes(category)) return 'stake';
  if (['RWA', 'Onchain Capital Allocator', 'Stablecoin Wrapper', 'Indexes'].includes(category)) return 'rwa';
  if (['Chain', 'Payments', 'Privacy', 'Insurance', 'Crypto Card Issuer', 'CeDeFi'].includes(category)) return 'chain';
  return 'other';
}

function depositFor(tvl: number): number {
  if (tvl < 100_000_000) return 250;
  if (tvl < 500_000_000) return 500;
  return 1000;
}

function holdDays(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 730) return 60;
  return 30;
}

interface FarmCtx {
  chain: string;
  nChains: number;
  deposit: number;
  cost: number;
  hold: number;
}

const STEP_BUILDERS: Record<string, Array<(name: string, c: FarmCtx) => string>> = {
  lend: [
    (n, c) => `Bridge $${c.deposit} in stablecoins to ${c.chain} through the protocol's own bridge page; keep $${c.cost} aside for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''}. Verify the deposit address on the protocol's site before sending anything.`,
    (n, c) => `Supply the $${c.deposit} to the ${n} lending market on ${c.chain}; switch on the market's points or rewards toggle when the app shows one, and save the transaction hash with the date.`,
    (n, c) => `Borrow only up to 40% of the supplied collateral, and only while the borrow rate stays below the supply reward; otherwise leave the position supplied and idle for ${c.hold} days.`,
    (n, c) => `Return weekly: re-check the supply rate, the points balance and any quest or epoch page, and top the position up only after two straight weeks of TVL growth.`,
    (n, c) => `Before any token announcement, withdraw a small test amount to confirm the exit path works, then hold the position until a claim window opens; never deposit money you cannot leave untouched for ${c.hold} days.`,
  ],
  dex: [
    (n, c) => `Bridge $${c.deposit} in stablecoins plus the chain's gas token to ${c.chain}; budget $${c.cost} for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''} and confirm the pool address on the protocol's own site first.`,
    (n, c) => `Add the $${c.deposit} as liquidity to the deepest ${n} pool on ${c.chain}, in the pair with the most volume; keep the LP receipt and note the entry price.`,
    (n, c) => `Route one real swap a week through ${n} on ${c.chain} instead of another venue, keeping each swap under 1% of the pool so the route stays cheap; log the volume you add.`,
    (n, c) => `Return weekly: check fee earnings against impermanent loss, the points or volume leaderboard, and any new pool incentives; move the position only when fees beat the loss for two weeks running.`,
    (n, c) => `Test a small withdrawal before any token announcement to confirm the exit path, then hold the LP position for ${c.hold} days; never deposit money you cannot leave untouched that long.`,
  ],
  yield: [
    (n, c) => `Bridge $${c.deposit} to ${c.chain} through the protocol's own bridge page; keep $${c.cost} aside for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''} and double-check the vault address on the protocol's site.`,
    (n, c) => `Deposit the $${c.deposit} into the ${n} vault on ${c.chain} with the longest track record; enable points or rewards tracking when the app offers it and save the transaction hash.`,
    (n, c) => `Leave the deposit compounding for ${c.hold} days without chasing the newest vault; a vault switch costs gas twice and resets most points multipliers.`,
    (n, c) => `Return weekly: compare the vault's realised yield with its advertised rate, check the points balance and any epoch page, and only add funds after two straight weeks of TVL growth.`,
    (n, c) => `Withdraw a small test amount before any token announcement to confirm the exit path works, then hold until a claim window opens; never deposit money you cannot leave untouched for ${c.hold} days.`,
  ],
  stake: [
    (n, c) => `Bridge $${c.deposit} in the stakeable asset to ${c.chain}; budget $${c.cost} for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''} and verify the staking contract on the protocol's own site before approving anything.`,
    (n, c) => `Stake the $${c.deposit} with ${n} on ${c.chain} through the protocol's own app, choosing the validator or curator with the longest uptime record; save the transaction hash and the unlock date.`,
    (n, c) => `Keep the stake locked for the full ${c.hold}-day horizon; early exits usually pay a penalty and forfeit the points multiplier the farm is actually for.`,
    (n, c) => `Return weekly: confirm the stake still earns, check the points or restaking balance and any governance or quest page, and only add stake after two straight weeks of TVL growth.`,
    (n, c) => `Test the unstake path with a small amount before any token announcement so the exit is proven, then hold until a claim window opens; never stake money you cannot leave untouched for ${c.hold} days.`,
  ],
  rwa: [
    (n, c) => `Bridge $${c.deposit} in stablecoins to ${c.chain}; budget $${c.cost} for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''} and confirm the vault or token address on the protocol's own site first.`,
    (n, c) => `Allocate the $${c.deposit} to the ${n} product on ${c.chain} with the longest redemption history; read the redemption terms and lock-up before confirming, and save the receipt.`,
    (n, c) => `Hold the allocation for ${c.hold} days; real-world products redeem slowly, so plan the exit around the stated redemption window rather than the market's mood.`,
    (n, c) => `Return weekly: check the net asset value update, the points or allocation record and any compliance or quest page; add funds only after two straight weeks of TVL growth.`,
    (n, c) => `Request a small test redemption before any token announcement to confirm the exit path and timing, then hold until a claim window opens; never allocate money you cannot leave untouched for ${c.hold} days.`,
  ],
  chain: [
    (n, c) => `Bridge $${c.deposit} to ${c.chain} through the protocol's own bridge page; keep $${c.cost} aside for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''} and verify the chain id on the protocol's site before sending.`,
    (n, c) => `Use the $${c.deposit} in the ${n} app on ${c.chain} for its core action — transact, pay or post — at least twice in the first week, and save both transaction hashes.`,
    (n, c) => `Keep a regular cadence for ${c.hold} days: one genuine transaction a week beats ten rushed ones, and most points systems reward streaks over bursts.`,
    (n, c) => `Return weekly: check the points or activity record, the quest or epoch page and whether the app added a feature worth using; add funds only after two straight weeks of TVL growth.`,
    (n, c) => `Move a small amount back out before any token announcement to confirm the exit path works, then hold the position until a claim window opens; never deposit money you cannot leave untouched for ${c.hold} days.`,
  ],
  other: [
    (n, c) => `Bridge $${c.deposit} to ${c.chain} through the protocol's own pages; budget $${c.cost} for gas across ${c.nChains} chain${c.nChains > 1 ? 's' : ''} and verify every contract address on the protocol's site before approving.`,
    (n, c) => `Put the $${c.deposit} to work in the ${n} app's main feature on ${c.chain}; switch on points or rewards tracking when offered and save the transaction hash with the date.`,
    (n, c) => `Stay active for ${c.hold} days at a steady weekly cadence; points systems usually reward streaks and tenure, not one large deposit.`,
    (n, c) => `Return weekly: check the points balance, the quest or epoch page and the protocol's own announcements; add funds only after two straight weeks of TVL growth.`,
    (n, c) => `Test a small withdrawal before any token announcement to confirm the exit path works, then hold until a claim window opens; never deposit money you cannot leave untouched for ${c.hold} days.`,
  ],
};

export function farmSteps(p: Proto, asOf: string): string[] {
  const ctx: FarmCtx = {
    chain: p.chains[0] ?? 'its home chain',
    nChains: p.chains.length,
    deposit: depositFor(p.tvl_usd),
    cost: farmCost(p),
    hold: holdDays(ageDays(p, asOf)),
  };
  return STEP_BUILDERS[groupOf(p.category)].map((build) => build(p.name, ctx));
}
