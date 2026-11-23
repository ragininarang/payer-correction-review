import { useEffect, useMemo, useState } from 'react';
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

interface CaseView {
  step: Step;
  proof: CorrectionProof;
  approval: { status: ApprovalStatus; revision: number | null; proofHash: string | null };
  projectionStatus: ProjectionStatus;
  actorRole: AppRole;
  mode: 'local' | 'forge';
}

interface WorkspaceResponse { case: CaseView | null; actorRole: AppRole }

function proofFor(step: Step): CorrectionProof {
  const input = step === 'missing' ? baseInput : step === 'corrected' ? withFinalReplacement()
    : step === 'reversed' ? withLateReversal(withFinalReplacement()) : conflictingScopeInput;
  return buildProof(input, step === 'challenged' ? [scopeCounterexample] : [], true);
}

function localCase(step: Step, approval?: CaseView['approval']): CaseView {
  const proof = proofFor(step);
  const priorWasApproved = approval?.status === 'approved';
  return {
    step,
    proof,
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
  const candidate = value as Partial<CaseView>;
  return typeof candidate.step === 'string' && typeof candidate.proof === 'object' && candidate.proof !== null
    && typeof candidate.approval === 'object' && candidate.approval !== null
    && typeof candidate.projectionStatus === 'string' && typeof candidate.actorRole === 'string';
}

function isWorkspaceResponse(value: unknown): value is WorkspaceResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceResponse>;
  return typeof candidate.actorRole === 'string' && (candidate.case === null || isCaseView(candidate.case));
}

function currency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function sentence(value: string): string {
  const normalized = value.replaceAll('-', ' ');
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function proofAppearance(status: CorrectionProof['status']): 'success' | 'danger' | 'warning' {
  return status === 'eligible' ? 'success' : status === 'challenged' ? 'danger' : 'warning';
}

function approvalAppearance(status: ApprovalStatus): 'success' | 'danger' | 'default' {
  return status === 'approved' ? 'success' : status === 'invalidated' ? 'danger' : 'default';
}

function obligationAppearance(status: LineObligation['status']): 'success' | 'danger' | 'warning' {
  return status === 'corrected' ? 'success' : status === 'ambiguous' ? 'danger' : 'warning';
}

function SourceList() {
  return <div className="source-list">
    <article><div className="source-icon">I</div><div><strong>Submitted claims inventory</strong><span>submitted-claims-v1 · 13 lines · Complete</span></div><Lozenge appearance="success">Current</Lozenge></article>
    <article><div className="source-icon">N</div><div><strong>Payer correction notice</strong><span>payer-notice-v1 · Effective Oct 1–31, 2026</span></div><Lozenge appearance="success">Current</Lozenge></article>
    <article><div className="source-icon">R</div><div><strong>Original remittance</strong><span>original-era-v1 · Imported Nov 1, 2026</span></div><Lozenge>Verified</Lozenge></article>
    <article><div className="source-icon">R</div><div><strong>Replacement remittance</strong><span>replacement-era-v1 · 12 linked adjustments</span></div><Lozenge appearance="information">Updated</Lozenge></article>
  </div>;
}

function ActivityTimeline({ view }: { view: CaseView }) {
  const items = [
    { title: 'Independent inventory registered', detail: '13 submitted lines · source submitted-claims-v1', meta: 'Deterministic intake · Revision 1' },
    { title: 'Scope rule confirmed', detail: 'Service dates Oct 1–31 · 12 lines included', meta: 'Billing supervisor · approved-rule-v1' },
    { title: 'Replacement evidence reconciled', detail: `${view.proof.correctedLineCount} of ${view.proof.expectedLineCount} expected lines currently pass`, meta: `Verification · Revision ${view.proof.revision}` },
  ];
  if (view.approval.revision) items.push({ title: view.approval.status === 'invalidated' ? 'Prior approval invalidated' : 'Proof approved', detail: `Approval is bound to revision ${view.approval.revision} and its fingerprint`, meta: 'Billing supervisor · append-only record' });
  if (view.step === 'reversed') items.push({ title: 'Late reversal changed the result', detail: 'Line L07 no longer satisfies its payment obligation', meta: 'Source late-reversal-era-v1 · Revision 3' });
  if (view.step === 'challenged') items.push({ title: 'Scope counterexample needs review', detail: 'An excluded line may fall within a conflicting notice', meta: 'Challenger · unresolved' });
  return <ol className="timeline">{items.map((item) => <li key={item.title}><span className="timeline-dot" /><div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.meta}</small></div></li>)}</ol>;
}

