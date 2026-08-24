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
const DESTINOS_MENSAGEM_GRUPO = new Set(["privado", "grupo"]);
const MODOS_MENSAGEM_GRUPO = new Set(["texto", "imagem", "imagem_texto"]);
const CORRESPONDENCIAS_COMANDO = new Set(["exato", "inicia"]);
const TIPOS_RESPOSTA_COMANDO = new Set(["texto", "imagem", "imagem_texto"]);

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

function criarEnvioPadraoMensageiro() {
  return {
    destino: "privado",
    modoGrupo: "imagem_texto",
    mensagemTemporaria: false,
    apagarAposSegundos: 20
  };
}

function normalizarEnvioMensageiro(envio = {}) {
  const atual = envio && typeof envio === "object" ? envio : {};
  const apagarAposSegundos = Math.max(
    1,
    Math.min(3600, Number(atual.apagarAposSegundos || 20) || 20)
  );

  return {
    ...criarEnvioPadraoMensageiro(),
    destino: DESTINOS_MENSAGEM_GRUPO.has(atual.destino)
      ? atual.destino
      : "privado",
    modoGrupo: MODOS_MENSAGEM_GRUPO.has(atual.modoGrupo)
      ? atual.modoGrupo
      : "imagem_texto",
    mensagemTemporaria: atual.mensagemTemporaria === true,
    apagarAposSegundos
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
    },
    boasVindasEnvio: normalizarEnvioMensageiro(config.boasVindasEnvio),
    despedidaEnvio: normalizarEnvioMensageiro(config.despedidaEnvio),
    comandos: normalizarComandosMensageiro(config.comandos)
  };
}

function carregarMensageiro() {
  try {
    mensageiroPorCliente = readGlobalJson("mensageiro.json", {});

    console.log(
      "✅ Mensageiro carregado:",
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
      "👋 Seja bem-vindo ao grupo!\n\nAproveite as ofertas e promoções.",
    mensagemDespedida:
      "😢 Obrigado por ter participado do grupo.\n\nVolte quando quiser!",

    imagemBoasVindas: "",
    imagemDespedida: "",

    grupos: [],

    boasVindasEnvio: criarEnvioPadraoMensageiro(),
    despedidaEnvio: criarEnvioPadraoMensageiro(),

    comandos: [],

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
  const itens = Array.isArray(lista) ? lista : [lista];

  const vistas = new Set();
  return itens
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .filter(item => {
      const chave = item.toLowerCase();
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });
}

function normalizarRespostaComando(resposta = {}) {
  const raw = resposta && typeof resposta === "object" ? resposta : {};
  const tipo = TIPOS_RESPOSTA_COMANDO.has(raw.tipo)
    ? raw.tipo
    : "texto";

  return {
    tipo,
    texto: String(raw.texto || raw.mensagem || raw.conteudo || "").slice(0, 4000),
    imagem: String(raw.imagem || raw.imagemUrl || raw.url || "")
  };
}

function normalizarComandoMensageiro(comando = {}, index = 0) {
  const raw = comando && typeof comando === "object" ? comando : {};
  const gatilhos = normalizarListaPalavras(raw.gatilhos || raw.gatilho || raw.palavras);
  const correspondencia = CORRESPONDENCIAS_COMANDO.has(raw.correspondencia)
    ? raw.correspondencia
    : "exato";

  return {
    id: String(raw.id || `cmd_${Date.now()}_${index}`),
    ativo: raw.ativo !== false,
    nome: String(raw.nome || `Comando ${index + 1}`).trim(),
    gatilhos,
    correspondencia,
    grupos: normalizarListaPalavras(raw.grupos),
    mencionarAutor: raw.mencionarAutor === true,
    resposta: normalizarRespostaComando(raw.resposta || {}),
    cooldownSegundos: Math.max(5, Math.min(3600, Number(raw.cooldownSegundos || 30) || 30)),
    cooldownParticipanteSegundos: Math.max(
      5,
      Math.min(3600, Number(raw.cooldownParticipanteSegundos || 60) || 60)
    )
  };
}

function normalizarComandosMensageiro(comandos = []) {
  if (!Array.isArray(comandos)) return [];

  return comandos
    .map(normalizarComandoMensageiro)
    .filter(comando => comando.nome && comando.gatilhos.length)
    .filter(comando => {
      const { tipo, texto, imagem } = comando.resposta || {};
      if (tipo === "texto") return Boolean(texto);
      if (tipo === "imagem") return Boolean(imagem);
      return Boolean(texto || imagem);
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
    tipoCorrespondencia: String(
      gatilho?.tipoCorrespondencia ||
      gatilho?.correspondencia ||
      gatilho?.match ||
      "exato"
    ).toLowerCase(),
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
    .map((evento, index) => {
      const respostaEnviada = Array.isArray(evento?.respostaEnviada)
        ? evento.respostaEnviada.map(item => String(item || "")).filter(Boolean)
        : String(evento?.respostaEnviada || "").trim()
          ? [String(evento.respostaEnviada)]
          : [];

      return {
        id: String(evento?.id || `hist_${Date.now()}_${index}`),
        data: evento?.data || new Date().toISOString(),
        tipo: String(evento?.tipo || "atendimento"),
        origem: String(evento?.origem || ""),
        contato: String(evento?.contato || evento?.jid || ""),
        contatoNome: String(evento?.contatoNome || evento?.nomeContato || ""),
        grupo: String(evento?.grupo || ""),
        grupoNome: String(evento?.grupoNome || evento?.nomeGrupo || ""),
        mensagemRecebida: String(evento?.mensagemRecebida || evento?.mensagem || "").slice(0, 500),
        gatilhoId: String(evento?.gatilhoId || evento?.comandoId || ""),
        gatilhoNome: String(evento?.gatilhoNome || evento?.comandoNome || evento?.gatilhoAcionado || ""),
        respostaEnviada,
        status: String(evento?.status || evento?.resultado || "registrado"),
        resultado: String(evento?.resultado || evento?.status || "registrado"),
        resumo: String(evento?.resumo || ""),
        detalhe: String(evento?.detalhe || ""),
        erro: String(evento?.erro || "")
      };
    });
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
