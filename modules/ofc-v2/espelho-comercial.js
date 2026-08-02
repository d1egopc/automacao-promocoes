"use strict";

const { analisarValorMonetario, formatarMoedaBR } = require("../../utils/moeda");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function chaveCupom(valor = "") {
  return normalizarComparacao(valor).replace(/[^a-z0-9_-]+/g, "").toUpperCase();
}

function numeroMonetario(valor) {
  const analise = analisarValorMonetario(valor);
  return analise.ok ? analise.numero : null;
}

function textoMoeda(valor) {
  const original = texto(valor).replace(/\s+/g, " ");
  if (/(?:US\$|USD|U\$|\u20ac|EUR)/i.test(original) || (/\$/.test(original) && !/R\$/i.test(original))) return original;
  const formatado = formatarMoedaBR(valor);
  return formatado || original;
}

function textoLimitado(valor = "", limite = 1200) {
  const fonte = texto(valor).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (fonte.length <= limite) return fonte;
  return `${fonte.slice(0, limite)}...`;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const t = texto(valor);
    if (t) return t;
  }
  return "";
}

function primeiroValor(...valores) {
  for (const valor of valores) {
    const n = numeroMonetario(valor);
    if (n !== null) return n;
  }
  return null;
}

function linhasTexto(fonte = "") {
  return texto(fonte)
    .split(/\n+/)
    .map(linha => linha.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean);
}

function extrairTextoOriginal({ oferta = {}, ofertaEntrada = {}, evento = {}, metadata = {} } = {}) {
  const radar = objeto(metadata.radarMirror || metadata.radarEspelhoComercial || ofertaEntrada.radarMirror || ofertaEntrada.radarEspelhoComercial);
  const textoRadar = objeto(radar.texto || {}).original || radar.textoOriginal || radar.textoComercialOriginal || radar.documentoComercialCanonico;
  return primeiroTexto(
    evento.texto_original,
    evento.textoOriginal,
    ofertaEntrada.textoComercialOriginal,
    ofertaEntrada.textoOriginal,
    ofertaEntrada.documentoComercialCanonico,
    oferta.textoComercialOriginal,
    oferta.documentoComercialCanonico,
    oferta.textoOriginal,
    textoRadar,
    metadata.textoComercialOriginal,
    metadata.documentoComercialCanonico
  );
}

