const crypto = require("crypto");
const { CATEGORIAS_OPTIMUS, categoriaExiste } = require("../../marketplaces/inteligencia/categorias-globais");
const { classificarCategoriaOferta } = require("../../marketplaces/inteligencia/classificador-categorias");
const { BANCO_ASSOCIATIVO_V2 } = require("./banco-associativo.v2");
const { familiaDaCategoriaCopyV2, FAMILIA_OPORTUNIDADE_V2 } = require("./familias-v2");
const { normalizarSinaisCopy, texto, normalizar } = require("./resolver-intencao");
const { validarCopyV2 } = require("./validator-v2");
const {
  planoPermiteTituloIa,
  ofertaIdCopy,
  chaveSinais,
  hashSinaisComerciais
} = require("./copy-inteligente.service");

const TTL_COPY_LOCAL_V2_MS = 45 * 60 * 1000;
const MAX_CACHE_COPY_LOCAL_V2 = 1000;
const LIMITE_HISTORICO_COPY_LOCAL_V2 = 20;
const FONTE_COPY_LOCAL_V2 = "banco_associativo_local_v2";

const cacheLocalV2 = new Map();
const historicoLocalV2 = new Map();
const ALIASES_CATEGORIA_OFICIAL_COPY_LOCAL_V2 = {
  "alimentos": "Alimentos e Mercearia",
  "mercado": "Alimentos e Mercearia",
  "bebidas": "Bebidas",
  "audio": "Audio TV",
  "audio tv": "Audio TV",
  "tv": "Audio TV",
  "automotivo": "Automotivo",
  "bebes": "Bebês e Acessórios",
  "bebe": "Bebês e Acessórios",
  "celular": "Celulares e Smartphones",
  "celulares": "Celulares e Smartphones",
  "smartphones": "Celulares e Smartphones",
  "computadores": "Computadores e Notebook",
  "notebook": "Computadores e Notebook",
  "notebooks": "Computadores e Notebook",
  "brinquedos": "Brinquedos e Artigos Infantis",
  "casa": "Casa, Móveis e Decoração",
  "casa e cozinha": "Casa, Móveis e Decoração",
  "decoracao": "Casa, Móveis e Decoração",
  "eletrodomesticos": "Eletrodomésticos",
  "eletroportateis": "Eletroportáteis",
  "ferramentas": "Ferramentas",
  "limpeza": "Limpeza",
  "eletronicos": "Eletrônicos",
  "perifericos": "Periféricos",
  "moda feminina": "Roupas e Moda Feminina",
  "moda masculina": "Roupas e Moda Masculina",
  "calcados": "Tênis e Chinelos",
  "tenis": "Tênis e Chinelos",
  "chinelos": "Tênis e Chinelos",
  "gamer": "Gamer e Hardware",
  "hardware": "Gamer e Hardware",
  "infantil": "Roupas e Calçados Infantil",
  "pet": "Pet Shop e Fazendinha",
  "pet shop": "Pet Shop e Fazendinha",
  "beleza": "Perfumaria, Farmácia e Beleza",
  "perfumaria": "Perfumaria, Farmácia e Beleza",
  "farmacia": "Perfumaria, Farmácia e Beleza",
  "esporte": "Esporte e Suplementos",
  "suplementos": "Esporte e Suplementos",
  "pesca": "Pesca e Camping",
  "camping": "Pesca e Camping",
  "games": "Games e Console",
  "console": "Games e Console",
  "climatizacao": "Climatização e Ventilação",
  "ventilacao": "Climatização e Ventilação",
  "iluminacao": "Iluminação e Elétrica",
  "eletrica": "Iluminação e Elétrica",
  "diversos": "Diversos"
};

function hashLocalV2(valor = "") {
  return crypto.createHash("sha1").update(String(valor || "")).digest("hex").slice(0, 16);
}

function agoraMs() {
  return Date.now();
}

function removerExpiradasCopyLocalV2(now = agoraMs()) {
  for (const [id, item] of cacheLocalV2.entries()) {
    if (Number(item?.expiraEm || 0) <= now) cacheLocalV2.delete(id);
  }
}

