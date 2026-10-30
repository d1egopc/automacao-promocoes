"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {classificarCategoriaUniversal:classify}=require("../modules/inteligencia-universal/categoria.service");
const {classificarCategoriaOferta,avaliarEvidenciaCategoria}=require("../marketplaces/inteligencia/classificador-categorias");
const {CATEGORIAS_OPTIMUS}=require("../marketplaces/inteligencia/categorias-globais");
const data=require("./fixtures/diversos-v4-whatsapp-20261029.json"),labels=require("./fixtures/diversos-v4-labels.json");
const baseline=require("./diversos-v4-baseline.cjs");
test("fonte única enviada:182 publicações,30 Diversos; instrução de interface excluída",()=>{
 assert.equal(data.offers.length,182);assert.equal(data.offers.filter(x=>x.categoriaRegistrada==="Diversos").length,30);
 assert.equal(Object.keys(labels.whatsapp).length,29);assert.ok(labels.excluded[164]);
 for(const row of data.offers.filter(x=>labels.whatsapp[x.sampleId]))assert.equal(baseline.universal.classificarCategoriaUniversal({...row,categoria:"Diversos"}).categoria,"Diversos");
});
for(const row of data.offers.filter(x=>labels.whatsapp[x.sampleId]))test(`amostra real ${row.sampleId}: natureza e finalidade`,()=>{
 const expected=labels.whatsapp[row.sampleId];assert.ok(CATEGORIAS_OPTIMUS.includes(expected));
 for(const tenant of ["tenant_a","tenant_b"])for(const marketplace of ["amazon","mercadolivre","shopee","magalu","aliexpress","kabum","awin"]){
  const input={...row,categoria:"Diversos",clienteId:tenant,marketplace,grupoNome:"Grupo sem autoridade"},before=structuredClone(input);
  assert.equal(classify(input).categoria,expected);assert.equal(classificarCategoriaOferta(input),expected);assert.deepEqual(input,before);
 }
});
for(const [titulo,categoria]of labels.supplemental)test(`exemplo obrigatório/variação: ${titulo}`,()=>assert.equal(classify({titulo,categoria:"Diversos"}).categoria,categoria));
test("ambiguidade, acessórios e finalidades concorrentes não contaminam Pesca",()=>{
 for(const titulo of ["Faca tática com bainha","Faca Tática Pescador Aço Inox","Faca Skinner Mini Campeira com bainha","Facão Rambo inox","Facão para cortar mato","Faca picanheira profissional para churrasco","Kit faca para cozinha e camping","Camiseta masculina com estampa pesca UV50","Camisa infantil de pesca UV50","Torne-se Prime 30 dias","Tinta para impressora","Linha para impressora 3D","Boia para piscina","Lanterna traseira automotiva","Refletor fotográfico passivo","Máscara de mergulho", "Produto desconhecido"]){
  const result=classify({titulo,categoria:"Diversos",grupoNome:"Pesca e Camping"}).categoria;assert.notEqual(result,"Pesca e Camping",titulo);
 }
 assert.equal(classify({titulo:"Kit faca para cozinha e camping",categoria:"Diversos"}).categoria,"Diversos");
 assert.equal(classify({titulo:"Kit impressora + perfume",categoria:"Diversos"}).categoria,"Diversos");
 assert.equal(classify({titulo:"Kit lanterna com notebook",categoria:"Diversos"}).categoria,"Diversos");
 assert.equal(classify({titulo:"Kit sabão em pó e sabonetes líquidos",categoria:"Diversos"}).categoria,"Diversos");
 assert.equal(classify({titulo:"Refletor fotográfico passivo",categoria:"Diversos"}).categoria,"Diversos");
 assert.notEqual(classify({titulo:"Capa EarPods Lightning",categoria:"Diversos"}).categoria,"Audio TV");
 assert.notEqual(classify({titulo:"Kit sabonete líquido veterinário para cachorro",categoria:"Diversos"}).categoria,"Perfumaria, Farmácia e Beleza");
 assert.notEqual(classify({titulo:"Refletor para bicicleta",categoria:"Diversos"}).categoria,"Iluminação e Elétrica");
});
test("descrição e atributos complementam o tipo; grupo e descrições de relacionados não determinam categoria",()=>{
 assert.equal(classify({titulo:"Produto X",atributos:{tipo:"Impressora multifuncional"},categoria:"Diversos"}).categoria,"Periféricos");
 assert.equal(classify({titulo:"Camisa de pesca",atributos:[{nome:"Finalidade",valor:"Proteção UV50"}],categoria:"Diversos"}).categoria,"Pesca e Camping");
 assert.equal(classify({titulo:"Camisa de pesca",descricao:"Poliamida com proteção UV50",categoria:"Diversos"}).categoria,"Pesca e Camping");
 assert.equal(classify({titulo:"Camisa de pesca",atributos:{material:"poliamida"},categoria:"Diversos"}).categoria,"Pesca e Camping");
 assert.notEqual(classify({titulo:"Camisa de pesca",atributos:{material:"poliamida",publico:"infantil"},categoria:"Diversos"}).categoria,"Pesca e Camping");
 for(const titulo of ["Panela de pressão","Perfume floral","Mouse USB"]){
  const evidence=avaliarEvidenciaCategoria({titulo,descricao:"Veja também impressora, tanquinho e refletores LED",categoria:"Diversos"});
  assert.ok(!evidence || !["Periféricos","Eletrodomésticos","Iluminação e Elétrica"].includes(evidence.categoria),titulo);
 }
 assert.equal(classify({titulo:"Produto desconhecido",categoria:"Diversos",grupoNome:"Periféricos",workspaceId:"pesca"}).categoria,"Diversos");
});
test("147 casos anteriores mantêm rótulos e controles negativos originais",()=>{
 const rows=require("./classificador-v3-replay.cjs").dataset();assert.equal(rows.length,147);
 for(const row of rows){const actual=classify({titulo:row.titulo,marketplace:row.marketplace,categoria:"Diversos"}).categoria;
  if(row.categoria)assert.equal(actual,row.categoria,row.titulo);else assert.notEqual(actual,row.forbidden,row.titulo);
 }
});
test("amostra real adicional de três tenants: rótulos e exclusões comerciais independentes",()=>{
 const rows=require("./fixtures/diversos-v4-multiworkspace-20261029.json").rows;
 assert.equal(rows.length,48);assert.equal(new Set(rows.map(x=>x.tenant_ref)).size,3);
 for(const row of rows.filter(x=>x.expected))assert.equal(classify({titulo:row.titulo,categoria:row.persisted_category,marketplace:row.marketplace}).categoria,row.expected,row.titulo);
});
test("correções específicas fora de Diversos são explícitas, sem tratar toda categoria antiga como rótulo correto",()=>{
 for(const row of data.offers.filter(x=>labels.additionalSpecific[x.sampleId]))assert.equal(classify({...row,categoria:row.categoriaRegistrada}).categoria,labels.additionalSpecific[row.sampleId]);
});
test("fronteira Engine preserva descrição/atributos disponíveis para a categoria materializada",async()=>{
 const {aplicarSombraInteligenciaUniversalV2:apply}=require("../modules/engine/importer/importer.service");
 for(const fields of [{descricao:"Impressora multifuncional laser"},{atributos:{tipo:"Impressora multifuncional"}}]){
  const result=await apply({titulo:"Produto X",categoria:"Diversos",marketplace:"amazon",preco:90},fields,{cliente_id:"fixture_a"},
    {consultaMemoriaHistoricaPromise:Promise.resolve({ok:true,memoria:[]})});
  assert.equal(result.oferta.categoria,"Periféricos");
 }
});