function limparTitulo(linha = "") {
  return texto(linha)
    .replace(/^[\s\-*>#.:;!]+/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function linhaPareceComercial(linha = "") {
  const n = normalizarComparacao(linha);
  return /\b(de|por|cupom|resgate|confira|link|pix|parcel|frete|cashback|voucher|moeda|moedas)\b/.test(n) || /https?:\/\//i.test(linha);
}

function extrairTituloOriginal(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const tituloEstruturado = primeiroTexto(ofertaEntrada.tituloOriginal, ofertaEntrada.titulo, oferta.titulo, oferta.nome);
  const linhas = linhasTexto(textoOriginal);
  const linhaTitulo = linhas.find(linha => !linhaPareceComercial(linha) && limparTitulo(linha).length >= 4);
  const linhaTituloPreservada = linhas.find(linha => {
    if (/https?:\/\//i.test(linha)) return false;
    const n = normalizarComparacao(linha);
    if (/^(de|por|valor|cupom|use|utilize|aplique|resgate|frete)\b/.test(n)) return false;
    return limparTitulo(linha).length >= 4;
  });
  return primeiroTexto(limparTitulo(linhaTitulo), limparTitulo(linhaTituloPreservada), tituloEstruturado);
}

function extrairPrecosTexto(textoOriginal = "") {
  const fonte = textoOriginal.replace(/\r\n/g, "\n");
  const padraoMoeda = "((?:R\\$|US\\$|USD|U\\$|\\$)?\\s*[\\d.]+(?:[,.][\\d]{1,2})?)";
  const dePor = fonte.match(new RegExp(`\\bde\\s*:?\\s*${padraoMoeda}\\s*(?:\\||-|\\/|,|\\s)+por\\s*:?\\s*${padraoMoeda}([^\\n]*)`, "i"));
  const linhaDe = fonte.match(new RegExp(`(?:^|\\n)\\s*(?:[^\\n\\w]{0,4}\\s*)?de\\s*:?\\s*${padraoMoeda}`, "i"));
  const linhaPor = fonte.match(new RegExp(`(?:^|\\n)\\s*(?:[^\\n\\w]{0,4}\\s*)?por\\s*:?\\s*${padraoMoeda}([^\\n]*)`, "i"));
  const linhaValor = fonte.match(new RegExp(`(?:^|\\n)\\s*(?:[^\\n\\w]{0,4}\\s*)?valor\\s*:?\\s*${padraoMoeda}([^\\n]*)`, "i"));
  const linhaPrecoDireta = fonte.match(new RegExp(`(?:^|\\n)\\s*${padraoMoeda}([^\\n]*(?:cupom|pix|moeda|moedas|voucher|app|carrinho)[^\\n]*)`, "i"));
  const final = fonte.match(new RegExp(`(?:pre(?:co|c\\u00e7o)\\s*final|valor\\s*final|pague|fica\\s*por)\\D{0,24}${padraoMoeda}([^\\n]*)`, "i"));

  const precoDeTexto = dePor?.[1] || linhaDe?.[1] || "";
  const precoPorTexto = dePor?.[2] || linhaPor?.[1] || linhaValor?.[1] || linhaPrecoDireta?.[1] || "";
  const sufixoPor = texto(dePor?.[3] || linhaPor?.[2] || linhaValor?.[2] || linhaPrecoDireta?.[2] || "");
  const precoFinalTexto = final?.[1] || "";
  const sufixoFinal = texto(final?.[2] || "");

  return {
    precoDeTexto: textoMoeda(precoDeTexto),
    precoPorTexto: textoMoeda(precoPorTexto),
    precoFinalTexto: textoMoeda(precoFinalTexto),
    precoDeValor: numeroMonetario(precoDeTexto),
    precoPorValor: numeroMonetario(precoPorTexto),
    precoFinalValor: numeroMonetario(precoFinalTexto),
    sufixoPor,
    sufixoFinal
  };
}

const CUPONS_BLOQUEADOS = new Set([
  "CUPOM", "CUPONS", "CODIGO", "COD", "DESCONTO", "PROMO", "PROMOCAO",
  "TODOS", "DESTA", "PAGINA", "RESGATE", "ANUNCIO", "HTTP", "HTTPS",
  "WWW", "COM", "BR", "COMBR", "SHOPEE", "MERCADOLIVRE", "MERCADO", "LIVRE"
]);

function cupomPlausivel(valor = "") {
  const chave = chaveCupom(valor);
  if (!chave || chave.length < 3 || chave.length > 32) return false;
  if (CUPONS_BLOQUEADOS.has(chave)) return false;
  if (!/[A-Z]/.test(chave)) return false;
  if (/^\d+$/.test(chave)) return false;
  return true;
}

function separarCupons(valor = "") {
  return texto(valor)
    .split(/\s+(?:ou|e)\s+|[,;/|]+/i)
    .map(item => item.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9_-]+$/g, "").trim())
    .filter(cupomPlausivel);
}

function dedupCupons(cupons = []) {
  const vistos = new Set();
  const saida = [];
  for (const cupom of cupons) {
    const chave = chaveCupom(cupom);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(texto(cupom));
  }
  return saida;
}

function extrairCupomTexto(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const candidatos = [];
  const linhas = linhasTexto(textoOriginal);
  for (const linha of linhas) {
    const marcador = linha.match(/\b(?:cupom|c[oÃƒÂ³]digo|cod\.?|use\s+o\s+cupom|utilize\s+o\s+cupom)\b\s*:?\s*([A-Z0-9][A-Z0-9_-]*(?:\s*(?:ou|e|[,;/|])\s*[A-Z0-9][A-Z0-9_-]*)*)/i);
    if (!marcador) continue;
    candidatos.push(...separarCupons(marcador[1]));
  }
  candidatos.push(...separarCupons(ofertaEntrada.cupom || ofertaEntrada.cupomCodigo || ofertaEntrada.codigoCupom || ""));
  candidatos.push(...separarCupons(oferta.cupom || oferta.cupomCodigo || oferta.codigoCupom || ""));
  const cupons = dedupCupons(candidatos);
  const linhaCupom = linhas.find(linha => /\bcupom\b/i.test(linha) && cupons.some(cupom => normalizarComparacao(linha).includes(normalizarComparacao(cupom))));
  return {
    cupons,
    cupomCodigo: cupons.join(" ou "),
    cupomTexto: texto(linhaCupom) || cupons.join(" ou ")
  };
}

function instrucaoRedundante(instrucao = "", cupomCodigo = "") {
  const normalizada = normalizarComparacao(instrucao).replace(/[^a-z0-9]+/g, " ").trim();
  const cupom = normalizarComparacao(cupomCodigo).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizada) return true;
  if (!cupom) return false;
  return [
    `cupom ${cupom}`,
    `codigo ${cupom}`,
    `cod ${cupom}`,
    `use o cupom ${cupom}`,
    `utilize o cupom ${cupom}`
  ].includes(normalizada);
}

