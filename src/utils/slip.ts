/**
 * slip — the Top 3+3 slip builder: CORE SELECTION, JOKER SELECTION and the
 * auditable readout of both.
 *
 * THREE SEPARATE QUESTIONS, THREE SEPARATE ANSWERS
 * ------------------------------------------------
 *  1. QUALITY (the gates)  — is the signal itself admissible? Quadrant, Kish
 *     effective sample, stability floor, team-goal market ban.
 *  2. EVIDENCE (the bands) — has the signalled PROBABILITY been measured?
 *     `calibrated` / `conditional` / `excluded`, resolved in
 *     `utils/coreEvidence.ts`. A missing measurement is NOT a refusal; a
 *     disproved own band IS, and is never softened to fill a card.
 *  3. TIER (the quadrant) — `actionable` → Primary Core, `volatile` →
 *     Secondary Core. `flat` and `ignore` never reach a Core card. A Secondary
 *     line may FILL a card no Primary line was available for, and can never
 *     DISPLACE an available Primary one.
 *
 * ONE FIXTURE + ONE MARKET = ONE CANDIDATE
 * ----------------------------------------
 * The candidate list is CANONICALISED (see {@link canonicalCandidates}) before
 * the Core gate and before every eligibility counter. Two pattern records for
 * the same `(fixtureId, code)` pair — e.g. a `77.4%` and a `79.8%` BTTS row for
 * Getafe – Barcelona produced by two generators — used to survive all the way
 * to `selectCoreSet`, where the one-fixture-per-card rule finally dropped one.
 * By then the readout had already reported "Core-eligible: 2" for a single
 * eligible fixture. Deduplication therefore happens FIRST, on a deterministic
 * key (tier → evidence → lexicographic rank → type priority), so every counter,
 * funnel stage and card reads the same population.
 *
 * CANONICAL KEY vs PATTERN IDENTITY
 * ----------------------------------
 * Raw PatternHit identity:  fixtureId + type + code  (id field)
 * Core canonical key:       fixtureId + code          (candidateKeyOf)
 *
 * The `id` field is NEVER changed — it uniquely identifies the raw pattern
 * record for React keys, swap/lookup, and audit trails. The canonical key is
 * used ONLY inside slip-building to collapse duplicates before any gate or
 * counter runs.
 *
 * NO FORCE FILL. Fewer than three valid candidates yields fewer than three
 * cards. An empty third card is a more honest output than a line that failed a
 * gate. Every funnel count is built from the PREVIOUS candidate array, never by
 * subtracting an aggregate from a different population — that is how a stage
 * once reported `1 − 6 = −5`.
 *
 * FUNNEL STAGES ARE ALL NAMED AND EXPORTED (readout hygiene)
 * ------------------------------------------------------------
 * `StrategyReadout` used to expose only the END of two different funnels
 * (`strictCandidates`/`calibratedCandidates`/`conditionalCandidates`, all
 * scoped to `eligible`, i.e. AFTER the full core gate) plus one
 * mid-funnel delta (`disprovedCandidates`, scoped to the quality-gate
 * population). Nothing named the population BEFORE the quality gate, and
 * nothing named the evidence-level breakdown across ALL candidates
 * (irrespective of the quality gate). Any UI that needed either of those —
 * e.g. "Minőségi kapun átment: N" or "0 kalibrált / 0 feltételes / 3 kizárt
 * az összes jelölt között" — had no exported field to read, and was forced to
 * recompute it locally. That is exactly how a `1 − 3 = −2` contradiction
 * happens: one side of the subtraction quietly scoped to "quality-gate
 * survivors" while the other quietly scoped to "all canonical candidates".
 *
 * Every stage of the funnel below is now named, computed ONLY from the stage
 * immediately above it, and exposed on `StrategyReadout`. No two exposed
 * counters may ever be combined across scopes by a caller, because every
 * scope a caller could plausibly need already exists as its own field:
 *
 *   strategyCandidates   → totalCandidates, totalCalibratedCandidates,
 *                          totalConditionalCandidates, totalExcludedCandidates
 *   qualityPassed        → qualityPassedCandidates, qualityFailedCandidates
 *   afterEvidence         → afterEvidenceCandidates, disprovedCandidates
 *   afterModelConflict    → modelConflictExcludedCandidates
 *   eligible              → strictCandidates, calibratedCandidates,
 *                          conditionalCandidates, primaryEligibleCandidates,
 *                          secondaryEligibleCandidates, eligibleFixtures,
 *                          tierExcludedCandidates (invariant check, see below)
 */

import { CORE_STABILITY_MIN } from './constants';
import { CORE_EVIDENCE_RULE_VERSION, coherentLevelOf, evidenceRank } from './coreEvidence';
import { BTTS_PROFILE_RULE_VERSION } from './bttsProfile';
import { coreStrategySpecOf, specNullReasonOf, type QuickStrategySpec } from './coreStrategy';
import { DECISION_THRESHOLDS, SECONDARY_MARKET_THRESHOLDS } from './decision';
import {
  coreCardMarkets,
  isTeamGoalCode,
  matchesMarkets,
  summarizeMarkets } from
'./marketCatalog';
import type {
  BandDiagnosis,
  BttsBlowoutRiskAssessment,
  CoreEvidenceLevel,
  CoreExecutionPath,
  CoreStrategySettings,
  CoreTier,
  DecisionQuadrant,
  FixtureAnalysis,
  PatternHit,
  PatternType,
  Slip,
  SlipLine,
  SlipMarketPreferences,
  SlipRole,
  SpecNullReason } from
'../types/winmix';

/** Bumped whenever WHICH line reaches a Core card can change. */
export const CORE_SELECTION_RULE_VERSION = 'core-selection/2.2';

/* -------------------------------------------------------------------------- *
 * Roles
 * -------------------------------------------------------------------------- */

export type ActiveSlipRole =
'btts_top' |
'btts_second' |
'over25' |
'joker_score' |
'joker_ht' |
'joker_trend';

export interface RoleSpec {
  title: string;
  families: string;
  empty: string;
  kind: 'core' | 'joker';
}

