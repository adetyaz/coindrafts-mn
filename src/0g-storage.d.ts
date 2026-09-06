// Minimal ambient declaration for `@0gfoundation/0g-storage-ts-sdk`.
//
// The package is intentionally NOT a dependency yet: the vocab knowledge-base
// batch write in src/lib/server/gauntlet.ts is a lazy import guarded by
// ZG_STORAGE_PRIVATE_KEY, so the Gauntlet feature works fully without it —
// this file lets the project type-check while the package is absent.
//
// Installing the real package makes the lazy import succeed and the storage
// write start working — nothing else has to change. At that point this file
// can be deleted in favour of the package's own types.
declare module '@0gfoundation/0g-storage-ts-sdk' {
	import type { Signer } from 'ethers';

	export interface MerkleTree {
		rootHash(): string;
	}

	export class ZgFile {
		static fromFilePath(path: string): Promise<ZgFile>;
		merkleTree(): Promise<[MerkleTree | null, Error | null]>;
		close(): Promise<void>;
	}

	export interface UploadTx {
		txSeq?: string | number;
	}

	export class Indexer {
		constructor(indexerUrl: string);
		upload(file: ZgFile, rpcUrl: string, signer: Signer): Promise<[UploadTx | null, Error | null]>;
		download(rootHash: string, outputPath: string, withProof: boolean): Promise<Error | null>;
	}
}
