"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "uf-destination-fanout-"));
const { writeGlobalJson } = require("../utils/storage");
const { validarOfertaParaDistribuicao } = require("../modules/engine/distributor/distributor.service");

const workspace = "ws_fanout_a";
writeGlobalJson("usuarios.json", [{ id: workspace, ativo: true, plano: "pro" }]);

function destino(id, categorias) {
  return { id, nome: id, ativo: true, tipo: "telegram", botToken: "bot",
    chatId: "chat", marketplaces: ["mercadolivre"], categorias };
}

test("one Engine job keeps destination decisions independent", async () => {
  const eventId = 501;
  const jobId = 401;
  const offer = { id: 301, evento_id: eventId, job_id: jobId,
    cliente_id: workspace, origem: "radar", marketplace: "mercadolivre",
    categoria: "Celulares e Smartphones", titulo: "Oferta fixture",
    status: "importada", metadata: {} };
  const result = await validarOfertaParaDistribuicao(offer, {
    clientesValidos: [workspace],
    marketplacesAtivosPorCliente: { [workspace]: { mercadolivre: true } },
    destinosPorCliente: { [workspace]: [
      destino("A", ["Celulares e Smartphones"]),
      destino("B", ["Celulares e Smartphones"]),
      destino("C", ["Gamer e Hardware"])
    ] },
    validarCreditos: () => ({ ok: true })
  });
  assert.equal(result.ok, true);
  assert.equal(result.destinosTotal, 3);
  assert.equal(result.destinosCompativeis, 2);
  assert.deepEqual(result.__destinosCompativeisRaw.map(item => item.id), ["A", "B"]);
  assert.equal(offer.job_id, jobId);
  assert.equal(offer.evento_id, eventId);
});
