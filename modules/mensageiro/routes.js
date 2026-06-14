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

const imagemBoasVindas =
  await otimizarBase64(dados.imagemBoasVindas);

const imagemDespedida =
  await otimizarBase64(dados.imagemDespedida);

const atualizado = setMensageiroCliente(clienteId, {
  ativo: Boolean(dados.ativo),
  sessaoId: dados.sessaoId || "",

  boasVindasAtivo: Boolean(dados.boasVindasAtivo),
  despedidaAtivo: Boolean(dados.despedidaAtivo),

  mensagemBoasVindas: dados.mensagemBoasVindas || "",
  mensagemDespedida: dados.mensagemDespedida || "",

  imagemBoasVindas: imagemBoasVindas || "",
  imagemDespedida: imagemDespedida || "",

  grupos: Array.isArray(dados.grupos)
    ? dados.grupos
    : [],

  atendimento: dados.atendimento === undefined
    ? configAtualMensageiro.atendimento
    : normalizarAtendimentoMensageiro(dados.atendimento)
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

