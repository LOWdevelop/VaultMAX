import { getMapsByProject, normalizeProject } from '../db/client';

interface MapInput {
  project?: string;
}

export async function getMap(input: MapInput) {
  const project = normalizeProject(input.project ?? process.env.PROJECT ?? 'default');

  try {
    return getMapsByProject(project).map((m) => ({
      id: m.id,
      content: m.content,
      tags: JSON.parse(m.tags) as string[],
      importance: m.importance,
      created_at: m.created_at,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
