---
name: pre-build-readiness-review
description: Audit completed product and agent planning immediately before implementation, using independent product, architecture, security/privacy, and agent/evaluation reviews. Use when deciding whether a planned product is ready to build; do not use for ordinary document review, implementation, or post-build code review.
---

# Pre-build readiness review

Determine whether implementation can begin safely and coherently. Review only; do not edit planning artifacts, create implementation files, change external systems, or begin coding.

## 1. Establish the evidence set

Locate all available planning evidence before judging readiness, including:

- PRD and acceptance criteria
- user, service, state, and exception flows
- visual system or business-logic schema
- system design and component/data-flow diagrams
- architecture decisions and unresolved alternatives
- implementation plan, milestones, roadmap, or backlog
- production-agent design, tool contracts, permissions, orchestration, memory, evaluation, and cost controls
- relevant planning decisions present only in the current conversation

Search the repository rather than relying only on expected filenames. Treat duplicate or differently dated artifacts as separate evidence until their authority is established. Record an artifact inventory containing the title/path or conversation label, revision/date when available, relevant sections, and apparent authority. If an artifact category is absent, report it as missing; do not reconstruct it from intuition.

Read each relevant artifact completely enough to evaluate its claims and follow its internal links to other planning artifacts. Use native read/inspection tools for non-text formats. Do not modify or normalize the source material.

Every material finding must cite the supporting artifact and section, heading, diagram label, requirement ID, or line when available. Cite conversation-only evidence as `Chat — <distinctive request or decision>`. Mark each claim as one of:

- **Verified fact:** explicitly supported by cited evidence.
- **Inference:** a conclusion drawn from cited evidence; explain the reasoning.
- **Missing information:** required evidence was not found after searching.

Do not treat a proposal, target, illustrative number, or unvalidated assumption as a verified fact.

## 2. Run four independent reviewer passes

When subagent delegation is available, an explicit request to run this skill authorizes four fresh, read-only reviewer subagents unless the user says not to delegate. Use four separate subagents with no inherited planning conversation when the tooling supports a fresh context. Give each the same artifact inventory, access to the raw artifacts, conversation-only evidence needed for citations, this skill's evidence rules, and exactly one role below. Tell each subagent not to edit files or coordinate with other reviewers.

Run reviewers in parallel as capacity permits; batching because of concurrency limits does not reduce independence. The primary agent is the final synthesizer and must not give reviewers suspected issues or desired conclusions. If delegation is unavailable or not authorized, perform four explicitly separated passes and reset the working hypothesis before each pass.

### Product skeptic

Test whether the proposed product solves a specific, evidenced user problem. Examine user value, actors and authority, complete happy/exception/recovery workflows, assumptions, scope and non-goals, acceptance criteria, success and guardrail metrics, research gaps, operational adoption, and unresolved product decisions. Identify requirements that describe a solution without establishing the problem or decision it supports.

### Architecture critic

Test whether the design can deliver the stated requirements without unnecessary machinery. Examine component boundaries, source of truth, data ownership and lifecycle, contracts, coupling, dependencies, state transitions, idempotency, concurrency, failure/recovery behavior, scalability targets, maintainability, deployment constraints, optional versus critical integrations, and overengineering. Trace at least one normal case and one failure case end to end.

### Security/privacy reviewer

Derive the product-specific assets, sensitive data, actors, trust boundaries, authentication, authorization, least-privilege permissions, tenant and case isolation, background-job identity, external integrations, model/tool data exposure, abuse and misuse cases, retention/deletion, logging, incident recovery, and required human approvals. Distinguish hackathon/synthetic-data controls from requirements for a real production pilot. Do not report generic security advice without tying it to a documented flow, asset, or missing decision.

### Agent/evaluation reviewer

Challenge the need for every proposed agent. Determine whether deterministic code, a workflow, one agent, or fewer specialized agents would suffice. For each justified agent, examine its unique objective, inputs, tools, permissions, memory/state, model boundary, handoffs, stopping conditions, retry and failure recovery, human escalation, observability, cost and latency budgets, and evaluation cases. Flag role names that merely split a deterministic pipeline into artificial agents. Preserve genuinely useful independence, such as an adversarial reviewer, only when its objective and evaluation differ from the producing agent.

Assess both component-level and end-to-end evaluation: fixtures, labeled expected outcomes, safety cases, authorization tests, adversarial or contradictory evidence, duplicates, stale revisions, partial failure, model/tool outage, cost limits, latency, regression gates, and criteria for disabling an agentic path.

