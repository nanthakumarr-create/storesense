import { describe, expect, it } from 'vitest';
import type { Application } from '../types';
import { normaliseAppId, parseIntent, parseUpdate, resolveUpdate, type UpdateIntent } from './intents';

const IDS = Array.from({ length: 200 }, (_, i) => `APP-${String(i + 1).padStart(3, '0')}`);
const NAMES = [
  { id: 'APP-001', name: 'Ravi Kumar' },
  { id: 'APP-002', name: 'Priya Shetty' },
  { id: 'APP-003', name: 'Ravi Gowda' },
  { id: 'APP-004', name: 'Meena Rao' },
];

function app(over: Partial<Application> = {}): Application {
  return {
    uid: 'APP-012', rowNumber: 15, id: 'APP-012', name: 'Test', city: 'Bengaluru', state: 'Karnataka', pin: '560100', pinRaw: '560100',
    investmentLakh: 30, experienceYears: 7, currentBusiness: 'Garments', spaceAvailable: 'Not yet identified', spaceSizeSqft: null,
    floor: 'Not known', targetLaunchMonths: 6, preferredLanguage: 'English', languageRaw: 'English', notes: 'Wants a high street site.', flags: [],
    ...over,
  };
}

const upd = (text: string) => {
  const i = parseIntent(text, IDS, NAMES);
  expect(i.kind).toBe('update');
  return i as UpdateIntent;
};

describe('ID normalisation', () => {
  it.each([
    ['APP-7', 'APP-007'],
    ['app 007', 'APP-007'],
    ['APP007', 'APP-007'],
    ['app-12', 'APP-012'],
    ['APP_150', 'APP-150'],
  ])('%s → %s', (raw, id) => expect(normaliseAppId(raw)).toBe(id));

  it('finds IDs inside a sentence', () => {
    expect(parseIntent('explain app 12', IDS)).toMatchObject({ kind: 'explain', appId: 'APP-012' });
    expect(parseIntent('why is APP7 waitlisted', IDS)).toMatchObject({ kind: 'explain', appId: 'APP-007' });
  });
});

describe('brief examples', () => {
  it('"Why is APP-007 on hold?" → explain with Hold premise', () => {
    expect(parseIntent('Why is APP-007 on hold?', IDS)).toEqual({ kind: 'explain', appId: 'APP-007', premise: ['Hold'] });
  });

  it('"APP-012 has now found a ground-floor space" → update Rented + Ground with assumptions', () => {
    const i = upd('APP-012 has now found a ground-floor space');
    expect(i.appId).toBe('APP-012');
    expect(i.patch).toEqual({ spaceAvailable: 'Rented', floor: 'Ground' });
    const r = resolveUpdate(i, app());
    expect(r.patch).toMatchObject({ spaceAvailable: 'Rented', floor: 'Ground' });
    expect(r.assumptions.join(' ')).toMatch(/Assumed rented/);
    expect(r.assumptions.join(' ')).toMatch(/Size not given/);
    expect(r.changes.map((c) => c.label)).toEqual(['Space', 'Floor']);
  });
});

describe('explain / premise', () => {
  it('premise is kept for wrong-premise checks', () => {
    expect(parseIntent('why is APP-009 on hold', IDS)).toMatchObject({ premise: ['Hold'] });
    expect(parseIntent('why was APP-009 rejected?', IDS)).toMatchObject({ premise: ['Decline'] });
    expect(parseIntent('is APP-009 approved?', IDS)).toMatchObject({ premise: ['Approve', 'Approve with conditions'] });
  });
  it('plain explain has no premise', () => {
    expect(parseIntent('explain APP-12', IDS)).toEqual({ kind: 'explain', appId: 'APP-012', premise: undefined });
  });
  it('unknown ID is reported', () => {
    expect(parseIntent('why is APP-450 on hold', IDS)).toEqual({ kind: 'unknownId', appId: 'APP-450' });
  });
  it('name lookup: full name and unique first name', () => {
    expect(parseIntent('tell me about Priya Shetty', IDS, NAMES)).toMatchObject({ kind: 'explain', appId: 'APP-002' });
    expect(parseIntent('tell me about meena', IDS, NAMES)).toMatchObject({ kind: 'explain', appId: 'APP-004' });
  });
  it('ambiguous first name lists candidates', () => {
    expect(parseIntent('tell me about Ravi', IDS, NAMES)).toEqual({ kind: 'ambiguous', query: 'ravi', candidates: ['APP-001', 'APP-003'] });
  });
});

