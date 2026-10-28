"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const previousSecret=process.env.JWT_SECRET;
process.env.JWT_SECRET="isolated-image-receipt-test-key-not-a-production-secret";
test.after(()=>{if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;});
const contract=require("../modules/local-worker/ml-identity.contract");
const {criarLocalWorkerService}=require("../modules/local-worker/local-worker.service");
const image=require("../modules/imagens/resolver-imagem-universal");
const {montarItemFilaEngine}=require("../modules/engine/distributor/distributor.service");
const {imagemFontePublicavel}=require("../modules/fila/fila-thumbnail.service");
const enrichment=require("../modules/engine/importer/ml-work-enrichment-shadow");
const fixture=require("./fixtures/ml-identity-image-history.json");

function raw(mlb=fixture.cases[0].mlb,at=Date.now()-1000){
 const finalUrl=`https://produto.mercadolivre.com.br/${mlb}-produto`;
 const collectedAt=new Date(at).toISOString();
 return {capability:"ml_identity_v1",contractVersion:1,marketplace:"mercadolivre",expectedMlb:mlb,observedMlb:mlb,
 identidadeValidada:true,tituloOficial:"Alicate de Corte Profissional Aço",imagemOficial:`https://http2.mlstatic.com/D_NQ_NP_${mlb}.jpg`,
 origemTitulo:"jsonld.name",origemImagem:"jsonld.image",finalUrl,canonicalUrl:finalUrl,collectedAt,
 provaTecnica:{capability:"ml_identity_v1",contractVersion:1,source:"local_first_party",provenance:"local_worker.ml_identity_v1",
 expectedMlb:mlb,observedMlb:mlb,sameProductObject:true,origemImagem:"jsonld.image",finalUrl,canonicalUrl:finalUrl,collectedAt}};
}
function http(r){return {imagemOficialUrl:r.imagemOficial,statusHttp:200,contentType:"image/jpeg"};}
async function trusted(r=raw()){
 let stored;
 const repository={obterTask:async()=>({id:"fixture",productId:r.expectedMlb,marketplace:"mercadolivre",capability:"ml_identity_v1",type:"identidade_oficial"}),
 completarIdentidade:async({resultado})=>{stored=resultado;return {ok:true};}};
 const service=criarLocalWorkerService({repository,dedicatedOwnerIds:["fixture-owner"],fetchFn:async url=>({ok:true,status:200,url,headers:{get:()=>"image/jpeg"},body:{cancel:async()=>{}}})});
 const worker={ok:true,workerType:"dedicated",ownerId:"fixture-owner",workerId:"fixture",capabilities:["ml_identity_v1"]};
 await service.resultado({worker,taskId:"fixture",...r});
 return stored;
}
function offer(result){
 const promotion=enrichment.prepararMlWorkEnrichmentAtivo({consulta:{identidadeValidada:true,cacheHit:true,resultado:result},expectedMlb:result.expectedMlb,marketplace:"mercadolivre",ativo:true});
 const canonical=enrichment.aplicarImagemMlWorkCanonica({},promotion);
 return {id:1,cliente_id:"workspace-fixture-a",marketplace:"mercadolivre",titulo:"Alicate de Corte Profissional Aço",categoria:"Diversos",produtoId:result.expectedMlb,
 imagem:canonical.imagemCanonicaDuravel,imagemUrl:canonical.imagemCanonicaDuravel,imagemOrigem:"local_worker.ml_identity_v1",imagemStatus:"local_worker_ml_identity",imagemEnviavel:true,
 preco:100,cupom:"ORIGINAL",link_original:result.finalUrl,link_afiliado:"https://example.test/affiliate-a",
 metadata:{imagemOrigem:"local_worker.ml_identity_v1",imagemEnviavel:true,localWorkerIdentityProof:canonical.localWorkerIdentityProof,
 ofcV24:{imagemComercial:{origemSelecionada:"local_worker.ml_identity_v1",imagemOficial:false,possuiMarcaFonte:false}}}};
}
for(const row of fixture.cases)test(`historical shape ${row.case}: Worker → enrichment → actual queue preparation → media gate`,async()=>{
 const result=await trusted(raw(row.mlb)),o=offer(result),before=structuredClone(o);
 assert.ok(result.provaTecnica.reciboImagem);
 assert.equal(image.temProvaImagemOficialMercadoLivre(o),true);
 const item=montarItemFilaEngine(o);
 assert.equal(item.imagem,o.imagem);assert.equal(item.imagemEnviavel,true);
 const media=imagemFontePublicavel(item,item.imagem); assert.equal(media.ok,true,JSON.stringify(media));
 assert.equal(item.preco,100);assert.equal(item.cupom,"ORIGINAL");assert.equal(item.linkAfiliado,o.link_afiliado);
 assert.deepEqual(o,before);
});
test("existing ml_image_v1 remains accepted",()=>{
 const o={imagem:"https://http2.mlstatic.com/image.jpg",imagemOrigem:"local_worker.ml_image_v1",imagemEnviavel:false,
 metadata:{localWorkerImageProof:{provenance:"local_worker.ml_image_v1",sameProductObject:true,productIdObserved:"MLB37743570"}}};
 assert.equal(image.temProvaImagemOficialMercadoLivre(o),true);
 assert.equal(image.avaliarPublicabilidadeImagemUniversal(o).ok,true);
});
for(const [name,mutate] of [
 ["different MLB",o=>o.produtoId="MLB99999999"],
 ["conflicting nested product ID",o=>o.metadata.produto={produtoId:"MLB99999999"}],
 ["conflicting original canonical link",o=>o.link_original="https://produto.mercadolivre.com.br/MLB99999999-produto"],
 ["different marketplace",o=>o.marketplace="amazon"],
 ["different observed MLB",o=>o.metadata.localWorkerIdentityProof.observedMlb="MLB99999999"],
 ["forged signature",o=>o.metadata.localWorkerIdentityProof.reciboImagem.assinatura="0".repeat(64)],
 ["missing signed receipt",o=>delete o.metadata.localWorkerIdentityProof.reciboImagem],
 ["legacy label cannot rescue forged identity",o=>{delete o.metadata.localWorkerIdentityProof.reciboImagem;o.metadata.imagemBaseOrigem="og:image.picture_id";}],
 ["changed official picture",o=>{o.imagem=o.imagemUrl="https://http2.mlstatic.com/other-product.jpg";}],
 ["nonofficial image",o=>{o.imagem=o.imagemUrl="https://example.test/image.jpg";}],
 ["Radar provenance",o=>o.metadata.imagemOrigem="radar_whatsapp"],
 ["Telegram provenance",o=>o.metadata.imagemBaseOrigem="telegram_grupo"],
 ["WhatsApp group thumbnail",o=>{o.imagem=o.imagemUrl="https://mmg.whatsapp.net/group.jpg";}],
 ["source watermark",o=>o.metadata.ofcV24.imagemComercial.possuiMarcaFonte=true],
 ["incompatible version",o=>o.metadata.localWorkerIdentityProof.contractVersion=2],
 ["missing product proof",o=>o.metadata.localWorkerIdentityProof.sameProductObject=false]
])test(`reject ${name}`,async()=>{
 const o=offer(await trusted());mutate(o);
 assert.equal(image.temProvaImagemOficialMercadoLivre(o),false);
 assert.equal(image.avaliarPublicabilidadeImagemUniversal(o).ok,false);
 assert.equal(montarItemFilaEngine(o).imagemEnviavel,false);
});
test("cache without backend HTTP validation never gains a receipt; expired cache is rejected",async()=>{
 const r=raw();
 const service=criarLocalWorkerService({repository:{obterCacheIdentidade:async()=>({result:r})}});
 const result=await service.obterIdentidadeMercadoLivre({productId:r.expectedMlb});
 assert.equal(result.provaTecnica.reciboImagem,undefined);
 assert.equal(image.avaliarPublicabilidadeImagemUniversal(offer(result)).ok,false);
 const expired=criarLocalWorkerService({repository:{obterCacheIdentidade:async()=>({result:r,expiresAt:new Date(Date.now()-1).toISOString()})}});
 assert.equal(await expired.obterIdentidadeMercadoLivre({productId:r.expectedMlb}),null);
});
test("failed official HTTP cannot mint a backend receipt",async()=>{
 let stored=false;const r=raw();
 const service=criarLocalWorkerService({repository:{obterTask:async()=>({id:1,productId:r.expectedMlb,marketplace:"mercadolivre",capability:"ml_identity_v1",type:"identidade_oficial"}),completarIdentidade:async()=>{stored=true;}},dedicatedOwnerIds:["fixture-owner"],fetchFn:async()=>({ok:false,status:403,url:r.imagemOficial,headers:{get:()=>"text/html"},body:{cancel:async()=>{}}})});
 await assert.rejects(()=>service.resultado({worker:{ok:true,workerType:"dedicated",ownerId:"fixture-owner",capabilities:["ml_identity_v1"]},taskId:1,...r}),/ml_imagem_http_nao_confirmada/);
 assert.equal(stored,false);
});
test("valid historical-shaped receipt expires at the media/queue gate without changing data",async()=>{
 const o=offer(await trusted());const old=raw(undefined,Date.now()-contract.ML_IDENTITY_IMAGE_TTL_MS-2000);
 const receipt=contract.criarReciboImagemMlIdentity(old,http(old),{agoraMs:Date.parse(old.collectedAt)+1000});
 assert.ok(receipt);
 o.metadata.localWorkerIdentityProof.reciboImagem=receipt;
 assert.equal(image.avaliarPublicabilidadeImagemUniversal(o).ok,false);
 assert.equal(montarItemFilaEngine(o).imagemEnviavel,false);
});
test("image validation hot path performs no external requests or filesystem reads",async()=>{
 const o=offer(await trusted());image.temProvaImagemOficialMercadoLivre(o);
 const fs=require("node:fs"),originalRead=fs.readFileSync,originalFetch=global.fetch;
 let reads=0,requests=0;fs.readFileSync=(...args)=>{reads++;return originalRead(...args);};global.fetch=()=>{requests++;throw Error("unexpected_network");};
 const started=performance.now();
 try{for(let i=0;i<1000;i++)assert.equal(image.avaliarPublicabilidadeImagemUniversal(o).ok,true);}finally{fs.readFileSync=originalRead;global.fetch=originalFetch;}
 assert.equal(reads,0);assert.equal(requests,0);
 console.log(JSON.stringify({kind:"image_receipt_local_benchmark",operations:1000,microsecondsPerValidation:(performance.now()-started)*1000/1000,filesystemReads:reads,externalRequests:requests}));
});
test("backend refuses divergent or unauthenticated Worker",async()=>{
 await assert.rejects(()=>trusted({...raw(),observedMlb:"MLB99999999"}),/ml_identity_mlb_divergente/);
 const service=criarLocalWorkerService({repository:{},dedicatedOwnerIds:["fixture-owner"]});
 await assert.rejects(()=>service.resultado({worker:{ok:true,workerType:"community"}}),/worker_nao_autorizado/);
});
test("expired proof and receipt cannot authorize an image",async()=>{
 const r=raw(undefined,Date.now()-contract.ML_IDENTITY_IMAGE_TTL_MS-1000);
 assert.throws(()=>contract.criarReciboImagemMlIdentity(r,http(r)),/stale/);
 const o=offer(await trusted()),receipt=o.metadata.localWorkerIdentityProof.reciboImagem;
 assert.equal(contract.validarReciboImagemMlIdentity(receipt,{expectedMlb:receipt.mlb,imagem:receipt.imagem,agoraMs:Date.parse(receipt.expiresAt)}),false);
});
test("provenance JSON alone and absent backend key fail closed",()=>{
 const o=offer(contract.validarResultadoMlIdentity(raw()));
 assert.equal(image.avaliarPublicabilidadeImagemUniversal(o).ok,false);
 const key=process.env.JWT_SECRET;delete process.env.JWT_SECRET;
 try{assert.equal(contract.criarReciboImagemMlIdentity(raw(),http(raw())),null);}finally{process.env.JWT_SECRET=key;}
});
test("trusted cache reattests HTTP-validated legacy rows without network and without extending collection expiry",async()=>{
 const r=raw();r.provaTecnica={...r.provaTecnica,...http(r)};
 let calls=0;
 const service=criarLocalWorkerService({repository:{obterCacheIdentidade:async()=>({result:r,expiresAt:new Date(Date.now()+60000).toISOString()})},fetchFn:async()=>{calls++;throw Error("unexpected_network");}});
 const result=await service.obterIdentidadeMercadoLivre({productId:r.expectedMlb});
 assert.ok(result.provaTecnica.reciboImagem);assert.equal(calls,0);
 assert.ok(Date.parse(result.provaTecnica.reciboImagem.expiresAt)<=Date.now()+60000);
 assert.equal(image.temProvaImagemOficialMercadoLivre(offer(result)),true);
});
