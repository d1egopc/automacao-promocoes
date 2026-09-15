const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const filaOfertas = require("../utils/fila-ofertas");
const { criarFilaStore } = require("../modules/fila/fila-store");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fila-terminal-guard-"));
}

function salvarEmMemoria(registros = []) {
  const writes = [];
  return {
    writes,
    writeClienteJson: (_clienteId, arquivo, dados) => {
      assert.strictEqual(arquivo, "fila.json");
      writes.push(JSON.parse(JSON.stringify(dados)));
    }
  };
}

function itemBase(id = "oferta_guard") {
  return {
    id,
    clienteId: "cliente_guard",
    titulo: "Produto teste",
    preco: 100,
    status: "processando",
    statusDetalhe: "Processando envio",
    processandoEm: "2026-09-15T01:00:00.000Z",
    metadata: { pesado: "x".repeat(2048) },
    radarMirror: { pesado: "y".repeat(2048) },
    ofertaUniversal: { pesado: "z".repeat(2048) }
  };
}

function salvarFilaMemoria(fila, opcoes = {}) {
  const memoria = salvarEmMemoria();
  const ok = filaOfertas.salvarFila({
    fila,
    clienteId: "cliente_guard",
    writeClienteJson: memoria.writeClienteJson,
    ...opcoes
  });
  assert.strictEqual(ok, true);
  return memoria.writes[memoria.writes.length - 1];
}

filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_guard");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_expirada");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_erro");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_retida");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_novo_terminal");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_distributor");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_falha_save");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_bootstrap");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_immutavel");
filaOfertas.invalidarTerminalGuardFila("cliente_guard", "oferta_clear_processando");

{
  const logsCompletos = Array.from({ length: 25 }, (_, indice) => ({
    tipo: "sucesso",
    mensagem: `log-${indice}`,
    data: `2026-09-15T01:${String(indice).padStart(2, "0")}:00.000Z`
  }));
  const enviado = {
    ...itemBase("oferta_guard"),
    status: "enviado",
    statusDetalhe: "Enviada para 2 destino(s)",
    processandoEm: "",
    enviadoEm: "2026-09-15T01:10:00.000Z",
    dataEnvio: "2026-09-15T01:10:00.000Z",
    finalizadoEm: "2026-09-15T01:10:01.000Z",
    logsEnvio: logsCompletos,
    destinosEstado: [{ chave: "whatsapp:g1", estado: "enviado", enviado: true, tentativa: 2 }],
    destinosEnviados: [{ destinoId: "g1", canal: "whatsapp", enviadoEm: "2026-09-15T01:10:00.000Z", messageId: "m1" }],
    progresso: { enviados: 1, total: 2, pendentes: 1, erros: 0 }
  };
  assert.strictEqual(filaOfertas.salvarFila({
    fila: [enviado],
    clienteId: "cliente_guard",
    writeClienteJson: salvarEmMemoria().writeClienteJson
  }), true);

  const stale = itemBase("oferta_guard");
  const filaGlobal = [stale];
  const store = criarFilaStore(filaGlobal);
  const salvo = salvarFilaMemoria([stale]);
  store.rebuildCliente(filaGlobal, "cliente_guard");
  assert.strictEqual(salvo[0].status, "enviado");
  assert.strictEqual(salvo[0].enviadoEm, "2026-09-15T01:10:00.000Z");
  assert.strictEqual(salvo[0].finalizadoEm, "2026-09-15T01:10:01.000Z");
  assert.strictEqual(salvo[0].statusDetalhe, "Enviada para 2 destino(s)");
  assert.deepStrictEqual(salvo[0].logsEnvio, enviado.logsEnvio);
  assert.deepStrictEqual(salvo[0].destinosEstado, enviado.destinosEstado);
  assert.deepStrictEqual(salvo[0].destinosEnviados, enviado.destinosEnviados);
  assert.deepStrictEqual(salvo[0].progresso, enviado.progresso);
  assert.strictEqual(stale.status, "enviado");
  assert.strictEqual(stale.processandoEm, "");
  assert.strictEqual(salvo[0].processandoEm, "");
  assert.strictEqual(stale.logsEnvio.length, 25);
  assert.strictEqual(store.resolverPorId("cliente_guard", "oferta_guard").status, "enviado");
}

