"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDirAnterior = process.env.DATA_DIR;
const dataDirTeste = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fase-c-"));
process.env.DATA_DIR = dataDirTeste;

const { writeGlobalJson } = require("../utils/storage");
const {
  motivoDistribuicaoDefinitivo
} = require("../modules/engine/distributor/motivos-definitivos");
const distributorService = require("../modules/engine/distributor/distributor.service");
const {
  MATRIZ_STATUS_AUTO_CLEAN
} = require("../modules/engine/auto-clean/auto-clean.service");

const WORKSPACE_A = "user_fase_c_a";
const WORKSPACE_B = "user_fase_c_b";

writeGlobalJson("usuarios.json", [
  { id: WORKSPACE_A, ativo: true, plano: "pro" },
  { id: WORKSPACE_B, ativo: true, plano: "pro" }
]);

function limparModulo(relativo) {
  const resolvido = require.resolve(relativo);
  delete require.cache[resolvido];
  return resolvido;
}

function mockModulo(relativo, exports) {
  const resolvido = limparModulo(relativo);
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports
  };
}

function destino(extra = {}) {
  return {
    id: extra.id || "destino",
    nome: extra.nome || "Destino",
    ativo: extra.ativo !== false,
    tipo: "telegram",
    botToken: extra.botToken === undefined ? "bot" : extra.botToken,
    chatId: extra.chatId === undefined ? "chat" : extra.chatId,
    marketplaces: extra.marketplaces || ["mercadolivre"],
    categorias: Object.prototype.hasOwnProperty.call(extra, "categorias") ? extra.categorias : ["Gamer e Hardware"],
    ...extra
  };
}

function validacaoOkComDestino(extra = {}) {
  const retorno = {
    ok: true,
    destinosCompativeis: 1,
    destinosCompativeisDetalhes: [],
    ...extra
  };
  Object.defineProperty(retorno, "__destinosCompativeisRaw", {
    value: [destino()],
    enumerable: false
  });
  return retorno;
}

function oferta(extra = {}) {
  return {
    id: extra.id || 1,
    job_id: extra.job_id || 101,
    evento_id: extra.evento_id || 201,
    cliente_id: extra.cliente_id || WORKSPACE_A,
    marketplace: extra.marketplace || "mercadolivre",
    titulo: extra.titulo || "Oferta fase C",
    categoria: extra.categoria || "Gamer e Hardware",
    status: extra.status || "importada",
    metadata: {},
    ...extra
  };
}

function contexto(destinosPorCliente = {}) {
  return {
    clientesValidos: [WORKSPACE_A, WORKSPACE_B],
    marketplacesAtivosPorCliente: {
      [WORKSPACE_A]: { mercadolivre: true, shopee: false },
      [WORKSPACE_B]: { mercadolivre: true }
    },
    destinosPorCliente,
    validarCreditos: () => ({ ok: true })
  };
}

async function validarClassificador() {
  assert.strictEqual(motivoDistribuicaoDefinitivo("marketplace_bloqueado").definitivo, true);
  assert.strictEqual(motivoDistribuicaoDefinitivo("categoria_incompativel", { destinosCompativeis: 0 }).definitivo, true);
  assert.strictEqual(motivoDistribuicaoDefinitivo("categoria_incompativel", { destinosCompativeis: 1 }).definitivo, false);
  assert.strictEqual(motivoDistribuicaoDefinitivo("sem_destino_compativel").definitivo, true);
  assert.strictEqual(motivoDistribuicaoDefinitivo("integracao_ausente").definitivo, true);
  assert.strictEqual(motivoDistribuicaoDefinitivo("sessao_ou_integracao_inapta").definitivo, false);
  assert.strictEqual(motivoDistribuicaoDefinitivo("sessao_ou_integracao_inapta", { temIntegracao: false }).definitivo, true);
  assert.strictEqual(motivoDistribuicaoDefinitivo("intervalo_nao_atingido").definitivo, false);
  assert.strictEqual(motivoDistribuicaoDefinitivo("erro_temporario").definitivo, false);
  assert.strictEqual(motivoDistribuicaoDefinitivo("janela_fechada").definitivo, false);
}

