# Payer Correction Review

An Atlassian Forge app that builds a **revisioned proof of correction**: it checks an independently defined claim cohort against payer adjustments, actively looks for counterexamples, and invalidates a prior conclusion when new evidence breaks it. A supervisor approves financial closure. The hackathon build uses synthetic data.

## Planning documents

This directory is the **canonical planning authority** for the product. Same-named files in the parent directory are historical and must not guide implementation. If documents conflict, precedence is: `DECISIONS.md` → `PRD.md` → `SYSTEM-DESIGN.md` → `AUTOMATION-SCHEMA.md` → implementation and evaluation plans. OpenAI API is the approved model provider; Forge LLMs are not part of the build.

- [Architecture and product decisions](DECISIONS.md)
- [Product requirements and acceptance fixture](PRD.md)
- [Desired automation and development schema](AUTOMATION-SCHEMA.md)
- [System design](SYSTEM-DESIGN.md)
- [Tech stack and component decisions](TECH-STACK.md)
- [Build implementation plan](IMPLEMENTATION-PLAN.md)
- [Agent and product evaluation plan](EVALUATION-PLAN.md)
- [Development setup](DEVELOPMENT.md)
- [Information architecture, user flows, states and UX writing](UX-SPEC.md)

## Current build

The repository now contains a strict TypeScript proof engine, two synthetic scenarios, a React case workspace, a Forge Jira/JSM issue panel resolver, Forge SQL persistence, and automated tests. Run the complete local check with `./scripts/use-local-tools.sh npm run check`.

The current prototype is not release-ready: Phase 1 of the implementation plan must first bind approval to the displayed revision/hash and enforce command authorization for every mutation.
- [Solo delivery roadmap](ROADMAP.md)

Develop in the local Codex workspace. Use GitHub for pull, commit and push.
