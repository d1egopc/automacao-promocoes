const { listarTemplatesCliente } = require("./storage");
const { renderizarTemplatePersonalizado } = require("./renderer");

const TEMPLATE_PADRAO_ID = "padrao_optimus";

function logTemplateResolver(evento, dados = {}) {
  try {
    console.log(evento, JSON.stringify(dados));
  } catch {
    console.log(evento);
  }
}

function texto(valor = "") {
  return String(valor || "").trim();
}

function normalizarCanal(canal = "", destino = {}) {
  const valor = texto(canal || destino.canal || destino.tipo || destino.plataforma || destino.provider).toLowerCase();
  if (valor.includes("telegram")) return "telegram";
  if (valor.includes("social") || valor.includes("instagram") || valor.includes("facebook")) return "social";
  return "whatsapp";
}

function normalizarTemplateIdDestino(destino = {}) {
  const id = texto(destino?.templateId);
  if (!id) return null;
  if (id === TEMPLATE_PADRAO_ID) return TEMPLATE_PADRAO_ID;
  if (/^tpl_[a-zA-Z0-9_-]+$/.test(id)) return id;
  return null;
}

function resultadoUniversal(motivo, contexto = {}) {
  logTemplateResolver("[TEMPLATE-FALLBACK-UNIVERSAL]", {
    clienteId: contexto.clienteId,
    templateId: contexto.templateId || null,
    canal: contexto.canal,
    motivo
  });

  return {
    ok: false,
    usarUniversal: true,
    motivo,
    mensagem: "",
    templateIdUsado: null
  };
}

function recursoTemplateHabilitado(valor) {
  return valor !== false;
}

function resolverTemplateMensagem({
  clienteId = "admin",
  destino = {},
  oferta = {},
  canal = "",
  templatePersonalizadoHabilitado = true
} = {}) {
  const canalNormalizado = normalizarCanal(canal, destino);
  const templateId = normalizarTemplateIdDestino(destino);
  const contexto = { clienteId, templateId, canal: canalNormalizado };

  if (!templateId || templateId === TEMPLATE_PADRAO_ID) {
    logTemplateResolver("[TEMPLATE-RESOLVIDO]", {
      ...contexto,
      tipo: "universal"
    });
    return resultadoUniversal(templateId === TEMPLATE_PADRAO_ID ? "template_padrao" : "template_ausente", contexto);
  }

  if (!recursoTemplateHabilitado(templatePersonalizadoHabilitado)) {
    logTemplateResolver("[TEMPLATE-FALLBACK-RECURSO-DESABILITADO]", {
      clienteId,
      destinoId: destino.id || null,
      templateId
    });
    return resultadoUniversal("recurso_desabilitado", contexto);
  }

  const template = listarTemplatesCliente(clienteId).find(item => String(item.id) === String(templateId));
  if (!template) {
    logTemplateResolver("[TEMPLATE-NAO-ENCONTRADO]", contexto);
    return resultadoUniversal("template_nao_encontrado", contexto);
  }

  if (template.clienteId && String(template.clienteId) !== String(clienteId)) {
    return resultadoUniversal("template_cliente_diferente", contexto);
  }

  if (template.ativo === false) {
    return resultadoUniversal("template_inativo", contexto);
  }

  const canais = Array.isArray(template.canais) ? template.canais : [];
  if (canais.length && !canais.includes(canalNormalizado)) {
    logTemplateResolver("[TEMPLATE-CANAL-INCOMPATIVEL]", contexto);
    return resultadoUniversal("template_canal_incompativel", contexto);
  }

  const renderizado = renderizarTemplatePersonalizado({
    oferta,
    template,
    canal: canalNormalizado
  });

  if (!renderizado.ok || !texto(renderizado.mensagem)) {
    return resultadoUniversal(renderizado.erro || "template_personalizado_vazio", contexto);
  }

  logTemplateResolver("[TEMPLATE-RESOLVIDO]", {
    ...contexto,
    tipo: "personalizado"
  });

  logTemplateResolver("[TEMPLATE-PERSONALIZADO]", {
    ...contexto,
    blocosRenderizados: renderizado.blocosRenderizados,
    blocosIgnorados: renderizado.blocosIgnorados
  });

  return {
    ok: true,
    usarUniversal: false,
    motivo: "template_personalizado",
    mensagem: renderizado.mensagem,
    templateIdUsado: renderizado.templateIdUsado || template.id,
    blocosRenderizados: renderizado.blocosRenderizados,
    blocosIgnorados: renderizado.blocosIgnorados
  };
}

module.exports = {
  TEMPLATE_PADRAO_ID,
  normalizarCanal,
  normalizarTemplateIdDestino,
  recursoTemplateHabilitado,
  resolverTemplateMensagem
};