function limitarCacheCopyLocalV2() {
  removerExpiradasCopyLocalV2();
  while (cacheLocalV2.size > MAX_CACHE_COPY_LOCAL_V2) {
    const primeira = cacheLocalV2.keys().next().value;
    if (!primeira) break;
    cacheLocalV2.delete(primeira);
  }
}

function lerCacheCopyLocalV2(chave = "") {
  const id = String(chave || "");
  if (!id) return null;
  const item = cacheLocalV2.get(id);
  if (!item) return null;
  if (Number(item.expiraEm || 0) <= agoraMs()) {
    cacheLocalV2.delete(id);
    return null;
  }
  return item.valor || null;
}

function salvarCacheCopyLocalV2(chave = "", valor = {}, ttlMs = TTL_COPY_LOCAL_V2_MS) {
  const id = String(chave || "");
  if (!id || !valor || typeof valor !== "object") return null;
  limitarCacheCopyLocalV2();
  if (!cacheLocalV2.has(id) && cacheLocalV2.size >= MAX_CACHE_COPY_LOCAL_V2) {
    const primeira = cacheLocalV2.keys().next().value;
    if (primeira) cacheLocalV2.delete(primeira);
  }
  const expiraEm = agoraMs() + Math.max(1000, Number(ttlMs) || TTL_COPY_LOCAL_V2_MS);
  if (cacheLocalV2.has(id)) cacheLocalV2.delete(id);
  cacheLocalV2.set(id, { valor, expiraEm });
  return valor;
}

function limparCacheCopyLocalV2() {
  cacheLocalV2.clear();
  historicoLocalV2.clear();
}

function tamanhoCacheCopyLocalV2() {
  removerExpiradasCopyLocalV2();
  return cacheLocalV2.size;
}

function categoriaAliasOficialCopyLocalV2(categoria = "") {
  const alias = ALIASES_CATEGORIA_OFICIAL_COPY_LOCAL_V2[normalizar(categoria)];
  return categoriaExiste(alias) ? alias : "";
}

function categoriaOficialCopyLocalV2(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const declarada = texto(sinais.categoria || oferta.categoria || oferta.categoriaProduto);
  if (categoriaExiste(declarada)) return declarada;
  const aliasOficial = categoriaAliasOficialCopyLocalV2(declarada);
  if (aliasOficial) return aliasOficial;

  const classificada = classificarCategoriaOferta({
    ...oferta,
    categoria: "",
    categoriaProduto: ""
  }, sinais.tituloOriginal || oferta.titulo || oferta.nome || "");
  return categoriaExiste(classificada) ? classificada : "Diversos";
}

function resolverFamiliaOfertaCopyLocalV2(oferta = {}, sinais = normalizarSinaisCopy(oferta)) {
  const categoriaOficial = categoriaOficialCopyLocalV2(oferta, sinais);
  return {
    categoriaOficial,
    familia: familiaDaCategoriaCopyV2(categoriaOficial)
  };
}

function contemToken(base = "", termos = []) {
  return termos.some(termo => {
    const alvo = normalizar(termo);
    return alvo && ` ${base} `.includes(` ${alvo} `);
  });
}

function resolverSubcontextoCopyLocalV2({ tituloOriginal = "", familia = "" } = {}) {
  const base = normalizar(tituloOriginal);
  if (!base) return "";

  if (["limpeza", "casa_eletro", "cozinha_pratica"].includes(familia) && contemToken(base, [
    "aspirador robo", "robo aspirador", "aspirador de po", "aspirador vertical"
  ])) {
    return "limpeza_pratica";
  }

  if (familia === "beleza" && contemToken(base, [
    "escova secadora", "secador de cabelo", "chapinha", "prancha de cabelo",
    "shampoo", "condicionador", "mascara capilar"
  ])) {
    return "cabelo";
  }

  if (["casa", "casa_eletro", "cozinha_pratica"].includes(familia) && contemToken(base, [
    "panela", "frigideira", "air fryer", "cafeteira", "liquidificador",
    "batedeira", "processador de alimentos"
  ])) {
    return "cozinha";
  }

  if (["gamer", "perifericos"].includes(familia) && contemToken(base, [
    "mouse gamer", "teclado gamer", "teclado mecanico", "headset gamer",
    "mousepad", "controle gamer"
  ])) {
    return "setup";
  }

  if (familia === "pesca_camping" && contemToken(base, [
    "vara de pesca", "molinete", "carretilha", "isca artificial", "anzol"
  ])) {
    return "pesca";
  }

  return "";
}

