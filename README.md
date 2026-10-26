# wowdb-mcp

Read WoW Forever records from [Azeroth DB](https://wowdb.wiki) over MCP.
Search by a record's name, then read its values and open its exact page.

## Connect

The server runs at `https://wowdb.wiki/api/mcp` over Streamable HTTP. It needs
no API key and no install. Add it to a client that connects to remote servers:

```json
{
  "mcpServers": {
    "wowdb": {
      "url": "https://wowdb.wiki/api/mcp"
    }
  }
}
```

In Claude Code: `claude mcp add --transport http wowdb https://wowdb.wiki/api/mcp`.

A client that only starts local stdio servers reaches the same endpoint through
[mcp-remote](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "wowdb": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://wowdb.wiki/api/mcp"]
    }
  }
}
```

## Run from source

Requires Node.js 26.12.1 or later.

```sh
npm install
node server.mjs
```

`server.mjs` serves the same tools over MCP stdio. It writes MCP messages to
stdout, starts no HTTP listener, reads no account records and changes no site
data. `wowdb-mcp` exports `createServer`; `wowdb-mcp/http` exports
`handleMcp`, which answers one stateless Streamable HTTP request and is what
the site's `/api/mcp` route runs.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `search` | `query`; optional `kind`, `locale`, `offset`, `limit` | Matching names with their kinds, slugs, page paths and production URLs |
| `get_entity` | `path` from a search or list result; optional `field`, `offset`, `limit` | Actual record data, its representation, data URL and production page URL |
| `list_entities` | `kind`; optional `locale`, `offset`, `limit` | Records in name order with continuation through `nextOffset` |

Supported kinds are `item`, `recipe`, `ability`, `spell`, `enchant`, `talent`,
`legacy`, `race`, `quest`, `giver`, `camp`, `dungeon`, `achievement`, `faction`
and English `guide`. The server does not expose news, player records or map
placement tools.

```json
{"name":"search","arguments":{"query":"Empty Vial","kind":"item","limit":1}}
{"name":"get_entity","arguments":{"path":"/forever/items/empty-vial"}}
{"name":"search","arguments":{"query":"Leere Phiole","kind":"item","locale":"deDE","limit":1}}
{"name":"get_entity","arguments":{"path":"/de/forever/gegenstaende/leere-phiole"}}
```

Locale codes are `enUS` (default), `deDE`, `esES`, `esMX`, `frFR`, `koKR`,
`ptBR`, `ruRU`, `zhCN` and `zhTW`. Search reads the index of the requested
language; lookup takes the language from the returned page path. Reuse that
path rather than translating a slug or adding a locale query parameter.

## Data boundaries

The English directory and named-record API provide full records for their
published paths. Search also covers records with a preview API only.
`representation` is `full-record` or `preview` so a caller can distinguish
these responses. A named talent is selected from its class response, rather
than returning that class as the talent.

Localized lookups return the site's preview data. Those responses may have
English field labels, shortened relationship lists or missing text. They do
not provide every field of the full English record. Localized guide records
have no lookup API and are excluded. The API can describe an ability's last
rank above the game's level cap of 60; such a preview returns a tool error
instead of presenting that rank as available. The full English ability response
keeps ranks with a required level at or below 60, including an unknown level
when the API explicitly records it as null. Known item requirements and quest
levels above 60 are excluded from discovery.

Keep nulls and missing fields unknown. An item's presence does not establish
its drop chance or acquisition conditions. Prices such as `sellPrice` and
`observed.price` are in copper; vendor observations are not auction prices.
Every successful result contains serialized JSON in a text `content` block.
HTTP and lookup failures return `isError: true` with a message; a missing
record asks the caller to search again.

## Pagination

`limit` defaults to 48 and accepts 1 through 48, matching the site's public
item collection page size. Search and list results return `nextOffset`;
pass it as `offset` with the same query, kind and language.

Lookup keeps scalar values and objects and limits each array to the requested
page size. If an array has more entries, `pagination` identifies its `field`
as a JSON pointer and supplies `nextOffset`. Pass both back to `get_entity`
with the same page path. For example:

```json
{"name":"get_entity","arguments":{"path":"/forever/items/empty-vial","field":"/uses","offset":0,"limit":2}}
```

Pointers are relative to the returned `data`, such as `/ranks` or
`/recipes/0/materials`. They select the original API data before array paging.
They cannot retrieve relationships omitted by the API itself. An offset past
the final result returns a tool error, rather than repeating the first page.

## Testing origin

`WOWDB_ORIGIN` is the single environment override for API requests, for
example `http://localhost:3712`. It changes the request origin only.
Returned page links and data links remain on `https://wowdb.wiki`.

The package reads its own public API contracts. It does not import site
source, store API payloads on disk or retain locale indexes between calls.
