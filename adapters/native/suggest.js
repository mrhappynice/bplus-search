// adapters/native/suggest.js
export async function suggest(q, { signal } = {}) {
  const fetchJson = async (u) => {
    const r = await fetch(u, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
    if (!r.ok) return [];
    return r.json();
  };

  const [ddg, brave, qwant, wiki] = await Promise.allSettled([
    fetchJson(`https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`),
    fetchJson(`https://search.brave.com/api/suggest?q=${encodeURIComponent(q)}`),
    fetchJson(`https://api.qwant.com/v3/suggest?q=${encodeURIComponent(q)}&locale=en_US&version=2`),
    fetchJson(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&formatversion=2&namespace=0&limit=10&search=${encodeURIComponent(q)}`),
  ]);

  const items = [];
  if (ddg.status === 'fulfilled' && Array.isArray(ddg.value) && ddg.value[1]) items.push(...ddg.value[1]);
  if (brave.status === 'fulfilled' && Array.isArray(brave.value) && Array.isArray(brave.value[1])) items.push(...brave.value[1]);
  if (qwant.status === 'fulfilled' && qwant.value?.status === 'success') items.push(...(qwant.value.data?.items?.map(i => i.value) ?? []));
  if (wiki.status === 'fulfilled' && Array.isArray(wiki.value) && Array.isArray(wiki.value[1])) items.push(...wiki.value[1]);

  const freq = new Map();
  for (const s of items) freq.set(s, (freq.get(s) ?? 0) + 1);
  return [...freq.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,10).map(([s]) => s);
}
