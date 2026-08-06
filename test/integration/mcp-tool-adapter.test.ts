import { fileURLToPath } from "node:url";
import { McpSessionManager } from "@pi-acp/mcp/session-manager";
import { buildMcpTools, invokeMcpTool } from "@pi-acp/mcp/tool-adapter";
import type { NormalizedStdioMcpServer } from "@pi-acp/mcp/types";
import { afterEach, describe, expect, test } from "vitest";

const fixturePath = fileURLToPath(new URL("../fixtures/fake-mcp-server.mjs", import.meta.url));
const managers: McpSessionManager[] = [];

function fixtureServer(): NormalizedStdioMcpServer {
	return {
		kind: "stdio",
		originalName: "Local Tools",
		stableName: "Local_Tools",
		command: process.execPath,
		args: [fixturePath],
		env: {},
		cwd: process.cwd(),
	};
}

afterEach(async () => {
	await Promise.allSettled(managers.splice(0).map((manager) => manager.close()));
});

describe("MCP tool adapter", () => {
	test("discovers tools with deterministic names and preserves input JSON Schema", async () => {
		const manager = await McpSessionManager.open([fixtureServer()]);
		managers.push(manager);

		const tools = await buildMcpTools(manager);
		const echo = tools.find((tool) => tool.name === "mcp__Local_Tools__echo");
		expect(echo).toBeDefined();
		expect(echo?.label).toBe("Local Tools / echo");
		expect(echo?.description).toBe("Return the supplied text");
		expect(echo?.parameters).toMatchObject({
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		});
	});

	test("invokes a tool and maps text content for pi", async () => {
		const manager = await McpSessionManager.open([fixtureServer()]);
		managers.push(manager);

		const result = await invokeMcpTool(manager.get("Local_Tools"), "echo", { text: "hello" });
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
		expect(result.details.serverName).toBe("Local Tools");
		expect(result.details.toolName).toBe("echo");
	});

	test("turns MCP isError results into failed pi tool executions", async () => {
		const manager = await McpSessionManager.open([fixtureServer()]);
		managers.push(manager);

		await expect(
			invokeMcpTool(manager.get("Local_Tools"), "fail", { message: "expected failure" }),
		).rejects.toThrow("expected failure");
	});

	test("propagates pi cancellation to an in-flight MCP tool call", async () => {
		const manager = await McpSessionManager.open([fixtureServer()]);
		managers.push(manager);
		const controller = new AbortController();
		setTimeout(() => controller.abort(new Error("cancelled by test")), 20);

		await expect(
			invokeMcpTool(
				manager.get("Local_Tools"),
				"sleep",
				{ milliseconds: 10_000 },
				controller.signal,
			),
		).rejects.toThrow();
	});
});
