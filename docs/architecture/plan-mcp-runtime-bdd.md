# pi-acp MCP runtime delivery plan and BDD specification

Status: Proposed  
Companion to: `docs/architecture/plan-mcp-runtime.md`  
Delivery baseline: `pi-acp` v0.5.x, Node 24

## 1. Delivery principles

This plan breaks the MCP feature into independently reviewable tasks. Each task must:

- leave the repository buildable and testable;
- add tests with the production change;
- avoid advertising capabilities before the implementation works end to end;
- avoid accepting non-empty `mcpServers` without either implementing them or returning an explicit error;
- preserve existing no-MCP behavior;
- avoid commits that mix refactoring, transport implementation, and protocol behavior unnecessarily.

The first production milestone is stdio MCP tools. Streamable HTTP is a later phase and must not block stdio delivery.

## 2. Test vocabulary

The BDD scenarios use these actors:

- **ACP client**: sends `initialize`, `session/new`, `session/load`, `session/resume`, `session/prompt`, and `session/close`.
- **pi-acp**: the adapter under test.
- **pi session**: the `AgentSession` created by `createAgentSession`.
- **fake MCP server**: deterministic fixture process controlled by tests.
- **MCP server A/B**: independent fake server instances.

Test layers:

| Layer | Purpose |
|---|---|
| Unit | Pure normalization, naming, fingerprint, schema, and result conversion |
| MCP integration | Real child process or HTTP fixture with real MCP SDK transports |
| ACP component | ACP request handler + fake/real MCP fixture + fake pi session |
| Smoke | Real `pi-acp` process over ACP stdio |

Standard verification commands:

```bash
bun run typecheck
bun run lint
bun test
bun run build
```

During development, each task may run a focused test file first, but its phase gate requires the complete commands above.

## 3. Phase 0 — Baseline and test harness

### Task 0.1 — Freeze the implementation baseline

**Purpose**

Create the feature branch from the agreed Node-based baseline and record dependency/runtime assumptions.

**Changes**

- Branch from `v0.5.0`.
- Add an implementation note linking the architecture and this BDD plan.
- Confirm Node 24 build output uses `#!/usr/bin/env node`.
- Record the current ACP SDK and pi package versions.
- Do not add MCP capability advertisement.

**BDD**

```gherkin
Feature: MCP implementation baseline

  Scenario: Existing sessions work without MCP
    Given pi-acp is built from the MCP feature branch
    And an ACP client sends session/new with an empty mcpServers array
    When the client sends a prompt
    Then the pi session completes normally
    And no MCP process is started

  Scenario: Non-empty MCP configuration is not silently accepted before implementation
    Given stdio MCP support has not reached its phase gate
    When an ACP client sends session/new with a non-empty mcpServers array
    Then pi-acp returns an explicit unsupported-feature error
    And no pi session is created
```

**Verification**

- Existing component session lifecycle tests pass.
- Add one regression test for explicit rejection of non-empty MCP input while the feature flag remains off.

**Done when**

- The branch is reproducible.
- Existing no-MCP behavior is green.
- The adapter cannot falsely claim MCP support during incremental development.

### Task 0.2 — Add a deterministic fake stdio MCP server

**Purpose**

Provide a real subprocess fixture for transport and lifecycle tests.

**Changes**

Add a fixture executable supporting modes selected by argv:

```text
normal
paginate-tools
stderr
hang-initialize
hang-tool
crash-after-initialize
invalid-schema
ignore-shutdown
tools-changed
```

The fixture exposes:

- `echo`;
- `fail`;
- `sleep`;
- `inspect_runtime`;
- text/image/resource result tools.

`inspect_runtime` returns cwd, PID, argv, and an allowlisted set of env keys. It must never return the full environment.

**BDD**

```gherkin
Feature: Fake MCP server

  Scenario: The fixture completes the MCP lifecycle
    Given the fake MCP server is started in normal mode
    When an MCP client connects and lists tools
    Then the server returns deterministic tool definitions
    And echo returns the supplied input

  Scenario: Failure modes are selectable
    Given the fixture is started in hang-initialize mode
    When an MCP client connects
    Then initialization remains pending until cancelled or killed
```

**Verification**

