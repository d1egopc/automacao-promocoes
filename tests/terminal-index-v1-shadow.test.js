"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOperacional = require("../modules/fila/fila-operacional-v2");
const { criarCoordenadorPersistencia } = require("../modules/fila/persistence-coordinator");
const { construirTerminalIndex } = require("../modules/fila/terminal-index-worker");
const terminalIndex = require("../modules/fila/terminal-index-shadow");

function fixture(prefix = "terminal-index-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cliente = "workspace_teste";
  const dir = path.join(root, "clientes", cliente);
  const incremental = path.join(dir, terminalIndex.TERMINAL_INDEX_INCREMENTAL_DIR);
  fs.mkdirSync(incremental, { recursive: true });
  return {
    root,
    cliente,
    dir,
    incremental,
    limpar() {
      const resolved = path.resolve(root);
      assert(resolved.startsWith(path.resolve(os.tmpdir())));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  };
}

function escreverFontes(f, opcoes = {}) {
  const legado = opcoes.legado || [
    { id: "legacy_retida", status: "retida", titulo: "nao indexar" },
    { id: "ambas", status: "erro" },
    { id: "viva_ignorada", status: "pendente" },
    { titulo: "sem identidade", status: "retida" }
  ];
  const incremental = opcoes.incremental || [
    { versao: 1, id: "incremental_enviado", status: "enviado", item: { id: "incremental_enviado", status: "enviado" } },
    { versao: 1, id: "ambas", status: "enviado", item: { id: "ambas", status: "enviado" } }
  ];
  fs.writeFileSync(path.join(f.dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE), JSON.stringify(legado));
  fs.writeFileSync(path.join(f.incremental, "2026-09-28.jsonl"), `${incremental.map(item => JSON.stringify(item)).join("\n")}\n`);
}

function build(f, extras = {}) {
  return construirTerminalIndex({
    operation: "terminal_index_bootstrap",
    clienteId: f.cliente,
    checkpointRevision: extras.revision || "terminal-test-0001",
    targetGeneration: extras.generation || 17,
    dataDir: f.root,
    nowMs: Date.parse("2026-09-28T12:00:00.000Z")
  }, {
    operacional: filaOperacional,
    hooks: extras.hooks
  });
}

function validar(f) {
  return terminalIndex.validarTerminalIndex(f.cliente, {
    getClientePath: () => f.dir,
    fs
  });
}

async function main() {
  const principal = fixture();
  try {
    escreverFontes(principal);
    const resultado = build(principal);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.totalTerminais, 3, "uniao factual deve eliminar duplicata e ignorar viva/sem identidade");
    assert(resultado.metrics.messageBytes < 4096, "descritor enviado ao Worker deve permanecer pequeno");
    assert(resultado.bytes < 4096, "fixture deve produzir indice compacto");

    const valido = validar(principal);
    assert.strictEqual(valido.valido, true);
    assert.strictEqual(valido.index.complete, true);
    assert.strictEqual(valido.index.totalTerminais, 3);
    assert.deepStrictEqual(valido.index.entries.legacy_retida, ["retida", 1], "gap legado retida deve entrar no bootstrap");
    assert.deepStrictEqual(valido.index.entries.incremental_enviado, ["enviado", 2], "terminal somente incremental deve entrar");
    assert.deepStrictEqual(valido.index.entries.ambas, ["enviado", 3], "duplicata deve colapsar e preservar status terminal mais avancado");
    assert.strictEqual(valido.index.entries.viva_ignorada, undefined);
    assert.strictEqual(valido.index.entries["indice:0"], undefined);
    assert.strictEqual(valido.index.entries["legacy-retida"], undefined, "identidade aproximada nunca pode casar");

    const logs = [];
    terminalIndex.resetarTerminalIndexShadowParaTeste();
    const shadow = terminalIndex.avaliarTerminalIndexShadow(
      principal.cliente,
      "legacy_retida",
      { provado: true, status: "retida", fonte: "fila-historico.json" },
      {
        env: { FILA_TERMINAL_INDEX_SHADOW: "1", FILA_TERMINAL_INDEX_SHADOW_LOG_INTERVAL_MS: "0" },
        getClientePath: () => principal.dir,
        fs,
        logger: { log: (...args) => logs.push(args.join(" ")) }
      }
    );
    assert.strictEqual(shadow.hit, true);
    assert.strictEqual(shadow.concorda, true);
    assert.strictEqual(shadow.statusConcorda, true);
    assert(logs.some(linha => linha.includes("[FILA-TERMINAL-INDEX-SHADOW]")));
    assert(!logs.join("\n").includes(principal.cliente), "log nao pode expor workspace bruto");
    assert(!logs.join("\n").includes("legacy_retida"), "log nao pode expor identidade bruta");

    fs.writeFileSync(path.join(principal.dir, "fila-viva.json"), "[]");
    const depsAutoridade = env => ({
      env,
      getClientePath: () => principal.dir,
      getClienteJsonPath: (_cliente, arquivo) => path.join(principal.dir, arquivo),
      readClienteJson: (_cliente, arquivo, fallback) => {
        const file = path.join(principal.dir, arquivo);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
      },
      fs,
      logger: { log() {} }
    });
    const legadoOff = filaOperacional.atualizarItemFilaVivaIncremental(
      principal.cliente,
      { id: "legacy_retida", status: "retida" },
      depsAutoridade({ FILA_TERMINAL_INDEX_SHADOW: "0" })
    );
    const legadoShadow = filaOperacional.atualizarItemFilaVivaIncremental(
      principal.cliente,
      { id: "legacy_retida", status: "retida" },
      depsAutoridade({ FILA_TERMINAL_INDEX_SHADOW: "1" })
    );
    const { updateVivaMs: _offMs, ...resultadoOff } = legadoOff;
    const { updateVivaMs: _shadowMs, ...resultadoShadow } = legadoShadow;
    assert.deepStrictEqual(resultadoShadow, resultadoOff, "Shadow nao pode alterar a resposta funcional da autoridade legada");

    const offLogs = [];
    const off = terminalIndex.avaliarTerminalIndexShadow(principal.cliente, "legacy_retida", { provado: true }, {
      env: { FILA_TERMINAL_INDEX_SHADOW: "0" },
      getClientePath: () => principal.dir,
      logger: { log: (...args) => offLogs.push(args) }
    });
    assert.strictEqual(off.ativo, false);
    assert.strictEqual(offLogs.length, 0, "flag OFF deve ser legado puro e silencioso");

    fs.appendFileSync(path.join(principal.incremental, "2026-09-28.jsonl"), `${JSON.stringify({ item: { id: "novo_terminal", status: "retida" } })}\n`);
    const stale = validar(principal);
    assert.strictEqual(stale.valido, false);
    assert.strictEqual(stale.motivo, "terminal_index_source_stale", "nova terminalizacao deve invalidar indice antigo");
  } finally {
    principal.limpar();
  }

  const fonteMudou = fixture("terminal-index-stale-");
  try {
    escreverFontes(fonteMudou);
    assert.throws(() => build(fonteMudou, {
      revision: "terminal-stale-0001",
      hooks: {
        afterScan() {
          fs.appendFileSync(path.join(fonteMudou.incremental, "2026-09-28.jsonl"), `${JSON.stringify({ item: { id: "race", status: "retida" } })}\n`);
        }
      }
    }), erro => erro?.code === "STALE_REVISION");
    assert.strictEqual(fs.existsSync(path.join(fonteMudou.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE)), false);
  } finally {
    fonteMudou.limpar();
  }

  const crash = fixture("terminal-index-crash-");
  try {
    escreverFontes(crash);
    assert.throws(() => build(crash, {
      revision: "terminal-crash-0001",
      hooks: { afterIndexPartial() { throw new Error("crash_controlado"); } }
    }), /crash_controlado/);
    assert.strictEqual(fs.existsSync(path.join(crash.dir, terminalIndex.TERMINAL_INDEX_FILE)), false);
    assert.strictEqual(fs.existsSync(path.join(crash.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE)), false);
    assert.strictEqual(fs.readdirSync(crash.dir).some(nome => nome.includes(".partial.")), false);
  } finally {
    crash.limpar();
  }

  const divergente = fixture("terminal-index-proof-");
  try {
    escreverFontes(divergente);
    build(divergente, { revision: "terminal-proof-0001" });
    const proofFile = path.join(divergente.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE);
    const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
    proof.revision = "terminal-proof-divergente";
    fs.writeFileSync(proofFile, JSON.stringify(proof));
    assert.strictEqual(validar(divergente).motivo, "terminal_index_revision_divergente");
  } finally {
    divergente.limpar();
  }

  const ausente = fixture("terminal-index-missing-");
  try {
    assert.throws(() => build(ausente, { revision: "terminal-missing-0001" }), erro => erro?.code === "TERMINAL_INDEX_SOURCE_MISSING");
    fs.writeFileSync(path.join(ausente.dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE), "{corrompido");
    fs.writeFileSync(path.join(ausente.incremental, "2026-09-28.jsonl"), "");
    assert.throws(() => build(ausente, { revision: "terminal-corrupt-0001" }));
    assert.strictEqual(fs.existsSync(path.join(ausente.dir, terminalIndex.TERMINAL_INDEX_PROOF_FILE)), false);
  } finally {
    ausente.limpar();
  }

  const integrado = fixture("terminal-index-worker-");
  let coordenador;
  try {
    escreverFontes(integrado);
    const eventos = [];
    const env = {
      ...process.env,
      DATA_DIR: integrado.root,
      FILA_PERSISTENCE_WORKER: "1",
      FILA_PERSISTENCIA_CANARY_CLIENTES: integrado.cliente,
      FILA_PERSISTENCE_WORKER_TIMEOUT_MS: "120000"
    };
    coordenador = criarCoordenadorPersistencia({
      env,
      logger: {
        log(tag, raw) {
          if (tag !== "[FILA-PERSISTENCIA-WORKER]") return;
          try { eventos.push(JSON.parse(raw)); } catch {}
        }
      }
    });
    const job = await coordenador.bootstrapTerminalIndex({
      clienteId: integrado.cliente,
      checkpointRevision: "terminal-worker-0001",
      targetGeneration: 23,
      dataDir: integrado.root,
      persistenceMode: "worker"
    });
    assert.strictEqual(job.ok, true);
    assert.strictEqual(job.operation, "terminal_index_bootstrap");
    assert(job.metrics.messageBytes < 4096);
    assert.strictEqual(coordenador.getState().workerCreated, true, "bootstrap deve reutilizar a unica Worker do coordenador");
    assert(eventos.some(item => item.evento === "job_ok" && item.operacao === "terminal_index_bootstrap"));
    assert.strictEqual(validar(integrado).valido, true);
    fs.unlinkSync(path.join(integrado.dir, terminalIndex.TERMINAL_INDEX_LEGACY_FILE));
    const incompleto = await coordenador.bootstrapTerminalIndex({
      clienteId: integrado.cliente,
      checkpointRevision: "terminal-worker-0002",
      targetGeneration: 24,
      dataDir: integrado.root,
      persistenceMode: "worker"
    });
    assert.strictEqual(incompleto.ok, false);
    assert.strictEqual(coordenador.getState().globalCircuitOpen, false, "falha Shadow esperada nao pode abrir circuito do Persistence Worker");
    assert.strictEqual(coordenador.getState().circuitByWorkspace[terminalIndex.workspaceHash(integrado.cliente)], false);
    assert(eventos.some(item => item.evento === "job_rejected" && item.operacao === "terminal_index_bootstrap"));
  } finally {
    if (coordenador) await coordenador.shutdown({ timeoutMs: 5000 });
    integrado.limpar();
  }

  console.log("terminal-index-v1-shadow: OK (union/exact/stale/crash/proof/small-descriptor/shared-worker)");
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
