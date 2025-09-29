// api/inpaint.js
import { buffer } from 'micro';
import fetch from 'node-fetch';

export const config = {
  api: { bodyParser: false } // важно, чтобы получить "сырой" form-data
};

// простые CORS (чтобы дергать из Тильды)
function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const API_KEY = process.env.REMAKER_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Missing REMAKER_API_KEY' });

  try {
    // ====== POLL STATUS ======
    if (req.method === 'GET') {
      const job = (req.query && req.query.job) || (new URL(req.url, 'http://x').searchParams.get('job'));
      if (!job) return res.status(400).json({ error: 'Missing job parameter' });

      const url = `https://developer.remaker.ai/api/remaker/v1/face-inpaint/face-inpaint/${job}`;
      const r = await fetch(url, {
        headers: { accept: 'application/json', Authorization: API_KEY }
      });
      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(data);
    }

    // ====== CREATE TASK (proxy) ======
    if (req.method === 'POST') {
      const raw = await buffer(req); // берём сырой body (multipart)
      const r = await fetch(
        'https://developer.remaker.ai/api/remaker/v1/face-inpaint/create',
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            Authorization: API_KEY
            // Content-Type пробрасывать НЕ нужно — Remaker сам определит по boundary
          },
          body: raw
        }
      );

      const data = await r.json();
      return res.status(r.ok ? 200 : 500).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
