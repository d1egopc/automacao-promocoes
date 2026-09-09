"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const repo = require("../modules/fila/fila-checkpoints-entrega.repository");

const ATTEMPT_A = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_B = "22222222-2222-4222-8222-222222222222";

function chave(params = []) {
  return params.slice(0, 4).join("|");
}

function copiar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function criarPoolMemoria() {
  const linhas = new Map();
  return {
    linhas,
    async connect() {
      return {
        async query(sql, params = []) {
          const texto = String(sql).replace(/\s+/g, " ").trim();
          const id = chave(params);
          if (/^INSERT INTO fila_checkpoints_entrega/i.test(texto)) {
            if (linhas.has(id)) return { rows: [], rowCount: 0 };
            const agora = "2026-09-09T12:00:00.000Z";
            const linha = {
              cliente_id: params[0], fila_item_id: params[1], destino_chave: params[2], alvo_chave: params[3],
              attempt_id: params[4], estado: "preparado", provider_message_id: null,
              credito_debitado: null, criado_em: agora, atualizado_em: agora
            };
            linhas.set(id, linha);
            return { rows: [copiar(linha)], rowCount: 1 };
          }
          if (/^SELECT .* FROM fila_checkpoints_entrega/i.test(texto)) {
            const linha = linhas.get(id);
            return { rows: linha ? [copiar(linha)] : [], rowCount: linha ? 1 : 0 };
          }
          if (/^UPDATE fila_checkpoints_entrega/i.test(texto) && /SET estado = \$7/i.test(texto)) {
            const linha = linhas.get(id);
            if (!linha || linha.attempt_id !== params[4] || linha.estado !== params[5]) return { rows: [], rowCount: 0 };
            linha.estado = params[6];
            if (params[7] !== null) linha.provider_message_id = params[7];
            if (params[8] !== null) linha.credito_debitado = params[8];
            linha.atualizado_em = "2026-09-09T12:01:00.000Z";
            return { rows: [copiar(linha)], rowCount: 1 };
          }
          if (/^UPDATE fila_checkpoints_entrega/i.test(texto) && /SET attempt_id = \$6/i.test(texto)) {
            const linha = linhas.get(id);
            if (!linha || linha.attempt_id !== params[4] || linha.estado !== "falha_confirmada") return { rows: [], rowCount: 0 };
            linha.attempt_id = params[5];
            linha.estado = "preparado";
            linha.provider_message_id = null;
            linha.credito_debitado = null;
            linha.atualizado_em = "2026-09-09T12:02:00.000Z";
            return { rows: [copiar(linha)], rowCount: 1 };
          }
          throw new Error(`sql_nao_suportado: ${texto}`);
        },
        release() {}
      };
    }
  };
}

function entrada(extra = {}) {
  return {
    clienteId: "workspace_a",
    filaItemId: "fila_1",
    destinoChave: "whatsapp:destino_1",
    alvoChave: "grupo:1203630@g.us",
    attemptId: ATTEMPT_A,
    ...extra
  };
}

function testarSchemaEValidacao() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "modules", "engine", "schema.sql"), "utf8");
  const tabela = schema.match(/CREATE TABLE IF NOT EXISTS fila_checkpoints_entrega \([\s\S]*?\n\);/i)?.[0] || "";
  assert.match(tabela, /PRIMARY KEY \(cliente_id, fila_item_id, destino_chave, alvo_chave\)/i);
  for (const estado of repo.ESTADOS) assert.match(tabela, new RegExp(`'${estado}'`));
  assert.doesNotMatch(tabela, /(lease|ttl|heartbeat|expires|takeover)/i);
  assert.throws(() => repo.normalizarChaveCheckpointEntrega({}), /cliente_id_ausente/);
  assert.throws(() => repo.normalizarChaveCheckpointEntrega({ clienteId: "a", filaItemId: "indice:1", destinoChave: "d", alvoChave: "x" }), /posicional/);
  assert.throws(() => repo.normalizarAttemptId("nao-uuid"), /attempt_id_invalido/);
  assert.throws(() => repo.normalizarTransicao({ deEstado: "preparado", paraEstado: "enviado" }), /transicao_invalida/);
  assert.throws(() => repo.sqlSchemaCheckpointEntrega("tabela;drop"), /tabela_invalida/);
}