export const ROLE_SPEC: Record<ActiveSlipRole, RoleSpec> = {
  btts_top: {
    title: 'Core 01',
    families: 'A core stratégia piaca',
    empty:
    'Nincs olyan jelölt, amely a szigorú core kapun belül van. A kártya ' +
    'szándékosan üres — a hármas szám kedvéért nem kerül fel sor.',
    kind: 'core'
  },
  btts_second: {
    title: 'Core 02',
    families: 'A core stratégia piaca',
    empty:
    'Egy mérkőzés csak egy soron szerepelhet, és a maradék jelöltek nem ' +
    'jutottak át a kapun. A kártya üresen marad.',
    kind: 'core'
  },
  over25: {
    title: 'Core 03',
    families: 'A core stratégia piaca',
    empty:
    'Nem maradt harmadik, más mérkőzésről érkező érvényes jelölt. A kártya ' +
    'üresen marad.',
    kind: 'core'
  },
  joker_score: {
    title: 'Joker 01 — pontos eredmény',
    families: 'Pontos eredmény',
    empty: 'Nincs modális pontos eredmény minta ebben a fordulóban.',
    kind: 'joker'
  },
  joker_ht: {
    title: 'Joker 02 — félidő',
    families: 'Félidei piacok',
    empty: 'Nincs elegendő félidős adat egyetlen szabad mérkőzésen sem.',
    kind: 'joker'
  },
  joker_trend: {
    title: 'Joker 03 — trend és fordulat',
    families: 'Trend · sorozat · fordulat · modell-egyetértés',
    empty: 'Nincs szabad mérkőzésre eső trend- vagy fordulat-minta.',
    kind: 'joker'
  }
};

export const CORE_ROLES: ActiveSlipRole[] = ['btts_top', 'btts_second', 'over25'];
export const JOKER_ROLES: ActiveSlipRole[] = ['joker_score', 'joker_ht', 'joker_trend'];
export const ROLE_ORDER: ActiveSlipRole[] = [...CORE_ROLES, ...JOKER_ROLES];

const LEGACY_ROLE_MAP: Record<string, ActiveSlipRole> = {
  core: 'btts_top',
  safety: 'btts_top',
  goals: 'over25',
  recurring: 'btts_second',
  joker: 'joker_trend'
};

/** Map any stored role — including the pre-split legacy ones — onto a slot. */
export function activeRoleOf(role: SlipRole): ActiveSlipRole {
  if ((ROLE_ORDER as string[]).includes(role)) return role as ActiveSlipRole;
  return LEGACY_ROLE_MAP[role] ?? 'joker_trend';
}

/* -------------------------------------------------------------------------- *
 * Gates
 * -------------------------------------------------------------------------- */

export type GateCondition =
'decision' |
'sample' |
'stability' |
'market_uncalibrated' |
'band' |
'model_conflict' |
'blowout_profile';

export const GATE_LABEL: Record<GateCondition, string> = {
  decision: 'kvadráns',
  sample: 'hideg minta',
  stability: 'stabilitás',
  market_uncalibrated: 'piac nincs visszamérve',
  band: 'cáfolt sáv',
  model_conflict: 'modell-konfliktus',
  blowout_profile: 'kiütés-profil'
};

export const GATE_DETAIL: Record<GateCondition, string> = {
  decision:
  'A kvadráns lapos vagy elvetendő: vagy nincs kimutatható él, vagy nincs ' +
  'mögötte elegendő megbízható információ. Csak a cselekvőképes (elsődleges) ' +
  'és a volatilis (másodlagos) szint kerülhet core kártyára.',
  sample:
  'A recency-súlyozott Kish effektív mintaméret a hideg fokozatban van — a ' +
  'százalék mögött nincs elegendő valós előzmény.',
  stability: `A stabilitás a core padló (${CORE_STABILITY_MIN}) alatt van: a minta nem ismétlődő.`,
  market_uncalibrated:
  'A csapatgól-család joker-only, amíg a piacspecifikus, minta-elemen kívüli ' +
  'mérés nem igazolja a saját sávját.',
  band:
  'A sor saját valószínűségi sávját MEGMÉRTÜK, és a jelzett valószínűség a ' +
  'tényleges beválás Wilson-intervallumán kívül van. Cáfolt evidencia — nem ' +
  'adathiány, ezért feltételesen sem kerülhet core kártyára.',
  model_conflict:
  'Egy még nem visszamért (feltételes) valószínűség, amely a saját modelljével ' +
  'is ellentmond, semmire nem támaszkodik.',
  blowout_profile:
  'Egyoldalú, nagy gólszámú, kapott-nullás profil — éles veto módban ez a sor kiesik.'
};

/** Goal- and HT/FT-market lines are judged on the secondary axes. */
function isSecondaryMarket(pattern: PatternHit): boolean {
  return pattern.type === 'goal_market' || pattern.type === 'htft_reversal';
}

export interface CoreConfidenceReading {
  /** The C axis the quadrant judged this line on. */
  value: number;
  /** The primary (actionable) cut-point of that axis. */
  threshold: number;
  /** True when the value is the market-specific confidence, not `stability`. */
  marketSpecific: boolean;
}

export function coreConfidenceOf(pattern: PatternHit): CoreConfidenceReading {
  return isSecondaryMarket(pattern) ?
  {
    value: pattern.marketConfidence,
    threshold: SECONDARY_MARKET_THRESHOLDS.cMin,
    marketSpecific: true
  } :
  {
    value: pattern.stability,
    threshold: DECISION_THRESHOLDS.minConfidence,
    marketSpecific: false
  };
}

/** The quadrant the gate actually reads. */
export function effectiveDecisionOf(pattern: PatternHit): DecisionQuadrant {
  return isSecondaryMarket(pattern) ? pattern.marketDecision ?? pattern.decision : pattern.decision;
}

/**
 * The resolved evidence level — read ONLY from the coreEvidence snapshot.
 *
 * `coherentLevelOf` is the single reader: a missing snapshot is `conditional`
 * (never `excluded`), and an incoherent exclusion — one whose own band never
 * reached `BAND_MIN_SAMPLE` audited observations — is downgraded there. No
 * separate `bandCalibrated` / `marketBandCalibrated` fallback exists any more,
 * because a thin band must never masquerade as a measured verdict.
 */
export function evidenceLevelOf(pattern: PatternHit): CoreEvidenceLevel {
  return coherentLevelOf(pattern.coreEvidence ?? null);
}

/** The band diagnosis that judged this line — from the snapshot, nowhere else. */
export function effectiveBandDiagnosisOf(pattern: PatternHit): BandDiagnosis {
  return pattern.coreEvidence?.diagnosis ?? 'insufficient';
}

function hasMaterialModelConflict(pattern: PatternHit): boolean {
  return pattern.bttsRisk?.reasonCodes.includes('model_conflict') ?? false;
}

function isTeamGoalCoreBlocked(pattern: PatternHit): boolean {
  return isTeamGoalCode(pattern.code) && pattern.marketCalibrationStatus !== 'calibrated';
}

/**
 * The CALIBRATION-INDEPENDENT conditions. Kept separate so the funnel can say
 * whether a candidate fell on quality or on measured evidence.
 */
export function coreQualityFailures(pattern: PatternHit): GateCondition[] {
  const failed: GateCondition[] = [];
  const quadrant = effectiveDecisionOf(pattern);
  if (quadrant !== 'actionable' && quadrant !== 'volatile') failed.push('decision');
  if (pattern.sufficiency === 'cold') failed.push('sample');
  if (pattern.stability < CORE_STABILITY_MIN) failed.push('stability');
  if (isTeamGoalCoreBlocked(pattern)) failed.push('market_uncalibrated');
  return failed;
}

