const {
  cortarTitulo,
  formatarPreco,
  normalizarPreco,
  montarLinhaCupom,
  montarLinhaParcelamento,
  montarLinhaDesconto,
  removerLinhasVazias,
  montarLinkCompra
} = require("./templates");
const { gerarTemplateUniversal } = require("../modules/template-universal");
const { resolverTemplateMensagem } = require("../modules/templates-clientes/resolver");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");
const fidelidadeObs = require("../modules/fidelidade/observabilidade-v1");
const { selecionarTemplateEspelhoPiloto } = require("../modules/ofc-v2/espelho-piloto");
const copyInteligente = require("../modules/copy-inteligente");

function normalizarTextoLocal(valor = "") {
  return String(valor || "").trim();
}

function textoMensagemExistenteLocal(valor = "") {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" || typeof valor === "function") return "";
  const texto = String(valor).trim();
  if (!texto || ["undefined", "null", "nan"].includes(texto.toLowerCase())) return "";
  return texto;
}

function normalizarTituloOfertaDestino(valor = "") {
  return String(valor || "").trim().toLowerCase() === "ia" ? "ia" : "original";
}

function tituloApresentacaoValido(valor = "") {
  return textoMensagemExistenteLocal(valor);
}

function primeiroTituloIaValido(oferta = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const candidatos = [
    oferta.tituloIa,
    oferta.tituloIA,
    oferta.tituloInteligente,
    oferta.copy?.tituloIa,
    oferta.copyInteligente?.tituloIa,
    metadata.tituloIa,
    metadata.tituloIA,
    metadata.tituloInteligente,
    metadata.copy?.tituloIa,
    metadata.copyInteligente?.tituloIa
  ];

  for (const candidato of candidatos) {
    const titulo = tituloApresentacaoValido(candidato);
    if (titulo) return titulo;
  }

  return "";
}

function tituloIaLiberadoRender(opcoes = {}) {
  return opcoes?.plano?.recursos?.tituloIa === true;
}

function fonteTituloApresentacaoLocal({ destino = {}, resultado = {}, tituloIaPreExistente = false } = {}) {
  if (normalizarTituloOfertaDestino(destino?.tituloOferta) !== "ia") return "original";
  if (!resultado || typeof resultado !== "object") return "original";
  if (resultado.fallbackOriginal) return "original";
  if (resultado.fonte === copyInteligente.FONTE_COPY_C3) return "copy_c3";
  if (resultado.fonte === copyInteligente.FONTE_COPY_LOCAL_V2) return "local_v2";
  if (resultado.fonte === "copy_inteligente_v1" || resultado.fonte === "banco_frases_v1") return "v1";
  if (resultado.usouTituloIa && tituloIaPreExistente) return "tituloIa_explicito";
  if (resultado.usouTituloIa) return "tituloIa_explicito";
  return "original";
}

function registrarObservabilidadeTituloOferta({
  oferta = {},
  destino = {},
  resultado = {},
  copyLocalV2Resolvida = null,
  copyC3Resolvida = null,
  copyResolvida = null,
  tituloIaPreExistente = false
} = {}) {
  try {
    const fonteTitulo = fonteTituloApresentacaoLocal({ destino, resultado, tituloIaPreExistente });
    const payload = {
      fonteTitulo,
      tituloIaPreExistente: Boolean(tituloIaPreExistente),
      categoriaRecebidaLocalV2: textoMensagemExistenteLocal(oferta.categoria || oferta.categoriaProduto || ""),
      cacheHit: resultado.cacheHit === true
    };

    if (fonteTitulo === "local_v2") {
      payload.fraseIdLocalV2 = textoMensagemExistenteLocal(copyLocalV2Resolvida?.fraseId || "");
      payload.familiaLocalV2 = textoMensagemExistenteLocal(copyLocalV2Resolvida?.familia || "");
      payload.intencaoLocalV2 = textoMensagemExistenteLocal(copyLocalV2Resolvida?.intencao || "");
      payload.cacheHit = copyLocalV2Resolvida?.cacheHit === true;
    }

    if (fonteTitulo === "copy_c3") {
      payload.fraseIdC3 = textoMensagemExistenteLocal(copyC3Resolvida?.fraseId || "");
      payload.fatoUsadoC3 = textoMensagemExistenteLocal(copyC3Resolvida?.fatoUsado || "");
      payload.familiaC3 = textoMensagemExistenteLocal(copyC3Resolvida?.familia || "");
      payload.intencaoC3 = textoMensagemExistenteLocal(copyC3Resolvida?.intencao || "");
      payload.confiancaC3 = textoMensagemExistenteLocal(copyC3Resolvida?.confianca || "");
      payload.cacheHit = false;
    }

    if (fonteTitulo === "v1") {
      payload.cacheHit = copyResolvida?.cacheHit === true;
    }

    console.log("[TITULO-APRESENTACAO-OBS]", JSON.stringify(payload));
  } catch (_) {
    // Observabilidade de titulo nunca pode interferir no envio.
  }
}

