// Pipeline helpers: sorting, CSV export (D1 decision file), small formatters.
import type { Decision, Result } from '../../types';
import { DECISIONS } from '../../types';

export type SortKey = 'appId' | 'name' | 'city' | 'decision' | 'partner' | 'place' | 'payback' | 'combined';

const DECISION_ORDER: Record<Decision, number> = Object.fromEntries(DECISIONS.map((d, i) => [d, i])) as Record<Decision, number>;

export function compareResults(a: Result, b: Result, key: SortKey): number {
  switch (key) {
    case 'appId':
      return a.appId.localeCompare(b.appId, undefined, { numeric: true }) || a.uid.localeCompare(b.uid);
    case 'name':
      return a.name.localeCompare(b.name);
    case 'city':
      return a.city.localeCompare(b.city) || (a.pin ?? '').localeCompare(b.pin ?? '');
    case 'decision':
      return DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision] || b.combinedScore - a.combinedScore;
    case 'partner':
      return a.partnerScore - b.partnerScore;
    case 'place':
      return a.place.placeScore - b.place.placeScore;
    case 'payback': {
      const pa = a.economics.paybackMonths ?? Infinity;
      const pb = b.economics.paybackMonths ?? Infinity;
      return pa === pb ? 0 : pa < pb ? -1 : 1;
    }
    case 'combined':
      return a.combinedScore - b.combinedScore;
  }
}

/** Default direction for each column: numbers best-first, text A→Z. */
export const DEFAULT_DESC: Record<SortKey, boolean> = {
  appId: false,
  name: false,
  city: false,
  decision: false,
  partner: true,
  place: true,
  payback: false,
  combined: true,
};

export const fmtScore = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(0));
export const fmtMonths = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(1)} mo`);

export function issueCount(r: Result): number {
  return r.flags.filter((f) => f.severity !== 'info').length;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** D1 decision file: one row per application. */
export function buildDecisionCsv(results: Result[], asOf: string): string {
  const header = [
    'Application ID', 'Applicant name', 'City', 'Pin code', 'Decision', 'Headline', 'Reasons',
    'Partner score', 'Place score', 'Combined score', 'Payback (months)', 'Capital gap (₹ lakh)',
    'Territory', 'Rank in territory', 'Redirect pin', 'Redirect km', 'Conditions', 'Next steps', 'Information to request', 'Data flags', 'Decisions as of',
  ];
  const rows = results.map((r) => [
    r.appId, r.name, r.city, r.pin ?? '', r.decision, r.headline, r.reasons.join(' | '),
    r.partnerScore.toFixed(1), r.place.placeScore.toFixed(1), r.combinedScore.toFixed(2),
    r.economics.paybackMonths === null ? '' : r.economics.paybackMonths.toFixed(1),
    r.economics.capitalGapLakh.toFixed(1),
    r.territoryId ?? '', r.rankInTerritory ?? '', r.redirect?.pin ?? '', r.redirect ? r.redirect.km.toFixed(1) : '',
    r.conditions.map((c) => `${c.text} (${c.owner}, ${c.deadlineDays} days)`).join(' | '),
    r.nextSteps.join(' | '), r.asks.join(' | '), r.flags.map((f) => f.code).join(' '), asOf,
  ]);
  // BOM so Excel opens ₹ and Kannada text correctly.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadText(text: string, fileName: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
