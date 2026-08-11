function texto(valor = "") {
  return String(valor ?? "").trim();
}

const {
  normalizarCuponsSemanticos
} = require("../radar/cupom-semantico");

function normalizarComparacao(valor = "") {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function chaveCupom(valor = "") {
  return normalizarComparacao(valor).replace(/\s+/g, "");
}

function chaveUrl(valor = "") {
  return texto(valor).replace(/#.*$/, "").trim();
}

function valorLink(item = {}) {
  if (typeof item === "string") return texto(item);
  if (!item || typeof item !== "object") return "";
  return texto(item.urlOptimus || item.urlAfiliada || item.afiliado || item.resolvido || item.original || item.link || item.url || "");
}

function itemLink(item = {}, tipoPadrao = "produto") {
  if (typeof item === "string") {
    const url = texto(item);
    return url ? { tipo: tipoPadrao, original: url, resolvido: "", afiliado: "" } : null;
  }
  if (!item || typeof item !== "object") return null;
  const url = valorLink(item);
  if (!url) return null;
  return {
    ...item,
    tipo: texto(item.tipo || item.papel || tipoPadrao),
    original: texto(item.original || item.urlOriginal || item.link || item.url || url),
    resolvido: texto(item.resolvido || item.urlOptimus || ""),
    afiliado: texto(item.afiliado || item.urlAfiliada || "")
  };
}

function listaLinksOcorrencias(valores = [], tipoPadrao = "produto") {
  const resultado = [];
  for (const [indice, valor] of (Array.isArray(valores) ? valores : []).entries()) {
    const item = itemLink(valor, tipoPadrao);
    if (!item) continue;
    const ordem = Number(item.ordemCaptura || item.ordem || indice + 1) || (indice + 1);
    resultado.push({
      ...item,
      ordemCaptura: ordem,
      ocorrenciaId: texto(item.ocorrenciaId || item.idOcorrencia || `link:${tipoPadrao}:${ordem}:${indice + 1}`)
    });
  }
  return resultado;
}

function partesCupom(valor = "") {
  const entrada = texto(valor);
  if (!entrada) return [];
  return entrada
    .split(/\s+(?:ou|e)\s+|\s*\+\s*|[,;/|]+/i)
    .map(texto)
    .filter(Boolean);
}

function tokenMoedasComoCupom(valor = "") {
  const chave = chaveCupom(valor);
  if (!chave) return false;
  return chave === "moeda" ||
    chave === "moedas" ||
    chave === "coin" ||
    chave === "coins" ||
    /^\d{1,6}(?:moeda|moedas|coin|coins)(?:no)?(?:app|aplicativo)?$/.test(chave);
}

function cupomBloqueado(valor = "") {
  const chave = chaveCupom(valor);
  if (tokenMoedasComoCupom(valor)) return true;
  return !chave || [
    "resgate",
    "produto",
    "modocupom",
    "tipocupom",
    "linksresgate",
    "linksproduto",
    "excelente",
    "otimo",
    "bom",
    "boa",
    "regular",
    "medio",
    "media",
    "ruim",
    "baixo",
    "baixa",
    "alto",
    "alta",
    "copiado",
    "cupomcopiado",
    "semcupom",
    "todos",
    "cupons",
    "desta",
    "pagina",
    "http",
    "https",
    "www",
    "com",
    "br",
    "combr",
    "moeda",
    "moedas",
    "coin",
    "coins",
    "undefined",
    "null",
    "nan"
  ].includes(chave);
}

function cupomComGrafiaPreferivel(atual = "", candidato = "") {
  const a = texto(atual);
  const b = texto(candidato);
  if (!a) return b;
  if (!b) return a;
  const letrasAtual = a.replace(/[^A-Za-z]/g, "");
  const letrasCandidato = b.replace(/[^A-Za-z]/g, "");
  const atualMaiusculo = letrasAtual && letrasAtual === letrasAtual.toUpperCase();
  const candidatoMaiusculo = letrasCandidato && letrasCandidato === letrasCandidato.toUpperCase();
  if (!atualMaiusculo && candidatoMaiusculo) return b;
  return a;
}

function normalizarCuponsApresentacao(...fontes) {
  const resultado = [];
  const indices = new Map();

  for (const fonte of fontes) {
    const valores = Array.isArray(fonte) ? fonte : [fonte];
    for (const valor of valores) {
      for (const parte of normalizarCuponsSemanticos(valor)) {
        const cupom = texto(parte);
        const chave = chaveCupom(cupom);
        if (cupomBloqueado(cupom)) continue;
        if (indices.has(chave)) {
          const indice = indices.get(chave);
          resultado[indice] = cupomComGrafiaPreferivel(resultado[indice], cupom);
          continue;
        }
        indices.set(chave, resultado.length);
        resultado.push(cupom);
      }
    }
  }

  return resultado;
}

function instrucaoTecnicaOuVazia(instrucao = "") {
  const normalizada = normalizarComparacao(instrucao);
  return !normalizada || [
    "resgate",
    "produto",
    "modocupom",
    "tipocupom",
    "linksresgate",
    "linksproduto"
  ].includes(normalizada.replace(/\s+/g, ""));
}

function instrucaoRedundanteCupom(instrucao = "", cupons = []) {
  const normalizada = normalizarComparacao(instrucao);
  if (!normalizada) return true;

  return cupons.some(cupom => {
    const codigo = normalizarComparacao(cupom);
    if (!codigo) return false;

    const padroesRedundantes = [
      `cupom ${codigo}`,
      `codigo ${codigo}`,
      `cod ${codigo}`,
      `use ${codigo}`,
      `use o cupom ${codigo}`,
      `utilize ${codigo}`,
      `utilize o cupom ${codigo}`
    ];

    return padroesRedundantes.includes(normalizada);
  });
}

function normalizarInstrucaoApresentacao(instrucao = "", cupons = []) {
  const valor = texto(instrucao);
  if (!valor || instrucaoTecnicaOuVazia(valor)) return "";
  if (cupons.length && instrucaoRedundanteCupom(valor, cupons)) return "";
  return valor;
}

function marketplaceAliExpress(...valores) {
  return valores.some(valor => normalizarComparacao(valor).replace(/\s+/g, "") === "aliexpress");
}

function extrairMoedasApresentacao(...fontes) {
  for (const fonte of fontes) {
    const valor = texto(fonte);
    if (!valor || !/\b(?:moeda|moedas|coins?)\b/i.test(valor)) continue;
    const match = valor.match(/(?:\+\s*)?(\d{1,6})\s*(?:moeda|moedas|coins?)\b/i);
    if (match) return `${match[1]} moedas no APP`;
    return "Moedas no APP";
  }
  return "";
}

function listaTextoComercialUnica(...fontes) {
  const resultado = [];
  const vistos = new Set();
  for (const fonte of fontes.flat()) {
    const item = texto(fonte);
    const chave = normalizarComparacao(item);
    if (!item || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(item);
  }
  return resultado;
}

function separarLinksApresentacao(dados = {}) {
  const linksComerciais = listaLinksOcorrencias(dados.linksComerciais, "produto");
  const temLinksComerciais = linksComerciais.length > 0;
  const linksProduto = temLinksComerciais ? [] : listaLinksOcorrencias(dados.linksProduto, "produto");
  const linksResgate = temLinksComerciais ? [] : listaLinksOcorrencias(dados.linksResgate, "resgate");
  const linksOutros = [];

  for (const item of linksComerciais) {
    const tipo = normalizarComparacao(item.tipo);
    if (["resgate", "cupom"].includes(tipo)) {
      linksResgate.push(itemLink(item, "resgate"));
    } else if (["produto", "afiliado"].includes(tipo)) {
      linksProduto.push(itemLink(item, "produto"));
    } else {
      linksOutros.push(item);
    }
  }

  const linkTopo = texto(dados.linkAfiliado || dados.linkFinal || dados.link || dados.url || "");
  if (linkTopo && !linksComerciais.length && !linksProduto.length && !linksResgate.length) {
    linksProduto.push({ tipo: "produto", original: linkTopo, resolvido: "", afiliado: linkTopo });
  }

  const produtoUnico = listaLinksOcorrencias(linksProduto, "produto");
  const resgateUnico = listaLinksOcorrencias(linksResgate, "resgate");

  const linkProduto = valorLink(produtoUnico[0]);
  const linkResgate = valorLink(resgateUnico[0]);

  return {
    linksProduto: produtoUnico,
    linksResgate: resgateUnico,
    linksComerciais: temLinksComerciais ? linksComerciais : listaLinksOcorrencias([...produtoUnico, ...resgateUnico, ...linksOutros], "produto"),
    linkProduto,
    linkResgate
  };
}

function primeiroLinkApresentacaoPorTipo(links = [], tipos = []) {
  const tiposNormalizados = new Set(tipos.map(tipo => normalizarComparacao(tipo).replace(/^link\s+/, "")));
  for (const item of Array.isArray(links) ? links : []) {
    const tipo = normalizarComparacao(item?.tipo || item?.papel || "").replace(/^link\s+/, "");
    if (tiposNormalizados.has(tipo)) return valorLink(item);
  }
  return "";
}

function normalizarApresentacaoComercial(dados = {}, origem = {}) {
  const aliExpress = marketplaceAliExpress(dados.marketplace, origem.marketplace);
  const cupons = normalizarCuponsApresentacao(
    origem.cupons,
    origem.codigosCupom,
    origem.cupom,
    origem.codigoCupom,
    origem.cupomCodigo,
    dados.cupons,
    dados.codigosCupom,
    dados.cupom,
    dados.codigoCupom,
    dados.cupomCodigo
  );
  const cupom = cupons.join(" ou ");
  const instrucaoCupomBase = normalizarInstrucaoApresentacao(
    dados.instrucaoCupom || origem.instrucaoCupom || "",
    cupons
  );
  const instrucaoCupom = instrucaoCupomBase;
  const moedasAliExpress = aliExpress
    ? extrairMoedasApresentacao(
      dados.moedasTexto,
      origem.moedasTexto,
      dados.beneficioTexto,
      origem.beneficioTexto,
      dados.beneficioExtra,
      origem.beneficioExtra,
      dados.avisoCupom,
      origem.avisoCupom
    )
    : "";
  const links = separarLinksApresentacao({ ...origem, ...dados });
  const linkPrincipal = links.linkProduto || texto(dados.linkAfiliado || dados.linkFinal || dados.link || origem.linkAfiliado || origem.linkFinal || origem.link || "");
  const linkApp = texto(dados.linkApp || origem.linkApp || primeiroLinkApresentacaoPorTipo(links.linksComerciais, ["app"]));
  const linkPc = texto(dados.linkPc || origem.linkPc || primeiroLinkApresentacaoPorTipo(links.linksComerciais, ["pc"]));
  const linkMoedas = texto(dados.linkMoedas || origem.linkMoedas || primeiroLinkApresentacaoPorTipo(links.linksComerciais, ["moedas"]));

  return {
    ...dados,
    cupom,
    codigoCupom: cupom,
    cupomCodigo: cupom,
    cupomTexto: cupom,
    cupons,
    codigosCupom: [...cupons],
    instrucaoCupom,
    condicoes: listaTextoComercialUnica(dados.condicoes, origem.condicoes, moedasAliExpress),
    linksComerciais: links.linksComerciais,
    linksProduto: links.linksProduto,
    linksResgate: links.linksResgate,
    linkProduto: links.linkProduto || linkPrincipal,
    linkResgate: links.linkResgate,
    linkApp,
    linkPc,
    linkMoedas,
    linkAfiliado: linkPrincipal,
    linkFinal: dados.linkFinal || linkPrincipal,
    link: dados.link || linkPrincipal
  };
}

module.exports = {
  normalizarApresentacaoComercial,
  normalizarCuponsApresentacao,
  normalizarInstrucaoApresentacao,
  separarLinksApresentacao
};
