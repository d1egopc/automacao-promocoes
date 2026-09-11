const assert = require("assert");
const { criarAgregadorFontes } = require("../modules/extension/oportunidades-fontes");
const ml = require("../modules/extension/oportunidades-fontes/mercadolivre");
const shopee = require("../modules/extension/oportunidades-fontes/shopee");
const amazon = require("../modules/extension/oportunidades-fontes/amazon");
const kabum = require("../modules/extension/oportunidades-fontes/kabum");
const aliexpress = require("../modules/extension/oportunidades-fontes/aliexpress");
const { hostPermitido } = require("../modules/extension/oportunidades-fontes/pagina-oficial");

const agora = new Date("2026-09-10T12:00:00.000Z");
const buscarCom = (html) => async () => html;

(async () => {
  assert.strictEqual((await ml.detectarOportunidade({ agora, buscarPagina: buscarCom("Todas as ofertas · Oferta do dia") })).marketplace, "mercadolivre");
  const sinalShopee = await shopee.detectarOportunidade({
    agora,
    clienteId: "workspace_a",
    buscarOfertasShopee: async (clienteId) => {
      assert.strictEqual(clienteId, "workspace_a");
      return [{ priceMin: "103.90", priceDiscountRate: 15 }];
    }
  });
  assert.strictEqual(sinalShopee.marketplace, "shopee");
  assert.strictEqual(sinalShopee.urlDestino, "https://shopee.com.br/flash_sale");
  assert.strictEqual(sinalShopee.fonte, "shopee_affiliate_product_offer_v2");
  assert.strictEqual(shopee.ttlMs, 300_000);
  assert.strictEqual(shopee.cacheKey({ clienteId: "workspace_a" }), "shopee:workspace_a");
  assert.strictEqual(await shopee.detectarOportunidade({
    agora,
    clienteId: "workspace_a",
    buscarOfertasShopee: async () => [{ priceMin: "103.90", priceDiscountRate: 0 }]
  }), null);
  assert.strictEqual(await shopee.detectarOportunidade({
    agora,
    clienteId: "sem_credencial",
    config: { marketplaces: { shopee: {} } },
    getIntegracaoCliente: () => null
  }), null);
  assert.strictEqual(await shopee.detectarOportunidade({
    agora,
    clienteId: "workspace_a",
    buscarOfertasShopee: async () => { throw new Error("api_indisponivel"); }
  }), null);
  assert.strictEqual((await amazon.detectarOportunidade({ agora, buscarPagina: buscarCom("Ofertas do Dia deal") })).marketplace, "amazon");
  assert.strictEqual((await kabum.detectarOportunidade({ agora, buscarPagina: buscarCom("Promoções Ofertas Produto") })).marketplace, "kabum_awin");
  assert.strictEqual(await aliexpress.detectarOportunidade(), null);

  assert.strictEqual(hostPermitido("https://www.mercadolivre.com.br/ofertas", [/mercadolivre\.com\.br$/]), true);
  assert.strictEqual(hostPermitido("https://evil.example/ofertas", [/mercadolivre\.com\.br$/]), false);

  let agoraMs = agora.getTime();
  let chamadasBoa = 0;
  let chamadasFalha = 0;
  const agregador = criarAgregadorFontes({
    agora: () => new Date(agoraMs),
    fontes: [
      {
        marketplace: "mercadolivre",
        ttlMs: 300_000,
        async detectarOportunidade({ agora: instante }) {
          chamadasBoa += 1;
          return { marketplace: "mercadolivre", ativo: true, quantidade: 1, validoAte: new Date(instante.getTime() + 300_000).toISOString() };
        }
      },
      {
        marketplace: "shopee",
        ttlMs: 300_000,
        async detectarOportunidade() {
          chamadasFalha += 1;
          throw new Error("fonte_indisponivel");
        }
      }
    ]
  });
  assert.deepStrictEqual((await agregador.listarSinais()).map((item) => item.marketplace), ["mercadolivre"]);
  await agregador.listarSinais();
  assert.strictEqual(chamadasBoa, 1, "cache evita nova consulta da fonte ativa");
  assert.strictEqual(chamadasFalha, 1, "cache também protege fonte indisponível");
  agoraMs += 300_001;
  await agregador.listarSinais();
  assert.strictEqual(chamadasBoa, 2, "cache vencido consulta novamente");
  assert.strictEqual(chamadasFalha, 2, "falha isolada não impede nova tentativa após TTL");

  let chamadasWorkspaceA = 0;
  let chamadasWorkspaceB = 0;
  const agregadorShopee = criarAgregadorFontes({ fontes: [shopee], agora: () => agora });
  const buscarPorWorkspace = async (clienteId) => {
    if (clienteId === "workspace_a") chamadasWorkspaceA += 1;
    if (clienteId === "workspace_b") chamadasWorkspaceB += 1;
    return [{ priceMin: "103.90", priceDiscountRate: 15 }];
  };
  assert.strictEqual((await agregadorShopee.listarSinais("workspace_a", { buscarOfertasShopee: buscarPorWorkspace })).length, 1);
  await agregadorShopee.listarSinais("workspace_a", { buscarOfertasShopee: buscarPorWorkspace });
  await agregadorShopee.listarSinais("workspace_b", { buscarOfertasShopee: buscarPorWorkspace });
  assert.strictEqual(chamadasWorkspaceA, 1, "cache Shopee reutiliza a consulta do mesmo workspace");
  assert.strictEqual(chamadasWorkspaceB, 1, "cache Shopee isola workspaces distintos");

  let chamadasConcorrentes = 0;
  let liberarConsulta;
  const aguardarConsulta = new Promise((resolve) => { liberarConsulta = resolve; });
  const agregadorConcorrente = criarAgregadorFontes({ fontes: [shopee], agora: () => agora });
  const buscarLenta = async () => {
    chamadasConcorrentes += 1;
    await aguardarConsulta;
    return [{ priceMin: "103.90", priceDiscountRate: 15 }];
  };
  const primeiraConsulta = agregadorConcorrente.listarSinais("workspace_a", { buscarOfertasShopee: buscarLenta });
  const segundaConsulta = agregadorConcorrente.listarSinais("workspace_a", { buscarOfertasShopee: buscarLenta });
  assert.strictEqual(chamadasConcorrentes, 1, "consultas concorrentes compartilham a Promise do workspace");
  liberarConsulta();
  assert.strictEqual((await primeiraConsulta).length, 1);
  assert.strictEqual((await segundaConsulta).length, 1);

  console.log("extension-oportunidades-fontes.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
