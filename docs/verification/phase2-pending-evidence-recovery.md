# Phase 2 verification — pending evidence recovery

**Date:** November 24, 2026  
**Environment:** Forge development, version 2.5.0  
**Site:** `one-atlas-fnmi.atlassian.net`  
**Synthetic Jira issue:** `MOBL-57`

## Purpose

Verify the failure boundary where a source event is registered but the invocation stops before the authoritative case row, immutable proof revision and audit ledger are updated.

## Procedure and observed result

1. Initialized a new synthetic correction review at evidence version 1 with one missing $100 correction.
2. Enabled the development-only `PCR_ENABLE_RECOVERY_TEST` flag.
3. Invocation 1 registered `recovery-probe-correction-r1` as a pending, fixed synthetic correction event and intentionally returned without changing the case row.
4. Invocation 2 ran the production `runRecovery` function against Forge SQL.
5. The case advanced once to evidence version 2 and became **Ready for closure** with 12 of 12 service lines corrected and $0 unresolved.
6. Review history displayed one new **New evidence created an updated result** entry for evidence version 2.
7. The UI reported: **Recovery test passed: a separate invocation completed the interrupted evidence update exactly once.**
8. Removed the environment flag after the test.

## What this verifies

- A pending event registered before a crash is not skipped indefinitely.
- Recovery uses the event's frozen prior revision and desired step.
- The case advances once rather than creating a duplicate revision.
- The immutable proof and audit ledger are completed after recovery.
- The result is visible through the installed Forge issue panel, not only a local test.

## What this does not verify

- Delivery of the hourly scheduled trigger; invocation 2 called the same recovery function directly through the guarded test resolver.
- Recovery of a pending Jira projection/effect.
- OpenAI, LangGraph or agent-stage recovery, which belongs to Phase 3.

Gate 2 remains open until the first two unverified Phase 2 paths are exercised and recorded.
