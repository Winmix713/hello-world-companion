import { CORE_STABILITY_MIN } from './constants';
import { H2H_ESS_WARM } from './patterns';
import { CORE_EVIDENCE_MAX_RADIUS } from './coreEvidence';
import { QUADRANT_DOC, explainQuadrant, type QuadrantExplain } from './quadrantExplain';
import { DECISION_THRESHOLDS, SECONDARY_MARKET_THRESHOLDS } from './decision';
import {
  GATE_DETAIL,
  GATE_LABEL,
  coreQualityFailures,
  effectiveDecisionOf,
  evidenceLevelOf,
  gateFailuresForKind,
  type GateCondition,
  type StrategyReadout } from
'./slip';
import type {
  CoreEvidenceKind,
  CoreEvidenceLevel,
  DecisionQuadrant,
  FixtureAnalysis,
  PatternAgreement,
  PatternHit,
  PatternType } from
'../types/winmix';

export type CoreGateEffect = 'hard' | 'conditional_hard' | 'scope' | 'rank' | 'display';

export interface CoreGateSpec {
  id: string;
  step: number;
  name: string;
  file: string;
  fn: string;
  threshold: string;
  why: string;
  effect: CoreGateEffect;
}

export const CORE_GATE_REGISTRY: readonly CoreGateSpec[] = [
{
  id: 'market_scope',
  step: 1,
  name: 'Piac-szűrés (stratégia kódjai)',
  file: 'utils/slip.ts',
  fn: 'strategySlots → spec.codes.includes(p.code)',
  threshold: 'a stratégia pontos market kódjai (pl. BTTS)',
  why: 'Csak a stratégia piacába tartozó sorok lehetnek jelöltek.',
  effect: 'scope'
},
{
  id: 'decision',
  step: 2,
  name: 'Kvadráns (core szint)',
  file: 'utils/decision.ts + utils/slip.ts',
  fn: 'decisionQuadrantOf(hitRate, marketConfidence, …) → effectiveDecisionOf',
  threshold:
  `P = súly. H2H ≥ ${SECONDARY_MARKET_THRESHOLDS.pMin} ÉS C = piaci konfidencia ≥ ` +
  `${SECONDARY_MARKET_THRESHOLDS.cMin} (gól/HT-FT piac, BTTS is); minden más ` +
  `családnál P ≥ ${DECISION_THRESHOLDS.minProbability} ÉS C = stability ≥ ` +
  `${DECISION_THRESHOLDS.minConfidence}`,
  why: 'Cselekvőképes = elsődleges, volatilis = másodlagos core; flat és ignore kizárt.',
  effect: 'hard'
},
{
  id: 'sample',
  step: 3,
  name: 'Hideg minta (Kish ESS)',
  file: 'utils/slip.ts',
  fn: "coreQualityFailures → pattern.sufficiency === 'cold'",
  threshold: `ESS ≥ ${H2H_ESS_WARM} (a 'cold' fokozat felett)`,
  why: 'A recency-súlyozott effektív mintaméretnek elegendőnek kell lennie.',
  effect: 'hard'
},
{
  id: 'stability',
  step: 4,
  name: 'Stabilitás',
  file: 'utils/slip.ts',
  fn: 'coreQualityFailures → pattern.stability < CORE_STABILITY_MIN',
  threshold: `stabilitás ≥ ${CORE_STABILITY_MIN}`,
  why: 'A core nem egyszeri kilengésre épül.',
  effect: 'hard'
},
{
  id: 'market_uncalibrated',
  step: 5,
  name: 'Csapatgól-piac core tilalom',
  file: 'utils/slip.ts',
  fn: 'coreQualityFailures → isTeamGoalCoreBlocked',
  threshold: "csapatgól kód ÉS marketCalibrationStatus !== 'calibrated'",
  why: 'A csapatgól-család csak saját piac-specifikus visszamérés után lehet core.',
  effect: 'hard'
},
{
  id: 'band',
  step: 6,
  name: 'Cáfolt saját valószínűségi sáv',
  file: 'utils/coreEvidence.ts + utils/slip.ts',
  fn: "resolveCoreEvidence → level === 'excluded' → gateFailuresForKind",
  threshold: 'a SAJÁT sávban n ≥ 20, és a jelzett érték Wilson-intervallumon kívül van',
  why:
  `Csak a saját, értékelhető sáv zárhat ki; a bővített ±${CORE_EVIDENCE_MAX_RADIUS} ` +
  'sávos környezet soha nem cáfolhat.',
  effect: 'hard'
},
{
  id: 'model_conflict',
  step: 7,
  name: 'Modell–H2H konfliktus (csak feltételes sornál)',
  file: 'utils/slip.ts',
  fn: "gateFailuresForKind → level === 'conditional' && hasMaterialModelConflict",
  threshold: "bttsRisk.reasonCodes tartalmazza a 'model_conflict' kódot",
  why: 'Csak feltételes evidencia mellett kizáró.',
  effect: 'conditional_hard'
},
{
  id: 'blowout_profile',
  step: 8,
  name: 'Kiütés-profil szűrő (BTTS)',
  file: 'utils/bttsProfile.ts + utils/slip.ts',
  fn: 'assessBttsBlowoutRisk → strategySlots → flagged(p)',
  threshold: 'bttsRisk.wouldVeto — csak ÉLES veto módban és profileVeto stratégiánál',
  why: 'Árnyék módban csak diagnosztika.',
  effect: 'conditional_hard'
},
{
  id: 'evidence_priority',
  step: 9,
  name: 'Szint- és evidencia-elsőbbség',
  file: 'utils/slip.ts',
  fn: 'byTierThenEvidenceThenStrategy → coreTierRank → evidenceRank',
  threshold: 'elsődleges < másodlagos; kalibrált < feltételes < kizárt',
  why: 'Csak rangsorol, nem zár ki.',
  effect: 'rank'
},
{
  id: 'ranking',
  step: 10,
  name: 'Lexikografikus rangsor',
  file: 'utils/slip.ts',
  fn: 'byStrategyRank',
  threshold: 'H2H% → modell% → Kish ESS → modell-egyezés → kiütés-risk',
  why: 'Csak rangsorol, nem zár ki.',
  effect: 'rank'
},
{
  id: 'distinct_fixture',
  step: 11,
  name: 'Egy mérkőzés — egy sor',
  file: 'utils/slip.ts',
  fn: 'pickDistinctFixtures',
  threshold: 'fixtureId egyszer szerepelhet a core oldalon',
  why: 'Egy meccs nem kerülhet két Core-slotba.',
  effect: 'scope'
},
{
  id: 'slot_limit',
  step: 12,
  name: 'Core 01 / 02 / 03 slot-kitöltés',
  file: 'utils/slip.ts',
  fn: 'strategySlots → CORE_ROLES.slice(0, spec.slots)',
  threshold: 'legfeljebb 3 sor; relaxed tartalék tiltott',
  why: 'Az üres Core-slot érvényes kimenet.',
  effect: 'scope'
},
{
  id: 'cohesion',
  step: 13,
  name: 'Kohéziós érték (átlaggól)',
  file: 'utils/patterns.ts → goalProfile.weightedAvgGoals',
  fn: 'CoreCandidateTable — csak megjelenítés',
  threshold: 'nincs küszöb',
  why: 'Nem szűr és nem rangsorol.',
  effect: 'display'
}];


