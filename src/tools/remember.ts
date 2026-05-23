import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import {
  generateEmbedding,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
  isModelCompatible,
} from '../embeddings/openai';
import { insertMemory, getAllByProject, MemoryType, bindSymbol, runInTransaction } from '../db/client';
import { appendToVault, RelatedMemory } from '../vault/writer';
import { detectLanguage, extractSymbolsAsync } from '../ast/parser';
import { getToolContext } from './context';

interface RememberInput {
  content: string;
  project?: string;
  type: MemoryType;
  tags?: string[];
  importance?: number;
  filePath?: string;
  symbols?: string[];
}

const DUPLICATE_THRESHOLD = 0.92;
const RELATED_THRESHOLD = 0.45;

function defaultImportance(type: MemoryType): number {
  if (type === 'constraint') return 5;
  if (type === 'lesson') return 4;
  return 3;
}

export async function remember(input: RememberInput, clientRoots?: any[]) {
  const { project, vaultPath, identity } = getToolContext(input.project, clientRoots);
  const importance = input.importance ?? defaultImportance(input.type);

  try {
    const embedding = await generateEmbedding(input.content);
    const existing = getAllByProject(project);

    // Score every existing memory once, skipping incompatible vector spaces
    const scored = existing.map((m) => {
      if (!isModelCompatible(embedding.model, m.embedding_model)) {
        return { memory: m, score: 0 };
      }
      return {
        memory: m,
        score: cosineSimilarity(embedding.vector, deserializeEmbedding(m.embedding)),
      };
    });

    // Duplicate detection
    const dup = scored.find((s) => s.score >= DUPLICATE_THRESHOLD);
    if (dup) {
      return {
        success: false,
        duplicate: true,
        existing_id: dup.memory.id,
        similarity: parseFloat(dup.score.toFixed(3)),
        message: `Memory is ${(dup.score * 100).toFixed(1)}% identical to ${dup.memory.id}. Not saved.`,
      };
    }

    // Top related (below duplicate threshold)
    const related: RelatedMemory[] = scored
      .filter((s) => s.score >= RELATED_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => ({ id: s.memory.id, content: s.memory.content, score: s.score }));

    const id = uuidv4();
    const symbolsToBind: Array<{ name: string; type: string; path: string }> = [];
    const boundSymbols: string[] = [];

    // --- AST Symbol Indexing & Linking (Chronode Feature Integration) ---
    if (input.filePath) {
      const absolutePath = path.isAbsolute(input.filePath)
        ? input.filePath
        : path.resolve(process.cwd(), input.filePath);

      if (fs.existsSync(absolutePath)) {
        const code = fs.readFileSync(absolutePath, 'utf8');
        const lang = detectLanguage(absolutePath);
        const allSymbols = await extractSymbolsAsync(code, lang);

        const contentLower = input.content.toLowerCase();

        // 1. Auto-bind any symbol that is mentioned in the memory content
        for (const sym of allSymbols) {
          if (contentLower.includes(sym.name.toLowerCase())) {
            symbolsToBind.push({ name: sym.name, type: sym.type, path: absolutePath });
            boundSymbols.push(`${sym.type}:${sym.name}`);
          }
        }

        // 2. Explicit symbols binding
        if (input.symbols && input.symbols.length > 0) {
          for (const symName of input.symbols) {
            const matched = allSymbols.find((s) => s.name.toLowerCase() === symName.toLowerCase());
            const symType = matched ? matched.type : 'function';
            
            if (!boundSymbols.includes(`${symType}:${symName}`)) {
              symbolsToBind.push({ name: symName, type: symType, path: absolutePath });
              boundSymbols.push(`${symType}:${symName}`);
            }
          }
        }
      }
    }

    // Wrap database writes in a SQL transaction
    runInTransaction(() => {
      insertMemory({
        id,
        project,
        type: input.type,
        content: input.content,
        tags: input.tags ?? [],
        embedding: serializeEmbedding(embedding.vector),
        embedding_model: embedding.model,
        importance,
      });

      for (const sym of symbolsToBind) {
        bindSymbol(id, sym.name, sym.type, sym.path);
      }
    });

    appendToVault(
      project,
      input.type,
      input.content,
      id,
      input.tags ?? [],
      importance,
      related,
      vaultPath,
      identity
    );

    return {
      success: true,
      id,
      importance,
      related_count: related.length,
      bound_symbols: boundSymbols,
      message: `Memory saved with id ${id}${boundSymbols.length > 0 ? ` and bound to symbols: ${boundSymbols.join(', ')}` : ''}`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
