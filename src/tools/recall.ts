import path from 'path';
import { generateEmbedding, deserializeEmbedding, cosineSimilarity } from '../embeddings/openai';
import { getAllByProject } from '../db/client';

interface RecallInput {
  query: string;
  project?: string;
  limit?: number;
}

export async function recall(input: RecallInput) {
  const project = input.project ?? process.env.PROJECT ?? 'default';
  const limit = input.limit ?? 5;

  try {
    const queryEmbedding = await generateEmbedding(input.query);
    const memories = getAllByProject(project);

    return memories
      .map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        tags: JSON.parse(m.tags) as string[],
        score: cosineSimilarity(queryEmbedding, deserializeEmbedding(m.embedding)),
        created_at: m.created_at,
      }))
      .filter((m) => m.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
