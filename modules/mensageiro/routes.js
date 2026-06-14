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
  setMensageiroCliente
} = deps;

function normalizarAtendimentoMensageiro(dados = {}) {
  const atendimento = dados && typeof dados === "object" ? dados : {};
  const respostasRapidas = Array.isArray(atendimento.respostasRapidas)
    ? atendimento.respostasRapidas
    : [];

  return {
    ativo: atendimento.ativo === true,
    delaySegundos: Math.max(0, Number(atendimento.delaySegundos || 2) || 0),
    escopo: "privado",
    respostasRapidas: respostasRapidas.map((item, index) => ({
      id: item.id || `resposta_${Date.now()}_${index}`,
      ativo: item.ativo !== false,
      gatilhos: Array.isArray(item.gatilhos)
        ? item.gatilhos.map(g => String(g || "").trim()).filter(Boolean)
        : [],
      tipoCorrespondencia: item.tipoCorrespondencia || "contem",
      resposta: {
        tipo: item.resposta?.tipo || "texto",
        conteudo: String(item.resposta?.conteudo || "")
      }
    })).filter(item => item.gatilhos.length && item.resposta.conteudo)
  };
}


router.get("/", (req, res) => {
  const clienteId = getClienteId(req);

  if (
    clienteId !== "admin" &&
    !usuarioTemRecurso(req, "mensageiro")
  ) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro nÃ£o disponÃ­vel no seu plano"
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

  const clienteId = getClienteId(req);

  if (
    clienteId !== "admin" &&
    !usuarioTemRecurso(req, "mensageiro")
  ) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro nÃ£o disponÃ­vel no seu plano"
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

const atualizado = setMensageiroCliente(clienteId, {
  ativo: dados.ativo === undefined
    ? configAtualMensageiro.ativo
    : Boolean(dados.ativo),
  sessaoId: dados.sessaoId === undefined
    ? configAtualMensageiro.sessaoId
    : dados.sessaoId || "",

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

  atendimento: atendimentoPayload === undefined
    ? configAtualMensageiro.atendimento
    : normalizarAtendimentoMensageiro(atendimentoPayload)
});


    return res.json({
      ok: true,
      clienteId,
      mensageiro: atualizado
    });
  });

  return router;
}

module.exports = criarRotasMensageiro;


