const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-copy-contextual-"));

const copy = require("../modules/copy-inteligente");
const { resolverTituloApresentacaoOferta, resolverEmojiSemanticoTitulo } = require("../utils/mensagens-ofertas");

const destinoIa = { id: "destino_copy_contextual", tipo: "whatsapp", tituloOferta: "ia" };
const planoIa = { recursos: { tituloIa: true, templatePersonalizado: true } };
const antiInterno = /\b(?:algoritmo|radar|contexto|analise|motor|classificacao|valor efetivo|desconto real|preco anterior mudou|valor reduzido|ponta do lapis|pare|pense|calma|avalie|compare antes|antes de decidir)\b/i;
const poesiaIa = /\b(?:ganhou possibilidade|aba imaginaria|entrou sem pedir licenca|prateleira.*abra espaco|curiosidade bem vestida|possibilidade nova|sala mais completa|bancada digital|ambiente ganhou)\b/i;
const perdaAcentoConhecida = /\b(?:nao|voce|voces|ja|calcado|calcados|pratica|praticas|proxima|proximas|combinacao|combinacoes|cabeca|licenca|espaco|espacos|rapida|rapidas|eletronico|eletronicos|acessorio|acessorios)\b/i;
const construcaoMecanica = /\b(?:preco interessante e|nesse valor, com)\b/i;

function ofertaBase(extra = {}) {
  return {
    id: "copy_contextual_base",
    engineOfertaId: "copy_contextual_base",
    clienteId: "workspace_copy_contextual",
    marketplace: "amazon",
    titulo: "Produto para oferta",
    nome: "Produto para oferta",
    categoria: "Diversos",
    precoAtual: 99.9,
    precoOriginal: "",
    cupom: "",
    linkOriginal: "https://produto.example/item",
    linkAfiliado: "https://go.example/item",
    imagem: "https://img.example/item.jpg",
    ...extra
  };
}

function resolverLocal(oferta, clienteId = oferta.clienteId || "workspace_copy_contextual") {
  return copy.resolverCopyLocalV2({ oferta, destino: destinoIa, clienteId, plano: planoIa });
}

const cesta = [
  ["bone", "Bone Nike Aba Curva", "Roupas e Moda Masculina", 59.9],
  ["blusa", "Blusa Feminina Manga Longa", "Roupas e Moda Feminina", 79.9],
  ["tenis", "Tenis Nike Revolution 7", "Tênis e Chinelos", 249.9],
  ["perfume", "Perfume Feminino Floral 100 ml", "Perfumaria, Farmácia e Beleza", 119.9],
  ["creme", "Creme Hidratante Profissional 1 kg", "Perfumaria, Farmácia e Beleza", 31.5],
  ["caixa", "Caixa de Som Bluetooth 35 W", "Audio TV", 99],
  ["tv", "Smart TV 4K 50 polegadas", "Audio TV", 1899],
  ["ssd", "SSD NVMe 1 TB", "Computadores e Notebook", 399],
  ["ferramenta", "Furadeira de Impacto 650 W", "Ferramentas", 219],
  ["cozinha", "Panela de Pressao 4,5 L", "Casa, Móveis e Decoração", 149],
  ["limpeza", "Robo Aspirador Inteligente", "Limpeza", 799],
  ["pesca", "Vara de Pesca Carbono 2 metros", "Pesca e Camping", 129],
  ["bebida", "Suco Integral de Uva 1 L", "Bebidas", 18.9],
  ["suplemento", "Whey Protein 900 g", "Esporte e Suplementos", 109],
  ["cupom_valido", "Smartphone Samsung Galaxy A56 256 GB", "Celulares e Smartphones", 1799, { cupom: "PROMO10", cupomTipo: "real", cupomConfirmado: true }],
  ["cupom_invalido", "Cabo USB-C 2 metros", "Eletrônicos", 39.9, { cupom: "APPLIED", cupomTipo: "real", cupomConfirmado: true }],
  ["desconto_valido", "Monitor Gamer 27 polegadas", "Gamer e Hardware", 899, { precoOriginal: 1099, descontoPercentual: 18, descontoPercentualOrigem: "marketplace" }],
  ["desconto_sintetico", "Notebook Lenovo 16 GB", "Computadores e Notebook", 2999, { precoOriginal: 3999 }],
  ["ambiguo", "Item Multiuso Modelo X200", "Diversos", 49.9],
  ["titulo_pobre", "Produto", "Diversos", 29.9]
];

