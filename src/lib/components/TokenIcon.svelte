<script lang="ts">
	// Real token logos. SoSoValue is the app's price source but returns no logo
	// field on either /currencies or /market-snapshot (checked directly), so
	// icons come from the pinned `cryptocurrency-icons` package on jsDelivr,
	// keyed by lowercase symbol.
	//
	// Coverage is good but not total — the set doesn't include every long-tail
	// token in the draft pool. Anything missing falls back to the same letter
	// badge that was there before, so a missing icon degrades to the old
	// appearance rather than a broken-image glyph.
	let {
		symbol,
		size = 34,
		bg = 'var(--color-surface-alt)',
		fg = 'var(--color-text-muted)'
	}: { symbol: string | undefined; size?: number; bg?: string; fg?: string } = $props();

	const slug = $derived((symbol ?? '').trim().toLowerCase());
	const letter = $derived((symbol ?? '?').charAt(0).toUpperCase());

	// Reset on symbol change so a previously-failed icon doesn't suppress a
	// different token's working one when the node is reused.
	let failed = $state(false);
	$effect(() => {
		void slug;
		failed = false;
	});
</script>

{#if slug && !failed}
	<img
		src={`https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/32/color/${slug}.png`}
		alt=""
		width={size}
		height={size}
		loading="lazy"
		onerror={() => (failed = true)}
		class="shrink-0 rounded-full object-contain"
		style="width:{size}px;height:{size}px;background:{bg}"
	/>
{:else}
	<div
		class="grid shrink-0 place-items-center rounded-full font-black"
		style="width:{size}px;height:{size}px;background:{bg};color:{fg};font-size:{Math.round(size * 0.42)}px"
		aria-hidden="true"
	>
		{letter}
	</div>
{/if}
