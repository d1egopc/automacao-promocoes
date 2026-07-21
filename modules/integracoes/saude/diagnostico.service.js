const crypto = require("crypto");
const { lerSaudeIntegracoes, lerSaudeMarketplace, salvarSaudeMarketplace } = require("./storage");
const {
  normalizarMarketplaceSaude,
  marketplaceSuportadoSaude,
  sanitizarDetalhes,
  registroPadrao,
  normalizarRegistro,
  aplicarConfiguracao,
  aplicarResultado,
  publico
} = require("./regras");
const { adaptarAmazon } = require("./marketplaces/amazon");
const { adaptarMercadoLivre } = require("./marketplaces/mercadolivre");

function valorTexto(obj = {}, campos = []) {
  const fonte = obj?.credenciais || obj || {};
  for (const campo of campos) {
    const valor = fonte?.[campo];
    if (valor !== undefined && valor !== null && String(valor).trim()) return String(valor).trim();
  }
  return "";
}

function configConfigurada(marketplace = "", config = {}) {
  const mp = normalizarMarketplaceSaude(marketplace);
  const c = config?.credenciais || config || {};
  if (mp === "mercadolivre") {
    return Boolean(valorTexto(c, ["cookies", "cookie"]) && valorTexto(c, ["tag", "tagId", "tagID", "tag_id", "codigoAfiliado", "trackingId", "partnerTag", "affiliateTag"]));
  }
  if (mp === "amazon") {
    const modo = String(config?.modo || c.modo || "").toLowerCase();
    const tag = valorTexto(c, ["trackingId", "partnerTag", "tag", "tagId", "affiliateTag", "appId"]);
    const cookies = valorTexto(c, ["cookies", "cookie"]);
    const api = Boolean(valorTexto(c, ["appId"]) && valorTexto(c, ["accessKey", "access_key"]) && valorTexto(c, ["secretKey", "secret_key"]));
    if (modo === "api") return api;
    if (modo === "cookies") return Boolean(tag && cookies);
    return Boolean((tag && cookies) || api);
  }
  if (mp === "shopee") {
    return Boolean(valorTexto(c, ["appId", "app_id"]) && valorTexto(c, ["secret", "secretKey", "appSecret", "app_secret"]));
  }
  if (mp === "aliexpress") {
    return Boolean(valorTexto(c, ["appKey", "app_key"]) && valorTexto(c, ["secret", "appSecret", "app_secret"]) && valorTexto(c, ["trackingId", "tracking_id"]));
  }
  if (mp === "awin" || mp === "kabum") {
    return Boolean(valorTexto(c, ["publisherId", "publisher_id", "publisher"]) && valorTexto(c, ["apiToken", "api_token", "token"]));
  }
  return false;
}

function ordenarObjeto(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarObjeto);
  if (!valor || typeof valor !== "object") return valor;
  return Object.keys(valor).sort().reduce((acc, chave) => {
    acc[chave] = ordenarObjeto(valor[chave]);
    return acc;
  }, {});
}

