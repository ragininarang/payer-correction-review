import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Breadcrumbs, { BreadcrumbsItem } from '@atlaskit/breadcrumbs';
import Button from '@atlaskit/button/default/button';
import '@atlaskit/css-reset';
import Lozenge from '@atlaskit/lozenge/new/lozenge';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import SectionMessage from '@atlaskit/section-message';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';
import { buildProof } from '../domain/proof';
import type { CorrectionProof, LineObligation } from '../domain/types';
import { can, type AppRole, type ApprovalStatus, type ProjectionStatus } from '../domain/workflow';
import { baseInput, conflictingScopeInput, scopeCounterexample, withFinalReplacement, withLateReversal } from '../fixtures/demo';
import './style.css';

void setGlobalTheme({ light: 'light', dark: 'dark', colorMode: 'auto' });

type Step = 'missing' | 'corrected' | 'reversed' | 'challenged';
type Action = 'initialize' | 'addCorrection' | 'approve' | 'addReversal' | 'challenge' | 'reset';
type ClaimFilter = 'attention' | 'all' | 'corrected';

interface CaseView {
  step: Step;
  proof: CorrectionProof;
  approval: { status: ApprovalStatus; revision: number | null; proofHash: string | null };
  projectionStatus: ProjectionStatus;
  actorRole: AppRole;
  mode: 'local' | 'forge';
}
interface FollowUp {
  followUpId: string;
  revision: number;
  outcome: string;
  nextReviewDate: string;
  note: string;
  lineIds: string[];
  actorId: string;
  occurredAt: string;
}
interface HistoryEvent {
  eventId: string;
  revision: number;
  eventType: string;
  actorId: string;
  details: Record<string, unknown>;
  occurredAt: string;
}
interface PlatformSpikeView {
  runId: string;
  revision: number;
  status: 'queued' | 'running' | 'model-complete' | 'completed' | 'failed' | 'superseded';
  attempt: number;
  terminalReason: string | null;
  model: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicrousd: number | null;
  durationMs: number | null;
  toolCalls: number | null;
  graphSteps: number | null;
  finding: {
    payer: string;
    claimType: string;
    serviceDateStart: string;
    serviceDateEnd: string;
    inventoryRequired: boolean;
    needsHumanReview: boolean;
    summary: string;
  } | null;
  updatedAt: string;
}
interface WorkspaceResponse {
  case: CaseView | null;
  actorRole: AppRole;
  followUps?: FollowUp[];
  history?: HistoryEvent[];
  platformSpike?: PlatformSpikeView | null;
  development?: { recoveryTestEnabled?: boolean; platformSpikeEnabled?: boolean; openAiConfigured?: boolean };
}

