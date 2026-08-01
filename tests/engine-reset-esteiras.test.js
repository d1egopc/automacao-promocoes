"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  GRUPOS_ESTEIRA,
  STATUS_FINAL_EXPIRADO,
  identidadeItem,
  caminhosOperacao,
  executarDryRunResetEsteiras,
  executarResetEsteiras,
  executarRollbackResetEsteiras,
  writeJsonAtomic
} = require("../modules/engine/reset-esteiras");

const tmpRoot = path.join(__dirname, "tmp-reset-esteiras");

function limpar() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function filaFile(dataDir, workspaceId) {
  return path.join(dataDir, "clientes", workspaceId, "fila.json");
}

function escreverFila(dataDir, workspaceId, fila) {
  const file = filaFile(dataDir, workspaceId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(fila, null, 2));
}

function lerFila(dataDir, workspaceId) {
  return JSON.parse(fs.readFileSync(filaFile(dataDir, workspaceId), "utf8"));
}

function item(id, extra = {}) {
  return {
    id,
    clienteId: extra.clienteId || "ws1",
    status: extra.status || "pendente",
    titulo: extra.titulo || `Oferta ${id}`,
    marketplace: extra.marketplace || "mercadolivre",
    dataEntradaFila: extra.dataEntradaFila,
    destinoId: extra.destinoId || "destino-a",
    ofertaId: extra.ofertaId || `oferta-${id}`,
    jobId: extra.jobId || `job-${id}`,
    ...extra
  };
}

function ids(fila) {
  return fila.map(o => o.id).sort();
}

