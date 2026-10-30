"use strict";
// Official functions, fictional persistence/queues. No socket, transport or DB.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"optimus-diversos-v4-"));
const {writeGlobalJson}=require("../utils/storage");
const tenants=["tenant_v4_a","tenant_v4_b"];
writeGlobalJson("usuarios.json",tenants.map(id=>({id,ativo:true,plano:"pro"})));
writeGlobalJson("planos.json",{pro:{ativo:true,marketplaces:["mercadolivre","amazon","shopee","magalu","aliexpress","kabum","awin"],recursos:{automacao:true}}});
const captured=new Map();let current=null;
const dbPath=require.resolve("../modules/engine/database");
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{queryEngine:async(sql,params=[])=>{
 if(/information_schema\.columns/.test(sql))return {ok:true,resultado:{rows:[{existe:true}]}};
 if(/INSERT INTO engine_ofertas/.test(sql)){
  const [evento_id,link_id,marketplace,titulo,,preco,preco_original,cupom,tipo_cupom,beneficio_extra,imagem,link_original,link_expandido,link_afiliado,categoria]=params;
  const row={id:1001,evento_id,link_id,marketplace,titulo,preco,preco_original,cupom,tipo_cupom,beneficio_extra,imagem,link_original,link_expandido,link_afiliado,categoria,metadata:JSON.parse(params[20]),cliente_id:current};
  captured.set(current,row);return {ok:true,resultado:{rows:[{id:1001,uuid:"fixture-shared-id"}]}};
 }
 if(/UPDATE engine_ofertas\s+SET metadata/.test(sql)){captured.get(current).metadata=JSON.parse(params[1]);return {ok:true,resultado:{rows:[{id:1001}]}};}
 return {ok:true,resultado:{rows:[]}};
}}};
const importer=require("../modules/engine/importer/importer.service"),distributor=require("../modules/engine/distributor/distributor.service");
const destinos=require("../utils/destinos"),{proximoSlotElegivel}=require("../modules/executor/fila-viva.service");
const data=require("./fixtures/diversos-v4-whatsapp-20261029.json"),labels=require("./fixtures/diversos-v4-labels.json");
async function run(){
 const originalLog=console.log,originalWarn=console.warn,originalFetch=global.fetch;let networkCalls=0;
 console.log=()=>{};console.warn=()=>{};global.fetch=async()=>{networkCalls++;throw Error("FIXTURE_NETWORK_FORBIDDEN");};
 const report=[];
 try{
 for(const input of data.offers.filter(x=>(labels.whatsapp[x.sampleId]&&labels.whatsapp[x.sampleId]!=="Diversos")||labels.additionalSpecific[x.sampleId])){
  const expected=labels.whatsapp[input.sampleId]||labels.additionalSpecific[input.sampleId];
  for(const tenant of tenants){
   current=tenant;
   const produtoUrl=input.marketplace==="amazon"?"https://www.amazon.com.br/dp/B000000001":input.marketplace==="shopee"?"https://shopee.com.br/product/123/456":"https://produto.mercadolivre.com.br/MLB-123456-produto";
   const affiliate=input.marketplace==="amazon"?`https://www.amazon.com.br/dp/B000000001?tag=${tenant}`:input.marketplace==="shopee"?`https://shopee.com.br/product/123/456?mmp_pid=${tenant}`:`https://meli.la/${tenant}`;
   const origin=input.sampleId%3===0?"clonador_grupos":input.sampleId%3===1?"radar":"teleradar";
   const metadata={origemFluxo:origin==="clonador_grupos"?origin:"optimus",clonadorGrupos:origin==="clonador_grupos"?{destinoIds:["niche"]}:undefined,
    produto:{titulo:input.titulo,imagemCandidatos:["https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg"]}};
   const offer={ok:true,marketplace:input.marketplace,titulo:input.titulo,preco:input.preco,precoOriginal:null,categoria:input.categoriaRegistrada,
    imagem:"https://http2.mlstatic.com/D_NQ_NP_123-MLB.jpg",imagemOrigem:"produto.imagem",linkOriginal:produtoUrl,linkExpandido:produtoUrl,linkAfiliado:affiliate,
    cupom:"V4FIXTURE",cupomTipo:"codigo_confirmado",precoPix:input.preco,beneficioExtra:"PIX",metadata};
   const before=structuredClone(offer);
   const result=await importer.gravarOfertaEngine({id:101,evento_id:201,cliente_id:tenant,marketplace:input.marketplace,metadata},
    {id:201,origem:origin,metadata,capturado_em:new Date(),texto_original:""},
    {id:301,url_original:produtoUrl,url_expandida:produtoUrl,marketplace_detectado:input.marketplace},offer);
   assert.equal(result.ok,true,`${input.sampleId}:${result.motivo}`);
   const stored=captured.get(tenant);assert.ok(stored);
   assert.equal(stored.categoria,expected,`SQL ${input.sampleId}`);assert.equal(stored.metadata.ofertaUniversal.produto.categoriaNormalizada,expected);
   assert.equal(stored.preco,input.preco);assert.equal(stored.link_afiliado,affiliate);assert.equal(stored.cupom,offer.cupom);assert.equal(stored.titulo,input.titulo);
   assert.deepEqual(offer,before,"captura comercial imutável");
   const target={id:"niche",ativo:true,workspaceId:tenant,marketplaces:[input.marketplace],categorias:[expected],origemOfertas:"ambos",tipoMidia:"texto",horarioInicio:"08:00",horarioFim:"22:00"};
   const context={clientesValidos:tenants,marketplacesAtivosPorCliente:Object.fromEntries(tenants.map(t=>[t,{[input.marketplace]:true}])),destinosPorCliente:{[tenant]:[target],[tenants.find(t=>t!==tenant)]:[{...target,id:"foreign"}]},validarCreditos:()=>({ok:true})};
   const eligibility=await distributor.validarOfertaParaDistribuicao(stored,context);assert.equal(eligibility.ok,true,`${input.sampleId}:${eligibility.motivo}`);
   assert.deepEqual(eligibility.__destinosCompativeisRaw.map(x=>x.id),["niche"]);
   const wrong=await distributor.validarOfertaParaDistribuicao({...stored,categoria:"Diversos"},context);assert.equal(wrong.ok,false);assert.equal(wrong.motivo,"categoria_incompativel");
   const blocked=await distributor.validarOfertaParaDistribuicao(stored,{...context,marketplacesAtivosPorCliente:{[tenant]:{[input.marketplace]:false}}});assert.equal(blocked.ok,false);
   assert.equal(distributor.ofertaJaExisteNaFila([{...distributor.montarItemFilaEngine(stored),clienteId:tenant}],stored),true);
   assert.equal(distributor.ofertaJaExisteNaFila([{...distributor.montarItemFilaEngine(stored),clienteId:tenants.find(t=>t!==tenant)}],stored),false);
   const queued=await distributor.adicionarOfertaNaFilaCliente(stored,{destinosCompativeisImagem:[target],deps:{adicionarOfertaNaFilaGlobal:async(t,item)=>{assert.equal(t,tenant);return {ok:true,itemFila:item};}}});
   assert.equal(queued.ok,true);assert.equal(queued.itemFila.categoria,expected);
   const now=Date.parse("2026-10-29T15:00:00-03:00"),slotOffer={...queued.itemFila,expiraEm:new Date(now+1800000).toISOString()};
   const slot=proximoSlotElegivel(target,slotOffer,now,{dentroHorario:destinos.destinoDentroHorario(target,now),limiteDiarioOk:true,intervalo:{liberado:true}});
   assert.equal(slot.liberadoAgora,true);assert.equal(slot.slotAntesDoDeadline,true);
   assert.equal(proximoSlotElegivel(target,slotOffer,now,{dentroHorario:true,limiteDiarioOk:false,intervalo:{liberado:true}}).liberadoAgora,false);
   assert.equal(proximoSlotElegivel(target,slotOffer,now,{dentroHorario:false,limiteDiarioOk:true,proximoHorarioEm:now+3600000,intervalo:{liberado:true}}).liberadoAgora,false);
   assert.equal(proximoSlotElegivel(target,slotOffer,now,{dentroHorario:true,limiteDiarioOk:true,intervalo:{liberado:false,proximoEnvioPermitidoEm:now+60000}}).liberadoAgora,false);
   assert.equal(proximoSlotElegivel(target,{...slotOffer,expiraEm:new Date(now-1).toISOString()},now,{dentroHorario:true,limiteDiarioOk:true,intervalo:{liberado:true}}).slotAntesDoDeadline,false);
   report.push({sampleId:input.sampleId,tenant,produto:input.titulo,marketplace:input.marketplace,origem:origin,categoriaAntes:input.categoriaRegistrada,categoriaDepois:expected,categoriaPersistida:stored.categoria,destinoNichadoElegivel:true,
    outrosFiltros:{workspace:"PASS",marketplace:"PASS",horario:"PASS_FIXTURE_15H_BRT",limite:"PASS_FIXTURE",cadencia:"PASS_FIXTURE",deduplicacao:"DUPLICATA_BLOQUEADA",ttl:"SLOT_ANTES_DO_DEADLINE"},resultado:"SIMULACAO_SQL_CONTRATO_FILA_DESTINO_PASS_SEM_ENVIO"});
  }
 }
 assert.equal(networkCalls,0,"nenhuma consulta externa na simulação");
 // The same commercial ID is legal in two tenants; persistence remains separate.
 assert.equal(captured.size,2);assert.notEqual(captured.get(tenants[0]).link_afiliado,captured.get(tenants[1]).link_afiliado);
 return {kind:"isolated official importer SQL interception, contract, distributor, queue and slot gates; not live PostgreSQL, transport or ACK",total:report.length,networkCalls,rows:report};
 }finally{console.log=originalLog;console.warn=originalWarn;global.fetch=originalFetch;}
}
if(require.main===module)run().then(report=>{const out=process.argv[process.argv.indexOf("--out")+1];if(process.argv.includes("--out"))fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({total:report.total,networkCalls:report.networkCalls,result:"PASS"}));}).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={run};
