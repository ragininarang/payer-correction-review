# Phase 4 verification — deterministic intake and source manifests

**Date:** November 26, 2026
**Status:** PASS — Gate 4 complete
**Environment:** Forge development, version 4.7.0
**Site:** `one-atlas-fnmi.atlassian.net`
**Synthetic JSM project and issue:** `PCR` / `PCR-1`

## Implemented and verified

- A versioned source-manifest contract for payer notice, local procedure, independent submitted-claims inventory, payment basis and remittance batch.
- Manifest validation for schema version, SHA-256 content identity, payer identity, effective dates, visibility, counts, coverage declaration and supersession.
- Independent inventory must declare complete coverage and contain at least one item. Remittances cannot substitute for that inventory.
- Active-version selection removes superseded sources before intake eligibility is evaluated.
- Deterministic qualification requires all of the following: opted-in project, an exact status transition to `Payer reports fixed`, a Jira notice reference, a matching current payer-notice source, complete independent inventory, payment basis, at least one remittance batch and consistent payer identity.
- Missing inputs return an explicit list and start zero model calls.
- A Forge `avi:jira:updated:issue` trigger is deployed with self-generated events filtered out. The handler ignores non-status changes, checks SQL project opt-in, validates the notice reference, deduplicates the event and records either `awaiting-inputs` or `eligible`.
- Project automation configuration is available to the app operator and to a Jira project administrator after a server-side `ADMINISTER_PROJECTS` permission check. It is bound server-side to the project containing the issue being viewed.
- The notice-reference field is discovered from Jira edit metadata by its configured name. The browser never supplies or trusts an internal field ID.
- Source registration is server-authorized, content-addressed and rejects reuse of a source ID with different content.
- The purpose-configured `PCR` JSM project has the exact `Payer reports fixed` workflow status and a plain-text `Payer notice reference` field. Automated intake is explicitly enabled for this project.
- A qualifying transition before the required manifests were available produced `awaiting-inputs`; the installed UI named the missing source records and stated that no model call was made.
- After five synthetic source manifests were registered, the live Jira trigger recorded exactly one `Intake qualified` event. The installed UI displayed `Automated intake checks passed` and stated that the intake check used no model call.
- A live `No response` payer follow-up kept evidence version 1, the unresolved $100 amount and the financial result unchanged.
- Adding the referenced synthetic replacement-payment evidence then created evidence version 2, changed the result to corrected and made the case ready for closure. Review history preserves the contact and evidence events separately.
- Local strict TypeScript, production build, Forge lint and 34 tests pass.

Atlassian documents that Jira updated events include a changelog and may include custom fields; oversized custom-field payloads may be omitted, so the handler safely falls back to the Jira REST API. Atlassian also notes trigger delivery may take up to three minutes. [Jira event reference](https://developer.atlassian.com/platform/forge/events-reference/jira/) · [Forge trigger reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/trigger/)

## What the current deployment proves

The product can distinguish evidence needed to decide **which claims belong in the review** from payment activity used to decide **what happened to those claims**. The UI no longer represents those as one undifferentiated evidence list. This is the structural guard against deriving cohort completeness from remittances.

Ordinary issue creation, comments, description edits and non-qualifying status changes cannot invoke OpenAI. Even a qualifying status transition cannot invoke OpenAI in Phase 4; it only produces a deterministic intake record for the future agent controller.

## Gate decision

Gate 4 passes. Ordinary Jira activity remains outside the paid path; incomplete intake fails closed with named missing inputs; complete intake creates an auditable eligible event without a model call; payer communication alone cannot alter the proof; and registered evidence is required before a new financial revision is created.

The next phase may implement agent contracts one role at a time. No agent receives write access, and each role must pass its evaluation gate before joining the main workflow.
