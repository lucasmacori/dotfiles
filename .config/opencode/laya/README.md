# Local Laya model router

OpenCode's `laya-model-router` plugin calls a local Laya HTTP server at `http://127.0.0.1:8765`. Laya selects models only: it never selects agents, grants permissions, or changes an agent's permissions.

`auto` is the default Build-capable primary agent. It re-evaluates the model profile on every substantive user prompt, so consecutive turns may use different models as complexity or risk changes. `/plan <task>` switches to native `plan`; its static permissions enforce read-only behavior, and it routes only when no decision has already been persisted. `/build <task>` explicitly returns to `auto` and that prompt is immediately re-evaluated. Wording never causes an implicit mode switch. Manual `build` and specialist agents are outside Laya routing unless explicitly configured otherwise. Child sessions bypass Laya and use their fixed subagent model.

## Routing profiles and policy

The five profiles form a capability ladder:

- `micro`: trivial interaction, mechanical transformations, and bounded simple file/web tool use (`ollama/ministral-3:8b`).
- `basic`: low-risk file operations, repository discovery, straightforward web search, and simple informational work (`openai/gpt-5.6-luna#low`).
- `standard`: routine code implementation, tests, debugging, and refactoring (`openai/gpt-6-luna#medium`).
- `advanced`: planning and difficult multi-component reasoning (`openai/gpt-6-sol#low`). Planning has this minimum profile.
- `deep`: consequential, ambiguous, architectural, or sustained high-reasoning work (`openai/gpt-6-sol#high`).

Profile models and classifier criteria are configured in [`profiles.json`](./profiles.json). The plugin option `profilesFile` points to that JSON file. It must define exactly `micro`, `basic`, `standard`, `advanced`, and `deep`; each entry requires a non-empty `criteria` plus `model.providerID` and `model.id`, with an optional non-empty `model.variant`. Absolute paths, paths relative to the OpenCode process working directory, and `~/...` paths are supported.

The profile file is loaded and validated once when the OpenCode service starts. After editing it, restart the service with `opencode service restart`. Missing or invalid files fail with an explicit configuration error rather than silently changing routing behavior. Inline `profiles` remain supported for compatibility, but `profiles` and `profilesFile` cannot be configured together.

Policy applies `standard`, `advanced`, and `deep` capability/risk floors before classifier choices. Native planning is at least `advanced`; explicit deep-risk signals can raise it to `deep`. A narrow probability tie between `micro` and `basic` resolves to `micro` only when they are the two leading classes, combined probability is at least `0.55`, and their gap is at most `0.10`. Uncertain low-risk classifications otherwise fall back conservatively to `basic`. Classifier and readiness failures use the operational `standard` fallback.

There are no phrase-specific greeting rules. Laya classifies interactions from the same capability, complexity, consequence, and uncertainty criteria used for every prompt. Tool availability is independent of model profile: `micro` and `basic` retain the tools permitted to the active agent. Reading/writing files, repository discovery, and straightforward online searches do not by themselves impose a `standard` floor; code implementation and consequential operations still do.

Attachments alone do not impose a `standard` floor; their task is classified by complexity and risk. A bare `/plan` asks for a task without consuming or replacing the current routing decision.

Each successful `auto` policy or fallback decision replaces the previous stored decision before the model call. Native `plan` follow-ups reuse decisions at `advanced` or `deep`; an older lower-profile decision is re-evaluated and raised to the planning floor. A manual `/models` override while `auto` is active lasts only until the next substantive prompt; switch to a non-routed agent if the override must persist.

## Agent workflow

Plan may delegate only to the read-only `scout`, `researcher`, and `architect` subagents. Auto/Build may use the existing Build set: `scout`, `command-runner`, `micro-worker`, `implementer`, `researcher`, `debugger`, and `reviewer`. The primary agent retains clarification, task decomposition, unresolved decisions, integration, and final verification; subagents cannot delegate further.

## Session telemetry

Run `/session-telemetry` for the compact native view or `/session-telemetry --json` for JSON. Telemetry records the latest selected and effective profile, policy floor/reason/version, separate confidence/probability/margin values, fallback state, and accumulated agent/model usage for the deduplicated session family. It never records prompt, message, or file content.

The TUI uses the read-only `laya-telemetry.get` RPC and does not invoke a model. Cost is OpenCode's recorded estimate, and coverage counts distinguish missing usage metadata from known zero usage.

The environment is installed in `.venv` with Python 3.12. The first server start downloads and preloads the English Laya checkpoint; non-English prompts load the multilingual checkpoint lazily.

Run `npm run check` from the OpenCode configuration directory for prompt-scope checks, TypeScript validation, and unit tests. Run `npm run eval:routing` separately to evaluate the live classifier against the versioned bilingual safety corpus and report its confusion matrix, per-profile precision/recall, fallback rate, and dangerous under-routing.

Manual start for diagnostics:

```sh
LAYA_HOST=127.0.0.1 \
LAYA_PORT=8765 \
LAYA_DEVICE=cpu \
LAYA_PRELOAD=1 \
LAYA_MODELS=english \
./laya/.venv/bin/laya-serve
```
