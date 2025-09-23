export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.VMODEL_TOKEN;
  if (!token) return res.status(500).json({ error: "VMODEL_TOKEN missing" });

  try {
    const { swap_image, target_image } = req.body || {};
    if (!swap_image || !target_image) {
      return res.status(400).json({ error: "swap_image and target_image are required" });
    }

    // 1) создаём таск
    const fd = new FormData();
    fd.append("version", "3a8d261fd14126eecec9f812b52b40811e9ed557cce5706452888cdeebc0b6"); // версия модели Photo Face Swap (из их страницы)
    fd.append("input", JSON.stringify({
      swap_image,         // лицо пользователя
      target_image,       // целевая фотка (МОТ)
      disable_safety_checker: false
    }));

    const create = await fetch("https://api.vmodel.ai/api/tasks/v1/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });

    if (!create.ok) {
      const txt = await create.text().catch(()=> "");
      return res.status(create.status).json({ error: "create failed", details: txt });
    }
    const created = await create.json();

    const taskId = created?.id || created?.task_id || created?.data?.id;
    if (!taskId) return res.status(500).json({ error: "No task id in response", raw: created });

    // 2) ждём готовность
    const started = Date.now();
    const deadlineMs = 90_000; // ждём до 90 сек
    let outputUrl = null, lastStatus = "pending";

    while (Date.now() - started < deadlineMs) {
      await delay(3000);
      const get = await fetch(`https://api.vmodel.ai/api/tasks/v1/get?task_id=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!get.ok) {
        lastStatus = `get_failed_${get.status}`;
        break;
      }
      const info = await get.json();
      lastStatus = info?.status || info?.data?.status || lastStatus;

      if (lastStatus === "succeeded") {
        // обычно output — массив URL
        const out = info?.output || info?.data?.output;
        outputUrl = Array.isArray(out) ? out[0] : (typeof out === "string" ? out : null);
        break;
      }
      if (lastStatus === "failed" || lastStatus === "canceled") break;
    }

    if (!outputUrl) {
      return res.status(200).json({ status: lastStatus || "pending", url: null });
    }

    return res.status(200).json({ status: "succeeded", url: outputUrl });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e) });
  }
}

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
