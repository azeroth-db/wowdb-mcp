export const SITE = 'https://wowdb.wiki';
const API_ORIGIN = new URL(process.env.WOWDB_ORIGIN ?? SITE).origin;

// The public item collections use 48 rows. The Forever beta admits levels through 30.
export const PAGE_SIZE = 48;
const LEVEL_CAP = 30;
export const LOCALES = {
  enUS: { prefix: '', language: 'en-US' },
  deDE: { prefix: 'de', language: 'de-DE' },
  esES: { prefix: 'es', language: 'es-ES' },
  esMX: { prefix: 'es-MX', language: 'es-MX' },
  frFR: { prefix: 'fr', language: 'fr-FR' },
  koKR: { prefix: 'ko', language: 'ko-KR' },
  ptBR: { prefix: 'pt-BR', language: 'pt-BR' },
  ruRU: { prefix: 'ru', language: 'ru-RU' },
  zhCN: { prefix: 'zh-CN', language: 'zh-CN' },
  zhTW: { prefix: 'zh-TW', language: 'zh-TW' },
};
export const KINDS = ['item', 'recipe', 'ability', 'spell', 'enchant', 'talent', 'legacy', 'race', 'quest', 'giver', 'camp', 'dungeon', 'achievement', 'faction', 'guide'];
const REFERENCE_KINDS = new Set(['spell', 'enchant']);

const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, '').trim();
const missing = () => new Error('Entity not found. Use search to find a published WoW Forever page path.');

