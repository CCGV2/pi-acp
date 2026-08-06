import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, test } from "vitest";

const fixturePath = fileURLToPath(new URL("../fixtures/fake-mcp-server.mjs", import.meta.url));
const openTransports: StdioClientTransport[] = [];

afterEach(async () => {
	await Promise.allSettled(openTransports.splice(0).map((transport) => transport.close()));
});

describe("fake MCP server fixture", () => {
	test("completes lifecycle and echoes input", async () => {
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [fixturePath],
			stderr: "pipe",
		});
		openTransports.push(transport);
		const client = new Client({ name: "fixture-test", version: "1.0.0" });

		await client.connect(transport);
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toContain("echo");

		const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
	});
});
