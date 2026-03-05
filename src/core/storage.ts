import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seen (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  first_seen_utc TEXT NOT NULL,
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  key TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  raw TEXT
);
`;

export class Storage {
  private readonly db: Database;

  constructor(path = process.env.LEADAGENT_STATE_DB ?? "./state.db") {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  seen(source: string, externalId: string): boolean {
    const row = this.db
      .query("SELECT 1 as ok FROM seen WHERE source = ? AND external_id = ?")
      .get(source, externalId) as { ok?: number } | null;
    return !!row?.ok;
  }

  markSeen(source: string, externalId: string): void {
    this.db
      .query(
        "INSERT OR IGNORE INTO seen (source, external_id, first_seen_utc) VALUES (?, ?, datetime('now'))"
      )
      .run(source, externalId);
  }

  geocodeGet(key: string): [number, number] | null {
    const row = this.db
      .query("SELECT lat, lon FROM geocode_cache WHERE key = ?")
      .get(key) as { lat: number; lon: number } | null;

    return row ? [row.lat, row.lon] : null;
  }

  geocodePut(key: string, lat: number, lon: number, raw: unknown): void {
    this.db
      .query("INSERT OR REPLACE INTO geocode_cache (key, lat, lon, raw) VALUES (?, ?, ?, ?)")
      .run(key, lat, lon, JSON.stringify(raw));
  }
}
