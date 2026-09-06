// Fixed-size lobby queue — mirrors src/lib/server/matchmaking.ts's pattern,
// but gathers (size - 1) other participants instead of exactly one.
import { db } from '$lib/server/db';
import { lobbyQueue } from '$lib/server/schema';
import { eq, and, lt, ne, inArray } from 'drizzle-orm';

const QUEUE_TIMEOUT_MS = 60_000; // lobbies wait longer than 1v1 before going stale

/**
 * Tries to gather (size - 1) other queued users of the same size/contestType.
 * Returns their userIds if a full group was claimed, otherwise null (caller
 * should enqueue and keep waiting).
 */
export async function findLobbyGroup(
	userId: string,
	size: number,
	contestType: string
): Promise<string[] | null> {
	const cutoff = new Date(Date.now() - QUEUE_TIMEOUT_MS);
	await db.delete(lobbyQueue).where(lt(lobbyQueue.queuedAt, cutoff));

	const needed = size - 1;
	const candidates = await db
		.select()
		.from(lobbyQueue)
		.where(
			and(eq(lobbyQueue.size, size), eq(lobbyQueue.contestType, contestType), ne(lobbyQueue.userId, userId))
		)
		.limit(needed);

	if (candidates.length < needed) return null;

	const candidateIds = candidates.map((c) => c.userId);
	const deleted = await db
		.delete(lobbyQueue)
		.where(inArray(lobbyQueue.userId, candidateIds))
		.returning();

	if (deleted.length < needed) {
		// Lost a race for some candidates — put back whichever we did claim
		// so they're not stranded out of the queue, then report "not yet."
		if (deleted.length > 0) {
			await db
				.insert(lobbyQueue)
				.values(deleted.map((d) => ({ userId: d.userId, size, contestType, queuedAt: new Date() })))
				.onConflictDoNothing();
		}
		return null;
	}

	return deleted.map((d) => d.userId);
}

export async function enqueueLobby(userId: string, size: number, contestType: string) {
	await db
		.insert(lobbyQueue)
		.values({ userId, size, contestType, queuedAt: new Date() })
		.onConflictDoUpdate({
			target: lobbyQueue.userId,
			set: { size, contestType, queuedAt: new Date() }
		});
}

export async function dequeueLobby(userId: string) {
	await db.delete(lobbyQueue).where(eq(lobbyQueue.userId, userId));
}
