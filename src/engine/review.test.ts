// Adversarial review: regressions for defects found in the engine, invariants on the sample file, and robustness cases.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { Application, EngineOutput, ParseResult, Result } from '../types';
import { parseWorkbook } from './parse';
import { runAll } from './index';
import { buildCtx, readArrayBuffer, SAMPLE } from './testUtil';

const ctx = buildCtx();
const parsed: ParseResult = parseWorkbook(readArrayBuffer(SAMPLE), 'StoreSense_Applicants_200.xlsx');
const out: EngineOutput = runAll(parsed, ctx);
const byId = (id: string): Result => {
  const r = out.results.find((x) => x.uid === id);
  if (!r) throw new Error(`no result ${id}`);
  return r;
};
const APPROVED = new Set(['Approve', 'Approve with conditions']);
const STORE_PINS = new Set(parsed.stores.map((s) => s.pin));

const APP_HEADER = ['Application ID', 'Applicant name', 'City', 'State', 'Pin code', 'Investment capacity (₹ lakh)', 'Retail experience (years)', 'Current / past business', 'Space available', 'Space size (sq ft)', 'Floor', 'Target launch (months)', 'Preferred language', 'Notes from applicant'];
const TERR_HEADER = ['Territory ID', 'City', 'State', 'Pin codes covered', 'City tier', 'Open slots', 'Priority'];

