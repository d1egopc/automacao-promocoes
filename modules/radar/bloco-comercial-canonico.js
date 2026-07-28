const {
  resolverPrecoSemantico,
  TIPOS_CANDIDATO
} = require("./preco-semantico");
const {
  normalizarCuponsSemanticos
} = require("./cupom-semantico");
const {
  classificarLinkComercial,
  classificarLinksComerciais,
  extrairLinksTextoComercial,
  normalizarTextoComparacao
} = require("./links-comerciais");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const limpo = texto(valor);
    if (limpo) return limpo;
  }
  return "";
}

function listaTextoUnica(valores = []) {
  const resultado = [];
  const vistos = new Set();

  for (const valor of Array.isArray(valores) ? valores : []) {
    const item = texto(valor);
    if (!item || vistos.has(item)) continue;
    vistos.add(item);
    resultado.push(item);
  }

  return resultado;
}

function linhaTemLinkComercial(linha = "") {
  return extrairLinksTextoComercial(linha).length > 0;
}

function linhaTemPrecoComercial(linha = "") {
  const resolucao = resolverPrecoSemantico(linha);
  return Boolean(
    resolucao?.precoAtual ||
    resolucao?.precoAntigo ||
    resolucao?.precoPix ||
    resolucao?.precoCartao ||
    resolucao?.precoBoleto ||
    /(?:^|\s)(?:de|por|agora|sai\s+por|apenas|pix)\s*:?\s*(?:R\$\s*)?\d{1,6}(?:[,.]\d{2})?(?![\dA-Za-z])(?=\s|$|[|);,])/i.test(linha)
  );
}

function linhaTemCupomComercial(linha = "") {
  return /\b(?:cupom|codigo|c[oó]digo|use|utilize|aplique|resgate)\b/i.test(linha);
}

function linhaTemCondicaoComercial(linha = "") {
  return /\b(?:pix|boleto|cart[aã]o|parcel|sem\s+juros|\d+\s*x|frete|cashback|app|carrinho|cada|unidade|un\.|brinde|leve\s+\d+)\b/i.test(linha);
}

function linhaPromocionalGenerica(linha = "") {
  const chave = normalizarTextoComparacao(linha);
  if (!chave) return false;
  return Boolean(
    /^(?:corre|aproveita|aproveite|olha|olhem|bora|partiu|garanta|compre|link)\b/.test(chave) ||
    /\b(?:precinho|baratinho|imperdivel|promocao|oferta|perfeitinho|meninas|elogio|supermercado)\b/.test(chave) ||
    /^[\W\d_]+$/.test(chave)
  );
}

function linhaTituloComercialValida(linha = "") {
  const original = texto(linha);
  const chave = normalizarTextoComparacao(original);
  if (!original || !chave) return false;
  if (linhaTemLinkComercial(original) || linhaTemPrecoComercial(original)) return false;
  if (linhaTemCupomComercial(original)) return false;
  if (/\b(?:pix|boleto|cart[aã]o|parcel|sem\s+juros|\d+\s*x|frete|cashback|app|carrinho|brinde)\b/i.test(original)) return false;
  if (linhaPromocionalGenerica(original)) return false;
  const palavras = chave.split(/\s+/).filter(Boolean);
  return chave.length >= 8 && palavras.length >= 2;
}

function linksConhecidosRadar(radarMirror = {}) {
  const links = radarMirror?.links || {};
  const comerciais = radarMirror?.comercial?.links || {};

  return {
    produtoOriginal: links.produtoOriginal,
    produto: comerciais.produto,
    resgateCupom: links.resgateCupom,
    resgate: comerciais.resgate,
    cupom: comerciais.cupom,
    classificados: [
      ...(Array.isArray(links.classificados) ? links.classificados : []),
      ...(Array.isArray(comerciais.classificados) ? comerciais.classificados : [])
    ]
  };
}

