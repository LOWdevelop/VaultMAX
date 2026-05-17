import path from 'path';
import { deleteMemory } from '../db/client';
import { removeFromVault } from '../vault/writer';

interface ForgetInput {
  memory_id: string;
  project?: string;
}

export async function forget(input: ForgetInput) {
  const project = input.project ?? process.env.PROJECT ?? 'default';
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), 'vaults');

  try {
    deleteMemory(input.memory_id);
    removeFromVault(project, input.memory_id, vaultPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
