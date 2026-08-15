const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-aliexpress-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  importarAliExpressManualV2,
  productIdManualAliExpress,
  retornoGenericoAliExpress,
  precoAnteriorManualAliExpress,
  urlAfiliadaGeradaAliExpress
} = require("../modules/manual-v2/adapters/aliexpress.manual.adapter");

const agora = "2026-08-14T13:25:00.000Z";
const idFactory = () => "manual_v2_aliexpress";

function criarDeps(produto, chamadas = []) {
  return {
    clienteId: "cliente_aliexpress",
    now: agora,
    idFactory,
    getIntegracaoCliente(clienteId, marketplace) {
      chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
      return {
        credenciais: {
          appKey: "app_ali",
          secret: "secret_ali",
          trackingId: "track_ali"
        }
      };
    },
    async importarAliExpress(url, config) {
      chamadas.push({
        tipo: "importarAliExpress",
        url,
        clienteId: config?.clienteId || "",
        trackingId: config?.credenciais?.trackingId || "",
        temContextoAutomatico: Boolean(config?.contextoEngine || config?.contextoRadar || config?.textoRadar)
      });
      return produto;
    }
  };
}

(async function main() {
{
  assert.strictEqual(
    productIdManualAliExpress({}, "https://www.aliexpress.com/item/1005001234567890.html"),
    "1005001234567890"
  );
  assert.strictEqual(
    retornoGenericoAliExpress({
      titulo: "Produto AliExpress",
      erroTecnico: "aliexpress_manual_fallback_generico"
    }, "https://sale.aliexpress.com/landing"),
    true
  );
  assert.strictEqual(precoAnteriorManualAliExpress({
    productId: "1005001234567890",
    precoAntigo: "199,90"
  }), "199,90");
  assert.strictEqual(precoAnteriorManualAliExpress({
    precoAntigo: "199,90",
    precoAntigoOrigem: "calculado_por_desconto"
  }), "");
  assert.strictEqual(urlAfiliadaGeradaAliExpress({
    linkAfiliado: "https://s.click.aliexpress.com/e/_DlPromo123"
  }), "https://s.click.aliexpress.com/e/_DlPromo123");
  assert.strictEqual(urlAfiliadaGeradaAliExpress({
    linkAfiliado: "https://www.aliexpress.com/item/1005001234567890.html"
  }), "");
}

{
  const chamadas = [];
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005001111111111.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005001111111111",
    linkOriginal: "https://www.aliexpress.com/item/1005001111111111.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT111",
    titulo: "Produto AliExpress Real",
    precoAtual: "129,90",
    precoAntigo: "199,90",
    imagem: "https://ae01.alicdn.com/produto.jpg",
    categoriaProduto: "Casa e Jardim",
    avisoCupom: "Compra internacional. Pode haver imposto/taxa. Confira cupom ou desconto com moedas na pagina."
  }, chamadas));

  assert.strictEqual(oferta.id, "manual_v2_aliexpress");
  assert.strictEqual(oferta.clienteId, "cliente_aliexpress");
  assert.strictEqual(oferta.marketplace, "aliexpress");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.urlOriginal, "https://www.aliexpress.com/item/1005001111111111.html");
  assert.strictEqual(oferta.urlAfiliada, "https://s.click.aliexpress.com/e/_SHORT111");
  assert.strictEqual(oferta.titulo, "Produto AliExpress Real");
  assert.strictEqual(oferta.precoAtual, "129,90");
  assert.strictEqual(oferta.precoAnterior, "199,90");
  assert.strictEqual(oferta.imagem, "https://ae01.alicdn.com/produto.jpg");
  assert.strictEqual(oferta.categoria, "Casa e Jardim");
  assert.strictEqual(oferta.cupom, "");
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "aliexpress");
  assert.strictEqual(oferta.fonteImportacao.adapter, "aliexpress.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAnterior"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("urlAfiliada"));
  assert.deepStrictEqual(chamadas, [
    {
      tipo: "getIntegracaoCliente",
      clienteId: "cliente_aliexpress",
      marketplace: "aliexpress"
    },
    {
      tipo: "importarAliExpress",
      url: "https://www.aliexpress.com/item/1005001111111111.html",
      clienteId: "cliente_aliexpress",
      trackingId: "track_ali",
      temContextoAutomatico: false
    }
  ]);
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005002222222222.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005002222222222",
    linkOriginal: "https://www.aliexpress.com/item/1005002222222222.html",
    linkAfiliado: "https://www.aliexpress.com/item/1005002222222222.html",
    titulo: "Produto Parcial AliExpress",
    precoAtual: "",
    precoAntigo: "",
    imagem: "",
    categoria: "AliExpress",
    aviso: "Dados parciais retornados pela API AliExpress."
  }));

  assert.strictEqual(oferta.titulo, "Produto Parcial AliExpress");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("url_afiliada_ignorada_sem_shortlink_confirmado"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("imagem"));
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005003333333333.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005003333333333",
    linkOriginal: "https://www.aliexpress.com/item/1005003333333333.html",
    linkAfiliado: "https://s.click.aliexpress.com/e/_SHORT333",
    titulo: "Produto sem de",
    precoAtual: "89,90",
    imagem: ""
  }));

  assert.strictEqual(oferta.precoAtual, "89,90");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAnterior"));
}

{
  const oferta = await importarAliExpressManualV2("https://sale.aliexpress.com/coins-land.htm", criarDeps({
    marketplace: "aliexpress",
    titulo: "Produto AliExpress",
    precoAtual: "",
    precoAntigo: "",
    linkOriginal: "https://sale.aliexpress.com/coins-land.htm",
    linkAfiliado: "https://sale.aliexpress.com/coins-land.htm",
    imagem: "",
    categoria: "AliExpress",
    erroTecnico: "aliexpress_manual_fallback_generico",
    motivoErroAliExpress: "product_id_ausente"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("aliexpress_product_id_ausente_sem_produto_fabricado"));
  assert.ok(oferta.fonteImportacao.avisos.includes("aliexpress_retorno_generico_ignorado_no_manual_v2"));
}

{
  const oferta = await importarAliExpressManualV2("https://www.aliexpress.com/item/1005004444444444.html", criarDeps({
    marketplace: "aliexpress",
    productId: "1005004444444444",
    linkOriginal: "https://www.aliexpress.com/item/1005004444444444.html",
    linkAfiliado: "",
    titulo: "",
    precoAtual: "",
    imagem: ""
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("urlAfiliada"));
}

{
  const arquivoManual = getClienteJsonPath("cliente_aliexpress", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_aliexpress", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "aliexpress.manual.adapter.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "processarFila",
    "prepararOfertaGlobal",
    "adicionarOfertaInicioFila",
    "Distributor",
    "Engine",
    "Oferta Universal",
    "oferta-universal",
    "inteligencia-universal",
    "memoria-ofertas",
    "radar-ofertas",
    "/fila",
    "/enviar-manual",
    "manual-offers.storage",
    "registrarRadarCupons",
    "contextoEngine",
    "contextoRadar"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Adapter AliExpress Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-aliexpress.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
