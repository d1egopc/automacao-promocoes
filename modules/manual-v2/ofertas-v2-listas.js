const crypto = require("crypto");
const fs = require("fs");
const { getClienteJsonPath, writeClienteJson, normalizarClienteId } = require("../../utils/storage");
const storageManual = require("./manual-offers.storage");
const { normalizarOfertaManualV2 } = require("./manual-offers.contract");
const { listarDestinosManuaisV2Async } = require("./manual-destinations");
const { enviarOfertaManualV2 } = require("./manual-dispatcher");
const { INTERVALO_AUTO_MINIMO_MS, INTERVALO_AUTO_MAXIMO_MS } = require("./manual-auto-dispatch");
const { buscarAchado } = require("./ofertas-v2-achados");
const { identidadeCanonica: identidadeCanonicaBase, identidadeIsoladaObservacao } = require("./ofertas-v2-identidade");
const {
  JANELA_ENVIO_RECENTE_MS,
  listarEnviosRecentes,
  filtrarDestinosRecentes,
  destinosRecentesDaOferta
} = require("./ofertas-v2-envios-recentes");
const {
  validarOfertaAfiliacaoWorkspaceShopee, validarProvaAfiliacaoWorkspaceShopee
} = require("../marketplaces/shopee/afiliacao-workspace");
const {
  validarOfertaAfiliacaoWorkspaceAliExpress, validarProvaAfiliacaoWorkspaceAliExpress
} = require("../marketplaces/aliexpress/afiliacao-workspace");
const { validarOfertaAfiliacaoWorkspaceMagalu } = require("../marketplaces/magalu/afiliacao-workspace");

const ARQUIVO_LISTAS = "manual_listas_v2.json";
const ARQUIVO_DEDUPE = "manual_listas_dedupe_v2.json";
const MAX_LISTAS = 6;
const DEDUPE_MS = JANELA_ENVIO_RECENTE_MS;
const RETENCAO_ITEM_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000;
const enviosEmMemoria = new Set();
function texto(valor) { return String(valor ?? "").trim(); }
function lista(valor) { return Array.isArray(valor) ? valor : []; }
function erro(codigo, statusCode = 400) { const e = new Error(codigo); e.codigo = codigo; e.statusCode = statusCode; return e; }
function agora(deps = {}) { return typeof deps.now === "function" ? deps.now() : Date.now(); }
function ms(valor) { const numero = Number(valor); return Number.isFinite(numero) ? numero : Date.parse(texto(valor)); }

