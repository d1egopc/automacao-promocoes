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
  return null;
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
      estado: !configurada ? "nao_configurada" : semHistorico ? "pendente" : registro.estado,
      codigo: !configurada ? "credenciais_ausentes" : semHistorico ? "validacao_pendente" : registro.codigo,
      mensagem: !configurada
        ? "Credenciais obrigatórias ausentes."
        : semHistorico
          ? "Credenciais salvas, teste real pendente."
          : registro.mensagem
    }, mp);
  }
  return publico(registro, mp);
}

function listarSaudeIntegracoes(clienteId = "admin", configs = {}) {
  const registros = lerSaudeIntegracoes(clienteId);
  const saida = {};
  for (const marketplace of ["amazon", "mercadolivre"]) {
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
  const adaptado = adaptarResultadoMarketplace(mp, resultado);
  if (!adaptado) return null;
  const atual = lerSaudeMarketplace(clienteId, mp) || registroPadrao(mp);
  const registro = aplicarResultado(atual, mp, adaptado);
  return publico(salvarSaudeMarketplace(clienteId, mp, registro), mp);
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
  registrarResultadoTesteIntegracao
};

