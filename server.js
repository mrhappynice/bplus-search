// server.js
// Works with plain Node (dev) and Node 22 SEA (single executable).

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import * as sea from 'node:sea';
import Database from 'better-sqlite3';

// --- Basic Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// --- Database Setup ---
let db = new Database(':memory:');
console.log('In-memory SQLite database initialized.');

function initializeDatabase(databaseInstance) {
    databaseInstance.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL, -- 'user' or 'assistant'
            content TEXT NOT NULL,
            sources TEXT, -- JSON array of sources for 'assistant' messages
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL UNIQUE, -- Enforce one note per conversation
            content TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content, content='messages', content_rowid='id'
        );

        -- Triggers to keep FTS table in sync with messages table
        CREATE TRIGGER IF NOT EXISTS messages_after_insert AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_after_delete AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_after_update AFTER UPDATE ON messages BEGIN
            UPDATE messages_fts SET content = new.content WHERE rowid = old.id;
        END;
    `);
    console.log('Database schema, notes, and FTS5 initialized.');
}
initializeDatabase(db);


// --- SEA Asset Extraction Logic (Unchanged) ---
let _extractedDir = null;
function extractSeaAssetsToTemp(prefix = 'public/') {
  if (!sea.isSea()) return null;
  if (_extractedDir) return _extracted-Dir;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-assets-'));
  const keys = typeof sea.getAssetKeys === 'function' ? sea.getAssetKeys() : [];
  const wanted = keys.length ? keys.filter(k => k.startsWith(prefix)) : [prefix + 'index.html'];
  for (const key of wanted) {
    const data = sea.getAsset(key);
    if (!data) continue;
    const rel = key.replace(prefix, '');
    const outPath = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(data));
  }
  _extractedDir = tmpRoot;
  return _extractedDir;
}

// --- Static Hosting Logic (Unchanged) ---
let staticRoot;
if (sea.isSea()) {
  staticRoot = extractSeaAssetsToTemp('public/');
} else {
  staticRoot = path.join(__dirname, 'public');
}
app.use(express.static(staticRoot));
app.get('/', (req, res) => {
  const indexPath = path.join(staticRoot, 'index.html');
  res.sendFile(indexPath);
});

// ---------------------------
// Env & Sanity Checks (Unchanged)
// ---------------------------
const { SEARXNG_URL, AUTH_USERNAME, AUTH_PASSWORD, LMSTUDIO_API_BASE, OPENAI_API_KEY, OPENROUTER_API_KEY, GOOGLE_API_KEY } = process.env;
if (!SEARXNG_URL) {
  console.error('FATAL ERROR: Missing SEARXNG_URL environment variable.');
  process.exit(1);
}

// ---------------------------
// API: Get available models (Unchanged)
// ---------------------------
app.get('/api/models', async (req, res) => {
    const { provider } = req.query;
    try {
        let url, headers, modelProcessor;
        switch (provider) {
            case 'lmstudio':
                if (!LMSTUDIO_API_BASE) return res.json([]);
                url = `${LMSTUDIO_API_BASE}/models`; headers = {};
                modelProcessor = (data) => data.data.map(m => ({ id: m.id, name: m.id }));
                break;
            case 'openai':
                if (!OPENAI_API_KEY) return res.json([]);
                url = 'https://api.openai.com/v1/models'; headers = { 'Authorization': `Bearer ${OPENAI_API_KEY}` };
                modelProcessor = (data) => data.data.filter(m => m.id.startsWith('gpt') || m.id.startsWith('o1') || m.id.startsWith('o3')).map(m => ({ id: m.id, name: m.id }));
                break;
            case 'openrouter':
                if (!OPENROUTER_API_KEY) return res.json([]);
                url = 'https://openrouter.ai/api/v1/models'; headers = { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` };
                modelProcessor = (data) => data.data.map(m => ({ id: m.id, name: m.name }));
                break;
            case 'google':
                 if (!GOOGLE_API_KEY) return res.json([]);
                url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}`; headers = {};
                modelProcessor = (data) => data.models.filter(m => m.supportedGenerationMethods.includes("generateContent")).map(m => ({ id: m.name, name: m.displayName }));
                break;
            default: return res.status(400).json({ error: 'Invalid provider' });
        }
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`Failed to fetch models from ${provider}: ${response.status}`);
        const data = await response.json();
        res.json(modelProcessor(data));
    } catch (error) {
        console.error(`Error fetching models for ${provider}:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------
// API: Conversation Management (MODIFIED)
// ---------------------------
app.get('/api/conversations', (req, res) => {
    try {
        const stmt = db.prepare('SELECT id, title, created_at FROM conversations ORDER BY created_at DESC');
        res.json(stmt.all());
    } catch (error) { res.status(500).json({ error: 'Failed to retrieve conversations' }); }
});

