# pi-acp per-session MCP runtime design

Status: Proposed  
Target baseline: `pi-acp` v0.5.x (Node 24, before the Bun daemon split)  
Scope: Real ACP `mcpServers` support for `session/new`, `session/load`, `session/resume`, and `unstable_forkSession`

Delivery tasks and executable BDD scenarios:
[`plan-mcp-runtime-bdd.md`](plan-mcp-runtime-bdd.md).

## 1. Executive decision

Implement MCP inside `pi-acp`, not as a user-installed pi extension and not in pi core.

Each ACP session owns:

1. one pi `AgentSession`;
2. one `McpSessionManager`;
3. zero or more MCP client connections;
4. a deterministic set of pi `ToolDefinition`s generated from MCP `tools/list`.

`pi-acp` connects every MCP server before creating the pi session, converts discovered MCP tools into pi custom tools, then calls:

```ts
createAgentSession({
  cwd,
  sessionManager,
  tools: [...builtinToolNames, ...generatedMcpToolNames],
  customTools: [...existingOverrides, ...generatedMcpTools],
});
```

This is necessary because pi deliberately does not expose a native `mcpServers` option, but it does expose `customTools`. The adapter therefore acts as the MCP host.

Do not write extensions or MCP configuration into `~/.pi/agent`, `.pi/`, or the user's project. ACP-provided server definitions are per-session runtime input.

## 2. Goals

- Fulfil ACP's requirement to connect to every MCP server supplied in session creation/open requests.
- Support independent MCP configurations across concurrent ACP sessions.
- Support cold `session/resume` by reconnecting transports and reopening the persisted pi session.
- Keep MCP stdout isolated from ACP stdout.
- Preserve the user's executable lookup environment without passing every ambient secret by default.
- Make partial startup atomic: either the complete requested MCP toolset is available or session creation fails.
- Guarantee child process cleanup on failed startup, close, resume reconfiguration, connection disposal, and process shutdown.
- Preserve exact original MCP server and tool names internally while exposing pi-safe, deterministic tool names.
- Avoid persisting MCP secrets or live transport state.

## 3. Non-goals for the first release

- MCP prompts and resources as model-facing primitives.
- MCP Apps/UI resources.
- OAuth browser flows.
- MCP sampling initiated by servers.
- MCP elicitation.
- Hot replacement of pi tool definitions after `notifications/tools/list_changed`.
- Sharing one MCP process across ACP sessions.
- Persisting ACP-provided MCP server configuration to disk.
- Supporting MCP-over-ACP transport.

The first release supports tools over stdio and Streamable HTTP. Legacy SSE may be added behind its own capability only if the selected MCP SDK still provides a maintained client transport.

## 4. Findings from the reference adapters

### 4.1 Claude Agent ACP

The Claude adapter:

- converts ACP stdio `command`, `args`, and env entries into Claude SDK MCP config;
- converts HTTP/SSE URLs and headers into Claude SDK MCP config;
- merges ACP-provided MCP servers over user-provided SDK options;
- advertises HTTP and SSE only because the downstream Claude SDK implements them;
- treats `cwd + normalized mcpServers` as session-defining state;
- computes a stable fingerprint with MCP servers sorted by name;
- tears down and recreates the underlying query when resume/load changes cwd or MCP configuration;
- uses the requested ACP session ID as the downstream resume ID;
- makes `loadSession` replay history while `resumeSession` does not.

Relevant source:

- `agentclientprotocol/claude-agent-acp/src/acp-agent.ts`
  - capability advertisement near `initialize`;
  - `computeSessionFingerprint`;
  - `getOrCreateSession`;
  - `createSession` MCP conversion and `options.mcpServers`.

The fingerprint/recreate behavior should be adopted. The actual process management cannot be reused because Claude Agent SDK owns it.

### 4.2 Codex ACP

The Codex adapter:

- builds a fresh session/thread config for new, load, and resume;
- maps ACP stdio definitions to Codex `mcp_servers`;
- maps ACP HTTP definitions to URL/header config;
- rejects transports Codex does not support instead of silently dropping them;
- sanitizes MCP server names;
- detects conflicts with already-configured servers to avoid invalid deep merges;
- observes MCP startup status and reports partial/failed startup;
- does not claim to recover an omitted session MCP set during load/resume;
- passes explicit MCP definitions into `thread/start` and `thread/resume`.