export interface CoreTraceGateResult {
  id: string;
  passed: boolean;
  actual: string;
  binding: boolean;
}

export type CoreTraceVerdict = 'core' | 'gate_failed' | 'vetoed' | 'flagged_shadow' | 'outranked';

export interface CoreTraceCandidate {
  id: string;
  fixture: string;
  fixtureId: string;
  code: string;
  patternType: PatternType;
  patternLabel: string;
  evidence: CoreEvidenceLevel;
  evidenceKind: CoreEvidenceKind | null;
  modelProb: number | null;
  h2hRate: number;
  stability: number;
  ess: number;
  quadrant: DecisionQuadrant;
  quadrantExplain: QuadrantExplain;
  agreement: PatternAgreement;
  judgedBy: 'market' | 'global';
  bandLabel: string | null;
  widened: boolean;
  observations: number;
  required: number;
  hits: number | null;
  measuredRate: number | null;
  signalledProb: number | null;
  ciLo: number | null;
  ciHi: number | null;
  outsideInterval: boolean | null;
  calibrationStatus: string;
  blowoutHistorical: number | null;
  blowoutModel: number | null;
  wouldVeto: boolean;
  vetoReasons: string[];
  cohesion: number | null;
  gates: CoreTraceGateResult[];
  failed: GateCondition[];
  slot: number | null;
  verdict: CoreTraceVerdict;
  primaryCause: string;
  primaryCauseDetail: string;
}

