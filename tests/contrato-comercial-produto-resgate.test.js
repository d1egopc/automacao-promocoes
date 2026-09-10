const assert = require("assert");

const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { prepararDadosOficiaisTemplate } = require("../modules/templates-clientes/dados-oficiais");
const { gerarTemplateUniversal } = require("../modules/template-universal");

function linkResgate(url) {
  return {
    tipo: "resgate",
    papel: "link_resgate",
    urlAfiliada: url,
    urlAfiliadaWorkspace: url,
    renderizavel: true,
    ordemCaptura: 1,
    conversaoStatus: "convertida"
  };
}

function linkProduto(url) {
  return {
    tipo: "produto",
    papel: "link_produto",
    urlAfiliada: url,
    urlAfiliadaWorkspace: url,
    renderizavel: true,
    ordemCaptura: 2,
    conversaoStatus: "convertida"
  };
}

function ofertaShopee({
  origemFluxo = "optimus",
  comprovado = true,
  completa = false,
  somenteProduto = false,
  titulo = "Shopee teste",
  produtoOriginal = "https://s.shopee.com.br/produto-original",
  produtoAfiliado = "https://s.shopee.com.br/produto-afiliado",
  resgateAfiliado = "https://s.shopee.com.br/resgate-afiliado"
} = {}) {
  const links = somenteProduto ? [linkProduto(produtoAfiliado)] : [linkResgate(resgateAfiliado)];
  if (completa && !somenteProduto) links.push(linkProduto(produtoAfiliado));
  return {
    id: 900,
    uuid: "oferta-900",
    job_id: 901,
    cliente_id: "cliente_teste",
    marketplace: "shopee",
    titulo,
    preco: 100,
    preco_original: 150,
    link_original: produtoOriginal,
    link_afiliado: produtoAfiliado,
    origemFluxo,
    metadata: {
      integridadeComercial: {
        linksComerciais: links,
        linksDescartadosRadar: comprovado ? [{
          tipo: "produto",
          papel: "produto",
          urlOriginal: produtoOriginal,
          destinoFuncionalFinal: { url: produtoAfiliado }
        }] : []
      },
      ofcV24: {
        documentoComercialCanonico: comprovado ? {
          linkAfiliado: produtoAfiliado,
          linksComerciais: [linkProduto(produtoAfiliado)]
        } : {}
      }
    }
  };
}

function mensagem(item) {
  return gerarTemplateUniversal(prepararDadosOficiaisTemplate(item, { modo: "universal" }));
}

function totalProdutos(item) {
  return (item.linksComerciais || []).filter(link => link.tipo === "produto" && link.renderizavel === true).length;
}

for (const origemFluxo of ["optimus", "clonador_grupos"]) {
  const item = montarItemFilaEngine(ofertaShopee({ origemFluxo }));
  assert.strictEqual(totalProdutos(item), 1, `${origemFluxo}: deve incorporar um produto comprovado`);
  assert.strictEqual(item.linksComerciais.length, 2, `${origemFluxo}: deve preservar produto e resgate`);
  assert.ok(mensagem(item).includes("https://s.shopee.com.br/resgate-afiliado"));
  assert.ok(mensagem(item).includes("https://s.shopee.com.br/produto-afiliado"));
}

{
  const item = montarItemFilaEngine(ofertaShopee({ comprovado: false }));
  assert.strictEqual(totalProdutos(item), 0, "produto sem prova não pode ser incorporado");
  assert.ok(!mensagem(item).includes("https://s.shopee.com.br/produto-afiliado"));
}

{
  const oferta = ofertaShopee();
  oferta.metadata.integridadeComercial.linksDescartadosRadar = [];
  const item = montarItemFilaEngine(oferta);
  assert.strictEqual(totalProdutos(item), 1, "documento canônico deve comprovar produto afiliado");
}

{
  const oferta = ofertaShopee();
  oferta.metadata.ofcV24.documentoComercialCanonico = {};
  const item = montarItemFilaEngine(oferta);
  assert.strictEqual(totalProdutos(item), 1, "integridade deve comprovar produto afiliado");
}

{
  const item = montarItemFilaEngine(ofertaShopee({ completa: true }));
  assert.strictEqual(totalProdutos(item), 1, "lista completa não pode duplicar produto");
  assert.strictEqual(item.linksComerciais.length, 2);
}

{
  const item = montarItemFilaEngine(ofertaShopee({ somenteProduto: true }));
  assert.strictEqual(totalProdutos(item), 1, "somente produto deve permanecer inalterado");
  assert.strictEqual(item.linksComerciais.length, 1);
}

{
  const item = montarItemFilaEngine(ofertaShopee({ comprovado: false, titulo: "Somente resgate legítimo" }));
  assert.strictEqual(item.linksComerciais.length, 1, "resgate sem produto comprovado não pode inventar produto");
}

for (const caso of [
  [20829, "Monitor LG", "https://s.shopee.com.br/5LBnpDG1AW", "https://s.shopee.com.br/9056CEYmwJ", "https://s.shopee.com.br/5q84QPkhs0"],
  [20836, "Ryzen 5600GT", "https://s.shopee.com.br/1Vz5GZpJLA", "https://s.shopee.com.br/50YxRHqqET", "https://s.shopee.com.br/AAH3amXRpI"],
  [20888, "RTX 5060", "https://s.shopee.com.br/5q84RhnRzD", "https://s.shopee.com.br/2qUSsYKmcY", "https://s.shopee.com.br/7fZidR6zLG"],
  [20894, "Kit Ryzen 5500", "https://s.shopee.com.br/60RUeBrJGl", "https://s.shopee.com.br/9AOWQLslpQ", "https://s.shopee.com.br/2gB2gPM3JY"]
]) {
  const [id, titulo, produtoOriginal, produtoAfiliado, resgateAfiliado] = caso;
  const item = montarItemFilaEngine(ofertaShopee({
    origemFluxo: "clonador_grupos",
    titulo,
    produtoOriginal,
    produtoAfiliado,
    resgateAfiliado
  }));
  assert.ok(mensagem(item).includes(produtoAfiliado), `${id}: produto afiliado deve chegar ao template`);
  assert.ok(mensagem(item).includes(resgateAfiliado), `${id}: resgate deve permanecer no template`);
}

console.log("contrato-comercial-produto-resgate.test.js OK");
