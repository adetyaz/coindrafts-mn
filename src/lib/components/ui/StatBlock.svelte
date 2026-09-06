<script lang="ts">
	let {
		value,
		label,
		color = 'var(--color-text)',
		size = 'md'
	}: {
		value: string;
		label: string;
		color?: string;
		size?: 'sm' | 'md' | 'lg';
	} = $props();

	const sizeClass = $derived({ sm: 'text-[22px]', md: 'text-[26px]', lg: 'text-[38px]' }[size]);
</script>

<div>
	<div class="{sizeClass} font-mono leading-none font-bold tracking-tight" style="color:{color}">
		{value}
	</div>
	<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em] text-text-muted uppercase">{label}</div>
</div>
