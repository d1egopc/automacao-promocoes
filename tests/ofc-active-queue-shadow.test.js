const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  selecionarFilaAtivaShadow,
  criarFilaAtivaShadowOfc
} = require("../modules/engine/ofc");

function job(id, status, marketplace, clienteId, criadoEm) {
  return {
    id,
    status,
    marketplace,
    cliente_id: clienteId,
    criado_em: criadoEm
  };
}

const base = "2026-07-30T12:00:00.000Z";
const depois = "2026-07-30T12:01:00.000Z";

const ordemStatus = selecionarFilaAtivaShadow([
  job(1, "pendente", "shopee", "user_a", base),
  job(2, "pronto_para_importar", "amazon", "user_b", depois),
  job(3, "pronto_para_importar", "mercadolivre", "user_c", base)
], {
  tamanhoAlvo: 2,
  limiteMarketplacePercentual: 1,
  limiteClientePercentual: 1
});

assert.deepStrictEqual(ordemStatus.idsAmostra, [3, 2]);
assert.strictEqual(ordemStatus.selecionadosPorStatus.pronto_para_importar, 2);
assert.strictEqual(ordemStatus.aplicouMudancas, false);

const limiteMarketplace = selecionarFilaAtivaShadow([
  job(1, "pendente", "shopee", "user_a", "2026-07-30T12:00:00.000Z"),
  job(2, "pendente", "shopee", "user_b", "2026-07-30T12:00:01.000Z"),
  job(3, "pendente", "shopee", "user_c", "2026-07-30T12:00:02.000Z"),
  job(4, "pendente", "mercadolivre", "user_d", "2026-07-30T12:00:03.000Z"),
  job(5, "pendente", "mercadolivre", "user_e", "2026-07-30T12:00:04.000Z"),
  job(6, "pendente", "mercadolivre", "user_f", "2026-07-30T12:00:05.000Z")
], {
  tamanhoAlvo: 5,
  limiteMarketplacePercentual: 0.4,
  limiteClientePercentual: 1
});

assert.strictEqual(limiteMarketplace.selecionadosPorMarketplace.shopee, 2);
assert.strictEqual(limiteMarketplace.selecionadosPorMarketplace.mercadolivre, 2);
assert.strictEqual(limiteMarketplace.totalSelecionado, 4);
assert.strictEqual(limiteMarketplace.motivoSelecaoIncompleta, "limites_operacionais_shadow");

const limiteCliente = selecionarFilaAtivaShadow([
  job(1, "pendente", "amazon", "user_a", "2026-07-30T12:00:00.000Z"),
  job(2, "pendente", "shopee", "user_a", "2026-07-30T12:00:01.000Z"),
  job(3, "pendente", "kabum", "user_a", "2026-07-30T12:00:02.000Z"),
  job(4, "pendente", "amazon", "user_b", "2026-07-30T12:00:03.000Z"),
  job(5, "pendente", "shopee", "user_c", "2026-07-30T12:00:04.000Z")
], {
  tamanhoAlvo: 4,
  limiteMarketplacePercentual: 1,
  limiteClientePercentual: 0.5
});

assert.strictEqual(limiteCliente.selecionadosPorCliente.user_a, 2);
assert.strictEqual(limiteCliente.totalSelecionado, 4);

const poucosJobs = selecionarFilaAtivaShadow([
  job(1, "pendente", "amazon", "user_a", base)
], {
  tamanhoAlvo: 3,
  limiteMarketplacePercentual: 1,
  limiteClientePercentual: 1
});

assert.strictEqual(poucosJobs.totalSelecionado, 1);
assert.strictEqual(poucosJobs.motivoSelecaoIncompleta, "candidatos_insuficientes");

const deterministicaA = selecionarFilaAtivaShadow([
  job(3, "pendente", "amazon", "user_a", base),
  job(1, "pendente", "amazon", "user_b", base),
  job(2, "pendente", "amazon", "user_c", base)
], {
  tamanhoAlvo: 3,
  limiteMarketplacePercentual: 1,
  limiteClientePercentual: 1
});
const deterministicaB = selecionarFilaAtivaShadow([
  job(2, "pendente", "amazon", "user_c", base),
  job(3, "pendente", "amazon", "user_a", base),
  job(1, "pendente", "amazon", "user_b", base)
], {
  tamanhoAlvo: 3,
  limiteMarketplacePercentual: 1,
  limiteClientePercentual: 1
});

assert.deepStrictEqual(deterministicaA.idsAmostra, [1, 2, 3]);
assert.deepStrictEqual(deterministicaA.idsAmostra, deterministicaB.idsAmostra);

(async () => {
  const filaAtiva = await criarFilaAtivaShadowOfc({
    plano: { reserva: { reservaDesejada: 2 } }
  }, {
    consultarCandidatos: async () => ({
      ok: true,
      jobs: [
        job(10, "pronto_para_importar", "shopee", "user_a", base),
        job(11, "pendente", "amazon", "user_b", depois)
      ],
      totalAvaliado: 2
    })
  });

  assert.strictEqual(filaAtiva.ok, true);
  assert.strictEqual(filaAtiva.aplicouMudancas, false);
  assert.deepStrictEqual(filaAtiva.idsAmostra, [10, 11]);

  const falha = await criarFilaAtivaShadowOfc({
    plano: { reserva: { reservaDesejada: 2 } }
  }, {
    consultarCandidatos: async () => {
      throw new Error("falha_controlada");
    }
  });

  assert.strictEqual(falha.ok, false);
  assert.strictEqual(falha.aplicouMudancas, false);
  assert.strictEqual(falha.failSafe, true);
  assert.match(falha.erro, /falha_controlada/);

  const repository = fs.readFileSync(
    path.join(__dirname, "..", "modules", "engine", "ofc", "active-queue.repository.js"),
    "utf8"
  );

  assert(repository.includes("WHERE status = ANY($1::text[])"));
  assert(repository.includes("ORDER BY CASE status"));
  assert(!/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i.test(repository), "Fila Ativa Shadow nao pode escrever no banco");

  console.log("ofc-active-queue-shadow.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
