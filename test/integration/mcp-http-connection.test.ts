import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { McpSessionManager } from "@pi-acp/mcp/session-manager";
import { buildMcpTools, invokeMcpTool } from "@pi-acp/mcp/tool-adapter";

const servers: Server[] = [];
const managers: McpSessionManager[] = [];

afterEach(async () => {
	await Promise.allSettled(managers.splice(0).map((manager) => manager.close()));
	await Promise.all(
		servers
			.splice(0)
			.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
	);
});

describe("MCP Streamable HTTP", () => {
	test("connects, discovers, and invokes tools over loopback HTTP", async () => {
		const http = createServer((request, response) => {
			void (async () => {
				if (request.method !== "POST") {
					response.writeHead(request.method === "DELETE" ? 200 : 405).end();
					return;
				}
				const chunks: Uint8Array[] = [];
				for await (const chunk of request) {
					if (chunk instanceof Uint8Array) chunks.push(chunk);
				}
				const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
					id?: string | number;
					method: string;
					params?: { arguments?: { text?: string } };
				};
				if (body.id === undefined) {
					response.writeHead(202).end();
					return;
				}
				const result =
					body.method === "initialize"
						? {
								protocolVersion: "2025-06-18",
								capabilities: { tools: {} },
								serverInfo: { name: "http-fixture", version: "1.0.0" },
							}
						: body.method === "tools/list"
							? {
									tools: [
										{
											name: "echo",
											description: "HTTP echo",
											inputSchema: {
												type: "object",
												properties: { text: { type: "string" } },
												required: ["text"],
											},
										},
									],
								}
							: {
									content: [{ type: "text", text: body.params?.arguments?.text ?? "" }],
								};
				response
					.writeHead(200, { "content-type": "application/json" })
					.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
			})();
		});
		servers.push(http);
		await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
		const address = http.address();
		if (address === null || typeof address === "string") throw new Error("Missing HTTP address");

		const manager = await McpSessionManager.open([
			{
				kind: "http",
				originalName: "http",
				stableName: "http",
				url: `http://127.0.0.1:${address.port}/mcp`,
				headers: { "X-Test": "value" },
			},
		]);
		managers.push(manager);

		expect((await buildMcpTools(manager)).map((tool) => tool.name)).toContain("mcp__http__echo");
		expect((await invokeMcpTool(manager.get("http"), "echo", { text: "hello" })).content).toEqual([
			{ type: "text", text: "hello" },
		]);
	});
});
