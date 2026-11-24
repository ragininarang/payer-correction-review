# Phase 3 verification — platform feasibility spike

**Date:** November 24, 2026  
**Status:** PASS — Gate 3 closed
**Environment:** Forge development, version 4.2.0
**Site:** `one-atlas-fnmi.atlassian.net`  
**Synthetic Jira issue:** `MOBL-57`

## Implemented and verified

- A Forge Async Events consumer with a 120-second function ceiling and per-case concurrency of one.
- SQL-persisted stage status, attempt, terminal reason, structured result and telemetry.
- A bounded LangGraph loop with one allowlisted synthetic-source read and an explicit recursion/tool budget.
- One OpenAI Responses API call using a strict Zod structured-output schema, `store: false`, 300 maximum output tokens, a 20-second timeout, zero SDK retries and a stable idempotency key.
- A separate resume event that validates the persisted result and current evidence revision before marking the run complete.
- Safe stale-revision termination, three-attempt delivery budget and classified configuration/rate-limit/timeout/provider/output failures.
- Token, duration, tool-call, graph-step and integer-microdollar telemetry; no prompt, secret or private reasoning is logged.
- A development-only supervisor/operator control in the Review history technical section. It cannot alter proof, approval or Jira-projection state.
- Local strict TypeScript, production build and 29 tests, including an actual in-process LangGraph execution with a fake model adapter.
- Forge deployment and installation upgrade. Forge CLI reports the build as not Runs on Atlassian eligible because of OpenAI egress.

## Live UI result

Before the encrypted key was configured, the installed app displayed **Automated run: Not started**, disabled **Run bounded platform test**, and explained that an encrypted OpenAI key was required. This proved the missing-secret path failed closed and could not spend model credits.

After `OPENAI_API_KEY` was copied directly from macOS Keychain into an encrypted Forge development variable and the app was redeployed, one explicit supervisor test completed with:

- Model: `gpt-6-luna`
- Structured result: professional claims, October 1–31, 2026, independent submitted-claims inventory required
- Allowlisted source reads: 1
- Input tokens: 245
- Output tokens: 297
- Model-call duration: 5.98 seconds
- Estimated model cost: $0.000173
- OpenAI response storage: disabled (`store: false`)

The UI first displayed **Model complete** while the durable stage awaited continuation. A later Async Events invocation read the SQL-persisted result, changed the state to **Completed**, and appended **Platform spike completed** to the immutable review history. The model output did not change proof, approval, financial result or Jira projection state.

## Failure evidence

- Missing encrypted key: observed in the deployed UI; execution was disabled before queueing.
- Timeout: classified as transient; retries at most twice and fails on the third attempt.
- HTTP 429: classified as transient; retries at most twice and fails on the third attempt.
- Provider 5xx/model outage: classified as transient; retries at most twice and fails on the third attempt.
- Configuration and invalid structured output: fail immediately rather than retrying blindly.
- Tests use real OpenAI SDK error types and do not persist error bodies, prompts, secrets or private reasoning.
- Existing stale-revision and persisted-result checks prevent a late worker from publishing against a newer case revision.

The timeout, 429 and provider-outage paths were verified through deterministic fault tests rather than intentionally disrupting a live provider. The successful deployed call, second-invocation resume, missing-key UI result and 29-test suite together close Gate 3.

**Observed API cost for Gate 3:** approximately $0.000173. This is far below the project’s $100 hard cap.
