/**
 * VaultMAX Project Name Normalization Script
 *
 * Slugifies project names in the SQLite database to ensure:
 * 1. Clean query resolution via `getAllByProject()`
 * 2. Proper markdown vault generation during `vaultmax_rebuild`
 * 3. Consistent semantic matching across all tools
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { DatabaseSync } = require('node:sqlite');
const dbPath = path.join(__dirname, '..', 'vaultmax.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

function normalizeProject(project) {
  if (!project || !project.trim()) {
    return 'goviews'; // Specialized fallback for the specific empty project memory
  }

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

function run() {
  const memories = db.prepare('SELECT id, project FROM memories').all();
  let updatedCount = 0;

  console.log(`\n🔍 Verificando ${memories.length} memórias para normalização de projetos...`);

  db.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = db.prepare('UPDATE memories SET project = ? WHERE id = ?');
    
    for (const m of memories) {
      const normalized = normalizeProject(m.project);
      if (normalized !== m.project) {
        console.log(`🔄 [${m.id.slice(0, 8)}] '${m.project}' ➔ '${normalized}'`);
        updateStmt.run(normalized, m.id);
        updatedCount++;
      }
    }
    
    db.exec('COMMIT;');
    console.log(`\n✅ Sucesso! ${updatedCount} memórias atualizadas.`);
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('❌ Erro durante a transação:', err);
    process.exit(1);
  }
}

run();
