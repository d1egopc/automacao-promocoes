"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  calcularBufferVivoWorkspace,
  resumirDivergenciaBufferVivo,
  slotsCobertura
} = require("../modules/engine/ofc/buffer-vivo-workspace.service");

const agora = Date.parse("2026-08-19T13:00:00.000Z");

function destino(extra = {}) {
  return {
    destinoId: extra.destinoId || extra.id || "destino_geral",
    nome: extra.nome || extra.destinoId || extra.id || "Destino Geral",
    tipo: extra.tipo || "telegram",
    marketplace: extra.marketplace || "",
    categoria: extra.categoria || "",
    tipoMidia: extra.tipoMidia || "",
    aptoAgora: extra.aptoAgora !== false,
    janelaAbertaAgora: extra.janelaAbertaAgora !== false,
    integracaoApta: extra.integracaoApta !== false,
    intervaloEfetivo: extra.intervaloEfetivo || 5,
    slots5Min: extra.slots5Min ?? slotsCobertura(5, extra.intervaloEfetivo || 5),
    slots10Min: extra.slots10Min ?? slotsCobertura(10, extra.intervaloEfetivo || 5),
    slots15Min: extra.slots15Min ?? slotsCobertura(15, extra.intervaloEfetivo || 5),
    limiteDiarioRestante: extra.limiteDiarioRestante ?? 20,
    proximoHorarioPermitido: extra.proximoHorarioPermitido || null
  };
}

function itemFila(extra = {}) {
  return {
    id: extra.id || "fila_1",
    status: extra.status || "pendente",
    marketplace: extra.marketplace || "mercadolivre",
    categoria: extra.categoria || "hardware",
    destinoId: extra.destinoId || "ml_hardware",
    dataEntradaFila: extra.dataEntradaFila || new Date(agora - 2 * 60 * 1000).toISOString(),
    ...extra
  };
}

function calcular(extra = {}) {
  return calcularBufferVivoWorkspace({
    workspaceId: extra.workspaceId || "workspace_teste",
    ofertaId: extra.ofertaId || "oferta_1",
    marketplace: extra.marketplace || "mercadolivre",
    categoria: extra.categoria || "hardware",
    tipoMidia: extra.tipoMidia || "imagem",
    tipoFluxo: extra.tipoFluxo || "oferta_comum",
    destinosResumo: {
      capacidadePorDestino: extra.capacidadePorDestino || [
        destino({ destinoId: "ml_hardware", marketplace: "mercadolivre", categoria: "hardware" })
      ]
    },
    filaItens: extra.filaItens || [],
    flowAtual: extra.flowAtual,
    saudeAgregada: extra.saudeAgregada,
    agoraMs: agora
  });
}

function testarContratoDeSaida() {
  const buffer = calcular();
  for (const campo of [
    "workspaceId",
    "estado",
    "bufferAlvo",
    "bufferAtualUtil",
    "deficitBuffer",
    "slotsFuturosUtilizaveis",
    "capacidadePorOferta",
    "capacidadePorDestino",
    "pressaoPorDestino",
    "pressaoPorMarketplace",
    "pressaoPorCategoria",
    "motivo"
  ]) {
    assert(Object.prototype.hasOwnProperty.call(buffer, campo), `campo obrigatorio ausente: ${campo}`);
  }
  assert.strictEqual(buffer.aplicouMudancas, false);
  assert.strictEqual(buffer.estado, "ABAIXO_DO_ALVO");
  assert.strictEqual(buffer.bufferAlvo, 2);
  assert.strictEqual(buffer.deficitBuffer, 2);
}

function testarCapacidadeAgregadaDivergentePorBraco() {
  const buffer = calcular({
    ofertaId: "179909",
    capacidadePorDestino: [
      destino({ destinoId: "ml_hardware", marketplace: "mercadolivre", categoria: "hardware", slots10Min: 2 }),
      destino({ destinoId: "amazon_casa", marketplace: "amazon", categoria: "casa", slots10Min: 10 })
    ],
    filaItens: [
      itemFila({ id: "ml_1", destinoId: "ml_hardware" }),
      itemFila({ id: "ml_2", destinoId: "ml_hardware" })
    ],
    flowAtual: {
      aceitarAgora: false,
      motivo: "esteira_saturada",
      nivelAlvo: 12,
      bufferAtual: 2,
      vagasDisponiveis: 10
    },
    saudeAgregada: {
      capacidade: 10,
      pressaoEsteiraViva: 2,
      filaAlvo10Min: 12
    }
  });

  assert.strictEqual(buffer.workspaceId, "workspace_teste");
  assert.strictEqual(buffer.capacidadePorOferta.ofertaId, "179909");
  assert.strictEqual(buffer.bufferAlvo, 2);
  assert.strictEqual(buffer.bufferAtualUtil, 2);
  assert.strictEqual(buffer.deficitBuffer, 0);
  assert.strictEqual(buffer.capacidadePorOferta.aceitarPeloBufferVivo, false);
  assert.strictEqual(buffer.pressaoPorMarketplace.mercadolivre, 2);
  assert.strictEqual(buffer.pressaoPorMarketplace.amazon, undefined);

  const divergencia = resumirDivergenciaBufferVivo(buffer);
  assert.strictEqual(divergencia.divergente, true);
  assert(divergencia.divergencias.includes("nivel_alvo_flow_diferente_buffer_vivo"));
  assert(divergencia.divergencias.includes("capacidade_agregada_nao_utilizavel_para_oferta"));
}

