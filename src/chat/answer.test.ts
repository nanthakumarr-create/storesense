import { describe, expect, it } from 'vitest';
import type { Decision, EngineOutput, Result } from '../types';
import { buildAnswer, buildUpdateReply, closeIds } from './answer';
import { parseIntent, resolveUpdate, type UpdateIntent } from './intents';

function res(appId: string, decision: Decision, over: Partial<Result> = {}): Result {
  return {
    uid: appId, appId, name: `Name ${appId}`, city: 'Bengaluru', pin: '560100', decision,
    headline: `${appId} headline for ${decision}.`,
    reasons: [`Reason for ${appId}: partner score 72/100.`], reasonCodes: [], nextSteps: ['Sign the agreement by 10 Nov 2026.'], preparation: [],
    whatWouldChange: ['A ground-floor space of 400+ sq ft.'], asks: [], conditions: [],
    partnerScore: 72, partnerBreakdown: [],
    place: { pin: '560100', pinName: 'Electronic City', territoryId: 'TER-02', territoryPriority: 'High', nearestStore: { id: 'ST-04', pin: '560066', area: 'Whitefield', km: 6.2 }, overlapRadiusKm: 2, insideOverlapRadius: false, samePinAsStore: null, demandIndex: 80, demandSource: 'orders', unservedNorm: 70, placeScore: 68, locationApproximate: false },
    economics: { tier: 'Tier 1', requiredInvestmentLakh: 35, bufferLakh: 7.5, totalCashNeedLakh: 42.5, floorFactor: 1, monthlySalesLakh: 8, monthlyFixedCostLakh: 2.5, monthlyProfitLakh: 1.5, paybackMonths: 24, paybackPass: true, capitalGapLakh: 0, capitalGapPct: 0 },
    readiness: 60, combinedScore: 70, territoryId: 'TER-02', rankInTerritory: 1, redirect: null, launchPlan: null, flags: [],
    ...over,
  };
}

const r7 = res('APP-007', 'Hold', { asks: ['Send the space size in sq ft.'], city: 'Davanagere', territoryId: 'TER-10' });
const r9 = res('APP-009', 'Waitlist', { headline: 'A stronger applicant took the last slot in TER-02.', combinedScore: 64, rankInTerritory: 2 });
const r3 = res('APP-003', 'Approve', { pin: '560037', combinedScore: 78 });
const r45 = res('APP-045', 'Waitlist', { pin: '560037', combinedScore: 71, partnerScore: 60 });
const rM = res('APP-070', 'Waitlist', { city: 'Mysuru', territoryId: 'TER-15' });
const out: EngineOutput = {
  results: [r3, r7, r9, r45, rM],
  territories: [
    {
      id: 'TER-02', city: 'Bengaluru', tier: 'Tier 1', priority: 'High', openSlots: 1,
      filled: [{ uid: 'APP-003', appId: 'APP-003', name: 'Name APP-003', pin: '560037', decision: 'Approve', combinedScore: 78 }],
      contenders: [{ uid: 'APP-045', appId: 'APP-045', name: 'Name APP-045', decision: 'Waitlist', combinedScore: 71, note: 'Lost the slot by 7 points.' }],
      reason: '1 slot; APP-003 had the highest combined score.', suggestRaisePriority: false,
    },
  ],
  gaps: [{ pin: '560100', name: 'Electronic City', city: 'Bengaluru', territoryId: 'TER-02', demandIndex: 82, onlineOrders: 1200, nearestStoreKm: 6.1, applicants: 0, note: '' }],
  summary: { total: 5, byDecision: { Approve: 1, 'Approve with conditions': 0, Redirect: 0, Waitlist: 3, Hold: 1, Decline: 0 }, slotsTotal: 1, slotsFilled: 1, pinConflicts: 0, dataIssues: 0 },
  asOf: '2026-10-25',
  hash: 'x',
};
const IDS = out.results.map((r) => r.appId);
const ask = (q: string) => buildAnswer(parseIntent(q, IDS), out);

