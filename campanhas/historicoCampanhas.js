const crypto = require("crypto");
const {
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../utils/storage");

const ARQUIVO_HISTORICO = "campanhas-historico.json";
const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function agoraIso() {
  return new Date().toISOString();
}

function clienteSeguro(clienteId = "admin") {
  return normalizarClienteId(clienteId || "admin");
}

function criarCampanhaId() {
  return `campanha_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function limitarTexto(valor = "", limite = 4000) {
  const t = texto(valor);
  return t.length > limite ? t.slice(0, limite) : t;
}

function inteiro(valor = 0) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function statusCampanha(enviados = 0, erros = 0) {
  const ok = inteiro(enviados);
  const falhas = inteiro(erros);
  if (ok > 0 && falhas > 0) return "parcial";
  if (ok > 0) return "enviada";
  if (falhas > 0) return "erro";
  return "sem_envio";
}

function normalizarDestino(destino = {}) {
  const tipo = texto(destino.tipo).toLowerCase();
  return {
    id: texto(destino.id),
    nome: texto(destino.nome),
    tipo,
    conexaoId: tipo === "whatsapp" ? texto(destino.conexaoId) : "",
    gruposWhatsappQuantidade: Array.isArray(destino.gruposWhatsapp) ? destino.gruposWhatsapp.length : 0,
    telegramDestinosQuantidade: Array.isArray(destino.telegramDestinos) ? destino.telegramDestinos.length : 0
  };
}

function normalizarDetalhe(det = {}) {
  return {
    destino: texto(det.destino),
    tipo: texto(det.tipo),
    status: texto(det.status),
    motivo: texto(det.motivo),
    creditos: inteiro(det.creditos),
    grupoPresente: Boolean(det.grupo),
    chatIdPresente: Boolean(det.chatId)
  };
}

function lerHistoricoCampanhas(clienteId = "admin") {
  const dados = readClienteJson(clienteSeguro(clienteId), ARQUIVO_HISTORICO, []);
  return Array.isArray(dados) ? dados : [];
}

function salvarHistoricoCampanhas(clienteId = "admin", itens = []) {
  const lista = Array.isArray(itens) ? itens : [];
  writeClienteJson(clienteSeguro(clienteId), ARQUIVO_HISTORICO, lista.slice(-LIMITE_MAXIMO));
}

function registrarHistoricoCampanha({
  campanhaId = "",
  clienteId = "admin",
  tipo = "texto",
  mensagem = "",
  legenda = "",
  midia = null,
  destinos = [],
  detalhes = [],
  enviados = 0,
  erros = 0,
  status = "",
  criadoEm = "",
  iniciadoEm = "",
  concluidoEm = ""
} = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const enviadosNumero = inteiro(enviados);
  const errosNumero = inteiro(erros);
  const registro = {
    campanhaId: texto(campanhaId) || criarCampanhaId(),
    clienteId: clienteIdSeguro,
    tipo: texto(tipo) || "texto",
    mensagem: limitarTexto(mensagem),
    legenda: limitarTexto(legenda || mensagem),
    nomeOriginal: texto(midia?.nomeOriginal),
    mimeType: texto(midia?.mimeType),
    bytes: inteiro(midia?.bytes),
    midiaOrigem: texto(midia?.origem),
    midiaId: texto(midia?.midiaId),
    destinos: Array.isArray(destinos) ? destinos.map(normalizarDestino) : [],
    detalhes: Array.isArray(detalhes) ? detalhes.map(normalizarDetalhe) : [],
    enviados: enviadosNumero,
    erros: errosNumero,
    status: texto(status) || statusCampanha(enviadosNumero, errosNumero),
    criadoEm: texto(criadoEm) || agoraIso(),
    iniciadoEm: texto(iniciadoEm) || agoraIso(),
    concluidoEm: texto(concluidoEm) || agoraIso()
  };

  const atuais = lerHistoricoCampanhas(clienteIdSeguro).filter(item => item.campanhaId !== registro.campanhaId);
  atuais.push(registro);
  salvarHistoricoCampanhas(clienteIdSeguro, atuais);
  return registro;
}

function listarHistoricoCampanhas(clienteId = "admin", { limite = LIMITE_PADRAO } = {}) {
  const max = Math.min(Math.max(inteiro(limite) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  return lerHistoricoCampanhas(clienteId)
    .slice()
    .sort((a, b) => texto(b.criadoEm).localeCompare(texto(a.criadoEm)))
    .slice(0, max);
}

function obterCampanhaHistorico(clienteId = "admin", campanhaId = "") {
  const id = texto(campanhaId);
  if (!id) return null;
  return lerHistoricoCampanhas(clienteId).find(item => item.campanhaId === id) || null;
}

module.exports = {
  ARQUIVO_HISTORICO,
  registrarHistoricoCampanha,
  listarHistoricoCampanhas,
  obterCampanhaHistorico,
  lerHistoricoCampanhas
};