function lerJsonEstrito(clienteId, arquivo, fallback, validar) {
  const file = getClienteJsonPath(normalizarClienteId(clienteId), arquivo);
  if (!fs.existsSync(file)) return fallback;
  let dado;
  try { dado = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw erro("listas_storage_corrompido", 500); }
  if (!validar(dado)) throw erro("listas_storage_corrompido", 500);
  return dado;
}
function lerListas(clienteId) {
  const id = normalizarClienteId(clienteId);
  return lerJsonEstrito(id, ARQUIVO_LISTAS, [], (v) => Array.isArray(v) && v.every((l) => l && l.clienteId === id &&
    typeof l.id === "string" && Array.isArray(l.itens)));
}
function salvarListas(clienteId, listas) { writeClienteJson(normalizarClienteId(clienteId), ARQUIVO_LISTAS, listas); return listas; }
function lerDedupe(clienteId) {
  const id = normalizarClienteId(clienteId);
  return lerJsonEstrito(id, ARQUIVO_DEDUPE, {}, (v) => v && !Array.isArray(v) && typeof v === "object" &&
    (!v.clienteId || v.clienteId === id));
}
function salvarDedupe(clienteId, dedupe) { writeClienteJson(normalizarClienteId(clienteId), ARQUIVO_DEDUPE, dedupe); }
function publicoLista(item) {
  return { ...item, itens: item.itens.map(({ oferta, ...publico }) => ({ ...publico,
    titulo: oferta.titulo, marketplace: oferta.marketplace, precoAtual: oferta.precoAtual,
    categoria: oferta.categoria, imagem: oferta.imagem, cupom: Boolean(oferta.cupom) })) };
}
function listarListas(clienteId) { return lerListas(clienteId).map(publicoLista); }
function atualizarLista(clienteId, listaId, alterar) {
  const listas = lerListas(clienteId);
  const indice = listas.findIndex((item) => item.id === texto(listaId));
  if (indice < 0) throw erro("lista_nao_encontrada", 404);
  const proxima = alterar(listas[indice], listas);
  if (proxima) listas[indice] = proxima;
  salvarListas(clienteId, listas);
  return publicoLista(listas[indice]);
}
function criarLista(clienteId, nome, deps = {}) {
  const id = normalizarClienteId(clienteId);
  const nomeLimpo = texto(nome).slice(0, 80);
  if (!nomeLimpo) throw erro("lista_nome_obrigatorio");
  const listas = lerListas(id);
  if (listas.length >= MAX_LISTAS) throw erro("limite_de_6_listas", 409);
  const nova = { id: crypto.randomUUID(), clienteId: id, nome: nomeLimpo, itens: [],
    status: "parada", destinosIds: [], intervaloMs: 0, proximoEm: 0,
    criadoEm: new Date(agora(deps)).toISOString(), atualizadoEm: new Date(agora(deps)).toISOString() };
  salvarListas(id, [...listas, nova]);
  return publicoLista(nova);
}
function nomeCopiaSeguro(nomeOriginal, listas) {
  const nomes = new Set(lista(listas).map((item) => texto(item?.nome).toLocaleLowerCase("pt-BR")));
  const base = texto(nomeOriginal) || "Lista";
  for (let numero = 1; numero <= MAX_LISTAS + 1; numero += 1) {
    const sufixo = numero === 1 ? " — cópia" : ` — cópia ${numero}`;
    const candidato = `${base.slice(0, Math.max(1, 80 - sufixo.length)).trimEnd()}${sufixo}`;
    if (!nomes.has(candidato.toLocaleLowerCase("pt-BR"))) return candidato;
  }
  throw erro("lista_nome_copia_indisponivel", 409);
}
function duplicarLista(clienteId, listaId, deps = {}) {
  const id = normalizarClienteId(clienteId);
  const listas = lerListas(id);
  if (listas.length >= MAX_LISTAS) throw erro("limite_de_6_listas", 409);
  const original = listas.find((item) => item.id === texto(listaId));
  if (!original) throw erro("lista_nao_encontrada", 404);
  const instante = new Date(agora(deps)).toISOString();
  const itens = original.itens.map((item) => ({
    id: crypto.randomUUID(),
    origem: texto(item.origem),
    origemId: texto(item.origemId),
    canonicalKey: texto(item.canonicalKey),
    oferta: JSON.parse(JSON.stringify(item.oferta || {})),
    status: "aguardando",
    motivo: ""
  }));
  const copia = {
    id: crypto.randomUUID(), clienteId: id, nome: nomeCopiaSeguro(original.nome, listas), itens,
    status: "parada", destinosIds: [], intervaloMs: 0, proximoEm: 0,
    criadoEm: instante, atualizadoEm: instante
  };
  salvarListas(id, [...listas, copia]);
  return publicoLista(copia);
}
function renomearLista(clienteId, listaId, nome) {
  const nomeLimpo = texto(nome).slice(0, 80);
  if (!nomeLimpo) throw erro("lista_nome_obrigatorio");
  return atualizarLista(clienteId, listaId, (item) => ({ ...item, nome: nomeLimpo }));
}
function exigirParada(item) {
  if (item.status === "enviando" || item.inFlight) throw erro("lista_em_execucao", 409);
}
function excluirLista(clienteId, listaId) {
  const listas = lerListas(clienteId);
  const atual = listas.find((item) => item.id === texto(listaId));
  if (!atual) throw erro("lista_nao_encontrada", 404);
  exigirParada(atual);
  salvarListas(clienteId, listas.filter((item) => item.id !== atual.id));
  return { ok: true };
}
function esvaziarLista(clienteId, listaId) {
  return atualizarLista(clienteId, listaId, (item) => { exigirParada(item); return { ...item, itens: [] }; });
}
function removerItem(clienteId, listaId, itemId) {
  return atualizarLista(clienteId, listaId, (item) => { exigirParada(item); return { ...item,
    itens: item.itens.filter((entrada) => entrada.id !== texto(itemId)) }; });
}

