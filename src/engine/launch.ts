// Launch plan for approved partners: dated 60-120 day checklist, ADKAR readiness and personalised training.
import type { AdkarStage, Application, Floor, Language, LaunchPlan, LaunchStep } from '../types';
import { AS_OF_DATE, FESTIVALS, LAUNCH_DAYS, SPACE_SQFT } from '../config/rules';
import type { PartnerScore } from './partner';
import { addDays, clamp, daysBetween, prettyDate, round1 } from './util';

const DIWALI = /diwali|deepavali|deepawali/i;
const AFTER_SANKRANTI = /after (sankranti|sankranthi|pongal)/i;

export interface FestivalCheck {
  conflict: boolean; // partner asked for a date that cannot be met
  note: string | null;
  minOpenDays: number; // earliest day the plan may open (e.g. after Sankranti)
}

/** Festival wishes in the notes vs the earliest realistic opening. */
export function festivalCheck(notes: string, planDays: number): FestivalCheck {
  const earliest = addDays(planDays);
  const diwali = FESTIVALS.find((f) => f.name === 'Diwali')!;
  const sankranti = FESTIVALS.find((f) => f.name === 'Sankranti')!;
  if (DIWALI.test(notes)) {
    const daysToDiwali = daysBetween(AS_OF_DATE, diwali.date);
    if (daysToDiwali < planDays) {
      const beforeSankranti = earliest < sankranti.date;
      return {
        conflict: true,
        note: `Diwali (about ${prettyDate(diwali.date)}) is ${daysToDiwali} days away, and the fastest opening takes ${planDays} days. Earliest realistic opening is ${prettyDate(earliest)}${beforeSankranti ? `, in time for Sankranti (${prettyDate(sankranti.date)}) and the wedding season` : ''}. We do not hold the store back for next Diwali.`,
        minOpenDays: planDays,
      };
    }
  }
  if (AFTER_SANKRANTI.test(notes)) {
    const after = daysBetween(AS_OF_DATE, sankranti.date) + 1;
    return { conflict: false, note: `Partner prefers to open after Sankranti (${prettyDate(sankranti.date)}); opening set for ${prettyDate(addDays(Math.max(after, planDays)))}.`, minOpenDays: after };
  }
  const s = daysBetween(AS_OF_DATE, sankranti.date);
  if (s - planDays >= 0 && s - planDays <= 21)
    return { conflict: false, note: `Opening on ${prettyDate(earliest)} lands just before Sankranti (${prettyDate(sankranti.date)}) and the wedding season.`, minOpenDays: planDays };
  return { conflict: false, note: null, minOpenDays: planDays };
}

export interface LaunchInput {
  app: Application;
  hasSite: boolean;
  floor: Floor | null;
  sizeSqft: number | null;
  zeroExperience: boolean;
  partner: PartnerScore;
  sitePinLabel: string; // e.g. "560037 Marathahalli"
  shadowStore: { id: string; area: string; km: number } | null;
  capitalCondition: boolean;
}

export function planDaysFor(hasSite: boolean) {
  return hasSite ? LAUNCH_DAYS.spaceReady : LAUNCH_DAYS.noSpace;
}