function book(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

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

describe('sample file invariants', () => {
  const terr = new Map(parsed.territories.map((t) => [t.id, t]));

  it('redirect targets are free pins in a territory, off store pins, paying back, never shared', () => {
    const approvedPins = new Set(out.results.filter((r) => APPROVED.has(r.decision)).map((r) => r.pin));
    const seen = new Set<string>();
    for (const r of out.results.filter((x) => x.decision === 'Redirect')) {
      const d = r.redirect!;
      expect(STORE_PINS.has(d.pin)).toBe(false);
      expect(approvedPins.has(d.pin)).toBe(false);
      expect(seen.has(d.pin)).toBe(false);
      seen.add(d.pin);
      expect(terr.get(d.territoryId)!.pins).toContain(d.pin);
      expect(d.paybackMonths).not.toBeNull();
      expect(d.paybackMonths!).toBeLessThanOrEqual(30);
      expect(d.pin).not.toBe(r.pin);
    }
  });

  it('approvals never contradict their own numbers', () => {
    // Allocated pairs are judged on the joint numbers (members' own "on their own" context lines are expected)
    for (const p of out.partnerships.filter((x) => x.status === 'allocated')) {
      expect(p.paybackMonths).not.toBeNull();
      expect(p.paybackMonths!).toBeLessThanOrEqual(30);
      expect(p.combinedInvestmentLakh).toBeGreaterThanOrEqual(p.totalCashNeedLakh);
      expect(STORE_PINS.has(p.pin)).toBe(false);
    }
    for (const r of out.results.filter((x) => APPROVED.has(x.decision) && x.partnership?.status !== 'allocated')) {
      expect(r.economics.paybackPass).toBe(true);
      expect(r.reasons.join(' ')).not.toMatch(/over the 30-month target|below the 55 bar|Over 30% short/);
      expect(r.economics.capitalGapPct).toBeLessThanOrEqual(0.3);
      expect(r.place.samePinAsStore).toBeNull();
    }
    for (const r of out.results.filter((x) => x.decision === 'Decline')) expect(r.headline).toMatch(/^Decline/);
  });

  it('counts approvals, redirects-in and held slots per territory within open slots', () => {
    for (const t of parsed.territories) {
      // Count slot-using units: an allocated pair uses one slot for two people
      const used = new Set(
        out.results
          .filter(
            (r) =>
              (APPROVED.has(r.decision) && (r.partnership?.status === 'allocated' ? out.partnerships.find((p) => p.id === r.partnership!.id)!.territoryId : r.territoryId) === t.id) ||
              (r.decision === 'Redirect' && r.redirect!.territoryId === t.id) ||
              (r.decision === 'Hold' && r.reasonCodes.includes('SLOT_HELD') && r.territoryId === t.id),
          )
          .map((r) => (r.partnership?.status === 'allocated' && APPROVED.has(r.decision) ? r.partnership.id : r.uid)),
      );
      expect(used.size).toBeLessThanOrEqual(t.openSlots);
    }
  });

  it('ranks only the applicants who competed for a slot', () => {
    for (const r of out.results.filter((x) => APPROVED.has(x.decision))) {
      expect(r.rankInTerritory).not.toBeNull();
      expect(r.reasons.find((s) => s.startsWith('Won a slot'))).toMatch(new RegExp(`ranked ${r.rankInTerritory} `));
    }
    for (const r of out.results.filter((x) => x.decision === 'Decline')) expect(r.rankInTerritory).toBeNull();
    // was "ranked 4" for a 2-slot territory because declined applicants with higher scores were counted
    expect(byId('APP-063').rankInTerritory).toBe(2);
  });

  it('a P5 Hold shows the as-typed numbers and names both readings honestly', () => {
    const r = byId('APP-158');
    expect(r.decision).toBe('Hold');
    expect(r.reasons.join(' ')).not.toMatch(/best case|worst case/);
    expect(r.reasons.join(' ')).toMatch(/if still searching, Approve with conditions/);
    expect(r.economics.floorFactor).toBe(0.8); // Upper floor as typed
    expect(byId('APP-007').reasons.find((s) => s.startsWith('Money'))).not.toMatch(/no site yet/);
  });

  it('explains exactly why no redirect was offered', () => {
    for (const r of out.results.filter((x) => x.reasonCodes.includes('NO_FREE_PIN_NEARBY'))) expect(r.reasons.join(' ')).toMatch(/no redirect was offered/);
    // TER-10's slot now goes to a pair, so APP-184 (on store pin 580020) finds every workable territory full
    expect(byId('APP-184').headline).toMatch(/already has store ST-09/);
    expect(byId('APP-184').headline).toMatch(/workable pin are full|would carry/);
    expect(byId('APP-166').headline).toMatch(/territories with a workable pin are full/);
  });

  it('gives real queue positions on 0-slot waitlists', () => {
    const zero = out.results.filter((r) => r.reasonCodes.includes('ZERO_SLOTS'));
    expect(zero.length).toBeGreaterThan(0);
    expect(zero.filter((r) => /1st in line/.test(r.headline)).length).toBe(1);
    expect(zero.every((r) => !/first in line/.test(r.headline))).toBe(true);
  });

  it('warns on a P1 Hold that the other checks already point to a Decline', () => {
    expect(byId('APP-013').whatWouldChange.join(' ')).toMatch(/point to a Decline/);
  });

  it('describes redirects in the territory reason correctly', () => {
    const t9 = out.territories.find((t) => t.id === 'TER-09')!;
    expect(t9.reason).not.toMatch(/moved to .* after a pin clash\) won/);
    // TER-09's slot goes to a pair whose site (575004) is a free pin, not the store pin 575001
    expect(t9.reason).toMatch(/as a pair/);
  });

  it('a chat "still searching" update drops the stale size and lifts the APP-158 Hold', () => {
    const p = applyUpdate(parsed, 'APP-158', { spaceAvailable: 'Not yet identified' }, 'APP-158 is still searching');
    const r = runAll(p, ctx).results.find((x) => x.uid === 'APP-158')!;
    expect(r.flags.some((f) => f.code === 'SPACE_SIZE_WITHOUT_SPACE')).toBe(false);
    expect(r.decision).not.toBe('Hold');
  });

  it('produces a sensible spread for 200 applicants vs 21 slots', () => {
    const b = out.summary.byDecision;
    const held = out.results.filter((r) => r.reasonCodes.includes('SLOT_HELD')).length;
    const allocatedPairs = out.partnerships.filter((p) => p.status === 'allocated').length;
    // each allocated pair is two approved people in one slot
    expect(b.Approve + b['Approve with conditions'] - allocatedPairs + b.Redirect + held).toBe(out.summary.slotsFilled);
    expect(b.Waitlist).toBeGreaterThan(20);
    expect(b.Decline).toBeLessThan(out.results.length * 0.6);
    expect(b.Hold).toBeLessThan(20);
  });
});

