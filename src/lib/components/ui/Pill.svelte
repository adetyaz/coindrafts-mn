<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		active = false,
		onclick,
		accent,
		class: className = '',
		children
	}: {
		active?: boolean;
		onclick?: () => void;
		/** Optional override color for the active fill (defaults to brand coral). */
		accent?: string;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<button
	type="button"
	{onclick}
	class="cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition-all {className}"
	style={active
		? `background:${accent ?? 'var(--color-primary)'};border-color:${accent ?? 'var(--color-primary)'};color:var(--color-text)`
		: `background:transparent;border-color:var(--color-border);color:var(--color-text-muted)`}
>
	{@render children?.()}
</button>
