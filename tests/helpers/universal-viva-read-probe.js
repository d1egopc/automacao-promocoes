"use strict";

// Test-only preload for a spawned local index.js process. Counts the legacy
// VIVA file reads and legacy checkpoint starts after an explicit IPC reset.
const fs = require("node:fs");
const Module = require("node:module");

let filaJsonReads = 0;
let filaVivaReads = 0;
let vivaWrites = 0;
let legacyCheckpoints = 0;
const fileName = file => String(file || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
const trackRead = file => {
  const name = fileName(file);
  if (name === "fila.json") filaJsonReads += 1;
  if (name === "fila-viva.json") filaVivaReads += 1;
};
const trackWrite = file => {
  if (["fila.json", "fila-viva.json"].includes(fileName(file))) vivaWrites += 1;
};
for (const method of ["readFileSync", "readFile"]) {
  const original = fs[method];
  fs[method] = function trackedRead(file, ...args) {
    trackRead(file);
    return original.call(this, file, ...args);
  };
}
const originalPromisesRead = fs.promises.readFile;
fs.promises.readFile = function trackedPromisesRead(file, ...args) {
  trackRead(file);
  return originalPromisesRead.call(this, file, ...args);
};
for (const method of ["writeFileSync", "writeFile", "renameSync", "rename"]) {
  const original = fs[method];
  fs[method] = function trackedWrite(file, ...args) {
    trackWrite(method.startsWith("rename") ? args[0] : file);
    return original.call(this, file, ...args);
  };
}
for (const method of ["writeFile", "rename"]) {
  const original = fs.promises[method];
  fs.promises[method] = function trackedPromisesWrite(file, ...args) {
    trackWrite(method === "rename" ? args[0] : file);
    return original.call(this, file, ...args);
  };
}

const originalLoad = Module._load;
Module._load = function trackedModuleLoad(request, parent, isMain) {
  const exports = originalLoad.call(this, request, parent, isMain);
  if (process.env.UF_FIXTURE_AMAZON === "1" &&
      request === "./marketplaces/amazon" &&
      String(parent?.filename || "").replace(/\\/g, "/").endsWith("/index.js")) {
    return { ...exports, criarImportarAmazon: () => async url => ({
      titulo: "Amazon fixture product", precoAtual: 99.9,
      precoOriginal: 129.9, categoria: "Eletronicos",
      imagem: "https://example.invalid/fixture.jpg",
      linkOriginal: url, linkAfiliado: `${url}?tag=fixture-tag`
    }) };
  }
  if (!String(request).includes("/fila/fila-operacional-v2") ||
      typeof exports.criarControladorCheckpointLegadoV2 !== "function" ||
      exports.__universalProbeWrapped === true) return exports;
  const create = exports.criarControladorCheckpointLegadoV2;
  exports.criarControladorCheckpointLegadoV2 = function trackedCheckpoint(...args) {
    const controller = create(...args);
    const start = controller.iniciarCheckpoint;
    controller.iniciarCheckpoint = function trackedStart(...startArgs) {
      legacyCheckpoints += 1;
      return start.apply(this, startArgs);
    };
    return controller;
  };
  Object.defineProperty(exports, "__universalProbeWrapped", { value: true });
  return exports;
};

process.on("message", message => {
  if (message?.type === "uf-clone-seed") {
    (async () => {
      const { criarRepositorioClonadorGrupos } =
        require("../../modules/clonador-grupos/repository");
      const { solicitarCicloEntradaClonador } =
        require("../../modules/engine/orchestrator.runner");
      const repo = criarRepositorioClonadorGrupos();
      await repo.substituirDestinos(message.capture.clienteId,
        ["uf_dest_inactive_session"]);
      const inserted = await repo.inserirBufferCaptura(message.capture);
      const wake = solicitarCicloEntradaClonador({ motivo: "local_runtime_fixture" });
      process.send?.({ type: "uf-fixture", requestId: message.requestId,
        result: { bufferId: inserted.item?.id || null, wake } });
    })().catch(error => process.send?.({ type: "uf-fixture",
      requestId: message.requestId, error: String(error.message || error) }));
    return;
  }
  if (message?.type === "uf-teleradar-accept") {
    require("../../modules/teleradar/radar-ingress.adapter")
      .createRadarIngressAdapter().accept(message.envelope)
      .then(result => process.send?.({ type: "uf-fixture", requestId: message.requestId,
        result }))
      .catch(error => process.send?.({ type: "uf-fixture", requestId: message.requestId,
        error: String(error.message || error) }));
    return;
  }
  if (message?.type === "uf-probe-reset") {
    filaJsonReads = 0;
    filaVivaReads = 0;
    vivaWrites = 0;
    legacyCheckpoints = 0;
  }
  if (message?.type === "uf-probe-reset" ||
      message?.type === "uf-probe-snapshot") {
    process.send?.({ type: "uf-probe", requestId: message.requestId,
      reads: filaJsonReads + filaVivaReads, filaJsonReads, filaVivaReads,
      vivaWrites, legacyCheckpoints });
  }
});
