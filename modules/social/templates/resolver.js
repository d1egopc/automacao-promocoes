const storage = require("../storage");

const TEMPLATE_OPTIMUS_ID = "padrao-instagram";
const TEMPLATE_PADRAO_CLIENTE_IDS = new Set([
  "",
  "usar-template-padrao",
  "template-padrao",
  "padrao-cliente",
  "__padrao_cliente",
  "__template_padrao_cliente",
  "default"
]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function listarTemplatesPersonalizados(clienteId = "admin") {
  return storage.listarTemplatesSocial(clienteId)
    .filter(item => texto(item.id) && texto(item.id) !== TEMPLATE_OPTIMUS_ID && item.ativo !== false);
}

function templatePadraoCliente(clienteId = "admin") {
  return listarTemplatesPersonalizados(clienteId).find(item => item.padrao === true) || null;
}

function snapshotTemplateSocial(resolvido = {}) {
  const template = resolvido.template || null;
  if (!template) {
    return {
      id: TEMPLATE_OPTIMUS_ID,
      padraoOptimus: true,
      personalizado: false
    };
  }

  return {
    id: texto(template.id),
    nome: texto(template.nome),
    rede: texto(template.rede || "instagram"),
    formato: texto(template.formato || "post"),
    padrao: template.padrao === true,
    personalizado: true,
    visual: objeto(template.visual),
    legenda: texto(template.legenda || template.conteudo),
    gatilho: objeto(template.gatilho),
    respostaPublica: texto(template.respostaPublica || template.gatilho?.respostaPublica),
    mensagemPrivada: texto(template.mensagemPrivada || template.gatilho?.mensagemDirect || template.gatilho?.textoDirect),
    cta: objeto(template.cta)
  };
}

function resolverTemplateSocial(clienteId = "admin", templateId = "") {
  const clienteSeguro = texto(clienteId || "admin") || "admin";
  const id = texto(templateId);

  if (id === TEMPLATE_OPTIMUS_ID) {
    return {
      templateId: TEMPLATE_OPTIMUS_ID,
      template: null,
      padraoOptimus: true,
      solicitado: id
    };
  }

  const templates = listarTemplatesPersonalizados(clienteSeguro);
  const template = TEMPLATE_PADRAO_CLIENTE_IDS.has(id)
    ? templatePadraoCliente(clienteSeguro)
    : templates.find(item => texto(item.id) === id);

  if (!template) {
    return {
      templateId: TEMPLATE_OPTIMUS_ID,
      template: null,
      padraoOptimus: true,
      solicitado: id
    };
  }

  return {
    templateId: texto(template.id),
    template,
    padraoOptimus: false,
    solicitado: id
  };
}

function payloadTemplatePersonalizadoSocial(resolvido = {}) {
  const template = resolvido.template || null;
  if (!template) return null;

  const gatilho = objeto(template.gatilho);
  const gatilhoAtivo = gatilho.ativo === true;
  const mensagemPrivada = texto(template.mensagemPrivada || gatilho.mensagemDirect || gatilho.textoDirect);
  const respostaPublica = texto(template.respostaPublica || gatilho.respostaPublica);

  return {
    templateId: texto(template.id),
    legenda: texto(template.legenda || template.conteudo),
    gatilho: gatilhoAtivo
      ? {
        ativo: true,
        palavra: texto(gatilho.palavra || "PROMO"),
        ctaPublico: texto(gatilho.ctaPublico),
        respostaPublica,
        mensagemDirect: mensagemPrivada,
        textoDirect: mensagemPrivada
      }
      : undefined,
    respostaPublica: gatilhoAtivo ? respostaPublica : "",
    mensagemPrivada: gatilhoAtivo ? mensagemPrivada : "",
    cta: gatilhoAtivo ? objeto(template.cta) : null,
    snapshot: snapshotTemplateSocial(resolvido)
  };
}

module.exports = {
  TEMPLATE_OPTIMUS_ID,
  resolverTemplateSocial,
  snapshotTemplateSocial,
  payloadTemplatePersonalizadoSocial,
  templatePadraoCliente,
  listarTemplatesPersonalizados
};
