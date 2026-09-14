import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		// The Midnight SDK (src/lib/midnightWallet.ts, src/lib/midnight/*) uses
		// WebAssembly (onchain-runtime) for ZK circuit execution and was built
		// for Node — these four plugins are what make it work in the browser.
		// See midnight-dapp-dev:core's vite-config reference.
		wasm(),
		topLevelAwait(),
		nodePolyfills({
			include: ['buffer', 'process', 'util', 'crypto', 'stream'],
			globals: { Buffer: true, process: true }
		}),
		viteCommonjs()
	],
	build: { target: 'esnext' },
	optimizeDeps: { exclude: ['@midnight-ntwrk/*'] }
});
