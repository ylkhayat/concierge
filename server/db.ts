// The state on disk: one SQLite database per machine (Node's built-in node:sqlite, no dependency), instead of a whole
// JSON file rewritten on every change. Each entry (one PR, one run, one setting: merge.ts's keys) is a row, and every
// change is also appended to a change log, so another machine can follow this one by asking for what changed since
// the last change it has (replica.ts): a run's update moves a few kilobytes, not the 7 MB file a file sync re-sent.
// Only the machine holding the lease writes its own changes (fleet.ts); the others apply what they pull, and log it too,
// so whichever machine holds the lease next can be followed the same way.
import { DatabaseSync } from 'node:sqlite'

export type Change = { seq: number; key: string; value: string | null; at: string } // value null: the entry was deleted
// Changes kept for a follower to catch up from; one further behind takes every entry instead, which is the smaller
// download anyway (the whole state is a few megabytes, the log of a day far more). So the log is kept short.
const KEEP = 20_000
const TRIM_EVERY = 10 * 60_000 // and trimmed by the clock: a count of this process's writes never got there across restarts

export class StateDb {
  private db: DatabaseSync
  private trimmedAt = 0
  private keep: number
  constructor(file: string, keep = KEEP) {
    this.keep = keep
    this.db = new DatabaseSync(file)
    // WAL: a write never waits for a read; NORMAL: durable at each checkpoint, which is what a crash can cost here
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT, at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;`)
    // on opening: an old log is cut to what is kept, and the room it held given back to the disk
    this.trim()
    this.compact()
  }
  /** Cut the change log to the last `keep` changes. */
  trim() {
    this.trimmedAt = Date.now()
    this.db.prepare('DELETE FROM changes WHERE seq <= ?').run(this.head() - this.keep)
  }
  /** Give freed pages back to the disk when they are most of the file (a log that was never trimmed): a rewrite of what is live. */
  private compact() {
    const n = (q: string) => Object.values(this.db.prepare(q).get() as Record<string, number>)[0]
    const pages = n('PRAGMA page_count'), free = n('PRAGMA freelist_count')
    if (pages < 2560 || free < pages / 2) return // under 10 MB, or mostly live: nothing worth a rewrite
    try { this.db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);') } catch { /* another reader has it open: next start */ }
  }
  /** Every entry, by key (its JSON). */
  all(): Map<string, string> {
    const out = new Map<string, string>()
    for (const r of this.db.prepare('SELECT key, value FROM entries').all() as { key: string; value: string }[]) out.set(r.key, r.value)
    return out
  }
  get empty() { return !(this.db.prepare('SELECT 1 AS x FROM entries LIMIT 1').get()) }
  /** Write changes in one transaction: each entry set (JSON) or deleted (null), and logged. */
  write(changes: { key: string; value: string | null }[], at = new Date().toISOString()) {
    if (!changes.length) return
    const set = this.db.prepare('INSERT INTO entries (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at')
    const del = this.db.prepare('DELETE FROM entries WHERE key = ?')
    const log = this.db.prepare('INSERT INTO changes (key, value, at) VALUES (?, ?, ?)')
    this.db.exec('BEGIN')
    try {
      for (const c of changes) { if (c.value === null) del.run(c.key); else set.run(c.key, c.value, at); log.run(c.key, c.value, at) }
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
    // the log is trimmed now and then, not on every write
    if (Date.now() - this.trimmedAt > TRIM_EVERY) this.trim()
  }
  /** Make the entries exactly these (a follower that was too far behind takes every entry), logged as changes. */
  replace(entries: Map<string, string>, at = new Date().toISOString()) {
    const have = this.all()
    const changes: { key: string; value: string | null }[] = []
    for (const [k, v] of entries) if (have.get(k) !== v) changes.push({ key: k, value: v })
    for (const k of have.keys()) if (!entries.has(k)) changes.push({ key: k, value: null })
    this.write(changes, at)
    return changes
  }
  /** The last change's number (0: none yet). */
  head(): number { return (this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM changes').get() as { n: number }).n }
  /** The oldest change still kept (a follower behind it takes every entry). */
  oldest(): number { return (this.db.prepare('SELECT COALESCE(MIN(seq), 0) AS n FROM changes').get() as { n: number }).n }
  /** What changed after `seq`, at most `limit` changes, oldest first. */
  since(seq: number, limit = 2000): Change[] {
    return this.db.prepare('SELECT seq, key, value, at FROM changes WHERE seq > ? ORDER BY seq LIMIT ?').all(seq, limit) as Change[]
  }
  getKv(k: string): string | undefined { return (this.db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined)?.v }
  setKv(k: string, v: string) { this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v) }
  /**
   * A copy of the entries as they are now, in a file of its own (the change log left out: it is for followers, and a
   * copy without it is a tenth the size). What a start falls back to when this file can't be read.
   */
  snapshot(dest: string) {
    this.db.prepare('VACUUM INTO ?').run(dest)
    const copy = new DatabaseSync(dest)
    try { copy.exec('DELETE FROM changes; VACUUM;') } finally { copy.close() }
  }
  close() { this.db.close() }
}
