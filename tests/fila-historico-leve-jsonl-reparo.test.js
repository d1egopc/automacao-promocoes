"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  repararHistoricoLeveJsonl,
  HISTORICO_LEVE_INCREMENTAL_DIR,
  CONFLITO_ENGINE_32325
} = require("../scripts/reparar-historico-leve-jsonl-core");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fila-historico-leve-reparo-"));
}

function dirHistorico(root, cliente) {
  return path.join(root, "clientes", cliente, HISTORICO_LEVE_INCREMENTAL_DIR);
}

function fileHistorico(root, cliente, dia) {
  return path.join(dirHistorico(root, cliente), `${dia}.jsonl`);
}

function escreverJsonl(root, cliente, dia, registros) {
  const file = fileHistorico(root, cliente, dia);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${registros.map(registro => JSON.stringify(registro)).join("\n")}\n`, "utf8");
  return file;
}

function lerJsonl(root, cliente, dia) {
  const file = fileHistorico(root, cliente, dia);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(linha => JSON.parse(linha));
}

function registro({ chave, id, status = "enviado", publico = "enviado", origem = "fila-historico.json", enviadoEm = "2026-09-07T10:00:00.000Z", extraItem = {} }) {
  const terminal = status === "enviado"
    ? { enviadoEm, dataEnvio: enviadoEm, finalizadoEm: enviadoEm, progresso: { enviados: 1, total: 1, pendentes: 0, erros: 0 } }
    : status === "expirada_operacional"
      ? { expiradaEm: enviadoEm, finalizadoEm: enviadoEm, progresso: { enviados: 0, total: 0, pendentes: 0, erros: 0 } }
      : { erroEm: enviadoEm, finalizadoEm: enviadoEm, progresso: { enviados: 0, total: 1, pendentes: 0, erros: 1 } };
  return {
    versao: 1,
    tipo: "historico_leve_terminal",
    chave,
    clienteId: "cliente",
    id,
    statusPublico: publico,
    statusOperacional: status,
    registradoEm: enviadoEm,
    item: {
      id,
      clienteId: "cliente",
      status,
      detalheRef: { arquivo: origem, id },
      ...terminal,
      ...extraItem
    }
  };
}

function stats(registros) {
  const chaves = new Set(registros.map(item => item.chave));
  return { linhas: registros.length, chaves: chaves.size, duplicatas: registros.length - chaves.size };
}

{
  const root = tmpRoot();
  const cliente = "user_zbbk3fdr";
  const unicos = Array.from({ length: 178 }, (_, i) => registro({
    chave: `z_key_${String(i).padStart(3, "0")}`,
    id: `z_${i}`,
    origem: "fila-historico.json",
    enviadoEm: `2026-09-07T10:${String(i % 60).padStart(2, "0")}:00.000Z`
  }));
  const duplicados = unicos.slice(0, 173).map((item, i) => ({
    ...item,
    registradoEm: `2026-09-08T11:${String(i % 60).padStart(2, "0")}:00.000Z`,
    item: { ...item.item, detalheRef: { arquivo: "fila-historico.json", id: item.id } }
  }));
  escreverJsonl(root, cliente, "2026-09-07", unicos.slice(0, 100).concat(duplicados.slice(0, 80)));
  escreverJsonl(root, cliente, "2026-09-08", unicos.slice(100).concat(duplicados.slice(80)));

  const dry = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente] });
  assert.strictEqual(dry.ok, true);
  assert.strictEqual(dry.clientes[0].linhasAtuais, 351);
  assert.strictEqual(dry.clientes[0].chavesAtuais, 178);
  assert.strictEqual(dry.clientes[0].linhasRemover, 173);
  assert.strictEqual(dry.clientes[0].linhasFinais, 178);
  assert.strictEqual(dry.clientes[0].duplicatasFinais, 0);
}

{
  const root = tmpRoot();
  const cliente = "user_pss60lus";
  const backfill = registro({ chave: "hook_backfill_same", id: "same_1", origem: "fila-historico.json" });
  const hook = registro({ chave: "hook_backfill_same", id: "same_1", origem: "fila.json" });
  escreverJsonl(root, cliente, "2026-09-15", [backfill, hook]);

  const res = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], arquivos: ["2026-09-15"], apply: true, timestampBackup: "teste" });
  const final = lerJsonl(root, cliente, "2026-09-15");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(final.length, 1);
  assert.strictEqual(final[0].item.detalheRef.arquivo, "fila.json");
}

{
  const root = tmpRoot();
  const cliente = "user_pss60lus";
  const enviado = registro({
    chave: CONFLITO_ENGINE_32325.chave,
    id: CONFLITO_ENGINE_32325.id,
    status: "enviado",
    publico: "enviado",
    origem: "fila.json",
    enviadoEm: "2026-09-15T03:23:27.193Z"
  });
  const expirada = registro({
    chave: CONFLITO_ENGINE_32325.chave,
    id: CONFLITO_ENGINE_32325.id,
    status: "expirada_operacional",
    publico: "nao_enviado",
    origem: "fila.json",
    enviadoEm: "2026-09-15T03:39:16.495Z"
  });
  escreverJsonl(root, cliente, "2026-09-15", [enviado, expirada]);

  const res = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], arquivos: ["2026-09-15"], apply: true, timestampBackup: "engine" });
  const final = lerJsonl(root, cliente, "2026-09-15");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(final.length, 1);
  assert.strictEqual(final[0].statusOperacional, "enviado");
  assert.strictEqual(final[0].item.enviadoEm, "2026-09-15T03:23:27.193Z");
  assert.strictEqual(final[0].item.expiradaEm || "", "");
  assert.deepStrictEqual(final[0].item.progresso, { enviados: 1, total: 1, pendentes: 0, erros: 0 });
}

{
  const root = tmpRoot();
  const cliente = "user_pss60lus";
  const enviado = registro({ chave: "conflito_desconhecido", id: "unknown_1", status: "enviado", publico: "enviado" });
  const erro = registro({ chave: "conflito_desconhecido", id: "unknown_1", status: "erro_final", publico: "nao_enviado" });
  escreverJsonl(root, cliente, "2026-09-15", [enviado, erro]);

  const res = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], arquivos: ["2026-09-15"], apply: true, timestampBackup: "unknown" });
  const final = lerJsonl(root, cliente, "2026-09-15");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.clientes[0].conflitosPreservados, 1);
  assert.strictEqual(final.length, 2);
}

{
  const root = tmpRoot();
  const cliente = "user_zbbk3fdr";
  escreverJsonl(root, cliente, "2026-09-07", [
    registro({ chave: "idem_1", id: "idem_1" }),
    registro({ chave: "idem_1", id: "idem_1" })
  ]);
  escreverJsonl(root, cliente, "2026-09-08", []);

  const primeiro = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], apply: true, timestampBackup: "idem1" });
  const segundo = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], apply: true, timestampBackup: "idem2" });
  assert.strictEqual(primeiro.clientes[0].linhasRemover, 1);
  assert.strictEqual(segundo.clientes[0].linhasRemover, 0);
  assert.strictEqual(segundo.aplicacoes[0].aplicados.length, 0);
}

{
  const root = tmpRoot();
  const cliente = "user_zbbk3fdr";
  const file = fileHistorico(root, cliente, "2026-09-07");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{\"ok\":true}\n{malformado\n", "utf8");
  escreverJsonl(root, cliente, "2026-09-08", []);
  const antes = fs.readFileSync(file, "utf8");

  const res = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], apply: true, timestampBackup: "bad" });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.clientes[0].motivo, "jsonl_malformado");
  assert.strictEqual(fs.readFileSync(file, "utf8"), antes);
  assert.strictEqual(fs.existsSync(`${file}.bak.bad`), false);
}

{
  const root = tmpRoot();
  const cliente = "user_zbbk3fdr";
  const file = escreverJsonl(root, cliente, "2026-09-07", [
    registro({ chave: "backup_1", id: "backup_1" }),
    registro({ chave: "backup_1", id: "backup_1" })
  ]);
  escreverJsonl(root, cliente, "2026-09-08", []);
  const res = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente], apply: true, timestampBackup: "backup" });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(fs.existsSync(`${file}.bak.backup`), true);
  assert.strictEqual(fs.readdirSync(path.dirname(file)).some(nome => nome.includes(".tmp.")), false);
  assert.deepStrictEqual(stats(lerJsonl(root, cliente, "2026-09-07")), { linhas: 1, chaves: 1, duplicatas: 0 });
}

{
  const root = tmpRoot();
  const cliente = "user_zbbk3fdr";
  const file = escreverJsonl(root, cliente, "2026-09-07", [
    registro({ chave: "dry_1", id: "dry_1" }),
    registro({ chave: "dry_1", id: "dry_1" })
  ]);
  escreverJsonl(root, cliente, "2026-09-08", []);
  const antes = fs.readFileSync(file, "utf8");
  const res = repararHistoricoLeveJsonl({ dataDir: root, clientes: [cliente] });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(fs.readFileSync(file, "utf8"), antes);
  assert.strictEqual(fs.existsSync(`${file}.bak.dry`), false);
}

console.log("fila-historico-leve-jsonl-reparo.test.js OK");
