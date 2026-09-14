// Client-only. Wires KycAttestation.compact's real compiled output into the
// browser: submits a real submitKyc transaction (real proof generation, real
// network round-trip) and reads the real on-chain verification status back.
//
// ZERO SERVER-SIDE IMPORTS — same discipline as $lib/midnightWallet.ts.
//
// SECURITY NOTE on the read path: the deployed contract's PLONK proof, in
// isolation, does not bind `adultBirthYearCutoff` to on-chain state — a
// forged (cutoff, isOver18) pair could pass the ZK checker on its own. So
// checkKycVerified() below never accepts a client-reported boolean or a bare
// proof as sufficient. It always re-fetches the actual on-chain ledger state
// for the one fixed, deployed KYC_CONTRACT_ADDRESS via the indexer, decodes
// it with the contract's own `ledger()` function, and reads `isOver18`
// straight out of that decoded map entry. That value only exists there
// because a real, network-confirmed submitKyc transaction wrote it — not
// because a client asserted it.

import { CompiledContract, type ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import type {
	MidnightProvider,
	PrivateStateProvider,
	WalletProvider
} from '@midnight-ntwrk/midnight-js-types';
import * as Rx from 'rxjs';

import {
	Contract,
	ledger,
	pureCircuits
} from '../../../contracts/midnight/src/managed/kyc/contract/index.js';
import {
	createKycPrivateState,
	kycWitnesses,
	randomBytes32,
	type KycIdentity,
	type KycPrivateState
} from '../../../contracts/midnight/src/witnesses/KycWitnesses.js';

import type { MidnightWalletSession } from '$lib/midnightWallet';
import { kycSecretKeyFromSeed } from '$lib/midnightWallet';
import {
	MIDNIGHT_INDEXER_HTTP_URL,
	MIDNIGHT_INDEXER_WS_URL,
	MIDNIGHT_PROOF_SERVER_URL,
	requireKycContractAddress
} from './config';

function assertBrowser(fnName: string): void {
	if (typeof window === 'undefined') {
		throw new Error(`midnight/kyc.${fnName}() is client-only and must not run during SSR.`);
	}
}

// ── Compiled contract binding ────────────────────────────────────────────
// Same instantiation-expression + scoped-cast pattern as
// contracts/midnight/scripts/lib/contract.ts, and for the same reason: the
// compiled Contract class's generic private-state parameter doesn't survive
// CompiledContract.make/withWitnesses's own generic inference in this TS
// version, even though each call is a plain runtime object-builder with no
// type-level branching (verified by reading compact-js's own source).

const KycContractCtor = Contract<KycPrivateState>;
type KycContract = InstanceType<typeof KycContractCtor>;

function loadCompiledContract(): CompiledContract.CompiledContract<KycContract, KycPrivateState> {
	const make = CompiledContract.make as (tag: string, ctor: unknown) => unknown;
	const withAssets = CompiledContract.withCompiledFileAssets as (self: unknown, p: string) => unknown;
	const withWit = CompiledContract.withWitnesses as (self: unknown, w: unknown) => unknown;

	// FetchZkConfigProvider (below) resolves the compiled-assets path against
	// its own baseURL, so this second argument is a no-op placeholder — kept
	// only because withCompiledFileAssets requires one.
	const base = make('KycAttestation', KycContractCtor);
	const withAssetsResult = withAssets(base, '.');
	const withWitnessesResult = withWit(withAssetsResult, kycWitnesses);

	return withWitnessesResult as CompiledContract.CompiledContract<KycContract, KycPrivateState>;
}

// ── In-memory private state provider ────────────────────────────────────
// Browser DApps don't persist private state across sessions — on refresh,
// private state is reconstructed from the cached wallet seed (see
// midnightWallet.ts) plus a fresh salt, not read back from storage.

type PrivateStateId = string;

function inMemoryPrivateStateProvider(): PrivateStateProvider<PrivateStateId, KycPrivateState> {
	const states = new Map<PrivateStateId, KycPrivateState>();
	const signingKeys = new Map<string, Uint8Array>();
	return {
		// Synchronous per the interface (unlike the rest of this provider) —
		// namespacing is pure in-memory bookkeeping, nothing to await.
		setContractAddress: (_address: string) => {},
		set: async (id: PrivateStateId, state: KycPrivateState) => {
			states.set(id, state);
		},
		get: async (id: PrivateStateId) => states.get(id) ?? null,
		remove: async (id: PrivateStateId) => {
			states.delete(id);
		},
		clear: async () => {
			states.clear();
		},
		setSigningKey: async (address: string, key: Uint8Array) => {
			signingKeys.set(address, key);
		},
		getSigningKey: async (address: string) => signingKeys.get(address) ?? null,
		removeSigningKey: async (address: string) => {
			signingKeys.delete(address);
		},
		clearSigningKeys: async () => {
			signingKeys.clear();
		},
		exportPrivateStates: async () => {
			throw new Error('Not supported by the in-memory private state provider.');
		},
		importPrivateStates: async () => {
			throw new Error('Not supported by the in-memory private state provider.');
		},
		exportSigningKeys: async () => {
			throw new Error('Not supported by the in-memory private state provider.');
		},
		importSigningKeys: async () => {
			throw new Error('Not supported by the in-memory private state provider.');
		}
	} as unknown as PrivateStateProvider<PrivateStateId, KycPrivateState>;
}

// ── Providers ────────────────────────────────────────────────────────────

async function createWalletAndMidnightProvider(
	session: MidnightWalletSession
): Promise<WalletProvider & MidnightProvider> {
	const state = await Rx.firstValueFrom(session.facade.state().pipe(Rx.filter((s) => s.isSynced)));
	const coinPublicKey = state.shielded.coinPublicKey.toHexString();
	const encryptionPublicKey = state.shielded.encryptionPublicKey.toHexString();

	return {
		getCoinPublicKey: () => coinPublicKey,
		getEncryptionPublicKey: () => encryptionPublicKey,
		async balanceTx(tx, ttl) {
			const recipe = await session.facade.balanceUnboundTransaction(
				tx,
				{ shieldedSecretKeys: session.shieldedSecretKeys, dustSecretKey: session.dustSecretKey },
				{ ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) }
			);
			return session.facade.finalizeRecipe(recipe);
		},
		submitTx: (tx) => session.facade.submitTransaction(tx)
	};
}

