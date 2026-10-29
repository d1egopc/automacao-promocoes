"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'magalu-boundary-'));
process.env.DATA_DIR=temp;
process.on('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));
const contract=require('../modules/local-worker/magalu-identity.contract');
const registry=require('../optimus-capture/adapters/registry');
const adapter=require('../modules/engine/importer/adapters/magalu.adapter');
const resolverPath=process.env.MAGALU_BOUNDARY_BASELINE
 ? path.join(process.env.MAGALU_BOUNDARY_BASELINE,'optimus-capture/local-worker/magalu-identity.js')
 : require.resolve('../optimus-capture/local-worker/magalu-identity');
const source=fs.readFileSync(resolverPath,'utf8');
// One official public DOM snapshot; other product facts and all tenant credentials are synthetic.
const official=require('./fixtures/magalu-official-pdp-242057800.json');
const samples=[['y4w9198t','237736500'],['t65ipuoe','238818200'],['q6mruvn4','242057800']];
const products=[];
function fixture(sample=samples[0],options={}){
 const [token,sku]=sample;const oneLink=`https://magazineluiza.onelink.me/589508454/${token}`;
 const real=token===official.sourceOneLink;
 const url=real?official.finalUrl:`https://www.magazineluiza.com.br/produto-fixture/p/${sku}/ud/test/`;
 const product=real?{...official.products[0]}:{name:'Produto sintético de identidade Magalu',sku,image:`https://a-static.mlcdn.com.br/${sku}.jpg`,offers:{price:'100.00',priceCurrency:'BRL'}};
 if(options.wrongSku)product.sku='999999999';
 const html=options.blocked ? '<html><title>Access Denied</title>HTTP 403</html>' :
  `<script type="application/ld+json">${JSON.stringify({'@type':'Product',...product})}</script>`;
 let calls=0,opens=0,closes=0,receiver;const delays=[];
 const context={URL,AbortController,Date,console,fetch:async()=>({ok:false,status:403,redirected:true,url,body:{cancel:async()=>{}}}),
  setTimeout:(fn,ms)=>{if(ms<1000)delays.push(ms);return setTimeout(fn,ms);},clearTimeout,
  chrome:{tabs:{create:async()=>{opens++;return{id:71,status:'complete',url};},
   get:async()=>({id:71,status:'complete',url:options.navigated&&calls>0?url.replace(sku,'888888888'):url}),
   sendMessage:async(id,message,frame)=>{
    assert.equal(id,71);assert.equal(frame.frameId,0);assert.equal(message.type,'OPTIMUS_CAPTURE_PAGE');calls++;
    if(options.error)throw Error(options.error);
    if(options.missingAlways||calls<2)throw Error('Could not establish connection. Receiving end does not exist.');
    if(!receiver){
     const page={chrome:{runtime:{onMessage:{addListener:fn=>{receiver=fn;}}}},OptimusCaptureRegistry:registry,
      document:{documentElement:{outerHTML:html}},window:{location:{href:url}}};
     vm.runInNewContext(fs.readFileSync(require.resolve('../optimus-capture/content/capture-content'),'utf8'),page);
    }
    let response;receiver(message,{},r=>{response=r;});return response;
   },remove:async()=>{closes++;},onUpdated:{addListener(){},removeListener(){}}}}};
 vm.runInNewContext(source,context);
 return{sku,url,oneLink,html,product,real,delays,resolve:()=>context.OptimusMagaluIdentityResolver.resolver({sourceUrl:oneLink,identityKey:contract.chaveIdentidadeMagalu(oneLink)}),stats:()=>({calls,opens,closes})};
}
test('late document_idle receiver recovers and passes the backend identity contract',async()=>{
 const f=fixture();const result=await f.resolve();
 assert.equal(contract.validarResultadoMagaluIdentity(result,{sourceUrl:f.oneLink,identityKey:contract.chaveIdentidadeMagalu(f.oneLink)}).identidadeValidada,true);
 assert.equal(result.provaTecnica.statusHttp,0);assert.deepEqual(f.stats(),{calls:2,opens:1,closes:1});
});
test('permanent missing receiver is bounded and closes the only technical tab',async()=>{
 const f=fixture(samples[0],{missingAlways:true});
 await assert.rejects(f.resolve(),/magalu_identity_content_script_ausente/);
 assert.deepEqual(f.stats(),{calls:3,opens:1,closes:1});assert.ok(f.delays.reduce((a,b)=>a+b,0)<=500);
});
test('403 body and SKU-only capture cannot become confirmed identity',async()=>{
 const f=fixture(samples[1],{blocked:true});await assert.rejects(f.resolve(),/magalu_identity_produto_nao_confirmado/);
 assert.equal(f.stats().calls,2);assert.equal(f.stats().closes,1);
});
test('SKU disagreement and tab navigation remain rejected',async()=>{
 for(const options of [{wrongSku:true},{navigated:true}]){
  const f=fixture(samples[2],options);await assert.rejects(f.resolve(),/magalu_identity_produto_nao_confirmado/);
  assert.equal(f.stats().closes,1);
 }
});
test('non-receiver errors are not retried',async()=>{
 const f=fixture(samples[0],{error:'Port closed for another reason'});
 await assert.rejects(f.resolve(),/Port closed/);assert.equal(f.stats().calls,1);assert.equal(f.stats().closes,1);
});
test('public official PDP snapshot and synthetic controls preserve two workspace affiliations and Radar terms',async()=>{
 for(const sample of samples){
  const f=fixture(sample);const identity=await f.resolve();
  const radarPrice=f.real?3103.03:83.51;const title=f.product.name;const priceText=String(radarPrice.toFixed(2)).replace('.',',');
  const validated=contract.validarResultadoMagaluIdentity(identity,{sourceUrl:f.oneLink,identityKey:contract.chaveIdentidadeMagalu(f.oneLink)});
  const outputs=[];
  for(const [workspace,promoter]of [['tenant_a','lojaa'],['tenant_b','lojab']]){
   const affiliate=`https://www.magazinevoce.com.br/magazine${promoter}/produto-fixture/p/${f.sku}/ud/test/`;
   const result=await adapter.importarProdutoMagaluEngine({job:{id:1,evento_id:2,cliente_id:workspace,marketplace:'magalu'},
    evento:{origem:'radar',titulo:title,precoAtual:String(radarPrice),cupom:'FIXTURE20',texto_original:`${title}\nPor R$ ${priceText}\nCupom FIXTURE20\n${f.oneLink}`,links_extraidos:[f.oneLink]},
    links:[{id:3,url_original:f.oneLink,url_normalizada:f.oneLink,marketplace_detectado:'magalu',metadata:{}}],deps:{
     getIntegracaoCliente:cid=>cid===workspace?{credenciais:{promoterId:promoter}}:null,
     obterIdentidadeMagaluLocalWorker:async()=>validated,garantirIdentidadeMagaluLocalWorker:async()=>{throw Error('unexpected task');},
     resolverFatosMagalu:async()=>({ok:true,produtoId:f.sku,fonteUsada:f.real?'public_official_dom_snapshot':'synthetic_official_fixture',fatos:{produtoId:f.sku,codigo:f.sku,titulo:title,precoAtual:f.product.offers.price,imagem:f.product.image,categoria:f.product.category||'Utilidades Domésticas',urlOriginal:f.url,urlCanonica:affiliate,urlAfiliavelComprovada:affiliate,magaluWorkspaceValidado:true,avisos:[],metadata:{}},avisos:[]})
    }});
   assert.equal(result.ok,true);assert.equal(result.linkAfiliado,affiliate);assert.equal(Number(result.preco),radarPrice);assert.equal(result.cupom,'FIXTURE20');outputs.push(result.linkAfiliado);
   products.push({workspace,promoter,result,url:f.url,oneLink:f.oneLink,sku:f.sku,title,radarPrice,priceText});
  }
  assert.notEqual(outputs[0],outputs[1]);
 }
});
test('isolated real persistence service creates offers; no distributor or sending provider is called',async()=>{
 assert.equal(products.length,6);
 const inserts=[];const db=require.resolve('../modules/engine/database');
 require.cache[db]={id:db,filename:db,loaded:true,exports:{queryEngine:async(sql,params=[])=>{
  if(/information_schema\.columns/i.test(sql))return{ok:true,resultado:{rows:[{existe:true}]}};
  if(/INSERT INTO engine_ofertas/i.test(sql)){inserts.push(params);return{ok:true,resultado:{rows:[{id:100+inserts.length,uuid:'fixture-'+inserts.length}]}};}
  if(/UPDATE engine_ofertas\s+SET metadata/i.test(sql))return{ok:true,resultado:{rows:[{id:params[0]}]}};
  return{ok:true,resultado:{rows:[]}};
 }}};
 const service=require('../modules/engine/importer/importer.service');
 for(let i=0;i<products.length;i++){
  const p=products[i];
  const result=await service.gravarOfertaEngine({id:i+1,evento_id:i+100,cliente_id:p.workspace,marketplace:'magalu',metadata:{origemFluxo:'optimus'}},
   {id:i+100,origem:'radar',origem_tipo:'whatsapp',texto_original:`${p.title}\nPor R$ ${p.priceText}\nCupom FIXTURE20\n${p.oneLink}`,metadata:{origemFluxo:'optimus'}},
   {id:i+200,url_original:p.oneLink,url_normalizada:p.oneLink,marketplace_detectado:'magalu'},p.result,
   {getIntegracaoCliente:cid=>cid===p.workspace?{credenciais:{promoterId:p.promoter}}:null});
  assert.equal(result.ok,true);
 }
 assert.equal(inserts.length,6);
});
