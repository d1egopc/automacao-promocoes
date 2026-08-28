const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-copy-c3-"));
process.env.DATA_DIR = dataDir;

const copy = require("../modules/copy-inteligente");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

const destinoIa = { id: "destino_c3", tipo: "whatsapp", tituloOferta: "ia" };
const planoC3 = { recursos: { tituloIa: true, templatePersonalizado: true, copyC3Factual: true } };

function ofertaBase(extra = {}) {
  return {
    id: "oferta_c3_base",
    engineOfertaId: "engine_c3_base",
    clienteId: "cliente_c3",
    marketplace: "mercadolivre",
    titulo: "Produto comercial capturado",
    nome: "Produto comercial capturado",
    tituloFactual: "Lava e Seca Philco 10kg",
    categoria: "Eletrodomésticos",
    preco: 150,
    precoAtual: 150,
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-1-lava-e-seca-philco",
    linkAfiliado: "https://meli.la/afiliado",
    linkResgate: "",
    imagem: "https://img.example/produto.jpg",
    ...extra
  };
}

function resolver(oferta) {
  return copy.resolverCopyC3({
    oferta,
    destino: destinoIa,
    clienteId: oferta.clienteId || "cliente_c3",
    plano: planoC3
  });
}

function renderizar(oferta) {
  return montarMensagemOferta(oferta, {
    clienteId: oferta.clienteId || "cliente_c3",
    destino: destinoIa,
    plano: planoC3
  });
}

function snapshotCamposProtegidos(oferta) {
  return {
    titulo: oferta.titulo,
    tituloFactual: oferta.tituloFactual,
    categoria: oferta.categoria,
    preco: oferta.preco,
    precoAtual: oferta.precoAtual,
    precoOriginal: oferta.precoOriginal,
    cupom: oferta.cupom,
    linkOriginal: oferta.linkOriginal,
    linkAfiliado: oferta.linkAfiliado,
    linkResgate: oferta.linkResgate,
    imagem: oferta.imagem,
    marketplace: oferta.marketplace
  };
}

function assertSemTermosProibidos(saida) {
  const texto = String(saida || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const termo of copy.TERMOS_PROIBIDOS_COPY_C3) {
    assert.ok(!texto.includes(termo), `C3 nao deve afirmar sem prova: ${termo}`);
  }
}

