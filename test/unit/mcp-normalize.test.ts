import type { McpServer } from "@agentclientprotocol/sdk";
import { normalizeMcpServers } from "@pi-acp/mcp/normalize";
import { describe, expect, test } from "vitest";

const cwd = process.cwd();

describe("normalizeMcpServers", () => {
	test("normalizes stdio environment and server names", () => {
		const result = normalizeMcpServers(
			[
				{
					name: "Local Files",
					command: "node",
					args: ["server.mjs"],
					env: [
						{ name: "TOKEN", value: "secret" },
						{ name: "MODE", value: "test" },
					],
				},
			],
			cwd,
		);

		expect(result).toEqual([
			{
				kind: "stdio",
				originalName: "Local Files",
				stableName: "Local_Files",
				command: "node",
				args: ["server.mjs"],
				env: { MODE: "test", TOKEN: "secret" },
				cwd,
			},
		]);
	});

	test("normalizes HTTP URLs and headers", () => {
		const result = normalizeMcpServers(
			[
				{
					type: "http",
					name: "remote",
					url: "https://example.com/mcp",
					headers: [{ name: "Authorization", value: "Bearer secret" }],
				},
			],
			cwd,
		);

		expect(result[0]).toEqual({
			kind: "http",
			originalName: "remote",
			stableName: "remote",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer secret" },
		});
	});

	test("allows loopback HTTP but rejects remote plaintext HTTP", () => {
		expect(() =>
			normalizeMcpServers(
				[{ type: "http", name: "local", url: "http://127.0.0.1:3000/mcp", headers: [] }],
				cwd,
			),
		).not.toThrow();

		expect(() =>
			normalizeMcpServers(
				[{ type: "http", name: "remote", url: "http://example.com/mcp", headers: [] }],
				cwd,
			),
		).toThrow("HTTPS");
	});

	test("rejects unsupported transports", () => {
		const server: McpServer = {
			type: "sse",
			name: "legacy",
			url: "https://example.com/sse",
			headers: [],
		};

		expect(() => normalizeMcpServers([server], cwd)).toThrow('transport "sse"');
	});

	test("rejects empty commands, duplicate environment keys, and invalid cwd", () => {
		expect(() =>
			normalizeMcpServers([{ name: "empty", command: " ", args: [], env: [] }], cwd),
		).toThrow("command");
		expect(() =>
			normalizeMcpServers(
				[
					{
						name: "dupe-env",
						command: "node",
						args: [],
						env: [
							{ name: "TOKEN", value: "a" },
							{ name: "TOKEN", value: "b" },
						],
					},
				],
				cwd,
			),
		).toThrow("environment");
		expect(() => normalizeMcpServers([], "/definitely/not/a/pi-acp-directory")).toThrow("cwd");
	});

	test("rejects duplicate names before and after stable-name normalization", () => {
		expect(() =>
			normalizeMcpServers(
				[
					{ name: "same", command: "one", args: [], env: [] },
					{ name: "same", command: "two", args: [], env: [] },
				],
				cwd,
			),
		).toThrow("Duplicate MCP server name");
		expect(() =>
			normalizeMcpServers(
				[
					{ name: "a b", command: "one", args: [], env: [] },
					{ name: "a@b", command: "two", args: [], env: [] },
				],
				cwd,
			),
		).toThrow("stable name");
	});

	test("rejects header injection and excessive server counts", () => {
		expect(() =>
			normalizeMcpServers(
				[
					{
						type: "http",
						name: "bad-header",
						url: "https://example.com/mcp",
						headers: [{ name: "X-Test", value: "safe\r\nInjected: yes" }],
					},
				],
				cwd,
			),
		).toThrow("header");

		const servers = Array.from({ length: 33 }, (_, index) => ({
			name: `server-${index}`,
			command: "node",
			args: [],
			env: [],
		}));
		expect(() => normalizeMcpServers(servers, cwd)).toThrow("at most 32");
	});
});