- Test the fixture directly with the official MCP client.
- Verify all fixture modes terminate during test cleanup.

**Done when**

- Later tasks do not need mocks for process, framing, cwd, env, timeout, or signals.

## 4. Phase 1 — Types, normalization, and identity

### Task 1.1 — Add MCP client dependency and internal types

**Purpose**

Introduce the official MCP client without changing ACP behavior.

**Changes**

- Add the exact tested stable `@modelcontextprotocol/sdk@1.29.0`.
- Add `src/mcp/types.ts`.
- Define normalized stdio/HTTP server definitions, connection states, discovered tools, and runtime snapshots.
- Add typed MCP errors.

**BDD**

```gherkin
Feature: Internal MCP model

  Scenario: Production code has no untyped MCP boundary
    Given the MCP dependency is installed
    When TypeScript checks the project
    Then normalized server definitions are discriminated unions
    And no any or unsafe external value reaches session creation without validation
```

**Verification**

- Typecheck.
- Dependency lockfile changes only as expected.
- No capability or runtime behavior changes.

### Task 1.2 — Normalize and validate ACP MCP definitions

**Purpose**

Convert untrusted ACP input into deterministic internal definitions before any connection starts.

**Changes**

- Add `src/mcp/normalize.ts`.
- Validate server names, commands, args, env, URLs, and headers.
- Set stdio cwd to effective session cwd.
- Reject unsupported transports explicitly.
- Enforce server-count limits.

**BDD**

```gherkin
Feature: MCP server normalization

  Scenario: Normalize a stdio server
    Given an ACP stdio server with command, args, and env entries
    And an effective session cwd
    When pi-acp normalizes the server
    Then command and each argv element are preserved exactly
    And env entries become a key-value map
    And cwd equals the effective session cwd

  Scenario: Normalize an HTTP server
    Given an ACP HTTP server with an HTTPS URL and headers
    When pi-acp normalizes the server
    Then the URL is parsed
    And header names and values are preserved

  Scenario Outline: Reject invalid definitions
    Given an MCP definition with <problem>
    When pi-acp normalizes it
    Then normalization fails before any process or network connection starts

    Examples:
      | problem |
      | an empty server name |
      | duplicate server names |
      | an empty stdio command |
      | a header containing CR or LF |
      | a malformed URL |
      | an unsupported transport |
      | more than the server limit |

  Scenario: Permit loopback HTTP only
    Given insecure HTTP is allowed only for loopback
    When the URL is http://127.0.0.1:3000/mcp
    Then normalization succeeds
    When the URL is http://example.com/mcp
    Then normalization fails
```

**Verification**

- Unit tests for every variant and error.
- Assert validation has no spawn/fetch side effects.

### Task 1.3 — Stable fingerprint

**Purpose**

Detect when a live session can be reused and when it must be rebuilt.

**Changes**

- Add `src/mcp/fingerprint.ts`.
- Canonically sort servers, env keys, and header keys.
- Hash canonical serialized definitions plus effective cwd.
- Never log or persist the canonical secret-bearing input.

**BDD**

```gherkin
Feature: Session MCP fingerprint

  Scenario: Ordering does not change identity
    Given two equivalent MCP configurations with different server, env, and header ordering
    When fingerprints are computed
    Then the fingerprints are equal

  Scenario Outline: Runtime-defining changes alter identity
    Given an existing MCP fingerprint
    When <field> changes
    Then the new fingerprint differs

    Examples:
      | field |
      | effective cwd |
      | command |
      | args |
      | env value |
      | URL |
      | header value |

  Scenario: Secrets are not exposed
    Given an MCP env value containing a recognizable secret
    When the fingerprint is computed and diagnostics are rendered
    Then the secret does not appear in logs, errors, snapshots, or persisted state
```

**Verification**

- Pure unit tests.
- Snapshot only the hash and sanitized diagnostic summary.

**Phase 1 gate**

- Full typecheck, lint, and tests pass.
- No transports are started yet.

## 5. Phase 2 — One stdio MCP connection

### Task 2.1 — Construct stdio transport with correct process semantics

**Purpose**

Start exactly one MCP server using the official transport.

**Changes**