async function createBrowserProviders(session: MidnightWalletSession) {
	const walletProvider = await createWalletAndMidnightProvider(session);
	const zkConfigProvider = new FetchZkConfigProvider<ProvableCircuitId<KycContract>>(
		window.location.origin,
		window.fetch.bind(window)
	);

	return {
		privateStateProvider: inMemoryPrivateStateProvider(),
		// No third (webSocketImpl) argument: the browser's native WebSocket is
		// picked up automatically. Passing it explicitly type-mismatches against
		// this package's expected `typeof ws.WebSocket` (the Node `ws` library's
		// class, not the browser's native constructor) — that argument only
		// makes sense from Node tooling (see contracts/midnight/scripts/lib/providers.ts).
		publicDataProvider: indexerPublicDataProvider(MIDNIGHT_INDEXER_HTTP_URL, MIDNIGHT_INDEXER_WS_URL),
		zkConfigProvider,
		proofProvider: httpClientProofProvider(MIDNIGHT_PROOF_SERVER_URL, zkConfigProvider),
		walletProvider,
		midnightProvider: walletProvider
	};
}

// ── Submit ───────────────────────────────────────────────────────────────

export interface SubmitKycResult {
	readonly txId: string;
	readonly participantIdHex: string;
}

/**
 * Submits a real submitKyc transaction: real witnesses (the form's identity,
 * the wallet-derived secret key, a fresh random salt), real proof generation
 * against the local proof server, real submission to the local devnet. Can
 * take well over a minute end to end — see midnightWallet.ts's
 * FundingStage / callers for the funding+registration wait, which happens
 * before this.
 */
export async function submitKyc(
	session: MidnightWalletSession,
	seed: Uint8Array,
	identity: KycIdentity
): Promise<SubmitKycResult> {
	assertBrowser('submitKyc');
	const contractAddress = requireKycContractAddress();

	const secretKey = await kycSecretKeyFromSeed(seed);
	const salt = randomBytes32();
	const privateState = createKycPrivateState(identity, secretKey, salt);

	const providers = await createBrowserProviders(session);
	const compiledContract = loadCompiledContract();

	const found = await findDeployedContract(providers, {
		contractAddress,
		compiledContract,
		privateStateId: 'KycAttestationPrivateState',
		initialPrivateState: privateState
	});

	const callResult = await found.callTx.submitKyc();

	const participantId = pureCircuits.deriveParticipantId(secretKey);
	const participantIdHex = Buffer.from(participantId).toString('hex');

	return { txId: callResult.public.txId, participantIdHex };
}

// ── Read path ────────────────────────────────────────────────────────────

export interface KycStatus {
	readonly submitted: boolean;
	readonly isOver18: boolean;
	readonly adultBirthYearCutoff: bigint;
}

/**
 * Reads real, confirmed on-chain state for the fixed deployed KYC contract —
 * never a client-reported result. See the security note at the top of this
 * file for why that distinction matters here.
 */
export async function checkKycVerified(seed: Uint8Array): Promise<KycStatus | null> {
	assertBrowser('checkKycVerified');
	const contractAddress = requireKycContractAddress();
	const secretKey = await kycSecretKeyFromSeed(seed);
	const participantId = pureCircuits.deriveParticipantId(secretKey);

	const publicDataProvider = indexerPublicDataProvider(MIDNIGHT_INDEXER_HTTP_URL, MIDNIGHT_INDEXER_WS_URL);
	const state = await publicDataProvider.queryContractState(contractAddress);
	if (!state) return null;

	const decoded = ledger(state.data);
	const submitted = decoded.records.member(participantId);
	return {
		submitted,
		isOver18: submitted ? decoded.records.lookup(participantId).isOver18 : false,
		adultBirthYearCutoff: decoded.adultBirthYearCutoff
	};
}
