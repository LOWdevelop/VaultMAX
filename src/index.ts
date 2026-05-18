import 'dotenv/config';
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

const server = new McpServer({
  name: 'vaultmax',
  version: '2.0.0',
});

// Flat interface avoids TS2589 deep generic instantiation in MCP SDK v1.29 types
interface ToolReg {
  registerTool(
    name: string,
    config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
    cb: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
  ): void;
}
const srv = server as unknown as ToolReg;

const json = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

srv.registerTool(
  'vaultmax_remember',
  {
    description:
      'Store a memory in the vault. Types: ' +
      '"decision" (architectural choices), "error" (bugs+root cause), "map" (project structure), ' +
      '"change" (session log), "lesson" (preventive rule), "constraint" (inviolable rule). ' +
      'Duplicate memories (>92% similar) are auto-rejected. Default importance: 3 (5 for constraint, 4 for lesson).',
    inputSchema: {
      content: z.string().describe('The content to memorize'),
      type: z
        .enum(['decision', 'error', 'map', 'change', 'lesson', 'constraint'])
        .describe('Memory type'),
      project: z.string().optional().describe('Project name (case-insensitive; defaults to PROJECT env var)'),
      tags: z.array(z.string()).optional().describe('Optional tags'),
      importance: z.number().min(1).max(5).optional().describe('Importance 1-5 (weighs recall results)'),
    },
  },
  async (input) => {
    const result = await remember(
      input as {
        content: string;
        type: 'decision' | 'error' | 'map' | 'change' | 'lesson' | 'constraint';
        project?: string;
        tags?: string[];
        importance?: number;
      }
    );
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_recall',
  {
    description:
      'Semantic search across project memories. Results are weighted by importance ' +
      '(memories with importance 5 rank ~20% higher than importance 3).',
    inputSchema: {
      query: z.string().describe('Natural language search query'),
      project: z.string().optional().describe('Project name (case-insensitive; defaults to PROJECT env var)'),
      limit: z.number().optional().describe('Max results (default 5)'),
    },
  },
  async (input) => {
    const result = await recall(input as { query: string; project?: string; limit?: number });
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_brief',
  {
    description:
      'ONE-SHOT context bundle for the current task. Returns: all constraints (rules you must follow), ' +
      'latest project map, 3 recent decisions, 3 recent lessons, plus top semantic matches for the query. ' +
      'Use this AT THE START of any task instead of multiple recalls.',
    inputSchema: {
      query: z.string().describe('What you are about to work on'),
      project: z.string().optional().describe('Project name (case-insensitive)'),
    },
  },
  async (input) => {
    const result = await brief(input as { query: string; project?: string });
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_lesson',
  {
    description:
      'Convert an error+solution pair into a preventive RULE via AI, then save it as a "lesson" memory. ' +
      'Lessons surface automatically in vaultmax_brief so future tasks avoid the same mistake.',
    inputSchema: {
      error_description: z.string().describe('What went wrong (be specific about cause)'),
      solution: z.string().describe('How it was fixed'),
      project: z.string().optional().describe('Project name (case-insensitive)'),
      tags: z.array(z.string()).optional().describe('Optional tags'),
    },
  },
  async (input) => {
    const result = await lesson(
      input as { error_description: string; solution: string; project?: string; tags?: string[] }
    );
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_summarize_project',
  {
    description:
      'Generate a fresh project map by analyzing ALL existing memories via AI. ' +
      'Saves the result as a new "map" memory so vaultmax_brief always returns up-to-date project state. ' +
      'Run this periodically after several changes.',
    inputSchema: {
      project: z.string().optional().describe('Project name (case-insensitive)'),
    },
  },
  async (input) => {
    const result = await summarize(input as { project?: string });
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_update',
  {
    description: 'Update the content of an existing memory by its ID. Re-embeds the new content.',
    inputSchema: {
      memory_id: z.string().describe('ID of the memory to update'),
      new_content: z.string().describe('New content'),
      project: z.string().optional().describe('Project name (case-insensitive)'),
    },
  },
  async (input) => {
    const result = await update(
      input as { memory_id: string; new_content: string; project?: string }
    );
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_forget',
  {
    description: 'Permanently delete a memory by its ID. Removes from both DB and .md vault.',
    inputSchema: {
      memory_id: z.string().describe('ID of the memory to delete'),
      project: z.string().optional().describe('Project name (case-insensitive)'),
    },
  },
  async (input) => {
    const result = await forget(input as { memory_id: string; project?: string });
    return json(result);
  }
);

srv.registerTool(
  'vaultmax_map',
  {
    description: 'List all map-type memories for a project, newest first.',
    inputSchema: {
      project: z.string().optional().describe('Project name (case-insensitive)'),
    },
  },
  async (input) => {
    const result = await getMap(input as { project?: string });
    return json(result);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