- Add `src/mcp/transports.ts`.
- Use `StdioClientTransport`.
- Pass command/args without shell interpolation.
- Pass effective cwd.
- Merge SDK `getDefaultEnvironment()` with explicit ACP env.
- Set stderr to `pipe`.

**BDD**

```gherkin
Feature: stdio MCP process startup

  Scenario: Launch in the session workspace
    Given an ACP session cwd
    And a stdio MCP server using inspect_runtime
    When the transport starts
    Then the child reports the ACP session cwd

  Scenario: Resolve command through PATH
    Given a bare executable command available through PATH
    When the transport starts
    Then the executable launches successfully

  Scenario: Do not invoke a shell
    Given an argument containing spaces, dollar signs, pipes, and command substitutions
    When the transport starts
    Then the child receives one exact argv element
    And no shell expression is evaluated

  Scenario: Inherit only safe environment variables
    Given pi-acp has a model-provider secret in its ambient environment
    And the ACP server definition does not explicitly pass it
    When the MCP child starts
    Then the child does not receive that secret
    And it receives the safe PATH and HOME values

  Scenario: Explicit env overrides inherited values
    Given PATH has an inherited value
    And the ACP MCP definition supplies a different PATH
    When the child starts
    Then the child receives the explicit PATH
```

**Verification**

- Real child-process tests through `inspect_runtime`.
- Windows-specific env expectations guarded by platform.

### Task 2.2 — Protect ACP stdio and capture MCP stderr

**Purpose**

Ensure MCP output cannot corrupt the outer ACP protocol.

**Changes**

- Consume child stdout only through MCP transport.
- Forward child stderr to adapter stderr with session/server prefix.
- Retain only a bounded stderr tail for startup errors.
- Redact known secret values.

**BDD**

```gherkin
Feature: MCP stream isolation

  Scenario: Protocol output stays internal
    Given an MCP server writes valid MCP JSON-RPC to stdout
    When pi-acp communicates with it
    Then those bytes are consumed by the MCP client
    And none appear on ACP stdout

  Scenario: Diagnostic output reaches stderr
    Given an MCP server writes a diagnostic line to stderr during startup
    When pi-acp starts the server
    Then adapter stderr includes the session and server prefix
    And ACP stdout remains valid NDJSON

  Scenario: Stderr retention is bounded
    Given a failing server writes more than the stderr retention limit
    When startup fails
    Then the error includes only the bounded tail
```

**Verification**

- Spawn the complete pi-acp process with separate stdout/stderr captures.
- Parse every ACP stdout line as JSON.

### Task 2.3 — Initialize, list tools, and close one connection

**Purpose**

Implement the complete lifecycle for one server.

**Changes**

- Add `src/mcp/connection.ts`.
- Connect and negotiate.
- List all tool pages.
- Track connection states.
- Implement idempotent close.
- Add startup timeout.

**BDD**

```gherkin
Feature: One MCP connection lifecycle

  Scenario: Successful initialization
    Given a normal MCP server
    When pi-acp connects
    Then initialize completes
    And all tools are discovered
    And connection state becomes ready

  Scenario: Paginated tools are complete
    Given a server returns multiple tools/list pages
    When discovery completes
    Then tools from every page are present exactly once

  Scenario: Initialization timeout
    Given a server hangs during initialize
    When the startup timeout expires
    Then connection startup fails
    And the child process exits

  Scenario: Idempotent close
    Given a ready stdio connection
    When close is called twice
    Then both calls settle without error
    And the child process is no longer alive

  Scenario: Stubborn child is killed
    Given a child ignores stdin EOF and SIGTERM
    When close is called
    Then pi-acp eventually sends SIGKILL
    And close finishes within the configured bound
```

**Verification**

- Real PID liveness assertions.
- No fixture process survives test teardown.

**Phase 2 gate**

- One stdio connection can start, discover, and close.
- Outer ACP stdout remains parseable.
- No ACP MCP capability is advertised yet.

## 6. Phase 3 — Per-session manager and atomic startup

### Task 3.1 — Implement `McpSessionManager`

**Purpose**

Own all MCP connections for exactly one ACP session.

**Changes**

- Add `src/mcp/manager.ts`.
- Start requested servers concurrently with bounded concurrency.
- Aggregate tools only after every server is ready.
- Roll back all ready/starting connections on any failure.
- Make manager close idempotent.

