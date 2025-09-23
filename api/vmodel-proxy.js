// api/vmodel-proxy.ts (или .js)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: any, res: any) {
  // Префлайт
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '600');
    return res.status(204).setHeader('Vary', 'Origin').setHeader('Access-Control-Allow-Origin','*')
      .setHeader('Access-Control-Allow-Methods','POST,OPTIONS')
      .setHeader('Access-Control-Allow-Headers','Content-Type')
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).setHeader('Content-Type','application/json').setHeader('Access-Control-Allow-Origin','*')
      .json({ error: 'Method not allowed' });
  }

  try {
    const { source_url, target_url } = req.body || {};
    if (!source_url || !target_url) {
      return res.status(400).setHeader('Access-Control-Allow-Origin','*')
        .json({ error: 'source_url & target_url required' });
    }

    // === вызов VModel (создать таск) ===
    const token = process.env.VMODEL_TOKEN; // добавлен в Vercel → Settings → Environment Variables
    const version = 'a3c8d261fd14126eecec/98812b52b40811e9ed557cec5706452888cdeebc0b6'; // из их страницы модели (Photo Face Swap Pro)

    const create = await fetch('https://api.vmodel.ai/api/tasks/v1/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `vmodel/photo-face-swap-pro:${version}`,
        input: {
          swap_image:   target_url, // у них "swap_image" — лицо, которое вставляем
          target_image: source_url, // а это — фото, куда вставляем
          disable_safety_checker: false,
        },
      }),
    });

    const createJson = await create.json();
    if (!create.ok) {
      return res.status(502).setHeader('Access-Control-Allow-Origin','*')
        .json({ error: 'vmodel create failed', details: createJson });
    }

    const taskId = createJson?.id || createJson?.data?.id;
    if (!taskId) {
      return res.status(502).setHeader('Access-Control-Allow-Origin','*')
        .json({ error: 'no task id from vmodel', raw: createJson });
    }

    // === опрос статуса (до 45с) ===
    const until = Date.now() + 45_000;
    let resultUrl: string | null = null;
    let last: any = null;

    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`https://api.vmodel.ai/api/tasks/v1/get?id=${encodeURIComponent(taskId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const j = await r.json();
      last = j;

      const status = j?.status || j?.data?.status;
      if (status === 'succeeded' || status === 'completed') {
        const files = j?.output?.files || j?.data?.output?.files || [];
        resultUrl = files[0]?.content_url || files[0]?.url || null;
        break;
      }
      if (status === 'failed') {
        return res.status(502).setHeader('Access-Control-Allow-Origin','*')
          .json({ error: 'vmodel task failed', details: j });
      }
    }

    if (!resultUrl) {
      return res.status(504).setHeader('Access-Control-Allow-Origin','*')
        .json({ error: 'timeout waiting vmodel', last });
    }

    // Можно сразу отдать ссылку
    return res.status(200).setHeader('Access-Control-Allow-Origin','*')
      .json({ url: resultUrl });

  } catch (e:any) {
    return res.status(500).setHeader('Access-Control-Allow-Origin','*')
      .json({ error: String(e) });
  }
}
