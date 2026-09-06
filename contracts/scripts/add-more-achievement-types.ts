import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Closes the gap between the 6 off-chain badges (src/lib/badges.ts) and the
// 4 achievement types seeded at launch (seed-achievements.ts) — On Fire,
// Unstoppable, Veteran, Champion and League Founder were displayable in the
// Badge cabinet as "earned" but had no on-chain type to claim, ever.
// addAchievementType() never needs a redeploy, so this just appends.
const NEW_ACHIEVEMENTS = [
	{
		name: 'On Fire',
		description: 'Won 3 contests in a row.',
		metadataURI: ''
	},
	{
		name: 'Unstoppable',
		description: 'Won 5 contests in a row.',
		metadataURI: ''
	},
	{
		name: 'Veteran',
		description: 'Won 10 contests total.',
		metadataURI: ''
	},
	{
		name: 'Champion',
		description: 'Won 25 contests total.',
		metadataURI: ''
	},
	{
		name: 'League Founder',
		description: 'Created your first league.',
		metadataURI: ''
	}
];

async function main() {
	const addressesPath = path.join(__dirname, '..', 'deployed-addresses.json');
	const address =
		process.env.ACHIEVEMENTS_CONTRACT_ADDRESS ??
		(fs.existsSync(addressesPath) ? JSON.parse(fs.readFileSync(addressesPath, 'utf-8'))[network.name]?.address : undefined);
	if (!address) {
		throw new Error('No contract address — set ACHIEVEMENTS_CONTRACT_ADDRESS or deployed-addresses.json.');
	}

	const [signer] = await ethers.getSigners();
	console.log(`Adding achievement types on ${network.name} at ${address} as ${signer.address}`);

	const contract = await ethers.getContractAt('CoinDraftAchievements', address, signer);

	const startId: bigint = await contract.nextTypeId();
	console.log(`Current nextTypeId: ${startId}`);

	for (const a of NEW_ACHIEVEMENTS) {
		const tx = await contract.addAchievementType(a.name, a.description, a.metadataURI);
		const receipt = await tx.wait();
		console.log(`Added "${a.name}" — tx ${receipt?.hash}`);
	}

	console.log('Done.');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
