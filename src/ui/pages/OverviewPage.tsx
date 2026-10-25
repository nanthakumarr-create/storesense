// Overview: where this batch of applications is, and what the operator should do next. One calm screen, no charts.
import { useMemo } from 'react';
import { useApp } from '../../state/AppState';
import { Button, Card, CardHeader, EmptyState, fmtInt } from '../components/ui';
import { ProcessStages, buildStages } from '../overview/ProcessStages';
import { NextSteps, buildNextSteps } from '../overview/NextSteps';

export function OverviewPage() {
  const { output, parse, demandSource, setPage, openApplicant, openTerritory, setDataPanelOpen, loadSample } = useApp();

  const stages = useMemo(() => (output ? buildStages(output) : []), [output]);
  const steps = useMemo(
    () =>
      output
        ? buildNextSteps(output, {
            openApplicant: (uid) => openApplicant(uid),
            openTerritory: (id) => openTerritory(id),
            openApplications: () => setPage('territories'),
            openCrm: () => setDataPanelOpen(true),
          })
        : [],
    [output, openApplicant, openTerritory, setPage, setDataPanelOpen],
  );

  if (!output || !parse) {
    return (
      <Card>
        <EmptyState
          title="No applications loaded"
          body="Upload the Applications and Territories workbook, or try the sample batch of 200 applicants."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => setDataPanelOpen(true)}>
                Upload a file
              </Button>
              <Button onClick={() => void loadSample()}>Load sample data</Button>
            </div>
          }
        />
      </Card>
    );
  }

  const { summary } = output;
  const approved = summary.byDecision.Approve + summary.byDecision['Approve with conditions'];
  const holds = summary.byDecision.Hold;
  const territories = output.territories.length;
  const storeCount = parse.stores.length;

  const summaryLine = [
    `${fmtInt(summary.total)} applications for ${fmtInt(summary.slotsTotal)} open ${summary.slotsTotal === 1 ? 'slot' : 'slots'} across ${territories} ${territories === 1 ? 'territory' : 'territories'}.`,
    `${approved} ${approved === 1 ? 'partner' : 'partners'} approved${holds ? `, ${holds} need information from you` : ''}.`,
  ].join(' ');

  const source =
    demandSource?.source === 'supabase'
      ? 'Demand: simulated online orders, read live from Supabase.'
      : 'Demand: simulated online orders, bundled copy (live source not reachable).';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="break-words text-xl font-semibold tracking-tight text-ink">Franchise applications — {parse.source.fileName}</h1>
        <p className="mt-1 text-sm text-muted">{summaryLine}</p>
      </header>

      <Card>
        <CardHeader
          title="Where this batch is"
          subtitle="Every application goes through the same six steps. Select a step to see the applications."
        />
        <div className="p-2 sm:p-3">
          <ProcessStages stages={stages} onOpen={() => setPage('territories')} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Your next steps" subtitle="Do these in order. Everything else was decided by the rulebook and needs no action." />
        <NextSteps items={steps} />
      </Card>

      <div className="flex flex-col gap-1 px-1 text-xs text-muted sm:flex-row sm:flex-wrap sm:gap-x-6">
        <span>
          Slots filled{' '}
          <span className="tabular font-medium text-ink">
            {summary.slotsFilled} of {summary.slotsTotal}
          </span>
        </span>
        <span>
          Pin conflicts <span className="tabular font-medium text-ink">{summary.pinConflicts}</span> (checked against {storeCount} existing{' '}
          {storeCount === 1 ? 'store' : 'stores'} and every approval)
        </span>
        <span>{source}</span>
        <span>Decisions as of {output.asOf}</span>
      </div>
    </div>
  );
}
