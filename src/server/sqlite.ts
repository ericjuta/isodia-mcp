import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDatabase, SqlValue } from './sql';

/** Open a SQLite file (or `:memory:`) for the store, creating its directory when needed. */
export function openSqlite(path: string): SqlDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // WAL and a busy timeout let the HTTP server and stdio MCP processes share one file.
  db.run('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  return {
    exec: (script) => db.run(script),
    all: <Row>(sql: string, ...params: SqlValue[]) =>
      db.query<Row, SQLQueryBindings[]>(sql).all(...params),
    // IMMEDIATE takes the write lock up front, so a read-modify-write cannot interleave with
    // another process's write between its read and its write.
    transaction: (change) => db.transaction(change).immediate()
  };
}
