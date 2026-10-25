// Engine entry point. STUB: replaced by the full implementation (place, partner, economics, allocate, launch, explain).
// Contract: pure + deterministic. Same ParseResult + EngineContext → identical EngineOutput (including `hash`).
import type { EngineContext, EngineOutput, ParseResult } from '../types';
import { AS_OF_DATE } from '../config/rules';

export function runAll(parse: ParseResult, _ctx: EngineContext): EngineOutput {
  return {
    results: [],
    territories: [],
    gaps: [],
    summary: {
      total: parse.applications.length,
      byDecision: { Approve: 0, 'Approve with conditions': 0, Redirect: 0, Waitlist: 0, Hold: 0, Decline: 0 },
      slotsTotal: 0,
      slotsFilled: 0,
      pinConflicts: 0,
      dataIssues: 0,
    },
    asOf: AS_OF_DATE,
    hash: 'stub',
  };
}