function classificarLinksBloco(linhas = [], radarMirror = {}) {
  const resultado = classificarLinksComerciais({
    linhas,
    marketplace: radarMirror?.comercial?.marketplace?.valor || radarMirror?.comercial?.marketplace || "",
    linksConhecidos: linksConhecidosRadar(radarMirror)
  });

  return {
    classificados: {
      produto: resultado.produto,
      resgate: resultado.resgate,
      afiliado: resultado.afiliado,
      imagem: resultado.imagem,
      outros: [
        ...resultado.outros,
        ...(Array.isArray(resultado.landing) ? resultado.landing : []),
        ...(Array.isArray(resultado.encurtador) ? resultado.encurtador : [])
      ]
    },
    evidencias: resultado.classificados.map(item => ({
      linha: item.linha,
      link: item.url,
      tipo: item.tipo,
      confianca: item.confianca,
      origem: item.origem,
      evidencias: item.evidencias || []
    }))
  };
}

function primeiroPrecoAtual(resolucao = {}) {
  return resolucao.precoAtual ||
    resolucao.precoPix ||
    resolucao.precoCartao ||
    resolucao.precoBoleto ||
    null;
}

function resumirPrecosBloco(textoBloco = "") {
  const resolucao = resolverPrecoSemantico(textoBloco);
  const atual = primeiroPrecoAtual(resolucao);
  const anterior = resolucao.precoAntigo || null;
  const unitario = resolucao.precoUnitario || null;
  const parcelamento = resolucao.parcela || null;

  return {
    atual,
    anterior,
    pix: resolucao.precoPix || null,
    boleto: resolucao.precoBoleto || null,
    cartao: resolucao.precoCartao || null,
    parcelado: resolucao.precoCartao || parcelamento || null,
    unitario,
    economia: resolucao.economia || null,
    frete: resolucao.frete || null,
    cashback: resolucao.cashback || null,
    resolucao
  };
}

function linhaIndicePorTexto(linhas = [], trecho = "") {
  const chave = texto(trecho);
  if (!chave) return null;
  const indice = linhas.findIndex(linha => texto(linha).includes(chave));
  return indice >= 0 ? indice : null;
}

function escolherTituloBloco(linhas = [], precos = {}) {
  const indicePrimeiroPreco = linhas.findIndex(linha => linhaTemPrecoComercial(linha));
  const limite = indicePrimeiroPreco >= 0 ? indicePrimeiroPreco : linhas.length;
  const candidatas = linhas
    .slice(0, limite)
    .map((linha, indice) => ({ linha: texto(linha), indice }))
    .filter(item => linhaTituloComercialValida(item.linha));

  return candidatas[candidatas.length - 1] || { linha: "", indice: null };
}

function extrairInstrucoesBloco(linhas = []) {
  return listaTextoUnica(linhas.filter(linha =>
    /\b(?:aplique|use|utilize|resgate|selecione|ative|pegue|cupom|app|carrinho|nao\s+acumulativo|n[aã]o\s+acumulativo)\b/i.test(linha) &&
    !linhaTemLinkComercial(linha)
  ));
}

function linhaPossuiCodigoCupomExplicito(linha = "") {
  return Boolean(
    /\b(?:cupom|codigo|c[oó]digo|cod)\s*:?\s*[A-Z0-9][A-Z0-9_-]{3,}/i.test(linha) ||
    /\b(?:use|utilize|aplique)\s+(?:o\s+)?(?:cupom|codigo|c[oó]digo|cod)\s+[A-Z0-9][A-Z0-9_-]{3,}/i.test(linha)
  );
}

function extrairCuponsBloco(linhas = []) {
  const fontes = linhas.filter(linha => linhaPossuiCodigoCupomExplicito(linha) && !linhaTemLinkComercial(linha));
  return normalizarCuponsSemanticos(fontes);
}

