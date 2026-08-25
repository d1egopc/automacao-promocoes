const express = require("express");

const {
  otimizarBase64
} = require("./imagem");

function criarRotasMensageiro(deps = {}) {
  const router = express.Router();

const {
  getClienteId,
  getPlanoUsuario,
  usuarioTemRecurso,
  getMensageiroCliente,
  setMensageiroCliente,
  getAtendimentoConfigCliente,
  setAtendimentoConfigCliente,
  encontrarGatilhoAtendimento,
  validarPerfisMensageiro,
  listarInfracoesGerenteCliente,
  zerarInfracaoGerenteCliente,
  listarUltimosMotivosGerenteCliente,
  referenciaGrupoGerente,
  listarSessoesMensageiro,
  listarGruposSessaoMensageiro,
  getSockMensageiro
} = deps;

function normalizarAtendimentoMensageiro(dados = {}) {
  const atendimento = dados && typeof dados === "object" ? dados : {};
  const respostasRapidas = Array.isArray(atendimento.respostasRapidas)
    ? atendimento.respostasRapidas
    : [];

  return {
    ativo: atendimento.ativo === true || atendimento.atendimentoAtivo === true,
    atendimentoAtivo: atendimento.ativo === true || atendimento.atendimentoAtivo === true,
    sessaoId: String(atendimento.sessaoAtendimentoId || atendimento.sessaoId || ""),
    sessaoAtendimentoId: String(atendimento.sessaoAtendimentoId || atendimento.sessaoId || ""),
    delaySegundos: Math.max(0, Number(atendimento.delaySegundos || 2) || 0),
    escopo: "privado",
    gatilhos: Array.isArray(atendimento.gatilhos) ? atendimento.gatilhos : [],
    respostasRapidas: respostasRapidas.map((item, index) => {
      const nome = String(
        item.nome ||
        item.resposta?.nome ||
        item.titulo ||
        ""
      ).trim();
      const respostaTipo = item.resposta?.tipo || item.tipo || "texto";
      const respostaConteudo =
        item.resposta?.conteudo ??
        item.resposta?.mensagem ??
        item.mensagem ??
        item.conteudo ??
        "";

      return {
        id: item.id || `resposta_${Date.now()}_${index}`,
        nome,
        ativo: item.ativo !== false,
        gatilhos: Array.isArray(item.gatilhos)
          ? item.gatilhos.map(g => String(g || "").trim()).filter(Boolean)
          : [],
        tipoCorrespondencia: item.tipoCorrespondencia || "contem",
        resposta: {
          tipo: respostaTipo,
          conteudo: String(respostaConteudo || ""),
          nome
        }
      };
    }).filter(item => item.gatilhos.length && item.resposta.conteudo)
  };
}

function mensageiroPermitido(req, clienteId) {
  return (
    clienteId === "admin" ||
    usuarioTemRecurso(req, "mensageiro")
  );
}

function normalizarTextoCurto(valor = "", limite = 120) {
  return String(valor || "").replace(/\s+/g, " ").trim().slice(0, limite);
}

function normalizarGrupoStatusGerente(grupo = {}) {
  const raw = grupo && typeof grupo === "object" ? grupo : {};
  const grupoId = String(raw.grupoId || raw.id || raw.jid || raw.remoteJid || raw.value || "").trim();
  return {
    grupoId,
    grupoRef: typeof referenciaGrupoGerente === "function" ? referenciaGrupoGerente(grupoId) : grupoId,
    nome: normalizarTextoCurto(raw.nome || raw.name || raw.subject || raw.titulo || raw.label || "Grupo sem nome")
  };
}

function normalizarJidBaseGerente(jid = "") {
  return String(jid || "").split(":")[0].trim();
}

function participanteAdminGerente(participante = {}) {
  const admin = String(participante?.admin || "").toLowerCase();
  return admin === "admin" || admin === "superadmin";
}

function botEhAdminMetadataGerente(sock, metadata = {}) {
  const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];
  const idsBot = new Set([
    normalizarJidBaseGerente(sock?.user?.id || ""),
    normalizarJidBaseGerente(sock?.user?.jid || ""),
    normalizarJidBaseGerente(sock?.authState?.creds?.me?.id || ""),
    normalizarJidBaseGerente(sock?.authState?.creds?.me?.jid || "")
  ].filter(Boolean));
  const bot = participantes.find(participante => idsBot.has(normalizarJidBaseGerente(participante?.id || participante?.jid || "")));
  return participanteAdminGerente(bot);
}

