/**
 * The synchronous SQLite surface the store needs. Bun's `bun:sqlite` and a Durable Object's SQL
 * storage both provide it, so one store serves the local server and the Cloudflare Worker.
 */
export type SqlValue = string | number | null;

export interface SqlDatabase {
  /** Run statements that take no parameters, such as schema setup. */
  exec(script: string): void;
  /** Run one statement and return its rows; a write without `RETURNING` returns none. */
  all<Row>(sql: string, ...params: SqlValue[]): Row[];
  /** Run `change` as one write transaction: a throw rolls back every write it made. */
  transaction<T>(change: () => T): T;
}

/** A write the storage refuses because one row would exceed its size limit. */
export class StorageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageLimitError';
  }
}
