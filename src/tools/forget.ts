import { deleteMemory } from '../db/client';
import { removeFromVault } from '../vault/writer';
import { getToolContext } from './context';

interface ForgetInput {
  memory_id: string;
  project?: string;
}

export async function forget(input: ForgetInput, clientRoots?: any[]) {
  const { project, vaultPath } = getToolContext(input.project, clientRoots);

  try {
    deleteMemory(input.memory_id);
    removeFromVault(project, input.memory_id, vaultPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
