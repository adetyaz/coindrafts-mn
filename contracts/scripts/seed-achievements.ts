import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Metadata URIs are intentionally EMPTY — there is no real domain for this
// project yet, and no /api/badges/metadata/<typeId> endpoint built. An
// earlier version of this file used "https://coindraft.io/..." as if that
// were real; it wasn't (nobody owns or has pointed that domain) and it was
// never OK to invent one without saying so. Fill these in for real once both
// exist, then re-run — updateAchievementType() can correct what's already
// live on-chain too, see fix-achievement-metadata.ts.
const INITIAL_ACHIEVEMENTS = [
	{
		name: 'First Blood',
		description: 'Won your first head-to-head match against a real opponent.',
		metadataURI: ''
	},
	{
		name: 'Scrimmage Starter',
		description: 'Won your first Scrimmage match against a bot.',
		metadataURI: ''
	},
	{
		name: 'Sharp Shooter',
		description: 'Answered a Gauntlet quiz question correctly.',
		metadataURI: ''
	},
	{
		name: 'Know-It-All',
		description: 'Answered 5 Gauntlet quiz questions correctly in a row.',
		metadataURI: ''
	}
	// Add more here any time — addAchievementType() never needs a redeploy.
	// A few candidates worth considering later:
	//  { name: 'Bracket Buster', description: 'Won a tournament.', metadataURI: '...' },
	//  { name: 'Welcome to the Draft', description: 'Completed your very first contest.', metadataURI: '...' },
];

async function main() {
	const addressesPath = path.join(__dirname, '..', 'deployed-addresses.json');
	if (!fs.existsSync(addressesPath)) {
		throw new Error('deployed-addresses.json not found — run the deploy script first.');
	}
	const deployed = JSON.parse(fs.readFileSync(addressesPath, 'utf-8'));
	const entry = deployed[network.name];
	if (!entry?.address) {
		throw new Error(`No deployed address recorded for network "${network.name}".`);
	}

	const [signer] = await ethers.getSigners();
	console.log(`Seeding achievement types on ${network.name} at ${entry.address} as ${signer.address}`);

	const contract = await ethers.getContractAt('CoinDraftAchievements', entry.address, signer);

	const existingCount: bigint = await contract.nextTypeId();
	if (existingCount > 0n) {
		console.log(`nextTypeId is already ${existingCount} — types look seeded. Re-run only if you mean to add more.`);
	}

	for (const a of INITIAL_ACHIEVEMENTS) {
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
