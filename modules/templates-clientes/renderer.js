const { CANAIS_PERMITIDOS, getBlocoCatalogo } = require("./catalogo-blocos");
const {
  prepararDadosOficiaisTemplate,
  diagnosticoDadosOficiaisTemplate
} = require("./dados-oficiais");
const { classificarBlocoComercial } = require("./politica-blocos-comerciais");
const fidelidadeObs = require("../fidelidade/observabilidade-v1");
const {
  normalizarCuponsSemanticos
} = require("../radar/cupom-semantico");
const {
  textoPixValido
} = require("../radar/preco-pix-precedencia");
const {
  classificacaoVisualOferta
} = require("./classificacao-visual-oferta");

const AVISO_FINAL_PADRAO = "Oferta sujeita à alteração de preço.";
const TIPOS_AVISO_FINAL = new Set(["aviso_final", "aviso_preco", "aviso_alteracao"]);

function textoUtil(valor) {
  if (valor === undefined || valor === null) return "";
  const texto = String(valor).trim();
  if (!texto) return "";
  if (["undefined", "null", "nan"].includes(texto.toLowerCase())) return "";
  return texto;
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    const texto = textoUtil(valor);
    if (texto) return texto;
  }
  return "";
}

function listaTexto(...valores) {
  const resultado = [];
  const vistos = new Set();
  for (const valor of valores.flat()) {
    const item = textoUtil(valor);
    if (!item || vistos.has(item)) continue;
    vistos.add(item);
    resultado.push(item);
  }
  return resultado;
}

function valorCupomTemplate(oferta = {}) {
  if (oferta.contratoComercialFinal?.cupomCodigo !== undefined) return textoUtil(oferta.contratoComercialFinal.cupomCodigo);
  const cupons = normalizarCuponsSemanticos(listaTexto(
    Array.isArray(oferta.cupons) ? oferta.cupons : [],
    Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []
  ));
  if (cupons.length) return cupons.join(" ou ");
  return normalizarCuponsSemanticos(oferta.cupom)[0] || "";
}

function numeroUtil(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor === "string" && ["undefined", "null", "nan"].includes(valor.trim().toLowerCase())) return null;

  if (typeof valor === "number") return Number.isFinite(valor) && valor > 0 ? valor : null;

  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim();

  if (!texto) return null;

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");
  const normalizado = temVirgula && temPonto
    ? texto.replace(/\./g, "").replace(",", ".")
    : temVirgula
      ? texto.replace(",", ".")
      : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function formatarMoeda(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function numeroMonetarioEmTexto(valor) {
  const direto = numeroUtil(valor);
  if (direto != null) return direto;
  const match = textoUtil(valor).match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|(?:R\$\s*)?\d+(?:[,.]\d{1,2})?/);
  return match ? numeroUtil(match[0]) : null;
}

function numeroInteiro(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return String(Math.round(numero));
}

function formatarPercentual(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return `${Math.round(numero)}%`;
}

function formatarQuantidade(valor) {
  const numero = numeroUtil(valor);
  if (!numero) return "";
  return Math.round(numero).toLocaleString("pt-BR");
}

function valorEconomia(oferta = {}) {
  return numeroUtil(oferta.economia ?? oferta.valorEconomia ?? oferta.economiaValor);
}

function chavePapelSemantico(valor = "") {
  return normalizarComparacao(valor).replace(/[^a-z0-9]+/g, "");
}

function textoEquivaleCampoIdentidade(valor = "", oferta = {}) {
  const chave = chavePapelSemantico(valor);
  if (!chave) return false;
  const referencias = [
    oferta.titulo,
    oferta.nome,
    oferta.descricao,
    oferta.descricaoAdicional,
    oferta.textoResumo,
    oferta.mensagemResumo,
    oferta.marketplace,
    oferta.loja,
    oferta.categoria
  ];
  return referencias.some(referencia => {
    const ref = chavePapelSemantico(referencia);
    return Boolean(ref && (chave === ref || (ref.length >= 24 && chave.includes(ref))));
  });
}

function beneficioTemPapelComercial(valor = "") {
  const normalizado = normalizarComparacao(valor);
  if (!normalizado) return false;
  return /\b(?:cupom|pix|frete|cashback|desconto|parcel|app|aplicativo|resgate|voucher|moeda|moedas|prime|garantia|brinde|off|gratis|relampago|leve|pague)\b/.test(normalizado) ||
    /\b\d+\s*%/.test(normalizado);
}

