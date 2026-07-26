import type { McpConnection } from "@pi-acp/mcp/connection";
import { fingerprintMcpServers } from "@pi-acp/mcp/fingerprint";
import { McpHttpConnection } from "@pi-acp/mcp/http-connection";
import {
	McpConnectionError,
	McpStdioConnection,
	type McpStdioConnectionOptions,
} from "@pi-acp/mcp/stdio-connection";
import type { NormalizedMcpServer } from "@pi-acp/mcp/types";

export type McpSessionManagerState = "starting" | "ready" | "closing" | "closed";

export type McpSessionManagerOptions = {
	connection?: McpStdioConnectionOptions;
};

export class McpSessionManager {
	readonly fingerprint: string;

	#state: McpSessionManagerState = "starting";
	#closePromise: Promise<void> | undefined;
	readonly #connections = new Map<string, McpConnection>();

	private constructor(servers: readonly NormalizedMcpServer[]) {
		this.fingerprint = fingerprintMcpServers(servers);
	}

	static async open(
		servers: readonly NormalizedMcpServer[],
		options: McpSessionManagerOptions = {},
	): Promise<McpSessionManager> {
		const manager = new McpSessionManager(servers);
		for (const server of servers) {
			try {
				const connection =
					server.kind === "stdio"
						? await McpStdioConnection.open(server, options.connection)
						: await McpHttpConnection.open(server);
				manager.#connections.set(server.stableName, connection);
			} catch (cause) {
				await manager.close();
				throw new McpConnectionError(
					`MCP session startup failed at server "${server.originalName}"`,
					{ cause },
				);
			}
		}
		manager.#state = "ready";
		return manager;
	}

	get state(): McpSessionManagerState {
		return this.#state;
	}

	get connections(): McpConnection[] {
		return [...this.#connections.values()];
	}

	get(stableName: string): McpConnection {
		const connection = this.#connections.get(stableName);
		if (connection === undefined) {
			throw new McpConnectionError(`Unknown MCP server: ${stableName}`);
		}
		return connection;
	}

	async close(): Promise<void> {
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#state = "closing";
		this.#closePromise = Promise.allSettled(
			[...this.#connections.values()].map((connection) => connection.close()),
		).then(() => {
			this.#connections.clear();
			this.#state = "closed";
		});
		return this.#closePromise;
	}
}
