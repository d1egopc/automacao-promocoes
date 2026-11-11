"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { extrairComercialUniversal } = require("../modules/radar/extrator-comercial-universal");
const { criarRadarMirror } = require("../modules/radar/radar-mirror");
const { validarFidelidadeComercialRadar } = require("../modules/radar/comercial-precedencia");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { criarPreflightFilaUniversal } = require("../modules/engine/universal-queue-preflight");
const { criarExecutorFilaUniversal } = require("../modules/engine/universal-queue-executor.adapter");

const gancho = "Uma boa escolha para o dia a dia";
const instrucao = "Use o cupom TESTE10 ou TESTE20 no carrinho";
const cases = [
  { marketplace: "amazon", titulo: "Monitor IPS Modelo A27 de 27 polegadas",
    tituloRadar: "Abra este link no APP", id: "B000000001", fonte: "amazon_importer",
    url: "https://www.amazon.com.br/dp/B000000001" },
  { marketplace: "mercadolivre", titulo: "Teclado mecânico Modelo K72 ABNT2",
    url: "https://produto.mercadolivre.com.br/MLB-100000001-teclado-_JM" },
  { marketplace: "shopee", titulo: "Suporte articulado Modelo X27 para monitor",
    tituloProva: "Suporte articulado Modelo X27", id: "123/456", fonte: "api.productOfferV2",
    url: "https://shopee.com.br/product/123/456" },
  { marketplace: "aliexpress", titulo: "Carregador USB C Modelo Z65 de 65 W",
    url: "https://pt.aliexpress.com/item/100000000001.html" }
];

function offer(fixture, { instruction = "", alias = "instrucaoCupom", separateCodes = false } = {}) {
  const { marketplace, titulo, tituloRadar = titulo, tituloProva = titulo, id, fonte, url } = fixture;
  const textoOriginal = [tituloRadar, "De R$ 149,90 por R$ 99,90",
    separateCodes ? "Cupom: TESTE10\nCupom: TESTE20" : "Cupom: TESTE10 ou TESTE20",
    instruction, url].filter(Boolean).join("\n");
  const comercial = extrairComercialUniversal({ textoOriginal, marketplaceDetectado: marketplace });
  const radarMirror = criarRadarMirror({ textoOriginal, marketplace, clienteId: "fixture_radar",
    extracaoRadarLocal: { comercial, cupom: comercial.cupom, precoAtual: comercial.precoAtual,
      precoAnterior: comercial.precoAntigo, titulo: { valor: tituloRadar } } });
  const metadata = { radarMirror };
  if (id) metadata.provaTituloTecnicoValidada = {
    validacao: "confirmada_pelo_importador",
    titulo: { valor: tituloProva, fonte },
    produto: { produtoIdCanonico: id, urlCanonica: url }
  };
  return { marketplace, titulo, tituloIa: gancho, clienteId: "fixture_radar",
    origemFluxo: "radar", fonteComercial: "radar_mirror", categoria: "Eletrônicos",
    preco: 99.9, precoAtual: 99.9, precoOriginal: 149.9,
    cupom: "TESTE10 ou TESTE20", cupons: ["TESTE10", "TESTE20"], metadata,
    linkOriginal: url, linkExpandido: url, linkAfiliado: "https://example.invalid/afiliado",
    imagem: "https://example.invalid/imagem.jpg",
    ...(instruction ? { [alias]: instruction } : {}) };
}

function render(oferta, tituloOferta) {
  return montarMensagemOferta(oferta, { clienteId: oferta.clienteId,
    destino: { id: "fixture_destino", tipo: "whatsapp", tituloOferta },
    plano: { recursos: { tituloIa: true, templatePersonalizado: false } }, rioOficialAtivo: true });
}

for (const fixture of cases) {
  test(`${fixture.marketplace}: factual title and commercial fields survive both presentation modes`, () => {
    const oferta = offer(fixture);
    const before = structuredClone(oferta);
    assert.deepEqual(validarFidelidadeComercialRadar(oferta), { aplicavel: true, ok: true, motivos: [] });
    for (const modo of ["original", "ia"]) {
      const result = render(oferta, modo);
      assert.ok(result.includes(fixture.titulo));
      assert.equal(result.includes(gancho), modo === "ia");
      assert.match(result, /149,90/);
      assert.match(result, /99,90/);
      assert.match(result, /TESTE10/);
      assert.match(result, /TESTE20/);
      assert.ok(result.includes(oferta.linkAfiliado));
      assert.deepEqual(oferta, before);
    }
  });
}

test("Radar instructions survive separately from the formatted coupon code, including legacy aliases", () => {
  for (const alias of ["instrucaoCupom", "avisoCupom", "cupomTexto"]) {
    const oferta = offer(cases[0], { instruction: instrucao, alias });
    for (const modo of ["original", "ia"]) {
      const result = render(oferta, modo);
      assert.ok(result.includes(instrucao));
      assert.match(result, /TESTE10/);
      assert.match(result, /TESTE20/);
    }
  }
});

