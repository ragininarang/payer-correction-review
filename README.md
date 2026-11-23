# Payer Correction Review

An Atlassian Forge app that builds a **revisioned proof of correction**: it checks an independently defined claim cohort against payer adjustments, actively looks for counterexamples, and invalidates a prior conclusion when new evidence breaks it. A supervisor approves financial closure. The hackathon build uses synthetic data.

## Planning documents

- [Product requirements and acceptance fixture](PRD.md)
- [Desired automation and development schema](AUTOMATION-SCHEMA.md)
- [System design](SYSTEM-DESIGN.md)
- [Tech stack and component decisions](TECH-STACK.md)
- [Development setup](DEVELOPMENT.md)

## Current build

The repository now contains a strict TypeScript proof engine, two synthetic scenarios, a React case workspace, a Forge Jira/JSM issue panel resolver, Forge SQL persistence, and automated tests. Run the complete local check with `./scripts/use-local-tools.sh npm run check`.
- [Solo delivery roadmap](ROADMAP.md)

Develop in the local Codex workspace. Use GitHub for pull, commit and push.