function extrairCondicoesBloco(linhas = [], precos = {}) {
  const textos = linhas.map(texto).filter(Boolean);
  return {
    pix: textos.find(linha => /\bpix\b/i.test(linha)) || "",
    parcelamento: textos.find(linha => /\b\d+\s*x\b|parcel|sem\s+juros/i.test(linha)) || "",
    frete: textos.find(linha => /\bfrete\b/i.test(linha)) || "",
    cashback: textos.find(linha => /\bcashback\b/i.test(linha)) || "",
    observacoes: listaTextoUnica(textos.filter(linha =>
      linhaTemCondicaoComercial(linha) &&
      !linhaTemPrecoComercial(linha) &&
      !linhaTemCupomComercial(linha)
    )),
    precoPix: precos.pix,
    precoUnitario: precos.unitario,
    parcelamentoValor: precos.parcelado,
    freteValor: precos.frete,
    cashbackValor: precos.cashback
  };
}

function linhaIniciaNovaUnidade(linha = "", blocoAtual = {}) {
  if (!linhaTituloComercialValida(linha)) return false;
  return Boolean(
    blocoAtual.temTitulo &&
    blocoAtual.temPreco &&
    blocoAtual.temLinkProduto
  );
}

function criarBlocosPorContinuidade(textoFonte = "", radarMirror = {}) {
  const linhasOriginais = String(textoFonte || "").replace(/\r/g, "\n").split("\n");
  const blocos = [];
  let atual = [];
  let estado = { temTitulo: false, temPreco: false, temLinkProduto: false };

  function fechar() {
    const limpas = atual.map(linha => texto(linha)).filter(Boolean);
    if (limpas.length) blocos.push(limpas);
    atual = [];
    estado = { temTitulo: false, temPreco: false, temLinkProduto: false };
  }

  linhasOriginais.forEach((linhaOriginal, indiceLinha) => {
    const linha = texto(linhaOriginal);
    if (!linha) return;

    if (linhaIniciaNovaUnidade(linha, estado)) fechar();

    atual.push(linha);

    if (linhaTituloComercialValida(linha)) estado.temTitulo = true;
    if (linhaTemPrecoComercial(linha)) estado.temPreco = true;

    for (const link of extrairLinksTextoComercial(linha)) {
      const tipo = classificarLinkComercial({
        url: link,
        linhaAtual: linha,
        linhaAnterior: linhasOriginais[indiceLinha - 1] || "",
        linhaPosterior: linhasOriginais[indiceLinha + 1] || "",
        tipoSugerido: ""
      }).tipo;
      if (tipo === "produto") estado.temLinkProduto = true;
    }
  });

  fechar();
  return blocos;
}

function resumirBlocoComercialCanonico(linhas = [], indice = 0, radarMirror = {}) {
  const textoBloco = linhas.join("\n");
  const precos = resumirPrecosBloco(textoBloco);
  const titulo = escolherTituloBloco(linhas, precos);
  const links = classificarLinksBloco(linhas, radarMirror);
  const cupons = extrairCuponsBloco(linhas);
  const instrucoes = extrairInstrucoesBloco(linhas);
  const condicoes = extrairCondicoesBloco(linhas, precos);
  const precoAtual = precos.atual?.valor ?? null;
  const possuiProduto = Boolean(titulo.linha);
  const possuiPreco = precoAtual !== null && precoAtual !== undefined;
  const possuiLinkProduto = links.classificados.produto.length > 0 || links.classificados.afiliado.length > 0;

  return {
    indice,
    texto: textoBloco,
    linhas,
    titulo: titulo.linha,
    precos,
    precoAtual,
    precoAnterior: precos.anterior?.valor ?? null,
    cupons,
    instrucoes,
    links: links.classificados,
    condicoes,
    evidencias: {
      tituloLinha: titulo.indice,
      precoLinhas: (precos.resolucao?.candidatos || [])
        .filter(candidato => [
          TIPOS_CANDIDATO.PRECO_ATUAL,
          TIPOS_CANDIDATO.PRECO_ANTIGO,
          TIPOS_CANDIDATO.PRECO_PIX,
          TIPOS_CANDIDATO.PRECO_CARTAO,
          TIPOS_CANDIDATO.PRECO_BOLETO,
          TIPOS_CANDIDATO.PRECO_UNITARIO,
          TIPOS_CANDIDATO.PARCELA
        ].includes(candidato.tipoCandidato))
        .map(candidato => ({
          tipo: candidato.tipoCandidato,
          valor: candidato.valor,
          evidencia: candidato.trechoOrigem,
          linha: linhaIndicePorTexto(linhas, candidato.textoOriginal)
        })),
      cupomLinhas: linhas
        .map((linha, linhaIndice) => ({ linha: linhaIndice, texto: linha }))
        .filter(item => linhaTemCupomComercial(item.texto)),
      linkLinhas: links.evidencias
    },
    coerente: Boolean(possuiProduto && possuiPreco && possuiLinkProduto),
    possuiProduto,
    possuiPreco,
    possuiLinkProduto
  };
}

