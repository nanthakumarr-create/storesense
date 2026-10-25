import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { Application, EngineOutput, ParseResult, Result } from '../types';
import { parseLakh, parseNumberCell, parsePin, parseWorkbook } from './parse';
import { runAll } from './index';
import { buildCtx, readArrayBuffer, SAMPLE } from './testUtil';

const ctx = buildCtx();
const sampleBuf = readArrayBuffer(SAMPLE);
const parsed: ParseResult = parseWorkbook(sampleBuf, 'StoreSense_Applicants_200.xlsx');
const out: EngineOutput = runAll(parsed, ctx);
const byId = (id: string): Result => {
  const r = out.results.find((x) => x.uid === id);
  if (!r) throw new Error(`no result ${id}`);
  return r;
};
const APPROVED = new Set(['Approve', 'Approve with conditions']);
const STORE_PINS = new Set(parsed.stores.map((s) => s.pin));

function toBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const u8 = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return u8;
}

/** Same as AppState.updateApplication: patch + an `updates` log entry per field. */
function applyUpdate(p: ParseResult, uid: string, patch: Partial<Application>, source: string): ParseResult {
  return {
    ...p,
    applications: p.applications.map((a) => {
      if (a.uid !== uid) return a;
      const log = Object.entries(patch).map(([field, to]) => ({ field, from: a[field as keyof Application], to, at: '2026-10-25T10:00:00.000Z', source }));
      return { ...a, ...patch, updates: [...(a.updates ?? []), ...log] };
    }),
  };
}

describe('value parsing', () => {
  it('reads messy numbers', () => {
    expect(parseLakh('30 lakh').value).toBe(30);
    expect(parseLakh('₹25L').value).toBe(25);
    expect(parseLakh('25,00,000').value).toBe(25);
    expect(parseLakh('2.5 cr').value).toBe(250);
    expect(parseLakh(42).value).toBe(42);
    expect(parseLakh(42).fromText).toBe(false);
    expect(parseNumberCell('5 yrs').value).toBe(5);
    expect(parseNumberCell('five').value).toBe(5);
    expect(parseNumberCell('').value).toBeNull();
  });
  it('normalises pins', () => {
    expect(parsePin('560 037')).toBe('560037');
    expect(parsePin(' 560103 ')).toBe('560103');
    expect(parsePin(560034)).toBe('560034');
    expect(parsePin(56003)).toBeNull();
    expect(parsePin('abc')).toBeNull();
  });
});