async function resolverPermissaoAdminGerente({ clienteId, sessaoId, grupoId }) {
  if (typeof getSockMensageiro !== "function") {
    return { estado: "metadata_indisponivel", permissao: "nao_verificado" };
  }
  const sessao = getSockMensageiro(clienteId, sessaoId);
  const sock = sessao?.sock || sessao;
  if (!sock || typeof sock.groupMetadata !== "function") {
    return { estado: "metadata_indisponivel", permissao: "nao_verificado" };
  }
  try {
    const metadata = await sock.groupMetadata(grupoId);
    const botAdmin = botEhAdminMetadataGerente(sock, metadata);
    return botAdmin
      ? { estado: "bot_admin", permissao: "administrador" }
      : { estado: "bot_sem_admin", permissao: "sem_permissao" };
  } catch {
    return { estado: "metadata_indisponivel", permissao: "nao_verificado" };
  }
}

async function montarStatusGerentePerfil({ clienteId, perfil = {}, sessoesValidas = [], ultimosMotivos = [] } = {}) {
  const gerente = perfil?.modulos?.gerente || {};
  const configuracao = gerente.configuracao || {};
  const regras = Array.isArray(configuracao.regras) ? configuracao.regras : [];
  const regrasAtivas = regras.filter(regra => regra?.ativo === true).length;
  const sessaoId = String(perfil?.sessaoId || perfil?.sessaoWhatsappId || perfil?.sessaoGruposId || "").trim();
  const sessaoExiste = !Array.isArray(sessoesValidas) || !sessoesValidas.length
    ? Boolean(sessaoId)
    : sessoesValidas.some(sessao => String(sessao?.id || sessao?.sessaoId || "") === sessaoId);
  const gruposCatalogo = typeof listarGruposSessaoMensageiro === "function"
    ? listarGruposSessaoMensageiro(clienteId, sessaoId)
    : [];
  const gruposPorId = new Map(
    (Array.isArray(gruposCatalogo) ? gruposCatalogo : [])
      .map(normalizarGrupoStatusGerente)
      .filter(grupo => grupo.grupoId)
      .map(grupo => [grupo.grupoId, grupo])
  );
  const gruposPerfil = Array.isArray(perfil?.grupos) ? perfil.grupos.map(item => String(item || "").trim()).filter(Boolean) : [];
  const motivosPorGrupo = new Map(
    ultimosMotivos
      .filter(item => item?.perfilId === perfil?.id)
      .map(item => [String(item.grupoId || ""), item])
  );

  const grupos = [];
  for (const grupoId of gruposPerfil) {
    const catalogo = gruposPorId.get(grupoId) || normalizarGrupoStatusGerente({ id: grupoId, nome: "Grupo selecionado" });
    const estados = [];
    let estado = "pronto_para_moderar";
    let permissao = "nao_verificado";
    let admin = false;

    if (perfil?.ativo !== true) {
      estado = "perfil_inativo";
      estados.push("perfil_inativo");
    } else if (!sessaoExiste) {
      estado = "sessao_divergente";
      estados.push("sessao_divergente");
    } else if (!gruposPerfil.includes(grupoId)) {
      estado = "grupo_fora_do_perfil";
      estados.push("grupo_fora_do_perfil");
    } else if (gerente.ativo !== true) {
      estado = "gerente_inativo";
      estados.push("gerente_inativo");
    } else if (!regrasAtivas) {
      estado = "sem_regras_ativas";
      estados.push("gerente_ativo", "sem_regras_ativas");
    } else {
      estados.push("gerente_ativo");
      const permissaoAdmin = await resolverPermissaoAdminGerente({ clienteId, sessaoId, grupoId });
      permissao = permissaoAdmin.permissao;
      admin = permissaoAdmin.estado === "bot_admin";
      estados.push(permissaoAdmin.estado);
      estado = admin ? "pronto_para_moderar" : permissaoAdmin.estado;
      if (admin) estados.push("pronto_para_moderar");
    }

    const ultimo = motivosPorGrupo.get(catalogo.grupoRef) || null;
    grupos.push({
      grupoRef: catalogo.grupoRef,
      nome: catalogo.nome,
      sessaoId,
      gerenteAtivo: gerente.ativo === true,
      regrasAtivas,
      permissao,
      admin,
      estado,
      estados: [...new Set(estados)],
      ultimoMotivo: ultimo?.codigo || "",
      ultimoMotivoEm: ultimo?.timestamp || ""
    });
  }

  const semPermissao = grupos.filter(grupo => grupo.estado === "bot_sem_admin").length;
  const naoVerificados = grupos.filter(grupo => grupo.estado === "metadata_indisponivel").length;
  const prontos = grupos.filter(grupo => grupo.estado === "pronto_para_moderar").length;
  const estadoResumo = gerente.ativo !== true
    ? "gerente_inativo"
    : perfil?.ativo !== true
      ? "perfil_inativo"
      : !regrasAtivas
        ? "sem_regras_ativas"
        : semPermissao
          ? "bot_sem_admin"
          : naoVerificados
            ? "metadata_indisponivel"
            : prontos
              ? "pronto_para_moderar"
              : "grupo_fora_do_perfil";

  return {
    perfilId: String(perfil?.id || ""),
    perfilNome: normalizarTextoCurto(perfil?.nome || "Perfil"),
    gerenteAtivo: gerente.ativo === true,
    perfilAtivo: perfil?.ativo === true,
    sessaoId,
    regrasAtivas,
    gruposSelecionados: gruposPerfil.length,
    estado: estadoResumo,
    permissaoResumo: semPermissao
      ? "sem_permissao"
      : naoVerificados
        ? "nao_verificado"
        : prontos
          ? "administrador"
          : "nao_verificado",
    grupos
  };
}

