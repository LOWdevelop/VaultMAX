import { generateEmbedding, deserializeEmbedding, cosineSimilarity } from '../embeddings/openai';
import { getAllByProject, normalizeProject } from '../db/client';

interface RecallInput {
  query: string;
  project?: string;
  limit?: number;
}

export async function recall(input: RecallInput) {
  const project = normalizeProject(input.project ?? process.env.PROJECT ?? 'default');
  const limit = input.limit ?? 5;

  try {
    const queryEmbedding = await generateEmbedding(input.query);
    const memories = getAllByProject(project);

    return memories
      .map((m) => {
        const similarity = cosineSimilarity(queryEmbedding, deserializeEmbedding(m.embedding));
        const weight = 1 + (m.importance - 3) * 0.1; // 0.8..1.2
        return {
          id: m.id,
          content: m.content,
          type: m.type,
          tags: JSON.parse(m.tags) as string[],
          importance: m.importance,
          similarity: parseFloat(similarity.toFixed(3)),
          score: parseFloat((similarity * weight).toFixed(3)),
          created_at: m.created_at,
        };
      })
      .filter((m) => m.similarity >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
