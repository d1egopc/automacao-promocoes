"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Sources are unchanged by the clock fixture; no global Date replacement or database access.
function carregar(clock, raiz = path.join(__dirname, "..")) {
  const cache = new Map();
  const leituras = [];
  const proibido = () => { throw new Error("storage/database forbidden in temporal test"); };
  const stubs = {
    "utils/storage.js": { readGlobalJson: proibido, readClienteJson: proibido, getClienteJsonPath: proibido },
    "utils/usuarios-atividade.js": { listarClientesAtivos: proibido },
    "modules/engine/ofc/absorption-gate.repository.js": { consultarEventosAbsorcaoPorWorkspace: proibido },
    "modules/engine/ofc/drainage-metrics.repository.js": { consultarEntregasConfirmadas: proibido }
  };
  function ler(arquivo) {
    arquivo = path.resolve(arquivo);
    const relativo = path.relative(raiz, arquivo).replaceAll("\\", "/");
    if (stubs[relativo]) return stubs[relativo];
    if (cache.has(arquivo)) return cache.get(arquivo).exports;
    const module = { exports: {} }; cache.set(arquivo, module);
    const agora = tipo => { const valor = clock(); leituras.push({ arquivo: relativo, tipo, valor }); return valor; };
    class Relogio extends Date {
      constructor(...args) { super(...(args.length ? args : [agora("constructor")])); }
      static now() { return agora("now"); }
    }
    vm.runInNewContext(fs.readFileSync(arquivo, "utf8"), {
      module, exports: module.exports, Date: Relogio, Buffer, URL, process: { env: {} },
      console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
      require: nome => {
        if (nome.startsWith(".")) {
          let destino = path.resolve(path.dirname(arquivo), nome);
          if (!destino.endsWith(".js")) destino += ".js";
          if (!destino.startsWith(raiz + path.sep)) throw new Error("Dependency outside test root");
          return ler(destino);
        }
        if (["fs", "path", "crypto"].includes(nome) || nome.startsWith("node:")) return require(nome);
        throw new Error("Unexpected dependency: " + nome);
      }
    }, { filename: arquivo });
    return module.exports;
  }
  return { ofc: ler(path.join(raiz, "modules/engine/ofc/absorption-gate.service.js")),
    destinos: ler(path.join(raiz, "utils/destinos.js")),
    buffer: ler(path.join(raiz, "modules/engine/ofc/buffer-vivo-workspace.service.js")), leituras };
}

const instante = Date.parse("2026-09-26T15:00:00Z");
const destino = Object.freeze({ id: "destino", ativo: true, tipo: "telegram", botToken: "test", chatId: "test",
  horarioInicio: "00:00", horarioFim: "23:59", intervaloMinutos: 3 });
function item(agora, idade, extra = {}) {
  const data = new Date(agora - idade).toISOString();
  return { id: "oferta", status: "pendente", criadoEm: data, dataEntradaFila: data,
    destinoId: destino.id, marketplace: "mercadolivre", ...extra };
}
function opcoes(clock, destinos = [destino], fila = []) {
  return { clock, usuarios: [{ id: "workspace", creditos: 100 }], listarClientesAtivos: () => ["workspace"],
    destinosPorCliente: { workspace: destinos }, configsPorCliente: { workspace: { automacaoAtiva: true } },
    configPadrao: {}, consultarEventosAbsorcao: async () => ({ ok: true, porWorkspace: [] }),
    getClienteJsonPath: () => "injected-fixture.json", readFileSync: () => JSON.stringify(fila) };
}
const normalizar = value => JSON.parse(JSON.stringify(value)); // Only cross-realm prototypes; no fields omitted.