**BDD**

```gherkin
Feature: Atomic MCP session startup

  Scenario: Start multiple servers
    Given MCP server A and MCP server B are valid
    When the session manager starts
    Then both servers become ready
    And tools from A and B are available

  Scenario: Roll back partial startup
    Given server A starts successfully
    And server B fails initialization
    When the session manager starts
    Then startup fails
    And server A is closed
    And no process from A or B remains

  Scenario: Independent sessions
    Given two ACP sessions request the same stdio MCP definition
    When both managers start
    Then each session owns a different child PID
    And closing one session does not affect the other

  Scenario: Empty configuration
    Given a session has no MCP servers
    When its manager starts
    Then startup succeeds without processes or tools
```

**Verification**

- Integration tests with two fixture servers and PID tracking.
- Assert no partial toolset is returned.

### Task 3.2 — Connection loss and stale toolset state

**Purpose**

Define behavior after successful session creation.

**Changes**

- Detect unexpected transport close.
- Mark server unavailable.
- Mark toolset stale on `tools/list_changed`.
- Expose a sanitized one-shot diagnostic event.
- Do not restart automatically.

**BDD**

```gherkin
Feature: Runtime MCP degradation

  Scenario: One server crashes after startup
    Given a session has ready servers A and B
    When server A exits unexpectedly
    Then A becomes unavailable
    And B remains usable
    And the session emits one diagnostic

  Scenario: A stale tool list is reported
    Given a ready MCP server
    When it sends notifications/tools/list_changed
    Then the session toolset is marked stale
    And pi-acp does not mutate active pi tool definitions in place
    And one diagnostic explains that reopen/resume applies changes
```

**Verification**

- Fixture crash and list-changed modes.
- Assert diagnostics are de-duplicated.

**Phase 3 gate**

- Manager ownership and rollback are proven.
- Runtime failure does not take down unrelated connections.

## 7. Phase 4 — Convert MCP tools into pi custom tools

### Task 4.1 — Stable tool naming and reverse mapping

**Purpose**

Generate deterministic pi-safe names without losing original MCP identity.

**Changes**

- Add `src/mcp/naming.ts`.
- Produce `mcp__<server>__<tool>`.
- Add truncation and short hash.
- Keep reverse map to original server/tool names.
- Detect builtin/custom collisions.

**BDD**

```gherkin
Feature: MCP tool naming

  Scenario: Generate a normal name
    Given server "github" exposes tool "create_issue"
    When the pi name is generated
    Then it equals "mcp__github__create_issue"

  Scenario: Preserve original identity
    Given names contain characters unsupported by pi
    When a safe name is generated
    Then the reverse map retains the exact original names

  Scenario: Resolve normalized collisions
    Given two distinct original names normalize to the same safe name
    When names are generated
    Then deterministic hash suffixes make them distinct

  Scenario: Stable across resume
    Given the same server and tool definitions in a different order
    When names are generated after resume
    Then every generated name is unchanged
```

**Verification**

- Property-style tests for determinism and uniqueness.
- Explicit max-length tests.

### Task 4.2 — Adapt MCP JSON Schema to pi parameters

**Purpose**

Preserve model-visible tool argument quality.

**Changes**

- Add schema validation and size/depth limits.
- Wrap compatible MCP JSON Schema as TypeBox-compatible external schema.
- Retain descriptions, required, enum, defaults, and local `$defs`.
- Reject invalid/non-object roots.

**BDD**

```gherkin
Feature: MCP tool input schema adaptation

  Scenario: Preserve a structured schema
    Given an MCP tool schema with required fields, enums, descriptions, and nested objects
    When it is adapted
    Then the pi tool schema preserves those constraints

  Scenario Outline: Reject dangerous or unusable schema
    Given a schema with <problem>
    When it is adapted
    Then MCP session startup fails with a sanitized schema error

    Examples:
      | problem |
      | a non-object root |
      | excessive serialized size |
      | excessive nesting |
      | an unresolved external reference |
```

**Verification**

- Unit fixtures for common MCP schemas.
- Validate generated pi tool arguments through pi's normal validator.

