// api/vmodel-proxy.js

export const config = { runtime: 'nodejs18.x' }; // форсим Node, не Edge

export default async function handler(req, res) {
  try {
    // ---- CORS (дефенсив) ----
    const reqAllowHeaders = String(
      (req.headers && req.headers['access-control-request-headers']) || 'content-type'
    );

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', reqAllowHeaders);
    res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const token = process.env.VMODEL_TOKEN;
    if (!token) {
      res.status(500).json({ error: 'VMODEL_TOKEN is missing' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { source_url, target_url } = body;
    if (!source_url || !target_url) {
      res.status(400).json({ error: 'source_url & target_url required' });
      return;
    }

    // модель vmodel photo-face-swap-pro (как в их UI)
    const version = 'a3c8d261fd14126eecec/98812b52b40811e9ed557cec5706452888cdeebc0b6';

    // 1) create
    const create = await fetch('https://api.vmodel.ai/api/tasks/v1/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `vmodel/photo-face-swap-pro:${version}`,
        input: {
          // swap_image — ЧЬЕ лицо; target_image — КУДА ставим
          swap_image: target_url,
          target_image: source_url,
          disable_safety_checker: false
        }
      })
    });

    const cj = await create.json().catch(() => ({}));
    if (!create.ok) {
      res.status(502).json({ error: 'vmodel create failed', details: cj });
      return;
    }

    const taskId = cj?.id || cj?.data?.id;
    if (!taskId) {
      res.status(502).json({ error: 'no task id', raw: cj });
      return;
    }

    // 2) poll (до 45 сек)
    const deadline = Date.now() + 45_000;
    let outUrl = null, last = null;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`https://api.vmodel.ai/api/tasks/v1/get?id=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = await r.json().catch(() => ({}));
      last = j;

      const status = j?.status || j?.data?.status;
      if (status === 'succeeded' || status === 'completed') {
        const files = j?.output?.files || j?.data?.output?.files || [];
        outUrl = files?.[0]?.content_url || files?.[0]?.url || null;
        break;
      }
      if (status === 'failed') {
        res.status(502).json({ error: 'vmodel task failed', details: j });
        return;
      }
    }

    if (!outUrl) {
      res.status(504).json({ error: 'timeout', last });
      return;
    }

    res.status(200).json({ url: outUrl });
  } catch (e) {
    res.status(500).json({ error: String(e && e.stack || e) });
  }
}
