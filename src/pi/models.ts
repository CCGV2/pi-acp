import type { Api, Model } from "@earendil-works/pi-ai";
import * as z from "zod";

const modelSourceSchema = z.object({
	getAvailableSnapshot: z.custom<() => readonly Model<Api>[]>(
		(value) => typeof value === "function",
		"Incompatible Pi SDK: ModelRuntime requires getAvailableSnapshot",
	),
});
const legacyModelSourceSchema = z.object({
	getAvailable: z.custom<() => readonly Model<Api>[]>(
		(value) => typeof value === "function",
		"Incompatible Pi SDK: ModelRegistry requires getAvailable",
	),
});

// Pi 1.x replaced ModelRegistry with ModelRuntime. Read its refreshed snapshot
// without starting another model discovery or credential refresh operation.
export function getSessionModels(session: object): readonly Model<Api>[] {
	if ("modelRuntime" in session) {
		const source = modelSourceSchema.safeParse(session.modelRuntime);
		if (!source.success) throw source.error;
		return source.data.getAvailableSnapshot.call(session.modelRuntime);
	}
	if ("modelRegistry" in session) {
		const source = legacyModelSourceSchema.safeParse(session.modelRegistry);
		if (!source.success) throw source.error;
		return source.data.getAvailable.call(session.modelRegistry);
	}
	throw new Error("Incompatible Pi SDK: session has no supported model catalog");
}
