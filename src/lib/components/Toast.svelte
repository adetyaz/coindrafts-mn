<script lang="ts">
	import { toastState } from '$lib/toast';
</script>

<div class="fixed right-4 bottom-4 z-1000 flex flex-col gap-2">
	{#each $toastState as t (t.id)}
		<div
			class="animate-in fade-in slide-in-from-bottom-4 rounded-lg px-4 py-3 text-sm font-medium duration-300"
			class:bg-[#eeedfe]={t.type === 'info'}
			class:text-[#534ab7]={t.type === 'info'}
			class:bg-[#faece7]={t.type === 'error'}
			class:text-[#993c1d]={t.type === 'error'}
			class:bg-[#0f6e56]={t.type === 'success'}
			class:text-white={t.type === 'success'}
		>
			{t.message}
		</div>
	{/each}
</div>
