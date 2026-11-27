import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(process.env.WUSOOL_DATA_DIR ?? path.join(process.cwd(), ".data"));
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 10000,
  hide_items INTEGER NOT NULL DEFAULT 1,
  receipt_visibility TEXT NOT NULL DEFAULT 'members',
  no_bank_account INTEGER NOT NULL DEFAULT 0,
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notif_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_verified INTEGER NOT NULL DEFAULT 0,
  t_breakdown INTEGER NOT NULL DEFAULT 1,
  t_request INTEGER NOT NULL DEFAULT 1,
  t_reminder INTEGER NOT NULL DEFAULT 1,
  t_wusool_maaf INTEGER NOT NULL DEFAULT 1,
  consent_at TEXT,
  consent_text TEXT
);
CREATE TABLE IF NOT EXISTS outings (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  organizer_user_id TEXT NOT NULL REFERENCES users(id),
  banner TEXT NOT NULL DEFAULT 'sea',
  logo_type TEXT NOT NULL DEFAULT 'cup3d',
  logo_value TEXT,
  date TEXT,
  place TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  allocation TEXT NOT NULL DEFAULT 'actual',
  routing TEXT NOT NULL DEFAULT 'original',
  rules TEXT NOT NULL DEFAULT '{}',
  draft_rev INTEGER NOT NULL DEFAULT 0,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  added_by_member_id TEXT,
  claim_user_id TEXT,
  color TEXT NOT NULL,
  no_bank_account INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS members_outing ON members(outing_id);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  require_approval INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  original_name TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploader_member_id TEXT NOT NULL,
  payer_member_id TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  ocr_text TEXT,
  ocr_confidence REAL,
  parsed TEXT,
  engine TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  transcript TEXT NOT NULL,
  interpreter TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  evidence_id TEXT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  declared_total INTEGER,
  equal_eligible INTEGER NOT NULL DEFAULT 1,
  payer_source TEXT,
  share_source TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_by_member_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_payers (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  amount INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  line_total INTEGER NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'high',
  raw TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS item_shares (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  weight REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  basis TEXT NOT NULL DEFAULT 'prorata'
);
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  from_member TEXT NOT NULL,
  to_member TEXT NOT NULL,
  amount INTEGER NOT NULL,
  on_behalf_of TEXT,
  kind TEXT NOT NULL,
  label TEXT,
  source TEXT NOT NULL,
  balance_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  expense_id TEXT,
  kind TEXT NOT NULL,
  qkey TEXT NOT NULL,
  text TEXT NOT NULL,
  detail TEXT,
  options TEXT NOT NULL,
  payload TEXT,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  allocation TEXT NOT NULL,
  routing TEXT NOT NULL,
  rules TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  published_by_member_id TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS balances (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  debtor_member_id TEXT NOT NULL,
  creditor_member_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  forgiven INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  prev_status TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  superseded INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS balance_events (
  id TEXT PRIMARY KEY,
  balance_id TEXT NOT NULL REFERENCES balances(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_member_id TEXT,
  amount INTEGER,
  note TEXT,
  idem_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  balance_id TEXT NOT NULL REFERENCES balances(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_by_member_id TEXT NOT NULL,
  resolution TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispute_messages (
  id TEXT PRIMARY KEY,
  dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  outing_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS wa_messages (
  id TEXT PRIMARY KEY,
  to_user_id TEXT NOT NULL,
  outing_id TEXT,
  balance_id TEXT,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  buttons TEXT,
  status TEXT NOT NULL,
  response TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  actor_member_id TEXT,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_reactions (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (photo_id, member_id, emoji)
);
CREATE TABLE IF NOT EXISTS removal_requests (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  requester_member_id TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`;

type G = typeof globalThis & { __wusoolDb?: DatabaseSync };

export function db(): DatabaseSync {
  const g = globalThis as G;
  if (!g.__wusoolDb) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const d = new DatabaseSync(path.join(DATA_DIR, "wusool.db"));
    d.exec(SCHEMA);
    // Additive migrations for databases created by earlier versions.
    for (const sql of [
      "ALTER TABLE expenses ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'itemised'",
      "ALTER TABLE expenses ADD COLUMN direct INTEGER NOT NULL DEFAULT 0",
      // "Get paid" details (see server/payments.ts)
      "ALTER TABLE users ADD COLUMN pay_raast TEXT",
      "ALTER TABLE users ADD COLUMN pay_iban TEXT",
      "ALTER TABLE users ADD COLUMN pay_title TEXT",
      "ALTER TABLE users ADD COLUMN pay_bank TEXT",
    ]) {
      try {
        d.exec(sql);
      } catch {
        /* column already exists */
      }
    }
    g.__wusoolDb = d;
  }
  return g.__wusoolDb;
}

export const now = () => new Date().toISOString();
export const newId = (prefix = "") => prefix + crypto.randomBytes(9).toString("base64url");

type Param = string | number | bigint | null | Uint8Array;
type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T = Row>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

/** Run `fn` atomically. Nested calls join the outer transaction. */
let depth = 0;
export function tx<T>(fn: () => T): T {
  const d = db();
  if (depth > 0) return fn();
  depth++;
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  } finally {
    depth--;
  }
}