function identidadeCanonica(oferta) {
  const identidade = identidadeCanonicaBase(oferta) || identidadeIsoladaObservacao(oferta);
  if (!identidade) throw erro("produto_sem_identidade_operacional", 422);
  return identidade;
}
function provarAfiliacao(oferta, clienteId, deps = {}) {
  const marketplace = oferta.marketplace;
  if (!["shopee", "aliexpress", "magalu"].includes(marketplace)) return;
  const integracao = typeof deps.getIntegracaoCliente === "function" ? deps.getIntegracaoCliente(clienteId, marketplace) || {} : {};
  const credenciais = integracao.credenciais || integracao || {};
  const principal = oferta.afiliacaoWorkspaceVerificada?.principal || oferta.afiliacaoWorkspaceVerificada;
  if (!principal || texto(oferta.urlAfiliada) === texto(oferta.urlOriginal) ||
      texto(principal.urlAfiliadaWorkspace) !== texto(oferta.urlAfiliada) ||
      (marketplace === "shopee" && texto(principal.urlFinalPublicada) !== texto(oferta.urlAfiliada)))
    throw erro("afiliacao_workspace_incompleta", 422);
  const opcoes = { clienteId, credenciais, exigirAssinatura: true };
  const validacao = marketplace === "shopee"
    ? validarOfertaAfiliacaoWorkspaceShopee(oferta, opcoes)
    : marketplace === "aliexpress"
      ? validarOfertaAfiliacaoWorkspaceAliExpress(oferta, opcoes)
      : validarOfertaAfiliacaoWorkspaceMagalu(oferta, { clienteId, promoterId: credenciais.promoterId || integracao.promoterId || "" });
  if (!validacao.ok) throw erro("afiliacao_workspace_incompleta", 422);
}
function papelContextual(marketplace, link) {
  const papel = texto(link?.papelLink || link?.papel || link?.tipo).toLowerCase();
  if (marketplace === "aliexpress") {
    if (["produto", "link_produto"].includes(papel)) return "produto";
    if (["app", "link_app"].includes(papel)) return "link_app";
    if (["pc", "link_pc"].includes(papel)) return "link_pc";
    if (["moedas", "link_moedas"].includes(papel)) return "link_moedas";
  }
  if (marketplace === "shopee") {
    if (["produto", "link_produto"].includes(papel)) return "produto";
    if (["resgate", "cupom", "link_resgate", "link_cupom"].includes(papel)) return "resgate";
  }
  return "";
}
async function ofertaDoAchado(achado, clienteId, deps = {}) {
  const marketplace = achado.marketplace;
  const integracao = typeof deps.getIntegracaoCliente === "function" ? deps.getIntegracaoCliente(clienteId, marketplace) || {} : {};
  const credenciais = integracao.credenciais || integracao || {};
  // Achados só é alimentada depois do importer. Reusar sua conversão comprovada,
  // inclusive para shortlinks APP/PC/resgate que o capture manual rejeita.
  const urlPrincipal = texto(achado.urlAfiliada);
  let provaPrincipal = achado.afiliacaoWorkspace || {};
  if (marketplace === "aliexpress" &&
      (!validarProvaAfiliacaoWorkspaceAliExpress(provaPrincipal, { clienteId, credenciais, exigirAssinatura: true }).valida ||
       texto(provaPrincipal.urlAfiliadaWorkspace) !== urlPrincipal)) {
    // O importer pode escolher o PC já convertido como CTA principal técnico.
    // A prova continua com papel PC (ou APP), sem reinterpretá-lo como Produto.
    provaPrincipal = lista(achado.linksComerciais).map((link) => link?.afiliacaoWorkspace || {})
      .find((prova) => ["link_pc", "link_app"].includes(texto(prova.papel)) &&
        texto(prova.urlAfiliadaWorkspace) === urlPrincipal &&
        validarProvaAfiliacaoWorkspaceAliExpress(prova, { clienteId, credenciais, exigirAssinatura: true }).valida) || {};
  }
  const principal = { url: urlPrincipal, prova: provaPrincipal };
  const contextuais = new Map();
  const provas = principal.prova ? [principal.prova] : [];
  const linksVerificados = ["produto", "link_produto"].includes(texto(principal.prova?.papel)) ? [{
    papel: texto(principal.prova.papel), tipo: "produto", urlOriginal: texto(principal.prova.urlOriginal || achado.urlOriginal),
    urlAfiliadaWorkspace: principal.url, urlAfiliada: principal.url,
    renderizavel: true, conversaoStatus: "convertida", afiliacaoWorkspace: principal.prova
  }] : [];
  const ocorrencias = new Set();
  for (const link of lista(achado.linksComerciais)) {
    const papel = papelContextual(marketplace, link);
    if (!papel) continue; // Papéis incompatíveis são descartados, nunca reinterpretados.
    const original = texto(link.urlOriginal || link.url);
    const final = texto(link.urlAfiliadaWorkspace || link.urlAfiliada);
    const prova = link.afiliacaoWorkspace || {};
    if (!original || !final || original === final || link.renderizavel !== true ||
        texto(link.conversaoStatus) !== "convertida" ||
        papelContextual(marketplace, { papel: prova.papel }) !== papel ||
        texto(prova.urlAfiliadaWorkspace) !== final ||
        (marketplace === "shopee" && texto(prova.urlFinalPublicada) !== final))
      throw erro("achado_cta_contextual_incompleto", 422);
    const valida = marketplace === "shopee"
      ? validarProvaAfiliacaoWorkspaceShopee(prova, { clienteId, credenciais, exigirAssinatura: true }).valida
      : validarProvaAfiliacaoWorkspaceAliExpress(prova, { clienteId, credenciais, exigirAssinatura: true }).valida;
    if (!valida) throw erro("afiliacao_workspace_incompleta", 422);
    if (marketplace === "shopee" && papel === "resgate" &&
        texto(prova.urlOriginal) !== original &&
        texto(link.destinoFuncionalOriginal?.url) !== texto(prova.urlOriginal))
      throw erro("achado_cta_contextual_incompleto", 422);
    const ocorrencia = JSON.stringify([papel, original]);
    if (ocorrencias.has(ocorrencia) || (papel === "produto" && final === principal.url)) continue;
    ocorrencias.add(ocorrencia);
    if (!contextuais.has(papel)) contextuais.set(papel, final);
    provas.push(prova);
    linksVerificados.push({
      papel: texto(prova.papel), papelLink: texto(prova.papel), tipo: papel, urlOriginal: original,
      urlAfiliadaWorkspace: final, urlAfiliada: final, renderizavel: true,
      conversaoStatus: "convertida", afiliacaoWorkspace: prova,
      destinoFuncionalOriginal: link.destinoFuncionalOriginal || null,
      ordemCaptura: link.ordemCaptura || linksVerificados.length
    });
  }
  const oferta = normalizarOfertaManualV2({
    marketplace, titulo: achado.titulo, produtoId: achado.produtoId,
    identidadeProdutoVerificada: achado.identidadeProdutoVerificada,
    identidadeObservacaoId: achado.id,
    precoAtual: achado.precoAtual, precoAnterior: achado.precoAnterior,
    cupom: achado.cupom, categoria: achado.categoria, imagem: achado.imagem,
    parcelamento: achado.parcelamento, frete: achado.frete,
    beneficioTexto: lista(achado.beneficios).map(texto).filter(Boolean).join("\n"),
    urlOriginal: achado.urlOriginal, urlAfiliada: principal.url,
    linkApp: contextuais.get("link_app") || "", linkPC: contextuais.get("link_pc") || "",
    linkMoedas: contextuais.get("link_moedas") || "",
    linkResgate: contextuais.get("resgate") || "",
    linksComerciais: linksVerificados,
    afiliacaoWorkspaceVerificada: marketplace === "magalu"
      ? (principal.prova || {}) : { principal: principal.prova || {}, links: provas },
    fonteImportacao: { adapter: "engine_achados_v2", marketplaceDetectado: marketplace }
  }, { clienteId, identidadeImportadorConfiavel: true });
  provarAfiliacao(oferta, clienteId, deps);
  return oferta;
}
async function adicionarItem(clienteId, listaId, { origem, ofertaId } = {}, deps = {}) {
  const id = normalizarClienteId(clienteId);
  let oferta;
  if (origem === "ofertas") {
    const existente = storageManual.buscarOfertaManualV2(id, ofertaId);
    if (!existente) throw erro("oferta_nao_encontrada", 404);
    oferta = normalizarOfertaManualV2({ ...existente,
      identidadeObservacaoId: existente.identidadeObservacaoId || existente.id },
    { clienteId: id, identidadeImportadorConfiavel: true });
    provarAfiliacao(oferta, id, deps);
  } else if (origem === "achados") {
    const achado = buscarAchado(id, ofertaId, agora(deps));
    if (!achado) throw erro("achado_expirado_ou_nao_encontrado", 404);
    oferta = await ofertaDoAchado(achado, id, deps);
  } else throw erro("origem_lista_invalida");
  if (!texto(oferta.urlAfiliada)) throw erro("oferta_sem_link_afiliado", 422);
  const canonicalKey = identidadeCanonica(oferta);
  return atualizarLista(id, listaId, (item) => {
    exigirParada(item);
    if (item.itens.some((i) => i.canonicalKey === canonicalKey)) throw erro("item_ja_na_lista", 409);
    return { ...item, itens: [...item.itens, { id: crypto.randomUUID(), origem, origemId: texto(ofertaId),
      canonicalKey, oferta, status: "aguardando", motivo: "" }] };
  });
}