async function otimizarImagensComandos(comandos = []) {
  if (!Array.isArray(comandos)) return [];

  return Promise.all(comandos.map(async (comando) => {
    const resposta = comando?.resposta && typeof comando.resposta === "object"
      ? comando.resposta
      : {};

    return {
      ...comando,
      resposta: {
        ...resposta,
        imagem: await otimizarBase64(resposta.imagem)
      }
    };
  }));
}

async function otimizarImagensProgramacoes(programacoes = []) {
  if (!Array.isArray(programacoes)) return [];

  return Promise.all(programacoes.map(async (programacao) => ({
    ...programacao,
    conteudos: await Promise.all((Array.isArray(programacao?.conteudos) ? programacao.conteudos : []).map(async (conteudo) => ({
      ...conteudo,
      imagem: await otimizarBase64(conteudo?.imagem)
    })))
  })));
}

async function otimizarImagensPerfis(perfis = []) {
  if (!Array.isArray(perfis)) return [];

  return Promise.all(perfis.map(async (perfil) => {
    const modulos = perfil?.modulos && typeof perfil.modulos === "object" ? perfil.modulos : {};
    const boasVindas = modulos.boasVindas && typeof modulos.boasVindas === "object" ? modulos.boasVindas : {};
    const despedida = modulos.despedida && typeof modulos.despedida === "object" ? modulos.despedida : {};
    const boasVindasConfig = boasVindas.configuracao && typeof boasVindas.configuracao === "object" ? boasVindas.configuracao : {};
    const despedidaConfig = despedida.configuracao && typeof despedida.configuracao === "object" ? despedida.configuracao : {};

    return {
      ...perfil,
      modulos: {
        ...modulos,
        boasVindas: {
          ...boasVindas,
          configuracao: {
            ...boasVindasConfig,
            imagem: await otimizarBase64(boasVindasConfig.imagem)
          }
        },
        despedida: {
          ...despedida,
          configuracao: {
            ...despedidaConfig,
            imagem: await otimizarBase64(despedidaConfig.imagem)
          }
        }
      }
    };
  }));
}