{
  const terminalSemProcessando = {
    id: "oferta_clear_processando",
    clienteId: "cliente_guard",
    status: "enviado",
    enviadoEm: "2026-09-15T01:20:00.000Z",
    statusDetalhe: "Enviada sem marcador transitorio"
  };
  salvarFilaMemoria([terminalSemProcessando]);
  const stale = {
    id: "oferta_clear_processando",
    clienteId: "cliente_guard",
    status: "processando",
    statusDetalhe: "Processando envio",
    processandoEm: "2026-09-15T01:00:00.000Z",
    proximaTentativaEnvioEm: "2026-09-15T01:30:00.000Z"
  };
  const salvo = salvarFilaMemoria([stale]);
  assert.strictEqual(salvo[0].status, "enviado");
  assert.strictEqual(salvo[0].enviadoEm, "2026-09-15T01:20:00.000Z");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(salvo[0], "processandoEm"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(salvo[0], "proximaTentativaEnvioEm"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stale, "processandoEm"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stale, "proximaTentativaEnvioEm"), false);
}

{
  const expirada = {
    ...itemBase("oferta_expirada"),
    status: "expirada_operacional",
    statusDetalhe: "Expirada pelo TTL operacional",
    expiradaEm: "2026-09-15T02:00:00.000Z"
  };
  salvarFilaMemoria([expirada]);
  const salvo = salvarFilaMemoria([{ ...itemBase("oferta_expirada"), status: "processando" }]);
  assert.strictEqual(salvo[0].status, "expirada_operacional");
  assert.strictEqual(salvo[0].expiradaEm, "2026-09-15T02:00:00.000Z");
}

{
  const erroRecuperavel = {
    ...itemBase("oferta_erro"),
    status: "erro",
    proximaTentativaEnvioEm: "2026-09-15T03:00:00.000Z",
    erroEm: "2026-09-15T02:30:00.000Z"
  };
  salvarFilaMemoria([erroRecuperavel]);
  const salvo = salvarFilaMemoria([{ ...itemBase("oferta_erro"), status: "processando" }]);
  assert.strictEqual(salvo[0].status, "processando");
  assert.strictEqual(salvo[0].erroEm || "", "");
}

{
  const retidaOperacional = {
    ...itemBase("oferta_retida"),
    status: "retida",
    motivoRetencao: "fora_horario",
    proximaTentativaEnvioEm: "2026-09-15T04:00:00.000Z",
    retidaEm: "2026-09-15T03:00:00.000Z"
  };
  salvarFilaMemoria([retidaOperacional]);
  const salvo = salvarFilaMemoria([{ ...itemBase("oferta_retida"), status: "processando" }]);
  assert.strictEqual(salvo[0].status, "processando");
  assert.strictEqual(salvo[0].retidaEm || "", "");
}

{
  const enviado = {
    ...itemBase("oferta_novo_terminal"),
    status: "enviado",
    enviadoEm: "2026-09-15T05:00:00.000Z"
  };
  const outroEnviado = {
    ...itemBase("oferta_guard"),
    status: "enviado",
    statusDetalhe: "Outro terminal protegido",
    enviadoEm: "2026-09-15T05:01:00.000Z"
  };
  salvarFilaMemoria([enviado]);
  salvarFilaMemoria([outroEnviado]);
  const reprocessado = { ...itemBase("oferta_novo_terminal"), status: "pendente", statusDetalhe: "Reprocessada manualmente" };
  const salvoReprocessado = salvarFilaMemoria([
    reprocessado,
    { ...itemBase("oferta_guard"), status: "processando" }
  ], {
    permitirRegressaoStatus: true,
    idRegressaoStatusPermitida: "oferta_novo_terminal"
  });
  assert.strictEqual(salvoReprocessado[0].status, "pendente");
  assert.strictEqual(salvoReprocessado[1].status, "enviado");
  assert.strictEqual(salvoReprocessado[1].statusDetalhe, "Outro terminal protegido");
  filaOfertas.invalidarTerminalGuardFila("cliente_guard", reprocessado);

  const novoTerminal = {
    ...reprocessado,
    status: "enviado",
    statusDetalhe: "Enviada novamente",
    enviadoEm: "2026-09-15T05:10:00.000Z"
  };
  salvarFilaMemoria([novoTerminal]);
  const stale = salvarFilaMemoria([{ ...itemBase("oferta_novo_terminal"), status: "processando" }]);
  assert.strictEqual(stale[0].status, "enviado");
  assert.strictEqual(stale[0].statusDetalhe, "Enviada novamente");
}