function preflightLista(clienteId, listaId, destinosIds = [], deps = {}) {
  const ids = [...new Set(lista(destinosIds).map(texto).filter(Boolean))];
  const atual = lerListas(clienteId).find((item) => item.id === texto(listaId));
  if (!atual) throw erro("lista_nao_encontrada", 404);
  const registros = listarEnviosRecentes(clienteId, deps);
  const paresPulados = [];
  const retomar = atual.status === "pausada" && atual.itens.some((item) => item.status === "aguardando");
  const itensElegiveis = retomar ? atual.itens.filter((item) => item.status === "aguardando") : atual.itens;
  const itens = itensElegiveis.map((item) => {
    const recentes = filtrarDestinosRecentes(item.oferta, ids, registros);
    for (const destino of recentes) paresPulados.push({
      itemId: item.id,
      destinoId: destino.destinoId,
      destinoNome: destino.nome,
      enviadoEm: destino.enviadoEm
    });
    return {
      itemId: item.id,
      repetidos: recentes.map((destino) => destino.destinoId),
      permitidos: ids.filter((id) => !recentes.some((destino) => destino.destinoId === id))
    };
  });
  return { totalPares: itensElegiveis.length * ids.length, paresPulados: paresPulados.length, pares: paresPulados, itens };
}