/** The full strict gate of one side of the slip. */
export function gateFailuresForKind(
pattern: PatternHit,
kind: 'core' | 'joker')
: GateCondition[] {
  const level = evidenceLevelOf(pattern);

  if (kind === 'joker') {
    const failed: GateCondition[] = [];
    if (effectiveDecisionOf(pattern) === 'ignore') failed.push('decision');
    if (level === 'excluded') failed.push('band');
    return failed;
  }

  const failed = coreQualityFailures(pattern);
  if (level === 'excluded') failed.push('band');
  if (level === 'conditional' && hasMaterialModelConflict(pattern)) failed.push('model_conflict');
  return failed;
}

/* -------------------------------------------------------------------------- *
 * Core tiering
 * -------------------------------------------------------------------------- */

export const CORE_TIER_LABEL: Record<CoreTier, string> = {
  primary: 'Elsődleges core',
  secondary: 'Másodlagos core'
};

export const CORE_TIER_DETAIL: Record<CoreTier, string> = {
  primary:
  'Cselekvőképes kvadráns: a súlyozott H2H irány és az információ-megbízhatóság ' +
  'is eléri az elsődleges küszöböt.',
  secondary:
  'Volatilis kvadráns: az irány erős, de a konfidencia az elsődleges küszöb alatt ' +
  'van. Magasabb kockázatú szint, amely csak olyan kártyára kerül, amelyre nem ' +
  'volt elérhető elsődleges jelölt.'
};

/** The Core selection tier of a line, or `null` when it never reaches Core. */
export function coreTierOf(pattern: PatternHit): CoreTier | null {
  const quadrant = effectiveDecisionOf(pattern);
  if (quadrant === 'actionable') return 'primary';
  if (quadrant === 'volatile') return 'secondary';
  return null;
}

/** Ordering weight of a tier. Primary always fills before Secondary. */
export function coreTierRank(tier: CoreTier | null): number {
  return tier === 'primary' ? 0 : tier === 'secondary' ? 1 : 2;
}

export function isCoreEligible(pattern: PatternHit): boolean {
  return coreTierOf(pattern) !== null && gateFailuresForKind(pattern, 'core').length === 0;
}

export function isJokerEligible(pattern: PatternHit): boolean {
  return gateFailuresForKind(pattern, 'joker').length === 0;
}

/* -------------------------------------------------------------------------- *
 * Ranking
 * -------------------------------------------------------------------------- */

function modelSpread(pattern: PatternHit): number {
  return typeof pattern.modelProb === 'number' ?
  Math.abs(pattern.hitRate - pattern.modelProb) :
  1;
}

function blowoutRisk(pattern: PatternHit): number {
  return pattern.bttsRisk?.modelRisk ?? 0;
}

/**
 * Stable type-priority tiebreaker for canonical deduplication.
 *
 * When two records for the same (fixtureId, code) are otherwise equal on tier,
 * evidence and strategy rank, `goal_market` wins over `streak` — the weighted
 * pool rate is a more direct measurement than a 5-of-5 shrunk estimate.
 * This is a DOCUMENTED CONSTANT: if ablation shows streaks should win, change
 * the order here, not inline at callsites.
 *
 * FIX v2.2: added as the final, stable tiebreaker in byTierThenEvidenceThenStrategy
 * to eliminate Map-insertion-order non-determinism in canonicalCandidates.
 */
const TYPE_PRIORITY: Record<string, number> = {
  goal_market: 0,
  safety_trend: 1,
  model_agreement: 2,
  streak: 3,
  htft_reversal: 4,
  ht_market: 5,
  exact_score: 6
};

function typePriorityOf(pattern: PatternHit): number {
  return TYPE_PRIORITY[pattern.type] ?? 99;
}

/**
 * Lexicographic, deterministic ranking. Nothing is fused into one product: a
 * criterion only speaks when every criterion above it is tied.
 */
function byStrategyRank(a: PatternHit, b: PatternHit): number {
  return (
    b.hitRate - a.hitRate ||
    (b.modelProb ?? 0) - (a.modelProb ?? 0) ||
    b.effectiveSampleSize - a.effectiveSampleSize ||
    modelSpread(a) - modelSpread(b) ||
    blowoutRisk(a) - blowoutRisk(b) ||
    a.id.localeCompare(b.id));

}

/**
 * Tier first, then measured evidence, then the lexicographic ranking, then
 * type priority as the final stable tiebreaker.
 *
 * FIX v2.2: `typePriorityOf` added as the last criterion so that two records
 * with identical tier + evidence + hitRate + modelProb + ESS + spread + risk
 * always resolve in the same order regardless of Map insertion order.
 * Without this, `canonicalCandidates` could non-deterministically keep either
 * the `streak::BTTS` or the `goal_market::BTTS` record.
 */
function byTierThenEvidenceThenStrategy(a: PatternHit, b: PatternHit): number {
  return (
    coreTierRank(coreTierOf(a)) - coreTierRank(coreTierOf(b)) ||
    evidenceRank(evidenceLevelOf(a)) - evidenceRank(evidenceLevelOf(b)) ||
    byStrategyRank(a, b) ||
    typePriorityOf(a) - typePriorityOf(b));

}

/**
 * Identity of a market line for Core deduplication purposes.
 *
 * NOTE: This is NOT the same as `PatternHit.id`. The raw pattern id includes
 * the pattern type (`fixtureId::type::code`) to uniquely identify the record
 * from its generator. The canonical key drops the type so that two generators
 * producing the same market for the same fixture are treated as ONE Core
 * candidate — which is the correct domain rule.
 */
export function candidateKeyOf(pattern: PatternHit): string {
  return `${pattern.fixtureId}::${pattern.code}`;
}

/**
 * Collapse every `(fixtureId, code)` group to ONE canonical candidate.
 *
 * Several pattern generators can emit the same market for the same fixture —
 * the streak generator shrinks a 5/5 toward the prior, the goal-market
 * generator reports the weighted rate — so the same BTTS line can arrive twice
 * with two different H2H percentages. Both are legitimate pattern records, but
 * only one of them can ever be a Core candidate, and the choice must be made
 * BEFORE the gates and the counters, not at card-selection time.
 *
 * The surviving record is chosen deterministically:
 *   1. Higher Core tier (primary beats secondary)
 *   2. Better evidence level (calibrated beats conditional)
 *   3. Lexicographic strategy rank (hitRate, modelProb, ESS, spread, risk, id)
 *   4. Type priority (goal_market beats streak as final stable tiebreaker)
 *
 * FIX v2.2: Step 4 (type priority) added. Previously, two records equal on
 * steps 1–3 resolved by Map insertion order — non-deterministic across JS
 * engine versions and input orderings.
 */