describe('parser on the sample file', () => {
  it('drops only the untouched example row and keeps row-4 APP-001', () => {
    expect(parsed.source.exampleRowDropped).toBe(true);
    expect(parsed.applications.length).toBe(200);
    const first = parsed.applications.find((a) => a.uid === 'APP-001')!;
    expect(first.rowNumber).toBe(4);
    expect(first.name).toBe('Basavaraj Patil');
    expect(parsed.applications.some((a) => a.name === 'Ravi Kumar' && a.pin === '570001')).toBe(false);
  });
  it('skips the blank row and handles the duplicate ID', () => {
    expect(parsed.source.blankRowsSkipped).toBe(1);
    const dup = parsed.applications.find((a) => a.uid.startsWith('APP-199#row'))!;
    expect(dup).toBeTruthy();
    expect(dup.id).toBe('APP-199');
    expect(dup.flags.some((f) => f.code === 'DUPLICATE_ID')).toBe(true);
    expect(new Set(parsed.applications.map((a) => a.uid)).size).toBe(parsed.applications.length);
  });
  it('cleans pins, money, experience and language', () => {
    const a = (uid: string) => parsed.applications.find((x) => x.uid === uid)!;
    expect(a('APP-077').pin).toBe('560037');
    expect(a('APP-158').pin).toBe('560103');
    expect(a('APP-028').investmentLakh).toBe(30);
    expect(a('APP-028').flags.some((f) => f.code === 'INVESTMENT_PARSED_FROM_TEXT')).toBe(true);
    expect(a('APP-116').investmentLakh).toBe(25);
    expect(a('APP-137').experienceYears).toBe(5);
    expect(a('APP-137').flags.some((f) => f.code === 'EXPERIENCE_PARSED_FROM_TEXT')).toBe(true);
    expect(a('APP-052').preferredLanguage).toBeNull();
    expect(a('APP-052').flags.some((f) => f.code === 'LANGUAGE_NOT_SUPPORTED')).toBe(true);
    expect(a('APP-175').preferredLanguage).toBe('Kannada');
    expect(a('APP-175').flags.some((f) => f.code === 'LANGUAGE_MULTIPLE')).toBe(true);
    expect(a('APP-013').flags.some((f) => f.code === 'PIN_NOT_IN_CITY')).toBe(true);
    expect(a('APP-007').flags.some((f) => f.code === 'SPACE_SIZE_MISSING')).toBe(true);
    expect(a('APP-019').flags.some((f) => f.code === 'SPACE_SIZE_WITHOUT_SPACE')).toBe(true);
    expect(a('APP-056').flags.some((f) => f.code === 'NOTES_CONTRADICT_SPACE')).toBe(true);
    expect(a('APP-147').flags.some((f) => f.code === 'NOTES_CONTRADICT_FLOOR')).toBe(true);
  });
  it('reads territories and stores', () => {
    expect(parsed.territories.length).toBe(15);
    expect(parsed.territories.find((t) => t.id === 'TER-01')!.city).toBe('Bengaluru');
    expect(parsed.territories.find((t) => t.id === 'TER-15')!.openSlots).toBe(0);
    expect(parsed.territories.find((t) => t.id === 'TER-02')!.pins).toContain('560100');
    expect(parsed.stores.length).toBe(10);
    expect(parsed.source.storesFromFile).toBe(true);
  });
  it('works without the Existing stores sheet', () => {
    const wb = XLSX.read(sampleBuf, { type: 'array' });
    delete wb.Sheets['Existing stores'];
    wb.SheetNames = wb.SheetNames.filter((n) => n !== 'Existing stores');
    const p = parseWorkbook(toBuffer(wb), 'no-stores.xlsx');
    expect(p.source.storesFromFile).toBe(false);
    expect(p.stores.map((s) => s.id)).toEqual(['ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05', 'ST-06', 'ST-07', 'ST-08', 'ST-09', 'ST-10']);
    const o = runAll(p, ctx);
    expect(o.results.length).toBe(200);
    expect(o.summary.pinConflicts).toBe(0);
    expect(o.hash).toBe(out.hash);
  });
  it('finds the header anywhere in the first rows and maps columns by name', () => {
    const header = ['Notes from applicant', 'Pin code', 'Application ID', 'City', 'Applicant name', 'Investment capacity (₹ lakh)', 'Retail experience (years)', 'Space available', 'Space size (sq ft)', 'Floor', 'Preferred language', 'Target launch (months)', 'State', 'Current / past business'];
    const rows = [
      header,
      ['Run it myself', '560037', 'APP-900', 'Bangalore', 'Test One', '45 lakh', 'six', 'Owned', 500, 'ground floor', 'kannada', 3, 'Karnataka', 'Optical shop'],
    ];
    const terr = [['Territory ID', 'City', 'State', 'Pin codes covered', 'City tier', 'Open slots', 'Priority'], ['TER-90', 'Bengaluru', 'Karnataka', '560037,560103', '', '', '']];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(terr), 'Zones');
    const p = parseWorkbook(toBuffer(wb), 'custom.xlsx');
    const a = p.applications[0];
    expect(a.uid).toBe('APP-900');
    expect(a.city).toBe('Bengaluru');
    expect(a.investmentLakh).toBe(45);
    expect(a.experienceYears).toBe(6);
    expect(a.floor).toBe('Ground');
    expect(a.preferredLanguage).toBe('Kannada');
    const t = p.territories[0];
    expect(t.tier).toBe('Tier 1');
    expect(t.priority).toBe('Medium');
    expect(t.openSlots).toBe(0);
    expect(t.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['TERRITORY_TIER_DEFAULT', 'TERRITORY_SLOTS_DEFAULT', 'TERRITORY_PRIORITY_DEFAULT']));
    expect(p.source.storesFromFile).toBe(false);
  });
  it('throws a clear error for a file without an Applications sheet', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['hello', 'world']]), 'Sheet1');
    expect(() => parseWorkbook(toBuffer(wb), 'bad.xlsx')).toThrow(/No Applications sheet/);
  });
});

