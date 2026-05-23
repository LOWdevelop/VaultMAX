import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { initSchema } from './schema';

export type MemoryType = 'decision' | 'error' | 'map' | 'change' | 'lesson' | 'constraint';

export interface Memory {
  id: string;
  project: string;
  type: MemoryType;
  content: string;
  tags: string[];
  embedding: Buffer;
  embedding_model: string;
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
    // Optimization for multi-window Cursor concurrency (WAL and busy_timeout)
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA busy_timeout = 5000;');
    initSchema(_db);
  }
  return _db;
}

/**
 * Runs `fn` inside a SQL transaction. All DB writes performed by `fn` either
 * commit together or roll back together — used so a memory + its symbol
 * bindings can never be half-written. `fn` must be synchronous (do any async
 * work, e.g. embeddings or file parsing, before calling this).
 */
export function runInTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function normalizeProject(project: string): string {
  const normalized = project
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized === 'global' ? 'global' : normalized;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function resolveWorkspacePath(): string | undefined {
  const candidates = [
    process.env.CURSOR_WORKSPACE_PATH,
    process.env.VSCODE_WORKSPACE_PATH,
    process.env.WORKSPACE_PATH,
    process.env.CURSOR_CWD,
    process.env.INIT_CWD,
    process.cwd(),
  ];

  const raw = firstNonEmpty(...candidates);
  if (!raw) return undefined;

  return path.basename(raw.replace(/[\\/]+$/, ''));
}

export function resolveIdentity(): string {
  const candidates = [
    process.env.VAULT_PROFILE_NAME,
    process.env.VAULT_OWNER,
    process.env.VAULT_IDENTITY,
    process.env.PROFILE_NAME,
  ];
  return normalizeProject(firstNonEmpty(...candidates) ?? 'floriani');
}

export function resolveProject(project?: string, clientRoots?: any[]): string {
  if (project && project.trim()) return normalizeProject(project);

  // 1. Dynamic Resolution via MCP listRoots (Real-Time IDE Workspace Folder)
  if (clientRoots && clientRoots.length > 0) {
    const firstRoot = clientRoots[0];
    const name = firstRoot.name || '';
    if (name && name.trim()) {
      return normalizeProject(name);
    }
    try {
      const parsedPath = fileURLToPath(firstRoot.uri);
      const base = path.basename(parsedPath);
      if (base && base !== path.parse(base).root) {
        return normalizeProject(base);
      }
    } catch {
      const match = firstRoot.uri.match(/\/([^/]+)\/?$/);
      if (match && match[1]) {
        return normalizeProject(match[1]);
      }
    }
  }

  // 2. Local Environment & CWD Fallbacks
  const workspaceName = resolveWorkspacePath();
  if (workspaceName && workspaceName !== path.parse(workspaceName).root) {
    return normalizeProject(workspaceName);
  }

  const envProject = process.env.PROJECT;
  if (envProject && envProject.trim()) return normalizeProject(envProject);

  return 'default';
}

export function isGlobalProject(project?: string): boolean {
  return normalizeProject(project ?? '') === 'global';
}

export function getVaultPath(): string {
  // If global env/dotenv specifies central VAULT_PATH, prioritize it!
  if (process.env.VAULT_PATH && process.env.VAULT_PATH.trim()) {
    return process.env.VAULT_PATH;
  }
  const workspace = resolveWorkspacePath();
  const baseDir = process.env.VAULT_PATH_BASE ?? process.cwd();

  if (workspace && workspace !== 'default') {
    return path.join(baseDir, 'vaults');
  }

  return path.join(process.cwd(), 'vaults');
}

// Row mapper helper
function mapRowToMemory(row: any): Memory {
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(row.tags);
  } catch {
    parsedTags = row.tags ? row.tags.split(',').map((t: string) => t.trim()) : [];
  }

  return {
    id: row.id,
    project: row.project,
    type: row.type as MemoryType,
    content: row.content,
    tags: parsedTags,
    embedding: row.embedding as Buffer,
    embedding_model: row.embedding_model,
    importance: row.importance,
    status: row.status as 'active' | 'superseded',
    superseded_by: row.superseded_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function insertMemory(memory: Omit<Memory, 'created_at' | 'updated_at' | 'status' | 'superseded_by'>): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO memories (id, project, type, content, tags, embedding, embedding_model, importance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    memory.id,
    normalizeProject(memory.project),
    memory.type,
    memory.content,
    JSON.stringify(memory.tags),
    memory.embedding,
    memory.embedding_model,
    memory.importance
  );
}

export function updateMemory(id: string, content: string, embedding: Buffer, embeddingModel: string): void {
  getDb()
    .prepare(
      `UPDATE memories SET content = ?, embedding = ?, embedding_model = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(content, embedding, embeddingModel, id);
}

export function deleteMemory(id: string): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export function getMemoryById(id: string): Memory | undefined {
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id);
  return row ? mapRowToMemory(row) : undefined;
}

export function getAllByProject(project: string): Memory[] {
  const rows = getDb()
    .prepare('SELECT * FROM memories WHERE project = ? AND status = ?')
    .all(normalizeProject(project), 'active');
  return rows.map(mapRowToMemory);
}

export function getMapsByProject(project: string): Memory[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories WHERE project = ? AND type = 'map'
       ORDER BY created_at DESC`
    )
    .all(normalizeProject(project));
  return rows.map(mapRowToMemory);
}

export function getByTypeAndProject(project: string, type: MemoryType, limit?: number): Memory[] {
  const sql = `SELECT * FROM memories WHERE project = ? AND type = ? ORDER BY created_at DESC${limit ? ' LIMIT ?' : ''}`;
  const stmt = getDb().prepare(sql);
  const rows = limit
    ? stmt.all(normalizeProject(project), type, limit)
    : stmt.all(normalizeProject(project), type);
  return rows.map(mapRowToMemory);
}

export function getAllMemories(): Memory[] {
  const rows = getDb().prepare('SELECT * FROM memories WHERE status = ? ORDER BY created_at DESC').all('active');
  return rows.map(mapRowToMemory);
}

/** Returns every distinct project name that has at least one memory. */
export function getAllProjects(): string[] {
  return (
    getDb().prepare('SELECT DISTINCT project FROM memories').all() as unknown as { project: string }[]
  ).map((r) => r.project);
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
  const rows = getDb()
    .prepare('SELECT * FROM memories WHERE project = ? AND status = ? ORDER BY updated_at DESC')
    .all(normalizeProject(project), 'superseded');
  return rows.map(mapRowToMemory);
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

export function getMemoriesBySymbol(symbolName: string, project?: string): Memory[] {
  const db = getDb();
  if (project && project.trim()) {
    const rows = db
      .prepare(
        `SELECT m.* FROM memories m
         JOIN symbol_bindings s ON m.id = s.memory_id
         WHERE s.symbol_name = ? AND m.project = ?
         ORDER BY m.created_at DESC`
      )
      .all(symbolName, normalizeProject(project));
    return rows.map(mapRowToMemory);
  }
  const rows = db
    .prepare(
      `SELECT m.* FROM memories m
       JOIN symbol_bindings s ON m.id = s.memory_id
       WHERE s.symbol_name = ?
       ORDER BY m.created_at DESC`
    )
    .all(symbolName);
  return rows.map(mapRowToMemory);
}