### Task 4.3 — Convert tool results

**Purpose**

Map MCP result content into pi without dumping binary data into context.

**Changes**

- Add `src/mcp/tool-result.ts`.
- Convert text, image, resource, resource link, structured content, and error results.
- Bound raw details.
- Add text fallback where pi cannot represent a content type.

**BDD**

```gherkin
Feature: MCP tool result conversion

  Scenario: Text result
    Given an MCP tool returns text
    When the result is converted
    Then the pi result contains the same text

  Scenario: Resource link result
    Given an MCP tool returns a resource_link
    When the result is converted
    Then the pi result includes a Markdown link
    And structured details retain URI, name, and MIME type

  Scenario: Binary result does not flood context
    Given an MCP tool returns a large base64 blob
    When the result is converted
    Then the blob is not stringified into model-visible text
    And the result contains bounded metadata

  Scenario: Error result
    Given MCP returns isError true
    When the result is converted
    Then pi treats the tool execution as failed
    And the user-readable MCP error is retained
```

**Verification**

- Unit test every MCP content variant.
- Size-limit regression tests.

### Task 4.4 — Execute tools with timeout and cancellation

**Purpose**

Make generated pi tools call their original MCP server/tool.

**Changes**

- Add `src/mcp/tool-adapter.ts`.
- Close over the owning connection and original name.
- Forward args unchanged after pi validation.
- Apply tool timeout.
- Forward pi `AbortSignal` to MCP SDK.

**BDD**

```gherkin
Feature: MCP-backed pi tool execution

  Scenario: Call the original MCP tool
    Given a generated pi tool with a sanitized name
    When pi executes it
    Then MCP tools/call uses the original server tool name
    And arguments are preserved

  Scenario: Cancel an active call
    Given an MCP sleep tool is running
    When the pi abort signal fires
    Then the MCP request is cancelled
    And the pi tool settles as cancelled
    And the connection remains usable

  Scenario: Tool timeout
    Given an MCP tool does not return
    When the tool timeout expires
    Then the call fails with a timeout error
    And the session remains responsive
```

**Verification**

- Real fixture calls.
- Call echo again after cancellation to prove connection health.

**Phase 4 gate**

- A discovered MCP tool can execute through a standalone/fake pi tool definition.
- Naming, schema, results, timeout, and cancellation are green.

## 8. Phase 5 — Wire `session/new`

### Task 5.1 — Compose MCP tools with existing pi tools

**Purpose**

Prevent pi's tool allowlist from silently filtering MCP custom tools.

**Changes**

- Add a composition helper for builtin names, ACP read/bash overrides, and MCP tool names.
- Deduplicate deterministically.
- Reject unresolved name collisions.

**BDD**

```gherkin
Feature: pi tool composition

  Scenario: MCP tools survive the allowlist
    Given ACP read and bash overrides are active
    And MCP exposes two tools
    When createAgentSession options are composed
    Then tools includes builtin, override, and both MCP generated names
    And customTools includes overrides and both MCP definitions

  Scenario: No MCP behavior remains unchanged
    Given no MCP servers are requested
    When options are composed
    Then existing builtin and ACP override behavior is unchanged
```

**Verification**

- Unit tests on composed options.
- Component assertion against active tool names after pi session creation.

### Task 5.2 — Open new sessions atomically

**Purpose**

Deliver the first end-to-end ACP MCP behavior.

**Changes**

- Build MCP manager before pi session creation.
- Discover/adapt tools.
- Create pi session.
- Store manager on `PiAcpSession`.
- Roll back MCP if pi creation/auth fails.
- Remove temporary unsupported-feature gate for stdio.

**BDD**

```gherkin
Feature: ACP session/new with stdio MCP

  Scenario: Create a session with an MCP tool
    Given an ACP client supplies the fake stdio MCP server
    When session/new succeeds
    And the model invokes its echo tool
    Then the MCP server receives tools/call
    And ACP emits normal tool_call and tool_call_update events

  Scenario: MCP startup failure prevents pi session creation
    Given the requested MCP server cannot initialize
    When the client sends session/new
    Then session/new fails
    And no pi session is registered
    And no MCP child remains

  Scenario: Pi creation failure rolls back MCP
    Given MCP startup succeeds
    And pi session creation fails authentication
    When the client sends session/new
    Then session/new fails with the existing auth error
    And the MCP child is closed
```