for (const timezone of ["UTC", "America/Sao_Paulo"]) {
  function caso(nome, fn) {
    test(timezone + ": " + nome, async () => {
      const anterior = process.env.TZ;
      try { process.env.TZ = timezone; await fn(); }
      finally { if (anterior === undefined) delete process.env.TZ; else process.env.TZ = anterior; }
    });
  }
  for (const ttl of [600000, 1800000]) for (const delta of [-1, 0, 1]) {
    caso("TTL " + ttl + " offset " + delta, async () => {
      let tempo = instante;
      const lab = carregar(() => tempo);
      const fila = [item(instante, ttl + delta, { cupomTurbo: ttl === 600000 })];
      const config = opcoes(() => tempo, [destino], fila);
      config.readFileSync = () => { tempo += 2; return JSON.stringify(fila); };
      const r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
      assert.equal(r.ok, true);
      const w = r.workspaces[0];
      assert.equal(w.queueDepthActionable, delta < 0 ? 1 : 0);
      // Existing workspace buffer is common-flow (30 min), even for a Turbo item.
      // Preserve that policy difference; this patch only unifies the instant.
      assert.equal(w.bufferVivoShadow.bufferAtualUtil, ttl === 600000 ? 1 : (delta < 0 ? 1 : 0));
      if (ttl === 600000) {
        const turbo = lab.buffer.calcularBufferVivoWorkspace({ workspaceId: "workspace", agoraMs: instante,
          tipoFluxo: "cupom_turbo", filaItens: fila, destinosResumo: { capacidadePorDestino: w.capacidadePorDestino } });
        assert.equal(turbo.bufferAtualUtil, delta < 0 ? 1 : 0);
      }
      assert.equal(w.oldestActionableAge, delta < 0 ? ttl + delta : 0);
      assert.equal(r.collectedAtMs, instante + 2, "collection clock must advance independently");
      assert.equal(r.duracaoMs, 2);
    });
  }
  const fronteiras = [
    ["before open", "2026-09-26T14:59:59.999Z", false],
    ["open", "2026-09-26T15:00:00Z", true],
    ["after open", "2026-09-26T15:00:00.001Z", true],
    ["closing minute starts", "2026-09-26T15:01:00Z", true],
    ["closing minute ends", "2026-09-26T15:01:59.999Z", true],
    ["next minute closes", "2026-09-26T15:02:00Z", false]
  ];
  for (const [nome, iso, aberta] of fronteiras) caso(nome, async () => {
    const inicio = Date.parse(iso); let tempo = inicio;
    const d = { ...destino, horarioInicio: "12:00", horarioFim: "12:01", timezone: "Asia/Tokyo" };
    const lab = carregar(() => tempo), config = opcoes(() => tempo, [d]);
    config.readFileSync = () => { tempo += 60001; return "[]"; };
    const r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
    assert.equal(r.workspaces[0].capacidadePorDestino[0].janelaAbertaAgora, aberta);
    assert.equal(r.workspaces[0].bufferVivoShadow.capacidadePorDestino[0].janelaAbertaAgora, aberta);
    assert.equal(lab.destinos.destinoDentroHorario(d, inicio), aberta);
  });
  for (const [iso, inicio, fim, aberta] of [
    ["2026-09-27T02:59:59.999Z", "23:00", "23:59", true],
    ["2026-09-27T03:00:00Z", "23:00", "23:59", false],
    ["2026-09-27T03:00:00Z", "23:00", "01:00", true]
  ]) caso("day boundary " + iso + " end " + fim, async () => {
    const agora = Date.parse(iso), lab = carregar(() => agora);
    const r = await lab.ofc.criarGateAbsorcaoShadowOfc(opcoes(() => agora,
      [{ ...destino, horarioInicio: inicio, horarioFim: fim }]));
    assert.equal(r.workspaces[0].capacidadePorDestino[0].janelaAbertaAgora, aberta);
  });
}

test("BEFORE hybrid summary/buffer versus AFTER single workspace instant", async () => {
  let tempo = instante;
  const lab = carregar(() => tempo), itens = [item(instante, 1799999)];
  const fila = lab.ofc.resumoFilaWorkspace("workspace", { filaItens: itens, agoraMs: instante, janelaAbertaAgora: true });
  tempo += 2;
  const legado = lab.ofc.montarGateWorkspace({ clienteId: "workspace", usuario: { creditos: 100 },
    configExecutor: { automacaoAtiva: true }, destinos: [destino], fila });
  assert.equal(legado.queueDepthActionable, 1);
  assert.equal(legado.bufferVivoShadow.bufferAtualUtil, 0);
  tempo = instante;
  const config = opcoes(() => tempo, [destino], itens);
  config.readFileSync = () => { tempo += 2; return JSON.stringify(itens); };
  const r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
  assert.equal(r.workspaces[0].queueDepthActionable, 1);
  assert.equal(r.workspaces[0].bufferVivoShadow.bufferAtualUtil, 1);
});

