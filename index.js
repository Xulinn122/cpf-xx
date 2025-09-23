const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const fs = require("fs");

const CREDENTIALS = { usuario: "2300869KAMYLA", senha: "Xulinn_777" };
const BROWSER_OPTIONS = {
  headless: chromium.headless,
  defaultViewport: chromium.defaultViewport,
  args: chromium.args,
  executablePath: chromium.executablePath(), // ✅ sem await
};


async function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function validarCPF(cpf) {
  const num = cpf.replace(/\D/g, "");
  return num.length === 11 || num.length === 15;
}

async function openCNS(cpf) {
  if (!validarCPF(cpf)) {
    return { success: false, error: "CPF/CNS inválido (precisa ter 11 ou 15 dígitos)" };
  }

  const browser = await puppeteer.launch(BROWSER_OPTIONS);
  const page = await browser.newPage();

  try {
    // LOGIN
    await page.goto("https://sisregiii.saude.gov.br", { waitUntil: "networkidle2", timeout: 60000 });
    await page.evaluate((usuario, senha) => {
      document.querySelector("#usuario").value = usuario;
      document.querySelector("#senha").value = senha;
      const btn = document.querySelector("input[name='entrar']");
      if (btn) btn.click();
    }, CREDENTIALS.usuario, CREDENTIALS.senha);

    try { await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }); } catch {}
    await delay(800);

    // HOVER CONSULTA GERAL + CLICAR CNS
    const menuHandle = await page.evaluateHandle(() => {
      const links = Array.from(document.querySelectorAll("a.sf-with-ul"));
      return links.find(a => a.textContent.toLowerCase().includes("consulta geral"));
    });
    if (!menuHandle) throw new Error("Não encontrou o menu 'consulta geral'");
    await menuHandle.asElement().hover();
    await delay(500);

    const cnsSelector = "a[href*='cadweb50']";
    await page.waitForSelector(cnsSelector, { timeout: 10000 });
    await page.click(cnsSelector);

    // FRAME
    let targetFrame = null;
    const start = Date.now();
    while ((Date.now() - start) < 10000) {
      await delay(200);
      const frames = page.frames();
      targetFrame = frames.find(f => {
        try {
          return f.name().includes("f_principal") || f.url().includes("cadweb50");
        } catch { return false; }
      });
      if (targetFrame) break;
    }
    if (!targetFrame) throw new Error("Não encontrei o frame 'f_principal'");
    await targetFrame.waitForSelector("body", { timeout: 10000 });
    await delay(500);

    // INSERIR CPF/CNS
    await targetFrame.evaluate((cpf) => {
      const input = document.querySelector("input[name='nu_cns']");
      if (input) input.value = cpf;
      const btn = document.querySelector("input[name='btn_pesquisar']");
      if (btn) btn.click();
    }, cpf);
    await delay(2000);

    // EXTRAÇÃO DOS DADOS
    const dados = await targetFrame.evaluate(() => {
      const normalize = txt => txt ? txt.replace(/\s+/g, " ").trim() : "";

      // CNS
      const cns = normalize(document.querySelector("font b")?.textContent);

      // Função para pegar valor pelo label
      const tds = Array.from(document.querySelectorAll("td"));
      const getValue = (label) => {
        for (let i = 0; i < tds.length; i++) {
          if (normalize(tds[i].textContent) === label) {
            return normalize(tds[i + 2]?.textContent || tds[i + 1]?.textContent);
          }
        }
        return "---";
      };

      // Dados Pessoais
      const dadosPessoais = {
        Nome: getValue("Nome:"),
        "Nome Social / Apelido": getValue("Nome Social / Apelido:"),
        "Nome da Mãe": getValue("Nome da Mãe:"),
        "Nome do Pai": getValue("Nome do Pai:"),
        Sexo: getValue("Sexo:"),
        Raça: getValue("Raça:"),
        "Data de Nascimento": getValue("Data de Nascimento:"),
        "Tipo Sanguíneo": getValue("Tipo Sanguíneo:"),
        Nacionalidade: getValue("Nacionalidade:"),
        "Município de Nascimento": getValue("Município de Nascimento:")
      };

      // Endereço
      const endereco = {
        "Tipo Logradouro": getValue("Tipo Logradouro:"),
        Logradouro: getValue("Logradouro:"),
        Complemento: getValue("Complemento:"),
        Número: getValue("Número:"),
        Bairro: getValue("Bairro:"),
        CEP: getValue("CEP:"),
        "País de Residência": getValue("País de Residência:"),
        "Município de Residência": getValue("Município de Residência:")
      };

      // Contatos (Telefones)
      const telefones = [];
      const phoneTables = document.querySelectorAll("table.table_listagem");
      if (phoneTables.length > 0) {
        const phoneRows = phoneTables[0].querySelectorAll("tbody tr");
        for (let i = 1; i < phoneRows.length; i++) {
          const tds = phoneRows[i].querySelectorAll("td");
          if (tds.length === 3) {
            telefones.push({
              "Tipo Telefone": tds[0]?.textContent.trim() || "",
              "DDD": tds[1]?.textContent.trim() || "",
              "Número": tds[2]?.textContent.trim() || ""
            });
          }
        }
      }

      // Documentos
      let cpf = "";
      let rg = { "Número": "", "Órgão Emissor": "", "Estado Emissor": "", "Data de Emissão": "" };

      // CPF
      const cpfTr = Array.from(document.querySelectorAll("tr"))
        .find(tr => tr.querySelector("td")?.textContent.includes("CPF:"));
      if (cpfTr) {
        const cpfValueTr = cpfTr.nextElementSibling;
        cpf = cpfValueTr?.querySelector("td")?.textContent.trim() || "";
      }

      // RG
      const rgContainer = Array.from(document.querySelectorAll("tr")).find(tr =>
        tr.querySelector("table.table_listagem tbody tr td")?.textContent.includes("Num. RG")
      );
      if (rgContainer) {
        const rgTable = rgContainer.querySelector("table.table_listagem");
        if (rgTable) {
          const rgCols = rgTable.querySelectorAll("tbody tr:nth-child(2) td");
          rg = {
            "Número": rgCols[0]?.textContent.trim() || "",
            "Órgão Emissor": rgCols[1]?.textContent.trim() || "",
            "Estado Emissor": rgCols[2]?.textContent.trim() || "",
            "Data de Emissão": rgCols[3]?.textContent.trim() || ""
          };
        }
      }

      return {
        CNS: cns,
        "Dados Pessoais": dadosPessoais,
        Endereço: endereco,
        Contatos: telefones,
        Documentos: { CPF: cpf, RG: rg }
      };
    });

    await browser.close();
    return { success: true, frameUrl: targetFrame.url(), dados };

  } catch (err) {
    console.error("Erro:", err.message);
    try { await page.screenshot({ path: "erro.png", fullPage: true }); } catch {}
    try { await fs.promises.writeFile("erro_page.html", await page.content()); } catch {}
    await browser.close();
    return { success: false, error: err.message };
  }
}

module.exports = { openCNS };
