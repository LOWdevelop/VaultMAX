import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { initSchema } from './schema';

export interface Memory {
  id: string;
  project: string;
  type: 'decision' | 'error' | 'map' | 'change';
  content: string;
  tags: string;
  embedding: string;
  created_at: string;
  updated_at: string;
}

let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!_db) {
    const dbPath = path.join(process.cwd(), 'vaultmax.db');
    _db = new DatabaseSync(dbPath);
    initSchema(_db);
  }
  return _db;
}

export function insertMemory(memory: Omit<Memory, 'created_at' | 'updated_at'>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO memories (id, project, type, content, tags, embedding)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(memory.id, memory.project, memory.type, memory.content, memory.tags, memory.embedding);
}

export function updateMemory(id: string, content: string, embedding: string): void {
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
  return getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as unknown as Memory | undefined;
}

export function getAllByProject(project: string): Memory[] {
  return getDb()
    .prepare('SELECT * FROM memories WHERE project = ?')
    .all(project) as unknown as Memory[];
}

export function getMapsByProject(project: string): Memory[] {
  return getDb()
    .prepare(
      `SELECT * FROM memories WHERE project = ? AND type = 'map'
       ORDER BY created_at DESC`
    )
    .all(project) as unknown as Memory[];
}
