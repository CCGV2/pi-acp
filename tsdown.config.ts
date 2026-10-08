import { defineConfig } from "tsdown";

export default defineConfig({
	entry: "src/index.ts",
	format: "esm",
	platform: "node",
	target: "node24",
	sourcemap: true,
	clean: true,
	dts: false,
	// Pi must remain a native Node module graph belonging to the selected install.
	deps: { neverBundle: [/^@earendil-works\/pi-/] },
	banner: {
		js: "#!/usr/bin/env node",
	},
});
