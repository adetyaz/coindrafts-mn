<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/toast';
	import { sectorTheme } from '$lib/sectorTheme';

	type OpenTournament = {
		id: string;
		name: string;
		contestType: string;
		payoutStructure: string;
		sectorRestriction: string | null;
		groupSize: number;
		status: string;
		createdBy: string;
		creatorName: string | null;
		participantCount: number;
	};

	type Group = {
		id: string;
		status: string;
		tournamentStage: number;
		size: number | null;
		winnerId: string | null;
		headcount: number;
	};

	type TournamentDetail = {
		id: string;
		name: string;
		contestType: string;
		accessType: string;
		payoutStructure: string;
		sectorRestriction: string | null;
		groupSize: number;
		status: string;
		createdBy: string;
		groups: Group[];
		myLobbyId: string | null;
	};

	const SECTORS = [
		{ id: '', label: 'No restriction' },
		{ id: 'l1', label: 'L1 only' },
		{ id: 'l2', label: 'L2 only' },
		{ id: 'defi', label: 'DeFi only' },
		{ id: 'meme', label: 'Meme only' },
		{ id: 'wildcard', label: 'Wildcard only' }
	];

	let view = $state<'menu' | 'create' | 'browse' | 'status'>('menu');
	let open = $state<OpenTournament[]>([]);
	let browseLoading = $state(false);
	let detail = $state<TournamentDetail | null>(null);
	let myUserId = $state('');
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	// Create form
	let name = $state('');
	let contestType = $state<'daily' | 'weekly'>('daily');
	let accessType = $state<'public' | 'private'>('public');
	let payoutStructure = $state<'winner_take_all' | 'top3_weighted'>('winner_take_all');
	let sectorRestriction = $state('');
	let groupSize = $state(4);
	let creating = $state(false);

	// Invite panel (organiser, private tournaments only)
	let inviteEmail = $state('');
	let sendingInvite = $state(false);
	let lastInvite = $state<{ joinUrl: string; emailStatus: string } | null>(null);

	onMount(() => {
		loadMe().then(() => {
			const p = new URLSearchParams(window.location.search);
			const inviteId = p.get('id');
			const inviteToken = p.get('invite');
			if (inviteId) {
				joinAndWatch(inviteId, inviteToken ?? undefined);
			}
		});
	});

	onDestroy(() => stopPolling());

	function stopPolling() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	async function loadMe() {
		const res = await fetch('/api/me');
		if (res.ok) myUserId = (await res.json()).id;
	}

	async function showBrowse() {
		view = 'browse';
		browseLoading = true;
		try {
			const res = await fetch('/api/tournaments?status=open');
			if (res.ok) open = await res.json();
		} finally {
			browseLoading = false;
		}
	}

	async function createTournament() {
		if (!name.trim()) {
			toast('Give your tournament a name', 'error');
			return;
		}
		creating = true;
		try {
			const res = await fetch('/api/tournaments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					contestType,
					accessType,
					payoutStructure,
					sectorRestriction: sectorRestriction || undefined,
					groupSize
				})
			});
			if (res.status === 401) {
				window.location.href = '/?auth=required';
				return;
			}
			if (!res.ok) throw new Error('Failed to create tournament');
			const t = await res.json();
			await joinAndWatch(t.id);
		} catch {
			toast('Failed to create tournament', 'error');
		} finally {
			creating = false;
		}
	}

	async function joinAndWatch(tournamentId: string, inviteToken?: string) {
		const res = await fetch(`/api/tournament/${tournamentId}/join`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(inviteToken ? { invite: inviteToken } : {})
		});
		if (res.status === 401) {
			window.location.href = '/?auth=required';
			return;
		}
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			const known = ['invite_required', 'invite_invalid'].includes(err.reason);
			toast(
				known
					? err.error
					: err.error === 'closed'
						? 'Registration for this tournament is closed'
						: 'Failed to join',
				'error'
			);
			if (known) view = 'menu';
			return;
		}
		if (!myUserId) await loadMe();
		watchTournament(tournamentId);
	}

	function watchTournament(tournamentId: string) {
		view = 'status';
		stopPolling();
		pollDetail(tournamentId);
		pollTimer = setInterval(() => pollDetail(tournamentId), 3000);
	}

	async function pollDetail(tournamentId: string) {
		const res = await fetch(`/api/tournament/${tournamentId}`);
		if (!res.ok) return;
		const d: TournamentDetail = await res.json();
		detail = d;

		if (d.myLobbyId) {
			const mine = d.groups.find((g) => g.id === d.myLobbyId);
			if (mine && mine.status !== 'waiting') {
				stopPolling();
				toast('Bracket underway — heading to draft!', 'success');
				goto(resolve(`/draft?lobbyId=${d.myLobbyId}`));
			}
		}
	}

	async function closeRegistration() {
		if (!detail) return;
		const res = await fetch(`/api/tournament/${detail.id}/close-registration`, { method: 'POST' });
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			toast(err.error ?? 'Failed to close registration', 'error');
			return;
		}
		toast('Registration closed — bracket starting', 'success');
	}

	async function sendInvite() {
		if (!detail) return;
		sendingInvite = true;
		try {
			const res = await fetch(`/api/tournament/${detail.id}/invite`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(inviteEmail.trim() ? { email: inviteEmail.trim() } : {})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast(data.error ?? 'Failed to create invite', 'error');
				return;
			}
			lastInvite = { joinUrl: data.joinUrl, emailStatus: data.emailStatus };
			inviteEmail = '';
			if (data.emailStatus === 'sent') toast('Invite emailed', 'success');
			else if (data.emailStatus === 'skipped')
				toast('Invite link created — copy and share it', 'success');
			else
				toast('Invite link created — email delivery unavailable, copy the link instead', 'success');
		} finally {
			sendingInvite = false;
		}
	}

	async function copyInviteLink() {
		if (!lastInvite) return;
		try {
			await navigator.clipboard.writeText(lastInvite.joinUrl);
			toast('Copied to clipboard', 'success');
		} catch {
			toast('Copy failed — select and copy the link manually', 'error');
		}
	}

	function backToMenu() {
		stopPolling();
		detail = null;
		lastInvite = null;
		inviteEmail = '';
		view = 'menu';
	}
