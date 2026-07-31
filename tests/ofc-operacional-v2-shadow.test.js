const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  avaliarOportunidadeOperacional,
  criarPlanoOperacionalV2Shadow,
  criarFilaAtivaShadowOfc,
  calcularSaudeOperacional
} = require("../modules/engine/ofc");

const agora = new Date("2026-07-31T12:00:00.000Z").getTime();

function minutosAtras(minutos) {
  return new Date(agora - minutos * 60 * 1000).toISOString();
}

function horasAtras(horas) {
  return new Date(agora - horas * 60 * 60 * 1000).toISOString();
}

function job(id, status, marketplace, clienteId, criadoEm, metadata = {}) {
  return {
    id,
    status,
    marketplace,
    cliente_id: clienteId,
    criado_em: criadoEm,
    metadata
  };
}

const radarNovo = job(1, "pendente", "shopee", "user_a", minutosAtras(10), {
  metadataEvento: {
    origem: "radar",
    origemTipo: "whatsapp"
  }
});

const cupomExpirado = job(2, "pendente", "mercadolivre", "user_b", horasAtras(5), {
  metadataEvento: {
    contratoComercial: {
      cupons: ["MODALIVRE"]
    }
  }
});

const comumReserva = job(3, "pendente", "amazon", "user_c", horasAtras(2), {});

const analiseRadar = avaliarOportunidadeOperacional(radarNovo, {
  agoraMs: agora,
  selecionada: true
});

assert.strictEqual(analiseRadar.estado, "ATIVA");
assert.strictEqual(analiseRadar.temperatura, "HOT");
assert.strictEqual(analiseRadar.aguaNova, true);
assert.strictEqual(analiseRadar.tipoOperacional, "radar");
assert.strictEqual(analiseRadar.candidataExpiracao, false);

const analiseCupom = avaliarOportunidadeOperacional(cupomExpirado, {
  agoraMs: agora,
  selecionada: false
});

assert.strictEqual(analiseCupom.estado, "EXPIRADA");
assert.strictEqual(analiseCupom.temperatura, "COLD");
assert.strictEqual(analiseCupom.tipoOperacional, "cupom");
assert.strictEqual(analiseCupom.candidataExpiracao, true);
assert.strictEqual(analiseCupom.motivoExpiracao, "ttl_operacional_excedido_shadow");

const plano = criarPlanoOperacionalV2Shadow({
  jobs: [radarNovo, cupomExpirado, comumReserva],
  filaAtiva: {
    tamanhoAlvo: 1,
    totalSelecionado: 1,
    quantidadeDisponivelAvaliada: 3,
    idsSelecionados: [1]
  },
  metricas: {
    pressao: {
      backlogOperacional: 3,
      pendentes: 3,
      prontosParaImportar: 0
    },
    consumoReal: {
      eventosPorMinuto: 1
    }
  },
  agoraMs: agora
});

assert.strictEqual(plano.modo, "shadow");
assert.strictEqual(plano.aplicouMudancas, false);
assert.strictEqual(plano.totalAvaliado, 3);
assert.strictEqual(plano.estados.ATIVA, 1);
assert.strictEqual(plano.estados.RESERVA, 1);
assert.strictEqual(plano.estados.EXPIRADA, 1);
assert.strictEqual(plano.temperaturas.HOT, 1);
assert.strictEqual(plano.temperaturas.COLD, 1);
assert.strictEqual(plano.aguaNova.total, 1);
assert.strictEqual(plano.aguaNova.selecionadas, 1);
assert.deepStrictEqual(plano.activeQueueDefinitiva.idsAmostra, [1]);
assert.deepStrictEqual(plano.reservaOperacional.idsAmostra, [3]);
assert.deepStrictEqual(plano.expiracaoOperacional.idsAmostra, [2]);
assert.strictEqual(plano.saudeOperacional.nivel, "pressionada");

const saudeCritica = calcularSaudeOperacional({
  backlogOperacional: 100,
  consumoPorMinuto: 0,
  expiradasOperacionaisShadow: 0,
  activeQueuePreenchimentoPercentual: 100
});

assert.strictEqual(saudeCritica.nivel, "critica");
assert(saudeCritica.motivos.includes("backlog_sem_consumo"));

(async () => {
  const fila = await criarFilaAtivaShadowOfc({
    plano: { reserva: { reservaDesejada: 2 } }
  }, {
    agoraMs: agora,
    limiteMarketplacePercentual: 1,
    limiteClientePercentual: 1,
    consultarCandidatos: async () => ({
      ok: true,
      jobs: [
        radarNovo,
        cupomExpirado,
        comumReserva
      ],
      totalAvaliado: 3
    })
  });

  assert.strictEqual(fila.ok, true);
  assert.strictEqual(fila.aplicouMudancas, false);
  assert.strictEqual(fila.operacionalV2.ok, true);
  assert.strictEqual(fila.totalSelecionado, 2);
  assert.strictEqual(fila.operacionalV2.activeQueueDefinitiva.total, 1);
  assert.strictEqual(fila.operacionalV2.expiracaoOperacional.candidatas, 1);
  assert.strictEqual(fila.idsSelecionados, undefined, "retorno publico nao deve carregar lista completa de IDs");

  const arquivosOfc = [
    "active-queue.repository.js",
    "active-queue.service.js",
    "policy.service.js",
    "operational-shadow.service.js"
  ];

  for (const arquivo of arquivosOfc) {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "modules", "engine", "ofc", arquivo),
      "utf8"
    );
    assert(!/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i.test(fonte), `${arquivo}: OFC V2.0 Shadow nao pode escrever dados`);
  }

  console.log("ofc-operacional-v2-shadow.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
