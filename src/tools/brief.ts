import { generateEmbedding, deserializeEmbedding, cosineSimilarity } from '../embeddings/openai';
import { getAllByProject, normalizeProject } from '../db/client';

interface BriefInput {
  query: string;
  project?: string;
}

/**
 * One-shot context bundle for the calling AI:
 *  - constraints (always shown — inviolable rules)
 *  - map        (latest project state)
 *  - decisions  (3 most recent)
 *  - lessons    (3 most recent)
 *  - relevant   (top semantic matches for the current task)
 */
export async function brief(input: BriefInput) {
  const project = normalizeProject(input.project ?? process.env.PROJECT ?? 'default');

  try {
    const all = getAllByProject(project);

    if (all.length === 0) {
      return {
        project,
        empty: true,
        message:
          'No memories yet for this project. Start by saving a map (vaultmax_remember type="map") and any constraints.',
      };
    }

    const constraints = all
      .filter((m) => m.type === 'constraint')
      .sort((a, b) => b.importance - a.importance)
      .map((m) => ({
        id: m.id,
        content: m.content,
        tags: JSON.parse(m.tags) as string[],
      }));

    const latestMap = all
      .filter((m) => m.type === 'map')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

    const recent_decisions = all
      .filter((m) => m.type === 'decision')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3)
      .map((m) => ({ id: m.id, content: m.content, date: m.created_at, importance: m.importance }));

    const recent_lessons = all
      .filter((m) => m.type === 'lesson')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 3)
      .map((m) => ({ id: m.id, content: m.content, date: m.created_at, importance: m.importance }));

    const queryEmbedding = await generateEmbedding(input.query);
    const relevant_memories = all
      .filter((m) => m.type !== 'constraint' && m.type !== 'map')
      .map((m) => {
        const sim = cosineSimilarity(queryEmbedding, deserializeEmbedding(m.embedding));
        const weight = 1 + (m.importance - 3) * 0.1;
        return {
          id: m.id,
          content: m.content,
          type: m.type,
          importance: m.importance,
          similarity: parseFloat(sim.toFixed(3)),
          score: sim * weight,
          date: m.created_at,
        };
      })
      .filter((m) => m.similarity >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        similarity: m.similarity,
        date: m.date,
      }));

    return {
      project,
      constraints,
      map: latestMap
        ? { id: latestMap.id, content: latestMap.content, date: latestMap.created_at }
        : null,
      recent_decisions,
      recent_lessons,
      relevant_memories,
      stats: {
        total_memories: all.length,
        constraints: constraints.length,
        decisions: all.filter((m) => m.type === 'decision').length,
        lessons: all.filter((m) => m.type === 'lesson').length,
        errors: all.filter((m) => m.type === 'error').length,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
