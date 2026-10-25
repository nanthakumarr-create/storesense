import { describe, expect, it } from 'vitest';
import type { Decision, EngineOutput, Partnership, Result } from '../types';
import { buildAnswer, buildUpdateReply, closeIds } from './answer';
import { parseIntent, resolveUpdate, type UpdateIntent } from './intents';

function res(appId: string, decision: Decision, over: Partial<Result> = {}): Result {
  return {
    uid: appId, partnership: null, appId, name: `Name ${appId}`, city: 'Bengaluru', pin: '560100', decision,
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
const r38 = res('APP-038', 'Waitlist', {
  combinedScore: 66,
  partnership: { id: 'PAIR-APP-038+APP-015', role: 'operator', withUid: 'APP-015', withAppId: 'APP-015', withName: 'Name APP-015', status: 'suggested' },
});
const r15 = res('APP-015', 'Decline', {
  combinedScore: 40,
  partnership: { id: 'PAIR-APP-038+APP-015', role: 'investor', withUid: 'APP-038', withAppId: 'APP-038', withName: 'Name APP-038', status: 'suggested' },
});
const pair: Partnership = {
  id: 'PAIR-APP-038+APP-015', operatorUid: 'APP-038', operatorAppId: 'APP-038', operatorName: 'Name APP-038',
  investorUid: 'APP-015', investorAppId: 'APP-015', investorName: 'Name APP-015', territoryId: 'TER-02', pin: '560100', pinName: 'Electronic City',
  combinedInvestmentLakh: 50, totalCashNeedLakh: 40.7, partnerScore: 74, breakdown: [], placeScore: 68, paybackMonths: 22, combinedScore: 73,
  rankInTerritory: 1, covers: ['APP-038 brings 8 years of optical retail; APP-015 brings ₹40L.'], status: 'suggested', outcome: 'Introduce the two applicants.',
};
const out: EngineOutput = {
  results: [r3, r7, r9, r45, rM, r38, r15],
  territories: [
    {
      id: 'TER-02', city: 'Bengaluru', tier: 'Tier 1', priority: 'High', openSlots: 1,
      filled: [{ uid: 'APP-003', appId: 'APP-003', name: 'Name APP-003', pin: '560037', decision: 'Approve', combinedScore: 78 }],
      contenders: [{ uid: 'APP-045', appId: 'APP-045', name: 'Name APP-045', decision: 'Waitlist', combinedScore: 71, note: 'Lost the slot by 7 points.' }],
      reason: '1 slot; APP-003 had the highest combined score.', suggestRaisePriority: false,
    },
  ],
  gaps: [{ pin: '560100', name: 'Electronic City', city: 'Bengaluru', territoryId: 'TER-02', demandIndex: 82, onlineOrders: 1200, nearestStoreKm: 6.1, applicants: 0, note: '' }],
  partnerships: [pair],
  summary: { total: 7, byDecision: { Approve: 1, 'Approve with conditions': 0, Redirect: 0, Waitlist: 3, Hold: 1, Decline: 0 }, slotsTotal: 1, slotsFilled: 1, pinConflicts: 0, dataIssues: 0 },
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
  it('who could partner with an applicant', () => {
    const a = ask('Who could partner with APP-038?');
    expect(a.text).toMatch(/^APP-015 Name APP-015 could partner with APP-038: APP-038 would run the store/);
    expect(a.sections?.[0].bullets.join(' ')).toMatch(/₹50L combined vs ₹41L needed/);
    expect(a.links?.map((l) => `${l.kind}:${l.id}`)).toEqual(['applicant:APP-038', 'applicant:APP-015', 'territory:TER-02', 'map:560100']);
  });
  it('partnership for the investor side', () => expect(ask('can APP-015 partner with someone').text).toMatch(/APP-038 .* could partner with APP-015: APP-015 would fund the store/));
  it('no partnership for an applicant says so', () => expect(ask('who could partner with APP-003').text).toMatch(/^No partnership is suggested for APP-003/));
  it('partnerships in a territory', () => {
    const a = ask('partnerships in TER-02');
    expect(a.text).toBe('1 partnership in TER-02: 0 won a slot, 1 suggested.');
    expect(a.cards?.map((c) => c.appId)).toEqual(['APP-038', 'APP-015']);
  });
  it('no partnerships in another territory', () => expect(ask('show partnerships in TER-15').text).toBe('No partnerships in TER-15.'));
  it('explain mentions the partnership and links the territory', () => {
    const a = ask('Tell me about APP-015');
    expect(a.sections?.find((s) => s.title === 'Suggested partnership')?.bullets[0]).toMatch(/Could pair with APP-038/);
    expect(a.links?.some((l) => l.kind === 'territory' && l.id === 'TER-02')).toBe(true);
  });
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
