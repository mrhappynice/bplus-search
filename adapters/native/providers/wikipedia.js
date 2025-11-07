// adapters/native/providers/wikipedia.js
export async function wikipediaWeb(q, { signal } = {}) {
  const api = `https://en.wikipedia.org/w/api.php?action=query&list=search&utf8=1&format=json&srsearch=${encodeURIComponent(q)}&srlimit=10`;
  const res = await fetch(api, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
  if (!res.ok) return [];
  const json = await res.json();
  const items = json?.query?.search ?? [];
  return items.map(i => ({
    title: i.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(i.title.replace(/\s/g, '_'))}`,
    content: i.snippet?.replace(/<\/?span[^>]*>/g, '').replace(/&quot;/g, '"'),
    engine: 'wikipedia'
  }));
}
