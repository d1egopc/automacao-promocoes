"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { consultarProdutoMagalu, parseMagaluProdutoHtml } = require("../modules/marketplaces/magalu/magalu-parser");
const { resolverFatosMagalu, limparCacheFactualMagalu } = require("../modules/marketplaces/magalu/magalu-factual-resolver");
const { classificarCategoriaUniversal } = require("../modules/inteligencia-universal/categoria.service");
const url = "https://www.magazineluiza.com.br/acessorio-qx/p/abc123/xx/test/";
const html = `<link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({
  "@type":"Product",name:"Acessório modelo QX",sku:"abc123",image:"https://a-static.mlcdn.com.br/fixture.jpg",offers:{"@type":"Offer",price:"59.90"}
})}</script><script type="application/ld+json">${JSON.stringify({"@type":"BreadcrumbList",itemListElement:[
  {position:1,name:"Home"},{position:2,name:"Pesca"},{position:3,name:"Iscas artificiais"},{position:4,name:"Acessório modelo QX"}
]})}</script>`;
function fetcher({status=200, final=url, body=html}={}) {return async()=>({ok:status>=200&&status<300,status,url:final,text:async()=>body});}
function classificar(fatos) {return classificarCategoriaUniversal({...fatos,marketplace:"magalu"});}
test("JSON-LD já recebido por HTTPS oficial mantém hierarquia e vínculo com SKU", async()=>{
  let calls=0; const fetchFn=fetcher();
  const fatos=await consultarProdutoMagalu(url,{fetchFn:async(...args)=>{calls++;return fetchFn(...args);},retries:0});
  assert.equal(calls,1,"nenhuma requisição adicional de categoria");
  assert.equal(fatos.categoria,"Iscas artificiais","contrato legado do parser preservado");
  assert.equal(classificar(fatos).categoria,"Pesca e Camping");
  assert.equal(classificar(fatos).fonteEvidencia,"magalu_product_jsonld");
  assert.equal(fatos.precoAtual,"R$\u00a059,90");
  assert.equal(fatos.imagem,"https://a-static.mlcdn.com.br/fixture.jpg");
});
test("parse-only, 403, CAPTCHA, host final externo e SKU divergente não recebem prova oficial",async()=>{
  const semRede=parseMagaluProdutoHtml({urlOriginal:url,html});
  assert.equal(semRede.categoriaMarketplace,undefined);
  for(const op of [{status:403},{final:"https://example.test/p/abc123/"},{body:"captcha"},
    {body:html.replaceAll("abc123","zzz999")}]) {
    const fatos=await consultarProdutoMagalu(url,{fetchFn:fetcher(op),retries:0});
    assert.ok(!fatos.categoriaMarketplace,JSON.stringify(op));
  }
});
test("cache factual existente preserva apenas a prova já criada em RAM, sem nova API de categoria",async()=>{
  limparCacheFactualMagalu();
  try {
    const primeiro=await resolverFatosMagalu({urlOriginal:url,promoterId:"fixtureloja"},{parserOptions:{fetchFn:fetcher(),retries:0},cacheFactual:true});
    assert.equal(primeiro.ok,true);
    const segundo=await resolverFatosMagalu({urlOriginal:url,promoterId:"fixtureloja"},{parserOptions:{fetchFn:async()=>{throw new Error("fixture_transient");},retries:0,retryDelayMs:0},cacheFactual:true});
    assert.equal(segundo.cache.hit,true);
    assert.equal(classificar(segundo.fatos).categoria,"Pesca e Camping");
    assert.equal(classificar(segundo.fatos).origem,"marketplace_oficial");
    const reidratado=JSON.parse(JSON.stringify(segundo.fatos));
    assert.notEqual(classificar(reidratado).origem,"marketplace_oficial","JSON não restaura proveniência de RAM");
  } finally {limparCacheFactualMagalu();}
});
