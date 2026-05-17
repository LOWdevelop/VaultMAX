import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { generateEmbedding, serializeEmbedding } from '../embeddings/openai';
import { insertMemory } from '../db/client';
import { appendToVault } from '../vault/writer';

interface RememberInput {
  content: string;
  project?: string;
  type: 'decision' | 'error' | 'map' | 'change';
  tags?: string[];
}

export async function remember(input: RememberInput) {
  const project = input.project ?? process.env.PROJECT ?? 'default';
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), 'vaults');

  try {
    const embedding = await generateEmbedding(input.content);
    const id = uuidv4();

    insertMemory({
      id,
      project,
      type: input.type,
      content: input.content,
      tags: JSON.stringify(input.tags ?? []),
      embedding: serializeEmbedding(embedding),
    });

    appendToVault(project, input.type, input.content, id, vaultPath);

    return { success: true, id, message: `Memory saved with id ${id}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
