<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/toast';
	import { resolve } from '$app/paths';

	type OpenLobby = {
		id: string;
		contestType: string;
		size: number | null;
		status: string;
		createdBy: string;
		creatorName: string | null;
		headcount: number;
	};

	type View = 'menu' | 'quick-searching' | 'browse' | 'waiting-room';

	let view = $state<View>('menu');
	let quickSize = $state(4);
	let openLobbies = $state<OpenLobby[]>([]);
	let waitingLobbyId = $state('');
	let waitingHeadcount = $state(1);
	let waitingSize = $state<number | null>(null);
	let isCreator = $state(false);
	let elapsed = $state(0);
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let searchStart = 0;

	const elapsedStr = $derived.by(() => {
		const s = Math.floor(elapsed / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function startQuickMatch(size: number) {
		quickSize = size;
		view = 'quick-searching';
		searchStart = Date.now();
		elapsed = 0;

		const res = await fetch('/api/lobby/queue/join', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ size, type: 'daily' })
		});
		if (res.status === 401) {
			window.location.href = '/?auth=required';
			return;
		}
		const data = await res.json();
		if (data.status === 'matched') {
			toast('Lobby filled — heading to draft!', 'success');
			goto(resolve(`/draft?lobbyId=${data.lobbyId}`));
			return;
		}

		pollTimer = setInterval(async () => {
			elapsed = Date.now() - searchStart;
			const r = await fetch('/api/lobby/queue/status');
			const d = await r.json();
			if (d.status === 'matched') {
				stopPolling();
				toast('Lobby filled — heading to draft!', 'success');
				goto(resolve(`/draft?lobbyId=${d.lobbyId}`));
			}
		}, 3000);
	}

	async function cancelQuickMatch() {
		stopPolling();
		await fetch('/api/lobby/queue/leave', { method: 'POST' });
		view = 'menu';
	}

	async function loadOpenLobbies() {
		const res = await fetch('/api/lobby?status=waiting');
		if (res.ok) openLobbies = await res.json();
	}

	async function showBrowse() {
		view = 'browse';
		await loadOpenLobbies();
	}

	async function createOpenLobby() {
		const res = await fetch('/api/lobby', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contestType: 'daily' })
		});
		if (res.status === 401) {
			window.location.href = '/?auth=required';
			return;
		}
		const data = await res.json();
		isCreator = true;
		enterWaitingRoom(data.id, data.size);
	}

	async function joinOpenLobby(lobbyId: string, size: number | null) {
		const res = await fetch(`/api/lobby/${lobbyId}/join`, { method: 'POST' });
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			toast(err.error ?? 'Failed to join lobby', 'error');
			return;
		}
		isCreator = false;
		enterWaitingRoom(lobbyId, size);
	}

	function enterWaitingRoom(lobbyId: string, size: number | null) {
		waitingLobbyId = lobbyId;
		waitingSize = size;
		view = 'waiting-room';
		pollWaitingRoom();
		pollTimer = setInterval(pollWaitingRoom, 3000);
	}

	async function pollWaitingRoom() {
		const res = await fetch('/api/lobby?status=waiting');
		if (!res.ok) return;
		const list: OpenLobby[] = await res.json();
		const mine = list.find((l) => l.id === waitingLobbyId);
		if (mine) {
			waitingHeadcount = mine.headcount;
			return;
		}
		// No longer in the "waiting" list — either it started or errored out
		stopPolling();
		toast('Lobby started — heading to draft!', 'success');
		goto(resolve(`/draft?lobbyId=${waitingLobbyId}`));
	}

	async function startLobby() {
		const res = await fetch(`/api/lobby/${waitingLobbyId}/start`, { method: 'POST' });
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			toast(err.error ?? 'Failed to start lobby', 'error');
			return;
		}
	}

	function leaveWaitingRoom() {
		stopPolling();
		view = 'menu';
	}
</script>

