# Payer Correction Review — autonomous workflow schema

**Purpose.** Build and continuously check a revisioned proof that a payer's announced correction reached every independently expected claim line. This document describes what runs automatically, what a person decides, and how we develop the product. The [PRD](PRD.md) defines financial correctness; the [system design](SYSTEM-DESIGN.md) defines implementation.

## Product boundary

The trigger is an internal JSM incident about a payer processing correction. Jira holds the shared work item; Confluence may hold the notice or local procedure. An independent submitted-claims inventory defines the candidate population. Remittances show what the payer did. **The app never infers completeness from remittances alone.** Its result is adjudication evidence, not proof that cash reached the bank. The hackathon uses synthetic records and does not submit claims, contact a payer, or change patient balances.

## Case state

| State | Meaning | Next actor |
| --- | --- | --- |
| Awaiting inputs | Notice, independent inventory, remittance, or expected-payment basis is missing | Agent requests a named source; analyst supplies it |
| Scope proposed | Agent extracted an evidence-linked population and rule | Supervisor confirms or edits the rule |
| Investigating | Approved scope is frozen for this revision; reconciliation runs | Agents and deterministic calculation |
| Proof challenged | The Challenger found a reproducible or unresolved material counterexample | Agent gathers evidence; analyst or supervisor resolves unsupported interpretation |
| Exceptions open | One or more lines are missing, reversed, mismatched, or ambiguous | Agent investigates; analyst handles unresolved facts |
| Eligible for closure | Full population checked, current sources, zero unresolved in-scope lines and no unresolved material challenge | Supervisor approves exact proof revision |
| Approved — sync pending | Supervisor approved the exact current revision/hash; Jira projection has not yet been verified | Deterministic projection worker retries or surfaces conflict |
| Closed | Supervisor approved the exact current revision/hash and Jira projection was verified | New evidence may reopen automatically |
| Reopened | New evidence invalidated the approved result | Agent reruns affected investigation; supervisor reviews again |

Proof, approval and Jira projection are stored separately even though the UI presents the combined states above. Agent-run state is separate: queued, running, waiting for source, waiting for scope decision, waiting for approval, completed, failed, or cancelled. Completing an agent run never implies a case is financially closed.

## Event-to-outcome automation

| Trigger | Autonomous agent work | Deterministic check or write | Human boundary |
| --- | --- | --- | --- |
| Correction status changes to `Payer reports fixed` in an opted-in JSM project, with notice reference | Evidence agent locates permitted source versions only after deterministic eligibility and minimum-input checks | Authorize caller/project; deduplicate event; create case/control record; validate source manifest; dispatch eligible work | Analyst supplies absent inventory or source. Ordinary issue creation starts no paid run |
| New notice/procedure or inventory | Scope agent proposes inclusion rule with cited passages and records contradictions | Validate source version, inventory coverage, identifiers and schema | Supervisor confirms population and expected-payment basis |
| Scope confirmed or new remittance batch | Exception agent investigates only ambiguous reference chains and groups similar exceptions; Challenger receives a frozen candidate and searches for evidence that would defeat it | Pure TypeScript engine joins independent expected lines to original, replacement and reversal events; computes integer-cent outcomes; deterministic verifier checks every source-linked counterexample | Analyst resolves unsupported adjustment semantics or scope interpretation |
| Current result has unresolved lines | Agent prepares a grouped internal follow-up with source references and needed facts | Create/link Jira work or internal JSM note once, using an idempotency key | Provider relations decides any external payer communication |
| All closure conditions satisfied | Challenger has completed bounded search | Deterministic verification rereads authorized source versions, replays obligations and marks the exact proof revision eligible only if all checks pass | Supervisor alone approves this exact revision and proof hash |
| Supervisor approves | No model inference is needed | Conditional revision check; project approved closure to Jira; reread and verify | Reapprove if any input changed |
| Duplicate batch or event | Agent may recognize it, but does not decide the financial result | Fingerprint event identities; no new revision or duplicate write | None |
| Late reversal, correction, superseding notice or lost source access | Agent explains what changed and investigates new exceptions | Immediately invalidate affected proof obligations, mark old proof stale; recompute; reopen if closure conditions fail | Supervisor decides later reclosure |
| Worker timeout, model/tool error or budget limit | Agent stops with a concrete reason | Bounded retry, recovery sweep, and visible failed-run state | Operator or analyst resumes after cause is addressed |
| Provider-relations update | No model changes proof state from communication alone | Record outcome, next-review date and evidence references; register a new source event only when evidence is supplied | Provider relations controls contact and decides whether to continue pursuit |

## Agent team and tool contract

There are four **reasoning agents**: Evidence, Scope, Exception and Challenger. Intake and Verification are deterministic stages. LangGraph.js may orchestrate a bounded tool loop for one reasoning stage inside one Forge invocation; Forge Async Events and SQL own durable progress. Agents choose only role-specific allowlisted read tools and return typed proposals. They cannot choose arbitrary APIs or write targets. The deterministic controller validates and persists outputs, performs money arithmetic, matches references, establishes cohort completeness and executes idempotent Jira/JSM writes.

