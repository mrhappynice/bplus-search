// adapters/native/providers/stackexchange.js
export async function stackexchangeWeb(q, { signal } = {}) {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&accepted=True&answers=1&q=${encodeURIComponent(q)}&site=stackoverflow&filter=default`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
  if (!res.ok) return [];
  const json = await res.json();
  const items = json?.items ?? [];
  return items.slice(0, 10).map(i => ({
    title: i.title,
    url: i.link,
    content: `Score ${i.score} • ${i.tags?.slice(0,3).join(', ') || ''}`,
    engine: 'stackexchange'
  }));
}