describe('list / territory / compare / gaps', () => {
  it('who is on hold', () => expect(parseIntent('Who is on hold?', IDS)).toEqual({ kind: 'list', filter: { decisions: ['Hold'], city: undefined, flagged: undefined } }));
  it('waitlisted in Mysuru', () => expect(parseIntent('Who is waitlisted in Mysuru?', IDS)).toMatchObject({ kind: 'list', filter: { decisions: ['Waitlist'], city: 'Mysuru' } }));
  it('city aliases', () => expect(parseIntent('who is on hold in mysore', IDS)).toMatchObject({ filter: { city: 'Mysuru' } }));
  it('approved in TER-02', () => expect(parseIntent('approved in TER-02', IDS)).toMatchObject({ kind: 'list', filter: { decisions: ['Approve', 'Approve with conditions'], territoryId: 'TER-02' } }));
  it('show redirects', () => expect(parseIntent('show redirects', IDS)).toMatchObject({ kind: 'list', filter: { decisions: ['Redirect'] } }));
  it('data issues', () => expect(parseIntent('which applications have data issues?', IDS)).toMatchObject({ kind: 'list', filter: { flagged: true } }));
  it('territory', () => {
    expect(parseIntent('What happened in TER-02?', IDS)).toEqual({ kind: 'territory', terId: 'TER-02' });
    expect(parseIntent('ter 5 status', IDS)).toEqual({ kind: 'territory', terId: 'TER-05' });
  });
  it('compare', () => {
    expect(parseIntent('Compare APP-003 and APP-045', IDS)).toEqual({ kind: 'compare', a: 'APP-003', b: 'APP-045' });
    expect(parseIntent('app 3 vs app 45', IDS)).toEqual({ kind: 'compare', a: 'APP-003', b: 'APP-045' });
  });
  it('gaps', () => {
    expect(parseIntent('Where should we open next?', IDS)).toEqual({ kind: 'gaps', city: undefined });
    expect(parseIntent('demand gaps in bangalore', IDS)).toEqual({ kind: 'gaps', city: 'Bengaluru' });
  });
  it('help / unknown', () => {
    expect(parseIntent('help', IDS).kind).toBe('help');
    expect(parseIntent('lorem ipsum dolor', IDS).kind).toBe('unknown');
  });
});

