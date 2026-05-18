import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { initSchema } from './schema';

export type MemoryType = 'decision' | 'error' | 'map' | 'change' | 'lesson' | 'constraint';

export interface Memory {
  id: string;
  project: string;
  type: MemoryType;
  content: string;
  tags: string;
  embedding: Buffer;
  importance: number;
  created_at: string;
  updated_at: string;
}

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!_db) {
    // __dirname = dist/db — go two levels up to reach VaultMAX root
    const dbPath = path.join(__dirname, '..', '..', 'vaultmax.db');
    _db = new DatabaseSync(dbPath);
    initSchema(_db);
  }
  return _db;
}

export function normalizeProject(project: string): string {
  return project.toLowerCase().trim();
}

export function insertMemory(memory: Omit<Memory, 'created_at' | 'updated_at'>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO memories (id, project, type, content, tags, embedding, importance)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    memory.id,
    normalizeProject(memory.project),
    memory.type,
    memory.content,
    memory.tags,
    memory.embedding,
    memory.importance
  );
}

export function updateMemory(id: string, content: string, embedding: Buffer): void {
  getDb()
    .prepare(
      `UPDATE memories SET content = ?, embedding = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(content, embedding, id);
}

export function deleteMemory(id: string): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export function getMemoryById(id: string): Memory | undefined {
  return getDb()
    .prepare('SELECT * FROM memories WHERE id = ?')
    .get(id) as unknown as Memory | undefined;
}

export function getAllByProject(project: string): Memory[] {
  return getDb()
    .prepare('SELECT * FROM memories WHERE project = ?')
    .all(normalizeProject(project)) as unknown as Memory[];
}

export function getMapsByProject(project: string): Memory[] {
  return getDb()
    .prepare(
      `SELECT * FROM memories WHERE project = ? AND type = 'map'
       ORDER BY created_at DESC`
    )
    .all(normalizeProject(project)) as unknown as Memory[];
}

export function getByTypeAndProject(project: string, type: MemoryType, limit?: number): Memory[] {
  const sql = `SELECT * FROM memories WHERE project = ? AND type = ? ORDER BY created_at DESC${limit ? ' LIMIT ?' : ''}`;
  const stmt = getDb().prepare(sql);
  if (limit) {
    return stmt.all(normalizeProject(project), type, limit) as unknown as Memory[];
  }
  return stmt.all(normalizeProject(project), type) as unknown as Memory[];
}
