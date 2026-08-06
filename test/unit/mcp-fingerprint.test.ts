import { fingerprintMcpServers } from "@pi-acp/mcp/fingerprint";
import { normalizeMcpServers } from "@pi-acp/mcp/normalize";
import { describe, expect, test } from "vitest";

const cwd = process.cwd();

describe("fingerprintMcpServers", () => {
	test("is stable across server, environment, and header declaration order", () => {
		const first = normalizeMcpServers(
			[
				{
					name: "stdio",
					command: "node",
					args: ["server.mjs"],
					env: [
						{ name: "B", value: "2" },
						{ name: "A", value: "1" },
					],
				},
				{
					type: "http",
					name: "http",
					url: "https://example.com/mcp",
					headers: [
						{ name: "X-B", value: "2" },
						{ name: "X-A", value: "1" },
					],
				},
			],
			cwd,
		);
		const second = normalizeMcpServers(
			[
				{
					type: "http",
					name: "http",
					url: "https://example.com/mcp",
					headers: [
						{ name: "X-A", value: "1" },
						{ name: "X-B", value: "2" },
					],
				},
				{
					name: "stdio",
					command: "node",
					args: ["server.mjs"],
					env: [
						{ name: "A", value: "1" },
						{ name: "B", value: "2" },
					],
				},
			],
			cwd,
		);

		expect(fingerprintMcpServers(first)).toBe(fingerprintMcpServers(second));
	});

	test("changes for every runtime-relevant field without exposing secrets", () => {
		const base = normalizeMcpServers(
			[
				{
					name: "stdio",
					command: "node",
					args: ["server.mjs"],
					env: [{ name: "TOKEN", value: "top-secret-value" }],
				},
			],
			cwd,
		);
		const changed = normalizeMcpServers(
			[
				{
					name: "stdio",
					command: "node",
					args: ["other.mjs"],
					env: [{ name: "TOKEN", value: "top-secret-value" }],
				},
			],
			cwd,
		);

		const fingerprint = fingerprintMcpServers(base);
		expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(fingerprint).not.toContain("top-secret-value");
		expect(fingerprint).not.toBe(fingerprintMcpServers(changed));
	});
});