</script>

<div class="mx-auto max-w-[900px] px-7 py-14">
	{#if view === 'menu'}
		<div
			class="mb-2.5 font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase"
		>
			Tournament
		</div>
		<h1 class="text-[40px] leading-none font-black tracking-[-0.04em]">Tournaments</h1>
		<p class="mt-2 text-sm text-text-muted">
			Free to play — winner-take-all or a top-3 XP split, brackets of qualifier groups feeding into
			a final. Public ones are open to anyone; private ones are invite-only. Sponsor-funded,
			real-money tournaments are coming once staking exists.
		</p>
		<div class="mt-6 flex flex-wrap gap-2.5">
			<button
				class="cursor-pointer rounded-full bg-primary px-6 py-3.5 text-sm font-extrabold text-text"
				onclick={() => (view = 'create')}
			>
				Create a tournament
			</button>
			<button
				class="cursor-pointer rounded-full border-[1.5px] border-text bg-transparent px-6 py-3.5 text-sm font-bold text-text"
				onclick={showBrowse}
			>
				Browse open tournaments
			</button>
		</div>
	{:else if view === 'create'}
		<button class="mb-4 cursor-pointer text-xs font-bold text-text-muted" onclick={backToMenu}
			>&larr; Back</button
		>
		<h1 class="text-[32px] leading-none font-black tracking-[-0.03em]">Create a tournament</h1>
		<div class="mt-6 flex flex-col gap-4 rounded-[20px] border border-border bg-surface p-6">
			<label class="flex flex-col gap-1.5 text-sm font-bold">
				Name
				<input
					bind:value={name}
					maxlength="80"
					placeholder="Friday Night Draft-Off"
					class="rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-normal"
				/>
			</label>
			<div class="flex flex-col gap-1.5 text-sm font-bold">
				Visibility
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => (accessType = 'public')}
						class="flex-1 cursor-pointer rounded-xl border px-3.5 py-2.5 text-left text-sm font-normal"
						style={accessType === 'public'
							? 'border-color:var(--color-primary);background:var(--color-primary-muted);color:var(--color-primary-ink)'
							: 'border-color:var(--color-border);background:var(--color-surface-alt);color:var(--color-text)'}
					>
						<span class="block font-bold">Public</span>
						<span class="text-xs font-normal opacity-80">Listed, anyone can join</span>
					</button>
					<button
						type="button"
						onclick={() => (accessType = 'private')}
						class="flex-1 cursor-pointer rounded-xl border px-3.5 py-2.5 text-left text-sm font-normal"
						style={accessType === 'private'
							? 'border-color:var(--color-primary);background:var(--color-primary-muted);color:var(--color-primary-ink)'
							: 'border-color:var(--color-border);background:var(--color-surface-alt);color:var(--color-text)'}
					>
						<span class="block font-bold">Private</span>
						<span class="text-xs font-normal opacity-80">Invite-only, unlisted</span>
					</button>
				</div>
			</div>
			<label class="flex flex-col gap-1.5 text-sm font-bold">
				Duration
				<select
					bind:value={contestType}
					class="rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-normal"
				>
					<option value="daily">Daily · 24h</option>
					<option value="weekly">Weekly · 7d, 2x XP</option>
				</select>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-bold">
				Payout structure (XP)
				<select
					bind:value={payoutStructure}
					class="rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-normal"
				>
					<option value="winner_take_all">Winner takes all</option>
					<option value="top3_weighted">Top-3 split (30 / 25 / 23)</option>
				</select>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-bold">
				Sector restriction
				<select
					bind:value={sectorRestriction}
					class="rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-normal"
				>
					{#each SECTORS as s (s.id)}
						<option value={s.id}>{s.label}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-bold">
				Players per qualifier group
				<input
					type="number"
					min="2"
					bind:value={groupSize}
					class="rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm font-normal"
				/>
			</label>
			<button
				disabled={creating}
				onclick={createTournament}
				class="mt-2 cursor-pointer rounded-full bg-primary px-6 py-3.5 text-sm font-extrabold text-text disabled:opacity-60"
			>
				{creating ? 'Creating…' : 'Create & join'}
			</button>
		</div>
	{:else if view === 'browse'}
		<button class="mb-4 cursor-pointer text-xs font-bold text-text-muted" onclick={backToMenu}
			>&larr; Back</button
		>
		<div class="flex flex-wrap items-baseline justify-between gap-3">
			<h1 class="text-[32px] leading-none font-black tracking-[-0.03em]">Open tournaments</h1>
			{#if open.length > 0}
				<span class="font-mono text-xs font-bold text-text-muted">{open.length} open</span>
			{/if}
		</div>

		{#if browseLoading}
			<div class="mt-4 flex flex-col gap-2.5">
				{#each [0, 1, 2] as i (i)}
					<div class="h-[86px] animate-pulse rounded-[20px] bg-surface-alt"></div>
				{/each}
			</div>
		{:else if open.length === 0}
			<div
				class="mt-4 flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-border-strong px-6 py-14 text-center"
			>
				<p class="text-sm text-text-muted">Nothing open right now.</p>
				<button
					class="cursor-pointer rounded-full bg-primary px-5 py-2.5 text-xs font-extrabold text-text"
					onclick={() => (view = 'create')}
				>
					Create one
				</button>
			</div>
		{:else}
			<div class="mt-4 flex flex-col gap-3">
				{#each open as t (t.id)}
					{@const sTheme = t.sectorRestriction ? sectorTheme(t.sectorRestriction) : null}
					<div
						class="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-border bg-surface p-5 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(26,36,33,0.08)]"
					>
						<div class="min-w-0 flex-1">
							<div class="truncate text-[17px] font-extrabold tracking-[-0.01em]">{t.name}</div>
							<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
								<span
									class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
									style="background:rgba(95,168,216,0.14);color:var(--color-blue-ink)"
								>
									{t.contestType === 'weekly' ? 'Weekly · 2× XP' : 'Daily'}
								</span>
								<span
									class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
									style="background:rgba(247,201,120,0.16);color:var(--color-warning-ink)"
								>
									{t.payoutStructure === 'winner_take_all' ? 'Winner takes all' : 'Top-3 split'}
								</span>
								{#if sTheme}
									<span
										class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
										style="background:color-mix(in srgb, {sTheme.color} 16%, transparent);color:{sTheme.ink}"
									>
										{sTheme.label} only
									</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-4">
							<div class="text-right">
								<div class="font-mono text-lg leading-none font-black tabular-nums">
									{t.participantCount}
								</div>
								<div class="mt-1 text-[10px] font-bold tracking-[0.08em] text-text-muted uppercase">
									joined
								</div>
							</div>
							<button
								class="cursor-pointer rounded-full bg-primary px-5 py-2.5 text-xs font-extrabold text-text transition hover:-translate-y-0.5"
								onclick={() => joinAndWatch(t.id)}
							>
								Join
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:else if view === 'status' && detail}
		<div class="mb-2.5 flex items-center gap-2">
			<span class="font-mono text-[11px] font-bold tracking-[0.14em] text-primary-ink uppercase">
				{detail.status === 'open'
					? 'Registration open'
					: detail.status === 'active'
						? 'Bracket underway'
						: 'Resolved'}
			</span>
			{#if detail.accessType === 'private'}
				<span
					class="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-text-muted uppercase"
					>Private</span
				>
			{/if}
		</div>
		<h1 class="text-[32px] leading-none font-black tracking-[-0.03em]">{detail.name}</h1>
		<p class="mt-2 text-sm text-text-muted">
			{detail.groups.filter((g) => g.tournamentStage === 0).length} qualifier group(s) &middot;
			{detail.groups.reduce((n, g) => n + g.headcount, 0)} player(s) joined so far
		</p>
		<div class="mt-5 flex flex-col gap-2.5">
			{#each detail.groups as g (g.id)}
				<div
					class="flex items-center justify-between rounded-[16px] border border-border bg-surface p-4"
				>
					<span class="text-sm font-bold">
						{g.tournamentStage === 1 ? 'Final' : 'Qualifier group'}
						{g.id === detail.myLobbyId ? ' (you)' : ''}
					</span>
					<span class="font-mono text-xs text-text-muted">
						{g.headcount}{g.size ? `/${g.size}` : ''} &middot; {g.status}
					</span>
				</div>
			{/each}
		</div>
		{#if detail.status === 'open' && detail.createdBy === myUserId}
			{#if detail.accessType === 'private'}
				<div class="mt-6 rounded-[20px] border border-border bg-surface p-5">
					<div class="text-sm font-extrabold">Invite players</div>
					<p class="mt-1 text-xs text-text-muted">
						Private tournaments aren't listed — this is the only way in. Each link works once.
					</p>
					<div class="mt-3.5 flex flex-wrap gap-2">
						<input
							type="email"
							bind:value={inviteEmail}
							placeholder="Email (optional — leave blank for a share link)"
							class="min-w-[220px] flex-1 rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm"
						/>
						<button
							disabled={sendingInvite}
							onclick={sendInvite}
							class="cursor-pointer rounded-full bg-primary px-5 py-2.5 text-xs font-extrabold text-text disabled:opacity-60"
						>
							{sendingInvite ? 'Creating…' : inviteEmail.trim() ? 'Send invite' : 'Create link'}
						</button>
					</div>
					{#if lastInvite}
						<div class="mt-3.5 flex items-center gap-2 rounded-xl bg-surface-alt px-3.5 py-2.5">
							<span class="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
								>{lastInvite.joinUrl}</span
							>
							<button
								class="shrink-0 cursor-pointer rounded-full bg-primary-muted px-3 py-1.5 text-[11px] font-bold text-primary-ink"
								onclick={copyInviteLink}
							>
								Copy
							</button>
						</div>
					{/if}
				</div>
			{/if}
			<button
				class="mt-6 cursor-pointer rounded-full bg-primary px-6 py-3.5 text-sm font-extrabold text-text"
				onclick={closeRegistration}
			>
				Close registration & start bracket
			</button>
			<p class="mt-2 text-xs text-text-muted">
				Groups with 2+ players start; anything smaller is dropped, no penalty.
			</p>
		{/if}
	{/if}
</div>

<Toast />
