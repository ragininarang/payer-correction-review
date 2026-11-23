import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildProof } from '../domain/proof';
import type { CorrectionProof } from '../domain/types';
import { can, type AppRole, type ApprovalStatus, type ProjectionStatus } from '../domain/workflow';
import { baseInput, conflictingScopeInput, scopeCounterexample, withFinalReplacement, withLateReversal } from '../fixtures/demo';
import './style.css';

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

interface WorkspaceResponse {
  case: CaseView | null;
  actorRole: AppRole;
}

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
    approval: priorWasApproved
      ? { ...approval, status: 'invalidated' }
      : { status: 'unapproved', revision: null, proofHash: null },
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
  return typeof candidate.step === 'string'
    && typeof candidate.proof === 'object'
    && candidate.proof !== null
    && typeof candidate.proof.expectedLineCount === 'number'
    && typeof candidate.approval === 'object'
    && candidate.approval !== null
    && typeof candidate.projectionStatus === 'string'
    && typeof candidate.actorRole === 'string';
}

function isWorkspaceResponse(value: unknown): value is WorkspaceResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceResponse>;
  return typeof candidate.actorRole === 'string' && (candidate.case === null || isCaseView(candidate.case));
}

function currency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function titleCase(value: string): string {
  return value.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function App() {
  const [view, setView] = useState<CaseView>(() => localCase('missing'));
  const [hasCase, setHasCase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [forgeMode] = useState(() => window.parent !== window);

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
          setMessage('This issue has no synthetic review yet. An analyst, supervisor, or operator can initialize it.');
        }
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load this case.'))
      .finally(() => setBusy(false));
  }, [forgeMode]);

  async function act(action: Action) {
    setMessage('');
    if (action === 'reset' && !window.confirm('Reset this synthetic case? The action is audited and any current approval will be invalidated.')) return;

    if (!forgeMode) {
      if (action === 'initialize' || action === 'reset') {
        setView(localCase('missing', view.approval));
        setHasCase(true);
      }
      if (action === 'addCorrection') setView(localCase('corrected', view.approval));
      if (action === 'approve' && view.proof.status === 'eligible') {
        setView({
          ...view,
          approval: { status: 'approved', revision: view.proof.revision, proofHash: view.proof.inputHash },
          projectionStatus: 'pending',
        });
      }
      if (action === 'addReversal') setView(localCase('reversed', view.approval));
      if (action === 'challenge') setView(localCase('challenged', view.approval));
      return;
    }

    const payload = action === 'approve'
      ? { expectedRevision: view.proof.revision, proofHash: view.proof.inputHash }
      : action === 'reset'
        ? { expectedRevision: view.proof.revision, confirmation: 'RESET CASE' }
        : action === 'initialize' ? {} : { expectedRevision: view.proof.revision };
    setBusy(true);
    try {
      const result = await callForge<CaseView>(action, payload);
      if (!isCaseView(result)) throw new Error('The app returned an invalid case response.');
      setView({ ...result, mode: 'forge' });
      setHasCase(true);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  const { proof } = view;
  const openCount = proof.expectedLineCount - proof.correctedLineCount;
  const isCurrentApproval = view.approval.status === 'approved'
    && view.approval.revision === proof.revision
    && view.approval.proofHash === proof.inputHash;
  const closure = isCurrentApproval ? 'Approved'
    : view.approval.status === 'invalidated' ? 'Prior approval invalidated'
      : proof.status === 'eligible' ? 'Ready for supervisor'
        : proof.status === 'challenged' ? 'Challenge needs review' : 'Investigation open';

  return <main className="shell">
    <header className="header">
      <div className="brandmark">P</div>
      <div><div className="eyebrow">Payer Correction Review</div><h1>Proof of correction</h1></div>
      <span className="role">{titleCase(view.actorRole)}</span>
      <span className="synthetic">Synthetic data</span>
    </header>

    <section className="intro">
      <div>
        <div className="eyebrow">CASE {proof.caseId} · REVISION {proof.revision}</div>
        <h2>Did the payer fix every affected line?</h2>
        <p>Independent submitted-line inventory is compared with adjustment evidence. Approval is bound to one exact revision and fingerprint; later evidence invalidates it.</p>
      </div>
      <div className={`status status-${proof.status}`}><span className="status-dot" />{closure}</div>
    </section>

    {message && <div role="status" className="message">{message}</div>}
    {!hasCase && <section className="empty-state">
      <div><span className="eyebrow">No review exists</span><h3>Initialize the synthetic evidence journey</h3><p>This creates revision 1. It does not call an LLM or contact a payer.</p></div>
      <button disabled={busy} onClick={() => void act('initialize')}>Initialize review</button>
    </section>}

    {hasCase && <>
      <section className="state-rail" aria-label="Workflow state">
        <div><span>Proof</span><strong className={`state-${proof.status}`}>{titleCase(proof.status)}</strong></div>
        <div><span>Human approval</span><strong className={`state-${view.approval.status}`}>{titleCase(view.approval.status)}</strong></div>
        <div><span>Jira projection</span><strong className={`state-${view.projectionStatus}`}>{titleCase(view.projectionStatus)}</strong></div>
        <div><span>Fingerprint</span><code>{proof.inputHash.slice(0, 12)}…</code></div>
      </section>

      <section className="metrics" aria-label="Case summary">
        <article><span>Expected lines</span><strong>{proof.expectedLineCount}</strong><small>From independent inventory</small></article>
        <article><span>Corrected</span><strong>{proof.correctedLineCount}</strong><small>Matching approved rule</small></article>
        <article><span>Open or disputed</span><strong>{openCount}</strong><small>Through evidence cutoff</small></article>
        <article><span>Known shortfall</span><strong>{currency(proof.unresolvedCents)}</strong><small>Adjudicated amount</small></article>
      </section>

      <section className="workspace">
        <div className="maincol">
          <div className="sectionhead"><div><div className="eyebrow">01 · Evidence</div><h3>Line obligations</h3></div><span className="subtle">{proof.obligations.length} in scope · {proof.excludedLineIds.length} excluded</span></div>
          <div className="tablewrap"><table><thead><tr><th>Line</th><th>Expected</th><th>Observed</th><th>Result</th><th>Evidence</th></tr></thead><tbody>{proof.obligations.map((item) => <tr key={item.lineId}><td className="mono">{item.lineId}</td><td>{currency(item.expectedNetCents)}</td><td>{item.observedNetCents === null ? 'Unknown' : currency(item.observedNetCents)}</td><td><span className={`pill pill-${item.status}`}>{item.status.replace('-', ' ')}</span></td><td title={item.sourceIds.join(', ')}>{item.eventIds.length} event{item.eventIds.length === 1 ? '' : 's'}</td></tr>)}</tbody></table></div>
        </div>

        <aside>
          <div className="sectionhead"><div><div className="eyebrow">02 · Decision</div><h3>What the proof says</h3></div></div>
          <div className="asidecard"><span className="label">Proof status</span><strong>{proof.status}</strong><p>Only a supervisor may approve an eligible proof. The server checks both revision {proof.revision} and its complete fingerprint.</p><code>{proof.inputHash}</code></div>
          {view.approval.status !== 'unapproved' && <div className={`asidecard approval-${view.approval.status}`}><span className="label">Approval record</span><strong>{titleCase(view.approval.status)}</strong><p>Revision {view.approval.revision ?? '—'} · {view.approval.proofHash?.slice(0, 14) ?? 'No hash'}…</p></div>}
          {proof.findings.length > 0 && <div className="asidecard warning"><span className="label">Counterexample</span>{proof.findings.map((finding) => <p key={finding.proposalId}><strong>{finding.outcome}</strong> · {finding.reason}<br /><small>Source: {finding.sourceId}</small></p>)}</div>}
          {proof.blockers.length > 0 && <div className="asidecard"><span className="label">Needs attention</span><ul>{proof.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
          <div className="actions">
            <button disabled={busy || !can(view.actorRole, 'reset')} onClick={() => void act('reset')}>Reset with audit</button>
            <button disabled={busy || !can(view.actorRole, 'record-evidence') || view.step !== 'missing'} onClick={() => void act('addCorrection')}>Add final correction</button>
            <button className="primary" disabled={busy || !can(view.actorRole, 'approve') || proof.status !== 'eligible' || isCurrentApproval} onClick={() => void act('approve')}>Approve exact revision</button>
            <button disabled={busy || !can(view.actorRole, 'record-evidence') || view.step !== 'corrected'} onClick={() => void act('addReversal')}>Import late reversal</button>
            <button disabled={busy || !can(view.actorRole, 'challenge')} onClick={() => void act('challenge')}>Open scope challenge</button>
          </div>
          <p className="permission-note">Actions are enforced on the server. Disabled controls reflect your mapped app role; they are not the security boundary.</p>
        </aside>
      </section>
    </>}

    <footer>Adjudication evidence only. This view does not prove cash receipt, contact a payer, or score employees. {view.mode === 'local' ? 'Local interactive prototype.' : 'Forge issue panel.'}</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
