const assert = require("assert");
const { criarAgregadorFontes, FONTES_PADRAO } = require("../modules/extension/oportunidades-fontes");
const ml = require("../modules/extension/oportunidades-fontes/mercadolivre");
const shopee = require("../modules/extension/oportunidades-fontes/shopee");
const amazon = require("../modules/extension/oportunidades-fontes/amazon");
const kabum = require("../modules/extension/oportunidades-fontes/kabum");
const aliexpress = require("../modules/extension/oportunidades-fontes/aliexpress");
const magalu = require("../modules/extension/oportunidades-fontes/magalu");
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
  const sinalMagalu = await magalu.detectarOportunidade({ agora, buscarPagina: buscarCom("Ofertas do dia · 47 produtos encontrados") });
  assert.strictEqual(sinalMagalu.marketplace, "magalu");
  assert.strictEqual(sinalMagalu.titulo, "Magalu");
  assert.strictEqual(sinalMagalu.urlDestino, "https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/");
  assert.strictEqual(sinalMagalu.validoAte, "2026-09-10T12:05:00.000Z");
  assert.strictEqual(await magalu.detectarOportunidade({ agora, buscarPagina: buscarCom("Página sem ofertas disponíveis") }), null);
  assert.ok(FONTES_PADRAO.includes(magalu), "Magalu deve participar do agregador padrão");
  let tasksMagalu = 0;
  const fonteBloqueada = await magalu.detectarOportunidade({
    agora,
    buscarPagina: async () => { const erro = new Error("http_403"); erro.status = 403; throw erro; },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: null }),
    garantirOportunidadeMagalu: async () => { tasksMagalu += 1; return { ok: true, criada: true }; }
  });
  assert.strictEqual(fonteBloqueada.cachear, false, "403 deve ser fonte indisponível, não ausência confirmada");
  assert.strictEqual(tasksMagalu, 1);
  assert.strictEqual((await magalu.detectarOportunidade({
    agora,
    buscarPagina: async () => { throw new Error("http_403"); },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: { accessible: true, indicatorFound: true, checkedAt: agora.toISOString() } })
  })).marketplace, "magalu", "resultado residencial fresco deve alimentar a mesma fonte");
  const ausenciaWorker = await magalu.detectarOportunidade({
    agora,
    buscarPagina: async () => { throw new Error("http_403"); },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: { accessible: true, indicatorFound: false, checkedAt: agora.toISOString() } })
  });
  assert.strictEqual(ausenciaWorker.ativo, false, "worker sem indicador confirma ausência");
  assert.strictEqual(ausenciaWorker.cachear, true);
  assert.strictEqual((await magalu.detectarOportunidade({
    agora,
    buscarPagina: buscarCom("az-request-verify robot"),
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: null })
  })).cachear, false, "challenge não pode virar cache vazio confirmado");

  assert.strictEqual(hostPermitido("https://www.mercadolivre.com.br/ofertas", [/mercadolivre\.com\.br$/]), true);
  assert.strictEqual(hostPermitido("https://evil.example/ofertas", [/mercadolivre\.com\.br$/]), false);
  assert.strictEqual(hostPermitido("https://www.magazineluiza.com.br/selecao/ofertasdodiamundo/", [/^(?:[a-z0-9-]+\.)?magazineluiza\.com\.br$/i]), true);

  let resultadoWorkerMagalu = null;
  let criacoesMagalu = 0;
  const agregadorMagalu = criarAgregadorFontes({ fontes: [magalu], agora: () => agora });
  const depsMagalu = {
    buscarPagina: async () => { throw new Error("http_403"); },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: resultadoWorkerMagalu }),
    garantirOportunidadeMagalu: async () => { criacoesMagalu += 1; return { ok: true, criada: criacoesMagalu === 1 }; }
  };
  assert.deepStrictEqual(await agregadorMagalu.listarSinais("workspace_a", depsMagalu), []);
  resultadoWorkerMagalu = { accessible: true, indicatorFound: true, checkedAt: agora.toISOString() };
  assert.deepStrictEqual((await agregadorMagalu.listarSinais("workspace_a", depsMagalu)).map(item => item.marketplace), ["magalu"], "resultado worker não pode ficar atrás do cache vazio antigo");
  assert.strictEqual(criacoesMagalu, 1, "resultado recente evita nova task");

  let modoMagalu = "ausente";
  let chamadasMagaluCache = 0;
  const chamadasOutrasFontes = new Map();
  const fonteMagaluCache = {
    marketplace: "magalu",
    ttlMs: 300_000,
    async detectarOportunidade() {
      chamadasMagaluCache += 1;
      if (modoMagalu === "presente") return { marketplace: "magalu", ativo: true, quantidade: 1, validoAte: new Date(agora.getTime() + 300_000).toISOString() };
      return null;
    }
  };
  const outrasFontesCache = ["amazon", "kabum_awin", "mercadolivre", "shopee", "aliexpress"].map(marketplace => ({
    marketplace,
    ttlMs: 300_000,
    async detectarOportunidade() {
      chamadasOutrasFontes.set(marketplace, Number(chamadasOutrasFontes.get(marketplace) || 0) + 1);
      return { marketplace, ativo: true, quantidade: 1, validoAte: new Date(agora.getTime() + 300_000).toISOString() };
    }
  }));
  const marketplacesSemMagalu = outrasFontesCache.map(item => item.marketplace).sort();
  const agregadorInvalidacao = criarAgregadorFontes({ fontes: [fonteMagaluCache, ...outrasFontesCache], agora: () => agora });
  assert.deepStrictEqual((await agregadorInvalidacao.listarSinais("workspace_a")).map(item => item.marketplace).sort(), marketplacesSemMagalu);
  modoMagalu = "presente";
  agregadorInvalidacao.invalidarFonte("magalu");
  assert.deepStrictEqual((await agregadorInvalidacao.listarSinais("workspace_a")).map(item => item.marketplace).sort(), [...marketplacesSemMagalu, "magalu"].sort());
  assert.strictEqual(chamadasMagaluCache, 2, "invalidação remove o [] Magalu antigo");
  assert.deepStrictEqual(Object.fromEntries(chamadasOutrasFontes), Object.fromEntries(marketplacesSemMagalu.map(marketplace => [marketplace, 1])), "invalidação Magalu preserva Amazon/KaBuM/ML/Shopee/Ali");
  modoMagalu = "ausente";
  agregadorInvalidacao.invalidarFonte("magalu");
  assert.deepStrictEqual((await agregadorInvalidacao.listarSinais("workspace_a")).map(item => item.marketplace).sort(), marketplacesSemMagalu, "resultado false continua sem Magalu");
  assert.deepStrictEqual(Object.fromEntries(chamadasOutrasFontes), Object.fromEntries(marketplacesSemMagalu.map(marketplace => [marketplace, 1])), "nova invalidação Magalu não limpa outras fontes");

  const checkedAtWorker = new Date("2026-09-10T12:00:00.000Z");
  const sinalCincoMinutos = await magalu.detectarOportunidade({
    agora: new Date("2026-09-10T12:05:00.000Z"),
    buscarPagina: async () => { throw new Error("http_403"); },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: { accessible: true, indicatorFound: true, checkedAt: checkedAtWorker.toISOString() } })
  });
  assert.strictEqual(sinalCincoMinutos.cacheExpiraEm, "2026-09-10T12:10:00.000Z");
  assert.strictEqual(sinalCincoMinutos.validoAte, "2026-09-10T12:10:00.000Z");
  const sinalNoveMinutosMeio = await magalu.detectarOportunidade({
    agora: new Date("2026-09-10T12:09:30.000Z"),
    buscarPagina: async () => { throw new Error("http_403"); },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: { accessible: true, indicatorFound: true, checkedAt: checkedAtWorker.toISOString() } })
  });
  assert.strictEqual(sinalNoveMinutosMeio.cacheExpiraEm, "2026-09-10T12:10:00.000Z");
  let renovacoesStale = 0;
  const sinalStale = await magalu.detectarOportunidade({
    agora: new Date("2026-09-10T12:10:00.000Z"),
    buscarPagina: async () => { throw new Error("http_403"); },
    obterOportunidadeMagaluRecente: async () => ({ ok: true, resultado: { accessible: true, indicatorFound: true, checkedAt: checkedAtWorker.toISOString() } }),
    garantirOportunidadeMagalu: async () => { renovacoesStale += 1; return { ok: true }; }
  });
  assert.strictEqual(sinalStale.cachear, false, "resultado com dez minutos não produz sinal nem cache renovado");
  assert.strictEqual(renovacoesStale, 1);

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
