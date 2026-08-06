import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@pi-acp": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		fileParallelism: false,
		include: ["test/**/*.test.ts"],
	},
});
