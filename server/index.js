import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { generateContract } from './groq.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const SAYMAN_RPC = (process.env.SAYMAN_RPC || 'https://sayman.onrender.com').replace(/\/+$/, '');

app.use(express.json({ limit: '1mb' }));

// --- Health ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasGroqKey: Boolean(process.env.GROQ_API_KEY), saymanRpc: SAYMAN_RPC });
});

// --- Client config (SAYMAN base is exposed; the Groq key is NOT) ---
app.get('/api/config', (_req, res) => {
  res.json({ saymanRpc: SAYMAN_RPC });
});

// --- Groq contract generation (key stays server-side) ---
app.post('/api/generate', async (req, res) => {
  const description = (req.body?.description || '').toString().trim();
  if (!description) {
    return res.status(400).json({ error: 'Provide a "description" of the contract you want.' });
  }
  if (description.length > 4000) {
    return res.status(400).json({ error: 'Description is too long (max 4000 chars).' });
  }
  try {
    const contract = await generateContract(description);
    res.json(contract);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, code: e.code || 'GENERATE_FAILED' });
  }
});

// --- SAYMAN RPC passthrough proxy ---
// The browser talks to /api/rpc/* on our own origin (no CORS headaches, no key
// needed). We forward verbatim to the SAYMAN public testnet. Blockchain calls
// still carry no secrets — signing happens entirely in the browser.
app.all('/api/rpc/*', async (req, res) => {
  const subPath = req.params[0] || '';
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  const target = `${SAYMAN_RPC}/api/${subPath}${qs}`;
  try {
    const init = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (!['GET', 'HEAD'].includes(req.method)) {
      init.body = JSON.stringify(req.body ?? {});
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    init.signal = controller.signal;

    let upstream;
    try {
      upstream = await fetch(target, init);
    } finally {
      clearTimeout(timeout);
    }

    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.set('content-type', ct);
    res.send(text);
  } catch (e) {
    const aborted = e.name === 'AbortError';
    res.status(aborted ? 504 : 502).json({
      error: aborted ? 'SAYMAN RPC timed out.' : `SAYMAN RPC proxy error: ${e.message}`,
    });
  }
});

// --- Static hosting of the built client ---
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback: any non-API route serves index.html.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .send(
        '<pre>SAYFORGE server is running, but the client has not been built yet.\nRun `npm run build`, or use `npm run dev` for the Vite dev server.</pre>'
      );
  });
}

app.listen(PORT, () => {
  console.log(`\n  SAYFORGE server listening on http://localhost:${PORT}`);
  console.log(`  SAYMAN RPC   → ${SAYMAN_RPC}`);
  console.log(`  Groq key     → ${process.env.GROQ_API_KEY ? 'loaded' : 'MISSING (set GROQ_API_KEY)'}`);
  console.log(`  Static dir   → ${fs.existsSync(publicDir) ? publicDir : '(not built — run npm run build)'}\n`);
});
