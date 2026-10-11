"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const stages = [
  ["processor", require("../modules/engine/processor-fairness.service")],
  ["validator", require("../modules/engine/validator-fairness.service")],
  ["importer", require("../modules/engine/importer/importer-fairness.service")]
];

for (const [name, fairness] of stages) {
  test(`${name}: baseline head carries factual origin into slot and memory`, () => {
    const group = {
      baseline: [{ id: 1, indiceBaseline: 0, workspace_rank_pre_importer: 1 }],
      candidates: [
        { id: 1, origemFluxo: "optimus", origemFluxoHead: true,
          workspace_rank_pre_importer: 1 },
        { id: 2, origemFluxo: "clonador_grupos", origemFluxoHead: true,
          workspace_rank_pre_importer: 2 }
      ]
    };
    const first = fairness.montarSelecaoGrupo(group, "clonador_grupos");
    assert.equal(first.slots[0].job.id, 1);
    assert.equal(fairness.origemProtegida(first.slots[0].job), "optimus");
    const second = fairness.montarSelecaoGrupo(group, "optimus");
    assert.equal(second.slots[0].job.id, 2);
    assert.equal(fairness.origemProtegida(second.slots[0].job), "clonador_grupos");
  });
}
