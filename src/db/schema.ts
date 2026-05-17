import { DatabaseSync } from 'node:sqlite';

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('decision', 'error', 'map', 'change')),
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      embedding TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type, project);
  `);
}
