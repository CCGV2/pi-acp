import { getSessionModels } from "@pi-acp/pi/models";
import { describe, expect, test } from "vitest";

describe("Pi model catalog compatibility", () => {
	test("uses the Pi 1.x snapshot and preserves receiver binding", () => {
		const models = [{ provider: "test", id: "model" }];
		const modelRuntime = {
			getAvailable() {
				throw new Error("Must use the synchronous snapshot");
			},
			models,
			getAvailableSnapshot() {
				return this.models;
			},
		};
		expect(getSessionModels({ modelRuntime })).toBe(models);
	});
	test("prefers the modern snapshot when both catalogs exist", () => {
		const models: never[] = [];
		expect(
			getSessionModels({
				modelRuntime: { getAvailableSnapshot: () => models },
				modelRegistry: {
					getAvailable() {
						throw new Error("Legacy catalog used");
					},
				},
			}),
		).toBe(models);
	});
	test("rejects sessions without a model catalog", () => {
		expect(() => getSessionModels({})).toThrow("no supported model catalog");
	});
	test("continues to read legacy model registries", () => {
		const models = [{ provider: "test", id: "legacy" }];
		expect(getSessionModels({ modelRegistry: { getAvailable: () => models } })).toBe(models);
	});
	test("rejects an incompatible modern runtime without falling back", () => {
		expect(() =>
			getSessionModels({ modelRuntime: {}, modelRegistry: { getAvailable: () => [] } }),
		).toThrow("getAvailableSnapshot");
	});
});
