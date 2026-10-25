// Shared contract between the parser, the engine, the chat and the UI.
// Every module imports its types from here; change this file only with care.

export type Tier = 'Tier 1' | 'Tier 2' | 'Tier 3';
export type Priority = 'High' | 'Medium' | 'Low';
export type SpaceAvailable = 'Owned' | 'Rented' | 'Not yet identified';
export type Floor = 'Ground' | 'Upper' | 'Mall unit' | 'Not known';
export type Language = 'Kannada' | 'English' | 'Hindi';
export type City = 'Bengaluru' | 'Mysuru' | 'Mangaluru' | 'Hubballi-Dharwad' | 'Belagavi' | 'Tumakuru' | 'Davanagere';

export type Decision = 'Approve' | 'Approve with conditions' | 'Redirect' | 'Waitlist' | 'Hold' | 'Decline';
export const DECISIONS: Decision[] = ['Approve', 'Approve with conditions', 'Redirect', 'Waitlist', 'Hold', 'Decline'];

/** A data-quality or rule flag attached to an application or territory. */
export interface DataFlag {
  code: string; // e.g. PIN_NOT_IN_CITY, SPACE_SIZE_MISSING, INVESTMENT_PARSED_FROM_TEXT
  severity: 'block' | 'ask' | 'info';
  message: string; // plain-language sentence
  field?: keyof Application;
}

/** One applicant row after parsing and cleaning. Raw text is kept so explanations can quote it. */
export interface Application {
  uid: string; // unique key: Application ID, or "APP-199#row203" when the ID is duplicated
  rowNumber: number; // Excel row number (1-based, as the user sees it)
  id: string; // Application ID as typed
  name: string;
  city: City | string; // string when the value is not in the allowed list
  state: string;
  pin: string | null; // normalised 6-digit pin, null if unreadable
  pinRaw: string;
  investmentLakh: number | null;
  experienceYears: number | null;
  currentBusiness: string;
  spaceAvailable: SpaceAvailable | null;
  spaceSizeSqft: number | null;
  floor: Floor | null;
  targetLaunchMonths: number | null;
  preferredLanguage: Language | null;
  languageRaw: string;
  notes: string;
  flags: DataFlag[];
  /** Fields changed after upload (chat updates), with the time of change. */
  updates?: { field: string; from: unknown; to: unknown; at: string; source: string }[];
}

export interface Territory {
  id: string;
  city: City | string;
  state: string;
  pins: string[];
  tier: Tier;
  openSlots: number;
  priority: Priority;
  rowNumber: number;
  flags: DataFlag[];
}

export interface ExistingStore {
  id: string;
  city: City;
  pin: string;
  opened: number;
}

export interface ParseResult {
  applications: Application[];
  territories: Territory[];
  stores: ExistingStore[];
  warnings: string[]; // file-level warnings (missing sheet, blank rows skipped, example row dropped...)
  source: { fileName: string; sheetNames: string[]; exampleRowDropped: boolean; blankRowsSkipped: number; storesFromFile: boolean };
}

/** Pin reference data (src/data/ka-pins.json). */
export interface PinInfo {
  pin: string;
  city: City;
  tier: Tier;
  name: string;
  division: string;
  lat: number;
  lng: number;
  areaKm2: number;
  distanceFromCentreKm: number;
  zone: 'core' | 'inner' | 'outer';
}

/** Per-pin demand from the simulated order data (Bengaluru) or the proxy (other cities). */
export interface PinDemand {
  pin: string;
  name: string;
  zone: string;
  lat: number;
  lng: number;
  customers: number;
  orders: number;
  online_orders: number;
  store_orders: number;
  online_share: number;
  revenue_inr: number;
  orders_last_12m: number;
  demand_index: number; // 0-100
  nearest_store_id: string;
  nearest_store_km: number;
}

export interface StoreCatchment {
  store_id: string;
  pin: string;
  area: string;
  lat: number;
  lng: number;
  opened: number;
  store_orders: number;
  walkin_orders: number;
  pickup_orders: number;
  revenue_inr: number;
  avg_customer_km: number;
  p80_customer_km: number;
  max_customer_km: number;
  pins_served: number;
  top_source_pins: { pin: string; name: string; orders: number }[];
}

export interface ScoreItem {
  label: string;
  weight: number; // 0-1
  score: number; // 0-100
  note: string; // why this score, in plain words
}

export interface Condition {
  code: string;
  text: string;
  deadlineDays: number;
  owner: string; // e.g. "Partner", "Expansion manager", "Training team"
}

export interface Economics {
  tier: Tier;
  requiredInvestmentLakh: number;
  bufferLakh: number; // 3 x monthly fixed cost
  totalCashNeedLakh: number;
  floorFactor: number;
  monthlySalesLakh: number;
  monthlyFixedCostLakh: number;
  monthlyProfitLakh: number;
  paybackMonths: number | null; // null when profit <= 0
  paybackPass: boolean;
  capitalGapLakh: number; // max(0, need - capacity)
  capitalGapPct: number; // 0-1
}