describe('buildAnswer', () => {
  it('explains APP-007 with the asks', () => {
    const a = ask('Why is APP-007 on hold?');
    expect(a.text).toMatch(/APP-007 .* is on hold/);
    expect(a.sections?.find((s) => s.title === 'What we need from them')?.bullets).toEqual(['Send the space size in sq ft.']);
    expect(a.focus?.decision).toBe('Hold');
  });
  it('corrects a wrong premise', () => {
    const a = ask('Why is APP-009 on hold?');
    expect(a.text).toBe('APP-009 is not on hold. It is waitlisted: A stronger applicant took the last slot in TER-02.');
    expect(a.tone).toBe('warn');
  });
  it('unknown ID lists close IDs', () => {
    const a = ask('why is APP-008 on hold');
    expect(a.text).toMatch(/can't find APP-008/);
    expect(closeIds(out, 'APP-008')[0]).toMatch(/APP-00[79]/);
  });
  it('lists by decision and city', () => {
    const a = ask('Who is waitlisted in Mysuru?');
    expect(a.text).toMatch(/^1 applicant is waitlisted in Mysuru/);
    expect(a.cards?.map((c) => c.appId)).toEqual(['APP-070']);
  });
  it('empty list says so', () => expect(ask('show redirects').text).toBe('Nobody is redirected.'));
  it('territory', () => {
    const a = ask('What happened in TER-02?');
    expect(a.text).toMatch(/TER-02 · Bengaluru · Tier 1 · High priority: 1 of 1 slot filled/);
    expect(a.cards?.length).toBe(2);
  });
  it('unknown territory', () => expect(ask('what happened in TER-09').text).toMatch(/can't find TER-09/));
  it('compare flags the same pin', () => {
    const a = ask('Compare APP-003 and APP-045');
    expect(a.text).toMatch(/^APP-003 ranks higher \(combined 78\/100 vs 71\/100\), mainly on partner score/);
    expect(a.bullets[0]).toMatch(/Both want pin 560037/);
    expect(a.compare?.rows.find((r) => r.label === 'Combined score')?.better).toBe('a');
  });
  it('gaps are labelled simulated', () => expect(ask('where should we open next').text).toMatch(/simulated/));
  it('no data', () => expect(buildAnswer(parseIntent('why APP-007', IDS), { ...out, results: [] }).tone).toBe('warn'));
});

describe('buildUpdateReply', () => {
  it('shows before → after and ripple', () => {
    const intent = parseIntent('APP-009 has now found a ground-floor space', IDS) as UpdateIntent;
    const resolved = resolveUpdate(intent, {
      uid: 'APP-009', rowNumber: 12, id: 'APP-009', name: 'n', city: 'Bengaluru', state: 'Karnataka', pin: '560100', pinRaw: '560100', investmentLakh: 40, experienceYears: 4,
      currentBusiness: '', spaceAvailable: 'Not yet identified', spaceSizeSqft: null, floor: 'Not known', targetLaunchMonths: 6, preferredLanguage: 'English', languageRaw: 'English', notes: '', flags: [],
    });
    const after = res('APP-009', 'Approve with conditions', { combinedScore: 80, rankInTerritory: 1, conditions: [{ code: 'SIZE', text: 'Send the space size', deadlineDays: 14, owner: 'Partner' }] });
    const reply = buildUpdateReply('APP-009', resolved, {
      target: { before: r9, after },
      changes: [
        { uid: 'APP-009', appId: 'APP-009', name: 'x', before: 'Waitlist', after: 'Approve with conditions', why: '' },
        { uid: 'APP-003', appId: 'APP-003', name: 'y', before: 'Approve', after: 'Waitlist', why: 'Lost the slot.' },
      ],
    });
    expect(reply.text).toMatch(/moves from Waitlist to Approve with conditions/);
    expect(reply.diff?.decisionChanged).toBe(true);
    expect(reply.diff?.ripple.map((c) => c.appId)).toEqual(['APP-003']);
    expect(reply.diff?.understood.map((u) => `${u.label}: ${u.from} → ${u.to}`)).toEqual(['Space: Not yet identified → Rented', 'Floor: Not known → Ground']);
    expect(reply.diff?.metrics.find((m) => m.label === 'Combined score')).toMatchObject({ before: '64/100', after: '80/100', changed: true });
  });
  it('unchanged decision explains why and what would change it', () => {
    const intent = parseIntent('APP-007 prefers Kannada', IDS) as UpdateIntent;
    const reply = buildUpdateReply('APP-007', { patch: intent.patch, changes: [], assumptions: [] }, { target: { before: r7, after: r7 }, changes: [] });
    expect(reply.text).toMatch(/stays on hold/);
    expect(reply.sections?.map((s) => s.title)).toContain('What would change it');
  });
});
