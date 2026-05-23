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
import { insertMemory, getMemoryById, getAllByProject } from '../db/client';
import { appendToVault, RelatedMemory } from '../vault/writer';
import { getToolContext } from './context';

interface PromoteInput {
  memory_ids: string[];
  custom_summary?: string;
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
  }
  return _openai;
}

/**
 * Promotes multiple project-specific lesson memories into a single, unifed global rule.
 * Saves to both SQLite (with project 'global') and the vault under global/ lessons.
 */
export async function promote(input: PromoteInput) {
  const { vaultPath } = getToolContext('global');

  try {
    if (!input.memory_ids || input.memory_ids.length < 2) {
      return { success: false, error: 'Forneça ao menos 2 IDs de memórias para promover.' };
    }

    const memories = [];
    const missingIds = [];

    for (const id of input.memory_ids) {
      const mem = getMemoryById(id);
      if (mem) {
        memories.push(mem);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      return {
        success: false,
        error: `As seguintes memórias não foram encontradas no banco: ${missingIds.join(', ')}`,
      };
    }

    const nonLessons = memories.filter((m) => m.type !== 'lesson');
    if (nonLessons.length > 0) {
      return {
        success: false,
        error: `Apenas memórias do tipo 'lesson' podem ser promovidas. Tipo inválido encontrado.`,
      };
    }

    // 1. Unify the lessons into a single universal rule
    let rule = '';
    const lessonsList = memories.map((m) => `- [${m.project.toUpperCase()}] ${m.content}`).join('\n');

    if (input.custom_summary) {
      rule = input.custom_summary.trim();
    } else {
      const apiKey = process.env.OPENAI_API_KEY;
      const isKeyValid = apiKey && apiKey.startsWith('sk-') && !apiKey.includes('INSIRA_SUA_CHAVE_OPENAI_AQUI');

      if (isKeyValid) {
        try {
          const completion = await getOpenAI().chat.completions.create({
            model: OPENAI_CHAT_MODEL,
            messages: [
              {
                role: 'system',
                content:
                  'You are a senior software architect consolidating lessons learned across different projects. ' +
                  'Given multiple software engineering lessons learned, write ONE comprehensive, actionable universal rule ' +
                  '(max 3 sentences, clear and technical, imperative voice) that generalizes these lessons. ' +
                  'Output only the rule itself — no preamble, no quotes, no markdown.',
              },
              {
                role: 'user',
                content: `LESSONS TO CONSOLIDATE:\n\n${lessonsList}`,
              },
            ],
            temperature: 0.3,
            max_tokens: 300,
          });

          rule = completion.choices[0].message.content?.trim() ?? '';
        } catch (err) {
          console.warn('OpenAI API call failed, using local rule consolidation fallback:', err);
        }
      }

      if (!rule) {
        // Safe, clean offline fallback
        rule = `Evitar erros recorrentes observados nos projetos: ${memories.map((m) => m.project.toUpperCase()).join(', ')}.`;
      }
    }

    const content =
      `Universal Rule: ${rule}\n\n` +
      `Consolidated Evidences:\n` +
      memories.map((m) => `* [Project: ${m.project.toUpperCase()}] ${m.content}`).join('\n');

    const embedding = await generateEmbedding(content);

    // Find related memories in global scope
    const existing = getAllByProject('global');
    const related: RelatedMemory[] = existing
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
      .filter((m) => m.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const promotedId = uuidv4();
    const tags = ['auto', 'universal-rule', 'promoted'];

    // 2. Insert into SQLite global scope
    insertMemory({
      id: promotedId,
      project: 'global',
      type: 'lesson',
      content,
      tags: tags,
      embedding: serializeEmbedding(embedding.vector),
      embedding_model: embedding.model,
      importance: 5,
    });

    // 3. Save physical file to vaults/global
    appendToVault('global', 'lesson', content, promotedId, tags, 5, related, vaultPath);

    return {
      success: true,
      promoted_id: promotedId,
      rule_created: rule,
      evidence_memories_count: memories.length,
      saved_path: path.join(vaultPath, 'global', 'lessons.md'),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