test("formatting separately captured coupon codes does not create a Radar instruction", () => {
  for (const fixture of cases.slice(0, 2)) {
    const oferta = offer(fixture, { separateCodes: true });
    assert.equal(validarFidelidadeComercialRadar(oferta).ok, true);
    assert.equal(oferta.instrucaoCupom, undefined);
    assert.equal(oferta.cupomTexto, undefined);
    for (const modo of ["original", "ia"]) {
      assert.match(render(oferta, modo), /TESTE10 ou TESTE20/);
    }
  }
});

test("unproven legacy AI claims cannot become a Radar presentation hook", () => {
  const oferta = offer(cases[0]);
  const tituloIa = "Use o cupom INVENTADO99 para ganhar cashback";
  const result = render({ ...oferta, tituloIa }, "ia");
  assert.ok(result.includes(oferta.titulo));
  assert.doesNotMatch(result, /INVENTADO99|cashback/i);
});

test("valid Radar offer reaches the Executor transport boundary with the factual image and link", async () => {
  const oferta = { ...offer(cases[0], { separateCodes: true }), engineOfertaId: "42" };
  const pool = { connect() {} };
  const claim = { ok: true, id: 1, workspace_id: oferta.clienteId, destination_id: "fixture_destino",
    oferta_id: 42, evento_id: 41, origem_fluxo: "optimus",
    capturado_em: "2026-11-11T12:00:00Z", operationEpochStartedAt: "2026-11-11T11:00:00Z",
    leaseToken: "fixture-lease", item_payload: oferta };
  const pass = () => ({ ok: true });
  const prepare = criarPreflightFilaUniversal({ pool,
    now: () => Date.parse("2026-11-11T12:02:00Z"), readClock: async () => null,
    resolveDestination: ({ destinationId }) => ({ ok: true,
      destination: { id: destinationId, tipo: "whatsapp", intervaloMinutos: 2.5 } }),
    checkWindow: pass, checkDailyLimit: pass, checkSession: pass, checkCredits: pass,
    checkMedia: ({ oferta: ready }) => ({ ok: ready.imagem === oferta.imagem }),
    checkLinks: ({ oferta: ready }) => ({ ok: ready.linkAfiliado === oferta.linkAfiliado }),
    checkDedup: pass,
    renderMessage: ({ oferta: ready }) => ({ ok: true, message: render(ready, "ia") })
  });
  const calls = [];
  const run = criarExecutorFilaUniversal({ pool, prepare,
    repository: {
      preflightWorkspace: pass, claimDestination: async () => claim,
      markSendStarted: async () => { calls.push("started"); return { ok: true }; },
      confirmSend: async ({ confirmationKey }) => {
        calls.push(confirmationKey);
        return { ok: true };
      }
    },
    dispatch: async (_target, prepared, { startAttempt }) => {
      assert.ok(prepared.rendered.message.includes(oferta.titulo));
      assert.ok(prepared.rendered.message.includes(gancho));
      assert.deepEqual(prepared.oferta.metadata, oferta.metadata);
      await startAttempt();
      return { confirmed: true, confirmationKey: "fixture-ack", providerMessageId: "fixture-provider" };
    }
  });
  assert.deepEqual(await run(oferta.clienteId), { ok: true });
  assert.deepEqual(calls, ["started", "fixture-ack"]);
});

test("Radar rejects invalid titles, identity, price, codes and instructions in both modes", () => {
  const amazon = offer(cases[0]);
  const ml = offer(cases[1]);
  const { provaTituloTecnicoValidada, ...semProva } = amazon.metadata;
  const bad = [
    [{ ...amazon, titulo: "Abra este link no APP" }, "radar_titulo_operacional_ou_ausente"],
    [{ ...amazon, metadata: semProva }, "radar_identidade_titulo_nao_confirmada"],
    [{ ...ml, titulo: "Monitor Modelo Z99 de 32 polegadas" }, "radar_titulo_divergente_sem_identidade"],
    [{ ...amazon, precoAtual: 79.9 }, "radar_preco_divergente"],
    [{ ...ml, codigoCupom: "INVENTADO10" }, "radar_cupom_divergente"],
    [{ ...ml, cupomTexto: "Aplique apenas no Pix" }, "radar_instrucao_cupom_divergente"],
    [{ ...amazon, linkExpandido: "https://www.amazon.com.br/checkout" }, "radar_identidade_destino_nao_produto"]
  ];
  for (const modo of ["original", "ia"]) {
    for (const [oferta, message] of bad) {
      assert.throws(() => render(oferta, modo), { code: "RADAR_FIDELIDADE_COMERCIAL_INVALIDA", message });
    }
  }
});