function extrairInstrucaoComercial(textoOriginal = "", cupomCodigo = "", oferta = {}, ofertaEntrada = {}) {
  const estruturada = primeiroTexto(ofertaEntrada.instrucaoCupom, ofertaEntrada.instrucaoComercial, oferta.instrucaoCupom, oferta.instrucaoComercial);
  const linhas = linhasTexto(textoOriginal);
  const linha = linhas.find(item => {
    if (/https?:\/\//i.test(item)) return false;
    const n = normalizarComparacao(item);
    if (!/(aplique|resgate|use|utilize|selecione|ative|pegue|copie|garanta)/.test(n)) return false;
    if (!/(cupom|cupons|voucher|moeda|moedas|pix|app|carrinho|desconto|valor)/.test(n)) return false;
    return true;
  });
  const instrucao = primeiroTexto(estruturada, linha);
  return instrucaoRedundante(instrucao, cupomCodigo) ? "" : instrucao;
}

function extrairFormaPagamento(textoOriginal = "", oferta = {}, ofertaEntrada = {}) {
  const estruturada = primeiroTexto(ofertaEntrada.condicaoPix, ofertaEntrada.precoPix, oferta.condicaoPix, oferta.precoPix);
  const fonte = `${textoOriginal}\n${estruturada}`;
  if (/\b(?:via|no|na|por)\s+pix\b|\bpix\b/i.test(fonte)) return "Pix";
  return "";
}

function removerPrefixoComercial(linha = "", padrao = /^$/) {
  return texto(linha).replace(padrao, "").replace(/^[\s:|\-]+/, "").trim();
}

function primeiraLinhaOriginal(textoOriginal = "", predicado = () => false) {
  return linhasTexto(textoOriginal).find(predicado) || "";
}

function primeiraLinhaPorNormalizacao(textoOriginal = "", padrao) {
  return primeiraLinhaOriginal(textoOriginal, linha => padrao.test(normalizarComparacao(linha)));
}

function extrairTextoLinhaPreco(linha = "", tipo = "") {
  const valor = texto(linha);
  if (!valor) return "";
  if (tipo === "de") return removerPrefixoComercial(valor, /^\s*(?:[^\n\w]{0,4}\s*)?de\s*:?\s*/i);
  if (tipo === "por") return removerPrefixoComercial(valor, /^\s*(?:[^\n\w]{0,4}\s*)?por\s*:?\s*/i);
  if (tipo === "valor") return removerPrefixoComercial(valor, /^\s*(?:[^\n\w]{0,4}\s*)?valor\s*:?\s*/i);
  return valor;
}

function extrairDocumentoComercialCanonico({
  textoOriginal = "",
  tituloOriginal = "",
  precosTexto = {},
  cupom = {},
  instrucaoComercial = "",
  formaPagamentoTexto = "",
  condicoesComerciais = [],
  links = {},
  linkAfiliado = "",
  marketplace = "",
  imagemComercial = {},
  oferta = {},
  ofertaEntrada = {},
  comercialNormalizado = {},
  avisos = [],
  motivosConfianca = []
} = {}) {
  const linhaDe = primeiraLinhaPorNormalizacao(textoOriginal, /^\s*(?:de)\b/);
  const linhaPor = primeiraLinhaPorNormalizacao(textoOriginal, /^\s*(?:por)\b/);
  const linhaValor = primeiraLinhaPorNormalizacao(textoOriginal, /^\s*(?:valor)\b/);
  const linhaPix = primeiraLinhaPorNormalizacao(textoOriginal, /\bpix\b/);
  const linhaParcelamento = primeiraLinhaPorNormalizacao(textoOriginal, /\b(?:parcel|\d+\s*x\s*de|ate\s+\d+x|em\s+\d+x|vezes)\b/);
  const linhaCashback = primeiraLinhaOriginal(textoOriginal, linha => /\bcashback\b/i.test(linha) && (/(?:R\$|US\$|USD|U\$|\$|\d)/i.test(linha) || /^\s*cashback\b/i.test(linha)));
  const linhaFrete = primeiraLinhaPorNormalizacao(textoOriginal, /\bfrete\b/);
  const linhaResgate = primeiraLinhaPorNormalizacao(textoOriginal, /\bresgate\b/);
  const linhaBeneficio = primeiraLinhaPorNormalizacao(textoOriginal, /\b(?:beneficio|app|prime|voucher|moeda|moedas|direto do brasil|pre venda|pré venda)\b/);

  const precoDeTexto = extrairTextoLinhaPreco(linhaDe, "de") || precosTexto.precoDeTexto || "";
  const precoPorTexto = extrairTextoLinhaPreco(linhaPor, "por") || extrairTextoLinhaPreco(linhaValor, "valor") || precosTexto.precoPorTexto || "";
  const precoPixTexto = /\bpix\b/i.test(linhaPor || linhaValor || linhaPix)
    ? (extrairTextoLinhaPreco(linhaPor, "por") || extrairTextoLinhaPreco(linhaValor, "valor") || texto(linhaPix))
    : primeiroTexto(ofertaEntrada.precoPix, ofertaEntrada.condicaoPix, oferta.precoPix, oferta.condicaoPix, formaPagamentoTexto === "Pix" ? precoPorTexto : "");
  const parcelamentoTexto = texto(linhaParcelamento) || primeiroTexto(ofertaEntrada.parcelamento, oferta.parcelamento, comercialNormalizado.parcelamento?.texto);
  const cashbackTexto = texto(linhaCashback) || primeiroTexto(ofertaEntrada.cashback, oferta.cashback);
  const freteTexto = texto(linhaFrete) || primeiroTexto(ofertaEntrada.frete, oferta.frete, oferta.freteGratis === true ? "Frete gratis" : "");
  const beneficioTexto = texto(linhaBeneficio) || primeiroTexto(ofertaEntrada.beneficioExtra, ofertaEntrada.beneficioTexto, oferta.beneficioExtra, oferta.beneficioTexto);
  const instrucaoTexto = texto(instrucaoComercial);
  const cupomTexto = texto(cupom.cupomCodigo || cupom.cupomTexto || ofertaEntrada.cupom || oferta.cupom);

  return {
    tituloOriginal: tituloOriginal || null,
    descricaoOriginal: textoOriginal || null,
    precoDeTexto: precoDeTexto || null,
    precoPorTexto: precoPorTexto || null,
    precoPixTexto: precoPixTexto || null,
    parcelamentoTexto: parcelamentoTexto || null,
    cupomTexto: cupomTexto || null,
    beneficioTexto: beneficioTexto || null,
    instrucaoTexto: instrucaoTexto || null,
    cashbackTexto: cashbackTexto || null,
    freteTexto: freteTexto || null,
    resgateTexto: texto(linhaResgate) || null,
    linkProdutoOriginal: links.linkProdutoOriginal || null,
    linkResgateOriginal: links.linkResgateOriginal || null,
    linkAfiliado: linkAfiliado || null,
    imagemComercial: imagemComercial && Object.keys(imagemComercial).length ? { ...imagemComercial } : null,
    marketplace: marketplace || null,
    origemDocumento: textoOriginal ? "texto_comercial_original" : "campos_estruturados_parciais",
    confianca: {
      confiavel: motivosConfianca.includes("preco_explicito_na_captura") || Boolean(cupomTexto && (precoPorTexto || precoPixTexto)),
      motivos: [...new Set(motivosConfianca.filter(Boolean))]
    },
    avisos: [...new Set((avisos || []).filter(Boolean))],
    condicoesComerciais: [...new Set((condicoesComerciais || []).map(texto).filter(Boolean))]
  };
}

function adicionarUnico(listaSaida, valor) {
  const item = texto(valor);
  if (!item) return;
  const chave = normalizarComparacao(item);
  if (listaSaida.some(existente => normalizarComparacao(existente) === chave)) return;
  listaSaida.push(item);
}

function extrairCondicoes({ textoOriginal = "", oferta = {}, ofertaEntrada = {}, comercialNormalizado = {} } = {}) {
  const condicoes = [];
  const fonte = textoOriginal;
  if (/\bpix\b/i.test(fonte) || oferta.precoPix || oferta.condicaoPix || ofertaEntrada.precoPix || ofertaEntrada.condicaoPix) adicionarUnico(condicoes, "pagamento_pix");
  if (/\b(?:voucher|moeda|moedas)\b/i.test(fonte)) adicionarUnico(condicoes, "voucher_ou_moedas");
  if (/\bcashback\b/i.test(fonte) || oferta.cashback || ofertaEntrada.cashback) adicionarUnico(condicoes, primeiroTexto(oferta.cashback, ofertaEntrada.cashback, "cashback"));
  if (/\bfrete\b/i.test(fonte) || oferta.frete || ofertaEntrada.frete) adicionarUnico(condicoes, primeiroTexto(oferta.frete, ofertaEntrada.frete, "frete"));
  const parcelamento = primeiroTexto(oferta.parcelamento, ofertaEntrada.parcelamento, comercialNormalizado.parcelamento?.texto);
  if (parcelamento) adicionarUnico(condicoes, parcelamento);
  const beneficios = [...lista(oferta.beneficios), ...lista(ofertaEntrada.beneficios)];
  for (const beneficio of beneficios) adicionarUnico(condicoes, beneficio);
  return condicoes.slice(0, 12);
}

function urlsDoTexto(textoOriginal = "") {
  const urls = [];
  const linhas = linhasTexto(textoOriginal);
  for (const linha of linhas) {
    const matches = linha.match(/https?:\/\/[^\s)]+/gi) || [];
    for (const url of matches) urls.push({ url: texto(url), linha });
  }
  return urls;
}