function montarContextoValidacaoPerfis(clienteId, perfis = [], configAtual = {}) {
  const sessoesValidas = typeof listarSessoesMensageiro === "function"
    ? listarSessoesMensageiro(clienteId)
    : [];
  const gruposPorSessao = {};
  const sessoes = new Set([
    ...perfis.map(perfil => String(perfil?.sessaoId || perfil?.sessaoWhatsappId || perfil?.sessaoGruposId || "").trim()),
    String(configAtual.sessaoGruposId || configAtual.sessaoWhatsappId || configAtual.sessaoId || "").trim()
  ].filter(Boolean));

  for (const sessaoId of sessoes) {
    if (typeof listarGruposSessaoMensageiro === "function") {
      const grupos = listarGruposSessaoMensageiro(clienteId, sessaoId);
      if (Array.isArray(grupos) && grupos.length) gruposPorSessao[sessaoId] = grupos;
    }
    const sessaoAtual = String(configAtual.sessaoGruposId || configAtual.sessaoWhatsappId || configAtual.sessaoId || "").trim();
    if (!gruposPorSessao[sessaoId] && sessaoId === sessaoAtual && Array.isArray(configAtual.grupos)) {
      gruposPorSessao[sessaoId] = configAtual.grupos;
    }
  }

  return { sessoesValidas, gruposPorSessao };
}

router.get("/config", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const config = getAtendimentoConfigCliente(clienteId);

  return res.json({
    ok: true,
    clienteId,
    config
  });
});

router.post("/config", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const dados = req.body?.config && typeof req.body.config === "object"
    ? req.body.config
    : req.body || {};

  const config = setAtendimentoConfigCliente(clienteId, dados);

  return res.json({
    ok: true,
    clienteId,
    config
  });
});

router.get("/historico", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const config = getAtendimentoConfigCliente(clienteId);
  const limite = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));

  return res.json({
    ok: true,
    clienteId,
    historico: Array.isArray(config.historico)
      ? config.historico.slice(-limite).reverse()
      : []
  });
});

router.get("/gerente/infracoes", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const infracoes = typeof listarInfracoesGerenteCliente === "function"
    ? listarInfracoesGerenteCliente(clienteId, {
      perfilId: String(req.query?.perfilId || ""),
      grupoId: String(req.query?.grupoId || ""),
      participante: String(req.query?.participante || ""),
      regraId: String(req.query?.regraId || "")
    })
    : [];

  return res.json({
    ok: true,
    clienteId,
    infracoes
  });
});

