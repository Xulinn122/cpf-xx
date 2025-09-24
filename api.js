const express = require("express");
const cors = require("cors");
const { openCNS } = require("./index.js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;
const API_KEY = "Xulinn";

app.get("/cns", async (req, res) => {
  const { cpf, apikey } = req.query;

  if (!cpf || !/^\d{11,15}$/.test(cpf))
    return res.status(400).json({ success: false, error: "CPF inválido" });

  if (!apikey || apikey !== API_KEY)
    return res.status(401).json({ success: false, error: "API Key inválida" });

  try {
    const result = await openCNS(cpf);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`API rodando.}`));