function beneficioValidoPorPapel(valor = "", oferta = {}) {
  const beneficio = textoUtil(valor);
  if (!beneficio) return false;
  if (textoEquivaleCampoIdentidade(beneficio, oferta)) return false;
  return beneficioTemPapelComercial(beneficio);
}

function assinaturaFatoComercial(valor = "") {
  const semUrl = textoUtil(valor).replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  const n = normalizarComparacao(semUrl)
    .replace(/\b(?:cupom|codigo|cod|voucher|use|utilize|aplique|resgate|ative|no|na|em|anuncio|pagina|link|abaixo|antes|finalizar|compra)\b/g, " ")
    .replace(/[^a-z0-9%$]+/g, " ")
    .trim();
  const percentual = n.match(/\b(\d{1,3})\s*%\s*(?:off|desconto)?\b/);
  if (percentual) return `percentual:${percentual[1]}`;
  const monetarioOff = semUrl.match(/R\$\s*(\d{1,5}(?:[,.]\d{1,2})?)\s*OFF\b/i);
  if (monetarioOff) return `valor_off:${monetarioOff[1].replace(",", ".")}`;
  const cupom = normalizarCuponsSemanticos(valor);
  if (cupom.length) return `cupom:${cupom.join("+")}`;
  return n.replace(/\s+/g, "");
}

function beneficioDuplicaOutroPapel(valor = "", oferta = {}) {
  const chave = assinaturaFatoComercial(valor);
  if (!chave) return false;
  const referencias = [
    oferta.cupom,
    oferta.codigoCupom,
    oferta.cupomCodigo,
    ...(Array.isArray(oferta.cupons) ? oferta.cupons : []),
    ...(Array.isArray(oferta.codigosCupom) ? oferta.codigosCupom : []),
    oferta.instrucaoCupom,
    oferta.condicaoCupom,
    oferta.condicaoComercial,
    oferta.avaliacao,
    oferta.rating,
    oferta.nota
  ];
  return referencias.some(referencia => {
    const ref = assinaturaFatoComercial(referencia);
    return Boolean(ref && ref === chave);
  });
}

function valorBeneficio(oferta = {}) {
  if (oferta.contratoComercialFinal?.beneficio !== undefined) return textoUtil(oferta.contratoComercialFinal.beneficio);
  const candidatos = [];
  if (Array.isArray(oferta.beneficios)) {
    candidatos.push(...oferta.beneficios);
  }

  candidatos.push(
    oferta.beneficioTexto,
    oferta.beneficioExtra,
    oferta.avisoCupom,
    oferta.beneficioDetectado
  );

  return candidatos.map(textoUtil).find(item =>
    beneficioValidoPorPapel(item, oferta) &&
    !beneficioDuplicaOutroPapel(item, oferta)
  ) || "";
}

function valorFrete(oferta = {}) {
  const texto = primeiroTexto(oferta.frete, oferta.freteTexto, oferta.avisoFrete);
  if (texto) return texto;
  return oferta.freteGratis === true ? "Frete gratis" : "";
}

function estrelasPreenchidas(avaliacao = "") {
  return (String(avaliacao || "").match(/⭐|★/g) || []).length;
}

function formatarAvaliacaoReal(valor = "") {
  const avaliacao = textoUtil(valor);
  if (!avaliacao) return "";
  if (/⭐|★|☆/.test(avaliacao)) return estrelasPreenchidas(avaliacao) >= 2 ? avaliacao : "";

  const possuiPapelAvaliacao = /^\s*[0-5](?:[,.]\d+)?\s*$/.test(avaliacao) ||
    /(?:\/\s*5\b|\bestrelas?\b|\bnota\b|\bavalia[cç][aã]o\b|\breviews?\b|\brating\b)/i.test(avaliacao);
  if (!possuiPapelAvaliacao) return "";

  const match = avaliacao.replace(",", ".").match(/\b([0-5](?:\.\d+)?)\b(?:\s*\/\s*5)?/);
  if (!match) return "";

  const numero = Number(match[1]);
  if (!Number.isFinite(numero) || numero <= 0 || numero > 5) return "";
  const cheias = Math.max(1, Math.min(5, Math.round(numero)));
  return `${"⭐".repeat(cheias)}${"☆".repeat(5 - cheias)}`;
}

function valorAvaliacao(oferta = {}) {
  return formatarAvaliacaoReal(primeiroTexto(oferta.avaliacao, oferta.rating, oferta.nota));
}

