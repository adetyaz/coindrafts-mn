import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
	const [deployer] = await ethers.getSigners();
	if (!deployer) {
		throw new Error('No signer configured — set PRIVATE_KEY in contracts/.env');
	}

	console.log(`Deploying on ${network.name} as ${deployer.address}`);

	const balance = await ethers.provider.getBalance(deployer.address);
	console.log(`Deployer balance: ${ethers.formatEther(balance)} OG`);
	if (balance === 0n) {
		throw new Error(
			`Deployer wallet has zero balance on ${network.name} — fund it from the 0G faucet before deploying.`
		);
	}

	const Achievements = await ethers.getContractFactory('CoinDraftAchievements');
	const contract = await Achievements.deploy();
	await contract.waitForDeployment();

	const address = await contract.getAddress();
	console.log(`CoinDraftAchievements deployed to: ${address}`);

	const outPath = path.join(__dirname, '..', 'deployed-addresses.json');
	const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf-8')) : {};
	existing[network.name] = { address, deployer: deployer.address, deployedAt: new Date().toISOString() };
	fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));
	console.log(`Saved to ${outPath}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
