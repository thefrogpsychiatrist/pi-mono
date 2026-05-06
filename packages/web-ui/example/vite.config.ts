import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: {
			"@mariozechner/pi-agent-core": path.resolve(repoRoot, "packages/agent/src/index.ts"),
			"@mariozechner/pi-ai": path.resolve(repoRoot, "packages/ai/src/index.ts"),
			"@mariozechner/pi-web-ui": path.resolve(repoRoot, "packages/web-ui/src/index.ts"),
		},
	},
	server: {
		fs: {
			allow: [repoRoot],
		},
	},
});
