"use strict";

const { buscarTemplate } = require("../templates-clientes/service");
const { TEMPLATE_PADRAO_ID, normalizarTemplateIdDestino } = require("../templates-clientes/resolver");
const {
  montarTemplateEspelhoPorBlocosV26,
  montarTemplateEspelhoShadow
} = require("./espelho-comercial");

const WORKSPACE_D1EGOPC_OFICIAL = "user_40qdblgt";

const CONFIGURACAO_ESPELHO_PILOTO = Object.freeze({
  [WORKSPACE_D1EGOPC_OFICIAL]: Object.freeze({
    ativo: true,
    workspaceId: WORKSPACE_D1EGOPC_OFICIAL,
    nome: "D1EGOPC OFICIAL",
    modo: "piloto_produtivo_controlado"
  })
});

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function metadataOfcV24(oferta = {}) {
  const metadata = objeto(oferta.metadata);
  return objeto(metadata.ofcV24 || oferta.ofcV24);
}

function obterConfiguracaoEspelhoPiloto(workspaceId = "") {
  const chave = texto(workspaceId);
  const config = CONFIGURACAO_ESPELHO_PILOTO[chave];
  if (!config?.ativo) {
    return { ativo: false, workspaceId: chave, motivo: "workspace_fora_do_piloto" };
  }
  return { ...config };
}

function sanitizarErro(erro) {
  return texto(erro?.message || erro || "erro_desconhecido").slice(0, 160);
}

function logSeguro(tag = "", payload = {}) {
  try {
    console.log(tag, JSON.stringify(payload));
  } catch (_) {
    // log fail-open: observabilidade nao pode interferir no envio.
  }
}

function mensagemValida(mensagem = "") {
  const msg = texto(mensagem);
  if (!msg) return false;
  if (/\b(?:undefined|null|NaN|Infinity)\b/i.test(msg)) return false;
  if (/\n{3,}/.test(msg)) return false;
  return true;
}

function obterTemplateEspelho(oferta = {}) {
  const ofcV24 = metadataOfcV24(oferta);
  return objeto(ofcV24.templateEspelhoShadow || ofcV24.templateEspelho || oferta.templateEspelhoShadow);
}

function obterEspelho(oferta = {}) {
  const ofcV24 = metadataOfcV24(oferta);
  return objeto(ofcV24.espelhoComercial || oferta.espelhoComercialV24);
}

function obterDocumentoCanonico(oferta = {}) {
  const ofcV24 = metadataOfcV24(oferta);
  const espelho = obterEspelho(oferta);
  return objeto(ofcV24.documentoComercialCanonico || espelho.documentoComercialCanonico || oferta.documentoComercialCanonicoV24);
}

function obterImagemComercial(oferta = {}) {
  const ofcV24 = metadataOfcV24(oferta);
  return objeto(ofcV24.imagemComercial || oferta.imagemComercialV24);
}

function resolverTemplateToggles({ workspaceId = "", destino = {}, template = null } = {}) {
  const direto = objeto(template || destino.template || destino.templateMensagem || destino.templateOferta);
  if (Array.isArray(direto.blocos)) return direto;
  if (Array.isArray(destino.blocos)) return { blocos: destino.blocos, rodape: destino.rodape };

  const templateId = normalizarTemplateIdDestino(destino);
  if (!templateId || templateId === TEMPLATE_PADRAO_ID) return {};

  try {
    return buscarTemplate(workspaceId, templateId);
  } catch (_) {
    return {};
  }
}

function resumoBase({ workspaceId = "", oferta = {}, config = {} } = {}) {
  const espelho = obterEspelho(oferta);
  return {
    workspaceId: texto(workspaceId),
    workspaceNome: config.nome || "",
    ofertaId: oferta.engineOfertaId || oferta.id || oferta.ofertaId || null,
    jobId: oferta.engineJobId || oferta.job_id || oferta.jobId || null,
    marketplace: texto(oferta.marketplace || espelho.marketplace || ""),
    temPreco: Boolean(espelho.precoFinalTexto || espelho.precoPorTexto || espelho.precoPorValor || espelho.precoFinalValor),
    temCupom: Boolean(espelho.cupomCodigo),
    temPix: /pix/i.test(`${espelho.formaPagamentoTexto || ""} ${(espelho.condicoesComerciais || []).join(" ")}`),
    temResgate: Boolean(espelho.linkResgateOriginal),
    aplicouMudancasOperacionais: false
  };
}

