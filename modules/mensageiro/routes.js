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
  setAtendimentoConfigCliente
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

router.get("/config", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
    return res.status(403).json({
      ok: false,
      erro: "Mensageiro nÃ£o disponÃ­vel no seu plano"
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
      erro: "Mensageiro nÃ£o disponÃ­vel no seu plano"
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


router.get("/", (req, res) => {
  const clienteId = getClienteId(req);

  if (!mensageiroPermitido(req, clienteId)) {
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

  if (!mensageiroPermitido(req, clienteId)) {
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



