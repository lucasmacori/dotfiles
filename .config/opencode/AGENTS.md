# AI Agent Configuration

This Ruler configuration is the source of truth for the Kiabi agent setup.

Run from `/Users/lucasmacori/.config`:

```bash
ruler apply --subagents
```

Ruler reads authored operational files from `.ruler/`. The `ruler/` directory is a visibility mirror. Generated global OpenCode instructions are written to `opencode/AGENTS.md`.

## Context7 Documentation

Use Context7 MCP for current documentation about a library, framework, SDK, API, CLI tool, or cloud service, including syntax, configuration, migration, debugging, and setup. Do not use it for refactoring, original scripts, business-logic debugging, code review, or general programming concepts.

Workflow:

1. Call `resolve-library-id` with the library name and question unless an exact `/org/project` ID was supplied.
2. Select the best match by name, relevance, snippets, source reputation, and benchmark score.
3. Query that library ID with the full question.
4. Answer from the fetched documentation.

## Agent Architecture

This setup uses specialized agents coordinated by a primary agent.

| Agent | Purpose |
| --- | --- |
| `k-orchestrator` | Intent classification and routing only |
| `k-frontend-developer` | Next.js, React, TypeScript, accessibility, TDD |
| `k-backend-developer` | Spring Boot, Java, REST, GraphQL |
| `k-devops-engineer` | Docker, Kubernetes, CI/CD, Terraform, observability |
| `k-security-engineer` | Security audits, OWASP, dependency and auth review |
| `k-business-analyst` | Read-only code analysis and Jira-ready summaries |

Ruler distributes these definitions as native subagents where supported. Specialist definitions remain scoped to their agent files and are not inlined into ambient rules.

## OpenCode Compatibility

- OpenCode runtime configuration is `opencode/opencode.jsonc`; global OpenCode instructions are generated to `opencode/AGENTS.md`.
- The custom `auto` primary agent is the default Build-capable mode.
- `/plan` selects native `plan`, whose permissions form a real read-only boundary. `/build` returns to `auto`.
- Laya routes models only. It never selects agents, grants permissions, or weakens the active agent's policy.
- The four model profiles are `micro`, `basic`, `standard`, and `deep`; `standard` is the fallback.
- OpenCode-specific subagents live in `opencode/agents/`, and child sessions retain their declared model.
- Ruler manages MCP configuration in `.ruler/ruler.toml` and its mirror and merges it into `opencode/opencode.jsonc` when applied.

## OpenCode Delegation Workflow

Treat `auto` as Build. When the selected primary agent is Plan, Build, or `auto`, delegate only one focused assignment at a time. Keep clarification, product and architecture decisions, task decomposition, integration, and final verification in the primary agent.

- `scout`: focused read-only repository discovery.
- `command-runner`: one exact command in one exact working directory.
- `micro-worker`: a tiny predetermined edit with exact files, locations, and replacement content.
- `implementer`: one approved, bounded implementation task with acceptance criteria and validation expectations.
- `researcher`: one focused documentation or approved external-evidence question.
- `debugger`: difficult, non-obvious root-cause analysis after ordinary diagnosis is insufficient.
- `architect`: exceptional cross-system, security, distributed-systems, migration, or high-impact design decisions.
- `reviewer`: independent review of completed nontrivial changes.

Plan may use only the read-only `scout`, `researcher`, and `architect` subagents. Plan must never run commands through a worker or ask any worker to edit files.

Build and `auto` may use `scout`, `command-runner`, `micro-worker`, `implementer`, `researcher`, `debugger`, and `reviewer`. Use Reviewer for behavior, API, security, or meaningful multi-file changes, not tiny mechanical edits. If implementation reveals a fundamental architecture problem, stop and return the decision to Plan rather than delegating a redesign.

Scout, Micro-worker, and Command-runner are low-capability literal executors. Give them the objective, complete context, working directory, exact scope and ordered steps, exact paths or symbols, exact command or content where applicable, constraints, expected output, and stopping conditions. They must block rather than infer or improvise.

Implementer, Researcher, Debugger, Architect, and Reviewer may reason only within their assigned role. Give them focused scope, context, constraints, expected evidence or output, and stopping conditions. They must return uncertainty and blockers rather than broaden scope, override the primary agent, or orchestrate other workers.

No subagent may delegate further work.

## Permission Model

Agent permissions are defined by the target runtime and each scoped agent definition. Model-profile routing never grants permissions. Agents that cannot enforce native permission controls must treat documented restrictions as behavioral requirements.

## Git Safety

Do not commit or push unless the user explicitly asks.
