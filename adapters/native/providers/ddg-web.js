// adapters/native/providers/ddg-web.js
import * as cheerio from 'cheerio';

const BASE = 'https://duckduckgo.com/html/'; // lite HTML results

export async function ddgWeb(q, { timeframe, safesearch = 1, signal } = {}) {
  const params = new URLSearchParams({ q, kp: String(safesearch ? 1 : -1) });
  // timeframe: d=w/day, w=week, m=month; DDG uses 'df' in some UIs; lite supports sort of 't=' in redirect
  if (timeframe === 'day') params.set('df', 'd');
  if (timeframe === 'week') params.set('df', 'w');
  if (timeframe === 'month') params.set('df', 'm');

  const res = await fetch(`${BASE}?${params}`, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = [];
  $('a.result__a').each((_, a) => {
    const el = $(a);
    const title = el.text().trim();
    const url = el.attr('href');
    const snippet = el.closest('.result').find('.result__snippet').text().trim();
    if (url && title) out.push({ title, url, content: snippet, engine: 'duckduckgo' });
  });
  return out.slice(0, 20);
}
