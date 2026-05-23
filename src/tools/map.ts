import { getMapsByProject, resolveProject } from '../db/client';

interface MapInput {
  project?: string;
}

export async function getMap(input: MapInput, clientRoots?: any[]) {
  const project = resolveProject(input.project, clientRoots);

  try {
    return getMapsByProject(project).map((m) => ({
      id: m.id,
      content: m.content,
      tags: m.tags,
      importance: m.importance,
      created_at: m.created_at,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