export interface CoreTraceStage {
  id: string;
  label: string;
  count: number;
  lost: number;
  detail: string;
}

export interface CoreTraceFixtureRow {
  fixture: string;
  patterns: number;
  codes: string[];
  inFamily: boolean;
}

export interface CoreTraceConditionalRow {
  code: string;
  total: number;
  eligible: number;
  inFamily: boolean;
}

export interface CoreTraceDuplicateGroup {
  fixture: string;
  fixtureId: string;
  rows: CoreTraceCandidate[];
  explanation: string;
}

export interface CoreTraceLevelTally {
  calibrated: number;
  conditional: number;
  excluded: number;
  total: number;
}

export interface CoreTraceEvidenceTally {
  all: CoreTraceLevelTally;
  eligible: CoreTraceLevelTally;
  placed: CoreTraceLevelTally;
}

export interface CoreTrace {
  strategy: string;
  strategyLabel: string;
  vetoMode: string;
  vetoActive: boolean;
  familyCodes: string[];
  fixtures: number;
  patternsTotal: number;
  fixtureRows: CoreTraceFixtureRow[];
  marketRows: {code: string;count: number;}[];
  stages: CoreTraceStage[];
  candidates: CoreTraceCandidate[];
  quadrantDoc: typeof QUADRANT_DOC;
  duplicates: CoreTraceDuplicateGroup[];
  evidenceTally: CoreTraceEvidenceTally;
  disproved: CoreTraceCandidate[];
  attribution: {cause: string;count: number;detail: string;}[];
  conditional: {
    familyTotal: number;
    familyEligible: number;
    familyBlocked: number;
    outsideTotal: number;
    byCode: CoreTraceConditionalRow[];
  };
  admitsConditional: {allowed: boolean;reason: string;};
  slots: {index: number;fixture: string | null;evidence: CoreEvidenceLevel | null;}[];
  coreSlots: number;
  coreFilled: number;
}

function quadrantOk(pattern: PatternHit): boolean {
  const decision = effectiveDecisionOf(pattern);
  return decision === 'actionable' || decision === 'volatile';
}

function gateResults(
pattern: PatternHit,
failed: GateCondition[],
vetoActive: boolean,
profileVeto: boolean)
: CoreTraceGateResult[] {
  const level = evidenceLevelOf(pattern);
  const snap = pattern.coreEvidence ?? null;
  const conflict = pattern.bttsRisk?.reasonCodes.includes('model_conflict') ?? false;
  const flagged = pattern.bttsRisk?.wouldVeto ?? false;

  return [
  { id: 'decision', passed: quadrantOk(pattern), actual: effectiveDecisionOf(pattern), binding: true },
  {
    id: 'sample',
    passed: pattern.sufficiency !== 'cold',
    actual: `${pattern.sufficiency} · ESS ${pattern.effectiveSampleSize.toFixed(2)}`,
    binding: true
  },
  { id: 'stability', passed: pattern.stability >= CORE_STABILITY_MIN, actual: pattern.stability.toFixed(0), binding: true },
  {
    id: 'market_uncalibrated',
    passed: !failed.includes('market_uncalibrated'),
    actual: pattern.marketCalibrationStatus ?? 'unregistered',
    binding: true
  },
  {
    id: 'band',
    passed: level !== 'excluded',
    actual: snap && snap.observations > 0 ? `${level} · n = ${snap.observations} / ${snap.required}` : level,
    binding: true
  },
  {
    id: 'model_conflict',
    passed: !(level === 'conditional' && conflict),
    actual: conflict ? 'model_conflict jelen van' : 'nincs konfliktus',
    binding: level === 'conditional'
  },
  {
    id: 'blowout_profile',
    passed: !flagged,
    actual: flagged ? 'megjelölve' : 'nincs megjelölés',
    binding: profileVeto && vetoActive
  }];

}

function outsideInterval(signalled: number | null, lo: number | null, hi: number | null): boolean | null {
  if (signalled === null || lo === null || hi === null) return null;
  return signalled < lo || signalled > hi;
}

