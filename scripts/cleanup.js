/**
 * VaultMAX Surgical Cleanup Script
 *
 * 1. Remove duplicate lessons/maps in 'vaultmax' project (same content, keep newest)
 * 2. Re-embed all 177 'unknown' model memories using OpenAI text-embedding-3-small
 *
 * Run: node scripts/cleanup.js
 */

const path = require('path');
const dotenv = require('dotenv');

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { getAllMemories, getAllProjects } = require('../dist/db/client');

// ─── Direct DB access for delete + update ───────────────────────────────────

const { DatabaseSync } = require('node:sqlite');
const dbPath = path.join(__dirname, '..', 'vaultmax.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

function deleteMemory(id) {
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  db.prepare('DELETE FROM symbol_bindings WHERE memory_id = ?').run(id);
}

function updateEmbedding(id, embeddingBuffer, model) {
  db.prepare('UPDATE memories SET embedding = ?, embedding_model = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(embeddingBuffer, model, id);
}

// ─── OpenAI embedding ────────────────────────────────────────────────────────

const https = require('https');

function generateEmbeddingOpenAI(text) {
  return new Promise((resolve, reject) => {
    const truncated = text.slice(0, 30000);
    const body = JSON.stringify({
      model: 'text-embedding-3-small',
      input: truncated,
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const vector = parsed.data[0].embedding;
          // Serialize to Float32 Buffer (same as serializeEmbedding in openai.ts)
          const buf = Buffer.allocUnsafe(vector.length * 4);
          for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i], i * 4);
          resolve({ vector: buf, model: 'text-embedding-3-small' });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !apiKey.startsWith('sk-')) {
    console.error('❌ OPENAI_API_KEY não encontrada ou inválida no .env');
    process.exit(1);
  }
  console.log('✅ Chave OpenAI carregada:', apiKey.slice(0, 12) + '...');

  const memories = getAllMemories();
  console.log(`\n📊 Total de memórias no banco: ${memories.length}`);

  // ── FASE 1: Remover duplicatas no projeto vaultmax ──────────────────────────

  console.log('\n═══════════════════════════════════════════');
  console.log('FASE 1: Limpeza de duplicatas no projeto vaultmax');
  console.log('═══════════════════════════════════════════');

  const vaultmax = memories.filter(m => m.project === 'vaultmax');

  // Group lessons by normalized content (first 80 chars)
  const lessonGroups = {};
  for (const m of vaultmax.filter(m => m.type === 'lesson')) {
    const key = m.content.slice(0, 80);
    if (!lessonGroups[key]) lessonGroups[key] = [];
    lessonGroups[key].push(m);
  }

  let deletedCount = 0;
  for (const [key, group] of Object.entries(lessonGroups)) {
    if (group.length <= 1) continue;
    // Sort by created_at desc (newest first), keep first, delete rest
    group.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const keep = group[0];
    const toDelete = group.slice(1);
    console.log(`\n🔁 Lesson duplicada (${group.length}x): "${key.slice(0, 60)}..."`);
    console.log(`   ✅ Mantendo: ${keep.id.slice(0, 8)} (${keep.created_at})`);
    for (const dup of toDelete) {
      deleteMemory(dup.id);
      console.log(`   🗑️  Deletado: ${dup.id.slice(0, 8)} (${dup.created_at})`);
      deletedCount++;
    }
  }

  // Group maps by project — keep only the newest, delete older versions
  const mapGroups = {};
  for (const m of vaultmax.filter(m => m.type === 'map')) {
    if (!mapGroups['vaultmax']) mapGroups['vaultmax'] = [];
    mapGroups['vaultmax'].push(m);
  }

  for (const [proj, group] of Object.entries(mapGroups)) {
    if (group.length <= 1) continue;
    group.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const keep = group[0];
    const toDelete = group.slice(1);
    console.log(`\n🗺️  Maps redundantes no projeto '${proj}' (${group.length}x)`);
    console.log(`   ✅ Mantendo: ${keep.id.slice(0, 8)} (${keep.created_at.slice(0, 19)})`);
    for (const dup of toDelete) {
      deleteMemory(dup.id);
      console.log(`   🗑️  Deletado: ${dup.id.slice(0, 8)} (${dup.created_at.slice(0, 19)})`);
      deletedCount++;
    }
  }

  console.log(`\n✅ Fase 1 concluída: ${deletedCount} duplicatas removidas`);

  // ── FASE 2: Auto-healing — re-embedar memórias com model 'unknown' ──────────

  console.log('\n═══════════════════════════════════════════');
  console.log('FASE 2: Auto-healing — re-embed model unknown → text-embedding-3-small');
  console.log('═══════════════════════════════════════════');

  // Refresh memories list after deletions
  const memoriesAfterCleanup = getAllMemories();
  const unknownMemories = memoriesAfterCleanup.filter(
    m => m.embedding_model === 'unknown' || m.embedding_model === 'local-hash-v1'
  );

  console.log(`\n🔄 ${unknownMemories.length} memórias precisam de re-embedding...`);

  let healedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < unknownMemories.length; i++) {
    const m = unknownMemories[i];
    const prefix = `[${(i + 1).toString().padStart(3)}/${unknownMemories.length}]`;
    process.stdout.write(`${prefix} ${m.project}/${m.type} ${m.id.slice(0, 8)}... `);

    try {
      const { vector, model } = await generateEmbeddingOpenAI(m.content);
      updateEmbedding(m.id, vector, model);
      healedCount++;
      console.log('✅');

      // Small delay to respect OpenAI rate limits
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      failedCount++;
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`✅ LIMPEZA CONCLUÍDA`);
  console.log(`   Duplicatas removidas:  ${deletedCount}`);
  console.log(`   Memórias re-embeddadas: ${healedCount}`);
  console.log(`   Falhas:                 ${failedCount}`);
  console.log(`   Total final no banco:   ${getAllMemories().length}`);
  console.log(`═══════════════════════════════════════════`);
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
