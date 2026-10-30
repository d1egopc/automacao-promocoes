"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path"), Module = require("node:module");
const { execFileSync } = require("node:child_process");
const fixture = require("./fixtures/classificador-diversos-real-20261028.json");
const v4 = require("./fixtures/diversos-v4-labels.json").policyOverrides;
const { classificarCategoriaUniversal: classify } = require("../modules/inteligencia-universal/categoria.service");
const { classificarCategoriaOferta, avaliarEvidenciaCategoria } = require("../marketplaces/inteligencia/classificador-categorias");
const copy = require("../modules/copy-inteligente/copy-local-v2.service");
const root = path.resolve(__dirname, ".."), relative = "marketplaces/inteligencia/classificador-categorias.js";
const source = execFileSync("git", ["show", `5dd99da80233ab9a49162e02e215b75982e3da28:${relative}`], {cwd:root,encoding:"utf8",windowsHide:true});
const file = path.join(root,relative), m = new Module(file,module);
m.filename=file; m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(source + "\nmodule.exports.scorer = o => REGRAS.map(r=>pontuarRegra(textoOferta(o,o.titulo),r)).filter(Boolean).sort(desempatar);", file);
const baseline=m.exports;

test("reprodução da primeira decisão incorreta na base publicada, antes do patch",()=>{
  for(const row of [...fixture.real28,...fixture.historical]) {
    assert.equal(baseline.classificarCategoriaOferta({titulo:row.titulo,categoria:"Diversos"},row.titulo),row.before,row.titulo);
  }
  const rod=fixture.real28[0], bait=fixture.real28[1];
  assert.equal(baseline.avaliarEvidenciaCategoria({titulo:rod.titulo}),null);
  assert.equal(baseline.scorer({titulo:rod.titulo}).length,0,"vara perde antes do fallback Diversos por ausência de evidência/scorer");
  assert.equal(baseline.avaliarEvidenciaCategoria({titulo:bait.titulo}),null);
  const first=baseline.scorer({titulo:bait.titulo});
  assert.equal(first[0].categoria,"Pet Shop e Fazendinha");
  assert.ok(first[0].fortes.includes("racao"));
});

for(const row of [...fixture.real28,...fixture.historical]) test(`real/referenciado: ${row.titulo}`,()=>{
  // Uma categoria específica errada também deve ser corrigida pela mesma natureza.
  const result=classify({titulo:row.titulo,categoria:row.before});
  assert.equal(result.categoria,v4[row.titulo] || row.categoria);
  assert.equal(classificarCategoriaOferta({titulo:row.titulo,categoria:row.before}),v4[row.titulo] || row.categoria);
  if(row.motivo) {
    assert.equal(result.motivo,row.motivo);
    assert.equal(result.origem,"identidade_produto");
    assert.equal(result.confianca,"alta");
  }
});

for(const row of fixture.controls) test(`controle negativo: ${row.titulo}`,()=>{
  const offer={titulo:row.titulo,categoria:"Diversos"};
  const actual=classify(offer).categoria;
  if(row.categoria || v4[row.titulo])assert.equal(actual,v4[row.titulo] || row.categoria);
  if(row.forbidden)assert.notEqual(actual,row.forbidden);
  assert.equal(baseline.classificarCategoriaOferta(offer,row.titulo),row.before || (v4[row.titulo] ? row.categoria || "Diversos" : actual),"controle preservado ou mudança V4 de finalidade explicitamente versionada");
});

test("generaliza comprimento/libragem e consumível de pesca sem marca ou título completo",()=>{
  for(const titulo of ["Vara fabricante alternativo 2,10m 10-25 lb", "Vara 180cm 8-17lbs inteiriça", "Ração furada para pesca com anzol", "Isca 9cm 12g flutuante", "Isca para corrico fabricante alternativo"]) {
    assert.equal(classify({titulo,categoria:"Diversos"}).categoria,"Pesca e Camping",titulo);
  }
});

