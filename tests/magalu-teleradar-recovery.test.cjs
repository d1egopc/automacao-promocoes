'use strict';
const assert=require('node:assert/strict');
const {createEnvelope}=require('../modules/teleradar/envelope.contract');
const {createRadarIngressAdapter}=require('../modules/teleradar/radar-ingress.adapter');
const {detectarMarketplaceHost}=require('../modules/engine/normalizers');
(async()=>{
 const urls=['https://magazineluiza.onelink.me/589508454/itfgrdhg','https://magazineluiza.onelink.me/589508454/b1agb5jp','https://www.magazineluiza.com.br/produto/p/240466500/','https://www.magazinevoce.com.br/magazinelojateste/produto/p/240466500/'];
 for(const [index,url] of urls.entries()){
  assert.equal(detectarMarketplaceHost(new URL(url).hostname),'magalu');
  const text='Oferta factual de teste\nPor R$ 83,51\nCupom: CUPOM20AMEND\n'+url;
  const envelope=createEnvelope({accountId:'100',chatId:'-1001',messageId:String(100+index),receivedAt:'2026-10-28T17:18:00Z',sourceTimestamp:'2026-10-28T17:18:00Z',text,entities:[{type:'url',occurrence:0,offset:text.indexOf(url),length:url.length,label:url,url}]});
  let received=false;
  const adapter=createRadarIngressAdapter({processarMensagemRadar:async(...args)=>{received=true;assert.ok(JSON.stringify(args).includes(url));assert.ok(JSON.stringify(args).includes('CUPOM20AMEND'));return {radarAccepted:true,radarAck:'RADAR_ACCEPTED',radarEventId:'fixture-event'};}});
  const result=await adapter.accept(envelope);assert.equal(received,true);assert.equal(result.accepted,true);
 }
 assert.notEqual(detectarMarketplaceHost('magazineluiza.onelink.me.evil.test'),'magalu');
 console.log('Magalu Telegram handoff/legacy/domain: PASS (fixtures only; no production ingress claimed)');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

