"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const manifestStateRepository = require("../modules/fila/fila-manifest-state.repository");

const AGORA = new Date("2026-08-26T14:00:00.000Z").getTime();

function criarStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-viva-idempotencia-"));
  const getClientePath = clienteId => path.join(dir, clienteId);
  const getClienteJsonPath = (clienteId, arquivo) => path.join(dir, clienteId, arquivo);
  const writeClienteJson = (clienteId, arquivo, dados) => {
    const destino = getClienteJsonPath(clienteId, arquivo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, JSON.stringify(dados), "utf8");
    return true;
  };
  return { dir, getClientePath, getClienteJsonPath, writeClienteJson };
}

function oferta(id, overrides = {}) {
  return {
    id,
    ofertaId: id,
    engineOfertaId: id,
    clienteId: "cliente_stale",
    marketplace: "mercadolivre",
    produtoId: `MLB-${id}`,
    titulo: `Oferta ${id}`,
    preco: 100,
    status: "pendente",
    dataEntradaFila: new Date(AGORA - 30 * 60 * 1000).toISOString(),
    ...overrides
  };
}

function envCanary(cliente) {
  return {
    FILA_V2_OPERACIONAL_ROLLOUT: "canary",
    FILA_V2_OPERACIONAL_CANARY_CLIENTES: cliente
  };
}

function criarRepoFake({ resultadoFixo = null } = {}) {
  return {
    compararDbJson: () => ({ resultado: "db_json_equivalente", equivalente: true }),
    async registrarMutacaoDuravel(clienteId, dados = {}) {
      if (resultadoFixo) return { ...resultadoFixo };
      const state = {
        clienteId,
        vivaGeneration: 0,
        durableCheckpointGeneration: 0,
        dirtyGeneration: null
      };
      const escrita = await dados.escreverArquivo({
        clienteId,
        state,
        nextGeneration: 1,
        fileRevision: "rev_teste"
      });
      if (escrita?.ok !== true) {
        return {
          ok: false,
          motivo: escrita?.motivo || "mutacao_viva_nao_confirmada",
          dbIndisponivel: escrita?.dbIndisponivel === true,
          state,
          resultadoArquivo: escrita
        };
      }
      return { ok: true, state, ...escrita };
    }
  };
}

async function main() {
  {
    const storage = criarStorage();
    const cliente = "cliente_stale_provado";
    const item = oferta("stale-1", { clienteId: cliente });
    const deps = {
      ...storage,
      logger: { log: () => {} },
      agora: AGORA
    };

    assert.strictEqual(filaOperacionalV2.inserirItemFilaVivaIncremental(cliente, item, deps).ok, true);
    const terminal = {
      ...item,
      status: "retida",
      motivoRetencao: "duplicata",
      retidaEm: new Date(AGORA).toISOString()
    };
    const primeira = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, terminal, deps);
    const segunda = filaOperacionalV2.atualizarItemFilaVivaIncremental(cliente, terminal, deps);

    assert.strictEqual(primeira.ok, true);
    assert.strictEqual(primeira.removeuDaViva, true);
    assert.strictEqual(segunda.ok, true, "repeticao stale so e idempotente com prova terminal");
    assert.strictEqual(segunda.idempotente, true);
    assert.strictEqual(segunda.terminalHistorico, true);
    assert.strictEqual(segunda.motivo, "item_ja_terminal_idempotente");

    const coordenada = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, terminal, {
      ...deps,
      env: envCanary(cliente),
      manifestStateRepository: criarRepoFake(),
      exigirMutacao: true
    });
    assert.strictEqual(coordenada.ok, true);
    assert.strictEqual(coordenada.idempotente, true);
    assert.strictEqual(coordenada.generation, 0, "idempotencia terminal nao deve criar generation fantasma");
  }

  {
    const storage = criarStorage();
    const cliente = "cliente_falha_arquivo";
    const resultado = await filaOperacionalV2.executarEscritaFilaV2Coordenada(
      cliente,
      "update_viva",
      () => ({ ok: true }),
      {
        ...storage,
        env: envCanary(cliente),
        manifestStateRepository: criarRepoFake({
          resultadoFixo: { ok: false, motivo: "arquivo_viva_falhou", dbIndisponivel: false }
        }),
        logger: { log: () => {} },
        agora: AGORA
      }
    );

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.dbIndisponivel, false, "falha de arquivo nao e indisponibilidade do DB");
  }

  {
    const storage = criarStorage();
    const cliente = "cliente_ausente_sem_prova";
    const item = oferta("ausente-1", { clienteId: cliente });
    const logs = [];
    const deps = {
      ...storage,
      env: envCanary(cliente),
      manifestStateRepository: criarRepoFake(),
      logger: { log: (...args) => logs.push(args.join(" ")) },
      agora: AGORA,
      exigirMutacao: true
    };

    storage.writeClienteJson(cliente, "fila-viva.json", []);
    const resultado = await filaOperacionalV2.atualizarItemFilaVivaCoordenado(cliente, item, deps);

    assert.strictEqual(resultado.ok, false, "ausencia sem prova deve permanecer fail-closed");
    assert.strictEqual(resultado.motivo, "mutacao_viva_nao_confirmada");
    assert.strictEqual(resultado.dbIndisponivel, false);
    assert(logs.some(linha => linha.includes("mutacao_viva_nao_confirmada")));
    assert(!logs.some(linha => linha.includes(cliente)));
    assert(!logs.some(linha => linha.includes(item.id)));
  }

  {
    const storage = criarStorage();
    const cliente = "cliente_db_indisponivel";
    const resultado = await filaOperacionalV2.executarEscritaFilaV2Coordenada(
      cliente,
      "update_viva",
      () => ({ ok: true }),
      {
        ...storage,
        env: envCanary(cliente),
        manifestStateRepository: criarRepoFake({
          resultadoFixo: { ok: false, motivo: "pool_indisponivel", dbIndisponivel: true }
        }),
        logger: { log: () => {} },
        agora: AGORA
      }
    );

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.dbIndisponivel, true, "falha real de pool continua sendo DB indisponivel");
  }

  {
    const erro = new Error("connection refused");
    erro.code = "ECONNREFUSED";
    const resultado = await manifestStateRepository.registrarMutacaoDuravel("cliente_pool_connect", {}, {
      pool: { connect: async () => { throw erro; } }
    });
    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.dbIndisponivel, true, "falha no connect do pool deve ser classificada como DB");
  }

  console.log("fila-viva-idempotencia-stale: ok");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