async function validarDistributorClassificaSemFila() {
  const marketplaceDesabilitado = await distributorService.validarOfertaParaDistribuicao(
    oferta({ marketplace: "shopee" }),
    contexto({ [WORKSPACE_A]: [destino({ marketplaces: ["shopee"] })] })
  );
  assert.strictEqual(marketplaceDesabilitado.ok, false);
  assert.strictEqual(marketplaceDesabilitado.motivo, "marketplace_bloqueado");
  assert.strictEqual(marketplaceDesabilitado.detalhes.definitivoOperacional, true);

  const todosIncompativeis = await distributorService.validarOfertaParaDistribuicao(
    oferta({ categoria: "Celulares e Smartphones" }),
    contexto({ [WORKSPACE_A]: [destino({ categorias: ["Gamer e Hardware"] })] })
  );
  assert.strictEqual(todosIncompativeis.ok, false);
  assert.strictEqual(todosIncompativeis.motivo, "categoria_incompativel");
  assert.strictEqual(todosIncompativeis.detalhes.definitivoOperacional, true);

  const umDestinoCompativel = await distributorService.validarOfertaParaDistribuicao(
    oferta({ categoria: "Celulares e Smartphones" }),
    contexto({
      [WORKSPACE_A]: [
        destino({ id: "rejeita", categorias: ["Gamer e Hardware"] }),
        destino({ id: "aceita", categorias: ["Celulares e Smartphones"] })
      ]
    })
  );
  assert.strictEqual(umDestinoCompativel.ok, true, "rejeicao definitiva de um destino nao deve bloquear destino compativel");
  assert.strictEqual(umDestinoCompativel.destinosCompativeis, 1);

  const semDestino = await distributorService.validarOfertaParaDistribuicao(
    oferta(),
    contexto({ [WORKSPACE_A]: [] })
  );
  assert.strictEqual(semDestino.ok, false);
  assert.strictEqual(semDestino.motivo, "sem_destino");
  assert.strictEqual(semDestino.detalhes.definitivoOperacional, true);
}

async function executarRunnerComMock({ ofertas, validar, gate }) {
  const statusMarcados = [];
  const restauracoes = [];
  const adicionados = [];
  const etapas = [];
  let buscaNumero = 0;

  limparModulo("../modules/engine/distributor/distributor.runner");
  mockModulo("../modules/engine/distributor/distributor.service", {
    limitarDistribuicao: valor => Number(valor || 10),
    buscarOfertasDistribuiveis: async () => {
      buscaNumero += 1;
      return { ok: true, ofertas: buscaNumero === 1 ? ofertas : [] };
    },
    tentarMarcarDistribuindo: async () => ({ ok: true }),
    marcarOfertaStatus: async (id, status, motivo) => {
      statusMarcados.push({ id, status, motivo });
      const alvo = ofertas.find(item => item.id === id);
      if (alvo) alvo.status = status;
      return { ok: true };
    },
    restaurarOfertaStatusSeDistribuindo: async (id, statusAnterior, motivo) => {
      restauracoes.push({ id, statusAnterior, motivo });
      statusMarcados.push({ id, status: statusAnterior, motivo: "" });
      return { ok: true };
    },
    restaurarOfertaParaReentradaFlow: async (id, statusAnterior, motivo) => {
      restauracoes.push({ id, statusAnterior, motivo, reentradaFlow: true });
      statusMarcados.push({ id, status: statusAnterior, motivo });
      return { ok: true };
    },
    registrarEtapaDistribuicao: async (jobId, etapa, status, motivo, detalhes) => {
      etapas.push({ jobId, etapa, status, motivo, detalhes });
      return { ok: true };
    },
    validarOfertaParaDistribuicao: validar,
    adicionarOfertaNaFilaCliente: async ofertaAtual => {
      adicionados.push(ofertaAtual.cliente_id);
      return { ok: true, itemFila: { id: `fila_${ofertaAtual.id}`, status: "pendente" } };
    }
  });

  const runner = require("../modules/engine/distributor/distributor.runner");
  const resultado = await runner.distribuirOfertasEngine({
    limite: ofertas.length,
    deps: gate ? { decidirAbsorcaoWorkspace: gate } : {}
  });

  return { resultado, statusMarcados, restauracoes, adicionados, etapas };
}

