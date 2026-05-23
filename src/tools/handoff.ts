import { getAllByProject, getSupersededMemories, Memory } from '../db/client';
import { getToolContext } from './context';
import fs from 'fs';
import path from 'path';

interface HandoffInput {
  project?: string;
  include_superseded?: boolean;
}

/**
 * Generates a dense Markdown handoff bundle for a project.
 * Contains everything another AI or developer needs to take over:
 *   - Project identity and stack
 *   - Constraints (inviolable rules)
 *   - Active decisions (with rationale)
 *   - Lessons learned (preventive rules)
 *   - Latest project map
 *   - Error history
 *   - Optionally: superseded decisions (evolution timeline)
 *
 * Inspired by Chronode UC-9 Knowledge Handoff.
 */
export function handoff(input: HandoffInput, clientRoots?: any[]) {
  const { project, vaultPath } = getToolContext(input.project, clientRoots);
  const includeSuperseeded = input.include_superseded ?? false;

  const all = getAllByProject(project);
  if (all.length === 0) {
    return { error: `No memories found for project '${project}'.` };
  }

  const constraints = all.filter((m) => m.type === 'constraint').sort((a, b) => b.importance - a.importance);
  const decisions = all.filter((m) => m.type === 'decision').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lessons = all.filter((m) => m.type === 'lesson').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const errors = all.filter((m) => m.type === 'error').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const maps = all.filter((m) => m.type === 'map').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const changes = all.filter((m) => m.type === 'change').sort((a, b) => b.created_at.localeCompare(a.created_at));

  const superseded = includeSuperseeded ? getSupersededMemories(project) : [];

  const lines: string[] = [];

  // Header
  lines.push(`# 🔄 HANDOFF BUNDLE — ${project.toUpperCase()}`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Total active memories: ${all.length}`);
  lines.push('');
  lines.push('This bundle contains everything you need to take over this project.');
  lines.push('Read it top-to-bottom before writing any code.');
  lines.push('');

  // Constraints
  if (constraints.length > 0) {
    lines.push('---');
    lines.push('## 🚫 CONSTRAINTS (Inviolable Rules)');
    lines.push('');
    lines.push('> These rules must NEVER be violated. They are non-negotiable.');
    lines.push('');
    for (const c of constraints) {
      const tags = parseTags(c);
      lines.push(`### ⛔ [importance: ${c.importance}]${tags ? ` ${tags}` : ''}`);
      lines.push(c.content);
      lines.push('');
    }
  }

  // Project Map (latest only)
  if (maps.length > 0) {
    lines.push('---');
    lines.push('## 🗺️ PROJECT MAP (Current State)');
    lines.push(`> Last updated: ${maps[0].created_at}`);
    lines.push('');
    lines.push(maps[0].content);
    lines.push('');
  }

  // Decisions
  if (decisions.length > 0) {
    lines.push('---');
    lines.push('## 🏛️ ACTIVE DECISIONS');
    lines.push('');
    for (const d of decisions) {
      const tags = parseTags(d);
      lines.push(`### 📌 Decision (${d.created_at})${tags ? ` ${tags}` : ''}`);
      lines.push(d.content);
      lines.push('');
    }
  }

  // Lessons
  if (lessons.length > 0) {
    lines.push('---');
    lines.push('## 📚 LESSONS LEARNED');
    lines.push('');
    lines.push('> Preventive rules derived from past mistakes. Follow these to avoid repeating errors.');
    lines.push('');
    for (const l of lessons) {
      const tags = parseTags(l);
      lines.push(`### 💡 Lesson (${l.created_at})${tags ? ` ${tags}` : ''}`);
      lines.push(l.content);
      lines.push('');
    }
  }

  // Errors
  if (errors.length > 0) {
    lines.push('---');
    lines.push('## 🐛 ERROR HISTORY');
    lines.push('');
    for (const e of errors) {
      lines.push(`### ❌ Error (${e.created_at})`);
      lines.push(e.content);
      lines.push('');
    }
  }

  // Changes (last 10)
  if (changes.length > 0) {
    lines.push('---');
    lines.push(`## 📝 RECENT CHANGES (last ${Math.min(changes.length, 10)})`);
    lines.push('');
    for (const c of changes.slice(0, 10)) {
      lines.push(`- **${c.created_at}:** ${c.content.slice(0, 200)}${c.content.length > 200 ? '…' : ''}`);
    }
    lines.push('');
  }

  // Superseded decisions (evolution timeline)
  if (superseded.length > 0) {
    lines.push('---');
    lines.push('## 🕰️ SUPERSEDED DECISIONS (Historical)');
    lines.push('');
    lines.push('> These decisions have been replaced. Shown for context on how the project evolved.');
    lines.push('');
    for (const s of superseded) {
      lines.push(`### ~~${s.type}~~ (${s.created_at}) → replaced by \`${s.superseded_by}\``);
      lines.push(s.content);
      lines.push('');
    }
  }

  // Stats footer
  lines.push('---');
  lines.push('## 📊 STATS');
  lines.push('');
  lines.push(`| Type | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Constraints | ${constraints.length} |`);
  lines.push(`| Decisions | ${decisions.length} |`);
  lines.push(`| Lessons | ${lessons.length} |`);
  lines.push(`| Errors | ${errors.length} |`);
  lines.push(`| Maps | ${maps.length} |`);
  lines.push(`| Changes | ${changes.length} |`);
  if (superseded.length > 0) {
    lines.push(`| Superseded | ${superseded.length} |`);
  }
  lines.push(`| **Total Active** | **${all.length}** |`);
  lines.push('');

  const markdown = lines.join('\n');

  // Save to vaults/<project>/HANDOFF.md
  const vaultsDir = path.join(vaultPath, project);
  if (!fs.existsSync(vaultsDir)) fs.mkdirSync(vaultsDir, { recursive: true });
  const handoffPath = path.join(vaultsDir, 'HANDOFF.md');
  fs.writeFileSync(handoffPath, markdown, 'utf8');

  return {
    project,
    path: handoffPath,
    stats: {
      constraints: constraints.length,
      decisions: decisions.length,
      lessons: lessons.length,
      errors: errors.length,
      maps: maps.length,
      changes: changes.length,
      superseded: superseded.length,
      total_active: all.length,
    },
    tokens_estimate: Math.ceil(markdown.length / 4),
    message: `Handoff bundle saved to ${handoffPath}. Paste this into any AI's context to transfer full project knowledge.`,
  };
}

function parseTags(m: Memory): string {
  const tags = m.tags;
  return tags && tags.length > 0 ? `[${tags.join(', ')}]` : '';
}
