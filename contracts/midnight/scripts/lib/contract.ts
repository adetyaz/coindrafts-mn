import fs from 'node:fs';
import path from 'node:path';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract } from '../../src/managed/kyc/contract/index.js';
import { kycWitnesses, type KycPrivateState } from '../../src/witnesses/KycWitnesses.js';
import { CONTRACT_NAME, DEPLOYED_CONTRACTS_FILE, STATE_DIR, ZK_CONFIG_PATH } from './config.js';
import type { Providers } from './providers.js';

// `Contract` (the compiled contract's class) is itself generic over the
// private-state type. Passing the bare class to CompiledContract.make lets
// TS's inference collapse to `never` (a known generic-class-as-value
// inference gap). An instantiation expression pins the type parameter
// explicitly before the value is used, which resolves it cleanly.
const KycContractCtor = Contract<KycPrivateState>;
type KycContractInstance = InstanceType<typeof KycContractCtor>;

/** The bound contract type: our compiled Contract, with the real KYC witnesses attached. */
export type KycContract = KycContractInstance;

// CompiledContract.make/withWitnesses/withCompiledFileAssets chain their own
// generics (C extends Contract<PS>, with PS inferred from a conditional type
// on a later argument) in a way this TS version can't resolve back to a
// concrete KycPrivateState — every attempt (instantiation expression,
// explicit type args, two-arg non-curried calls) collapses PS to `never`
// partway through the chain, even though each individual runtime call is a
// plain object-builder with no type-level branching (verified by reading
// node_modules/@midnight-ntwrk/compact-js's CompiledContract.d.ts source).
// The `as` casts below are scoped to just this one builder function; every
// other use of the result is fully typed via KycContract/KycPrivateState.
export function loadCompiledContract(): CompiledContract.CompiledContract<KycContract, KycPrivateState> {
	const make = CompiledContract.make as (tag: string, ctor: unknown) => unknown;
	const withAssets = CompiledContract.withCompiledFileAssets as (self: unknown, p: string) => unknown;
	const withWit = CompiledContract.withWitnesses as (self: unknown, w: unknown) => unknown;

	const base = make(CONTRACT_NAME, KycContractCtor);
	const withAssetsResult = withAssets(base, ZK_CONFIG_PATH);
	const withWitnessesResult = withWit(withAssetsResult, kycWitnesses);

	return withWitnessesResult as CompiledContract.CompiledContract<KycContract, KycPrivateState>;
}

export interface DeployResult {
	contractAddress: string;
	txId: string;
	blockHeight: number;
}

export async function deploy(
	providers: Providers,
	cutoffBirthYear: bigint,
	deployerPrivateState: KycPrivateState
): Promise<DeployResult> {
	const compiledContract = loadCompiledContract();

	const deployed = await deployContract(providers, {
		compiledContract,
		args: [cutoffBirthYear],
		privateStateId: `${CONTRACT_NAME}PrivateState`,
		initialPrivateState: deployerPrivateState
	});

	const result: DeployResult = {
		contractAddress: deployed.deployTxData.public.contractAddress,
		txId: deployed.deployTxData.public.txId,
		blockHeight: deployed.deployTxData.public.blockHeight
	};

	saveDeployedContract(CONTRACT_NAME, result);
	return result;
}

export async function join(
	providers: Providers,
	contractAddress: string,
	privateState: KycPrivateState
) {
	const compiledContract = loadCompiledContract();

	return findDeployedContract(providers, {
		contractAddress,
		compiledContract,
		privateStateId: `${CONTRACT_NAME}PrivateState`,
		initialPrivateState: privateState
	});
}

interface DeployedContractStore {
	[name: string]: { address: string; deployedAt: string; txId: string; cutoffBirthYear: string };
}

function contractsPath(): string {
	return path.join(STATE_DIR, DEPLOYED_CONTRACTS_FILE);
}

export function loadDeployedContracts(): DeployedContractStore {
	const filePath = contractsPath();
	if (!fs.existsSync(filePath)) return {};
	return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DeployedContractStore;
}

function saveDeployedContract(name: string, result: DeployResult): void {
	const store = loadDeployedContracts();
	store[name] = {
		address: result.contractAddress,
		deployedAt: new Date().toISOString(),
		txId: result.txId,
		cutoffBirthYear: ''
	};
	if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
	fs.writeFileSync(contractsPath(), `${JSON.stringify(store, null, 2)}\n`);
}