const ofertasCesta = cesta.map(([chave, titulo, categoria, precoAtual, extra = {}], indice) => ofertaBase({
  id: `contextual_${chave}`,
  engineOfertaId: `contextual_${chave}`,
  titulo,
  nome: titulo,
  categoria,
  precoAtual,
  marketplace: ["amazon", "mercadolivre", "shopee", "aliexpress", "magalu", "kabum"][indice % 6],
  ...extra
}));

copy.limparCacheCopyLocalV2();
for (const oferta of ofertasCesta) {
  const snapshot = JSON.parse(JSON.stringify(oferta));
  const resultado = resolverLocal(oferta, `workspace_${oferta.id}`);
  assert.strictEqual(resultado.ok, true, `${oferta.id}: resolve frase local`);
  assert.ok(resultado.tituloIa.length <= 90, `${oferta.id}: respeita limite aproximado de caracteres`);
  assert.ok(resultado.tituloIa.trim().split(/\s+/).length <= 16, `${oferta.id}: respeita limite de palavras`);
  assert.ok(!antiInterno.test(copy.normalizar(resultado.tituloIa)), `${oferta.id}: nao publica linguagem interna/anti-conversao`);
  assert.deepStrictEqual(oferta, snapshot, `${oferta.id}: nao altera fatos da oferta`);
}

const cupomValido = copy.normalizarSinaisCopy(ofertasCesta[14]);
const cupomInvalido = copy.normalizarSinaisCopy(ofertasCesta[15]);
const descontoValido = copy.normalizarSinaisCopy(ofertasCesta[16]);
const descontoSintetico = copy.normalizarSinaisCopy(ofertasCesta[17]);
assert.strictEqual(cupomValido.cupom, true, "cupom comprovado e publicavel");
assert.strictEqual(cupomInvalido.cupom, false, "sentinela nao vira cupom");
assert.strictEqual(descontoValido.desconto, true, "desconto com proveniencia e publicavel");
assert.strictEqual(descontoSintetico.desconto, false, "De/Por sozinho nao cria desconto");

const brutoSemEvidencia = ofertaBase({ cupom: "PROMO10" });
const suspeito = ofertaBase({ cupom: "PROMO10", cupomTipo: "real", cupomConfirmado: true, cupomSuspeito: true });
const incompatibilidadeMonetaria = ofertaBase({ cupom: "PROMO10", cupomTipo: "real", cupomConfirmado: true, cupomMonetarioIncompativel: true });
assert.strictEqual(copy.normalizarSinaisCopy(brutoSemEvidencia).cupom, false, "codigo sem evidencia nao e publicavel");
assert.strictEqual(copy.normalizarSinaisCopy(suspeito).cupom, false, "cupom suspeito permanece bloqueado");
assert.strictEqual(copy.normalizarSinaisCopy(incompatibilidadeMonetaria).cupom, false, "cupom monetariamente incompativel permanece bloqueado");

const atributos = copy.extrairAtributosTituloCopyLocalV2("SSD NVMe X200 1 TB 35 W 4,5 L 12 unidades 50\"");
const atributosTexto = atributos.map(item => item.texto).join(" | ");
assert.ok(/1 TB/i.test(atributosTexto), "extrai capacidade explicita");
assert.ok(/35 W/i.test(atributosTexto), "extrai potencia explicita");
assert.ok(!/beneficio|rapido|potente/i.test(atributosTexto), "nao inventa beneficio tecnico");
assert.deepStrictEqual(copy.extrairAtributosTituloCopyLocalV2("Produto simples"), [], "titulo sem atributo nao ganha atributo");

const categoriaMaiuscula = resolverLocal(ofertaBase({ id: "categoria_maiuscula", categoria: "MODA", titulo: "Blusa casual" }), "workspace_categoria");
const categoriaMinuscula = resolverLocal(ofertaBase({ id: "categoria_minuscula", categoria: "moda", titulo: "Blusa casual" }), "workspace_categoria_2");
assert.strictEqual(categoriaMaiuscula.categoriaOficial, categoriaMinuscula.categoriaOficial, "aliases usam a mesma taxonomia oficial");
assert.strictEqual(categoriaMaiuscula.familia, categoriaMinuscula.familia, "capitalizacao nao muda familia");