test("grupo de origem não determina categoria ou gênero; marketplace/workspace não são regras",()=>{
  for(const titulo of ["Produto desconhecido", "Faca Tática Pescador Aço Inox", "Camisa de pesca UV50", "Vara"]) {
    for(const grupoNome of ["Optimus Clone", "Promoções do Pescador", "Cozinha", "Pet Shop"]) {
      assert.equal(classify({titulo,categoria:"Diversos",grupoNome,origemGrupo:grupoNome}).categoria,v4[titulo] || "Diversos");
    }
  }
  for(const workspaceId of ["fixture-a","fixture-b"])for(const marketplace of ["mercadolivre","shopee","amazon","aliexpress","magalu","awin"]) {
    for(const row of fixture.real28.slice(0,2)) {
      assert.equal(classify({titulo:row.titulo,categoria:row.before,workspaceId,clienteId:workspaceId,marketplace}).categoria,row.categoria);
    }
  }
});

test("preço, cupom, URLs, afiliação e identidade não são mutados; Copy reutiliza a natureza comprovada",()=>{
  for(const clienteId of ["fixture-a","fixture-b"])for(const row of fixture.real28.slice(0,2)) {
    const oferta={titulo:row.titulo,categoria:row.before,clienteId,id:"same-id",preco:41.25,precoOriginal:50,cupom:"FIXTURE",linkOriginal:"https://example.test/p",linkAfiliado:`https://example.test/${clienteId}`,beneficioExtra:"Pix"};
    const before=structuredClone(oferta);
    assert.equal(classify(oferta).categoria,"Pesca e Camping");
    assert.equal(copy.resolverFamiliaOfertaCopyLocalV2(oferta).familia,"pesca_camping");
    const result=copy.resolverCopyLocalV2({oferta,clienteId,destino:{tituloOferta:"ia"},plano:{recursos:{tituloIa:true}}});
    assert.equal(result.ok,true);
    assert.equal(result.familia,"pesca_camping");
    assert.doesNotMatch(result.tituloIa,/pet shop|cachorro|gato|rotina digital/i);
    assert.deepEqual(oferta,before);
  }
});

test("ambiguidade não recebe nova evidência de pesca pelo grupo",()=>{
  assert.equal(avaliarEvidenciaCategoria({titulo:"Faca tática com bainha",grupoNome:"Pesca"}),null);
  assert.equal(avaliarEvidenciaCategoria({titulo:"Ração para pesqueiro",grupoNome:"Pesca"}),null);
});

test("categorias novas não contaminam destinos de cozinha, ferramentas, moda ou pet e preservam origem",()=>{
  const {destinoAceitaOferta}=require("../utils/destinos");
  for(const workspaceId of ["fixture-a","fixture-b"]) {
    const destination=categoria=>({id:"same-destination-id",workspaceId,ativo:true,marketplaces:["mercadolivre"],categorias:[categoria],origemOfertas:"ambos"});
    for(const row of fixture.real28.slice(0,2)) {
      const offer={id:"same-offer-id",workspaceId,titulo:row.titulo,categoria:classify({titulo:row.titulo,categoria:row.before}).categoria,marketplace:"mercadolivre",origem:"clonador_grupos"};
      assert.equal(destinoAceitaOferta(destination("Pesca e Camping"),offer),true);
      for(const category of ["Pet Shop e Fazendinha","Ferramentas","Casa, Móveis e Decoração","Roupas e Moda Masculina"])assert.equal(destinoAceitaOferta(destination(category),offer),false);
      assert.equal(destinoAceitaOferta({...destination("Pesca e Camping"),origemOfertas:"optimus"},offer),false);
    }
    for(const row of fixture.controls.filter(row=>row.forbidden==="Pesca e Camping")) {
      const offer={workspaceId,titulo:row.titulo,categoria:classify({titulo:row.titulo,categoria:"Diversos"}).categoria,marketplace:"mercadolivre"};
      assert.equal(destinoAceitaOferta(destination("Pesca e Camping"),offer),false,row.titulo);
    }
  }
});
