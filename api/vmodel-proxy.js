export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const formData = new FormData();
    formData.append("version", "3a8d261fd14126eecec9f812b52b40811e9ed557cce5706452888cdeebc0b6");
    formData.append("input", JSON.stringify({
      swap_image: req.body.swap_image,
      target_image: req.body.target_image,
      disable_safety_checker: false
    }));

    const response = await fetch("https://api.vmodel.ai/api/tasks/v1/create", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VMODEL_TOKEN}`
      },
      body: formData
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