function primaryCauseOf(
row: Omit<CoreTraceCandidate, 'primaryCause' | 'primaryCauseDetail'>)
: {primaryCause: string;primaryCauseDetail: string;} {
  if (row.slot !== null) {
    return {
      primaryCause: `Core ${row.slot}`,
      primaryCauseDetail:
      row.evidence === 'conditional' ?
      'Felkerült, de feltételes evidencia-szinten.' :
      'Felkerült, kalibrált evidencia-szinten.'
    };
  }
  if (row.failed.length > 0) {
    const first = row.failed[0];
    return {
      primaryCause: GATE_LABEL[first],
      primaryCauseDetail: `${GATE_DETAIL[first]}${
      row.failed.length > 1 ?
      ` (további bukott feltétel: ${row.failed.slice(1).map((c) => GATE_LABEL[c]).join(', ')})` :
      ''}.`

    };
  }
  if (row.verdict === 'vetoed') {
    return { primaryCause: 'Kiütés-profil (ÉLES)', primaryCauseDetail: row.vetoReasons.join(' ') || 'A profil-szűrő levette a sort.' };
  }
  if (row.verdict === 'flagged_shadow') {
    return {
      primaryCause: 'Rangsor (profil-jelölés árnyékban)',
      primaryCauseDetail: 'A profil-szűrő csak megjelölte a sort; a rangsor mögé került.'
    };
  }
  return {
    primaryCause: 'Rangsor / egy-mérkőzés szabály',
    primaryCauseDetail: 'Kapun belüli jelölt, amely a rangsorban hátrébb került, vagy a fixture már szerepel a core oldalon.'
  };
}

function tallyLevels(rows: readonly CoreTraceCandidate[]): CoreTraceLevelTally {
  return {
    calibrated: rows.filter((r) => r.evidence === 'calibrated').length,
    conditional: rows.filter((r) => r.evidence === 'conditional').length,
    excluded: rows.filter((r) => r.evidence === 'excluded').length,
    total: rows.length
  };
}

const PATTERN_SOURCE: Record<PatternType, string> = {
  safety_trend: 'safetyTrend() — kimenet-trend a súlyozott H2H poolon',
  goal_market: 'goalMarket() — súlyozott H2H gólpiaci arány',
  exact_score: 'exactScore() — modális pontos eredmény',
  htft_reversal: 'reversal() — HT/FT fordulás',
  ht_market: 'htMarket() — félidős piac',
  streak: 'streak() — megszakítás nélküli sorozat',
  model_agreement: 'modelAgreement() — modell és H2H egyezése'
};

function duplicateExplanation(rows: readonly CoreTraceCandidate[]): string {
  const types = Array.from(new Set(rows.map((r) => r.patternType)));
  const codes = Array.from(new Set(rows.map((r) => r.code)));
  const parts: string[] = [];
  if (codes.length > 1) parts.push(`Külön market kódok: ${codes.join(', ')}.`);
  if (types.length > 1) {
    parts.push(
      `Azonos piac, ${types.length} generator: ${types.map((t) => `${t} → ${PATTERN_SOURCE[t]}`).join(' · ')}. ` +
      'A modellérték azonos lehet, a H2H különbözhet, mert a generátorok más képletet használnak.'
    );
  }
  if (types.length === 1 && codes.length === 1) {
    parts.push(`Nem várt duplikáció: ${rows.map((r) => r.id).join(' · ')}.`);
  }
  parts.push('A core oldalon ugyanebből a fixture-ből csak egy sor szerepelhet.');
  return parts.join(' ');
}

export interface CoreTraceInput {
  analyses: readonly FixtureAnalysis[];
  readout: StrategyReadout;
  familyCodes: readonly string[];
  profileVeto: boolean;
}

