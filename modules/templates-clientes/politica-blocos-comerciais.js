"use strict";

const CLASSES_BLOCOS_COMERCIAIS = Object.freeze({
  PROTEGIDO_OBRIGATORIO: "protegido_obrigatorio",
  PROTEGIDO_QUANDO_NECESSARIO: "protegido_quando_necessario",
  AUTOMATICO_CONDICIONADO: "automatico_condicionado",
  OPCIONAL_VISUAL: "opcional_visual"
});

const ORIGENS_VALOR_COMERCIAL = Object.freeze({
  CAPTURADO: "capturado",
  DERIVADO: "derivado",
  FRASE_CAPTURADA: "frase_capturada",
  EDITORIAL_SISTEMA: "editorial_sistema",
  FALLBACK_TECNICO: "fallback_tecnico"
});

const PAPEIS_LINKS_COMERCIAIS = Object.freeze({
  LINK_PRODUTO: "link_produto",
  LINK_RESGATE: "link_resgate",
  LINK_APP: "link_app",
  LINK_MOEDAS: "link_moedas",
  LINK_PC: "link_pc"
});

const ALIASES_BLOCOS = Object.freeze({
  titulo: "titulo",
  title: "titulo",
  preco_por: "preco_por",
  preco_oferta: "preco_por",
  preco_efetivo: "preco_por",
  valor_efetivo: "preco_por",
  link: "link_afiliado",
  cta: "link_afiliado",
  link_afiliado: "link_afiliado",
  link_produto: "link_produto",
  link_produto_original: "link_produto",
  link_resgate: "link_resgate",
  link_app: "link_app",
  link_moedas: "link_moedas",
  link_pc: "link_pc",
  cupom: "cupom",
  cupom_codigo: "cupom",
  cupons_alternativos: "cupom",
  cupom_sem_codigo: "cupom",
  frase_cupom: "frase_cupom",
  instrucao_cupom: "frase_cupom",
  condicao_comercial: "condicao_comercial",
  requisito_preco: "condicao_comercial",
  preco_pix: "preco_pix",
  preco_final_condicionado: "preco_por",
  parcelamento: "parcelamento",
  preco_de: "preco_de",
  preco_referencia: "preco_de",
  desconto: "desconto_percentual",
  desconto_percentual: "desconto_percentual",
  economia: "economia",
  frete: "frete",
  cashback: "cashback",
  beneficio: "beneficio",
  beneficio_app: "beneficio",
  marketplace: "marketplace",
  categoria: "categoria",
  descricao: "descricao_adicional",
  descricao_adicional: "descricao_adicional",
  avaliacao: "avaliacao",
  avaliacao_nota: "avaliacao",
  quantidade_avaliacoes: "quantidade_avaliacoes",
  avaliacao_quantidade: "quantidade_avaliacoes",
  vendas: "vendas",
  aviso: "aviso_editorial",
  aviso_preco: "aviso_editorial",
  aviso_alteracao: "aviso_editorial",
  rodape: "rodape",
  texto_personalizado: "rodape"
});

const POLITICA_BASE = Object.freeze({
  titulo: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "identidade_comercial_da_oferta"
  },
  preco_por: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO, ORIGENS_VALOR_COMERCIAL.DERIVADO],
    motivo: "valor_efetivo_ou_preco_por_oficial"
  },
  link_afiliado: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "conversao_e_cta_principal_seguro"
  },
  link_produto: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "produto_canonico_seguro"
  },
  cupom: {
    classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO,
    classeNecessaria: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "cupom_so_e_protegido_quando_condiciona_preco"
  },
  frase_cupom: {
    classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL,
    classeNecessaria: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.FRASE_CAPTURADA, ORIGENS_VALOR_COMERCIAL.EDITORIAL_SISTEMA],
    motivo: "instrucao_capturada_ou_editorial_marcada"
  },
  preco_pix: {
    classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO,
    classeNecessaria: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO, ORIGENS_VALOR_COMERCIAL.DERIVADO],
    motivo: "pix_so_e_protegido_quando_condiciona_preco"
  },
  parcelamento: {
    classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO,
    classeNecessaria: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "parcelamento_pode_ser_condicao_ou_informativo"
  },
  link_resgate: {
    classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO,
    classeNecessaria: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "resgate_essencial_para_cupom_ou_beneficio"
  },
  link_app: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "cta_app_afiliado_seguro"
  },
  link_moedas: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "cta_moedas_afiliado_seguro"
  },
  link_pc: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: "cta_pc_afiliado_seguro"
  },
  condicao_comercial: {
    classe: CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.CAPTURADO, ORIGENS_VALOR_COMERCIAL.FRASE_CAPTURADA],
    motivo: "condicao_necessaria_para_fidelidade_do_preco"
  },
  preco_de: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  desconto_percentual: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  economia: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  frete: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  cashback: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  beneficio: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  marketplace: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  categoria: { classe: CLASSES_BLOCOS_COMERCIAIS.AUTOMATICO_CONDICIONADO },
  descricao_adicional: { classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL },
  avaliacao: { classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL },
  quantidade_avaliacoes: { classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL },
  vendas: { classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL },
  aviso_editorial: {
    classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.EDITORIAL_SISTEMA, ORIGENS_VALOR_COMERCIAL.CAPTURADO]
  },
  rodape: {
    classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL,
    origemPermitida: [ORIGENS_VALOR_COMERCIAL.EDITORIAL_SISTEMA]
  }
});

