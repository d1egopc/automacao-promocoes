"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),cp=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shopee-context-fixture-'));process.env.DATA_DIR=dir;
const cases=require('./fixtures/shopee-recovery-20261028.json');
const base='12589a07843954fb6ea858f34da4c56861e64f8a';
const adapterFile=path.resolve('modules/engine/importer/adapters/shopee.adapter.js');
const baseline=new Module(adapterFile,module);baseline.filename=adapterFile;baseline.paths=Module._nodeModulePaths(path.dirname(adapterFile));baseline._compile(cp.execFileSync('git',['show',base+':modules/engine/importer/adapters/shopee.adapter.js'],{encoding:'utf8'}),adapterFile);
const candidate=require(adapterFile).importarShopeeEngine;
const {criarImportarShopee}=require('../marketplaces/shopee/importar');
const originalFetch=global.fetch,originalLog=console.log;
let calls=0,reads=0,queries=0;
async function fixture(row,run=candidate,options={}){
 const workspace=options.workspace||'fixture_A',app=workspace==='fixture_A'?'100':'200';
 const u='https://s.shopee.com.br/FIXTURE'+row.eventId;
 const canonical=row.product?`https://shopee.com.br/product/${row.product.shopId}/${row.product.itemId}`:'https://shopee.com.br/m/cupom-fixture';
 const affiliate=canonical+'?mmp_pid=an_'+app;
 const integration={credenciais:{appId:app,secret:'fixture-only'}};
 const input={job:{id:row.jobId,evento_id:row.eventId,cliente_id:workspace},evento:{id:row.eventId,origem:'radar',origem_tipo:'telegram',texto_original:'Produto de teste\nPor R$ 79,90\nCupom: PROMO10\n'+u,links_extraidos:[u]},links:[{url_original:u,metadata:{papelLink:row.role,papelLinkMotivo:'contexto_'+row.role}}]};
 if(options.known)input.links[0].url_expandida=canonical;
 const imported=criarImportarShopee({limparPreco:v=>String(v||'').replace(/^R\$\s*/i,''),htmlDecode:v=>String(v||''),extrairMeta:()=>'',corrigirImagemUrl:v=>String(v||'')});
 global.fetch=async(url,config={})=>{
  if(String(url)!=='https://open-api.affiliate.shopee.com.br/graphql')return {status:200,text:async()=>'<html></html>'};
  queries++;assert.match(JSON.parse(config.body).query,/productOfferV2/);assert.ok(!JSON.parse(config.body).query.includes('mutation'));
  const nodes=(!row.product||options.empty)?[]:[{...row.product,itemId:options.wrong?'999999999':row.product.itemId,productName:'Ferramenta de teste factual',productLink:canonical,offerLink:affiliate,imageUrl:'https://cf.shopee.com.br/file/fixture.jpg',priceMin:'99.90',priceMax:'99.90'}];
  return {status:200,json:async()=>({data:{productOfferV2:{nodes}}})};
 };
 const result=await run({...input,deps:{getIntegracaoCliente:w=>!options.noIntegration&&w===workspace?integration:null,
  resolverRedirectContextualShopee:async(_url,limits)=>{reads++;assert.equal(limits.timeout,4500);assert.equal(limits.maxRedirects,4);return {request:{res:{responseUrl:canonical}}};},
  importarShopee:async(url,config)=>{calls++;return imported(url,config)},
  expandirShortlinkShopee:async()=> options.foreign?canonical+'?mmp_pid=an_999':options.wrongDestination?'https://shopee.com.br/product/99/88?mmp_pid=an_'+app:affiliate}});
 return {result,input,canonical,app};
}
(async()=>{
 console.log=()=>{};
 let before=0,after=0;
 for(const row of cases){
  const b=await fixture(row,baseline.exports.importarShopeeEngine);assert.equal(b.result.ok,false);assert.equal(b.result.motivo,'sem_link_produto_entre_links_auxiliares');before+=!!b.result.ok;
  const c=await fixture(row);if(row.product){assert.equal(row.product.officialApiMatched,true);assert.equal(c.result.ok,true,JSON.stringify({id:row.eventId,reason:c.result.motivo}));assert.equal(c.result.preco,79.9);assert.equal(c.result.linkOriginal,c.input.links[0].url_original);assert.equal(c.input.links[0].metadata.papelLink,row.role,'original input immutable');after++;}else assert.equal(c.result.ok,false,'landing remains blocked');
 }
 assert.equal(before,0);assert.equal(after,18);
 const r=cases.find(x=>x.product);
 for(const options of [{noIntegration:true},{empty:true},{wrong:true},{foreign:true},{wrongDestination:true}]){
  const c=await fixture(r,candidate,options);assert.equal(c.result.ok,false,JSON.stringify(options));
 }
 const n=reads;const known=await fixture(r,candidate,{known:true});assert.equal(known.result.ok,true);assert.equal(reads,n,'known destination avoids redirect');
 const a=await fixture(r,candidate,{workspace:'fixture_A'}),b=await fixture(r,candidate,{workspace:'fixture_B'});
 assert.equal(a.result.metadata.afiliacaoWorkspace.workspaceId,'fixture_A');assert.equal(b.result.metadata.afiliacaoWorkspace.workspaceId,'fixture_B');assert.notEqual(a.result.linkAfiliado,b.result.linkAfiliado);
 console.log=originalLog;console.log(JSON.stringify({baseline:before,candidate:after,events:cases.length,uniqueProducts:new Set(cases.filter(x=>x.product).map(x=>x.product.shopId+'/'+x.product.itemId)).size,negativeControls:5,actualImporterQueries:queries,resolverCalls:reads,network:'mocked_only',result:'PASS'}));
})().catch(e=>{console.log=originalLog;console.error(e.stack);process.exitCode=1;}).finally(()=>{global.fetch=originalFetch;console.log=originalLog;fs.rmSync(dir,{recursive:true,force:true});});
