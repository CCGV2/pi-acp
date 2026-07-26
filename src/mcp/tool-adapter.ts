import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent as PiImageContent, TextContent } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type CallToolResult, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpSessionManager } from "@pi-acp/mcp/session-manager";
import type { McpStdioConnection } from "@pi-acp/mcp/stdio-connection";
import { Unsafe } from "typebox";

type PiToolContent = TextContent | PiImageContent;

export type McpToolDetails = {
	serverName: string;
	toolName: string;
	structuredContent?: Record<string, unknown>;
};

export class McpToolExecutionError extends Error {
	readonly serverName: string;
	readonly toolName: string;

	constructor(serverName: string, toolName: string, message: string) {
		super(message);
		this.name = "McpToolExecutionError";
		this.serverName = serverName;
		this.toolName = toolName;
	}
}

function sanitizeToolNamePart(value: string): string {
	return value.replaceAll(/[^A-Za-z0-9_]/g, "_");
}

export function mcpToolName(serverName: string, toolName: string): string {
	return `mcp__${sanitizeToolNamePart(serverName)}__${sanitizeToolNamePart(toolName)}`;
}

export function validateUniqueMcpToolNames(
	tools: readonly { serverName: string; toolName: string }[],
): void {
	const names = new Set<string>();
	for (const tool of tools) {
		const name = mcpToolName(tool.serverName, tool.toolName);
		if (names.has(name)) {
			throw new McpToolExecutionError(
				tool.serverName,
				tool.toolName,
				`MCP tool name collision after sanitization: ${name}`,
			);
		}
		names.add(name);
	}
}

export function mcpResultToPiContent(result: CallToolResult): PiToolContent[] {
	const content: PiToolContent[] = [];
	for (const block of result.content) {
		switch (block.type) {
			case "text":
				content.push({ type: "text", text: block.text });
				break;
			case "image":
				content.push({ type: "image", data: block.data, mimeType: block.mimeType });
				break;
			case "audio":
				content.push({ type: "text", text: `[MCP audio: ${block.mimeType}]` });
				break;
			case "resource_link":
				content.push({
					type: "text",
					text: `[MCP resource link: ${block.name}](${block.uri})`,
				});
				break;
			case "resource":
				content.push({
					type: "text",
					text:
						"text" in block.resource
							? `[MCP resource: ${block.resource.uri}]\n${block.resource.text}`
							: `[MCP binary resource: ${block.resource.uri}${
									block.resource.mimeType === undefined ? "" : ` (${block.resource.mimeType})`
								}]`,
				});
				break;
		}
	}
	if (result.structuredContent !== undefined) {
		content.push({
			type: "text",
			text: `[MCP structured content]\n${JSON.stringify(result.structuredContent)}`,
		});
	}
	return content;
}

function errorMessage(content: readonly PiToolContent[]): string {
	const text = content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
	return text.length === 0 ? "MCP tool returned an error" : text;
}

export async function invokeMcpTool(
	connection: McpStdioConnection,
	toolName: string,
	arguments_: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<AgentToolResult<McpToolDetails>> {
	const rawResult = await connection.client.callTool(
		{ name: toolName, arguments: arguments_ },
		CallToolResultSchema,
		signal === undefined ? undefined : { signal },
	);
	const result = CallToolResultSchema.parse(rawResult);
	const content = mcpResultToPiContent(result);
	if (result.isError === true) {
		throw new McpToolExecutionError(
			connection.server.originalName,
			toolName,
			errorMessage(content),
		);
	}
	return {
		content,
		details: {
			serverName: connection.server.originalName,
			toolName,
			...(result.structuredContent === undefined
				? {}
				: { structuredContent: result.structuredContent }),
		},
	};
}

export async function buildMcpTools(manager: McpSessionManager): Promise<ToolDefinition[]> {
	const discovered = await Promise.all(
		manager.connections.map(async (connection) => ({
			connection,
			tools: (await connection.client.listTools()).tools,
		})),
	);
	validateUniqueMcpToolNames(
		discovered.flatMap(({ connection, tools }) =>
			tools.map((tool) => ({
				serverName: connection.server.stableName,
				toolName: tool.name,
			})),
		),
	);

	return discovered.flatMap(({ connection, tools }) =>
		tools.map((tool) =>
			defineTool({
				name: mcpToolName(connection.server.stableName, tool.name),
				label: `${connection.server.originalName} / ${tool.name}`,
				description: tool.description ?? `MCP tool ${tool.name}`,
				parameters: Unsafe<Record<string, unknown>>(tool.inputSchema),
				execute: async (_toolCallId, params, signal) =>
					invokeMcpTool(connection, tool.name, params, signal),
			}),
		),
	);
}
