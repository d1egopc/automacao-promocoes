const { normalizarCuponsSemanticos } = require("../radar/cupom-semantico");
const { resolverContratoComercialFinal } = require("../templates-clientes/contrato-comercial-final");

const ORIGENS_DESCONTO_PUBLICAVEIS = new Set(["marketplace", "manual"]);
const EVIDENCIAS_CUPOM_PUBLICAVEIS = new Set([
  "real",
  "confirmado",
  "validado",
  "detectado",
  "texto_radar",
  "texto_clonador"
]);
const CUPONS_SENTINELA = new Set(["COPIADO", "APPLIED", "APPEARANCE", "APPLINK", "SEM CUPOM"]);

function texto(valor = "") {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" || typeof valor === "function") return "";
  const out = String(valor).trim();
  if (!out || ["undefined", "null", "nan"].includes(out.toLowerCase())) return "";
  return out;
}

function normalizar(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function listaObjetos(valor) {
  return Array.isArray(valor) ? valor.filter(item => item && typeof item === "object") : [];
}

function temUrl(valor = "") {
  return /^https?:\/\//i.test(texto(valor));
}

function cupomPublicavel(oferta = {}) {
  if (!oferta || typeof oferta !== "object") return "";
  if (oferta.cupomSuspeito === true || oferta.cupomMonetarioIncompativel === true) return "";

  const contrato = resolverContratoComercialFinal(oferta);
  const cupomContrato = normalizarCuponsSemanticos(contrato?.cupomCodigo || "")[0] || "";
  if (cupomContrato && !CUPONS_SENTINELA.has(cupomContrato)) return cupomContrato;

  const evidencia = normalizar([
    oferta.cupomTipo,
    oferta.tipoCupom,
    oferta.cupomEvidencia,
    oferta.evidenciaCupom
  ].filter(Boolean).join(" "));
  const evidenciaPublicavel = Array.from(EVIDENCIAS_CUPOM_PUBLICAVEIS).some(tipo => evidencia.includes(tipo)) ||
    oferta.cupomConfirmado === true ||
    oferta.cupomValidado === true;
  if (!evidenciaPublicavel) return "";

  const cupom = normalizarCuponsSemanticos([
    oferta.cupom,
    oferta.cupomCodigo,
    oferta.codigoCupom,
    oferta.cupomTexto
  ])[0] || "";
  return cupom && !CUPONS_SENTINELA.has(cupom) ? cupom : "";
}

function linkResgateValido(oferta = {}) {
  if (temUrl(oferta.linkResgate)) return true;
  return listaObjetos(oferta.linksResgate).some(item =>
    temUrl(item.afiliado || item.resolvido || item.original || item.url)
  ) || listaObjetos(oferta.linksComerciais).some(item => {
    const tipo = normalizar([item.tipo, item.papel, item.role].filter(Boolean).join(" "));
    return tipo.includes("resgate") && temUrl(item.afiliado || item.resolvido || item.original || item.url);
  });
}

function numeroPositivo(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) && valor > 0;
  const bruto = texto(valor).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const numero = Number(bruto);
  return Number.isFinite(numero) && numero > 0;
}

function descontoOficial(oferta = {}) {
  const origem = normalizar(oferta.descontoPercentualOrigem);
  if (!ORIGENS_DESCONTO_PUBLICAVEIS.has(origem)) return false;
  return numeroPositivo(oferta.descontoPercentual ?? oferta.desconto);
}

function beneficioSeguro(oferta = {}) {
  return Boolean(
    texto(oferta.beneficioExtra) ||
    texto(oferta.beneficioTexto) ||
    texto(oferta.beneficioDetectado) ||
    (Array.isArray(oferta.beneficios) && oferta.beneficios.some(texto))
  );
}

function sinalSazonalSeguro(oferta = {}) {
  const base = normalizar([
    oferta.sazonalidade,
    oferta.eventoSazonal,
    oferta.campanhaSazonal,
    oferta.validade,
    oferta.categoria,
    oferta.titulo,
    oferta.nome
  ].filter(Boolean).join(" "));
  if (!base) return false;
  return /\b(?:natal|ano novo|pascoa|dia das maes|dia dos pais|black friday|festa junina|carnaval|volta as aulas|festa|comemoracao)\b/.test(base);
}

function categoriaParaIntencao(categoria = "", tituloOriginal = "") {
  const base = normalizar(`${categoria} ${tituloOriginal}`);
  if (!base) return "";
  if (/\b(?:beleza|cosmetico|cosmeticos|cabelo|maquiagem|skincare|perfume|barba|visual)\b/.test(base)) return "beleza";
  if (/\b(?:gamer|hardware|setup|mouse|teclado|headset|monitor|placa de video|notebook gamer|pc gamer)\b/.test(base)) return "gamer";
  if (/\b(?:casa|cozinha|organizacao|limpeza|decoracao|moveis|lar|utensilio|eletrodomestico)\b/.test(base)) return "casa";
  if (/\b(?:colchao|travesseiro|sof[aá]|poltrona|conforto|ergonomico|ergonomica)\b/.test(base)) return "conforto";
  if (/\b(?:presente|brinquedo|infantil|kids|crianca|namorados)\b/.test(base)) return "presente";
  return "";
}

function normalizarSinaisCopy(oferta = {}) {
  const tituloOriginal = texto(oferta.titulo || oferta.nome);
  const categoria = texto(oferta.categoria || oferta.categoriaProduto);
  const cupomCodigo = cupomPublicavel(oferta);
  const sinais = {
    tituloOriginal,
    categoria,
    marketplace: texto(oferta.marketplace || oferta.loja),
    cupom: Boolean(cupomCodigo),
    cupomCodigo,
    resgate: linkResgateValido(oferta),
    desconto: descontoOficial(oferta),
    beneficio: beneficioSeguro(oferta),
    freteGratis: oferta.freteGratis === true,
    parcelamento: Boolean(texto(oferta.parcelamento)),
    sazonal: sinalSazonalSeguro(oferta),
    score: oferta.score,
    prioridade: oferta.prioridade ?? oferta.prioridadeEnvio ?? oferta.prioridadeFila
  };
  sinais.categoriaIntencao = categoriaParaIntencao(categoria, tituloOriginal);
  return sinais;
}

function resolverIntencaoCopy(oferta = {}) {
  const sinais = normalizarSinaisCopy(oferta);
  if (sinais.resgate) return { intencao: "resgate", sinais, motivo: "resgate_real" };
  if (sinais.cupom) return { intencao: "cupom", sinais, motivo: "cupom_real" };
  if (sinais.beneficio) return { intencao: "beneficio", sinais, motivo: "beneficio_comprovado" };
  if (sinais.desconto) return { intencao: "economia", sinais, motivo: "desconto_oficial" };
  if (sinais.sazonal) return { intencao: "sazonal", sinais, motivo: "sazonal_seguro" };
  if (sinais.categoriaIntencao) return { intencao: sinais.categoriaIntencao, sinais, motivo: "categoria_especifica" };
  return { intencao: "oportunidade", sinais, motivo: "fallback_oportunidade" };
}

module.exports = {
  texto,
  normalizar,
  normalizarSinaisCopy,
  resolverIntencaoCopy,
  categoriaParaIntencao,
  cupomPublicavel,
  descontoOficial
};