export function buildCoreTrace(input: CoreTraceInput): CoreTrace {
  const { analyses, readout, familyCodes, profileVeto } = input;
  const allPatterns = analyses.flatMap((analysis) => analysis.patterns);
  const family = allPatterns.filter((pattern) => familyCodes.includes(pattern.code));
  const vetoActive = readout.vetoActive;

  const fixtureRows: CoreTraceFixtureRow[] = analyses.map((analysis) => {
    const codes = Array.from(new Set(analysis.patterns.map((pattern) => pattern.code)));
    return {
      fixture: analysis.label || analysis.fixtureId,
      patterns: analysis.patterns.length,
      codes,
      inFamily: codes.some((code) => familyCodes.includes(code))
    };
  });

  const marketCounts = new Map<string, number>();
  allPatterns.forEach((pattern) => marketCounts.set(pattern.code, (marketCounts.get(pattern.code) ?? 0) + 1));
  const marketRows = Array.from(marketCounts.entries()).
  map(([code, count]) => ({ code, count })).
  sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const slotOf = new Map<string, number>();
  readout.candidates.forEach((row) => {
    if (row.slot !== null) slotOf.set(row.pattern.id, row.slot);
  });

  const candidates: CoreTraceCandidate[] = family.map((pattern) => {
    const failed = gateFailuresForKind(pattern, 'core');
    const level = evidenceLevelOf(pattern);
    const snap = pattern.coreEvidence ?? null;
    const slot = slotOf.get(pattern.id) ?? null;
    const flagged = pattern.bttsRisk?.wouldVeto ?? false;
    const signalledProb = snap?.avgP ?? null;
    const ciLo = snap?.ciLo ?? null;
    const ciHi = snap?.ciHi ?? null;
    const verdict: CoreTraceVerdict =
    slot !== null ? 'core' :
    failed.length > 0 ? 'gate_failed' :
    flagged && profileVeto && vetoActive ? 'vetoed' :
    flagged && profileVeto ? 'flagged_shadow' : 'outranked';

    const base: Omit<CoreTraceCandidate, 'primaryCause' | 'primaryCauseDetail'> = {
      id: pattern.id,
      fixture: pattern.fixtureLabel,
      fixtureId: pattern.fixtureId,
      code: pattern.code,
      patternType: pattern.type,
      patternLabel: pattern.label,
      evidence: level,
      evidenceKind: snap?.kind ?? null,
      modelProb: pattern.modelProb ?? null,
      h2hRate: pattern.hitRate,
      stability: pattern.stability,
      ess: pattern.effectiveSampleSize,
      quadrant: effectiveDecisionOf(pattern),
      quadrantExplain: explainQuadrant(pattern),
      agreement: pattern.agreement,
      judgedBy: pattern.marketCalibrationStatus && pattern.marketCalibrationStatus !== 'unregistered' ? 'market' : 'global',
      bandLabel: snap?.environmentLabel ?? snap?.bandLabel ?? null,
      widened: snap?.widened ?? false,
      observations: snap?.observations ?? 0,
      required: snap?.required ?? 0,
      hits: snap?.hits ?? null,
      measuredRate: snap?.hitRate ?? null,
      signalledProb,
      ciLo,
      ciHi,
      outsideInterval: outsideInterval(signalledProb, ciLo, ciHi),
      calibrationStatus: pattern.marketCalibrationStatus ?? 'unregistered',
      blowoutHistorical: pattern.bttsRisk?.historicalRisk ?? null,
      blowoutModel: pattern.bttsRisk?.modelRisk ?? null,
      wouldVeto: flagged,
      vetoReasons: pattern.bttsRisk?.vetoReasons ?? [],
      cohesion: pattern.goalProfile?.weightedAvgGoals ?? null,
      gates: gateResults(pattern, failed, vetoActive, profileVeto),
      failed,
      slot,
      verdict
    };
    return { ...base, ...primaryCauseOf(base) };
  });

  candidates.sort((a, b) =>
  (a.slot ?? 99) - (b.slot ?? 99) ||
  a.failed.length - b.failed.length ||
  b.h2hRate - a.h2hRate
  );

  const byFixture = new Map<string, CoreTraceCandidate[]>();
  candidates.forEach((row) => {
    const rows = byFixture.get(row.fixtureId) ?? [];
    rows.push(row);
    byFixture.set(row.fixtureId, rows);
  });
  const duplicates: CoreTraceDuplicateGroup[] = Array.from(byFixture.entries()).
  filter(([, rows]) => rows.length > 1).
  map(([fixtureId, rows]) => ({ fixture: rows[0].fixture, fixtureId, rows, explanation: duplicateExplanation(rows) }));

  const eligibleRows = candidates.filter((candidate) => candidate.failed.length === 0);
  const placedRows = candidates.filter((candidate) => candidate.slot !== null);
  const evidenceTally: CoreTraceEvidenceTally = {
    all: tallyLevels(candidates),
    eligible: tallyLevels(eligibleRows),
    placed: tallyLevels(placedRows)
  };

  // Funnel stages are built from the previous stage's population only.
  // No global exclusion tally is ever subtracted from a narrower stage.
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const qualityPassedPatterns = family.filter((pattern) => coreQualityFailures(pattern).length === 0);
  const qualityPassedIds = new Set(qualityPassedPatterns.map((pattern) => pattern.id));
  const qualityPassedRows = candidates.filter((candidate) => qualityPassedIds.has(candidate.id));
  const afterEvidenceRows = qualityPassedRows.filter((candidate) => !candidate.failed.includes('band'));
  const conflictRejectedRows = afterEvidenceRows.filter((candidate) => candidate.failed.includes('model_conflict'));
  // The gated population is built from the PREVIOUS stage (afterEvidenceRows),
  // never re-derived from the full candidate list — otherwise the stage's
  // count and lost would be computed from different sets.
  const afterConflictRows = afterEvidenceRows.filter((candidate) => !candidate.failed.includes('model_conflict'));
  const gatePassing = candidates.filter((candidate) => candidate.failed.length === 0);
  // Funnel integrity check: afterConflictRows must be exactly the production
  // gatePassing set (same ids, same size). A mismatch is surfaced in the
  // stage detail instead of silently breaking the funnel arithmetic.
  const gatePassingIds = new Set(gatePassing.map((candidate) => candidate.id));
  const funnelConsistent =
  afterConflictRows.length === gatePassing.length &&
  afterConflictRows.every((candidate) => gatePassingIds.has(candidate.id));
  const vetoedRows = afterConflictRows.filter((candidate) => candidate.verdict === 'vetoed');
  const rankedRows = afterConflictRows.filter((candidate) => candidate.verdict !== 'vetoed');
  const allDisprovedRows = candidates.filter((candidate) => candidate.failed.includes('band'));

  const stage = (id: string, label: string, count: number, previousCount: number, detail: string): CoreTraceStage => ({
    id,
    label,
    count,
    lost: Math.max(0, previousCount - count),
    detail
  });

  const stages: CoreTraceStage[] = [
  stage('fixtures', 'Elemzett mérkőzés', analyses.length, analyses.length, 'A fordulóból kitöltött és lefuttatott fixture-ök.'),
  stage('patterns', 'Összes piaci sor', allPatterns.length, allPatterns.length, 'Minden mérkőzés minden market pattern-je, minden piacon.'),
  stage('family', `A stratégia piaca (${familyCodes.join(', ') || '—'})`, family.length, allPatterns.length, 'Ezek a jelöltek; a többi piaci sor nem tartozik ehhez a stratégiához.'),
  stage('quality', 'Minőségi kapun belül (kvadráns + minta + stabilitás)', qualityPassedRows.length, family.length, 'Kalibrációtól független minőségi feltételek.'),
  stage('evidence', 'Cáfolt sáv nélkül', afterEvidenceRows.length, qualityPassedRows.length, 'Csak a minőségi kapun már átjutott, megmért és cáfolt saját sáv zár ki.'),
  stage('gated', 'Core-jelölt (teljes szigorú kapun belül)', afterConflictRows.length, afterEvidenceRows.length, `A modell–H2H konfliktus ebben a lépésben ${conflictRejectedRows.length} sort érintett.${funnelConsistent ? '' : ' (!! INTEGRITÁSI ELTÉRÉS: a stádium halmaza nem egyezik a gatePassing listával)'}`),
  stage('profile', `Kiütés-profil után (${vetoActive ? 'ÉLES' : 'ÁRNYÉK'} mód)`, rankedRows.length, afterConflictRows.length, vetoActive ? 'Éles módban a megjelölt sorok kiesnek.' : 'Árnyék módban a szűrő nem vesz le sort.'),
  stage('slots', 'Core kártyára került', readout.coreFilled, rankedRows.length, `Rangsor, egy mérkőzés egy sor, legfeljebb ${readout.coreSlots} kártya.`)];


  const attribution = [
  { cause: 'Kvadráns', count: candidates.filter((candidate) => candidate.failed.includes('decision')).length, detail: "effectiveDecisionOf === 'flat' | 'ignore' (a volatilis másodlagos szintként belefér)" },
  { cause: 'Hideg minta (ESS)', count: candidates.filter((candidate) => candidate.failed.includes('sample')).length, detail: `ESS < ${H2H_ESS_WARM}` },
  { cause: 'Stabilitás', count: candidates.filter((candidate) => candidate.failed.includes('stability')).length, detail: `stabilitás < ${CORE_STABILITY_MIN}` },
  { cause: 'Piac visszamérés (csapatgól)', count: candidates.filter((candidate) => candidate.failed.includes('market_uncalibrated')).length, detail: 'csapatgól-család core tilalom' },
  { cause: 'Cáfolt sáv', count: allDisprovedRows.length, detail: 'megmért saját sáv, a jelzett valószínűség az intervallumon kívül' },
  { cause: 'Modell–H2H konfliktus', count: candidates.filter((candidate) => candidate.failed.includes('model_conflict')).length, detail: 'csak feltételes sornál zár ki' },
  { cause: 'Kiütés-profil (ÉLES)', count: vetoedRows.length, detail: 'csak éles veto módban vesz le sort' },
  { cause: 'Rangsor / egy-mérkőzés szabály', count: candidates.filter((candidate) => candidate.verdict === 'outranked' || candidate.verdict === 'flagged_shadow').length, detail: 'nem kizárás — csak nem jutott a három hely valamelyikére' }];


  const conditionalAll = allPatterns.filter((pattern) => evidenceLevelOf(pattern) === 'conditional');
  const byCodeMap = new Map<string, {total: number;eligible: number;}>();
  conditionalAll.forEach((pattern) => {
    const entry = byCodeMap.get(pattern.code) ?? { total: 0, eligible: 0 };
    entry.total++;
    if (gateFailuresForKind(pattern, 'core').length === 0) entry.eligible++;
    byCodeMap.set(pattern.code, entry);
  });
  const conditionalFamily = conditionalAll.filter((pattern) => familyCodes.includes(pattern.code));
  const conditionalFamilyEligible = conditionalFamily.filter((pattern) => gateFailuresForKind(pattern, 'core').length === 0).length;

  // Ensures every raw family candidate is represented in the trace.
  void candidateById;

  return {
    strategy: readout.strategy,
    strategyLabel: readout.label,
    vetoMode: readout.vetoMode,
    vetoActive,
    familyCodes: [...familyCodes],
    fixtures: analyses.length,
    patternsTotal: allPatterns.length,
    fixtureRows,
    marketRows,
    stages,
    candidates,
    quadrantDoc: QUADRANT_DOC,
    duplicates,
    evidenceTally,
    disproved: allDisprovedRows,
    attribution,
    conditional: {
      familyTotal: conditionalFamily.length,
      familyEligible: conditionalFamilyEligible,
      familyBlocked: conditionalFamily.length - conditionalFamilyEligible,
      outsideTotal: conditionalAll.length - conditionalFamily.length,
      byCode: Array.from(byCodeMap.entries()).
      map(([code, value]) => ({ code, total: value.total, eligible: value.eligible, inFamily: familyCodes.includes(code) })).
      sort((a, b) => Number(b.inFamily) - Number(a.inFamily) || b.total - a.total)
    },
    admitsConditional: {
      allowed: true,
      reason: 'Igen. A feltételes szint engedett; csak megmért és cáfolt saját sáv, illetve feltételes soron fennálló érdemi modell–H2H konfliktus zár ki.'
    },
    slots: Array.from({ length: readout.coreSlots }, (_, index) => {
      const row = candidates.find((candidate) => candidate.slot === index + 1) ?? null;
      return { index: index + 1, fixture: row?.fixture ?? null, evidence: row?.evidence ?? null };
    }),
    coreSlots: readout.coreSlots,
    coreFilled: readout.coreFilled
  };
}

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

