const { normalizar, texto } = require("./resolver-intencao");

const MAX_CARACTERES_COPY_V2 = 90;
const MAX_PALAVRAS_COPY_V2 = 16;
const MIN_PALAVRAS_COPY_V2 = 2;

function fatos(contexto = {}) {
  return contexto?.fatosPermitidos && typeof contexto.fatosPermitidos === "object"
    ? contexto.fatosPermitidos
    : {};
}

function contarEmojis(valor = "") {
  const matches = String(valor || "").match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

function caixaAltaExagerada(valor = "") {
  const letras = String(valor || "").replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  if (letras.length < 8) return false;
  const maiusculas = letras.replace(/[^A-ZÀ-Ö]/g, "");
  return maiusculas.length >= 8 && maiusculas.length / letras.length > 0.6;
}

function codigoCupomExplicito(valor = "") {
  const bruto = String(valor || "");
  return /(?:c[oó]digo|cupom)\s+[A-Z0-9]*\d[A-Z0-9]*/i.test(bruto) ||
    /\b(?:[A-Z]{2,}\d[A-Z0-9]*|[A-Z0-9]*\d[A-Z0-9]{4,})\b/.test(bruto);
}

function validarCopyV2({ textoGerado = "", contexto = {} } = {}) {
  const textoLimpo = texto(textoGerado);
  const permissao = fatos(contexto);
  const base = normalizar(textoLimpo);
  const palavras = textoLimpo.split(/\s+/).filter(Boolean);

  const reprovar = motivoCodigo => ({ valida: false, texto: "", motivoCodigo });

  if (!textoLimpo) return reprovar("texto_vazio");
  if (textoLimpo.length > MAX_CARACTERES_COPY_V2) return reprovar("texto_longo");
  if (/[\r\n]/.test(String(textoGerado || ""))) return reprovar("multiplas_linhas");
  if (palavras.length < MIN_PALAVRAS_COPY_V2 || palavras.length > MAX_PALAVRAS_COPY_V2) return reprovar("tamanho_palavras_invalido");
  if (/https?:\/\/|www\./i.test(textoLimpo)) return reprovar("url_detectada");
  if (/(?:R\$|US\$|\$|€|£)\s*\d|\b\d+[,.]\d{2}\b/.test(textoLimpo)) return reprovar("preco_detectado");
  if (/\d+\s*%/.test(textoLimpo)) return reprovar("percentual_detectado");
  if (codigoCupomExplicito(textoLimpo)) return reprovar("codigo_cupom_detectado");

  if (/\bcupom\b/.test(base) && permissao.cupom !== true) return reprovar("cupom_sem_permissao");
  if (/\bresgate\b/.test(base) && permissao.resgate !== true) return reprovar("resgate_sem_permissao");
  if (/\b(?:frete (?:gratis|0|zero)|entrega (?:gratis|gratuita))\b/.test(base) && permissao.freteGratis !== true) return reprovar("frete_gratis_sem_permissao");
  if (/\b(?:desconto|economia|off|economize|poupe)\b/.test(base) && permissao.descontoOficial !== true) return reprovar("desconto_sem_permissao");
  if (/\bcashback\b/.test(base) && permissao.cashback !== true) return reprovar("cashback_sem_permissao");
  if (/\bparcel(?:a|ado|amento)\b/.test(base) && permissao.parcelamento !== true) return reprovar("parcelamento_sem_permissao");
  if (/\b(?:beneficio|vantagem)\b/.test(base) && permissao.beneficioSeguro !== true && permissao.resgate !== true) return reprovar("beneficio_sem_permissao");

  if (/\b(?:exclusivo|exclusiva|so aqui|oferta exclusiva)\b/.test(base)) return reprovar("exclusividade_sem_permissao");
  if (/\b(?:ultimas unidades|ultima unidade|estoque acabando|vai acabar|acabando)\b/.test(base)) return reprovar("estoque_inventado");
  if (/\b(?:menor preco|melhor preco|preco mais baixo|preco imbatível|preco imbativel|preco incrivel|mais barato|o mais barato)\b/.test(base)) return reprovar("comparativo_preco_sem_prova");
  if (/\b(?:corre|corra|urgente|so hoje|por pouco tempo|agora ou nunca|ultima chance|garanta ja|aproveite antes que acabe)\b/.test(base)) return reprovar("urgencia_falsa");
  if (contarEmojis(textoLimpo) > 1) return reprovar("multiplos_emojis");
  if (caixaAltaExagerada(textoLimpo)) return reprovar("caixa_alta_exagerada");
  if (/[!?]{2,}|\.{3,}/.test(textoLimpo)) return reprovar("pontuacao_exagerada");

  return { valida: true, texto: textoLimpo, motivoCodigo: "ok" };
}

module.exports = {
  MAX_CARACTERES_COPY_V2,
  MAX_PALAVRAS_COPY_V2,
  MIN_PALAVRAS_COPY_V2,
  validarCopyV2
};