**Verification**

- ACP component test.
- Process-level smoke test with fake MCP.
- Existing new-session tests unchanged.

### Task 5.3 — Advertise stdio support truthfully

**Purpose**

Enable clients only after end-to-end support exists.

**Changes**

- Keep `http: false`, `sse: false`.
- Document that stdio is the baseline MCP server form.
- Add protocol surface test.

**BDD**

```gherkin
Feature: MCP capability advertisement

  Scenario: Advertised capabilities match implementation
    Given only stdio MCP has passed its phase gate
    When an ACP client initializes
    Then pi-acp does not advertise HTTP
    And pi-acp does not advertise SSE
    And a stdio MCP server supplied to session/new is supported
```

**Phase 5 gate — stdio MVP**

- Full typecheck, lint, test, and build pass.
- Real `session/new` can call a stdio MCP tool.
- Failure leaves no pi session or child process.
- Ready for an internal prerelease.

## 9. Phase 6 — Load, resume, and fork

### Task 6.1 — Refactor shared session-open pipeline

**Purpose**

Remove duplicated ordering and rollback logic before adding three more lifecycle paths.

**Changes**

- Introduce internal `openSession`.
- Parameterize session manager creation/open/fork and history replay.
- Keep public ACP behavior unchanged.

**BDD**

```gherkin
Feature: Shared session-open pipeline

  Scenario Outline: Existing operation behavior is preserved
    Given no MCP servers are requested
    When the client performs <operation>
    Then behavior matches the pre-refactor implementation

    Examples:
      | operation |
      | session/new |
      | session/load |
      | session/resume |
      | unstable_forkSession |
```

**Verification**

- Existing lifecycle and replay tests act as characterization tests.
- No MCP-specific behavior change in this task.

### Task 6.2 — MCP-aware `session/load`

**BDD**

```gherkin
Feature: Load a pi session with MCP

  Scenario: Cold load reconnects MCP before replay
    Given a persisted pi session used an MCP tool
    And no live runtime exists
    When session/load supplies the MCP server definition
    Then MCP reconnects and tools are registered
    And history is replayed
    And historical MCP tool calls are not executed again

  Scenario: Load failure is atomic
    Given a persisted pi session exists
    And its requested MCP server cannot start
    When session/load is called
    Then load fails
    And no partial live pi session is registered
```

**Verification**

- Component test with persisted fixture JSONL.
- Count fake MCP calls to prove replay has no execution.

### Task 6.3 — MCP-aware `session/resume`

**BDD**

```gherkin
Feature: Resume a pi session with MCP

  Scenario: Cold resume reconnects without replay
    Given a persisted pi session and no live runtime
    When session/resume supplies its MCP definitions
    Then MCP reconnects
    And pi reopens the session with MCP custom tools
    And no history updates are replayed

  Scenario: Equal live fingerprint reuses runtime
    Given the session is already live
    And resume supplies an equivalent reordered MCP configuration
    When session/resume is called
    Then the existing pi and MCP runtimes are reused
    And the MCP child PID is unchanged

  Scenario: Changed live fingerprint rebuilds runtime
    Given the session is already live
    And resume changes an MCP env value
    When session/resume is called
    Then the old runtime is closed
    And a new MCP child starts with the new definition
    And the old child is gone

  Scenario: Omitted MCP servers are not recovered from secrets on disk
    Given a persisted pi session was previously opened with MCP
    And no live runtime exists
    When session/resume supplies no MCP servers
    Then the session resumes without ACP-provided MCP tools
    And pi-acp does not load a persisted secret-bearing MCP definition
```

**Verification**

- PID and fingerprint assertions.
- Assert resume emits no replay updates.

### Task 6.4 — MCP-aware fork

**BDD**

```gherkin
Feature: Fork a session with MCP

  Scenario: Fork owns an independent MCP runtime
    Given a live source session with MCP server A
    When unstable_forkSession supplies server A
    Then the fork has a new pi session ID
    And the fork has a different MCP child PID
    And closing the source does not close the fork MCP child
```

**Verification**