const tituloCategoria = resolverTituloApresentacaoOferta(ofertasCesta[0], destinoIa, { clienteId: "workspace_precedencia", plano: planoIa });
const tituloCupom = resolverTituloApresentacaoOferta(ofertasCesta[14], destinoIa, { clienteId: "workspace_precedencia_cupom", plano: planoIa });
assert.strictEqual(tituloCategoria.fonte, copy.FONTE_COPY_LOCAL_V2, "categoria/preco generico chega ao motor contextual");
assert.strictEqual(tituloCupom.fonte, copy.FONTE_COPY_C3, "fato comercial forte e comprovado preserva C3");
assert.strictEqual(tituloCupom.intencao, "cupom", "C3 forte conserva intencao de cupom");
const tituloPersistido = resolverTituloApresentacaoOferta(ofertaBase({ tituloIa: "Gancho ja persistido" }), destinoIa, { plano: planoIa });
assert.strictEqual(tituloPersistido.titulo, "Gancho ja persistido", "titulo IA persistido continua prioritario");
const tituloOriginal = resolverTituloApresentacaoOferta(ofertaBase({ titulo: "Titulo original intacto" }), { ...destinoIa, tituloOferta: "original" }, { plano: planoIa });
assert.strictEqual(tituloOriginal.titulo, "Titulo original intacto", "modo original permanece intacto");

for (const canal of ["whatsapp", "telegram", "discord", "social"]) {
  const resultado = resolverTituloApresentacaoOferta(ofertasCesta[6], { id: `destino_${canal}`, tipo: canal, tituloOferta: "ia" }, { clienteId: `workspace_${canal}`, plano: planoIa });
  assert.strictEqual(resultado.usouTituloIa, true, `${canal}: usa o mesmo renderer central de titulo`);
  assert.ok(resultado.titulo, `${canal}: produz gancho local sem transporte externo`);
}

copy.limparCacheCopyLocalV2();
const resultados = [];
for (let i = 0; i < 500; i += 1) {
  const base = ofertasCesta[i % ofertasCesta.length];
  const oferta = {
    ...base,
    id: `abundancia_${i}`,
    engineOfertaId: `abundancia_${i}`,
    titulo: `${base.titulo} ${i + 1}`,
    nome: `${base.nome} ${i + 1}`
  };
  const resultado = resolverLocal(oferta, "workspace_abundancia");
  assert.strictEqual(resultado.ok, true, `abundancia ${i}: resolve`);
  assert.ok(!antiInterno.test(copy.normalizar(resultado.tituloIa)), `abundancia ${i}: frase segura`);
  resultados.push({ oferta, resultado, cenario: base.id });
}

const frequencias = new Map();
const porFamilia = {};
const porEmoji = {};
const estruturas = new Set();
let repeticoesConsecutivas = 0;
let fallbacks = 0;
let humor = 0;
let barradasPorVerdade = 0;
let precoDisponivel = 0;
let precoUsado = 0;
let atributoForteDisponivel = 0;
let atributoForteUsado = 0;
let candidatosC3BarradosContrato = 0;
const distribuicaoC3V2 = { copy_c3: 0, local_v2: 0 };
const porEstilo = {};
for (let i = 0; i < resultados.length; i += 1) {
  const { oferta, resultado, cenario } = resultados[i];
  frequencias.set(resultado.tituloIa, (frequencias.get(resultado.tituloIa) || 0) + 1);
  porFamilia[resultado.familia] = (porFamilia[resultado.familia] || 0) + 1;
  estruturas.add(copy.estruturaFraseCopyLocalV2(resultado.tituloIa));
  const emoji = resultado.tituloIa.match(/\p{Extended_Pictographic}/u)?.[0] ||
    resolverEmojiSemanticoTitulo(oferta, { familia: resultado.familia, subcontexto: resultado.subcontexto }).emoji;
  porEmoji[emoji] = (porEmoji[emoji] || 0) + 1;
  if (i > 0 && resultados[i - 1].resultado.tituloIa === resultado.tituloIa) repeticoesConsecutivas += 1;
  if (!resultado.fraseId || resultado.motivoFallback) fallbacks += 1;
  if (resultado.tituloIa.includes("😂")) humor += 1;
  const estilo = resultado.tom || (resultado.contextual ? "direta" : "banco_curado");
  porEstilo[estilo] = (porEstilo[estilo] || 0) + 1;
  const resultadoC3 = copy.resolverCopyC3({ oferta, destino: destinoIa, clienteId: "workspace_abundancia", plano: planoIa });
  const c3Forte = resultadoC3.ok === true && resultadoC3.confianca === "alta" &&
    ["resgate", "beneficio", "cupom", "desconto_real", "valor_efetivo"].includes(resultadoC3.intencao);
  distribuicaoC3V2[c3Forte ? "copy_c3" : "local_v2"] += 1;
  candidatosC3BarradosContrato += Number(resultadoC3.candidatosBarradosContrato || 0);
  if (Number(oferta.precoAtual) > 0) {
    precoDisponivel += 1;
    if (/\b(?:pre[cç]o|valor)\b/i.test(resultado.tituloIa)) precoUsado += 1;
  }
  const intencaoComercial = ["cupom", "economia", "resgate", "beneficio", "frete_gratis", "parcelamento"].includes(resultado.intencao);
  const atributoForte = !intencaoComercial ? resultado.atributos?.[0]?.texto : "";
  if (atributoForte) {
    atributoForteDisponivel += 1;
    if (copy.normalizar(resultado.tituloIa).includes(copy.normalizar(atributoForte))) atributoForteUsado += 1;
  }
  assert.ok(!poesiaIa.test(copy.normalizar(resultado.tituloIa)), `abundancia ${i}: sem poesia de IA`);
  assert.ok(!perdaAcentoConhecida.test(resultado.tituloIa), `abundancia ${i}: sem perda conhecida de acentuacao`);
  assert.ok(!construcaoMecanica.test(copy.normalizar(resultado.tituloIa)), `abundancia ${i}: sem construcao mecanica`);
  const tituloNormalizado = copy.normalizar(oferta.titulo);
  if (/\bcaixa de som\b/.test(tituloNormalizado)) {
    assert.ok(!resultado.tituloIa.includes("📺"), `abundancia ${i}: caixa de som nao usa emoji de TV`);
  }
  if (/\b(?:smart tv|televisao|tv)\b/.test(tituloNormalizado)) {
    assert.ok(!resultado.tituloIa.includes("🎧"), `abundancia ${i}: TV nao usa emoji de audio`);
  }
  if (/cupom_invalido/.test(cenario) && resultado.intencao !== "cupom") barradasPorVerdade += 1;
  if (/desconto_sintetico/.test(cenario) && resultado.intencao !== "economia") barradasPorVerdade += 1;
}

