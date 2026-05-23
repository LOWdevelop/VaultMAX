import path from 'path';
import dotenv from 'dotenv';
// Load from process.cwd() first
dotenv.config();
// Load from VaultMAX root fallback
const rootEnv = path.join(__dirname, '..', '.env');
dotenv.config({ path: rootEnv });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { remember } from './tools/remember';
import { recall } from './tools/recall';
import { update } from './tools/update';
import { forget } from './tools/forget';
import { getMap } from './tools/map';
import { brief } from './tools/brief';
import { lesson } from './tools/lesson';
import { summarize } from './tools/summarize';
import { buildProfile } from './tools/profile';
import { promote } from './tools/promote';
import { observe } from './tools/observe';
import { supersede } from './tools/supersede';
import { handoff } from './tools/handoff';
import { rebuild } from './tools/rebuild';

const server = new McpServer({
  name: 'vaultmax',
  version: '2.1.0',
});

const json = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

const registerTool = (
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: (input: any, clientRoots?: any[]) => Promise<unknown> | unknown
) => {
  (server as any).registerTool(
    name,
    {
      description,
      inputSchema,
    },
    async (input: any) => {
      let clientRoots: any[] = [];
      try {
        const response = await (server as any).server.listRoots();
        clientRoots = response.roots || [];
      } catch (err) {
        // Fallback silently if roots capability is not supported
      }
      return json(await handler(input, clientRoots));
    }
  );
};

registerTool(
  'vaultmax_remember',
  'Store a memory in the vault. Types: "decision" (architectural choices), "error" (bugs+root cause), "map" (project structure), "change" (session log), "lesson" (preventive rule), "constraint" (inviolable rule). Duplicate memories (>92% similar) are auto-rejected. Default importance: 3 (5 for constraint, 4 for lesson).',
  {
    content: z.string().describe('The content to memorize'),
    type: z.enum(['decision', 'error', 'map', 'change', 'lesson', 'constraint']).describe('Memory type'),
    project: z.string().optional().describe('Project name (case-insensitive; defaults to PROJECT env var)'),
    tags: z.array(z.string()).optional().describe('Optional tags'),
    importance: z.number().min(1).max(5).optional().describe('Importance 1-5 (weighs recall results)'),
    filePath: z.string().optional().describe('Path to the code file relating to this memory for AST analysis'),
    symbols: z.array(z.string()).optional().describe('Explicit list of symbol names in this file to link to this memory'),
  },
  async (input: any, clientRoots?: any[]) => remember(input, clientRoots)
);

registerTool(
  'vaultmax_recall',
  'Semantic search across project memories. Results are weighted by importance (memories with importance 5 rank ~20% higher than importance 3). DEFAULT scope=auto: searches ALL projects with location boost (+0.30 current project, -0.10 others). Returns compact snippets (≤120 chars). Use vaultmax_observe to hydrate IDs you need.',
  {
    query: z.string().describe('Natural language search query'),
    project: z.string().optional().describe('Project name (case-insensitive; defaults to PROJECT env var)'),
    limit: z.number().optional().describe('Max results (default 5)'),
    expand: z.boolean().optional().describe('If true, returns full content inline instead of snippets (legacy mode)'),
    scope: z.enum(['auto', 'project', 'all']).optional().describe('auto (default): cross-project search with boost. project: only active project. all: no boost.'),
  },
  async (input: any, clientRoots?: any[]) => recall(input, clientRoots)
);

registerTool(
  'vaultmax_brief',
  'ONE-SHOT context bundle for the current task. Returns: all constraints (rules you must follow), latest project map, 3 recent decisions, 3 recent lessons, plus top semantic matches for the query. Use this AT THE START of any task instead of multiple recalls.',
  {
    query: z.string().describe('What you are about to work on'),
    project: z.string().optional().describe('Project name (case-insensitive)'),
    filePath: z.string().optional().describe('Path to the code file you are working on for AST symbol lookup'),
    cursorSymbol: z.string().optional().describe('Exact name of class or function under cursor for direct memory matching'),
  },
  async (input: any, clientRoots?: any[]) => brief(input, clientRoots)
);

registerTool(
  'vaultmax_observe',
  'Hydrate memory IDs with full content. Use after vaultmax_recall or vaultmax_brief returns compact snippets. Pick only the 2-3 IDs you actually need — this is the pay-only-what-you-read pattern that saves ~70% of context tokens.',
  {
    ids: z.array(z.string()).describe('List of memory IDs to hydrate with full content'),
  },
  async (input: any) => observe(input)
);