function testarCasos179916E179917SemExcecaoPorWorkspace() {
  for (const ofertaId of ["179916", "179917"]) {
    const buffer = calcular({
      workspaceId: `workspace_${ofertaId}`,
      ofertaId,
      capacidadePorDestino: [
        destino({ destinoId: "ml_hw", marketplace: "mercadolivre", categoria: "hardware", slots10Min: 1 }),
        destino({ destinoId: "shopee_moda", marketplace: "shopee", categoria: "moda", slots10Min: 8 })
      ],
      filaItens: [
        itemFila({ id: `${ofertaId}_slot`, destinoId: "ml_hw" })
      ],
      saudeAgregada: { capacidade: 8 }
    });
    assert.strictEqual(buffer.capacidadePorOferta.ofertaId, ofertaId);
    assert.strictEqual(buffer.bufferAlvo, 1);
    assert.strictEqual(buffer.bufferAtualUtil, 1);
    assert.strictEqual(buffer.deficitBuffer, 0);
    assert.strictEqual(buffer.capacidadePorDestino.find(item => item.destinoId === "shopee_moda").bufferAtualDestino, 0);
  }
}

function testarMarketplaceECategoriaIsolamPressao() {
  const buffer = calcular({
    marketplace: "shopee",
    categoria: "moda",
    capacidadePorDestino: [
      destino({ destinoId: "ml_hardware", marketplace: "mercadolivre", categoria: "hardware", slots10Min: 2 }),
      destino({ destinoId: "shopee_moda", marketplace: "shopee", categoria: "moda", slots10Min: 2 })
    ],
    filaItens: [
      itemFila({ id: "ml_1", destinoId: "ml_hardware", marketplace: "mercadolivre", categoria: "hardware" }),
      itemFila({ id: "ml_2", destinoId: "ml_hardware", marketplace: "mercadolivre", categoria: "hardware" })
    ]
  });

  assert.strictEqual(buffer.bufferAlvo, 2);
  assert.strictEqual(buffer.bufferAtualUtil, 0);
  assert.strictEqual(buffer.deficitBuffer, 2);
  assert.strictEqual(buffer.estado, "ABAIXO_DO_ALVO");
  assert.strictEqual(buffer.pressaoPorMarketplace.mercadolivre, undefined);
  assert(buffer.itensIgnorados.some(item => item.motivo === "fora_braco_oferta"));
}

function testarExpiradoNaoContaComoBufferUtil() {
  const buffer = calcular({
    filaItens: [
      itemFila({ id: "vivo", dataEntradaFila: new Date(agora - 5 * 60 * 1000).toISOString() }),
      itemFila({ id: "velho", dataEntradaFila: new Date(agora - 31 * 60 * 1000).toISOString() }),
      itemFila({ id: "enviado", status: "enviado" })
    ]
  });

  assert.strictEqual(buffer.bufferAtualUtil, 1);
  assert.strictEqual(buffer.deficitBuffer, 1);
  assert(buffer.itensIgnorados.some(item => item.id === "velho" && item.motivo === "fora_frescor_buffer_vivo"));
  assert(buffer.itensIgnorados.some(item => item.id === "enviado" && item.motivo === "status_fora_buffer_vivo"));
}

function testarSimulacaoMultiworkspaceSemStarvation() {
  for (const totalWorkspaces of [5, 20, 100]) {
    const resultados = Array.from({ length: totalWorkspaces }, (_, indice) => {
      const volumoso = indice === 0;
      return calcular({
        workspaceId: `workspace_${indice}`,
        capacidadePorDestino: [
          destino({ destinoId: `destino_${indice}`, marketplace: "mercadolivre", categoria: "hardware", slots10Min: 2 })
        ],
        filaItens: volumoso
          ? Array.from({ length: 50 }, (_, slot) => itemFila({
            id: `vol_${slot}`,
            destinoId: `destino_${indice}`,
            dataEntradaFila: new Date(agora - 25 * 60 * 1000).toISOString()
          }))
          : []
      });
    });

    assert.strictEqual(resultados.length, totalWorkspaces);
    assert.strictEqual(resultados[0].estado, "CHEIO");
    assert(resultados.slice(1).every(item => item.estado === "ABAIXO_DO_ALVO"));
    assert(resultados.slice(1).every(item => item.deficitBuffer === 2));
  }
}

