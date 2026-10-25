// Browser side of the HubSpot connection. Talks only to our own /api/hubspot/* endpoints (the token stays on the server).
import * as XLSX from 'xlsx';
import type { EngineOutput, ParseResult } from '../types';

export interface HubSpotStatus {
  connected: boolean;
  reason?: string;
  pipeline?: string;
  stages?: string[];
  contacts?: number;
  deals?: number;
}

async function call<T>(action: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch(`/api/hubspot/${action}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({ error: `HubSpot endpoint returned ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HubSpot request failed (${res.status})`);
  return json as T;
}

export const hubspotStatus = () => call<HubSpotStatus>('status', 'GET').catch((e): HubSpotStatus => ({ connected: false, reason: e.message }));

/**
 * Pull applicants from HubSpot and turn them into a workbook in the judges' template layout, so they go
 * through exactly the same parser and cleaning as an Excel upload. Territories and existing stores come
 * from the currently loaded file (they are the brand's plan, managed in StoreSense, not in the CRM).
 */
export async function importFromHubSpot(current: ParseResult | null): Promise<{ data: ArrayBuffer; fileName: string; count: number }> {
  const { headers, applicants } = await call<{ headers: string[]; applicants: { row: Record<string, string> }[] }>('import', 'POST', {});
  if (!applicants.length) throw new Error('HubSpot has no StoreSense applicants yet');
  const wb = XLSX.utils.book_new();
  const appRows = applicants.map((a) => headers.map((h) => a.row[h] ?? ''));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Applications — imported from HubSpot CRM'], headers, ...appRows]), 'Applications');
  const terrHeaders = ['Territory ID', 'City', 'State', 'Pin codes covered', 'City tier', 'Open slots', 'Priority'];
  const terr = (current?.territories ?? []).map((t) => [t.id, t.city, t.state, t.pins.join(', '), t.tier, t.openSlots, t.priority]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Territories — from the current plan'], terrHeaders, ...terr]), 'Territories');
  if (current?.stores.length) {
    const st = current.stores.map((s) => [s.id, s.city, s.pin, s.opened]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Existing stores'], ['Store ID', 'City', 'Pin code', 'Opened (year)'], ...st]), 'Existing stores');
  }
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { data, fileName: `HubSpot CRM (${applicants.length} applicants)`, count: applicants.length };
}

/** Write every decision back to HubSpot as a deal in the Franchise Pipeline. */
export function pushToHubSpot(output: EngineOutput) {
  const decisions = output.results.map((r) => ({
    uid: r.uid,
    appId: r.appId,
    name: r.name,
    city: r.city,
    decision: r.decision,
    headline: r.headline,
    nextStep: r.nextSteps[0] ?? r.asks[0] ?? '',
    partnerScore: Math.round(r.partnerScore),
    placeScore: Math.round(r.place.placeScore),
    paybackMonths: r.economics.paybackMonths === null ? null : Math.round(r.economics.paybackMonths * 10) / 10,
    assignedPin: r.redirect?.pin ?? r.pin ?? '',
    territoryId: r.redirect?.territoryId ?? r.territoryId ?? '',
  }));
  return call<{ created: number; updated: number; byStage: Record<string, number> }>('push', 'POST', { decisions });
}
