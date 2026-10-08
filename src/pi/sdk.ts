import { loadPiRuntime } from "@pi-acp/pi/runtime";

export const piRuntime = await loadPiRuntime(process.env.PI_ACP_SDK_ROOT);
export const { createAgentSession, SessionManager, defineTool } = piRuntime.sdk;

process.stderr.write(
	`pi-acp: Pi SDK ${piRuntime.info.version} from ${piRuntime.source}: ${piRuntime.entry}\n`,
);
