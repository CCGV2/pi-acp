import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpConnectionState } from "@pi-acp/mcp/stdio-connection";
import type { NormalizedHttpMcpServer } from "@pi-acp/mcp/types";

class HttpTransportBridge implements Transport {
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;

	constructor(private readonly transport: StreamableHTTPClientTransport) {}

	start(): Promise<void> {
		this.transport.onclose = () => this.onclose?.();
		this.transport.onerror = (error) => this.onerror?.(error);
		this.transport.onmessage = (message) => this.onmessage?.(message);
		return this.transport.start();
	}
	close(): Promise<void> {
		return this.transport.close();
	}
	send(message: JSONRPCMessage): Promise<void> {
		return this.transport.send(message);
	}
}

export class McpHttpConnection {
	readonly client: Client;
	readonly server: NormalizedHttpMcpServer;
	#state: McpConnectionState = "starting";
	#closePromise: Promise<void> | undefined;

	private constructor(server: NormalizedHttpMcpServer, client: Client) {
		this.server = server;
		this.client = client;
	}

	static async open(server: NormalizedHttpMcpServer): Promise<McpHttpConnection> {
		const client = new Client({ name: "pi-acp", version: "0.5.0" });
		const connection = new McpHttpConnection(server, client);
		const transport = new HttpTransportBridge(
			new StreamableHTTPClientTransport(new URL(server.url), {
				requestInit: { headers: server.headers },
			}),
		);
		try {
			await client.connect(transport);
			connection.#state = "ready";
			return connection;
		} catch (error) {
			connection.#state = "failed";
			await connection.close();
			throw error;
		}
	}

	get state(): McpConnectionState {
		return this.#state;
	}

	get pid(): number {
		return 0;
	}

	async close(): Promise<void> {
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#state = "closing";
		this.#closePromise = this.client.close().finally(() => {
			this.#state = "closed";
		});
		return this.#closePromise;
	}
}
