import { getNews } from '$lib/server/sosovalue';
import { classifySector } from '$lib/sectors';
import { json } from '@sveltejs/kit';

type RawNewsItem = {
	id: string;
	sourceLink?: string;
	releaseTime?: number;
	author?: string;
	matchedCurrencies?: Array<{ id: string; name?: string }>;
	tags?: string[];
	multilanguageContent?: Array<{ language: string; title: string; content: string }>;
};

// Industry-standard news categories — Markets/DeFi/Regulation/NFTs/Security/
// Business/General is what real crypto news sites (CoinDesk, The Block,
// Decrypt) actually use, not this app's L1/L2/DeFi/Meme/Wildcard draft-sector
// taxonomy, which was being reused here for lack of anything better and
// didn't mean anything as a news filter (found live: "Wildcard" isn't a
// topic). SoSoValue's own `category` field turned out useless — sampled 50
// articles, every single one came back the same value — so this is a
// keyword classifier over the real title/content/tags instead.
export type NewsCategory = 'regulation' | 'security' | 'defi' | 'nfts' | 'markets' | 'business' | 'general';

const CATEGORY_KEYWORDS: Record<Exclude<NewsCategory, 'general'>, string[]> = {
	regulation: ['sec ', 'regulat', 'lawsuit', 'congress', 'senate', 'court', 'legal', 'compliance', 'cftc', 'doj', 'subpoena', 'ban ', 'policy'],
	security: ['hack', 'exploit', 'breach', 'scam', 'phishing', 'stolen', 'drain', 'vulnerability', 'rug pull', 'attacker'],
	defi: ['defi', 'liquidity', 'lending', 'borrow', 'yield', ' amm', ' dex', 'staking', 'protocol', 'tvl'],
	nfts: ['nft', 'collectible', 'opensea'],
	markets: ['price', 'rally', 'surge', 'plunge', ' etf', 'trading', 'whale', 'bull', 'bear', 'market cap', 'volume'],
	business: ['funding', 'raise', 'raised', 'partnership', 'acquisition', 'ipo', 'valuation', 'invest', 'launch']
};

function classifyNewsCategory(title: string, content: string, tags: string[]): NewsCategory {
	const haystack = ` ${title} ${content} ${tags.join(' ')} `.toLowerCase();
	for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [Exclude<NewsCategory, 'general'>, string[]][]) {
		if (keywords.some((k) => haystack.includes(k))) return category;
	}
	return 'general';
}

export async function GET() {
	try {
		const data = (await getNews()) as { list?: RawNewsItem[] };
		const list = Array.isArray(data?.list) ? data.list : [];

		const items = list
			.map((item) => {
				const en = item.multilanguageContent?.find((c) => c.language === 'en');
				const symbols = (item.matchedCurrencies ?? []).map((c) => c.name ?? '').filter(Boolean);
				const title = en?.title ?? '';
				const content = en?.content ?? '';
				const tags = item.tags ?? [];
				return {
					id: item.id,
					title,
					content,
					source: item.author ?? 'SoSoValue',
					date: item.releaseTime ? new Date(item.releaseTime).toISOString() : null,
					url: item.sourceLink ?? null,
					symbols,
					// Reader-facing topic — what the filter UI shows and filters by.
					category: classifyNewsCategory(title, content, tags),
					// Draft-sector mapping — NOT shown to the reader, kept only because
					// the "read an article, earn a sector boost" mechanic needs to know
					// which of the game's 5 draft sectors to credit.
					sector: classifySector(symbols)
				};
			})
			// SoSoValue's feed is general market/macro news, not crypto-only —
			// an item with no matched currencies at all (found live: general
			// politics with zero crypto relevance) doesn't belong on a crypto
			// knowledge base regardless of what category it'd otherwise get.
			.filter((item) => item.symbols.length > 0);

		return json(items);
	} catch (error) {
		console.error('Error fetching news:', error);
		return json({ error: 'Failed to fetch news' }, { status: 500 });
	}
}
