import { createHash } from "node:crypto";
import type { NormalizedMcpServer } from "@pi-acp/mcp/types";

function sortedEntries(values: Readonly<Record<string, string>>): [string, string][] {
	return Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
}

export function fingerprintMcpServers(servers: readonly NormalizedMcpServer[]): string {
	const canonical = [...servers]
		.sort((left, right) => left.stableName.localeCompare(right.stableName))
		.map((server) =>
			server.kind === "stdio"
				? {
						kind: server.kind,
						originalName: server.originalName,
						stableName: server.stableName,
						command: server.command,
						args: server.args,
						env: sortedEntries(server.env),
						cwd: server.cwd,
					}
				: {
						kind: server.kind,
						originalName: server.originalName,
						stableName: server.stableName,
						url: server.url,
						headers: sortedEntries(server.headers),
					},
		);
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
