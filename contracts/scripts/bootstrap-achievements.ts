import { ethers, network } from 'hardhat';

// Full bootstrap for a freshly deployed CoinDraftAchievements: seeds every
// achievement type WITH its metadata URI already set, then authorises the
// voucher signer. Idempotent — safe to re-run.
//
// Seeding with metadata in the same transaction is deliberate. Doing it in two
// passes (add with metadataURI '', update later) means every badge claimed in
// between resolves to an empty tokenURI and renders blank in wallets, and it
// costs a second round of one transaction per type. On a fresh contract there's
// no reason to accept either.
//
// Types already present are UPDATED rather than re-added, so re-running this
// after changing copy or artwork just corrects them in place. typeId is an
// array index on-chain, so ORDER HERE IS LOAD-BEARING — it must match
// ACHIEVEMENT_TYPES in src/lib/server/achievements.ts exactly.
//
// Usage (from contracts/):
//   APP_BASE_URL=https://coindrafts.vercel.app \
//   ACHIEVEMENTS_CONTRACT_ADDRESS=0x... \
//   npx hardhat run scripts/bootstrap-achievements.ts --network 0g-mainnet
const ACHIEVEMENTS = [
	{ name: 'First Blood', description: 'Won your first head-to-head match against a real opponent.' },
	{ name: 'Scrimmage Starter', description: 'Won your first Scrimmage match against a bot.' },
	{ name: 'Sharp Shooter', description: 'Answered a Gauntlet quiz question correctly.' },
	{ name: 'Know-It-All', description: 'Answered 5 Gauntlet quiz questions correctly in a row.' },
	{ name: 'On Fire', description: 'Won 3 contests in a row.' },
	{ name: 'Unstoppable', description: 'Won 5 contests in a row.' },
	{ name: 'Veteran', description: 'Won 10 contests total.' },
	{ name: 'Champion', description: 'Won 25 contests total.' },
	{ name: 'League Founder', description: 'Created your first league.' }
];

async function main() {
	const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
	if (!baseUrl) throw new Error('APP_BASE_URL is required — the deployed, publicly reachable app origin.');
	if (/localhost|127\.0\.0\.1/.test(baseUrl)) {
		throw new Error(`APP_BASE_URL is ${baseUrl} — wallets and indexers cannot reach localhost.`);
	}

	const address = process.env.ACHIEVEMENTS_CONTRACT_ADDRESS;
	if (!address) throw new Error('ACHIEVEMENTS_CONTRACT_ADDRESS is required.');

	const [signer] = await ethers.getSigners();
	const contract = await ethers.getContractAt('CoinDraftAchievements', address, signer);

	console.log(`network : ${network.name}`);
	console.log(`contract: ${address}`);
	console.log(`sender  : ${signer.address}`);
	console.log(`metadata: ${baseUrl}/api/achievements/metadata/<typeId>\n`);

	const owner = await contract.owner();
	if (owner.toLowerCase() !== signer.address.toLowerCase()) {
		throw new Error(`Sender is not the owner (owner is ${owner}) — onlyOwner calls would revert.`);
	}

	let nextTypeId: bigint = await contract.nextTypeId();

	for (let typeId = 0; typeId < ACHIEVEMENTS.length; typeId++) {
		const a = ACHIEVEMENTS[typeId];
		const metadataURI = `${baseUrl}/api/achievements/metadata/${typeId}`;

		if (BigInt(typeId) < nextTypeId) {
			const cur = await contract.achievementTypes(typeId);
			if (cur.name === a.name && cur.metadataURI === metadataURI && cur.active) {
				console.log(`[${typeId}] "${a.name}" already correct — skipped`);
				continue;
			}
			const tx = await contract.updateAchievementType(typeId, a.name, a.description, metadataURI, true);
			const r = await tx.wait();
			console.log(`[${typeId}] updated "${a.name}"  tx ${r?.hash}`);
		} else {
			const tx = await contract.addAchievementType(a.name, a.description, metadataURI);
			const r = await tx.wait();
			nextTypeId = BigInt(typeId) + 1n;
			console.log(`[${typeId}] added   "${a.name}"  tx ${r?.hash}`);
		}
	}

	// The backend signs claim vouchers with this wallet; the contract rejects any
	// voucher from an unauthorised signer, so claiming is dead until this is set.
	const alreadySigner = await contract.signers(signer.address);
	if (alreadySigner) {
		console.log(`\nsigner ${signer.address} already authorised`);
	} else {
		const tx = await contract.setSigner(signer.address, true);
		const r = await tx.wait();
		console.log(`\nauthorised signer ${signer.address}  tx ${r?.hash}`);
	}

	console.log('\nDone.');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