export function canonicalCandidates(patterns: readonly PatternHit[]): PatternHit[] {
  const best = new Map<string, PatternHit>();

  patterns.forEach((pattern) => {
    const key = candidateKeyOf(pattern);
    const incumbent = best.get(key);
    if (!incumbent || byTierThenEvidenceThenStrategy(pattern, incumbent) < 0) {
      best.set(key, pattern);
    }
  });

  return Array.from(best.values()).sort(byTierThenEvidenceThenStrategy);
}

/** Every pattern of the round, best first. */
export function rankedPatterns(analyses: readonly FixtureAnalysis[]): PatternHit[] {
  return analyses.flatMap((analysis) => analysis.patterns).slice().sort(byStrategyRank);
}

/**
 * The ordered Core set: canonical, eligible candidates only, one fixture per
 * card, capped at `slots`. No relaxed fallback, no force fill.
 */
export function selectCoreSet(patterns: readonly PatternHit[], slots: number): PatternHit[] {
  const ordered = canonicalCandidates(patterns.filter(isCoreEligible));
  const picked: PatternHit[] = [];
  const usedFixtures = new Set<string>();

  ordered.forEach((pattern) => {
    if (picked.length >= slots) return;
    if (usedFixtures.has(pattern.fixtureId)) return;
    usedFixtures.add(pattern.fixtureId);
    picked.push(pattern);
  });

  return picked;
}

/* -------------------------------------------------------------------------- *
 * Draft shape
 * -------------------------------------------------------------------------- */

export interface BlockedCandidate {
  pattern: PatternHit;
  failed: GateCondition[];
}

export interface CoreCandidateRow {
  pattern: PatternHit;
  evidence: CoreEvidenceLevel;
  quadrant: DecisionQuadrant;
  coreTier: CoreTier | null;
  failed: GateCondition[];
  /** 1-based core card index, or `null` when the line was not placed. */
  slot: number | null;
  reason: string;
}

export interface CoreExecutionTrace {
  executionPath: CoreExecutionPath;
  specNullReason: SpecNullReason;
  /** The configured per-card market pool, when one exists. */
  configuredMarketPool: (string[] | null)[] | null;
}

export interface StrategyReadout {
  strategy: string;
  label: string;
  vetoMode: string;
  vetoActive: boolean;
  ruleVersion: string;
  evidenceRuleVersion: string;
  selectionRuleVersion: string;
  /** Selection WITHOUT the profile filter — the "A" control branch. */
  baseline: PatternHit[];
  /** Selection WITH the profile filter — the "B" branch. */
  experiment: PatternHit[];
  excluded: Array<{pattern: PatternHit;risk: BttsBlowoutRiskAssessment;}>;
  candidates: CoreCandidateRow[];
  analysedFixtures: number;

  /**
   * STAGE 0 — `strategyCandidates` (canonical, BEFORE any gate).
   * "BTTS jelölt: N" — how many distinct (fixture, market) candidates exist
   * at all, once duplicate generator records are collapsed. Every other
   * count in this readout is a subset of this one, and this field is the
   * ONLY correct denominator for an "out of how many total" label.
   */
  totalCandidates: number;
  /** Evidence-level breakdown across `totalCandidates` — i.e. ALL canonical
   *  candidates, irrespective of whether they pass the quality gate. Use
   *  these three fields (not `calibratedCandidates`/`conditionalCandidates`
   *  below) for a "0 kalibrált / 0 feltételes / 3 kizárt" style summary that
   *  is meant to describe the whole candidate pool. */
  totalCalibratedCandidates: number;
  totalConditionalCandidates: number;
  totalExcludedCandidates: number;

  /**
   * STAGE 1 — `qualityPassed` (quadrant, sample, stability, team-goal ban).
   * Calibration-independent: a candidate can be here with `excluded`
   * evidence. "Minőségi kapun átment: N" / "Minőségi kapun kiesett: N".
   */
  qualityPassedCandidates: number;
  qualityFailedCandidates: number;

  /**
   * STAGE 2 — `afterEvidence` (STAGE 1 minus disproved own bands).
   * "Kalibráció után marad: N". `disprovedCandidates` is STAGE 1 minus
   * STAGE 2 — i.e. "cáfolt sáv a minőségi kapun BELÜLI jelöltek között".
   * It must never be compared against `totalCandidates` or
   * `totalExcludedCandidates`, which are a different, wider population.
   */
  afterEvidenceCandidates: number;
  disprovedCandidates: number;

  /**
   * STAGE 3 — `afterModelConflict` (STAGE 2 minus conditional lines that
   * contradict their own model). STAGE 2 minus STAGE 3.
   */
  modelConflictExcludedCandidates: number;

  /**
   * STAGE 4 — `eligible` (STAGE 3 minus non-actionable/volatile quadrants).
   * This is expected to be 0 in practice, because `coreQualityFailures`
   * already removes `flat`/`ignore` at STAGE 1 — it exists purely as an
   * invariant check so a future change to the gate order cannot silently
   * reopen the STAGE-1/STAGE-4 scope gap this whole fix addresses.
   */
  tierExcludedCandidates: number;

  /** Candidates inside the full strict gate (== STAGE 4, `eligible`). */
  strictCandidates: number;
  calibratedCandidates: number;
  conditionalCandidates: number;
  /** Duplicate `(fixture, market)` records collapsed before the gates ran. */
  duplicateCandidatesMerged: number;
  coreFilled: number;
  coreSlots: number;
  primaryEligibleCandidates: number;
  secondaryEligibleCandidates: number;
  /** Distinct fixtures behind the eligible candidates — the honest denominator. */
  eligibleFixtures: number;
  primaryCoreCount: number;
  secondaryCoreCount: number;
  tierNote: string | null;
  coreEvidenceLevel: CoreEvidenceLevel | null;
}

export interface SlipSlot {
  role: ActiveSlipRole;
  pattern: PatternHit | null;
  title: string | null;
  families: string | null;
  reason: string | null;
  blocked: BlockedCandidate[];
  /** Always false: no strategy inserts a gate-relaxed line. */
  relaxed: boolean;
  failed: GateCondition[];
  risk: BttsBlowoutRiskAssessment | null;
  shadowVeto: boolean;
  coreTier: CoreTier | null;
}

export interface SlipDraft {
  slots: SlipSlot[];
  strategy: StrategyReadout | null;
  trace: CoreExecutionTrace | null;
  configError: string | null;
  notes: string[];
}

function emptySlot(role: ActiveSlipRole, reason: string | null): SlipSlot {
  return {
    role,
    pattern: null,
    title: null,
    families: null,
    reason,
    blocked: [],
    relaxed: false,
    failed: [],
    risk: null,
    shadowVeto: false,
    coreTier: null
  };
}