function normalizarTextoTeste(valor = "") {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function assertNaoRepeteDadoTemplate(gancho = "", dados = []) {
  const normalizado = normalizarTextoTeste(gancho);
  for (const dado of dados) {
    const texto = normalizarTextoTeste(dado);
    if (!texto) continue;
    assert.ok(!normalizado.includes(texto), `gancho C3 nao deve repetir dado do template: ${dado}`);
  }
}

function distribuicaoFrases(intencao, montarOferta) {
  const histograma = {};
  for (let i = 0; i < 10; i += 1) {
    const resultado = resolver(montarOferta(i));
    assert.strictEqual(resultado.intencao, intencao, `intencao esperada em amostra ${i}`);
    histograma[resultado.fraseId] = (histograma[resultado.fraseId] || 0) + 1;
  }
  return histograma;
}

function assertDistribuicaoRazoavel(histograma, mensagem) {
  const contagens = Object.values(histograma);
  assert.ok(contagens.length >= 4, `${mensagem}: deve usar pelo menos 4 frases em 10 ofertas`);
  assert.ok(Math.max(...contagens) <= 5, `${mensagem}: nenhuma frase deve concentrar mais de 5/10`);
}

function assertNaoUsaIntencao(oferta, intencao, mensagem) {
  const resultado = resolver(oferta);
  assert.notStrictEqual(resultado.intencao, intencao, mensagem);
  assert.notStrictEqual(resultado.fatoUsado, `${intencao}_confirmado`, mensagem);
  assert.ok(!String(resultado.fatoUsado || "").startsWith(intencao), mensagem);
  return resultado;
}

const cupom = resolver(ofertaBase({ id: "c3_cupom", engineOfertaId: "c3_cupom", cupom: "PROMO10", precoOriginal: "" }));
assert.strictEqual(cupom.ok, true, "cupom confirmado gera gancho C3");
assert.strictEqual(cupom.intencao, "cupom");
assert.strictEqual(cupom.fatoUsado, "cupom_confirmado");
assert.ok(/cupom|compra|olhada|oferta/i.test(cupom.ganchoComercialC3), "gancho interpreta o contexto de cupom");
assert.ok(!/confirmad|identificad|codigo|c[oó]digo/i.test(cupom.ganchoComercialC3), "cupom nao soa como log tecnico");
assertNaoRepeteDadoTemplate(cupom.ganchoComercialC3, ["PROMO10"]);
assert.ok(!/%|R\$/i.test(cupom.ganchoComercialC3), "cupom sem desconto numerico nao inventa percentual/valor");
assertSemTermosProibidos(cupom.ganchoComercialC3);

const desconto = resolver(ofertaBase({ id: "c3_desconto", engineOfertaId: "c3_desconto", precoOriginal: 200, precoAtual: 150, preco: 150, cupom: "" }));
assert.strictEqual(desconto.ok, true, "desconto real gera gancho C3");
assert.strictEqual(desconto.intencao, "desconto_real");
assert.strictEqual(desconto.fatoUsado, "desconto_real_comprovado");
assert.ok(/valor|preco|desconto|De\/Por|conta|diferenca/i.test(desconto.ganchoComercialC3), "gancho interpreta desconto real");
assertNaoRepeteDadoTemplate(desconto.ganchoComercialC3, ["R$ 150,00", "R$ 200,00", "R$ 50,00", "25%"]);
assertSemTermosProibidos(desconto.ganchoComercialC3);

const precoSemDesconto = resolver(ofertaBase({ id: "c3_preco", engineOfertaId: "c3_preco", tituloFactual: "", categoria: "Diversos", precoOriginal: "", precoAtual: 89, preco: 89, cupom: "" }));
assert.strictEqual(precoSemDesconto.ok, true, "preco sem desconto gera gancho factual");
assert.strictEqual(precoSemDesconto.intencao, "preco");
assert.ok(/preco|valor|comparar|conta|olhada|segundos/i.test(precoSemDesconto.ganchoComercialC3), "gancho interpreta preco oficial");
assertNaoRepeteDadoTemplate(precoSemDesconto.ganchoComercialC3, ["R$ 89,00"]);
assert.ok(!/desconto|cupom|beneficio|resgate/i.test(precoSemDesconto.ganchoComercialC3), "preco simples nao inventa fato comercial");

const beneficio = assertNaoUsaIntencao(
  ofertaBase({ id: "c3_beneficio", engineOfertaId: "c3_beneficio", beneficioTexto: "cashback confirmado", cupom: "", precoOriginal: "" }),
  "beneficio",
  "beneficio textual nao prova beneficio confirmado na C3 V1"
);

const resgate = assertNaoUsaIntencao(
  ofertaBase({ id: "c3_resgate", engineOfertaId: "c3_resgate", linkResgate: "https://resgate.example/app", cupom: "", precoOriginal: "" }),
  "resgate",
  "linkResgate sozinho nao prova resgate confirmado na C3 V1"
);

const valorEfetivo = resolver(ofertaBase({
  id: "c3_valor_efetivo",
  engineOfertaId: "c3_valor_efetivo",
  precoOriginal: "",
  precoAtual: 150,
  valorEfetivo: 120,
  valorEfetivoOrigem: "cupom_valor_fixo",
  valorEfetivoComprovado: true,
  cupom: ""
}));
assert.strictEqual(valorEfetivo.ok, true, "valor efetivo comprovado gera gancho C3");
assert.strictEqual(valorEfetivo.intencao, "valor_efetivo");
assertNaoRepeteDadoTemplate(valorEfetivo.ganchoComercialC3, ["R$ 120,00", "R$ 150,00"]);
assert.ok(/conta|condicao|valor|vitrine|avaliar/i.test(valorEfetivo.ganchoComercialC3), "valor efetivo deve ser interpretado sem repetir numero");

const categoriaHumana = resolver(ofertaBase({
  id: "c3_categoria_humana",
  engineOfertaId: "c3_categoria_humana",
  tituloFactual: "Creme renovador para os pes",
  categoria: "Perfumaria, Farmácia e Beleza",
  preco: "",
  precoAtual: "",
  precoOriginal: "",
  cupom: ""
}));
assert.strictEqual(categoriaHumana.ok, true, "categoria conhecida pode gerar gancho C3");
assert.strictEqual(categoriaHumana.intencao, "categoria");
assert.strictEqual(categoriaHumana.categoriaOficial, "Perfumaria, Farmácia e Beleza", "categoria operacional e preservada");
assertNaoRepeteDadoTemplate(categoriaHumana.ganchoComercialC3, ["Perfumaria, Farmácia e Beleza"]);
assert.ok(/beleza|cuidado|tipo de compra|radar/i.test(categoriaHumana.ganchoComercialC3), "categoria usa apresentacao humana");

const categoriaSemApresentacao = resolver(ofertaBase({
  id: "c3_categoria_sem_apresentacao",
  engineOfertaId: "c3_categoria_sem_apresentacao",
  tituloFactual: "Produto de categoria nova",
  categoria: "Categoria Experimental Interna",
  preco: 77,
  precoAtual: 77,
  precoOriginal: "",
  cupom: ""
}));
assert.strictEqual(categoriaSemApresentacao.ok, true, "categoria sem apresentacao cai para fato seguro seguinte");
assert.notStrictEqual(categoriaSemApresentacao.intencao, "categoria", "taxonomia desconhecida nao vira gancho bruto");
assertNaoRepeteDadoTemplate(categoriaSemApresentacao.ganchoComercialC3, ["Categoria Experimental Interna"]);

for (const intencao of ["cupom", "desconto_real", "valor_efetivo", "marca_preco", "categoria", "preco", "fallback"]) {
  const pool = copy.FRASES_COPY_C3[intencao];
  assert.ok(pool.length >= 6, `${intencao}: pool ativo deve ter variedade minima`);
  for (const frase of pool) {
    assert.ok(!/confirmad|identificad|fato confirmado/i.test(frase.texto), `${frase.id}: frase ativa nao deve soar como sistema`);
    assert.ok(!/cupom:\s|\bR\$\b/i.test(frase.texto), `${frase.id}: frase ativa nao deve reproduzir linha do template`);
  }
}

assertDistribuicaoRazoavel(distribuicaoFrases("preco", i => ofertaBase({
  id: `c3_dist_preco_${i}`,
  engineOfertaId: `c3_dist_preco_${i}`,
  tituloFactual: "",
  categoria: "Diversos",
  precoOriginal: "",
  precoAtual: 50 + i,
  preco: 50 + i,
  cupom: ""
})), "preco");

assertDistribuicaoRazoavel(distribuicaoFrases("cupom", i => ofertaBase({
  id: `c3_dist_cupom_${i}`,
  engineOfertaId: `c3_dist_cupom_${i}`,
  precoOriginal: "",
  cupom: `CUPOM${i}`
})), "cupom");

assertDistribuicaoRazoavel(distribuicaoFrases("desconto_real", i => ofertaBase({
  id: `c3_dist_desconto_${i}`,
  engineOfertaId: `c3_dist_desconto_${i}`,
  precoOriginal: 150 + i,
  precoAtual: 100 + i,
  preco: 100 + i,
  cupom: ""
})), "desconto real");

for (const [nome, extra] of [
  ["resgate_texto_incerto", { resgate: "consulte condicoes de resgate" }],
  ["resgate_link_sozinho", { linkResgate: "https://resgate.example/oferta" }],
  ["resgate_link_app_sozinho", { linkApp: "app://produto/123" }],
  ["resgate_deeplink_sozinho", { deepLink: "app://produto/123" }]
]) {
  assertNaoUsaIntencao(
    ofertaBase({ id: `c3_neg_${nome}`, engineOfertaId: `c3_neg_${nome}`, cupom: "", precoOriginal: "", ...extra }),
    "resgate",
    `${nome}: nao deve usar resgate_confirmado`
  );
}

for (const [nome, extra] of [
  ["beneficio_pode_ter", { beneficioTexto: "pode ter cashback" }],
  ["beneficio_ate_valor", { beneficio: "ate R$50" }],
  ["beneficio_aviso_generico", { avisoCupom: "beneficio disponivel na pagina" }],
  ["beneficio_cashback_sujeito", { beneficioExtra: "cashback sujeito as regras" }]
]) {
  assertNaoUsaIntencao(
    ofertaBase({ id: `c3_neg_${nome}`, engineOfertaId: `c3_neg_${nome}`, cupom: "", precoOriginal: "", ...extra }),
    "beneficio",
    `${nome}: nao deve usar beneficio_confirmado`
  );
}

for (const [nome, extra] of [
  ["valor_preco_app", { valorEfetivo: 80, valorEfetivoOrigem: "preco_app", valorEfetivoComprovado: true }],
  ["valor_preco_generico", { valorEfetivo: 80, valorEfetivoOrigem: "preco", valorEfetivoComprovado: true }],
  ["valor_origem_desconhecida", { valorEfetivo: 80, valorEfetivoOrigem: "origem_desconhecida", valorEfetivoComprovado: true }],
  ["valor_sem_comprovacao", { valorEfetivo: 80, valorEfetivoOrigem: "cupom_valor_fixo" }]
]) {
  assertNaoUsaIntencao(
    ofertaBase({ id: `c3_neg_${nome}`, engineOfertaId: `c3_neg_${nome}`, cupom: "", precoOriginal: "", precoAtual: 100, preco: 100, ...extra }),
    "valor_efetivo",
    `${nome}: nao deve usar valor_efetivo_comprovado`
  );
}

for (const [nome, cupomTexto] of [
  ["tem_cupom", "tem cupom"],
  ["cupom_disponivel", "cupom disponivel"],
  ["consulte_cupom", "consulte cupom"],
  ["ate_percentual", "ate 20%"],
  ["sem_cupom", "sem cupom"]
]) {
  assertNaoUsaIntencao(
    ofertaBase({ id: `c3_neg_${nome}`, engineOfertaId: `c3_neg_${nome}`, cupom: cupomTexto, precoOriginal: "" }),
    "cupom",
    `${nome}: texto generico nao deve virar cupom confirmado`
  );
}

const slogan = ofertaBase({
  id: "c3_slogan",
  engineOfertaId: "c3_slogan",
  titulo: "ROUPA QUE JA SAI SECA E LUXO",
  nome: "ROUPA QUE JA SAI SECA E LUXO",
  tituloFactual: "Lava e Seca Philco 10kg",
  categoria: "Eletrodomésticos",
  preco: 149,
  precoAtual: 149,
  precoOriginal: 199,
  cupom: "PROMO50"
});
const snapshotSlogan = snapshotCamposProtegidos(slogan);
const c3Slogan = resolver(slogan);
assert.strictEqual(c3Slogan.ok, true, "C3 usa fatos oficiais mesmo com slogan Radar no titulo");
assert.notStrictEqual(c3Slogan.ganchoComercialC3, "ROUPA QUE JA SAI SECA E LUXO", "slogan nao vira gancho factual");
assert.deepStrictEqual(snapshotCamposProtegidos(slogan), snapshotSlogan, "C3 nao muta fatos da oferta com slogan");

for (const saida of [cupom, desconto, precoSemDesconto, beneficio, resgate, valorEfetivo, c3Slogan]) {
  assertSemTermosProibidos(saida.ganchoComercialC3);
}

const protegida = ofertaBase({
  id: "c3_protecao",
  engineOfertaId: "c3_protecao",
  cupom: "CUPOM10",
  precoOriginal: 180,
  precoAtual: 120,
  linkResgate: "https://resgate.example/promo"
});
const snapshotProtegida = snapshotCamposProtegidos(protegida);
const resultadoProtegida = resolver(protegida);
assert.strictEqual(resultadoProtegida.ok, true);
assert.deepStrictEqual(snapshotCamposProtegidos(protegida), snapshotProtegida, "Copy C3 preserva campos comerciais/factuais");

const deterministica = ofertaBase({ id: "c3_determinismo", engineOfertaId: "c3_determinismo", cupom: "PROMO10", precoOriginal: "" });
const frases = Array.from({ length: 5 }, () => resolver(deterministica).ganchoComercialC3);
assert.strictEqual(new Set(frases).size, 1, "mesma oferta renderiza mesmo gancho C3");
const outraOferta = resolver(ofertaBase({ id: "c3_determinismo_outra", engineOfertaId: "c3_determinismo_outra", cupom: "PROMO10", precoOriginal: "" }));
assert.ok(outraOferta.ganchoComercialC3, "outra oferta tambem seleciona frase valida");

const semFatos = resolver({
  id: "c3_sem_fatos",
  engineOfertaId: "c3_sem_fatos",
  clienteId: "cliente_c3",
  marketplace: "mercadolivre",
  titulo: "",
  nome: "",
  categoria: "",
  preco: "",
  precoAtual: "",
  cupom: "",
  linkAfiliado: "",
  imagem: ""
});
assert.strictEqual(semFatos.ok, false, "sem fatos fortes preserva fallback legado");

const ofertaRender = ofertaBase({ id: "c3_render", engineOfertaId: "c3_render", cupom: "PROMO10", precoOriginal: "" });
const snapshotRender = JSON.parse(JSON.stringify(ofertaRender));
const mensagem = renderizar(ofertaRender);
assert.ok(mensagem.includes("*Lava e Seca Philco 10kg*"), "Template recebe titulo factual separado");
assert.ok(/cupom/i.test(mensagem), "Template recebe gancho C3 relacionado ao fato escolhido");
assert.ok(mensagem.includes("PROMO10"), "Template preserva cupom oficial");
assert.ok(mensagem.includes("https://meli.la/afiliado"), "Template preserva link oficial");
assert.deepStrictEqual(ofertaRender, snapshotRender, "renderizacao com C3 nao muta oferta compartilhada/fanout");

const planoSemC3 = { recursos: { tituloIa: true, templatePersonalizado: true, copyC3Factual: false } };
const c3Desligada = copy.resolverCopyC3({ oferta: ofertaRender, destino: destinoIa, clienteId: "cliente_c3", plano: planoSemC3 });
assert.strictEqual(c3Desligada.ok, false, "recurso desligado preserva fallback Local V2/V1");

console.log("copy-inteligente-c3.test.js OK");
