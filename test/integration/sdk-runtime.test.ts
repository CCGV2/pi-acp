import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadPiRuntime } from "@pi-acp/pi/runtime";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as z from "zod";
import adapter from "../../package.json" with { type: "json" };

const sdkName = "@earendil-works/pi-coding-agent";
const responseSchema = z.object({
	id: z.number(),
	result: z.unknown().optional(),
	error: z.unknown().optional(),
});
let temp: string;
let external: string;

async function packageAt(
	root: string,
	name: string,
	code: string,
	extra: Record<string, unknown> = {},
) {
	await mkdir(root, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name,
			version: "9.8.7",
			type: "module",
			exports: { ".": { import: "./entry.js" } },
			...extra,
		}),
	);
	await writeFile(join(root, "entry.js"), code);
	return root;
}

const fixture = `
import { marker } from '@earendil-works/pi-agent-core';
console.log('external SDK import log');
export async function createAgentSession() { throw new Error('external createAgentSession: ' + marker); }
export function defineTool(tool) { return { ...tool, description: marker }; }
export class SessionManager {
 static open() {} static forkFrom() {}
 static async list() { return [{ id: marker, path: '/fixture/session', cwd: '/fixture', name: marker, modified: new Date(0) }]; }
 static listAll() { return this.list(); }
}
export class AgentSession {
 prompt() {} abort() {} subscribe() {} dispose() {} setModel() {} setThinkingLevel() {}
 getAvailableThinkingLevels() {} getContextUsage() {} getSessionStats() {} compact() {}
 exportToHtml() {} setSessionName() {} setAutoCompactionEnabled() {} setSteeringMode() {} setFollowUpMode() {}
}
`;

beforeAll(async () => {
	execFileSync("npm", ["run", "build"], { cwd: resolve("."), stdio: "pipe" });
	temp = await mkdtemp(join(tmpdir(), "pi-acp-sdk-"));
	external = await packageAt(
		join(temp, "separate install", "node_modules", sdkName),
		sdkName,
		fixture,
	);
	const core = join(dirname(external), "pi-agent-core");
	await packageAt(
		core,
		"@earendil-works/pi-agent-core",
		`import { marker as ai } from '@earendil-works/pi-ai'; export const marker = 'external-core/' + ai;`,
	);
	await packageAt(
		join(dirname(external), "pi-ai"),
		"@earendil-works/pi-ai",
		`export const marker = 'external-ai';`,
	);
}, 30_000);

afterAll(async () => {
	if (temp !== undefined) await rm(temp, { recursive: true, force: true });
});

function run(
	root: string | undefined,
	method = "initialize",
	params: unknown = { protocolVersion: 1, clientCapabilities: {} },
	source = false,
) {
	const env = { ...process.env };
	Reflect.deleteProperty(env, "PI_ACP_SDK_ROOT");
	if (root !== undefined) env.PI_ACP_SDK_ROOT = root;
	return new Promise<{ code: number | null; stdout: string; stderr: string }>(
		(resolveResult, reject) => {
			const child = spawn(
				process.execPath,
				source ? ["--import", "tsx", "src/index.ts"] : ["dist/index.mjs"],
				{ env, stdio: "pipe" },
			);
			let stdout = "";
			let stderr = "";
			const timeout = setTimeout(() => {
				child.kill("SIGKILL");
				reject(new Error(`ACP timed out: ${stderr}`));
			}, 15_000);
			child.on("error", reject);
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
				if (stdout.includes("\n")) child.stdin.end();
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on("close", (code) => {
				clearTimeout(timeout);
				resolveResult({ code, stdout, stderr });
			});
			child.stdin.on("error", () => {});
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`);
		},
	);
}

function result(stdout: string) {
	return responseSchema.parse(JSON.parse(stdout.trim())).result;
}

describe("SDK runtime selection (built ACP process)", { timeout: 20_000 }, () => {
	test.each([
		"default",
		"explicit",
	])("%s real SDK reports its installed version and retains the adapter version", async (mode) => {
		const manifestPath = findPackageJSON(sdkName, import.meta.url);
		if (manifestPath === undefined) throw new Error("Missing installed SDK");
		const manifest = z
			.object({ version: z.string().trim() })
			.parse(JSON.parse(await readFile(manifestPath, "utf8")));
		const output = await run(mode === "default" ? undefined : dirname(manifestPath));
		expect(output.code).toBe(0);
		expect(result(output.stdout)).toMatchObject({
			agentInfo: { version: adapter.version },
			_meta: { pax: { runtime: { name: "pi", version: manifest.version } } },
		});
		expect(output.stderr).toContain(mode === "default" ? "adapter dependency" : "PI_ACP_SDK_ROOT");
	});

	test.each([
		false,
		true,
	])("external SDK controls the handshake, including source mode %s", async (source) => {
		const output = await run(external, undefined, undefined, source);
		expect(output.code).toBe(0);
		expect(result(output.stdout)).toMatchObject({
			agentInfo: { version: adapter.version },
			_meta: { pax: { runtime: { name: "pi", version: "9.8.7" } } },
		});
		expect(output.stderr).toContain("external SDK import log");
		expect(output.stderr).toContain(join(external, "entry.js"));
	});

	test("session operations use external SDK and its transitive Pi dependencies", async () => {
		const listed = await run(external, "session/list", {});
		expect(listed.code).toBe(0);
		expect(result(listed.stdout)).toMatchObject({
			sessions: [{ sessionId: "external-core/external-ai" }],
		});
		const created = await run(external, "session/new", { cwd: temp, mcpServers: [] });
		expect(created.stdout).toContain("external createAgentSession: external-core/external-ai");
	});

	test("MCP defineTool also comes from the external SDK", async () => {
		const runtime = await loadPiRuntime(external);
		const tool = runtime.sdk.defineTool({
			name: "probe",
			label: "probe",
			description: "original",
			parameters: {},
			execute: async () => ({ content: [], details: {} }),
		});
		expect(tool.description).toBe("external-core/external-ai");
	});

	test("resolves symlinked installations to their real package directory", async () => {
		const link = join(temp, "linked-sdk");
		await symlink(external, link, "dir");
		const output = await run(link);
		expect(output.code).toBe(0);
		expect(output.stderr).toContain(join(external, "entry.js"));
	});

	test.each([
		"",
		"relative/path",
		"/does-not-exist/pi-acp-sdk",
	])("rejects invalid root %j without fallback", async (root) => {
		const output = await run(root);
		expect(output.code).toBe(1);
		expect(output.stdout).toBe("");
		expect(output.stderr).toContain("PI_ACP_SDK_ROOT");
		expect(output.stderr).toContain("No SDK fallback was attempted");
	});

	test.each([
		["wrong-name", "export {}", { name: "wrong-package" }],
		["missing-api", "export {}", {}],
		["missing-session-methods", fixture.replace("abort() {}", ""), {}],
		["import-error", "throw new Error('broken SDK dependency')", {}],
		["missing-entry", "export {}", { exports: "./missing.js" }],
	])("rejects incompatible SDK %s without fallback", async (name, code, extra) => {
		const root = await packageAt(join(temp, name), sdkName, code, extra);
		// Reuse the isolated fixture dependencies when testing API validation.
		await symlink(
			join(temp, "separate install", "node_modules"),
			join(root, "node_modules"),
			"dir",
		);
		const output = await run(root);
		expect(output.code).toBe(1);
		expect(output.stdout).toBe("");
		expect(output.stderr).toContain("No SDK fallback was attempted");
		if (name === "missing-session-methods")
			expect(output.stderr).toContain("AgentSession is missing required methods");
	});
});