export interface PlaceInfo {
  pin: string | null;
  pinName: string;
  territoryId: string | null;
  territoryPriority: Priority | null;
  nearestStore: { id: string; pin: string; area: string; km: number } | null;
  overlapRadiusKm: number;
  insideOverlapRadius: boolean;
  samePinAsStore: string | null; // store ID or approved APP ID holding the same pin
  demandIndex: number; // 0-100
  demandSource: 'orders' | 'proxy';
  unservedNorm: number; // 0-100
  placeScore: number; // 0-100
  locationApproximate: boolean;
}

export interface LaunchStep {
  phase: string; // e.g. "Week 1-2 · Paperwork"
  dayFrom: number;
  dayTo: number;
  task: string;
  owner: string;
  dueDate: string; // ISO date
}

export type AdkarStage = 'Awareness' | 'Desire' | 'Knowledge' | 'Ability' | 'Reinforcement';

export interface LaunchPlan {
  totalDays: number;
  startDate: string;
  targetOpenDate: string;
  trainingLanguage: Language;
  adkar: { stage: AdkarStage; score: number; note: string }[]; // weakest first
  weakestStage: AdkarStage;
  steps: LaunchStep[];
  training: string[]; // personalised preparation items
  shadowStore: { id: string; area: string; km: number } | null;
  festivalNote: string | null;
}

export interface Redirect {
  pin: string;
  pinName: string;
  territoryId: string;
  km: number; // from the applicant's original pin
  demandIndex: number;
  paybackMonths: number | null;
}

/**
 * Two applicants in the same territory who cover each other's gap: an OPERATOR (retail experience, short of money)
 * and an INVESTOR (money, little or no experience). The operator runs the store day to day; the investor funds it.
 */
export interface Partnership {
  id: string; // e.g. "PAIR-APP-038+APP-015"
  operatorUid: string;
  operatorAppId: string;
  operatorName: string;
  investorUid: string;
  investorAppId: string;
  investorName: string;
  territoryId: string | null;
  pin: string; // where the joint store would open (the operator's or investor's site, whichever is better)
  pinName: string;
  combinedInvestmentLakh: number;
  totalCashNeedLakh: number;
  partnerScore: number; // joint partner score
  breakdown: ScoreItem[]; // joint breakdown (experience/relevance from operator, capital from both, ...)
  placeScore: number;
  paybackMonths: number | null;
  combinedScore: number;
  rankInTerritory: number | null; // where the pair would rank among the territory's contenders
  covers: string[]; // plain sentences: what each one brings and which gap it closes
  status: 'allocated' | 'suggested'; // allocated = the pair won a slot and both are approved as a pair
  outcome: string; // one plain sentence for the operator
}

export interface Result {
  uid: string;
  /** Set when this applicant is part of a suggested or allocated partnership. */
  partnership: { id: string; role: 'operator' | 'investor'; withUid: string; withAppId: string; withName: string; status: Partnership['status'] } | null;
  appId: string;
  name: string;
  city: string;
  pin: string | null;
  decision: Decision;
  headline: string; // one sentence: what happens and the main reason
  reasons: string[]; // "why", each with numbers
  reasonCodes: string[]; // machine codes, e.g. SAME_PIN_EXISTING_STORE, PAYBACK_FAIL
  nextSteps: string[]; // what the partner does next (dated where possible)
  preparation: string[]; // how they will be prepared to run the store
  whatWouldChange: string[]; // what would change this decision
  asks: string[]; // exact information to request (Hold / missing data)
  conditions: Condition[];
  partnerScore: number;
  partnerBreakdown: ScoreItem[];
  place: PlaceInfo;
  economics: Economics;
  readiness: number; // 0-100
  combinedScore: number;
  territoryId: string | null;
  rankInTerritory: number | null;
  redirect: Redirect | null;
  launchPlan: LaunchPlan | null; // Approve / Approve with conditions only
  flags: DataFlag[];
}

export interface TerritoryStatus {
  id: string;
  city: string;
  tier: Tier;
  priority: Priority;
  openSlots: number;
  filled: { uid: string; appId: string; name: string; pin: string; decision: Decision; combinedScore: number }[];
  contenders: { uid: string; appId: string; name: string; decision: Decision; combinedScore: number; note: string }[];
  reason: string; // plain words: why the slots went the way they did
  suggestRaisePriority: boolean;
}

export interface GapPin {
  pin: string;
  name: string;
  city: string;
  territoryId: string | null;
  demandIndex: number;
  onlineOrders: number | null;
  nearestStoreKm: number;
  applicants: number;
  note: string;
}

export interface EngineSummary {
  total: number;
  byDecision: Record<Decision, number>;
  slotsTotal: number;
  slotsFilled: number;
  pinConflicts: number; // must always be 0
  dataIssues: number;
}

export interface EngineOutput {
  results: Result[];
  territories: TerritoryStatus[];
  gaps: GapPin[];
  partnerships: Partnership[];
  summary: EngineSummary;
  asOf: string; // AS_OF_DATE used for every date calculation
  hash: string; // deterministic fingerprint of the decisions
}

/** Reference data the engine needs besides the uploaded file. */
export interface EngineContext {
  pins: PinInfo[];
  demand: Record<string, PinDemand>; // keyed by pin
  catchment: StoreCatchment[];
}

/** Diff shown after a chat update re-runs the engine. */
export interface DecisionChange {
  uid: string;
  appId: string;
  name: string;
  before: Decision;
  after: Decision;
  why: string;
}