function reservarDestinos(clienteId, listaId, destinosIds, intervaloMs, deps = {}) {
  const ids = [...new Set(lista(destinosIds).map(texto).filter(Boolean))];
  const intervalo = Number(intervaloMs);
  if (!ids.length || !Number.isInteger(intervalo) || intervalo < INTERVALO_AUTO_MINIMO_MS ||
      intervalo > INTERVALO_AUTO_MAXIMO_MS) throw erro("lista_destinos_ou_intervalo_invalidos");
  return (deps.listarDestinosManuaisV2Async || listarDestinosManuaisV2Async)(clienteId, deps).then((destinos) => {
    const mapa = new Map(destinos.map((destino) => [destino.id, destino]));
    if (ids.some((id) => mapa.get(id)?.utilizavel !== true)) throw erro("destino_indisponivel", 422);
    return atualizarLista(clienteId, listaId, (item, todas) => {
      if (item.status === "enviando" || item.inFlight) throw erro("lista_em_execucao", 409);
      if (!item.itens.length) throw erro("lista_vazia", 422);
      const conflito = todas.find((outra) => outra.id !== item.id && outra.status === "enviando" &&
        lista(outra.destinosIds).some((id) => ids.includes(id)));
      if (conflito) throw erro(`destino_em_uso_pela_lista:${conflito.nome}`, 409);
      const retomar = item.status === "pausada" && item.itens.some((i) => i.status === "aguardando");
      if (item.itens.some((i) => texto(i.motivo).startsWith("resultado_indeterminado")) && !retomar)
        throw erro("lista_resultado_indeterminado_requer_reconciliacao", 409);
      return { ...item, status: "enviando", pauseRequested: false, destinosIds: ids, intervaloMs: intervalo,
        proximoEm: agora(deps), itens: retomar ? item.itens : item.itens.map((i) => ({ ...i, status: "aguardando", motivo: "" })) };
    });
  });
}
function interromperLista(clienteId, listaId, modo = "pausada") {
  if (!["pausada", "parada"].includes(modo)) throw erro("estado_lista_invalido");
  return atualizarLista(clienteId, listaId, (item) => ({ ...item,
    ...(item.inFlight ? { pauseRequested: modo } : { status: modo, destinosIds: [], pauseRequested: false }) }));
}
function recuperarExecucoes(clienteId, deps = {}) {
  const listas = lerListas(clienteId);
  let alterou = false;
  for (const item of listas) {
    if (item.inFlight && !enviosEmMemoria.has(`${clienteId}:${item.id}`)) {
      const atual = item.itens.find((i) => i.id === item.inFlight.itemId);
      if (atual) { atual.status = "erro"; atual.motivo = "resultado_indeterminado_apos_restart"; }
      item.status = "pausada";
      item.destinosIds = [];
      item.inFlight = null;
      item.pauseRequested = false;
      alterou = true;
    }
    const antes = item.itens.length;
    item.itens = item.itens.filter((entrada) => !["enviado", "repetido"].includes(entrada.status) ||
      !Number.isFinite(ms(entrada.terminalEm)) || agora(deps) - ms(entrada.terminalEm) < RETENCAO_ITEM_TERMINAL_MS);
    if (item.itens.length !== antes) alterou = true;
  }
  if (alterou) salvarListas(clienteId, listas);
  return listas;
}

