import { generateEmbedding, deserializeEmbedding, cosineSimilarity } from '../embeddings/openai';
import { getAllByProject, getAllMemories, normalizeProject, getMemoriesBySymbol, Memory } from '../db/client';
import { detectLanguage, extractSymbolsAsync } from '../ast/parser';
import fs from 'fs';
import path from 'path';

interface BriefInput {
  query: string;
  project?: string;
  filePath?: string;
  cursorSymbol?: string;
}

/**
 * One-shot context bundle for the calling AI:
 *  - constraints (always shown — inviolable rules)
 *  - map        (latest project state)
 *  - decisions  (3 most recent)
 *  - lessons    (3 most recent)
 *  - bound      (memories bound specifically to symbols in the active file/cursor)
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

    // --- Chronode Feature Integration: Symbol-Bound Memories Retrieval ---
    const bound_memories: Array<{ id: string; snippet: string; type: string; symbol: string; tokens_full: number; file?: string }> = [];
    const boundIds = new Set<string>();

    const addBoundMemory = (m: Memory, symbol: string, file?: string) => {
      if (!boundIds.has(m.id)) {
        boundIds.add(m.id);
        bound_memories.push({
          id: m.id,
          snippet: m.content.slice(0, 120).replace(/\n/g, ' ').trim() + (m.content.length > 120 ? '…' : ''),
          type: m.type,
          symbol,
          tokens_full: Math.ceil(m.content.length / 4),
          file: file ? path.basename(file) : undefined,
        });
      }
    };

    // 1. Symbol-based cursor lookup
    if (input.cursorSymbol) {
      const cursorMemories = getMemoriesBySymbol(input.cursorSymbol);
      for (const m of cursorMemories) {
        addBoundMemory(m, input.cursorSymbol);
      }
    }

    // 2. File-based symbol lookup
    let targetFile = input.filePath;
    if (!targetFile && input.query) {
      // Auto-detect if query is a valid existing file path
      const maybePath = path.isAbsolute(input.query)
        ? input.query
        : path.resolve(process.cwd(), input.query);
      if (fs.existsSync(maybePath) && fs.statSync(maybePath).isFile()) {
        targetFile = maybePath;
      }
    }

    if (targetFile) {
      const absolutePath = path.isAbsolute(targetFile)
        ? targetFile
        : path.resolve(process.cwd(), targetFile);

      if (fs.existsSync(absolutePath)) {
        const code = fs.readFileSync(absolutePath, 'utf8');
        const lang = detectLanguage(absolutePath);
        const allSymbols = await extractSymbolsAsync(code, lang);

        for (const sym of allSymbols) {
          const symMemories = getMemoriesBySymbol(sym.name);
          for (const m of symMemories) {
            addBoundMemory(m, sym.name, absolutePath);
          }
        }
      }
    }

    // --- Cross-project search with location boost (Chronode §8.2) ---
    const queryEmbedding = await generateEmbedding(input.query);
    const allCrossProject = getAllMemories();

    const relevant_memories = allCrossProject
      .filter((m) => m.type !== 'constraint' && m.type !== 'map' && !boundIds.has(m.id))
      .map((m) => {
        const sim = cosineSimilarity(queryEmbedding, deserializeEmbedding(m.embedding));
        const importanceWeight = 1 + (m.importance - 3) * 0.1;
        const baseScore = sim * importanceWeight;

        // Location boost
        const memProject = normalizeProject(m.project);
        let boost = 0;
        if (memProject === project) {
          boost = 0.30;
        } else if (m.type === 'lesson') {
          boost = 0.10;
        } else {
          boost = -0.10;
        }
        boost = Math.max(-0.20, Math.min(0.30, boost));

        return {
          id: m.id,
          content: m.content,
          type: m.type,
          project: m.project,
          importance: m.importance,
          similarity: parseFloat(sim.toFixed(3)),
          score: baseScore + boost,
          date: m.created_at,
          tokens_full: Math.ceil(m.content.length / 4),
        };
      })
      .filter((m) => m.similarity >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        snippet: m.content.slice(0, 120).replace(/\n/g, ' ').trim() + (m.content.length > 120 ? '…' : ''),
        type: m.type,
        project: m.project,
        similarity: m.similarity,
        tokens_full: m.tokens_full,
        date: m.date,
      }));

    const total_tokens_if_expanded =
      relevant_memories.reduce((sum, m) => sum + m.tokens_full, 0) +
      bound_memories.reduce((sum, m) => sum + m.tokens_full, 0);

    return {
      project,
      constraints,
      map: latestMap
        ? { id: latestMap.id, content: latestMap.content, date: latestMap.created_at }
        : null,
      recent_decisions,
      recent_lessons,
      bound_memories,
      relevant_memories,
      total_tokens_if_expanded,
      hint: 'bound_memories and relevant_memories show snippets only. Use vaultmax_observe with IDs to get full content.',
      stats: {
        total_memories: all.length,
        constraints: constraints.length,
        decisions: all.filter((m) => m.type === 'decision').length,
        lessons: all.filter((m) => m.type === 'lesson').length,
        errors: all.filter((m) => m.type === 'error').length,
        bound_symbols: bound_memories.length,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