function hashCredenciais(marketplace = "", config = {}) {
  const mp = normalizarMarketplaceSaude(marketplace);
  const credenciais = config?.credenciais || config || {};
  const payload = ordenarObjeto({ marketplace: mp, modo: config?.modo || credenciais.modo || "", credenciais });
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function adaptarResultadoMarketplace(marketplace = "", resultado = {}) {
  const mp = normalizarMarketplaceSaude(marketplace || resultado.marketplace);
  if (mp === "amazon") return adaptarAmazon(resultado);
  if (mp === "mercadolivre") return adaptarMercadoLivre(resultado);
  return adaptarResultadoGenerico(mp, resultado);
}

function statusCredencialInvalida(status = "") {
  const valor = String(status || "").toLowerCase();
  return /credencial|credential|cookie|token|secret|publisher|tag|api[_-]?key|app[_-]?key|unauthorized|unauthorised|forbidden|401|403|invalid|invalido|inv[aá]lido|expirad|ausente|rejeitad/.test(valor);
}

function adaptarResultadoGenerico(marketplace = "", resultado = {}) {
  const mp = normalizarMarketplaceSaude(marketplace || resultado.marketplace);
  const status = String(resultado.status || resultado.codigo || "").toLowerCase();
  const origem = resultado.origem || "teste_manual";
  const testeManual = origem === "teste_manual";
  const detalhes = sanitizarDetalhes(resultado.detalhes || {}) || {};

  if (resultado.ok === true || status === "ok") {
    return {
      marketplace: mp,
      estado: "ok",
      codigo: status || "ok",
      mensagem: resultado.mensagem || "Fluxo oficial executado com sucesso.",
      origem,
      detalhes
    };
  }

  if (statusCredencialInvalida(status) || statusCredencialInvalida(resultado.mensagem)) {
    return {
      marketplace: mp,
      estado: "invalida",
      codigo: status || "credencial_invalida",
      mensagem: resultado.mensagem || "Credenciais inválidas ou rejeitadas.",
      origem,
      detalhes
    };
  }

  if (testeManual) {
    return {
      marketplace: mp,
      estado: "invalida",
      codigo: status || "falha_teste",
      mensagem: resultado.mensagem || "Teste manual não comprovou o fluxo oficial de afiliado.",
      origem,
      detalhes
    };
  }

  return {
    marketplace: mp,
    estado: "ok",
    codigo: status || "falha_temporaria",
    mensagem: resultado.mensagem || "Falha temporária registrada pelo fluxo oficial.",
    origem,
    falhaTemporaria: true,
    detalhes
  };
}

function obterSaudeIntegracao(clienteId = "admin", marketplace = "", config = null) {
  const mp = normalizarMarketplaceSaude(marketplace);
  if (!marketplaceSuportadoSaude(mp)) return null;
  const registro = normalizarRegistro(lerSaudeMarketplace(clienteId, mp) || registroPadrao(mp), mp);
  if (config) {
    const configurada = configConfigurada(mp, config);
    const semHistorico = !registro.ultimoTesteEm && registro.estado === "nao_configurada";
    return publico({
      ...registro,
      configurada,
      estado: !configurada ? "nao_configurada" : semHistorico ? "ok" : registro.estado,
      codigo: !configurada ? "credenciais_ausentes" : semHistorico ? "configurada" : registro.codigo,
      mensagem: !configurada
        ? "Credenciais obrigatórias ausentes."
        : semHistorico
          ? "Integração configurada."
          : registro.mensagem
    }, mp);
  }
  return publico(registro, mp);
}

function listarSaudeIntegracoes(clienteId = "admin", configs = {}) {
  const registros = lerSaudeIntegracoes(clienteId);
  const saida = {};
  for (const marketplace of ["amazon", "mercadolivre", "shopee", "aliexpress", "awin", "kabum"]) {
    const config = configs?.[marketplace] || null;
    saida[marketplace] = obterSaudeIntegracao(clienteId, marketplace, config || null) || publico(registros[marketplace] || registroPadrao(marketplace), marketplace);
  }
  return saida;
}

function registrarConfiguracaoIntegracao(clienteId = "admin", marketplace = "", config = {}) {
  const mp = normalizarMarketplaceSaude(marketplace);
  if (!marketplaceSuportadoSaude(mp)) return null;
  const atual = lerSaudeMarketplace(clienteId, mp) || registroPadrao(mp);
  const registro = aplicarConfiguracao(atual, mp, {
    configurada: configConfigurada(mp, config),
    credenciaisHash: hashCredenciais(mp, config)
  });
  return publico(salvarSaudeMarketplace(clienteId, mp, registro), mp);
}

function registrarResultadoTesteIntegracao(clienteId = "admin", marketplace = "", resultado = {}) {
  const mp = normalizarMarketplaceSaude(marketplace || resultado.marketplace);
  if (!marketplaceSuportadoSaude(mp)) return null;
  const adaptado = adaptarResultadoMarketplace(mp, {
    ...resultado,
    origem: resultado.origem || "teste_manual"
  });
  if (!adaptado) return null;
  const atual = lerSaudeMarketplace(clienteId, mp) || registroPadrao(mp);
  const registro = aplicarResultado(atual, mp, adaptado);
  return publico(salvarSaudeMarketplace(clienteId, mp, registro), mp);
}

function registrarResultadoOperacionalIntegracao(clienteId = "admin", marketplace = "", resultado = {}) {
  return registrarResultadoTesteIntegracao(clienteId, marketplace, {
    ...resultado,
    origem: resultado.origem || "producao"
  });
}

module.exports = {
  normalizarMarketplaceSaude,
  marketplaceSuportadoSaude,
  configConfigurada,
  hashCredenciais,
  sanitizarDetalhes,
  adaptarResultadoMarketplace,
  obterSaudeIntegracao,
  listarSaudeIntegracoes,
  registrarConfiguracaoIntegracao,
  registrarResultadoTesteIntegracao,
  registrarResultadoOperacionalIntegracao
};