async function testarCriacaoTransicaoELeitura() {
  const pool = criarPoolMemoria();
  const criado = await repo.criarCheckpointEntrega(entrada(), { pool });
  assert.strictEqual(criado.criado, true);
  assert.strictEqual(criado.checkpoint.estado, "preparado");
  assert.strictEqual((await repo.criarCheckpointEntrega(entrada(), { pool })).criado, false);
  assert.strictEqual((await repo.obterCheckpointEntrega(entrada(), { pool })).attemptId, ATTEMPT_A);

  const iniciado = await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool });
  assert.strictEqual(iniciado.transicionado, true);
  const enviado = await repo.transicionarCheckpointEntrega({
    ...entrada(), deEstado: "envio_iniciado", paraEstado: "enviado",
    providerMessageId: "provider-123", creditoDebitado: true
  }, { pool });
  assert.strictEqual(enviado.transicionado, true);
  assert.strictEqual(enviado.checkpoint.providerMessageId, "provider-123");
  assert.strictEqual(enviado.checkpoint.creditoDebitado, true);
  await assert.rejects(
    repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "enviado", paraEstado: "resultado_ambiguo" }, { pool }),
    /transicao_invalida/
  );
}

async function testarCasEFencing() {
  const pool = criarPoolMemoria();
  await repo.criarCheckpointEntrega(entrada(), { pool });
  const errado = await repo.transicionarCheckpointEntrega({ ...entrada({ attemptId: ATTEMPT_B }), deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool });
  assert.strictEqual(errado.transicionado, false, "attempt errado nao conclui checkpoint alheio");
  await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool });
  await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "envio_iniciado", paraEstado: "falha_confirmada" }, { pool });
  const nova = await repo.prepararNovaTentativaCheckpointEntrega({ ...entrada(), attemptIdAnterior: ATTEMPT_A, attemptId: ATTEMPT_B }, { pool });
  assert.strictEqual(nova.preparada, true);
  assert.strictEqual(nova.checkpoint.attemptId, ATTEMPT_B);
  const velha = await repo.transicionarCheckpointEntrega({ ...entrada(), deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool });
  assert.strictEqual(velha.transicionado, false, "tentativa velha nao sobrescreve tentativa nova");
  assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...entrada({ attemptId: ATTEMPT_B }), deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool })).transicionado, true);
}

async function testarEstadosTerminaisConservadores() {
  const pool = criarPoolMemoria();
  const ambigua = entrada({ destinoChave: "telegram:destino_1" });
  await repo.criarCheckpointEntrega(ambigua, { pool });
  await repo.transicionarCheckpointEntrega({ ...ambigua, deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool });
  assert.strictEqual((await repo.transicionarCheckpointEntrega({ ...ambigua, deEstado: "envio_iniciado", paraEstado: "resultado_ambiguo" }, { pool })).transicionado, true);
  assert.strictEqual((await repo.prepararNovaTentativaCheckpointEntrega({ ...ambigua, attemptIdAnterior: ATTEMPT_A, attemptId: ATTEMPT_B }, { pool })).preparada, false, "resultado ambiguo nao abre nova tentativa");

  const semProvider = entrada({ destinoChave: "discord:destino_1" });
  await repo.criarCheckpointEntrega(semProvider, { pool });
  await repo.transicionarCheckpointEntrega({ ...semProvider, deEstado: "preparado", paraEstado: "envio_iniciado" }, { pool });
  const enviado = await repo.transicionarCheckpointEntrega({ ...semProvider, deEstado: "envio_iniciado", paraEstado: "enviado", creditoDebitado: false }, { pool });
  assert.strictEqual(enviado.checkpoint.providerMessageId, null, "provider_message_id e opcional");
  assert.strictEqual(enviado.checkpoint.creditoDebitado, false, "credito e apenas evidencia booleana");
}

async function testarIsolamentoDeChaves() {
  const pool = criarPoolMemoria();
  const resultados = await Promise.all([
    repo.criarCheckpointEntrega(entrada(), { pool }),
    repo.criarCheckpointEntrega(entrada({ destinoChave: "discord:destino_2" }), { pool }),
    repo.criarCheckpointEntrega(entrada({ alvoChave: "canal:987" }), { pool }),
    repo.criarCheckpointEntrega(entrada({ clienteId: "workspace_b" }), { pool })
  ]);
  assert(resultados.every(resultado => resultado.criado), "destino, alvo e workspace possuem chaves independentes");
}

(async () => {
  testarSchemaEValidacao();
  await testarCriacaoTransicaoELeitura();
  await testarCasEFencing();
  await testarEstadosTerminaisConservadores();
  await testarIsolamentoDeChaves();
  console.log("fila-checkpoints-entrega.repository.test.js OK");
})().catch(erro => {
  console.error(erro.stack || erro.message || erro);
  process.exit(1);
});