<div class="mx-auto max-w-[1360px] px-7 pt-7 pb-18">
	<div class="mb-5 flex flex-wrap items-end justify-between gap-6">
		<div>
			<div
				class="mb-2.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase"
			>
				Multiplayer
			</div>
			<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">
				{#if view === 'menu'}Pick your lobby size{:else if view === 'quick-searching'}Building your
					room{:else if view === 'browse'}Open lobbies{:else}Waiting room{/if}
			</h1>
			<p class="mt-2 text-sm text-text-muted">
				Everyone drafts the same five sectors. You place against the whole room, not one opponent.
			</p>
		</div>
	</div>

	{#if view === 'menu'}
		<div class="flex flex-wrap gap-4.5">
			<div class="hero-coral dot-grid min-w-0 flex-[1_1_520px] rounded-[24px] p-[34px]">
				<div
					class="mb-5 w-fit rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
				>
					Quick match
				</div>
				<div class="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
					{#each [4, 6, 8] as size (size)}
						<button
							type="button"
							onclick={() => (quickSize = size)}
							class="cursor-pointer rounded-2xl p-4.5 text-left transition-transform"
							style={quickSize === size
								? 'background:var(--color-ink);color:var(--color-primary);border:1.5px solid var(--color-ink)'
								: 'background:rgba(26,36,33,0.06);color:var(--color-ink);border:1.5px solid rgba(26,36,33,0.18)'}
						>
							<div class="font-mono text-[34px] leading-none font-bold tracking-[-0.03em]">
								{size}
							</div>
							<div class="mt-2 text-[11px] font-extrabold tracking-[0.1em]">players</div>
						</button>
					{/each}
				</div>
				<button
					onclick={() => startQuickMatch(quickSize)}
					class="mt-6 cursor-pointer rounded-full bg-text px-9 py-4 text-base font-extrabold text-primary"
				>
					Find a {quickSize}-player lobby
				</button>
			</div>

			<div class="frost-panel min-w-0 flex-[1_1_280px] rounded-[20px] p-6">
				<h3 class="mb-2 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase">
					Open lobbies
				</h3>
				<p class="mb-4 text-xs text-text-muted">
					Create a lobby and invite friends, or join one that's still filling up.
				</p>
				<div class="flex flex-col gap-2.5">
					<button
						class="cursor-pointer rounded-full bg-primary py-3 text-sm font-extrabold text-text transition hover:bg-primary-hover"
						onclick={createOpenLobby}
					>
						Create lobby
					</button>
					<button
						class="cursor-pointer rounded-full border border-border bg-transparent py-3 text-sm font-bold text-text-muted transition hover:bg-hover"
						onclick={showBrowse}
					>
						Browse open lobbies
					</button>
				</div>
			</div>
		</div>
	{:else if view === 'quick-searching'}
		<div
			class="hero-coral dot-grid relative flex min-h-[440px] max-w-[720px] flex-col justify-between overflow-hidden rounded-[24px] p-11"
		>
			<div
				class="pointer-events-none absolute top-20 right-[-70px] flex h-80 w-80 items-center justify-center"
			>
				<div
					class="anim-pulse absolute h-52 w-52 rounded-full border-2 border-[rgba(26,36,33,0.28)]"
				></div>
				<div
					class="anim-pulse absolute h-52 w-52 rounded-full border-2 border-[rgba(26,36,33,0.28)]"
					style="animation-delay:0.85s"
				></div>
				<div class="font-mono text-[46px] font-bold tracking-[-0.04em]">{elapsedStr}</div>
			</div>
			<span
				class="relative flex w-fit items-center gap-2 rounded-full bg-text px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary uppercase"
			>
				<span class="anim-blink h-1.5 w-1.5 rounded-full bg-primary"></span>Filling
			</span>
			<div class="relative">
				<div class="text-[46px] leading-[0.94] font-black tracking-[-0.05em]">
					Filling a {quickSize}-player lobby
				</div>
				<p class="mt-3 text-[15px] opacity-80">Draft opens the moment the last seat fills.</p>
			</div>
			<button
				onclick={cancelQuickMatch}
				class="relative w-fit cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-[26px] py-3.5 text-sm font-bold text-text"
			>
				Cancel
			</button>
		</div>
	{:else if view === 'browse'}
		<div>
			<button
				class="mb-4 cursor-pointer text-xs font-bold text-primary-ink"
				onclick={() => (view = 'menu')}>&larr; Back</button
			>
			{#if openLobbies.length === 0}
				<div
					class="rounded-[20px] border border-dashed border-border-strong bg-surface py-14 text-center"
				>
					<p class="text-sm font-bold text-text-muted">No open lobbies right now</p>
					<button
						class="mt-3 cursor-pointer text-xs font-extrabold text-primary-ink underline"
						onclick={createOpenLobby}>Create one</button
					>
				</div>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5">
					{#each openLobbies as lobby (lobby.id)}
						{@const full = lobby.size != null && lobby.headcount >= lobby.size}
						<div
							class="rounded-[20px] border border-border bg-surface p-[22px] transition-transform hover:-translate-y-1"
						>
							<div class="mb-4 flex items-start justify-between gap-3">
								<div class="min-w-0">
									<div class="truncate text-[19px] font-black tracking-[-0.02em]">
										{lobby.creatorName ?? 'Player'}'s lobby
									</div>
									<div class="mt-1 font-mono text-[11px] text-text-muted">
										{lobby.contestType} contest
									</div>
								</div>
								<span
									class="shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.1em] uppercase"
									style="background:var(--color-primary-muted);color:var(--color-coral-ink)"
									>ranked</span
								>
							</div>
							<div class="mb-2.5 flex items-baseline gap-2">
								<span class="font-mono text-[26px] font-bold tracking-[-0.03em]"
									>{lobby.headcount}{lobby.size ? `/${lobby.size}` : ''}</span
								>
								<span class="font-mono text-xs font-bold text-text-muted">seats filled</span>
							</div>
							{#if lobby.size}
								<div class="mb-4 h-2 overflow-hidden rounded-full bg-surface-alt">
									<div
										class="h-full"
										style="width:{Math.round(
											(lobby.headcount / lobby.size) * 100
										)}%;background:{full ? 'var(--color-mint)' : 'var(--color-primary)'}"
									></div>
								</div>
							{/if}
							<button
								disabled={full}
								class="w-full cursor-pointer rounded-full py-2.5 text-xs font-extrabold {full
									? 'cursor-default bg-surface-alt text-text-muted'
									: 'bg-text text-bg'}"
								onclick={() => joinOpenLobby(lobby.id, lobby.size)}
							>
								{full ? 'Full' : 'Join room'}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if view === 'waiting-room'}
		<div class="flex max-w-[720px] flex-col gap-4.5">
			<div class="frost-panel rounded-[24px] p-7">
				<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
					<div>
						<div
							class="mb-2.5 text-[11px] font-extrabold tracking-[0.12em] text-text-muted uppercase"
						>
							Waiting room
						</div>
						<div class="flex items-baseline gap-2.5">
							<span class="font-mono text-[44px] leading-none font-bold tracking-[-0.04em]"
								>{waitingHeadcount}{waitingSize ? `/${waitingSize}` : ''}</span
							>
							<span class="text-[13px] font-bold text-text-muted">seats filled</span>
						</div>
					</div>
					<span
						class="flex items-center gap-2 rounded-full border border-border bg-surface-alt px-3.5 py-1.5 font-mono text-[11px] font-bold tracking-[0.12em] text-positive-ink uppercase"
					>
						<span class="anim-blink h-1.5 w-1.5 rounded-full bg-positive"></span>Live
					</span>
				</div>
				<div class="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
					{#each Array(waitingSize ?? Math.max(waitingHeadcount, 4)) as _, i (i)}
						{@const taken = i < waitingHeadcount}
						<div
							class="grid h-11 place-items-center rounded-xl text-sm font-black"
							style={taken
								? 'background:rgba(26,36,33,0.08);border:1.5px solid rgba(26,36,33,0.22)'
								: 'border:1.5px dashed var(--color-border-strong)'}
						>
							{taken ? '●' : ''}
						</div>
					{/each}
				</div>
			</div>

			<div
				class="hero-coral dot-grid flex flex-wrap items-center justify-between gap-5 rounded-[24px] p-7"
			>
				<div class="min-w-0">
					{#if isCreator}
						<div class="mb-2 text-[11px] font-extrabold tracking-[0.12em] uppercase opacity-75">
							You host this lobby
						</div>
						<div class="text-2xl font-black tracking-[-0.03em]">
							{waitingHeadcount < 2 ? 'Need at least 2 players' : `Start with ${waitingHeadcount}?`}
						</div>
					{:else}
						<div class="text-2xl font-black tracking-[-0.03em]">Waiting for the host to start…</div>
					{/if}
				</div>
				<div class="flex gap-2.5">
					{#if isCreator}
						<button
							onclick={startLobby}
							disabled={waitingHeadcount < 2}
							class="cursor-pointer rounded-full bg-text px-[26px] py-3.5 text-sm font-extrabold text-primary disabled:cursor-not-allowed disabled:opacity-40"
						>
							Start drafting
						</button>
					{/if}
					<button
						onclick={leaveWaitingRoom}
						class="cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-[26px] py-3.5 text-sm font-bold text-text"
					>
						Leave
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<Toast />
