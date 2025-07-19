import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					compatibilityFlags: ["nodejs_compat", "export_commonjs_default"],
					compatibilityDate: "2022-10-31",
				},
			},
		},
		globals: true,
	},
});
