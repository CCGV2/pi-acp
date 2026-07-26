export const MAX_MCP_SERVERS = 32;

export type NormalizedStdioMcpServer = {
	kind: "stdio";
	originalName: string;
	stableName: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
};

export type NormalizedHttpMcpServer = {
	kind: "http";
	originalName: string;
	stableName: string;
	url: string;
	headers: Record<string, string>;
};

export type NormalizedMcpServer = NormalizedStdioMcpServer | NormalizedHttpMcpServer;

export class McpConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpConfigurationError";
	}
}
