"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {classificarCategoriaOferta}=require("../marketplaces/inteligencia/classificador-categorias");
const {classificarCategoriaUniversal}=require("../modules/inteligencia-universal/categoria.service");
const {avaliarOfertaUniversal}=require("../modules/inteligencia-universal/oferta-universal.service");
const {avaliarFamiliaFuncional}=require("../marketplaces/inteligencia/evidencia-funcional");
const {destinoAceitaOferta}=require("../utils/destinos");
const positives=[
 ["HUAWEI WiFi AX2S, roteador WS7000 V2, Dual Band, Wi-Fi 6","Periféricos"],
 ["Router TP-Link AX1500 WiFi 6","Periféricos"],
 ["Access Point Aruba rede sem fio","Periféricos"],
 ["Switch de rede Ethernet gigabit 8 portas","Periféricos"],
 ["Caixa Amplificada Mondial CM-400-L 400W RMS","Audio TV"],
 ["Caixa acústica Frahm 200W RMS","Audio TV"],
 ["Alto falante marca alternativa 20W RMS","Audio TV"],
 ["Vara Saint Plus 1,73m 7-17lbs","Pesca e Camping"],
 ["Isca de corrico fabricante alternativo","Pesca e Camping"],
 ["Ração furadinha para pesca em anzol","Pesca e Camping"]
];
for(const [titulo,categoria]of positives)test(`integração compartilhada: ${titulo}`,()=>{
 for(const clienteId of ["tenant_a","tenant_b"])for(const marketplace of ["mercadolivre","shopee","amazon","aliexpress","magalu","kabum","awin"])
 for(const origem of ["radar","teleradar","clonador_grupos"]){
  const offer={id:"same-product-id",clienteId,workspaceId:clienteId,titulo,categoria:"Diversos",marketplace,origem,
   precoAtual:83.51,precoOriginal:145.90,precoPix:83.51,cupom:"FIXTURE20",cupomTipo:"codigo",beneficioTexto:"PIX",
   linkOriginal:"https://example.test/product",linkAfiliado:`https://example.test/${clienteId}/affiliate`,
   destinoId:"same-destination-id",dedupeKey:`${clienteId}:same-product-id`,ttl:900,cadencia:60};
  const snapshot=structuredClone(offer);
  assert.equal(classificarCategoriaOferta(offer),categoria);
  assert.equal(classificarCategoriaUniversal(offer).categoria,categoria);
  const result=avaliarOfertaUniversal(offer,{clienteId,origem});
  assert.equal(result.categoria,categoria);
  for(const key of ["titulo","clienteId","marketplace","origem","precoAtual","precoOriginal","cupom","beneficioTexto","linkOriginal","linkAfiliado"])
   assert.deepEqual(result.ofertaUniversal[key],offer[key],key);
  assert.deepEqual(offer,snapshot,"classificação não altera o envelope comercial");
  const routed={...offer,categoria:result.categoria};
  for(const target of ["Pesca e Camping","Periféricos","Audio TV","Ferramentas","Pet Shop e Fazendinha","Casa, Móveis e Decoração"]){
   const destination={id:"same-destination-id",workspaceId:clienteId,ativo:true,marketplaces:[marketplace],categorias:[target],origemOfertas:"ambos"};
   assert.equal(destinoAceitaOferta(destination,routed),target===categoria,`${origem}:${marketplace}:${target}`);
  }
 }
});
test("controles negativos não herdam rede ou áudio",()=>{
 for(const titulo of ["Roteador de madeira para marcenaria","Router CNC para madeira 1200W","Caixa organizadora Mondial 400 litros","Caixa organizadora para caixa amplificada 400W RMS","Suporte para caixa amplificada 400W RMS","Capa de roteador WiFi AX2S","Manual roteador WiFi 6","Caixa de ferramentas 400 peças","Camiseta Huawei WiFi AX2S","Carregador para roteador WiFi AX2S"]){
  assert.ok(!["Periféricos","Audio TV"].includes(classificarCategoriaUniversal({titulo,categoria:"Diversos"}).categoria),titulo);
 }
 assert.equal(classificarCategoriaUniversal({titulo:"Roteador de madeira para marcenaria",categoria:"Diversos"}).categoria,"Ferramentas");
});
test("atributos e descrição disponíveis não viram prova pelo grupo ou campos privados",()=>{
 assert.equal(classificarCategoriaUniversal({titulo:"Equipamento AX",descricao:"Roteador de rede WiFi 6 dual band",categoria:"Diversos"}).categoria,"Periféricos");
 assert.equal(classificarCategoriaUniversal({titulo:"Equipamento",atributos:[{nome:"Tipo",valor:"Caixa amplificada"},{nome:"Potência RMS",valor:"400W RMS"}],categoria:"Diversos"}).categoria,"Audio TV");
 assert.equal(avaliarFamiliaFuncional({titulo:"Produto desconhecido",grupoNome:"Roteador WiFi",atributos:{token:"roteador WiFi"}}),null);
 assert.equal(avaliarFamiliaFuncional({titulo:"Panela de pressão",descricao:"Veja também roteador WiFi"}),null);
 assert.equal(classificarCategoriaUniversal({titulo:"Roteador WiFi e caixa amplificada RMS",categoria:"Diversos"}).categoria,"Diversos");
});
test("laboratório ausente; correções chegam pelo mesmo serviço já usado pela Engine",()=>{
 const root=path.resolve(__dirname,"..");
 assert.equal(fs.existsSync(path.join(root,"modules/inteligencia-universal/classificador-estrutural.candidate.js")),false);
 assert.match(fs.readFileSync(path.join(root,"modules/engine/importer/importer.service.js"),"utf8"),/avaliarOfertaUniversal\(/);
 assert.match(fs.readFileSync(path.join(root,"modules/clonador-grupos/bridge.js"),"utf8"),/registrarEventoBruto/);
 for(const name of ["shopee","mercadolivre","amazon"])
  assert.match(fs.readFileSync(path.join(root,`modules/engine/importer/adapters/${name}.adapter.js`),"utf8"),/classificador-categorias/);
});
test("adapter Shopee real reutiliza classificação sem rede e mantém afiliação da workspace",async()=>{
 const {importarShopeeEngine}=require("../modules/engine/importer/adapters/shopee.adapter");
 const saved=global.fetch;global.fetch=async()=>{throw Error("NETWORK_FORBIDDEN_IN_FIXTURE");};
 try{for(const clienteId of ["tenant_a","tenant_b"]){
  const url="https://www.shopee.com.br/product/123/456",titulo=positives[0][0];
  const result=await importarShopeeEngine({job:{id:1,evento_id:2,cliente_id:clienteId},
   evento:{texto_original:`${titulo}\nR$ 83,51\n${url}`,links_extraidos:[url]},
   links:[{id:1,url_original:url,url_normalizada:url,url_expandida:"",marketplace_detectado:"shopee",metadata:{}}],
   deps:{getIntegracaoCliente:()=>({credenciais:{appId:clienteId,secret:"fixture-only"}}),
    importarShopee:async()=>({titulo,precoAtual:"83.51",precoOriginal:"145.90",imagem:"https://example.test/router.jpg",categoria:"Shopee",shopId:"123",itemId:"456",linkExpandido:url,linkAfiliado:`${url}?mmp_pid=an_${clienteId}`})}});
  assert.equal(result.ok,true,JSON.stringify({motivo:result.motivo,motivoDetalhe:result.motivoDetalhe}));assert.equal(result.categoria,"Periféricos");assert.equal(result.titulo,titulo);
  assert.match(result.linkAfiliado,new RegExp(clienteId));
  assert.equal(result.metadata.afiliacaoWorkspace.workspaceId,clienteId);
  assert.equal(result.metadata.afiliacaoWorkspace.conversaoStatus,"convertida");
 }}finally{global.fetch=saved;}
});
