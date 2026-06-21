const fs = require("fs");
const path = require("path");
const {
  getClienteJsonPath,
  readClienteJson,
  writeClienteJson,
  readGlobalJson,
  writeGlobalJson
} = require("../../utils/storage");

const DATA_DIR = process.env.DATA_DIR || "/data";
const MENSAGEIRO_FILE = path.join(DATA_DIR, "mensageiro.json");
const HISTORICO_ATENDIMENTO_MAX = 200;
const TIPOS_RESPOSTA_ATENDIMENTO = new Set(["texto", "imagemUrl", "videoUrl", "arquivoUrl", "link"]);
const ESCOPOS_ATENDIMENTO = new Set(["privado", "grupo", "ambos"]);
const MODOS_GATILHO_ATENDIMENTO = new Set(["todas", "qualquer"]);

let mensageiroPorCliente = {};

function garantirDiretorio(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function clienteIdSeguro(clienteId) {
  return String(clienteId || "admin").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getDiretorioCliente(clienteId) {
  return path.join(DATA_DIR, "clientes", clienteIdSeguro(clienteId));
}

function getMensageiroConfigFile(clienteId) {
  return getClienteJsonPath(clienteId, "mensageiro-config.json");
}

function criarAtendimentoPadraoMensageiro() {
  return {
    ativo: false,
    delaySegundos: 2,
    escopo: "privado",
    respostasRapidas: []
  };
}

function normalizarConfigMensageiro(clienteId, config = {}) {
  const padrao = criarConfigPadraoMensageiro(clienteId);
  const atendimentoAtual =
    config.atendimento && typeof config.atendimento === "object"
      ? config.atendimento
      : {};
  const sessaoGruposId = String(
    config.sessaoGruposId ||
    config.sessaoWhatsappId ||
    config.sessaoId ||
    ""
  );

  return {
    ...padrao,
    ...config,
    clienteId,
    sessaoId: sessaoGruposId,
    sessaoWhatsappId: sessaoGruposId,
    sessaoGruposId,
    atendimento: {
      ...criarAtendimentoPadraoMensageiro(),
      ...atendimentoAtual,
      escopo: "privado",
      respostasRapidas: Array.isArray(atendimentoAtual.respostasRapidas)
        ? atendimentoAtual.respostasRapidas
        : []
    }
  };
}

function carregarMensageiro() {
  try {
    mensageiroPorCliente = readGlobalJson("mensageiro.json", {});

    console.log(
      "âœ… Mensageiro carregado:",
      Object.keys(mensageiroPorCliente).length
    );
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao carregar mensageiro:", e.message);
    mensageiroPorCliente = {};
  }
}

function salvarMensageiro() {
  try {
    writeGlobalJson("mensageiro.json", mensageiroPorCliente);
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao salvar mensageiro:", e.message);
  }
}

function criarConfigPadraoMensageiro(clienteId) {
  return {
    clienteId,
    ativo: false,

    sessaoId: "",
    sessaoWhatsappId: "",
    sessaoGruposId: "",

    boasVindasAtivo: false,
    despedidaAtivo: false,

    mensagemBoasVindas:
      "ðŸ‘‹ Seja bem-vindo ao grupo!\n\nAproveite as ofertas e promoÃ§Ãµes.",
    mensagemDespedida:
      "ðŸ˜¢ Obrigado por ter participado do grupo.\n\nVolte quando quiser!",

    imagemBoasVindas: "",
    imagemDespedida: "",

    grupos: [],

    atendimento: criarAtendimentoPadraoMensageiro(),

    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
}

function criarConfigAtendimentoPadrao(clienteId) {
  return {
    clienteId,
    atendimentoAtivo: false,
    sessaoId: "",
    sessaoAtendimentoId: "",
    escopo: "privado",
    cooldownMinutos: 10,
    gatilhos: [],
    historico: [],
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
}

function normalizarListaPalavras(lista = []) {
  if (!Array.isArray(lista)) return [];

  const vistas = new Set();
  return lista
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .filter(item => {
      const chave = item.toLowerCase();
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });
}

function normalizarRespostaAtendimento(resposta = {}, index = 0) {
  const tipo = TIPOS_RESPOSTA_ATENDIMENTO.has(resposta?.tipo)
    ? resposta.tipo
    : "texto";

  return {
    id: String(resposta?.id || `resposta_${Date.now()}_${index}`),
    tipo,
    conteudo: String(resposta?.conteudo || "").trim(),
    delaySegundos: Math.max(0, Math.min(60, Number(resposta?.delaySegundos || 0) || 0))
  };
}

function normalizarGatilhoAtendimento(gatilho = {}, index = 0) {
  const respostas = Array.isArray(gatilho?.respostas)
    ? gatilho.respostas
    : gatilho?.resposta
      ? [gatilho.resposta]
      : [];

  return {
    id: String(gatilho?.id || `gatilho_${Date.now()}_${index}`),
    ativo: gatilho?.ativo !== false,
    nome: String(gatilho?.nome || `Gatilho ${index + 1}`).trim(),
    modo: MODOS_GATILHO_ATENDIMENTO.has(gatilho?.modo) ? gatilho.modo : "todas",
    palavrasObrigatorias: normalizarListaPalavras(gatilho?.palavrasObrigatorias),
    palavrasOpcionais: normalizarListaPalavras(gatilho?.palavrasOpcionais),
    respostas: respostas
      .map(normalizarRespostaAtendimento)
      .filter(resposta => resposta.conteudo)
  };
}

function normalizarHistoricoAtendimento(historico = []) {
  if (!Array.isArray(historico)) return [];

  return historico
    .slice(-HISTORICO_ATENDIMENTO_MAX)
    .map((evento, index) => ({
      id: String(evento?.id || `hist_${Date.now()}_${index}`),
      data: evento?.data || new Date().toISOString(),
      origem: String(evento?.origem || ""),
      contato: String(evento?.contato || evento?.jid || ""),
      grupo: String(evento?.grupo || ""),
      mensagemRecebida: String(evento?.mensagemRecebida || evento?.mensagem || "").slice(0, 500),
      gatilhoId: String(evento?.gatilhoId || ""),
      gatilhoNome: String(evento?.gatilhoNome || evento?.gatilhoAcionado || ""),
      respostaEnviada: Array.isArray(evento?.respostaEnviada)
        ? evento.respostaEnviada.map(item => String(item || "")).filter(Boolean)
        : String(evento?.respostaEnviada || "").trim()
          ? [String(evento.respostaEnviada)]
          : [],
      status: String(evento?.status || "registrado"),
      erro: String(evento?.erro || "")
    }));
}

function normalizarConfigAtendimentoCliente(clienteId, config = {}) {
  const padrao = criarConfigAtendimentoPadrao(clienteId);
  const raw = config && typeof config === "object" ? config : {};
  const nested = raw.atendimento && typeof raw.atendimento === "object" ? raw.atendimento : {};
  const fonte = Object.keys(nested).length ? nested : raw;
  const escopo = ESCOPOS_ATENDIMENTO.has(fonte.escopo) ? fonte.escopo : "privado";
  const podeUsarSessaoIdLegado = !raw.sessaoWhatsappId && !raw.sessaoGruposId && !raw.grupos && !raw.gruposIds;
  const sessaoId = String(
    fonte.sessaoAtendimentoId ||
    raw.sessaoAtendimentoId ||
    fonte.atendimentoSessaoId ||
    raw.atendimentoSessaoId ||
    fonte.sessionId ||
    fonte.whatsappSessionId ||
    (podeUsarSessaoIdLegado ? (fonte.sessaoId || raw.sessaoId || "") : "")
  );

  return {
    ...padrao,
    ...fonte,
    clienteId,
    atendimentoAtivo: fonte.atendimentoAtivo === true || fonte.ativo === true || raw.atendimentoAtivo === true,
    sessaoId,
    sessaoAtendimentoId: sessaoId,
    escopo,
    cooldownMinutos: Math.max(1, Math.min(120, Number(fonte.cooldownMinutos || raw.cooldownMinutos || 10) || 10)),
    gatilhos: Array.isArray(fonte.gatilhos)
      ? fonte.gatilhos
        .map(normalizarGatilhoAtendimento)
        .filter(gatilho => gatilho.palavrasObrigatorias.length && gatilho.respostas.length)
      : [],
    historico: normalizarHistoricoAtendimento(fonte.historico || raw.historico),
    atualizadoEm: fonte.atualizadoEm || raw.atualizadoEm || new Date().toISOString()
  };
}

function getAtendimentoConfigCliente(clienteId) {
  let config = criarConfigAtendimentoPadrao(clienteId);

  try {
    config = readClienteJson(clienteId, "mensageiro-config.json", config);
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao ler atendimento:", e.message);
  }

  return normalizarConfigAtendimentoCliente(clienteId, config);
}

function setAtendimentoConfigCliente(clienteId, dados = {}) {
  const arquivoAtual = readClienteJson(clienteId, "mensageiro-config.json", criarConfigPadraoMensageiro(clienteId));
  const atual = normalizarConfigAtendimentoCliente(clienteId, arquivoAtual);
  const payload = dados && typeof dados === "object" ? dados : {};
  const atualizado = normalizarConfigAtendimentoCliente(clienteId, {
    ...atual,
    ...payload,
    historico: payload.historico === undefined ? atual.historico : payload.historico,
    atualizadoEm: new Date().toISOString()
  });

  try {
    writeClienteJson(clienteId, "mensageiro-config.json", {
      ...arquivoAtual,
      atendimento: {
        ...(arquivoAtual.atendimento && typeof arquivoAtual.atendimento === "object" ? arquivoAtual.atendimento : {}),
        ...atualizado,
        sessaoId: atualizado.sessaoAtendimentoId,
        sessaoAtendimentoId: atualizado.sessaoAtendimentoId
      },
      atendimentoAtivo: atualizado.atendimentoAtivo,
      sessaoAtendimentoId: atualizado.sessaoAtendimentoId,
      atualizadoEm: new Date().toISOString()
    });
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao persistir atendimento:", e.message);
  }

  return atualizado;
}

function registrarHistoricoAtendimento(clienteId, evento = {}) {
  const atual = getAtendimentoConfigCliente(clienteId);
  return setAtendimentoConfigCliente(clienteId, {
    historico: [
      ...atual.historico,
      {
        id: evento.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        data: evento.data || new Date().toISOString(),
        ...evento
      }
    ].slice(-HISTORICO_ATENDIMENTO_MAX)
  });
}

function getMensageiroCliente(clienteId) {
  if (!mensageiroPorCliente[clienteId]) {
    mensageiroPorCliente[clienteId] =
      criarConfigPadraoMensageiro(clienteId);

    salvarMensageiro();
  }

  const normalizado = normalizarConfigMensageiro(
    clienteId,
    mensageiroPorCliente[clienteId]
  );

  const mudou = JSON.stringify(normalizado) !== JSON.stringify(mensageiroPorCliente[clienteId]);
  mensageiroPorCliente[clienteId] = normalizado;

  if (mudou) salvarMensageiro();

  return mensageiroPorCliente[clienteId];
}

function setMensageiroCliente(clienteId, dados = {}) {
  const atual = getMensageiroCliente(clienteId);

  mensageiroPorCliente[clienteId] = normalizarConfigMensageiro(clienteId, {
    ...atual,
    ...dados,
    clienteId,
    atualizadoEm: new Date().toISOString()
  });

  salvarMensageiro();

  return mensageiroPorCliente[clienteId];
}

module.exports = {
  carregarMensageiro,
  salvarMensageiro,
  getMensageiroCliente,
  setMensageiroCliente,
  getAtendimentoConfigCliente,
  setAtendimentoConfigCliente,
  registrarHistoricoAtendimento,
  normalizarConfigAtendimentoCliente
};