(async () => {
  limpar();
  const dataDir = path.join(tmpRoot, "caso-dry-run");
  const filaOriginal = [
    item("exp-1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
    item("exp-2", { dataEntradaFila: "2026-07-31T20:05:00.000Z", cupom: "MODA10" }),
    item("proc-1", { status: "processando", dataEntradaFila: "2026-07-31T10:00:00.000Z" }),
    item("sem-data", { dataEntradaFila: "" }),
    item("env-1", { status: "enviado", dataEntradaFila: "2026-07-31T10:00:00.000Z" }),
    item("similar-1", { titulo: "Produto Similar", dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
    item("similar-2", { titulo: "Produto Similar", dataEntradaFila: "2026-07-31T20:00:00.000Z" })
  ];
  escreverFila(dataDir, "ws1", filaOriginal);

  const antes = fs.readFileSync(filaFile(dataDir, "ws1"), "utf8");
  const dry = await executarDryRunResetEsteiras({
    dataDir,
    operationId: "op-dry",
    operationStartedAt: "2026-08-01T00:00:00.000Z",
    loteTamanho: 2
  });
  const depois = fs.readFileSync(filaFile(dataDir, "ws1"), "utf8");
  assert.strictEqual(antes, depois, "dry-run nao deve escrever na fila");
  assert.strictEqual(dry.totais.expirar, 4, "dry-run deve materializar expirados confirmados");
  assert.strictEqual(dry.totais.preservarAtivo, 1, "processando deve ser preservado ativo");
  assert.strictEqual(dry.totais.auditar, 1, "sem timestamp deve ir para auditoria");
  assert.strictEqual(dry.porWorkspace.ws1.estatisticas.expirar.total, 4);
  assert(fs.existsSync(path.join(dataDir, "reset-esteiras", "op-dry", "manifest.json")), "manifest deve existir");
  assert(fs.existsSync(path.join(dataDir, "reset-esteiras", "op-dry", "snapshot", "ws1.json")), "snapshot por workspace deve existir");
  assert(fs.existsSync(path.join(dataDir, "reset-esteiras", "op-dry", "lotes", "ws1-1.json")), "lote deve existir");

  const snapshot = JSON.parse(fs.readFileSync(path.join(dataDir, "reset-esteiras", "op-dry", "snapshot", "ws1.json"), "utf8"));
  assert(snapshot.grupos[GRUPOS_ESTEIRA.EXPIRAR].every(registro => registro.indiceOriginal >= 0), "indice original fica apenas como auditoria");
  assert(snapshot.grupos[GRUPOS_ESTEIRA.EXPIRAR].every(registro => registro.identidade.chave), "snapshot deve guardar identidade exata");

  assert.notStrictEqual(
    identidadeItem(filaOriginal[5]).chave,
    identidadeItem(filaOriginal[6]).chave,
    "dois itens semelhantes com ids estaveis nao podem colidir"
  );

  {
    await assert.rejects(
      () => executarResetEsteiras({ dataDir, operationId: "op-dry" }),
      /execute_exige_confirm_operation_id/,
      "execute deve exigir confirmacao forte"
    );
  }

  {
    limpar();
    const dataDir2 = path.join(tmpRoot, "caso-execute");
    escreverFila(dataDir2, "ws1", [
      item("e1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("e2", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("e3", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("e4", { dataEntradaFila: "2026-07-31T20:00:00.000Z" })
    ]);
    await executarDryRunResetEsteiras({ dataDir: dataDir2, operationId: "op-exec", operationStartedAt: "2026-08-01T00:00:00.000Z", loteTamanho: 10 });

    const atual = lerFila(dataDir2, "ws1");
    escreverFila(dataDir2, "ws1", [
      item("novo", { dataEntradaFila: "2026-08-01T00:01:00.000Z" }),
      { ...atual[2], titulo: "Oferta alterada" },
      atual[3],
      { ...atual[1], status: "processando" },
      atual[0]
    ]);

    const exec = await executarResetEsteiras({ dataDir: dataDir2, operationId: "op-exec", confirmOperationId: "op-exec" });
    assert.strictEqual(exec.removidos, 2, "execute remove apenas candidatos ainda identicos");
    assert.strictEqual(exec.pulados, 2, "status alterado e hash divergente devem ser pulados");
    assert.deepStrictEqual(ids(lerFila(dataDir2, "ws1")), ["e2", "e3", "novo"].sort(), "item novo e candidatos alterados permanecem");
    const historico = JSON.parse(fs.readFileSync(caminhosOperacao("op-exec", { dataDir: dataDir2 }).historico, "utf8"));
    assert.strictEqual(historico.length, 2);
    assert(historico.every(item => item.statusFinal === STATUS_FINAL_EXPIRADO), "removidos geram historico leve expirado_fluxo_vivo");
  }

  {
    limpar();
    const dataDir3 = path.join(tmpRoot, "caso-retomada");
    escreverFila(dataDir3, "ws1", [
      item("r1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("r2", { dataEntradaFila: "2026-07-31T20:00:00.000Z" }),
      item("r3", { dataEntradaFila: "2026-07-31T20:00:00.000Z" })
    ]);
    await executarDryRunResetEsteiras({ dataDir: dataDir3, operationId: "op-retoma", operationStartedAt: "2026-08-01T00:00:00.000Z", loteTamanho: 1 });
    const parcial = await executarResetEsteiras({ dataDir: dataDir3, operationId: "op-retoma", confirmOperationId: "op-retoma", maxLotes: 1 });
    assert.strictEqual(parcial.removidos, 1, "maxLotes permite interrupcao controlada");
    const final = await executarResetEsteiras({ dataDir: dataDir3, operationId: "op-retoma", confirmOperationId: "op-retoma" });
    assert.strictEqual(final.removidos, 2, "segunda rodada retoma lotes restantes sem forcar os ja removidos");
    assert.deepStrictEqual(lerFila(dataDir3, "ws1"), [], "todos os lotes elegiveis foram removidos apos retomada");
  }

  {
    limpar();
    const dataDir4 = path.join(tmpRoot, "caso-atomicidade");
    escreverFila(dataDir4, "ws1", [item("a1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" })]);
    await executarDryRunResetEsteiras({ dataDir: dataDir4, operationId: "op-atom", operationStartedAt: "2026-08-01T00:00:00.000Z" });
    await assert.rejects(
      () => executarResetEsteiras({ dataDir: dataDir4, operationId: "op-atom", confirmOperationId: "op-atom", falharAntesRename: true }),
      /falha_injetada_antes_rename/,
      "falha antes do rename deve abortar"
    );
    assert.deepStrictEqual(ids(lerFila(dataDir4, "ws1")), ["a1"], "arquivo original permanece apos falha antes do rename");
  }

  {
    limpar();
    const dataDir5 = path.join(tmpRoot, "caso-rollback");
    escreverFila(dataDir5, "ws1", [item("b1", { dataEntradaFila: "2026-07-31T20:00:00.000Z" })]);
    await executarDryRunResetEsteiras({ dataDir: dataDir5, operationId: "op-roll", operationStartedAt: "2026-08-01T00:00:00.000Z" });
    await executarResetEsteiras({ dataDir: dataDir5, operationId: "op-roll", confirmOperationId: "op-roll" });
    assert.deepStrictEqual(lerFila(dataDir5, "ws1"), [], "execute remove candidato");
    const rollback = await executarRollbackResetEsteiras({ dataDir: dataDir5, operationId: "op-roll", confirmOperationId: "op-roll" });
    assert.strictEqual(rollback.restaurados, 1, "rollback restaura removido");
    const rollback2 = await executarRollbackResetEsteiras({ dataDir: dataDir5, operationId: "op-roll", confirmOperationId: "op-roll" });
    assert.strictEqual(rollback2.pulados, 1, "rollback repetido nao duplica item");
    assert.deepStrictEqual(ids(lerFila(dataDir5, "ws1")), ["b1"], "rollback nao duplica");
  }

  {
    limpar();
    const dataDir6 = path.join(tmpRoot, "caso-colisao");
    escreverFila(dataDir6, "ws1", [
      { status: "pendente", titulo: "Sem id", dataEntradaFila: "2026-07-31T20:00:00.000Z", destinoId: "d1" },
      { status: "pendente", titulo: "Sem id", dataEntradaFila: "2026-07-31T20:00:00.000Z", destinoId: "d1" }
    ]);
    const resultado = await executarDryRunResetEsteiras({ dataDir: dataDir6, operationId: "op-col", operationStartedAt: "2026-08-01T00:00:00.000Z" });
    assert.strictEqual(resultado.totais.auditar, 2, "colisao de identidade composta deve ir para auditoria");
    assert.strictEqual(resultado.totais.expirar, 0, "identidade ambigua nao pode expirar automaticamente");
  }

  {
    const raiz = path.join(__dirname, "..");
    const bootFiles = [
      path.join(raiz, "index.js"),
      path.join(raiz, "modules", "engine", "index.js"),
      path.join(raiz, "modules", "engine", "ofc", "controller.runner.js")
    ];
    for (const file of bootFiles) {
      const fonte = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      assert(!fonte.includes("reset-esteiras"), `${file} nao deve acoplar o script ao boot`);
    }
  }

  writeJsonAtomic(path.join(tmpRoot, "atomic.json"), { ok: true });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(tmpRoot, "atomic.json"), "utf8")), { ok: true }, "writeJsonAtomic escreve via rename");

  limpar();
  console.log("engine-reset-esteiras.test.js OK");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
