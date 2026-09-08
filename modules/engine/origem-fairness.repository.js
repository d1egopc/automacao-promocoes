const ORIGENS_PROTEGIDAS = Object.freeze([
  "optimus",
  "clonador_grupos"
]);

const ETAPAS_FAIRNESS = Object.freeze([
  "diagnostico_final",
  "validacao_final"
]);

const LANES_FAIRNESS = Object.freeze([
  "agua_nova",
  "fresca_em_risco",
  "fresca_circulavel",
  "expirada"
]);

function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizarChaveFairness({ clienteId = "", etapa = "", lane = "" } = {}) {
  const chave = {
    clienteId: texto(clienteId),
    etapa: texto(etapa),
    lane: texto(lane)
  };

  if (!chave.clienteId) throw new Error("fairness_cliente_id_ausente");
  if (!ETAPAS_FAIRNESS.includes(chave.etapa)) throw new Error("fairness_etapa_invalida");
  if (!LANES_FAIRNESS.includes(chave.lane)) throw new Error("fairness_lane_invalida");
  return chave;
}

function normalizarOrigemProtegida(origem = "") {
  const valor = texto(origem).toLowerCase();
  if (!ORIGENS_PROTEGIDAS.includes(valor)) throw new Error("fairness_origem_invalida");
  return valor;
}

function exigirClientTransacional(client) {
  if (!client || typeof client.query !== "function") {
    throw new Error("fairness_client_transacional_ausente");
  }
  return client;
}

function paramsChave(chave = {}) {
  return [chave.clienteId, chave.etapa, chave.lane];
}

function normalizarEstado(linha = {}, chave = {}) {
  return {
    clienteId: linha.cliente_id || chave.clienteId,
    etapa: linha.etapa || chave.etapa,
    lane: linha.lane || chave.lane,
    ultimaOrigemAtendida: linha.ultima_origem_atendida || "",
    ultimoAtendimentoEm: linha.ultimo_atendimento_em || null,
    criadoEm: linha.criado_em || null,
    atualizadoEm: linha.atualizado_em || null
  };
}

// O chamador abre/fecha a transacao. Para lotes futuros, ordenar as chaves por
// clienteId, etapa e lane antes de chamar bloquearEstadoFairness evita deadlock.
async function garantirEstadoFairness(client, entrada = {}) {
  const transacao = exigirClientTransacional(client);
  const chave = normalizarChaveFairness(entrada);
  const resultado = await transacao.query(
    `INSERT INTO engine_fairness_origem_fluxo (cliente_id, etapa, lane)
     VALUES ($1, $2, $3)
     ON CONFLICT (cliente_id, etapa, lane) DO NOTHING
     RETURNING cliente_id, etapa, lane, ultima_origem_atendida,
               ultimo_atendimento_em, criado_em, atualizado_em`,
    paramsChave(chave)
  );

  return {
    criada: resultado.rowCount > 0,
    estado: resultado.rows[0] ? normalizarEstado(resultado.rows[0], chave) : null
  };
}

async function obterEstadoFairness(client, entrada = {}) {
  const transacao = exigirClientTransacional(client);
  const chave = normalizarChaveFairness(entrada);
  const resultado = await transacao.query(
    `SELECT cliente_id, etapa, lane, ultima_origem_atendida,
            ultimo_atendimento_em, criado_em, atualizado_em
       FROM engine_fairness_origem_fluxo
      WHERE cliente_id = $1 AND etapa = $2 AND lane = $3
      LIMIT 1`,
    paramsChave(chave)
  );
  return resultado.rows[0] ? normalizarEstado(resultado.rows[0], chave) : null;
}

async function bloquearEstadoFairness(client, entrada = {}) {
  const transacao = exigirClientTransacional(client);
  const chave = normalizarChaveFairness(entrada);
  await garantirEstadoFairness(transacao, chave);
  const resultado = await transacao.query(
    `SELECT cliente_id, etapa, lane, ultima_origem_atendida,
            ultimo_atendimento_em, criado_em, atualizado_em
       FROM engine_fairness_origem_fluxo
      WHERE cliente_id = $1 AND etapa = $2 AND lane = $3
      FOR UPDATE`,
    paramsChave(chave)
  );
  return normalizarEstado(resultado.rows[0] || {}, chave);
}

async function registrarOrigemAtendidaFairness(client, entrada = {}, origem = "") {
  const transacao = exigirClientTransacional(client);
  const chave = normalizarChaveFairness(entrada);
  const origemFinal = normalizarOrigemProtegida(origem);
  const resultado = await transacao.query(
    `UPDATE engine_fairness_origem_fluxo
        SET ultima_origem_atendida = $4,
            ultimo_atendimento_em = NOW(),
            atualizado_em = NOW()
      WHERE cliente_id = $1 AND etapa = $2 AND lane = $3
      RETURNING cliente_id, etapa, lane, ultima_origem_atendida,
                ultimo_atendimento_em, criado_em, atualizado_em`,
    [...paramsChave(chave), origemFinal]
  );
  if (!resultado.rows[0]) throw new Error("fairness_estado_ausente_para_atualizacao");
  return normalizarEstado(resultado.rows[0], chave);
}

module.exports = {
  ORIGENS_PROTEGIDAS,
  ETAPAS_FAIRNESS,
  LANES_FAIRNESS,
  normalizarChaveFairness,
  normalizarOrigemProtegida,
  garantirEstadoFairness,
  obterEstadoFairness,
  bloquearEstadoFairness,
  registrarOrigemAtendidaFairness
};
