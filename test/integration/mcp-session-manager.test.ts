import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpSessionManager } from "@pi-acp/mcp/session-manager";
import type { NormalizedStdioMcpServer } from "@pi-acp/mcp/types";

const fixturePath = fileURLToPath(new URL("../fixtures/fake-mcp-server.mjs", import.meta.url));
const managers: McpSessionManager[] = [];

function server(
	name: string,
	mode = "normal",
	env: Record<string, string> = {},
): NormalizedStdioMcpServer {
	return {
		kind: "stdio",
		originalName: name,
		stableName: name,
		command: process.execPath,
		args: [fixturePath, mode],
		env,
		cwd: process.cwd(),
	};
}

afterEach(async () => {
	await Promise.allSettled(managers.splice(0).map((manager) => manager.close()));
});

describe("McpSessionManager", () => {
	test("owns multiple initialized connections and exposes a stable registry", async () => {
		const manager = await McpSessionManager.open([server("first"), server("second")]);
		managers.push(manager);

		expect(manager.state).toBe("ready");
		expect(manager.connections.map((connection) => connection.server.stableName)).toEqual([
			"first",
			"second",
		]);
		expect(manager.get("first").state).toBe("ready");
		expect(manager.fingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	test("rolls back every initialized connection when a later server fails", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-acp-mcp-manager-"));
		const pidFile = join(directory, "first.pid");

		await expect(
			McpSessionManager.open(
				[
					server("first", "normal", { PI_ACP_PID_FILE: pidFile }),
					server("second", "hang-initialize"),
				],
				{ connection: { initializeTimeoutMs: 1_000 } },
			),
		).rejects.toThrow('MCP session startup failed at server "second"');

		const pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
		expect(() => process.kill(pid, 0)).toThrow();
	});

	test("supports an empty configuration", async () => {
		const manager = await McpSessionManager.open([]);
		managers.push(manager);

		expect(manager.connections).toEqual([]);
		expect(manager.state).toBe("ready");
	});

	test("closes all children idempotently", async () => {
		const manager = await McpSessionManager.open([server("first"), server("second")]);
		const pids = manager.connections.map((connection) => connection.pid);

		await manager.close();
		await manager.close();

		expect(manager.state).toBe("closed");
		for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
	});
});
