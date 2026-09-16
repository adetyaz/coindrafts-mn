import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type KycRecord = { commitment: Uint8Array; isOver18: boolean };

export type Witnesses<PS> = {
  kycSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  kycFullName(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  kycBirthYear(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  kycCountry(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  kycSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  submitKyc(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  submitKyc(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  deriveParticipantId(sk_0: Uint8Array): Uint8Array;
  computeBundleCommitment(fullName_0: Uint8Array,
                          birthYear_0: bigint,
                          country_0: Uint8Array,
                          salt_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  deriveParticipantId(context: __compactRuntime.CircuitContext<PS>,
                      sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeBundleCommitment(context: __compactRuntime.CircuitContext<PS>,
                          fullName_0: Uint8Array,
                          birthYear_0: bigint,
                          country_0: Uint8Array,
                          salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  submitKyc(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  records: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): KycRecord;
    [Symbol.iterator](): Iterator<[Uint8Array, KycRecord]>
  };
  readonly submissionCount: bigint;
  readonly adultBirthYearCutoff: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               cutoffBirthYear_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
