"use strict";
const assert=require("node:assert/strict"),test=require("node:test");
const {classificarCategoriaUniversal:classify}=require("../modules/inteligencia-universal/categoria.service");
const {avaliarFamiliaFuncional,extrairFatosFuncionais}=require("../marketplaces/inteligencia/evidencia-funcional");
const {createStructuralClassifier}=require("../modules/inteligencia-universal/classificador-estrutural.candidate");
const {criarEvidenciaCategoriaMarketplace}=require("../marketplaces/inteligencia/classificador-categorias");
const positive=[
 ["HUAWEI WiFi AX2S, roteador WS7000 V2, Dual Band, Wi-Fi 6","Periféricos"],
 ["Roteador fabricante alternativo dual band 802.11ax","Periféricos"],
 ["Router TP-Link AX1500 WiFi 6","Periféricos"],
 ["Access Point Aruba rede sem fio","Periféricos"],
 ["Switch de rede Ethernet gigabit 8 portas","Periféricos"],
 ["Caixa Amplificada Mondial CM-400-L 400W RMS","Audio TV"],
 ["Caixa amplificada marca alternativa 100W RMS","Audio TV"],
 ["Caixa acústica Frahm 200W RMS","Audio TV"],
 ["Alto falante marca alternativa 20W RMS","Audio TV"],
 ["Roteador de madeira para marcenaria","Ferramentas"]
];
for(const [titulo,category]of positive)test(`família funcional: ${titulo}`,()=>assert.equal(classify({titulo,categoria:"Diversos"}).categoria,category));
const negative=["Caixa organizadora Mondial 400 litros","Caixa organizadora para caixa amplificada 400W RMS","Suporte para caixa amplificada 400W RMS","Capa de roteador WiFi AX2S","Manual roteador WiFi 6","Caixa de ferramentas 400 peças","Router CNC para madeira 1200W","Roteador de madeira para marcenaria WiFi para controle","Armário com caixa organizadora","Camiseta Huawei WiFi AX2S","Carregador para roteador WiFi AX2S"];
for(const titulo of negative)test(`negativo funcional: ${titulo}`,()=>{
 const family=avaliarFamiliaFuncional({titulo});assert.ok(!family||!["Periféricos","Audio TV"].includes(family.categoria));
 assert.ok(!["Periféricos","Audio TV"].includes(classify({titulo,categoria:"Diversos"}).categoria));
});
test("descrição e atributos disponíveis são usados com limites; grupo/credenciais/preço não",()=>{
 assert.equal(classify({titulo:"Equipamento AX genérico",descricao:"Roteador de rede WiFi 6 dual band",categoria:"Diversos"}).categoria,"Periféricos");
 assert.equal(classify({titulo:"Equipamento de som genérico",atributos:[{nome:"Tipo",valor:"Caixa amplificada"},{nome:"Potência RMS",valor:"400W RMS"}],categoria:"Diversos"}).categoria,"Audio TV");
 const raw={titulo:"Produto desconhecido",grupoNome:"Roteador WiFi",cupom:"Caixa Amplificada",atributos:{senha:"WiFi roteador",preco:"400W RMS",token:"secret"}};
 assert.equal(avaliarFamiliaFuncional(raw),null);
 assert.ok(extrairFatosFuncionais({titulo:"X".repeat(100000),descricao:"D".repeat(100000)}).texto.length<=4200);
 assert.equal(avaliarFamiliaFuncional({titulo:"Panela de pressão",descricao:"Veja também roteador WiFi"}),null);
 assert.equal(avaliarFamiliaFuncional({titulo:"Roteador WiFi e caixa amplificada RMS"}).categoria,"Diversos");
});
const make=options=>createStructuralClassifier({authorizeFeedback:({actorRef})=>actorRef==="admin_fixture",...options});
const offer={marketplace:"shopee",produtoId:"123/456",titulo:"Produto sem nome",categoria:"Diversos"};
const proof=(lab,workspaceId="tenant_a",productId="123/456",variantId="")=>lab.attestIdentity({workspaceId,marketplace:"shopee",productId,variantId,evidenceRef:"importer_fixture"});
const confirm=(lab,p,extra={})=>lab.confirm({workspaceId:"tenant_a",identityProof:p,offer,category:"Audio TV",actorRef:"admin_fixture",reasonCode:"owner_review",...extra});
test("feedback confirmado reutiliza identidade exata e não aprende de saídas próprias",()=>{
 const lab=make(),p=proof(lab);assert.equal(lab.decide(offer,{workspaceId:"tenant_a",identityProof:p}).categoria,"Diversos");
 confirm(lab,p);const result=lab.decide(offer,{workspaceId:"tenant_a",identityProof:p});
 assert.equal(result.categoria,"Audio TV");assert.equal(result.stage,"confirmed_identity");
 assert.equal(lab.decide(offer,{workspaceId:"tenant_a",identityProof:{...p}}).categoria,"Diversos");
 assert.equal(lab.decide({...offer,produtoId:"123/999"},{workspaceId:"tenant_a",identityProof:p}).categoria,"Diversos");
 assert.notEqual(lab.decide({...offer,titulo:"Geladeira frost free"},{workspaceId:"tenant_a",identityProof:p}).stage,"confirmed_identity");
 assert.equal(lab.decide({...offer,preco:999,cupom:"NOVO",linkAfiliado:"https://example.test/changed"},{workspaceId:"tenant_a",identityProof:p}).stage,"confirmed_identity");
 assert.equal(lab.metrics("tenant_a").entries,1);
});
test("nega confirmação não autorizada, CAS obsoleto e identidade sem prova",()=>{
 const denied=createStructuralClassifier(),p=proof(denied);assert.throws(()=>confirm(denied,p),/not_authorized/);
 const lab=make(),id=proof(lab);confirm(lab,id);
 assert.throws(()=>confirm(lab,id),/stale_feedback_revision/);
 assert.throws(()=>confirm(lab,{}),/confirmation_invalid/);
 assert.throws(()=>confirm(lab,id,{expectedRevision:1,category:"Nova categoria inventada"}),/confirmation_invalid/);
});
test("workspace, marketplace, variante, expiração e revogação isolam a reutilização",()=>{
 let clock=10000;const lab=make({now:()=>clock,ttlMs:1000}),p=proof(lab);confirm(lab,p);
 assert.equal(lab.decide(offer,{workspaceId:"tenant_b",identityProof:p}).categoria,"Diversos");
 assert.equal(lab.decide({...offer,marketplace:"amazon"},{workspaceId:"tenant_a",identityProof:p}).categoria,"Diversos");
 assert.equal(lab.decide({...offer,variantId:"another"},{workspaceId:"tenant_a",identityProof:p}).categoria,"Diversos");
 clock+=1001;assert.equal(lab.decide(offer,{workspaceId:"tenant_a",identityProof:p}).categoria,"Diversos");
 confirm(lab,p,{expectedRevision:1});lab.revoke({workspaceId:"tenant_a",identityProof:p,offer,expectedRevision:2,actorRef:"admin_fixture"});
 assert.equal(lab.decide(offer,{workspaceId:"tenant_a",identityProof:p}).categoria,"Diversos");
 assert.deepEqual(lab.audit("tenant_b"),[]);
});
test("categoria oficial validada vence fallback, JSON forjado não vira prova e conflito abstém",()=>{
 const lab=make();const official=criarEvidenciaCategoriaMarketplace({marketplace:"shopee",fonte:"shopee_affiliate_graphql",produtoId:"123/456",hierarquia:["computer peripherals"]});
 const product={...offer,categoriaMarketplace:official};
 assert.equal(lab.decide(product,{workspaceId:"tenant_a"}).stage,"validated_official");
 assert.notEqual(lab.decide({...product,categoriaMarketplace:JSON.parse(JSON.stringify(official))},{workspaceId:"tenant_a"}).stage,"validated_official");
 assert.equal(lab.decide({...product,titulo:"Caixa amplificada 400W RMS"},{workspaceId:"tenant_a"}).reason,"trusted_evidence_conflict");
});
test("cache, métricas e auditoria são limitados e não guardam texto, URL ou credencial",()=>{
 const lab=make({maxWorkspaces:2,maxEntriesPerWorkspace:1});const p=proof(lab);confirm(lab,p);
 const second=proof(lab,"tenant_a","999/888");assert.throws(()=>confirm(lab,second,{offer:{...offer,produtoId:"999/888"}}),/capacity/);
 lab.decide({...offer,descricao:"https://private.invalid secret_cookie",grupoNome:"Grupo privado"},{workspaceId:"tenant_a",origin:"private-high-cardinality"});
 lab.decide(offer,{workspaceId:"tenant_b"});assert.throws(()=>lab.decide(offer,{workspaceId:"tenant_c"}),/capacity/);
 const snapshot=JSON.stringify({metrics:lab.metrics("tenant_a"),audit:lab.audit("tenant_a")});assert.doesNotMatch(snapshot,/private|cookie|Produto sem nome|123\/456/);
 assert.equal(lab.metrics("tenant_a").byOrigin.other,1);
 assert.equal(lab.metrics("tenant_a").byReason.unrecognized_or_insufficient_context,1);
});
test("os dois casos preservam integralmente dados comerciais e não dependem de workspace/marca",()=>{
 for(const workspaceId of ["tenant_a","tenant_b"])for(const [titulo,categoria]of positive.slice(0,9)) {
  const product={titulo,workspaceId,marketplace:"shopee",categoria:"Diversos",preco:98,cupom:"FIXTURE",linkOriginal:"https://example.test/unchanged",linkAfiliado:`https://example.test/${workspaceId}`};
  const before=structuredClone(product);assert.equal(classify(product).categoria,categoria);assert.deepEqual(product,before);
 }
});

