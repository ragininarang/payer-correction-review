# Phase 2 verification — scheduled Jira projection recovery

**Date:** November 24, 2026  
**Environment:** Forge development, temporary version 3.1.0 five-minute test schedule  
**Site:** `one-atlas-fnmi.atlassian.net`  
**Synthetic Jira issue:** `MOBL-57`  
**Synthetic review:** `PCR-1042`

## Purpose

Verify that a pending Jira effect is completed by the real scheduled recovery path, that later retries are idempotent, and that evidence arriving after approval publishes an invalidation rather than leaving the obsolete approval in Jira.

## Procedure and observed result

1. Approved evidence version 2 with 12 of 12 included service lines corrected and $0 unresolved.
2. The UI immediately showed **Approved · Jira update pending**; financial approval and Jira projection remained separate.
3. The scheduled worker wrote the exact version 2 proof hash to the app-owned Jira issue property, read it back, and changed the UI to **Approved** with **Jira update: Synced** at 12:13:33 p.m.
4. Left the case unchanged through the next scheduler cycle. Review history still contained exactly one **Closure approved** and one **Jira update synced** event, proving the retry created no duplicate mutation or audit entry.
5. Imported a synthetic late reversal. The case immediately advanced to evidence version 3, reopened one service line with $100 unresolved, invalidated the prior supervisor approval, and showed **Jira update: Pending**.
6. The scheduled worker projected version 3 with `approvalStatus: invalidated`, read it back, and changed **Jira update** to **Synced** at 12:23:33 p.m.
7. Final review history contained one sync for version 2 and one sync for version 3, preserving both transitions without duplicating either.
8. Restored the normal hourly scheduler after the test.

## What this verifies

- A financial approval is not presented as Jira-synced until exact write/read-back succeeds.
- The scheduled trigger completes pending Jira effects without a manual recovery call.
- Scheduler redelivery is idempotent.
- Late evidence creates a new revision and invalidates the earlier approval before projection.
- The worker publishes the current invalidated revision/hash rather than the obsolete approved revision/hash.
- Financial approval state and Jira projection state remain independently visible.

## What this does not verify

- OpenAI, LangGraph or agent-stage orchestration; those belong to the Phase 3 feasibility spike.
- Jira outage behavior against a real outage; finite retry and terminal-failure policy are covered by deterministic tests, while a controlled failure exercise remains part of hardening.
- Production health-care data or workflows; all evidence is synthetic.

This record, the pending-event recovery record, and deterministic replay/fault tests satisfy Gate 2. The next gated work is Phase 3.
