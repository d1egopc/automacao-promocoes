"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../modules/engine/database").queryEngine = async () => ({ ok: true, resultado: {rowCount:1,rows:[]} });
const service = require("../modules/engine/importer/importer.service");
const { importarMercadoLivreEngine } = require("../modules/engine/importer/adapters/mercadolivre.adapter");
const url="https://produto.mercadolivre.com.br/MLB-123456789-produto-_JM";
const original="https://meli.la/fixture";
const title="Placa de captura HDMI USB 3.0 1080p";
async function run({id="MLB123456789", officialTitle=title, resolved=true, workspace="synthetic_A"}={}) {
 const job={id:"synthetic_job",evento_id:"synthetic_event",cliente_id:workspace};
 const evento={texto_original:"GRUPO DE OFERTAS GERAIS\nDE R$ 150,00\nPOR R$ 99,90\nCupom: TESTE10",metadata:{radarMirror:{produto:{tituloCapturado:"Grupo de ofertas Gerais"},preco:{atualCapturado:99.9,anteriorCapturado:150},cupom:{codigoCapturado:"TESTE10"}}}};
 const links=[{id:"synthetic_link",url_original:original,ordem:1,papel_link:"produto"}, {id:"synthetic_link_2",url_original:url,ordem:2,papel_link:"produto"}];
 const calls=[];
 const result=await importarMercadoLivreEngine({job,evento,links,deps:{
 getIntegracaoCliente:()=>({credenciais:{accessToken:"synthetic",tag:workspace}}),
 resolverLinkOriginalRadar:async()=>resolved?{ok:true,linkResolvido:url,linkOriginalLimpo:url,urlResolvida:url,metodoResolucaoMeli:"social_action_links_show_product",provaTransporteShowProduct:{ok:true,linkResolvidoTecnico:url,actionId:"show_product",ctaPrincipalUnico:true}}:{ok:false},
 importarMercadoLivre:async(_u,_w,opts)=>{opts.registrarBloqueioOperacionalMercadoLivre({motivo:"ml_wall_captcha"});return null;},
 gerarLinkAfiliadoMercadoLivre:async(u,_i,{clienteId})=>{calls.push(clienteId);return u+"?affiliate="+clienteId;},
 adiarFallbackImagemMercadoLivre:true,
 buscarImagemOficialMercadoLivrePorMlb:async mlb=>service.buscarImagemOficialMercadoLivrePorMlb(mlb,{accessToken:"synthetic",fetchImpl:async()=>({status:200,json:async()=>({id,title:officialTitle,price:9876,pictures:[{secure_url:"https://http2.mlstatic.com/D_NQ_NP_123456-MLB123456789-O.webp"}]})})})
 }});
 return {result,job,calls};
}
test("official item response recovers title, canonical ID and occurrence proof through normalization",async()=>{
 for(const workspace of ["synthetic_A","synthetic_B"]) {
 const {result,job,calls}=await run({workspace,id:workspace==="synthetic_B"?"MLB-123456789":"MLB123456789"});
 assert.equal(result.ok,true);assert.equal(result.titulo,title);
 const normalized=service.normalizarOfertaImportada(result,job);
 assert.equal(normalized.titulo,title);assert.equal(service.avaliarGateIdentidadeMercadoLivre(normalized,normalized.metadata).retida,false);assert.equal(normalized.produtoIdDetectado,"MLB123456789");
 assert.equal(normalized.metadata.provaTituloTecnicoValidada.workspaceId,workspace);
 assert.equal(normalized.preco,99.9);assert.equal(normalized.precoOriginal,150);
 assert.ok(normalized.linkAfiliado.includes(workspace));assert.ok(calls.every(w=>w===workspace));
 assert.equal(result.metadata.linksComerciais[0].urlOriginal,original);
 assert.equal(result.metadata.linksComerciais.length,2);
 assert.equal(result.metadata.linksComerciais[1].urlOriginal,url);
 const missingBinding=structuredClone(result);
 delete missingBinding.metadata.produto.provaTituloOficial;
 assert.equal(service.normalizarOfertaImportada(missingBinding,job).metadata.provaTituloTecnicoValidada,undefined);
 const wrongId=structuredClone(result);
 wrongId.metadata.produto.provaTituloOficial.produtoIdCanonico="MLB987654321";
 assert.equal(service.normalizarOfertaImportada(wrongId,job).metadata.provaTituloTecnicoValidada,undefined);
 const foreign=service.normalizarOfertaImportada(result,{...job,cliente_id:"other_workspace"});
 assert.equal(foreign.metadata.provaTituloTecnicoValidada,undefined);
 }
});
for(const [name,args] of [["different item",{id:"MLB987654321"}],["missing title",{officialTitle:""}],["missing returned ID",{id:""}],["resolution failure",{resolved:false}]]) {
 test(name+" does not produce trusted title proof",async()=>{const {result,job}=await run(args);const out=service.normalizarOfertaImportada(result,job);assert.equal(out.metadata.provaTituloTecnicoValidada,undefined);});
}