function resolverIntencaoCopyLocalV2(sinais = {}, familia = FAMILIA_OPORTUNIDADE_V2) {
  if (sinais.resgate === true) return { intencao: "resgate", motivo: "resgate_real" };
  if (sinais.cupom === true) return { intencao: "cupom", motivo: "cupom_real" };
  if (sinais.beneficio === true) return { intencao: "beneficio", motivo: "beneficio_comprovado" };
  if (sinais.desconto === true) return { intencao: "economia", motivo: "desconto_oficial" };
  if (sinais.freteGratis === true) return { intencao: "frete_gratis", motivo: "frete_gratis_oficial" };
  if (sinais.parcelamento === true) return { intencao: "parcelamento", motivo: "parcelamento_oficial" };
  if (familia && familia !== FAMILIA_OPORTUNIDADE_V2) return { intencao: "familia", motivo: "familia_oficial" };
  return { intencao: "oportunidade", motivo: "fallback_oportunidade" };
}

function fatosValidatorCopyLocalV2(sinais = {}) {
  return {
    cupom: sinais.cupom === true,
    resgate: sinais.resgate === true,
    freteGratis: sinais.freteGratis === true,
    descontoOficial: sinais.desconto === true,
    beneficioSeguro: sinais.beneficio === true,
    parcelamento: sinais.parcelamento === true
  };
}

function requisitoAtendidoLocalV2(requisito = "", sinais = {}) {
  const req = texto(requisito);
  if (!req) return true;
  return sinais[req] === true;
}

function proibicaoAtendidaLocalV2(proibicao = "", sinais = {}) {
  const item = texto(proibicao);
  if (!item) return true;
  return sinais[item] !== true;
}

function fraseContextoCompativel(frase = {}, subcontexto = "") {
  const palavras = Array.isArray(frase.palavrasContexto) ? frase.palavrasContexto.map(texto).filter(Boolean) : [];
  if (!palavras.length) return true;
  return Boolean(subcontexto && palavras.includes(subcontexto));
}

function fraseElegivelCopyLocalV2(frase = {}, contexto = {}) {
  if (!frase || typeof frase !== "object" || frase.ativo === false) return false;
  const intencoes = Array.isArray(frase.intencoes) ? frase.intencoes : [];
  const familiaFrase = texto(frase.familia || FAMILIA_OPORTUNIDADE_V2);
  const familiaOk = familiaFrase === "qualquer" ||
    familiaFrase === contexto.familia ||
    (contexto.intencao === "oportunidade" && familiaFrase === FAMILIA_OPORTUNIDADE_V2);
  const intencaoOk = intencoes.includes(contexto.intencao);
  const requisitos = Array.isArray(frase.exige) ? frase.exige : [];
  const proibe = Array.isArray(frase.proibe) ? frase.proibe : [];
  if (!familiaOk || !intencaoOk) return false;
  if (!fraseContextoCompativel(frase, contexto.subcontexto)) return false;
  if (!requisitos.every(req => requisitoAtendidoLocalV2(req, contexto.sinais))) return false;
  if (!proibe.every(item => proibicaoAtendidaLocalV2(item, contexto.sinais))) return false;

  const validacao = validarCopyV2({
    textoGerado: frase.texto,
    contexto: { fatosPermitidos: fatosValidatorCopyLocalV2(contexto.sinais) }
  });
  return validacao.valida === true;
}

function filtrarFrasesCopyLocalV2(banco = BANCO_ASSOCIATIVO_V2, contexto = {}) {
  const lista = Array.isArray(banco) ? banco : [];
  const candidatas = lista.filter(frase => fraseElegivelCopyLocalV2(frase, contexto));
  if (candidatas.length) {
    const subcontexto = texto(contexto.subcontexto);
    const especificas = subcontexto
      ? candidatas.filter(frase => (Array.isArray(frase.palavrasContexto) ? frase.palavrasContexto.map(texto) : []).includes(subcontexto))
      : [];
    return especificas.length ? especificas : candidatas;
  }
  if (contexto.intencao === "oportunidade") return [];
  return lista.filter(frase => fraseElegivelCopyLocalV2(frase, {
    ...contexto,
    familia: FAMILIA_OPORTUNIDADE_V2,
    intencao: "oportunidade",
    subcontexto: ""
  }));
}