| Role | Unique responsibility | Required output | Stops when |
|---|---|---|---|
| Evidence | Permission-aware discovery across permitted notice/procedure versions | `EvidencePack`: queried and unsearched sources, passages, versions, contradictions, access failures and coverage status | Source budget reached, all eligible sources queried, access denied or no new evidence |
| Scope | Translate evidence into a proposed population and expected-payment predicate | Cited predicate, effective dates, exclusions, contradictions, confidence limits and questions for supervisor | Citation invalid, rule unsupported/contradictory or proposal complete |
| Exception | Investigate known ambiguous reference chains after deterministic detection | Typed grouped findings, source chains, unsupported semantics and next evidence needed | Group resolved, lookup budget reached or unsupported semantics found |
| Challenger | Independently attempt to falsify a frozen candidate | Typed counterexamples naming obligation, source IDs, claim and requested deterministic check | Search budget complete, counterexample found, source inaccessible or revision stale |

The Challenger cannot inspect producer scratch memory or modify the candidate. Deterministic verification records each challenge as reproduced, refuted or unresolved. Agent confidence never makes a proof pass.

Tool handlers validate every model-provided argument with Zod; check installation, project, caller/source visibility and case revision; and return a typed result with a stable source ID. The model never receives a raw credential. Read tools include notice passage, inventory manifest, remittance reference chain, case summary, and revision difference. Write tools are limited to owned internal Jira/JSM fields, links and notes. A separate policy function approves every write before execution.

Autonomy has finite bounds: maximum node visits, evidence lookups, model calls, tokens, runtime and spend per case. When exhausted, the run reports what it established and the precise unresolved question. No agent rewards itself for finishing a case or suppresses an exception to make a metric look better.

## User experience

The case page answers four questions in order: **Which lines should be in scope? What correction was expected? What did the remittances actually show? What is the next justified action?** A compact timeline shows agent steps, source IDs, rule version, tool outcomes, duplicate detection, approval and later reversals. The analyst can challenge a source or correct an extraction. The supervisor sees exactly which revision they approve. The Rovo agent and an authorized MCP caller can read the same revisioned result, but cannot approve it. No staff leaderboard, individual performance score or surveillance dashboard is part of the product.

## Development schema

| Gate | Deliverable | Proof needed before the next gate |
| --- | --- | --- |
| 0. Domain contract | Synthetic fixture, state vocabulary, independent inventory, proof obligations and expected-payment semantics | Hand calculation reproduces 12 in-scope lines, one missing $100 correction, then a late $100 reversal; a contradictory scope variant defines a counterexample |
| 1. Platform spike | Deployed Forge async consumer; encrypted OpenAI key; backend egress declaration; one structured-output call; one bounded LangGraph tool loop; SQL-persisted stage result | A second invocation resumes from persisted stage state; timeout and model outage terminate safely; scopes, cost and Runs-on-Atlassian impact are recorded |
| 2. Correct core | Pure reconciliation library and source manifests | Duplicate, reversal, missing-line, out-of-order and ambiguous-reference tests pass; no false closure |
| 3. Autonomous journey | Deterministic intake/verification plus Evidence, Scope, Exception and Challenger work, proof UI and internal action | Two different synthetic cases work without hardcoded paths; a source-linked counterexample blocks eligibility; retries produce no duplicate effect |
| 4. Trust and access | Role matrix, revision/hash-bound supervisor approval, automatic proof invalidation, permission checks, case trace and cost limits | Every unauthorized command is denied; stale approval is rejected; a reversal breaks a named obligation; denied caller sees no case; failed worker is recoverable |
| 5. Evaluation and submission | Timed manual/app comparison, judge install link, seeded scenarios, public demo | Observed time and error results are reported honestly; exact submitted build passes fresh-site test |

If the LangGraph package cannot run reliably on Forge, retain agent roles and tool contracts but use Forge async events plus SQL as the durable controller. A custom LangGraph checkpoint adapter is optional; SQL-backed stage state is required. If the Teamwork Graph API or MCP permission model cannot be verified, omit that bonus claim. These fallbacks preserve the core product and prevent a preview integration from deciding financial correctness.

## Evaluation and business case

Primary outcome: active analyst and reviewer minutes per **correct** case disposition, including time spent checking agent work. Safety measures: false-closure count, unresolved-line recall, duplicate-write count, wrong-scope count, and inaccessible-source leakage. Report the sample and method. ROI uses observed minutes saved multiplied by an explicit loaded labor rate; any avoided rework or recovered amount is counted only when independently measured. The hackathon demo proves a functioning workflow, not production savings.

The labeled oracle, baselines, held-out cases and role-specific pass criteria are defined in [EVALUATION-PLAN.md](EVALUATION-PLAN.md). No agent is enabled in the end-to-end path until its required oracle cases pass.