registerTool(
  'vaultmax_lesson',
  'Convert an error+solution pair into a preventive RULE via AI, then save it as a "lesson" memory. Lessons surface automatically in vaultmax_brief so future tasks avoid the same mistake.',
  {
    error_description: z.string().describe('What went wrong (be specific about cause)'),
    solution: z.string().describe('How it was fixed'),
    project: z.string().optional().describe('Project name (case-insensitive)'),
    tags: z.array(z.string()).optional().describe('Optional tags'),
  },
  async (input: any, clientRoots?: any[]) => lesson(input, clientRoots)
);

registerTool(
  'vaultmax_summarize_project',
  'Generate a fresh project map by analyzing ALL existing memories via AI. Saves the result as a new "map" memory so vaultmax_brief always returns up-to-date project state. Run this periodically after several changes.',
  {
    project: z.string().optional().describe('Project name (case-insensitive)'),
  },
  async (input: any, clientRoots?: any[]) => summarize(input, clientRoots)
);

registerTool(
  'vaultmax_update',
  'Update the content of an existing memory by its ID. Re-embeds the new content.',
  {
    memory_id: z.string().describe('ID of the memory to update'),
    new_content: z.string().describe('New content'),
    project: z.string().optional().describe('Project name (case-insensitive)'),
  },
  async (input: any, clientRoots?: any[]) => update(input, clientRoots)
);

registerTool(
  'vaultmax_forget',
  'Permanently delete a memory by its ID. Removes from both DB and .md vault.',
  {
    memory_id: z.string().describe('ID of the memory to delete'),
    project: z.string().optional().describe('Project name (case-insensitive)'),
  },
  async (input: any, clientRoots?: any[]) => forget(input, clientRoots)
);

registerTool(
  'vaultmax_map',
  'List all map-type memories for a project, newest first.',
  {
    project: z.string().optional().describe('Project name (case-insensitive)'),
  },
  async (input: any, clientRoots?: any[]) => getMap(input, clientRoots)
);

registerTool(
  'vaultmax_profile',
  'Compile all decisions, lessons, constraints, and project maps into a live professional profile with computed skill weights, project portfolios, and timelines. Generates /vaults/profile.md.',
  {
    dry_run: z.boolean().optional().describe('If true, only returns the markdown in the response without saving profile.md to disk'),
  },
  async (input: any) => buildProfile(input)
);

registerTool(
  'vaultmax_promote',
  'Promote multiple project-specific lesson memories with high similarity into a single unified universal-rule. Saves to SQLite global scope (project: "global") and vaults/global/lessons.md.',
  {
    memory_ids: z.array(z.string()).describe('List of SQLite lesson memory IDs to promote'),
    custom_summary: z.string().optional().describe('Optional custom unifed rule summary to use instead of OpenAI AI generation'),
  },
  async (input: any) => promote(input)
);

registerTool(
  'vaultmax_supersede',
  'Replace an outdated memory with a new version. The old memory is marked as "superseded" and preserved in history but hidden from recall/brief. Use when a decision, lesson, or constraint has been replaced by a newer one (e.g., "switched from Prisma to Drizzle"). Prevents contradictory context in the AI.',
  {
    old_memory_id: z.string().describe('ID of the memory being replaced'),
    new_content: z.string().describe('Updated content for the new active memory'),
    project: z.string().optional().describe('Project name (case-insensitive)'),
    tags: z.array(z.string()).optional().describe('Optional tags for the new memory'),
  },
  async (input: any, clientRoots?: any[]) => supersede(input, clientRoots)
);

registerTool(
  'vaultmax_handoff',
  'Generate a dense Markdown handoff bundle for a project. Contains all constraints, decisions, lessons, errors, project map, and recent changes compiled into a single file. Paste this into any AI context to instantly transfer full project knowledge. Saves to vaults/<project>/HANDOFF.md.',
  {
    project: z.string().optional().describe('Project name (case-insensitive)'),
    include_superseded: z.boolean().optional().describe('If true, includes superseded (historical) decisions for evolution context'),
  },
  async (input: any, clientRoots?: any[]) => handoff(input, clientRoots)
);

registerTool(
  'vaultmax_rebuild',
  'Force rebuild of all Markdown vaults by reading all memories from the SQLite database. Restores files in vaults/<project>/ directory, creating decisions.md, changelog.md, map.md, lessons.md, and constraints.md. Use this tool if files in vaults get deleted or go out-of-sync with SQLite.',
  {
    project: z.string().optional().describe('Project name (case-insensitive)')
  },
  async (input: any, clientRoots?: any[]) => rebuild(input, clientRoots)
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