function chaveDedupe(canonicalKey, destinoId) { return crypto.createHash("sha256").update(JSON.stringify([canonicalKey, destinoId])).digest("hex"); }
function reservarMemoria(clienteId, canonicalKey, destinosIds, attemptId, nowMs) {
  const dedupe = lerDedupe(clienteId);
  for (const [key, registro] of Object.entries(dedupe)) {
    if (key !== "clienteId" && nowMs - ms(registro?.em) >= DEDUPE_MS) delete dedupe[key];
  }
  const permitidos = [];
  const repetidos = [];
  for (const destinoId of destinosIds) {
    const key = chaveDedupe(canonicalKey, destinoId);
    if (dedupe[key]?.estado === "enviado" && nowMs - ms(dedupe[key].em) < DEDUPE_MS) repetidos.push(destinoId);
    else { permitidos.push(destinoId); dedupe[key] = { estado: "pendente", em: nowMs, attemptId }; }
  }
  salvarDedupe(clienteId, dedupe);
  return { permitidos, repetidos };
}
function concluirMemoria(clienteId, canonicalKey, attemptId, resultados, nowMs) {
  const dedupe = lerDedupe(clienteId);
  for (const resultado of lista(resultados)) {
    const key = chaveDedupe(canonicalKey, resultado.destinoId);
    if (dedupe[key]?.attemptId === attemptId && resultado.status === "enviado")
      dedupe[key] = { estado: "enviado", em: nowMs, attemptId };
  }
  salvarDedupe(clienteId, dedupe);
}
function liberarMemoriaAntesDoDispatcher(clienteId, canonicalKey, attemptId, destinosIds) {
  const dedupe = lerDedupe(clienteId);
  for (const destinoId of destinosIds) {
    const key = chaveDedupe(canonicalKey, destinoId);
    if (dedupe[key]?.attemptId === attemptId && dedupe[key]?.estado === "pendente") delete dedupe[key];
  }
  salvarDedupe(clienteId, dedupe);
}

