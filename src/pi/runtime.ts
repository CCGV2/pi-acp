import { readFileSync, realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Pi from "@earendil-works/pi-coding-agent";
import * as z from "zod";

const SDK_NAME = "@earendil-works/pi-coding-agent";
const manifestSchema = z.object({
	name: z.literal(SDK_NAME),
	version: z
		.string()
		.trim()
		.regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/),
	main: z.string().trim().optional(),
	exports: z.json().optional(),
});

function hasMethods(value: unknown, methods: readonly string[]): boolean {
	if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
	return methods.every((method) => typeof Reflect.get(value, method) === "function");
}

// This is an ABI boundary: check the callable surface before assigning SDK types.
// Signatures and behavior must remain compatible with the adapter's Pi SDK API.
const sdkSchema = z.object({
	createAgentSession: z.custom<typeof Pi.createAgentSession>(
		(v) => typeof v === "function",
		"Incompatible Pi SDK: missing createAgentSession function",
	),
	defineTool: z.custom<typeof Pi.defineTool>(
		(v) => typeof v === "function",
		"Incompatible Pi SDK: missing defineTool function",
	),
	SessionManager: z.custom<typeof Pi.SessionManager>(
		(v) => typeof v === "function" && hasMethods(v, ["open", "list", "listAll", "forkFrom"]),
		"Incompatible Pi SDK: SessionManager requires open, list, listAll and forkFrom",
	),
	AgentSession: z.custom<typeof Pi.AgentSession>(
		(v) =>
			typeof v === "function" &&
			hasMethods(Reflect.get(v, "prototype"), [
				"prompt",
				"abort",
				"subscribe",
				"dispose",
				"setModel",
				"setThinkingLevel",
				"getAvailableThinkingLevels",
				"getContextUsage",
				"getSessionStats",
				"compact",
				"exportToHtml",
				"setSessionName",
				"setAutoCompactionEnabled",
				"setSteeringMode",
				"setFollowUpMode",
			]),
		"Incompatible Pi SDK: AgentSession is missing required methods",
	),
});

// Resolve the package's ESM export, honoring condition order. Never use its CLI.
function importTarget(value: z.infer<ReturnType<typeof z.json>>): string | undefined {
	if (typeof value === "string") return value;
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	for (const [condition, target] of Object.entries(value)) {
		if (["node", "import", "node-addons", "default"].includes(condition)) {
			const resolved = importTarget(target);
			if (resolved !== undefined) return resolved;
		}
	}
	return undefined;
}

export async function loadPiRuntime(configuredRoot: string | undefined) {
	const source = configuredRoot === undefined ? "adapter dependency" : "PI_ACP_SDK_ROOT";
	try {
		if (configuredRoot !== undefined && !isAbsolute(configuredRoot)) {
			throw new Error("PI_ACP_SDK_ROOT must be a non-empty absolute package directory path");
		}
		const manifestPath =
			configuredRoot === undefined
				? findPackageJSON(SDK_NAME, import.meta.url)
				: join(configuredRoot, "package.json");
		if (manifestPath === undefined) throw new Error(`Cannot locate ${SDK_NAME}/package.json`);
		const root = realpathSync(dirname(manifestPath));
		const manifest = manifestSchema.parse(
			JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
		);
		const exports = manifest.exports;
		const target =
			exports === undefined
				? (manifest.main ?? "./index.js")
				: importTarget(
						exports !== null &&
							typeof exports === "object" &&
							!Array.isArray(exports) &&
							"." in exports
							? exports["."]
							: exports,
					);
		if (target === undefined) throw new Error("SDK has no supported ESM entry export");
		const entry = realpathSync(join(root, target));
		const entryRelative = relative(root, entry);
		if (entryRelative.startsWith("..") || isAbsolute(entryRelative)) {
			throw new Error("SDK entry resolves outside its package directory");
		}
		// A file URL leaves the complete dependency graph to Node, relative to this
		// installation. No runtime Pi imports may bypass this boundary.
		const module: unknown = await import(pathToFileURL(entry).href);
		const sdk = sdkSchema.parse(module);
		return { sdk, root, entry, source, info: { name: "pi", version: manifest.version } };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to load Pi SDK from ${source}${configuredRoot === undefined ? "" : ` (${JSON.stringify(configuredRoot)})`}: ${message}. No SDK fallback was attempted.`,
			{ cause: error },
		);
	}
}
