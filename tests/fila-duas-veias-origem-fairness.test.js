"use strict";

const assert = require("assert");
const {
  ETAPA_FILA_FAIRNESS,
  LANE_FILA_FAIRNESS,
  ordenarCandidatePool,
  criarFairnessOrigemFila
} = require("../modules/fila/fila-origem-fairness.service");

function candidato(id, origemFluxo, prioridade = 1) {
  return { oferta: { id, clienteId: "workspace_1", origemFluxo, prioridade } };
}

function criarPool({ ordem = null, falharEm = null } = {}) {
  const consultas = [];
  const client = {
    consultas,
    async query(sql) {
      consultas.push(sql);
      if (ordem) ordem.push(sql);
      if (typeof falharEm === "function" && falharEm(sql)) throw new Error(`falha_pg_${sql}`);
      return { rows: [], rowCount: 1 };
    },
    release(erro) {
      this.released = true;
      this.releaseErro = erro || null;
      this.releaseCount = Number(this.releaseCount || 0) + 1;
      if (ordem) ordem.push("RELEASE");
    }
  };
  return { client, async connect() { return client; } };
}

function criarCatraca({ ocupados = new Set() } = {}) {
  const liberados = [];
  return {
    liberados,
    async adquirir({ oferta, client }) {
      if (ocupados.has(oferta.id)) return { resultado: "ocupado", handle: null };
      return { resultado: "adquirido", handle: { client, clientProprio: false, ofertaId: oferta.id } };
    },
    async finalizar(estado) {
      liberados.push(estado?.handle?.ofertaId || "");
      return { liberacao: "liberado" };
    }
  };
}

function criarServico({ ultima = "", ocupados, revalidar, catraca: catracaFornecida } = {}) {
  const pool = criarPool();
  const atualizacoes = [];
  const catraca = catracaFornecida || criarCatraca({ ocupados });
  const eventos = [];
  const service = criarFairnessOrigemFila({
    pool,
    catracaAdvisory: catraca,
    logger: { log(_tag, corpo) { eventos.push(JSON.parse(corpo)); } },
    bloquearEstado: async (_client, chave) => ({ ...chave, ultimaOrigemAtendida: ultima }),
    registrarAtendimento: async (_client, chave, origem) => {
      atualizacoes.push({ chave, origem });
      return { ...chave, ultimaOrigemAtendida: origem };
    }
  });
  return { service, pool, catraca, atualizacoes, eventos, revalidar: revalidar || (async () => ({ ok: true })) };
}

