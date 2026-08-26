"use strict";

const {
  identidadeAntiRepeticaoAutomatica,
  ofertasEquivalentesAntiRepeticao,
  melhoriaFinanceiraComprovada
} = require("../../marketplaces/inteligencia/memoria-ofertas");

const JANELA_EXECUTOR_MS = 2 * 60 * 60 * 1000;
const STATUS_VIVO_DIRETO = new Set(["pendente", "processando", "enviando"]);

function texto(valor = "") {
  return String(valor || "").trim();
}

function textoNormalizado(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clienteItem(item = {}) {
  return texto(item.clienteId || item.cliente_id || "admin") || "admin";
}

function statusItem(item = {}) {
  return textoNormalizado(item.status || item.estado || "pendente");
}

function numeroComparavel(valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : texto(valor);
}

function timestampFila(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;
  const bruto = texto(valor);
  if (!bruto) return NaN;

  const brasileiro = bruto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (brasileiro) {
    return Date.UTC(
      Number(brasileiro[3]),
      Number(brasileiro[2]) - 1,
      Number(brasileiro[1]),
      Number(brasileiro[4]) + 3,
      Number(brasileiro[5]),
      Number(brasileiro[6] || 0)
    );
  }

  const direto = Date.parse(bruto);
  return Number.isFinite(direto) ? direto : NaN;
}

function idCampos(item = {}) {
  return [
    item.id,
    item.ofertaId,
    item.oferta_id,
    item.engineOfertaId,
    item.engine_oferta_id,
    item.idOferta
  ].map(texto).filter(Boolean);
}

function linkCanonico(valor = "") {
  const bruto = textoNormalizado(valor);
  if (!bruto) return "";
  return bruto
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function produtoCampos(item = {}) {
  return [
    item.produtoId,
    item.productId,
    item.idProduto,
    item.asin,
    item.mlbId,
    item.itemId,
    item.sku
  ].map(textoNormalizado).filter(Boolean);
}

function chavesFingerprint(item = {}) {
  const chaves = new Set();
  const clienteId = clienteItem(item);
  const marketplace = textoNormalizado(item.marketplace || item.mercado || "");

  try {
    const identidade = identidadeAntiRepeticaoAutomatica(item);
    if (identidade?.identidade && !String(identidade.identidade).endsWith("|titulo:")) {
      chaves.add(`identidade:${identidade.identidade}`);
    }
  } catch {}

  for (const produto of produtoCampos(item)) {
    chaves.add(`produto:${clienteId}|${marketplace}|${produto}`);
  }

  for (const link of [
    item.linkOriginal,
    item.urlOriginal,
    item.url,
    item.link,
    item.linkAfiliado,
    item.linkFinal,
    item.link_afiliado
  ].map(linkCanonico).filter(Boolean)) {
    chaves.add(`link:${clienteId}|${marketplace}|${link}`);
  }

  const titulo = textoNormalizado(item.titulo || item.nome || item.produto || "");
  const preco = numeroComparavel(item.precoAtual ?? item.preco ?? item.valorEfetivo);
  if (titulo && preco) chaves.add(`titulo_preco:${clienteId}|${marketplace}|${titulo}|${preco}`);

  return [...chaves];
}

function itemVivoOperacional(item = {}) {
  const status = statusItem(item);
  if (STATUS_VIVO_DIRETO.has(status)) return true;
  if (status === "erro") return Boolean(item.proximaTentativaEnvioEm || item.retry || item.recuperavel);
  if (status === "retida") {
    const motivo = textoNormalizado(item.motivoRetencao || item.motivo || item.statusDetalhe || "");
    return Boolean(item.proximaTentativaEnvioEm) ||
      motivo.includes("intervalo") ||
      motivo.includes("aguardando") ||
      motivo.includes("sessao");
  }
  return false;
}

function criarEstadoVazio() {
  return {
    porCliente: new Map(),
    vivosPorCliente: new Map(),
    enviadosPorCliente: new Map(),
    porId: new Map(),
    porFingerprint: new Map(),
    refsPorItem: new WeakMap()
  };
}

function adicionarMapaSet(mapa, chave, item, refs) {
  if (!chave) return;
  let set = mapa.get(chave);
  if (!set) {
    set = new Set();
    mapa.set(chave, set);
  }
  set.add(item);
  refs.push([mapa, chave, set]);
}

function removerRefs(refs = [], item) {
  for (const [mapa, chave, set] of refs) {
    set.delete(item);
    if (set.size === 0) mapa.delete(chave);
  }
}

function contarItensMapa(mapa) {
  let total = 0;
  for (const set of mapa.values()) total += set.size;
  return total;
}

function criarFilaStore(filaInicial = []) {
  let estado = criarEstadoVazio();
  const metricas = {
    totalIndexado: 0,
    vivos: 0,
    enviadosRecentes: 0,
    consultasPorIndice: 0,
    consultasPorId: 0,
    consultasPorFingerprint: 0,
    fallbacksLegados: 0,
    rebuilds: 0,
    atualizacoes: 0,
    remocoes: 0,
    divergenciasDetectadas: 0
  };

  function indexarItem(item, agora = Date.now()) {
    if (!item || typeof item !== "object") return false;
    const refs = [];
    const clienteId = clienteItem(item);
    const status = statusItem(item);

    adicionarMapaSet(estado.porCliente, clienteId, item, refs);
    if (itemVivoOperacional(item)) adicionarMapaSet(estado.vivosPorCliente, clienteId, item, refs);
    if (status === "enviado") adicionarMapaSet(estado.enviadosPorCliente, clienteId, item, refs);

    for (const id of idCampos(item)) {
      adicionarMapaSet(estado.porId, `${clienteId}|${id}`, item, refs);
    }

    for (const chave of chavesFingerprint(item)) {
      adicionarMapaSet(estado.porFingerprint, chave, item, refs);
    }

    estado.refsPorItem.set(item, refs);
    metricas.totalIndexado += 1;
    if (itemVivoOperacional(item)) metricas.vivos += 1;
    if (status === "enviado") {
      const enviadoEmMs = timestampFila(item.enviadoEm || item.dataEnvio);
      if (Number.isFinite(enviadoEmMs) && agora - enviadoEmMs >= 0 && agora - enviadoEmMs < JANELA_EXECUTOR_MS) {
        metricas.enviadosRecentes += 1;
      }
    }
    return true;
  }

  function rebuild(fila = [], opcoes = {}) {
    estado = criarEstadoVazio();
    metricas.totalIndexado = 0;
    metricas.vivos = 0;
    metricas.enviadosRecentes = 0;
    metricas.rebuilds += 1;
    const agora = Number(opcoes.agora || Date.now());
    for (const item of Array.isArray(fila) ? fila : []) indexarItem(item, agora);
    return snapshotMetricas();
  }

  function rebuildCliente(fila = [], clienteId = "admin", opcoes = {}) {
    const cliente = texto(clienteId || "admin") || "admin";
    for (const item of [...(estado.porCliente.get(cliente) || [])]) removerItem(item);
    metricas.rebuilds += 1;
    const agora = Number(opcoes.agora || Date.now());
    for (const item of Array.isArray(fila) ? fila : []) {
      if (clienteItem(item) === cliente) indexarItem(item, agora);
    }
    return snapshotMetricas();
  }

  function atualizarItem(item, opcoes = {}) {
    removerItem(item, { contar: false });
    const ok = indexarItem(item, Number(opcoes.agora || Date.now()));
    if (ok) metricas.atualizacoes += 1;
    return ok;
  }

  function removerItem(item, opcoes = {}) {
    const refs = estado.refsPorItem.get(item);
    if (!refs) return false;
    removerRefs(refs, item);
    estado.refsPorItem.delete(item);
    if (opcoes.contar !== false) metricas.remocoes += 1;
    return true;
  }

  function itensPorCliente(clienteId = "admin") {
    return [...(estado.porCliente.get(texto(clienteId || "admin") || "admin") || [])];
  }

  function vivosPorCliente(clienteId = "admin") {
    return [...(estado.vivosPorCliente.get(texto(clienteId || "admin") || "admin") || [])];
  }

  function enviadosRecentesPorCliente(clienteId = "admin", agora = Date.now()) {
    const cliente = texto(clienteId || "admin") || "admin";
    return [...(estado.enviadosPorCliente.get(cliente) || [])].filter(item => {
      const enviadoEmMs = timestampFila(item.enviadoEm || item.dataEnvio);
      return Number.isFinite(enviadoEmMs) && agora - enviadoEmMs >= 0 && agora - enviadoEmMs < JANELA_EXECUTOR_MS;
    });
  }

  function resolverPorId(clienteId = "admin", id = "") {
    metricas.consultasPorId += 1;
    const itens = estado.porId.get(`${texto(clienteId || "admin") || "admin"}|${texto(id)}`) || new Set();
    return [...itens][0] || null;
  }

  function candidatosPorFingerprint(oferta = {}) {
    metricas.consultasPorFingerprint += 1;
    const chaves = chavesFingerprint(oferta);
    if (!chaves.length) {
      metricas.fallbacksLegados += 1;
      return { ok: false, motivo: "sem_fingerprint_seguro", itens: [] };
    }

    const itens = new Set();
    for (const chave of chaves) {
      for (const item of estado.porFingerprint.get(chave) || []) itens.add(item);
    }
    return { ok: true, motivo: "fingerprint", itens: [...itens] };
  }

  function candidatosEnvioRecente2h(oferta = {}, opcoes = {}) {
    const agora = Number(opcoes.agora || Date.now());
    const clienteId = texto(opcoes.clienteId || oferta.clienteId || oferta.cliente_id || "admin") || "admin";
    const candidatos = candidatosPorFingerprint(oferta);
    if (!candidatos.ok) return candidatos;
    return {
      ok: true,
      motivo: "fingerprint_enviado_recente",
      itens: candidatos.itens.filter(item => {
        if (item === oferta) return false;
        if (clienteItem(item) !== clienteId) return false;
        if (statusItem(item) !== "enviado") return false;
        if (!ofertasEquivalentesAntiRepeticao(oferta, item)) return false;
        if (melhoriaFinanceiraComprovada(oferta, item).ok) return false;
        const enviadoEmMs = timestampFila(item.enviadoEm || item.dataEnvio);
        return Number.isFinite(enviadoEmMs) && enviadoEmMs <= agora && agora - enviadoEmMs < JANELA_EXECUTOR_MS;
      })
    };
  }

  function resolverIndiceGlobalLegado(fila = [], clienteId = "admin", index) {
    metricas.consultasPorIndice += 1;
    const indice = Number(index);
    if (!Array.isArray(fila) || !Number.isInteger(indice) || indice < 0 || indice >= fila.length) {
      return { ok: false, motivo: "indice_invalido", item: null, indexReal: -1 };
    }
    const item = fila[indice];
    if (clienteItem(item) !== String(clienteId || "admin")) {
      return { ok: false, motivo: "sem_permissao", item, indexReal: indice };
    }
    return { ok: true, motivo: "indice_global_legado", item, indexReal: indice };
  }

  function resolverIndiceClienteLegado(fila = [], clienteId = "admin", index, opcoes = {}) {
    metricas.consultasPorIndice += 1;
    const indice = Number(index);
    const cliente = texto(clienteId || "admin") || "admin";
    const filaClienteIndexada = itensPorCliente(cliente);
    const filaClienteLegada = Array.isArray(fila)
      ? fila.filter(item => clienteItem(item) === cliente)
      : [];

    if (filaClienteIndexada.length !== filaClienteLegada.length) {
      metricas.divergenciasDetectadas += 1;
      metricas.fallbacksLegados += 1;
    }

    if (!Number.isInteger(indice) || indice < 0 || indice >= filaClienteLegada.length) {
      return { ok: false, motivo: "indice_invalido", item: null, indexReal: -1 };
    }

    const idEsperado = texto(opcoes.idEsperado || "");
    let item = idEsperado
      ? filaClienteLegada.find(alvo => idCampos(alvo).includes(idEsperado))
      : filaClienteLegada[indice];

    if (opcoes.preferirPendente && (!item || statusItem(item) !== "pendente")) {
      item = filaClienteLegada.filter(alvo => statusItem(alvo) === "pendente")[indice] || item;
    }

    const indexReal = Array.isArray(fila) ? fila.findIndex(alvo => alvo === item) : -1;
    return {
      ok: Boolean(item && indexReal >= 0),
      motivo: item && indexReal >= 0 ? "indice_cliente_legado" : "item_nao_relocalizado",
      item: item || null,
      indexReal
    };
  }

  function snapshotMetricas(extra = {}) {
    const agora = Date.now();
    return {
      ...extra,
      totalIndexado: contarItensMapa(estado.porCliente),
      vivos: contarItensMapa(estado.vivosPorCliente),
      enviadosRecentes: contarItensMapa(estado.enviadosPorCliente) > 0
        ? [...estado.enviadosPorCliente.values()].reduce((total, set) => total + [...set].filter(item => {
          const enviadoEmMs = timestampFila(item.enviadoEm || item.dataEnvio);
          return Number.isFinite(enviadoEmMs) && agora - enviadoEmMs >= 0 && agora - enviadoEmMs < JANELA_EXECUTOR_MS;
        }).length, 0)
        : 0,
      consultasPorIndice: metricas.consultasPorIndice,
      consultasPorId: metricas.consultasPorId,
      consultasPorFingerprint: metricas.consultasPorFingerprint,
      fallbacksLegados: metricas.fallbacksLegados,
      rebuilds: metricas.rebuilds,
      atualizacoes: metricas.atualizacoes,
      remocoes: metricas.remocoes,
      divergenciasDetectadas: metricas.divergenciasDetectadas,
      clientesIndexados: estado.porCliente.size,
      fingerprintsIndexados: estado.porFingerprint.size
    };
  }

  rebuild(filaInicial);

  return {
    rebuild,
    rebuildCliente,
    atualizarItem,
    removerItem,
    itensPorCliente,
    vivosPorCliente,
    enviadosRecentesPorCliente,
    resolverPorId,
    candidatosPorFingerprint,
    candidatosEnvioRecente2h,
    resolverIndiceGlobalLegado,
    resolverIndiceClienteLegado,
    snapshotMetricas
  };
}

module.exports = {
  criarFilaStore,
  chavesFingerprint,
  itemVivoOperacional,
  statusItem,
  timestampFila,
  JANELA_EXECUTOR_MS
};
