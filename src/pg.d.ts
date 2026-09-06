// Minimal ambient declaration for `pg`.
//
// The package ships no types of its own, and `@types/pg` is deliberately NOT a
// dependency here — this file exists so the project needs no extra install for
// what is only a type-checking concern. `pg` itself was already present.
//
// Scope is intentionally narrow: only what src/lib/server/db.ts actually uses.
// If more of the pg surface gets used later, prefer adding to this file over
// pulling in the full @types package.
declare module 'pg' {
	export interface PoolConfig {
		connectionString?: string;
		max?: number;
		idleTimeoutMillis?: number;
		connectionTimeoutMillis?: number;
		ssl?: boolean | { rejectUnauthorized?: boolean };
	}

	export class Pool {
		constructor(config?: PoolConfig);
		on(event: 'error', listener: (err: Error) => void): this;
		end(): Promise<void>;
	}

	export class Client {
		constructor(config?: PoolConfig);
		connect(): Promise<void>;
		query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
		end(): Promise<void>;
	}

	const pg: { Pool: typeof Pool; Client: typeof Client };
	export default pg;
}