function filledSlot(
role: ActiveSlipRole,
pattern: PatternHit,
options: {
  title?: string | null;
  families?: string | null;
  vetoActive: boolean;
  profileVeto: boolean;
  coreTier: CoreTier | null;
})
: SlipSlot {
  const flagged = pattern.bttsRisk?.wouldVeto ?? false;
  return {
    role,
    pattern,
    title: options.title ?? null,
    families: options.families ?? null,
    reason: null,
    blocked: [],
    relaxed: false,
    failed: [],
    risk: pattern.bttsRisk ?? null,
    shadowVeto: options.profileVeto && flagged && !options.vetoActive,
    coreTier: options.coreTier
  };
}

function blockedList(patterns: readonly PatternHit[], limit = 4): BlockedCandidate[] {
  return patterns.
  map((pattern) => ({ pattern, failed: gateFailuresForKind(pattern, 'core') })).
  filter((entry) => entry.failed.length > 0).
  slice(0, limit);
}

/* -------------------------------------------------------------------------- *
 * Joker pools
 * -------------------------------------------------------------------------- */

const JOKER_TYPES: Record<ActiveSlipRole, PatternType[]> = {
  btts_top: [],
  btts_second: [],
  over25: [],
  joker_score: ['exact_score'],
  joker_ht: ['ht_market'],
  joker_trend: ['streak', 'model_agreement', 'htft_reversal', 'safety_trend']
};

function jokerPool(
role: ActiveSlipRole,
allPatterns: readonly PatternHit[],
markets: SlipMarketPreferences | null)
: PatternHit[] {
  const types = JOKER_TYPES[role];
  const pool = allPatterns.filter((pattern) => {
    if (!types.includes(pattern.type)) return false;
    if (markets && markets.joker.length > 0 && !matchesMarkets(pattern, markets.joker)) return false;
    return isJokerEligible(pattern);
  });
  return canonicalCandidates(pool);
}

/* -------------------------------------------------------------------------- *
 * The builder
 * -------------------------------------------------------------------------- */

interface CoreOutcome {
  slots: SlipSlot[];
  readout: StrategyReadout | null;
  trace: CoreExecutionTrace;
  configError: string | null;
  usedFixtures: Set<string>;
  notes: string[];
}

function tierNoteOf(
secondaryCoreCount: number,
coreFilled: number,
coreSlots: number)
: string | null {
  if (secondaryCoreCount > 0) {
    return (
      `${secondaryCoreCount} core kártyát MÁSODLAGOS (volatilis) sor tart: az irány ` +
      'erős, de a piaci konfidencia az elsődleges küszöb alatt van. Ezek a sorok ' +
      'kizárólag olyan helyre kerültek, amelyre nem volt elérhető elsődleges jelölt.');

  }
  if (coreFilled < coreSlots) {
    return (
      `${coreFilled} / ${coreSlots} core kártya telt meg — sem elsődleges, sem ` +
      'másodlagos szinten nem volt több érvényes jelölt. A többi kártya szándékosan üres.');

  }
  return null;
}

/**
 * Build the Core side of the slip for a strategy-mode configuration.
 *
 * FIX v2.2 — CANONICAL PIPELINE ENFORCEMENT
 * ------------------------------------------
 * The single source of truth for ALL Core counters, gates, readout fields and
 * card assignments is `strategyCandidates` — the result of
 * `canonicalCandidates(rawCandidates)`. Every subsequent array in this function
 * is derived from the PREVIOUS array in the funnel chain; no counter or card
 * ever reads from `rawCandidates` directly.
 *
 * FIX v2.2.1 — NO CROSS-SCOPE ARITHMETIC IN THE READOUT
 * -------------------------------------------------------
 * Every named funnel array below (`strategyCandidates`, `qualityPassed`,
 * `afterEvidence`, `afterModelConflict`, `eligible`) now has its `.length`
 * (and, where useful, its evidence-level breakdown) exposed as its OWN named
 * field on `StrategyReadout`. Previously only `eligible`'s breakdown
 * (`strictCandidates`/`calibratedCandidates`/`conditionalCandidates`) and one
 * mid-funnel delta (`disprovedCandidates`, STAGE1 − STAGE2) were exposed. A
 * caller that additionally needed "how many candidates exist in total" or
 * "evidence breakdown across ALL candidates" had no field to read and was
 * forced to recompute it from `candidates` (the flat per-line list) — which
 * is exactly how a display ended up subtracting a STAGE-0-scoped count
 * (all 3 BTTS candidates marked `excluded`) from a STAGE-1-scoped count
 * (the 1 candidate that passed the quality gate), producing `1 − 3 = −2`
 * instead of the correct `1 − 1 = 0`. With every stage now named and
 * exported, no caller needs to perform that subtraction itself again.
 *
 * Funnel chain (each step reads ONLY from the step above it):
 *   rawCandidates          — spec.codes filter on allPatterns (may contain dups)
 *   strategyCandidates     — canonicalCandidates(rawCandidates)        ← STAGE 0
 *   qualityPassed          — coreQualityFailures === 0                 ← STAGE 1
 *   afterEvidence          — evidenceLevel !== 'excluded'               ← STAGE 2
 *   afterModelConflict     — no material conflict on a conditional line ← STAGE 3
 *   eligible               — tier check (flat/ignore removed)           ← STAGE 4
 *   vetoPool               — profileVeto filter (if active)
 *   baseline / experiment  — selectCoreSet(eligible | vetoPool, slots)
 *   selected               — baseline or experiment
 */
