// adapters/native/providers/qwant-web.js
import * as cheerio from 'cheerio';

export async function qwantWeb(q, { signal } = {}) {
  const url = `https://www.qwant.com/?q=${encodeURIComponent(q)}&t=web`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const out = [];
  $('a[data-testid="result-link"]').each((_, a) => {
    const el = $(a);
    const title = el.text().trim();
    const href = el.attr('href');
    const snippet = el.closest('[data-testid="result-card"]').find('[data-testid="result-description"]').text().trim();
    if (href && title) out.push({ title, url: href, content: snippet, engine: 'qwant' });
  });
  return out.slice(0, 15);
}
