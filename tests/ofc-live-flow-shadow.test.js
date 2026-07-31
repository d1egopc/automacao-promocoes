const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  calcularFluxoVivoShadow,
  criarFluxoVivoShadowOfc
} = require("../modules/engine/ofc");

const agoraMs = new Date("2026-07-31T23:00:00.000Z").getTime();
const iso = ms => new Date(agoraMs - ms).toISOString();

const dados = {
  ok: true,
  janelaMinutos: 10,
  limiteAmostra: 10,
  vivos: {
    total: 4,
    mais_antigo_em: iso(20 * 60 * 60 * 1000),
    mais_novo_em: iso(2 * 60 * 1000),
    idade_media_ms: 300000
  },
  circulaveis: {
    total: 3,
    mais_antigo_em: iso(20 * 60 * 60 * 1000),
    mais_novo_em: iso(2 * 60 * 1000),
    idade_media_ms: 400000
  },
  chegada: { total: 20 },
  consumo: { total: 50 },
  expiracao: { total: 6 },
  primeiraTentativa: { total: 5, media_ms: 45000 },
  radarOferta: { total: 4, media_ms: 120000 },
  amostraCirculavel: [
    {
      id: 1,
      status: "pendente",
      cliente_id: "user_a",
      marketplace: "mercadolivre",
      criado_em: iso(5 * 60 * 1000),
      metadata: { radarMirror: { origem: "radar" } }
    },
    {
      id: 2,
      status: "pendente",
      cliente_id: "user_b",
      marketplace: "amazon",
      criado_em: iso(20 * 60 * 60 * 1000),
      metadata: {}
    },
    {
      id: 3,
      status: "pronto_para_importar",
      cliente_id: "user_c",
      marketplace: "shopee",
      criado_em: iso(20 * 60 * 1000),
      metadata: { contratoComercial: { cupom: "CASA10" } }
    }
  ]
};

const metricas = {
  consumoReal: { janelaMinutos: 10, eventosPorMinuto: 5 },
  pressao: {
    backlogOperacional: 3,
    pendentes: 2,
    prontosParaImportar: 1,
    emCurso: 1
  }
};

const plano = {
  reserva: {
    janelaAlvoMinutos: 5,
    pisoOperacional: 2
  }
};

const fluxo = calcularFluxoVivoShadow({
  dados,
  metricas,
  plano,
  filaAtiva: { tamanhoAlvo: 3, totalSelecionado: 2 },
  agoraMs,
  opcoes: { tetoActiveQueue: 500, coberturaReservaMinutos: 15 }
});

assert.strictEqual(fluxo.modo, "shadow");
assert.strictEqual(fluxo.aplicouMudancas, false);
assert.strictEqual(fluxo.entradaPorMinuto, 2);
assert.strictEqual(fluxo.consumoPorMinuto, 5);
assert.strictEqual(fluxo.expiracaoPorHora, 36);
assert.strictEqual(fluxo.activeQueueSugerida, 3);
assert.strictEqual(fluxo.reservaSugerida, 3);
assert.strictEqual(fluxo.tempoMedioRadarOfertaMs, 120000);
assert.strictEqual(fluxo.tempoMedioAtePrimeiraTentativaMs, 45000);
assert.strictEqual(fluxo.percentualAguaNova, 33.33);
assert.strictEqual(fluxo.aguaNova.totalAmostra, 1);
assert.strictEqual(fluxo.ttl.jobsAcimaTtlAmostra, 1);
assert.strictEqual(fluxo.pressaoOperacional.entradaMaiorQueConsumo, false);
assert.strictEqual(fluxo.filaAtivaShadowAtual.aplicouMudancas, false);

(async () => {
  const ok = await criarFluxoVivoShadowOfc({ metricas, plano, filaAtiva: {} }, {
    agoraMs,
    consultarFluxoVivo: async () => dados
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.aplicouMudancas, false);
  assert.ok(ok.duracaoMs >= 0);

  const erro = await criarFluxoVivoShadowOfc({}, {
    consultarFluxoVivo: async () => ({ ok: false, motivo: "falha_teste", erro: "db indisponivel" })
  });
  assert.strictEqual(erro.ok, false);
  assert.strictEqual(erro.failSafe, true);
  assert.strictEqual(erro.aplicouMudancas, false);

  const repo = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "live-flow.repository.js"), "utf8");
  assert(!/\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bALTER\b|\bCREATE\b/i.test(repo), "V2.1 Shadow deve ser somente leitura");

  const controller = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "ofc", "controller.runner.js"), "utf8");
  assert(controller.includes("[OFC-FLUXO-VIVO-SHADOW]"), "runner deve registrar o log shadow do fluxo vivo");
  assert(controller.includes("[OFC-FLUXO-VIVO-ERRO]"), "runner deve registrar erro fail-safe do fluxo vivo");

  console.log("ofc-live-flow-shadow.test.js OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
