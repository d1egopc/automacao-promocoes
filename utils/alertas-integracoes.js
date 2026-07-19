const {
  readClienteJson,
  writeClienteJson
} = require("./storage");

const ARQUIVO = "alertas-integracoes.json";

function normalizarMarketplace(marketplace = "") {
  return String(marketplace || "").trim().toLowerCase();
}

function listarAlertasIntegracoes(clienteId = "admin") {
  return readClienteJson(clienteId, ARQUIVO, []);
}

function registrarAlertaIntegracao(
  clienteId = "admin",
  marketplace = "",
  alerta = {}
) {
  const alertas = listarAlertasIntegracoes(clienteId);
  const mp = normalizarMarketplace(marketplace);

  const novaLista = alertas.filter(
    item => normalizarMarketplace(item.marketplace) !== mp
  );

  novaLista.push({
    marketplace: mp,
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
  const mp = normalizarMarketplace(marketplace);

  const novaLista = alertas.filter(
    item => normalizarMarketplace(item.marketplace) !== mp
  );

  writeClienteJson(clienteId, ARQUIVO, novaLista);

  return novaLista;
}

module.exports = {
  listarAlertasIntegracoes,
  registrarAlertaIntegracao,
  limparAlertaIntegracao
};
