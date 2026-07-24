const assert = require("assert");
const Module = require("module");
const fs = require("fs");
const path = require("path");

const originalLoad = Module._load;
let htmlKabum = "";
let ultimaUrlBaixada = "";
let ultimoDeepLinkOriginal = "";

Module._load = function loadComAxiosMock(request, parent, isMain) {
  if (request === "axios") {
    return {
      get: async (url) => {
        ultimaUrlBaixada = url;
        return {
          status: 200,
          data: htmlKabum
        };
      }
    };
  }

  return originalLoad.apply(this, arguments);
};

const {
  diagnosticarProdutoKabum,
  importarProdutoKabumViaAwin,
  limparSufixoTituloKabum,
  tituloGenericoKabum
} = require("../marketplaces/kabum/importador");

Module._load = originalLoad;

function htmlProduto(titulo, extras = {}) {
  return [
    "<html><head>",
    `<title>${titulo}</title>`,
    extras.imagem ? `<meta property="og:image" content="${extras.imagem}">` : "",
    "</head><body>",
    extras.texto || "R$ 595,00 a vista no PIX",
    "</body></html>"
  ].join("");
}

async function importarComHtml(url, html) {
  htmlKabum = html;
  ultimaUrlBaixada = "";
  ultimoDeepLinkOriginal = "";
  return importarProdutoKabumViaAwin(url, "admin", {
    gerarDeepLinkAwin: async (link) => {
      ultimoDeepLinkOriginal = link;
      return `https://awin.test/?ued=${encodeURIComponent(link)}`;
    }
  });
}

function normalizarEspacosTeste(valor = "") {
  return String(valor).replace(/\u00a0/g, " ");
}

async function assertImportacaoRejeitada(titulo, motivoEsperado) {
  htmlKabum = htmlProduto(titulo);

  await assert.rejects(
    () => importarProdutoKabumViaAwin("https://www.kabum.com.br/produto/944475/produto-teste", "admin", {
      gerarDeepLinkAwin: async (link) => link
    }),
    (erro) => erro.motivo === motivoEsperado
  );
}

async function testarTitulosGenericos() {
  assert.strictEqual(tituloGenericoKabum("BR Kabum").motivo, "kabum_titulo_generico");
  assert.strictEqual(tituloGenericoKabum("KaBuM").motivo, "kabum_titulo_generico");
  assert.strictEqual(tituloGenericoKabum("Access Denied").motivo, "kabum_html_intermediario");
  assert.strictEqual(tituloGenericoKabum("Just a moment... Cloudflare").motivo, "kabum_html_intermediario");
  assert.strictEqual(
    limparSufixoTituloKabum("Placa de Video ASUS RTX 5060 8GB | KaBuM!"),
    "Placa de Video ASUS RTX 5060 8GB"
  );

  await assertImportacaoRejeitada("BR Kabum", "kabum_titulo_generico");
  await assertImportacaoRejeitada("KaBuM", "kabum_titulo_generico");
  await assertImportacaoRejeitada("Access Denied", "kabum_html_intermediario");
}

async function testarProdutoComprovado() {
  const tituloReal = "Placa de Video ASUS RTX 5060 8GB | KaBuM!";
  const urlDireta = "https://www.kabum.com.br/produto/944475/placa-de-video-asus-rtx";
  const awin = `https://www.awin1.com/cread.php?ued=${encodeURIComponent(urlDireta)}&awinmid=17729`;

  assert.strictEqual(diagnosticarProdutoKabum(urlDireta, tituloReal, "").ok, true);
  assert.strictEqual(diagnosticarProdutoKabum(awin, tituloReal, "").ok, true);
  assert.strictEqual(diagnosticarProdutoKabum("https://www.kabum.com.br/oferta", tituloReal, "").motivo, "kabum_produto_nao_comprovado");

  const produto = await importarComHtml(urlDireta, htmlProduto(tituloReal));
  assert.strictEqual(produto.titulo, "Placa de Video ASUS RTX 5060 8GB");
  assert.strictEqual(produto.produtoIdCanonico, "944475");
  assert.strictEqual(produto.chaveCanonica, "kabum:944475");
  assert.strictEqual(produto.imagem, "");
  assert.strictEqual(ultimaUrlBaixada, urlDireta);

  const urlWaterCooler = "https://www.kabum.com.br/produto/921292/water-cooler-mach1-logic-rgb-120mm-amd-e-intel-preto-gk120";
  const urlWaterCoolerComTracking = `${urlWaterCooler}?gad_source=1&gad_campaignid=abc&gbraid=def&gclid=ghi&utm_source=google&cor=preto`;
  const urlWaterCoolerHttpEsperada = `${urlWaterCooler}?cor=preto`;
  const htmlWaterCooler = htmlProduto(
    "Water Cooler MACH1 Logic, RGB, 120mm, AMD e Intel, Preto - GK120 | KaBuM!",
    {
      texto: [
        '<script type="application/ld+json">',
        '{"offers":{"price":199.99},"image":"https://images.kabum.com.br/produtos/fotos/921292/water-cooler-mach1-logic-rgb-120mm.jpg"}',
        "</script>"
      ].join("")
    }
  );
  const produtoWaterCooler = await importarComHtml(urlWaterCoolerComTracking, htmlWaterCooler);
  assert.strictEqual(produtoWaterCooler.titulo, "Water Cooler MACH1 Logic, RGB, 120mm, AMD e Intel, Preto - GK120");
  assert.strictEqual(normalizarEspacosTeste(produtoWaterCooler.precoAtual), "R$ 199,99");
  assert.strictEqual(
    produtoWaterCooler.imagem,
    "https://images.kabum.com.br/produtos/fotos/921292/water-cooler-mach1-logic-rgb-120mm.jpg"
  );
  assert.strictEqual(produtoWaterCooler.produtoIdCanonico, "921292");
  assert.strictEqual(ultimaUrlBaixada, urlWaterCoolerHttpEsperada);
  assert.strictEqual(ultimoDeepLinkOriginal, urlWaterCoolerComTracking);
  assert.ok(produtoWaterCooler.linkAfiliado.startsWith("https://awin.test/?ued="));
  assert.notStrictEqual(produtoWaterCooler.linkAfiliado, urlWaterCoolerComTracking);
}

function testarContratoIndex() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

  assert.ok(fonte.includes("Retida por falta de destino compatível."));
  assert.ok(!fonte.includes("Retida por falta de destino compatÃ"));
  assert.ok(fonte.includes("function retidaCanonicaJaExiste"));
  assert.ok(fonte.includes("[RADAR-RETIDA-CANONICA-DUPLICADA]"));
  assert.ok(fonte.includes("[RADAR-KABUM-DESCARTADA-INCOMPLETA]"));
  assert.ok(fonte.includes("motivoKabumIncompletoControlado"));
}

(async () => {
  await testarTitulosGenericos();
  await testarProdutoComprovado();
  testarContratoIndex();
  console.log("kabum-hotfix.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