test("exactly one classification capture; real collection/performance clocks remain live", async () => {
  let tempo = instante, perf = 10;
  const lab = carregar(() => tempo), readings = [];
  const config = opcoes(() => tempo, [destino], [item(instante, 60000)]);
  config.medidorCiclo = { clock: () => perf, registrarLeitura: leitura => readings.push(leitura) };
  config.readFileSync = () => { tempo += 3000; perf += 2500; return JSON.stringify([item(instante, 60000)]); };
  const r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
  assert.equal(lab.leituras.length, 1, JSON.stringify(lab.leituras));
  assert.equal(lab.leituras[0].valor, instante);
  assert.equal(r.collectedAtMs, instante + 3000);
  assert.equal(r.workspaces[0].fonteFilaColetadaEmMs, instante + 3000);
  assert.equal(r.duracaoMs, 3000);
  assert.equal(readings[0].leituraMs, 2500);
  assert.equal(r.workspaces[0].oldestActionableAge, 60000);
  assert.equal(r.workspaces[0].bufferVivoShadow.itensBufferUtil[0].idadeMs, 60000);
});

test("each workspace captures its own entry time, not global gate start", async () => {
  let tempo = instante;
  const lab = carregar(() => tempo), config = opcoes(() => tempo);
  config.listarClientesAtivos = () => ["workspace", "second"];
  config.usuarios.push({ id: "second", creditos: 100 });
  config.destinosPorCliente.second = [destino]; config.configsPorCliente.second = { automacaoAtiva: true };
  config.readFileSync = () => { tempo += 2; return JSON.stringify([item(instante, 60000)]); };
  const r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
  assert.equal(r.workspaces[0].oldestActionableAge, 60000);
  assert.equal(r.workspaces[1].oldestActionableAge, 60002);
  assert.deepEqual(lab.leituras.map(x => x.valor), [instante, instante + 2]);
  assert.equal(r.finalizacoesComerciaisObservadas.observadoEmMs, instante);
  assert.equal(r.collectedAtMs, instante + 4);
});

for (const [nome, lerArquivo, motivo] of [
  ["missing", () => { const erro = new Error("absent"); erro.code = "ENOENT"; throw erro; }, "fila_ausente"],
  ["invalid JSON", () => "{broken", "fila_json_corrompido"],
  ["non-array", () => "{}", "fila_formato_invalido"]
]) test(nome + " preserves fail-safe and current collection time", async () => {
  let tempo = instante;
  const lab = carregar(() => tempo), config = opcoes(() => tempo);
  config.readFileSync = () => { tempo += 2; return lerArquivo(); };
  const r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
  assert.equal(r.ok, true); assert.equal(r.snapshotCompleto, false);
  assert.equal(r.workspaces[0].fonteFilaMotivo, motivo);
  assert.equal(r.collectedAtMs, instante + 2);
  assert.equal(r.workspaces[0].queueDepthActionable, 0);
});

test("helpers without agoraMs retain live defaults; explicit clock needs no live read", () => {
  let tempo = instante;
  const lab = carregar(() => tempo), d = { ...destino, horarioInicio: "12:00", horarioFim: "12:01" };
  assert.equal(lab.destinos.destinoDentroHorario(d), true);
  tempo += 120000;
  assert.equal(lab.destinos.destinoDentroHorario(d), false);
  assert.equal(lab.destinos.destinoDentroHorario(d, instante), true);
  lab.leituras.length = 0;
  lab.buffer.calcularBufferVivoWorkspace({ agoraMs: instante, filaItens: [] });
  assert.equal(lab.leituras.length, 0);
  lab.buffer.calcularBufferVivoWorkspace({ filaItens: [] });
  assert.equal(lab.leituras.length, 1);
});

