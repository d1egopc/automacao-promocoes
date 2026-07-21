const ESTADOS_SAUDE = new Set(["nao_configurada", "ok", "invalida"]);
const MARKETPLACES_SAUDE = new Set(["amazon", "mercadolivre", "shopee", "aliexpress", "awin", "kabum"]);

function agoraIso() {
  return new Date().toISOString();
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizarMarketplaceSaude(marketplace = "") {
  const valor = texto(marketplace)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (["ml", "meli", "mercadolivrebr", "mercadolivre"].includes(valor)) return "mercadolivre";
  if (["amazon", "amazonbr"].includes(valor)) return "amazon";
  return valor;
}

function marketplaceSuportadoSaude(marketplace = "") {
  return MARKETPLACES_SAUDE.has(normalizarMarketplaceSaude(marketplace));
}

function estadoSeguro(estado = "ok") {
  const valor = texto(estado).toLowerCase();
  if (valor === "saudavel") return "ok";
  if (valor === "pendente" || valor === "atencao") return "ok";
  return ESTADOS_SAUDE.has(valor) ? valor : "ok";
}

function sanitizarDetalhes(valor, profundidade = 0) {
  if (profundidade > 4) return "[truncado]";
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string") return valor.length > 240 ? valor.slice(0, 240) + "..." : valor;
  if (typeof valor === "number" || typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) return valor.slice(0, 12).map(item => sanitizarDetalhes(item, profundidade + 1));
  if (typeof valor !== "object") return undefined;

  const saida = {};
  const secretKey = /cookie|cookies|token|secret|senha|password|authorization|access|refresh|api[_-]?key|apikey|chave/i;
  for (const [chave, item] of Object.entries(valor)) {
    if (secretKey.test(chave)) {
      saida[chave] = item ? "***" : item;
      continue;
    }
    saida[chave] = sanitizarDetalhes(item, profundidade + 1);
  }
  return saida;
}

function registroPadrao(marketplace = "") {
  const mp = normalizarMarketplaceSaude(marketplace);
  return {
    marketplace: mp,
    configurada: false,
    estado: "nao_configurada",
    codigo: "credenciais_ausentes",
    mensagem: "Integração não configurada.",
    origem: "configuracao",
    ultimoTesteEm: null,
    ultimoSucessoEm: null,
    ultimaFalhaEm: null,
    ultimoResultadoEm: null,
    falhasConsecutivas: 0,
    ultimoSucesso: null,
    ultimaFalha: null,
    detalhes: {}
  };
}

function normalizarRegistro(registro = {}, marketplace = "") {
  const base = registroPadrao(marketplace || registro.marketplace);
  const atual = registro && typeof registro === "object" ? registro : {};
  return {
    ...base,
    ...atual,
    marketplace: normalizarMarketplaceSaude(atual.marketplace || marketplace || base.marketplace),
    configurada: atual.configurada === true,
    estado: estadoSeguro(atual.estado || base.estado),
    falhasConsecutivas: Number.isFinite(Number(atual.falhasConsecutivas)) ? Math.max(0, Number(atual.falhasConsecutivas)) : 0,
    detalhes: sanitizarDetalhes(atual.detalhes || {}) || {},
    ultimoSucesso: atual.ultimoSucesso ? sanitizarDetalhes(atual.ultimoSucesso) : null,
    ultimaFalha: atual.ultimaFalha ? sanitizarDetalhes(atual.ultimaFalha) : null
  };
}

function aplicarConfiguracao(registroAtual = {}, marketplace = "", opcoes = {}) {
  const agora = agoraIso();
  const registro = normalizarRegistro(registroAtual, marketplace);
  const configurada = opcoes.configurada === true;
  const credenciaisHash = texto(opcoes.credenciaisHash);
  const hashAnterior = texto(registro.credenciaisHash);
  const hashMudou = Boolean(credenciaisHash && hashAnterior && credenciaisHash !== hashAnterior);

  registro.marketplace = normalizarMarketplaceSaude(marketplace || registro.marketplace);
  registro.configurada = configurada;
  registro.origem = "configuracao";
  registro.detalhes = sanitizarDetalhes({ ...(registro.detalhes || {}), configurada }) || {};
  if (credenciaisHash) registro.credenciaisHash = credenciaisHash;

  if (!configurada) {
    registro.estado = "nao_configurada";
    registro.codigo = "credenciais_ausentes";
    registro.mensagem = "Credenciais obrigatórias ausentes.";
    registro.ultimoResultadoEm = registro.ultimoResultadoEm || agora;
    return registro;
  }

  if (!registro.ultimoTesteEm || hashMudou || registro.estado === "nao_configurada") {
    registro.estado = "ok";
    registro.codigo = hashMudou ? "configuracao_alterada" : "configurada";
    registro.mensagem = "Integração configurada.";
    registro.ultimoResultadoEm = agora;
  }

  return registro;
}

function aplicarResultado(registroAtual = {}, marketplace = "", resultado = {}) {
  const agora = agoraIso();
  const registro = normalizarRegistro(registroAtual, marketplace || resultado.marketplace);
  const estadoAnterior = registro.estado;
  const codigoAnterior = registro.codigo;
  const mensagemAnterior = registro.mensagem;
  const estado = estadoSeguro(resultado.estado || "ok");
  const codigo = texto(resultado.codigo || resultado.status || "falha_teste") || "falha_teste";
  const mensagem = texto(resultado.mensagem) || "Resultado de integração registrado.";
  const detalhes = sanitizarDetalhes(resultado.detalhes || {}) || {};
  const resumo = {
    estado,
    codigo,
    mensagem,
    origem: texto(resultado.origem) || "teste_manual",
    detalhes,
    registradoEm: agora
  };

  registro.marketplace = normalizarMarketplaceSaude(resultado.marketplace || marketplace || registro.marketplace);
  registro.configurada = estado !== "nao_configurada" ? true : registro.configurada === true;
  registro.estado = estado;
  registro.codigo = codigo;
  registro.mensagem = mensagem;
  registro.origem = resumo.origem;
  registro.ultimoTesteEm = agora;
  registro.ultimoResultadoEm = agora;
  registro.detalhes = detalhes;

  if (estado === "ok" && resultado.falhaTemporaria !== true) {
    registro.ultimoSucessoEm = agora;
    registro.ultimoSucesso = resumo;
    registro.falhasConsecutivas = 0;
    return registro;
  }

  if (resultado.falhaTemporaria === true) {
    if (estadoAnterior === "invalida") {
      registro.estado = "invalida";
      registro.codigo = codigoAnterior || registro.codigo;
      registro.mensagem = mensagemAnterior || registro.mensagem;
    }
    registro.ultimaFalhaEm = agora;
    registro.ultimaFalha = resumo;
    registro.falhasConsecutivas = Number(registro.falhasConsecutivas || 0) + 1;
    return registro;
  }

  if (["invalida", "nao_configurada"].includes(estado)) {
    registro.ultimaFalhaEm = agora;
    registro.ultimaFalha = resumo;
    registro.falhasConsecutivas = Number(registro.falhasConsecutivas || 0) + 1;
  }

  return registro;
}

function publico(registro = {}, marketplace = "") {
  const normalizado = normalizarRegistro(registro, marketplace);
  const { credenciaisHash, clienteId, ...saida } = normalizado;
  return sanitizarDetalhes(saida) || saida;
}

module.exports = {
  ESTADOS_SAUDE,
  MARKETPLACES_SAUDE,
  normalizarMarketplaceSaude,
  marketplaceSuportadoSaude,
  sanitizarDetalhes,
  registroPadrao,
  normalizarRegistro,
  aplicarConfiguracao,
  aplicarResultado,
  publico
};

