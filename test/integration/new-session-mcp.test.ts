import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	CreateAgentSessionOptions,
	CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import { PiAcpAgent } from "@pi-acp/acp/agent";
import { asAgentConn, FakeAgentSession, FakeAgentSideConnection } from "../helpers/fakes";

const fixturePath = fileURLToPath(new URL("../fixtures/fake-mcp-server.mjs", import.meta.url));
const agents: PiAcpAgent[] = [];

afterEach(() => {
	for (const agent of agents.splice(0)) agent.dispose();
});

function resultFrom(session: FakeAgentSession): CreateAgentSessionResult {
	return {
		session,
		extensionsResult: { extensions: [], errors: [], runtime: undefined },
	} as unknown as CreateAgentSessionResult;
}

describe("session/new MCP integration", () => {
	test("injects discovered MCP tools into pi customTools", async () => {
		let received: CreateAgentSessionOptions | undefined;
		const fakeSession = new FakeAgentSession();
		const agent = new PiAcpAgent(asAgentConn(new FakeAgentSideConnection()), {
			createAgentSession: async (options) => {
				received = options;
				return resultFrom(fakeSession);
			},
		});
		agents.push(agent);

		const response = await agent.newSession({
			cwd: process.cwd(),
			mcpServers: [
				{
					name: "fixture",
					command: process.execPath,
					args: [fixturePath],
					env: [],
				},
			],
		});

		expect(response.sessionId).toBe("test-session-id");
		expect(received?.cwd).toBe(process.cwd());
		expect(received?.customTools?.map((tool) => tool.name)).toContain("mcp__fixture__echo");
	});

	test("maps MCP startup failure to an ACP request error and skips pi creation", async () => {
		let createCount = 0;
		const agent = new PiAcpAgent(asAgentConn(new FakeAgentSideConnection()), {
			createAgentSession: async () => {
				createCount++;
				return resultFrom(new FakeAgentSession());
			},
			mcpInitializeTimeoutMs: 100,
		});
		agents.push(agent);

		await expect(
			agent.newSession({
				cwd: process.cwd(),
				mcpServers: [
					{
						name: "stuck",
						command: process.execPath,
						args: [fixturePath, "hang-initialize"],
						env: [],
					},
				],
			}),
		).rejects.toMatchObject({ code: -32602 });
		expect(createCount).toBe(0);
	});

	test("cleans up MCP when pi session creation fails", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-acp-new-mcp-"));
		const pidFile = join(directory, "mcp.pid");
		const agent = new PiAcpAgent(asAgentConn(new FakeAgentSideConnection()), {
			createAgentSession: async () => {
				throw new Error("pi creation failed");
			},
		});
		agents.push(agent);

		await expect(
			agent.newSession({
				cwd: process.cwd(),
				mcpServers: [
					{
						name: "fixture",
						command: process.execPath,
						args: [fixturePath],
						env: [{ name: "PI_ACP_PID_FILE", value: pidFile }],
					},
				],
			}),
		).rejects.toThrow("pi creation failed");
		await Bun.sleep(20);
		const pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
		expect(() => process.kill(pid, 0)).toThrow();
	});

	test("waits for the MCP child to exit before closeSession returns", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-acp-close-mcp-"));
		const pidFile = join(directory, "mcp.pid");
		const agent = new PiAcpAgent(asAgentConn(new FakeAgentSideConnection()), {
			createAgentSession: async () => resultFrom(new FakeAgentSession()),
		});
		agents.push(agent);
		const response = await agent.newSession({
			cwd: process.cwd(),
			mcpServers: [
				{
					name: "fixture",
					command: process.execPath,
					args: [fixturePath],
					env: [{ name: "PI_ACP_PID_FILE", value: pidFile }],
				},
			],
		});
		const pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);

		await agent.closeSession({ sessionId: response.sessionId });

		expect(() => process.kill(pid, 0)).toThrow();
	});
});
