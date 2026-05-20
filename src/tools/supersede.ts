import { v4 as uuid } from 'uuid';
import { generateEmbedding, serializeEmbedding } from '../embeddings/openai';
import {
  getMemoryById,
  insertMemory,
  supersedeMemory,
  normalizeProject,
} from '../db/client';

interface SupersedeInput {
  old_memory_id: string;
  new_content: string;
  project?: string;
  tags?: string[];
}

/**
 * Bi-temporal supersede: marks the old memory as 'superseded' and creates
 * a new active memory with the updated content. The old memory is preserved
 * for historical timeline but filtered from recall/brief by default.
 *
 * Inspired by Chronode SDD §6.1 / §8.4 bi-temporality model.
 */
export async function supersede(input: SupersedeInput) {
  const oldMem = getMemoryById(input.old_memory_id);
  if (!oldMem) {
    return { error: `Memory '${input.old_memory_id}' not found.` };
  }

  if (oldMem.status === 'superseded') {
    return {
      error: `Memory '${input.old_memory_id}' is already superseded by '${oldMem.superseded_by}'.`,
    };
  }

  const project = normalizeProject(input.project ?? oldMem.project);
  const newId = uuid();

  // Generate embedding for the new content
  const embedding = await generateEmbedding(input.new_content);
  const embeddingBuf = serializeEmbedding(embedding);

  // Create the new active memory (inherits type and importance from old)
  insertMemory({
    id: newId,
    project,
    type: oldMem.type as 'decision' | 'error' | 'map' | 'change' | 'lesson' | 'constraint',
    content: input.new_content,
    tags: JSON.stringify(input.tags ?? JSON.parse(oldMem.tags)),
    embedding: embeddingBuf,
    importance: oldMem.importance,
  });

  // Mark old memory as superseded
  supersedeMemory(input.old_memory_id, newId);

  return {
    superseded: {
      old_id: input.old_memory_id,
      old_snippet: oldMem.content.slice(0, 120) + (oldMem.content.length > 120 ? '…' : ''),
      status: 'superseded',
    },
    created: {
      new_id: newId,
      type: oldMem.type,
      project,
      snippet: input.new_content.slice(0, 120) + (input.new_content.length > 120 ? '…' : ''),
      status: 'active',
    },
    message: `Old memory superseded. New active memory created. The old version is preserved in history but hidden from recall/brief.`,
  };
}
