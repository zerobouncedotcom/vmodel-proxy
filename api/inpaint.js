// Serverless-эндпоинт для Replicate ip_adapter-face-inpaint
// Принимает: { gender: "male"|"female", faceImageDataUrl: "data:image/..." }
// Возвращает: { url: "https://..." } — итоговая картинка

export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // при желании поставь свой домен
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { gender, faceImageDataUrl } = req.body || {};
    if (!gender || !faceImageDataUrl) {
      return res.status(400).json({ error: "Missing gender or faceImageDataUrl" });
    }

    // --- ТВОИ ШАБЛОНЫ ---
    // БАЗОВОЕ ИЗОБРАЖЕНИЕ (source_image): «Мот + модель»
    // Возьми те же, что были у вас в face-swap коде (прямые URL, без atob для простоты)
    const TEMPLATE = {
      male:   "https://static.tildacdn.com/tild3238-3562-4031-b135-633133365363/shablon_m.jpg", // твой шаблон с мужским сетапом
      female: "https://static.tildacdn.com/tild3665-6338-4236-a262-643963326236/shablon_w.jpg"  // твой шаблон с женским сетапом
    };

    // МАСКИ (mask_image): ОТ КЛИЕНТА
    const MASK = {
      male:   "https://static.tildacdn.com/tild3834-3435-4431-a163-613738653662/__v4_.png",
      female: "https://static.tildacdn.com/tild3364-6438-4335-a433-653263343039/__v4_.png"
    };

    const source_image = TEMPLATE[gender];
    const mask_image   = MASK[gender];
    const face_image   = faceImageDataUrl; // data:image/...;base64,...

    if (!source_image || !mask_image) {
      return res.status(400).json({ error: "Bad gender or missing template/mask url" });
    }

    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN on server" });
    }

    // 1) Создаём prediction (без явного version — берём последнюю версию модели)
    const createResp = await fetch(
      "https://api.replicate.com/v1/models/lucataco/ip_adapter-face-inpaint/predictions",
      {
        method: "POST",
        headers: {
          "Authorization": `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: {
            // Минимальный нужный набор
            face_image,          // data URL пользователя
            source_image,        // твой шаблон
            mask_image,          // твоя маска
            // Пара ручек (при желании подстрой):
            // "num_inference_steps": 30,
            // "guidance_scale": 7.0
          }
        })
      }
    );

    if (!createResp.ok) {
      const t = await createResp.text();
      return res.status(createResp.status).json({ error: `Create prediction failed: ${t}` });
    }

    const prediction = await createResp.json();
    const id = prediction?.id;
    if (!id) return res.status(500).json({ error: "No prediction id from Replicate" });

    // 2) Поллим статус
    let outputUrl = null;
    for (let i = 0; i < 60; i++) { // до ~60 * 2с = 2 минуты
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { "Authorization": `Token ${REPLICATE_API_TOKEN}` }
      });
      const data = await poll.json();

      if (data.status === "succeeded") {
        // Обычно output — массив ссылок
        const out = data.output;
        if (Array.isArray(out) && out.length) outputUrl = out[0];
        else if (typeof out === "string")      outputUrl = out;
        break;
      }
      if (data.status === "failed" || data.status === "canceled") {
        return res.status(500).json({ error: `Replicate failed: ${data.error || data.status}` });
      }
    }

    if (!outputUrl) {
      return res.status(504).json({ error: "Timed out waiting for result" });
    }

    return res.json({ url: outputUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