function resolverTituloApresentacaoOferta(oferta = {}, destino = {}, opcoes = {}) {
  const original = tituloApresentacaoValido(oferta.titulo) ||
    tituloApresentacaoValido(oferta.nome) ||
    "Oferta";
  const tituloIaPreExistente = Boolean(primeiroTituloIaValido(oferta));

  if (normalizarTituloOfertaDestino(destino?.tituloOferta) !== "ia") {
    const resultado = {
      titulo: original,
      modo: "original",
      usouTituloIa: false,
      fallbackOriginal: false
    };
    registrarObservabilidadeTituloOferta({
      oferta,
      destino,
      resultado,
      tituloIaPreExistente
    });
    return resultado;
  }

  if (!tituloIaLiberadoRender(opcoes)) {
    const resultado = {
      titulo: original,
      modo: "ia",
      usouTituloIa: false,
      fallbackOriginal: true,
      motivo: "feature_tituloIa_indisponivel"
    };
    registrarObservabilidadeTituloOferta({
      oferta,
      destino,
      resultado,
      tituloIaPreExistente
    });
    return resultado;
  }

  const tituloIa = primeiroTituloIaValido(oferta);
  if (tituloIa) {
    const resultado = {
      titulo: tituloIa,
      modo: "ia",
      usouTituloIa: true,
      fallbackOriginal: false
    };
    registrarObservabilidadeTituloOferta({
      oferta,
      destino,
      resultado,
      tituloIaPreExistente
    });
    return resultado;
  }

  let copyC3Resolvida = null;
  try {
    copyC3Resolvida = copyInteligente.resolverCopyC3({
      oferta,
      destino,
      clienteId: opcoes.clienteId || oferta.clienteId || "admin",
      plano: opcoes.plano || {}
    });
  } catch (err) {
    copyC3Resolvida = {
      ok: false,
      motivoFallback: "copy_c3_erro"
    };
  }
  if (copyC3Resolvida?.ok && tituloApresentacaoValido(copyC3Resolvida.ganchoComercialC3 || copyC3Resolvida.tituloIa)) {
    const resultado = {
      titulo: copyC3Resolvida.ganchoComercialC3 || copyC3Resolvida.tituloIa,
      modo: "ia",
      usouTituloIa: true,
      fallbackOriginal: false,
      intencao: copyC3Resolvida.intencao || "",
      fraseId: copyC3Resolvida.fraseId || "",
      familia: copyC3Resolvida.familia || "",
      categoriaOficial: copyC3Resolvida.categoriaOficial || "",
      fatoUsado: copyC3Resolvida.fatoUsado || "",
      confianca: copyC3Resolvida.confianca || "",
      fonte: copyC3Resolvida.fonte || copyInteligente.FONTE_COPY_C3,
      cacheHit: false
    };
    registrarObservabilidadeTituloOferta({
      oferta,
      destino,
      resultado,
      copyC3Resolvida,
      tituloIaPreExistente
    });
    return resultado;
  }

  let copyLocalV2Resolvida = null;
  try {
    copyLocalV2Resolvida = copyInteligente.resolverCopyLocalV2({
      oferta,
      destino,
      clienteId: opcoes.clienteId || oferta.clienteId || "admin",
      plano: opcoes.plano || {}
    });
  } catch (err) {
    copyLocalV2Resolvida = {
      ok: false,
      motivoFallback: "copy_local_v2_erro"
    };
  }
  if (copyLocalV2Resolvida?.ok && tituloApresentacaoValido(copyLocalV2Resolvida.tituloIa)) {
    const resultado = {
      titulo: copyLocalV2Resolvida.tituloIa,
      modo: "ia",
      usouTituloIa: true,
      fallbackOriginal: false,
      intencao: copyLocalV2Resolvida.intencao || "",
      fraseId: copyLocalV2Resolvida.fraseId || "",
      familia: copyLocalV2Resolvida.familia || "",
      categoriaOficial: copyLocalV2Resolvida.categoriaOficial || "",
      subcontexto: copyLocalV2Resolvida.subcontexto || "",
      fonte: copyLocalV2Resolvida.fonte || "banco_associativo_local_v2",
      cacheHit: copyLocalV2Resolvida.cacheHit === true
    };
    registrarObservabilidadeTituloOferta({
      oferta,
      destino,
      resultado,
      copyLocalV2Resolvida,
      tituloIaPreExistente
    });
    return resultado;
  }

  let copyResolvida = null;
  try {
    copyResolvida = copyInteligente.resolverCopyInteligente({
      oferta,
      destino,
      clienteId: opcoes.clienteId || oferta.clienteId || "admin",
      plano: opcoes.plano || {}
    });
  } catch (err) {
    copyResolvida = {
      ok: false,
      motivoFallback: "copy_inteligente_erro"
    };
  }
  if (copyResolvida?.ok && tituloApresentacaoValido(copyResolvida.tituloIa)) {
    const resultado = {
      titulo: copyResolvida.tituloIa,
      modo: "ia",
      usouTituloIa: true,
      fallbackOriginal: false,
      intencao: copyResolvida.intencao || "",
      fonte: copyResolvida.fonte || "copy_inteligente_v1",
      cacheHit: copyResolvida.cacheHit === true
    };
    registrarObservabilidadeTituloOferta({
      oferta,
      destino,
      resultado,
      copyResolvida,
      tituloIaPreExistente
    });
    return resultado;
  }

  const resultado = {
    titulo: original,
    modo: "ia",
    usouTituloIa: false,
    fallbackOriginal: true,
    motivo: copyResolvida?.motivoFallback || copyLocalV2Resolvida?.motivoFallback || "titulo_ia_indisponivel"
  };
  registrarObservabilidadeTituloOferta({
    oferta,
    destino,
    resultado,
    copyLocalV2Resolvida,
    copyResolvida,
    tituloIaPreExistente
  });
  return resultado;
}

function resolverMensagemExistente(oferta = {}, opcoes = {}, ofertaOficial = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const metadataOficial = ofertaOficial.metadata && typeof ofertaOficial.metadata === "object" ? ofertaOficial.metadata : {};
  const radarMirror = metadata.radarMirror && typeof metadata.radarMirror === "object" ? metadata.radarMirror : {};
  const radarMirrorOficial = metadataOficial.radarMirror && typeof metadataOficial.radarMirror === "object" ? metadataOficial.radarMirror : {};
  const candidatos = [
    opcoes.mensagemAtual,
    opcoes.mensagemExistente,
    opcoes.mensagemOriginal,
    opcoes.textoOriginal,
    oferta.mensagemRenderizada,
    oferta.mensagemFinal,
    oferta.mensagem,
    oferta.legenda,
    oferta.texto,
    oferta.textoOriginal,
    oferta.mensagemOriginalRadar,
    oferta.textoComercialOriginal,
    metadata.mensagemOriginalRadar,
    metadata.textoOriginal,
    radarMirror.texto?.original,
    radarMirror.evento?.texto_original,
    ofertaOficial.mensagemRenderizada,
    ofertaOficial.mensagemFinal,
    ofertaOficial.mensagem,
    ofertaOficial.legenda,
    ofertaOficial.texto,
    ofertaOficial.textoOriginal,
    ofertaOficial.mensagemOriginalRadar,
    ofertaOficial.textoComercialOriginal,
    metadataOficial.mensagemOriginalRadar,
    metadataOficial.textoOriginal,
    radarMirrorOficial.texto?.original,
    radarMirrorOficial.evento?.texto_original
  ];

  for (const candidato of candidatos) {
    const mensagem = textoMensagemExistenteLocal(candidato);
    if (mensagem) return mensagem;
  }

  return "Oferta recebida. Renderizacao oficial indisponivel no momento.";
}

