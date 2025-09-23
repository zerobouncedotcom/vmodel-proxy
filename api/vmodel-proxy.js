const fetch = require("node-fetch");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { swap_image, target_image } = req.body;

    if (!swap_image || !target_image) {
      return res.status(400).json({ error: "swap_image и target_image обязательны" });
    }

    const response = await fetch("https://api.vmodel.ai/api/tasks/v1/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VMODEL_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "3a8d261fd14126eecec9812b52b40811e9ed557cce5706452888cdeebc0b6",
        input: {
          swap_image,
          target_image,
          disable_safety_checker: false
        }
      })
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
