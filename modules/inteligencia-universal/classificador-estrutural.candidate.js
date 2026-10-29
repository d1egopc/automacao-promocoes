"use strict";
// Laboratório OFF por construção: nenhum motor/rota importa este módulo.
// Sem persistência, autoaprendizado, rede, timer, instalação ou envio.
const {createHash}=require("node:crypto");
const {categoriaExiste,CATEGORIAS_OPTIMUS}=require("../../marketplaces/inteligencia/categorias-globais");
const {avaliarEvidenciaCategoria,categoriaMarketplaceComprovada}=require("../../marketplaces/inteligencia/classificador-categorias");
const {classificarCategoriaUniversal}=require("./categoria.service");
const {extrairFatosFuncionais}=require("../../marketplaces/inteligencia/evidencia-funcional");
const VERSION="structural-lab-v1";
const ORIGENS=new Set(["radar","teleradar","clonador_grupos","manual","importer","optimus"]);
const STAGES=new Set(["confirmed_identity","validated_official","explicit_nature","legacy_context","ambiguity"]);
const scopeOk=value=>typeof value==="string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const hash=value=>createHash("sha256").update(value).digest("hex");
const factsHash=offer=>hash(extrairFatosFuncionais(offer).texto);
function createStructuralClassifier({authorizeFeedback=()=>false,now=Date.now,maxWorkspaces=128,maxEntriesPerWorkspace=64,ttlMs=86400000}={}) {
  // Autorização deve vir do adaptador administrativo confiável futuro, nunca do DTO.
  // Limites globais fixos impedem cardinalidade/memória sem teto por tenant.
  const quota=Math.max(1,Math.min(128,Number(maxWorkspaces)||128));
  const perTenant=Math.max(1,Math.min(64,Number(maxEntriesPerWorkspace)||64));
  const ttl=Math.max(1000,Math.min(86400000,Number(ttlMs)||86400000));
  const identities=new WeakMap(),tenants=new Map();
  const state=workspaceId=>{
    if(!scopeOk(workspaceId))throw new Error("workspace_required");
    if(!tenants.has(workspaceId)) {
      if(tenants.size>=quota)throw new Error("workspace_capacity_reached");
      tenants.set(workspaceId,{entries:new Map(),audit:[],metrics:{total:0,diversos:0,ambiguous:0,byCategory:{},byStage:{},byReason:{},byOrigin:{}}});
    }
    return tenants.get(workspaceId);
  };
  function attestIdentity({workspaceId,marketplace,productId,variantId="",evidenceRef}={}) {
    // Chamada de uma fronteira de importador confiável, sem endpoint publicado.
    if(!scopeOk(workspaceId)||!new Set(["mercadolivre","shopee","amazon","aliexpress","magalu","kabum","awin"]).has(marketplace)||
       !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?$/.test(productId||"")||String(productId).length>80||
       !/^[a-zA-Z0-9_-]{0,80}$/.test(variantId)||!scopeOk(evidenceRef))throw new Error("verified_identity_required");
    const proof=Object.freeze({});
    identities.set(proof,Object.freeze({workspaceId,marketplace,key:hash(`${marketplace}|${productId}|${variantId}`)}));
    return proof;
  }
  function identity(proof,workspaceId,offer={}) {
    const value=identities.get(proof);
    if(!value || value.workspaceId!==workspaceId || value.marketplace!==offer.marketplace)return null;
    const productId=offer.produtoId||offer.productId;
    if(!productId||hash(`${offer.marketplace}|${productId}|${offer.variantId||""}`)!==value.key)return null;
    return value;
  }
  function confirm({workspaceId,identityProof,offer,category,expectedRevision=0,actorRef,reasonCode}={}) {
    if(authorizeFeedback({workspaceId,actorRef,action:"confirm_classification"})!==true)throw new Error("feedback_not_authorized");
    const id=identity(identityProof,workspaceId,offer);
    if(!id||!categoriaExiste(category)||!scopeOk(actorRef)||!scopeOk(reasonCode))throw new Error("confirmation_invalid");
    const s=state(workspaceId),previous=s.entries.get(id.key),revision=previous?.revision||0;
    if(expectedRevision!==revision)throw new Error("stale_feedback_revision");
    if(!previous&&s.entries.size>=perTenant)throw new Error("identity_capacity_reached");
    const record=Object.freeze({category,revision:revision+1,version:VERSION,factsHash:factsHash(offer),confirmedAt:now(),expiresAt:now()+ttl,revoked:false});
    s.entries.set(id.key,record);
    s.audit.push(Object.freeze({action:"confirm",identityRef:id.key.slice(0,16),actorRef,reasonCode,revision:record.revision,at:record.confirmedAt,version:VERSION}));
    if(s.audit.length>128)s.audit.shift();
    return {...record};
  }
  function revoke({workspaceId,identityProof,offer,expectedRevision,actorRef}={}) {
    if(authorizeFeedback({workspaceId,actorRef,action:"revoke_classification"})!==true)throw new Error("feedback_not_authorized");
    const id=identity(identityProof,workspaceId,offer),s=state(workspaceId),entry=id&&s.entries.get(id.key);
    if(!entry||expectedRevision!==entry.revision)throw new Error("stale_feedback_revision");
    const next=Object.freeze({...entry,revoked:true,revision:entry.revision+1});s.entries.set(id.key,next);
    s.audit.push(Object.freeze({action:"revoke",identityRef:id.key.slice(0,16),actorRef,revision:next.revision,at:now(),version:VERSION}));
    if(s.audit.length>128)s.audit.shift();
    return {revision:next.revision,revoked:true};
  }
  function decide(offer={}, {workspaceId,identityProof,origin="importer"}={}) {
    const s=state(workspaceId),id=identity(identityProof,workspaceId,offer),entry=id&&s.entries.get(id.key);
    const official=categoriaMarketplaceComprovada(offer),evidence=avaliarEvidenciaCategoria(offer);
    const nature=evidence?.origem==="identidade_produto"?evidence:null;
    let category,stage,reason;
    const usable=entry&&!entry.revoked&&entry.version===VERSION&&entry.expiresAt>now()&&entry.factsHash===factsHash(offer);
    const contradictions=new Set([usable?entry.category:null,official?.categoria,nature?.categoria].filter(Boolean));
    if(contradictions.size>1||official?.conflito) {
      category="Diversos";stage="ambiguity";reason="trusted_evidence_conflict";
    } else if(usable) {
      category=entry.category;stage="confirmed_identity";reason="human_confirmed_exact_identity";
    } else if(official) {
      category=official.categoria;stage="validated_official";reason="official_provenance_and_identity";
    } else if(nature) {
      category=nature.categoria;stage=category==="Diversos"?"ambiguity":"explicit_nature";reason="explicit_product_nature";
    } else {
      const result=classificarCategoriaUniversal(offer);
      category=result.categoria;stage=category==="Diversos"?"ambiguity":"legacy_context";
      reason=category==="Diversos"?"unrecognized_or_insufficient_context":"legacy_unvalidated_context";
    }
    if(!categoriaExiste(category)) {category="Diversos";stage="ambiguity";reason="invalid_category";}
    const metrics=s.metrics;metrics.total++;metrics.diversos+=Number(category==="Diversos");metrics.ambiguous+=Number(stage==="ambiguity");
    metrics.byCategory[category]=(metrics.byCategory[category]||0)+1;
    metrics.byStage[stage]=(metrics.byStage[stage]||0)+1;
    metrics.byReason[reason]=(metrics.byReason[reason]||0)+1;
    const source=ORIGENS.has(origin)?origin:"other";metrics.byOrigin[source]=(metrics.byOrigin[source]||0)+1;
    return {categoria:category,stage,reason,version:VERSION,requiresReview:stage==="ambiguity",semantic:"not_installed",confidence:stage==="legacy_context"?"heuristic":stage==="ambiguity"?"low":"evidence_based"};
  }
  return Object.freeze({attestIdentity,confirm,revoke,decide,
    metrics:workspaceId=>{const s=state(workspaceId);return structuredClone({...s.metrics,diversosRate:s.metrics.total?s.metrics.diversos/s.metrics.total:null,entries:s.entries.size,version:VERSION});},
    audit:workspaceId=>structuredClone(state(workspaceId).audit),
    limits:Object.freeze({maxWorkspaces:quota,maxEntriesPerWorkspace:perTenant,ttlMs:ttl,maxAuditPerWorkspace:128,maxCategoryLabels:CATEGORIAS_OPTIMUS.length,maxStageLabels:STAGES.size,maxOriginLabels:ORIGENS.size+1})});
}
module.exports={createStructuralClassifier,VERSION};
