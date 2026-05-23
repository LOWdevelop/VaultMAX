import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  generateEmbedding,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
  isModelCompatible,
  OPENAI_CHAT_MODEL,
} from '../embeddings/openai';
import { insertMemory, getAllByProject, runInTransaction } from '../db/client';
import { appendToVault, RelatedMemory } from '../vault/writer';
import { getToolContext } from './context';

interface SummarizeInput {
  project?: string;
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
  return _openai;
}

/**
 * Reads every memory for the project and produces a fresh project map via OpenAI.
 * The map is saved as a new `map` memory (history preserved) and also appears
 * as the latest map in vaultmax_brief / vaultmax_map.
 */
export async function summarize(input: SummarizeInput, clientRoots?: any[]) {
  const { project, vaultPath } = getToolContext(input.project, clientRoots);

  try {
    const all = getAllByProject(project);
    if (all.length === 0) {
      return { success: false, error: `No memories found for project "${project}"` };
    }

    const ordered = [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const memoryText = ordered
      .map((m) => `[${m.type} · imp=${m.importance} · ${m.created_at}] ${m.content}`)
      .join('\n\n');

    const apiKey = process.env.OPENAI_API_KEY;
    const isKeyValid = apiKey && apiKey.startsWith('sk-') && !apiKey.includes('INSIRA_SUA_CHAVE_OPENAI_AQUI');
    let summary = '';

    if (isKeyValid) {
      try {
        const completion = await getOpenAI().chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'Generate a concise project map (max 500 words) covering: ' +
                '(1) current architecture — key files, modules, technologies; ' +
                '(2) conventions and patterns adopted; ' +
                '(3) known limitations or open issues. ' +
                'Use plain markdown, headings no deeper than ##, be specific, no fluff, no preamble.',
            },
            {
              role: 'user',
              content: `Memories from project "${project}" (oldest first):\n\n${memoryText}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 1200,
        });

        summary = completion.choices[0].message.content?.trim() ?? '';
      } catch (err) {
        console.warn("OpenAI API call failed, using local summary fallback:", err);
      }
    }

    if (!summary) {
      summary = `## Project Map — ${project.toUpperCase()}\n\n` +
        `Este mapa do projeto foi compilado localmente em ${new Date().toLocaleDateString('pt-BR')}.\n\n` +
        `### Memórias Registradas (${all.length} itens):\n` +
        ordered.map((m) => `- **[${m.type.toUpperCase()}]** (imp=${m.importance}): ${m.content.split('\n')[0]}`).join('\n');
    }

    const embedding = await generateEmbedding(summary);
    const related: RelatedMemory[] = all
      .map((m) => {
        if (!isModelCompatible(embedding.model, m.embedding_model)) {
          return { id: m.id, content: m.content, score: 0 };
        }
        return {
          id: m.id,
          content: m.content,
          score: cosineSimilarity(embedding.vector, deserializeEmbedding(m.embedding)),
        };
      })
      .filter((m) => m.score >= 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const id = uuidv4();
    const tags = ['summary', 'auto'];

    // Wrap database write in a SQL transaction
    runInTransaction(() => {
      insertMemory({
        id,
        project,
        type: 'map',
        content: summary,
        tags: tags,
        embedding: serializeEmbedding(embedding.vector),
        embedding_model: embedding.model,
        importance: 4,
      });
    });

    appendToVault(project, 'map', summary, id, tags, 4, related, vaultPath);

    return {
      success: true,
      id,
      summary,
      source_memories: all.length,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