const CATALOGO_LINKS_COMERCIAIS = Object.freeze([
  { papel: PAPEIS_LINKS_COMERCIAIS.LINK_PRODUTO, descricao: "Produto principal afiliado seguro" },
  { papel: PAPEIS_LINKS_COMERCIAIS.LINK_RESGATE, descricao: "Resgate de cupom ou beneficio essencial" },
  { papel: PAPEIS_LINKS_COMERCIAIS.LINK_APP, descricao: "CTA de APP afiliado seguro" },
  { papel: PAPEIS_LINKS_COMERCIAIS.LINK_MOEDAS, descricao: "CTA de moedas afiliado seguro" },
  { papel: PAPEIS_LINKS_COMERCIAIS.LINK_PC, descricao: "CTA de PC afiliado seguro" }
]);

function normalizarTexto(valor = "") {
  return String(valor || "").trim().toLowerCase();
}

function normalizarTipoBloco(tipo = "") {
  const chave = normalizarTexto(tipo).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return ALIASES_BLOCOS[chave] || chave;
}

function contextoNecessario(contexto = {}) {
  return contexto.necessario === true ||
    contexto.essencial === true ||
    contexto.condicionaPreco === true ||
    contexto.comercialmenteNecessario === true ||
    contexto.fazParteValorAnunciado === true;
}

function classificarBlocoComercial(tipo = "", contexto = {}) {
  const tipoCanonico = normalizarTipoBloco(tipo);
  const regra = POLITICA_BASE[tipoCanonico] || { classe: CLASSES_BLOCOS_COMERCIAIS.OPCIONAL_VISUAL };
  const classe = contextoNecessario(contexto) && regra.classeNecessaria
    ? regra.classeNecessaria
    : regra.classe;
  return {
    tipo: tipoCanonico,
    classe,
    protegido: classe === CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_OBRIGATORIO ||
      classe === CLASSES_BLOCOS_COMERCIAIS.PROTEGIDO_QUANDO_NECESSARIO,
    origemPermitida: regra.origemPermitida || [ORIGENS_VALOR_COMERCIAL.CAPTURADO],
    motivo: regra.motivo || ""
  };
}

function togglePodeOcultarBloco(tipo = "", contexto = {}) {
  return !classificarBlocoComercial(tipo, contexto).protegido;
}

function listarCatalogoLinksComerciais() {
  return CATALOGO_LINKS_COMERCIAIS.map(item => ({ ...item }));
}

function papelLinkComercialOficial(papel = "") {
  const tipo = normalizarTipoBloco(papel);
  if (tipo === "link_produto") return PAPEIS_LINKS_COMERCIAIS.LINK_PRODUTO;
  if (tipo === "link_resgate") return PAPEIS_LINKS_COMERCIAIS.LINK_RESGATE;
  if (tipo === "link_app") return PAPEIS_LINKS_COMERCIAIS.LINK_APP;
  if (tipo === "link_moedas") return PAPEIS_LINKS_COMERCIAIS.LINK_MOEDAS;
  if (tipo === "link_pc") return PAPEIS_LINKS_COMERCIAIS.LINK_PC;
  return "";
}

module.exports = {
  CLASSES_BLOCOS_COMERCIAIS,
  ORIGENS_VALOR_COMERCIAL,
  PAPEIS_LINKS_COMERCIAIS,
  classificarBlocoComercial,
  listarCatalogoLinksComerciais,
  normalizarTipoBloco,
  papelLinkComercialOficial,
  togglePodeOcultarBloco
};
