import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Each committed room snapshot contains all game state and idempotency keys. */
export class RoomStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, updated INTEGER NOT NULL)",
    );
  }
  list<T>(): T[] {
    return this.db
      .prepare("SELECT state FROM rooms")
      .all()
      .map((row) => JSON.parse(String(row.state)) as T);
  }
  save(code: string, state: unknown) {
    this.db
      .prepare(
        "INSERT INTO rooms(code,state,updated) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET state=excluded.state,updated=excluded.updated",
      )
      .run(code, JSON.stringify(state), Date.now());
  }
  delete(code: string) {
    this.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
  }
  close() {
    this.db.close();
  }
}
