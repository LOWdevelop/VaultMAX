import fs from 'fs';
import path from 'path';
import {
  getAllByProject,
  Memory,
  MemoryType,
  updateMemory,
  getAllProjects,
} from '../db/client';
import { appendToVault, ensureVaultExists } from '../vault/writer';
import { getToolContext } from './context';
import {
  deserializeEmbedding,
  cosineSimilarity,
  generateEmbedding,
  serializeEmbedding,
  OPENAI_EMBED_MODEL,
  isModelCompatible,
} from '../embeddings/openai';

interface RebuildInput {
  project?: string;
}

async function rebuildSingleProject(project: string, vaultPath: string, identity: string) {
  const allMemories = getAllByProject(project);

  // Clean up the existing markdown vault folder to start fresh
  // E.g., vaults/<project>/
  const projectDir = project === identity && identity
    ? path.join(vaultPath, '_profiles', identity)
    : path.join(vaultPath, project);

  if (fs.existsSync(projectDir)) {
    const memoriesDir = path.join(projectDir, 'memories');
    if (fs.existsSync(memoriesDir)) {
      fs.rmSync(memoriesDir, { recursive: true, force: true });
    }
    
    const indexes = ['decisions.md', 'changelog.md', 'map.md', 'lessons.md', 'constraints.md'];
    for (const idx of indexes) {
      const file = path.join(projectDir, idx);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  }

  if (allMemories.length === 0) {
    return {
      success: true,
      rebuilt_count: 0,
      healed_count: 0,
    };
  }

  // Re-create vault structure
  ensureVaultExists(project, vaultPath, identity);

  const apiKey = process.env.OPENAI_API_KEY;
  const isKeyValid = apiKey && apiKey.startsWith('sk-') && !apiKey.includes('INSIRA_SUA_CHAVE_OPENAI_AQUI');
  let healedCount = 0;

  // Sort by created_at ascending (oldest first) so they append in chronological order to index files
  const sortedMemories = [...allMemories].sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const m of sortedMemories) {
    // Auto-Healing: Re-embed legacy/mock embedding models using OpenAI text-embedding-3-small if key is valid
    if (isKeyValid && m.embedding_model !== OPENAI_EMBED_MODEL) {
      console.warn(`[VaultMAX Rebuild] Auto-healing memory ${m.id} (${m.embedding_model} -> ${OPENAI_EMBED_MODEL})...`);
      try {
        const embedding = await generateEmbedding(m.content);
        updateMemory(m.id, m.content, serializeEmbedding(embedding.vector), embedding.model);
        
        m.embedding = serializeEmbedding(embedding.vector);
        m.embedding_model = embedding.model;
        healedCount++;
      } catch (err) {
        console.error(`[VaultMAX Rebuild] Failed to auto-heal memory ${m.id}:`, err);
      }
    }

    const parsedTags = m.tags;

    // Calculate related memories (cos-sim >= 0.45, max 3)
    const mEmbedding = deserializeEmbedding(m.embedding);
    const related = sortedMemories
      .filter((other) => other.id !== m.id)
      .map((other) => {
        if (!isModelCompatible(m.embedding_model, other.embedding_model)) {
          return { other, score: 0 };
        }
        return {
          other,
          score: cosineSimilarity(mEmbedding, deserializeEmbedding(other.embedding)),
        };
      })
      .filter((r) => r.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => ({
        id: r.other.id,
        content: r.other.content,
        score: r.score,
      }));

    appendToVault(
      project,
      m.type,
      m.content,
      m.id,
      parsedTags,
      m.importance,
      related,
      vaultPath,
      identity
    );
  }

  return {
    success: true,
    rebuilt_count: sortedMemories.length,
    healed_count: healedCount,
  };
}

export async function rebuild(input: RebuildInput, clientRoots?: any[]) {
  const { project, vaultPath, identity } = getToolContext(input.project, clientRoots);

  try {
    if (input.project === 'all') {
      const projects = getAllProjects();
      let totalRebuilt = 0;
      let totalHealed = 0;
      const results = [];

      for (const proj of projects) {
        try {
          const res = await rebuildSingleProject(proj, vaultPath, identity);
          if (res.success) {
            totalRebuilt += res.rebuilt_count;
            totalHealed += res.healed_count;
            results.push(`${proj}: ${res.rebuilt_count} rebuilt, ${res.healed_count} healed`);
          }
        } catch (projErr) {
          results.push(`${proj}: FAILED (${projErr instanceof Error ? projErr.message : String(projErr)})`);
        }
      }

      return {
        success: true,
        project: 'all',
        rebuilt_count: totalRebuilt,
        healed_count: totalHealed,
        message: `Database-wide rebuild complete. ${projects.length} projects processed. Total ${totalRebuilt} memories restored, ${totalHealed} healed. Details: ${results.join(' | ')}`,
      };
    }

    const res = await rebuildSingleProject(project, vaultPath, identity);
    return {
      success: true,
      project,
      rebuilt_count: res.rebuilt_count,
      healed_count: res.healed_count,
      message: `Markdown vault for project '${project}' successfully rebuilt from SQLite database (${res.rebuilt_count} memories restored, ${res.healed_count} healed to ${OPENAI_EMBED_MODEL}).`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
