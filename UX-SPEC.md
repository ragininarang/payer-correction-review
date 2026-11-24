# Payer Correction Review — UX specification

**Status:** canonical V1 interaction specification, November 23, 2026. This document translates the PRD and system design into user-facing structure, flows, states and language. It does not replace financial or security rules in `DECISIONS.md`.

## Users and goals

| User | Primary goal | Authority in V1 |
|---|---|---|
| RCM analyst | Investigate incomplete payer corrections and prepare follow-up | Review evidence, inspect service lines, record payer follow-up; cannot approve closure |
| Billing supervisor | Confirm inclusion criteria and decide whether a correction review may close | All analyst capabilities plus approval of the exact current evidence version |
| Provider-relations specialist | Contact the payer about selected unresolved items | View selected claims, record outcome and next review date; communication cannot change the financial result |
| App operator | Recover failed automated runs without changing financial facts | View a failed run, retry an idempotent stage, or escalate |

Patients and payer employees are not V1 users. The product contains synthetic data only.

## Terminology

- Use **Claims** for navigation and broad grouping.
- Use **service line** for the precise billed unit. Identify it as `Claim CLM-104724 · service line 2`, followed by service date and procedure code. Do not expose internal IDs such as `L07`.
- Use **inclusion criteria**, not scope; **included service lines**, not cohort; **potential issue**, not counterexample.
- Use **correction review**, not proof; **evidence version**, not revision; **technical identifier**, not fingerprint/hash.
- Use **Jira update**, not Jira projection; **payment activity**, not event chain; **amount still unresolved**, not unresolved cents.
- Use **automated review**, not agent, unless the operator opens technical details.

## Information architecture

The Jira issue panel is one case workspace with five persistent destinations:

1. **Summary** — current decision state, amount still unresolved, progress and next action.
2. **Claims** — searchable/filterable service-line results, selection and record details.
3. **Included claims and evidence** — inclusion criteria, cited notice, evidence intake and source health.
4. **Payer follow-up** — selected unresolved claims, communication outcome, next review date and attached evidence.
5. **Review history** — append-only business history; operator-only automation failures are shown separately.

`Review for closure` is a contextual supervisor action, not a navigation destination. Settings, access and cost controls belong to an admin surface outside the case workspace.

## End-to-end flows

### 1. Start or update a correction review

1. JSM status becomes **Payer reports fixed** and includes a payer notice reference.
2. System checks for the minimum required sources: submitted-claims inventory, payer notice and payment activity.
3. If a source is missing, the page shows **Waiting for documents** and names what is missing. No model run starts.
4. User selects **Add evidence**, chooses a supported source, and the system validates access, identity, format, duplicates and conflicts.
5. Accepted evidence creates a new evidence version; duplicate evidence is ignored; inaccessible/conflicting evidence returns a specific recovery action.

### 2. Confirm inclusion criteria

1. Supervisor opens **Included claims and evidence** and reviews payer, service dates, inventory basis, expected payment and cited notice text.
2. A proposed change must show the before/after service-line count before confirmation.
3. Confirmation creates a new evidence version. Cancellation leaves the prior criteria unchanged.
4. If population completeness cannot be confirmed, the only possible result is **Supplied claims checked**—never correction-wide closure.

### 3. Investigate claims

1. Analyst opens **Claims**, filters to **Needs review**, searches by claim ID, and opens a service line.
2. Details show expected/observed amount, difference, payment activity and human-readable source names.
3. Analyst may select one or more unresolved service lines and choose **Prepare payer follow-up**.
4. Loading, no-results and failed-review states always preserve filters and allow retry.

### 4. Record payer follow-up

1. Provider relations receives the selected claims grouped for contact.
2. User records communication outcome, next review date and an optional note.
3. A note alone never changes the correction result.
4. If new evidence is attached and accepted, the automated review reruns; a result change invalidates prior approval.
5. **Stop pursuing** is an administrative state only; the amount remains financially unresolved.

### 5. Review for closure

1. Supervisor opens the contextual action from **Summary**.
2. Modal shows included/corrected counts, amount still unresolved and evidence-version timestamp.
3. Server verifies the displayed evidence version and technical identifier.
4. If evidence changed, approval is refused and the new result is shown. Otherwise approval is appended.
5. Jira update is separate: **Approved — Jira update pending/failed** never revokes the financial approval.

### 6. New evidence, reversal or automation failure

1. New evidence is deduplicated, validated and registered before recomputation.
2. A material change advances the evidence version and invalidates current approval atomically.
3. A reversal reopens the correction review and points to the affected claim/service line.
4. Failed automated stages appear to operators with safe retry and escalation. Retrying cannot duplicate a financial mutation.

## State-to-copy contract

| System condition | User-facing status | Primary action |
|---|---|---|
| Required source absent | Waiting for documents | Add evidence |
| Automated review running | Checking evidence | None; show progress and last update |
| Criteria not confirmed | Waiting for criteria confirmation | Review inclusion criteria |
| One or more unresolved lines | Needs review | Review claims |
| All checks pass, not approved | Ready for closure | Review for closure |
| Exact version approved, Jira pending | Approved — Jira update pending | View update status |
| Exact version approved, Jira failed | Approved — Jira update failed | Retry Jira update |
| Later evidence changed result | Reopened after new evidence | Review what changed |
| Population completeness unconfirmed | Supplied claims checked | Confirm inventory completeness |
| Source access lost | Evidence source unavailable | Reconnect or replace source |
| Lookup/model budget exhausted | Automated review paused | Retry when budget is available |

## Feedback and recovery

- Every mutation returns a visible result: evidence accepted/rejected, follow-up saved, sent back to analyst, approved, Jira pending/failed, reopened or retry queued.
- Destructive reset requires a modal naming what will be cleared and that history remains auditable.
- Empty states explain whether no records exist or no records match the current filter.
- Error messages state what failed, what remains safe, and the next available action. Never blame the user.
- Technical IDs and orchestration details remain behind **Technical details** and are primarily for operators.

## V1 limits

- Synthetic generated claims and remittance activity only; no PHI or live payer submission.
- Payer communication is recorded, not sent automatically.
- The app supports review and approved Jira updates; it does not modify source billing data.
- Administrative closure without pursuit does not imply payment or erase unresolved exposure.

