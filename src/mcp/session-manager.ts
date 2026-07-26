import { fingerprintMcpServers } from "@pi-acp/mcp/fingerprint";
import {
	McpConnectionError,
	McpStdioConnection,
	type McpStdioConnectionOptions,
} from "@pi-acp/mcp/stdio-connection";
import {
	McpConfigurationError,
	type NormalizedMcpServer,
	type NormalizedStdioMcpServer,
} from "@pi-acp/mcp/types";

export type McpSessionManagerState = "starting" | "ready" | "closing" | "closed";

export type McpSessionManagerOptions = {
	connection?: McpStdioConnectionOptions;
};

function isStdioServer(server: NormalizedMcpServer): server is NormalizedStdioMcpServer {
	return server.kind === "stdio";
}

export class McpSessionManager {
	readonly fingerprint: string;

	#state: McpSessionManagerState = "starting";
	#closePromise: Promise<void> | undefined;
	readonly #connections = new Map<string, McpStdioConnection>();

	private constructor(servers: readonly NormalizedMcpServer[]) {
		this.fingerprint = fingerprintMcpServers(servers);
	}

	static async open(
		servers: readonly NormalizedMcpServer[],
		options: McpSessionManagerOptions = {},
	): Promise<McpSessionManager> {
		const unsupported = servers.find((server) => server.kind !== "stdio");
		if (unsupported !== undefined) {
			throw new McpConfigurationError(`MCP transport "${unsupported.kind}" is not implemented`);
		}

		const manager = new McpSessionManager(servers);
		for (const server of servers.filter(isStdioServer)) {
			try {
				const connection = await McpStdioConnection.open(server, options.connection);
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

	get connections(): McpStdioConnection[] {
		return [...this.#connections.values()];
	}

	get(stableName: string): McpStdioConnection {
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
