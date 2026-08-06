import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	mcpResultToPiContent,
	mcpToolName,
	validateUniqueMcpToolNames,
} from "@pi-acp/mcp/tool-adapter";
import { describe, expect, test } from "vitest";

describe("MCP tool naming", () => {
	test("creates provider-safe deterministic names", () => {
		expect(mcpToolName("My Server", "find-files.v2")).toBe("mcp__My_Server__find_files_v2");
	});

	test("rejects collisions created by sanitization", () => {
		expect(() =>
			validateUniqueMcpToolNames([
				{ serverName: "one", toolName: "a-b" },
				{ serverName: "one", toolName: "a_b" },
			]),
		).toThrow("collision");
	});
});

describe("MCP result conversion", () => {
	test("preserves text and image blocks", () => {
		const result: CallToolResult = {
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
			],
		};

		expect(mcpResultToPiContent(result)).toEqual([
			{ type: "text", text: "hello" },
			{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
		]);
	});

	test("renders resources, links, audio, and structured-only results without dropping them", () => {
		const result: CallToolResult = {
			content: [
				{
					type: "resource",
					resource: { uri: "file:///note.txt", text: "note body", mimeType: "text/plain" },
				},
				{
					type: "resource_link",
					uri: "https://example.com/item",
					name: "item",
				},
				{ type: "audio", data: "ignored", mimeType: "audio/wav" },
			],
			structuredContent: { count: 2 },
		};

		expect(mcpResultToPiContent(result)).toEqual([
			{ type: "text", text: "[MCP resource: file:///note.txt]\nnote body" },
			{ type: "text", text: "[MCP resource link: item](https://example.com/item)" },
			{ type: "text", text: "[MCP audio: audio/wav]" },
			{ type: "text", text: '[MCP structured content]\n{"count":2}' },
		]);
	});
});
