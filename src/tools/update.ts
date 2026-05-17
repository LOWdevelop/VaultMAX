import path from 'path';
import { generateEmbedding, serializeEmbedding } from '../embeddings/openai';
import { getMemoryById, updateMemory } from '../db/client';
import { updateInVault } from '../vault/writer';

interface UpdateInput {
  memory_id: string;
  new_content: string;
  project?: string;
}

export async function update(input: UpdateInput) {
  const project = input.project ?? process.env.PROJECT ?? 'default';
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), 'vaults');

  try {
    const existing = getMemoryById(input.memory_id);
    if (!existing) {
      return { success: false, error: `Memory ${input.memory_id} not found` };
    }

    const embedding = await generateEmbedding(input.new_content);
    updateMemory(input.memory_id, input.new_content, serializeEmbedding(embedding));
    updateInVault(project, input.memory_id, input.new_content, vaultPath);

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
