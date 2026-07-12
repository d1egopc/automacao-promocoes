const crypto = require("crypto");
const { listarCatalogoBlocos } = require("./catalogo-blocos");
const { normalizarTemplatePayload } = require("./validator");
const { lerStorageTemplates, salvarTemplatesCliente } = require("./storage");
const { renderizarTemplatePersonalizado } = require("./renderer");
const { obterOfertaPreviewOficial } = require("./oferta-preview");

const TEMPLATE_PADRAO_OPTIMUS = Object.freeze({
  id: "padrao_optimus",
  nome: "Template padrao Optimus",
  tipo: "sistema",
  protegido: true,
  editavel: false,
  excluivel: false
});

function logTemplate(evento, dados = {}) {
  try {
    console.log(evento, JSON.stringify(dados));
  } catch {
    console.log(evento);
  }
}

function gerarTemplateId() {
  return `tpl_${crypto.randomBytes(8).toString("hex")}`;
}

function clonar(objeto) {
  return JSON.parse(JSON.stringify(objeto));
}

function listarTemplates(clienteId) {
  return {
    ok: true,
    padrao: { ...TEMPLATE_PADRAO_OPTIMUS },
    catalogo: listarCatalogoBlocos(),
    templates: lerStorageTemplates(clienteId).templates
  };
}

function buscarTemplate(clienteId, templateId) {
  const template = lerStorageTemplates(clienteId).templates.find(item => String(item.id) === String(templateId));
  if (!template) {
    const erro = new Error("template_nao_encontrado");
    erro.statusCode = 404;
    throw erro;
  }
  return template;
}

function criarTemplate(clienteId, payload = {}) {
  try {
    const atual = lerStorageTemplates(clienteId);
    const id = gerarTemplateId();
    const template = normalizarTemplatePayload(payload, { clienteId, id });
    const salvo = salvarTemplatesCliente(clienteId, [...atual.templates, template]);
    logTemplate("[TEMPLATE-CLIENTE-CRIADO]", { clienteId, templateId: template.id, quantidadeBlocos: template.blocos.length });
    return { ok: true, template, total: salvo.templates.length };
  } catch (e) {
    logTemplate("[TEMPLATE-CLIENTE-INVALIDO]", { clienteId, erro: e.codigo || e.message });
    throw e;
  }
}

function atualizarTemplate(clienteId, templateId, payload = {}) {
  try {
    const atual = lerStorageTemplates(clienteId);
    const index = atual.templates.findIndex(item => String(item.id) === String(templateId));
    if (index < 0) {
      const erro = new Error("template_nao_encontrado");
      erro.statusCode = 404;
      throw erro;
    }
    const template = normalizarTemplatePayload(payload, { clienteId, id: atual.templates[index].id, existente: atual.templates[index] });
    const templates = [...atual.templates];
    templates[index] = template;
    salvarTemplatesCliente(clienteId, templates);
    logTemplate("[TEMPLATE-CLIENTE-ATUALIZADO]", { clienteId, templateId: template.id, quantidadeBlocos: template.blocos.length });
    return { ok: true, template };
  } catch (e) {
    logTemplate("[TEMPLATE-CLIENTE-INVALIDO]", { clienteId, templateId, erro: e.codigo || e.message });
    throw e;
  }
}

function duplicarTemplate(clienteId, templateId) {
  const atual = lerStorageTemplates(clienteId);
  const origem = atual.templates.find(item => String(item.id) === String(templateId));
  if (!origem) {
    const erro = new Error("template_nao_encontrado");
    erro.statusCode = 404;
    throw erro;
  }
  const agora = new Date().toISOString();
  const nomeBase = String(origem.nome || "Template").trim();
  const template = {
    ...clonar(origem),
    id: gerarTemplateId(),
    nome: `${nomeBase} - Copia`.slice(0, 80),
    clienteId,
    criadoEm: agora,
    atualizadoEm: agora
  };
  salvarTemplatesCliente(clienteId, [...atual.templates, template]);
  logTemplate("[TEMPLATE-CLIENTE-DUPLICADO]", { clienteId, templateId: template.id, origemId: origem.id, quantidadeBlocos: template.blocos.length });
  return { ok: true, template };
}

function excluirTemplate(clienteId, templateId) {
  const atual = lerStorageTemplates(clienteId);
  const templates = atual.templates.filter(item => String(item.id) !== String(templateId));
  if (templates.length === atual.templates.length) {
    const erro = new Error("template_nao_encontrado");
    erro.statusCode = 404;
    throw erro;
  }
  salvarTemplatesCliente(clienteId, templates);
  logTemplate("[TEMPLATE-CLIENTE-EXCLUIDO]", { clienteId, templateId });
  return { ok: true, templateId };
}

function previewTemplate(clienteId, payload = {}) {
  try {
    const canal = payload.canal || "whatsapp";
    const templatePayload = payload.template || payload;
    const template = normalizarTemplatePayload(templatePayload, { clienteId, id: "preview_template" });
    const resultado = renderizarTemplatePersonalizado({ oferta: obterOfertaPreviewOficial(), template, canal });
    logTemplate("[TEMPLATE-PREVIEW]", {
      clienteId,
      templateId: template.id,
      canal,
      quantidadeBlocos: template.blocos.length,
      blocosRenderizados: resultado.blocosRenderizados,
      blocosIgnorados: resultado.blocosIgnorados
    });
    return { ...resultado, template };
  } catch (e) {
    logTemplate("[TEMPLATE-CLIENTE-INVALIDO]", { clienteId, erro: e.codigo || e.message });
    throw e;
  }
}

module.exports = {
  TEMPLATE_PADRAO_OPTIMUS,
  gerarTemplateId,
  listarTemplates,
  buscarTemplate,
  criarTemplate,
  atualizarTemplate,
  duplicarTemplate,
  excluirTemplate,
  previewTemplate
};
