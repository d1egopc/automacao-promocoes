const storageManual = require("./manual-offers.storage");
const { identidadeCanonica, identidadeIsoladaObservacao } = require("./ofertas-v2-identidade");

const JANELA_ENVIO_RECENTE_MS = 2 * 60 * 60 * 1000;

function texto(valor) { return String(valor ?? "").trim(); }
function lista(valor) { return Array.isArray(valor) ? valor : []; }
function timestamp(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;
  const bruto = texto(valor);
  const brasileiro = bruto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (brasileiro) return Date.UTC(Number(brasileiro[3]), Number(brasileiro[2]) - 1,
    Number(brasileiro[1]), Number(brasileiro[4]) + 3, Number(brasileiro[5]), Number(brasileiro[6] || 0));
  const ms = Date.parse(bruto);
  return Number.isFinite(ms) ? ms : NaN;
}
function recente(emMs, agoraMs) {
  return Number.isFinite(emMs) && emMs <= agoraMs && agoraMs - emMs < JANELA_ENVIO_RECENTE_MS;
}
function chavePar(canonicalKey, destinoId) { return `${canonicalKey}\u0000${texto(destinoId)}`; }

function registrar(registros, oferta, destino = {}, dados = {}) {
  const canonicalKey = identidadeCanonica(oferta) || identidadeIsoladaObservacao(oferta);
  const destinoId = texto(destino.destinoId || destino.id);
  const enviadoEmMs = timestamp(destino.enviadoEm || destino.dataEnvio || dados.enviadoEm);
  if (!canonicalKey || !destinoId || !recente(enviadoEmMs, dados.agoraMs)) return;
  const chave = chavePar(canonicalKey, destinoId);
  const anterior = registros.get(chave);
  if (anterior && anterior.enviadoEmMs >= enviadoEmMs) return;
  registros.set(chave, {
    canonicalKey,
    destinoId,
    nome: texto(destino.nome || destino.destinoNome) || destinoId,
    tipo: texto(destino.tipo || destino.canal),
    enviadoEm: new Date(enviadoEmMs).toISOString(),
    enviadoEmMs,
    origem: texto(dados.origem)
  });
}

function coletarManuais(clienteId, registros, deps, agoraMs) {
  const ofertas = typeof deps.listarOfertasManuaisV2 === "function"
    ? deps.listarOfertasManuaisV2(clienteId, deps.storageOptions || {})
    : storageManual.listarOfertasManuaisV2(clienteId, deps.storageOptions || {});
  for (const oferta of lista(ofertas)) {
    const envio = oferta?.envioManual || {};
    const origem = texto(oferta?.origemAgendamento) === "lista_v2" ? "lista" :
      texto(oferta?.origemAgendamento) ? "manual_agendado" : "manual";
    for (const resultado of lista(envio.resultados)) {
      if (texto(resultado?.status).toLowerCase() !== "enviado") continue;
      registrar(registros, oferta, resultado, {
        agoraMs,
        origem,
        enviadoEm: resultado.enviadoEm || envio.concluidoEm || oferta.enviadoEm
      });
    }
  }
}

function coletarAutomaticos(clienteId, registros, deps, agoraMs) {
  const ofertas = typeof deps.listarEnviosRecentesAutomaticos === "function"
    ? deps.listarEnviosRecentesAutomaticos(clienteId, agoraMs)
    : [];
  for (const oferta of lista(ofertas)) {
    for (const destino of lista(oferta?.destinosEstado)) {
      if (texto(destino?.estado || destino?.status).toLowerCase() !== "enviado") continue;
      registrar(registros, oferta, destino, { agoraMs, origem: "automatico", enviadoEm: oferta.enviadoEm || oferta.dataEnvio });
    }
    for (const destino of lista(oferta?.destinosEnviados)) {
      registrar(registros, oferta, destino, { agoraMs, origem: "automatico", enviadoEm: oferta.enviadoEm || oferta.dataEnvio });
    }
    if (!lista(oferta?.destinosEstado).length && !lista(oferta?.destinosEnviados).length &&
        texto(oferta?.status).toLowerCase() === "enviado") {
      registrar(registros, oferta, {
        destinoId: oferta.destinoId || oferta.destino?.id,
        nome: oferta.destinoNome || oferta.destino?.nome,
        tipo: oferta.destinoTipo || oferta.destino?.tipo,
        enviadoEm: oferta.enviadoEm || oferta.dataEnvio
      }, { agoraMs, origem: "automatico" });
    }
  }
}

function listarEnviosRecentes(clienteId, deps = {}) {
  const valorAgora = typeof deps.now === "function" ? deps.now() : Date.now();
  const agoraMs = typeof valorAgora === "number" ? valorAgora : timestamp(valorAgora);
  const registros = new Map();
  coletarAutomaticos(clienteId, registros, deps, agoraMs);
  coletarManuais(clienteId, registros, deps, agoraMs);
  return [...registros.values()].sort((a, b) => b.enviadoEmMs - a.enviadoEmMs);
}

function filtrarDestinosRecentes(oferta, destinosIds = [], registros = []) {
  const canonicalKey = identidadeCanonica(oferta) || identidadeIsoladaObservacao(oferta);
  if (!canonicalKey) return [];
  const filtro = new Set(lista(destinosIds).map(texto).filter(Boolean));
  return lista(registros)
    .filter((registro) => registro.canonicalKey === canonicalKey && (!filtro.size || filtro.has(registro.destinoId)))
    .map(({ enviadoEmMs, canonicalKey: _, ...publico }) => publico);
}

function destinosRecentesDaOferta(clienteId, oferta, destinosIds = [], deps = {}) {
  return filtrarDestinosRecentes(oferta, destinosIds, listarEnviosRecentes(clienteId, deps));
}

function enriquecerOfertasComDestinosRecentes(clienteId, ofertas = [], deps = {}) {
  const registros = listarEnviosRecentes(clienteId, deps);
  const porProduto = new Map();
  for (const registro of registros) {
    const grupo = porProduto.get(registro.canonicalKey) || [];
    grupo.push(registro);
    porProduto.set(registro.canonicalKey, grupo);
  }
  return lista(ofertas).map((oferta) => {
    const canonicalKey = identidadeCanonica(oferta) || identidadeIsoladaObservacao(oferta);
    const destinosRecentes = lista(porProduto.get(canonicalKey)).map(({ enviadoEmMs, canonicalKey: _, ...publico }) => publico);
    return destinosRecentes.length ? { ...oferta, destinosRecentes } : oferta;
  });
}

module.exports = {
  JANELA_ENVIO_RECENTE_MS,
  listarEnviosRecentes,
  filtrarDestinosRecentes,
  destinosRecentesDaOferta,
  enriquecerOfertasComDestinosRecentes
};