async function processarLista(clienteId, listaId, deps = {}) {
  const memoriaKey = `${clienteId}:${listaId}`;
  if (enviosEmMemoria.has(memoriaKey)) return { processado: false, motivo: "em_voo" };
  const listaAtual = lerListas(clienteId).find((item) => item.id === listaId);
  if (!listaAtual || listaAtual.status !== "enviando" || listaAtual.inFlight || agora(deps) < Number(listaAtual.proximoEm || 0))
    return { processado: false, motivo: "nao_elegivel" };
  const proximo = listaAtual.itens.find((item) => item.status === "aguardando");
  if (!proximo) {
    atualizarLista(clienteId, listaId, (item) => ({ ...item, status: "concluida", destinosIds: [] }));
    return { processado: true, motivo: "concluida" };
  }
  const attemptId = crypto.randomUUID();
  const agoraProcessamento = agora(deps);
  const recentesOficiais = destinosRecentesDaOferta(clienteId, proximo.oferta, listaAtual.destinosIds, deps);
  const idsRecentesOficiais = new Set(recentesOficiais.map((destino) => destino.destinoId));
  const livresOficiais = listaAtual.destinosIds.filter((destinoId) => !idsRecentesOficiais.has(destinoId));
  const reserva = reservarMemoria(clienteId, proximo.canonicalKey, livresOficiais, attemptId, agoraProcessamento);
  reserva.repetidos = [...new Set([...idsRecentesOficiais, ...reserva.repetidos])];
  if (!reserva.permitidos.length) {
    atualizarLista(clienteId, listaId, (item) => {
      const itens = item.itens.map((i) => i.id === proximo.id ? { ...i, status: "repetido",
        motivo: "ignorado_enviado_recentemente", repetidos: reserva.repetidos, terminalEm: agora(deps) } : i);
      const concluida = !itens.some((i) => i.status === "aguardando");
      return { ...item, status: concluida ? "concluida" : "enviando",
        destinosIds: concluida ? [] : item.destinosIds,
        proximoEm: agora(deps) + item.intervaloMs, itens };
    });
    return { processado: true, motivo: "repetido", paresPulados: reserva.repetidos.length };
  }
  enviosEmMemoria.add(memoriaKey);
  let manualId = "";
  try {
    const manual = storageManual.criarOfertaManualV2(clienteId, {
      ...proximo.oferta, origemAgendamento: "lista_v2",
      identidadeObservacaoId: proximo.oferta.identidadeObservacaoId || proximo.oferta.id
    }, { identidadeImportadorConfiavel: true });
    manualId = manual.id;
    atualizarLista(clienteId, listaId, (item) => ({ ...item, inFlight: { attemptId, itemId: proximo.id, manualId,
      destinosIds: reserva.permitidos, repetidos: reserva.repetidos, iniciadoEm: agora(deps) } }));
    const resultado = await (deps.enviarOfertaManualV2 || enviarOfertaManualV2)(
      { clienteId, ofertaId: manualId, destinosIds: reserva.permitidos }, deps);
    const fim = agora(deps);
    const resultados = lista(resultado?.resultados);
    const ignoradosConcorrencia = resultados.filter((r) =>
      texto(r?.status).toLowerCase() === "ignorado_enviado_recentemente");
    concluirMemoria(clienteId, proximo.canonicalKey, attemptId, resultados, fim);
    storageManual.atualizarMetadadosEnvioManualV2(clienteId, manualId, {
      status: resultados.some((r) => r.status === "enviado") ? "enviada" : ignoradosConcorrencia.length ? "salva" : "erro",
      enviadoEm: resultados.some((r) => r.status === "enviado") ? new Date(fim).toISOString() : "",
      envioManual: { solicitadoEm: new Date(fim).toISOString(), concluidoEm: new Date(fim).toISOString(),
        resultados, enviados: resultado?.enviados || 0, erros: resultado?.erros || 0,
        creditosDebitados: resultado?.creditosDebitados || 0 }
    });
    atualizarLista(clienteId, listaId, (item) => {
      const houveEnvio = resultados.some((r) => r.status === "enviado");
      const totalmenteIgnorado = !houveEnvio && ignoradosConcorrencia.length === reserva.permitidos.length;
      const itens = item.itens.map((i) => i.id === proximo.id ? { ...i,
        status: houveEnvio ? "enviado" : totalmenteIgnorado ? "repetido" : "erro",
        motivo: houveEnvio ? "" : totalmenteIgnorado ? "ignorado_enviado_recentemente" : "falha_no_dispatcher",
        terminalEm: fim, manualOfferId: manualId,
        repetidos: [...new Set([...reserva.repetidos, ...ignoradosConcorrencia.map((r) => r.destinoId)])] } : i);
      const concluida = !itens.some((i) => i.status === "aguardando");
      const status = item.pauseRequested || (concluida ? "concluida" : "enviando");
      return { ...item, inFlight: null, status,
        destinosIds: status === "enviando" ? item.destinosIds : [],
        pauseRequested: false, proximoEm: fim + item.intervaloMs, itens };
    });
    return { processado: true, motivo: ignoradosConcorrencia.length === reserva.permitidos.length
      ? "repetido" : "despachado", resultado,
    paresPulados: reserva.repetidos.length + ignoradosConcorrencia.length };
  } catch (e) {
    // Depois da reserva ou do início do dispatcher, o resultado externo pode ser indeterminado.
    if (!manualId) liberarMemoriaAntesDoDispatcher(clienteId, proximo.canonicalKey, attemptId, reserva.permitidos);
    atualizarLista(clienteId, listaId, (item) => ({ ...item, status: "pausada", destinosIds: [],
      inFlight: null, pauseRequested: false,
      itens: item.itens.map((i) => i.id === proximo.id ? { ...i, status: "erro",
        motivo: manualId ? "resultado_indeterminado" : "falha_antes_do_dispatcher", manualOfferId: manualId } : i) }));
    return { processado: true, motivo: "resultado_indeterminado", erro: texto(e?.codigo || e?.message).slice(0, 120) };
  } finally { enviosEmMemoria.delete(memoriaKey); }
}
async function processarListasCliente(clienteId, deps = {}) {
  const listas = recuperarExecucoes(clienteId, deps).filter((item) => item.status === "enviando");
  return Promise.all(listas.map((item) => processarLista(clienteId, item.id, deps)));
}

module.exports = {
  ARQUIVO_LISTAS, ARQUIVO_DEDUPE, MAX_LISTAS, DEDUPE_MS,
  lerListas, listarListas, criarLista, duplicarLista, renomearLista, excluirLista, esvaziarLista,
  adicionarItem, removerItem, reservarDestinos, interromperLista, recuperarExecucoes,
  preflightLista, processarLista, processarListasCliente, identidadeCanonica, ofertaDoAchado
};
