"use strict";

const {
  criarRepositorioIdentidadeVisualOfertas,
  normalizarConfigIdentidadeVisual
} = require("./repository");
const {
  POLITICAS_IDENTIDADE_VISUAL_OFERTAS,
  resolverPoliticaIdentidadeVisualPlano
} = require("./politica");

const CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS = Object.freeze({
  ativo: true,
  logo: "optimus_oficial",
  frase: "AS MELHORES OFERTAS, EM UM SÓ LUGAR",
  corFaixa: "#111827",
  corTexto: "#FFFFFF"
});

const CAMPOS_CONFIG_EDITAVEIS = ["logo", "frase", "corFaixa", "corTexto"];

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clonar(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function erroIdentidadeVisual(codigo, statusCode = 400) {
  const erro = new Error(codigo);
  erro.codigo = codigo;
  erro.statusCode = statusCode;
  return erro;
}

function resolverPlanoIdentidadeVisual(clienteId = "admin", deps = {}) {
  if (deps.plano && typeof deps.plano === "object") return deps.plano;
  if (typeof deps.getPlanoCliente === "function") return deps.getPlanoCliente(clienteId) || {};
  if (typeof deps.resolverPlanoCliente === "function") return deps.resolverPlanoCliente(clienteId) || {};
  if (typeof deps.resolverPlanoManualV2 === "function") return deps.resolverPlanoManualV2(clienteId) || {};
  return {};
}

function montarConfigEfetiva(configWorkspace = {}, politicaResolvida = {}) {
  const config = {
    ...CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
    ...normalizarConfigIdentidadeVisual(configWorkspace)
  };

  if (!politicaResolvida.habilitada) {
    return {
      ...config,
      ativo: false
    };
  }

  if (politicaResolvida.obrigatoria) {
    return {
      ...config,
      ativo: true
    };
  }

  return {
    ...config,
    ativo: config.ativo !== false
  };
}

function criarServicoIdentidadeVisualOfertas(deps = {}) {
  const repository = deps.repository || criarRepositorioIdentidadeVisualOfertas(deps);

  function resolverPolitica(clienteId = "admin", opcoes = {}) {
    const plano = resolverPlanoIdentidadeVisual(clienteId, { ...deps, ...opcoes });
    return resolverPoliticaIdentidadeVisualPlano(plano);
  }

  function resolverConfig(clienteId = "admin", opcoes = {}) {
    const politica = resolverPolitica(clienteId, opcoes);
    const configWorkspace = repository.lerConfig(clienteId);
    const configEfetiva = montarConfigEfetiva(configWorkspace, politica);

    return {
      politica: politica.politica,
      habilitada: politica.habilitada,
      obrigatoria: politica.obrigatoria,
      editavel: politica.editavel,
      podeDesligar: politica.podeDesligar,
      config: configWorkspace,
      configPadrao: clonar(CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS),
      configEfetiva
    };
  }

  function atualizarConfig(clienteId = "admin", patch = {}, opcoes = {}) {
    const politica = resolverPolitica(clienteId, opcoes);
    const alteracoes = normalizarConfigIdentidadeVisual(patch);
    const querAlterarAtivo = Object.prototype.hasOwnProperty.call(patch || {}, "ativo");
    const querEditarVisual = CAMPOS_CONFIG_EDITAVEIS.some(campo =>
      Object.prototype.hasOwnProperty.call(patch || {}, campo)
    );

    if (politica.politica === POLITICAS_IDENTIDADE_VISUAL_OFERTAS.DESABILITADA) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_desabilitada", 403);
    }

    if (querEditarVisual && !politica.editavel) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_edicao_bloqueada", 403);
    }

    if (querAlterarAtivo && alteracoes.ativo === false && !politica.podeDesligar) {
      throw erroIdentidadeVisual("identidade_visual_ofertas_nao_pode_desligar", 403);
    }

    if (politica.obrigatoria) {
      alteracoes.ativo = true;
    }

    repository.atualizarConfig(clienteId, alteracoes);
    return resolverConfig(clienteId, opcoes);
  }

  async function aplicarIdentidadeVisualOferta({ clienteId = "admin", oferta = {}, imagemAtual = "", contexto = {} } = {}, opcoes = {}) {
    const imagemOriginal = texto(imagemAtual || oferta.imagem || oferta.imagemUrl || "");
    const resolucao = resolverConfig(clienteId, opcoes);

    if (!resolucao.habilitada) {
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "politica_desabilitada",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        contexto
      };
    }

    if (!resolucao.configEfetiva.ativo) {
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "config_inativa",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        contexto
      };
    }

    if (!imagemOriginal) {
      return {
        aplicada: false,
        imagemOriginal,
        imagemFinal: imagemOriginal,
        motivo: "imagem_ausente",
        politica: resolucao.politica,
        configEfetiva: resolucao.configEfetiva,
        contexto
      };
    }

    return {
      aplicada: false,
      imagemOriginal,
      imagemFinal: imagemOriginal,
      motivo: "renderer_nao_implementado",
      politica: resolucao.politica,
      configEfetiva: resolucao.configEfetiva,
      contexto
    };
  }

  return {
    resolverConfig,
    atualizarConfig,
    aplicarIdentidadeVisualOferta
  };
}

const servicoPadrao = criarServicoIdentidadeVisualOfertas();

module.exports = {
  CONFIG_PADRAO_IDENTIDADE_VISUAL_OFERTAS,
  criarServicoIdentidadeVisualOfertas,
  resolverConfigIdentidadeVisualOferta: servicoPadrao.resolverConfig,
  atualizarConfigIdentidadeVisualOferta: servicoPadrao.atualizarConfig,
  aplicarIdentidadeVisualOferta: servicoPadrao.aplicarIdentidadeVisualOferta
};
