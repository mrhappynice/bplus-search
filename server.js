import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SEARXNG_URL = process.env.SEARXNG_URL;
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'not-needed';

if (!SEARXNG_URL || !OPENAI_API_BASE) {
    console.error("FATAL ERROR: Missing critical environment variables.");
    process.exit(1);
}

app.post('/search', async (req, res) => {
    // --- MODIFIED: Receive timeframe from the request body ---
    const { query, timeframe } = req.body;
    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

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

        // --- MODIFIED: Dynamically build the SearXNG URL ---
        let searxngUrl = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`;
        
        // Whitelist allowed values for security
        const allowedTimeframes = ['day', 'week', 'month'];
        if (timeframe && allowedTimeframes.includes(timeframe)) {
            searxngUrl += `&time_range=${timeframe}`;
        }
        
        console.log(`Querying SearXNG for: "${query}" with timeframe: "${timeframe || 'none'}"`);
        const searchResponse = await fetch(searxngUrl, { headers: searxngHeaders });
        // --- END MODIFICATION ---

        if (!searchResponse.ok) {
            throw new Error(`SearXNG returned an error: ${searchResponse.statusText}`);
        }
        const searchData = await searchResponse.json();
        const results = searchData.results || [];

        results.forEach(result => sendEvent('result', { title: result.title, content: result.content, url: result.url }));

        const contentForSummary = results.map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`).join('\n\n---\n\n');
        const summaryPrompt = `Based on the following web search results, write a clear and concise summary for a human reader that answers the original query. Use Markdown formatting. Original Query: "${query}"\n\nSearch Results:\n${contentForSummary}`;

        console.log('Sending prompt to LLM for summarization...');
        const llmResponse = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({
                model: 'local-model',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that summarizes web search results and formats your response using Markdown.' },
                    { role: 'user', content: summaryPrompt }
                ],
                temperature: 0.5,
                stream: true,
            })
        });

        if (!llmResponse.ok) {
            const errorText = await llmResponse.text();
            throw new Error(`LLM API error: ${llmResponse.status} - ${errorText}`);
        }

        if (!llmResponse.body) { throw new Error("LLM response body is empty."); }

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
                    const data = line.substring(line.indexOf(' ')+1);
                    if (data.trim() === '[DONE]') break;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content || '';
                        if (content) { sendEvent('summary-chunk', { text: content }); }
                    } catch (e) {
                        console.error("Error parsing LLM streaming line:", line, e);
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

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SearXNG instance configured at: ${SEARXNG_URL}`);
    console.log(`LM Studio API base configured at: ${OPENAI_API_BASE}`);
});
