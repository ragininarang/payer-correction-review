# Development setup

This repository includes a workspace-local Node.js 24 and Forge CLI installation under the ignored `.local-tools` directory. Run project commands through the helper so the local tools are available without changing the whole Mac:

```sh
./scripts/use-local-tools.sh npm run check
./scripts/use-local-tools.sh npm run dev
./scripts/use-local-tools.sh forge lint
```

The local prototype runs without Atlassian or OpenAI credentials. The deployed Forge issue panel requires an Atlassian developer login, an app registration and a Jira/JSM development site. Keep all credentials outside Git.

## One-time Forge connection

1. Authenticate the CLI with the Atlassian account email and scoped Forge token using `forge login`, or export `FORGE_EMAIL` and `FORGE_API_TOKEN` in the current shell.
2. Run `forge register` from this directory. This writes the registered app ID into `manifest.yml`.
3. Run `npm run build`, `forge lint`, then `forge deploy -e development`.
4. Install into the Jira product on the development site with `forge install -e development -p Jira --site <site>.atlassian.net`.
5. Set the supervisor account ID with `forge variables set --encrypt PCR_SUPERVISOR_ACCOUNT_ID <account-id> -e development`.
6. Open a Jira or JSM issue, add **Payer correction proof** from Apps and initialize the synthetic case.

The current development slice does not call OpenAI. Add `OPENAI_API_KEY` only when the bounded Challenger agent is implemented. Forge SQL is provisioned per installation; the app applies an idempotent schema migration before initializing a case and also checks the schema hourly.

## Current verification

- `npm test`: deterministic proof engine and synthetic scenario tests.
- `npm run typecheck`: strict TypeScript contracts.
- `npm run build`: production Custom UI bundle.
- `forge lint`: Forge manifest and packaging validation; requires Forge authentication for some checks.

Generated UI output in `static/build` and Forge working data in `.forge` are intentionally ignored. GitHub Actions rebuilds the UI from the lockfile on every push and pull request.
