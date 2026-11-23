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
| Closed | Supervisor approved this exact revision and Jira projection was verified | New evidence may reopen automatically |
| Reopened | New evidence invalidated the approved result | Agent reruns affected investigation; supervisor reviews again |

Agent-run state is separate: queued, running, waiting for source, waiting for scope decision, waiting for approval, completed, failed, or cancelled. Completing an agent run never implies a case is financially closed.

## Event-to-outcome automation

| Trigger | Autonomous agent work | Deterministic check or write | Human boundary |
| --- | --- | --- | --- |
| Configured JSM incident created | Intake identifies payer, affected period, references and missing inputs; Evidence agent locates permitted source versions | Deduplicate incident; create case and evidence ledger; post internal status | Analyst supplies absent inventory or source |
| New notice/procedure or inventory | Scope agent proposes inclusion rule with cited passages and records contradictions | Validate source version, inventory coverage, identifiers and schema | Supervisor confirms population and expected-payment basis |
| Scope confirmed or new remittance batch | Exception agent investigates ambiguous reference chains and groups similar exceptions; Challenger searches for evidence that would defeat the candidate proof | Pure TypeScript engine joins independent expected lines to original, replacement and reversal events; computes integer-cent outcomes; verifier checks each source-linked counterexample | Analyst resolves unsupported adjustment semantics or scope interpretation |
| Current result has unresolved lines | Agent prepares a grouped internal follow-up with source references and needed facts | Create/link Jira work or internal JSM note once, using an idempotency key | Provider relations decides any external payer communication |
| All closure conditions satisfied | Challenger has completed bounded search; Verification agent rereads inputs, proof obligations and Jira projection | Mark exact proof revision eligible only if all obligations pass and no material challenge is unresolved | Supervisor alone approves closure of this exact revision |
| Supervisor approves | No model inference is needed | Conditional revision check; project approved closure to Jira; reread and verify | Reapprove if any input changed |
| Duplicate batch or event | Agent may recognize it, but does not decide the financial result | Fingerprint event identities; no new revision or duplicate write | None |
| Late reversal, correction, superseding notice or lost source access | Agent explains what changed and investigates new exceptions | Immediately invalidate affected proof obligations, mark old proof stale; recompute; reopen if closure conditions fail | Supervisor decides later reclosure |
| Worker timeout, model/tool error or budget limit | Agent stops with a concrete reason | Bounded retry, recovery sweep, and visible failed-run state | Operator or analyst resumes after cause is addressed |

## Agent team and tool contract

The Intake, Scope, Evidence, Exception, Challenger and Verification agents are **specialized reasoning roles**, orchestrated by LangGraph.js. They can choose the next allowlisted evidence tool and request another bounded lookup. They cannot choose arbitrary APIs or write targets. The reconciliation engine is ordinary deterministic code because money arithmetic, reference matching and cohort completeness must be reproducible. The Challenger attempts to falsify the candidate proof by searching authorized notice versions, inventory exclusions and adjustment chains for a line or rule the first pass missed. It returns typed counterexamples with source IDs and an alleged broken obligation. Deterministic checks reproduce each claim; unverifiable material findings remain open for a person. A Challenger's confidence cannot make a proof pass. Record which checks ran and which could not run.

Tool handlers validate every model-provided argument with Zod; check installation, project, caller/source visibility and case revision; and return a typed result with a stable source ID. The model never receives a raw credential. Read tools include notice passage, inventory manifest, remittance reference chain, case summary, and revision difference. Write tools are limited to owned internal Jira/JSM fields, links and notes. A separate policy function approves every write before execution.

Autonomy has finite bounds: maximum node visits, evidence lookups, model calls, tokens, runtime and spend per case. When exhausted, the run reports what it established and the precise unresolved question. No agent rewards itself for finishing a case or suppresses an exception to make a metric look better.

## User experience

The case page answers four questions in order: **Which lines should be in scope? What correction was expected? What did the remittances actually show? What is the next justified action?** A compact timeline shows agent steps, source IDs, rule version, tool outcomes, duplicate detection, approval and later reversals. The analyst can challenge a source or correct an extraction. The supervisor sees exactly which revision they approve. The Rovo agent and an authorized MCP caller can read the same revisioned result, but cannot approve it. No staff leaderboard, individual performance score or surveillance dashboard is part of the product.

## Development schema

| Gate | Deliverable | Proof needed before the next gate |
| --- | --- | --- |
| 0. Domain contract | Synthetic fixture, state vocabulary, independent inventory, proof obligations and expected-payment semantics | Hand calculation reproduces 12 in-scope lines, one missing $100 correction, then a late $100 reversal; a contradictory scope variant defines a counterexample |
| 1. Platform spike | Forge app built from local Codex workspace source and installed on the demo site; Jira/JSM event; SQL; OpenAI call; small LangGraph run | A second Forge invocation resumes persisted state; external egress and scopes are known |
| 2. Correct core | Pure reconciliation library and source manifests | Duplicate, reversal, missing-line, out-of-order and ambiguous-reference tests pass; no false closure |
| 3. Autonomous journey | Event-triggered Intake/Evidence/Scope/Exception/Challenger/Verification work, proof UI and internal action | Two different synthetic cases work without hardcoded paths; a source-linked counterexample blocks eligibility; retries produce no duplicate effect |
| 4. Trust and access | Supervisor approval, automatic proof invalidation, permission checks, case trace and cost limits | Stale approval is rejected; a reversal breaks a named obligation; denied caller sees no case; failed worker is recoverable |
| 5. Evaluation and submission | Timed manual/app comparison, judge install link, seeded scenarios, public demo | Observed time and error results are reported honestly; exact submitted build passes fresh-site test |

If the LangGraph package cannot run reliably on Forge, retain agent roles and tool contracts but use Forge async events plus SQL as the durable controller. A custom LangGraph checkpoint adapter is optional; SQL-backed stage state is required. If the Teamwork Graph API or MCP permission model cannot be verified, omit that bonus claim. These fallbacks preserve the core product and prevent a preview integration from deciding financial correctness.

## Evaluation and business case

Primary outcome: active analyst and reviewer minutes per **correct** case disposition, including time spent checking agent work. Safety measures: false-closure count, unresolved-line recall, duplicate-write count, wrong-scope count, and inaccessible-source leakage. Report the sample and method. ROI uses observed minutes saved multiplied by an explicit loaded labor rate; any avoided rework or recovered amount is counted only when independently measured. The hackathon demo proves a functioning workflow, not production savings.
