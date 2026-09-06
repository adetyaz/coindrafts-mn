<script lang="ts">
	let {
		pct,
		color = 'var(--color-primary)',
		track = 'var(--color-surface-alt)',
		height = '8px',
		glow = true
	}: {
		pct: number;
		color?: string;
		track?: string;
		height?: string;
		glow?: boolean;
	} = $props();

	const clamped = $derived(Math.max(0, Math.min(100, pct)));
</script>

<div class="overflow-hidden rounded-full" style="height:{height};background:{track}">
	<div
		class="h-full rounded-full transition-[width] duration-500 ease-out"
		style="width:{clamped}%;background:{color};{glow ? `box-shadow:0 0 14px ${color}88` : ''}"
	></div>
</div>