async function validarRunnerNaoRestauraDefinitivo() {
  const definitivo = await executarRunnerComMock({
    ofertas: [oferta({ id: 10, job_id: 110, cliente_id: WORKSPACE_A })],
    validar: async () => validacaoOkComDestino(),
    gate: async () => ({
      ativo: true,
      permitir: false,
      estadoDaEsteira: "FECHADA",
      motivo: "sem_destino_apto",
      capacidadeAtual: 0,
      pressaoEsteiraViva: 0,
      filaAlvo: 0
    })
  });

  assert.strictEqual(definitivo.resultado.adicionadasFila, 0);
  assert.strictEqual(definitivo.restauracoes.length, 0, "Gate definitivo nao pode restaurar status comercial");
  assert(definitivo.statusMarcados.some(item => item.id === 10 && item.status === "retida"));
  assert(definitivo.etapas.some(item => item.detalhes?.definitivoOperacional === true));

  const temporario = await executarRunnerComMock({
    ofertas: [oferta({ id: 11, job_id: 111, cliente_id: WORKSPACE_A })],
    validar: async () => validacaoOkComDestino(),
    gate: async () => ({
      ativo: true,
      permitir: false,
      estadoDaEsteira: "SATURADA",
      motivo: "esteira_saturada",
      capacidadeAtual: 0,
      pressaoEsteiraViva: 3,
      filaAlvo: 3
    })
  });

  assert.strictEqual(temporario.restauracoes.length, 1, "bloqueio temporario de Gate preserva restauracao atual");
  assert(temporario.statusMarcados.some(item => item.id === 11 && item.status === "importada"));
}

async function validarIsolamentoWorkspace() {
  const misto = await executarRunnerComMock({
    ofertas: [
      oferta({ id: 20, job_id: 120, cliente_id: WORKSPACE_A }),
      oferta({ id: 21, job_id: 121, cliente_id: WORKSPACE_B })
    ],
    validar: async ofertaAtual => {
      if (ofertaAtual.cliente_id === WORKSPACE_A) {
        return { ok: false, motivo: "marketplace_bloqueado", detalhes: { definitivoOperacional: true } };
      }
      return validacaoOkComDestino();
    }
  });

  assert.strictEqual(misto.resultado.adicionadasFila, 1);
  assert.deepStrictEqual(misto.adicionados, [WORKSPACE_B]);
  assert(misto.statusMarcados.some(item => item.id === 20 && item.status === "retida"));
  assert(misto.statusMarcados.some(item => item.id === 21 && item.status === "fila"));
}

async function validarPoliticaIntegracaoAusente() {
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.integracao_ausente.terminal, true);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.integracao_ausente.vivo, false);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.integracao_ausente.reprocessavel, false);
  assert.strictEqual(MATRIZ_STATUS_AUTO_CLEAN.integracao_ausente.reprocessavelAteHoras, 0);
}

async function validarExecutorFonte() {
  const fonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const indiceRejeitados = fonte.indexOf("for (const itemRejeitado of analiseDestinosFila.rejeitados)");
  const indiceSemCompativeis = fonte.indexOf("if (!destinosCompativeis.length)", indiceRejeitados);
  const indiceOrdenados = fonte.indexOf("const destinosOrdenados = destinosCompativeis", indiceSemCompativeis);
  assert(indiceRejeitados > 0, "executor deve auditar destinos rejeitados");
  assert(indiceSemCompativeis > indiceRejeitados, "retencao deve ocorrer somente apos analisar rejeitados");
  assert(indiceOrdenados > indiceSemCompativeis, "destinos compativeis devem seguir para ordenacao/envio");
  assert(fonte.includes("oferta.retidaTerminal = true"), "retida definitiva deve ser terminal para historico/fila");
}

(async () => {
  try {
    await validarClassificador();
    await validarDistributorClassificaSemFila();
    await validarRunnerNaoRestauraDefinitivo();
    await validarIsolamentoWorkspace();
    await validarPoliticaIntegracaoAusente();
    await validarExecutorFonte();
    console.log("distributor-definitivo-fase-c.test.js OK");
  } finally {
    if (dataDirAnterior === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = dataDirAnterior;
    fs.rmSync(dataDirTeste, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  if (dataDirAnterior === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataDirAnterior;
  try { fs.rmSync(dataDirTeste, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