export function buildLaunchPlan(input: LaunchInput): LaunchPlan {
  const { app, hasSite, floor, zeroExperience, partner, sitePinLabel, shadowStore } = input;
  const language: Language = app.preferredLanguage ?? 'English';
  const planDays = planDaysFor(hasSite);
  const fest = festivalCheck(app.notes, planDays);
  // Open as early as the plan allows (never push a ready partner back); only a stated festival preference moves it later.
  const openDays = Math.max(planDays, fest.minOpenDays);
  const siteDays = hasSite ? 0 : LAUNCH_DAYS.noSpace - LAUNCH_DAYS.spaceReady; // 40 days to find and audit a site
  const k = (openDays - siteDays) / LAUNCH_DAYS.spaceReady;
  const at = (d: number) => Math.round(siteDays + d * k);
  const steps: LaunchStep[] = [];
  const add = (phase: string, from: number, to: number, task: string, owner: string) =>
    steps.push({ phase, dayFrom: from, dayTo: to, task, owner, dueDate: addDays(to) });

  add('Paperwork', 0, 7, 'KYC, CIBIL check, source-of-funds proof and franchise agreement signed', 'Expansion manager + Finance');
  add('Licences (parallel)', 3, Math.max(30, at(30)), 'Shops & Establishments registration, trade licence, GST registration (typical list, verify locally)', 'Partner');
  if (!hasSite) {
    add('Site', 0, 30, `Find a ground-floor site of ${SPACE_SQFT.ideal}+ sq ft in or near ${sitePinLabel}; share 2-3 options`, 'Partner + Expansion manager');
    add('Site', 30, siteDays, 'Brand site audit (frontage, footfall, size) and lease sign-off', 'Expansion manager');
  }
  add('Fit-out', at(7), at(45), `Store design, fit-out, eye-test room and signage${floor === 'Upper' ? ' (street-level sign and stair branding)' : ''}`, 'Projects team');
  add(
    'Hiring',
    at(zeroExperience ? 7 : 20),
    at(45),
    zeroExperience ? 'Hire a store manager with 2+ years of retail experience (must join before fit-out ends), an optometrist and 2 sales staff' : 'Hire an optometrist and 2 sales staff',
    'Partner',
  );
  add('Stock & systems', at(40), at(55), 'Opening stock, POS and order-system setup, online listing for the new store', 'Supply + IT');
  add(
    'Training',
    at(zeroExperience ? 35 : 45),
    at(63),
    `Training in ${language}: products, prescriptions, eye-test workflow, POS, selling${zeroExperience ? ' (4 weeks incl. shadowing)' : ''}`,
    'Training team',
  );
  if (shadowStore) add('Shadowing', at(50), at(60), `Owner and staff shadow ${shadowStore.id} ${shadowStore.area} (${round1(shadowStore.km)} km away)`, 'Area manager');
  add('Soft launch', at(63), openDays, 'Soft launch, local promotion and opening day', 'Partner + Area manager');
  add('First 90 days', openDays, openDays + 90, 'Weekly sales and service review; fix gaps found in the first month', 'Area manager');
  steps.sort((a, b) => a.dayFrom - b.dayFrom || a.dayTo - b.dayTo);

  // ADKAR from the profile (0-100, higher = readier)
  const item = (label: string) => partner.items.find((i) => i.label === label)?.score ?? 50;
  const knowsBrand = /spoke to|know the eyewear|area sales manager/i.test(app.notes);
  const yrs = app.experienceYears ?? 0;
  const adkar: { stage: AdkarStage; score: number; note: string }[] = [
    {
      stage: 'Awareness',
      score: clamp((partner.relevance === 'same' ? 90 : 60) + (knowsBrand ? 15 : 0) - (partner.involvement === 'low' ? 20 : 0)),
      note: partner.relevance === 'same' ? 'Already in eyewear; knows why the brand model works' : knowsBrand ? 'Has spoken to our team already' : 'New to eyewear: needs the brand and category walkthrough',
    },
    {
      stage: 'Desire',
      score: clamp((partner.involvement === 'high' ? 90 : partner.involvement === 'low' ? 30 : 60) + (/2 stores|immediately|full-time|full time/i.test(app.notes) ? 10 : 0)),
      note: partner.involvement === 'high' ? 'Plans to run the store hands-on' : partner.involvement === 'low' ? 'Plans to be hands-off; needs an owner-involvement agreement' : 'No clear signal on how involved they will be',
    },
    {
      stage: 'Knowledge',
      score: Math.round(0.5 * item('Experience') + 0.5 * item('Category relevance')),
      note: zeroExperience ? 'No shop experience: needs full retail and product training' : partner.relevance === 'same' ? 'Knows the products' : 'Knows retail, not eyewear products',
    },
    {
      stage: 'Ability',
      score: Math.round(0.5 * item('Capital fit') + 0.5 * item('Commitment')),
      note: `${hasSite ? 'Space ready' : 'No site yet'}; ${input.capitalCondition ? 'funding gap to close' : 'funding in place'}`,
    },
    {
      stage: 'Reinforcement',
      score: clamp(50 + (partner.hasManagerOrCoInvestor ? 25 : 0) + (yrs >= 4 ? 15 : 0)),
      note: partner.hasManagerOrCoInvestor ? 'Has family, a co-investor or trained staff behind them' : 'Needs a 30/60/90-day check-in rhythm',
    },
  ];
  adkar.sort((a, b) => a.score - b.score || a.stage.localeCompare(b.stage));
  const weakest = adkar[0].stage;

  const training: string[] = [`All training in ${language}${app.preferredLanguage ? '' : ' (language not confirmed; English by default)'}.`];
  if (shadowStore) training.push(`Shadow ${shadowStore.id} ${shadowStore.area}, the nearest existing store (${round1(shadowStore.km)} km), for 10 days before opening.`);
  if (zeroExperience) training.push('No retail experience: hire a store manager with 2+ years before fit-out ends; owner does 4 weeks of training and shadowing.');
  if (partner.relevance !== 'same') training.push('Eyewear category course: frames, lenses, prescriptions and the eye-test flow (optometrist-led).');
  if (floor === 'Upper') training.push('Upper-floor store: footfall plan with street-level signage, stair branding and a ground-floor standee.');
  if (floor === 'Mall unit') training.push('Mall unit: briefing on mall rules, CAM charges and weekend staffing.');
  if (input.capitalCondition) training.push('Finance session: working capital, the 3-month cash buffer and the loan or co-investor paperwork.');
  const focus: Record<AdkarStage, string> = {
    Awareness: 'Weakest stage is Awareness: start with a brand and category induction day.',
    Desire: 'Weakest stage is Desire: agree owner hours in the store and the incentive plan in writing.',
    Knowledge: 'Weakest stage is Knowledge: extra product and prescription sessions before stock arrives.',
    Ability: 'Weakest stage is Ability: close the site and funding gaps first; nothing else starts until they are done.',
    Reinforcement: 'Weakest stage is Reinforcement: area manager check-ins at day 30, 60 and 90 after opening.',
  };
  training.push(focus[weakest]);

  return {
    totalDays: openDays,
    startDate: AS_OF_DATE,
    targetOpenDate: addDays(openDays),
    trainingLanguage: language,
    adkar,
    weakestStage: weakest,
    steps,
    training,
    shadowStore,
    festivalNote: fest.note,
  };
}
