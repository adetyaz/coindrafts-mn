/**
 * A minimal local simulator built directly on @midnight-ntwrk/compact-runtime.
 *
 * It runs the real compiled circuit against a real in-memory ledger state — no
 * devnet, no proof server, no wallet. State transitions and disclosure
 * behaviour are identical to on-chain execution; only proof generation is
 * skipped.
 *
 * NOTE ON RUNTIME VERSION: this targets compact-runtime 0.16.0, which is the
 * runtime the compiled contract declares (see contract-info.json) and the one
 * @midnight-ntwrk/midnight-js-protocol@4.1.1 is built against. 0.16.0 uses a
 * FLAT CircuitContext (currentPrivateState / currentQueryContext at the top
 * level). Runtime 0.19.0 restructured this behind a nested `callContext` and
 * added a circuitId first argument to createCircuitContext — do not port this
 * file to that shape without also moving the whole SDK stack off 4.1.1.
 */

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../managed/kyc/contract/index.js';
import { kycWitnesses, type KycPrivateState } from '../witnesses/KycWitnesses.js';

const DEFAULT_COIN_PUBLIC_KEY = '0'.repeat(64);

export class KycSimulator {
  readonly contract: Contract<KycPrivateState>;
  readonly contractAddress: string;
  private circuitContext: CircuitContext<KycPrivateState>;

  private constructor(
    contract: Contract<KycPrivateState>,
    contractAddress: string,
    circuitContext: CircuitContext<KycPrivateState>,
  ) {
    this.contract = contract;
    this.contractAddress = contractAddress;
    this.circuitContext = circuitContext;
  }

  /** Deploy: run the constructor and capture the resulting initial state. */
  static async deploy(
    privateState: KycPrivateState,
    cutoffBirthYear: bigint,
    coinPublicKey: string = DEFAULT_COIN_PUBLIC_KEY,
  ): Promise<KycSimulator> {
    const contract = new Contract<KycPrivateState>(kycWitnesses);
    const contractAddress = sampleContractAddress();

    const { currentContractState, currentPrivateState } = contract.initialState(
      createConstructorContext(privateState, coinPublicKey),
      cutoffBirthYear,
    );

    const circuitContext = createCircuitContext<KycPrivateState>(
      contractAddress,
      coinPublicKey,
      currentContractState,
      currentPrivateState,
    );

    return new KycSimulator(contract, contractAddress, circuitContext);
  }

  /**
   * Call the one exported circuit. On success the new ledger state is
   * persisted into the simulator, exactly as a confirmed transaction would.
   *
   * Stays `async` so failing calls surface as a rejected promise, which is how
   * the assert-rejection tests consume it.
   */
  async submitKyc(): Promise<void> {
    const { context } = this.contract.impureCircuits.submitKyc(this.circuitContext);
    this.circuitContext = context;
  }

  /**
   * Swap in a different participant's private state without touching the
   * ledger — models a second person using the same deployed contract.
   */
  asParticipant(privateState: KycPrivateState): this {
    this.circuitContext = { ...this.circuitContext, currentPrivateState: privateState };
    return this;
  }

  /** Decode the public on-chain state — this is what any observer can read. */
  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}
