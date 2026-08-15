const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-kabum-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  importarKabumAwinManualV2,
  produtoIdKabumManual,
  produtoKabumGenerico,
  precoAnteriorManualKabum,
  urlAfiliadaAwinGerada
} = require("../modules/manual-v2/adapters/kabum-awin.manual.adapter");

const agora = "2026-08-14T13:50:00.000Z";
const idFactory = () => "manual_v2_kabum";

function criarDeps(produto, chamadas = []) {
  return {
    clienteId: "cliente_kabum",
    now: agora,
    idFactory,
    async importarProdutoKabumViaAwin(url, clienteId, deps) {
      chamadas.push({
        tipo: "importarProdutoKabumViaAwin",
        url,
        clienteId,
        temGerarDeepLinkAwin: typeof deps.gerarDeepLinkAwin === "function"
      });
      return produto;
    },
    async gerarDeepLinkAwin(url, clienteId) {
      chamadas.push({ tipo: "gerarDeepLinkAwin", url, clienteId });
      return "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=123&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F944475%2Fproduto";
    }
  };
}

(async function main() {
{
  assert.strictEqual(
    produtoIdKabumManual({}, "https://www.kabum.com.br/produto/944475/produto-teste"),
    "944475"
  );
  assert.strictEqual(produtoKabumGenerico({ titulo: "Produto importado de Awin" }), true);
  assert.strictEqual(precoAnteriorManualKabum({
    produtoId: "944475",
    precoAntigo: "R$ 899,90"
  }), "R$ 899,90");
  assert.strictEqual(precoAnteriorManualKabum({
    produtoId: "944475",
    precoAntigo: "R$ 899,90",
    precoAntigoOrigem: "calculado_por_desconto"
  }), "");
  assert.strictEqual(urlAfiliadaAwinGerada({
    linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=123&ued=x"
  }, "https://www.kabum.com.br/produto/944475/produto"), "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=123&ued=x");
  assert.strictEqual(urlAfiliadaAwinGerada({
    linkAfiliado: "https://www.kabum.com.br/produto/944475/produto"
  }, "https://www.kabum.com.br/produto/944475/produto"), "");
}

{
  const chamadas = [];
  const oferta = await importarKabumAwinManualV2("https://www.kabum.com.br/produto/944475/placa-de-video", criarDeps({
    marketplace: "kabum",
    produtoId: "944475",
    produtoIdCanonico: "944475",
    linkOriginal: "https://www.kabum.com.br/produto/944475/placa-de-video",
    linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&awinaffid=123&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F944475%2Fplaca-de-video",
    titulo: "Placa de Video ASUS RTX 5060 8GB",
    precoAtual: "R$ 799,90",
    precoAntigo: "R$ 999,90",
    imagem: "https://images.kabum.com.br/produtos/fotos/944475/placa.jpg",
    categoria: "Gamer e Hardware",
    parcelamento: "10x de R$ 79,99 sem juros"
  }, chamadas));

  assert.strictEqual(oferta.id, "manual_v2_kabum");
  assert.strictEqual(oferta.clienteId, "cliente_kabum");
  assert.strictEqual(oferta.marketplace, "kabum");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.urlOriginal, "https://www.kabum.com.br/produto/944475/placa-de-video");
  assert.ok(oferta.urlAfiliada.startsWith("https://www.awin1.com/cread.php"));
  assert.strictEqual(oferta.titulo, "Placa de Video ASUS RTX 5060 8GB");
  assert.strictEqual(oferta.precoAtual, "R$ 799,90");
  assert.strictEqual(oferta.precoAnterior, "R$ 999,90");
  assert.strictEqual(oferta.imagem, "https://images.kabum.com.br/produtos/fotos/944475/placa.jpg");
  assert.strictEqual(oferta.categoria, "Gamer e Hardware");
  assert.strictEqual(oferta.parcelamento, "10x de R$ 79,99 sem juros");
  assert.strictEqual(oferta.cupom, "");
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "kabum");
  assert.strictEqual(oferta.fonteImportacao.adapter, "kabum-awin.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAnterior"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("urlAfiliada"));
  assert.deepStrictEqual(chamadas, [
    {
      tipo: "importarProdutoKabumViaAwin",
      url: "https://www.kabum.com.br/produto/944475/placa-de-video",
      clienteId: "cliente_kabum",
      temGerarDeepLinkAwin: true
    }
  ]);
}

{
  const oferta = await importarKabumAwinManualV2("https://www.kabum.com.br/produto/921292/water-cooler", criarDeps({
    marketplace: "kabum",
    produtoIdCanonico: "921292",
    linkOriginal: "https://www.kabum.com.br/produto/921292/water-cooler",
    linkAfiliado: "https://www.awin1.com/cread.php?awinmid=17729&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F921292%2Fwater-cooler",
    titulo: "Water Cooler MACH1 Logic RGB",
    precoAtual: "R$ 199,99",
    avisoPagamento: "A vista no PIX",
    imagem: "https://images.kabum.com.br/produtos/fotos/921292/water.jpg",
    parcelamento: "5x de R$ 43,00 sem juros"
  }));

  assert.strictEqual(oferta.precoAtual, "R$ 199,99");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.ok(oferta.observacoes.includes("A vista no PIX"));
}

{
  const oferta = await importarKabumAwinManualV2("https://www.kabum.com.br/produto/111111/produto-sem-awin", criarDeps({
    marketplace: "kabum",
    produtoIdCanonico: "111111",
    linkOriginal: "https://www.kabum.com.br/produto/111111/produto-sem-awin",
    linkAfiliado: "https://www.kabum.com.br/produto/111111/produto-sem-awin",
    titulo: "Produto KaBuM sem deeplink",
    precoAtual: "R$ 349,90",
    precoAntigo: "",
    imagem: ""
  }));

  assert.strictEqual(oferta.precoAtual, "R$ 349,90");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("awin_deeplink_ausente_url_afiliada_vazia"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("urlAfiliada"));
}

{
  const oferta = await importarKabumAwinManualV2("https://www.kabum.com.br/produto/222222/parcial", criarDeps({
    marketplace: "kabum",
    produtoIdCanonico: "222222",
    linkOriginal: "https://www.kabum.com.br/produto/222222/parcial",
    linkAfiliado: "",
    titulo: "",
    precoAtual: "",
    imagem: "",
    categoria: "KaBuM"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("kabum_retorno_parcial_campos_editaveis"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
}

{
  const chamadas = [];
  const oferta = await importarKabumAwinManualV2("https://www.kabum.com.br/produto/333333/falha", {
    clienteId: "cliente_kabum",
    now: agora,
    idFactory,
    async importarProdutoKabumViaAwin() {
      chamadas.push("importador");
      const erro = new Error("kabum_http_403");
      erro.motivo = "kabum_http_403";
      throw erro;
    },
    async gerarDeepLinkAwin() {
      chamadas.push("deeplink");
      return "https://www.awin1.com/cread.php?x=1";
    }
  });

  assert.deepStrictEqual(chamadas, ["importador"]);
  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("kabum_http_403"));
}

{
  const arquivoManual = getClienteJsonPath("cliente_kabum", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_kabum", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "kabum-awin.manual.adapter.js"),
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
    assert.ok(!fonte.includes(termo), `Adapter KaBuM/AWIN Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-kabum.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