test("cem workspaces com IDs iguais não compartilham confirmação; cardinalidade fica limitada",()=>{
 const lab=make();
 for(let i=0;i<100;i++) {
  const workspaceId=`tenant_${i}`,p=proof(lab,workspaceId);
  const category=i%2?"Audio TV":"Periféricos";
  confirm(lab,p,{workspaceId,category});
  assert.equal(lab.decide(offer,{workspaceId,identityProof:p,origin:`private_${i}`}).categoria,category);
  assert.equal(lab.metrics(workspaceId).entries,1);
  assert.deepEqual(Object.keys(lab.metrics(workspaceId).byOrigin),["other"]);
 }
});

test("sem rede, disco ou mutação por decisão; laboratório não é importado por motor/rota",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const oldFetch=global.fetch,oldRead=fs.readFileSync,oldWrite=fs.writeFileSync;
 const fail=()=>{throw new Error("unexpected_io");};
 const lab=make(),p=proof(lab);confirm(lab,p);
 global.fetch=fail;fs.readFileSync=fail;fs.writeFileSync=fail;
 try { for(let i=0;i<100;i++)assert.equal(lab.decide(offer,{workspaceId:"tenant_a",identityProof:p}).stage,"confirmed_identity"); }
 finally {global.fetch=oldFetch;fs.readFileSync=oldRead;fs.writeFileSync=oldWrite;}
 for(const file of ["index.js","modules/inteligencia-universal/categoria.service.js","marketplaces/inteligencia/classificador-categorias.js"])
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname,"..",file),"utf8"),/require\([^\n]*classificador-estrutural\.candidate/);
});
