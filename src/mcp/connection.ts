import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpConnectionState } from "@pi-acp/mcp/stdio-connection";
import type { NormalizedMcpServer } from "@pi-acp/mcp/types";

export interface McpConnection {
	readonly client: Client;
	readonly server: NormalizedMcpServer;
	readonly state: McpConnectionState;
	readonly pid: number;
	close(): Promise<void>;
}
