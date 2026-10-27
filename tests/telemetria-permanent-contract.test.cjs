"use strict";

// Release/CI contract only: no credentials, production requests, database or motor imports.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { testMatrix } = require("../scripts/guardian-v1.cjs");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requiredTests = [
  "tests/telemetria-permanent-contract.test.cjs",
  "tests/telemetria-operacional.test.cjs",
  "tests/telemetria-prepared-input.test.cjs",
];

function checkPolicy(agents) {
  const section = agents.match(
    /^## Telemetria Primeiro[^\r\n]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m,
  )?.[1];
  assert.ok(section, "AGENTS.md must retain the Telemetria Primeiro section");
  for (const [reason, expression] of [
    [
      "telemetry must precede investigation",
      /Antes de investigar defeitos[\s\S]*consultar primeiro a Telemetria Operacional/,
    ],
    ["proactive reminder", /Lembrar proativamente/],
    [
      "temporary owner authorization",
      /Solicitar autorização temporária `tel_` ao proprietário/,
    ],
    [
      "read-only scope, expiration and revocation",
      /read-only[\s\S]*escopo, expiração e revogação/,
    ],
    ["first proven failure", /primeira etapa com falha comprovada/],
    [
      "absence is not proof",
      /ausência de registro[\s\S]*sem cobertura não há prova/,
    ],
    [
      "instrumentation requires a concrete gap",
      /instrumentação adicional somente[\s\S]*lacuna concreta/,
    ],
    [
      "no productive actions with read-only grant",
      /Não executar ações produtivas com a autorização read-only/,
    ],
    [
      "permanent contract link",
      /docs\/contracts\/TELEMETRIA-OPERACIONAL\.md#telemetria-primeiro--contrato-permanente/,
    ],
  ])
    assert.match(section, expression, reason);
}

function checkOfficialCi(workflow) {
  // Require the real, unconditional critical-test step, not a commented command or deploy step.
  const block = workflow.match(
    /^      - name: Critical tests\r?\n        run: \|\r?\n((?:          [^\r\n]*(?:\r?\n|$))*)/m,
  )?.[1];
  assert.ok(block, "official main CI must retain unconditional critical tests");
  const tests = new Set(
    block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("node --test "))
      .flatMap((line) => line.split(/\s+/).slice(2)),
  );
  for (const file of requiredTests)
    assert.ok(tests.has(file), `official main CI must run ${file}`);
}

test("Telemetria Primeiro remains mandatory and links to the existing permanent contract", () => {
  checkPolicy(read("AGENTS.md"));
  assert.match(
    read("docs/contracts/TELEMETRIA-OPERACIONAL.md"),
    /^## Telemetria Primeiro — contrato permanente$/m,
  );
});

test("Guardian always selects existing read-only authorization tests and cannot classify failures as baseline debt", () => {
  for (const plan of [
    { runtimeFiles: [], ignoredFiles: [] },
    { runtimeFiles: [], ignoredFiles: ["AGENTS.md"] },
    { runtimeFiles: ["index.js"], ignoredFiles: [] },
    { runtimeFiles: ["modules/telemetria/codex-client.cjs"], ignoredFiles: [] },
  ]) {
    const matrix = testMatrix(plan);
    for (const [id, file] of [
      ["telemetria:contrato-permanente", requiredTests[0]],
      ["telemetria:autorizacao-readonly", requiredTests[1]],
    ]) {
      const spec = matrix.find((item) => item.id === id);
      assert.ok(spec, id);
      assert.equal(spec.command, process.execPath);
      assert.equal(
        spec.compareBaseline,
        false,
        "security contract failures must fail, never BASELINE_DEBT",
      );
      assert.equal(spec.args[0], "--test");
      assert.ok(spec.args.includes(file));
      assert.equal(matrix.filter((item) => item.id === id).length, 1);
    }
    assert.ok(
      matrix
        .find((item) => item.id === "telemetria:autorizacao-readonly")
        .args.includes(requiredTests[2]),
    );
  }
});

test("official main CI retains the focal contract and approved authorization/isolation/expiry/revocation tests", () => {
  checkOfficialCi(read(".github/workflows/deploy-backend-vps.yml"));
  for (const file of requiredTests)
    assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
});

test("policy gate rejects removing telemetry-first, authorization, scope or evidence safeguards", () => {
  const agents = read("AGENTS.md");
  for (const removed of [
    "## Telemetria Primeiro",
    "consultar primeiro a Telemetria Operacional",
    "Solicitar autorização temporária `tel_` ao proprietário",
    "escopo, expiração e revogação",
    "ausência de registro",
    "lacuna concreta",
    "Não executar ações produtivas com a autorização read-only",
  ])
    assert.throws(
      () => checkPolicy(agents.replace(removed, "REMOVED")),
      /AssertionError/,
    );
});

test("CI gate rejects missing or commented tests and conditional critical-test execution", () => {
  const workflow = read(".github/workflows/deploy-backend-vps.yml");
  for (const file of requiredTests) {
    assert.throws(
      () => checkOfficialCi(workflow.replace(file, "")),
      /AssertionError/,
    );
  }
  assert.throws(
    () =>
      checkOfficialCi(
        workflow.replace("          node --test", "          # node --test"),
      ),
    /AssertionError/,
  );
  assert.throws(
    () =>
      checkOfficialCi(
        workflow.replace(
          /      - name: Critical tests\r?\n/,
          "      - name: Critical tests\n        if: false\n",
        ),
      ),
    /AssertionError/,
  );
});
