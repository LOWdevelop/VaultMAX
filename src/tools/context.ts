import { getVaultPath, resolveIdentity, resolveProject } from '../db/client';

export interface ToolContext {
  project: string;
  vaultPath: string;
  identity: string;
}

export function getToolContext(project?: string, clientRoots?: any[]): ToolContext {
  return {
    project: resolveProject(project, clientRoots),
    vaultPath: getVaultPath(),
    identity: resolveIdentity(),
  };
}

export async function withToolError<T>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