Relevant source:

- `agentclientprotocol/codex-acp/src/CodexAcpClient.ts`
  - `newSession`, `loadSession`, `resumeSession`;
  - `createSessionConfig`;
  - `createMcpSeverConfig`.
- `agentclientprotocol/codex-acp/src/CodexAcpServer.ts`
  - MCP startup tracking;
  - `resolveSessionMcpServers`.

The strict transport errors, explicit resume configuration, name handling, and startup reporting should be adopted. Codex's downstream app-server owns the actual MCP clients, so its runtime cannot be reused.

## 5. Proposed module layout

```text
src/
  mcp/
    types.ts             # Internal normalized definitions and states
    normalize.ts         # ACP schema -> normalized server definitions
    manager.ts           # Per-session orchestration and atomic startup
    connection.ts        # One MCP client + transport
    transports.ts        # stdio / Streamable HTTP constructors
    tool-adapter.ts      # MCP Tool -> pi ToolDefinition
    tool-result.ts       # MCP CallToolResult -> pi tool result
    naming.ts            # Stable pi-safe names and collision handling
    fingerprint.ts       # Stable session-defining MCP fingerprint
    errors.ts            # Typed startup/tool/transport errors
```

Changes outside `src/mcp/`:

```text
src/acp/agent.ts
  - build MCP runtime before createAgentSession
  - pass MCP custom tools
  - use one shared session-open helper for new/load/resume/fork

src/acp/session.ts
  - own McpSessionManager
  - make disposal asynchronous or expose async close()

package.json
  - add the official MCP client package
```

Use the stable official TypeScript SDK:

```text
@modelcontextprotocol/sdk@1.29.0
```

Import its client and transports through the documented subpaths
(`client/index.js`, `client/stdio.js`, and `client/streamableHttp.js`).
The split `@modelcontextprotocol/client` package is still a 2.0 beta at the
time of implementation, so it is not used for the first release. Pin the
stable SDK exactly; do not depend on `latest` or a broad major range.

## 6. Internal data model

```ts
type NormalizedMcpServer =
  | {
      kind: "stdio";
      originalName: string;
      stableName: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string;
    }
  | {
      kind: "http";
      originalName: string;
      stableName: string;
      url: URL;
      headers: Record<string, string>;
    };

type McpConnectionState =
  | "created"
  | "starting"
  | "ready"
  | "failed"
  | "closing"
  | "closed";

interface McpConnection {
  definition: NormalizedMcpServer;
  client: Client;
  transport: Transport;
  state: McpConnectionState;
  tools: DiscoveredMcpTool[];
  close(): Promise<void>;
}

interface McpRuntimeSnapshot {
  fingerprint: string;
  serverNames: string[];
  toolNames: string[];
}
```

`McpSessionManager` is never global. It is owned by exactly one `PiAcpSession`.

## 7. ACP server normalization

Validate before spawning anything:

- session cwd is absolute and exists;
- server names are non-empty and unique before and after stable-name normalization;
- stdio command is non-empty;
- args are strings and passed without rewriting;
- env names and values are strings;
- HTTP URL parses successfully and uses `https:` by default;
- header names/values contain no CR/LF;
- unsupported variants fail with `invalidParams` or `invalidRequest`;
- duplicate tools after generated-name normalization fail startup rather than shadowing.

Do not silently ignore unknown future ACP `McpServer` variants. Exhaustive handling is required.

Normalize servers in input order for diagnostics, but sort by stable server name when computing the fingerprint.

## 8. stdio process model

### 8.1 Process ownership

One ACP session gets one child process per stdio MCP server.

Do not share a child across sessions, even when definitions are identical. Per-session ownership gives:

- deterministic close semantics;
- no cross-session authentication or state leakage;
- independent cancellation and failure;
- correct behavior when the same server is started with different env/cwd;
- simpler resume.

Future process pooling would require an explicit MCP-server-level multiplexing contract and is out of scope.

### 8.2 Executable and PATH resolution

Pass the ACP `command` directly to `StdioClientTransport`; do not invoke a shell and do not concatenate command/args.

```ts
new StdioClientTransport({
  command: definition.command,
  args: definition.args,
  env,
  cwd: definition.cwd,
  stderr: "pipe",
});
```

