const assert = require("assert");

const {
  consultarEnvioRecenteExecutor2h,
  sanearDuplicatasPendentes2h
} = require("../utils/fila-ofertas");
const {
  identidadeAntiRepeticaoAutomatica,
  ofertasEquivalentesAntiRepeticao
} = require("../marketplaces/inteligencia/memoria-ofertas");

const AGORA = new Date("2026-07-24T23:00:00.000Z").getTime();

function oferta(overrides = {}) {
  return {
    id: `oferta_${Math.random().toString(36).slice(2)}`,
    clienteId: "cliente_a",
    marketplace: "mercadolivre",
    titulo: "Mascara Glatten Milagre Dos Fios Repairpro 500g",
    preco: 89.9,
    precoAtual: 89.9,
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-123456789",
    status: "pendente",
    criadoEm: "24/07/2026, 19:00:00",
    ...overrides
  };
}

{
  const primeira = oferta({
    id: "primeira",
    status: "pendente"
  });
  const segunda = oferta({ id: "segunda" });
  let resultado = consultarEnvioRecenteExecutor2h([primeira, segunda], primeira, { agora: AGORA });
  assert.strictEqual(resultado.bloqueada, false, "primeira pendente nao bloqueia a si propria");

  primeira.status = "enviado";
  primeira.enviadoEm = new Date(AGORA - 10 * 60 * 1000).toISOString();
  resultado = consultarEnvioRecenteExecutor2h([primeira, segunda], segunda, { agora: AGORA });
  assert.strictEqual(resultado.bloqueada, true, "segunda copia deve ser bloqueada depois do primeiro envio");
  assert.strictEqual(resultado.ofertaAnterior.id, "primeira");
}

{
  const comProdutoId = oferta({
    produtoId: "MLB123456789",
    linkOriginal: ""
  });
  const comLink = oferta({
    produtoId: "",
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-123456789?tracking=1"
  });
  assert.strictEqual(ofertasEquivalentesAntiRepeticao(comProdutoId, comLink), true);
  assert.strictEqual(
    identidadeAntiRepeticaoAutomatica(comProdutoId).identidade,
    identidadeAntiRepeticaoAutomatica(comLink).identidade
  );
}

{
  const comProdutoIdNumerico = oferta({
    marketplace: "kabum",
    produtoId: "921292",
    linkOriginal: ""
  });
  const comLink = oferta({
    marketplace: "kabum",
    produtoId: "",
    linkOriginal: "https://www.kabum.com.br/produto/921292/produto-teste"
  });
  assert.strictEqual(
    ofertasEquivalentesAntiRepeticao(comProdutoIdNumerico, comLink),
    true,
    "produtoId numerico e ID na URL devem convergir"
  );
}

{
  const aliases = ["Mercado Livre", "mercadolivre", "mercado_livre", "ml"];
  const identidades = aliases.map(marketplace =>
    identidadeAntiRepeticaoAutomatica(oferta({ marketplace })).identidade
  );
  assert.strictEqual(new Set(identidades).size, 1, "aliases do Mercado Livre devem convergir");
}

{
  const redirect = "https://go.optimuspromo.com.br/r/ino3rp";
  const a = oferta({ marketplace: "amazon", linkOriginal: "", linkAfiliado: redirect, asin: "" });
  const b = oferta({ marketplace: "amazon", linkOriginal: "", linkAfiliado: redirect, asin: "" });
  assert.strictEqual(ofertasEquivalentesAntiRepeticao(a, b), true, "mesmo redirect Optimus deve identificar repeticao");
}

{
  const a = oferta({
    linkOriginal: "https://produto.mercadolivre.com.br/MLB-987654321-produto-a"
  });
  const b = oferta({
    linkOriginal: "https://lista.mercadolivre.com.br/MLB987654321?tracking=outro"
  });
  assert.strictEqual(ofertasEquivalentesAntiRepeticao(a, b), true, "mesmo MLB em URLs diferentes deve convergir");
}

{
  const a = oferta({
    marketplace: "amazon",
    asin: "B0ABC12345",
    linkOriginal: "",
    linkAfiliado: "https://amzn.to/link-a"
  });
  const b = oferta({
    marketplace: "amazon",
    asin: "B0ABC12345",
    linkOriginal: "",
    linkAfiliado: "https://amazon.com.br/dp/B0ABC12345?tag=outra"
  });
  assert.strictEqual(ofertasEquivalentesAntiRepeticao(a, b), true, "mesmo ASIN deve prevalecer sobre links diferentes");
}

{
  const a = oferta({ produtoId: "MLB111111111", linkOriginal: "", titulo: "Produto igual" });
  const b = oferta({ produtoId: "MLB222222222", linkOriginal: "", titulo: "Produto igual" });
  assert.strictEqual(
    ofertasEquivalentesAntiRepeticao(a, b),
    false,
    "titulo igual nao pode superar identidades fortes diferentes"
  );
}

{
  const enviada = oferta({
    clienteId: "cliente_a",
    status: "enviado",
    enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString()
  });
  const outroCliente = oferta({ clienteId: "cliente_b" });
  const resultado = consultarEnvioRecenteExecutor2h([enviada, outroCliente], outroCliente, { agora: AGORA });
  assert.strictEqual(resultado.bloqueada, false, "clientes diferentes nao se bloqueiam");
}

{
  const antiga = oferta({
    status: "enviado",
    enviadoEm: new Date(AGORA - 3 * 60 * 60 * 1000).toISOString()
  });
  const atual = oferta();
  const resultado = consultarEnvioRecenteExecutor2h([antiga, atual], atual, { agora: AGORA });
  assert.strictEqual(resultado.bloqueada, false, "envio com mais de 2 horas nao bloqueia");
}

