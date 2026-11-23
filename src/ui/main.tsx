import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildProof } from '../domain/proof.js';
import type { CorrectionProof } from '../domain/types.js';
import { baseInput, conflictingScopeInput, scopeCounterexample, withFinalReplacement, withLateReversal } from '../fixtures/demo.js';
import './style.css';

type Step = 'missing' | 'corrected' | 'reversed' | 'challenged';
interface CaseView {
  step: Step;
  proof: CorrectionProof;
  approvedRevision: number | null;
  mode: 'local' | 'forge';
}

function localCase(step: Step, approvedRevision: number | null): CaseView {
  const input = step === 'missing' ? baseInput : step === 'corrected' ? withFinalReplacement()
    : step === 'reversed' ? withLateReversal(withFinalReplacement()) : conflictingScopeInput;
  const proof = buildProof(input, step === 'challenged' ? [scopeCounterexample] : [], true);
  return { step, proof, approvedRevision, mode: 'local' };
}

async function callForge<T>(method: string): Promise<T> {
  const { invoke } = await import('@forge/bridge');
  return await invoke(method) as T;
}

function currency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function App() {
  const [view, setView] = useState<CaseView>(() => localCase('missing', null));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [forgeMode] = useState(() => window.parent !== window);

  useEffect(() => {
    if (!forgeMode) return;
    setBusy(true);
    callForge<CaseView | null>('getCase')
      .then((result) => {
        if (result) setView({ ...result, mode: 'forge' });
        else setMessage('This issue has no synthetic review yet. Initialize it to begin.');
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load this case.'))
      .finally(() => setBusy(false));
  }, [forgeMode]);

  async function act(action: 'initialize' | 'addCorrection' | 'approve' | 'addReversal' | 'challenge') {
    setMessage('');
    if (!forgeMode) {
      if (action === 'initialize') setView(localCase('missing', null));
      if (action === 'addCorrection') setView(localCase('corrected', null));
      if (action === 'approve' && view.proof.status === 'eligible') setView({ ...view, approvedRevision: view.proof.revision });
      if (action === 'addReversal') setView(localCase('reversed', view.approvedRevision));
      if (action === 'challenge') setView(localCase('challenged', null));
      return;
    }
    setBusy(true);
    try {
      const result = await callForge<CaseView>(action);
      setView({ ...result, mode: 'forge' });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  const { proof } = view;
  const openCount = proof.expectedLineCount - proof.correctedLineCount;
  const closure = view.approvedRevision === proof.revision && proof.status === 'eligible' ? 'Approved'
    : view.approvedRevision && proof.status !== 'eligible' ? 'Prior approval invalidated'
    : proof.status === 'eligible' ? 'Ready for supervisor' : proof.status === 'challenged' ? 'Challenge needs review' : 'Investigation open';

  return <main className="shell">
    <header className="header">
      <div className="brandmark">P</div>
      <div><div className="eyebrow">Payer Correction Review</div><h1>Proof of correction</h1></div>
      <span className="synthetic">Synthetic data</span>
    </header>
    <section className="intro">
      <div>
        <div className="eyebrow">CASE {proof.caseId} · REVISION {proof.revision}</div>
        <h2>Did the payer fix every affected line?</h2>
        <p>We start with submitted claims, then compare each expected correction with the payer’s adjustment evidence. A later reversal can invalidate an earlier approval.</p>
      </div>
      <div className={`status status-${proof.status}`}><span className="status-dot" />{closure}</div>
    </section>
    {message && <div role="status" className="message">{message}</div>}
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
        <div className="asidecard"><span className="label">Proof status</span><strong>{proof.status}</strong><p>Revision {proof.revision} is tied to a frozen input fingerprint. A supervisor can approve only an eligible revision.</p><code>{proof.inputHash.slice(0, 14)}…</code></div>
        {proof.findings.length > 0 && <div className="asidecard warning"><span className="label">Counterexample</span>{proof.findings.map((finding) => <p key={finding.proposalId}><strong>{finding.outcome}</strong> · {finding.reason}<br /><small>Source: {finding.sourceId}</small></p>)}</div>}
        {proof.blockers.length > 0 && <div className="asidecard"><span className="label">Needs attention</span><ul>{proof.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
        <div className="actions"><button disabled={busy} onClick={() => void act('initialize')}>Reset synthetic case</button><button disabled={busy || view.step !== 'missing'} onClick={() => void act('addCorrection')}>Add final correction</button><button disabled={busy || proof.status !== 'eligible' || view.approvedRevision === proof.revision} onClick={() => void act('approve')}>Approve this revision</button><button disabled={busy || view.step !== 'corrected'} onClick={() => void act('addReversal')}>Import late reversal</button><button disabled={busy} onClick={() => void act('challenge')}>Open scope challenge</button></div>
      </aside>
    </section>
    <footer>Adjudication evidence only. This view does not prove that cash reached the bank or authorize payer contact. {view.mode === 'local' ? 'Local interactive prototype.' : 'Forge issue panel.'}</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