const frasesUnicas = frequencias.size;
const maiorRepeticao = Math.max(...frequencias.values());
assert.ok(frasesUnicas >= 100, `variedade perceptivel: ${frasesUnicas} frases unicas`);
assert.ok(estruturas.size >= 25, `variedade estrutural: ${estruturas.size} estruturas`);
assert.strictEqual(repeticoesConsecutivas, 0, "nao repete frase consecutivamente");
assert.ok(Object.keys(porEmoji).length >= 8, "emojis variam semanticamente");
assert.ok(barradasPorVerdade >= 40, "casos sem prova permanecem barrados ao longo da cesta");
const percentualHumor = Number(((humor / resultados.length) * 100).toFixed(1));
const percentualPreco = Number(((precoUsado / precoDisponivel) * 100).toFixed(1));
const percentualAtributo = Number(((atributoForteUsado / atributoForteDisponivel) * 100).toFixed(1));
assert.ok(percentualHumor >= 10 && percentualHumor <= 20, `humor perceptivel sem dominar: ${percentualHumor}%`);
assert.ok(percentualPreco >= 70, `preco/valor aproveitado quando disponivel: ${percentualPreco}%`);
assert.strictEqual(percentualAtributo, 100, "atributo forte nao comercial e aproveitado integralmente");

copy.limparCacheCopyLocalV2();
const workspaceA = resolverLocal(ofertaBase({ id: "isolamento_a", titulo: "Tenis casual", categoria: "Tênis e Chinelos" }), "workspace_isolamento_a");
const workspaceB = resolverLocal(ofertaBase({ id: "isolamento_a", titulo: "Tenis casual", categoria: "Tênis e Chinelos" }), "workspace_isolamento_b");
assert.ok(workspaceA.ok && workspaceB.ok, "duas workspaces resolvem independentemente");
assert.strictEqual(copy.ultimasFrasesCopyLocalV2("workspace_isolamento_a:calcados:familia").length, 1, "workspace A guarda historico proprio");
assert.strictEqual(copy.ultimasFrasesCopyLocalV2("workspace_isolamento_b:calcados:familia").length, 1, "workspace B guarda historico proprio");

const bancoResumo = copy.resumoBancoAssociativoV2();
const frasesInelegiveis = copy.BANCO_ASSOCIATIVO_V2.filter(item => copy.PADRAO_COPY_LOCAL_V2_INELEGIVEL.test(copy.normalizar(item.texto))).length;