function normalizarComparacaoLocal(valor = "") {
  return normalizarTextoLocal(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^cupom\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function instrucaoCupomRedundanteLocal(instrucao = "", cupom = "") {
  const textoInstrucao = normalizarComparacaoLocal(instrucao);
  const textoCupom = normalizarComparacaoLocal(cupom);
  return Boolean(textoInstrucao && textoCupom && textoInstrucao === textoCupom);
}

function templateUniversalOficialAtivo() {
  return true;
}

function rioOficialAtivo(oferta = {}, opcoes = {}) {
  const arquitetura = opcoes.arquiteturaComercial && typeof opcoes.arquiteturaComercial === "object"
    ? opcoes.arquiteturaComercial
    : {};
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  const arquiteturaOferta = metadata.arquiteturaComercial && typeof metadata.arquiteturaComercial === "object"
    ? metadata.arquiteturaComercial
    : {};

  return opcoes.rioOficialAtivo !== false &&
    arquitetura.rioOficial !== false &&
    arquiteturaOferta.rioOficial !== false &&
    oferta.rioOficial !== false;
}

function scoreUniversal(valor) {
  if (valor && typeof valor === "object") {
    return valor.score ?? valor.valor ?? valor.total ?? null;
  }

  return valor ?? null;
}

function beneficiosUniversais(oferta = {}, v2 = {}) {
  const logs = Array.isArray(v2.logs) ? v2.logs : [];
  const beneficios = [];

  if (Array.isArray(oferta.beneficios)) beneficios.push(...oferta.beneficios);
  if (Array.isArray(v2.beneficios)) beneficios.push(...v2.beneficios);
  if (oferta.beneficioTexto) beneficios.push(oferta.beneficioTexto);
  if (oferta.avisoCupom) beneficios.push(oferta.avisoCupom);
  if (oferta.aviso) beneficios.push(oferta.aviso);

  logs.forEach(item => {
    if (typeof item === "string") beneficios.push(item);
    else if (item?.mensagem) beneficios.push(item.mensagem);
    else if (item?.motivo) beneficios.push(item.motivo);
  });

  return [...new Set(beneficios.map(normalizarTextoLocal).filter(Boolean))].slice(0, 5);
}

function objetoLocal(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function primeiroValorLocal(...valores) {
  for (const valor of valores) {
    if (valor === null || valor === undefined) continue;
    if (typeof valor === "string" && !valor.trim()) continue;
    return valor;
  }
  return "";
}

function metadataOfcV24Local(oferta = {}) {
  const metadata = objetoLocal(oferta.metadata);
  return objetoLocal(metadata.ofcV24 || oferta.ofcV24);
}

function documentoOfcV24Local(oferta = {}) {
  const ofcV24 = metadataOfcV24Local(oferta);
  const espelho = objetoLocal(ofcV24.espelhoComercial || oferta.espelhoComercialV24);
  return objetoLocal(
    ofcV24.documentoComercialCanonico ||
    espelho.documentoComercialCanonico ||
    oferta.documentoComercialCanonicoV24
  );
}

function blocosOfcV24Local(documento = {}) {
  return Array.isArray(documento.blocos) ? documento.blocos : [];
}

function blocoOfcV24Local(documento = {}, ...tipos) {
  const alvos = new Set(tipos.map(normalizarTextoLocal));
  return blocosOfcV24Local(documento).find(bloco => alvos.has(normalizarTextoLocal(bloco?.tipo))) || {};
}

function textoBlocoOfcV24Local(documento = {}, ...tipos) {
  const bloco = blocoOfcV24Local(documento, ...tipos);
  return normalizarTextoLocal(bloco.textoOriginal || bloco.valor || "");
}

const LIMITE_TITULO_PRODUTO_PRESERVADO = 96;
const LIMITE_TITULO_PRODUTO_APRESENTACAO = 72;

function tituloIaCandidatosLocal(oferta = {}) {
  const metadata = oferta.metadata && typeof oferta.metadata === "object" ? oferta.metadata : {};
  return [
    oferta.tituloIa,
    oferta.tituloIA,
    oferta.tituloInteligente,
    oferta.copy?.tituloIa,
    oferta.copyInteligente?.tituloIa,
    metadata.tituloIa,
    metadata.tituloIA,
    metadata.tituloInteligente,
    metadata.copy?.tituloIa,
    metadata.copyInteligente?.tituloIa
  ].map(tituloApresentacaoValido).filter(Boolean);
}

function removerUrlsTituloProdutoLocal(valor = "") {
  return normalizarTextoLocal(valor)
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limparMarcadoresTituloProdutoLocal(valor = "") {
  return removerUrlsTituloProdutoLocal(valor)
    .replace(/^[\s\-*>#.:;!]+/, "")
    .replace(/^(?:an[uú]ncio|#\s*an[uú]ncio|oferta)\b\s*:?\s*/i, "")
    .replace(/^[()\[\]{}\s\-*>#.:;!]+/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function linhaComercialNaoFactualLocal(linha = "") {
  const texto = normalizarTextoLocal(linha);
  const n = normalizarComparacaoLocal(texto);
  if (!texto || !n) return true;
  if (/https?:\/\//i.test(texto)) return true;
  if (/(?:R\$|US\$|\$|€|£)\s*\d|\b\d+[,.]\d{2}\b/i.test(texto)) return true;
  if (/^(?:de|por|pre[cç]o|valor|cupom|c[oó]digo|resgate|link|confira|categoria|marketplace|loja)\b/.test(n)) return true;
  if (/\b(?:cupom|resgate|frete gratis|frete gr[aá]tis|economia|cashback|parcelamento)\b/.test(n) && n.split(/\s+/).length <= 8) return true;
  return false;
}

function extrairTituloFactualDeTextoLocal(valor = "") {
  const linhas = normalizarTextoLocal(valor)
    .split(/\r?\n+/)
    .map(limparMarcadoresTituloProdutoLocal)
    .filter(Boolean);

  for (const linha of linhas) {
    if (!linhaComercialNaoFactualLocal(linha)) return linha;
  }

  const unico = limparMarcadoresTituloProdutoLocal(valor);
  return linhaComercialNaoFactualLocal(unico) ? "" : unico;
}

function tituloIgualTituloIaLocal(titulo = "", oferta = {}) {
  const alvo = normalizarComparacaoLocal(titulo);
  if (!alvo) return false;
  return tituloIaCandidatosLocal(oferta).some(item => normalizarComparacaoLocal(item) === alvo);
}

function candidatosTituloProdutoLocal(oferta = {}) {
  const metadata = objetoLocal(oferta.metadata);
  const autoridadeFactual = objetoLocal(metadata.autoridadeFactual || oferta.autoridadeFactual);
  const produtoMetadata = objetoLocal(metadata.produto || oferta.produto);
  const radarMirror = objetoLocal(metadata.radarMirror || metadata.radarEspelhoComercial || oferta.radarMirror || oferta.radarEspelhoComercial);
  const documento = documentoOfcV24Local(oferta);
  const documentoDireto = objetoLocal(oferta.documentoComercialCanonico);
  const v2 = objetoLocal(oferta.inteligenciaUniversalV2);
  const candidatos = [];
  const adicionarTexto = (fonte, valor) => {
    const texto = textoMensagemExistenteLocal(valor);
    const titulo = texto ? extrairTituloFactualDeTextoLocal(texto) : "";
    if (titulo) candidatos.push({ fonte, titulo });
  };
  const adicionarCampo = (fonte, valor) => {
    const texto = textoMensagemExistenteLocal(valor);
    const titulo = texto ? limparMarcadoresTituloProdutoLocal(texto) : "";
    if (titulo) candidatos.push({ fonte, titulo });
  };

  adicionarCampo("tituloFactual", oferta.tituloFactual);
  adicionarCampo("autoridadeFactual.titulo", autoridadeFactual.tituloFactual || autoridadeFactual.titulo);
  adicionarCampo("metadata.produto.titulo", produtoMetadata.titulo || produtoMetadata.nome || produtoMetadata.name);
  adicionarTexto("textoOriginal", oferta.textoOriginal || metadata.textoOriginal || radarMirror.texto?.original || radarMirror.textoOriginal);
  adicionarTexto("textoComercialOriginal", oferta.textoComercialOriginal || metadata.textoComercialOriginal || radarMirror.textoComercialOriginal);
  adicionarTexto("documentoComercialCanonico", oferta.documentoComercialCanonico || metadata.documentoComercialCanonico || radarMirror.documentoComercialCanonico);
  adicionarCampo("titulo", oferta.titulo);
  adicionarCampo("nome", oferta.nome);
  adicionarCampo("documento.tituloOriginal", documento.tituloOriginal || documentoDireto.tituloOriginal);
  adicionarCampo("documento.bloco_titulo", textoBlocoOfcV24Local(documento, "titulo"));
  adicionarCampo("inteligencia.titulo", v2.titulo || v2.tituloOriginal || v2.tituloNormalizado);
  adicionarCampo("tituloOriginal", oferta.tituloOriginal);

  return candidatos;
}

function tokensCriticosTituloProdutoLocal(valor = "") {
  const semCompatibilidade = normalizarTextoLocal(valor).replace(/\bcompat[ií]vel\s+com\b[\s\S]*$/i, "");
  const matches = semCompatibilidade.match(/\b(?:[A-Z]{1,6}\d{2,}[A-Z0-9-]*|\d+\s*(?:gb|tb|mb|mah|w|kw|v|hz|mhz|ghz|mm|cm|m|ml|l|kg|g|un|und|pcs|pe[cç]as)|usb-c|tipo\s+c|5g|4g)\b/gi);
  return [...new Set((matches || []).map(item => normalizarComparacaoLocal(item).replace(/\s+/g, "")))];
}

function preservaTokensCriticosTituloLocal(original = "", candidato = "") {
  const base = normalizarComparacaoLocal(candidato).replace(/\s+/g, "");
  return tokensCriticosTituloProdutoLocal(original).every(token => base.includes(token));
}

function compactarTituloProdutoLocal(titulo = "") {
  const original = limparMarcadoresTituloProdutoLocal(titulo);
  if (!original) return { titulo: "", limpo: false, modo: "fallback" };
  if (original.length <= LIMITE_TITULO_PRODUTO_PRESERVADO) {
    return { titulo: original, limpo: false, modo: "preservado" };
  }

  let candidato = original
    .replace(/\s*(?:\||-)\s*(?:Mercado Livre|Amazon|Shopee|AliExpress|KaBuM!?|Kabum BR|BR Kabum|promo[cç][aã]o|oferta)\s*$/i, "")
    .replace(/\bcompat[ií]vel\s+com\b[\s\S]*$/i, "")
    .replace(/\s+(?:com\s+)?(?:cupom|desconto|frete\s+gr[aá]tis)\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (candidato.length > LIMITE_TITULO_PRODUTO_APRESENTACAO) {
    const palavras = candidato.split(/\s+/);
    const selecionadas = [];
    for (const palavra of palavras) {
      const proximo = [...selecionadas, palavra].join(" ");
      if (proximo.length > LIMITE_TITULO_PRODUTO_APRESENTACAO) break;
      selecionadas.push(palavra);
    }
    candidato = selecionadas.join(" ").trim();
  }

  if (candidato.length < 12 || !preservaTokensCriticosTituloLocal(original, candidato)) {
    return { titulo: original, limpo: false, modo: "fallback" };
  }

  return {
    titulo: candidato || original,
    limpo: candidato !== original,
    modo: candidato !== original ? "limpo" : "preservado"
  };
}

function resolverTituloProdutoApresentacao(oferta = {}) {
  for (const candidato of candidatosTituloProdutoLocal(oferta)) {
    if (tituloIgualTituloIaLocal(candidato.titulo, oferta)) continue;
    const resolvido = compactarTituloProdutoLocal(candidato.titulo);
    if (resolvido.titulo) {
      return {
        titulo: resolvido.titulo,
        fonteTituloProduto: candidato.fonte,
        tituloProdutoLimpo: resolvido.limpo === true,
        modoTituloProduto: resolvido.modo
      };
    }
  }

  return {
    titulo: "Oferta",
    fonteTituloProduto: "fallback_factual",
    tituloProdutoLimpo: false,
    modoTituloProduto: "fallback"
  };
}

function resolverEmojiSemanticoTitulo(oferta = {}, contexto = {}) {
  const titulo = normalizarComparacaoLocal(contexto.tituloProduto || oferta.titulo || oferta.nome || "");
  const categoria = normalizarComparacaoLocal(oferta.inteligenciaUniversalV2?.categoria || oferta.categoria || oferta.categoriaProduto || "");
  const subcontexto = normalizarComparacaoLocal(contexto.subcontexto || contexto.subcontextoGancho || "");
  let familia = textoMensagemExistenteLocal(contexto.familia || contexto.familiaGancho || contexto.familiaLocalV2 || "");
  try {
    familia = familia || copyInteligente.resolverFamiliaOfertaCopyLocalV2?.(oferta)?.familia || "";
  } catch (_) {
    familia = "";
  }
  const base = `${categoria} ${titulo}`;
  const escolher = (emoji, origem) => ({ emoji, origem });

  if (familia === "calcados") return escolher("👟", "subcontexto_calcados");
  if (["casa", "casa_eletro", "cozinha_pratica"].includes(familia) &&
    (subcontexto === "cozinha" || /\b(?:cozinha|panela|air fryer|fogao|forno|cooktop)\b/.test(base))) {
    return escolher("🍳", "subcontexto_cozinha");
  }
  if (familia === "bebidas" && /\b(?:cerveja|chopp)\b/.test(base)) return escolher("🍺", "subcontexto_cerveja");
  if (familia === "pesca_camping" && (subcontexto === "camping" || /\b(?:camping|barraca|trilha)\b/.test(base))) {
    return escolher("🏕️", "subcontexto_camping");
  }
  if (familia === "pesca_camping" && (subcontexto === "pesca" || /\b(?:pesca|vara de pesca|molinete|carretilha)\b/.test(base))) {
    return escolher("🎣", "subcontexto_pesca");
  }

  const porFamilia = {
    celulares: "📱",
    computadores: "💻",
    gamer: "🎮",
    games: "🎮",
    perifericos: "🖥️",
    casa: "🏠",
    casa_eletro: "🏠",
    ferramentas: "🔧",
    automotivo: "🚗",
    bebe: "🍼",
    infantil: "🧸",
    brinquedos: "🧸",
    pet: "🐾",
    beleza: "💄",
    mercado: "🛒",
    climatizacao: "❄️",
    iluminacao: "💡",
    audio_tv: "🎧",
    eletronicos: "⚡"
  };
  if (familia === "moda") {
    if (/\bfeminina\b/.test(categoria)) return escolher("👗", "familia_moda_feminina");
    if (/\bmasculina\b/.test(categoria)) return escolher("👕", "familia_moda_masculina");
    return escolher("✨", "familia_moda_neutra");
  }
  if (familia === "bebidas") return escolher("✨", "familia_bebidas_neutra");
  if (porFamilia[familia]) return escolher(porFamilia[familia], `familia_${familia}`);
  return escolher("🔥", "fallback_universal");
}

function resolverGanchoCopyLocalApresentacao(tituloApresentacao = {}, fonteGancho = "") {
  if (!tituloApresentacao?.usouTituloIa || tituloApresentacao?.fallbackOriginal) {
    return {
      gancho: "",
      fonteGancho: "indisponivel",
      fraseIdGancho: "",
      familiaGancho: "",
      intencaoGancho: ""
    };
  }

  return {
    gancho: tituloApresentacaoValido(tituloApresentacao.titulo),
    fonteGancho: fonteGancho || tituloApresentacao.fonte || "tituloIa_explicito",
    fraseIdGancho: textoMensagemExistenteLocal(tituloApresentacao.fraseId || ""),
    familiaGancho: textoMensagemExistenteLocal(tituloApresentacao.familia || ""),
    intencaoGancho: textoMensagemExistenteLocal(tituloApresentacao.intencao || "")
  };
}

function camposTituloProdutoGanchoLocal(oferta = {}) {
  return {
    tituloProdutoApresentacaoAtivo: oferta.tituloProdutoApresentacaoAtivo === true,
    tituloProdutoApresentacao: textoMensagemExistenteLocal(oferta.tituloProdutoApresentacao || ""),
    fonteTituloProduto: textoMensagemExistenteLocal(oferta.fonteTituloProduto || ""),
    tituloProdutoLimpo: oferta.tituloProdutoLimpo === true,
    modoTituloProduto: textoMensagemExistenteLocal(oferta.modoTituloProduto || ""),
    ganchoCopyLocal: textoMensagemExistenteLocal(oferta.ganchoCopyLocal || ""),
    fonteGancho: textoMensagemExistenteLocal(oferta.fonteGancho || ""),
    fraseIdGancho: textoMensagemExistenteLocal(oferta.fraseIdGancho || ""),
    familiaGancho: textoMensagemExistenteLocal(oferta.familiaGancho || ""),
    intencaoGancho: textoMensagemExistenteLocal(oferta.intencaoGancho || ""),
    emojiTituloProduto: textoMensagemExistenteLocal(oferta.emojiTituloProduto || ""),
    emojiSemanticoOrigem: textoMensagemExistenteLocal(oferta.emojiSemanticoOrigem || ""),
    emojiGanchoCopyLocal: textoMensagemExistenteLocal(oferta.emojiGanchoCopyLocal || "")
  };
}

function urlBlocoOfcV24Local(documento = {}, ...tipos) {
  const bloco = blocoOfcV24Local(documento, ...tipos);
  return normalizarTextoLocal(bloco.valorEstruturado?.url || bloco.url || bloco.textoOriginal || "");
}

function linkOfcV24Local(tipo = "produto", url = "", ordemCaptura = 1, origem = "ofc_v24") {
  const valor = normalizarTextoLocal(url);
  if (!valor) return null;
  return {
    tipo,
    papel: `link_${tipo}`,
    ordemCaptura,
    original: valor,
    resolvido: "",
    afiliado: valor,
    urlOptimus: valor,
    origem
  };
}

function linksOfcV24ParaApresentacao(oferta = {}) {
  const ofcV24 = metadataOfcV24Local(oferta);
  const espelho = objetoLocal(ofcV24.espelhoComercial || oferta.espelhoComercialV24);
  const documento = documentoOfcV24Local(oferta);
  const temOcorrenciasRadar = Array.isArray(oferta.linksComerciais) && oferta.linksComerciais.length > 0;
  if (temOcorrenciasRadar) return [];
  const candidatos = [
    linkOfcV24Local("produto", primeiroValorLocal(documento.linkAfiliado, espelho.linkAfiliado), 1, "ofc_v24.linkAfiliado"),
    linkOfcV24Local("resgate", primeiroValorLocal(documento.linkResgateOriginal, espelho.linkResgateOriginal, urlBlocoOfcV24Local(documento, "link_resgate")), 3, "ofc_v24.linkResgate"),
    linkOfcV24Local("app", urlBlocoOfcV24Local(documento, "link_app"), 4, "ofc_v24.linkApp"),
    linkOfcV24Local("moedas", urlBlocoOfcV24Local(documento, "link_moedas"), 5, "ofc_v24.linkMoedas"),
    linkOfcV24Local("pc", urlBlocoOfcV24Local(documento, "link_pc"), 6, "ofc_v24.linkPc")
  ].filter(Boolean);

  return candidatos;
}

function aplicarFatosOfcV24ComoEntrada(oferta = {}) {
  const ofcV24 = metadataOfcV24Local(oferta);
  const espelho = objetoLocal(ofcV24.espelhoComercial || oferta.espelhoComercialV24);
  const documento = documentoOfcV24Local(oferta);
  const temOfc = Boolean(Object.keys(ofcV24).length || Object.keys(espelho).length || Object.keys(documento).length);
  if (!temOfc) return oferta;

  return {
    ...oferta,
    titulo: primeiroValorLocal(oferta.titulo, oferta.nome, documento.tituloOriginal, textoBlocoOfcV24Local(documento, "titulo")),
    nome: primeiroValorLocal(oferta.nome, oferta.titulo, documento.tituloOriginal, textoBlocoOfcV24Local(documento, "titulo")),
    marketplace: primeiroValorLocal(oferta.marketplace, documento.marketplace, espelho.marketplace, textoBlocoOfcV24Local(documento, "marketplace")),
    categoria: primeiroValorLocal(oferta.categoria, documento.categoria, espelho.categoria, textoBlocoOfcV24Local(documento, "categoria")),
    avaliacao: primeiroValorLocal(oferta.avaliacao, oferta.rating, oferta.nota, textoBlocoOfcV24Local(documento, "avaliacao_nota")),
    origemApresentacao: primeiroValorLocal(oferta.origemApresentacao, "ofc_v24_espelho_piloto"),
    metadata: {
      ...objetoLocal(oferta.metadata),
      ofcV24
    }
  };
}

function montarEntradaTemplateUniversalOficial(oferta = {}) {
  return {
    ...prepararDadosOficiaisTemplate(oferta, { modo: "universal" }),
    ...camposTituloProdutoGanchoLocal(oferta)
  };
}

function montarOfertaRenderizacaoOficial(oferta = {}) {
  const dadosUniversal = prepararDadosOficiaisTemplate(oferta, { modo: "universal" });
  const dadosPersonalizado = prepararDadosOficiaisTemplate(oferta, { modo: "personalizado" });
  const precoAtual = dadosUniversal.precoAtual ?? dadosPersonalizado.precoAtual ?? oferta.precoAtual ?? oferta.preco;
  const precoOriginal = dadosUniversal.precoOriginal ?? dadosPersonalizado.precoOriginal ?? oferta.precoOriginal ?? oferta.precoAntigo;
  const linkAfiliado = dadosUniversal.linkAfiliado || dadosPersonalizado.linkAfiliado || oferta.linkAfiliado || oferta.linkFinal || oferta.link || "";
  const cupom = dadosUniversal.cupom || dadosPersonalizado.cupom || oferta.cupom || "";

  return {
    ...oferta,
    ...dadosPersonalizado,
    ...dadosUniversal,
    precoAtual,
    preco: precoAtual,
    precoPor: precoAtual,
    precoOriginal,
    precoAntigo: precoOriginal,
    precoDe: precoOriginal,
    cupom,
    cupomTexto: dadosUniversal.cupomTexto || dadosPersonalizado.cupomTexto || cupom,
    codigoCupom: dadosUniversal.codigoCupom || dadosPersonalizado.codigoCupom || cupom,
    codigosCupom: Array.isArray(dadosUniversal.codigosCupom) ? dadosUniversal.codigosCupom : [],
    cupons: Array.isArray(dadosUniversal.cupons) ? dadosUniversal.cupons : [],
    linkAfiliado,
    linkFinal: oferta.linkFinal || linkAfiliado,
    link: oferta.link || linkAfiliado,
    fonteDadosMensagem: "dados_oficiais_template",
    ...camposTituloProdutoGanchoLocal(oferta)
  };
}

function tentarTemplateUniversalOficial(oferta = {}, opcoes = {}) {
  const clienteId = opcoes.clienteId || oferta.clienteId || "admin";

  if (!templateUniversalOficialAtivo()) return "";

  const resumo = {
    clienteId,
    marketplace: oferta.marketplace || "",
    titulo: cortarTitulo(oferta.titulo || oferta.nome || "", 80)
  };

  try {
    const entradaUniversal = opcoes.dadosOficiaisUniversal || montarEntradaTemplateUniversalOficial(oferta);
    console.log("[TEMPLATE-UNIVERSAL-OFICIAL]", JSON.stringify({
      ...resumo,
      score: entradaUniversal.score ?? "",
      prioridade: entradaUniversal.prioridade ?? ""
    }));

    const texto = gerarTemplateUniversal(entradaUniversal);
    if (!texto) throw new Error("template_universal_vazio");

    console.log("[TEMPLATE-UNIVERSAL-OFICIAL-ENVIADO]", JSON.stringify({
      ...resumo,
      categoria: entradaUniversal.categoria || "",
      precoAtual: entradaUniversal.precoAtual ?? "",
      precoAntigo: entradaUniversal.precoOriginal ?? "",
      economia: entradaUniversal.economia ?? "",
      cupom: entradaUniversal.cupom || "",
      avaliacao: entradaUniversal.avaliacao ?? "",
      origem: opcoes.origem || oferta.origem || "",
      templateVersao: "v2-universal-oficial",
      tamanhoTexto: texto.length,
      temCupom: Boolean(entradaUniversal.cupom),
      temLinkAfiliado: Boolean(entradaUniversal.linkAfiliado)
    }));

    return texto;
  } catch (e) {
    console.log("[TEMPLATE-UNIVERSAL-FALLBACK-V1]", JSON.stringify({
      ...resumo,
      erro: e.message
    }));
    return "";
  }
}

function precoTemVariacao(valor = "") {
  return /\d[\d.,]*\s+a\s+\d[\d.,]*/i.test(String(valor || ""));
}

function formatarFaixaPreco(valor = "") {
  const texto = String(valor || "").replace(/\s+/g, " ").trim();
  const partes = texto.split(/\s+a\s+/i).map(formatarPreco).filter(Boolean);

  if (partes.length >= 2) {
    return `${partes[0]} a ${partes[1]}`;
  }

  return formatarPreco(texto);
}

function montarLinhaAplicarCupom(oferta = {}) {
  const cupom = String(oferta.cupom || "").trim();

  return cupom ? `\uD83C\uDFAB Aplique o cupom ${cupom} no carrinho.` : "";
}

function montarBlocoPreco({ precoAtual = "", precoAntigo = "", variacao = false } = {}) {
  return [
    precoAntigo ? `\u274C De: ${precoAntigo}` : "",
    variacao ? `\u2705 Pre\u00E7o com varia\u00E7\u00E3o: ${precoAtual}` : precoAtual ? `\u2705 Por: ${precoAtual}` : ""
  ].filter(Boolean).join("\n");
}

function montarLegendaOferta(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoAtual = formatarPreco(oferta.precoAtual || oferta.preco);
  const precoAntigo = formatarPreco(oferta.precoOriginal ?? oferta.precoAntigo);
  const desconto = montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const aplicarCupom = montarLinhaAplicarCupom(oferta);
  const instrucaoCupom = normalizarTextoLocal(oferta.instrucaoCupom || oferta.condicaoCupom || oferta.condicaoComercial);
  const condicaoPix = normalizarTextoLocal(oferta.condicaoPix || oferta.precoPix);
  const precoUnitario = normalizarTextoLocal(oferta.precoUnitario || oferta.unitarioCapturado);
  const blocoPreco = montarBlocoPreco({ precoAtual, precoAntigo });

  return removerLinhasVazias([
    `\uD83D\uDD25 ${titulo}`,
    blocoPreco,
    condicaoPix ? `\u26A1 ${condicaoPix}` : "",
    precoUnitario ? `\u2139\uFE0F Pre\u00E7o unit\u00E1rio: ${precoUnitario}` : "",
    desconto ? `\uD83D\uDD25 ${desconto}` : "",
    parcelamento,
    cupom,
    instrucaoCupom && !instrucaoCupomRedundanteLocal(instrucaoCupom, oferta.cupom) ? `\u26A1 ${instrucaoCupom}` : "",
    montarLinkCompra(oferta),
    aplicarCupom && !instrucaoCupom ? aplicarCupom : ""
  ]);
}


function montarPrecoVariacaoShopee(oferta = {}) {
  const aviso = String(oferta.avisoVariacaoPreco || "").trim();
  if (aviso) return aviso;

  const precoMin = formatarPreco(oferta.precoMin || oferta.precoAtual || oferta.preco);
  const precoMax = formatarPreco(oferta.precoMax);

  if (precoMin && precoMax && precoMin !== precoMax) {
    return `${precoMin} a ${precoMax}`;
  }

  return precoMin || formatarPreco(oferta.precoAtual || oferta.preco);
}
function montarLegendaShopee(oferta = {}) {
  const titulo = cortarTitulo(oferta.titulo || oferta.nome || "Oferta", 120);
  const precoBruto = oferta.precoAtual || oferta.preco;
  const temVariacaoAuxiliar = oferta.temVariacaoPreco === true;
  const temVariacao = temVariacaoAuxiliar || precoTemVariacao(precoBruto);
  const precoAtual = temVariacaoAuxiliar
    ? montarPrecoVariacaoShopee(oferta)
    : temVariacao
      ? formatarFaixaPreco(precoBruto)
      : formatarPreco(precoBruto);
  const precoAntigo = temVariacao ? "" : formatarPreco(oferta.precoAntigo);
  const desconto = temVariacao ? "" : montarLinhaDesconto(oferta);
  const parcelamento = montarLinhaParcelamento(oferta);
  const cupom = montarLinhaCupom(oferta);
  const aplicarCupom = montarLinhaAplicarCupom(oferta);
  const blocoPreco = temVariacaoAuxiliar
    ? (precoAtual ? `✅ ${precoAtual}` : "")
    : montarBlocoPreco({
        precoAtual,
        precoAntigo,
        variacao: temVariacao
      });

  return removerLinhasVazias([
    `\uD83D\uDD25 ${titulo}`,
    blocoPreco,
    temVariacao ? "\u2139\uFE0F O valor pode mudar conforme cor, tamanho ou varia\u00E7\u00E3o escolhida na Shopee." : "",
    desconto ? `\uD83D\uDD25 ${desconto}` : "",
    parcelamento,
    cupom,
    montarLinkCompra(oferta),
    aplicarCupom
  ]);
}

function montarMensagemOferta(oferta = {}, opcoes = {}) {
  const clienteId = opcoes.clienteId || oferta.clienteId || "admin";
  const destino = opcoes.destino || {};
  let resolucaoTemplate = null;
  let espelhoPilotoResultado = null;
  const ofertaComFatosBase = aplicarFatosOfcV24ComoEntrada({
    ...oferta,
    clienteId
  });
  const tituloApresentacao = resolverTituloApresentacaoOferta(ofertaComFatosBase, destino, {
    ...opcoes,
    clienteId
  });
  const tituloIaPreExistente = Boolean(primeiroTituloIaValido(ofertaComFatosBase));
  const fonteTitulo = fonteTituloApresentacaoLocal({
    destino,
    resultado: tituloApresentacao,
    tituloIaPreExistente
  });
  const tituloProdutoAtivo = normalizarTituloOfertaDestino(destino?.tituloOferta) === "ia" &&
    tituloIaLiberadoRender(opcoes);
  const tituloProdutoApresentacao = tituloProdutoAtivo
    ? resolverTituloProdutoApresentacao(ofertaComFatosBase)
    : { titulo: "", fonteTituloProduto: "", tituloProdutoLimpo: false, modoTituloProduto: "" };
  const ganchoCopyLocal = tituloProdutoAtivo
    ? resolverGanchoCopyLocalApresentacao(tituloApresentacao, fonteTitulo)
    : {
      gancho: "",
      fonteGancho: "",
      fraseIdGancho: "",
      familiaGancho: "",
      intencaoGancho: ""
    };
  const emojiTituloProduto = tituloProdutoAtivo
    ? resolverEmojiSemanticoTitulo(ofertaComFatosBase, {
      tituloProduto: tituloProdutoApresentacao.titulo,
      familiaGancho: ganchoCopyLocal.familiaGancho,
      subcontextoGancho: tituloApresentacao.subcontexto
    })
    : { emoji: "", origem: "" };
  const ofertaApresentacao = {
    ...ofertaComFatosBase,
    clienteId,
    titulo: tituloApresentacao.titulo,
    tituloProdutoApresentacaoAtivo: tituloProdutoAtivo,
    tituloProdutoApresentacao: tituloProdutoAtivo ? tituloProdutoApresentacao.titulo : "",
    fonteTituloProduto: tituloProdutoAtivo ? tituloProdutoApresentacao.fonteTituloProduto : "",
    tituloProdutoLimpo: tituloProdutoAtivo ? tituloProdutoApresentacao.tituloProdutoLimpo === true : false,
    modoTituloProduto: tituloProdutoAtivo ? tituloProdutoApresentacao.modoTituloProduto : "",
    ganchoCopyLocal: tituloProdutoAtivo ? ganchoCopyLocal.gancho : "",
    fonteGancho: tituloProdutoAtivo ? ganchoCopyLocal.fonteGancho : "",
    fraseIdGancho: tituloProdutoAtivo ? ganchoCopyLocal.fraseIdGancho : "",
    familiaGancho: tituloProdutoAtivo ? ganchoCopyLocal.familiaGancho : "",
    intencaoGancho: tituloProdutoAtivo ? ganchoCopyLocal.intencaoGancho : "",
    emojiTituloProduto: tituloProdutoAtivo ? emojiTituloProduto.emoji : "",
    emojiSemanticoOrigem: tituloProdutoAtivo ? emojiTituloProduto.origem : "",
    emojiGanchoCopyLocal: tituloProdutoAtivo && ganchoCopyLocal.gancho ? "✨" : ""
  };
  const ofertaEntradaComFatosOfc = aplicarFatosOfcV24ComoEntrada(ofertaApresentacao);
  const ofertaOficial = montarOfertaRenderizacaoOficial(ofertaEntradaComFatosOfc);
  const fidelidadeTraceIdPrincipal = fidelidadeObs.flagAtiva()
    ? fidelidadeObs.resolverFidelidadeTraceId(oferta, oferta.metadata, ofertaOficial, ofertaOficial.metadata)
    : "";
  const contextoFidelidadeTemplate = fidelidadeTraceIdPrincipal
    ? { fidelidadeTraceId: fidelidadeTraceIdPrincipal }
    : {};
  const renderersFinaisValidos = new Set([
    "ofc_v25_documento_canonico",
    "ofc_v25_espelho",
    "renderer_oficial",
    "template_personalizado",
    "template_universal",
    "template_legado",
    "fallback_marketplace",
    "fallback_generico"
  ]);
  const valorLogCurto = (valor, fallback = "") => {
    if (valor === null || valor === undefined) return fallback;
    return String(valor).replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 120) || fallback;
  };
  const rendererFinalSeguro = (renderer) => {
    const normalizado = valorLogCurto(renderer, "fallback_generico");
    return renderersFinaisValidos.has(normalizado) ? normalizado : "fallback_generico";
  };
  const registrarRendererFinal = (templateTipo = "", decisao = {}) => {
    const metadata = ofertaOficial.metadata && typeof ofertaOficial.metadata === "object" ? ofertaOficial.metadata : {};
    const ofcV24 = metadata.ofcV24 && typeof metadata.ofcV24 === "object" ? metadata.ofcV24 : {};
    const rendererEscolhido = rendererFinalSeguro(decisao.rendererEscolhido || ({
      ofc_v24_espelho_piloto: ofcV24.documentoComercialCanonico ? "ofc_v25_documento_canonico" : "ofc_v25_espelho",
      personalizado_resolver: "template_personalizado",
      universal_oficial: "template_universal",
      mensagem_existente_sem_reconstrucao: "renderer_oficial",
      personalizado_legado: "template_legado",
      fallback_amazon: "fallback_marketplace",
      fallback_shopee: "fallback_marketplace",
      fallback_mercadolivre: "fallback_marketplace",
      fallback_padrao: "fallback_generico"
    }[templateTipo] || "fallback_generico"));
    const fallbackUtilizado = decisao.fallbackUtilizado === true ||
      rendererEscolhido === "renderer_oficial" ||
      rendererEscolhido === "template_legado" ||
      rendererEscolhido === "fallback_marketplace" ||
      rendererEscolhido === "fallback_generico";
    const payload = {
      workspaceId: valorLogCurto(clienteId),
      ofertaId: valorLogCurto(ofertaOficial.engineOfertaId || ofertaOficial.id || ofertaOficial.ofertaId || ""),
      marketplace: valorLogCurto(ofertaOficial.marketplace || ""),
      rendererEscolhido,
      motivo: valorLogCurto(decisao.motivo || espelhoPilotoResultado?.motivo || templateTipo || "renderer_oficial", "renderer_oficial"),
      temOfcV24: Boolean(Object.keys(ofcV24).length),
      temDocumentoCanonico: Boolean(ofcV24.documentoComercialCanonico),
      temEspelho: Boolean(ofcV24.espelhoComercial),
      temTemplateEspelho: Boolean(ofcV24.templateEspelhoShadow || ofcV24.templateEspelho),
      contratoFinalAplicado: ofertaOficial.contratoFinalAplicado === true ||
        ofertaOficial.contratoComercialFinalResolvido === true ||
        ofertaOficial.contratoComercialFinal?.resolvido === true,
      fonteTitulo,
      tituloIaPreExistente,
      categoriaRecebidaLocalV2: ofertaComFatosBase.categoria || ofertaComFatosBase.categoriaProduto || "",
      categoriaExibidaTemplate: ofertaOficial.categoria || ofertaOficial.categoriaProduto || "",
      fonteTituloProduto: valorLogCurto(ofertaOficial.fonteTituloProduto || ""),
      tituloProdutoLimpo: ofertaOficial.tituloProdutoLimpo === true,
      fonteGancho: valorLogCurto(ofertaOficial.fonteGancho || ""),
      fraseIdGancho: valorLogCurto(ofertaOficial.fraseIdGancho || ""),
      familiaGancho: valorLogCurto(ofertaOficial.familiaGancho || ""),
      intencaoGancho: valorLogCurto(ofertaOficial.intencaoGancho || ""),
      emojiSemanticoOrigem: valorLogCurto(ofertaOficial.emojiSemanticoOrigem || ""),
      ...(fonteTitulo === "local_v2" ? {
        fraseIdLocalV2: tituloApresentacao.fonte === copyInteligente.FONTE_COPY_LOCAL_V2 ? (tituloApresentacao.fraseId || "") : "",
        familiaLocalV2: tituloApresentacao.fonte === copyInteligente.FONTE_COPY_LOCAL_V2 ? (tituloApresentacao.familia || "") : "",
        intencaoLocalV2: tituloApresentacao.fonte === copyInteligente.FONTE_COPY_LOCAL_V2 ? (tituloApresentacao.intencao || "") : "",
        cacheHit: tituloApresentacao.fonte === copyInteligente.FONTE_COPY_LOCAL_V2 ? tituloApresentacao.cacheHit === true : false
      } : {
        cacheHit: tituloApresentacao.cacheHit === true
      }),
      origemApresentacao: valorLogCurto(ofertaOficial.origemApresentacao || ""),
      templatePersonalizado: rendererEscolhido === "template_personalizado" || rendererEscolhido === "template_legado",
      templateUniversal: rendererEscolhido === "template_universal",
      fallbackUtilizado,
      pilotoAtivo: espelhoPilotoResultado?.ativo === true
    };

    try {
      console.log("[OFC-V2.5-RENDERER-FINAL]", JSON.stringify(payload));
      if (fallbackUtilizado) {
        console.log("[OFC-V2.5-RENDERER-FALLBACK]", JSON.stringify({
          rendererOrigem: decisao.rendererOrigem || (payload.temDocumentoCanonico ? "ofc_v25_documento_canonico" : payload.temEspelho ? "ofc_v25_espelho" : "template_universal"),
          rendererDestino: rendererEscolhido,
          motivo: payload.motivo
        }));
      }
    } catch (_) {
      // Observabilidade do renderer nao pode interferir no envio.
    }
  };
  const motivoRendererOficial = (motivoPadrao = "renderer_oficial") => {
    const motivoPiloto = espelhoPilotoResultado?.motivo || "";
    if (motivoPiloto === "workspace_fora_do_piloto") return "workspace_fora_piloto";
    if (espelhoPilotoResultado?.ativo === true && espelhoPilotoResultado?.usarEspelho !== true) {
      if (motivoPiloto === "template_espelho_indisponivel") return "documento_ausente";
      if (motivoPiloto === "template_espelho_invalido") return "template_invalido";
      return motivoPiloto || motivoPadrao;
    }
    return motivoPadrao;
  };
  const registrarTemplate = (templateTipo, mensagem, decisao = {}) => {
    fidelidadeObs.registrarTemplate("template_saida", {
      ...contextoFidelidadeTemplate,
      clienteId,
      destinoId: destino.id || destino.destinoId || "",
      canal: opcoes.canal || destino.canal || destino.tipo || "",
      oferta: ofertaOficial,
      templateTipo,
      mensagem
    });
    registrarRendererFinal(templateTipo, decisao);
    return mensagem;
  };
  fidelidadeObs.registrarTemplate("template_entrada", {
    ...contextoFidelidadeTemplate,
    clienteId,
    destinoId: destino.id || destino.destinoId || "",
    canal: opcoes.canal || destino.canal || destino.tipo || "",
    oferta: ofertaOficial,
    templateTipo: "resolver_mensagem_oferta"
  });

  const mensagemExistente = resolverMensagemExistente(oferta, opcoes, ofertaOficial);

  espelhoPilotoResultado = selecionarTemplateEspelhoPiloto({
    workspaceId: clienteId,
    oferta: ofertaOficial,
    mensagemAtual: mensagemExistente,
    destino,
    canal: opcoes.canal || destino.canal || destino.tipo,
    rioOficialAtivo: rioOficialAtivo(ofertaOficial, opcoes)
  });
  if (espelhoPilotoResultado.usarEspelho && espelhoPilotoResultado.mensagem) {
    ofertaOficial.origemApresentacao = ofertaOficial.origemApresentacao || "ofc_v24_espelho_piloto";
    ofertaOficial.mensagemOfcV24ShadowDisponivel = true;
    ofertaOficial.metadata = {
      ...objetoLocal(ofertaOficial.metadata),
      ofcV24: {
        ...objetoLocal(objetoLocal(ofertaOficial.metadata).ofcV24),
        apresentacaoShadow: {
          disponivel: true,
          autoridadeFinal: false,
          motivo: espelhoPilotoResultado.motivo || "documento_canonico",
          tamanhoMensagem: String(espelhoPilotoResultado.mensagem || "").length
        }
      }
    };
    try {
      console.log("[OFC-V2.4-ESPELHO-PILOTO-SHADOW]", JSON.stringify({
        workspaceId: valorLogCurto(clienteId),
        ofertaId: valorLogCurto(ofertaOficial.engineOfertaId || ofertaOficial.id || ofertaOficial.ofertaId || ""),
        marketplace: valorLogCurto(ofertaOficial.marketplace || ""),
        origemApresentacao: "ofc_v24_espelho_piloto",
        autoridadeFinal: false,
        contratoFinalAplicado: ofertaOficial.contratoFinalAplicado === true ||
          ofertaOficial.contratoComercialFinalResolvido === true ||
          ofertaOficial.contratoComercialFinal?.resolvido === true,
        motivo: valorLogCurto(espelhoPilotoResultado.motivo || "documento_canonico")
      }));
    } catch (_) {
      // Observabilidade shadow nao pode interferir no envio.
    }
  }

  const dadosOficiaisUniversal = montarEntradaTemplateUniversalOficial(ofertaOficial);

  try {
    resolucaoTemplate = resolverTemplateMensagem({
      clienteId,
      destino,
      oferta: ofertaOficial,
      canal: opcoes.canal || destino.canal || destino.tipo,
      templatePersonalizadoHabilitado: opcoes.plano ? opcoes.plano?.recursos?.templatePersonalizado === true : true
    });
  } catch (erro) {
    console.warn("[TEMPLATE-ERRO-FALLBACK-UNIVERSAL]", {
      clienteId,
      destinoId: destino.id || null,
      templateId: destino.templateId || null,
      erro: String(erro?.message || erro || "erro_desconhecido").slice(0, 200)
    });
  }

  if (resolucaoTemplate?.ok && resolucaoTemplate.mensagem) {
    return registrarTemplate("personalizado_resolver", resolucaoTemplate.mensagem, {
      rendererEscolhido: "template_personalizado",
      motivo: motivoRendererOficial("renderer_oficial")
    });
  }

  const mensagemUniversalOficial = tentarTemplateUniversalOficial(ofertaOficial, {
    ...opcoes,
    dadosOficiaisUniversal
  });
  if (mensagemUniversalOficial) return registrarTemplate("universal_oficial", mensagemUniversalOficial, {
    rendererEscolhido: "template_universal",
    motivo: motivoRendererOficial("renderer_oficial")
  });

  return registrarTemplate("fallback_seguro_contrato", "Oferta recebida. Renderizacao oficial indisponivel no momento.", {
    rendererEscolhido: "fallback_generico",
    motivo: "fallback_seguro_sem_mensagem_legada",
    fallbackUtilizado: true,
    rendererOrigem: "template_universal"
  });
}

module.exports = {
  montarMensagemOferta,
  resolverTituloApresentacaoOferta,
  normalizarTituloOfertaDestino,
  formatarPreco,
  cortarTitulo,
  montarLinhaCupom,
  montarLinhaParcelamento,
  montarLegendaOferta,
  montarLegendaShopee,
  resolverTituloProdutoApresentacao,
  resolverEmojiSemanticoTitulo,
  tituloIaLiberadoRender,
  parsePreco: normalizarPreco,
  formatarDesconto: montarLinhaDesconto,
  precoTemVariacao,
  formatarFaixaPreco
};
