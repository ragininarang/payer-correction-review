# Payer Correction Review — tech stack and component decisions

**Product requirement driving the stack:** produce a revisioned, inspectable proof of correction; autonomously seek counterexamples; let deterministic checks establish financial results; invalidate prior approval when evidence changes. The stack must support a solo build, a judge-installable Forge app and the $100 ceiling on new cash spend. See [PRD](PRD.md), [system design](SYSTEM-DESIGN.md) and [roadmap](ROADMAP.md). These are planned choices, not claims that integrations are already deployed.

| Layer | Planned choice | Why this product needs it |
|---|---|---|
| Language and repository | Strict TypeScript on Node.js 24, npm workspaces, GitHub for version control and CI | One set of types for input records, proof obligations, agent tool contracts, Forge handlers and UI. Work locally in Codex; pull, commit and push to GitHub. |
| Frontend | React + Vite + Atlassian Design System in Forge Custom UI | An internal JSM/Jira issue panel and full case workspace show cohort coverage, line obligations, counterexamples, revisions and supervisor actions. |
| Forge backend | Forge Functions/resolvers, product triggers, Async Events, scheduled recovery | Atlassian-native installation, identity, event-driven runs, bounded background stages and retries. A durable outer controller survives invocation limits. |
| Orchestration | LangGraph.js inside bounded Forge async workers; SQL state between workers | Specialized Intake, Scope, Evidence, Exception, Challenger and Verification roles can choose allowlisted tools. Forge queues and SQL, rather than an in-memory graph, own durable progress. Prove packaging and resume in an early deployed spike. |
| Model | OpenAI Responses API with structured outputs validated by Zod | Extract notice conditions, investigate ambiguous evidence and propose cited counterexamples. Model never computes authoritative money, establishes completeness by assertion, approves closure or contacts a payer. Pin evaluated model and prompt versions. |
| Financial/proof core | Pure TypeScript, integer cents, versioned rule adapters and deterministic obligation verifier | Reproducible line matching, signed adjustment chains, independent cohort coverage, challenge checking and invalidation. Runs without the model on frozen fixtures. |
| Storage | Forge SQL with migrations and tenant-scoped, revisioned tables | Store source manifests and fingerprints, expected lines, remittance events, proofs and obligations, challenges, approvals, run state, idempotency keys and Jira projection receipts. Never use Jira comments as the financial database. |
| Atlassian sources | Jira REST v3, JSM REST, optional Confluence REST v2 | Jira/JSM anchors the payer incident and internal follow-up. Confluence provides permission-checked, versioned notice/procedure evidence when available. Independent inventory and remittances are uploaded synthetic fixtures in the hackathon. |
| Agent-facing surfaces | Rovo actions/agent for authorized explanation; Forge Rovo MCP for read-only proof tools if caller authorization passes clean-site testing | Other agents can inspect the same revisioned proof and changed obligations. Rovo is an interface to the app, not the background orchestration runtime. MCP is a bonus candidate, never a hidden dependency of reconciliation. |
| Context discovery | Teamwork Graph API, optional stretch | Find related incidents or policies if entitlement and permissions permit. It cannot establish the expected claim cohort or financial correctness. |
| Observability | Structured Forge logs, SQL decision history, optional metadata-only Langfuse on synthetic runs | Trace each stage, tool, source ID, rule/model version, challenge outcome, cost, retry and Jira effect. The analyst sees the decision trail; operators see failures. No staff performance scoring. |
| Quality and delivery | Vitest + fast-check for core invariants, React Testing Library for case UX, Playwright for install and end-to-end journey, GitHub Actions | Verify duplicates, reversals, stale approval, source permissions, counterexample recall, recovery and two non-hardcoded cases before the judge demo. |

## Runtime path

1. A JSM event creates a case revision and queues Intake. Forge checks installation and source access.
2. Scope/Evidence agents propose an evidence-linked cohort and rule. The supervisor confirms them; the independent inventory remains separate from payer adjustment rows.
3. The TypeScript core builds a candidate proof with per-line obligations. The Challenger searches bounded, authorized sources for counterexamples; deterministic code reproduces or rejects each one. Unresolved material findings block eligibility.
4. A supervisor approves the exact eligible proof revision. Forge projects the approved status to Jira and verifies the resulting state.
5. A new reversal, changed notice or lost access immediately marks the prior proof stale, queues recomputation and reopens an affected closed case. Rovo and MCP readers see only the authorized current revision and its history.

## Spend and release controls

The user's existing $85 OpenAI API credits are excluded from the **$100 maximum new cash spend** across all project APIs, hosting and tooling. Use a dedicated OpenAI project spend limit and per-run token/call limits; monitor Forge and any other metered usage. Langfuse is optional and must not introduce required paid infrastructure. The hackathon sends synthetic data only. Real claims or PHI require a separate provider-approved security, privacy and data-flow design. Validate Forge entitlements, egress, SQL limits, Rovo/MCP identity and LangGraph packaging in the platform spike before relying on them in the demo.