- Component test with source/fork PID tracking.

**Phase 6 gate**

- New/load/resume/fork all have happy, failure, and cleanup coverage.
- Resume semantics match ACP: no replay.

## 10. Phase 7 — Close, disconnect, and process shutdown

### Task 7.1 — Make session disposal awaitable

**Purpose**

Ensure subprocess cleanup completes instead of running fire-and-forget.

**Changes**

- Add async session close path.
- Reject new prompts while closing.
- Abort active pi turn and MCP calls.
- Close pi and MCP resources in a bounded sequence.
- Keep compatibility wrappers only where required.

**BDD**

```gherkin
Feature: Session close cleanup

  Scenario: Close a quiet session
    Given a live session with two MCP children
    When session/close completes
    Then both children have exited
    And the pi session is disposed
    And the registry no longer contains the session

  Scenario: Close during an MCP tool call
    Given an MCP tool call is active
    When session/close is called
    Then the call is cancelled
    And close completes within its deadline
    And no child remains

  Scenario: Close is idempotent
    Given a session has already been closed
    When internal cleanup runs again
    Then it performs no destructive duplicate action
```

### Task 7.2 — Clean up on ACP disconnect and signals

**BDD**

```gherkin
Feature: Adapter shutdown cleanup

  Scenario Outline: Process-level shutdown reaps MCP children
    Given pi-acp owns active MCP sessions
    When <event> occurs
    Then pi-acp stops accepting operations
    And all MCP children exit before the shutdown deadline

    Examples:
      | event |
      | ACP stdin EOF |
      | SIGINT |
      | SIGTERM |

  Scenario: Failed session open leaves no orphan
    Given MCP starts successfully
    And a later open step throws
    When rollback completes
    Then the child PID no longer exists
```

**Verification**

- Process-level tests, not only mocked unit tests.
- After each suite, scan recorded fixture PIDs and assert none are alive.

**Phase 7 gate**

- No known path leaks a child process.
- Shutdown behavior is bounded and deterministic.

## 11. Phase 8 — Streamable HTTP

### Task 8.1 — HTTP transport and security policy

**Changes**

- Construct `StreamableHTTPClientTransport`.
- Apply validated headers.
- Allow HTTPS and loopback HTTP.
- Use SDK session/reconnection behavior only for the live ACP session.
- Add HTTP fixture.

**BDD**

```gherkin
Feature: Streamable HTTP MCP

  Scenario: Connect to an HTTPS MCP server
    Given a valid HTTPS MCP endpoint
    When the MCP manager starts
    Then initialize and tools/list complete
    And its tools are available to pi

  Scenario: Connect to loopback HTTP
    Given a local HTTP MCP test server
    When the manager starts
    Then the connection is permitted

  Scenario: Reject insecure remote HTTP
    Given a non-loopback HTTP URL
    When normalization runs
    Then the request fails before network access

  Scenario: Forward headers without logging secrets
    Given ACP supplies an Authorization header
    When pi-acp connects
    Then the server receives the header
    And logs/errors never contain its value

  Scenario: Resume creates a fresh MCP HTTP session
    Given an ACP session is cold-resumed
    When HTTP MCP reconnects
    Then a fresh MCP transport session is negotiated
    And no stale MCP session ID is loaded from disk
```

### Task 8.2 — Advertise HTTP after the gate

**BDD**

```gherkin
Feature: HTTP capability gate

  Scenario: HTTP is advertised after implementation
    Given Streamable HTTP integration tests pass
    When an ACP client initializes
    Then mcpCapabilities.http is true
    And mcpCapabilities.sse remains false
```

**Phase 8 gate**

- Full suite passes with stdio and HTTP.
- HTTP headers are redacted.
- Capability advertisement matches behavior.

## 12. Phase 9 — Diagnostics and release hardening

### Task 9.1 — Sanitized MCP status reporting

**Purpose**

Make failures debuggable without leaking secrets.

**Changes**

- One-line startup summary per server when diagnostics are enabled.
- Optional `/mcp` adapter command listing server state and discovered tool counts.
- Never include env/header values.

**BDD**

