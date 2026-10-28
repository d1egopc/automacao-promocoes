"use strict";
// Configuration/renderer only. Dispatch, money, claims and timers remain in
// the existing V4 engine and V3 scheduler. No external URL fetches.
const crypto = require("node:crypto");
const { fail, text, list } = require("./model");
const MODULES = Object.freeze(["welcome", "farewell", "commands", "attendance", "groupManager", "scheduled"]);
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("configuracao_invalida");
  return value;
}
function number(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail("limites_invalidos");
  return n;
}
function array(value, max) {
  if (!Array.isArray(value) || value.length > max) fail("lista_invalida");
  return value;
}
function media(input) {
  if (!input) return null;
  const m = object(input), type = m.type;
  if (!["image", "video"].includes(type)) fail("midia_invalida");
  // Keep base64 + JSON inside the existing global 10 MiB HTTP boundary.
  const max = type === "image" ? 5 * 1024 * 1024 : 6 * 1024 * 1024;
  const value = m.dataUri;
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) + 100) fail("midia_invalida");
  const match = /^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || (type === "video") !== match[1].startsWith("video/")) fail("midia_invalida");
  const b = Buffer.from(match[2], "base64");
  if (!b.length || b.length > max || b.toString("base64") !== match[2]) fail("midia_invalida");
  const valid = match[1] === "image/png" ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    match[1] === "image/jpeg" ? b[0] === 255 && b[1] === 216 && b[2] === 255 :
    match[1] === "image/webp" ? b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP" :
    b.length >= 16 && b.toString("ascii",4,8) === "ftyp" && b.readUInt32BE(0) >= 16 && b.readUInt32BE(0) <= b.length;
  if (!valid) fail("midia_invalida");
  if(type === "video") {
    const kinds=new Set(); let offset=0, count=0;
    while(offset<b.length && ++count<=1000) {
      if(offset+8>b.length) fail("midia_invalida");
      const size=b.readUInt32BE(offset), kind=b.toString("ascii",offset+4,offset+8);
      if(size<8 || offset+size>b.length) fail("midia_invalida");
      kinds.add(kind); offset+=size;
    }
    if(offset!==b.length||!kinds.has("moov")||!kinds.has("mdat")) fail("midia_invalida");
  }
  return { type, mime:match[1], bytes:b.length, dataUri:value };
}
function response(input) {
  const r = object(input), result = { text:text(r.text || "", 4000), media:media(r.media) };
  if (!result.text && !result.media) fail("resposta_vazia");
  return result;
}
function responses(input) { const r = array(input,8).map(response); if (!r.length) fail("resposta_vazia"); return r; }
function hours(input) {
  if (!input) return null;
  const h = object(input);
  if (!/^\d{2}:\d{2}$/.test(h.start || "") || !/^\d{2}:\d{2}$/.test(h.end || "") ||
      ![h.start,h.end].every(v => Number(v.slice(0,2)) < 24 && Number(v.slice(3)) < 60)) fail("horario_invalido");
  const days = [...new Set(array(h.days || [0,1,2,3,4,5,6],7))];
  if (!days.length || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) fail("horario_invalido");
  return { start:h.start, end:h.end, days, timezone:"America/Sao_Paulo" };
}
function groups(input, inherited) {
  const values = input === undefined ? undefined : list(input,100);
  if (values?.some(g => !inherited.includes(g))) fail("scope_invalid");
  return values;
}
function normalizeModule(name, input, inherited = []) {
  if (!MODULES.includes(name)) fail("card_invalido");
  const c = object(input), result = { version:1 };
  if (name !== "attendance") result.groups = groups(c.groups, inherited);
  if (["welcome","farewell"].includes(name)) return { ...result,
    responses:responses(c.responses || [{text:"Olá!"}]), delaySeconds:number(c.delaySeconds,0,0,30),
    destination:c.destination === "private" ? "private" : "group" };
  if (name === "commands") {
    const used = new Set();
    return {...result, commands:array(c.commands || [],50).map((v,i) => {
      const x = object(v), triggers = list(x.triggers || [],10);
      if (!triggers.length || triggers.some(t => !/^![\p{L}\p{N}_-]{1,40}$/u.test(t))) fail("comando_invalido");
      for (const t of triggers) { const normalized=t.toLowerCase(); if(used.has(normalized)) fail("comando_duplicado"); used.add(normalized); }
      return { id:text(x.id || `command_${i}`,100), triggers, groups:groups(x.groups, result.groups || inherited),
        cooldownSeconds:number(x.cooldownSeconds,30,0,86400), responses:responses(x.responses) };
    })};
  }
  if (name === "attendance") {
    const rules = array(c.rules || [],50).map((v,i) => { const x = object(v); return {
      id:text(x.id || `trigger_${i}`,100), terms:list(x.terms || [],20),
      match:["exact","contains","starts"].includes(x.match) ? x.match : "exact",
      priority:number(x.priority,0,0,100), responses:responses(x.responses),
      human:x.human === true, next:x.next ? text(x.next,100) : null };
    });
    if (rules.some(r => !r.terms.length) || new Set(rules.map(r=>r.id)).size !== rules.length) fail("gatilho_invalido");
    const nodes = array(c.nodes || [],30).map(v=> {const n=object(v); return {
      id:text(n.id,100), responses:responses(n.responses), options:array(n.options || [],10).map(o=>({
        terms:list(o.terms || [],10), next:o.next ? text(o.next,100) : null, human:o.human === true })) }; });
    const ids = new Set(nodes.map(n=>n.id));
    if(ids.size !== nodes.length || [...rules,...nodes.flatMap(n=>n.options)].some(r=>r.next&&!ids.has(r.next)) ||
       nodes.some(n=>!n.id || n.options.some(o=>!o.terms.length))) fail("fluxo_invalido");
    return {...result, rules, nodes, greeting:c.greeting?.length ? responses(c.greeting) : [],
      fallback:c.fallback?.length ? responses(c.fallback) : [], hours:hours(c.hours),
      delaySeconds:number(c.delaySeconds,0,0,30), cooldownSeconds:number(c.cooldownSeconds,60,0,86400),
      humanTerms:list(c.humanTerms || ["humano","atendente"],10),
      humanPauseMinutes:number(c.humanPauseMinutes,60,1,1440)};
  }
  if (name === "groupManager") {
    const { normalizeModeration } = require("./model");
    const normalized = normalizeModeration({rules:array(c.rules || [],30).map(r=>({...r,
      action:["warn","warn_ban"].includes(r.action) ? "observe" : r.action}))});
    return {...result, rules:normalized.rules.map((r,i)=>({...r,
      action:["warn","warn_ban"].includes(c.rules[i].action) ? c.rules[i].action : r.action,
      strikes:[2,4].includes(c.rules[i].strikes) ? c.rules[i].strikes : 2,
      strikeWindowMinutes:number(c.rules[i].strikeWindowMinutes,60,1,1440)}))};
  }
  return result;
}
function stateOf(profile, card, session) {
  if (!profile.cards[card]?.active) return "desativado";
  if (!profile.active || !profile.execution?.activatedAt) return "configurado";
  if (!session?.connected || session.liveReady === false) return "pendente_de_permissao";
  if(card === "groupManager") return "pendente_de_permissao"; // Admin proof is obtained at the action, never inferred from configuration.
  return "ativo";
}
function choose(values, key) {
  return values[crypto.createHash("sha256").update(String(key)).digest().readUInt32BE(0) % values.length];
}
function payload(r, variables = {}) {
  const output = String(r.text || "").replace(/\{(nome|grupo|saudacao|negocio)\}/g,(_,k)=>String(variables[k] || ""));
  if (!r.media) return {text:output};
  // prepared bytes are attached only by the repository worker after reading
  // validated configuration; HTTP normalization never accepts this property.
  const m = r.media.prepared instanceof Uint8Array ? r.media : media(r.media);
  const bytes = m.prepared instanceof Uint8Array ? Buffer.from(m.prepared.buffer,m.prepared.byteOffset,m.prepared.byteLength) : Buffer.from(m.dataUri.split(",")[1],"base64");
  return {[m.type]:bytes, ...(output ? {caption:output} : {}), ...(m.type === "video" ? {mimetype:m.mime} : {})};
}
module.exports = { MODULES, normalizeModule, media, response, responses, hours, stateOf, choose, payload };
