const { normalizarNumeroMoeda } = require("../../utils/moeda");

const VERSAO_PRECO_SEMANTICO = "radar_preco_semantico_v1";
const CONFIANCA = {
  ALTA: "alta",
  MEDIA: "media",
  BAIXA: "baixa",
  AUSENTE: "ausente"
};

const TIPOS_CANDIDATO = {
  PRECO_ATUAL: "preco_atual",
  PRECO_ANTIGO: "preco_antigo",
  PRECO_PIX: "preco_pix",
  PRECO_CARTAO: "preco_cartao",
  PRECO_BOLETO: "preco_boleto",
  PARCELA: "parcela",
  VALOR_CUPOM: "valor_cupom",
  ECONOMIA: "economia",
  FRETE: "frete",
  CASHBACK: "cashback",
  PERCENTUAL: "percentual",
  QUANTIDADE: "quantidade",
  IDENTIFICADOR: "identificador",
  DESCONHECIDO: "desconhecido"
};

const PADRAO_NUMERO = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:[,.]\d{2})?|\d+)/gi;
const JANELA_CONTEXTO = 56;

function texto(valor = "") {
  return String(valor ?? "");
}

function textoLimpo(valor = "") {
  return texto(valor)
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ");
}

function semAcentos(valor = "") {
  return textoLimpo(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function evidencia(valor = "") {
  const limpo = texto(valor).replace(/\s+/g, " ").trim();
  return limpo ? limpo.slice(0, 160) : null;
}

function valorMoeda(valor) {
  const numero = normalizarNumeroMoeda(valor);
  return numero === null || !Number.isFinite(numero) ? null : numero;
}

function contexto(textoFonte = "", inicio = 0, fim = 0) {
  const antesInicio = Math.max(0, inicio - JANELA_CONTEXTO);
  const depoisFim = Math.min(textoFonte.length, fim + JANELA_CONTEXTO);
  const linhaInicio = textoFonte.lastIndexOf("\n", inicio) + 1;
  const linhaFimBusca = textoFonte.indexOf("\n", fim);
  const linhaFim = linhaFimBusca === -1 ? textoFonte.length : linhaFimBusca;
  return {
    anterior: textoFonte.slice(antesInicio, inicio),
    posterior: textoFonte.slice(fim, depoisFim),
    trecho: textoFonte.slice(antesInicio, depoisFim).trim(),
    linha: textoFonte.slice(linhaInicio, linhaFim).trim()
  };
}

function marcadorAnterior(contextoAnterior = "") {
  const normalizado = semAcentos(contextoAnterior);
  const regras = [
    ["preco_final", /(?:preco final|valor final|final)\s*:?\s*$/],
    ["com_cupom", /(?:com cupom fica|aplicando (?:o )?cupom|aplicar (?:o )?cupom|usando (?:o )?cupom)\s*:?\s*$/],
    ["pix", /(?:no pix|pix|a vista|avista)\s*:?\s*$/],
    ["boleto", /boleto\s*:?\s*$/],
    ["cartao", /(?:cartao|cartao de credito|credito)\s*:?\s*$/],
    ["por", /(?:por|agora|sai por|saindo por|apenas|fica por|leva por|hoje)\s*:?\s*$/],
    ["parcela", /\b\d{1,2}\s*x\s*(?:de\s*)?$/],
    ["cupom_valor", /(?:cupom de|cupom|desconto de)\s*:?\s*$/],
    ["de", /(?:\bde|antes|era|preco antigo|valor antigo|preco de)\s*:?\s*$/],
    ["total", /(?:total|valor total)\s*:?\s*$/],
    ["economia", /(?:economize|economia)\s*:?\s*$/],
    ["frete", /(?:frete|entrega)\s*:?\s*$/],
    ["cashback", /cashback\s*:?\s*$/],
    ["modelo", /(?:modelo|versao|versao|codigo|cod|sku|ref)\s*:?\s*$/],
    ["estoque", /(?:estoque|ultimas?|unidades?)\s*:?\s*$/]
  ];
  for (const [nome, regex] of regras) {
    if (regex.test(normalizado)) return nome;
  }
  return "";
}

function marcadorPosterior(contextoPosterior = "") {
  const normalizado = semAcentos(contextoPosterior);
  const imediato = normalizado.slice(0, 36);
  const regras = [
    ["percentual", /^\s*%/],
    ["vendidos", /^\s*(vendidos?|comprados?|vendas?)\b/],
    ["avaliacoes", /^\s*(avaliacoes?|reviews?|estrelas?)\b/],
    ["unidades", /^\s*(unidades?|pecas?|em estoque|estoque)\b/],
    ["modelo", /^\s*(modelo|versao|codigo|cod|sku|ref)\b/],
    ["pix", /^\s*(?:no pix|pix)\b/],
    ["por", /\b(por|agora|sai por|saindo por|apenas|fica por|leva por)\b/],
    ["cartao", /^\s*(?:cartao|cartao de credito|credito)\b/],
    ["boleto", /^\s*boleto\b/]
  ];
  for (const [nome, regex] of regras) {
    if (regex.test(imediato)) return nome;
  }
  return "";
}

function possuiCifraoNoTexto(textoOriginal = "") {
  return /R\$/i.test(textoOriginal);
}

function pareceDecimalMonetario(textoOriginal = "") {
  return /[,.]\d{2}\b/.test(textoOriginal);
}

function classificarTipo(base = {}) {
  const anterior = base.marcadorAnterior;
  const posterior = base.marcadorPosterior;
  const contextoNormalizado = semAcentos(`${base.trechoOrigem} ${base.textoOriginal}`);
  const motivos = [];

  if (posterior === "percentual" || /%/.test(base.textoOriginal)) {
    motivos.push("candidato_classificado_como_percentual");
    return { tipo: TIPOS_CANDIDATO.PERCENTUAL, motivos };
  }
  if (posterior === "vendidos") {
    motivos.push("candidato_classificado_como_quantidade");
    return { tipo: TIPOS_CANDIDATO.QUANTIDADE, motivos };
  }
  if (posterior === "avaliacoes") {
    motivos.push("candidato_classificado_como_quantidade");
    return { tipo: TIPOS_CANDIDATO.QUANTIDADE, motivos };
  }
  if (posterior === "unidades" || anterior === "estoque") {
    motivos.push("candidato_classificado_como_quantidade");
    return { tipo: TIPOS_CANDIDATO.QUANTIDADE, motivos };
  }
  if (anterior === "modelo" || posterior === "modelo") {
    motivos.push("candidato_classificado_como_identificador");
    return { tipo: TIPOS_CANDIDATO.IDENTIFICADOR, motivos };
  }
  if (anterior === "parcela") {
    motivos.push("candidato_classificado_como_parcela");
    return { tipo: TIPOS_CANDIDATO.PARCELA, motivos };
  }
  if (anterior === "cupom_valor" && !/\b(com cupom fica|aplicando (?:o )?cupom|usando (?:o )?cupom)\b/.test(contextoNormalizado)) {
    motivos.push("candidato_classificado_como_valor_cupom");
    return { tipo: TIPOS_CANDIDATO.VALOR_CUPOM, motivos };
  }
  if (anterior === "economia") {
    motivos.push("candidato_classificado_como_economia");
    return { tipo: TIPOS_CANDIDATO.ECONOMIA, motivos };
  }
  if (anterior === "frete") {
    motivos.push("candidato_classificado_como_frete");
    return { tipo: TIPOS_CANDIDATO.FRETE, motivos };
  }
  if (anterior === "cashback") {
    motivos.push("candidato_classificado_como_cashback");
    return { tipo: TIPOS_CANDIDATO.CASHBACK, motivos };
  }
  if (anterior === "de") {
    motivos.push("candidato_classificado_como_preco_antigo");
    return { tipo: TIPOS_CANDIDATO.PRECO_ANTIGO, motivos };
  }
  if (["preco_final", "com_cupom", "por", "total"].includes(anterior)) {
    motivos.push("preco_radar_marcador_explicito");
    return { tipo: TIPOS_CANDIDATO.PRECO_ATUAL, motivos };
  }
  if (anterior === "pix" || posterior === "pix") {
    motivos.push("preco_radar_marcador_pix");
    return { tipo: TIPOS_CANDIDATO.PRECO_PIX, motivos };
  }
  if (anterior === "boleto") {
    motivos.push("candidato_classificado_como_boleto");
    return { tipo: TIPOS_CANDIDATO.PRECO_BOLETO, motivos };
  }
  if (anterior === "cartao") {
    motivos.push("candidato_classificado_como_cartao");
    return { tipo: TIPOS_CANDIDATO.PRECO_CARTAO, motivos };
  }
  if (posterior === "boleto") {
    motivos.push("candidato_classificado_como_boleto");
    return { tipo: TIPOS_CANDIDATO.PRECO_BOLETO, motivos };
  }
  if (posterior === "cartao") {
    motivos.push("candidato_classificado_como_cartao");
    return { tipo: TIPOS_CANDIDATO.PRECO_CARTAO, motivos };
  }
  if (base.possuiCifrao) {
    motivos.push("valor_monetario_com_cifrao");
    return { tipo: TIPOS_CANDIDATO.PRECO_ATUAL, motivos };
  }
  if (pareceDecimalMonetario(base.textoOriginal)) {
    motivos.push("valor_decimal_sem_cifrao");
    return { tipo: TIPOS_CANDIDATO.DESCONHECIDO, motivos };
  }
  motivos.push("candidato_sem_contexto_monetario");
  return { tipo: TIPOS_CANDIDATO.DESCONHECIDO, motivos };
}

function nivelEvidencia(base = {}, totalMonetarios = 0) {
  const motivos = [...(base.motivos || [])];
  const tipo = base.tipoCandidato;
  if ([TIPOS_CANDIDATO.PERCENTUAL, TIPOS_CANDIDATO.QUANTIDADE, TIPOS_CANDIDATO.IDENTIFICADOR, TIPOS_CANDIDATO.PARCELA, TIPOS_CANDIDATO.VALOR_CUPOM, TIPOS_CANDIDATO.ECONOMIA, TIPOS_CANDIDATO.FRETE, TIPOS_CANDIDATO.CASHBACK].includes(tipo)) {
    return { nivel: CONFIANCA.BAIXA, motivos };
  }
  if ([TIPOS_CANDIDATO.PRECO_ATUAL, TIPOS_CANDIDATO.PRECO_PIX, TIPOS_CANDIDATO.PRECO_ANTIGO].includes(tipo)) {
    if (base.marcadorAnterior || base.marcadorPosterior) {
      motivos.push("evidencia_forte_preco");
      return { nivel: CONFIANCA.ALTA, motivos };
    }
  }
  if (base.possuiCifrao && totalMonetarios === 1) {
    motivos.push("unico_valor_monetario_com_cifrao");
    return { nivel: CONFIANCA.MEDIA, motivos };
  }
  if (base.possuiCifrao && totalMonetarios > 1) {
    motivos.push("valor_monetario_com_cifrao_sem_desambiguacao");
    return { nivel: CONFIANCA.MEDIA, motivos };
  }
  if (pareceDecimalMonetario(base.textoOriginal) && totalMonetarios === 1 && !base.marcadorAnterior && !base.marcadorPosterior) {
    motivos.push("unico_valor_decimal_sem_conflito");
    return { nivel: CONFIANCA.MEDIA, motivos };
  }
  motivos.push("candidato_sem_contexto_monetario");
  return { nivel: CONFIANCA.BAIXA, motivos };
}

function coletarCandidatosPreco(textoFonte = "") {
  const fonte = textoLimpo(textoFonte);
  const candidatos = [];
  let match;
  PADRAO_NUMERO.lastIndex = 0;
  while ((match = PADRAO_NUMERO.exec(fonte))) {
    const textoOriginal = match[0];
    const numero = match[1];
    const valor = valorMoeda(numero);
    if (valor === null) continue;
    const indiceInicio = match.index;
    const indiceFim = match.index + textoOriginal.length;
    const ctx = contexto(fonte, indiceInicio, indiceFim);
    const base = {
      valor,
      textoOriginal,
      trechoOrigem: evidencia(ctx.trecho),
      indiceInicio,
      indiceFim,
      marcadorAnterior: marcadorAnterior(ctx.anterior),
      marcadorPosterior: marcadorPosterior(ctx.posterior),
      possuiCifrao: possuiCifraoNoTexto(textoOriginal),
      possuiMoeda: possuiCifraoNoTexto(textoOriginal),
      tipoCandidato: TIPOS_CANDIDATO.DESCONHECIDO,
      nivelEvidencia: CONFIANCA.BAIXA,
      motivos: []
    };
    const tipo = classificarTipo(base);
    base.tipoCandidato = tipo.tipo;
    base.motivos = tipo.motivos;
    candidatos.push(base);
  }

  const totalMonetarios = candidatos.filter(item => (
    item.possuiCifrao || pareceDecimalMonetario(item.textoOriginal)
  ) && ![TIPOS_CANDIDATO.PERCENTUAL, TIPOS_CANDIDATO.QUANTIDADE, TIPOS_CANDIDATO.IDENTIFICADOR].includes(item.tipoCandidato)).length;

  return candidatos.map(item => {
    const evidenciaFinal = nivelEvidencia(item, totalMonetarios);
    return {
      ...item,
      nivelEvidencia: evidenciaFinal.nivel,
      motivos: [...new Set(evidenciaFinal.motivos)]
    };
  });
}

function prioridadeTipo(tipo = "") {
  const prioridades = {
    [TIPOS_CANDIDATO.PRECO_ATUAL]: 100,
    [TIPOS_CANDIDATO.PRECO_PIX]: 110,
    [TIPOS_CANDIDATO.PRECO_CARTAO]: 70,
    [TIPOS_CANDIDATO.PRECO_BOLETO]: 70,
    [TIPOS_CANDIDATO.DESCONHECIDO]: 35
  };
  return prioridades[tipo] || 0;
}

function pontuarCandidato(candidato = {}) {
  let pontos = prioridadeTipo(candidato.tipoCandidato);
  if (candidato.nivelEvidencia === CONFIANCA.ALTA) pontos += 40;
  else if (candidato.nivelEvidencia === CONFIANCA.MEDIA) pontos += 20;
  if (candidato.marcadorAnterior || candidato.marcadorPosterior) pontos += 8;
  if (candidato.possuiCifrao) pontos += 5;
  if (candidato.tipoCandidato === TIPOS_CANDIDATO.DESCONHECIDO && candidato.nivelEvidencia !== CONFIANCA.MEDIA) pontos -= 30;
  return pontos;
}

function rejeitadosPorTipo(candidatos = [], escolhido = null) {
  const resumo = {};
  for (const candidato of candidatos) {
    if (escolhido && candidato.indiceInicio === escolhido.indiceInicio && candidato.indiceFim === escolhido.indiceFim) continue;
    const tipo = candidato.tipoCandidato || TIPOS_CANDIDATO.DESCONHECIDO;
    resumo[tipo] = (resumo[tipo] || 0) + 1;
  }
  return resumo;
}

function primeiroPorTipo(candidatos = [], tipo = "") {
  return candidatos.find(item => item.tipoCandidato === tipo) || null;
}

function resolverPrecoSemantico(textoFonte = "") {
  const candidatos = coletarCandidatosPreco(textoFonte);
  const elegiveis = candidatos
    .filter(item => [TIPOS_CANDIDATO.PRECO_ATUAL, TIPOS_CANDIDATO.PRECO_PIX, TIPOS_CANDIDATO.PRECO_CARTAO, TIPOS_CANDIDATO.PRECO_BOLETO, TIPOS_CANDIDATO.DESCONHECIDO].includes(item.tipoCandidato))
    .filter(item => item.nivelEvidencia !== CONFIANCA.BAIXA || item.tipoCandidato !== TIPOS_CANDIDATO.DESCONHECIDO)
    .map(item => ({ ...item, pontuacao: pontuarCandidato(item) }))
    .sort((a, b) => {
      if (b.pontuacao !== a.pontuacao) return b.pontuacao - a.pontuacao;
      if (Number(b.possuiCifrao) !== Number(a.possuiCifrao)) return Number(b.possuiCifrao) - Number(a.possuiCifrao);
      return a.indiceInicio - b.indiceInicio;
    });

  const precoAtualExplicito = candidatos.find(item => item.tipoCandidato === TIPOS_CANDIDATO.PRECO_ATUAL && ["preco_final", "com_cupom", "por", "total"].includes(item.marcadorAnterior));
  const precosGenericosSemMarcador = candidatos.filter(item => item.tipoCandidato === TIPOS_CANDIDATO.PRECO_ATUAL && !item.marcadorAnterior && !item.marcadorPosterior);
  const precosEspecificos = candidatos.filter(item => [TIPOS_CANDIDATO.PRECO_PIX, TIPOS_CANDIDATO.PRECO_CARTAO, TIPOS_CANDIDATO.PRECO_BOLETO].includes(item.tipoCandidato));
  const ambiguoSemMarcador = !precoAtualExplicito && precosGenericosSemMarcador.length > 1 && precosEspecificos.length === 0;
  const escolhido = ambiguoSemMarcador ? null : (precoAtualExplicito ? { ...precoAtualExplicito, pontuacao: pontuarCandidato(precoAtualExplicito) } : (elegiveis[0] || null));
  const antigo = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.PRECO_ANTIGO);
  const pix = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.PRECO_PIX) || (escolhido && (escolhido.marcadorAnterior === "pix" || escolhido.marcadorPosterior === "pix") ? escolhido : null);
  const cartao = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.PRECO_CARTAO);
  const boleto = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.PRECO_BOLETO);
  const parcela = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.PARCELA);
  const economia = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.ECONOMIA);
  const cupomValor = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.VALOR_CUPOM);
  const frete = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.FRETE);
  const cashback = primeiroPorTipo(candidatos, TIPOS_CANDIDATO.CASHBACK);

  const ambiguidades = [];
  if (ambiguoSemMarcador) {
    ambiguidades.push({ tipo: "multiplos_precos_sem_marcador", quantidade: precosGenericosSemMarcador.length });
  }
  if (!escolhido && candidatos.filter(item => item.tipoCandidato === TIPOS_CANDIDATO.DESCONHECIDO).length > 1) {
    ambiguidades.push({ tipo: "multiplos_valores_sem_desambiguacao", quantidade: candidatos.length });
  }

  return {
    versao: VERSAO_PRECO_SEMANTICO,
    candidatos,
    escolhido,
    precoAtual: escolhido,
    precoAntigo: antigo,
    precoPix: pix,
    precoCartao: cartao,
    precoBoleto: boleto,
    parcela,
    economia,
    cupomValor,
    frete,
    cashback,
    ambiguidades,
    quantidadeCandidatosPreco: candidatos.length,
    candidatosRejeitadosPorTipo: rejeitadosPorTipo(candidatos, escolhido),
    motivosConfiancaPreco: escolhido?.motivos || []
  };
}

function campoDeCandidato(candidato = null, confiancaPadrao = CONFIANCA.AUSENTE) {
  if (!candidato) return { valor: null, confianca: CONFIANCA.AUSENTE, evidencia: null };
  return {
    valor: candidato.valor,
    confianca: candidato.nivelEvidencia || confiancaPadrao,
    evidencia: candidato.trechoOrigem,
    tipo: candidato.tipoCandidato,
    tipoCandidato: candidato.tipoCandidato,
    marcadorAnterior: candidato.marcadorAnterior,
    marcadorPosterior: candidato.marcadorPosterior,
    possuiCifrao: candidato.possuiCifrao === true,
    possuiMoeda: candidato.possuiMoeda === true,
    nivelEvidencia: candidato.nivelEvidencia,
    motivos: candidato.motivos || []
  };
}

module.exports = {
  VERSAO_PRECO_SEMANTICO,
  CONFIANCA,
  TIPOS_CANDIDATO,
  coletarCandidatosPreco,
  resolverPrecoSemantico,
  campoDeCandidato
};
