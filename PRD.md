# Payer Correction Review — product requirements

**Decision, November 22, 2026.** Build an internal Forge app for provider revenue-cycle teams. Enter Codegeist under **Apps for Specialized Industries**. The launch user is a cash-posting analyst at a billing organization that already coordinates payer issues in Jira Service Management (JSM). That workflow assumption needs practitioner validation. This document defines the build and its acceptance criteria. [Autonomous workflow](AUTOMATION-SCHEMA.md) · [Delivery roadmap](ROADMAP.md) · [System design](SYSTEM-DESIGN.md)

## Problem and value

A payer announces that a processing error has been fixed. Provider relations can record that notice immediately. Cash posting still needs to verify which of the provider's affected claim lines actually received the expected correction. CGS has published closed incidents in which providers were specifically asked to flag claims that remained unadjusted. Remittance adjustments can occur at the provider, claim, or service-line level. That makes simple row counts an unreliable closure test. [CGS resolved issues](https://www.cgsmedicare.com/partb/claims/resolved_issues.html) · [CMS remittance guidance](https://www.cms.gov/medicare/coding-billing/electronic-billing/health-care-payment-remittance-advice)

**User outcome.** From a JSM incident, establish which lines should have been corrected, see what the remittances support, and decide whether to close or follow up. A later reversal can change that decision. The distinctive product hypothesis is a **continuously checked proof of correction**, rather than an AI-generated assurance: an independent expected cohort, explicit proof obligations for every line, an active search for counterexamples, and a revision that becomes invalid when later evidence breaks an obligation. Existing vendors already support reprocessing and reconciliation, so this differentiation needs competitor and practitioner validation. [Finni Health’s reprocessing workflow](https://www.finnihealth.com/resources/clinicians/handle-payer-initiated-aba-claim-reprocessing) · [Waystar](https://www.waystar.com/our-platform/smart-platform/) · [CoOrdio](https://www.coordio.com/products/cycle)

**Autonomous product behavior.** A configured incident or changed evidence starts an agent run without a user prompt. Specialized agents gather permitted context, propose scope, investigate exceptions, challenge the candidate proof, prepare internal follow-up and explain changes. The app's deterministic engine computes the financial result and checks each proof obligation. Human decisions are limited to confirming the population/payment rule, resolving unsupported evidence, approving financial closure, and controlling payer communication. Agents may carry out approved internal Jira/JSM changes and must verify their effect. This keeps the workflow autonomous without granting an LLM unsupported financial authority.

## Stakeholders and decisions

| Stakeholder | Job and authority |
|---|---|
| Cash-posting analyst, primary daily user | Compare original and replacement lines, inspect discrepancies, add evidence, propose a disposition. |
| Provider-relations lead | Own the internal JSM case, inspect a concise exception packet, decide what to communicate to the payer. |
| Billing supervisor | Confirm the expected-population rule and payment basis. Approve closure against a specific evidence revision. Can return a case for investigation. |
| RCM director / buyer | Evaluate cycle time, unresolved exposure and operating cost by case. Receives aggregate reporting. |
| Payer representative, indirect stakeholder | Supplies notices and clarifications. Receives only the follow-up the provider chooses to send. No external portal in this release. |
| Patient, indirect stakeholder | Has a privacy interest in billing information. The hackathon edition accepts only synthetic fixtures. No patient-facing decision or balance update. |
| Site admin, security and integration owners | Install, map roles, approve scopes, configure sources and retention, review failures and data boundaries. Admin status alone grants no case-review rights. |
| Rovo assistant and authorized consuming agents | Retrieve a revisioned case summary, inspect an exception, and ask what changed. Inherit caller visibility. Cannot approve closure or initiate payer contact. |
| Judge / evaluator | Install in a clean site, seed a synthetic case, vary evidence and independently verify outputs in the app. |

## Case workflow and closure policy

1. Start from an internal JSM incident. Select a payer notice, an **independent inventory of submitted claims**, the corresponding original remittances, later adjustments, and an approved expected-payment rule. Show origin, effective period, version, and completeness of each input.
2. The scope investigator proposes inclusion/exclusion conditions with evidence. The supervisor confirms the date basis, population boundary, inventory coverage and expected amount basis. A complete-looking list of remittances alone cannot identify a claim omitted from the correction.
3. Reconcile the cohort. Show counts for corrected, missing, amount mismatch, reversed and ambiguous lines; identify out-of-scope items separately. Show unresolved balances only where an expected amount is known.
4. Investigate exceptions. Each has an evidence timeline, the reason it remains open, and the next useful action. Provider relations can prepare a single internal follow-up for several lines; the human controls external communication.
5. Publish a **candidate proof** pinned to the inventory, rule, notice, remittance versions and cutoff. For every expected line, record the reference chain, observed net, expected net and passed or failed obligation. A bounded Challenger agent searches for excluded-but-eligible lines, superseded rules, ambiguous chains and contradictory adjustments. It submits source-linked counterexamples; deterministic checks reproduce or reject them. Unresolved material challenges block eligibility. The proof is an inspectable computational record, not a legal attestation.
6. Closure requires confirmed scope, complete inventory for that scope, current inputs, a supported expected-payment rule, zero unresolved in-scope lines, no unresolved material challenge, and supervisor approval of the exact proof revision. A zero-line cohort requires explicit review. Scope ambiguity yields **Population unknown**; complete verification of a partial upload yields **Supplied lines checked**. Neither qualifies for financial closure.
7. A material correction, reversal, new in-scope line, superseding notice or lost source access immediately marks the approved proof stale or invalid. Preserve the previous decision, show the broken obligation and difference, and reopen a closed case if its closure conditions fail. A duplicate input leaves both the result and Jira workflow unchanged.

**Financial semantics.** Reprocessed means a linked adjustment was observed. Corrected as expected additionally requires net adjudicated payment to match the approved expectation. Cash received requires separate payment evidence. The submission stops at adjudication. Staff can record a disputed amount even when recovery is uncertain. [CMS distinguishes ERA and EFT](https://www.cms.gov/priorities/key-initiatives/burden-reduction/administrative-simplification/transactions/health-care-payment-remittance-advice-electronic-funds-transfer)

## Release requirements

| ID | Priority | Acceptance test |
|---|---|---|
| R1 | Core | A clean install can initialize a synthetic case from the internal Jira workspace. A second initialization safely resumes or opens the existing case. Show setup instructions for missing capabilities. |
| R2 | Core | Scope review displays cited source passages and inventory coverage. Ambiguous notice, inconsistent rule or missing inventory blocks closure and identifies the needed evidence. |
| R3 | Core | Independent expected lines are joined to original, reversal and replacement events. Duplicates, out-of-order records, conflicting references and provider-level adjustments pass the labeled evaluation suite. |
| R4 | Core | Summary and detail agree on revision, counts and amounts. An analyst can get from a discrepancy to its source in two selections. Visible text communicates status independently of color; essential actions support keyboard navigation. |
| R5 | Core | A supervisor can close an eligible case. An analyst or agent cannot. A concurrent update invalidates stale approval. A late reversal reopens exactly one affected case. |
| R6 | Core | Product events start a durable multi-agent investigation automatically. Intake, scope, evidence, exception, Challenger and verification roles select bounded tools through LangGraph.js. A second invocation can resume the case. Rovo can explain a changed result and cite source references visible to the caller. Capture tool outcomes, cost and failures per run. |
| R7 | Core | Restricted sources and cases remain restricted across UI, search, Rovo and exportable summaries. Recovery from a worker retry cannot double an amount or duplicate the Jira update. Agents cannot approve closure or contact payers. |
| R8 | Target bonus | A second Rovo Studio agent calls read-only Forge MCP tools against the same case. Test an allowed user, a denied user, a stale revision, and a page of exceptions. Submission claims this integration only after a fresh-site test. |
| R9 | Stretch | Permission-filtered Teamwork Graph discovery finds related notices or incidents. Explicit source links remain sufficient for the core case. |
| R10 | Core | A versioned proof record exposes the independently expected cohort, source fingerprints, cutoff, per-line obligations, counterexample findings, approval and invalidation reason. A Challenger independently queries permitted sources under a bounded budget; the deterministic verifier reproduces findings and never treats the agent's confidence as a pass. An omitted eligible line or superseding rule blocks closure even when all imported remittance rows balance. |

**Scope boundary.** One provider organization per fixture, one USD correction rule per case revision, synthetic normalized files, and internal users. Live X12 integration, payer outreach, collections posting, contract-rate modeling, staff scoring and portfolio dashboards sit outside the hackathon. Confluence adds a real versioned policy source when connected; the seeded case also carries a versioned local fixture.

**Budget boundary.** New cash spend across APIs, hosting and tooling stays below $100 for this project. The user's existing $85 OpenAI API credits are available but are excluded from new cash spend. The app uses the OpenAI API rather than Forge LLMs for background reasoning; per-run limits and a dedicated OpenAI project spend control apply. The core deterministic result must still work when the model is unavailable.

## Worked acceptance fixture

The inventory has 13 lines. Twelve match the confirmed scope, one falls outside its effective dates. The 12 were originally denied at $0; the approved correction is $100 per line. The first replacement file accounts for 11 lines. The candidate proof shows 11 passed line obligations, one failed obligation and $100 unresolved. The next file supplies the twelfth correction. The supervisor can approve that exact proof. Reimporting either file changes nothing. A later $100 reversal referring to line 07 invalidates its obligation and reopens the case with 11 corrected and $100 unresolved. The original closed proof remains inspectable. A second variant contains an apparently out-of-scope line whose notice language contradicts the extracted date predicate: the Challenger must surface the source-linked counterexample, and eligibility stays blocked until the scope is confirmed. Switching inventory coverage to “unconfirmed” must also suppress cohort-wide closure even if every supplied line matches.

## Measurement and research

**Primary measure:** total active analyst and reviewer minutes per correct disposition, including time verifying agent findings. Compare app and manual reconciliation on equivalent held-out fixtures, counterbalance order, and record participants, case size, errors and elapsed versus active time. Report observed results with sample size. A timed solo walkthrough is labeled as such. Proposed target is a 30% reduction with zero false closures on the labeled safety suite; both are targets pending measurement.

Secondary measures: unresolved-line recall, incorrect reopening rate, source-citation accuracy, median investigation latency, cost per completed case and review overrides. Report dollars under review separately from realized payments. Illustratively, 300 lines at three minutes saved per line frees 15 hours before fixed review overhead. Only observed baseline time, usage cost, and case frequency support a customer ROI claim.

Before pilot, ask a cash-posting analyst to reconstruct their last bulk correction and ask a supervisor what evidence permitted closure. If the only available source is a partial remittance export, ship the narrower “supplied lines checked” promise for that customer. Record the decision in the pilot requirements.
