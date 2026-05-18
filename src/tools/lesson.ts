import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  generateEmbedding,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
} from '../embeddings/openai';
import { insertMemory, getAllByProject, normalizeProject } from '../db/client';
import { appendToVault, RelatedMemory } from '../vault/writer';

interface LessonInput {
  error_description: string;
  solution: string;
  project?: string;
  tags?: string[];
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Generates a preventive rule from an error+solution pair via OpenAI,
 * then stores it as a `lesson` memory. Lessons are surfaced in vaultmax_brief
 * so weaker AIs see them before making the same mistake again.
 */
export async function lesson(input: LessonInput) {
  const project = normalizeProject(input.project ?? process.env.PROJECT ?? 'default');
  const vaultPath = process.env.VAULT_PATH ?? path.join(process.cwd(), 'vaults');

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You generate concise preventive rules. Given an error and its solution, write ONE actionable rule (max 2 sentences, imperative voice) that prevents the error from recurring. Output only the rule itself — no preamble, no quotes, no markdown.',
        },
        {
          role: 'user',
          content: `ERROR:\n${input.error_description}\n\nSOLUTION:\n${input.solution}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const rule = completion.choices[0].message.content?.trim() ?? '';
    if (!rule) {
      return { success: false, error: 'OpenAI returned empty rule' };
    }

    const content =
      `Rule: ${rule}\n\n` +
      `Context — Error: ${input.error_description}\n` +
      `Context — Solution: ${input.solution}`;

    const embedding = await generateEmbedding(content);
    const existing = getAllByProject(project);
    const related: RelatedMemory[] = existing
      .map((m) => ({
        id: m.id,
        content: m.content,
        score: cosineSimilarity(embedding, deserializeEmbedding(m.embedding)),
      }))
      .filter((m) => m.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const id = uuidv4();
    const tags = input.tags ?? [];

    insertMemory({
      id,
      project,
      type: 'lesson',
      content,
      tags: JSON.stringify(tags),
      embedding: serializeEmbedding(embedding),
      importance: 4,
    });

    appendToVault(project, 'lesson', content, id, tags, 4, related, vaultPath);

    return { success: true, id, rule, related_count: related.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