function buildStrategyCore(
spec: QuickStrategySpec,
strategy: CoreStrategySettings,
allPatterns: readonly PatternHit[],
analysedFixtures: number,
markets: SlipMarketPreferences | null)
: CoreOutcome {
  const vetoActive = strategy.vetoMode === 'active';
  const flaggedOf = (pattern: PatternHit) => pattern.bttsRisk?.wouldVeto ?? false;

  /* --- STAGE 0: CANONICALISATION — before any gate, counter or readout ----
   *
   * One (fixtureId, code) pair → exactly one candidate record.
   *
   * Without this, a `streak::BTTS` and a `goal_market::BTTS` for the same
   * fixture both entered the funnel, each counting as a separate
   * "Core-eligible candidate". The readout then reported e.g. "Core-eligible:
   * 2" for a single eligible fixture, while the card correctly placed only one
   * line (the fixture dedup in selectCoreSet caught it there). This
   * inconsistency is the root cause of the bug described in the v2.2 header.
   *
   * ALL arrays below are derived from `strategyCandidates`, never from
   * `rawCandidates`. The `duplicateCandidatesMerged` counter is the ONLY
   * place `rawCandidates` is referenced after this point.
   */
  const rawCandidates = allPatterns.filter((pattern) => spec.codes.includes(pattern.code));
  const strategyCandidates = canonicalCandidates(rawCandidates);
  const duplicateCandidatesMerged = rawCandidates.length - strategyCandidates.length;

  /* --- Funnel: each stage filters the PREVIOUS stage's output ------------ */
  const qualityPassed = strategyCandidates.filter(
    (pattern) => coreQualityFailures(pattern).length === 0
  );
  const afterEvidence = qualityPassed.filter((pattern) => evidenceLevelOf(pattern) !== 'excluded');
  const afterModelConflict = afterEvidence.filter(
    (pattern) => !(evidenceLevelOf(pattern) === 'conditional' && hasMaterialModelConflict(pattern))
  );
  // Tier check last. In practice this removes nothing new, because
  // `coreQualityFailures` (STAGE 1) already pushes 'decision' for flat/ignore
  // quadrants — `tierExcludedCandidates` below should therefore always read
  // 0. It is kept as its own stage (rather than folded into `isCoreEligible`
  // silently) so that invariant is visible and checkable in the readout
  // instead of assumed.
  const eligible = afterModelConflict.filter((pattern) => coreTierOf(pattern) !== null);

  const vetoPool = spec.profileVeto ? eligible.filter((p) => !flaggedOf(p)) : eligible;
  const baseline = selectCoreSet(eligible, spec.slots);
  const experiment = selectCoreSet(vetoPool, spec.slots);
  const selected = spec.profileVeto && vetoActive ? experiment : baseline;

  const slotOf = new Map<string, number>();
  selected.forEach((pattern, index) => slotOf.set(pattern.id, index + 1));

  /* --- Candidate readout — built from strategyCandidates (canonical) ------ */
  const candidates: CoreCandidateRow[] = strategyCandidates.
  map((pattern) => {
    const failed = gateFailuresForKind(pattern, 'core');
    const slot = slotOf.get(pattern.id) ?? null;
    const flagged = flaggedOf(pattern);
    const reason =
    slot !== null ?
    `Core ${slot} — ${
    evidenceLevelOf(pattern) === 'conditional' ?
    'feltételes evidencia-szinten került kártyára' :
    'kalibrált evidencia-szinten került kártyára'}.` :

    failed.length > 0 ?
    GATE_DETAIL[failed[0]] :
    flagged && spec.profileVeto && vetoActive ?
    'Éles kiütés-profil veto vette le a sort.' :
    'Kapun belüli jelölt, de a rangsorban a felvett sorok mögé került, ' +
    'vagy a mérkőzése már szerepel a core oldalon.';
    return {
      pattern,
      evidence: evidenceLevelOf(pattern),
      quadrant: effectiveDecisionOf(pattern),
      coreTier: coreTierOf(pattern),
      failed,
      slot,
      reason
    };
  }).
  sort(
    (a, b) =>
    (a.slot ?? 99) - (b.slot ?? 99) ||
    a.failed.length - b.failed.length ||
    b.pattern.hitRate - a.pattern.hitRate
  );

  const slots = CORE_ROLES.map((role, index) => {
    const pattern = selected[index] ?? null;
    if (!pattern) {
      return {
        ...emptySlot(
          role,
          eligible.length === 0 ?
          `${strategyCandidates.length} jelölt közül egy sem jutott át a szigorú core ` +
          'kapun — a kártya üresen marad.' :
          'Nem maradt más mérkőzésről érkező érvényes jelölt erre a kártyára.'
        ),
        title: `${ROLE_SPEC[role].title} — ${spec.short}`,
        families: spec.codes.join(' · '),
        blocked: blockedList(strategyCandidates)
      };
    }
    return filledSlot(role, pattern, {
      title: `${ROLE_SPEC[role].title} — ${spec.short}`,
      families: spec.codes.join(' · '),
      vetoActive,
      profileVeto: spec.profileVeto,
      coreTier: coreTierOf(pattern)
    });
  });

  const primaryCoreCount = selected.filter((p) => coreTierOf(p) === 'primary').length;
  const secondaryCoreCount = selected.filter((p) => coreTierOf(p) === 'secondary').length;
  const placedLevels = selected.map(evidenceLevelOf);

  /* --- StrategyReadout — ALL counts from canonical funnel stages ----------
   *
   * Every numeric field below reads from the funnel arrays defined above,
   * and ONLY from the one array it is named after — never from a
   * differently-scoped array, and never by combining two scopes in the same
   * expression:
   *
   *   totalCandidates*            ← strategyCandidates   (STAGE 0, canonical, unfiltered)
   *   qualityPassedCandidates     ← qualityPassed         (STAGE 1)
   *   qualityFailedCandidates     ← STAGE 0 − STAGE 1
   *   afterEvidenceCandidates     ← afterEvidence         (STAGE 2)
   *   disprovedCandidates         ← STAGE 1 − STAGE 2 (own band disproved,
   *                                 scoped to quality-gate survivors only)
   *   modelConflictExcludedCandidates ← STAGE 2 − STAGE 3
   *   tierExcludedCandidates      ← STAGE 3 − STAGE 4 (expected 0; invariant)
   *   strictCandidates/
   *   calibratedCandidates/
   *   conditionalCandidates       ← eligible              (STAGE 4)
   *   primaryEligibleCandidates/
   *   secondaryEligibleCandidates/
   *   eligibleFixtures            ← eligible              (STAGE 4)
   *
   * `duplicateCandidatesMerged` is the only field that references
   * `rawCandidates` (pre-STAGE-0) — by design, because it measures how many
   * raw records were collapsed by canonicalisation.
   */
  const readout: StrategyReadout = {
    strategy: spec.id,
    label: spec.label,
    vetoMode: strategy.vetoMode,
    vetoActive: spec.profileVeto && vetoActive,
    ruleVersion: BTTS_PROFILE_RULE_VERSION,
    evidenceRuleVersion: CORE_EVIDENCE_RULE_VERSION,
    selectionRuleVersion: CORE_SELECTION_RULE_VERSION,
    baseline,
    experiment,
    excluded: spec.profileVeto ?
    strategyCandidates.
    filter((pattern) => pattern.bttsRisk && pattern.bttsRisk.wouldVeto).
    map((pattern) => ({
      pattern,
      risk: pattern.bttsRisk as BttsBlowoutRiskAssessment
    })) :
    [],
    candidates,
    analysedFixtures,

    totalCandidates: strategyCandidates.length,
    totalCalibratedCandidates: strategyCandidates.filter(
      (p) => evidenceLevelOf(p) === 'calibrated'
    ).length,
    totalConditionalCandidates: strategyCandidates.filter(
      (p) => evidenceLevelOf(p) === 'conditional'
    ).length,
    totalExcludedCandidates: strategyCandidates.filter(
      (p) => evidenceLevelOf(p) === 'excluded'
    ).length,

    qualityPassedCandidates: qualityPassed.length,
    qualityFailedCandidates: strategyCandidates.length - qualityPassed.length,

    afterEvidenceCandidates: afterEvidence.length,
    disprovedCandidates: qualityPassed.length - afterEvidence.length,

    modelConflictExcludedCandidates: afterEvidence.length - afterModelConflict.length,
    tierExcludedCandidates: afterModelConflict.length - eligible.length,

    strictCandidates: eligible.length,
    calibratedCandidates: eligible.filter((p) => evidenceLevelOf(p) === 'calibrated').length,
    conditionalCandidates: eligible.filter((p) => evidenceLevelOf(p) === 'conditional').length,
    duplicateCandidatesMerged,
    coreFilled: selected.length,
    coreSlots: spec.slots,
    primaryEligibleCandidates: eligible.filter((p) => coreTierOf(p) === 'primary').length,
    secondaryEligibleCandidates: eligible.filter((p) => coreTierOf(p) === 'secondary').length,
    eligibleFixtures: new Set(eligible.map((p) => p.fixtureId)).size,
    primaryCoreCount,
    secondaryCoreCount,
    tierNote: tierNoteOf(secondaryCoreCount, selected.length, spec.slots),
    coreEvidenceLevel:
    placedLevels.length === 0 ?
    null :
    placedLevels.includes('conditional') ?
    'conditional' :
    'calibrated'
  };

  return {
    slots,
    readout,
    trace: {
      executionPath: 'strategy',
      specNullReason: specNullReasonOf(strategy),
      configuredMarketPool: markets ? markets.coreCards.map((card) => card) : null
    },
    configError: null,
    usedFixtures: new Set(selected.map((p) => p.fixtureId)),
    notes:
    duplicateCandidatesMerged > 0 ?
    [
    `${duplicateCandidatesMerged} duplikált jelölt-rekord (ugyanaz a mérkőzés és ` +
    'ugyanaz a piac, két külön minta-generátorból) a kapuk ELŐTT egyetlen ' +
    'kanonikus sorra lett vonva — a jogosultsági számlálók ezért mérkőzésenként ' +
    'egyszer számolnak.'] :

    []
  };
}