(async () => {
  const optimus = candidato("optimus_1", "optimus");
  const clone = candidato("clone_1", "clonador_grupos");

  assert.strictEqual(ordenarCandidatePool([optimus], "").motivo, "only_optimus");
  assert.strictEqual(ordenarCandidatePool([clone], "").motivo, "only_clone");
  assert.strictEqual(ordenarCandidatePool([optimus, clone], "optimus").ordem[0], clone, "ultima Optimus deve ceder ao Clone");
  assert.strictEqual(ordenarCandidatePool([optimus, clone], "clonador_grupos").ordem[0], optimus, "ultima Clone deve ceder ao Optimus");
  assert.strictEqual(ordenarCandidatePool([candidato("legacy", ""), optimus], "optimus").motivo, "baseline_legacy");
  let ultimaSequencia = "";
  const sequencia = [];
  for (let indice = 0; indice < 8; indice += 1) {
    const plano = ordenarCandidatePool([optimus, clone], ultimaSequencia);
    const origem = plano.ordem[0].oferta.origemFluxo;
    sequencia.push(origem);
    ultimaSequencia = origem;
  }
  assert.deepStrictEqual(sequencia, ["optimus", "clonador_grupos", "optimus", "clonador_grupos", "optimus", "clonador_grupos", "optimus", "clonador_grupos"], "disputa longa alterna sem starvation mantendo uma unica selecao por ciclo");

  {
    const ctx = criarServico({ ultima: "optimus" });
    const resultado = await ctx.service.selecionar({
      clienteId: "workspace_1",
      candidatePool: [optimus, clone],
      revalidar: ctx.revalidar
    });
    assert.strictEqual(resultado.candidato, clone);
    assert.strictEqual(ctx.atualizacoes.length, 1);
    assert.strictEqual(ctx.atualizacoes[0].origem, "clonador_grupos");
    assert.strictEqual(ctx.atualizacoes[0].chave.etapa, ETAPA_FILA_FAIRNESS);
    assert.strictEqual(ctx.atualizacoes[0].chave.lane, LANE_FILA_FAIRNESS);
    assert.strictEqual(resultado.advisory.handle.client, ctx.pool.client, "advisory e fairness usam o mesmo client");
    assert.strictEqual(resultado.advisory.handle.clientProprio, true, "ownership e transferido somente apos COMMIT");
    assert(ctx.pool.client.consultas.includes("BEGIN") && ctx.pool.client.consultas.includes("COMMIT"));
    assert.strictEqual(ctx.pool.client.consultas.filter(sql => sql === "COMMIT").length, 1, "atendimento real commita exatamente uma vez");
  }

  {
    // Clone aparece depois de ciclos somente Optimus: o primeiro ciclo de
    // disputa preserva ranking sem memoria; o proximo alterna para Clone.
    const primeiro = ordenarCandidatePool([optimus, clone], "");
    const segundo = ordenarCandidatePool([optimus, clone], primeiro.ordem[0].oferta.origemFluxo);
    assert.strictEqual(primeiro.ordem[0], optimus);
    assert.strictEqual(segundo.ordem[0], clone, "origem que reaparece progride na proxima disputa sem reset");
  }

  {
    const ctx = criarServico({ ultima: "optimus", ocupados: new Set(["clone_1"]) });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus, clone], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.candidato, optimus, "advisory ocupado usa reposicao bounded");
    assert.strictEqual(resultado.skipped[0].motivo, "advisory_ocupado");
    assert.strictEqual(ctx.atualizacoes[0].origem, "optimus");
    assert.deepStrictEqual(ctx.eventos.at(-1).causasFallback, ["advisory_ocupado"], "telemetria preserva a causa antes do fallback");
  }

  for (const motivo of ["candidato_stale", "gate_reprovado", "anti_repeat", "duplicidade"]) {
    const ctx = criarServico({ ultima: "optimus", revalidar: async item =>
      item.oferta.id === "clone_1" ? { ok: false, motivo } : { ok: true }
    });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus, clone], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.candidato, optimus, `${motivo} usa fallback bounded`);
    assert.strictEqual(ctx.atualizacoes.length, 1, `${motivo} nao atualiza por candidato rejeitado`);
    assert.strictEqual(ctx.atualizacoes[0].origem, "optimus");
    assert(ctx.catraca.liberados.includes("clone_1"), `${motivo} libera advisory do candidato rejeitado`);
  }

  {
    const ctx = criarServico({ ultima: "optimus", revalidar: async () => ({ ok: false, motivo: "gate_reprovado" }) });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus, clone], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.ignorado, true);
    assert.strictEqual(ctx.atualizacoes.length, 0, "nenhum candidato aprovado nao consome fairness");
    assert(ctx.pool.client.consultas.includes("ROLLBACK"), "sem candidato aprovado desfaz a criacao transitória da memoria");
    assert(!ctx.pool.client.consultas.includes("COMMIT"), "sem atendimento real nao commita linha vazia");
    assert.strictEqual(ctx.pool.client.released, true, "sem candidato aprovado devolve o client");
  }

  for (const motivo of ["anti_repeat_indisponivel", "duplicidade_indisponivel"]) {
    const revalidacoes = [];
    const ctx = criarServico({ ultima: "optimus", revalidar: async item => {
      revalidacoes.push(item.oferta.id);
      return { ok: false, motivo };
    } });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus, clone], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.ignorado, true, `${motivo} bloqueia somente o ciclo`);
    assert.strictEqual(ctx.atualizacoes.length, 0, `${motivo} nao consome fairness`);
    assert.deepStrictEqual(revalidacoes, ["clone_1"], `${motivo} nao tenta fallback apos indisponibilidade tecnica`);
    assert(ctx.pool.client.consultas.includes("ROLLBACK"), `${motivo} desfaz estado transacional`);
    assert(!resultado.skipped.some(item => item.motivo === "anti_repeat" || item.motivo === "duplicidade"), `${motivo} permanece distinto de bloqueio comprovado`);
  }

  {
    const ordem = [];
    const pool = criarPool({ ordem });
    const catraca = {
      async adquirir({ oferta, client }) {
        ordem.push(`LOCK:${oferta.id}`);
        return { resultado: "adquirido", handle: { client, clientProprio: false, ofertaId: oferta.id } };
      },
      async finalizar(estado) {
        ordem.push(`UNLOCK:${estado.handle.ofertaId}`);
        return { liberacao: "liberado" };
      }
    };
    const service = criarFairnessOrigemFila({
      pool,
      catracaAdvisory: catraca,
      logger: { log() {} },
      bloquearEstado: async (_client, chave) => ({ ...chave, ultimaOrigemAtendida: "optimus" }),
      registrarAtendimento: async () => ({})
    });
    const resultado = await service.selecionar({
      clienteId: "workspace_1",
      candidatePool: [optimus, clone],
      revalidar: async item => item.oferta.id === "clone_1" ? { ok: false, motivo: "gate_reprovado" } : { ok: true }
    });
    assert.strictEqual(resultado.candidato, optimus, "cleanup saudavel preserva fallback bounded");
    assert.deepStrictEqual(
      ordem,
      ["BEGIN", "LOCK:clone_1", "ROLLBACK", "UNLOCK:clone_1", "BEGIN", "LOCK:optimus_1", "COMMIT"],
      "candidato rejeitado limpa rollback, unlock e so entao recompõe o pool bounded"
    );
    assert.strictEqual(pool.client.releaseCount || 0, 0, "advisory aprovado e transferido; candidato rejeitado nao transfere client");
  }

  {
    const ordem = [];
    const pool = criarPool({ ordem });
    const tentativas = [];
    const service = criarFairnessOrigemFila({
      pool,
      catracaAdvisory: {
        async adquirir({ oferta, client }) {
          tentativas.push(oferta.id);
          ordem.push(`LOCK:${oferta.id}`);
          return { resultado: "adquirido", handle: { client, clientProprio: false, ofertaId: oferta.id } };
        },
        async finalizar(estado) {
          ordem.push(`UNLOCK_ERRO:${estado.handle.ofertaId}`);
          return { liberacao: "erro" };
        }
      },
      logger: { log() {} },
      bloquearEstado: async (_client, chave) => ({ ...chave, ultimaOrigemAtendida: "optimus" }),
      registrarAtendimento: async () => ({})
    });
    const resultado = await service.selecionar({
      clienteId: "workspace_1",
      candidatePool: [optimus, clone],
      revalidar: async () => ({ ok: false, motivo: "gate_reprovado" })
    });
    assert.strictEqual(resultado.ok, false, "unlock nao confirmado encerra o ciclo fail-closed");
    assert.deepStrictEqual(tentativas, ["clone_1"], "unlock falho nao tenta proximo candidato");
    assert.deepStrictEqual(ordem, ["BEGIN", "LOCK:clone_1", "ROLLBACK", "UNLOCK_ERRO:clone_1", "RELEASE"], "unlock falho ocorre somente apos rollback");
    assert(pool.client.releaseErro instanceof Error, "unlock falho descarta a conexao contaminada");
    assert.strictEqual(pool.client.releaseCount, 1, "cleanup falho libera o client exatamente uma vez");
  }

  {
    const ordem = [];
    const pool = criarPool({ ordem, falharEm: sql => sql === "ROLLBACK" });
    const service = criarFairnessOrigemFila({
      pool,
      catracaAdvisory: {
        async adquirir({ oferta, client }) {
          ordem.push(`LOCK:${oferta.id}`);
          return { resultado: "adquirido", handle: { client, clientProprio: false, ofertaId: oferta.id } };
        },
        async finalizar(estado) {
          ordem.push(`UNLOCK:${estado.handle.ofertaId}`);
          return { liberacao: "liberado" };
        }
      },
      logger: { log() {} },
      bloquearEstado: async (_client, chave) => ({ ...chave, ultimaOrigemAtendida: "optimus" }),
      registrarAtendimento: async () => ({})
    });
    const resultado = await service.selecionar({
      clienteId: "workspace_1",
      candidatePool: [optimus, clone],
      revalidar: async () => ({ ok: false, motivo: "gate_reprovado" })
    });
    assert.strictEqual(resultado.ok, false, "rollback falho tambem encerra o ciclo fail-closed");
    assert.deepStrictEqual(ordem, ["BEGIN", "LOCK:clone_1", "ROLLBACK", "UNLOCK:clone_1", "RELEASE"], "rollback falho ainda tenta unlock conservador antes do descarte");
    assert(pool.client.releaseErro instanceof Error, "rollback falho descarta a conexao");
    assert.strictEqual(pool.client.releaseCount, 1, "rollback falho nao causa double release");
  }

  {
    const chamadas = [];
    const ctx = criarServico({
      ultima: "optimus",
      catraca: {
        async adquirir({ oferta }) {
          chamadas.push(oferta.id);
          return { resultado: "erro", handle: null };
        },
        async finalizar() { throw new Error("nao_deve_finalizar_sem_advisory"); }
      }
    });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus, clone], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.ok, false, "erro PostgreSQL advisory e fail-closed");
    assert.deepStrictEqual(chamadas, ["clone_1"], "erro PostgreSQL nao tenta candidato de fallback");
    assert(ctx.pool.client.consultas.includes("ROLLBACK"), "erro PostgreSQL faz rollback");
    assert(!ctx.pool.client.consultas.includes("COMMIT"), "erro PostgreSQL nao commita fairness");
    assert.strictEqual(ctx.pool.client.released, true, "erro PostgreSQL devolve o client");
  }

  {
    const ctx = criarServico({ ultima: "", revalidar: async () => ({ ok: true }) });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.candidato, optimus, "origem isolada permanece work-conserving");
    assert.strictEqual(ctx.atualizacoes.length, 0, "origem isolada permanece work-conserving sem consumir turno de fairness");
    assert(ctx.pool.client.consultas.includes("ROLLBACK"), "origem isolada desfaz a linha transitoria de fairness");
    assert(!ctx.pool.client.consultas.includes("COMMIT"), "origem isolada nao persiste memoria vazia");
    assert.strictEqual(resultado.advisory.handle.clientProprio, true, "rollback nao perde o advisory session-scoped transferido ao caller");
    assert.strictEqual(ctx.pool.client.released, undefined, "client permanece retido ate o cleanup posterior do advisory");
  }

  {
    const ctx = criarServico({ ultima: "", revalidar: async () => ({ ok: true }) });
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [clone], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.candidato, clone, "Clone isolado permanece work-conserving");
    assert.strictEqual(ctx.atualizacoes.length, 0, "Clone isolado nao consome memoria de fairness");
    assert(ctx.pool.client.consultas.includes("ROLLBACK"), "Clone isolado tambem desfaz a linha transitoria");
    assert(!ctx.pool.client.consultas.includes("COMMIT"), "Clone isolado nao persiste linha vazia");
  }

  {
    const estadoExistente = { ultimaOrigemAtendida: "optimus", atualizadoEm: "antes" };
    const pool = criarPool();
    let registros = 0;
    const service = criarFairnessOrigemFila({
      pool,
      catracaAdvisory: criarCatraca(),
      logger: { log() {} },
      bloquearEstado: async (_client, chave) => ({ ...chave, ...estadoExistente }),
      registrarAtendimento: async () => { registros += 1; }
    });
    const resultado = await service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus], revalidar: async () => ({ ok: true }) });
    assert.strictEqual(registros, 0, "origem isolada nao atualiza linha existente");
    assert.deepStrictEqual(estadoExistente, { ultimaOrigemAtendida: "optimus", atualizadoEm: "antes" }, "rollback preserva memoria preexistente");
    assert.strictEqual(resultado.advisory.handle.clientProprio, true);
  }

  {
    const ordem = [];
    const pool = criarPool({ ordem });
    let unlocks = 0;
    const catraca = {
      async adquirir({ oferta, client }) {
        ordem.push("ADVISORY_ACQUIRED");
        return { resultado: "adquirido", handle: { client, clientProprio: false, ofertaId: oferta.id } };
      },
      async finalizar() {
        unlocks += 1;
        ordem.push("ADVISORY_UNLOCK");
        return { liberacao: "liberado" };
      }
    };
    const service = criarFairnessOrigemFila({
      pool,
      catracaAdvisory: catraca,
      logger: { log() {} },
      bloquearEstado: async (_client, chave) => ({ ...chave, ultimaOrigemAtendida: "optimus" }),
      registrarAtendimento: async () => {
        ordem.push("QUERY_ERROR");
        throw new Error("transacao_abortada");
      }
    });
    const resultado = await service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus, clone], revalidar: async () => ({ ok: true }) });
    assert.strictEqual(resultado.ok, false, "erro apos advisory permanece fail-closed");
    assert.strictEqual(unlocks, 1, "cleanup do advisory ocorre uma unica vez");
    assert.deepStrictEqual(ordem, ["BEGIN", "ADVISORY_ACQUIRED", "QUERY_ERROR", "ROLLBACK", "ADVISORY_UNLOCK", "RELEASE"], "rollback ocorre antes do unlock e release");
  }

  {
    const pool = criarPool();
    let unlocks = 0;
    const catraca = {
      async adquirir({ oferta, client }) {
        return { resultado: "adquirido", handle: { client, clientProprio: false, ofertaId: oferta.id, liberado: false } };
      },
      async finalizar(estado) {
        if (!estado?.handle || estado.handle.liberado) return { liberado: false, idempotente: true };
        estado.handle.liberado = true;
        unlocks += 1;
        if (estado.handle.clientProprio) estado.handle.client.release();
        return { liberado: true };
      }
    };
    const service = criarFairnessOrigemFila({
      pool,
      catracaAdvisory: catraca,
      logger: { log() {} },
      bloquearEstado: async (_client, chave) => ({ ...chave, ultimaOrigemAtendida: "" }),
      registrarAtendimento: async () => ({})
    });
    const resultado = await service.selecionar({ clienteId: "workspace_1", candidatePool: [optimus], revalidar: async () => ({ ok: true }) });
    try {
      throw new Error("falha_apos_retorno_do_service");
    } catch {
      // Simula qualquer throw posterior do caller, inclusive persistencia da fila.
    } finally {
      await catraca.finalizar(resultado.advisory);
    }
    await catraca.finalizar(resultado.advisory);
    assert.strictEqual(unlocks, 1, "caller com ownership transferido libera advisory exatamente uma vez apos throw");
    assert.strictEqual(pool.client.released, true, "client transferido e devolvido mesmo quando caller falha apos retorno");
  }

  {
    const legacy = candidato("legacy_1", "");
    const ctx = criarServico();
    const resultado = await ctx.service.selecionar({ clienteId: "workspace_1", candidatePool: [legacy, optimus], revalidar: ctx.revalidar });
    assert.strictEqual(resultado.legacy, true);
    assert.strictEqual(resultado.candidato, legacy);
    assert.strictEqual(ctx.atualizacoes.length, 0, "legacy nao ganha origem falsa nem atualiza memoria");
  }

  console.log("fila-duas-veias-origem-fairness.test.js OK");
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
