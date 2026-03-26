const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

/**
 * Wrapper around sql.js that provides a better-sqlite3-compatible API.
 * This lets license.js and main.js use db.prepare().get()/run()/all()
 * without knowing the underlying driver changed.
 */
class DatabaseWrapper {
  constructor(sqlDb, dbPath) {
    this._db = sqlDb;
    this._dbPath = dbPath;
    this._saveTimer = null;
  }

  /** Save database to disk (debounced). */
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const data = this._db.export();
        fs.writeFileSync(this._dbPath, Buffer.from(data));
      } catch (err) {
        console.error('[database] Save failed:', err.message);
      }
    }, 100);
  }

  /** Force immediate save. */
  save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    try {
      const data = this._db.export();
      fs.writeFileSync(this._dbPath, Buffer.from(data));
    } catch (err) {
      console.error('[database] Save failed:', err.message);
    }
  }

  /** Execute raw SQL (CREATE TABLE, multi-statement, etc.) */
  exec(sql) {
    this._db.run(sql);
    this._scheduleSave();
  }

  /** Returns a statement-like object with .get(), .run(), .all() methods. */
  prepare(sql) {
    const db = this._db;
    const wrapper = this;

    return {
      /** Get single row. Returns object or undefined. */
      get(...params) {
        try {
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            stmt.free();
            const row = {};
            cols.forEach((col, i) => { row[col] = vals[i]; });
            return row;
          }
          stmt.free();
          return undefined;
        } catch (err) {
          console.error(`[database] prepare.get error: ${err.message}\nSQL: ${sql}\nParams: ${JSON.stringify(params)}`);
          return undefined;
        }
      },

      /** Execute write statement. */
      run(...params) {
        try {
          if (params.length > 0) {
            db.run(sql, params);
          } else {
            db.run(sql);
          }
          wrapper._scheduleSave();
        } catch (err) {
          console.error(`[database] prepare.run error: ${err.message}\nSQL: ${sql}\nParams: ${JSON.stringify(params)}`);
          throw err;
        }
      },

      /** Get all rows. Returns array of objects. */
      all(...params) {
        try {
          const results = [];
          const stmt = db.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((col, i) => { row[col] = vals[i]; });
            results.push(row);
          }
          stmt.free();
          return results;
        } catch (err) {
          console.error(`[database] prepare.all error: ${err.message}\nSQL: ${sql}\nParams: ${JSON.stringify(params)}`);
          return [];
        }
      },
    };
  }

  close() {
    this.save();
    this._db.close();
  }
}

/**
 * Initialize database (async — sql.js needs to load WASM).
 * Returns a DatabaseWrapper with better-sqlite3-compatible API.
 */
async function initDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    sqlDb = new SQL.Database(fileBuffer);
  } else {
    sqlDb = new SQL.Database();
  }

  const db = new DatabaseWrapper(sqlDb, dbPath);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      license_key TEXT NOT NULL,
      tier TEXT NOT NULL,
      daily_limit INTEGER NOT NULL,
      machine_id TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      expires_at TEXT,
      last_validated TEXT NOT NULL,
      validation_response TEXT,
      subscription_status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processing_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      name TEXT,
      image_count INTEGER NOT NULL DEFAULT 0,
      color_counts TEXT,
      input_path TEXT,
      output_path TEXT,
      duration_seconds REAL,
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations — add columns to existing DBs
  try { db.prepare("SELECT name FROM processing_history LIMIT 1").get(); }
  catch { try { db.prepare("ALTER TABLE processing_history ADD COLUMN name TEXT").run(); } catch {} }

  // Seed default settings
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM settings').get();
  if (countRow && countRow.cnt === 0) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('theme', 'dark');
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('keep_originals', 'true');
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('nyckel_enabled', 'false');
  }

  console.log(`[database] Initialized at ${dbPath}`);
  return db;
}

module.exports = { initDatabase };
