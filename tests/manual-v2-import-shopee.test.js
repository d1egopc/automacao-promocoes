const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-shopee-"));

const {
  getClienteJsonPath
} = require("../utils/storage");
const {
  importarShopeeManualV2,
  resolverPrecosShopee,
  temFaixaRealShopee,
  precoAnteriorManualShopee,
  bloquearProdutoSemItemShopee,
  urlAfiliadaSeguraShopee
} = require("../modules/manual-v2/adapters/shopee.manual.adapter");
const {
  validarOfertaAfiliacaoWorkspaceShopee
} = require("../modules/marketplaces/shopee/afiliacao-workspace");
const {
  enviarOfertaManualV2
} = require("../modules/manual-v2/manual-dispatcher");

const agora = "2026-08-14T13:05:00.000Z";
const idFactory = () => "manual_v2_shopee";

function criarDeps(produto, chamadas = [], extras = {}) {
  return {
    clienteId: "cliente_shopee",
    now: agora,
    idFactory,
    getIntegracaoCliente(clienteId, marketplace) {
      chamadas.push({ tipo: "getIntegracaoCliente", clienteId, marketplace });
      return {
        credenciais: {
          appId: "app_shopee",
          secret: "secret_shopee"
        }
      };
    },
    async importarShopee(url, config) {
      chamadas.push({
        tipo: "importarShopee",
        url,
        clienteId: config?.clienteId || "",
        appId: config?.credenciais?.appId || "",
        temContextoAutomatico: Boolean(config?.contextoEngine || config?.contextoRadar || config?.textoRadar)
      });
      return produto;
    },
    async expandirShortlinkShopee() {
      return "https://shopee.com.br/product/111/222?mmp_pid=an_app_shopee&utm_source=an_app_shopee";
    },
    ...extras
  };
}

(async function main() {
{
  assert.strictEqual(temFaixaRealShopee("100,00", "150,00"), true);
  assert.strictEqual(temFaixaRealShopee("100,00", "100,00"), false);
  assert.deepStrictEqual(resolverPrecosShopee({
    precoAtual: "100,00",
    precoMin: "100,00",
    precoMax: "150,00",
    precoOrigem: "api_productOfferV2.priceMin_priceMax"
  }), {
    precoAtual: "",
    precoMin: "100,00",
    precoMax: "150,00",
    temVariacaoPreco: true
  });
  assert.deepStrictEqual(resolverPrecosShopee({
    precoAtual: "129,90",
    precoMin: "129,90",
    precoMax: "129,90",
    precoOrigem: "api_productOfferV2.priceMin"
  }), {
    precoAtual: "129,90",
    precoMin: "",
    precoMax: "",
    temVariacaoPreco: false
  });
  assert.strictEqual(precoAnteriorManualShopee({ precoAntigo: "199,90" }), "");
  assert.strictEqual(precoAnteriorManualShopee({
    precoAntigo: "199,90",
    precoAntigoOrigem: "html.price.before"
  }), "199,90");
  assert.strictEqual(bloquearProdutoSemItemShopee({
    motivo: "resgate_shopee_sem_conversao_landing",
    linkExpandido: "https://shopee.com.br/m/cupom-de-desconto"
  }, "https://shopee.com.br/m/cupom-de-desconto"), true);
  assert.strictEqual(urlAfiliadaSeguraShopee({
    offerLink: "https://s.shopee.com.br/abc123",
    productLink: "https://shopee.com.br/product/111/222"
  }, "https://shopee.com.br/product/111/222"), "https://s.shopee.com.br/abc123");
}

{
  const chamadas = [];
  const oferta = await importarShopeeManualV2("https://shopee.com.br/product/111/222", criarDeps({
    marketplace: "shopee",
    linkOriginal: "https://shopee.com.br/product/111/222",
    productLink: "https://shopee.com.br/product/111/222",
    offerLink: "https://s.shopee.com.br/oferta222",
    linkAfiliado: "https://s.shopee.com.br/oferta222",
    titulo: "Produto Shopee Real",
    precoAtual: "129,90",
    precoMin: "129,90",
    precoMax: "129,90",
    imagem: "https://cf.shopee.com.br/produto.jpg",
    categoria: "Eletronicos",
    cupom: "PROMO10",
    cupomOrigem: "api_voucher",
    parcelamento: "5x de R$ 25,98",
    itemId: "222",
    shopId: "111"
  }, chamadas));

  assert.strictEqual(oferta.id, "manual_v2_shopee");
  assert.strictEqual(oferta.clienteId, "cliente_shopee");
  assert.strictEqual(oferta.marketplace, "shopee");
  assert.strictEqual(oferta.status, "salva");
  assert.strictEqual(oferta.precoAtual, "129,90");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.precoMin, "");
  assert.strictEqual(oferta.precoMax, "");
  assert.strictEqual(oferta.temVariacaoPreco, false);
  assert.strictEqual(oferta.urlOriginal, "https://shopee.com.br/product/111/222");
  assert.strictEqual(oferta.urlAfiliada, "https://s.shopee.com.br/oferta222");
  assert.strictEqual(oferta.titulo, "Produto Shopee Real");
  assert.strictEqual(oferta.imagem, "https://cf.shopee.com.br/produto.jpg");
  assert.strictEqual(oferta.categoria, "Eletronicos");
  assert.strictEqual(oferta.cupom, "PROMO10");
  assert.strictEqual(oferta.parcelamento, "5x de R$ 25,98");
  assert.strictEqual(oferta.fonteImportacao.marketplaceDetectado, "shopee");
  assert.strictEqual(oferta.fonteImportacao.adapter, "shopee.manual.adapter");
  assert.strictEqual(oferta.fonteImportacao.parseOnly, true);
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoAtual"));
  assert.strictEqual(oferta.afiliacaoWorkspaceVerificada.conversaoStatus, "convertida");
  assert.strictEqual(oferta.afiliacaoWorkspaceVerificada.affiliateIdDetectado, "an_app_shopee");
  assert.ok(oferta.afiliacaoWorkspaceVerificada.urlFinalExpandida.includes("mmp_pid=an_app_shopee"));
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(oferta, {
    clienteId: "cliente_shopee",
    credenciais: { appId: "app_shopee", secret: "secret_shopee" },
    exigirAssinatura: true
  }).ok, true, "shortlink expandido com ownership do workspace deve gerar prova valida");
  assert.deepStrictEqual(chamadas, [
    {
      tipo: "getIntegracaoCliente",
      clienteId: "cliente_shopee",
      marketplace: "shopee"
    },
    {
      tipo: "importarShopee",
      url: "https://shopee.com.br/product/111/222",
      clienteId: "cliente_shopee",
      appId: "app_shopee",
      temContextoAutomatico: false
    }
  ]);
}

