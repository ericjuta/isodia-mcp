import { type SqlDatabase, StorageLimitError } from '../server/sql';

/** SQLite refuses a string, BLOB or row above this size in Durable Object storage. */
const ROW_LIMIT_MESSAGE =
  'This change is larger than Cloudflare Durable Object storage allows in one row (8 MB). Remove large custom icons or split the diagram.';

/**
 * The store's SQL surface over a Durable Object's SQLite storage. The object runs one request's
 * synchronous code at a time, and `transactionSync` rolls back every write when its callback
 * throws, so a read-modify-write here is as atomic as Bun's `BEGIN IMMEDIATE`.
 */
export function durableObjectSql(storage: DurableObjectStorage): SqlDatabase {
  const run = <Row>(sql: string, params: SqlStorageValue[]): Row[] => {
    try {
      return storage.sql.exec(sql, ...params).toArray() as Row[];
    } catch (error) {
      if (error instanceof Error && /SQLITE_TOOBIG|too big/i.test(error.message)) throw new StorageLimitError(ROW_LIMIT_MESSAGE);
      throw error;
    }
  };
  return {
    exec: (script) => void run(script, []),
    all: (sql, ...params) => run(sql, params),
    transaction: (change) => storage.transactionSync(change)
  };
}