test("explicit reference remains supported and offer contracts are not mutated", async () => {
  const lab = carregar(() => instante + 5000);
  const original = Object.freeze(item(instante, 60000, { titulo: "Official", preco: 12, precoAnterior: 15,
    cupom: "REAL", imagem: "https://official.invalid/image", linkOriginal: "https://product.invalid",
    linkAfiliado: "https://affiliate.invalid", metadata: Object.freeze({ media: "image" }) }));
  const config = opcoes(() => instante + 5000);
  config.agoraMs = instante;
  config.readFilaSnapshot = () => ({ ok: true, itens: [original], collectedAtMs: instante + 5000 });
  const before = JSON.stringify(original), r = await lab.ofc.criarGateAbsorcaoShadowOfc(config);
  assert.equal(r.workspaces[0].oldestActionableAge, 60000);
  assert.equal(r.workspaces[0].bufferVivoShadow.itensBufferUtil[0].idadeMs, 60000);
  assert.equal(JSON.stringify(original), before);
  assert.equal(r.modo, "shadow"); assert.equal(r.aplicouMudancas, false);
});

test("deepEqual legacy and explicit helpers away from boundaries", () => {
  const lab = carregar(() => instante), itens = [item(instante, 60000), item(instante, 3600000, { id: "old" })];
  const fila = lab.ofc.resumoFilaWorkspace("workspace", { filaItens: itens, agoraMs: instante, janelaAbertaAgora: true });
  const entrada = { clienteId: "workspace", usuario: { creditos: 100 }, configExecutor: { automacaoAtiva: true }, destinos: [destino], fila };
  assert.deepEqual(normalizar(lab.ofc.montarGateWorkspace(entrada)),
    normalizar(lab.ofc.montarGateWorkspace({ ...entrada, agoraMs: instante })));
});

// Optional audited baseline run uses the actual prior checkout, never manufactured expected values.
if (process.env.OFC_TEMPORAL_BASELINE_ROOT) {
  test("actual pre-patch Gate diverges at late buffer clock; patched Gate does not", async () => {
    const baselineRoot = path.resolve(process.env.OFC_TEMPORAL_BASELINE_ROOT);
    let chamadasAntes = 0, chamadasDepois = 0;
    const antes = carregar(() => instante + (++chamadasAntes >= 6 ? 2 : 0), baselineRoot);
    const depois = carregar(() => instante + (++chamadasDepois >= 6 ? 2 : 0));
    const fila = [item(instante, 1799999)];
    const legado = await antes.ofc.criarGateAbsorcaoShadowOfc(opcoes(() => instante, [destino], fila));
    const atual = await depois.ofc.criarGateAbsorcaoShadowOfc(opcoes(() => instante, [destino], fila));
    assert.equal(legado.workspaces[0].queueDepthActionable, 1);
    assert.equal(legado.workspaces[0].bufferVivoShadow.bufferAtualUtil, 0);
    assert.equal(atual.workspaces[0].queueDepthActionable, 1);
    assert.equal(atual.workspaces[0].bufferVivoShadow.bufferAtualUtil, 1);
    assert.equal(chamadasDepois, 1);
  });
  test("full Gate deepEqual against pre-patch sources outside boundaries", async () => {
    const baselineRoot = path.resolve(process.env.OFC_TEMPORAL_BASELINE_ROOT);
    for (const fila of [[], [item(instante, 60000)], [item(instante, 3600000)],
      [item(instante, 60000, { status: "enviado", enviadoEm: new Date(instante - 1000).toISOString() })]]) {
      const antes = carregar(() => instante, baselineRoot), depois = carregar(() => instante);
      assert.deepEqual(normalizar(await depois.ofc.criarGateAbsorcaoShadowOfc(opcoes(() => instante, [destino], fila))),
        normalizar(await antes.ofc.criarGateAbsorcaoShadowOfc(opcoes(() => instante, [destino], fila))));
    }
  });
}