{
  const urlCurta = "https://s.shopee.com.br/origem-crua";
  const oferta = await importarShopeeManualV2("https://shopee.com.br/product/111/777", criarDeps({
    marketplace: "shopee",
    linkOriginal: "https://shopee.com.br/product/111/777",
    productLink: "https://shopee.com.br/product/111/777",
    offerLink: urlCurta,
    titulo: "Produto sem resolucao do shortlink",
    precoAtual: "79,90",
    imagem: "https://cf.shopee.com.br/produto-777.jpg",
    itemId: "777",
    shopId: "111"
  }, [], {
    expandirShortlinkShopee: async () => ""
  }));

  assert.strictEqual(oferta.urlAfiliada, urlCurta, "URL curta permanece apenas como materia-prima da oferta");
  assert.strictEqual(oferta.afiliacaoWorkspaceVerificada.urlFinalExpandida, "");
  assert.strictEqual(oferta.afiliacaoWorkspaceVerificada.conversaoStatus, "falhou");
  assert.strictEqual(validarOfertaAfiliacaoWorkspaceShopee(oferta, {
    clienteId: "cliente_shopee",
    credenciais: { appId: "app_shopee", secret: "secret_shopee" },
    exigirAssinatura: true
  }).ok, false, "shortlink sem ownership resolvido deve permanecer fail-closed");

  let envios = 0;
  const retorno = await enviarOfertaManualV2({
    clienteId: "cliente_shopee",
    ofertaId: oferta.id,
    destinosIds: ["destino_wa"]
  }, {
    buscarOfertaManualV2: () => oferta,
    getIntegracaoCliente: () => ({ credenciais: { appId: "app_shopee", secret: "secret_shopee" } }),
    enviarWhatsApp: async () => { envios += 1; }
  });
  assert.strictEqual(retorno.motivoGlobal, "afiliacao_workspace_incompleta");
  assert.deepStrictEqual(retorno.resultados, []);
  assert.strictEqual(envios, 0, "shortlink cru sem ownership nao pode chegar ao sender");
}

