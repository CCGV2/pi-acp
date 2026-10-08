# pi-acp

ACP ([Agent Client Protocol](https://agentclientprotocol.com/get-started/introduction)) adapter for [`pi`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) coding agent.

`pi-acp` embeds pi directly via the `@earendil-works/pi-coding-agent` SDK and exposes it as an ACP agent over stdio. Each ACP session owns one in-process `AgentSession`.

> **Fork notice:** This repository is based on
> [`victor-software-house/pi-acp`](https://github.com/victor-software-house/pi-acp).
> This fork adds per-session MCP runtime support, including stdio and Streamable HTTP
> servers, MCP tool discovery, and exposing those tools to pi as `customTools`.

## Specs and decisions

- [`docs/prd/PRD-001-acp-v013-zed-alignment.md`](docs/prd/PRD-001-acp-v013-zed-alignment.md) — active release PRD (v0.5).
- [`docs/architecture/plan-acp-v013-zed-alignment.md`](docs/architecture/plan-acp-v013-zed-alignment.md) — phased implementation plan.
- [`docs/adr/`](docs/adr/) — architecture decision records (ADR-0001..ADR-0004).
- [`docs/architecture/acp-conformance.md`](docs/architecture/acp-conformance.md) — ACP conformance reference.
- [`docs/architecture/claude-acp-comparison.md`](docs/architecture/claude-acp-comparison.md) — reference comparison against `claude-agent-acp`.

## Status

Active development. ACP compliance is improving steadily. Development is centered around [Zed](https://zed.dev) editor support; other ACP clients may have varying levels of compatibility.

## Features

- Streams assistant output as ACP `agent_message_chunk`
- Streams thinking output as ACP `agent_thought_chunk`
- Maps pi tool execution to ACP `tool_call` / `tool_call_update`
  - Descriptive tool titles (`Read src/index.ts`, `Run ls -la`, `Edit config.ts`)
  - Tool call locations surfaced for follow-along features in clients like Zed
  - For `edit` and `write`, emits ACP structured diffs (`oldText`/`newText`)
  - Tool kinds: `read`, `edit`, `execute` (bash), `other`
- Session configuration via ACP `configOptions`
  - Model selector (category: `model`)
  - Thinking level selector (category: `thought_level`)
  - Also advertises `modes` and `models` for backward compatibility
  - `session/set_config_option` for changing model or thinking level
  - `config_option_update` emitted when configuration changes
- Session persistence and lifecycle
  - Multiple concurrent sessions supported
  - pi manages sessions in `~/.pi/agent/sessions/...`
  - `session/list` with title fallback from first user message
  - `session/load` replays structured history (text, thinking, tool calls)
  - `closeSession`, `resumeSession` (stable in ACP v0.12.2+)
  - `unstable_forkSession` (preview)
  - Sessions can be resumed in both `pi` CLI and ACP clients
- Per-session MCP servers
  - stdio servers with command, arguments, session cwd, and explicit environment overrides
  - Streamable HTTP servers over HTTPS or loopback HTTP
  - MCP tools are exposed to pi as namespaced `customTools`
  - Atomic startup rollback, bounded stderr diagnostics, cancellation, and awaited cleanup
- Usage and cost tracking
  - `usage_update` emitted after each agent turn with context size and cost
  - `PromptResponse.usage` includes per-turn token counts
- Slash commands
  - File-based prompt templates from `~/.pi/agent/prompts/` and `<cwd>/.pi/prompts/`
  - Extension commands from pi extensions
  - Skill commands (appear as `/skill:skill-name`)
  - Built-in adapter commands (see below)
- Authentication via Terminal Auth (ACP Registry support)
- Startup info block with pi version and context (configurable via `quietStartup` setting)

## Prerequisites

- Node.js 24+ (hard requirement, matches pi runtime)
- Configure `pi` for your model providers/API keys

## Install

### ACP Registry (Zed)

Launch the registry with `zed: acp registry` and select `pi ACP`:

```json
"agent_servers": {
  "pi-acp": {
    "type": "registry"
  }
}
```

### npx (no global install)

```json
"agent_servers": {
  "pi": {
    "type": "custom",
    "command": "npx",
    "args": ["-y", "@ccgv2/pi-acp"],
    "env": {}
  }
}
```

### Global install

```bash
npm install -g @ccgv2/pi-acp
```

```json
"agent_servers": {
  "pi": {
    "type": "custom",
    "command": "pi-acp",
    "args": [],
    "env": {}
  }
}
```

### From source

```bash
npm install
npm run build
```

```json
"agent_servers": {
  "pi": {
    "type": "custom",
    "command": "node",
    "args": ["/path/to/pi-acp/dist/index.mjs"],
    "env": {}
  }
}
```

### External Pi SDK (independent harness and adapter upgrades)

By default, pi-acp loads its installed `@earendil-works/pi-coding-agent` dependency.
Set `PI_ACP_SDK_ROOT` to the **absolute package directory** of another installed
`@earendil-works/pi-coding-agent` to select that SDK instead. The directory must
contain its `package.json`, built SDK entry, and have its runtime dependencies
installed. Do not point it at a prefix, `node_modules`, or the `pi` executable.
Symlinked package directories are supported and resolved to their real paths.

For example, paxd can maintain separate installation prefixes:

```bash
npm install --prefix /opt/pax/pi-harness @earendil-works/pi-coding-agent@0.75.3
npm install --prefix /opt/pax/pi-adapter @ccgv2/pi-acp

PI_ACP_SDK_ROOT=/opt/pax/pi-harness/node_modules/@earendil-works/pi-coding-agent \
  node /opt/pax/pi-adapter/node_modules/@ccgv2/pi-acp/dist/index.mjs
```

When spawning the adapter, paxd should pass that variable in the child process
environment and use stdin/stdout for ACP. Upgrade either installation separately,
then restart the adapter process to select the updated SDK. This is still an
in-process `AgentSession`; session operations do not invoke the pi CLI.
The SDK's dependency graph (including `pi-agent-core` and `pi-ai`) resolves from
the selected installation, with no runtime Pi imports from the adapter's SDK.

An explicitly empty value, relative path, invalid package, failed import, or
missing required SDK API produces an error on stderr and exits with status 1
before accepting ACP requests. There is **no fallback** to the adapter dependency.
Startup validates the callable API used by this adapter; an external SDK must
also preserve its signatures and session/event semantics. API shape validation
cannot guarantee compatibility with arbitrary future behavioral changes.

`initialize` keeps the adapter version in `agentInfo.version` and reports the
selected SDK's actual installed `package.json` version separately:

```json
{
  "agentInfo": { "name": "@ccgv2/pi-acp", "title": "pi ACP adapter", "version": "0.6.0" },
  "_meta": { "pax": { "runtime": { "name": "pi", "version": "0.75.3" } } }
}
```

This excerpt omits the other initialize fields. The runtime version is not
inferred from the adapter's dependency range. Startup diagnostics include the
source, resolved entry path, and SDK version on stderr; stdout carries only ACP.
`/changelog` also reads from the selected SDK installation.
`PI_ACP_PI_COMMAND` remains a separate setting used only for the interactive
`--terminal-login` authentication command; it does not select the SDK.

## Built-in commands

- `/compact [instructions...]` -- compact session context
- `/autocompact on|off|toggle` -- toggle automatic compaction
- `/export` -- export session to HTML
- `/session` -- show session stats (tokens, messages, cost)
- `/name <name>` -- set session display name
- `/steering all|one-at-a-time` -- set steering message delivery mode
- `/follow-up all|one-at-a-time` -- set follow-up message delivery mode
- `/changelog` -- show pi changelog

## Authentication

Terminal Auth for the [ACP Registry](https://agentclientprotocol.com/get-started/registry):

```bash
pi-acp --terminal-login
```

Zed shows an Authenticate banner that launches this automatically.

## Development

```bash
npm install
npm run dev          # run from src
npm run build        # tsdown -> dist/index.mjs
npm run typecheck    # tsc --noEmit
npm run lint         # biome + oxlint
npm test             # Vitest
```

Project layout:

```
src/
  index.ts                  # stdio entry point
  env.d.ts                  # ProcessEnv augmentation
  acp/
    agent.ts                # PiAcpAgent (ACP Agent interface)
    session.ts              # PiAcpSession (wraps AgentSession, translates events)
    auth.ts                 # AuthMethod builder
    auth-required.ts        # auth error detection
    pi-settings.ts          # settings reader (Zod schema)
    translate/
      pi-messages.ts        # pi message text extraction
      pi-tools.ts           # pi tool result text extraction (Zod schema)
      prompt.ts             # ACP ContentBlock -> pi message
  pi-auth/
    status.ts               # auth detection (Zod schema)
test/
  helpers/fakes.ts          # test doubles
  unit/                     # unit tests
  component/                # integration tests
```

## Limitations

### MCP behavior

- stdio and Streamable HTTP transports are supported. Legacy SSE and unstable ACP-routed MCP transports are rejected.
- Remote plaintext HTTP is rejected; `http://` is accepted only for `localhost`, `127.0.0.1`, and `::1`.
- stdio processes inherit only the MCP SDK safe environment allowlist plus explicit ACP `env` entries.
- Each ACP session owns its MCP connections. Startup is atomic and `session/close` waits for cleanup.
- `session/load` and `session/fork` rebuild MCP from the request. `session/resume` reuses a live runtime when MCP is omitted and rejects an explicitly different configuration.

### SHOULD-level gaps

- **`session/request_permission`** -- pi does not request permission from ACP clients before tool execution.

### Not implemented (MAY / client capabilities)

- **`agent_plan`** -- plan updates not emitted before tool execution. pi has no equivalent planning surface.
- **ACP filesystem delegation** (`fs/read_text_file`, `fs/write_text_file`) -- pi reads/writes locally. Not advertised.
- **ACP terminal delegation** (`terminal/*`) -- pi executes commands locally. Not advertised.

### Design decisions

- pi does not have real session modes (ask/architect/code). The `modes` field exposes thinking levels for backward compatibility with clients that do not support `configOptions`.
- `configOptions` is the preferred configuration mechanism. Zed uses it exclusively when present.
- pi-acp uses direct filesystem access rather than delegating reads/writes to the ACP client. This means pi reads on-disk file versions, not unsaved editor buffers.

See [docs/architecture/acp-conformance.md](docs/architecture/acp-conformance.md) for detailed conformance status.

## Release

Releases are automated via [semantic-release](https://semantic-release.gitbook.io/) on pushes to `main`. The pipeline runs typecheck, lint, tests, and `npm pack --dry-run` before publishing. npm trusted publishing (OIDC) is used -- no long-lived npm tokens.

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/). Commitlint enforces this locally via lefthook and in CI.

## License

MIT (see [LICENSE](LICENSE)).

---

Inspired by [svkozak/pi-acp](https://github.com/svkozak/pi-acp).
