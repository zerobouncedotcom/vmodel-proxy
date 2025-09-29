// /api/ip-inpaint.js  (Vercel)
// Требуется env: REPLICATE_API_TOKEN

export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } } // чтобы влезало base64 фото
};

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

// --- ТВОИ ШАБЛОНЫ (как были у разраба, оставил в atob) ---
const TEMPLATE_M_URL = atob('aHR0cHM6Ly9zdGF0aWMudGlsZGFjZG4uY29tL3RpbGQzMjM4LTM1NjItNDAzMS1iMTM1LTYzMzEzMzY1MzYzNS9zaGFibG9uX20uanBn');
const TEMPLATE_W_URL = atob('aHR0cHM6Ly9zdGF0aWMudGlsZGFjZG4uY29tL3RpbGQzNjY1LTYzMzgtNDIzNi1hMjYyLTY0Mzk2MzMyNjIzNi9zaGFibG9uX3cuanBn');

// --- ТВОИ МАСКИ (прозрачный фон, белая область замены) ---
const MASK_W_URL = 'https://static.tildacdn.com/tild3364-6438-4335-a433-653263343039/__v4_.png';
const MASK_M_URL = 'https://static.tildacdn.com/tild3834-3435-4431-a163-613738653662/__v4_.png';

// Помощник ожидания
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST' });
      return;
    }
    if (!REPLICATE_TOKEN) {
      res.status(500).json({ error: 'Missing REPLICATE_API_TOKEN env' });
      return;
    }

    const { gender, face_image_base64, prompt } = req.body || {};
    if (!gender || !face_image_base64) {
      res.status(400).json({ error: 'gender and face_image_base64 required' });
      return;
    }

    const isMale = gender === 'male';
    const image  = isMale ? TEMPLATE_M_URL : TEMPLATE_W_URL;
    const mask   = isMale ? MASK_M_URL     : MASK_W_URL;

    // Минимальный безопасный промпт (можешь править под вкус)
    const finalPrompt = prompt && String(prompt).trim().length
      ? prompt
      : 'realistic head replacement, match lighting and perspective, natural skin tone';

    // 1) создаём предикшен (можно через slug модели — так проще поддерживать last version)
    const createResp = await fetch('https://api.replicate.com/v1/models/lucataco/ip_adapter-face-inpaint/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: {
          image,              // шаблон (с МОТ)
          mask,               // твоя белая маска (голова, волосы, шея)
          face_image: face_image_base64, // портрет юзера (dataURL/base64)
          prompt: finalPrompt,
          // Ниже дефолтные ручки — при желании можно поиграть:
          num_inference_steps: 28,
          guidance_scale: 4.5,
          seed: Math.floor(Math.random()*1e9),
        }
      })
    });

    const created = await createResp.json();
    if (!createResp.ok) {
      res.status(500).json({ error: 'Replicate create failed', details: created });
      return;
    }

    const pollUrl = created.urls?.get || created?.urls?.self || created?.id && `https://api.replicate.com/v1/predictions/${created.id}`;
    if (!pollUrl) {
      res.status(500).json({ error: 'No poll URL from Replicate', details: created });
      return;
    }

    // 2) Поллим до готовности
    let outputUrl = null;
    for (let i=0;i<60;i++){ // до ~60 * 2s = 2 мин
      await sleep(2000);
      const st = await fetch(pollUrl, { headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` }});
      const sj = await st.json();

      if (sj.status === 'succeeded' || sj.status === 'completed') {
        // output обычно: array of urls
        if (Array.isArray(sj.output) && sj.output.length) {
          outputUrl = sj.output[0];
        } else if (typeof sj.output === 'string') {
          outputUrl = sj.output;
        }
        break;
      }
      if (sj.status === 'failed' || sj.status === 'canceled') {
        return res.status(500).json({ error: 'Replicate job failed', details: sj });
      }
    }

    if (!outputUrl) {
      return res.status(504).json({ error: 'Timeout waiting for result' });
    }

    res.status(200).json({ ok:true, url: outputUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'Server error', details: String(e?.message || e) });
  }
}