router.get("/gerente/status", async (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const config = getMensageiroCliente(clienteId);
  const perfilId = String(req.query?.perfilId || "");
  const perfis = Array.isArray(config?.perfis) ? config.perfis.filter(perfil => !perfil?.removidoEm) : [];
  const perfisAlvo = perfilId
    ? perfis.filter(perfil => String(perfil?.id || "") === perfilId)
    : perfis;
  const sessoesValidas = typeof listarSessoesMensageiro === "function"
    ? listarSessoesMensageiro(clienteId)
    : [];
  const ultimosMotivos = typeof listarUltimosMotivosGerenteCliente === "function"
    ? listarUltimosMotivosGerenteCliente(clienteId, perfilId ? { perfilId } : {})
    : [];

  if (perfilId && !perfisAlvo.length) {
    return res.json({
      ok: true,
      clienteId,
      estado: "perfil_nao_encontrado",
      resumo: {
        gerenteAtivo: false,
        regrasAtivas: 0,
        gruposSelecionados: 0,
        permissaoResumo: "nao_verificado"
      },
      perfis: []
    });
  }

  const statusPerfis = [];
  for (const perfil of perfisAlvo) {
    statusPerfis.push(await montarStatusGerentePerfil({
      clienteId,
      perfil,
      sessoesValidas,
      ultimosMotivos
    }));
  }

  const resumoBase = statusPerfis.find(item => item.perfilId === perfilId) || statusPerfis[0] || null;
  return res.json({
    ok: true,
    clienteId,
    estado: resumoBase?.estado || "perfil_nao_encontrado",
    resumo: resumoBase
      ? {
        gerenteAtivo: resumoBase.gerenteAtivo,
        regrasAtivas: resumoBase.regrasAtivas,
        gruposSelecionados: resumoBase.gruposSelecionados,
        permissaoResumo: resumoBase.permissaoResumo
      }
      : {
        gerenteAtivo: false,
        regrasAtivas: 0,
        gruposSelecionados: 0,
        permissaoResumo: "nao_verificado"
      },
    perfis: statusPerfis
  });
});

router.post("/gerente/infracoes/reset", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const filtro = {
    id: String(req.body?.id || ""),
    perfilId: String(req.body?.perfilId || ""),
    grupoId: String(req.body?.grupoId || ""),
    participante: String(req.body?.participante || ""),
    regraId: String(req.body?.regraId || "")
  };
  const infracoes = typeof zerarInfracaoGerenteCliente === "function"
    ? zerarInfracaoGerenteCliente(clienteId, filtro)
    : [];

  return res.json({
    ok: true,
    clienteId,
    infracoes
  });
});

router.post("/testar-gatilho", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const texto = String(req.body?.texto || req.body?.mensagem || "").trim();
  const configBase = getAtendimentoConfigCliente(clienteId);

  const gatilho = typeof encontrarGatilhoAtendimento === "function"
    ? encontrarGatilhoAtendimento(texto, configBase.gatilhos)
    : null;

  return res.json({
    ok: true,
    clienteId,
    texto,
    encontrou: Boolean(gatilho),
    gatilho: gatilho
      ? {
        id: gatilho.id,
        nome: gatilho.nome,
        modo: gatilho.modo,
        respostas: gatilho.respostas
      }
      : null
  });
});


router.get("/", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

  const config = getMensageiroCliente(clienteId);

  return res.json({
    ok: true,
    clienteId,
    mensageiro: config
  });
});


router.post("/", async (req, res) => {
  try {

  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro não disponível no seu plano"
    });
  }

 const dados = req.body || {};
const configAtualMensageiro = getMensageiroCliente(clienteId);
const atendimentoPayload =
  dados.atendimento !== undefined
    ? dados.atendimento
    : dados.mensageiro?.atendimento;

const imagemBoasVindas =
  dados.imagemBoasVindas === undefined
    ? configAtualMensageiro.imagemBoasVindas
    : await otimizarBase64(dados.imagemBoasVindas);

const imagemDespedida =
  dados.imagemDespedida === undefined
    ? configAtualMensageiro.imagemDespedida
    : await otimizarBase64(dados.imagemDespedida);

const sessaoGruposId = dados.sessaoGruposId === undefined && dados.sessaoWhatsappId === undefined && dados.sessaoId === undefined
  ? (configAtualMensageiro.sessaoGruposId || configAtualMensageiro.sessaoWhatsappId || configAtualMensageiro.sessaoId || "")
  : (dados.sessaoGruposId || dados.sessaoWhatsappId || dados.sessaoId || "");

