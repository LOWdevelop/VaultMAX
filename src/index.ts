import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { remember } from './tools/remember';
import { recall } from './tools/recall';
import { update } from './tools/update';
import { forget } from './tools/forget';
import { getMap } from './tools/map';

const server = new McpServer({
  name: 'vaultmax',
  version: '1.0.0',
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

srv.registerTool(
  'vaultmax_remember',
  {
    description: 'Store a memory (decision, error, map, or change) in the vault for a project',
    inputSchema: {
      content: z.string().describe('The content to memorize'),
      type: z.enum(['decision', 'error', 'map', 'change']).describe('Type of memory'),
      project: z.string().optional().describe('Project name (defaults to PROJECT env var)'),
      tags: z.array(z.string()).optional().describe('Optional tags'),
    },
  },
  async (input) => {
    const result = await remember(
      input as { content: string; type: 'decision' | 'error' | 'map' | 'change'; project?: string; tags?: string[] }
    );
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

srv.registerTool(
  'vaultmax_recall',
  {
    description: 'Search memories by semantic similarity using natural language',
    inputSchema: {
      query: z.string().describe('Natural language search query'),
      project: z.string().optional().describe('Project name (defaults to PROJECT env var)'),
      limit: z.number().optional().describe('Max results (default 5)'),
    },
  },
  async (input) => {
    const result = await recall(input as { query: string; project?: string; limit?: number });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

srv.registerTool(
  'vaultmax_update',
  {
    description: 'Update the content of an existing memory by its ID',
    inputSchema: {
      memory_id: z.string().describe('ID of the memory to update'),
      new_content: z.string().describe('New content to replace the old one'),
      project: z.string().optional().describe('Project name (defaults to PROJECT env var)'),
    },
  },
  async (input) => {
    const result = await update(input as { memory_id: string; new_content: string; project?: string });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

srv.registerTool(
  'vaultmax_forget',
  {
    description: 'Permanently delete a memory from the vault by its ID',
    inputSchema: {
      memory_id: z.string().describe('ID of the memory to delete'),
      project: z.string().optional().describe('Project name (defaults to PROJECT env var)'),
    },
  },
  async (input) => {
    const result = await forget(input as { memory_id: string; project?: string });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

srv.registerTool(
  'vaultmax_map',
  {
    description: 'List all map-type memories for a project, ordered by creation date',
    inputSchema: {
      project: z.string().optional().describe('Project name (defaults to PROJECT env var)'),
    },
  },
  async (input) => {
    const result = await getMap(input as { project?: string });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
