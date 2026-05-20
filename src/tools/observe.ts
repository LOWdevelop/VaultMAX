import { getMemoryById } from '../db/client';

interface ObserveInput {
  ids: string[];
}

/**
 * Hydrates a set of memory IDs with their full content.
 * Designed for progressive disclosure: after recall/brief returns compact snippets,
 * the LLM picks 2-3 IDs that matter and calls observe() to get full text.
 * This saves ~70% of context tokens vs always returning full content.
 */
export function observe(input: ObserveInput) {
  if (!input.ids || input.ids.length === 0) {
    return { error: 'Provide at least 1 memory ID to observe.' };
  }

  const results: Array<{
    id: string;
    content: string;
    type: string;
    project: string;
    tags: string[];
    importance: number;
    created_at: string;
  }> = [];

  const missing: string[] = [];

  for (const id of input.ids) {
    const mem = getMemoryById(id);
    if (mem) {
      results.push({
        id: mem.id,
        content: mem.content,
        type: mem.type,
        project: mem.project,
        tags: JSON.parse(mem.tags) as string[],
        importance: mem.importance,
        created_at: mem.created_at,
      });
    } else {
      missing.push(id);
    }
  }

  return {
    observations: results,
    missing_ids: missing.length > 0 ? missing : undefined,
    count: results.length,
  };
}