const atendimentoNormalizado = atendimentoPayload === undefined
  ? configAtualMensageiro.atendimento
  : normalizarAtendimentoMensageiro(atendimentoPayload);
const boasVindasEnvio = dados.boasVindasEnvio !== undefined
  ? dados.boasVindasEnvio
  : dados.boasVindas?.envio !== undefined
    ? dados.boasVindas.envio
    : configAtualMensageiro.boasVindasEnvio;
const despedidaEnvio = dados.despedidaEnvio !== undefined
  ? dados.despedidaEnvio
  : dados.despedida?.envio !== undefined
    ? dados.despedida.envio
    : configAtualMensageiro.despedidaEnvio;
const comandosPayload = dados.comandos !== undefined
  ? await otimizarImagensComandos(dados.comandos)
  : dados.mensageiro?.comandos !== undefined
    ? await otimizarImagensComandos(dados.mensageiro.comandos)
    : configAtualMensageiro.comandos;
const programacoesPayload = dados.programacoes !== undefined
  ? await otimizarImagensProgramacoes(dados.programacoes)
  : dados.mensageiro?.programacoes !== undefined
    ? await otimizarImagensProgramacoes(dados.mensageiro.programacoes)
    : configAtualMensageiro.programacoes;
const perfisPayload = dados.perfis !== undefined
  ? await otimizarImagensPerfis(dados.perfis)
  : dados.mensageiro?.perfis !== undefined
    ? await otimizarImagensPerfis(dados.mensageiro.perfis)
    : configAtualMensageiro.perfis;

if (typeof validarPerfisMensageiro === "function") {
  validarPerfisMensageiro(
    perfisPayload,
    montarContextoValidacaoPerfis(clienteId, perfisPayload, configAtualMensageiro)
  );
}

const atualizado = setMensageiroCliente(clienteId, {
  ativo: dados.ativo === undefined
    ? configAtualMensageiro.ativo
    : Boolean(dados.ativo),
  sessaoId: sessaoGruposId,
  sessaoWhatsappId: sessaoGruposId,
  sessaoGruposId,

  boasVindasAtivo: dados.boasVindasAtivo === undefined
    ? configAtualMensageiro.boasVindasAtivo
    : Boolean(dados.boasVindasAtivo),
  despedidaAtivo: dados.despedidaAtivo === undefined
    ? configAtualMensageiro.despedidaAtivo
    : Boolean(dados.despedidaAtivo),

  mensagemBoasVindas: dados.mensagemBoasVindas === undefined
    ? configAtualMensageiro.mensagemBoasVindas
    : dados.mensagemBoasVindas || "",
  mensagemDespedida: dados.mensagemDespedida === undefined
    ? configAtualMensageiro.mensagemDespedida
    : dados.mensagemDespedida || "",

  imagemBoasVindas: imagemBoasVindas || "",
  imagemDespedida: imagemDespedida || "",

  grupos: dados.grupos === undefined
    ? configAtualMensageiro.grupos || []
    : Array.isArray(dados.grupos)
      ? dados.grupos
      : [],

  boasVindasEnvio,
  despedidaEnvio,
  perfis: perfisPayload,
  comandos: comandosPayload,
  programacoes: programacoesPayload,

  atendimento: atendimentoNormalizado
});

if (atendimentoPayload !== undefined) {
  setAtendimentoConfigCliente(clienteId, atendimentoNormalizado);
}


    return res.json({
      ok: true,
      clienteId,
      mensageiro: atualizado
    });
  } catch (erro) {
    return res.status(erro.statusCode || 500).json({
      ok: false,
      erro: erro.message || "Erro ao salvar mensageiro",
      codigo: erro.code || "erro_mensageiro"
    });
  }
  });

  return router;
}

module.exports = criarRotasMensageiro;