function ultimasFrasesCopyLocalV2(chave = "") {
  return historicoLocalV2.get(String(chave || "")) || [];
}

function registrarFraseCopyLocalV2(chave = "", fraseTexto = "") {
  const id = String(chave || "");
  const valor = texto(fraseTexto);
  if (!id || !valor) return;
  const lista = [valor, ...ultimasFrasesCopyLocalV2(id).filter(item => item !== valor)].slice(0, LIMITE_HISTORICO_COPY_LOCAL_V2);
  historicoLocalV2.set(id, lista);
}

function escolherPorPesoLocalV2(frases = [], chaveOferta = "") {
  const candidatas = [...frases].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!candidatas.length) return null;
  const totalPeso = candidatas.reduce((total, item) => total + Math.max(1, Number(item.peso) || 1), 0);
  let ponto = parseInt(hashLocalV2(chaveOferta).slice(0, 8), 16) % totalPeso;
  for (let i = 0; i < candidatas.length; i += 1) {
    ponto -= Math.max(1, Number(candidatas[i].peso) || 1);
    if (ponto < 0) return candidatas[i];
  }
  return candidatas[0];
}

function escolherFrasePonderadaCopyLocalV2({ frases = [], chaveOferta = "", historicoKey = "" } = {}) {
  const candidatas = [...frases].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!candidatas.length) return null;

  const historico = ultimasFrasesCopyLocalV2(historicoKey);
  const ultima = historico[0] || "";
  const elegiveis = candidatas.length > 1
    ? candidatas.filter(item => texto(item.texto) !== ultima)
    : candidatas;
  const recentes = new Set(historico);
  const foraDoHistorico = elegiveis.filter(item => !recentes.has(texto(item.texto)));
  const pool = foraDoHistorico.length ? foraDoHistorico : elegiveis;
  const escolhida = foraDoHistorico.length
    ? escolherPorPesoLocalV2(pool, chaveOferta)
    : [...pool].sort((a, b) => {
      const idadeA = historico.indexOf(texto(a.texto));
      const idadeB = historico.indexOf(texto(b.texto));
      const ordemA = idadeA >= 0 ? idadeA : Number.MAX_SAFE_INTEGER;
      const ordemB = idadeB >= 0 ? idadeB : Number.MAX_SAFE_INTEGER;
      if (ordemA !== ordemB) return ordemB - ordemA;
      return String(a.id).localeCompare(String(b.id));
    })[0];
  if (!escolhida) return null;
  registrarFraseCopyLocalV2(historicoKey, escolhida.texto);
  return escolhida;
}

function chaveCacheCopyLocalV2({ clienteId = "admin", oferta = {}, sinais = {}, categoriaOficial = "", familia = "", intencao = "", subcontexto = "" } = {}) {
  const chaveOferta = chaveSinais(clienteId, oferta, sinais);
  if (!chaveOferta) return "";
  return hashLocalV2(JSON.stringify({
    versao: "copy-local-v2-1",
    clienteId: texto(clienteId) || "admin",
    chaveOferta,
    categoriaOficial,
    familia,
    intencao,
    subcontexto,
    sinaisHash: hashSinaisComerciais(oferta, sinais)
  }));
}

function fallbackLocalV2(motivo = "fallback_v1", extra = {}) {
  return {
    ok: false,
    tituloIa: "",
    fonte: FONTE_COPY_LOCAL_V2,
    motivoFallback: motivo,
    cacheHit: false,
    ...extra
  };
}