describe('robustness', () => {
  it('reads a judge file with only Applications + Territories, shuffled columns, a blank column and blank optionals', () => {
    const header = ['Pin code', '', 'Applicant name', 'Application ID', 'City', 'State', 'Retail experience (years)', 'Investment capacity (₹ lakh)', 'Space available', 'Space size (sq ft)', 'Floor', 'Target launch (months)', 'Preferred language', 'Notes from applicant', 'Current / past business'];
    const apps = [
      ['Applications - one row per record', null],
      header,
      [560037, null, 'All Blank Optionals', 'APP-501', 'Bengaluru', 'Karnataka', 6, 50, 'Not yet identified', null, null, null, null, null, null],
      [572101, null, 'Tumkur Person', 'APP-502', 'Tumakuru', 'Karnataka', 5, 25, 'Rented', 500, 'Ground', 4, 'Kannada', 'Run it myself', 'Footwear shop'],
      [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ['5600', null, 'Bad Pin', 'APP-503', 'Bengaluru', 'Karnataka', 3, 40, 'Owned', 500, 'Ground', 6, 'English', '', ''],
    ];
    const terr = [['Territories'], TERR_HEADER, ['TER-01', 'Bengaluru', 'Karnataka', '560037, 560103', 'Tier 1', 1, 'High'], ['TER-02', 'Tumakuru', 'Karnataka', 572101, 'Tier 3', 1, 'Low']];
    const p = parseWorkbook(book({ Applications: apps, Territories: terr }), 'judge.xlsx');
    expect(p.applications.map((a) => a.uid)).toEqual(['APP-501', 'APP-502', 'APP-503']);
    expect(p.source.storesFromFile).toBe(false);
    expect(p.stores.length).toBe(10);
    expect(p.territories[1].pins).toEqual(['572101']);
    const o = runAll(p, ctx);
    expect(o.results.length).toBe(3);
    const blank = o.results.find((r) => r.uid === 'APP-501')!;
    expect(blank.decision).not.toBe('Hold'); // blank optionals never block
    expect(blank.asks.join(' ')).toMatch(/training language/);
    expect(o.results.find((r) => r.uid === 'APP-503')!.decision).toBe('Hold');
    expect(o.summary.pinConflicts).toBe(0);
  });

  it('handles an Applications sheet with headers but no rows', () => {
    const p = parseWorkbook(book({ Applications: [['Applications'], APP_HEADER], Territories: [['T'], TERR_HEADER] }), 'empty.xlsx');
    expect(p.applications.length).toBe(0);
    expect(p.warnings.join(' ')).toMatch(/no applicant rows/);
    expect(p.warnings.join(' ')).toMatch(/no territory rows/);
    const o = runAll(p, ctx);
    expect(o.results.length).toBe(0);
    expect(o.summary.total).toBe(0);
  });

  it('parses the official blank template (example rows only) to zero applicants with warnings', () => {
    const p = parseWorkbook(readArrayBuffer(SAMPLE.replace('StoreSense_Applicants_200.xlsx', 'Case1_Franchise_Test_Data_Format.xlsx')), 'template.xlsx');
    expect(p.applications.length).toBe(0);
    expect(p.territories.length).toBe(0);
    expect(p.source.exampleRowDropped).toBe(true);
    expect(runAll(p, ctx).summary.total).toBe(0);
  });

  it('handles a missing Territories sheet without crashing', () => {
    const p = parseWorkbook(book({ Applications: [APP_HEADER, ['APP-1', 'A', 'Bengaluru', 'Karnataka', '560037', 50, 8, 'Optical shop', 'Rented', 500, 'Ground', 6, 'English', '']] }), 'apps-only.xlsx');
    expect(p.warnings.join(' ')).toMatch(/No Territories sheet/);
    const r = runAll(p, ctx).results[0];
    expect(r.decision).toBe('Waitlist');
    expect(r.reasonCodes).toContain('NO_TERRITORY');
  });

  it('holds a slot for 14 days when the missing size decides between two outcomes', () => {
    const apps = [
      APP_HEADER,
      ['APP-1', 'Strong Owner', 'Bengaluru', 'Karnataka', '560037', 50, 8, 'Optical shop', 'Owned', null, 'Ground', 6, 'English', 'Run it myself'],
      ['APP-2', 'Runner Up', 'Bengaluru', 'Karnataka', '560103', 50, 3, 'Grocery', 'Rented', 450, 'Ground', 6, 'English', ''],
    ];
    const terr = [TERR_HEADER, ['TER-01', 'Bengaluru', 'Karnataka', '560037, 560103', 'Tier 1', 1, 'High']];
    const o = runAll(parseWorkbook(book({ Applications: apps, Territories: terr }), 'held.xlsx'), ctx);
    const held = o.results.find((r) => r.uid === 'APP-1')!;
    expect(held.decision).toBe('Hold');
    expect(held.reasonCodes).toContain('SLOT_HELD');
    expect(held.asks.join(' ')).toMatch(/sq ft/);
    expect(o.results.find((r) => r.uid === 'APP-2')!.decision).toBe('Waitlist');
    expect(o.territories[0].filled.map((f) => f.uid)).toEqual(['APP-1']);
  });
});