async function json(path) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error('The API path must stay on the configured wowdb.wiki origin.');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) throw missing();
  if (!response.ok) throw new Error(`wowdb.wiki returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error('wowdb.wiki did not return readable JSON.');
  }
}

// Accept links from either owned domain; return the current public origin.
const SITES = [SITE, 'https://azeroth.wiki'];

function address(path) {
  const given = new URL(path, SITE);
  if (!SITES.includes(given.origin) || given.search || given.username || given.password) {
    throw new Error('Use a wowdb.wiki page path returned by search, without query parameters.');
  }
  const url = new URL(given.pathname + given.hash, SITE);
  const prefix = url.pathname.split('/')[1];
  const locale = Object.keys(LOCALES).find(key => LOCALES[key].prefix === prefix) ?? 'enUS';
  const base = LOCALES[locale].prefix ? `/${LOCALES[locale].prefix}/forever/` : '/forever/';
  if (!url.pathname.startsWith(base)) throw missing();
  return { url, locale };
}

function pageKey(path) {
  const { url } = address(path);
  return decodeURI(url.pathname).normalize('NFC') + decodeURIComponent(url.hash);
}

function inBeta(kind, facts) {
  const level = kind === 'quest' ? facts[0] : kind === 'item' ? facts[3] : null;
  return typeof level !== 'number' || level <= LEVEL_CAP;
}

function summary({ name, kind, slug, path, url, facts }) {
  return { name, kind, slug, path, url, facts };
}

function page(rows, offset, limit) {
  if (offset > 0 && offset >= rows.length) throw new Error('Offset is past the last result. Use the previous nextOffset or start at 0.');
  return {
    entries: rows.slice(offset, offset + limit).map(summary),
    nextOffset: offset + limit < rows.length ? offset + limit : null,
  };
}

function score(record, query) {
  const text = normalize(record.name);
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.includes(query)) return 2;
  if (query.split(/\s+/u).every(word => text.includes(word))) return 3;
  return record.alternate && normalize(record.alternate).includes(query) ? 4 : Infinity;
}

function previewPath(url, locale) {
  let path = locale === 'enUS' ? url.pathname.slice('/forever'.length) : url.pathname;
  const selection = new URLSearchParams(url.hash.slice(1)).get('select');
  if (selection) path += `/select/${encodeURIComponent(selection)}`;
  else if (url.hash) path += `/variant/${encodeURIComponent(decodeURIComponent(url.hash.slice(1)))}`;
  return `/api/forever/entity${path}`;
}

function namedData(data, record) {
  if (record.kind === 'talent' && Array.isArray(data?.talents)) {
    const talent = data.talents.find(row => row.node === record.id);
    if (!talent) throw missing();
    return { ...talent, class: { id: data.id, name: data.name } };
  }
  if (record.kind === 'legacy' && Array.isArray(data?.perks)) {
    const perk = data.perks.find(row => row.node === record.id);
    if (!perk) throw missing();
    return perk;
  }
  if (record.kind === 'ability' && Array.isArray(data?.ranks)) {
    return { ...data, ranks: data.ranks.filter(rank => rank.level === null || rank.level <= LEVEL_CAP) };
  }
  return data;
}

function checkLevel(data, representation) {
  const level = representation === 'preview' ? data.stats?.find(row => row[0] === 'Level')?.[1] : data?.level;
  if (typeof level === 'number' && level > LEVEL_CAP) {
    throw new Error('This API response describes content above the Forever beta level cap of 30. Search for another record; use the English full ability record for beta ranks.');
  }
}

function selectField(data, field) {
  if (!field) return data;
  if (!field.startsWith('/')) throw new Error('field must be a JSON pointer, for example /uses or /recipes/0/materials.');
  let value = data;
  for (const part of field.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new Error(`The record has no field ${field}. Read it without field to inspect its available fields.`);
    }
    value = value[key];
  }
  return value;
}

const pointer = (path, key) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

function bounded(value, path, limit, pagination, offset = 0) {
  if (Array.isArray(value)) {
    if (offset > 0 && offset >= value.length) throw new Error('Offset is past the last array entry.');
    if (offset || value.length > limit) {
      pagination.push({ field: path, offset, nextOffset: offset + limit < value.length ? offset + limit : null });
    }
    return value.slice(offset, offset + limit).map((row, index) => bounded(row, pointer(path, offset + index), limit, pagination));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bounded(child, pointer(path, key), limit, pagination)]));
  }
  return value;
}

/** One API instance per server; a hosted request builds its own and drops it. Each call reads the site's current JSON. */
export function createApi() {
  async function records(locale) {
    const index = await json(`/api/forever/search${locale === 'enUS' ? '' : `/${locale}`}`);
    if (index.ruleset !== 'forever' || !index.rows || typeof index.rows !== 'object') {
      throw new Error('wowdb.wiki returned an unexpected search index.');
    }
    return Object.entries(index.rows).flatMap(([key, rows]) => {
      const kind = key.replace(/^forever-/, '');
      if (!KINDS.includes(kind) || (kind === 'guide' && locale !== 'enUS')) return [];
      return rows.filter(row => inBeta(kind, row[7] ?? [])).map(row => {
        const [id, name, path, , , , alternate, facts = []] = row;
        const { url } = address(path);
        return {
          id, name, kind, path, alternate, facts,
          slug: new URLSearchParams(url.hash.slice(1)).get('select') ?? decodeURIComponent(url.pathname.split('/').at(-1)),
          url: url.href,
        };
      });
    });
  }

  async function search({ query, kind, locale, offset, limit }) {
    const terms = normalize(query);
    if (!terms) throw new Error('Enter a name to search.');
    const rows = (await records(locale))
      .filter(row => !kind || row.kind === kind)
      .map(row => ({ row, rank: score(row, terms) }))
      .filter(hit => Number.isFinite(hit.rank))
      .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name, LOCALES[locale].language) || a.row.url.localeCompare(b.row.url))
      .map(hit => hit.row);
    return { locale, ...page(rows, offset, limit) };
  }

  async function listEntities({ kind, locale, offset, limit }) {
    const rows = (await records(locale))
      .filter(row => row.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name, LOCALES[locale].language) || a.url.localeCompare(b.url));
    return { locale, kind, ...page(rows, offset, limit) };
  }

  async function getEntity({ path, field, offset, limit }) {
    const { url, locale } = address(path);
    const record = (await records(locale)).find(row => pageKey(row.path) === pageKey(path));
    if (!record) throw missing();
    const directory = locale === 'enUS' ? await json('/api/forever') : null;
    const entry = directory?.entries?.find(row => pageKey(row.page) === pageKey(url.pathname));
    const full = Boolean(entry) || (locale === 'enUS' && REFERENCE_KINDS.has(record.kind));
    const apiPath = full ? entry?.data ?? `/api${url.pathname}` : previewPath(url, locale);
    const payload = await json(apiPath);
    const representation = full ? 'full-record' : 'preview';
    const data = full ? namedData(payload.data ?? payload, record) : payload;
    checkLevel(data, representation);
    const selected = selectField(data, field);
    if (offset && !Array.isArray(selected)) throw new Error('Use field to select an array before setting offset.');
    const pagination = [];
    return {
      ...summary(record), locale, representation,
      dataUrl: new URL(apiPath, SITE).href,
      data: bounded(selected, field ?? '', limit, pagination, offset),
      pagination,
    };
  }

  return { search, listEntities, getEntity };
}
