import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import {
  generateEmbedding,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
} from '../embeddings/openai';
import { insertMemory, getAllByProject, normalizeProject, MemoryType, bindSymbol } from '../db/client';
import { appendToVault, RelatedMemory } from '../vault/writer';
import { detectLanguage, extractSymbolsAsync } from '../ast/parser';

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

export async function remember(input: RememberInput) {
  const project = normalizeProject(input.project ?? process.env.PROJECT ?? 'default');
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), 'vaults');
  const importance = input.importance ?? defaultImportance(input.type);

  try {
    const embedding = await generateEmbedding(input.content);
    const existing = getAllByProject(project);

    // Score every existing memory once
    const scored = existing.map((m) => ({
      memory: m,
      score: cosineSimilarity(embedding, deserializeEmbedding(m.embedding)),
    }));

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
    insertMemory({
      id,
      project,
      type: input.type,
      content: input.content,
      tags: JSON.stringify(input.tags ?? []),
      embedding: serializeEmbedding(embedding),
      importance,
    });

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
            bindSymbol(id, sym.name, sym.type, absolutePath);
            boundSymbols.push(`${sym.type}:${sym.name}`);
          }
        }

        // 2. Explicit symbols binding
        if (input.symbols && input.symbols.length > 0) {
          for (const symName of input.symbols) {
            const matched = allSymbols.find((s) => s.name.toLowerCase() === symName.toLowerCase());
            const symType = matched ? matched.type : 'function';
            
            if (!boundSymbols.includes(`${symType}:${symName}`)) {
              bindSymbol(id, symName, symType, absolutePath);
              boundSymbols.push(`${symType}:${symName}`);
            }
          }
        }
      }
    }

    appendToVault(
      project,
      input.type,
      input.content,
      id,
      input.tags ?? [],
      importance,
      related,
      vaultPath
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
