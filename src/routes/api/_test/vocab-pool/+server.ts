// TEMPORARY — manual test trigger for the vocab pool batch generation + 0G
// Storage push, now that the SDK is installed. Deleted right after use.
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { vocabPool, vocabPoolBatches } from '$lib/server/schema';
import { ensureVocabPool } from '$lib/server/gauntlet';

export async function GET() {
	await ensureVocabPool();
	const pool = await db.select().from(vocabPool);
	const batches = await db.select().from(vocabPoolBatches);
	return json({ poolCount: pool.length, terms: pool.map((p) => p.term), batches });
}
