# Payer Correction Review — system design

**Design baseline, November 23, 2026.** One Forge installation owns one organization's case data. A Jira issue anchors collaboration; a revisioned proof in Forge SQL is the app's financial source of truth. The hackathon operates on synthetic data and uses OpenAI API for bounded reasoning. See [binding decisions](DECISIONS.md), [requirements](PRD.md), [automation schema](AUTOMATION-SCHEMA.md), [implementation plan](IMPLEMENTATION-PLAN.md), and [evaluation plan](EVALUATION-PLAN.md).

## Components and request paths

| Component | Choice and responsibility |
|---|---|
| Client | React, Vite, TypeScript, Atlassian Design System and Forge Custom UI. Internal issue panel for counts and approval status; full-page workspace for scope review, paginated exceptions and evidence timeline. Poll by revision while work is pending. |
| Identity and commands | Forge bridge invokes typed resolvers. Resolve installation, caller and issue access on the server; enforce mapped app roles and Jira permissions. Require expected revision for every consequential command. |
| Workflow | Node.js 24 Forge Functions, product triggers, scheduled recovery, and bounded queues via Async Events. LangGraph.js selects investigator steps and tool calls within a bounded worker invocation. Forge SQL persists the case/revision/stage state across invocations; do not rely on LangGraph's in-memory checkpointer. Use a job per case/revision/stage with bounded parallelism across exceptions. |
| Investigator runtime | OpenAI Responses API, Zod schemas, versioned prompts and an allowlisted tool dispatcher. Start with a low-cost model for extraction and promote disputed notice interpretation to a stronger model only when evaluation justifies it. Pin the evaluated model ID per release. The API key exists only as an encrypted Forge backend variable. Apply per-run call/token budgets and an OpenAI project hard spend limit. |
| Domain core | A pure TypeScript library maps evidence to typed outcomes and integer USD cents. The same code runs behind Forge and offline fixture replay. |
| Persistence | Forge SQL and parameterized queries for bounded case records. Versioned migrations, tenant-isolated storage, paginated reads. Verify the installed database schema before starting new jobs. |
| Integration | Jira REST v3 for issue state, JSM REST for internal request context, Confluence REST v2 for authorized page/version reads. Jira required, Confluence optional. Rovo reads results through Forge actions. A read-only MCP server reuses those actions. |
| Observability | Case-level decision history and structured Forge logs are required. Langfuse is optional developer telemetry on synthetic cases, with metadata-only traces; the application does not rely on Langfuse to complete work. |
| Delivery | npm workspaces for domain, contracts, Forge adapters, UI and fixtures. Vitest, fast-check, React Testing Library and Playwright. GitHub Actions CI. Develop in the local Codex workspace and use GitHub for pull, commit and push. Distinct Forge development, staging and production environments. |

