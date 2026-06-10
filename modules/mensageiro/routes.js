const express = require("express");

function criarRotasMensageiro(deps = {}) {
  const router = express.Router();

const {
  getClienteId,
  getPlanoUsuario,
  usuarioTemRecurso,
  getMensageiroCliente,
  setMensageiroCliente
} = deps;

 router.get("/", (req, res) => {

  const clienteId = getClienteId(req);

  if (
    clienteId !== "admin" &&
    !usuarioTemRecurso(req, "mensageiro")
  ) {
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

  router.post("/", (req, res) => {

 const clienteId = getClienteId(req);

if (
  clienteId !== "admin" &&
  !usuarioTemRecurso(req, "mensageiro")
) {
  return res.status(403).json({
    ok: false,
    erro: "Mensageiro não disponível no seu plano"
  });
}
    const clienteId = getClienteId(req);

    const dados = req.body || {};

const atualizado = setMensageiroCliente(clienteId, {
  ativo: Boolean(dados.ativo),
  sessaoId: dados.sessaoId || "",

  boasVindasAtivo: Boolean(dados.boasVindasAtivo),
  despedidaAtivo: Boolean(dados.despedidaAtivo),

  mensagemBoasVindas: dados.mensagemBoasVindas || "",
  mensagemDespedida: dados.mensagemDespedida || "",

  imagemBoasVindas: dados.imagemBoasVindas || "",
  imagemDespedida: dados.imagemDespedida || "",

  grupos: Array.isArray(dados.grupos)
    ? dados.grupos
    : []
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