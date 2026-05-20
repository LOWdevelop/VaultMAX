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
  status: 'active' | 'superseded';
  superseded_by: string | null;
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

export function insertMemory(memory: Omit<Memory, 'created_at' | 'updated_at' | 'status' | 'superseded_by'>): void {
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
    .prepare('SELECT * FROM memories WHERE project = ? AND status = ?')
    .all(normalizeProject(project), 'active') as unknown as Memory[];
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

export function getAllMemories(): Memory[] {
  return getDb().prepare('SELECT * FROM memories WHERE status = ? ORDER BY created_at DESC').all('active') as unknown as Memory[];
}

export function supersedeMemory(oldId: string, newId: string): void {
  getDb()
    .prepare(
      `UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(newId, oldId);
}

export function getSupersededMemories(project: string): Memory[] {
  return getDb()
    .prepare('SELECT * FROM memories WHERE project = ? AND status = ? ORDER BY updated_at DESC')
    .all(normalizeProject(project), 'superseded') as unknown as Memory[];
}

export interface SymbolBinding {
  symbol_name: string;
  symbol_type: string;
  file_path: string;
}

export function bindSymbol(memoryId: string, symbolName: string, symbolType: string, filePath: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO symbol_bindings (memory_id, symbol_name, symbol_type, file_path)
     VALUES (?, ?, ?, ?)`
  ).run(memoryId, symbolName, symbolType, filePath);
}

export function getSymbolBindings(memoryId: string): SymbolBinding[] {
  return getDb()
    .prepare('SELECT symbol_name, symbol_type, file_path FROM symbol_bindings WHERE memory_id = ?')
    .all(memoryId) as unknown as SymbolBinding[];
}

export function getMemoriesBySymbol(symbolName: string): Memory[] {
  return getDb()
    .prepare(
      `SELECT m.* FROM memories m
       JOIN symbol_bindings s ON m.id = s.memory_id
       WHERE s.symbol_name = ?
       ORDER BY m.created_at DESC`
    )
    .all(symbolName) as unknown as Memory[];
}