The official transport uses `cross-spawn` with `shell: false`. Therefore:

- absolute executable paths work directly;
- relative/bare commands resolve through the child `PATH`;
- shell syntax, redirections, pipes, globbing, `$()`, and quoting are not interpreted;
- each ACP `args` element is passed as one exact argv element.

Do not resolve a bare command to an absolute path in `pi-acp`; doing so would diverge from the environment the user supplied and break shims such as `npx`, `uvx`, `mise`, `nvm`, and platform-specific launchers.

### 8.3 Working directory

ACP's stdio MCP definition does not carry a cwd. Launch the process with the effective pi session cwd:

```text
stdio MCP cwd = effective session cwd
```

This matches the practical behavior expected by project-local MCP servers and aligns the server with pi's tool workspace.

For `mode: none`, use the generated ephemeral cwd. For load/resume/fork, use the persisted session cwd after validating it against the request.

Do not use:

- `pi-acp`'s installation directory;
- the daemon/service working directory;
- the user's home directory;
- the MCP executable's directory.

### 8.4 Environment

Use the MCP SDK's safe inherited environment plus ACP-provided overrides:

```ts
const env = {
  ...getDefaultEnvironment(),
  ...definition.env,
};
```

The official SDK's default Unix inheritance is limited to:

```text
HOME LOGNAME PATH SHELL TERM USER
```

On Windows it includes the platform variables necessary for executable lookup and normal process operation.

This is preferable to `{ ...process.env }`, which would leak unrelated provider keys and service credentials to every MCP subprocess.

Rules:

- ACP-provided env wins over inherited defaults.
- Preserve an explicitly supplied empty string.
- Never log env values.
- Diagnostics may log only sorted env key names.
- Do not persist env values in the pi JSONL session, sidecars, debug snapshots, or error metadata.
- Do not implicitly forward pi/model-provider credentials.
- `PATH` is inherited unless ACP explicitly overrides it.

If compatibility later requires additional ambient variables, add an explicit adapter allowlist setting rather than switching to full `process.env`.

### 8.5 stdin, stdout, and stderr

The MCP subprocess streams are not the ACP transport.

```text
ACP client <-> pi-acp process stdin/stdout

pi-acp MCP client -> child stdin
child stdout       -> pi-acp MCP client
child stderr       -> pi-acp stderr/logging
```

Requirements:

- Child stdin carries only MCP JSON-RPC messages serialized by the SDK.
- Child stdout carries only MCP JSON-RPC messages and is consumed only by `StdioClientTransport`.
- Child stdout must never be piped to `pi-acp` stdout; doing so corrupts ACP framing.
- Configure child stderr as `"pipe"` and forward line-oriented diagnostics to `process.stderr`.
- Prefix stderr lines with session ID and stable server name.
- Bound retained stderr used in errors, for example to the last 32 KiB.
- Do not parse stderr as protocol.

The official transport provides framing, buffering, backpressure, and message parsing. Do not implement MCP JSON-RPC framing manually.

### 8.6 Startup

For each server:

1. construct `Client` with `pi-acp` name/version;
2. construct transport;
3. attach stderr listener before connect;
4. call `client.connect(transport)`;
5. allow SDK to complete `initialize` and `notifications/initialized`;
6. call `client.listTools()` with pagination;
7. validate and convert every tool;
8. mark the connection ready.

Use a startup timeout around connect plus initial tool discovery. Proposed default:

```text
PI_ACP_MCP_STARTUP_TIMEOUT_MS=10000
```

The timeout is adapter configuration, not injected into the child.

Connect all requested servers concurrently with bounded concurrency. A simple first implementation may use `Promise.allSettled` because typical server counts are small.

Startup is atomic:

- if every server succeeds, create the pi session;
- if any server fails, close every server that started and fail the ACP session request;
- never create a pi session with a silently incomplete requested MCP set.

The error should identify failed server names and sanitized reasons, but never include env values or authorization headers.

## 9. Streamable HTTP model

HTTP MCP servers do not create local processes.

Construct:

```ts
new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: normalizedHeaders,
  },
});
```

Requirements:

- require HTTPS unless an explicit adapter setting allows loopback HTTP;
- allow `http://localhost`, `127.0.0.1`, and `[::1]` by default for local development;
- pass ACP headers exactly after CR/LF validation;
- never log authorization/cookie header values;
- use SDK-managed MCP session IDs and protocol-version headers;
- close the transport on ACP session close;
- do not persist the MCP session ID for ACP resume; create a fresh MCP connection;
- apply the same startup and tool-call timeouts as stdio;
- use SDK reconnection behavior only within a live ACP session.

Initial release authentication is header-based only. Interactive OAuth requires ACP elicitation/auth integration and is deferred.

Legacy SSE should remain unadvertised until implemented and tested. Do not map SSE to Streamable HTTP as if they were identical.

## 10. Tool discovery and pi adaptation

### 10.1 Pagination

Fetch all `tools/list` pages before creating the pi session. Enforce limits:

```text
maximum servers per session: 32
maximum tools per server: 256
maximum total MCP tools: 512
maximum serialized input schema per tool: 256 KiB
```

Limits should be constants with tests and may later become settings.

### 10.2 Stable names

Pi tool names must be deterministic and collision-free:

```text
mcp__<server-slug>__<tool-slug>
```

Store a reverse map:

```ts
generatedPiName -> {
  originalServerName,
  originalToolName,
}
```

Rules:

- normalize unsupported characters to `_`;
- retain original names for display and `tools/call`;
- cap generated length;
- append a short hash when truncation or normalization collides;
- reject a collision with a builtin/custom tool that cannot be deterministically disambiguated;
- never send the generated name to the MCP server.

### 10.3 Input schema

MCP tool input is JSON Schema. Pi's `ToolDefinition.parameters` is TypeBox-compatible.

Prefer wrapping the validated MCP schema as an unsafe/external TypeBox schema rather than lossy manual conversion:

```ts
parameters: Type.Unsafe(mcpTool.inputSchema)
```

If the pi package does not expose a compatible TypeBox helper, add the exact TypeBox dependency version used by pi and verify identity/compatibility in tests.

Do not reduce schemas to a generic `{ [key: string]: unknown }`; doing so harms model tool selection and argument generation.

Validate untrusted schemas before registration:

- root must be an object schema;
- reject cyclic/non-serializable structures;
- bound depth and serialized size;
- retain descriptions, enums, defaults, and required fields;
- allow `$defs` only when references remain self-contained.

### 10.4 `tools` allowlist interaction

Pi filters both builtin and custom tools through `createAgentSession({ tools })`.

When ACP read/bash overrides or another allowlist is active:

```ts
tools = unique([
  ...builtinToolNames,
  ...existingOverrideNames,
  ...generatedMcpToolNames,
]);
```

Fail a test if a discovered MCP tool is missing from `AgentSession.getActiveToolNames()` after creation.

### 10.5 Calling tools

Each generated pi tool closes over its owning `McpConnection` and original tool name:

```ts
execute(_toolCallId, args, signal) {
  return connection.callTool(originalToolName, args, signal);
}
```

Use a per-call timeout:

```text
PI_ACP_MCP_TOOL_TIMEOUT_MS=60000
```

Forward pi's `AbortSignal` into the MCP SDK request. On abort:

- issue MCP cancellation through the SDK when supported;
- reject the pi tool call as cancelled;
- keep the connection alive unless the transport itself failed.

Concurrent tool calls are allowed per connection unless a server proves incompatible. Do not serialize globally.

## 11. Tool result conversion

Convert MCP `CallToolResult` into pi tool content without dropping information:

- `text` -> pi text content;
- `image` -> pi image content when supported, otherwise a bounded diagnostic text;
- `audio` -> metadata/text fallback in the first release;
- embedded text resource -> text with URI and MIME metadata;
- embedded blob resource -> metadata only unless pi supports the MIME type;
- `resource_link` -> Markdown link plus structured details;
- `structuredContent` -> `details`, and text fallback only when no user-readable content exists;
- `isError: true` -> pi error result.

Do not stringify large binary/base64 payloads into model-visible text.

Preserve a bounded raw result in `details` for ACP `rawOutput`, with secrets/redaction rules and size limits.

## 12. Session lifecycle

### 12.1 Shared open helper

Refactor new/load/resume/fork through one helper:

```ts
openSession({
  operation,
  sessionId?,
  cwd,
  mcpServers,
  replayHistory,
  forkFrom?,
})
```

Order:

1. validate request and resolve effective cwd;
2. normalize MCP definitions;
3. compute fingerprint;
4. create and start `McpSessionManager`;
5. discover and adapt tools;
6. build resource loader and existing ACP FS/terminal overrides;
7. compose complete `tools` and `customTools`;
8. open/create/fork pi `SessionManager`;
9. call `createAgentSession`;
10. bind final pi session ID;
11. register `PiAcpSession`;
12. optionally replay history;
13. return response.

Rollback in exact reverse ownership order on any failure.

### 12.2 New

`session/new` must use exactly the request's MCP servers. Empty means no ACP-provided MCP runtime.

### 12.3 Load

`session/load` reconnects exactly the request's MCP servers, opens the pi JSONL, creates the pi session with the discovered custom tools, then replays history.

MCP tool calls in old history are replayed as historical ACP tool events. They do not invoke MCP.

### 12.4 Resume

`session/resume` reconnects exactly the request's MCP servers and does not replay history.

If a matching session is already live on the same connection:

- compute the normalized fingerprint;
- if equal, reuse it;
- if different, close the old pi/MCP runtime and reopen from disk with the new MCP set.

Do not compare raw request ordering. Sort normalized server definitions and env/header keys before hashing.

If `mcpServers` is omitted, treat it as empty unless the ACP SDK/type explicitly distinguishes omitted from empty and the protocol defines inheritance. Do not recover secret-bearing definitions from disk.

### 12.5 Fork

Fork creates a completely new MCP runtime using the fork request's servers. No transport or child process is shared with the source session.

### 12.6 Close

Close sequence:

1. reject new prompts/tool calls for the session;
2. abort the active pi turn;
3. wait a short grace period for active MCP calls;
4. dispose pi subscriptions/session;
5. close all MCP clients/transports;
6. run session cleanup callbacks;
7. remove registry entries.

For stdio, rely on SDK close semantics:

1. end child stdin;
2. wait;
3. SIGTERM;
4. wait;
5. SIGKILL if required.

Make close idempotent and bounded.

### 12.7 Agent connection/process shutdown

On ACP connection EOF, SIGINT, or SIGTERM:

- stop accepting new operations;
- close all owned sessions;
- await MCP manager closes with a global deadline;
- only then exit.

Do not use fire-and-forget disposal for MCP subprocesses.

## 13. Failure and status semantics

### Startup failures

Fail the ACP session request when any requested MCP server:

- cannot spawn/connect;
- times out;
- fails initialize/version negotiation;
- returns invalid tool schemas;
- exceeds configured limits;
- collides irrecoverably with another tool.

### Runtime failures

If one live connection exits after session creation:

- mark its generated tools unavailable;
- subsequent calls return a clear tool error;
- emit one ACP `agent_message_chunk` diagnostic for visibility;
- do not automatically restart in the first release;
- keep unrelated MCP servers and the pi session alive.

Automatic restart is deferred because a restarted server may expose a different tool list while pi's registered tool definitions are fixed.

### `tools/list_changed`

Subscribe and record the notification, but do not hot-mutate pi tools in v1.

Behavior:

- mark session MCP toolset stale;
- emit one diagnostic;
- continue serving the originally registered tools where still callable;
- apply changes on the next load/resume/reopen.

## 14. Capability advertisement

Advertise only implemented transports:

```ts
mcpCapabilities: {
  http: true,
  sse: false,
}
```

Stdio is the baseline ACP MCP server form and has no separate boolean in the older capability shape.

If legacy SSE is implemented and tested, change `sse` to true. Never advertise a transport that is merely accepted by the type parser.

## 15. Security requirements

- Treat every MCP server as arbitrary code with the same OS privileges as `pi-acp`.
- Never use `shell: true`.
- Never interpolate command or args into a shell string.
- Use the SDK safe inherited env, not full `process.env`.
- Do not persist env values or HTTP authorization headers.
- Redact sensitive headers and common secret-like fields in diagnostics.
- Bound stderr, schemas, tool results, and raw output retained in memory.
- Restrict non-HTTPS remote URLs except loopback.
- Validate header values against CR/LF injection.
- Do not allow MCP stdout to reach ACP stdout.
- Ensure close kills stubborn child processes.
- Do not automatically trust MCP tool annotations.
- Keep session ownership strict; a client cannot close or reconfigure another connection's session without registry authorization.

## 16. Configuration defaults

Initial adapter settings:

```text
PI_ACP_MCP_STARTUP_TIMEOUT_MS=10000
PI_ACP_MCP_TOOL_TIMEOUT_MS=60000
PI_ACP_MCP_CLOSE_TIMEOUT_MS=5000
PI_ACP_MCP_MAX_SERVERS=32
PI_ACP_MCP_MAX_TOOLS=512
PI_ACP_MCP_ALLOW_INSECURE_HTTP=loopback
```

These configure the host only and are not forwarded to child processes.

Use strict integer parsing with bounded minimum/maximum values. Invalid settings fail startup with actionable stderr diagnostics.

## 17. Test plan

### Unit

- ACP stdio/HTTP normalization.
- Duplicate server names.
- Env merge and secret non-inheritance.
- Stable fingerprint independent of ordering.
- Fingerprint changes on cwd, command, args, env, URL, or headers.
- Stable tool naming, truncation, hashing, and collisions.
- JSON Schema validation and TypeBox wrapping.
- MCP result conversion for every content type.
- Allowlist contains every generated MCP tool.
- Error redaction.

### Fake stdio server integration

Provide a fixture executable that:

- completes initialization;
- paginates `tools/list`;
- exposes echo/error/sleep/image/resource tools;
- writes diagnostics to stderr;
- supports cancellation;
- optionally crashes or hangs;
- optionally emits `tools/list_changed`;
- records cwd and selected env keys.

Test:

- stdin/stdout framing remains isolated from ACP;
- cwd equals effective session cwd;
- safe env inheritance and explicit override;
- startup timeout and atomic rollback;
- tool invocation and cancellation;
- child exits on close;
- SIGTERM/SIGKILL escalation;
- concurrent sessions create independent PIDs;
- failed session creation leaves no child.

### HTTP integration

- initialize and tools call;
- headers delivered and redacted from logs;
- MCP session ID handling;
- loopback HTTP accepted;
- non-loopback HTTP rejected by default;
- close tears down the transport;
- timeout/cancellation.

### ACP component

- initialize advertises only actual support;
- new with MCP exposes callable pi tools;
- new fails if one of multiple requested servers fails;
- load reconnects and replays without invoking historical tools;
- resume reconnects without replay;
- live resume with equal fingerprint reuses runtime;
- live resume with changed MCP config rebuilds runtime;
- fork gets independent MCP processes;
- close reaps all children;
- client disconnect reaps all children.

## 18. Implementation phases

### Phase 1: stdio tools

- normalized types;
- per-session manager;
- stdio transport;
- tools discovery/call/result conversion;
- new/load/resume/fork wiring;
- strict startup and cleanup;
- tests.

### Phase 2: Streamable HTTP

- URL/header validation;
- transport and cancellation;
- security policy;
- tests;
- advertise HTTP.

### Phase 3: operational hardening

- richer startup diagnostics;
- stale tool notifications;
- bounded runtime status reporting;
- optional `/mcp` adapter command.

### Phase 4: optional MCP surfaces

- legacy SSE if demanded;
- elicitation;
- OAuth;
- resources/prompts;
- safe dynamic tool refresh if pi gains a supported tool-definition replacement API.

## 19. Acceptance criteria

The implementation is complete when:

1. non-empty ACP `mcpServers` is never silently ignored;
2. every requested server is connected before session creation succeeds;
3. every discovered MCP tool is visible and callable by the pi agent;
4. stdio child stdout cannot corrupt ACP stdout;
5. child cwd and env behavior are covered by integration tests;
6. close, failed startup, resume reconfiguration, and process shutdown leave no MCP children;
7. load and resume reconstruct tools before recreating the pi `AgentSession`;
8. unsupported transports produce explicit errors and are not advertised;
9. no MCP env/header secret is persisted or logged;
10. the full existing pi-acp test suite still passes.

## 20. Primary references

- ACP Claude adapter:
  `https://github.com/agentclientprotocol/claude-agent-acp`
- ACP Codex adapter:
  `https://github.com/agentclientprotocol/codex-acp`
- MCP TypeScript client:
  `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md`
- MCP stdio transport source:
  `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/stdio.ts`
- MCP lifecycle:
  `https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle`
- MCP transports:
  `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`
- MCP tools:
  `https://modelcontextprotocol.io/specification/2025-06-18/server/tools`