const indicesUsados = new Set();
function selecionarAmostras(quantidade, predicado) {
  const selecionadas = [];
  for (let indice = 0; indice < resultados.length && selecionadas.length < quantidade; indice += 1) {
    if (indicesUsados.has(indice) || !predicado(resultados[indice], indice)) continue;
    indicesUsados.add(indice);
    selecionadas.push(resultados[indice]);
  }
  assert.strictEqual(selecionadas.length, quantidade, `seleciona ${quantidade} exemplos para revisao humana`);
  return selecionadas.map(({ oferta, resultado }) => ({
    produto: oferta.titulo,
    fatos: [resultado.intencao, ...(resultado.atributos || []).map(item => item.texto), `preco=${oferta.precoAtual}`],
    frase: resultado.tituloIa
  }));
}

const amostrasPrecoAtributo = selecionarAmostras(20, ({ resultado }) => {
  const atributo = resultado.atributos?.[0]?.texto;
  return Boolean(atributo && copy.normalizar(resultado.tituloIa).includes(copy.normalizar(atributo)) && /\b(?:pre[cç]o|valor)\b/i.test(resultado.tituloIa));
});
const amostrasModaBeleza = selecionarAmostras(15, ({ resultado }) => ["moda", "calcados", "beleza"].includes(resultado.familia));
const amostrasCasaEletronicos = selecionarAmostras(15, ({ resultado }) => ["casa", "limpeza", "audio_tv", "eletronicos", "bebidas"].includes(resultado.familia));
const amostrasFerramentasSetup = selecionarAmostras(10, ({ resultado }) => ["ferramentas", "gamer", "computadores"].includes(resultado.familia));
const amostrasHumor = selecionarAmostras(10, ({ resultado }) => resultado.tom === "humor" && resultado.tituloIa.includes("😂"));

const produtosCupom = [
  ["Boné Nike Aba Curva", "Roupas e Moda Masculina"], ["Perfume Feminino Floral 100 ml", "Perfumaria, Farmácia e Beleza"],
  ["Tênis Nike Revolution 7", "Tênis e Chinelos"], ["Smartphone Samsung Galaxy A56 256 GB", "Celulares e Smartphones"],
  ["Caixa de Som Bluetooth 35 W", "Audio TV"], ["Panela de Pressão 4,5 L", "Casa, Móveis e Decoração"],
  ["Monitor Gamer 27 polegadas", "Gamer e Hardware"], ["Furadeira de Impacto 650 W", "Ferramentas"],
  ["SSD NVMe 1 TB", "Computadores e Notebook"], ["Creme Hidratante Profissional 1 kg", "Perfumaria, Farmácia e Beleza"]
];
const amostrasCupom = produtosCupom.map(([titulo, categoria], indice) => {
  const oferta = ofertaBase({
    id: `amostra_cupom_${indice}`,
    engineOfertaId: `amostra_cupom_${indice}`,
    titulo,
    nome: titulo,
    tituloFactual: titulo,
    categoria,
    cupom: `OFERTA${indice + 10}`,
    cupomTipo: "real",
    cupomConfirmado: true
  });
  const resultado = resolverTituloApresentacaoOferta(oferta, destinoIa, { clienteId: `workspace_amostra_cupom_${indice}`, plano: planoIa });
  assert.strictEqual(resultado.fonte, copy.FONTE_COPY_C3, `cupom ${indice}: usa C3 factual`);
  assert.strictEqual(resultado.intencao, "cupom", `cupom ${indice}: preserva intencao forte`);
  assert.ok(/cupom/i.test(resultado.titulo), `cupom ${indice}: frase usa o sinal validado`);
  return { produto: titulo, fatos: ["cupom validado", categoria], frase: resultado.titulo };
});

const amostrasEmoji = resultados
  .filter(({ oferta, resultado }) => /\b(?:caixa de som|smart tv|televisao|tv)\b/.test(copy.normalizar(oferta.titulo)) && resultado.tom !== "humor")
  .slice(0, 10)
  .map(({ oferta, resultado }) => ({ produto: oferta.titulo, fatos: [resultado.familia, "emoji semantico"], frase: resultado.tituloIa }));
const amostrasMecanicas = resultados
  .filter(({ resultado }) => resultado.tom === "direta" && resultado.atributos?.[0]?.texto && /\b(?:pre[cç]o|valor)\b/i.test(resultado.tituloIa))
  .slice(0, 10)
  .map(({ oferta, resultado }) => ({ produto: oferta.titulo, fatos: resultado.atributos.map(item => item.texto), frase: resultado.tituloIa }));