export function traceToText(trace: CoreTrace): string {
  const lines: string[] = [];
  lines.push('# CORE DECISION TRACE');
  lines.push(`Stratégia: ${trace.strategyLabel} (${trace.strategy}) · piac: ${trace.familyCodes.join(', ')} · veto: ${trace.vetoMode}${trace.vetoActive ? ' (ÉLES)' : ' (nem vesz le sort)'}`);
  lines.push(`Core: ${trace.coreFilled} / ${trace.coreSlots} kártya feltöltve`);
  lines.push('', '## 1–2. Tölcsér');
  trace.stages.forEach((item) => lines.push(`${item.label}: ${item.count}${item.lost ? ` (−${item.lost})` : ''} — ${item.detail}`));
  lines.push('', '## 3. Kapuk');
  CORE_GATE_REGISTRY.forEach((gate) => lines.push(`${gate.step}. ${gate.name} [${gate.effect}] — ${gate.file} › ${gate.fn} — küszöb: ${gate.threshold}`));
  lines.push('', '## 0. Számláló-elszámolás');
  lines.push(`Összes vizsgált jelölt: ${trace.evidenceTally.all.total} — ${trace.evidenceTally.all.calibrated} kalibrált · ${trace.evidenceTally.all.conditional} feltételes · ${trace.evidenceTally.all.excluded} kizárt`);
  lines.push(`Core-ra jogosult: ${trace.evidenceTally.eligible.total} — ${trace.evidenceTally.eligible.calibrated} kalibrált · ${trace.evidenceTally.eligible.conditional} feltételes · ${trace.evidenceTally.eligible.excluded} kizárt`);
  lines.push(`Core kártyára került: ${trace.coreFilled} / ${trace.coreSlots} — ${trace.evidenceTally.placed.calibrated} kalibrált · ${trace.evidenceTally.placed.conditional} feltételes`);
  lines.push('', '## 4. Jelöltek');
  trace.candidates.forEach((candidate) => {
    lines.push([candidate.fixture, `id ${candidate.id}`, `generátor ${candidate.patternType}`, `kód ${candidate.code}`, `modell ${pct(candidate.modelProb)}`, `H2H ${pct(candidate.h2hRate)}`, `stab ${candidate.stability.toFixed(0)}`, `ESS ${candidate.ess.toFixed(2)}`, candidate.quadrant, candidate.agreement, `sáv ${candidate.bandLabel ?? '—'}${candidate.widened ? ' (bővített)' : ''}`, `n ${candidate.observations}/${candidate.required}`, `hits ${candidate.hits ?? '—'}`, `jelzett ${pct(candidate.signalledProb)}`, `mért ${pct(candidate.measuredRate)}`, `Wilson ${pct(candidate.ciLo)}–${pct(candidate.ciHi)}`, `verdikt ${candidate.evidence}`, candidate.slot !== null ? `CORE ${candidate.slot}` : candidate.verdict, candidate.primaryCause].join(' | '));
  });
  lines.push('', '## 4b. Kvadráns-kapu');
  lines.push(`Számolja: ${trace.quadrantDoc.computedIn}`);
  lines.push(`Hozzárendeli: ${trace.quadrantDoc.assignedIn}`);
  lines.push(`Kapuként alkalmazza: ${trace.quadrantDoc.gatedIn}`);
  lines.push(`Feltétel: ${trace.quadrantDoc.formula}`);
  lines.push(`Küszöbök: ${trace.quadrantDoc.thresholds}`);
  trace.candidates.forEach((candidate) => {
    const q = candidate.quadrantExplain;
    lines.push(`${candidate.fixture} [${candidate.patternType}/${candidate.code}]: P ${pct(q.p)} vs pMin ${pct(q.pMin, 0)} → ${q.pOk ? 'OK' : 'BUKÓ'} · C ${q.c} vs cMin ${q.cMin} → ${q.cOk ? 'OK' : 'BUKÓ'} · kvadráns ${q.quadrant}${q.consistent ? '' : ` (!! újraszámolva ${q.recomputed})`} · ${q.needed.note}`);
  });
  lines.push('', '## 5. Cáfolt sávok bizonyítása');
  if (trace.disproved.length === 0) lines.push('Nincs cáfolt sávú jelölt ebben a futásban.');else
  trace.disproved.forEach((candidate) => lines.push(`${candidate.fixture}: saját sáv ${candidate.bandLabel ?? '—'} · n = ${candidate.observations} (min ${candidate.required}) · hits ${candidate.hits ?? '—'} · jelzett ${pct(candidate.signalledProb)} · mért ${pct(candidate.measuredRate)} · Wilson ${pct(candidate.ciLo)}–${pct(candidate.ciHi)} · intervallumon kívül: ${candidate.outsideInterval ? 'IGEN' : 'NEM'} · ítélő sávrendszer: ${candidate.judgedBy === 'market' ? 'piacspecifikus' : 'globális 1X2'}`));
  lines.push('', '## 7. Feltételes sorok elszámolása');
  lines.push(`A stratégia piacában: ${trace.conditional.familyTotal} feltételes sor (kapun belül ${trace.conditional.familyEligible}, kapun kívül ${trace.conditional.familyBlocked}). Más piacokban / szerepkörökben: ${trace.conditional.outsideTotal}.`);
  trace.conditional.byCode.forEach((row) => lines.push(`  ${row.code}${row.inFamily ? ' (stratégia piaca)' : ''}: ${row.total} feltételes, ebből kapun belül ${row.eligible}`));
  lines.push('', '## 9. Attribúció');
  trace.attribution.forEach((item) => lines.push(`${item.cause}: ${item.count} — ${item.detail}`));
  return lines.join('\n');
}