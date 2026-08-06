import { fileURLToPath } from "node:url";
import { McpStdioConnection } from "@pi-acp/mcp/stdio-connection";
import type { NormalizedStdioMcpServer } from "@pi-acp/mcp/types";
import { afterEach, describe, expect, test } from "vitest";
import * as z from "zod";

const fixturePath = fileURLToPath(new URL("../fixtures/fake-mcp-server.mjs", import.meta.url));
const connections: McpStdioConnection[] = [];
const textResultSchema = z.object({
	content: z.array(z.object({ type: z.literal("text"), text: z.string().trim() }).loose()),
});
const runtimeSchema = z.object({
	cwd: z.string().trim(),
	env: z.record(z.string(), z.string().trim()),
});

function server(mode = "normal"): NormalizedStdioMcpServer {
	return {
		kind: "stdio",
		originalName: "fixture",
		stableName: "fixture",
		command: process.execPath,
		args: [fixturePath, mode],
		env: { PI_ACP_TEST_VALUE: "explicit-value" },
		cwd: process.cwd(),
	};
}

afterEach(async () => {
	await Promise.allSettled(connections.splice(0).map((connection) => connection.close()));
});

describe("McpStdioConnection", () => {
	test("starts, initializes, lists tools, and invokes the real child process", async () => {
		const connection = await McpStdioConnection.open(server());
		connections.push(connection);

		expect(connection.state).toBe("ready");
		expect(connection.pid).toBeGreaterThan(0);
		expect((await connection.client.listTools()).tools.map((tool) => tool.name)).toContain("echo");
		const result = await connection.client.callTool({
			name: "echo",
			arguments: { text: "hello" },
		});
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
	});

	test("uses the session cwd, safe inherited environment, and explicit overrides", async () => {
		const connection = await McpStdioConnection.open(server());
		connections.push(connection);

		const result = await connection.client.callTool({ name: "inspect_runtime", arguments: {} });
		const content = textResultSchema.parse(result).content[0];
		if (content === undefined) throw new Error("Expected text inspection result");
		const runtime = runtimeSchema.parse(JSON.parse(content.text));
		expect(runtime.cwd).toBe(process.cwd());
		expect(runtime.env["PI_ACP_TEST_VALUE"]).toBe("explicit-value");
		expect(runtime.env["PATH"]).toBe(process.env["PATH"]);
	});

	test("captures bounded stderr without mixing it into protocol stdout", async () => {
		const connection = await McpStdioConnection.open(server("stderr"));
		connections.push(connection);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(connection.stderr).toContain("fake MCP diagnostic");
		expect((await connection.client.listTools()).tools.length).toBeGreaterThan(0);
	});

	test("times out initialization and cleans up the child", async () => {
		const startedAt = Date.now();
		await expect(
			McpStdioConnection.open(server("hang-initialize"), { initializeTimeoutMs: 100 }),
		).rejects.toThrow('MCP server "fixture" failed to initialize');
		expect(Date.now() - startedAt).toBeLessThan(2_000);
	});

	test("closes idempotently and terminates the child process", async () => {
		const connection = await McpStdioConnection.open(server());
		const pid = connection.pid;
		expect(pid).toBeGreaterThan(0);

		await connection.close();
		await connection.close();

		expect(connection.state).toBe("closed");
		expect(() => process.kill(pid, 0)).toThrow();
	});
});
