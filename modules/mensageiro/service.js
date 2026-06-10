const {
  getMensageiroCliente,
  setMensageiroCliente
} = require("./storage");

function mensageiroAtivo(clienteId) {
  const config = getMensageiroCliente(clienteId);

  return config?.ativo === true;
}

function boasVindasAtivo(clienteId) {
  const config = getMensageiroCliente(clienteId);

  return (
    config?.ativo === true &&
    config?.boasVindasAtivo === true
  );
}

function despedidaAtivo(clienteId) {
  const config = getMensageiroCliente(clienteId);

  return (
    config?.ativo === true &&
    config?.despedidaAtivo === true
  );
}

function grupoPermitido(clienteId, grupoId) {
  const config = getMensageiroCliente(clienteId);

  if (!config?.grupos?.length) {
    return true;
  }

  return config.grupos.includes(grupoId);
}

function obterMensagemBoasVindas(clienteId) {
  return (
    getMensageiroCliente(clienteId)
      ?.mensagemBoasVindas ||
    "👋 Seja bem-vindo!"
  );
}

function obterMensagemDespedida(clienteId) {
  return (
    getMensageiroCliente(clienteId)
      ?.mensagemDespedida ||
    "😢 Obrigado por participar."
  );
}

module.exports = {
  mensageiroAtivo,
  boasVindasAtivo,
  despedidaAtivo,
  grupoPermitido,
  obterMensagemBoasVindas,
  obterMensagemDespedida,
  getMensageiroCliente,
  setMensageiroCliente
};