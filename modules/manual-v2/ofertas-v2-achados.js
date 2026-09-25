const fs = require("fs");
const { getClienteJsonPath, writeClienteJson, normalizarClienteId } = require("../../utils/storage");
const { MARKETPLACES_MANUAL_V2 } = require("./manual-offers.contract");
const { categoriaGenerica } = require("../inteligencia-universal/categoria.service");
const {
  identidadeCanonica,
  identidadeTituloConservadora,
  identidadeIsoladaObservacao
} = require("./ofertas-v2-identidade");

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

function origemTituloAchado(metadata = {}) {
  const mlWork = objeto(metadata.mlWorkEnrichmentActive);
  if (mlWork.identidadeValidada === true && mlWork.tituloWorkAplicado === true) {
    return "local_worker.ml_identity_v1";
  }
  const produto = objeto(metadata.produto);
  const autoridade = objeto(metadata.autoridadeFactual);
  return texto(produto.tituloOrigem || autoridade.tituloOrigem);
}

function qualidadeOrigem(valor = "") {
  const origem = texto(valor).toLowerCase();
  if (!origem) return 1;
  if (/local_worker\.ml_identity_v1|work_validado/.test(origem)) return 4;
  if (/oficial|official|marketplace_api|product_api|adapter_oficial|canonic/.test(origem)) return 3;
  return 2;
}

function tituloGenerico(valor = "") {
  const normalizado = texto(valor).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return !normalizado || ["produto", "oferta", "promocao", "item"].includes(normalizado);
}

function qualidadeApresentacaoTitulo(valor = "") {
  const titulo = texto(valor);
  const acentos = (titulo.match(/[\u00c0-\u017f]/g) || []).length;
  const ruido = (titulo.match(/\*/g) || []).length + (/[*|\-–—:,;]+\s*$/.test(titulo) ? 1 : 0);
  return acentos - (ruido * 10);
}

function escolherTitulo(existente = {}, novo = {}) {
  const atual = texto(existente.titulo);
  const recebido = texto(novo.titulo);
  if (!recebido || (tituloGenerico(recebido) && !tituloGenerico(atual))) {
    return { titulo: atual, tituloOrigem: texto(existente.tituloOrigem) };
  }
  if (!atual || (tituloGenerico(atual) && !tituloGenerico(recebido))) {
    return { titulo: recebido, tituloOrigem: texto(novo.tituloOrigem) };
  }
  const qualidadeAtual = qualidadeOrigem(existente.tituloOrigem);
  const qualidadeNova = qualidadeOrigem(novo.tituloOrigem);
  if (qualidadeAtual !== qualidadeNova) {
    return qualidadeNova > qualidadeAtual
      ? { titulo: recebido, tituloOrigem: texto(novo.tituloOrigem) }
      : { titulo: atual, tituloOrigem: texto(existente.tituloOrigem) };
  }
  if (identidadeTituloConservadora(existente) === identidadeTituloConservadora(novo) &&
      qualidadeApresentacaoTitulo(atual) !== qualidadeApresentacaoTitulo(recebido)) {
    return qualidadeApresentacaoTitulo(recebido) > qualidadeApresentacaoTitulo(atual)
      ? { titulo: recebido, tituloOrigem: texto(novo.tituloOrigem) }
      : { titulo: atual, tituloOrigem: texto(existente.tituloOrigem) };
  }
  return { titulo: recebido, tituloOrigem: texto(novo.tituloOrigem) };
}

function imagemValida(valor = "") {
  try {
    return ["http:", "https:"].includes(new URL(texto(valor)).protocol);
  } catch { return false; }
}

function qualidadeOrigemImagem(valor = "") {
  const origem = texto(valor).toLowerCase();
  if (/radar|whatsapp|telegram/.test(origem)) return 0;
  return qualidadeOrigem(origem);
}

function escolherImagem(existente = {}, novo = {}) {
  const atual = texto(existente.imagem);
  const recebida = texto(novo.imagem);
  const atualValida = imagemValida(atual);
  const novaValida = imagemValida(recebida);
  if (!novaValida || qualidadeOrigemImagem(novo.imagemOrigem) === 0) {
    return { imagem: atualValida ? atual : "", imagemOrigem: atualValida ? texto(existente.imagemOrigem) : "" };
  }
  if (!atualValida || qualidadeOrigemImagem(novo.imagemOrigem) >= qualidadeOrigemImagem(existente.imagemOrigem)) {
    return { imagem: recebida, imagemOrigem: texto(novo.imagemOrigem) };
  }
  return { imagem: atual, imagemOrigem: texto(existente.imagemOrigem) };
}