{
  const enviadoDistributor = {
    ...itemBase("oferta_distributor"),
    status: "enviado",
    enviadoEm: "2026-09-15T06:00:00.000Z"
  };
  salvarFilaMemoria([enviadoDistributor]);
  const dir = tmpDir();
  const oldDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const file = path.join(dir, "clientes", "cliente_guard", "fila.json");
    const ok = filaOfertas.salvarFila({
      fila: [{ ...itemBase("oferta_distributor"), status: "processando" }],
      clienteId: "cliente_guard",
      getFilaFile: clienteId => path.join(dir, "clientes", clienteId, "fila.json")
    });
    assert.strictEqual(ok, true);
    const salvo = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(salvo[0].status, "enviado");
    assert.strictEqual(salvo[0].enviadoEm, "2026-09-15T06:00:00.000Z");
  } finally {
    if (oldDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDataDir;
  }
}

{
  const falhaTerminal = {
    ...itemBase("oferta_falha_save"),
    status: "enviado",
    enviadoEm: "2026-09-15T07:00:00.000Z"
  };
  const ok = filaOfertas.salvarFila({
    fila: [falhaTerminal],
    clienteId: "cliente_guard",
    writeClienteJson: () => {
      throw new Error("falha_controlada");
    },
    logger: { error: () => {} }
  });
  assert.strictEqual(ok, false);
  const salvo = salvarFilaMemoria([{ ...itemBase("oferta_falha_save"), status: "processando" }]);
  assert.strictEqual(salvo[0].status, "processando");
}

{
  const terminalCarregado = {
    ...itemBase("oferta_bootstrap"),
    status: "enviado",
    enviadoEm: "2026-09-15T08:00:00.000Z"
  };
  filaOfertas.inicializarTerminalGuardFilaCliente("cliente_guard", [terminalCarregado]);
  const salvo = salvarFilaMemoria([{ ...itemBase("oferta_bootstrap"), status: "processando" }]);
  assert.strictEqual(salvo[0].status, "enviado");
  assert.strictEqual(salvo[0].enviadoEm, "2026-09-15T08:00:00.000Z");
}

{
  const original = {
    id: "oferta_immutavel",
    clienteId: "cliente_guard",
    status: "enviado",
    enviadoEm: "2026-09-15T09:00:00.000Z",
    logsEnvio: [{ tipo: "sucesso", mensagem: "original" }],
    metadata: { pesado: "terminal-pesado" },
    radarMirror: { pesado: "terminal-radar" },
    ofertaUniversal: { pesado: "terminal-universal" }
  };
  salvarFilaMemoria([original]);
  original.status = "processando";
  original.enviadoEm = "";
  original.logsEnvio[0].mensagem = "mutado";
  const salvo = salvarFilaMemoria([{ id: "oferta_immutavel", clienteId: "cliente_guard", status: "processando" }]);
  assert.strictEqual(salvo[0].status, "enviado");
  assert.strictEqual(salvo[0].enviadoEm, "2026-09-15T09:00:00.000Z");
  assert.strictEqual(salvo[0].logsEnvio[0].mensagem, "original");
  assert.strictEqual(salvo[0].metadata, undefined);
  assert.strictEqual(salvo[0].radarMirror, undefined);
  assert.strictEqual(salvo[0].ofertaUniversal, undefined);
  const guard = filaOfertas.snapshotTerminalGuardFila("cliente_guard");
  assert(guard.total >= 1);
}

console.log("fila-terminal-guard-legado.test.js OK");