function motivoRejeicaoBlocos(blocos = []) {
  const possuiProduto = blocos.some(bloco => bloco.possuiProduto);
  const possuiPreco = blocos.some(bloco => bloco.possuiPreco);
  const possuiLinkProduto = blocos.some(bloco => bloco.possuiLinkProduto);
  const possuiLinkResgate = blocos.some(bloco => (bloco.links?.resgate || []).length > 0);

  if (possuiProduto && possuiPreco && !possuiLinkProduto) return "produto_sem_link";
  if (possuiLinkResgate && !possuiLinkProduto) return "produto_sem_link";
  if (possuiProduto && possuiLinkProduto && !possuiPreco) return "titulo_sem_preco";
  if (possuiPreco && possuiLinkProduto && !possuiProduto) return "preco_sem_produto";
  if (possuiPreco && !possuiProduto) return "preco_sem_produto";
  if (possuiProduto && !possuiPreco) return "titulo_sem_preco";
  return "evidencias_comerciais_insuficientes";
}

function resumirBlocoDiagnostico(bloco = {}) {
  return {
    indice: bloco.indice,
    possuiTitulo: Boolean(bloco.titulo),
    possuiProduto: Boolean(bloco.possuiProduto),
    possuiPreco: Boolean(bloco.possuiPreco),
    possuiLinkProduto: Boolean(bloco.possuiLinkProduto),
    linksProduto: bloco.links?.produto?.length || 0,
    linksResgate: bloco.links?.resgate?.length || 0,
    cupons: bloco.cupons || [],
    titulo: bloco.titulo || ""
  };
}

function resolverBlocoComercialCanonico(radarMirror = {}) {
  const fonte = primeiroTexto(radarMirror?.texto?.original, radarMirror?.texto?.limpo);
  const linhasBlocos = criarBlocosPorContinuidade(fonte, radarMirror);
  const blocos = linhasBlocos.map((linhas, indice) => resumirBlocoComercialCanonico(linhas, indice, radarMirror));
  const coerentes = blocos.filter(bloco => bloco.coerente);

  if (coerentes.length === 1) {
    const bloco = coerentes[0];
    return {
      ok: true,
      bloco,
      blocosDescartados: blocos.filter(item => item.indice !== bloco.indice).map(resumirBlocoDiagnostico),
      motivo: "bloco_comercial_canonico"
    };
  }

  if (coerentes.length > 1) {
    return {
      ok: false,
      motivo: "multiplos_blocos_comerciais",
      blocos: blocos.map(resumirBlocoDiagnostico)
    };
  }

  return {
    ok: false,
    motivo: motivoRejeicaoBlocos(blocos),
    blocos: blocos.map(resumirBlocoDiagnostico)
  };
}

module.exports = {
  classificarLinkComercial,
  criarBlocosPorContinuidade,
  extrairLinksTextoComercial,
  linhaTituloComercialValida,
  resolverBlocoComercialCanonico,
  resumirBlocoComercialCanonico
};
