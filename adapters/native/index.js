// adapters/native/index.js
import { setTimeout as delay } from 'node:timers/promises';
import pLimit from 'p-limit';
import { ddgWeb } from './providers/ddg-web.js';
import { mojeekWeb } from './providers/mojeek-web.js';
import { qwantWeb } from './providers/qwant-web.js';
import { wikipediaWeb } from './providers/wikipedia.js';
import { redditWeb } from './providers/reddit.js';
import { stackexchangeWeb } from './providers/stackexchange.js';

const limit = pLimit(4);            // be nice to endpoints
const DEFAULT_TIMEOUT_MS = 12000;

export async function nativeSearch(query, { timeframe, safesearch = 1, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controllers = [];
  const withTimeout = (fn) => async () => {
    const ctl = new AbortController();
    controllers.push(ctl);
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fn(ctl.signal); } finally { clearTimeout(t); }
  };

  // Engines that do not require keys (mix of HTML + JSON sources)
  const tasks = [
    withTimeout((signal) => ddgWeb(query, { timeframe, safesearch, signal })),
    withTimeout((signal) => mojeekWeb(query, { timeframe, safesearch, signal })),
    withTimeout((signal) => qwantWeb(query, { timeframe, safesearch, signal })),
    withTimeout((signal) => wikipediaWeb(query, { timeframe, signal })),
    withTimeout((signal) => redditWeb(query, { timeframe, safesearch, signal })),
    withTimeout((signal) => stackexchangeWeb(query, { timeframe, signal })),
  ].map(t => limit(t));

  const results = (await Promise.allSettled(tasks))
    .flatMap(r => r.status === 'fulfilled' ? r.value : []);
  
  // Deduplicate by URL, keep best title/snippet
  const seen = new Map();
  for (const r of results) {
    if (!r?.url) continue;
    const key = r.url.replace(/[#?].*$/, '');
    if (!seen.has(key)) seen.set(key, r);
  }
  // Small relevance bump: sites with query in title first
  const lc = query.toLowerCase();
  return [...seen.values()].sort((a, b) => {
    const at = (a.title || '').toLowerCase().includes(lc);
    const bt = (b.title || '').toLowerCase().includes(lc);
    return (bt - at) || 0;
  });
}