function resumoBlocosCanonicosV26(template = null) {
  const blocos = Array.isArray(template?.blocosRenderizados) ? template.blocosRenderizados : [];
  return {
    totalBlocos: Array.isArray(template?.blocosOriginais) ? template.blocosOriginais.length : null,
    tiposRenderizados: blocos.slice(0, 20),
    totalEssenciais: Number.isFinite(Number(template?.totalEssenciais)) ? Number(template.totalEssenciais) : null
  };
}

function selecionarTemplateEspelhoPiloto({
  workspaceId = "",
  oferta = {},
  mensagemAtual = "",
  destino = {},
  template = null,
  canal = "whatsapp"
} = {}) {
  const config = obterConfiguracaoEspelhoPiloto(workspaceId || oferta.clienteId || oferta.cliente_id);
  if (!config.ativo) {
    return {
      usarEspelho: false,
      ativo: false,
      mensagem: mensagemAtual,
      motivo: config.motivo || "workspace_fora_do_piloto",
      aplicouMudancasOperacionais: false
    };
  }

  let base = {
    workspaceId: config.workspaceId,
    workspaceNome: config.nome || "",
    ofertaId: oferta.engineOfertaId || oferta.id || oferta.ofertaId || null,
    jobId: oferta.engineJobId || oferta.job_id || oferta.jobId || null,
    marketplace: texto(oferta.marketplace || ""),
    aplicouMudancasOperacionais: false
  };

  try {
    base = resumoBase({ workspaceId: config.workspaceId, oferta, config });
    logSeguro("[OFC-V2.4-ESPELHO-PILOTO-ATIVO]", {
      ...base,
      modo: config.modo,
      pilotoAtivo: true
    });

    const templateAtual = obterTemplateEspelho(oferta);
    const espelho = obterEspelho(oferta);
    const documento = obterDocumentoCanonico(oferta);
    const temDocumento = Boolean(documento && Object.keys(documento).length);
    const templateCliente = resolverTemplateToggles({ workspaceId: config.workspaceId, destino, template });
    let templatePorBlocos = null;
    if (temDocumento && Array.isArray(documento.blocos)) {
      try {
        templatePorBlocos = montarTemplateEspelhoPorBlocosV26(espelho, documento, {
          template: templateCliente,
          canal
        });
      } catch (erroBlocos) {
        logSeguro("[OFC-V2.6-COMPOSITOR-BLOCOS-ERRO]", {
          ...base,
          totalBlocos: Array.isArray(documento.blocos) ? documento.blocos.length : 0,
          fallback: "template_espelho_plano",
          motivo: "erro_compositor_blocos",
          erro: sanitizarErro(erroBlocos),
          aplicouMudancasOperacionais: false
        });
      }
    }
    if (templatePorBlocos?.ok === true && mensagemValida(templatePorBlocos.mensagem)) {
      logSeguro("[OFC-V2.6-COMPOSITOR-BLOCOS-SELECIONADO]", {
        ...base,
        ...resumoBlocosCanonicosV26(templatePorBlocos),
        fallback: false,
        motivo: templatePorBlocos.motivo || "documento_canonico_blocos_v26_valido",
        aplicouMudancasOperacionais: true
      });
      return {
        usarEspelho: true,
        ativo: true,
        mensagem: templatePorBlocos.mensagem,
        motivo: templatePorBlocos.motivo || "documento_canonico_blocos_v26_valido",
        aplicouMudancasOperacionais: false
      };
    }
    if (Array.isArray(documento.blocos) && documento.blocos.length) {
      logSeguro("[OFC-V2.6-COMPOSITOR-BLOCOS-FALLBACK]", {
        ...base,
        totalBlocos: documento.blocos.length,
        tiposRenderizados: [],
        totalEssenciais: documento.blocos.filter(bloco => bloco?.essencial === true).length,
        fallback: "template_espelho_plano",
        motivo: templatePorBlocos?.motivo || "compositor_blocos_indisponivel",
        aplicouMudancasOperacionais: false
      });
    }
    const templateAdaptativo = temDocumento
      ? montarTemplateEspelhoShadow(espelho, documento, {
        template: templateCliente,
        canal,
        contexto: {
          categoria: oferta.categoria,
          score: oferta.score || oferta.avaliacao,
          economia: oferta.economia,
          avisoPreco: oferta.avisoPreco,
          avisoAlteracao: oferta.avisoAlteracao,
          aviso: oferta.aviso
        }
      })
      : null;
    const mensagem = texto(templateAdaptativo?.mensagem || templateAtual.mensagem);
    const valido = (templateAdaptativo?.ok === true || templateAtual.ok === true) &&
      mensagemValida(mensagem) &&
      Boolean(espelho && Object.keys(espelho).length);

    if (!valido) {
      logSeguro("[OFC-V2.4-TEMPLATE-ATUAL-FALLBACK]", {
        ...base,
        motivo: templateAdaptativo?.ok === false || templateAtual.ok === false ? "template_espelho_invalido" : "template_espelho_indisponivel",
        tamanhoTemplateEspelho: mensagem.length
      });
      return {
        usarEspelho: false,
        ativo: true,
        mensagem: mensagemAtual,
        motivo: templateAdaptativo?.ok === false || templateAtual.ok === false ? "template_espelho_invalido" : "template_espelho_indisponivel",
        aplicouMudancasOperacionais: false
      };
    }

    logSeguro("[OFC-V2.4-TEMPLATE-ESPELHO-SELECIONADO]", {
      ...base,
      motivo: temDocumento ? "documento_canonico_adaptativo_valido" : "espelho_comercial_valido",
      tamanhoMensagem: mensagem.length,
      linhas: templateAdaptativo?.linhas || templateAtual.linhas || null,
      blocosRenderizados: Array.isArray(templateAdaptativo?.blocosRenderizados) ? templateAdaptativo.blocosRenderizados : undefined
    });

    return {
      usarEspelho: true,
      ativo: true,
      mensagem,
      motivo: temDocumento ? "documento_canonico_adaptativo_valido" : "espelho_comercial_valido",
      aplicouMudancasOperacionais: false
    };
  } catch (erro) {
    logSeguro("[OFC-V2.4-ESPELHO-PILOTO-ERRO]", {
      ...base,
      motivo: "erro_selecao_template_espelho",
      erro: sanitizarErro(erro)
    });
    return {
      usarEspelho: false,
      ativo: true,
      mensagem: mensagemAtual,
      motivo: "erro_selecao_template_espelho",
      erro: sanitizarErro(erro),
      aplicouMudancasOperacionais: false
    };
  }
}

