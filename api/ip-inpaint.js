export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // чтобы пролезал dataURL
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_TOKEN) {
    return res.status(500).json({ error: 'REPLICATE_API_TOKEN is not set' });
  }

  try {
    const { template_url, mask_url, donor_data_url, prompt = '' } = req.body || {};
    if (!template_url || !mask_url || !donor_data_url) {
      return res.status(400).json({ error: 'template_url, mask_url, donor_data_url are required' });
    }

    // Создаём prediction на последней версии модели (без явного version-хэша):
    const createResp = await fetch(
      'https://api.replicate.com/v1/models/lucataco/ip_adapter-face-inpaint/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${REPLICATE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: {
            // базовые параметры; правь по вкусу
            image: template_url,       // наш шаблон с МОТ
            mask: mask_url,            // белая область = заменять
            ip_image: donor_data_url,  // фото пользователя (dataURL)
            prompt: prompt || 'Replace masked head using the reference face photo, keep lighting and context natural.',
            negative_prompt: '',
            num_inference_steps: 28,
            guidance_scale: 3,
            strength: 0.85,
            seed: null
          }
        })
      }
    );

    if (!createResp.ok) {
      const t = await createResp.text();
      return res.status(createResp.status).json({ error: `Replicate create error: ${t}` });
    }

    const prediction = await createResp.json();
    const statusUrl = prediction?.urls?.get;
    if (!statusUrl) {
      return res.status(500).json({ error: 'No status URL from Replicate' });
    }

    // Пулим статус до готовности
    const started = Date.now();
    const timeoutMs = 120000; // 2 минуты

    async function poll() {
      const r = await fetch(statusUrl, { headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` }});
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Replicate status error: ${t}`);
      }
      const body = await r.json();
      if (body.status === 'succeeded') {
        const out = body.output;
        const url = Array.isArray(out) ? out[0] : out;
        return url;
      }
      if (body.status === 'failed' || body.status === 'canceled') {
        throw new Error(`Replicate failed: ${body.error || body.status}`);
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('Timeout waiting for Replicate');
      }
      await new Promise(r => setTimeout(r, 2500));
      return poll();
    }

    const outputUrl = await poll();
    return res.status(200).json({ output_url: outputUrl });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
