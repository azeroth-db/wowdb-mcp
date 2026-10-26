import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createApi, KINDS, LOCALES, PAGE_SIZE } from './api.mjs';

const localeSchema = z.enum(Object.keys(LOCALES)).default('enUS').describe('Client locale code. English is enUS; German is deDE.');
const paginationSchema = {
  offset: z.number().int().nonnegative().default(0).describe('Use nextOffset from the previous result; start at 0.'),
  limit: z.number().int().min(1).max(PAGE_SIZE).default(PAGE_SIZE).describe('Rows per result, at most the site collection size of 48.'),
};
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const result = handler => async args => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await handler(args), null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
  }
};

/** The three read-only tools over one API instance. */
export function createServer(api = createApi()) {
  const server = new McpServer({ name: 'wowdb-mcp', version: '0.2.1' });
  server.registerTool('search', {
    description: 'Find WoW Forever records by name in the requested language. Returns kind, slug and exact production page path. Use that path with get_entity. Records above the level cap of 60 are excluded. Localized guides have no record API and are not returned.',
    inputSchema: { query: z.string().trim().min(1), kind: z.enum(KINDS).optional(), locale: localeSchema, ...paginationSchema },
    annotations,
  }, result(api.search));
  server.registerTool('get_entity', {
    description: 'Read a page path returned by search or list_entities. Returns the full English API record where available; localized and search-only records return explicitly marked previews. Null remains unknown. Arrays are paged at up to 48 rows; use a pagination field with its nextOffset to continue.',
    inputSchema: {
      path: z.string().trim().min(1).describe('Exact path or production URL returned by search, including its language prefix and selection fragment.'),
      field: z.string().optional().describe('Optional JSON pointer within data, such as /uses, /ranks or /recipes/0/materials.'),
      ...paginationSchema,
    },
    annotations,
  }, result(api.getEntity));
  server.registerTool('list_entities', {
    description: 'Browse a kind of WoW Forever record in name order, with exact production page paths. Pass nextOffset as offset to continue. Uses the same locale and beta scope as search.',
    inputSchema: { kind: z.enum(KINDS), locale: localeSchema, ...paginationSchema },
    annotations,
  }, result(api.listEntities));
  return server;
}
