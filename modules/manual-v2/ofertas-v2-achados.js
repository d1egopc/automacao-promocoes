const fs = require("fs");
const { getClienteJsonPath, writeClienteJson, normalizarClienteId } = require("../../utils/storage");
const { MARKETPLACES_MANUAL_V2 } = require("./manual-offers.contract");
const { identidadeCanonica, identidadeIsoladaObservacao } = require("./ofertas-v2-identidade");

const ARQUIVO_ACHADOS = "manual_achados_v2.json";
const TTL_ACHADOS_MS = 48 * 60 * 60 * 1000;
const LIMITE_POR_MARKETPLACE = 40;
const MARKETPLACES_ACHADOS = new Set(MARKETPLACES_MANUAL_V2.filter((item) => item !== "manual"));

function texto(valor) { return String(valor ?? "").trim(); }
function objeto(valor) { return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {}; }
function erro(codigo) { const e = new Error(codigo); e.codigo = codigo; e.statusCode = 422; return e; }

const CAMPOS_PROVA = ["marketplace", "workspaceId", "appId", "affiliateIdEsperado", "affiliateIdDetectado",
  "appKey", "trackingIdEnviado", "papel", "urlOriginal", "urlAfiliadaWorkspace", "urlFinalPublicada",
  "urlFinalExpandida", "origemConversao", "conversaoStatus", "motivoConversao", "assinatura"];
function provaCompacta(valor) {
  const prova = objeto(valor);
  return Object.fromEntries(CAMPOS_PROVA.filter((campo) => Object.hasOwn(prova, campo))
    .map((campo) => [campo, texto(prova[campo])]));
}
function linksCompactos(links, marketplace) {
  if (!["shopee", "aliexpress"].includes(marketplace)) return [];
  return (Array.isArray(links) ? links : []).map((link) => ({
    papel: texto(link?.papel), papelLink: texto(link?.papelLink), tipo: texto(link?.tipo),
    urlOriginal: texto(link?.urlOriginal), urlAfiliadaWorkspace: texto(link?.urlAfiliadaWorkspace || link?.urlAfiliada),
    renderizavel: link?.renderizavel === true, conversaoStatus: texto(link?.conversaoStatus),
    afiliacaoWorkspace: provaCompacta(link?.afiliacaoWorkspace),
    destinoFuncionalOriginal: link?.destinoFuncionalOriginal?.url
      ? { url: texto(link.destinoFuncionalOriginal.url) } : null,
    ordemCaptura: Number(link?.ordemCaptura || 0) || 0
  }));
}

function lerAchados(clienteId) {
  const file = getClienteJsonPath(normalizarClienteId(clienteId), ARQUIVO_ACHADOS);
  if (!fs.existsSync(file)) return [];
  let dados;
  try { dados = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw erro("achados_storage_corrompido"); }
  if (!Array.isArray(dados)) throw erro("achados_storage_corrompido");
  return dados.filter((item) => item && item.clienteId === clienteId);
}

function rank(achado, agoraMs) {
  const idadeHoras = Math.max(0, Math.floor((agoraMs - Date.parse(achado.capturadoEm)) / 3600000));
  return 100 - idadeHoras + (achado.cupom ? 12 : 0);
}

function instanteAchado(achado = {}) {
  const valor = Date.parse(texto(achado.ultimaObservacaoEm || achado.capturadoEm));
  return Number.isFinite(valor) ? valor : -Infinity;
}

function consolidarCanonicos(achados = []) {
  const mapa = new Map();
  for (const item of achados) {
    // Recalcular impede que uma chave permissiva persistida por versão antiga
    // continue fundindo observações sem identidade oficial.
    const canonicalKey = identidadeCanonica(item) || identidadeIsoladaObservacao(item);
    const chave = canonicalKey ? `${texto(item?.clienteId)}:${canonicalKey}` : `oferta:${texto(item?.clienteId)}:${texto(item?.id)}`;
    const normalizado = canonicalKey && item?.canonicalKey !== canonicalKey ? { ...item, canonicalKey } : item;
    const atual = mapa.get(chave);
    if (!atual || instanteAchado(normalizado) > instanteAchado(atual) ||
        (instanteAchado(normalizado) === instanteAchado(atual) && texto(normalizado?.id).localeCompare(texto(atual?.id)) > 0)) {
      mapa.set(chave, normalizado);
    }
  }
  return [...mapa.values()];
}

function selecionarEstoque(achados, agoraMs = Date.now()) {
  const porMarketplace = new Map();
  for (const item of consolidarCanonicos(achados)) {
    const capturadoMs = Date.parse(texto(item?.capturadoEm));
    if (!MARKETPLACES_ACHADOS.has(item?.marketplace) || !Number.isFinite(capturadoMs) ||
        capturadoMs > agoraMs || agoraMs - capturadoMs >= TTL_ACHADOS_MS) continue;
    const grupo = porMarketplace.get(item.marketplace) || [];
    grupo.push(item);
    porMarketplace.set(item.marketplace, grupo);
  }
  return [...porMarketplace.values()].flatMap((grupo) => grupo
    .sort((a, b) => rank(b, agoraMs) - rank(a, agoraMs) ||
      Date.parse(b.capturadoEm) - Date.parse(a.capturadoEm) || texto(b.id).localeCompare(texto(a.id)))
    .slice(0, LIMITE_POR_MARKETPLACE));
}