function selecionarImagemEspelhoPiloto({ workspaceId = "", oferta = {}, imagemAtual = "" } = {}) {
  const config = obterConfiguracaoEspelhoPiloto(workspaceId || oferta.clienteId || oferta.cliente_id);
  if (!config.ativo) {
    return {
      usarImagemEspelho: false,
      imagem: imagemAtual,
      motivo: config.motivo || "workspace_fora_do_piloto",
      aplicouMudancasOperacionais: false
    };
  }

  try {
    const imagem = obterImagemComercial(oferta);
    const url = texto(imagem.urlSelecionada);
    const segura = Boolean(url && imagem.imagemLimpa === true && imagem.imagemOficial === true && imagem.possuiMarcaFonte !== true);
    if (!segura) {
      return {
        usarImagemEspelho: false,
        imagem: imagemAtual,
        motivo: "imagem_espelho_nao_segura",
        aplicouMudancasOperacionais: false
      };
    }
    return {
      usarImagemEspelho: true,
      imagem: url,
      motivo: "imagem_espelho_oficial_limpa",
      origem: imagem.origemSelecionada || "",
      aplicouMudancasOperacionais: false
    };
  } catch (erro) {
    logSeguro("[OFC-V2.4-ESPELHO-PILOTO-ERRO]", {
      workspaceId: config.workspaceId,
      workspaceNome: config.nome,
      ofertaId: oferta.engineOfertaId || oferta.id || oferta.ofertaId || null,
      motivo: "erro_selecao_imagem_espelho",
      erro: sanitizarErro(erro),
      aplicouMudancasOperacionais: false
    });
    return {
      usarImagemEspelho: false,
      imagem: imagemAtual,
      motivo: "erro_selecao_imagem_espelho",
      erro: sanitizarErro(erro),
      aplicouMudancasOperacionais: false
    };
  }
}

module.exports = {
  WORKSPACE_D1EGOPC_OFICIAL,
  CONFIGURACAO_ESPELHO_PILOTO,
  obterConfiguracaoEspelhoPiloto,
  selecionarTemplateEspelhoPiloto,
  selecionarImagemEspelhoPiloto
};

