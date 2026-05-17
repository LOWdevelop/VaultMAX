import { getMapsByProject } from '../db/client';

interface MapInput {
  project?: string;
}

export async function getMap(input: MapInput) {
  const project = input.project ?? process.env.PROJECT ?? 'default';

  try {
    return getMapsByProject(project).map((m) => ({
      id: m.id,
      content: m.content,
      tags: JSON.parse(m.tags) as string[],
      created_at: m.created_at,
    }));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
