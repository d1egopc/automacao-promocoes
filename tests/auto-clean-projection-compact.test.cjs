"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "auto-clean-projection-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = root;
const { writeClienteJson, readClienteJson, getClienteJsonPath } = require("../utils/storage");
if (previousDataDir === undefined) delete process.env.DATA_DIR;
else process.env.DATA_DIR = previousDataDir;

test("only the light queue projection omits whitespace while preserving every value", () => {
  try {
    const workspace = "user_projection_fixture";
    const attributes = Object.fromEntries(Array.from({ length: 50 }, (_, j) => [`k${j}`, "v".repeat(10)]));
    const projection = {
      versao: 1,
      gcCoverage: { hashes: ["a".repeat(64)], checkpointRevision: "fixture" },
      itens: Array.from({ length: 1713 }, (_, id) => ({ id, payload: "x".repeat(1100), ...attributes }))
    };
    const expected = { ...projection, clienteId: workspace };
    assert.ok(Buffer.byteLength(JSON.stringify(expected, null, 2)) > 4 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(expected)) < 4 * 1024 * 1024);

    writeClienteJson(workspace, "fila-projecao-leve.json", projection);
    const projectionFile = getClienteJsonPath(workspace, "fila-projecao-leve.json");
    const content = fs.readFileSync(projectionFile, "utf8");
    assert.equal(content, JSON.stringify(expected));
    assert.ok(fs.statSync(projectionFile).size < 4 * 1024 * 1024);
    assert.deepEqual(readClienteJson(workspace, "fila-projecao-leve.json"), expected);

    writeClienteJson(workspace, "fila-historico.json", { itens: [{ id: 1 }] });
    const history = fs.readFileSync(getClienteJsonPath(workspace, "fila-historico.json"), "utf8");
    assert.equal(history, JSON.stringify({ itens: [{ id: 1 }], clienteId: workspace }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