function proofFor(step: Step): CorrectionProof {
  const input = step === 'missing' ? baseInput : step === 'corrected' ? withFinalReplacement()
    : step === 'reversed' ? withLateReversal(withFinalReplacement()) : conflictingScopeInput;
  return buildProof(input, step === 'challenged' ? [scopeCounterexample] : [], true);
}
function localCase(step: Step, approval?: CaseView['approval']): CaseView {
  const priorWasApproved = approval?.status === 'approved';
  return {
    step,
    proof: proofFor(step),
    approval: priorWasApproved ? { ...approval, status: 'invalidated' } : { status: 'unapproved', revision: null, proofHash: null },
    projectionStatus: priorWasApproved ? 'pending' : 'not-requested',
    actorRole: 'supervisor',
    mode: 'local',
  };
}
async function callForge<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@forge/bridge');
  return await invoke(method, payload) as T;
}
function isCaseView(value: unknown): value is CaseView {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CaseView>;
  return typeof item.step === 'string' && !!item.proof && !!item.approval && typeof item.projectionStatus === 'string' && typeof item.actorRole === 'string';
}
function isWorkspaceResponse(value: unknown): value is WorkspaceResponse {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkspaceResponse>;
  return typeof item.actorRole === 'string' && (item.case === null || isCaseView(item.case));
}
function currency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function sentence(value: string): string {
  const text = value.replaceAll('-', ' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}
function lineName(line: LineObligation): string { return `Claim ${line.claimId} · service line ${line.serviceLineNumber}`; }
function lineStatus(status: LineObligation['status']): string {
  if (status === 'corrected') return 'Corrected';
  if (status === 'missing') return 'Not found';
  if (status === 'amount-mismatch') return 'Amount differs';
  return 'Needs review';
}
function lineAppearance(status: LineObligation['status']): 'success' | 'danger' | 'warning' {
  return status === 'corrected' ? 'success' : status === 'ambiguous' ? 'danger' : 'warning';
}
function followUpLabel(value: string): string {
  return sentence(value === 'additional-information-requested' ? 'additional information requested'
    : value === 'correction-promised' ? 'correction promised'
      : value === 'payer-disputes-correction' ? 'payer disputes correction'
        : value === 'payer-researching' ? 'payer researching'
          : value === 'no-response' ? 'no response' : 'closed without pursuit');
}

function SourceList({ step }: { step: Step }) {
  return <div className="source-list">
    <article><div className="source-icon">C</div><div><strong>Submitted claims list</strong><span>13 service lines · Coverage confirmed</span></div><Lozenge appearance="success">Current</Lozenge></article>
    <article><div className="source-icon">N</div><div><strong>Payer correction notice</strong><span>Effective Oct 1–31, 2026</span></div><Lozenge appearance="success">Current</Lozenge></article>
    <article><div className="source-icon">P</div><div><strong>Original payment activity</strong><span>Imported Nov 1, 2026</span></div><Lozenge>Checked</Lozenge></article>
    <article><div className="source-icon">P</div><div><strong>Replacement payment activity</strong><span>{step === 'missing' ? 11 : 12} adjustments matched</span></div><Lozenge appearance="information">Updated</Lozenge></article>
    {step === 'reversed' && <article><div className="source-icon">R</div><div><strong>Late reversal activity</strong><span>Imported Nov 23, 2026 · Result changed</span></div><Lozenge appearance="removed">New</Lozenge></article>}
  </div>;
}

function ActivityTimeline({ view, followUp, history }: { view: CaseView; followUp: FollowUp | null; history: HistoryEvent[] }) {
  if (history.length > 0) {
    return <ol className="timeline">{history.map((item) => {
      const title = item.eventType === 'case-initialized' ? 'Correction review started'
        : item.eventType === 'evidence-revision-created' ? 'New evidence created an updated result'
          : item.eventType === 'payer-follow-up-recorded' ? 'Payer follow-up recorded'
            : item.eventType === 'proof-approved' ? 'Closure approved'
              : item.eventType === 'case-reset' ? 'Synthetic case reset'
                : item.eventType === 'role-mapped' ? 'App role changed' : sentence(item.eventType);
      const detail = item.eventType === 'payer-follow-up-recorded'
        ? `${followUpLabel(String(item.details.outcome ?? ''))} · Financial result unchanged`
        : item.eventType === 'evidence-revision-created'
          ? `Evidence version ${item.revision} · ${sentence(String(item.details.step ?? 'updated'))}`
          : `Evidence version ${item.revision}`;
      return <li key={item.eventId}><span className="timeline-dot" /><div><strong>{title}</strong><p>{detail}</p><small>{new Date(item.occurredAt).toLocaleString()}</small></div></li>;
    })}</ol>;
  }
  const reversed = view.proof.obligations.find((item) => item.lineId === 'L07');
  const items = [
    ['Submitted claims list accepted', '13 service lines available; inventory coverage confirmed', 'Automated validation · Evidence version 1'],
    ['Inclusion criteria confirmed', 'Service dates Oct 1–31 · 12 service lines included', 'Billing supervisor · Nov 22, 2026'],
    ['Payment activity checked', `${view.proof.correctedLineCount} of ${view.proof.expectedLineCount} included service lines currently match`, `Automated review · Evidence version ${view.proof.revision}`],
  ];
  if (followUp) items.push(['Payer follow-up recorded', `${followUpLabel(followUp.outcome)} · ${followUp.lineIds.length} selected service line${followUp.lineIds.length === 1 ? '' : 's'}`, `Provider relations · Next review ${followUp.nextReviewDate}`]);
  if (view.approval.revision) items.push([view.approval.status === 'invalidated' ? 'Earlier closure approval invalidated' : 'Closure approved', view.approval.status === 'invalidated' ? 'New payment activity changed the result' : `Evidence version ${view.approval.revision} was approved`, 'Billing supervisor · Audit history retained']);
  if (view.step === 'reversed' && reversed) items.push(['Late reversal reopened the review', `${lineName(reversed)} no longer matches the expected payment`, 'Automated review · Evidence version 3']);
  if (view.step === 'challenged') items.push(['Potential inclusion issue needs review', 'A service line outside the date range may be covered by another payer notice', 'Automated review · Human decision required']);
  return <ol className="timeline">{items.map(([title, detail, meta]) => <li key={`${title}-${meta}`}><span className="timeline-dot" /><div><strong>{title}</strong><p>{detail}</p><small>{meta}</small></div></li>)}</ol>;
}

function App() {
  const [view, setView] = useState<CaseView>(() => localCase('missing'));
  const [hasCase, setHasCase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'danger' | 'information'>('information');
  const [forgeMode] = useState(() => window.parent !== window);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState<string | null>('L12');
  const [filter, setFilter] = useState<ClaimFilter>('attention');
  const [search, setSearch] = useState('');
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(() => new Set());
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [recoveryTestEnabled, setRecoveryTestEnabled] = useState(false);
  const [platformSpikeEnabled, setPlatformSpikeEnabled] = useState(false);
  const [openAiConfigured, setOpenAiConfigured] = useState(false);
  const [platformSpike, setPlatformSpike] = useState<PlatformSpikeView | null>(null);

  useEffect(() => {
    if (!forgeMode) return;
    setBusy(true);
    callForge<WorkspaceResponse>('getCase').then((result) => {
      if (!isWorkspaceResponse(result)) throw new Error('The app returned an invalid workspace response.');
      setRecoveryTestEnabled(result.development?.recoveryTestEnabled === true);
      setPlatformSpikeEnabled(result.development?.platformSpikeEnabled === true);
      setOpenAiConfigured(result.development?.openAiConfigured === true);
      setPlatformSpike(result.platformSpike ?? null);
      if (result.case) { setView({ ...result.case, mode: 'forge' }); setHasCase(true); setFollowUps(result.followUps ?? []); setHistory(result.history ?? []); }
      else { setView((current) => ({ ...current, actorRole: result.actorRole, mode: 'forge' })); setHasCase(false); }
    }).catch((error: unknown) => showMessage(error instanceof Error ? error.message : 'Unable to load this correction review.', 'danger')).finally(() => setBusy(false));
  }, [forgeMode]);

  useEffect(() => {
    if (!forgeMode || !platformSpike || !['queued', 'running', 'model-complete'].includes(platformSpike.status)) return;
    const timer = window.setInterval(() => {
      void callForge<WorkspaceResponse>('getCase').then((workspace) => {
        setPlatformSpike(workspace.platformSpike ?? null);
        setHistory(workspace.history ?? []);
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [forgeMode, platformSpike?.status, platformSpike?.runId]);

  function showMessage(text: string, tone: 'success' | 'danger' | 'information' = 'information') { setMessage(text); setMessageTone(tone); }
  async function act(action: Action) {
    setMessage('');
    if (!forgeMode) {
      if (action === 'initialize' || action === 'reset') { setView(localCase('missing', view.approval)); setHasCase(true); setSelectedLineId('L12'); setSelectedLineIds(new Set()); if (action === 'initialize') setFollowUps([]); showMessage(action === 'reset' ? 'The synthetic case was reset. Earlier history remains available.' : 'Correction review started.', 'success'); }
      if (action === 'addCorrection') { setView(localCase('corrected', view.approval)); setSelectedLineId(null); showMessage('Replacement payment activity was accepted and checked.', 'success'); }
      if (action === 'approve' && view.proof.status === 'eligible') { setView({ ...view, approval: { status: 'approved', revision: view.proof.revision, proofHash: view.proof.inputHash }, projectionStatus: 'pending' }); showMessage('Closure approved. The Jira update is pending.', 'success'); }
      if (action === 'addReversal') { setView(localCase('reversed', view.approval)); setSelectedLineId('L07'); showMessage('New reversal activity reopened the review.', 'information'); }
      if (action === 'challenge') { setView(localCase('challenged', view.approval)); setSelectedLineId(null); showMessage('A potential inclusion issue needs a human decision.', 'information'); }
      setApprovalOpen(false); setEvidenceOpen(false); setResetOpen(false); return;
    }
    const payload = action === 'approve' ? { expectedRevision: view.proof.revision, proofHash: view.proof.inputHash }
      : action === 'reset' ? { expectedRevision: view.proof.revision, confirmation: 'RESET CASE' }
        : action === 'initialize' ? {} : { expectedRevision: view.proof.revision };
    setBusy(true);
    try {
      const result = await callForge<CaseView>(action, payload);
      if (!isCaseView(result)) throw new Error('The app returned an invalid case response.');
      setView({ ...result, mode: 'forge' }); setHasCase(true); setApprovalOpen(false); setEvidenceOpen(false); setResetOpen(false);
      try {
        const workspace = await callForge<WorkspaceResponse>('getCase');
        setFollowUps(workspace.followUps ?? []);
        setHistory(workspace.history ?? []);
      } catch {
        showMessage('The update was saved, but recent history could not be reloaded. Refresh to try again.', 'information');
        return;
      }
      showMessage(action === 'approve' ? 'Closure approved. The Jira update will be tracked separately.' : 'The correction review was updated.', 'success');
    } catch (error: unknown) { showMessage(error instanceof Error ? error.message : 'The action failed. No financial result was changed.', 'danger'); }
    finally { setBusy(false); }
  }

  const attentionCount = view.proof.obligations.filter((item) => item.status !== 'corrected').length + view.proof.findings.filter((item) => item.outcome !== 'refuted').length;
  const currentApproval = view.approval.status === 'approved' && view.approval.revision === view.proof.revision && view.approval.proofHash === view.proof.inputHash;
  const selectedLine = view.proof.obligations.find((item) => item.lineId === selectedLineId) ?? null;
  const claims = useMemo(() => view.proof.obligations.filter((item) => {
    if (filter === 'attention' && item.status === 'corrected') return false;
    if (filter === 'corrected' && item.status !== 'corrected') return false;
    const query = search.trim().toLowerCase();
    return !query || item.claimId.toLowerCase().includes(query) || item.procedureCode.includes(query);
  }), [view.proof.obligations, filter, search]);
  const caseStatus = view.approval.status === 'invalidated' ? { label: 'Reopened', appearance: 'removed' as const }
    : currentApproval && view.projectionStatus === 'pending' ? { label: 'Approved · Jira update pending', appearance: 'information' as const }
      : currentApproval ? { label: 'Approved', appearance: 'success' as const }
        : view.proof.status === 'eligible' ? { label: 'Ready for closure', appearance: 'success' as const }
          : { label: 'Needs review', appearance: 'moved' as const };
  const nextAction = view.proof.status === 'eligible' && !currentApproval ? 'Review for closure' : view.approval.status === 'invalidated' ? 'Review what changed' : attentionCount > 0 ? 'Review claims' : 'View review history';
  function primaryAction() {
    if (view.proof.status === 'eligible' && !currentApproval) { setApprovalOpen(true); return; }
    if (attentionCount > 0 || view.approval.status === 'invalidated') { setFilter('attention'); setSelectedTab(1); return; }
    setSelectedTab(4);
  }
  function toggleLine(id: string) { setSelectedLineIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function prepareFollowUp() {
    if (!selectedLineIds.size) { showMessage('Select at least one service line before preparing payer follow-up.', 'danger'); return; }
    setSelectedTab(3); showMessage(`${selectedLineIds.size} service line${selectedLineIds.size === 1 ? '' : 's'} added to payer follow-up.`);
  }
  async function saveFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const outcome = String(data.get('outcome') || '');
    const nextReviewDate = String(data.get('nextReviewDate') || '');
    const note = String(data.get('note') || '');
    if (!outcome || !nextReviewDate) { showMessage('Choose an outcome and next review date.', 'danger'); return; }
    if (!forgeMode) {
      setFollowUps((current) => [{ followUpId: crypto.randomUUID(), revision: view.proof.revision, outcome, nextReviewDate, note, lineIds: [...selectedLineIds], actorId: 'local-supervisor', occurredAt: new Date().toISOString() }, ...current]);
      showMessage('Payer follow-up was recorded. The financial result did not change.', 'success'); return;
    }
    setBusy(true);
    try {
      const saved = await callForge<FollowUp>('recordFollowUp', { expectedRevision: view.proof.revision, outcome, nextReviewDate, note, lineIds: [...selectedLineIds] });
      setFollowUps((current) => [saved, ...current]);
      setHistory((current) => [...current, {
        eventId: `followup:${saved.followUpId}`,
        revision: saved.revision,
        eventType: 'payer-follow-up-recorded',
        actorId: saved.actorId,
        details: { outcome: saved.outcome, lineIds: saved.lineIds, financialResultChanged: false },
        occurredAt: saved.occurredAt,
      }]);
      showMessage('Payer follow-up was recorded. The financial result did not change.', 'success');
    } catch (error: unknown) { showMessage(error instanceof Error ? error.message : 'Payer follow-up could not be saved.', 'danger'); }
    finally { setBusy(false); }
  }

  async function testInterruptedRecovery() {
    if (!forgeMode) return;
    setBusy(true); setMessage('');
    try {
      await callForge('injectPendingCorrection', { expectedRevision: view.proof.revision });
      const recovered = await callForge<CaseView>('runRecoveryTest');
      if (!isCaseView(recovered)) throw new Error('The recovery test returned an invalid case response.');
      setView({ ...recovered, mode: 'forge' });
      const workspace = await callForge<WorkspaceResponse>('getCase');
      setHistory(workspace.history ?? []);
      showMessage('Recovery test passed: a separate invocation completed the interrupted evidence update exactly once.', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : 'The controlled recovery test failed.', 'danger');
    } finally { setBusy(false); }
  }

  async function startPlatformSpike() {
    if (!forgeMode) return;
    setBusy(true); setMessage('');
    try {
      const result = await callForge<PlatformSpikeView>('startPlatformSpike');
      setPlatformSpike(result);
      showMessage(result.status === 'completed'
        ? 'The existing platform test is already complete for this evidence version.'
        : 'The bounded platform test is queued. This does not change the financial result.', 'information');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : 'The platform test could not be started.', 'danger');
    } finally { setBusy(false); }
  }

  const latestFollowUp = followUps[0] ?? null;

  if (!hasCase) return <main className="empty-shell"><div className="product-mark">PCR</div><h1>No correction review yet</h1><p>Start a review for this Jira work item using synthetic claims and payment activity. No payer will be contacted.</p><Button appearance="primary" isDisabled={busy || !can(view.actorRole, 'initialize')} onClick={() => void act('initialize')}>Start correction review</Button></main>;

  return <main className="app-shell">
    <header className="page-header"><Breadcrumbs><BreadcrumbsItem text="Payer correction reviews" /><BreadcrumbsItem text="PCR-1042" /></Breadcrumbs><div className="title-row"><div><div className="title-with-status"><h1>October payment correction</h1><Lozenge appearance={caseStatus.appearance}>{caseStatus.label}</Lozenge></div><p>Payer Demo · Professional claims · Evidence checked through Nov 22, 2026</p></div><div className="header-actions"><Button onClick={() => setEvidenceOpen(true)}>Add evidence</Button><Button appearance="primary" onClick={primaryAction}>{nextAction}</Button></div></div><div className="case-meta"><span>Jira work item <strong>PCR-1042</strong></span><span>Evidence version <strong>{view.proof.revision}</strong></span><span>Your role <strong>{sentence(view.actorRole)}</strong></span><span><strong>Synthetic data only</strong></span></div></header>
    {message && <div role="status" className={`message-bar ${messageTone}`}>{message}<button aria-label="Dismiss message" onClick={() => setMessage('')}>×</button></div>}
    <Tabs id="case-workspace" selected={selectedTab} onChange={setSelectedTab}><TabList><Tab>Summary</Tab><Tab>Claims {attentionCount ? `(${attentionCount})` : ''}</Tab><Tab>Included claims and evidence</Tab><Tab>Payer follow-up</Tab><Tab>Review history</Tab></TabList>
      <TabPanel><div className="tab-content overview-grid"><section className="main-column">
        {view.approval.status === 'invalidated' ? <SectionMessage appearance="warning" title="New payment activity reopened this review"><p>An earlier closure approval is no longer current. Review the affected claim before approving again.</p></SectionMessage> : attentionCount ? <SectionMessage appearance="warning" title={`${attentionCount} service line${attentionCount === 1 ? ' needs' : 's need'} review`}><p>Resolve the missing, different, or uncertain results before this correction review can close.</p></SectionMessage> : currentApproval ? <SectionMessage appearance="success" title="Closure is approved"><p>The financial decision is current. The Jira update is {sentence(view.projectionStatus).toLowerCase()}.</p></SectionMessage> : <SectionMessage appearance="information" title="Ready for closure"><p>All included service lines match the expected payment. A billing supervisor must approve this evidence version.</p></SectionMessage>}
        <div className="section-heading"><div><h2>Correction result</h2><p>Based on the submitted claims list and accepted payment activity</p></div><Button appearance="subtle" onClick={() => { setFilter('all'); setSelectedTab(1); }}>View claims</Button></div>
        <div className="result-list"><button onClick={() => { setFilter('all'); setSelectedTab(1); }}><span>Included service lines</span><strong>{view.proof.expectedLineCount}</strong><small>From the confirmed claims list</small></button><button onClick={() => { setFilter('corrected'); setSelectedTab(1); }}><span>Corrected as expected</span><strong>{view.proof.correctedLineCount}</strong><small>Payment activity matches</small></button><button onClick={() => { setFilter('attention'); setSelectedTab(1); }}><span>Needs review</span><strong>{attentionCount}</strong><small>Missing, different, or uncertain</small></button><div><span>Amount still unresolved</span><strong>{currency(view.proof.unresolvedCents)}</strong><small>Known difference; not recovered cash</small></div></div>
        <div className="section-heading"><div><h2>Recommended next step</h2><p>What the current evidence supports</p></div></div><div className="next-action-card"><div className="next-number">1</div><div><strong>{nextAction}</strong><p>{view.proof.status === 'eligible' ? 'Check the counts and evidence version before approving closure.' : 'Open the affected claim and decide what information is needed.'}</p></div><Button appearance="primary" onClick={primaryAction}>{nextAction}</Button></div>
      </section><aside className="context-column"><section><h2>Review details</h2><dl><div><dt>Correction review</dt><dd><Lozenge appearance={caseStatus.appearance}>{caseStatus.label}</Lozenge></dd></div><div><dt>Supervisor approval</dt><dd>{view.approval.status === 'unapproved' ? 'Not approved' : sentence(view.approval.status)}</dd></div><div><dt>Jira update</dt><dd>{view.projectionStatus === 'not-requested' ? 'Not started' : sentence(view.projectionStatus)}</dd></div><div><dt>Claims-list coverage</dt><dd>Confirmed</dd></div><div><dt>Included dates</dt><dd>Oct 1–31, 2026</dd></div></dl></section><section><h2>Progress</h2><ol className="workflow"><li className="done">Documents accepted</li><li className="done">Inclusion criteria confirmed</li><li className="done">Payment activity checked</li><li className={view.proof.status === 'challenged' ? 'current' : 'done'}>Potential issues checked</li><li className={currentApproval ? 'done' : 'current'}>Supervisor closure decision</li></ol></section></aside></div></TabPanel>

      <TabPanel><div className="tab-content"><div className="section-heading"><div><h2>Claims</h2><p>Review included service lines and prepare unresolved items for payer follow-up</p></div>{selectedLineIds.size > 0 && <Button appearance="primary" onClick={prepareFollowUp}>Prepare payer follow-up ({selectedLineIds.size})</Button>}</div><div className="claim-toolbar"><label className="search-field"><span className="sr-only">Search claims</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search claim ID or procedure code" /></label><div className="filter-group"><Button appearance={filter === 'attention' ? 'primary' : 'default'} onClick={() => setFilter('attention')}>Needs review</Button><Button appearance={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')}>All</Button><Button appearance={filter === 'corrected' ? 'primary' : 'default'} onClick={() => setFilter('corrected')}>Corrected</Button></div></div>
        <div className="exception-workspace"><div className="table-container"><table><thead><tr><th><span className="sr-only">Select</span></th><th>Claim and service line</th><th>Service</th><th>Expected</th><th>Observed</th><th>Status</th></tr></thead><tbody>{claims.map((item) => <tr key={item.lineId} className={selectedLineId === item.lineId ? 'selected-row' : ''} onClick={() => setSelectedLineId(item.lineId)}><td><input aria-label={`Select ${lineName(item)}`} type="checkbox" checked={selectedLineIds.has(item.lineId)} onChange={() => toggleLine(item.lineId)} onClick={(event) => event.stopPropagation()} /></td><td><button className="line-link" onClick={() => setSelectedLineId(item.lineId)}>{item.claimId}<span>Service line {item.serviceLineNumber}</span></button></td><td>{dateLabel(item.serviceDate)}<span className="cell-subtext">Procedure {item.procedureCode}</span></td><td>{currency(item.expectedNetCents)}</td><td>{item.observedNetCents === null ? 'Unknown' : currency(item.observedNetCents)}</td><td><Lozenge appearance={lineAppearance(item.status)}>{lineStatus(item.status)}</Lozenge></td></tr>)}</tbody></table>{!claims.length && <div className="table-empty"><h3>No claims match</h3><p>Clear the search or choose another filter.</p><Button onClick={() => { setSearch(''); setFilter('all'); }}>Show all claims</Button></div>}</div>
          <aside className="line-panel">{selectedLine ? <><div><span className="overline">Claim details</span><h2>{selectedLine.claimId}</h2><Lozenge appearance={lineAppearance(selectedLine.status)}>{lineStatus(selectedLine.status)}</Lozenge><p className="panel-subtitle">Service line {selectedLine.serviceLineNumber} · {dateLabel(selectedLine.serviceDate)} · Procedure {selectedLine.procedureCode}</p></div><dl><div><dt>Expected payment</dt><dd>{currency(selectedLine.expectedNetCents)}</dd></div><div><dt>Payment found</dt><dd>{selectedLine.observedNetCents === null ? 'Unknown' : currency(selectedLine.observedNetCents)}</dd></div><div><dt>Amount still unresolved</dt><dd>{currency(Math.max(0, selectedLine.expectedNetCents - (selectedLine.observedNetCents ?? 0)))}</dd></div></dl><div className="reason"><strong>Why this result</strong><p>{selectedLine.status === 'corrected' ? 'Accepted payment activity matches the expected amount.' : selectedLine.status === 'missing' ? 'No replacement payment was found before the evidence cutoff.' : selectedLine.status === 'ambiguous' ? 'The reversal or adjustment relationship cannot be confirmed.' : 'The payment found does not match the expected amount.'}</p></div><div className="evidence-chain"><strong>Documents checked</strong><button><span>Submitted claims list</span><small>Current</small></button>{selectedLine.eventIds.length > 0 && <button><span>Payment activity</span><small>{selectedLine.eventIds.length} record{selectedLine.eventIds.length === 1 ? '' : 's'}</small></button>}</div><Button shouldFitContainer onClick={() => toggleLine(selectedLine.lineId)}>{selectedLineIds.has(selectedLine.lineId) ? 'Remove from payer follow-up' : 'Add to payer follow-up'}</Button></> : <div className="panel-empty"><h3>Select a claim</h3><p>Choose a row to see its payment result and documents checked.</p></div>}</aside></div></div></TabPanel>

      <TabPanel><div className="tab-content split-page"><section className="main-column"><div className="section-heading"><div><h2>Included claims and evidence</h2><p>See why claims are included and which documents support the review</p></div><Button onClick={() => setEvidenceOpen(true)}>Add evidence</Button></div><SourceList step={view.step} /></section><aside className="context-column"><section><h2>Confirmed inclusion criteria</h2><dl><div><dt>Payer</dt><dd>Payer Demo</dd></div><div><dt>Service dates</dt><dd>Oct 1–31, 2026</dd></div><div><dt>Starting list</dt><dd>Submitted claims</dd></div><div><dt>Expected payment</dt><dd>$100.00 per service line</dd></div><div><dt>Confirmed by</dt><dd>Billing supervisor</dd></div></dl><Button appearance="subtle" onClick={() => setCriteriaOpen(true)}>View criteria and cited notice</Button></section><SectionMessage appearance="information" title="Payment files do not decide which claims are included"><p>The claims list and confirmed payer notice define the included service lines before payment activity is checked.</p></SectionMessage></aside></div></TabPanel>

      <TabPanel><div className="tab-content follow-up-page"><div className="section-heading"><div><h2>Payer follow-up</h2><p>Record contact about unresolved items. A note never changes the financial result.</p></div></div>{!selectedLineIds.size ? <div className="empty-state"><h3>No claims selected</h3><p>Select unresolved service lines from Claims before preparing payer follow-up.</p>{latestFollowUp && <p>Most recent: {followUpLabel(latestFollowUp.outcome)} · Next review {latestFollowUp.nextReviewDate}</p>}<Button appearance="primary" onClick={() => { setFilter('attention'); setSelectedTab(1); }}>Choose claims</Button></div> : <div className="follow-up-grid"><section className="selected-claims"><h3>Selected for follow-up</h3>{view.proof.obligations.filter((item) => selectedLineIds.has(item.lineId)).map((item) => <article key={item.lineId}><div><strong>{lineName(item)}</strong><span>{dateLabel(item.serviceDate)} · Procedure {item.procedureCode}</span></div><span>{currency(Math.max(0, item.expectedNetCents - (item.observedNetCents ?? 0)))} unresolved</span></article>)}</section><form className="follow-up-form" onSubmit={(event) => void saveFollowUp(event)}><h3>Record payer contact</h3><label>Outcome<select name="outcome" defaultValue={latestFollowUp?.outcome ?? ''}><option value="" disabled>Choose an outcome</option><option value="payer-researching">Payer researching</option><option value="additional-information-requested">Additional information requested</option><option value="correction-promised">Correction promised</option><option value="payer-disputes-correction">Payer disputes correction</option><option value="no-response">No response</option><option value="closed-without-pursuit">Stop pursuing internally</option></select></label><label>Next review date<input name="nextReviewDate" type="date" defaultValue={latestFollowUp?.nextReviewDate ?? '2026-11-30'} /></label><label>Internal note<textarea name="note" rows={4} defaultValue={latestFollowUp?.note ?? ''} placeholder="What should the next person know?" /></label><SectionMessage appearance="information"><p>Saving this contact does not mark claims as paid. “Stop pursuing” also leaves the amount financially unresolved.</p></SectionMessage><Button appearance="primary" type="submit" isDisabled={busy}>Save payer follow-up</Button></form></div>}</div></TabPanel>

      <TabPanel><div className="tab-content activity-page"><div className="section-heading"><div><h2>Review history</h2><p>Who or what changed the review, in order</p></div></div><ActivityTimeline view={view} followUp={latestFollowUp} history={history} /><section className="technical-disclosure"><button className="disclosure-button" onClick={() => setTechnicalOpen(!technicalOpen)} aria-expanded={technicalOpen}><span>Technical and automation details</span><span>{technicalOpen ? 'Hide' : 'Show'}</span></button>{technicalOpen && <div className="technical-body"><dl><div><dt>Internal case</dt><dd>{view.proof.caseId}</dd></div><div><dt>Evidence version</dt><dd>{view.proof.revision}</dd></div><div><dt>Technical identifier</dt><dd className="hash">{view.proof.inputHash}</dd></div><div><dt>Automated run</dt><dd>{platformSpike ? sentence(platformSpike.status) : 'Not started'}</dd></div>{platformSpike?.model && <div><dt>Model</dt><dd>{platformSpike.model}</dd></div>}{platformSpike?.durationMs !== null && platformSpike?.durationMs !== undefined && <div><dt>Run time</dt><dd>{(platformSpike.durationMs / 1000).toFixed(2)} seconds</dd></div>}{platformSpike?.estimatedCostMicrousd !== null && platformSpike?.estimatedCostMicrousd !== undefined && <div><dt>Estimated model cost</dt><dd>${(platformSpike.estimatedCostMicrousd / 1_000_000).toFixed(6)}</dd></div>}</dl>{platformSpike?.finding && <SectionMessage appearance="success" title="Bounded extraction completed"><p>{platformSpike.finding.summary}</p><p>One allowlisted source read · {platformSpike.inputTokens ?? 0} input tokens · {platformSpike.outputTokens ?? 0} output tokens</p></SectionMessage>}<p className="subtle-copy">Operators use this area to diagnose bounded automated runs. These tests cannot approve closure or change the financial result.</p><div className="technical-actions">{recoveryTestEnabled && <Button isDisabled={busy || view.step !== 'missing' || !can(view.actorRole, 'test-recovery')} onClick={() => void testInterruptedRecovery()}>Test interrupted recovery</Button>}{platformSpikeEnabled && <Button isDisabled={busy || !openAiConfigured || !can(view.actorRole, 'run-platform-spike')} onClick={() => void startPlatformSpike()}>{platformSpike && ['queued', 'running', 'model-complete'].includes(platformSpike.status) ? 'Platform test running' : 'Run bounded platform test'}</Button>}</div>{platformSpikeEnabled && !openAiConfigured && <p className="subtle-copy">An encrypted OpenAI key must be configured before this test can run.</p>}</div>}</section><div className="demo-controls"><button className="demo-toggle" onClick={() => setDemoOpen(!demoOpen)}><span>Demo scenario controls</span><small>{demoOpen ? 'Hide' : 'Show'} synthetic state changes</small></button>{demoOpen && <div className="demo-actions"><Button onClick={() => void act('addCorrection')}>Import final correction</Button><Button onClick={() => void act('addReversal')}>Import late reversal</Button><Button onClick={() => void act('challenge')}>Find inclusion conflict</Button><Button appearance="danger" onClick={() => setResetOpen(true)}>Reset synthetic case</Button></div>}</div></div></TabPanel>
    </Tabs>

    <ModalTransition>{evidenceOpen && <Modal onClose={() => setEvidenceOpen(false)}><ModalHeader><ModalTitle>Add payment evidence</ModalTitle></ModalHeader><ModalBody><p>The app checks access, identity, format, duplicates, and conflicts before updating the result.</p><div className="source-choice selected"><div><strong>Replacement payment activity</strong><span>Synthetic remittance file · 12 adjustments</span></div><Lozenge appearance="success">Ready</Lozenge></div><SectionMessage appearance="information" title="Required documents must be valid first"><p>This creates a new evidence version. If the result changes, any current closure approval is invalidated.</p></SectionMessage></ModalBody><ModalFooter><Button appearance="subtle" onClick={() => setEvidenceOpen(false)}>Cancel</Button><Button appearance="primary" isDisabled={busy || view.step !== 'missing'} onClick={() => void act('addCorrection')}>{view.step === 'missing' ? 'Add and check evidence' : 'Evidence already added'}</Button></ModalFooter></Modal>}</ModalTransition>
    <ModalTransition>{criteriaOpen && <Modal onClose={() => setCriteriaOpen(false)}><ModalHeader><ModalTitle>Inclusion criteria</ModalTitle></ModalHeader><ModalBody><p>These criteria decide which submitted service lines should have received the payer correction.</p><dl className="modal-summary"><div><dt>Payer</dt><dd>Payer Demo</dd></div><div><dt>Service dates</dt><dd>Oct 1–31, 2026</dd></div><div><dt>Included</dt><dd>12 service lines</dd></div><div><dt>Excluded</dt><dd>1 service line</dd></div></dl><div className="quoted-source"><strong>Cited payer notice</strong><p>“Professional claims with dates of service from October 1 through October 31, 2026 are included in this correction.”</p></div><p className="subtle-copy">Changing these criteria must show the population difference and create a new evidence version.</p></ModalBody><ModalFooter><Button appearance="primary" onClick={() => setCriteriaOpen(false)}>Done</Button></ModalFooter></Modal>}</ModalTransition>
    <ModalTransition>{approvalOpen && <Modal onClose={() => setApprovalOpen(false)}><ModalHeader><ModalTitle>Review for closure</ModalTitle></ModalHeader><ModalBody><p>You are approving the financial result for this exact evidence version. New evidence will reopen the review if it changes the result.</p><dl className="modal-summary"><div><dt>Included service lines</dt><dd>{view.proof.expectedLineCount}</dd></div><div><dt>Corrected as expected</dt><dd>{view.proof.correctedLineCount}</dd></div><div><dt>Amount still unresolved</dt><dd>{currency(view.proof.unresolvedCents)}</dd></div><div><dt>Evidence version</dt><dd>{view.proof.revision}</dd></div></dl><details><summary>Technical identifier</summary><p className="hash">{view.proof.inputHash}</p></details></ModalBody><ModalFooter><Button appearance="subtle" onClick={() => setApprovalOpen(false)}>Cancel</Button><Button appearance="primary" isDisabled={busy} onClick={() => void act('approve')}>Approve closure</Button></ModalFooter></Modal>}</ModalTransition>
    <ModalTransition>{resetOpen && <Modal onClose={() => setResetOpen(false)}><ModalHeader><ModalTitle>Reset this synthetic case?</ModalTitle></ModalHeader><ModalBody><SectionMessage appearance="warning" title="This starts a new demo evidence version"><p>The current result and selections return to the starting scenario. Earlier evidence, follow-up, approvals, and audit history remain inspectable.</p></SectionMessage></ModalBody><ModalFooter><Button appearance="subtle" onClick={() => setResetOpen(false)}>Cancel</Button><Button appearance="danger" onClick={() => void act('reset')}>Reset synthetic case</Button></ModalFooter></Modal>}</ModalTransition>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