function buildPooledCore(
allPatterns: readonly PatternHit[],
markets: SlipMarketPreferences | null,
strategy: CoreStrategySettings | null,
path: CoreExecutionPath)
: CoreOutcome {
  const usedFixtures = new Set<string>();
  const slots: SlipSlot[] = [];

  CORE_ROLES.forEach((role, index) => {
    const ids = markets ? coreCardMarkets(markets, index) : [];
    const pool = canonicalCandidates(
      allPatterns.filter((pattern) =>
      markets && ids.length > 0 ?
      matchesMarkets(pattern, ids) :
      index === 0 ?
      pattern.code === 'BTTS' :
      index === 1 ?
      pattern.code === 'O2.5' :
      pattern.type === 'safety_trend'
      )
    );
    const candidate =
    pool.
    filter((pattern) => !usedFixtures.has(pattern.fixtureId)).
    filter(isCoreEligible).
    slice().
    sort(byTierThenEvidenceThenStrategy)[0] ?? null;

    if (!candidate) {
      slots.push({
        ...emptySlot(
          role,
          ids.length === 0 && markets ?
          'Ehhez a core kártyához nincs kiválasztott piac.' :
          'Nincs olyan jelölt ebben a készletben, amely a szigorú core kapun belül van.'
        ),
        title: `${ROLE_SPEC[role].title}`,
        families: markets && ids.length > 0 ? summarizeMarkets(ids) : ROLE_SPEC[role].families,
        blocked: blockedList(pool)
      });
      return;
    }

    usedFixtures.add(candidate.fixtureId);
    slots.push(
      filledSlot(role, candidate, {
        title: `${ROLE_SPEC[role].title}`,
        families: markets && ids.length > 0 ? summarizeMarkets(ids) : ROLE_SPEC[role].families,
        vetoActive: strategy?.vetoMode === 'active',
        profileVeto: false,
        coreTier: coreTierOf(candidate)
      })
    );
  });

  return {
    slots,
    readout: null,
    trace: {
      executionPath: path,
      specNullReason: specNullReasonOf(strategy),
      configuredMarketPool: markets ? markets.coreCards.map((card) => card) : null
    },
    configError: null,
    usedFixtures,
    notes: []
  };
}

function buildBlockedCore(
markets: SlipMarketPreferences | null,
strategy: CoreStrategySettings | null)
: CoreOutcome {
  return {
    slots: CORE_ROLES.map((role) =>
    emptySlot(
      role,
      'A core stratégia beállítása önmagával ellentmondó (gyors mód piac-kód nélkül).'
    )
    ),
    readout: null,
    trace: {
      executionPath: 'blocked',
      specNullReason: specNullReasonOf(strategy),
      configuredMarketPool: markets ? markets.coreCards.map((card) => card) : null
    },
    configError:
    'A core stratégia gyors módban van, de nem hordoz egyetlen piac-kódot sem, ' +
    'ezért nem dönthető el, melyik kiválasztási út volt a szándék.',
    usedFixtures: new Set<string>(),
    notes: []
  };
}

/** Build the whole 3+3 draft from a finished round analysis. */
export function buildSlipDraft(
analyses: readonly FixtureAnalysis[],
markets?: SlipMarketPreferences | null,
strategy?: CoreStrategySettings | null)
: SlipDraft {
  const allPatterns = rankedPatterns(analyses);
  const spec = coreStrategySpecOf(strategy);
  const reason = specNullReasonOf(strategy);
  const marketPrefs = markets ?? null;
  const strategySettings = strategy ?? null;

  const core: CoreOutcome = spec ?
  buildStrategyCore(
    spec,
    strategySettings as CoreStrategySettings,
    allPatterns,
    analyses.length,
    marketPrefs
  ) :
  reason === 'empty_codes' ?
  buildBlockedCore(marketPrefs, strategySettings) :
  buildPooledCore(
    allPatterns,
    marketPrefs,
    strategySettings,
    marketPrefs ? 'pooled' : 'fixed'
  );

  const usedFixtures = new Set(core.usedFixtures);
  const jokerSlots = JOKER_ROLES.map((role) => {
    const pool = jokerPool(role, allPatterns, marketPrefs);
    const candidate = pool.find((pattern) => !usedFixtures.has(pattern.fixtureId)) ?? null;
    if (!candidate) return emptySlot(role, ROLE_SPEC[role].empty);
    usedFixtures.add(candidate.fixtureId);
    return filledSlot(role, candidate, {
      vetoActive: strategy?.vetoMode === 'active',
      profileVeto: false,
      coreTier: null
    });
  });

  const notes = [...core.notes];
  if (core.readout && core.readout.coreEvidenceLevel === 'conditional') {
    notes.push(
      'A core oldalon feltételes evidencia-szintű sor is van: ezeknél a jelzett ' +
      'valószínűség még nincs visszamérve, ezért a kombinált érték nem visszamért ' +
      'valószínűség.'
    );
  }

  return {
    slots: [...core.slots, ...jokerSlots],
    strategy: core.readout,
    trace: core.trace,
    configError: core.configError,
    notes
  };
}

/* -------------------------------------------------------------------------- *
 * Draft operations
 * -------------------------------------------------------------------------- */