describe('engine on the sample file', () => {
  it('gives every application a decision, a headline and reasons', () => {
    expect(out.results.length).toBe(parsed.applications.length);
    for (const r of out.results) {
      expect(r.decision).toBeTruthy();
      expect(r.headline.length).toBeGreaterThan(10);
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.nextSteps.length).toBeGreaterThan(0);
      expect(r.reasonCodes.length).toBeGreaterThan(0);
    }
    const total = Object.values(out.summary.byDecision).reduce((s, n) => s + n, 0);
    expect(total).toBe(out.results.length);
  });
  it('never puts two stores in one pin (existing stores included)', () => {
    expect(out.summary.pinConflicts).toBe(0);
    // One store per approved unit: a solo partner at their pin, an allocated pair once at the pair's site.
    const pins: string[] = [...STORE_PINS];
    const pairsSeen = new Set<string>();
    for (const r of out.results) {
      if (APPROVED.has(r.decision)) {
        if (r.partnership?.status === 'allocated') {
          if (pairsSeen.has(r.partnership.id)) continue;
          pairsSeen.add(r.partnership.id);
          pins.push(out.partnerships.find((p) => p.id === r.partnership!.id)!.pin);
        } else pins.push(r.pin!);
      }
      if (r.decision === 'Redirect') pins.push(r.redirect!.pin);
    }
    expect(new Set(pins).size).toBe(pins.length);
  });
  it('respects open slots per territory', () => {
    for (const t of out.territories) expect(t.filled.length).toBeLessThanOrEqual(t.openSlots);
    expect(out.summary.slotsFilled).toBeLessThanOrEqual(out.summary.slotsTotal);
  });
  it('is deterministic', () => {
    const again = runAll(parseWorkbook(readArrayBuffer(SAMPLE), 'StoreSense_Applicants_200.xlsx'), buildCtx());
    expect(again.hash).toBe(out.hash);
    expect(JSON.stringify(again)).toBe(JSON.stringify(out));
  });
  it('holds APP-007 (Owned, size blank) and asks for the size', () => {
    const r = byId('APP-007');
    expect(r.decision).toBe('Hold');
    expect(r.asks.join(' ').toLowerCase()).toContain('send the shop size in sq ft');
  });
  it('holds APP-013 (Mysuru with a Bengaluru pin) and suggests the city', () => {
    const r = byId('APP-013');
    expect(r.decision).toBe('Hold');
    expect(r.asks.join(' ')).toContain('Bengaluru');
  });
  it('never approves anyone at an existing store pin', () => {
    for (const id of ['APP-023', 'APP-091', 'APP-128', 'APP-166', 'APP-184']) {
      const r = byId(id);
      expect(STORE_PINS.has(r.pin!)).toBe(true);
      expect(APPROVED.has(r.decision)).toBe(false);
      if (r.decision === 'Redirect') expect(STORE_PINS.has(r.redirect!.pin)).toBe(false);
    }
    // The store site is the pair's site for allocated pairs (a member's own pin may be a store pin, e.g. APP-131 at 575001).
    for (const r of out.results) {
      if (!APPROVED.has(r.decision)) continue;
      const site = r.partnership?.status === 'allocated' ? out.partnerships.find((p) => p.id === r.partnership!.id)!.pin : r.pin!;
      expect(STORE_PINS.has(site)).toBe(false);
    }
  });
  it('resolves the Tumakuru 572101 clash with at most one approval', () => {
    const both = [byId('APP-099'), byId('APP-150')];
    expect(both.filter((r) => APPROVED.has(r.decision)).length).toBeLessThanOrEqual(1);
    const loser = both.find((r) => !APPROVED.has(r.decision))!;
    expect(loser.reasons.length).toBeGreaterThan(0);
  });
  it('resolves the 560037 clash: one approved, the other redirected or waitlisted with a reason', () => {
    const rs = out.results.filter((r) => r.pin === '560037');
    expect(rs.filter((r) => APPROVED.has(r.decision)).length).toBeLessThanOrEqual(1);
    const a45 = byId('APP-045');
    expect(['Redirect', 'Waitlist']).toContain(a45.decision);
    expect(a45.headline).toMatch(/560037/);
  });
  it('does not approve the TER-15 (0 slots) applicant', () => {
    const r = byId('APP-070');
    expect(r.territoryId).toBe('TER-15');
    expect(APPROVED.has(r.decision)).toBe(false);
  });
  it('fails payback for at least one upper-floor applicant', () => {
    const upper = out.results.filter((r) => r.reasonCodes.includes('PAYBACK_FAIL') && r.economics.floorFactor === 0.8);
    expect(upper.length).toBeGreaterThan(0);
    for (const r of upper) expect(r.economics.paybackPass).toBe(false);
  });
  it('flags the impossible Diwali opening', () => {
    const r = byId('APP-081');
    expect(r.conditions.some((c) => c.code === 'FESTIVAL_CONFLICT') || r.reasonCodes.includes('TOO_MANY_CONDITIONS')).toBe(true);
    const withDiwali = out.results.filter((x) => x.conditions.some((c) => c.code === 'FESTIVAL_CONFLICT'));
    expect(withDiwali.length).toBeGreaterThan(0);
    expect(withDiwali[0].conditions.find((c) => c.code === 'FESTIVAL_CONFLICT')!.text).toMatch(/Jan 2027/);
  });
  it('declines 0-year applicants who miss the 0-year route', () => {
    expect(APPROVED.has(byId('APP-015').decision)).toBe(false);
    // APP-160 fails the 0-year route alone; it may only be approved as the investor of an allocated pair
    const a160 = byId('APP-160');
    if (APPROVED.has(a160.decision)) expect(a160.partnership).toMatchObject({ role: 'investor', status: 'allocated' });
    for (const r of out.results) {
      if (APPROVED.has(r.decision) && r.partnerBreakdown[0].score === 0 && r.partnership?.status !== 'allocated')
        expect(r.conditions.some((c) => c.code === 'ZERO_EXPERIENCE')).toBe(true);
    }
  });
  it('gives launch plans only to approved partners, with ADKAR and dated steps', () => {
    for (const r of out.results) {
      if (APPROVED.has(r.decision)) {
        expect(r.launchPlan).not.toBeNull();
        expect(r.launchPlan!.adkar.length).toBe(5);
        expect(r.launchPlan!.steps.length).toBeGreaterThan(5);
        expect(r.launchPlan!.startDate).toBe('2026-10-25');
        expect(r.launchPlan!.steps.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.dueDate))).toBe(true);
      } else expect(r.launchPlan).toBeNull();
    }
  });
  it('approves with conditions only when 1-2 conditions remain', () => {
    for (const r of out.results) {
      if (r.decision === 'Approve') expect(r.conditions.length).toBe(0);
      if (r.decision === 'Approve with conditions') expect(r.conditions.length).toBeGreaterThanOrEqual(1);
      if (r.decision === 'Approve with conditions') expect(r.conditions.length).toBeLessThanOrEqual(2);
    }
  });
  it('gives every Hold exact asks', () => {
    for (const r of out.results.filter((x) => x.decision === 'Hold')) expect(r.asks.length).toBeGreaterThan(0);
  });
  it('lists gaps and territory reasons', () => {
    expect(out.gaps.length).toBeGreaterThan(5);
    for (const g of out.gaps) expect(STORE_PINS.has(g.pin)).toBe(false);
    expect(out.gaps.some((g) => g.territoryId === null && g.applicants > 0)).toBe(true);
    for (const t of out.territories) expect(t.reason.length).toBeGreaterThan(10);
  });
});