function valorAvisoFinal(oferta = {}) {
  return primeiroTexto(
    oferta.avisoFinal,
    oferta.avisoAlteracao,
    oferta.avisoPreco,
    oferta.avisoPagamento,
    oferta.avisoVariacaoPreco,
    oferta.aviso,
    AVISO_FINAL_PADRAO
  );
}

function valorQuantidadeAvaliacoes(oferta = {}) {
  return numeroInteiro(
    oferta.quantidadeAvaliacoes ??
    oferta.totalAvaliacoes ??
    oferta.avaliacoes ??
    oferta.reviews ??
    oferta.reviewCount
  );
}

function valorVendas(oferta = {}) {
  return numeroInteiro(oferta.vendas ?? oferta.sales ?? oferta.vendasShopee ?? oferta.totalVendas);
}

function valorEfetivoConfirmado(oferta = {}) {
  const valorEfetivo = numeroUtil(oferta.valorEfetivo);
  const precoAtual = numeroUtil(oferta.precoAtual ?? oferta.precoPor ?? oferta.preco);
  const origem = normalizarComparacao(oferta.valorEfetivoOrigem);

  if (valorEfetivo == null || precoAtual == null || valorEfetivo >= precoAtual) return null;
  if (!["cupom", "pix", "app", "cashback", "frete_gratis", "desconto"].some(termo => origem.includes(termo))) {
    return null;
  }

  return valorEfetivo;
}

function valorPrecoPor(oferta = {}) {
  if (oferta.fontePrecoExibido && oferta.precoExibido !== undefined && oferta.precoExibido !== null && oferta.precoExibido !== "") {
    return oferta.precoExibido;
  }

  return oferta.precoAtual ?? oferta.precoPor ?? oferta.preco;
}

