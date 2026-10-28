// Converte o HTML do Raio-X em PDF A4 (Chrome headless). Reaproveita o puppeteer-core instalado em video/.
// Uso: node raio_x/pdf.js raio_x/saida/mg_2222.html [--paginas]   (--paginas também salva uma imagem de cada página)
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require(path.join(__dirname, "../video/node_modules/puppeteer-core"));

const [, , entrada, flag] = process.argv;
const base = path.join(os.homedir(), ".cache/puppeteer/chrome");
const chrome = path.join(base, fs.readdirSync(base)[0], "chrome-linux64/chrome");

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("file://" + path.resolve(entrada), { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const saida = entrada.replace(/\.html$/, ".pdf");
  await page.pdf({ path: saida, format: "A4", printBackground: true, preferCSSPageSize: true });
  if (flag === "--paginas") {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    const n = await page.$$eval(".pag", (p) => p.length);
    for (let i = 0; i < n; i++) {
      const el = (await page.$$(".pag"))[i];
      await el.screenshot({ path: saida.replace(/\.pdf$/, `_p${i + 1}.png`) });
    }
  }
  await browser.close();
  console.log(saida);
})();