describe('chat update: APP-012 found a ground-floor space', () => {
  const before = byId('APP-012');
  const next = applyUpdate(parsed, 'APP-012', { spaceAvailable: 'Rented', floor: 'Ground' }, 'APP-012 has now found a ground-floor space');
  const after = runAll(next, ctx).results.find((r) => r.uid === 'APP-012')!;

  it('starts without a site', () => {
    expect(parsed.applications.find((a) => a.uid === 'APP-012')!.spaceAvailable).toBe('Not yet identified');
    expect(['Waitlist', 'Approve with conditions']).toContain(before.decision);
    if (before.decision === 'Approve with conditions') expect(before.conditions.some((c) => c.code === 'NO_SITE')).toBe(true);
  });
  it('moves forward instead of going on Hold', () => {
    expect(after.decision).not.toBe('Hold');
    expect(APPROVED.has(after.decision)).toBe(true);
    expect(after.conditions.some((c) => c.code === 'NO_SITE')).toBe(false);
    expect(after.conditions.some((c) => c.code === 'CONFIRM_LEASE')).toBe(true);
    expect(after.combinedScore).toBeGreaterThan(before.combinedScore);
    const rankBefore = ['Decline', 'Hold', 'Waitlist', 'Redirect', 'Approve with conditions', 'Approve'];
    expect(rankBefore.indexOf(after.decision)).toBeGreaterThanOrEqual(rankBefore.indexOf(before.decision));
  });
  it('explains the change', () => {
    expect(after.reasonCodes).toContain('UPDATED_FROM_CHAT');
    expect(after.reasons[0]).toMatch(/Updated from chat/);
    expect(after.reasons[0]).toMatch(/400 sq ft/);
    expect(after.launchPlan).not.toBeNull();
  });
  it('keeps every rule intact after the re-run', () => {
    const o = runAll(next, ctx);
    expect(o.summary.pinConflicts).toBe(0);
    for (const t of o.territories) expect(t.filled.length).toBeLessThanOrEqual(t.openSlots);
  });
  it('sending the size for APP-007 lifts the Hold', () => {
    const p = applyUpdate(parsed, 'APP-007', { spaceSizeSqft: 500 }, 'APP-007 shop is 500 sq ft');
    const r = runAll(p, ctx).results.find((x) => x.uid === 'APP-007')!;
    expect(r.decision).not.toBe('Hold');
    expect(r.flags.some((f) => f.code === 'SPACE_SIZE_MISSING')).toBe(false);
  });
});
