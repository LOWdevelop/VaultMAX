import { generateEmbedding, deserializeEmbedding, cosineSimilarity, isModelCompatible } from '../embeddings/openai';
import { getAllByProject, getAllMemories, normalizeProject } from '../db/client';
import { getToolContext } from './context';

interface RecallInput {
  query: string;
  project?: string;
  limit?: number;
  expand?: boolean;
  scope?: 'auto' | 'project' | 'all';
}

/**
 * Location boost weights — inspired by Chronode SDD §8.2.
 * Applied additively post-scoring; capped at [−0.20, +0.30].
 *
 *   Current project:        +0.30
 *   Constraints (global):   +0.25
 *   Lessons (cross-proj):   +0.10
 *   Other projects:         −0.10
 */
const BOOST = {
  CURRENT_PROJECT: 0.30,
  CONSTRAINT:      0.25,
  LESSON:          0.10,
  OTHER_PROJECT:  -0.10,
} as const;

function clampBoost(b: number): number {
  return Math.max(-0.20, Math.min(0.30, b));
}

/**
 * Semantic search with progressive disclosure + cross-project boost.
 *
 * scope:
 *   "auto"    (default) — searches ALL memories, boosts current project hits
 *   "project" — old behavior, only the active project
 *   "all"     — all memories, no boost applied (flat ranking)
 */
export async function recall(input: RecallInput, clientRoots?: any[]) {
  const { project } = getToolContext(input.project, clientRoots);
  const limit = input.limit ?? 5;
  const expand = input.expand ?? false;
  const scope = input.scope ?? 'auto';

  try {
    const queryEmbedding = await generateEmbedding(input.query);

    // Decide which memories to search
    const memories = scope === 'project'
      ? getAllByProject(project)
      : getAllMemories();

    const ranked = memories
      .map((m) => {
        // Calculate temporal decay based on age and memory type
        const isoDateString = m.created_at.replace(' ', 'T');
        const mDate = new Date(isoDateString);
        const diffTime = Math.abs(Date.now() - mDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;

        let decay = 1.0;
        if (m.type === 'change' || m.type === 'error') {
          // Half-life ~90 days
          decay = Math.exp(-diffDays / 130);
        } else if (m.type === 'decision' || m.type === 'lesson') {
          // Half-life ~360 days
          decay = Math.exp(-diffDays / 520);
        } // constraint and map have decay = 1.0

        // Floor the decay so older memories are not completely lost
        decay = Math.max(0.4, decay);

        let similarity = 0;
        if (isModelCompatible(queryEmbedding.model, m.embedding_model)) {
          similarity = cosineSimilarity(queryEmbedding.vector, deserializeEmbedding(m.embedding));
        }
        const importanceWeight = 1 + (m.importance - 3) * 0.1; // 0.8..1.2
        const baseScore = similarity * importanceWeight * decay;

        // Apply location boost (only in 'auto' scope)
        let boost = 0;
        if (scope === 'auto') {
          const memProject = normalizeProject(m.project);
          if (memProject === project) {
            boost = BOOST.CURRENT_PROJECT;
          } else if (m.type === 'constraint') {
            boost = BOOST.CONSTRAINT;
          } else if (m.type === 'lesson') {
            boost = BOOST.LESSON;
          } else {
            boost = BOOST.OTHER_PROJECT;
          }
          boost = clampBoost(boost);
        }

        const finalScore = baseScore + boost;

        return {
          id: m.id,
          content: m.content,
          type: m.type,
          project: m.project,
          tags: m.tags,
          importance: m.importance,
          similarity: parseFloat(similarity.toFixed(3)),
          score: parseFloat(finalScore.toFixed(3)),
          boost: scope === 'auto' ? parseFloat(boost.toFixed(2)) : undefined,
          created_at: m.created_at,
          tokens_full: Math.ceil(m.content.length / 4),
        };
      })
      .filter((m) => m.similarity >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (expand) {
      return ranked.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        project: m.project,
        tags: m.tags,
        importance: m.importance,
        similarity: m.similarity,
        score: m.score,
        boost: m.boost,
        created_at: m.created_at,
      }));
    }

    const total_tokens_if_expanded = ranked.reduce((sum, m) => sum + m.tokens_full, 0);

    return {
      scope,
      active_project: project,
      hits: ranked.map((m) => ({
        id: m.id,
        type: m.type,
        project: m.project,
        snippet: m.content.slice(0, 120).replace(/\n/g, ' ').trim() + (m.content.length > 120 ? '…' : ''),
        score: m.score,
        similarity: m.similarity,
        boost: m.boost,
        importance: m.importance,
        tokens_full: m.tokens_full,
        created_at: m.created_at,
      })),
      total_tokens_if_expanded,
      hint: 'Use vaultmax_observe with the IDs you need to see full content.',
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
