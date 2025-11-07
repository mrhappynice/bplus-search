// adapters/native/providers/mojeek-web.js
import * as cheerio from 'cheerio';

export async function mojeekWeb(q, { signal } = {}) {
  const url = `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = [];
  $('div.results div.result').each((_, r) => {
    const a = $(r).find('a[href]').first();
    const title = a.text().trim();
    const href = a.attr('href');
    const snippet = $(r).find('p').text().trim();
    if (href && title) out.push({ title, url: href, content: snippet, engine: 'mojeek' });
  });
  return out.slice(0, 15);
}