Runtime and limits: [Node](https://developer.atlassian.com/platform/forge/function-reference/nodejs-runtime/), [Async Events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/), [SQL limits](https://developer.atlassian.com/platform/forge/limits-sql/), [OpenAI API](https://developers.openai.com/api/reference/overview), [app compatibility](https://developer.atlassian.com/platform/forge/app-compatibility/).

```mermaid
flowchart LR
  A[JSM case and evidence] --> B[Authorize and register revision]
  C[Confluence notice and procedure] --> B
  B --> C1[Evidence agent builds EvidencePack]
  C1 --> D[Scope agent proposes cited predicate]
  D --> E[Supervisor confirms rule and inventory]
  E --> F[Deterministic reconciliation]
  F --> G[Candidate proof with line obligations]
  F --> X[Exception agent investigates ambiguous chains]
  X --> G
  G --> H[Challenger independently searches for counterexamples]
  H --> I[Deterministic verification checks findings]
  I -->|New verified input| F
  I -->|Unresolved challenge| J[Human reviews evidence]
  I -->|All obligations pass| K[Eligible proof in Forge SQL]
  J -->|Resolved with new evidence or rule revision| F
  K --> L[Supervisor approves exact revision]
  L --> M[Jira projection pending or verified]
  K --> N[Authorized Rovo and MCP reads]
  O[Late or superseding evidence] --> P[Invalidate prior proof immediately]
  P --> F
  P --> M
```

## Inputs, storage and financial invariants

| Record | Minimum fields and invariant |
|---|---|
| Case control row | Jira issue ID, project, active input revision/fingerprint, current proof ID, proof status, approval status, projection status, pending event ID and pending stage. One conditional update is the authoritative state transition. |
| Source and inventory manifest | Type, schema version, provider/payer, source version and hash, effective period, provenance/visibility, counts, coverage declaration and supersedes reference. Expectation comes from independently supplied inventory plus approved scope. |
| Expected line | Stable provider claim/line ID, payer, plan, service date, original reference, approved expected net amount and currency. Unique within scope revision. Multiple possible identities are an exception. |
| Remittance event | Source batch, stable event identity, original/replacement reference, level, signed amount, effective ordering and content hash. Distinct events may legitimately share amounts. A repeated ID with different content is quarantined. |
| Decision / exception | Case revision, line, status, observed net, expected net, reason code, evidence IDs, rule version, and prior decision. Show an unknown expectation explicitly. |
| Proof of correction | Proof ID and revision, independent cohort and coverage assertion, frozen source IDs/hashes/versions, cutoff, rule version, proof status (candidate, challenged, eligible, approved, stale, invalid), per-line obligations and evidence chains, material counterexamples with resolution, verifier version, approval and invalidation reason. Store a content hash over canonical inputs and outcomes; it proves reproducibility of this record, not the real-world truth of the source data. |
| Run / approval / effect | Run ID, stage, source and prompt versions, tool outcomes, retry state, reviewer decision and time, reviewed revision/hash, idempotency key and Jira sync receipt. Approval and invalidation records are append-only. |

The seed adapter accepts allowlisted, schema-validated synthetic fixture variants, including an incomplete manifest. Additional fixture amounts/dates may be changed through validated controls. Record input hashes and row-level event identities: a reordered file or overlapping batch can contain previously seen events even with a different file hash.

1. Freeze the inventory, approved population rule, remittance sources and cutoff time for a candidate revision. Validate counts and reference integrity before calculation. Unsupported currencies, payment rules or incomplete sources stay unresolved.
2. Apply the confirmed predicate to inventory independently of payment rows. Match only supported exact identifiers and explicit reference chains. Flag ambiguous, dangling or conflicting references. Out-of-order branches stay pending until sufficient evidence arrives.
3. Apply the adapter's documented signed-event semantics. A $100 replacement, a $100 reversal of it, and a $100 reissue net to $100. Never add a provider-level adjustment to an arbitrary line. The demo supports full reversals and replacements with explicit references; quarantine other semantics until a domain-approved adapter supports them.
4. Classify each in-scope line once; report unknown/out-of-scope evidence separately. Distinguish missing evidence from a verified $0 payment. Verify the result covers the full expected set. A superseding scope or late reversal schedules recomputation of dependent results; a full recompute is the reference implementation for testing incremental updates.

**Proof obligations.** (1) The inventory is independently sourced and its declared coverage supports the confirmed predicate. (2) The applied rule is the approved version effective for this cohort. (3) Every included line has an unambiguous identity and complete supported adjustment chain through the cutoff. (4) Its observed adjudicated net equals the expected amount. (5) No excluded line, provider-level adjustment, superseding notice or later event defeats obligations 1–4. The first four are checked mechanically where the typed input is complete. The Challenger searches for a counterexample to obligation 5 and scope/rule assumptions; it does not decide whether the proof passes. Unknown, inaccessible or unsupported evidence yields a blocked obligation, never a silent success.

**Challenge protocol.** The Challenger receives a frozen candidate proof, an allowlisted source catalog and a strict lookup budget. It queries excluded inventory rows, other notice versions and suspicious adjustment chains; outputs `obligationId`, `sourceIds`, `counterexampleType`, `claim` and `requestedCheck`. The verifier checks source identity and access, replays the relevant predicate or reference chain, then records reproduced, refuted or unresolved with a reason. Do not allow the agent to create its own evidence or widen permissions. A deterministic discovered failure does not wait for a Challenger run. If the Challenger times out or cannot inspect a required source, the proof records incomplete challenge coverage and cannot become eligible until the missing check is completed or a supervisor explicitly narrows the scope and creates a new revision.

**Invalidation.** On any subscribed source mutation, mark dependent approved proofs stale before queuing recomputation. A duplicate event with the same identity/content is a no-op. A verified reversal, new in-scope line, changed coverage declaration, superseding rule or lost evidence access creates an invalidation event pointing to broken obligations and the previous approval. Conditional publication prevents an old worker from restoring eligibility. Jira shows the case reopened or pending sync; the financial proof state in SQL is authoritative until Jira projection succeeds.

### Atomic input-registration and invalidation contract

Forge SQL does not provide a normal multi-statement application transaction, so correctness cannot depend on several statements committing together. Use this recoverable protocol:

1. Insert the immutable source event using a stable `eventId` and content hash. Duplicate identity + same hash is a no-op; duplicate identity + different hash is quarantined.
2. Execute one conditional update against the case-control row: require the expected active revision, then atomically set the new active input revision/fingerprint, proof status `stale`, approval status `invalidated` when applicable, `pendingEventId`, and `pendingStage=register_input`.
3. If the conditional update affects zero rows, reread and either recognize an already-applied event or retry from the new revision. Never publish based on the stale expected revision.
4. Idempotently append invalidation history and create the stage job keyed by `installationId:caseId:inputRevision:stage`. These records may be completed after the control-row update because readers already see the proof as stale.
5. Clear `pendingEventId/pendingStage` only with a conditional update after the ledger and job intent exist. A scheduled sweep finds non-null pending fields and completes the same idempotent work.

The case-control row is the safety boundary: a crash may delay ledger completion or recomputation, but cannot leave an old approval current. Approval compares the displayed `expectedRevision` and `proofHash` with this row in one conditional update.

## Durable orchestration

Use separate states for **investigation** (`queued`, `running`, `waiting_evidence`, `waiting_scope`, `complete`, `failed`, `cancelled`), **proof** (`candidate`, `challenged`, `eligible`, `stale`, `invalid`), **approval** (`not_requested`, `approved`, `invalidated`) and **Jira projection** (`not_requested`, `pending`, `synced`, `conflict`, `failed`). An agent finishing its run confers no financial sign-off. A changed input marks the proof stale and invalidates approval immediately. Jira failure does not erase approval; readers see `Approved — Jira sync pending` or the conflict explicitly.

Each worker receives installation-scoped IDs, checks allowed project and job revision, and uses a bounded lease. Stage immutable output rows under a candidate revision. Publish only after verifying manifest completeness, using a single conditional update on the case row. Keep the intended Jira projection in that row at publication. This accommodates Forge SQL's single-query statements and lack of foreign keys. Abandoned candidate rows remain invisible and expire under a cleanup job.

**LangGraph boundary.** A graph invocation may autonomously plan and use allowlisted evidence tools, but it finishes or yields within one Forge async consumer invocation. The durable outer controller records its state in SQL and queues the next stage. This is an architectural decision until a deployed spike proves LangGraph packaging, OpenAI calls, and resume behavior in Forge. A custom SQL checkpointer is optional; it must not become a prerequisite for the core reconciliation path. Forge Workflows is currently unavailable/EAP, so the build uses Async Events. [Forge Workflows status](https://developer.atlassian.com/platform/forge/runtime-reference/workflows-api/)

**Shared stage envelope.** Every queued stage carries only identifiers: `schemaVersion`, `installationId`, `caseId`, `inputRevision`, `stage`, `attempt`, `authorizationEnvelopeId`, `budgetId` and `idempotencyKey`. The worker rereads the frozen inputs. Persist `sourceSnapshot`, `promptVersion`, `modelId`, typed result, citations, unresolved items, token/tool/cost totals, terminal reason and next permitted command. Terminal reasons are `completed`, `waiting_human`, `source_denied`, `source_missing`, `contradiction`, `unsupported_semantics`, `stale_revision`, `budget_exhausted`, `transient_failure` and `permanent_failure`.

**Background authorization envelope.** Bind each job to installation, opted-in project, case/revision, allowed source IDs, initiating or service authority, allowed actions and expiry. Recheck installation/project/source access before every read and before publication. Access loss produces `source_denied`, blocks the relevant obligation and invalidates derived currentness. Reasoning agents never receive write capabilities.

### Platform-spike completion criteria

The platform boundary becomes **partial** after a deployed async consumer successfully calls OpenAI with a Zod-validated structured response and records cost/latency. It becomes **complete** only when a second invocation resumes from persisted SQL stage state; OpenAI backend egress and eligibility impact are recorded; timeout, rate-limit and model-outage paths terminate safely; one bounded LangGraph tool loop packages and runs; the encrypted key never reaches UI/logs; and the measured worst-case case budget stays below configured limits.

The projection worker updates the existing issue with a target status/revision, reads back the projection, and records completion. On a timeout it checks current state before retrying. If an analyst changed the workflow meanwhile, surface a sync conflict for resolution. Prefer setting an owned field or issue property to a stable value over appending comments. Never treat a timed-out create or transition as known failure. Recover stale leases, unfinished projections and incomplete queue dispatch from a scheduled sweep. The queue has at-least-once delivery and a finite retention window. Keep rate-limit backoff, a visible failed-jobs list, and operator replay keyed to the same inputs.

## Agents as workers and users

| Actor | Available tools | Escalation / autonomy limit |
|---|---|---|
| Deterministic intake | Validate qualifying transition, opted-in project, command authority, notice reference, manifest and duplicate identity | Starts no model call until minimum inputs exist. Cannot define the expected cohort from remittances alone. |
| Evidence agent | Query case-bound, permission-visible notice/procedure versions and source catalog | Returns a typed `EvidencePack`, including contradictions, access failures, unsearched eligible sources and retrieval coverage. Read-only. |
| Scope investigator | Read case-bound notice/procedure versions, inspect manifest, propose structured predicate with supporting spans | Propose only. Invalid citations, contradictory dates, or unsupported predicates request human review. |
| Exception investigator | Look up original reference, inspect authorized batch manifest, follow a replacement chain, request bounded recomputation | Default maximum three evidence lookups per unresolved group before returning findings. Group equivalent exceptions to avoid one LLM call per line. New financial facts must pass the deterministic adapter. |
| Challenger agent | Read the frozen proof, excluded inventory rows, authorized notice versions and suspicious adjustment chains; submit typed, cited counterexamples | Searches for omitted eligibility, rule conflict, ambiguous chain or reversal. Bounded lookups and time. Cannot approve, close or directly change a monetary outcome. |
| Deterministic verification | Validate citation/source identity, replay predicate and reference chains, compute money and completeness, compare revision/hash, execute policy-approved idempotent writes and read back Jira effects | No model judgment. Rejects stale, inaccessible, invalid or unsupported results. Cannot approve financial closure. |
| Rovo case assistant | Case summary, exception list and revision difference | Cites source references and states evidence limits. May suggest a human next step. Its output cannot alter the ledger or approve closure. |
| Consuming agent | Same four versioned read tools exposed by one Forge MCP module | Example: a provider-relations assistant checks what changed before drafting an internal briefing. Use delegated user access and explicit site opt-in. Deny any invocation without verifiable caller context. |

The four reasoning agents are application workers using model/tool loops. Forge owns scheduling, permissions and all persistence. Their coordination does not depend on invoking Rovo agents recursively. Treat source text as untrusted evidence. Validate tool selections, IDs, inputs and model outputs server-side. Missing, fabricated or inaccessible citations produce an unresolved finding.

**Authority:** Agents may read permitted sources and propose scope, discrepancy findings, counterexamples and internal follow-up content. They cannot write directly to SQL or Jira. A supervisor alone confirms the population/expected-payment basis and approves closure of a current revision/hash. The deterministic controller may then persist validated proposals and project the approved closure into Jira through the write-policy function. No agent contacts a payer, updates patient balances, or silently closes an unapproved financial case. This is autonomous investigation within bounded authority, not an unattended financial adjudicator.

### MVP command-authorization matrix

| Command | Viewer | Analyst / evidence editor | Supervisor | Operator |
|---|:---:|:---:|:---:|:---:|
| Read visible case/proof | Yes | Yes | Yes | Only when separately granted case access |
| Add/version synthetic evidence | No | Yes | Yes | No |
| Confirm scope/payment basis | No | Propose only | Yes | No |
| Record provider-relations event | No | Yes | Yes | No |
| Approve exact revision/hash | No | No | Yes | No |
| Replay failed idempotent job | No | No | No | Yes, without changing inputs |
| Reset/delete synthetic case | No | No | Yes | Yes, with explicit confirmation and audit event |
| Configure project/role mapping | No | No | No | Site-admin configuration only |

Every resolver checks installation, internal-project membership, Jira visibility and app role server-side. A single environment-variable supervisor ID is allowed only as a development bootstrap and is not distribution-ready. Ordinary issue read permission never grants mutation authority.

### Agent API contract, version 1

Implement a shared application API behind Forge resolvers, Rovo actions and MCP. The release exposes authenticated tools through Forge; it requires no public HTTP service, API keys, or bespoke OAuth server. A future provider-side ingestion API requires its own trust agreement and design.

| Read-only tool | Request | Response |
|---|---|---|
| `get-case-summary` | `caseId`, optional `revision` | `proofId`, `proofStatus`, `scopeCoverage`, counts, known exposure in integer cents, currency, adjudication basis, closure state, input freshness, unresolved challenge count |
| `list-case-exceptions` | `caseId, revision`, optional `status, cursor, limit` | Stable, paged exceptions with reason codes, needed evidence and visible source references; maximum 50 items |
| `get-case-changes` | `caseId, fromRevision, toRevision` | Changed decisions, causal event references, count/amount deltas, and whether prior approval was invalidated |
| `get-proof-obligations` | `caseId, revision`, optional `cursor, limit` | Paginated obligation status, source IDs, verified counterexamples and invalidation reasons, with access filtering |

All successful tool responses include `schemaVersion, caseId, revision, asOf, runId`. Pin pagination to the requested revision. Validate opaque cursor binding to caller, case and filters. Use typed errors for invalid input, stale/unavailable revision, throttling (with retry hint), and unavailability. Unknown or inaccessible case IDs return the same external error. Redact restricted sources; if a derived conclusion would reveal their contents, withhold it as well. Provide a bounded structured envelope, serialized to JSON text where the action adapter requires it. Cache only within the same access context.

**Example.** In the worked fixture, the request `get-case-changes(caseId="DEMO-1", fromRevision=2, toRevision=3)` returns a change for synthetic line 07 from corrected to reversed, an unresolved delta of 10000 USD cents, and the reversal evidence reference. The caller sees that the supervisor approved revision 2 and that revision 3 requires review. A second agent with no access to DEMO-1 receives no counts, identifiers, or explanation.

The MCP module is Preview. Validate the supported caller identity and permission propagation on a clean installation before exposing tools. If the connector cannot prove caller authorization, disable it and retain the internal authorized app flow. Rovo actions invoked by automation have write restrictions. [Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/) · [Actions](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)

## Security, operations and release gates

- **Access.** Use Forge's verified invocation context, app installation boundary, case-level Jira visibility, and app role mapping. Recheck source permissions at read time. Separate customer-visible JSM surfaces from internal results. Bind background workers to installations, opted-in projects and authorized source sets. A permissions change invalidates cached derived content. Record minimal approval identity for accountability; measure performance at the case level.
- **Privacy.** The released judge workflow uses only generated synthetic records. Keep model input to authorized notice passages and minimal typed exception descriptors. Never send raw ERA files, patient identifiers, or hidden source text to Rovo/MCP. Logs carry opaque IDs and reason codes. Before any live pilot, review BAAs, feature eligibility, residency, retention/deletion, subprocessors, source licenses and access controls. Maintain real remittances within a provider-approved boundary; even pseudonymous data needs assessment. Rovo MCP is excluded from the HIPAA-enabled clinical-data path. [Atlassian HIPAA guide](https://support.atlassian.com/organization-administration/docs/the-hipaa-implementation-guide/) · [Rovo for HIPAA organizations](https://support.atlassian.com/organization-administration/docs/use-rovo-for-hipaa-organizations/)
- **External data flow.** OpenAI is declared as Forge backend egress with `inScopeEUD: false`; the hackathon sends only generated synthetic case content. Forge CLI confirms that development version 4.1.0 is not Runs on Atlassian eligible because it egresses data. Do not send Teamwork Graph-derived context or real claims data to the external model. [Graph limitations](https://developer.atlassian.com/platform/teamwork-graph/limitations-and-considerations/) · [Forge egress](https://developer.atlassian.com/platform/forge/runtime-egress-permissions/)
- **Cost.** The project cash ceiling is $100 across paid resources; the user's existing $85 OpenAI API credits are excluded from new cash spend. Reserve cash for Codespaces/Forge/Rovo overages. Use a dedicated OpenAI project limit, disable automatic recharge if applicable, cap calls/tokens/tool loops per run, and stop new paid work before approaching the ceiling. Dashboard billing can lag, so app counters are a second control, not a guarantee. [OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [Forge pricing](https://developer.atlassian.com/platform/forge/forge-platform-pricing/)
- **Observability.** Distinguish the analyst's decision trail from operator telemetry. Trace input revision, stage, tool, source IDs, result codes, model/prompt versions, tokens, cost, duration, retries and Jira sync outcome. Persist auditable facts and concise evidence-backed explanations. Never log private reasoning or full prompts. Alert on stalled jobs, stale projections, authorization failures and repeated model failures. Replay uses frozen inputs and recorded decisions; an intentional new model evaluation creates a separate run.
- **Capacity and recovery.** Initial design target: 300 synthetic lines per case, 5 concurrent cases per installation, p95 summary load under 2 seconds after publication, and p95 reconciliation within 60 seconds after scope confirmation for the 300-line fixture, excluding human waits. Measure under warm and cold conditions; show timestamps while work is queued. Chunk inserts/reads, cap evidence sizes, monitor tenant storage and refuse oversized imports before partial publication. Budget hosted SQL against its documented 1 GiB production ceiling. Test recoverability from source fixtures and a failed migration. Pilot volume, retention period, RTO/RPO and provider-side storage need buyer sign-off and a restore drill.
- **Evaluation.** Differentially test incremental and full replay. Use property tests for duplicate invariance, net arithmetic, out-of-order events with authoritative references, and stale-approval rejection. Withhold entire notice/fixture variants from prompt tuning. Track predicate and citation accuracy, unresolved-line recall, false closures, excess abstention, cost and turnaround. Include inaccessible sources, instruction-like notice text, worker crash, partial import, provider adjustment, and stale read-tool revisions. Test noisy warnings as well as missed discrepancies.
- **Failure behavior.** If the LLM is unavailable, retain the last verified state and permit supervisor-entered scope; label manual input. If Confluence is disconnected, demo with versioned synthetic notice/procedure and show the source mode. If Jira sync fails, surface pending status in the app and replay safely. Optional Teamwork Graph results are user-filtered discovery aids and never establish financial completeness. [Graph authorization](https://developer.atlassian.com/platform/teamwork-graph/curated-queries/)
