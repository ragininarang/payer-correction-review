# Payer Correction Review — build implementation plan

**Status:** implementation in progress. The local Phase 1 authorization/approval controls and Phase 2 append-only ledger foundation are implemented; deployed Forge SQL migration, recovery and reload tests remain gate evidence. Follow [binding decisions](DECISIONS.md), [requirements](PRD.md), [system design](SYSTEM-DESIGN.md), and [evaluation plan](EVALUATION-PLAN.md). Work does not advance past a gate until its evidence is recorded.

## MVP definition

The MVP proves one end-to-end synthetic journey: a payer reports a correction fixed; the app establishes the expected cohort from an independent inventory; four bounded agents retrieve and interpret evidence, investigate ambiguity and challenge a frozen proof; deterministic code computes and verifies the result; a supervisor approves an exact revision/hash; a late reversal invalidates it; Jira reflects the current collaboration state without becoming the financial database.

## Phase 0 — planning lock

**Deliverables**

- Canonical document authority and OpenAI decision recorded.
- Four-agent topology and deterministic boundaries recorded.
- Trigger, material-challenge policy, state model and command matrix recorded.
- Evaluation oracle structure, baselines and pass criteria recorded.

**Exit evidence:** document consistency check finds no six-agent, Forge-LLM or generic-issue-trigger instruction in canonical plans.

## Phase 1 — safety foundation

**Build scope**

1. Replace the development-only supervisor identity with installation-scoped role mapping and an explicit development bootstrap.
2. Enforce viewer, analyst/evidence-editor, supervisor and operator permissions for every resolver command.
3. Require `expectedRevision` and `proofHash` for approval; persist append-only approval history.
4. Separate proof, approval and Jira-projection states.
5. Restrict reset/delete to supervisor/operator with explicit confirmation and audit event.

**Tests required**

- Every unauthorized role/command pair is denied.
- A supervisor viewing revision N cannot approve N+1.
- A changed hash with the same submitted revision is rejected.
- Reset invalidates current state only when performed by an authorized actor.
- Jira projection failure leaves financial approval intact and visibly pending.

**Gate 1:** the two P0 findings from the readiness review are closed. No agent implementation begins before this gate.

## Phase 2 — revisioned event and proof ledger

**Build scope**

1. Add the case-control row, source events, immutable proof revisions, obligations, challenges, approvals, stage runs and Jira effects.
2. Implement stable event fingerprints and quarantine identity/content conflicts.
3. Implement the recoverable source-registration protocol from the system design.
4. Add scheduled recovery for pending event registration, dispatch, stale leases and Jira effects.
5. Add synthetic case deletion/uninstall cleanup behavior and judging-period retention statement.

**Tests required**

- Duplicate event is a no-op.
- Crash after control-row invalidation cannot expose an old approval as current.
- Recovery creates exactly one stage job and one Jira effect.
- Old worker cannot publish against a newer active revision.
- Late reversal identifies the broken line obligation and preserves prior history.

**Gate 2:** full replay and incremental processing produce identical frozen proofs; fault injection leaves the system recoverable.

## Phase 3 — platform feasibility spike

**Build scope**

1. Add an async consumer with persisted stage state.
2. Declare OpenAI backend egress and store the key only as an encrypted Forge variable.
3. Execute one structured OpenAI response validated by Zod against synthetic text.
4. Execute one bounded LangGraph read-tool loop inside one worker invocation.
5. Resume the next stage from SQL in a second invocation.
6. Capture model, prompt, calls, tokens, estimated cost, duration, terminal reason and retry context.

**Failure exercises**

- Missing key.
- Invalid structured response.
- Model timeout or 429.
- Worker timeout after result persistence but before dispatch.
- Stale revision while the model is running.
- Project/case/source authorization revoked before publication.

**Gate 3:** deployed evidence confirms egress, packaging, safe resume, cost and outage behavior. If LangGraph is unreliable, use the same stage contracts with a small custom in-worker loop; do not change durable orchestration.

## Phase 4 — deterministic qualifying trigger and source manifests

**Build scope**

1. Opt-in project configuration and role mapping.
2. Trigger only on transition to `Payer reports fixed` with notice reference.
3. Minimum-input validation before paid work.
4. Versioned manifests for notice, procedure, independent inventory, payment basis and remittance batches.
5. Provider-relations communication events and next-review date.

**Gate 4:** ordinary issue creation causes no model call; missing input produces a named request; a payer reply changes proof only after referenced evidence is registered.

## Phase 5 — agent contracts, one role at a time

Implement in this order because each role has a separately testable output:

1. **Evidence:** `EvidencePack` with searched/unsearched sources, versions, citations, contradictions, denials and coverage.
2. **Scope:** cited predicate proposal; supervisor confirms or edits it.
3. **Exception:** runs only for deterministic ambiguity groups and returns typed findings.
4. **Challenger:** receives a frozen candidate, independent context and strict budget; returns typed counterexamples.

Each role receives role-specific read tools only. The controller owns persistence and writes. Enable a role in the main journey only after its oracle gate in `EVALUATION-PLAN.md` passes.

**Gate 5:** four-role pipeline outperforms or materially de-risks the single-agent baseline on its predeclared measures. Merge Evidence and Scope if their separation does not improve retrieval coverage, citation accuracy or permission isolation enough to justify latency/cost.

## Phase 6 — user journey and Atlassian surfaces

**Build scope**

- Issue panel: current proof/approval/projection state and next action.
- Full workspace: inventory coverage, cited scope, per-line obligations, challenges, evidence timeline, provider-relations events and revision comparison.
- Supervisor view: exact revision/hash, closure requirements and return-for-investigation.
- Operator view: failed/pending jobs, safe replay and cost totals without staff scoring.
- Rovo read actions: summary, exceptions, changes and obligations with caller visibility.
- MCP/Teamwork Graph only after identity/permission tests; otherwise omit.

**Gate 6:** a clean-site evaluator completes the canonical correction, approval, duplicate and reversal journey without developer intervention beyond documented provisioning.

## Phase 7 — evaluation, hardening and submission

- Run deterministic, authorization, agent, fault-injection and accessibility suites.
- Run held-out manual versus app-assisted comparison; report active time and all errors/abstentions.
- Confirm total project cash spend remains below $100 and per-case model cost is recorded.
- Freeze prompts/models and the submitted build.
- Reinstall in a second site and execute judge instructions.

**Release gate:** zero false closure on the labeled safety suite; no unauthorized mutation or source leakage; no duplicate effect; exact money arithmetic; successful late-evidence invalidation; measured costs within configured bounds.

## Explicitly outside this implementation

- Live claims, patient data or raw X12/ERA ingestion.
- Autonomous payer communication.
- Patient balance or cash posting changes.
- Contract-rate modeling.
- Staff performance scoring.
- Production pilot claims or ROI claims not supported by observed data.
