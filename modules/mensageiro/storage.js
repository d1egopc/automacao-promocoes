const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const MENSAGEIRO_FILE = path.join(DATA_DIR, "mensageiro.json");

let mensageiroPorCliente = {};

function carregarMensageiro() {
  try {
    if (fs.existsSync(MENSAGEIRO_FILE)) {
      mensageiroPorCliente = JSON.parse(
        fs.readFileSync(MENSAGEIRO_FILE, "utf8")
      );
    }

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
    fs.writeFileSync(
      MENSAGEIRO_FILE,
      JSON.stringify(mensageiroPorCliente, null, 2)
    );
  } catch (e) {
    console.log("[ERRO] [MENSAGEIRO] Erro ao salvar mensageiro:", e.message);
  }
}

function criarConfigPadraoMensageiro(clienteId) {
  return {
    clienteId,
    ativo: false,

    sessaoId: "",

    boasVindasAtivo: false,
    despedidaAtivo: false,

    mensagemBoasVindas:
      "ðŸ‘‹ Seja bem-vindo ao grupo!\n\nAproveite as ofertas e promoÃ§Ãµes.",
    mensagemDespedida:
      "ðŸ˜¢ Obrigado por ter participado do grupo.\n\nVolte quando quiser!",

    imagemBoasVindas: "",
    imagemDespedida: "",

    grupos: [],

    atendimento: {
      ativo: false,
      delaySegundos: 2,
      escopo: "privado",
      respostasRapidas: []
    },

    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString()
  };
}

function getMensageiroCliente(clienteId) {
  if (!mensageiroPorCliente[clienteId]) {
    mensageiroPorCliente[clienteId] =
      criarConfigPadraoMensageiro(clienteId);

    salvarMensageiro();
  }

  return mensageiroPorCliente[clienteId];
}

function setMensageiroCliente(clienteId, dados = {}) {
  const atual = getMensageiroCliente(clienteId);

  mensageiroPorCliente[clienteId] = {
    ...atual,
    ...dados,
    clienteId,
    atualizadoEm: new Date().toISOString()
  };

  salvarMensageiro();

  return mensageiroPorCliente[clienteId];
}

module.exports = {
  carregarMensageiro,
  salvarMensageiro,
  getMensageiroCliente,
  setMensageiroCliente
};
