import type { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

// 0G Chain — evmVersion MUST be "cancun", no other value works.
// Testnet: Galileo, chainId 16602. Mainnet: chainId 16661.
const config: HardhatUserConfig = {
	solidity: {
		version: '0.8.24',
		settings: {
			evmVersion: 'cancun',
			optimizer: { enabled: true, runs: 200 }
		}
	},
	networks: {
		'0g-testnet': {
			url: process.env.ZG_CHAIN_RPC_URL_TESTNET ?? 'https://evmrpc-testnet.0g.ai',
			chainId: 16602,
			accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
		},
		'0g-mainnet': {
			url: process.env.ZG_CHAIN_RPC_URL_MAINNET ?? 'https://evmrpc.0g.ai',
			chainId: 16661,
			accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
		}
	}
};

export default config;
