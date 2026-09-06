<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/images/logo_v4_appicon.svg';
	import Ticker from '$lib/components/ui/Ticker.svelte';
	import Nav from '$lib/components/Nav.svelte';

	let { children, data } = $props();
	let tickerItems = $state<string[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/api/tokens');
			if (res.ok) {
				const tokens: { symbol?: string; change24h: number | null }[] = await res.json();
				tickerItems = tokens
					.filter((t) => t.change24h != null)
					.slice(0, 14)
					.map(
						(t) =>
							`${(t.symbol ?? '').toUpperCase()} ${t.change24h! >= 0 ? '+' : ''}${t.change24h!.toFixed(1)}%`
					);
			}
		} catch {
			// Ticker is decorative — a failed fetch just leaves it empty.
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="min-h-screen bg-bg text-text">
	<Nav user={data.user} />

	{#if tickerItems.length > 0}
		<Ticker items={tickerItems} />
	{/if}

	<main>
		{@render children()}
	</main>
</div>