function App() {
  const [view, setView] = useState<CaseView>(() => localCase('missing'));
  const [hasCase, setHasCase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [forgeMode] = useState(() => window.parent !== window);
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState<string | null>('L12');
  const [exceptionFilter, setExceptionFilter] = useState<'attention' | 'all' | 'corrected'>('attention');
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    if (!forgeMode) return;
    setBusy(true);
    callForge<WorkspaceResponse>('getCase')
      .then((result) => {
        if (!isWorkspaceResponse(result)) throw new Error('The app returned an invalid workspace response.');
        if (result.case) {
          setView({ ...result.case, mode: 'forge' });
          setHasCase(true);
        } else {
          setView((current) => ({ ...current, actorRole: result.actorRole, mode: 'forge' }));
          setHasCase(false);
          setMessage('No review exists for this Jira work item.');
        }
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load this case.'))
      .finally(() => setBusy(false));
  }, [forgeMode]);

  async function act(action: Action) {
    setMessage('');
    if (!forgeMode) {
      if (action === 'initialize' || action === 'reset') { setView(localCase('missing', view.approval)); setHasCase(true); setSelectedLineId('L12'); }
      if (action === 'addCorrection') { setView(localCase('corrected', view.approval)); setSelectedLineId(null); }
      if (action === 'approve' && view.proof.status === 'eligible') setView({ ...view, approval: { status: 'approved', revision: view.proof.revision, proofHash: view.proof.inputHash }, projectionStatus: 'pending' });
      if (action === 'addReversal') { setView(localCase('reversed', view.approval)); setSelectedLineId('L07'); }
      if (action === 'challenge') { setView(localCase('challenged', view.approval)); setSelectedLineId('L13'); }
      setApprovalOpen(false);
      return;
    }
    const payload = action === 'approve' ? { expectedRevision: view.proof.revision, proofHash: view.proof.inputHash }
      : action === 'reset' ? { expectedRevision: view.proof.revision, confirmation: 'RESET CASE' }
        : action === 'initialize' ? {} : { expectedRevision: view.proof.revision };
    setBusy(true);
    try {
      const result = await callForge<CaseView>(action, payload);
      if (!isCaseView(result)) throw new Error('The app returned an invalid case response.');
      setView({ ...result, mode: 'forge' });
      setHasCase(true);
      setApprovalOpen(false);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'The action failed.');
    } finally { setBusy(false); }
  }

  const selectedLine = view.proof.obligations.find((item) => item.lineId === selectedLineId) ?? null;
  const exceptions = useMemo(() => view.proof.obligations.filter((item) => {
    if (exceptionFilter === 'attention') return item.status !== 'corrected';
    if (exceptionFilter === 'corrected') return item.status === 'corrected';
    return true;
  }), [view.proof.obligations, exceptionFilter]);
  const attentionCount = view.proof.obligations.filter((item) => item.status !== 'corrected').length + view.proof.findings.filter((item) => item.outcome !== 'refuted').length;
  const isCurrentApproval = view.approval.status === 'approved' && view.approval.revision === view.proof.revision && view.approval.proofHash === view.proof.inputHash;
  const nextAction = view.proof.status === 'eligible' && !isCurrentApproval ? 'Approve this proof'
    : view.approval.status === 'invalidated' ? 'Review changed evidence'
      : attentionCount > 0 ? 'Review exceptions' : 'View proof';

  function primaryAction() {
    if (view.proof.status === 'eligible' && !isCurrentApproval) return setApprovalOpen(true);
    if (view.approval.status === 'invalidated' || attentionCount > 0) { setSelectedTab(2); return; }
    setSelectedTab(3);
  }

  if (!hasCase) return <main className="empty-shell">
    <div className="product-mark">PCR</div><h1>No correction review yet</h1><p>Initialize a synthetic case from this Jira work item. No model call or payer communication will occur.</p>
    <Button appearance="primary" isDisabled={busy || !can(view.actorRole, 'initialize')} onClick={() => void act('initialize')}>Initialize review</Button>
    {message && <p role="status" className="inline-error">{message}</p>}
  </main>;

  return <main className="app-shell">
    <header className="page-header">
      <Breadcrumbs><BreadcrumbsItem text="Payer correction reviews" /><BreadcrumbsItem text="PCR-1042" /></Breadcrumbs>
      <div className="title-row">
        <div><div className="title-with-status"><h1>October payment correction</h1><Lozenge appearance={proofAppearance(view.proof.status)}>{sentence(view.proof.status)}</Lozenge></div><p>Payer Demo · Professional claims · Updated through Nov 22, 2026</p></div>
        <div className="header-actions"><Button onClick={() => setSelectedTab(1)}>Add evidence</Button><Button appearance="primary" isDisabled={busy || (view.proof.status === 'eligible' && !can(view.actorRole, 'approve'))} onClick={primaryAction}>{nextAction}</Button></div>
      </div>
      <div className="case-meta"><span>Jira work item <strong>PCR-1042</strong></span><span>Revision <strong>{view.proof.revision}</strong></span><span>Role <strong>{sentence(view.actorRole)}</strong></span><span>Data <strong>Synthetic</strong></span></div>
    </header>

    {message && <div role="status" className="message-bar">{message}</div>}

    <Tabs id="case-workspace" selected={selectedTab} onChange={setSelectedTab}>
      <TabList>
        <Tab>Overview</Tab><Tab>Scope and sources</Tab><Tab>Exceptions {attentionCount > 0 ? `(${attentionCount})` : ''}</Tab><Tab>Proof and approval</Tab><Tab>Activity</Tab>
      </TabList>

      <TabPanel>
        <div className="tab-content overview-grid">
          <section className="main-column">
            {view.approval.status === 'invalidated' ? <SectionMessage appearance="warning" title="New evidence invalidated the prior approval"><p>Revision {view.proof.revision} contains a reversal for line L07. Review the changed obligation before this case can be approved again.</p></SectionMessage>
              : attentionCount > 0 ? <SectionMessage appearance="warning" title={`${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention`}><p>The proof remains open until every expected line passes and material challenges are resolved.</p></SectionMessage>
                : isCurrentApproval ? <SectionMessage appearance="success" title="This proof is approved"><p>Financial approval is current. Jira projection is {sentence(view.projectionStatus).toLowerCase()}.</p></SectionMessage>
                  : <SectionMessage appearance="information" title="The evidence supports closure"><p>All line obligations pass. A supervisor must approve this exact revision and fingerprint.</p></SectionMessage>}

            <div className="section-heading"><div><h2>Reconciliation result</h2><p>What the submitted inventory and remittances currently support</p></div><Button appearance="subtle" onClick={() => setSelectedTab(2)}>View all lines</Button></div>
            <div className="result-list">
              <button onClick={() => { setExceptionFilter('all'); setSelectedTab(2); }}><span>Expected lines</span><strong>{view.proof.expectedLineCount}</strong><small>Independent submitted inventory</small></button>
              <button onClick={() => { setExceptionFilter('corrected'); setSelectedTab(2); }}><span>Corrected as expected</span><strong>{view.proof.correctedLineCount}</strong><small>Observed net matches approved expectation</small></button>
              <button onClick={() => { setExceptionFilter('attention'); setSelectedTab(2); }}><span>Need attention</span><strong>{attentionCount}</strong><small>Missing, mismatched, ambiguous, or challenged</small></button>
              <div><span>Known unresolved amount</span><strong>{currency(view.proof.unresolvedCents)}</strong><small>Adjudicated exposure, not recovered cash</small></div>
            </div>

            <div className="section-heading"><div><h2>Next justified action</h2><p>Based on the current evidence—not agent confidence</p></div></div>
            <div className="next-action-card"><div className="next-number">1</div><div><strong>{nextAction}</strong><p>{view.proof.status === 'eligible' ? 'Confirm the revision and fingerprint before approval.' : 'Open the affected line, inspect its evidence chain, and decide what information is needed.'}</p></div><Button appearance="primary" onClick={primaryAction}>{nextAction}</Button></div>
          </section>

          <aside className="context-column">
            <section><h2>Case details</h2><dl><div><dt>Proof</dt><dd><Lozenge appearance={proofAppearance(view.proof.status)}>{sentence(view.proof.status)}</Lozenge></dd></div><div><dt>Human approval</dt><dd><Lozenge appearance={approvalAppearance(view.approval.status)}>{sentence(view.approval.status)}</Lozenge></dd></div><div><dt>Jira projection</dt><dd>{sentence(view.projectionStatus)}</dd></div><div><dt>Inventory coverage</dt><dd>Complete</dd></div><div><dt>Effective period</dt><dd>Oct 1–31, 2026</dd></div><div><dt>Evidence cutoff</dt><dd>Nov 22, 12:00 UTC</dd></div></dl></section>
            <section><h2>Workflow</h2><ol className="workflow"><li className="done">Inputs validated</li><li className="done">Scope confirmed</li><li className="done">Lines reconciled</li><li className={view.proof.status === 'challenged' ? 'current' : 'done'}>Counterexamples checked</li><li className={isCurrentApproval ? 'done' : 'current'}>Supervisor approval</li></ol></section>
          </aside>
        </div>
      </TabPanel>

      <TabPanel>
        <div className="tab-content split-page"><section className="main-column"><div className="section-heading"><div><h2>Scope and sources</h2><p>Why these lines belong in this correction review</p></div><Button>Add source</Button></div><SourceList /></section><aside className="context-column"><section><h2>Approved population rule</h2><dl><div><dt>Payer</dt><dd>Payer Demo</dd></div><div><dt>Service dates</dt><dd>Oct 1–31, 2026</dd></div><div><dt>Inventory basis</dt><dd>Submitted claims</dd></div><div><dt>Expected net</dt><dd>$100.00 per line</dd></div><div><dt>Confirmed by</dt><dd>Billing supervisor</dd></div></dl><Button appearance="subtle">Review cited passage</Button></section><SectionMessage appearance="information" title="Scope is independently established"><p>Remittance rows are not used to decide which claims should have been corrected.</p></SectionMessage></aside></div>
      </TabPanel>

      <TabPanel>
        <div className="tab-content"><div className="section-heading"><div><h2>Line obligations</h2><p>Select a line to inspect its expected amount, adjustment chain, and source references</p></div><div className="filter-group"><Button appearance={exceptionFilter === 'attention' ? 'primary' : 'default'} onClick={() => setExceptionFilter('attention')}>Needs attention</Button><Button appearance={exceptionFilter === 'all' ? 'primary' : 'default'} onClick={() => setExceptionFilter('all')}>All lines</Button><Button appearance={exceptionFilter === 'corrected' ? 'primary' : 'default'} onClick={() => setExceptionFilter('corrected')}>Corrected</Button></div></div>
          <div className="exception-workspace"><div className="table-container"><table><thead><tr><th>Line</th><th>Service date</th><th>Expected</th><th>Observed</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{exceptions.map((item) => <tr key={item.lineId} className={selectedLineId === item.lineId ? 'selected-row' : ''} onClick={() => setSelectedLineId(item.lineId)}><td><button className="line-link" onClick={() => setSelectedLineId(item.lineId)}>{item.lineId}</button></td><td>Oct 15, 2026</td><td>{currency(item.expectedNetCents)}</td><td>{item.observedNetCents === null ? 'Unknown' : currency(item.observedNetCents)}</td><td><Lozenge appearance={obligationAppearance(item.status)}>{sentence(item.status)}</Lozenge></td><td>{item.eventIds.length} event{item.eventIds.length === 1 ? '' : 's'}</td></tr>)}</tbody></table>{exceptions.length === 0 && <div className="table-empty"><h3>No lines match this filter</h3><p>Choose another filter to continue reviewing the case.</p></div>}</div>
            <aside className="line-panel">{selectedLine ? <><div><span className="overline">Line obligation</span><h2>{selectedLine.lineId}</h2><Lozenge appearance={obligationAppearance(selectedLine.status)}>{sentence(selectedLine.status)}</Lozenge></div><dl><div><dt>Expected net</dt><dd>{currency(selectedLine.expectedNetCents)}</dd></div><div><dt>Observed net</dt><dd>{selectedLine.observedNetCents === null ? 'Unknown' : currency(selectedLine.observedNetCents)}</dd></div><div><dt>Difference</dt><dd>{currency(Math.max(0, selectedLine.expectedNetCents - (selectedLine.observedNetCents ?? 0)))}</dd></div></dl><div className="reason"><strong>Why this result</strong><p>{selectedLine.reason}</p></div><div className="evidence-chain"><strong>Evidence chain</strong>{selectedLine.sourceIds.map((source) => <button key={source}>{source}<span>Open source</span></button>)}</div><Button appearance="primary">Request evidence</Button></> : <div className="panel-empty"><h3>Select a line</h3><p>Its evidence chain and next action will appear here.</p></div>}</aside>
          </div>
        </div>
      </TabPanel>

      <TabPanel>
        <div className="tab-content proof-page"><section className="main-column"><div className="section-heading"><div><h2>Proof of correction</h2><p>Closure requirements for revision {view.proof.revision}</p></div><Lozenge appearance={proofAppearance(view.proof.status)}>{sentence(view.proof.status)}</Lozenge></div><ul className="obligation-checklist"><li className="pass"><strong>Population is independently established</strong><span>12 expected lines from a complete submitted-claims inventory</span></li><li className="pass"><strong>Rule and expected payment are confirmed</strong><span>approved-rule-v1 · $100.00 net per line</span></li><li className={attentionCount === 0 ? 'pass' : 'fail'}><strong>Every line has a complete supported adjustment chain</strong><span>{attentionCount === 0 ? 'All line obligations pass' : `${attentionCount} obligation${attentionCount === 1 ? '' : 's'} remain open`}</span></li><li className={view.proof.status === 'challenged' ? 'fail' : 'pass'}><strong>No material counterexample remains unresolved</strong><span>{view.proof.status === 'challenged' ? 'Scope challenge needs a human decision' : 'Bounded counterexample search completed'}</span></li><li className={isCurrentApproval ? 'pass' : 'waiting'}><strong>Supervisor approved this exact proof</strong><span>{isCurrentApproval ? `Approved revision ${view.approval.revision}` : 'Approval has not been recorded for this revision'}</span></li></ul></section><aside className="context-column"><section><h2>Revision fingerprint</h2><p className="hash">{view.proof.inputHash}</p><p className="subtle-copy">The fingerprint makes the record reproducible. It does not prove that the source data is true.</p></section><section><h2>Approval</h2><dl><div><dt>Status</dt><dd><Lozenge appearance={approvalAppearance(view.approval.status)}>{sentence(view.approval.status)}</Lozenge></dd></div><div><dt>Approved revision</dt><dd>{view.approval.revision ?? '—'}</dd></div><div><dt>Jira projection</dt><dd>{sentence(view.projectionStatus)}</dd></div></dl><Button appearance="primary" isDisabled={busy || view.proof.status !== 'eligible' || isCurrentApproval || !can(view.actorRole, 'approve')} onClick={() => setApprovalOpen(true)}>Approve revision {view.proof.revision}</Button></section></aside></div>
      </TabPanel>

      <TabPanel><div className="tab-content activity-page"><div className="section-heading"><div><h2>Case activity</h2><p>Source versions, agent work, deterministic checks, and human decisions</p></div><Button>Filter activity</Button></div><ActivityTimeline view={view} /></div></TabPanel>
    </Tabs>

    <section className="demo-controls"><button className="demo-toggle" onClick={() => setDemoOpen((open) => !open)} aria-expanded={demoOpen}><span>Demo data controls</span><small>Use synthetic evidence to test the workflow</small></button>{demoOpen && <div className="demo-actions"><Button isDisabled={busy || view.step !== 'missing'} onClick={() => void act('addCorrection')}>Import final correction</Button><Button isDisabled={busy || view.step !== 'corrected'} onClick={() => void act('addReversal')}>Import late reversal</Button><Button isDisabled={busy} onClick={() => void act('challenge')}>Add scope challenge</Button><Button appearance="danger" isDisabled={busy || !can(view.actorRole, 'reset')} onClick={() => void act('reset')}>Reset synthetic case</Button></div>}</section>

    <ModalTransition>{approvalOpen && <Modal onClose={() => setApprovalOpen(false)}><ModalHeader hasCloseButton><ModalTitle>Approve proof revision {view.proof.revision}</ModalTitle></ModalHeader><ModalBody><p>You are approving the exact evidence revision shown below. New evidence will invalidate this approval.</p><dl className="modal-summary"><div><dt>Expected lines</dt><dd>{view.proof.expectedLineCount}</dd></div><div><dt>Corrected</dt><dd>{view.proof.correctedLineCount}</dd></div><div><dt>Unresolved amount</dt><dd>{currency(view.proof.unresolvedCents)}</dd></div><div><dt>Fingerprint</dt><dd className="hash">{view.proof.inputHash}</dd></div></dl></ModalBody><ModalFooter><Button appearance="subtle" onClick={() => setApprovalOpen(false)}>Cancel</Button><Button appearance="primary" isDisabled={busy} onClick={() => void act('approve')}>Approve revision {view.proof.revision}</Button></ModalFooter></Modal>}</ModalTransition>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
