<script lang="ts">
	// Decision record, not a product screen — never linked from the nav.
	// Five interaction concepts for "pick one token per sector." Sample data
	// only; the chosen mechanic gets built for real on /draft.
	type SectorDef = { name: string; color: string; tokens: { t: string; p: string }[] };

	const SECTORS: SectorDef[] = [
		{
			name: 'L1',
			color: 'var(--color-sector-l1)',
			tokens: [
				{ t: 'SOL', p: '$182.40' },
				{ t: 'AVAX', p: '$28.10' },
				{ t: 'SUI', p: '$3.44' }
			]
		},
		{
			name: 'L2',
			color: 'var(--color-sector-l2)',
			tokens: [
				{ t: 'ARB', p: '$0.82' },
				{ t: 'OP', p: '$1.94' },
				{ t: 'ZK', p: '$0.11' }
			]
		},
		{
			name: 'DeFi',
			color: 'var(--color-sector-defi)',
			tokens: [
				{ t: 'UNI', p: '$9.85' },
				{ t: 'AAVE', p: '$142.60' },
				{ t: 'CRV', p: '$0.61' }
			]
		},
		{
			name: 'Meme',
			color: 'var(--color-sector-meme)',
			tokens: [
				{ t: 'DOGE', p: '$0.14' },
				{ t: 'PEPE', p: '$0.000009' },
				{ t: 'WIF', p: '$2.08' }
			]
		},
		{
			name: 'Wildcard',
			color: 'var(--color-sector-wildcard)',
			tokens: [
				{ t: 'LINK', p: '$13.20' },
				{ t: 'RNDR', p: '$5.61' },
				{ t: 'TAO', p: '$412.00' }
			]
		}
	];

	let reel = $state([0, 1, 0, 2, 1]);
	let flipped = $state([true, false, true, false, false]);
	let claimed = $state<(number | null)[]>([1, null, 0, null, 2]);
	let faders = $state([6, 3, 5, 2, 4]);

	const faderTotal = $derived(faders.reduce((a, b) => a + b * 25, 0));
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<div class="mb-6.5">
		<div
			class="mb-2.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase"
		>
			Design decision record &middot; not a product screen
		</div>
		<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">Five ways to draft</h1>
		<p class="mt-2 text-sm text-text-muted">
			Each one takes the same five-sector rule somewhere different. All are live — click them. Ship
			only the chosen mechanic; the rest of the app uses the sector-slot board on /draft.
		</p>
	</div>

	<div class="flex flex-col gap-5">
		<!-- A. Reel rack -->
		<div class="rounded-[24px] border border-border bg-surface p-7">
			<div class="mb-5 flex flex-wrap items-baseline gap-3.5">
				<span class="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-bold text-text"
					>A</span
				>
				<span class="text-xl font-black tracking-[-0.02em]">The reel rack</span>
				<span class="text-[13px] text-text-muted"
					>Five reels, one per sector. Spin until the pick you want lands in the window.</span
				>
			</div>
			<div class="grid grid-cols-5 gap-3.5 max-lg:grid-cols-2 max-sm:grid-cols-1">
				{#each SECTORS as s, i (s.name)}
					{@const n = s.tokens.length}
					{@const idx = reel[i] % n}
					{@const cur = s.tokens[idx]}
					<button
						type="button"
						onclick={() => (reel[i] = (reel[i] + 1) % n)}
						class="cursor-pointer overflow-hidden rounded-2xl border border-border bg-surface text-left"
					>
						<div
							class="py-2.5 text-center text-[10px] font-extrabold tracking-[0.12em] text-text uppercase"
							style="background:{s.color}"
						>
							{s.name}
						</div>
						<div class="p-2.5">
							<div class="py-1.5 text-center font-mono text-xs text-text-muted">
								{s.tokens[(idx + n - 1) % n].t}
							</div>
							<div
								class="flex flex-col items-center gap-1.5 rounded-xl p-4"
								style="background:var(--color-surface-alt);border:1px solid {s.color}55"
							>
								<div class="text-xl font-black tracking-[-0.02em]">{cur.t}</div>
								<div class="font-mono text-[11px] text-text-muted">{cur.p}</div>
							</div>
							<div class="py-1.5 text-center font-mono text-xs text-text-muted">
								{s.tokens[(idx + 1) % n].t}
							</div>
							<div
								class="mt-1 text-center font-mono text-[10px] tracking-[0.1em] text-text-muted uppercase"
							>
								Click to spin
							</div>
						</div>
					</button>
				{/each}
			</div>
		</div>

		<!-- B. The hand -->
		<div class="rounded-[24px] border border-border bg-surface p-7">
			<div class="mb-2 flex flex-wrap items-baseline gap-3.5">
				<span class="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-bold text-text"
					>B</span
				>
				<span class="text-xl font-black tracking-[-0.02em]">The hand</span>
				<span class="text-[13px] text-text-muted"
					>A fanned hand of five. Flip a card to commit that sector.</span
				>
			</div>
			<div class="flex flex-wrap items-center justify-center gap-2 py-5">
				{#each SECTORS as s, i (s.name)}
					{@const up = flipped[i]}
					{@const cur = s.tokens[0]}
					<button
						type="button"
						onclick={() => (flipped[i] = !up)}
						class="flex h-53 w-38 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl p-4 transition-transform hover:-translate-y-2.5"
						style="background:var(--color-surface);border:2px solid {up
							? s.color
							: 'var(--color-border-strong)'}"
					>
						{#if up}
							<span
								class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] uppercase"
								style="background:{s.color}24;color:{s.color}">{s.name}</span
							>
							<div class="text-2xl font-black tracking-[-0.02em]">{cur.t}</div>
							<div class="font-mono text-[11px] text-text-muted">{cur.p}</div>
						{:else}
							<span
								class="rounded-full bg-surface-alt px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] text-text-muted uppercase"
								>Closed</span
							>
							<div class="text-2xl font-black text-text-muted">?</div>
							<div class="font-mono text-[11px] text-text-muted">tap to reveal</div>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- C. The belt -->
		<div class="overflow-hidden rounded-[24px] border border-border bg-surface p-7">
			<div class="mb-5 flex flex-wrap items-baseline gap-3.5">
				<span class="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-bold text-text"
					>C</span
				>
				<span class="text-xl font-black tracking-[-0.02em]">The belt</span>
				<span class="text-[13px] text-text-muted"
					>The market runs past on a conveyor. Grab what you want before it leaves the window.</span
				>
			</div>
			<div class="mb-4.5 grid grid-cols-5 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
				{#each SECTORS as s, i (s.name)}
					{@const filled = i === 0 || i === 2}
					<div
						class="rounded-2xl border p-4 text-center"
						style="border-color:{filled ? s.color : 'var(--color-border-strong)'}"
					>
						<div
							class="text-[10px] font-extrabold tracking-[0.1em] uppercase"
							style="color:{s.color}"
						>
							{s.name}
						</div>
						<div
							class="mt-2.5 text-lg font-black"
							style={filled ? '' : 'color:var(--color-text-muted)'}
						>
							{filled ? s.tokens[0].t : 'waiting'}
						</div>
					</div>
				{/each}
			</div>
			<div class="anim-marquee flex w-max gap-3 border-y-2 border-dashed border-border py-4">
				{#each [...SECTORS, ...SECTORS] as s, repIdx (repIdx)}
					{#each s.tokens as t (t.t)}
						<div
							class="flex shrink-0 items-center gap-2.5 rounded-full border border-border bg-surface px-4 py-2.5"
						>
							<div class="h-6 w-6 rounded-full" style="background:{s.color}"></div>
							<span class="text-sm font-bold">{t.t}</span>
						</div>
					{/each}
				{/each}
			</div>
		</div>

		<!-- D. Claim board -->
		<div class="rounded-[24px] border border-border bg-surface p-7">
			<div class="mb-5 flex flex-wrap items-baseline gap-3.5">
				<span class="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-bold text-text"
					>D</span
				>
				<span class="text-xl font-black tracking-[-0.02em]">The claim board</span>
				<span class="text-[13px] text-text-muted"
					>Every token is a cell. Claim one cell per sector column.</span
				>
			</div>
			<div class="grid grid-cols-5 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
				{#each SECTORS as s, i (s.name)}
					<div>
						<div
							class="mb-3 text-center text-[10px] font-extrabold tracking-[0.1em] uppercase"
							style="color:{s.color}"
						>
							{s.name}
						</div>
						<div class="flex flex-col items-center gap-2">
							{#each s.tokens as tk, j (tk.t)}
								{@const on = claimed[i] === j}
								<button
									type="button"
									onclick={() => (claimed[i] = on ? null : j)}
									class="w-full cursor-pointer rounded-xl py-3 text-center text-sm font-black transition-transform hover:-translate-y-0.5"
									style={on
										? `background:${s.color};color:var(--color-ink)`
										: 'background:var(--color-surface-alt);color:var(--color-text-muted)'}
								>
									{tk.t}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- E. The desk -->
		<div class="rounded-[24px] border border-border bg-surface p-7">
			<div class="mb-5 flex flex-wrap items-baseline gap-3.5">
				<span class="rounded-full bg-primary px-2.5 py-1 font-mono text-xs font-bold text-text"
					>E</span
				>
				<span class="text-xl font-black tracking-[-0.02em]">The desk</span>
				<span class="text-[13px] text-text-muted"
					>Pick the token, then set how hard you back it. Conviction weights the sector's score.</span
				>
			</div>
			<div class="grid grid-cols-5 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
				{#each SECTORS as s, i (s.name)}
					{@const lvl = faders[i]}
					<div class="rounded-2xl border border-border p-4.5">
						<div class="mb-4 flex items-center gap-2.5">
							<div
								class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black text-text"
								style="background:{s.color}"
							>
								{s.tokens[0].t.charAt(0)}
							</div>
							<div class="min-w-0">
								<div class="truncate text-sm font-black">{s.tokens[0].t}</div>
								<div
									class="text-[10px] font-extrabold tracking-[0.08em] uppercase"
									style="color:{s.color}"
								>
									{s.name}
								</div>
							</div>
						</div>
						<div class="mb-3.5 flex flex-col-reverse gap-1">
							{#each Array(8) as _, j (j)}
								<button
									type="button"
									onclick={() => (faders[i] = j + 1)}
									class="h-3.5 cursor-pointer rounded"
									style="background:{j < lvl ? s.color : 'var(--color-surface-alt)'}"
									aria-label="Set conviction level {j + 1}"
								></button>
							{/each}
						</div>
						<span class="font-mono text-xl font-bold" style="color:{s.color}">{lvl * 25}</span>
						<span
							class="ml-1.5 text-[10px] font-extrabold tracking-[0.08em] text-text-muted uppercase"
							>Conviction</span
						>
					</div>
				{/each}
			</div>
			<div class="mt-4.5 font-mono text-xs text-text-muted">
				Total budget {faderTotal} / 500 &middot; click a bar to reweight
			</div>
		</div>
	</div>
</div>
