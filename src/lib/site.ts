import type { EngineOutput, Result } from '../types';

/**
 * Pin where this applicant's store would actually open: an allocated pair's shared site,
 * a redirect target, or else the pin they applied for.
 */
export function storeSiteOf(r: Result, output: EngineOutput): string | null {
  if (r.partnership?.status === 'allocated') {
    const pair = output.partnerships.find((p) => p.id === r.partnership!.id);
    if (pair) return pair.pin;
  }
  if (r.decision === 'Redirect' && r.redirect) return r.redirect.pin;
  return r.pin;
}

/** Ordinal for queue positions: 1st, 2nd, 3rd, 4th… */
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
