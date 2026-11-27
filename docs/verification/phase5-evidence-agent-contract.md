# Phase 5 verification — Evidence agent contract

**Date:** November 26, 2026
**Status:** PARTIAL — contract and deterministic safety tests pass; live model evaluation and workflow enablement remain open
**Runtime:** local Node.js 24 test/build environment

## Implemented and verified

- A versioned `EvidencePack` contains exact searched source versions, unsearched sources and reasons, access denials, citations, contradictions, coverage, terminal reason and run observability.
- The agent has no mutation tool. Its only external capability is an injected, source-version-bound read function.
- The controller permits at most two model calls and eight source reads per case revision.
- Closure-critical permitted sources are deterministically placed ahead of optional model choices, so a planner cannot crowd required evidence out of the tool budget.
- Denied sources expose only catalog metadata. Their content is never passed to the read tool or model.
- Citation publication fails when a citation names a source version that was not actually read. Contradictions may reference only known citation identifiers.
- Tool-budget exhaustion, read failure, denied critical evidence and incomplete coverage remain explicit. None can become a completed evidence pack silently.
- A revision-currentness check stops stale work before the analysis call can publish.
- OpenAI integration uses structured Responses API outputs, `store: false`, two idempotency keys, fixed timeouts and a pinned prompt version. Source text is explicitly treated as untrusted evidence rather than instructions.
- Strict TypeScript, 40 tests, the production UI build and Forge lint pass.

## Initial contract cases

1. The planner omits a critical inventory: the controller adds it.
2. A critical supervisor-only rule is denied: no read occurs, coverage is incomplete and the terminal reason is `access-denied`.
3. A model cites an unread source version: publication is rejected.
4. Nine critical sources exceed the eight-read budget: the omitted source is named and the terminal reason is `budget-exhausted`.
5. Eight optional planner choices compete with one critical inventory: the inventory is read first.
6. Superseding notices conflict: both citations and the unresolved consequence are preserved.
7. The case revision changes after retrieval: analysis does not run and the result is `stale-revision`.

## Still required before Evidence-agent enablement

1. Build the labeled Evidence fixtures for O1, O5–O8 and O12–O14 from `EVALUATION-PLAN.md` without using model output to set the gold labels.
2. Add the Forge worker adapter that reads only authorized, current source versions and persists the pack against the active case revision.
3. Run the pinned OpenAI model on the labeled safety set and compare it with deterministic-only and one-agent baselines.
4. Demonstrate 100% retrieval of closure-critical permitted sources, zero denied-content leakage and explicit reporting of every incomplete search.
5. Record calls, tokens, latency and cost, then keep the role disabled if its value does not justify the added cost and latency.

This is not Gate 5 completion. It proves the role boundary and failure behavior required before model-quality evaluation.