function valorUrl(item = {}) {
  if (typeof item === "string") return texto(item);
  if (!item || typeof item !== "object") return "";
  return primeiroTexto(item.afiliado, item.linkAfiliado, item.resolvido, item.url_expandida, item.urlNormalizada, item.original, item.url_original, item.link, item.url);
}

function adicionarLinkUnico(saida, url, tipo = "produto") {
  const valor = texto(url);
  if (!valor) return;
  const chave = valor.replace(/#.*$/, "");
  if (saida.some(item => item.url.replace(/#.*$/, "") === chave)) return;
  saida.push({ url: valor, tipo });
}

function extrairLinksComerciais({ textoOriginal = "", oferta = {}, ofertaEntrada = {}, link = {} } = {}) {
  const links = [];
  for (const item of urlsDoTexto(textoOriginal)) {
    const n = normalizarComparacao(item.linha);
    const tipo = /(resgate|cupom|voucher)/.test(n) ? "resgate" : "produto";
    adicionarLinkUnico(links, item.url, tipo);
  }
  for (const item of lista(ofertaEntrada.linksProduto)) adicionarLinkUnico(links, valorUrl(item), "produto");
  for (const item of lista(ofertaEntrada.linksResgate)) adicionarLinkUnico(links, valorUrl(item), "resgate");
  for (const item of lista(oferta.linksProduto)) adicionarLinkUnico(links, valorUrl(item), "produto");
  for (const item of lista(oferta.linksResgate)) adicionarLinkUnico(links, valorUrl(item), "resgate");
  adicionarLinkUnico(links, oferta.linkOriginal || link.url_original || ofertaEntrada.linkOriginal, "produto");
  adicionarLinkUnico(links, oferta.linkAfiliado || ofertaEntrada.linkAfiliado, "produto");
  return {
    linkProdutoOriginal: links.find(item => item.tipo === "produto")?.url || "",
    linkResgateOriginal: links.find(item => item.tipo === "resgate")?.url || "",
    links
  };
}

function imagemPossuiMarcaFonte(url = "", origem = "") {
  const fonte = normalizarComparacao(`${url} ${origem}`);
  return /(whatsapp|telegram|grupo|canal|radar|fonte|print|screenshot|thumb|avatar|logo)/.test(fonte);
}

function classificarImagem(candidato = {}) {
  const origem = normalizarComparacao(candidato.origem);
  const url = normalizarComparacao(candidato.url);
  const possuiMarcaFonte = imagemPossuiMarcaFonte(url, origem);
  let prioridade = 90;
  let origemSelecionada = candidato.origem || "desconhecida";
  let imagemOficial = false;
  let imagemLimpa = !possuiMarcaFonte;

  if (/(canonical|produto|product|importer|oficial|marketplace|engine_ofertas\.imagem)/.test(origem)) {
    prioridade = 10;
    imagemOficial = true;
  } else if (/(mercadolivre|meli|shopee|amazon|aliexpress|kabum|awin)/.test(url)) {
    prioridade = 20;
    imagemOficial = true;
    origemSelecionada = origemSelecionada || "dominio_marketplace";
  } else if (/(manufacturer|fabricante|marca)/.test(origem)) {
    prioridade = 30;
    imagemOficial = true;
  } else if (/(og|open_graph|meta)/.test(origem)) {
    prioridade = 40;
  } else if (/(thumb|thumbnail)/.test(origem)) {
    prioridade = 80;
  }

  if (possuiMarcaFonte && prioridade < 80) prioridade += 45;
  if (possuiMarcaFonte) imagemLimpa = false;

  return { ...candidato, prioridade, origemSelecionada, imagemOficial, imagemLimpa, possuiMarcaFonte };
}

function selecionarImagemComercial({ oferta = {}, ofertaEntrada = {}, metadata = {}, link = {} } = {}) {
  const candidatos = [];
  const adicionar = (url, origem) => {
    const valor = texto(url);
    if (valor) candidatos.push({ url: valor, origem: texto(origem) || "desconhecida" });
  };
  const imagemAuditoria = objeto(metadata.imagemAuditoria);
  adicionar(oferta.imagem, oferta.imagemOrigem || metadata.imagemOrigem || "oferta.imagem");
  adicionar(imagemAuditoria.imagemFinal, imagemAuditoria.origemImagem || "metadata.imagemAuditoria");
  adicionar(ofertaEntrada.imagem, "ofertaEntrada.imagem");
  adicionar(ofertaEntrada.imagemUrl, "ofertaEntrada.imagemUrl");
  adicionar(ofertaEntrada.thumbnail, "ofertaEntrada.thumbnail");
  adicionar(objeto(link.metadata).imagem, "link.metadata.imagem");
  adicionar(objeto(link.metadata).thumbnail, "link.metadata.thumbnail");

  const classificados = candidatos.map(classificarImagem).sort((a, b) => a.prioridade - b.prioridade);
  const selecionada = classificados[0];
  if (!selecionada) {
    return {
      urlOriginalCapturada: primeiroTexto(ofertaEntrada.imagemOriginal, ofertaEntrada.thumbnail),
      urlSelecionada: null,
      origemSelecionada: null,
      imagemOficial: false,
      imagemLimpa: false,
      possuiMarcaFonte: false,
      motivoSelecao: "imagem_indisponivel"
    };
  }
  return {
    urlOriginalCapturada: primeiroTexto(ofertaEntrada.imagemOriginal, ofertaEntrada.thumbnail),
    urlSelecionada: selecionada.url,
    origemSelecionada: selecionada.origemSelecionada,
    imagemOficial: selecionada.imagemOficial,
    imagemLimpa: selecionada.imagemLimpa,
    possuiMarcaFonte: selecionada.possuiMarcaFonte,
    motivoSelecao: selecionada.imagemOficial && selecionada.imagemLimpa
      ? "imagem_oficial_limpa_priorizada"
      : (selecionada.possuiMarcaFonte ? "imagem_com_marca_fonte_mantida_como_fallback" : "melhor_imagem_disponivel")
  };
}

function montarTemplateEspelhoShadow(espelho = {}, documento = null) {
  const doc = objeto(documento || espelho.documentoComercialCanonico);
  const linhas = [];
  const adicionar = (...partes) => {
    const bloco = partes.map(texto).filter(Boolean);
    if (bloco.length) linhas.push(bloco.join("\n"));
  };

  const precoPor = primeiroTexto(doc.precoPixTexto, doc.precoPorTexto, espelho.precoFinalTexto, espelho.precoPorTexto);
  const parcelamento = primeiroTexto(doc.parcelamentoTexto, lista(espelho.condicoesComerciais).find(item => /x\s*de|parcel/i.test(item)) || "");
  const cashback = primeiroTexto(doc.cashbackTexto, lista(espelho.condicoesComerciais).find(item => /cashback/i.test(item)) || "");
  const frete = primeiroTexto(doc.freteTexto, lista(espelho.condicoesComerciais).find(item => /frete/i.test(item)) || "");
  const beneficio = primeiroTexto(doc.beneficioTexto, lista(espelho.condicoesComerciais).find(item => !/cashback|frete|x\s*de|parcel/i.test(item)) || "");
  const cupom = primeiroTexto(doc.cupomTexto, espelho.cupomCodigo);
  const linkResgate = primeiroTexto(doc.linkResgateOriginal, espelho.linkResgateOriginal);
  const linkProduto = primeiroTexto(doc.linkAfiliado, espelho.linkAfiliado, doc.linkProdutoOriginal, espelho.linkProdutoOriginal);

  adicionar(doc.tituloOriginal || espelho.tituloNormalizado || espelho.tituloOriginal || "Oferta");
  adicionar(
    doc.precoDeTexto ? `De: ${doc.precoDeTexto}` : (espelho.precoDeTexto ? `De: ${espelho.precoDeTexto}` : ""),
    precoPor ? `Por: ${precoPor}` : "",
    parcelamento
  );
  adicionar(beneficio ? `Beneficio: ${beneficio}` : "");
  adicionar(cashback ? `Cashback: ${cashback}` : "");
  adicionar(frete ? `Frete: ${frete}` : "");
  adicionar(cupom ? `Cupom: ${cupom}` : "");
  adicionar(linkResgate ? `Resgate os cupons:\n${linkResgate}` : "");
  adicionar(linkProduto ? `Confira aqui:\n${linkProduto}` : "");
  adicionar(doc.instrucaoTexto || espelho.instrucaoComercial || "");

  const mensagem = linhas.join("\n\n");
  return {
    ok: Boolean(mensagem),
    modo: "shadow",
    aplicouMudancas: false,
    mensagem,
    linhas: linhas.length,
    avisos: mensagem ? [] : ["template_espelho_sem_conteudo"]
  };
}

function construirEspelhoComercialV24(entrada = {}) {
  const oferta = objeto(entrada.oferta);
  const ofertaEntrada = objeto(entrada.ofertaEntrada);
  const job = objeto(entrada.job);
  const evento = objeto(entrada.evento);
  const link = objeto(entrada.link);
  const metadata = objeto(entrada.metadata);
  const comercialNormalizado = objeto(entrada.comercialNormalizado);
  const textoOriginalCompleto = extrairTextoOriginal({ oferta, ofertaEntrada, evento, metadata });
  const textoOriginal = textoLimitado(textoOriginalCompleto, 3000);
  const tituloOriginal = extrairTituloOriginal(textoOriginal, oferta, ofertaEntrada);
  const precosTexto = extrairPrecosTexto(textoOriginal);
  const cupom = extrairCupomTexto(textoOriginal, oferta, ofertaEntrada);
  const instrucaoComercial = extrairInstrucaoComercial(textoOriginal, cupom.cupomCodigo, oferta, ofertaEntrada);
  const formaPagamentoTexto = extrairFormaPagamento(textoOriginal, oferta, ofertaEntrada);
  const condicoesComerciais = extrairCondicoes({ textoOriginal, oferta, ofertaEntrada, comercialNormalizado });
  const links = extrairLinksComerciais({ textoOriginal, oferta, ofertaEntrada, link });

  const podeComplementarPrecoDe = !textoOriginal || precosTexto.precoDeValor !== null;
  const precoDeValor = precosTexto.precoDeValor ?? (podeComplementarPrecoDe
    ? primeiroValor(ofertaEntrada.precoOriginal, ofertaEntrada.precoAntigo, oferta.precoOriginal, comercialNormalizado.precoAnterior)
    : null);
  const precoPorValor = precosTexto.precoPorValor ?? primeiroValor(ofertaEntrada.precoAtual, ofertaEntrada.preco, oferta.preco, comercialNormalizado.precoAtual);
  let precoFinalValor = precosTexto.precoFinalValor ?? primeiroValor(ofertaEntrada.precoComCupom, ofertaEntrada.precoCupom, comercialNormalizado.precoComCupom);
  let precoFinalTexto = precosTexto.precoFinalTexto || (precoFinalValor !== null ? textoMoeda(precoFinalValor) : "");
  if (precoFinalValor === null && precoPorValor !== null && (formaPagamentoTexto || cupom.cupomCodigo || instrucaoComercial)) {
    precoFinalValor = precoPorValor;
    precoFinalTexto = precosTexto.precoPorTexto || textoMoeda(precoPorValor);
  }

  const precoDeTexto = precosTexto.precoDeTexto || (precoDeValor !== null ? textoMoeda(precoDeValor) : "");
  const precoPorTexto = precosTexto.precoPorTexto || (precoPorValor !== null ? textoMoeda(precoPorValor) : "");
  const linkAfiliado = primeiroTexto(oferta.linkAfiliado, ofertaEntrada.linkAfiliado, oferta.linkFinal, link.link_afiliado);
  const marketplace = primeiroTexto(oferta.marketplace, ofertaEntrada.marketplace, job.marketplace, job.marketplace_detectado, comercialNormalizado.marketplace);

  const motivosConfianca = [];
  if (textoOriginal) motivosConfianca.push("texto_comercial_capturado");
  if (precosTexto.precoPorValor !== null || precosTexto.precoFinalValor !== null) motivosConfianca.push("preco_explicito_na_captura");
  if (cupom.cupomCodigo) motivosConfianca.push("cupom_explicito");
  if (formaPagamentoTexto) motivosConfianca.push("forma_pagamento_explicita");
  if (links.linkProdutoOriginal || linkAfiliado) motivosConfianca.push("link_produto_presente");
  if (comercialNormalizado.precoConfiavel === true && !motivosConfianca.includes("preco_explicito_na_captura")) motivosConfianca.push("preco_estruturado_complementar");

  const avisos = [];
  if (!textoOriginal) avisos.push("texto_original_indisponivel");
  if (!precoPorTexto && !precoFinalTexto) avisos.push("preco_comercial_indisponivel");
  if (!links.linkProdutoOriginal && !linkAfiliado) avisos.push("link_produto_indisponivel");
  if (comercialNormalizado.avisoPreco) avisos.push(comercialNormalizado.avisoPreco);

  const espelhoComercial = {
    tituloOriginal: tituloOriginal || null,
    tituloNormalizado: tituloOriginal ? limparTitulo(tituloOriginal) : null,
    textoOriginal: textoOriginal || null,
    textoComercialPreservado: textoOriginal || null,
    precoDeTexto: precoDeTexto || null,
    precoPorTexto: precoPorTexto || null,
    precoFinalTexto: precoFinalTexto || null,
    precoDeValor,
    precoPorValor,
    precoFinalValor,
    formaPagamentoTexto: formaPagamentoTexto || null,
    condicoesComerciais,
    cupomCodigo: cupom.cupomCodigo || null,
    cupomTexto: cupom.cupomTexto || null,
    instrucaoComercial: instrucaoComercial || null,
    linkProdutoOriginal: links.linkProdutoOriginal || null,
    linkResgateOriginal: links.linkResgateOriginal || null,
    linkAfiliado: linkAfiliado || null,
    marketplace: marketplace || null,
    origemComercial: textoOriginal ? "captura_comercial" : "campos_estruturados",
    confiavel: motivosConfianca.includes("preco_explicito_na_captura") || Boolean(cupom.cupomCodigo && (precoPorTexto || precoFinalTexto)),
    motivosConfianca,
    avisos: Array.from(new Set(avisos.filter(Boolean)))
  };

  const imagemComercial = selecionarImagemComercial({ oferta, ofertaEntrada, metadata, link });
  const documentoComercialCanonico = extrairDocumentoComercialCanonico({
    textoOriginal,
    tituloOriginal,
    precosTexto,
    cupom,
    instrucaoComercial,
    formaPagamentoTexto,
    condicoesComerciais,
    links,
    linkAfiliado,
    marketplace,
    imagemComercial,
    oferta,
    ofertaEntrada,
    comercialNormalizado,
    avisos: espelhoComercial.avisos,
    motivosConfianca
  });
  espelhoComercial.documentoComercialCanonico = documentoComercialCanonico;
  const templateEspelhoShadow = montarTemplateEspelhoShadow(espelhoComercial, documentoComercialCanonico);

  return {
    ok: true,
    modo: "shadow",
    aplicouMudancas: false,
    espelhoComercial,
    documentoComercialCanonico,
    imagemComercial,
    templateEspelhoShadow
  };
}

function construirEspelhoComercialV24FailOpen(entrada = {}) {
  try {
    return construirEspelhoComercialV24(entrada);
  } catch (erro) {
    return {
      ok: false,
      modo: "shadow",
      aplicouMudancas: false,
      espelhoComercial: null,
      documentoComercialCanonico: null,
      imagemComercial: null,
      templateEspelhoShadow: null,
      motivo: "espelho_comercial_exception",
      erro: String(erro?.message || "erro_desconhecido").slice(0, 180)
    };
  }
}

function resumoEspelhoComercialLog(resultado = {}, contexto = {}) {
  const espelho = objeto(resultado.espelhoComercial);
  const imagem = objeto(resultado.imagemComercial);
  return {
    workspaceId: contexto.workspaceId || "",
    marketplace: espelho.marketplace || contexto.marketplace || "",
    ofertaId: contexto.ofertaId || null,
    jobId: contexto.jobId || null,
    temPrecoDe: Boolean(espelho.precoDeValor || espelho.precoDeTexto),
    temPrecoPor: Boolean(espelho.precoPorValor || espelho.precoPorTexto),
    temPrecoFinal: Boolean(espelho.precoFinalValor || espelho.precoFinalTexto),
    temPix: normalizarComparacao(`${espelho.formaPagamentoTexto || ""} ${lista(espelho.condicoesComerciais).join(" ")}`).includes("pix"),
    temCupom: Boolean(espelho.cupomCodigo),
    temInstrucao: Boolean(espelho.instrucaoComercial),
    temLinkResgate: Boolean(espelho.linkResgateOriginal),
    imagemOrigem: imagem.origemSelecionada || "",
    imagemLimpa: imagem.imagemLimpa === true,
    confiavel: espelho.confiavel === true,
    avisos: lista(espelho.avisos).slice(0, 8),
    aplicouMudancasOperacionais: false
  };
}

module.exports = {
  construirEspelhoComercialV24,
  construirEspelhoComercialV24FailOpen,
  resumoEspelhoComercialLog,
  selecionarImagemComercial
};