app.post('/api/conversations', (req, res) => {
    try {
        const { title } = req.body;
        const stmt = db.prepare('INSERT INTO conversations (title) VALUES (?)');
        const info = stmt.run(title || 'New Conversation');
        res.status(201).json({ id: info.lastInsertRowid, title: title || 'New Conversation' });
    } catch (error) { res.status(500).json({ error: 'Failed to create conversation' }); }
});

app.get('/api/conversations/:id', (req, res) => {
    try {
        const convoStmt = db.prepare(`
            SELECT c.*, n.content as note_content 
            FROM conversations c
            LEFT JOIN notes n ON c.id = n.conversation_id
            WHERE c.id = ?
        `);
        const conversation = convoStmt.get(req.params.id);
        if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

        const messagesStmt = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC');
        conversation.messages = messagesStmt.all(req.params.id);
        res.json(conversation);
    } catch (error) { res.status(500).json({ error: 'Failed to retrieve conversation details' }); }
});

app.delete('/api/conversations/:id', (req, res) => {
    try {
        const info = db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
        if (info.changes === 0) return res.status(404).json({ error: 'Conversation not found' });
        res.status(204).send();
    } catch (error) { res.status(500).json({ error: 'Failed to delete conversation' }); }
});

// PUT to save/update notes for a conversation
app.put('/api/conversations/:id/notes', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content is required.' });
    
    try {
        const stmt = db.prepare(`
            INSERT INTO notes (conversation_id, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(conversation_id) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at
        `);
        stmt.run(req.params.id, content);
        res.json({ message: 'Notes saved successfully.' });
    } catch (error) {
        console.error("Error saving notes:", error);
        res.status(500).json({ error: 'Failed to save notes.' });
    }
});


// ---------------------------
// API: Database Persistence (Unchanged)
// ---------------------------
app.post('/api/research/save', async (req, res) => {
    let { filename } = req.body;
    if (!filename || typeof filename !== 'string') return res.status(400).json({ error: 'Filename is required.' });
    filename = path.basename(filename);
    if (!filename.endsWith('.db')) filename += '.db';
    const filePath = path.join(__dirname, filename);
    try {
        await db.backup(filePath);
        console.log(`Database saved to ${filePath}`);
        res.json({ message: `Database saved successfully to ${filename}` });
    } catch (error) {
        console.error('Failed to save database:', error);
        res.status(500).json({ error: 'Failed to save database.' });
    }
});

app.get('/api/research/files', (req, res) => {
    try {
        res.json(fs.readdirSync(__dirname).filter(file => file.endsWith('.db')));
    } catch (error) {
        console.error('Failed to list database files:', error);
        res.status(500).json({ error: 'Could not retrieve file list.' });
    }
});

app.post('/api/research/load', (req, res) => {
    let { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required.' });
    filename = path.basename(filename);
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: `Database file not found: ${filename}` });
    try {
        db.close();
        db = new Database(filePath);
        console.log(`Database loaded from ${filePath}`);
        res.json({ message: `Successfully loaded ${filename}.` });
    } catch (error) {
        console.error('Failed to load database:', error);
        db = new Database(':memory:');
        initializeDatabase(db);
        res.status(500).json({ error: 'Failed to load database. Reverted to a new in-memory session.' });
    }
});


// ---------------------------
// Streaming Helpers & Main Query Endpoint (Unchanged)
// ---------------------------
const sendEvent = (res, event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
};

async function streamOpenAIResponse(llmResponse, res) {
    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();
    let leftover = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = leftover + decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            leftover = lines.pop() || '';
            for (const line of lines) {
                if (line.trim().startsWith('data:')) {
                    const data = line.substring(line.indexOf(' ') + 1).trim();
                    if (data === '[DONE]') return;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content || '';
                        if (content) sendEvent(res, 'summary-chunk', { text: content });
                    } catch (e) {}
                }
            }
        }
    } catch (e) {
        console.error("Error during OpenAI stream:", e);
        sendEvent(res, 'error', { message: 'Stream interrupted.' });
    }
}

async function streamGoogleResponse(llmResponse, res) {
    const reader = llmResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done && buffer.length === 0) break;
            if (value) buffer += decoder.decode(value, { stream: true });
            let depth = 0, start = -1;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i] === '{') {
                    if (depth === 0) start = i;
                    depth++;
                } else if (buffer[i] === '}') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        try {
                            const jsonChunk = JSON.parse(buffer.substring(start, i + 1));
                            const content = jsonChunk.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (content) sendEvent(res, 'summary-chunk', { text: content });
                        } catch (e) {}
                        buffer = buffer.substring(i + 1);
                        i = -1; start = -1;
                    }
                }
            }
            if (done) break;
        }
    } catch (e) {
        console.error("Error during Google stream:", e);
        sendEvent(res, 'error', { message: 'Google stream interrupted.' });
    }
}

