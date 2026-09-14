import { describe, it, expect, beforeEach } from 'vitest';
import { pureCircuits } from '../managed/kyc/contract/index.js';
import { KycSimulator } from './KycSimulator.js';
import {
  createKycPrivateState,
  toBytes32,
  type KycIdentity,
  type KycPrivateState,
} from '../witnesses/KycWitnesses.js';

// Cutoff for "today" (2026): born in or before 2008 => 18 or older.
const CUTOFF_BIRTH_YEAR = 2008n;

// A completely realistic-looking fake identity. Every field below is private.
const ADA: KycIdentity = {
  fullName: 'Adaeze Nkemdirim Okonkwo',
  birthYear: 1991,
  country: 'Nigeria',
};

// A second, underage identity.
const TEEN: KycIdentity = {
  fullName: 'Marcus Oluwaseun Bell',
  birthYear: 2012,
  country: 'Nigeria',
};

const FIXED_SECRET = new Uint8Array(32).fill(7);
const FIXED_SALT = new Uint8Array(32).fill(9);

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('KycAttestation — commit + selective disclosure', () => {
  let ada: KycPrivateState;
  let sim: KycSimulator;

  beforeEach(async () => {
    ada = createKycPrivateState(ADA, FIXED_SECRET, FIXED_SALT);
    sim = await KycSimulator.deploy(ada, CUTOFF_BIRTH_YEAR);
  });

  it('starts empty with the adulthood cutoff publicly pinned', () => {
    const l = sim.getLedger();
    expect(l.records.isEmpty()).toBe(true);
    expect(l.submissionCount).toBe(0n);
    expect(l.adultBirthYearCutoff).toBe(CUTOFF_BIRTH_YEAR);
  });

  it('records an attestation keyed by the derived participant id', async () => {
    await sim.submitKyc();

    const l = sim.getLedger();
    const participantId = pureCircuits.deriveParticipantId(ada.secretKey);

    expect(l.submissionCount).toBe(1n);
    expect(l.records.size()).toBe(1n);
    expect(l.records.member(participantId)).toBe(true);
  });

  // ── THE POINT OF THE EXERCISE ──────────────────────────────────────────────
  it('stores the identity as opaque bytes but isOver18 as a readable boolean', async () => {
    await sim.submitKyc();

    const participantId = pureCircuits.deriveParticipantId(ada.secretKey);
    const record = sim.getLedger().records.lookup(participantId);

    // The commitment is 32 bytes of noise — no structure, no readable content.
    expect(record.commitment).toBeInstanceOf(Uint8Array);
    expect(record.commitment.length).toBe(32);
    expect(hex(record.commitment)).toMatch(/^[0-9a-f]{64}$/);

    // The derived fact, by contrast, is directly readable.
    expect(record.isOver18).toBe(true);

    console.log('\n  ── what an on-chain observer sees ──');
    console.log('  participantId :', hex(participantId));
    console.log('  commitment    :', hex(record.commitment), '  <- opaque');
    console.log('  isOver18      :', record.isOver18, '                 <- readable');
    console.log('  cutoffYear    :', sim.getLedger().adultBirthYearCutoff);
    console.log('  ── what stays on the prover ──');
    console.log('  fullName      :', ADA.fullName);
    console.log('  birthYear     :', ADA.birthYear);
    console.log('  country       :', ADA.country, '\n');
  });

  it('leaks no private field anywhere in the public ledger', async () => {
    await sim.submitKyc();

    const l = sim.getLedger();
    const participantId = pureCircuits.deriveParticipantId(ada.secretKey);
    const record = l.records.lookup(participantId);

    // Every byte a chain observer can read, concatenated.
    const publicBytes = hex(participantId) + hex(record.commitment);

    // No private field, in plaintext or padded-bytes32 form, appears in it.
    for (const secret of [ADA.fullName, ADA.country]) {
      expect(publicBytes).not.toContain(hex(toBytes32(secret)).replace(/0+$/, ''));
      expect(publicBytes).not.toContain(Buffer.from(secret, 'utf8').toString('hex'));
    }

    // The real birth year never appears; only the public cutoff does.
    expect(publicBytes).not.toContain((1991).toString(16));
    expect(l.adultBirthYearCutoff).toBe(CUTOFF_BIRTH_YEAR);
    expect(l.adultBirthYearCutoff).not.toBe(BigInt(ADA.birthYear));

    // The secret key and salt are likewise absent.
    expect(publicBytes).not.toContain(hex(ada.secretKey));
    expect(publicBytes).not.toContain(hex(ada.salt));
  });

  it('discloses false for an underage identity, still without the birth year', async () => {
    const teen = createKycPrivateState(TEEN, new Uint8Array(32).fill(3), new Uint8Array(32).fill(4));
    await sim.asParticipant(teen).submitKyc();

    const teenId = pureCircuits.deriveParticipantId(teen.secretKey);
    const record = sim.getLedger().records.lookup(teenId);

    expect(record.isOver18).toBe(false);
    expect(record.commitment.length).toBe(32);
    expect(hex(record.commitment)).not.toContain((2012).toString(16));
  });

  it('binds the commitment to the exact bundle (opens correctly)', async () => {
    await sim.submitKyc();

    const participantId = pureCircuits.deriveParticipantId(ada.secretKey);
    const onChain = sim.getLedger().records.lookup(participantId);

    // Recomputing with the true private values reproduces the commitment...
    const reopened = pureCircuits.computeBundleCommitment(
      toBytes32(ADA.fullName),
      BigInt(ADA.birthYear),
      toBytes32(ADA.country),
      ada.salt,
    );
    expect(hex(reopened)).toBe(hex(onChain.commitment));

    // ...and changing any single field does not.
    const tampered = pureCircuits.computeBundleCommitment(
      toBytes32(ADA.fullName),
      BigInt(ADA.birthYear + 1),
      toBytes32(ADA.country),
      ada.salt,
    );
    expect(hex(tampered)).not.toBe(hex(onChain.commitment));
  });

  it('hides the bundle: same identity, different salt => unrelated commitment', () => {
    const args = [
      toBytes32(ADA.fullName),
      BigInt(ADA.birthYear),
      toBytes32(ADA.country),
    ] as const;

    const c1 = pureCircuits.computeBundleCommitment(...args, new Uint8Array(32).fill(1));
    const c2 = pureCircuits.computeBundleCommitment(...args, new Uint8Array(32).fill(2));

    // Without the salt, an observer cannot brute-force the bundle by guessing.
    expect(hex(c1)).not.toBe(hex(c2));
  });

  it('derives a stable participant id from the secret, and distinct ids per secret', () => {
    const a1 = pureCircuits.deriveParticipantId(FIXED_SECRET);
    const a2 = pureCircuits.deriveParticipantId(FIXED_SECRET);
    const b = pureCircuits.deriveParticipantId(new Uint8Array(32).fill(8));

    expect(hex(a1)).toBe(hex(a2));
    expect(hex(a1)).not.toBe(hex(b));
    // The id is a hash, not the key itself.
    expect(hex(a1)).not.toBe(hex(FIXED_SECRET));
  });

  it('rejects a second submission from the same identity', async () => {
    await sim.submitKyc();
    await expect(sim.submitKyc()).rejects.toThrow('KYC already submitted for this identity');
  });

  it('allows a different identity to submit against the same contract', async () => {
    await sim.submitKyc();

    const teen = createKycPrivateState(TEEN, new Uint8Array(32).fill(3), new Uint8Array(32).fill(4));
    await sim.asParticipant(teen).submitKyc();

    const l = sim.getLedger();
    expect(l.submissionCount).toBe(2n);
    expect(l.records.size()).toBe(2n);
  });
});
