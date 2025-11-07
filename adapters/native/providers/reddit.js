// adapters/native/providers/reddit.js
export async function redditWeb(q, { signal } = {}) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=all&limit=10`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'bplus-native/1.0' } });
  if (!res.ok) return [];
  const json = await res.json();
  const posts = json?.data?.children ?? [];
  return posts.map(({ data }) => ({
    title: data.title,
    url: `https://www.reddit.com${data.permalink}`,
    content: data.selftext?.slice(0, 240) || data.subreddit_name_prefixed,
    engine: 'reddit'
  }));
}
