import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { NormalizedStdioMcpServer } from "@pi-acp/mcp/types";

const DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000;
const DEFAULT_STDERR_LIMIT_BYTES = 64 * 1024;

export type McpConnectionState = "starting" | "ready" | "closing" | "closed" | "failed";

export type McpStdioConnectionOptions = {
	initializeTimeoutMs?: number;
	stderrLimitBytes?: number;
};

export class McpConnectionError extends Error {
	constructor(
		message: string,
		options?: {
			cause?: unknown;
		},
	) {
		super(message, options);
		this.name = "McpConnectionError";
	}
}

export class McpStdioConnection {
	readonly client: Client;
	readonly server: NormalizedStdioMcpServer;

	#state: McpConnectionState = "starting";
	#stderr = "";
	#closePromise: Promise<void> | undefined;
	readonly #stderrLimitBytes: number;
	readonly #transport: StdioClientTransport;

	private constructor(
		server: NormalizedStdioMcpServer,
		transport: StdioClientTransport,
		client: Client,
		stderrLimitBytes: number,
	) {
		this.server = server;
		this.#transport = transport;
		this.client = client;
		this.#stderrLimitBytes = stderrLimitBytes;
		transport.stderr?.on("data", (chunk: unknown) => {
			this.#appendStderr(chunk);
		});
	}

	static async open(
		server: NormalizedStdioMcpServer,
		options: McpStdioConnectionOptions = {},
	): Promise<McpStdioConnection> {
		const transport = new StdioClientTransport({
			command: server.command,
			args: server.args,
			env: { ...getDefaultEnvironment(), ...server.env },
			cwd: server.cwd,
			stderr: "pipe",
		});
		const client = new Client({ name: "pi-acp", version: "0.5.0" });
		const connection = new McpStdioConnection(
			server,
			transport,
			client,
			options.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT_BYTES,
		);

		try {
			await client.connect(transport, {
				timeout: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
			});
			connection.#state = "ready";
			return connection;
		} catch (cause) {
			connection.#state = "failed";
			await connection.close();
			throw new McpConnectionError(
				`MCP server "${server.originalName}" failed to initialize${connection.#stderrSuffix()}`,
				{ cause },
			);
		}
	}

	get state(): McpConnectionState {
		return this.#state;
	}

	get pid(): number {
		return this.#transport.pid ?? 0;
	}

	get stderr(): string {
		return this.#stderr;
	}

	async close(): Promise<void> {
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#state = "closing";
		this.#closePromise = this.client.close().finally(() => {
			this.#state = "closed";
		});
		return this.#closePromise;
	}

	#appendStderr(chunk: unknown): void {
		let text: string;
		if (typeof chunk === "string") {
			text = chunk;
		} else if (chunk instanceof Uint8Array) {
			text = Buffer.from(chunk).toString("utf8");
		} else {
			return;
		}
		this.#stderr = `${this.#stderr}${text}`.slice(-this.#stderrLimitBytes);
	}

	#stderrSuffix(): string {
		const diagnostic = this.#stderr.trim();
		return diagnostic.length === 0 ? "" : `: ${diagnostic}`;
	}
}