describe('update phrases', () => {
  it('bought / owns a shop → Owned', () => {
    expect(upd('APP-012 bought a shop').patch).toMatchObject({ spaceAvailable: 'Owned' });
    expect(upd('APP-012 now owns a shop on MG Road').patch).toMatchObject({ spaceAvailable: 'Owned' });
  });
  it('rented space with size', () => {
    expect(upd('APP-012 rented a 600 sq ft shop').patch).toEqual({ spaceAvailable: 'Rented', spaceSizeSqft: 600 });
  });
  it('size only', () => {
    const i = upd('APP-007 space is 1,200 sqft');
    expect(i.patch.spaceSizeSqft).toBe(1200);
    expect(i.patch.spaceAvailable).toBeUndefined();
  });
  it('first floor / upper floor → Upper, mall → Mall unit', () => {
    expect(upd('APP-012 found a first floor space').patch).toMatchObject({ floor: 'Upper', spaceAvailable: 'Rented' });
    expect(upd('APP-012 found an upper floor shop').patch).toMatchObject({ floor: 'Upper' });
    expect(upd('APP-012 found a unit in a mall').patch).toMatchObject({ floor: 'Mall unit' });
  });
  it('investment absolute', () => {
    expect(upd('APP-038 investment is now 40 lakh').patch).toEqual({ investmentLakh: 40 });
    expect(upd('APP-038 can invest 45L').patch).toEqual({ investmentLakh: 45 });
    expect(upd('APP-038 budget is 1.2 crore').patch).toEqual({ investmentLakh: 120 });
  });
  it('loan adds to current', () => {
    const i = upd('APP-038 got a loan of 10 lakh');
    expect(i.investmentDeltaLakh).toBe(10);
    const r = resolveUpdate(i, app({ investmentLakh: 30 }));
    expect(r.patch.investmentLakh).toBe(40);
    expect(r.assumptions.join(' ')).toMatch(/Added ₹10L to the current ₹30L = ₹40L/);
    expect(r.patch.notes).toMatch(/Loan of ₹10L/);
  });
  it('manager with years → notes, not experience', () => {
    const i = upd('APP-015 hired a manager with 5 years');
    expect(i.patch.experienceYears).toBeUndefined();
    expect(i.notesAppend[0]).toMatch(/Hired a store manager with 5 years/);
    const r = resolveUpdate(i, app());
    expect(r.patch.notes).toBe('Wants a high street site. Hired a store manager with 5 years retail experience (chat update).');
  });
  it('co-investor → notes (+ money when given)', () => {
    expect(upd('APP-038 has a co-investor now').notesAppend).toEqual(['Co-investor confirmed (chat update).']);
    const i = upd('APP-038 found a co-investor putting in 8 lakh');
    expect(i.investmentDeltaLakh).toBe(8);
  });
  it('experience', () => {
    expect(upd('APP-015 has 3 years experience').patch).toEqual({ experienceYears: 3 });
    expect(upd('APP-015 actually has 4 years of retail experience').patch).toEqual({ experienceYears: 4 });
  });
  it('launch months / weeks', () => {
    expect(upd('APP-081 wants to open in 2 months').patch).toEqual({ targetLaunchMonths: 2 });
    const w = upd('APP-081 wants to open in 6 weeks');
    expect(w.patch.targetLaunchMonths).toBe(2);
    expect(w.assumptions[0]).toMatch(/6 weeks/);
  });
  it('language', () => expect(upd('APP-052 prefers Kannada').patch).toEqual({ preferredLanguage: 'Kannada' }));
  it('pin move sets city from prefix', () => {
    expect(upd('APP-013 moved to 570020').patch).toEqual({ pin: '570020', city: 'Mysuru' });
    expect(upd('APP-033 new pin 560102').patch).toEqual({ pin: '560102', city: 'Bengaluru' });
  });
  it('withdrew → no patch', () => {
    expect(upd('APP-099 withdrew').withdraw).toBe(true);
    expect(upd('APP-099 has withdrawn her application').patch).toEqual({});
  });
  it('update by name', () => {
    expect(parseIntent('Priya Shetty found a ground floor shop', IDS, NAMES)).toMatchObject({ kind: 'update', appId: 'APP-002' });
  });
  it('what-if phrasing is treated as an update', () => {
    expect(parseIntent('What if APP-012 found a ground floor space?', IDS).kind).toBe('update');
  });
  it('a question with no usable data stays explain', () => {
    expect(parseIntent('why does APP-012 have no space?', IDS).kind).toBe('explain');
    expect(parseUpdate('APP-012 is great', 'APP-012')).toBeNull();
  });
});

describe('resolveUpdate', () => {
  it('drops no-op fields', () => {
    const r = resolveUpdate(upd('APP-012 prefers English'), app());
    expect(r.changes).toEqual([]);
    expect(r.patch).toEqual({});
  });
  it('clears stale parser flags on changed fields', () => {
    const a = app({
      spaceAvailable: 'Owned',
      flags: [
        { code: 'SPACE_SIZE_MISSING', severity: 'ask', message: 'Owned but no size', field: 'spaceSizeSqft' },
        { code: 'LANGUAGE_DEFAULTED', severity: 'info', message: 'x', field: 'preferredLanguage' },
      ],
    });
    const r = resolveUpdate(upd('APP-012 space is 600 sq ft'), a);
    expect(r.patch.spaceSizeSqft).toBe(600);
    expect(r.patch.flags?.map((f) => f.code)).toEqual(['LANGUAGE_DEFAULTED']);
  });
  it('lost the space resets size and floor', () => {
    const r = resolveUpdate(upd('APP-012 lost the shop'), app({ spaceAvailable: 'Rented', spaceSizeSqft: 500, floor: 'Ground' }));
    expect(r.patch).toMatchObject({ spaceAvailable: 'Not yet identified', spaceSizeSqft: null, floor: 'Not known' });
  });
});
