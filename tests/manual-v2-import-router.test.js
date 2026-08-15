const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-router-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  normalizarOfertaManualV2
} = require("../modules/manual-v2/manual-offers.contract");
const {
  detectarMarketplaceManualV2,
  importarUrlManualV2,
  destinoKabumEmLinkAwin
} = require("../modules/manual-v2/manual-import.adapters");

const agora = "2026-08-14T14:10:00.000Z";

function ofertaAdapter(marketplace, adapter, url, clienteId = "cliente_router") {
  return normalizarOfertaManualV2(
    {
      marketplace,
      urlOriginal: url,
      titulo: `Produto ${marketplace}`,
      precoAtual: "99,90",
      fonteImportacao: {
        marketplaceDetectado: marketplace,
        adapter,
        parseOnly: true,
        avisos: []
      }
    },
    {
      clienteId,
      now: agora,
      idFactory: () => `manual_v2_router_${marketplace}`
    }
  );
}

function criarAdapters(chamadas = []) {
  const nomes = ["mercadolivre", "amazon", "shopee", "aliexpress", "kabum"];
  const adapters = {};

  for (const nome of nomes) {
    adapters[nome] = async (url, opcoes = {}) => {
      chamadas.push({
        adapter: nome,
        url,
        clienteId: opcoes.clienteId || "",
        marketplaceDetectado: opcoes.marketplaceDetectado || ""
      });
      return ofertaAdapter(nome, `${nome}.fake.adapter`, url, opcoes.clienteId);
    };
  }

  return adapters;
}

async function assertRoteiaSomente(url, esperado) {
  const chamadas = [];
  const oferta = await importarUrlManualV2(url, {
    clienteId: "cliente_router",
    adapters: criarAdapters(chamadas)
  });

  assert.strictEqual(oferta.marketplace, esperado);
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.deepStrictEqual(chamadas.map(item => item.adapter), [esperado]);
  assert.strictEqual(chamadas[0].marketplaceDetectado, esperado);
}

(async function main() {
{
  assert.strictEqual(detectarMarketplaceManualV2("https://www.mercadolivre.com.br/produto/p/MLB123").marketplace, "mercadolivre");
  assert.strictEqual(detectarMarketplaceManualV2("https://www.amazon.com.br/dp/B0ABCDEF12").marketplace, "amazon");
  assert.strictEqual(detectarMarketplaceManualV2("https://shopee.com.br/product/111/222").marketplace, "shopee");
  assert.strictEqual(detectarMarketplaceManualV2("https://www.aliexpress.com/item/1005001234567890.html").marketplace, "aliexpress");
  assert.strictEqual(detectarMarketplaceManualV2("https://www.kabum.com.br/produto/944475/produto").marketplace, "kabum");
  assert.strictEqual(destinoKabumEmLinkAwin("https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F944475%2Fproduto"), true);
  assert.strictEqual(detectarMarketplaceManualV2("https://www.awin1.com/cread.php?ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F944475%2Fproduto").marketplace, "kabum");
}

{
  await assertRoteiaSomente("https://www.mercadolivre.com.br/produto/p/MLB123", "mercadolivre");
  await assertRoteiaSomente("https://www.amazon.com.br/dp/B0ABCDEF12", "amazon");
  await assertRoteiaSomente("https://shopee.com.br/product/111/222", "shopee");
  await assertRoteiaSomente("https://www.aliexpress.com/item/1005001234567890.html", "aliexpress");
  await assertRoteiaSomente("https://www.kabum.com.br/produto/944475/produto", "kabum");
}

{
  const chamadas = [];
  const resultado = await importarUrlManualV2("https://www.awin1.com/cread.php?awinmid=1", {
    clienteId: "cliente_router",
    adapters: criarAdapters(chamadas)
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "awin_sem_destino_kabum_comprovado");
  assert.deepStrictEqual(chamadas, []);
}

{
  const chamadas = [];
  const resultado = await importarUrlManualV2("https://example.com/produto", {
    clienteId: "cliente_router",
    adapters: criarAdapters(chamadas)
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "marketplace_manual_v2_nao_suportado");
  assert.deepStrictEqual(chamadas, []);
}

{
  const chamadas = [];
  const resultado = await importarUrlManualV2("not a url", {
    clienteId: "cliente_router",
    adapters: criarAdapters(chamadas)
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "url_manual_invalida");
  assert.deepStrictEqual(chamadas, []);
}

{
  const chamadas = [];
  const adapters = criarAdapters(chamadas);
  delete adapters.amazon;

  const resultado = await importarUrlManualV2("https://www.amazon.com.br/dp/B0ABCDEF12", {
    clienteId: "cliente_router",
    adapters
  });

  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.motivo, "adapter_manual_v2_indisponivel");
  assert.deepStrictEqual(chamadas, []);
}

{
  const arquivoManual = getClienteJsonPath("cliente_router", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_router", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "roteador parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "roteador parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "manual-import.adapters.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "importarKabumManualRequest",
    "adicionarOfertaNaFila",
    "salvarFila",
    "processarFila",
    "prepararOfertaGlobal",
    "Distributor",
    "Engine",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/kabum/importar",
    "/fila",
    "/enviar-manual",
    "manual-offers.storage",
    "registrarRadarCupons"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Roteador Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-router.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
