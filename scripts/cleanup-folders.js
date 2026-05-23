/**
 * VaultMAX Legacy Folder Cleanup Script
 *
 * Removes physical directories in vaults/ that have spaces or special characters
 * in their names, but ONLY if the normalized (slugified) directory already exists.
 * This resolves UI duplication issues in Obsidian/Cursor.
 */

const fs = require('fs');
const path = require('path');

const vaultsDir = path.join(__dirname, '..', 'vaults');

function normalizeProject(project) {
  if (!project || !project.trim()) return '';

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
  if (!fs.existsSync(vaultsDir)) {
    console.error('❌ Diretório vaults/ não encontrado');
    process.exit(1);
  }

  const items = fs.readdirSync(vaultsDir);
  let deletedCount = 0;

  console.log('🔍 Analisando diretórios físicos em vaults/...\n');

  for (const item of items) {
    const fullPath = path.join(vaultsDir, item);
    const stat = fs.statSync(fullPath);

    if (!stat.isDirectory() || item.startsWith('.') || item.startsWith('_')) {
      continue;
    }

    const normalized = normalizeProject(item);
    if (normalized && normalized !== item) {
      const normalizedPath = path.join(vaultsDir, normalized);
      
      // Only delete if the normalized folder exists
      if (fs.existsSync(normalizedPath)) {
        console.log(`🗑️ Deletando pasta legada duplicada: "${item}" ➔ (Mantendo "${normalized}")`);
        fs.rmSync(fullPath, { recursive: true, force: true });
        deletedCount++;
      } else {
        console.log(`⚠️ Alerta: Pasta "${item}" precisa ser normalizada para "${normalized}", mas a pasta destino não existe.`);
      }
    }
  }

  console.log(`\n✅ Limpeza de pastas físicas concluída! ${deletedCount} pastas legadas deletadas.`);
}

run();