Each reviewer returns concise, artifact-grounded findings, recommended severity, evidence type, consequence, and the smallest decision or change that resolves the issue. Reviewers must also state what they checked and found adequate so absence of a finding is interpretable.

## 3. Synthesize without voting

After all four passes finish, reconcile them as a separate synthesis step. Do not count votes or discard a concern because other reviewers omitted it. Merge findings only when they share the same underlying cause, affected decision, and resolution. Preserve disagreements in a dedicated table containing:

- reviewer positions
- cited evidence behind each position
- why the disagreement exists
- consequence of choosing either interpretation
- synthesizer conclusion, or the targeted user decision still required

Check every proposed P0 and P1 directly against the artifacts. Downgrade speculative concerns; promote cross-cutting contradictions when their combined consequence is greater than either isolated finding.

## 4. Classify findings

Assign exactly one class to each retained finding:

- **P0 — must resolve before any implementation:** proceeding would risk building the wrong product, violate a critical safety/authorization boundary, make the core design internally impossible, or leave no valid way to verify core correctness.
- **P1 — must resolve before the affected component is implemented:** unaffected foundation work may proceed, but the named component or workflow cannot responsibly begin.
- **P2 — may be resolved during implementation:** bounded issue with an identified implementation-time owner and verification point.
- **Assumption — safe to proceed temporarily if explicitly recorded:** include the evidence gap, chosen temporary assumption, owner, validation method, expiry/trigger, and what work must stop if it is false.

Do not inflate severity because an item is important. A finding is P0 only when it blocks all responsible implementation, not merely a later integration.

## 5. Produce the readiness report

Return one self-contained report in this order:

1. **Executive summary** — product being assessed, evidence coverage, highest risks, and verdict.
2. **Artifact inventory** — artifacts reviewed, authority/revision, and missing categories.
3. **Requirements-completeness matrix** — problem/value, users and authority, workflows, data, functional requirements, non-functional requirements, integrations, security/privacy, agent design, evaluation, operations, implementation plan, and non-goals. For each: status (`Complete`, `Partial`, `Missing`, or `Contradictory`), citations, and consequence.
4. **Prioritized findings** — ID, class, evidence type, finding, consequence, citation, and exact resolution condition.
5. **Contradictions between artifacts** — quote or tightly paraphrase both sides, identify which decision controls implementation, and request an authority decision where needed.
6. **Missing decisions and targeted questions** — ask only questions whose answers change scope, architecture, safety, evaluation, or implementation order. State the default consequence of leaving each unanswered.
7. **Production-agent necessity assessment** — evaluate every proposed agent and non-agent stage; recommend `retain`, `merge`, `replace with deterministic code/workflow`, or `defer`, with reasons.
8. **Recommended minimum initial agent architecture** — smallest architecture that still proves the claimed product value and preserves necessary independent challenge. Specify responsibilities, tools, permissions, state, handoffs, stopping/escalation conditions, and human gates.
9. **Security and privacy gaps** — product-specific assets, trust boundaries, gaps, human approvals, and production-versus-demo distinction.
10. **Evaluation and test-readiness assessment** — available fixtures/oracles, missing cases, measurable gates, observability, cost/latency tests, and whether claims can be falsified.
11. **Suggested MVP implementation sequence** — order work so early slices retire the largest product, safety, and architecture risks. Put explicit entry/exit gates before components blocked by P1 findings.
12. **Reviewer disagreements** — preserve material differences and consequences; do not force consensus.
13. **Final verdict** — `READY`, `READY WITH ASSUMPTIONS`, or `NOT READY`.
14. **Exact conditions to reach READY** — an actionable, finite list mapped to finding IDs and artifact changes or decisions required.

Keep the report specific to the reviewed product. Do not pad sections with generic checklist material.

## Verdict rules

- **NOT READY:** one or more unresolved P0 findings exist.
- **READY WITH ASSUMPTIONS:** no P0 exists, but explicit assumptions or P1 decisions remain; the report identifies a safe initial sequence that does not cross their gates.
- **READY:** no P0 or P1 remains; core requirements are mutually consistent; necessary security/human boundaries and evaluation oracles are defined; any remaining P2 items have owners and verification points.

If evidence is insufficient to prove a stronger verdict, choose the weaker verdict. State the exact conditions—not general aspirations—that would change it to READY.

## Stop conditions

Stop and ask a targeted question only when an unavailable artifact or authority decision prevents evidence-based classification. Otherwise complete the audit with the gap recorded. Never silently resolve contradictions, modify the product plan, begin implementation, or treat the review itself as approval to build.
