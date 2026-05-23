import path from 'path';
import { generateEmbedding, serializeEmbedding } from '../embeddings/openai';
import { getMemoryById, updateMemory } from '../db/client';
import { updateInVault } from '../vault/writer';
import { getToolContext } from './context';

interface UpdateInput {
  memory_id: string;
  new_content: string;
  project?: string;
}

export async function update(input: UpdateInput, clientRoots?: any[]) {
  const { project, vaultPath } = getToolContext(input.project, clientRoots);

  try {
    const existing = getMemoryById(input.memory_id);
    if (!existing) {
      return { success: false, error: `Memory ${input.memory_id} not found` };
    }

    const embedding = await generateEmbedding(input.new_content);
    updateMemory(input.memory_id, input.new_content, serializeEmbedding(embedding.vector), embedding.model);
    updateInVault(project, input.memory_id, input.new_content, vaultPath);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
