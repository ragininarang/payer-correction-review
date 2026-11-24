# Development setup

This repository includes a workspace-local Node.js 24 and Forge CLI installation under the ignored `.local-tools` directory. Run project commands through the helper so the local tools are available without changing the whole Mac:

```sh
./scripts/use-local-tools.sh npm run check
./scripts/use-local-tools.sh npm run dev
./scripts/use-local-tools.sh forge lint
./scripts/use-local-tools.sh gh auth status
```

The local prototype runs without Atlassian or OpenAI credentials. The registered Forge app ID is stored in `manifest.yml`. Development version 3.3.0 is deployed on the free demo site `one-atlas-fnmi.atlassian.net`, which expires February 21, 2027. Version 2.5.0 was used for the controlled source-event recovery test. Versions 3.0.0–3.1.0 added and live-tested the deterministic Jira projection worker with the installation-approved `write:jira-work` scope; version 3.3.0 restores the normal hourly schedule and makes projection bookkeeping recoverable across interrupted invocations. Keep all credentials outside Git.

## One-time Forge connection

1. Authenticate the CLI with the Atlassian account email and scoped Forge token using `forge login`, or export `FORGE_EMAIL` and `FORGE_API_TOKEN` in the current shell.
2. Run `forge register` from this directory. This writes the registered app ID into `manifest.yml`.
3. Run `npm run build`, `forge lint`, then `forge deploy -e development`.
4. Install into the Jira product on the development site with `forge install -e development -p Jira --site <site>.atlassian.net`.
5. Set the supervisor account ID with `forge variables set --encrypt PCR_SUPERVISOR_ACCOUNT_ID <account-id> -e development`.
6. Open a Jira or JSM issue, add **Payer correction proof** from Apps and initialize the synthetic case.

The current development slice does not call OpenAI. The key may be held in macOS Keychain for future development, but do not add `OPENAI_API_KEY` to Forge until the bounded Challenger agent and its call limits are implemented. Forge SQL is provisioned per installation; the app applies an idempotent schema migration before initializing a case and also checks the schema hourly.

## Cost controls

- Hard maximum for new project cash spend: **$100**. Prefer free allowances and existing credits.
- The current app has no OpenAI call path, remote hosting or paid database.
- Forge reports this development deployment as eligible for **Runs on Atlassian**.
- Do not enable a paid API without a project spend limit, per-run call/token limits and a recorded cost test.
- Stop development usage before any provider reaches its configured limit; billing dashboards may lag.

## Current verification

- `npm test`: 24 deterministic proof, authorization, evidence-ledger, recovery-contract and Jira-projection policy tests.
- `npm run typecheck`: strict TypeScript contracts.
- `npm run build`: production Custom UI bundle.
- `forge lint`: Forge manifest and packaging validation; requires Forge authentication for some checks.
- Live Jira smoke test: initialized a Forge SQL case, added final correction evidence, approved revision 2, imported a late reversal and verified that revision 3 invalidated the prior approval.
- Recovery update: a controlled version 2.5.0 test registered a pending correction in one invocation and recovered it in a second invocation. The case advanced once from evidence version 1 to 2 and produced one audit event. See [the verification record](docs/verification/phase2-pending-evidence-recovery.md).
- Scheduled Jira-projection recovery: a live five-minute test schedule projected approved evidence version 2, remained idempotent on the following cycle, then projected the invalidated version 3 after a late reversal. The normal hourly schedule was restored afterward. See [the verification record](docs/verification/phase2-jira-projection-recovery.md).
- Jira projection worker: writes the current approved or invalidated revision/hash to the app-owned `payer-correction-proof` issue property, reads it back, and marks the effect synced only on an exact match. Stale effects conflict; transient failures retry at most three times.

Generated UI output in `static/build` and Forge working data in `.forge` are intentionally ignored. GitHub Actions rebuilds the UI from the lockfile on every push and pull request.