for (const origem of ["manual", "manual-kabum-awin", "manual-magalu", "importacao_manual", "magalu_manual"]) {
  const enviada = oferta({
    status: "enviado",
    enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString()
  });
  const manual = oferta({ origem });
  const resultado = consultarEnvioRecenteExecutor2h([enviada, manual], manual, { agora: AGORA });
  assert.strictEqual(resultado.bloqueada, false, `${origem} deve preservar excecao manual`);
}

{
  const atual = oferta();
  const resultado = consultarEnvioRecenteExecutor2h([], atual, {
    agora: AGORA,
    obterItens() {
      throw new Error("storage_indisponivel");
    }
  });
  assert.strictEqual(resultado.ok, false);
  assert.strictEqual(resultado.bloqueada, false, "falha de consulta nao descarta oferta");
  assert.strictEqual(atual.status, "pendente");
}

{
  const fila = [
    oferta({ id: "mais_antiga", criadoEm: "24/07/2026, 19:00:00" }),
    oferta({ id: "duplicada_1", criadoEm: "24/07/2026, 19:05:00" }),
    oferta({ id: "duplicada_2", marketplace: "Mercado Livre", criadoEm: "24/07/2026, 19:10:00" }),
    oferta({
      id: "outro_cliente",
      clienteId: "cliente_b",
      criadoEm: "24/07/2026, 19:06:00"
    })
  ];
  const resultado = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.totalSaneado, 2);
  assert.strictEqual(fila[0].status, "pendente", "copia mais antiga permanece pendente");
  assert.strictEqual(fila[1].status, "retida");
  assert.strictEqual(fila[2].status, "retida");
  assert.strictEqual(fila[3].status, "pendente", "outro cliente permanece isolado");

  const estadoDepoisPrimeiroSaneamento = JSON.stringify(fila);
  const segundaExecucao = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(segundaExecucao.totalSaneado, 0, "segundo saneamento deve ser idempotente");
  assert.strictEqual(JSON.stringify(fila), estadoDepoisPrimeiroSaneamento);
}

{
  const fila = [
    oferta({ id: "preco_antigo", preco: 100, precoAtual: 100, criadoEm: "24/07/2026, 19:00:00" }),
    oferta({ id: "preco_melhor", preco: 90, precoAtual: 90, criadoEm: "24/07/2026, 19:10:00" })
  ];
  const resultado = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(resultado.totalSaneado, 0, "preco menor comprovado deve ser preservado");
  assert.strictEqual(fila[1].status, "pendente");
}

{
  const fila = [
    oferta({ id: "desconto_antigo", desconto: "10%", criadoEm: "24/07/2026, 19:00:00" }),
    oferta({ id: "desconto_melhor", desconto: "20%", criadoEm: "24/07/2026, 19:10:00" })
  ];
  const resultado = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(resultado.totalSaneado, 0, "desconto percentual maior deve ser preservado");
  assert.strictEqual(fila[1].status, "pendente");
}

{
  const fila = [
    oferta({ id: "sem_cupom", criadoEm: "24/07/2026, 19:00:00" }),
    oferta({
      id: "cupom_textual",
      avisoCupom: "Pode haver cupom no aplicativo",
      tipoCupom: "provavel",
      criadoEm: "24/07/2026, 19:10:00"
    })
  ];
  const resultado = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(resultado.totalSaneado, 1, "cupom apenas textual nao deve liberar repeticao");
  assert.strictEqual(fila[1].status, "retida");
}

{
  const fila = [
    oferta({ id: "timestamp_ausente", criadoEm: "" }),
    oferta({ id: "timestamp_invalido", criadoEm: "data-invalida" })
  ];
  const resultado = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(resultado.totalSaneado, 0, "timestamp inseguro nao pode causar retencao");
  assert.strictEqual(fila[0].status, "pendente");
  assert.strictEqual(fila[1].status, "pendente");
}

for (const status of ["retida", "erro", "expirada", "cancelada", "pendente"]) {
  const historicoNaoEnviado = oferta({
    id: `historico_${status}`,
    status,
    enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString()
  });
  const atual = oferta({ id: `atual_${status}` });
  const resultado = consultarEnvioRecenteExecutor2h([historicoNaoEnviado, atual], atual, { agora: AGORA });
  assert.strictEqual(resultado.bloqueada, false, `${status} nao deve bloquear como envio concluido`);
}

{
  const original = oferta({ id: "identidade_original" });
  const identidadeOficial = identidadeAntiRepeticaoAutomatica(original).identidade;
  const enviada = oferta({
    id: "identidade_enviada",
    status: "enviado",
    enviadoEm: new Date(AGORA - 5 * 60 * 1000).toISOString()
  });
  const consulta = consultarEnvioRecenteExecutor2h([enviada, original], original, { agora: AGORA });
  assert.strictEqual(consulta.identidade, identidadeOficial, "Executor deve usar identidade oficial");

  const fila = [
    oferta({ id: "identidade_antiga", criadoEm: "24/07/2026, 19:00:00" }),
    oferta({ id: "identidade_duplicada", criadoEm: "24/07/2026, 19:10:00" })
  ];
  const saneamento = sanearDuplicatasPendentes2h(fila, { agora: AGORA });
  assert.strictEqual(saneamento.atualizacoes[0].identidade, identidadeOficial, "saneamento deve usar identidade oficial");
}

console.log("anti-repeticao-executor ok");
