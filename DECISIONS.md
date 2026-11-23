# Payer Correction Review — binding decisions

**Status:** approved build baseline, November 23, 2026. This file has precedence over the other planning documents. Changing a decision requires recording the replacement here before implementation follows it.

| ID | Decision | Consequence |
|---|---|---|
| D1 | The documents in this repository directory are canonical; same-named parent-directory files are historical. | Implementation and review use only this planning set. |
| D2 | Use the OpenAI Responses API for model reasoning. Do not use Forge LLMs. | Declare OpenAI backend egress, keep the key in encrypted Forge variables, and enforce model/cost budgets. |
| D3 | Use four reasoning agents: Evidence, Scope, Exception and Challenger. Intake and Verification are deterministic workflow stages. | Agent count follows distinct judgment needs rather than presentation complexity. |
| D4 | Forge Async Events and Forge SQL own durable orchestration. LangGraph.js may coordinate a bounded model/tool loop inside one worker invocation only. | A LangGraph checkpoint is not a financial or workflow source of truth. |
| D5 | The qualifying MVP trigger is an opted-in internal JSM issue whose correction status changes to `Payer reports fixed`, with a payer notice reference. Ordinary issue creation does not start a paid run. | The trigger is testable and avoids premature or noisy investigations. |
| D6 | Proof, human approval and Jira projection have separate statuses. Financial approval is valid in SQL once the exact current proof revision and hash are approved; Jira may separately be pending, synced, conflicted or failed. | Jira availability cannot silently change the financial decision. UI shows `Approved — Jira sync pending` when applicable. |
| D7 | Agents may read permitted sources and return typed proposals. They have no direct SQL/Jira write authority. A deterministic controller validates and persists proposals and executes idempotent approved writes. | Model output cannot directly mutate financial or workflow state. |
| D8 | Hackathon data is generated synthetic data only. Live claims, X12/ERA and PHI ingestion remain disabled. | Production compliance is a later gated workstream, not implied by the demo. |
| D9 | New project cash spend may not exceed $100. Existing OpenAI credits are excluded from that cash figure but calls remain metered and capped. | Paid calls stay disabled until project and per-run controls are configured and tested. |
| D10 | The hackathon promise is proof over an independently supplied inventory. If coverage is not confirmed, the only permitted outcome is `Supplied lines checked`, never cohort-wide closure. | Practitioner validation can refine source adapters without weakening the safety claim. |

## Decisions intentionally deferred

- Production inventory adapters, payer coverage and contract-rate modeling.
- Live-data BAA, residency, retention and provider security approval.
- Teamwork Graph and external MCP support unless clean-site identity tests pass.
- Portfolio dashboards and staff-level productivity reporting.
