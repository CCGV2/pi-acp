#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const mode = process.argv[2] ?? "normal";

if (process.env.PI_ACP_PID_FILE !== undefined) {
	writeFileSync(process.env.PI_ACP_PID_FILE, String(process.pid));
}

if (mode === "hang-initialize") {
	process.stdin.resume();
	await new Promise(() => {});
}

const server = new McpServer(
	{ name: "pi-acp-fake-mcp", version: "1.0.0" },
	{ capabilities: { tools: { listChanged: true } } },
);

server.registerTool(
	"echo",
	{
		description: "Return the supplied text",
		inputSchema: { text: z.string().trim() },
	},
	async ({ text }) => ({ content: [{ type: "text", text }] }),
);

server.registerTool(
	"fail",
	{
		description: "Return an MCP tool error",
		inputSchema: { message: z.string().trim() },
	},
	async ({ message }) => ({
		content: [{ type: "text", text: message }],
		isError: true,
	}),
);

server.registerTool(
	"sleep",
	{
		description: "Wait before returning",
		inputSchema: { milliseconds: z.int().nonnegative() },
	},
	async ({ milliseconds }, { signal }) => {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, milliseconds);
			signal.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					reject(signal.reason);
				},
				{ once: true },
			);
		});
		return { content: [{ type: "text", text: "done" }] };
	},
);

server.registerTool(
	"inspect_runtime",
	{
		description: "Return deterministic process information",
		inputSchema: {},
	},
	async () => ({
		content: [
			{
				type: "text",
				text: JSON.stringify({
					cwd: process.cwd(),
					pid: process.pid,
					argv: process.argv.slice(2),
					env: Object.fromEntries(
						["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER", "PI_ACP_TEST_VALUE"]
							.filter((key) => process.env[key] !== undefined)
							.map((key) => [key, process.env[key]]),
					),
				}),
			},
		],
	}),
);

if (mode === "stderr") {
	process.stderr.write("fake MCP diagnostic\n");
}

if (mode === "ignore-shutdown") {
	process.on("SIGTERM", () => {});
	process.stdin.on("end", () => process.stdin.resume());
}

const transport = new StdioServerTransport();
await server.connect(transport);

if (mode === "crash-after-initialize") {
	setTimeout(() => process.exit(17), 50);
}

if (mode === "tools-changed") {
	setTimeout(() => server.sendToolListChanged(), 50);
}