{
  const oferta = await importarShopeeManualV2("https://shopee.com.br/product/111/333", criarDeps({
    marketplace: "shopee",
    linkOriginal: "https://shopee.com.br/product/111/333",
    productLink: "https://shopee.com.br/product/111/333",
    offerLink: "https://s.shopee.com.br/oferta333",
    titulo: "Produto Shopee com variacao",
    precoAtual: "100,00",
    precoMin: "100,00",
    precoMax: "150,00",
    precoOrigem: "api_productOfferV2.priceMin_priceMax",
    variacaoComprovada: true,
    imagem: "https://cf.shopee.com.br/variacao.jpg",
    itemId: "333",
    shopId: "111"
  }));

  assert.strictEqual(oferta.precoAtual, "", "faixa real sem preco unico nao pode usar precoMin como precoAtual");
  assert.strictEqual(oferta.precoMin, "100,00");
  assert.strictEqual(oferta.precoMax, "150,00");
  assert.strictEqual(oferta.temVariacaoPreco, true);
  assert.strictEqual(oferta.precoAnterior, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("faixa_preco_preservada_sem_preco_unico"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoMin"));
  assert.ok(oferta.fonteImportacao.camposConfiaveis.includes("precoMax"));
}

{
  const oferta = await importarShopeeManualV2("https://shopee.com.br/product/111/444", criarDeps({
    marketplace: "shopee",
    linkOriginal: "https://shopee.com.br/product/111/444",
    titulo: "Produto sem preco anterior",
    precoAtual: "89,90",
    precoAntigo: "149,90",
    imagem: "",
    itemId: "444",
    shopId: "111"
  }));

  assert.strictEqual(oferta.precoAtual, "89,90");
  assert.strictEqual(oferta.precoAnterior, "", "preco antigo sem origem comprovada nao entra no Manual V2");
  assert.ok(oferta.fonteImportacao.avisos.includes("preco_anterior_ignorado_sem_origem_comprovada"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAnterior"));
}

{
  const oferta = await importarShopeeManualV2("https://shopee.com.br/m/cupom-de-desconto", criarDeps({
    ok: false,
    marketplace: "shopee",
    motivo: "resgate_shopee_sem_conversao_landing",
    linkOriginal: "https://shopee.com.br/m/cupom-de-desconto",
    linkExpandido: "https://shopee.com.br/m/cupom-de-desconto",
    titulo: "Cupom Shopee",
    precoAtual: "9,90",
    imagem: "https://cf.shopee.com.br/cupom.jpg"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.precoMin, "");
  assert.strictEqual(oferta.precoMax, "");
  assert.strictEqual(oferta.urlAfiliada, "");
  assert.strictEqual(oferta.imagem, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("link_shopee_sem_item_id_nao_importado"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
}

{
  const oferta = await importarShopeeManualV2("https://shopee.com.br/product/111/555", criarDeps({
    marketplace: "shopee",
    linkOriginal: "https://shopee.com.br/product/111/555",
    titulo: "",
    precoAtual: "",
    precoMin: "",
    precoMax: "",
    imagem: "",
    categoria: "Shopee",
    cupomOrigem: "texto_extraido",
    cupom: "TEXTO10",
    itemId: "555",
    shopId: "111"
  }));

  assert.strictEqual(oferta.titulo, "");
  assert.strictEqual(oferta.precoAtual, "");
  assert.strictEqual(oferta.precoAnterior, "");
  assert.strictEqual(oferta.imagem, "");
  assert.strictEqual(oferta.categoria, "");
  assert.strictEqual(oferta.cupom, "");
  assert.ok(oferta.fonteImportacao.avisos.includes("shopee_retorno_parcial_campos_editaveis"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("titulo"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("precoAtual"));
  assert.ok(oferta.fonteImportacao.camposAusentes.includes("imagem"));
}

{
  const arquivoManual = getClienteJsonPath("cliente_shopee", "manual_ofertas_v2.json");
  const arquivoFila = getClienteJsonPath("cliente_shopee", "fila.json");
  assert.strictEqual(fs.existsSync(arquivoManual), false, "adapter parse-only nao salva oferta manual");
  assert.strictEqual(fs.existsSync(arquivoFila), false, "adapter parse-only nao escreve fila");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "adapters", "shopee.manual.adapter.js"),
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
    assert.ok(!fonte.includes(termo), `Adapter Shopee Manual V2 nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-import-shopee.test.js ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
