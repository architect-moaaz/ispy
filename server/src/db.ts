import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export const DB_PATH = process.env.ISPY_DB ?? new URL("../ispy.db", import.meta.url).pathname;

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, codename TEXT UNIQUE NOT NULL, faction_id TEXT,
  rank TEXT NOT NULL DEFAULT 'civilian', xp INTEGER NOT NULL DEFAULT 0,
  trust INTEGER NOT NULL DEFAULT 50, skills TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assessments (
  player_id TEXT PRIMARY KEY, answers TEXT NOT NULL, skills TEXT NOT NULL, offers TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, radius_m REAL NOT NULL, merge_group TEXT
);
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY, area_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, approach_radius_m REAL NOT NULL DEFAULT 40,
  safe_start INTEGER NOT NULL DEFAULT 7, safe_end INTEGER NOT NULL DEFAULT 19,
  capacity INTEGER NOT NULL DEFAULT 4, state TEXT NOT NULL DEFAULT 'ACTIVE',
  observation TEXT NOT NULL, observation_answer TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS presence (
  player_id TEXT PRIMARY KEY, area_id TEXT, mode TEXT NOT NULL,
  checked_in_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  last_lat REAL, last_lng REAL, last_fix_at TEXT
);
CREATE TABLE IF NOT EXISTS area_plans (
  id TEXT PRIMARY KEY, faction_id TEXT NOT NULL, area_id TEXT NOT NULL,
  plan TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY, faction_id TEXT NOT NULL, area_id TEXT NOT NULL,
  template_id TEXT NOT NULL, mode TEXT NOT NULL, target_id TEXT,
  assignee_id TEXT, state TEXT NOT NULL, title TEXT NOT NULL, brief TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}', reward_xp INTEGER NOT NULL,
  contested_group_id TEXT, desk_link_id TEXT, version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
  accepted_at TEXT, completed_at TEXT, outcome TEXT
);
CREATE TABLE IF NOT EXISTS desk_links (
  id TEXT PRIMARY KEY, desk_mission_id TEXT NOT NULL, field_mission_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open', fallback_after_s INTEGER NOT NULL,
  started_at TEXT, fulfilled_at TEXT
);
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, player_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open', expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, actor TEXT NOT NULL,
  player_id TEXT, payload TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, mission_id TEXT,
  lat REAL, lng REAL, trust REAL NOT NULL, reasons TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS world (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS missions_state ON missions(state, faction_id, area_id);
CREATE INDEX IF NOT EXISTS offers_player ON offers(player_id, state);
CREATE INDEX IF NOT EXISTS events_player ON events(player_id, id);
`;
db.exec(SCHEMA);

type Row = Record<string, any>;

export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
export const json = (v: unknown) => JSON.stringify(v);
export const parse = <T = any>(s: string | null | undefined, fallback: T): T =>
  s ? (JSON.parse(s) as T) : fallback;

export function logEvent(type: string, actor: string, payload: unknown, playerId?: string | null) {
  run(
    "INSERT INTO events(type, actor, player_id, payload, at) VALUES (?,?,?,?,?)",
    type, actor, playerId ?? null, json(payload), now(),
  );
}

export function worldGet(key: string, fallback = ""): string {
  return get<{ value: string }>("SELECT value FROM world WHERE key=?", key)?.value ?? fallback;
}
export function worldSet(key: string, value: string) {
  run("INSERT INTO world(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value);
}
