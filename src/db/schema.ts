import { DatabaseSync } from 'node:sqlite';

const CURRENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('decision', 'error', 'map', 'change', 'lesson', 'constraint')),
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    embedding BLOB NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'unknown',
    importance INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded')),
    superseded_by TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type, project);
  CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);

  CREATE TABLE IF NOT EXISTS symbol_bindings (
    memory_id TEXT,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_symbol_bindings_memory ON symbol_bindings(memory_id);
  CREATE INDEX IF NOT EXISTS idx_symbol_bindings_name ON symbol_bindings(symbol_name);
`;

interface ColumnInfo { name: string; type: string }
interface OldRow {
  id: string;
  project: string;
  type: string;
  content: string;
  tags: string;
  embedding: string | Buffer | Uint8Array;
  importance?: number;
  created_at: string;
  updated_at: string;
}

export function initSchema(db: DatabaseSync): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
    .all();

  if (tables.length === 0) {
    db.exec(CURRENT_SCHEMA);
    return;
  }

  const cols = db.prepare('PRAGMA table_info(memories)').all() as unknown as ColumnInfo[];
  const hasImportance = cols.some((c) => c.name === 'importance');
  const embCol = cols.find((c) => c.name === 'embedding');
  const embeddingIsBlob = embCol?.type.toUpperCase() === 'BLOB';

  const tableSql = (db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'")
    .get() as unknown as { sql: string }).sql;
  const hasNewTypes = tableSql.includes("'lesson'") && tableSql.includes("'constraint'");

  const hasStatus = cols.some((c) => c.name === 'status');
  const hasEmbeddingModel = cols.some((c) => c.name === 'embedding_model');

  if (!hasImportance || !embeddingIsBlob || !hasNewTypes) {
    migrate(db);
  } else {
    db.exec(CURRENT_SCHEMA);
  }

  // Incremental migration: add bi-temporal columns if missing
  if (!hasStatus) {
    console.error('[VaultMAX] Adding bi-temporal columns (status, superseded_by)...');
    db.exec(`ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
    db.exec(`ALTER TABLE memories ADD COLUMN superseded_by TEXT DEFAULT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status)`);
    console.error('[VaultMAX] Bi-temporal migration complete.');
  }

  // Incremental migration: track which embedding model produced each vector.
  // Existing rows are tagged 'unknown' (treated as compatible with any model
  // on recall). New rows are tagged with a concrete model so vectors from
  // incompatible spaces are never compared. See embeddings/openai.ts.
  if (!hasEmbeddingModel) {
    console.error('[VaultMAX] Adding embedding_model column...');
    db.exec(`ALTER TABLE memories ADD COLUMN embedding_model TEXT NOT NULL DEFAULT 'unknown'`);
    console.error('[VaultMAX] embedding_model migration complete.');
  }
}

function migrate(db: DatabaseSync): void {
  console.error('[VaultMAX] Migrating database schema (TEXT->BLOB embeddings, +importance, +lesson/constraint, lowercased project)...');

  const rows = db.prepare('SELECT * FROM memories').all() as unknown as OldRow[];

  db.exec('DROP TABLE IF EXISTS memories_new');
  db.exec(`
    CREATE TABLE memories_new (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('decision', 'error', 'map', 'change', 'lesson', 'constraint')),
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      embedding BLOB NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insert = db.prepare(`
    INSERT INTO memories_new (id, project, type, content, tags, embedding, importance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    let embBuf: Buffer;
    if (typeof row.embedding === 'string') {
      const arr = new Float32Array(JSON.parse(row.embedding) as number[]);
      embBuf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    } else if (row.embedding instanceof Uint8Array) {
      embBuf = Buffer.from(row.embedding);
    } else {
      embBuf = row.embedding as Buffer;
    }

    insert.run(
      row.id,
      row.project.toLowerCase().trim(),
      row.type,
      row.content,
      row.tags,
      embBuf,
      row.importance ?? 3,
      row.created_at,
      row.updated_at
    );
  }

  db.exec('DROP TABLE memories');
  db.exec('ALTER TABLE memories_new RENAME TO memories');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type, project);
  `);

  console.error(`[VaultMAX] Migrated ${rows.length} memories.`);
}
