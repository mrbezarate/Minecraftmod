import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'database.sqlite');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

// Promisify database methods
export const run = promisify(db.run.bind(db));
export const get = promisify(db.get.bind(db));
export const all = promisify(db.all.bind(db));

export async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      server_address TEXT NOT NULL,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      final_stats TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS task_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      parameters TEXT,
      result TEXT,
      FOREIGN KEY (session_id) REFERENCES bot_sessions(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      key TEXT NOT NULL,
      data TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES bot_sessions(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS decision_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      context TEXT NOT NULL,
      action_taken TEXT NOT NULL,
      success_rate REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES task_history(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS location_data (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      z REAL NOT NULL,
      dimension TEXT DEFAULT 'overworld',
      metadata TEXT,
      FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
    )
  `);

  // Create indexes
  await run(`CREATE INDEX IF NOT EXISTS idx_sessions_username ON bot_sessions(username)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON task_history(session_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(memory_type)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_locations_coords ON location_data(x, z)`);

  // Initial data if empty
  const hasPriorities = await get("SELECT id FROM memory_entries WHERE id = 'default_priorities'");
  if (!hasPriorities) {
    await run(`
      INSERT INTO memory_entries (id, session_id, memory_type, key, data, importance) VALUES
      ('default_priorities', 'system', 'configuration', 'task_priorities', 
      '{"exploration": 0.7, "mining": 0.8, "building": 0.6, "combat": 0.3, "crafting": 0.5}', 1.0)
    `);
  }

  const hasSafety = await get("SELECT id FROM memory_entries WHERE id = 'safety_rules'");
  if (!hasSafety) {
    await run(`
      INSERT INTO memory_entries (id, session_id, memory_type, key, data, importance) VALUES
      ('safety_rules', 'system', 'configuration', 'safety_config',
      '{"hostile_detection_range": 20, "shelter_search_range": 50, "emergency_health_threshold": 6}', 1.0)
    `);
  }
}

export default db;