function resolverCopyLocalV2({ oferta = {}, destino = {}, clienteId = "admin", plano = {}, ttlMs = TTL_COPY_LOCAL_V2_MS, banco = BANCO_ASSOCIATIVO_V2 } = {}) {
  try {
    if (String(destino?.tituloOferta || "").trim().toLowerCase() !== "ia") {
      return fallbackLocalV2("destino_original");
    }
    if (!planoPermiteTituloIa(plano)) {
      return fallbackLocalV2("feature_tituloIa_indisponivel", { ofertaId: ofertaIdCopy(oferta) });
    }

    const sinais = normalizarSinaisCopy(oferta);
    const { categoriaOficial, familia } = resolverFamiliaOfertaCopyLocalV2(oferta, sinais);
    const subcontexto = resolverSubcontextoCopyLocalV2({ tituloOriginal: sinais.tituloOriginal, familia });
    const resolucaoIntencao = resolverIntencaoCopyLocalV2(sinais, familia);
    const contexto = {
      sinais,
      categoriaOficial,
      familia,
      intencao: resolucaoIntencao.intencao,
      subcontexto
    };
    const cacheKey = chaveCacheCopyLocalV2({ clienteId, oferta, sinais, categoriaOficial, familia, intencao: contexto.intencao, subcontexto });

    if (cacheKey) {
      const cached = lerCacheCopyLocalV2(cacheKey);
      if (cached?.tituloIa) return { ...cached, cacheHit: true };
    }

    const frases = filtrarFrasesCopyLocalV2(banco, contexto);
    if (!frases.length) {
      return fallbackLocalV2("frase_segura_indisponivel", contexto);
    }

    const historicoKey = `${texto(clienteId) || "admin"}:${familia}:${contexto.intencao}`;
    const frase = escolherFrasePonderadaCopyLocalV2({
      frases,
      chaveOferta: `${cacheKey || chaveSinais(clienteId, oferta, sinais)}:${familia}:${contexto.intencao}:${subcontexto}`,
      historicoKey
    });
    if (!frase) return fallbackLocalV2("frase_segura_indisponivel", contexto);

    const resultado = {
      ok: true,
      tituloIa: frase.texto,
      intencao: contexto.intencao,
      familia,
      categoriaOficial,
      subcontexto,
      fraseId: frase.id,
      fonte: FONTE_COPY_LOCAL_V2,
      motivo: resolucaoIntencao.motivo,
      cacheHit: false
    };
    if (cacheKey) salvarCacheCopyLocalV2(cacheKey, resultado, ttlMs);
    return resultado;
  } catch (erro) {
    return fallbackLocalV2("erro_motor_local_v2", {
      motivo: erro?.message || "erro"
    });
  }
}

function resumoBancoAssociativoV2(banco = BANCO_ASSOCIATIVO_V2) {
  const porFamilia = {};
  const porIntencao = {};
  for (const item of Array.isArray(banco) ? banco : []) {
    if (!item || item.ativo === false) continue;
    const familia = item.familia || "";
    porFamilia[familia] = (porFamilia[familia] || 0) + 1;
    for (const intencao of Array.isArray(item.intencoes) ? item.intencoes : []) {
      porIntencao[intencao] = (porIntencao[intencao] || 0) + 1;
    }
  }
  return {
    total: Array.isArray(banco) ? banco.filter(item => item?.ativo !== false).length : 0,
    porFamilia,
    porIntencao,
    categoriasOficiais: CATEGORIAS_OPTIMUS.length
  };
}

module.exports = {
  TTL_COPY_LOCAL_V2_MS,
  MAX_CACHE_COPY_LOCAL_V2,
  LIMITE_HISTORICO_COPY_LOCAL_V2,
  FONTE_COPY_LOCAL_V2,
  hashLocalV2,
  categoriaOficialCopyLocalV2,
  categoriaAliasOficialCopyLocalV2,
  resolverFamiliaOfertaCopyLocalV2,
  resolverSubcontextoCopyLocalV2,
  resolverIntencaoCopyLocalV2,
  fatosValidatorCopyLocalV2,
  fraseElegivelCopyLocalV2,
  filtrarFrasesCopyLocalV2,
  chaveCacheCopyLocalV2,
  escolherFrasePonderadaCopyLocalV2,
  ultimasFrasesCopyLocalV2,
  lerCacheCopyLocalV2,
  salvarCacheCopyLocalV2,
  removerExpiradasCopyLocalV2,
  limparCacheCopyLocalV2,
  tamanhoCacheCopyLocalV2,
  resolverCopyLocalV2,
  resumoBancoAssociativoV2
};
