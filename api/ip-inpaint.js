// api/ip-inpaint.js

export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } }, // запас по размеру
};

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_TOKEN) {
    return res.status(500).json({ error: 'REPLICATE_API_TOKEN is not set' });
  }

  try {
    const {
      template_url,   // картинка-шаблон (с МОТ и пустым местом)
      mask_url,       // чёрно-белая маска (белое = перерисовать)
      donor_data_url, // URL фото юзера (то, что загрузили на imgbb/s3 и т.п.)
      prompt = '',    // можно оставить пустым
      strength = 0.85,
      image_guidance_scale = 1.5,
      num_inference_steps = 28
    } = req.body || {};

    if (!template_url || !mask_url || !donor_data_url) {
      return res.status(400).json({ error: 'template_url, mask_url, donor_data_url are required' });
    }

    // 1) Создаём prediction
    const create = await fetch('https://api.replicate.com/v1/models/lucataco/ip_adapter-face-inpaint/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Token ${REPLICATE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          source_image: template_url,
          face_image: donor_data_url,
          mask: mask_url,
          prompt,
          image_guidance_scale,
          strength,
          num_inference_steps
        }
      })
    });

    if (!create.ok) {
      const text = await create.text();
      return res.status(create.status).json({ error: `replicate create failed: ${text}` });
    }

    const job = await create.json();
    const id = job?.id || job?.uuid || job?.idempotency_key || job?.output?.id;
    if (!id) return res.status(502).json({ error: 'replicate: no prediction id in response', raw: job });

    // 2) Пулим статус до 60с
    const started = Date.now();
    const deadline = started + 60_000;

    let last;
    while (Date.now() < deadline) {
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { Authorization: `Token ${REPLICATE_TOKEN}` }
      });

      if (!poll.ok) {
        const t = await poll.text();
        return res.status(poll.status).json({ error: `replicate poll failed: ${t}` });
      }

      last = await poll.json();

      if (last.status === 'succeeded') {
        const out = last.output;
        // output у Replicate — это массив URL’ов или один URL
        const url = Array.isArray(out) ? out[0] : out;
        return res.status(200).json({ url, replicate_id: id });
      }

      if (last.status === 'failed' || last.status === 'canceled') {
        return res.status(502).json({ error: `replicate status=${last.status}`, detail: last });
      }

      // queued / starting / processing
      await new Promise(r => setTimeout(r, 2000));
    }

    return res.status(504).json({ error: 'timeout waiting replicate', last });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || 'server error' });
  }
}
