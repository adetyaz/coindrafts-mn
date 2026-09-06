<script lang="ts">
	import { sectorTheme } from '$lib/sectorTheme';

	let {
		sector,
		variant = 'fill',
		suffix = ''
	}: {
		sector: string;
		variant?: 'fill' | 'outline' | 'text';
		suffix?: string;
	} = $props();

	const theme = $derived(sectorTheme(sector));
</script>

{#if variant === 'text'}
	<span class="text-[11px] font-extrabold tracking-[0.08em] uppercase" style="color:{theme.ink}"
		>{theme.label}{suffix}</span
	>
{:else if variant === 'outline'}
	<span
		class="rounded-full border px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase"
		style="border-color:{theme.color};color:{theme.ink}">{theme.label}{suffix}</span
	>
{:else}
	<span
		class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase"
		style="background:{theme.color};color:var(--color-ink)">{theme.label}{suffix}</span
	>
{/if}