function escolherCategoria(existente = {}, novo = {}) {
  const atual = texto(existente.categoria);
  const recebida = texto(novo.categoria);
  if (categoriaGenerica(recebida) && !categoriaGenerica(atual)) return atual;
  if (!categoriaGenerica(recebida) && categoriaGenerica(atual)) return recebida;
  return recebida || atual;
}

function primeiroInstante(existente = {}, novo = {}) {
  return [existente.primeiroCapturadoEm, existente.capturadoEm, novo.primeiroCapturadoEm, novo.capturadoEm]
    .map(texto).filter((valor) => Number.isFinite(Date.parse(valor)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";
}

function mesclarIdentidadeVisual(existente = {}, novo = {}) {
  const titulo = escolherTitulo(existente, novo);
  const imagem = escolherImagem(existente, novo);
  return {
    ...novo,
    ...titulo,
    ...imagem,
    categoria: escolherCategoria(existente, novo),
    primeiroCapturadoEm: primeiroInstante(existente, novo) || texto(novo.primeiroCapturadoEm)
  };
}

function identidadeAchado(achado = {}) {
  return identidadeCanonica(achado) || identidadeTituloConservadora(achado) || identidadeIsoladaObservacao(achado);
}

function consolidarCanonicos(achados = []) {
  const mapa = new Map();
  for (const item of achados) {
    // Recalcular impede que uma chave permissiva persistida por versão antiga
    // continue fundindo observações sem identidade oficial.
    const canonicalKey = identidadeAchado(item);
    const chave = canonicalKey ? `${texto(item?.clienteId)}:${canonicalKey}` : `oferta:${texto(item?.clienteId)}:${texto(item?.id)}`;
    const normalizado = canonicalKey && item?.canonicalKey !== canonicalKey ? { ...item, canonicalKey } : item;
    const atual = mapa.get(chave);
    if (!atual) mapa.set(chave, normalizado);
    else {
      const normalizadoMaisNovo = instanteAchado(normalizado) > instanteAchado(atual) ||
        (instanteAchado(normalizado) === instanteAchado(atual) && texto(normalizado?.id).localeCompare(texto(atual?.id)) > 0);
      mapa.set(chave, normalizadoMaisNovo
        ? mesclarIdentidadeVisual(atual, normalizado)
        : mesclarIdentidadeVisual(normalizado, atual));
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
    tituloOrigem: origemTituloAchado(metadata),
    precoAtual: Number(universal.comercial.precoAtual),
    precoAnterior: universal.comercial.precoAnterior == null ? null : Number(universal.comercial.precoAnterior),
    cupom: texto(universal.comercial.cupom),
    parcelamento: texto(universal.comercial.parcelamento),
    frete: texto(universal.comercial.frete),
    beneficios: Array.isArray(universal.comercial.beneficios)
      ? universal.comercial.beneficios.map(texto).filter(Boolean) : [],
    imagem: texto(universal.midia?.imagemPrincipal),
    imagemOrigem: texto(universal.midia?.origemImagem || metadata.imagemOrigem),
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
  const canonicalKey = identidadeAchado(achado);
  if (!canonicalKey) return { ok: false, motivo: "produto_sem_identidade_canonica" };
  const existente = atual
    .filter((item) => identidadeAchado(item) === canonicalKey)
    .sort((a, b) => instanteAchado(b) - instanteAchado(a))[0];
  const consolidado = {
    ...mesclarIdentidadeVisual(existente, achado),
    id: existente?.id || achado.id,
    canonicalKey,
    ofertaIdAtual: achado.id,
    primeiroCapturadoEm: texto(existente?.primeiroCapturadoEm || existente?.capturadoEm) || capturadoEm
  };
  const proximo = selecionarEstoque([consolidado, ...atual.filter((item) =>
    item.id !== consolidado.id &&
    identidadeAchado(item) !== canonicalKey)]);
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
  identidadeAchado, mesclarIdentidadeVisual, consolidarCanonicos, selecionarEstoque,
  registrarAchado, listarAchados, buscarAchado
};
