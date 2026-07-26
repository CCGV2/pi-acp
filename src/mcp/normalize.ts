import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk";
import {
	MAX_MCP_SERVERS,
	McpConfigurationError,
	type NormalizedHttpMcpServer,
	type NormalizedMcpServer,
	type NormalizedStdioMcpServer,
} from "@pi-acp/mcp/types";

const INVALID_HEADER_CHARACTER = /[\r\n]/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function stableServerName(name: string): string {
	return name.replaceAll(/[^A-Za-z0-9_-]/g, "_");
}

function validateCwd(cwd: string): void {
	if (!isAbsolute(cwd)) {
		throw new McpConfigurationError(`MCP cwd must be an absolute path: ${cwd}`);
	}

	try {
		if (!statSync(cwd).isDirectory()) {
			throw new McpConfigurationError(`MCP cwd is not a directory: ${cwd}`);
		}
	} catch (error) {
		if (error instanceof McpConfigurationError) throw error;
		throw new McpConfigurationError(`MCP cwd does not exist: ${cwd}`);
	}
}

function normalizeName(name: string): { originalName: string; stableName: string } {
	const originalName = name.trim();
	if (originalName.length === 0) {
		throw new McpConfigurationError("MCP server name must not be empty");
	}
	const stableName = stableServerName(originalName);
	if (stableName.length === 0) {
		throw new McpConfigurationError(`MCP server name cannot be normalized safely: ${name}`);
	}
	return { originalName, stableName };
}

function normalizeKeyValuePairs(
	pairs: readonly { name: string; value: string }[],
	kind: "environment" | "header",
): Record<string, string> {
	const result: Record<string, string> = {};
	const seen = new Set<string>();
	for (const pair of pairs) {
		const key = pair.name.trim();
		if (key.length === 0) {
			throw new McpConfigurationError(`MCP ${kind} name must not be empty`);
		}
		if (INVALID_HEADER_CHARACTER.test(key) || INVALID_HEADER_CHARACTER.test(pair.value)) {
			throw new McpConfigurationError(`MCP ${kind} contains a forbidden newline`);
		}
		const identity = kind === "header" ? key.toLowerCase() : key;
		if (seen.has(identity)) {
			throw new McpConfigurationError(`Duplicate MCP ${kind} key: ${key}`);
		}
		seen.add(identity);
		result[key] = pair.value;
	}
	return Object.fromEntries(
		Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function normalizeStdioServer(
	server: Extract<McpServer, { command: string }>,
	cwd: string,
): NormalizedStdioMcpServer {
	const names = normalizeName(server.name);
	if (server.command.trim().length === 0) {
		throw new McpConfigurationError(
			`MCP stdio server "${names.originalName}" command must not be empty`,
		);
	}
	return {
		kind: "stdio",
		...names,
		command: server.command,
		args: [...server.args],
		env: normalizeKeyValuePairs(server.env, "environment"),
		cwd,
	};
}

function normalizeHttpServer(
	server: Extract<McpServer, { type: "http" }>,
): NormalizedHttpMcpServer {
	const names = normalizeName(server.name);
	let url: URL;
	try {
		url = new URL(server.url);
	} catch {
		throw new McpConfigurationError(`Invalid MCP HTTP URL for "${names.originalName}"`);
	}
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
	) {
		throw new McpConfigurationError(
			`MCP HTTP server "${names.originalName}" must use HTTPS unless it is loopback`,
		);
	}
	return {
		kind: "http",
		...names,
		url: url.toString(),
		headers: normalizeKeyValuePairs(server.headers, "header"),
	};
}

export function normalizeMcpServers(
	servers: readonly McpServer[] | undefined,
	cwd: string,
): NormalizedMcpServer[] {
	validateCwd(cwd);
	if ((servers?.length ?? 0) > MAX_MCP_SERVERS) {
		throw new McpConfigurationError(
			`A session may configure at most ${MAX_MCP_SERVERS} MCP servers`,
		);
	}

	const normalized = (servers ?? []).map((server) => {
		if (!("type" in server)) return normalizeStdioServer(server, cwd);
		if (server.type === "http") return normalizeHttpServer(server);
		throw new McpConfigurationError(`Unsupported MCP transport "${server.type}"`);
	});

	const originalNames = new Set<string>();
	const stableNames = new Set<string>();
	for (const server of normalized) {
		if (originalNames.has(server.originalName)) {
			throw new McpConfigurationError(`Duplicate MCP server name: ${server.originalName}`);
		}
		if (stableNames.has(server.stableName)) {
			throw new McpConfigurationError(`Duplicate MCP server stable name: ${server.stableName}`);
		}
		originalNames.add(server.originalName);
		stableNames.add(server.stableName);
	}
	return normalized;
}
