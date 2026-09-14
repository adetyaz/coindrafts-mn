/**
 * TypeScript witness implementations for KycAttestation.compact.
 *
 * Everything in this file runs ON THE PROVER'S MACHINE ONLY. None of these
 * values are sent to the network; they enter the ZK proof as private inputs.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../managed/kyc/contract/index.js';

/** The raw identity a person actually holds, in human-readable form. */
export type KycIdentity = {
  readonly fullName: string;
  /** Birth year only — a full date is not needed to derive `isOver18`. */
  readonly birthYear: number;
  readonly country: string;
};

/**
 * Private state persisted locally (browser storage / CLI keystore in a real
 * deployment). It never leaves the prover.
 */
export type KycPrivateState = {
  /** Long-lived identity secret. The basis of the on-chain participant id. */
  readonly secretKey: Uint8Array;
  readonly identity: KycIdentity;
  /** Commitment randomness. Must be kept to re-open the commitment later. */
  readonly salt: Uint8Array;
};

/** Encode a UTF-8 string into exactly 32 bytes, zero-padded on the right. */
export const toBytes32 = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length > 32) {
    throw new Error(
      `toBytes32: "${value}" encodes to ${encoded.length} bytes, exceeding the 32-byte field width`,
    );
  }
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return padded;
};

/** Cryptographically random 32 bytes, for secret keys and commitment salts. */
export const randomBytes32 = (): Uint8Array => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

export const createKycPrivateState = (
  identity: KycIdentity,
  secretKey: Uint8Array = randomBytes32(),
  salt: Uint8Array = randomBytes32(),
): KycPrivateState => {
  if (secretKey.length !== 32) {
    throw new Error(`createKycPrivateState: secretKey must be 32 bytes, got ${secretKey.length}`);
  }
  if (salt.length !== 32) {
    throw new Error(`createKycPrivateState: salt must be 32 bytes, got ${salt.length}`);
  }
  return { secretKey, identity, salt };
};

type Ctx = WitnessContext<Ledger, KycPrivateState>;

/**
 * Witness implementations. Each returns `[privateState, value]`; none of them
 * mutate private state, so the incoming state is returned unchanged.
 */
export const kycWitnesses = {
  kycSecretKey: ({ privateState }: Ctx): [KycPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  kycFullName: ({ privateState }: Ctx): [KycPrivateState, Uint8Array] => [
    privateState,
    toBytes32(privateState.identity.fullName),
  ],

  kycBirthYear: ({ privateState }: Ctx): [KycPrivateState, bigint] => [
    privateState,
    BigInt(privateState.identity.birthYear),
  ],

  kycCountry: ({ privateState }: Ctx): [KycPrivateState, Uint8Array] => [
    privateState,
    toBytes32(privateState.identity.country),
  ],

  kycSalt: ({ privateState }: Ctx): [KycPrivateState, Uint8Array] => [privateState, privateState.salt],
};