function normalizarComparacao(valor = "") {
  return textoUtil(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function avisoCupomGenericoTemplate(valor = "") {
  const normalizado = normalizarComparacao(valor);
  if (!normalizado) return false;
  return (
    normalizado.includes("cupom disponivel na pagina") ||
    normalizado.includes("cupons disponiveis na pagina") ||
    normalizado.includes("resgate antes de finalizar") ||
    normalizado.includes("confira antes de finalizar") ||
    normalizado.includes("pode haver beneficio")
  );
}

function nomeBeneficioFraseCupom(oferta = {}) {
  const frete = valorFrete(oferta);
  const beneficio = valorBeneficio(oferta);
  const fonte = normalizarComparacao([frete, beneficio].filter(Boolean).join(" "));

  if (frete || oferta.freteGratis === true || fonte.includes("frete")) return "frete grátis";
  if (fonte.includes("pix")) return "PIX";
  if (fonte.includes("app") || fonte.includes("aplicativo")) return "app";
  if (fonte.includes("cashback")) return "cashback";

  return "";
}

function montarFraseCupom(oferta = {}) {
  if (oferta.contratoComercialFinal?.instrucaoComercial !== undefined) {
    const instrucaoFinal = textoUtil(oferta.contratoComercialFinal.instrucaoComercial);
    return instrucaoFinal ? `âš¡ ${instrucaoFinal}` : "";
  }
  const cupom = valorCupomTemplate(oferta);
  if (!cupom) return "";
  const avisoCupom = avisoCupomGenericoTemplate(oferta.avisoCupom) ? "" : oferta.avisoCupom;
  const instrucao = primeiroTexto(oferta.instrucaoCupom, oferta.condicaoCupom, oferta.condicaoComercial, avisoCupom);
  if (instrucao && instrucao !== cupom) return `⚡ ${instrucao}`;

  return "";
}

function textoIndicaPix(valor = "") {
  return normalizarComparacao(valor).includes("pix");
}

function precoPixRenderizavel(oferta = {}) {
  if (oferta.contratoComercialFinal?.precoPixTexto !== undefined) return textoPixValido(oferta.contratoComercialFinal.precoPixTexto);
  if (oferta.precoPixDistinto != null && oferta.precoPix) return textoPixValido(oferta.precoPix);
  return textoPixValido(oferta.precoPix);
}

function instrucaoCupomEssencial(oferta = {}) {
  const cupom = valorCupomTemplate(oferta);
  const instrucao = primeiroTexto(oferta.instrucaoCupom, oferta.condicaoCupom, oferta.condicaoComercial, oferta.avisoCupom);
  if (!instrucao || instrucao === cupom || avisoCupomGenericoTemplate(instrucao)) return false;
  const n = normalizarComparacao(instrucao);
  if (cupom && !n.includes(normalizarComparacao(cupom)) && !/\b(?:cupom|voucher|resgate|moeda|moedas|pix|app|loja)\b/.test(n)) return false;
  return /\b(?:cupom|voucher|resgate|moeda|moedas|pix|app|loja|siga)\b/.test(n);
}

function cupomEssencial(oferta = {}) {
  if (!valorCupomTemplate(oferta)) return false;
  const fonte = normalizarComparacao([
    oferta.instrucaoCupom,
    oferta.condicaoCupom,
    oferta.condicaoComercial,
    oferta.avisoCupom,
    oferta.condicaoPix,
    oferta.precoPix,
    oferta.valorEfetivoOrigem
  ].filter(Boolean).join(" "));
  return oferta.cupomConfirmado === true ||
    instrucaoCupomEssencial(oferta) ||
    /\b(?:cupom|voucher|aplique|use|utilize|resgate)\b/.test(fonte);
}

function precoPixEssencial(oferta = {}) {
  if (oferta.contratoComercialFinal?.precoPixDistinto === null) return false;
  const precoPix = precoPixRenderizavel(oferta);
  if (!precoPix || !textoIndicaPix(precoPix)) return false;
  const precoPor = formatarMoeda(valorPrecoPor(oferta));
  return !precoPor || normalizarComparacao(precoPix) !== normalizarComparacao(precoPor);
}

function linkComercialPorTipo(oferta = {}, tipos = []) {
  const tiposNormalizados = new Set(tipos.map(tipo => normalizarComparacao(tipo).replace(/^link_/, "")));
  const candidatos = [
    ...(Array.isArray(oferta.linksComerciais) ? oferta.linksComerciais : []),
    ...(Array.isArray(oferta.linksProduto) ? oferta.linksProduto : []),
    ...(Array.isArray(oferta.linksResgate) ? oferta.linksResgate : [])
  ];
  const links = [];
  const vistos = new Set();
  for (const item of candidatos) {
    if (!item || typeof item !== "object") continue;
    const tipo = normalizarComparacao(item.tipo || item.papel || "").replace(/^link_/, "");
    if (!tiposNormalizados.has(tipo)) continue;
    const url = primeiroTexto(item.urlOptimus, item.urlAfiliada, item.afiliado, item.linkAfiliado, item.resolvido, item.url, item.original, item.link);
    const ordem = Number(item.ordemCaptura || item.ordem || links.length + 1) || (links.length + 1);
    const chave = `${tipo}:${ordem}:${url}`;
    if (url && !vistos.has(chave)) {
      vistos.add(chave);
      links.push({ url, ordem });
    }
  }
  return links
    .sort((a, b) => a.ordem - b.ordem)
    .map(item => item.url)
    .join("\n");
}

function dadosBlocoTemplate(tipo = "", oferta = {}) {
  if (tipo === "titulo") return primeiroTexto(oferta.titulo, oferta.nome);
  if (tipo === "preco_por") return formatarMoeda(valorPrecoPor(oferta));
  if (tipo === "preco_pix") return precoPixRenderizavel(oferta);
  if (tipo === "cupom") return valorCupomTemplate(oferta);
  if (tipo === "frase_cupom") return primeiroTexto(oferta.instrucaoCupom, oferta.condicaoCupom, oferta.condicaoComercial, oferta.avisoCupom);
  if (tipo === "link") return primeiroTexto(linkComercialPorTipo(oferta, ["produto"]), oferta.linkProduto, oferta.linkAfiliado, oferta.linkFinal, oferta.link, oferta.url);
  if (tipo === "link_resgate") return primeiroTexto(oferta.linkResgate, linkComercialPorTipo(oferta, ["resgate"]));
  if (tipo === "link_app") return primeiroTexto(oferta.linkApp, linkComercialPorTipo(oferta, ["app"]));
  if (tipo === "link_moedas") return primeiroTexto(oferta.linkMoedas, linkComercialPorTipo(oferta, ["moedas"]));
  if (tipo === "link_pc") return primeiroTexto(oferta.linkPc, linkComercialPorTipo(oferta, ["pc"]));
  return "__opcional__";
}

function blocoComercialmenteNecessario(tipo = "", oferta = {}) {
  if (tipo === "cupom") return cupomEssencial(oferta);
  if (tipo === "frase_cupom") return instrucaoCupomEssencial(oferta);
  if (tipo === "preco_pix") return precoPixEssencial(oferta);
  if (["link_resgate", "link_app", "link_moedas", "link_pc"].includes(tipo)) return Boolean(dadosBlocoTemplate(tipo, oferta));
  return Boolean(dadosBlocoTemplate(tipo, oferta));
}

function blocoProtegidoNoTemplate(tipo = "", oferta = {}) {
  const necessario = blocoComercialmenteNecessario(tipo, oferta);
  return classificarBlocoComercial(tipo, {
    essencial: necessario,
    comercialmenteNecessario: necessario,
    necessario
  }).protegido && necessario;
}

function ordemProtegidaTemplate(tipo = "", ordemOriginal = 0) {
  const ordens = {
    link_app: ordemOriginal,
    link_moedas: ordemOriginal,
    link_pc: ordemOriginal
  };
  return Number.isFinite(Number(ordens[tipo])) ? ordens[tipo] : ordemOriginal;
}

function aplicarOrdemLinksProtegidosTemplate(blocos = []) {
  const linkProduto = blocos.find(bloco => bloco.tipo === "link");
  const linkResgate = blocos.find(bloco => bloco.tipo === "link_resgate");
  if (linkProduto && linkResgate) linkResgate.ordem = Number(linkProduto.ordem || 0) - 0.1;

  const linksAli = ["link_app", "link_moedas", "link_pc"]
    .map(tipo => blocos.find(bloco => bloco.tipo === tipo))
    .filter(Boolean);
  if (linksAli.length) {
    const base = Math.min(...linksAli.map(bloco => Number(bloco.ordem || 0)));
    const ordemAli = { link_app: base, link_moedas: base + 0.1, link_pc: base + 0.2 };
    for (const bloco of linksAli) bloco.ordem = ordemAli[bloco.tipo];
  }
  return blocos;
}

function normalizarBlocosProtegidosTemplate(blocos = [], oferta = {}) {
  const origem = Array.isArray(blocos) ? blocos : [];
  const saida = origem
    .filter(bloco => bloco && (bloco.ativo !== false || blocoProtegidoNoTemplate(bloco.tipo, oferta)))
    .map((bloco, indice) => ({
      ...bloco,
      ordem: ordemProtegidaTemplate(
        textoUtil(bloco.tipo),
        Number.isFinite(Number(bloco.ordem)) ? Number(bloco.ordem) : (indice + 1) * 10
      )
    }));
  const existentes = new Set(saida.map(bloco => textoUtil(bloco.tipo)));
  const essenciaisPadrao = [
    ["titulo", 10],
    ["preco_por", 50],
    ["preco_pix", 55],
    ["cupom", 80],
    ["frase_cupom", 90],
    ["link_resgate", 170],
    ["link_app", 171],
    ["link_moedas", 172],
    ["link_pc", 173],
    ["link", 180]
  ];
  for (const [tipo, ordem] of essenciaisPadrao) {
    if (existentes.has(tipo) || !blocoProtegidoNoTemplate(tipo, oferta)) continue;
    saida.push({ tipo, ativo: true, ordem, obrigatorio: true, compatibilidadePassiva: true });
    existentes.add(tipo);
  }
  return aplicarOrdemLinksProtegidosTemplate(saida);
}

function aplicarCondicaoPixPreco(preco = "", oferta = {}) {
  const textoPreco = textoUtil(preco);
  if (!textoPreco) return "";
  if (textoIndicaPix(textoPreco)) return textoPreco;
  if (normalizarComparacao(oferta.condicaoPrecoPor || oferta.contratoComercialFinal?.condicaoPrecoPor) === "pix") {
    return `${textoPreco} no Pix`;
  }
  if (precoPixRenderizavel(oferta)) return textoPreco;
  const condicaoPixOferta = primeiroTexto(oferta.condicaoPix, oferta.precoPix);
  const valorPix = numeroMonetarioEmTexto(condicaoPixOferta);
  const valorPreco = numeroMonetarioEmTexto(textoPreco);
  if (textoIndicaPix(condicaoPixOferta) && valorPix != null && valorPreco != null && valorPix === valorPreco) {
    return `${textoPreco} no Pix`;
  }

  const condicaoPix = primeiroTexto(oferta.descontoPix);
  if (!textoIndicaPix(condicaoPix)) return textoPreco;

  return `${textoPreco} no Pix`;
}

function resolverLinha(bloco, oferta = {}) {
  const tipo = bloco.tipo;

  if (tipo === "titulo") {
    const titulo = primeiroTexto(oferta.titulo, oferta.nome);
    return titulo ? `🔥 ${titulo}` : "";
  }
  if (tipo === "marketplace") {
    const marketplace = primeiroTexto(oferta.marketplace, oferta.loja);
    return marketplace ? `🛍️ ${marketplace}` : "";
  }
  if (tipo === "categoria") {
    const categoria = textoUtil(oferta.categoria);
    return categoria ? `📂 ${categoria}` : "";
  }
  if (tipo === "preco_de") {
    const precoPor = numeroUtil(valorPrecoPor(oferta));
    const precoDe = numeroUtil(oferta.precoOriginal ?? oferta.precoDe ?? oferta.precoAntigo);
    const preco = precoDe != null && precoPor != null && precoDe > precoPor
      ? formatarMoeda(precoDe)
      : "";
    return preco ? `❌ De: ${preco}` : "";
  }
  if (tipo === "preco_por") {
    const preco = formatarMoeda(valorPrecoPor(oferta));
    const precoComCondicao = aplicarCondicaoPixPreco(preco, oferta);
    return precoComCondicao ? `✅ Por: ${precoComCondicao}` : "";
  }
  if (tipo === "desconto_percentual") {
    const desconto = formatarPercentual(oferta.descontoPercentual ?? oferta.desconto);
    return desconto ? `📉 ${desconto} OFF` : "";
  }
  if (tipo === "preco_pix") {
    const pix = precoPixRenderizavel(oferta);
    return pix ? `⚡ Pix: ${pix}` : "";
  }
  if (tipo === "economia") {
    const economia = formatarMoeda(valorEconomia(oferta));
    return economia ? `💸 Economia: ${economia}` : "";
  }
  if (tipo === "cupom") {
    const cupom = valorCupomTemplate(oferta);
    return cupom ? `🎟️ Cupom: ${cupom}` : "";
  }
  if (tipo === "frase_cupom") {
    return montarFraseCupom(oferta);
  }
  if (tipo === "beneficio") {
    const beneficio = valorBeneficio(oferta);
    return beneficio ? `⚡ ${beneficio}` : "";
  }
  if (tipo === "cashback") {
    const cashback = textoUtil(oferta.cashback);
    return cashback ? `💰 ${cashback}` : "";
  }
  if (tipo === "oportunidade") {
    return classificacaoVisualOferta(oferta);
  }
  if (tipo === "descricao_adicional") {
    const descricao = primeiroTexto(oferta.descricaoAdicional, oferta.descricao, oferta.textoResumo, oferta.mensagemResumo);
    return descricao ? `📝 ${descricao}` : "";
  }
  if (tipo === "parcelamento") {
    const parcelamento = textoUtil(oferta.parcelamento);
    return parcelamento ? `💳 ${parcelamento}` : "";
  }
  if (tipo === "frete") {
    const frete = valorFrete(oferta);
    return frete ? `🚚 ${frete}` : "";
  }
  if (tipo === "avaliacao") {
    const avaliacao = valorAvaliacao(oferta);
    return avaliacao ? `✰ Avaliação\n${avaliacao}` : "";
  }
  if (tipo === "quantidade_avaliacoes") {
    const quantidade = valorQuantidadeAvaliacoes(oferta);
    return quantidade ? `👥 ${formatarQuantidade(quantidade)} avaliacoes` : "";
  }
  if (tipo === "vendas") {
    const vendas = valorVendas(oferta);
    return vendas ? `🛒 ${formatarQuantidade(vendas)} vendidos` : "";
  }
  if (tipo === "cta") {
    const cta = primeiroTexto(oferta.ctaPublico, oferta.cta, "Confira aqui:");
    return cta ? `🔗 ${cta}` : "";
  }
  if (tipo === "link_resgate") {
    const link = primeiroTexto(oferta.linkResgate, linkComercialPorTipo(oferta, ["resgate"]));
    return link ? `🎟️ Resgate:\n${link}` : "";
  }
  if (tipo === "link_app") {
    const link = primeiroTexto(oferta.linkApp, linkComercialPorTipo(oferta, ["app"]));
    return link ? `📱 APP:\n${link}` : "";
  }
  if (tipo === "link_app") {
    const link = primeiroTexto(oferta.linkApp, linkComercialPorTipo(oferta, ["app"]));
    return link ? `📱 APP / Moedas:\n${link}` : "";
  }
  if (tipo === "link_moedas") {
    const link = primeiroTexto(oferta.linkMoedas, linkComercialPorTipo(oferta, ["moedas"]));
    return link ? `🪙 Moedas:\n${link}` : "";
  }
  if (tipo === "link_moedas") {
    const link = primeiroTexto(oferta.linkMoedas, linkComercialPorTipo(oferta, ["moedas"]));
    return link ? `📱 APP / Moedas:\n${link}` : "";
  }
  if (tipo === "link_pc") {
    const link = primeiroTexto(oferta.linkPc, linkComercialPorTipo(oferta, ["pc"]));
    return link ? `🖥️ PC:\n${link}` : "";
  }
  if (tipo === "link_pc") {
    const link = primeiroTexto(oferta.linkPc, linkComercialPorTipo(oferta, ["pc"]));
    return link ? `🖥️ PC:\n${link}` : "";
  }
  if (tipo === "link") {
    const link = primeiroTexto(linkComercialPorTipo(oferta, ["produto"]), oferta.linkProduto, oferta.linkAfiliado, oferta.linkFinal, oferta.link, oferta.url);
    return link ? `🔗 Confira aqui:\n${link}` : "";
  }
  if (TIPOS_AVISO_FINAL.has(tipo)) {
    const aviso = valorAvisoFinal(oferta);
    return aviso ? `⚠️ ${aviso}` : "";
  }
  if (tipo === "aviso_preco") {
    const aviso = primeiroTexto(oferta.avisoPreco, oferta.avisoPagamento, oferta.avisoVariacaoPreco);
    return aviso ? `⚠️ ${aviso}` : "";
  }
  if (tipo === "aviso_alteracao") {
    const aviso = primeiroTexto(oferta.avisoAlteracao, oferta.aviso);
    return aviso ? `⚠️ ${aviso}` : "";
  }

  return "";
}

function grupoBlocoTemplate(tipo = "") {
  if (tipo === "titulo") return "identificacao";
  if (["marketplace", "categoria", "oportunidade"].includes(tipo)) return "origem";
  if (["preco_de", "preco_por", "preco_pix", "desconto_percentual", "economia", "parcelamento"].includes(tipo)) return "precos";
  if (["cupom", "beneficio", "cashback", "descricao_adicional"].includes(tipo)) return "beneficios";
  if (["avaliacao", "quantidade_avaliacoes", "vendas", "frete"].includes(tipo)) return "prova";
  if (tipo === "cta") return "cta";
  if (tipo === "link_resgate") return "link_resgate";
  if (["link_app", "link_moedas", "link_pc"].includes(tipo)) return "link";
  if (tipo === "link") return "link";
  if (tipo === "frase_cupom") return "frase_cupom";
  if (TIPOS_AVISO_FINAL.has(tipo)) return "avisos";
  if (tipo === "rodape") return "rodape";
  return "outros";
}

function limparLinhas(linhas = []) {
  return linhas
    .map(linha => String(linha || "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function montarMensagemAgrupada(entradas = []) {
  const linhas = [];
  let grupoAnterior = "";

  for (const entrada of entradas) {
    const linha = String(entrada?.linha || "").trim();
    if (!textoUtil(linha)) continue;

    const grupo = grupoBlocoTemplate(entrada.tipo);
    if (linhas.length && grupo && grupoAnterior && grupo !== grupoAnterior) {
      linhas.push("");
    }
    linhas.push(linha);
    grupoAnterior = grupo;
  }

  return limparLinhas(linhas);
}

function renderizarTemplatePersonalizado({ oferta = {}, template = {}, canal = "whatsapp" } = {}) {
  const canalNormalizado = textoUtil(canal).toLowerCase();
  if (!CANAIS_PERMITIDOS.includes(canalNormalizado)) {
    return { ok: false, erro: "canal_invalido", mensagem: "", templateIdUsado: template.id || "", blocosRenderizados: [], blocosIgnorados: [] };
  }

  const canaisTemplate = Array.isArray(template.canais) ? template.canais : [];
  if (canaisTemplate.length && !canaisTemplate.includes(canalNormalizado)) {
    return { ok: false, erro: "canal_incompativel", mensagem: "", templateIdUsado: template.id || "", blocosRenderizados: [], blocosIgnorados: [] };
  }

  const blocos = Array.isArray(template.blocos) ? [...template.blocos] : [];
  const ofertaOficial = prepararDadosOficiaisTemplate(oferta, { modo: "personalizado" });
  const fidelidadeTraceIdPrincipal = fidelidadeObs.flagAtiva()
    ? fidelidadeObs.resolverFidelidadeTraceId(oferta, oferta.metadata, ofertaOficial, ofertaOficial.metadata)
    : "";
  const contextoFidelidadeTemplate = fidelidadeTraceIdPrincipal
    ? { fidelidadeTraceId: fidelidadeTraceIdPrincipal }
    : {};
  fidelidadeObs.registrarTemplate("template_personalizado_renderer_entrada", {
    ...contextoFidelidadeTemplate,
    oferta: ofertaOficial,
    templateTipo: "personalizado_renderer",
    canal: canalNormalizado,
    templateId: template.id || ""
  });

  if (process.env.NODE_ENV === "test" || process.env.TEMPLATE_DADOS_OFICIAIS_LOG === "1") {
    console.log("[TEMPLATE-DADOS-OFICIAIS]", JSON.stringify(diagnosticoDadosOficiaisTemplate(ofertaOficial)));
  }

  const blocosProtegidos = normalizarBlocosProtegidosTemplate(blocos, ofertaOficial);
  const possuiBlocoLinkResgate = blocosProtegidos.some(bloco => bloco?.tipo === "link_resgate");
  const existeLinkResgate = textoUtil(dadosBlocoTemplate("link_resgate", ofertaOficial));
  const blocosComCompatibilidade = [...blocosProtegidos];
  if (!possuiBlocoLinkResgate && existeLinkResgate) {
    const indiceLink = blocosComCompatibilidade.findIndex(bloco => bloco?.tipo === "link" && bloco.ativo !== false);
    if (indiceLink >= 0) {
      const ordemLink = Number(blocosComCompatibilidade[indiceLink].ordem || 0);
      blocosComCompatibilidade.splice(indiceLink, 0, {
        tipo: "link_resgate",
        ativo: true,
        ordem: ordemLink - 0.1,
        compatibilidadePassiva: true
      });
    }
  }

  const ativosOrdenados = blocosComCompatibilidade
    .filter(bloco => bloco && (bloco.ativo !== false || blocoProtegidoNoTemplate(bloco.tipo, ofertaOficial)))
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0) || String(a.tipo).localeCompare(String(b.tipo)));

  const linhas = [];
  const blocosRenderizados = [];
  const blocosIgnorados = [];
  let avisoFinalRenderizado = false;

  for (const bloco of ativosOrdenados) {
    const catalogo = getBlocoCatalogo(bloco.tipo);
    if (!catalogo || !catalogo.canais.includes(canalNormalizado)) {
      blocosIgnorados.push({ tipo: bloco.tipo || "", motivo: "bloco_incompativel" });
      continue;
    }
    const ctaNormalizada = normalizarComparacao(primeiroTexto(ofertaOficial.ctaPublico, ofertaOficial.cta, "Confira aqui:"))
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const existeLinkRenderizavel = primeiroTexto(
      ofertaOficial.linkProduto,
      ofertaOficial.linkAfiliado,
      ofertaOficial.linkFinal,
      ofertaOficial.link,
      ofertaOficial.url,
      ofertaOficial.linkResgate
    );
    if (bloco.tipo === "cta" && existeLinkRenderizavel && ctaNormalizada === "confira aqui") {
      blocosIgnorados.push({ tipo: bloco.tipo, motivo: "cta_coberta_pelo_bloco_link" });
      continue;
    }
    if (TIPOS_AVISO_FINAL.has(bloco.tipo) && avisoFinalRenderizado) {
      blocosIgnorados.push({ tipo: bloco.tipo, motivo: "aviso_final_ja_renderizado" });
      continue;
    }
    const linha = resolverLinha(bloco, ofertaOficial);
    if (!textoUtil(linha)) {
      blocosIgnorados.push({ tipo: bloco.tipo, motivo: "sem_dados" });
      continue;
    }
    linhas.push({ tipo: bloco.tipo, linha });
    blocosRenderizados.push(bloco.tipo);
    if (TIPOS_AVISO_FINAL.has(bloco.tipo)) avisoFinalRenderizado = true;
  }

  if (template.rodape?.ativo) {
    const rodape = String(template.rodape.texto ?? "").trim();
    if (textoUtil(rodape)) {
      linhas.push({ tipo: "rodape", linha: rodape });
      blocosRenderizados.push("rodape");
    } else {
      blocosIgnorados.push({ tipo: "rodape", motivo: "sem_dados" });
    }
  }

  const mensagem = montarMensagemAgrupada(linhas);
  fidelidadeObs.registrarTemplate("template_personalizado_renderer_saida", {
    ...contextoFidelidadeTemplate,
    oferta: ofertaOficial,
    templateTipo: "personalizado_renderer",
    canal: canalNormalizado,
    templateId: template.id || "",
    mensagem,
    blocosRenderizados,
    blocosIgnorados
  });

  return {
    ok: true,
    mensagem,
    templateIdUsado: template.id || "",
    blocosRenderizados,
    blocosIgnorados
  };
}

module.exports = {
  renderizarTemplatePersonalizado,
  textoUtil,
  formatarMoeda
};
