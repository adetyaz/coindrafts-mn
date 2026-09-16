import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		// The Midnight SDK (src/lib/midnightWallet.ts, src/lib/midnight/*) uses
		// WebAssembly (onchain-runtime) for ZK circuit execution and was built
		// for Node — these plugins are what make it work in the browser. See
		// midnight-dapp-dev:core's vite-config reference.
		//
		// vite-plugin-top-level-await was dropped — it's fundamentally
		// incompatible with Vite 8's Rolldown build pipeline (its internal
		// @swc/core-based bundle post-processing throws `missing field "type"`,
		// a real AST-shape mismatch, not a missing-dependency issue). It's also
		// redundant here: `build.target: 'esnext'` below already means Vite
		// emits native top-level-await syntax directly, which is exactly what
		// this plugin exists to produce for targets that DON'T support it
		// natively. Removing it fixed the Vercel build; nothing here needed it.
		wasm(),
		// Client-build only. Applied unscoped, this shims global Buffer/process
		// inside the SSR/server bundle too — real Node already has both natively
		// there, and the shim breaks SvelteKit's own postbuild worker-thread step
		// (worker_threads' workerData came through empty — a real, reproduced
		// build failure, not a guess). The server should just use real Node.
		...nodePolyfills({
			include: ['buffer', 'process', 'util', 'crypto', 'stream'],
			globals: { Buffer: true, process: true }
		}).map((plugin) => ({ ...plugin, apply: (_config: unknown, env: { ssrBuild?: boolean }) => !env.ssrBuild })),
		viteCommonjs()
	],
	build: { target: 'esnext' },
	optimizeDeps: { exclude: ['@midnight-ntwrk/*'] }
});
