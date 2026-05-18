import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  generateEmbedding,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
} from '../embeddings/openai';
import { insertMemory, getAllByProject, normalizeProject, MemoryType } from '../db/client';
import { appendToVault, RelatedMemory } from '../vault/writer';

interface RememberInput {
  content: string;
  project?: string;
  type: MemoryType;
  tags?: string[];
  importance?: number;
}

const DUPLICATE_THRESHOLD = 0.92;
const RELATED_THRESHOLD = 0.45;

function defaultImportance(type: MemoryType): number {
  if (type === 'constraint') return 5;
  if (type === 'lesson') return 4;
  return 3;
}

export async function remember(input: RememberInput) {
  const project = normalizeProject(input.project ?? process.env.PROJECT ?? 'default');
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), 'vaults');
  const importance = input.importance ?? defaultImportance(input.type);

  try {
    const embedding = await generateEmbedding(input.content);
    const existing = getAllByProject(project);

    // Score every existing memory once
    const scored = existing.map((m) => ({
      memory: m,
      score: cosineSimilarity(embedding, deserializeEmbedding(m.embedding)),
    }));

    // Duplicate detection
    const dup = scored.find((s) => s.score >= DUPLICATE_THRESHOLD);
    if (dup) {
      return {
        success: false,
        duplicate: true,
        existing_id: dup.memory.id,
        similarity: parseFloat(dup.score.toFixed(3)),
        message: `Memory is ${(dup.score * 100).toFixed(1)}% identical to ${dup.memory.id}. Not saved.`,
      };
    }

    // Top related (below duplicate threshold)
    const related: RelatedMemory[] = scored
      .filter((s) => s.score >= RELATED_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => ({ id: s.memory.id, content: s.memory.content, score: s.score }));

    const id = uuidv4();
    insertMemory({
      id,
      project,
      type: input.type,
      content: input.content,
      tags: JSON.stringify(input.tags ?? []),
      embedding: serializeEmbedding(embedding),
      importance,
    });

    appendToVault(
      project,
      input.type,
      input.content,
      id,
      input.tags ?? [],
      importance,
      related,
      vaultPath
    );

    return { success: true, id, importance, related_count: related.length, message: `Memory saved with id ${id}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