```gherkin
Feature: MCP diagnostics

  Scenario: Report ready servers
    Given two MCP servers are ready
    When the user invokes /mcp
    Then the response lists names, transport kinds, states, and tool counts

  Scenario: Redact secrets
    Given MCP configuration contains env and authorization secrets
    When startup fails and diagnostics are displayed
    Then no secret value appears
```

### Task 9.2 — Limits and abuse cases

**BDD**

```gherkin
Feature: MCP resource limits

  Scenario Outline: Reject excessive input
    Given MCP input exceeds <limit>
    When the session is opened
    Then the request fails before pi session creation
    And all started transports are closed

    Examples:
      | limit |
      | server count |
      | total tool count |
      | tools per server |
      | schema size |
      | schema depth |
      | retained stderr |
      | retained raw result |
```

### Task 9.3 — Release verification

**Verification matrix**

| Behavior | Unit | MCP integration | ACP component | Process smoke |
|---|---:|---:|---:|---:|
| Normalize stdio/HTTP | Yes |  |  |  |
| Safe env and cwd |  | Yes |  | Yes |
| stdout isolation |  | Yes |  | Yes |
| Atomic startup |  | Yes | Yes |  |
| Tool naming/schema | Yes |  | Yes |  |
| Tool call/cancel | Yes | Yes | Yes |  |
| New |  |  | Yes | Yes |
| Load |  |  | Yes |  |
| Resume |  |  | Yes | Yes |
| Fork |  |  | Yes |  |
| Close/disconnect/signals |  | Yes | Yes | Yes |
| HTTP security | Yes | Yes | Yes |  |
| Secret redaction | Yes | Yes | Yes | Yes |

**Release BDD**

```gherkin
Feature: Production MCP conformance

  Scenario: Non-empty mcpServers is never ignored
    Given an ACP operation supplies one or more MCP servers
    When the operation completes successfully
    Then every requested server initialized successfully
    And every accepted discovered tool was registered with pi

  Scenario: Failure is clean
    Given any startup or session-open step fails
    When rollback completes
    Then no partial pi session is registered
    And no owned MCP child or HTTP transport remains

  Scenario: Existing users are unaffected
    Given an ACP client supplies no MCP servers
    When it exercises existing pi-acp session and tool behavior
    Then results match the release baseline
```

**Final commands**

```bash
bun run typecheck
bun run lint
bun test
bun run build
npm pack --dry-run
```

**Done when**

- All phase gates pass.
- Capability declarations match tested transports.
- No expected-failure test leaks a process.
- The README limitation claiming MCP is unwired is removed.
- The conformance document marks stdio and HTTP accurately.
- Upgrade notes explain resume behavior and that MCP definitions are not persisted.

## 13. Dependency graph

```text
0.1 baseline
  └── 0.2 fake server
      └── 1.1 types/dependency
          ├── 1.2 normalization
          │   └── 1.3 fingerprint
          └── 2.1 stdio transport
              ├── 2.2 stream isolation
              └── 2.3 connection lifecycle
                  └── 3.1 session manager
                      ├── 3.2 runtime degradation
                      └── 4.1 naming
                          ├── 4.2 schema
                          └── 4.3 results
                              └── 4.4 calls/cancel
                                  └── 5.1 tool composition
                                      └── 5.2 session/new
                                          └── 5.3 stdio gate
                                              └── 6.1 shared open pipeline
                                                  ├── 6.2 load
                                                  ├── 6.3 resume
                                                  └── 6.4 fork
                                                      └── 7.1 async close
                                                          └── 7.2 shutdown
                                                              ├── 8.1 HTTP
                                                              │   └── 8.2 HTTP gate
                                                              └── 9.x hardening/release
```

## 14. Suggested pull request boundaries

1. Test fixture and baseline guard.
2. MCP types, normalization, fingerprint.
3. Stdio transport and one-connection lifecycle.
4. Per-session manager and atomic rollback.
5. Tool naming, schema, result, and call adapter.
6. End-to-end `session/new` stdio MCP.
7. Shared open refactor plus load/resume/fork.
8. Async close and process shutdown.
9. Streamable HTTP.
10. Diagnostics, documentation, and release hardening.

Do not combine all phases into one pull request. The end-to-end `session/new` PR is the first externally useful milestone; load/resume/fork and HTTP can follow independently.
