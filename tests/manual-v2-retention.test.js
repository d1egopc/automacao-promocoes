const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-manual-v2-retention-"));

const {
  readClienteJson,
  writeClienteJson
} = require("../utils/storage");
const {
  ARQUIVO_OFERTAS_MANUAL_V2
} = require("../modules/manual-v2/manual-offers.storage");
const {
  resolverRetencaoDiasManualV2,
  ofertaElegivelRetencaoManualV2,
  limparRetencaoManualV2Cliente
} = require("../modules/manual-v2/manual-retention");

const NOW = "2026-08-15T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function diasAtras(dias) {
  return new Date(Date.parse(NOW) - dias * DAY_MS).toISOString();
}

function oferta(id, status, extras = {}) {
  return {
    id,
    clienteId: extras.clienteId || "cliente_a",
    marketplace: "amazon",
    titulo: id,
    status,
    criadoEm: extras.criadoEm || diasAtras(20),
    atualizadoEm: extras.atualizadoEm || diasAtras(20),
    ...extras
  };
}

function ids(clienteId) {
  return readClienteJson(clienteId, ARQUIVO_OFERTAS_MANUAL_V2, [])
    .map((item) => item.id)
    .sort();
}

{
  assert.strictEqual(resolverRetencaoDiasManualV2(undefined), 7);
  assert.strictEqual(resolverRetencaoDiasManualV2("0"), 7, "retencao zero nao pode apagar imediatamente");
  assert.strictEqual(resolverRetencaoDiasManualV2("-2"), 7);
  assert.strictEqual(resolverRetencaoDiasManualV2("abc"), 7);
  assert.strictEqual(resolverRetencaoDiasManualV2("99999"), 7);
  assert.strictEqual(resolverRetencaoDiasManualV2("10"), 10);
}

{
  const recenteComRetencaoInvalida = oferta("enviada_1_dia", "enviada", {
    enviadoEm: diasAtras(1)
  });
  assert.strictEqual(
    ofertaElegivelRetencaoManualV2(recenteComRetencaoInvalida, { now: NOW, retentionDays: 0 }).elegivel,
    false,
    "retencao invalida deve cair no default conservador"
  );
}

writeClienteJson("cliente_a", ARQUIVO_OFERTAS_MANUAL_V2, [
  oferta("enviada_8_dias", "enviada", {
    enviadoEm: diasAtras(8)
  }),
  oferta("enviada_6_dias", "enviada", {
    enviadoEm: diasAtras(6)
  }),
  oferta("erro_envio_8_dias", "erro", {
    envioManual: {
      concluidoEm: diasAtras(8)
    }
  }),
  oferta("erro_agendamento_8_dias", "erro", {
    agendamentoAtualizadoEm: diasAtras(8),
    atualizadoEm: diasAtras(2)
  }),
  oferta("erro_atualizado_8_dias", "erro", {
    atualizadoEm: diasAtras(8)
  }),
  oferta("erro_timestamp_invalido", "erro", {
    envioManual: {
      concluidoEm: "nao-e-data"
    },
    agendamentoAtualizadoEm: "tambem-invalido",
    atualizadoEm: "invalido"
  }),
  oferta("salva_antiga", "salva", {
    atualizadoEm: diasAtras(40)
  }),
  oferta("agendada_antiga", "agendada", {
    agendadoPara: diasAtras(30),
    agendamentoAtualizadoEm: diasAtras(30)
  }),
  oferta("enviando_antiga", "enviando", {
    atualizadoEm: diasAtras(30)
  }),
  oferta("cancelada_voltou_salva", "salva", {
    agendamentoCanceladoEm: diasAtras(30),
    atualizadoEm: diasAtras(30)
  }),
  oferta("reprogramada_agendada", "agendada", {
    agendamentoCriadoEm: diasAtras(30),
    agendamentoAtualizadoEm: diasAtras(8),
    agendadoPara: new Date(Date.parse(NOW) + DAY_MS).toISOString()
  })
]);

writeClienteJson("cliente_b", ARQUIVO_OFERTAS_MANUAL_V2, [
  oferta("cliente_b_enviada_antiga", "enviada", {
    clienteId: "cliente_b",
    enviadoEm: diasAtras(30)
  })
]);

{
  const resultado = limparRetencaoManualV2Cliente("cliente_a", { now: NOW });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.clienteId, "cliente_a");
  assert.strictEqual(resultado.removidos, 4);
  assert.strictEqual(resultado.preservados, 7);
  assert.deepStrictEqual(resultado.porStatus, {
    enviada: 1,
    erro: 3
  });

  assert.deepStrictEqual(ids("cliente_a"), [
    "agendada_antiga",
    "cancelada_voltou_salva",
    "enviada_6_dias",
    "enviando_antiga",
    "erro_timestamp_invalido",
    "reprogramada_agendada",
    "salva_antiga"
  ].sort());

  assert.deepStrictEqual(ids("cliente_b"), ["cliente_b_enviada_antiga"], "limpeza de A nao toca cliente B");
}

{
  const segunda = limparRetencaoManualV2Cliente("cliente_a", { now: NOW });
  assert.strictEqual(segunda.removidos, 0, "segunda execucao deve ser idempotente");
  assert.strictEqual(segunda.preservados, 7);
  assert.deepStrictEqual(ids("cliente_a"), [
    "agendada_antiga",
    "cancelada_voltou_salva",
    "enviada_6_dias",
    "enviando_antiga",
    "erro_timestamp_invalido",
    "reprogramada_agendada",
    "salva_antiga"
  ].sort());
}

{
  let escreveu = 0;
  const resultado = limparRetencaoManualV2Cliente("cliente_sem_mudanca", { now: NOW }, {
    normalizarClienteId: (id) => id,
    readClienteJson: () => [
      oferta("salva_preservada", "salva", {
        clienteId: "cliente_sem_mudanca",
        atualizadoEm: diasAtras(60)
      }),
      oferta("enviada_recente", "enviada", {
        clienteId: "cliente_sem_mudanca",
        enviadoEm: diasAtras(2)
      })
    ],
    writeClienteJson: () => {
      escreveu += 1;
    }
  });

  assert.strictEqual(resultado.removidos, 0);
  assert.strictEqual(resultado.preservados, 2);
  assert.strictEqual(escreveu, 0, "nao deve escrever quando nada mudou");
}

{
  const fonte = fs.readFileSync(
    path.join(__dirname, "..", "modules", "manual-v2", "manual-retention.js"),
    "utf8"
  );
  const proibidos = [
    "utils/fila-ofertas",
    "processarFila",
    "prepararOfertaGlobal",
    "adicionarOfertaInicioFila",
    "enviarOfertaManualV2",
    "manual-dispatcher",
    "manual-scheduler",
    "Distributor",
    "Oferta Universal",
    "oferta-universal",
    "Engine",
    "Radar",
    "radar-ofertas",
    "fila.json",
    "/fila",
    "/enviar-manual"
  ];

  for (const termo of proibidos) {
    assert.ok(!fonte.includes(termo), `Manual V2 retention nao pode referenciar ${termo}`);
  }
}

console.log("manual-v2-retention.test.js ok");
