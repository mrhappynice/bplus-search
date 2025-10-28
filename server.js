// server.js
// Works with plain Node (dev) and Node 22 SEA (single executable).

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import * as sea from 'node:sea'; // SEA runtime detection + asset access (Node 22+)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------
// SEA helper: extract embedded assets to a temp dir and return its path
// ---------------------------
let _extractedDir = null;

/**
 * Extract all SEA-embedded assets whose keys start with a prefix (e.g. "public/")
 * into a temp directory. Returns the path to the extracted root.
 */
function extractSeaAssetsToTemp(prefix = 'public/') {
  if (!sea.isSea()) return null; // Not running as SEA => nothing to do
  if (_extractedDir) return _extractedDir; // Only extract once

  // Create a stable temp folder for this process
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-assets-'));

  // Newer Node exposes key enumeration; if unavailable, just extract the ones we know by name.
  // We assume Node 22.20+ so sea.getAssetKeys() exists.
  const keys = typeof sea.getAssetKeys === 'function' ? sea.getAssetKeys() : [];
  const wanted = keys.length ? keys.filter(k => k.startsWith(prefix)) : [prefix + 'index.html'];

  for (const key of wanted) {
    const data = sea.getAsset(key);
    if (!data) continue;

    const rel = key.replace(prefix, ''); // e.g., public/index.html => index.html
    const outPath = path.join(tmpRoot, rel);

    // Ensure subdirectories exist
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    // Write file
    fs.writeFileSync(outPath, Buffer.from(data));
  }

  _extractedDir = tmpRoot;
  return _extractedDir;
}

// ---------------------------
// Static hosting (works in both modes)
// ---------------------------
let staticRoot;

if (sea.isSea()) {
  // Running as SEA: extract embedded "public/**" and serve from the temp directory
  staticRoot = extractSeaAssetsToTemp('public/');
} else {
  // Normal dev/runtime: serve from filesystem
  staticRoot = path.join(__dirname, 'public');
}

// Mount static files
app.use(express.static(staticRoot));

// Explicit route for "/" so it works consistently in both modes
app.get('/', (req, res) => {
  const indexPath = path.join(staticRoot, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else if (sea.isSea()) {
    // Fallback: serve in-memory (just in case)
    const buf = sea.getAsset('public/index.html');
    if (buf) {
      res.type('html').send(new TextDecoder().decode(buf));
    } else {
      res.status(404).send('index.html not found');
    }
  } else {
    res.status(404).send('index.html not found');
  }
});

// ---------------------------
// Env & sanity checks (your existing variables)
// ---------------------------
const SEARXNG_URL = process.env.SEARXNG_URL;
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'not-needed';

if (!SEARXNG_URL || !OPENAI_API_BASE) {
  console.error('FATAL ERROR: Missing critical environment variables.');
  process.exit(1);
}

// ---------------------------
// API: /search  (SSE streaming; unchanged behavior)
// ---------------------------
app.post('/search', async (req, res) => {
  // timeframe is optional and whitelisted to day/week/month
  const { query, timeframe } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const searxngHeaders = {};
    if (AUTH_USERNAME && AUTH_PASSWORD) {
      const credentials = Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString('base64');
      searxngHeaders['Authorization'] = `Basic ${credentials}`;
    }

    // Build SearXNG URL
    let searxngUrl = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`;
    const allowedTimeframes = ['day', 'week', 'month'];
    if (timeframe && allowedTimeframes.includes(timeframe)) {
      searxngUrl += `&time_range=${timeframe}`;
    }

    console.log(`Querying SearXNG for: "${query}" with timeframe: "${timeframe || 'none'}"`);
    const searchResponse = await fetch(searxngUrl, { headers: searxngHeaders }); // global fetch in Node 22

    if (!searchResponse.ok) {
      throw new Error(`SearXNG returned an error: ${searchResponse.statusText}`);
    }

    const searchData = await searchResponse.json();
    const results = searchData.results || [];

    // Stream raw results
    results.forEach(result =>
      sendEvent('result', { title: result.title, content: result.content, url: result.url })
    );

    // Build LLM prompt
    const contentForSummary = results
      .map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`)
      .join('\n\n---\n\n');

    const summaryPrompt =
      `Based on the following web search results, write a clear and concise summary for a human reader that answers the original query. ` +
      `Use Markdown formatting. Original Query: "${query}"\n\nSearch Results:\n${contentForSummary}`;

    console.log('Sending prompt to LLM for summarization...');
    const llmResponse = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'local-model',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that summarizes web search results and formats your response using Markdown.',
          },
          { role: 'user', content: summaryPrompt },
        ],
        temperature: 0.5,
        stream: true,
      }),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      throw new Error(`LLM API error: ${llmResponse.status} - ${errorText}`);
    }

    if (!llmResponse.body) throw new Error('LLM response body is empty.');

    sendEvent('summary-start', {});

    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();
    let leftover = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = leftover + decoder.decode(value);
      const lines = chunk.split('\n');
      leftover = lines.pop() || '';

      for (const line of lines) {
        if (line.trim().startsWith('data:')) {
          const data = line.substring(line.indexOf(' ') + 1);
          if (data.trim() === '[DONE]') break;
          try {
            const json = JSON.parse(data);
            const content = json.choices[0]?.delta?.content || '';
            if (content) sendEvent('summary-chunk', { text: content });
          } catch (e) {
            console.error('Error parsing LLM streaming line:', line, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('An error occurred:', error);
    sendEvent('error', { message: error.message });
  } finally {
    res.end();
  }
});

// ---------------------------
// Startup
// ---------------------------
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`SearXNG instance configured at: ${SEARXNG_URL}`);
  console.log(`LM Studio API base configured at: ${OPENAI_API_BASE}`);
});