function testarBaixaDiversidadeNaoMudaCadencia() {
  const buffer = calcular({
    capacidadePorDestino: [
      destino({ destinoId: "unico_braco", marketplace: "mercadolivre", categoria: "hardware", intervaloEfetivo: 4, slots10Min: 2 })
    ]
  });

  assert.strictEqual(buffer.bufferAlvo, 2);
  assert.strictEqual(buffer.capacidadePorDestino[0].intervaloEfetivo, 4);
  assert.strictEqual(buffer.capacidadePorOferta.coberturaMinutos, 10);
}

function testarCasosReaisComSlotUtilPassamSemSobrecarga() {
  const casos = [
    { ofertaId: "180083", marketplace: "aliexpress", categoria: "hardware" },
    { ofertaId: "180067", marketplace: "aliexpress", categoria: "hardware" },
    { ofertaId: "180088", marketplace: "mercadolivre", categoria: "diversos" },
    { ofertaId: "179909", marketplace: "mercadolivre", categoria: "diversos" },
    { ofertaId: "179916", marketplace: "shopee", categoria: "diversos" },
    { ofertaId: "179917", marketplace: "mercadolivre", categoria: "diversos" }
  ];

  for (const caso of casos) {
    const buffer = calcular({
      workspaceId: `workspace_amostra_${caso.ofertaId}`,
      ofertaId: caso.ofertaId,
      marketplace: caso.marketplace,
      categoria: caso.categoria,
      capacidadePorDestino: [
        destino({ destinoId: `${caso.marketplace}_wa_${caso.ofertaId}`, tipo: "whatsapp", marketplace: caso.marketplace, categoria: caso.categoria, slots10Min: 2 }),
        destino({ destinoId: `${caso.marketplace}_tg_${caso.ofertaId}`, tipo: "telegram", marketplace: caso.marketplace, categoria: caso.categoria, slots10Min: 2 }),
        destino({ destinoId: `${caso.marketplace}_dc_${caso.ofertaId}`, tipo: "discord", marketplace: caso.marketplace, categoria: caso.categoria, slots10Min: 2 })
      ],
      filaItens: [
        itemFila({ id: `exp_${caso.ofertaId}`, status: "expirada_operacional", marketplace: caso.marketplace, categoria: caso.categoria }),
        itemFila({ id: `env_${caso.ofertaId}`, status: "enviado", marketplace: caso.marketplace, categoria: caso.categoria })
      ],
      flowAtual: {
        aceitarAgora: false,
        motivo: "esteira_saturada",
        nivelAlvo: 6,
        bufferAtual: 8,
        vagasDisponiveis: 0
      },
      saudeAgregada: { capacidade: 20, pressaoEsteiraViva: 8 }
    });

    assert.strictEqual(buffer.capacidadePorOferta.ofertaId, caso.ofertaId);
    assert.strictEqual(buffer.capacidadePorOferta.destinosAptos, 3);
    assert.strictEqual(buffer.bufferAtualUtil, 0);
    assert.strictEqual(buffer.deficitBuffer, 6);
    assert.strictEqual(buffer.capacidadePorOferta.aceitarPeloBufferVivo, true);
    assert(buffer.itensIgnorados.every(item => item.motivo === "status_fora_buffer_vivo"));
  }
}

function testarLogsShadowPresentes() {
  const raiz = path.join(__dirname, "..");
  const flow = fs.readFileSync(path.join(raiz, "modules", "engine", "flow-manager", "flow-manager.service.js"), "utf8");
  const gate = fs.readFileSync(path.join(raiz, "modules", "engine", "ofc", "absorption-gate.service.js"), "utf8");
  for (const marcador of [
    "BUFFER-VIVO-SHADOW",
    "BUFFER-VIVO-DIVERGENCIA-FLOW",
    "BUFFER-VIVO-CAPACIDADE-POR-BRACO"
  ]) {
    assert(flow.includes(marcador), `Flow sem marcador ${marcador}`);
    assert(gate.includes(marcador), `Gate sem marcador ${marcador}`);
  }
  const servico = fs.readFileSync(path.join(raiz, "modules", "engine", "ofc", "buffer-vivo-workspace.service.js"), "utf8");
  assert(!/user_9hqs434h|Roger|D1|Jhonata/i.test(servico), "servico nao deve ter regra por workspace especifico");
}

testarContratoDeSaida();
testarCapacidadeAgregadaDivergentePorBraco();
testarCasos179916E179917SemExcecaoPorWorkspace();
testarMarketplaceECategoriaIsolamPressao();
testarExpiradoNaoContaComoBufferUtil();
testarSimulacaoMultiworkspaceSemStarvation();
testarBaixaDiversidadeNaoMudaCadencia();
testarCasosReaisComSlotUtilPassamSemSobrecarga();
testarLogsShadowPresentes();

console.log("ofc-buffer-vivo-workspace-shadow.test.js OK");