function poolForRole(
role: ActiveSlipRole,
allPatterns: readonly PatternHit[],
markets: SlipMarketPreferences | null,
strategy: CoreStrategySettings | null)
: PatternHit[] {
  if (ROLE_SPEC[role].kind === 'joker') return jokerPool(role, allPatterns, markets);

  const spec = coreStrategySpecOf(strategy);
  if (spec) {
    return canonicalCandidates(
      allPatterns.filter((pattern) => spec.codes.includes(pattern.code)).filter(isCoreEligible)
    );
  }

  const index = CORE_ROLES.indexOf(role);
  const ids = markets ? coreCardMarkets(markets, index) : [];
  return canonicalCandidates(
    allPatterns.
    filter((pattern) => ids.length > 0 ? matchesMarkets(pattern, ids) : false).
    filter(isCoreEligible)
  );
}

/**
 * Replace one slot's line with the next valid alternative.
 *
 * Fixtures already used by the OTHER slots are excluded, so a swap can never
 * introduce a correlated duplicate. Returns `null` when no alternative exists.
 */
export function swapSlot(
draft: SlipDraft,
role: ActiveSlipRole,
allPatterns: readonly PatternHit[],
markets: SlipMarketPreferences | null,
strategy: CoreStrategySettings | null)
: SlipDraft | null {
  const slot = draft.slots.find((s) => s.role === role);
  if (!slot) return null;

  const blockedFixtures = new Set(
    draft.slots.
    filter((s) => s.role !== role && s.pattern).
    map((s) => (s.pattern as PatternHit).fixtureId)
  );

  const pool = poolForRole(role, allPatterns, markets, strategy).filter(
    (pattern) => !blockedFixtures.has(pattern.fixtureId)
  );
  if (pool.length === 0) return null;

  const currentIndex = slot.pattern ?
  pool.findIndex((pattern) => pattern.id === (slot.pattern as PatternHit).id) :
  -1;
  const next = pool[(currentIndex + 1) % pool.length];
  if (!next || slot.pattern && next.id === slot.pattern.id) return null;

  return {
    ...draft,
    slots: draft.slots.map((s) =>
    s.role === role ?
    {
      ...filledSlot(role, next, {
        title: s.title,
        families: s.families,
        vetoActive: strategy?.vetoMode === 'active',
        profileVeto: ROLE_SPEC[role].kind === 'core',
        coreTier: ROLE_SPEC[role].kind === 'core' ? coreTierOf(next) : null
      })
    } :
    s
    )
  };
}

function lineProbability(pattern: PatternHit): number {
  const value = typeof pattern.modelProb === 'number' ? pattern.modelProb : pattern.hitRate;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function hasLines(draft: SlipDraft): boolean {
  return draft.slots.some((slot) => slot.pattern !== null);
}

/**
 * Fixture labels that occur on more than one line.
 *
 * The identity is the `fixtureId`, NOT the display label: two different
 * fixtures (e.g. one in each league column) can render an identical
 * `${home} – ${away}` label, and counting labels reported those as a
 * duplicate — invalidating a perfectly valid slip. The label is only used
 * for the message shown to the user.
 */
export function duplicateFixtures(draft: SlipDraft): string[] {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  draft.slots.forEach((slot) => {
    if (!slot.pattern) return;
    const key = slot.pattern.fixtureId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!labels.has(key)) labels.set(key, slot.pattern.fixtureLabel);
  });
  return Array.from(counts.entries()).
  filter(([, count]) => count > 1).
  map(([id]) => labels.get(id) ?? id);
}

/**
 * Product of the line probabilities.
 *
 * A duplicated fixture makes the lines correlated, so the product is NOT a
 * probability — it returns 0, and the surface renders an explicit invalid state
 * rather than a catastrophic-looking 0.0%.
 */
export function combinedProbability(draft: SlipDraft): number {
  if (duplicateFixtures(draft).length > 0) return 0;
  const lines = draft.slots.map((slot) => slot.pattern).filter((p): p is PatternHit => Boolean(p));
  if (lines.length === 0) return 0;
  return lines.reduce((acc, pattern) => acc * lineProbability(pattern), 1);
}

/** The weakest evidence level on the core side, or `null` when it is empty. */
export function draftEvidenceLevel(draft: SlipDraft): CoreEvidenceLevel | null {
  const levels = draft.slots.
  filter((slot) => ROLE_SPEC[slot.role].kind === 'core' && slot.pattern).
  map((slot) => evidenceLevelOf(slot.pattern as PatternHit));
  if (levels.length === 0) return null;
  if (levels.includes('excluded')) return 'excluded';
  if (levels.includes('conditional')) return 'conditional';
  return 'calibrated';
}

function lineOf(slot: SlipSlot, pattern: PatternHit): SlipLine {
  return {
    id: `${slot.role}-${pattern.id}`,
    role: slot.role,
    fixtureLabel: pattern.fixtureLabel,
    league: pattern.league,
    type: pattern.type,
    code: pattern.code,
    label: pattern.label,
    stability: pattern.stability,
    hitRate: pattern.hitRate,
    sample: pattern.sample,
    decision: effectiveDecisionOf(pattern),
    band: pattern.band,
    bandHitRate: pattern.bandHitRate,
    // Both derived from the ONE snapshot, so a saved slip can never disagree
    // with the screen that produced it.
    bandCalibrated: evidenceLevelOf(pattern) === 'calibrated',
    bandDiagnosis: effectiveBandDiagnosisOf(pattern),
    htHome: null,
    htAway: null,
    ftHome: null,
    ftAway: null,
    headToHeadRecord: pattern.headToHeadRecord,
    goalStats: pattern.goalStats,
    htStats: pattern.htStats,
    topModalScores: pattern.topModalScores,
    reversalStats: pattern.reversalStats,
    goalProfile: pattern.goalProfile ?? null,
    bttsRisk: pattern.bttsRisk ?? null,
    coreEvidence: pattern.coreEvidence ?? null,
    evidenceLevel: evidenceLevelOf(pattern),
    coreTier: slot.coreTier ?? null,
    coreSelectionRuleVersion: CORE_SELECTION_RULE_VERSION
  };
}

/** Freeze a draft into a persistable slip, stamped with its rule versions. */
export function draftToSlip(
draft: SlipDraft,
roundName: string,
strategy: CoreStrategySettings)
: Slip {
  const lines = draft.slots.
  filter((slot) => slot.pattern).
  map((slot) => lineOf(slot, slot.pattern as PatternHit));

  return {
    id: `slip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    roundName,
    combinedProb: combinedProbability(draft),
    lines,
    coreStrategy: strategy.quickStrategy,
    vetoMode: strategy.vetoMode,
    ruleVersion: CORE_SELECTION_RULE_VERSION,
    executionPath: draft.trace?.executionPath,
    specNullReason: draft.trace?.specNullReason ?? null
  };
}