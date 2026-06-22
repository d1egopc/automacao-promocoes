const {
  readClienteJson,
  writeClienteJson
} = require("./storage");

const ARQUIVO = "alertas-integracoes.json";

function listarAlertasIntegracoes(clienteId = "admin") {
  return readClienteJson(clienteId, ARQUIVO, []);
}

function registrarAlertaIntegracao(
  clienteId = "admin",
  marketplace = "",
  alerta = {}
) {
  const alertas = listarAlertasIntegracoes(clienteId);

  const novaLista = alertas.filter(
    item => item.marketplace !== marketplace
  );

  novaLista.push({
    marketplace,
    tipo: alerta.tipo || "desconhecido",
    status: alerta.status || "atencao",
    mensagem: alerta.mensagem || "",
    detalhes: alerta.detalhes || {},
    ultimaOcorrencia: new Date().toISOString()
  });

  writeClienteJson(clienteId, ARQUIVO, novaLista);

  return novaLista;
}

function limparAlertaIntegracao(
  clienteId = "admin",
  marketplace = ""
) {
  const alertas = listarAlertasIntegracoes(clienteId);

  const novaLista = alertas.filter(
    item => item.marketplace !== marketplace
  );

  writeClienteJson(clienteId, ARQUIVO, novaLista);

  return novaLista;
}

module.exports = {
  listarAlertasIntegracoes,
  registrarAlertaIntegracao,
  limparAlertaIntegracao
};