app.post('/api/conversations/:id/query', async (req, res) => {
    const { query, timeframe, provider, model, systemPrompt } = req.body;
    const conversationId = req.params.id;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
        db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conversationId, 'user', query);
        
        const searxngHeaders = {};
        if (AUTH_USERNAME && AUTH_PASSWORD) searxngHeaders['Authorization'] = `Basic ${Buffer.from(`${AUTH_USERNAME}:${AUTH_PASSWORD}`).toString('base64')}`;
        let searxngUrl = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`;
        if (timeframe && ['day', 'week', 'month'].includes(timeframe)) searxngUrl += `&time_range=${timeframe}`;
        
        console.log(`Querying SearXNG for convo ${conversationId}: "${query}" [${timeframe || 'all'}]`);
        const sResp = await fetch(searxngUrl, { headers: searxngHeaders });
        if (!sResp.ok) throw new Error(`SearXNG failed: ${sResp.status} ${sResp.statusText}`);
        const sData = await sResp.json();
        const results = (sData.results || []).map(r => ({ title: r.title, content: r.content, url: r.url }));
        sendEvent(res, 'results', results);

        if (results.length === 0) {
            const noResultsMsg = 'No search results found to summarize.';
            sendEvent(res, 'summary-chunk', { text: noResultsMsg });
            db.prepare('INSERT INTO messages (conversation_id, role, content, sources) VALUES (?, ?, ?, ?)').run(conversationId, 'assistant', noResultsMsg, JSON.stringify([]));
            res.end();
            return;
        }

        const history = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND id NOT IN (SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1) ORDER BY created_at ASC").all(conversationId, conversationId);
        const snippets = results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`).join('\n\n---\n\n');
        const userPrompt = `Based on the following search results, write a clear, concise summary answering my latest prompt: "${query}".\n\nSearch Results:\n${snippets}`;
        
        let llmResp, fullResponseText = '';
        const llmMessages = [ { role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }];

        if (provider === 'google') {
            const modelId = model.startsWith('models/') ? model.replace('models/', '') : model;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${GOOGLE_API_KEY}`;
            llmResp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }] }) });
        } else {
            let apiBase, apiKey;
            const headers = { 'Content-Type': 'application/json', 'User-Agent': 'SearXNG-Direct/1.0' };
            switch (provider) {
                case 'openai': apiBase = 'https://api.openai.com/v1'; apiKey = OPENAI_API_KEY; break;
                case 'openrouter': apiBase = 'https://openrouter.ai/api/v1'; apiKey = OPENROUTER_API_KEY; headers['HTTP-Referer'] = 'http://localhost:3001'; headers['X-Title'] = 'SearXNG Direct'; break;
                case 'lmstudio': default: apiBase = LMSTUDIO_API_BASE; apiKey = 'not-needed'; break;
            }
            if (provider !== 'lmstudio' && !apiKey) throw new Error(`API key missing for ${provider}`);
            headers['Authorization'] = `Bearer ${apiKey}`;
            llmResp = await fetch(`${apiBase}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model, messages: llmMessages, stream: true }) });
        }

        if (!llmResp.ok) {
            const errText = await llmResp.text();
            throw new Error(`${provider} API error: ${llmResp.status} - ${errText}`);
        }

        sendEvent(res, 'summary-start', {});
        
        const originalWrite = res.write;
        res.write = (chunk) => {
            try {
                const dataMatch = chunk.match(/data: (.*)\n/);
                if (dataMatch) {
                    const data = JSON.parse(dataMatch[1]);
                    if (data.text) fullResponseText += data.text;
                }
            } catch(e) {}
            return originalWrite.apply(res, [chunk]);
        };

        if (provider === 'google') await streamGoogleResponse(llmResp, res);
        else await streamOpenAIResponse(llmResp, res);

        const info = db.prepare('INSERT INTO messages (conversation_id, role, content, sources) VALUES (?, ?, ?, ?)').run(conversationId, 'assistant', fullResponseText, JSON.stringify(results));
        sendEvent(res, 'summary-done', { messageId: info.lastInsertRowid });

    } catch (error) {
        console.error('Search/Summary Error:', error);
        sendEvent(res, 'error', { message: error.message });
    } finally {
        res.end();
    }
});


const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});