const produtosDesconto = [
  ["Monitor Gamer 27 polegadas", "Gamer e Hardware"], ["Smart TV 4K 50 polegadas", "Audio TV"],
  ["Notebook Lenovo 16 GB", "Computadores e Notebook"], ["SSD NVMe 1 TB", "Computadores e Notebook"],
  ["Perfume Feminino Floral 100 ml", "Perfumaria, Farmácia e Beleza"], ["Tênis Nike Revolution 7", "Tênis e Chinelos"],
  ["Furadeira de Impacto 650 W", "Ferramentas"], ["Panela de Pressão 4,5 L", "Casa, Móveis e Decoração"],
  ["Caixa de Som Bluetooth 35 W", "Audio TV"], ["Smartphone Samsung Galaxy A56 256 GB", "Celulares e Smartphones"]
];
const amostrasDesconto = produtosDesconto.map(([titulo, categoria], indice) => {
  const oferta = ofertaBase({
    id: `amostra_desconto_${indice}`,
    engineOfertaId: `amostra_desconto_${indice}`,
    titulo,
    nome: titulo,
    tituloFactual: titulo,
    categoria,
    precoAtual: 100 + indice,
    precoOriginal: 150 + indice,
    descontoPercentual: 20 + indice,
    descontoPercentualOrigem: "marketplace"
  });
  const resultado = resolverTituloApresentacaoOferta(oferta, destinoIa, { clienteId: `workspace_amostra_desconto_${indice}`, plano: planoIa });
  assert.strictEqual(resultado.fonte, copy.FONTE_COPY_C3, `desconto ${indice}: usa C3 factual`);
  assert.strictEqual(resultado.intencao, "desconto_real", `desconto ${indice}: preserva proveniencia`);
  assert.ok(!antiInterno.test(copy.normalizar(resultado.titulo)), `desconto ${indice}: sem linguagem interna`);
  return { produto: titulo, fatos: [`${20 + indice}% OFF`, "origem marketplace"], frase: resultado.titulo };
});
const amostras30Microcuradoria = {
  emoji_semantico: amostrasEmoji,
  ordem_natural: amostrasMecanicas,
  desconto_humano: amostrasDesconto
};
assert.strictEqual(Object.values(amostras30Microcuradoria).flat().length, 30, "microcuradoria gera 30 amostras finais");

const amostras80 = {
  preco_quantidade_atributo: amostrasPrecoAtributo,
  moda_beleza: amostrasModaBeleza,
  casa_eletronicos: amostrasCasaEletronicos,
  ferramentas_setup: amostrasFerramentasSetup,
  cupom: amostrasCupom,
  humor: amostrasHumor
};
const listaAmostras80 = Object.values(amostras80).flat();
assert.strictEqual(listaAmostras80.length, 80, "revisao humana recebe exatamente 80 exemplos");
for (const [indice, amostra] of listaAmostras80.entries()) {
  assert.ok(amostra.frase && amostra.frase.length <= 90, `amostra ${indice + 1}: curta e direta`);
  assert.ok(!antiInterno.test(copy.normalizar(amostra.frase)), `amostra ${indice + 1}: sem linguagem interna`);
  assert.ok(!poesiaIa.test(copy.normalizar(amostra.frase)), `amostra ${indice + 1}: sem poesia de IA`);
  assert.ok(!perdaAcentoConhecida.test(amostra.frase), `amostra ${indice + 1}: sem perda conhecida de acentuacao`);
}

const relatorio = {
  total: resultados.length,
  frasesUnicas,
  estruturasUnicas: estruturas.size,
  porFamilia,
  porEmoji,
  repeticoesConsecutivas,
  maiorRepeticao,
  fallbacks,
  humor,
  percentualHumor,
  precoDisponivel,
  precoUsado,
  percentualPreco,
  atributoForteDisponivel,
  atributoForteUsado,
  percentualAtributo,
  porEstilo,
  distribuicaoC3V2,
  candidatosC3BarradosContrato,
  barradasPorVerdade,
  construcoesBancoPreservadas: bancoResumo.total,
  frasesAntiConversaoInelegiveis: frasesInelegiveis,
  amostras80,
  amostras30Microcuradoria
};

console.log(`COPY-CONTEXTUAL-REPORT ${JSON.stringify(relatorio)}`);
console.log("copy-contextual-local.test.js OK");
