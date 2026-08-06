import { PiAcpAgent } from "@pi-acp/acp/agent";
import { describe, expect, test } from "vitest";
import { asAgentConn, FakeAgentSideConnection } from "../helpers/fakes";

describe("listSessions cursor validation", () => {
	test("invalid cursor throws invalidParams", async () => {
		const conn = new FakeAgentSideConnection();
		const agent = new PiAcpAgent(asAgentConn(conn));
		await expect(agent.listSessions({ cursor: "not-a-number" })).rejects.toThrow();
	});

	test("negative cursor throws invalidParams", async () => {
		const conn = new FakeAgentSideConnection();
		const agent = new PiAcpAgent(asAgentConn(conn));
		await expect(agent.listSessions({ cursor: "-5" })).rejects.toThrow();
	});
});
