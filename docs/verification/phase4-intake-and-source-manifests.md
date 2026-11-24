# Phase 4 verification — deterministic intake and source manifests

**Date:** November 24, 2026
**Status:** PARTIAL — backend and UI foundation deployed; Gate 4 remains open
**Environment:** Forge development, version 4.5.0
**Site:** `one-atlas-fnmi.atlassian.net`
**Synthetic Jira issue:** `MOBL-57`

## Implemented and verified

- A versioned source-manifest contract for payer notice, local procedure, independent submitted-claims inventory, payment basis and remittance batch.
- Manifest validation for schema version, SHA-256 content identity, payer identity, effective dates, visibility, counts, coverage declaration and supersession.
- Independent inventory must declare complete coverage and contain at least one item. Remittances cannot substitute for that inventory.
- Active-version selection removes superseded sources before intake eligibility is evaluated.
- Deterministic qualification requires all of the following: opted-in project, an exact status transition to `Payer reports fixed`, a Jira notice reference, a matching current payer-notice source, complete independent inventory, payment basis, at least one remittance batch and consistent payer identity.
- Missing inputs return an explicit list and start zero model calls.
- A Forge `avi:jira:updated:issue` trigger is deployed with self-generated events filtered out. The handler ignores non-status changes, checks SQL project opt-in, validates the notice reference, deduplicates the event and records either `awaiting-inputs` or `eligible`.
- Project automation configuration is operator-only and is bound server-side to the project containing the issue being viewed.
- Source registration is server-authorized, content-addressed and rejects reuse of a source ID with different content.
- The installed evidence page correctly showed a missing-source state, loaded five synthetic source manifests through an explicit supervisor action, and then displayed their user-facing roles and coverage.
- Local strict TypeScript, production build, Forge lint and 34 tests pass.

Atlassian documents that Jira updated events include a changelog and may include custom fields; oversized custom-field payloads may be omitted, so the handler safely falls back to the Jira REST API. Atlassian also notes trigger delivery may take up to three minutes. [Jira event reference](https://developer.atlassian.com/platform/forge/events-reference/jira/) · [Forge trigger reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/trigger/)

## What the current deployment proves

The product can distinguish evidence needed to decide **which claims belong in the review** from payment activity used to decide **what happened to those claims**. The UI no longer represents those as one undifferentiated evidence list. This is the structural guard against deriving cohort completeness from remittances.

Ordinary issue creation, comments, description edits and non-qualifying status changes cannot invoke OpenAI. Even a qualifying status transition cannot invoke OpenAI in Phase 4; it only produces a deterministic intake record for the future agent controller.

## Still required for Gate 4

1. Create or select an internal JSM test project with a `Payer reports fixed` workflow status and a plain-text payer-notice-reference custom field.
2. Map an operator account and explicitly opt that project into this app.
3. Exercise one transition with a missing manifest and verify the UI shows the named request with zero stage/model runs.
4. Register the missing source, repeat the transition and verify exactly one `eligible` intake event.
5. Record a payer communication event with no evidence and verify it does not change the proof; then attach referenced evidence and verify only that registered source can create a new revision.

The current `MOBL` development issue is not a JSM workflow configured for this healthcare scenario, so changing its status would not be a valid end-to-end Gate 4 test.