function registrarAchado({ clienteId, ofertaId, ofertaUniversal, metadata = {}, capturedAt } = {}) {
  const id = normalizarClienteId(clienteId);
  const universal = objeto(ofertaUniversal);
  const validacao = objeto(metadata.ofertaUniversalValidacao);
  if (validacao.ok !== true || universal.workspaceId !== id || !universal.ofertaId ||
      String(universal.ofertaId) !== String(ofertaId) || !MARKETPLACES_ACHADOS.has(universal.marketplace) ||
      !texto(universal.produto?.titulo) || !Number.isFinite(Number(universal.comercial?.precoAtual)) ||
      !texto(universal.afiliacao?.urlAfiliada)) return { ok: false, motivo: "oferta_nao_elegivel" };

  const capturadoEm = texto(capturedAt || universal.criadoEm || new Date().toISOString());
  if (!Number.isFinite(Date.parse(capturadoEm))) return { ok: false, motivo: "captura_sem_tempo" };
  const achado = {
    id: String(ofertaId), clienteId: id, marketplace: universal.marketplace,
    titulo: texto(universal.produto.titulo), produtoId: texto(universal.produto.idExterno),
    // O campo vem da Oferta Universal validada, dentro do importer, nao da API Manual.
    identidadeProdutoVerificada: { origem: "engine_importer", marketplace: universal.marketplace,
      id: texto(universal.produto.idExterno) },
    categoria: texto(universal.produto.categoriaNormalizada),
    precoAtual: Number(universal.comercial.precoAtual),
    precoAnterior: universal.comercial.precoAnterior == null ? null : Number(universal.comercial.precoAnterior),
    cupom: texto(universal.comercial.cupom),
    parcelamento: texto(universal.comercial.parcelamento),
    frete: texto(universal.comercial.frete),
    beneficios: Array.isArray(universal.comercial.beneficios)
      ? universal.comercial.beneficios.map(texto).filter(Boolean) : [],
    imagem: texto(universal.midia?.imagemPrincipal),
    urlOriginal: texto(universal.produto.urlCanonica || universal.produto.urlOriginal),
    urlAfiliada: texto(universal.afiliacao.urlAfiliada),
    // Somente a evidência de saída do importer; nunca aceitar esses campos da API pública.
    linksComerciais: linksCompactos(metadata.linksComerciais, universal.marketplace),
    afiliacaoWorkspace: ["shopee", "aliexpress"].includes(universal.marketplace)
      ? provaCompacta(metadata.afiliacaoWorkspace) : objeto(metadata.afiliacaoWorkspace),
    capturadoEm,
    ultimaObservacaoEm: capturadoEm
  };
  const atual = lerAchados(id);
  const canonicalKey = identidadeCanonica(achado) || identidadeIsoladaObservacao(achado);
  if (!canonicalKey) return { ok: false, motivo: "produto_sem_identidade_canonica" };
  const existente = atual
    .filter((item) => (identidadeCanonica(item) || identidadeIsoladaObservacao(item)) === canonicalKey)
    .sort((a, b) => instanteAchado(b) - instanteAchado(a))[0];
  const consolidado = {
    ...achado,
    id: existente?.id || achado.id,
    canonicalKey,
    ofertaIdAtual: achado.id,
    primeiroCapturadoEm: texto(existente?.primeiroCapturadoEm || existente?.capturadoEm) || capturadoEm
  };
  const proximo = selecionarEstoque([consolidado, ...atual.filter((item) =>
    item.id !== consolidado.id &&
    (identidadeCanonica(item) || identidadeIsoladaObservacao(item)) !== canonicalKey)]);
  writeClienteJson(id, ARQUIVO_ACHADOS, proximo);
  return { ok: true, achado: consolidado, atualizado: Boolean(existente) };
}

function listarAchados(clienteId, { marketplace = "", categoria = "", busca = "", nowMs = Date.now() } = {}) {
  const id = normalizarClienteId(clienteId);
  const todos = selecionarEstoque(lerAchados(id), nowMs);
  const termo = texto(busca).toLowerCase();
  return todos.filter((item) => (!marketplace || item.marketplace === marketplace) &&
      (!categoria || item.categoria === categoria) &&
      (!termo || item.titulo.toLowerCase().includes(termo) || item.produtoId.toLowerCase().includes(termo)))
    .map(({ linksComerciais, afiliacaoWorkspace, urlOriginal, urlAfiliada, ...publico }) => publico);
}

function buscarAchado(clienteId, achadoId, nowMs = Date.now()) {
  return selecionarEstoque(lerAchados(normalizarClienteId(clienteId)), nowMs)
    .find((item) => item.id === String(achadoId)) || null;
}

module.exports = {
  ARQUIVO_ACHADOS, TTL_ACHADOS_MS, LIMITE_POR_MARKETPLACE, MARKETPLACES_ACHADOS,
  consolidarCanonicos, selecionarEstoque, registrarAchado, listarAchados, buscarAchado
};
