"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { V3Store } = require("../mensageiro-v3/src/v3/store");
const { selectProfile, cardActive } = require("../mensageiro-v3/operational-gates");
const { scheduleInput } = require("../mensageiro-v3/legacy-compat");
const {normalizeSchedule}=require("./schedule-options");
const {
  CARDS,
  lightProfile,
  normalizeIntelligence,
  normalizeModeration,
  text,
  list,
  fail,
  validateImages,
} = require("./model");
const store = new V3Store({ filePath: workerData.filePath });
const { normalizeModule, MODULES } = require("./module-contract");
const { template } = require("./templates");
const profile = (w, id) => {
  const p = store.state.workspaces[w] ? store.getProfile(w, id) : null;
  if (!p || p.id !== id || p.workspaceId !== w) fail("perfil_nao_encontrado");
  return p;
};
function conflict(w, p) {
  if (!p.active) return;
  for (const other of store.listProfiles(w)) {
    if (other.id === p.id || !other.active || other.sessionId !== p.sessionId)
      continue;
    const privateCards = ["attendance", "faq", "flows", "quickReplies"];
    if (cardActive(p,"attendance") && cardActive(other,"attendance"))
      fail("perfis_conflitantes");
    for (const card of CARDS.filter((c) => c !== "scheduled" && !privateCards.includes(c))) {
      if (!p.cards[card]?.active || !other.cards[card]?.active) continue;
      const groups = (value) =>
        value.cards[card].configuration?.gruposConfigurados === true ||
        value.cards[card].configuration?.grupos?.length
          ? value.cards[card].configuration.grupos || []
          : value.destinations || [];
      if (
        ["attendance", "faq", "flows", "quickReplies"].includes(card) ||
        groups(p).some((g) => groups(other).includes(g))
      )
        fail("perfis_conflitantes");
    }
  }
}
function saveSettings(w, p, input) {
  const attendance = p.cards.attendance;
  const manager = p.cards.groupManager;
  const exceptions = {};
  if (input.exemptions) {
    for (const key of ["isentarAdmins", "isentarDono"])
      if (typeof input.exemptions[key] === "boolean")
        exceptions[key] = input.exemptions[key];
  }
  store.saveCard(w, p.id, "attendance", {
    configuration: {
      ...attendance.configuration,
      v4: normalizeIntelligence(
        input.intelligence || attendance.configuration?.v4,
      ),
    },
  });
  const nested = manager.configuration?.configuracao;
  store.saveCard(w, p.id, "groupManager", {
    configuration: {
      ...manager.configuration,
      ...exceptions,
      ...(nested ? { configuracao: { ...nested, ...exceptions } } : {}),
      v4: {
        ...normalizeModeration(input.moderation || manager.configuration?.v4),
        migrationVersion: 4,
        sourceRevision: manager.configuration?.v4?.sourceRevision || p.revision,
      },
    },
  });
}
function execute(operation, a) {
  if (operation === "universal_sessions") {
    store.reload();
    const sessions = new Map();
    for (const [workspaceId, ws] of Object.entries(store.state.workspaces))
      for (const p of Object.values(ws.profiles || {}))
        if (p.workspaceId === workspaceId && p.execution?.version === 4) {
          sessions.set(JSON.stringify([workspaceId, p.sessionId]), { workspaceId, sessionId: p.sessionId });
          if (sessions.size > 10000) fail("v4_scope_invalid");
        }
    return [...sessions.values()];
  }
  if (operation === "outbound_targets") {
    // Read-only, bounded result in the existing worker. No runtime activation,
    // replay, refund or new financial authority after a process restart.
    store.reload();
    const targets = new Map();
    for (const [workspaceId, ws] of Object.entries(store.state.workspaces))
      for (const row of Object.values(ws.claims || {})) {
        if (row.card !== "v4_outbound" || ["settled", "not_sent"].includes(row.stage) ||
            row.identity?.workspaceId !== workspaceId || row.identity?.origin !== "mensageiro_v4" ||
            row.identity?.destinationId !== row.groupId || !row.messageId) continue;
        const t = { workspaceId, profileId: row.profileId, sessionId: row.sessionId, groupId: row.groupId };
        targets.set(JSON.stringify(t), t);
        if (targets.size > 4096) fail("v4_ack_backpressure");
      }
    return [...targets.values()];
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(a.workspaceId || ""))
    fail("workspace_invalido");
  const w = a.workspaceId;
  store.reload();
  if (operation === "module" || operation === "apply_template") return store.transaction(() => {
    const p = profile(w,a.profileId);
    if(a.expectedRevision !== p.revision) fail("conflito_revisao");
    if(operation === "apply_template") {
      if(p.active) fail("desative_perfil_para_modelo");
      const model = template(a.templateId,p.destinations);
      for(const [name,configuration] of Object.entries(model.modules)) store.saveCard(w,p.id,name,{active:false,
        configuration:{universal:configuration,...(name==="groupManager"?{v4:{migrationVersion:4,rules:[]}}:{})}});
      for(const name of ["faq","flows","quickReplies"]) store.saveCard(w,p.id,name,{active:false,configuration:p.cards[name].configuration||{}});
      const current=store.state.workspaces[w].profiles[p.id];
      current.niche=model.niche; current.template={id:model.id,version:model.version};
      return lightProfile(profile(w,p.id));
    }
    if(!MODULES.includes(a.card)) fail("card_invalido");
    const current=p.cards[a.card], previous=current.configuration?.universal;
    const config=normalizeModule(a.card,a.configuration === undefined ? previous || {} : a.configuration,p.destinations);
    const active=a.active===undefined?current.active:a.active===true;
    store.saveCard(w,p.id,a.card,{active,configuration:{...current.configuration,universal:config,
      ...(config.groups===undefined?{grupos:[],gruposConfigurados:false}:{grupos:config.groups,gruposConfigurados:true})}});
    if(a.card==="attendance") for(const name of ["faq","flows","quickReplies"]) store.saveCard(w,p.id,name,{active:false,configuration:p.cards[name].configuration||{}});
    conflict(w,profile(w,p.id));
    return lightProfile(profile(w,p.id));
  });
  if (["conversation","interaction","human","strike"].includes(operation)) {
    const p=profile(w,a.profileId);
    if(!/^[a-f0-9]{64}$/.test(a.contactRef||"")) fail("contato_invalido");
    if(operation === "conversation") return store.state.workspaces[w].messengerRuntime?.[a.contactRef] || {};
    return store.transaction(()=> {
      const current=profile(w,a.profileId);
      if(current.revision!==a.expectedRevision || current.sessionId!==a.sessionId) fail("conflito_revisao");
      if(operation!=="human" && (!current.active || current.execution?.version!==4)) fail("activation_confirmation_required");
      const ws=store.state.workspaces[w], now=Date.now();
      ws.messengerRuntime ||= {};
      for(const [key,row] of Object.entries(ws.messengerRuntime)) if(now-(row.at||0)>86400000 && !(row.humanUntil>now)) delete ws.messengerRuntime[key];
      if(Object.keys(ws.messengerRuntime).length>=1000 && !ws.messengerRuntime[a.contactRef]) fail("runtime_limit");
      const row=ws.messengerRuntime[a.contactRef] ||= {profileId:p.id,sessionId:p.sessionId,at:now,cooldowns:{}};
      if(row.profileId!==p.id || row.sessionId!==p.sessionId) fail("scope_invalid");
      if(operation === "human") {
        row.humanUntil=a.paused===true?now+Math.max(1,Math.min(1440,Number(a.minutes)||60))*60000:0;
        row.node=null;
      } else if(operation === "strike") {
        row.strikes ||= {};
        const strikeKey="rule:"+a.ruleId;
        if(Object.keys(row.strikes).length>=30&&!row.strikes[strikeKey]) fail("runtime_limit");
        const entries=(row.strikes[strikeKey]||[]).filter(e=>now-e.at<a.windowMinutes*60000);
        if(!entries.some(e=>e.id===a.eventRef)) entries.push({id:a.eventRef,at:now});
        row.strikes[strikeKey]=entries.slice(-4); row.at=now;
        store._touch(ws,"messenger_strike",{profileId:p.id,ruleId:a.ruleId,count:entries.length});
        return {count:entries.length};
      } else {
        if(row.humanUntil>now) return {allowed:false,reason:"human_paused"};
        if((row.cooldowns[a.slot]||0)>now) return {allowed:false,reason:"cooldown"};
        if(Object.keys(row.cooldowns).length>=60 && !Object.hasOwn(row.cooldowns,a.slot)) fail("runtime_limit");
        row.cooldowns[a.slot]=now+(Number(a.cooldownSeconds)||0)*1000;
        if(a.humanPauseMinutes) {row.humanUntil=now+a.humanPauseMinutes*60000;row.node=null;}
        else if(Object.hasOwn(a,"node")) row.node=a.node;
      }
      row.at=now; store._touch(ws,"messenger_conversation",{profileId:p.id,operation});
      return {allowed:true,humanUntil:row.humanUntil||0,node:row.node||null};
    });
  }
  if(operation === "history") {
    profile(w,a.profileId);
    const ws=store.state.workspaces[w];
    return (ws.audit || []).slice(-500).map(e=>({event:e,claim:e.key?ws.claims[e.key]:null}))
      .filter(({event:e,claim:c})=>e.profileId===a.profileId||c?.profileId===a.profileId)
      .slice(-Math.min(100,Math.max(1,Number(a.limit)||30)))
      .map(({event:e,claim:c})=>({at:e.at,event:e.event,profileId:a.profileId,ruleId:e.ruleId,count:e.count,
        executionRef:e.key?require("node:crypto").createHash("sha256").update(e.key).digest("hex"):undefined,
        card:c?.card,status:c?.status,stage:c?.stage,ack:c?.ack,ackAt:c?.ackAt,result:c?.result}));
  }
  if (operation === "state") {
    const workspace = store.state.workspaces[w];
    return {
      profiles: Object.values(workspace?.profiles || {})
        .filter((p) => p.workspaceId === w)
        .map(lightProfile),
      schedules: Object.values(workspace?.schedules || {})
        .filter(
          (s) =>
            s.workspaceId === w &&
            workspace.profiles[s.profileId]?.workspaceId === w,
        )
        .map((s) => ({
          id: s.id,
          profileId: s.profileId,
          revision: s.revision,
          name: s.name,
          active: s.active,
          nextRunAt: s.nextRunAt,
          destinations: s.destinations,
          timezone: s.timezone,
        })),
    };
  }
  if (operation === "profile") return profile(w, a.profileId);
  if (operation === "authorize" || operation === "scheduled_authorize") {
    const p = store.state.workspaces[w]?.profiles[a.profileId];
    if (!p || p.workspaceId !== w || !p.active || p.sessionId !== a.sessionId ||
        p.revision !== a.expectedRevision || p.execution?.version !== 4 || !p.execution.activatedAt ||
        !cardActive(p, a.card)) return false;
    if (operation === "scheduled_authorize") {
      const s = store.getSchedule(w, a.scheduleId);
      const module=p.cards.scheduled.configuration?.universal;
      if(module && (!p.destinations.includes(a.destination)||module.groups&&!module.groups.includes(a.destination))) return false;
      return !!(s && s.profileId === p.id && s.active && s.revision === a.scheduleRevision && s.destinations.includes(a.destination));
    }
    return true;
  }
  if (operation === "schedules") {
    profile(w,a.profileId);
    return store
      .listSchedules(w, { includeInactive: true })
      .filter((s) => s.profileId === a.profileId);
  }
  if (operation === "schedule")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (!a.remove)
        validateImages(
          a.input,
          a.scheduleId ? store.getSchedule(w, a.scheduleId)?.content : null,
        );
      if (a.scheduleId) {
        const s = store.getSchedule(w, a.scheduleId);
        if (!s || s.profileId !== p.id) fail("programacao_nao_encontrada");
        if (a.expectedRevision !== s.revision) fail("conflito_revisao");
        if (a.remove)
          return store.deleteSchedule(w, s.id, {
            expectedRevision: s.revision,
          });
        return store.updateSchedule(
          w,
          s.id,
          {
            ...normalizeSchedule(a.input, s),
            active:
              a.input.ativo === undefined ? s.active : a.input.ativo === true,
          },
          { expectedRevision: s.revision },
        );
      }
      const input = { ...a.input };
      delete input.nextRunAt;
      if (!input.recurrence && !["horario", "intervalo"].includes(input.tipo))
        fail("programacao_invalida");
      const normalized = normalizeSchedule(input);
      if (
        !normalized.nextRunAt ||
        Date.parse(normalized.nextRunAt) <= Date.now()
      )
        fail("programacao_passada");
      const s = store.createSchedule(w, p.id, {
        ...normalized,
        allowInactive: true,
      });
      return store.updateSchedule(
        w,
        s.id,
        { active: a.input.ativo === true },
        { expectedRevision: s.revision },
      );
    });
  if (operation === "save")
    return store.transaction(() => {
      const body = a.input;
      let p;
      if (a.universal === true && a.profileId && body.active === true &&
          profile(w, a.profileId).execution?.version !== 4 && body.confirmLegacyReview !== true)
        fail("legacy_review_required");
      if (a.profileId) {
        p = profile(w, a.profileId);
        if (body.expectedRevision !== p.revision) fail("conflito_revisao");
        p = store.updateProfile(w, p.id, {
          name: text(body.name, 100),
          sessionId: text(body.sessionId, 150),
          active: body.active === true,
          destinations: list(body.destinations || [], 100),
        });
      } else {
        p = store.createProfile({
          workspaceId: w,
          sessionId: text(body.sessionId, 150),
          name: text(body.name, 100),
        });
        p = store.updateProfile(w, p.id, {
          destinations: list(body.destinations || [], 100),
          active: false,
        });
      }
      if (!p.name) fail("nome_obrigatorio");
      if(body.niche!==undefined) store.state.workspaces[w].profiles[p.id].niche=text(body.niche,100);
      for(const [name,current] of Object.entries(p.cards)) if(current.configuration?.universal) normalizeModule(name,current.configuration.universal,p.destinations);
      for(const schedule of store.listSchedules(w,{includeInactive:true}).filter(s=>s.profileId===p.id)) require("./schedule-options").assertSchedule(p,schedule);
      saveSettings(w, p, body);
      if (a.universal === true) {
        const current = profile(w, p.id);
        const previous = current.execution;
        if (body.active === true && body.confirmActivation !== true) fail("activation_confirmation_required");
        if (body.active === true && !Object.values(current.cards).some(c => c.active)) fail("active_card_required");
        // This field is not accepted by V3 profile/card payloads. Only this
        // authenticated adoption transaction can create the send authority.
        store.state.workspaces[w].profiles[p.id].execution = { version: 4,
          activatedAt: body.active === true ? previous?.activatedAt || new Date().toISOString() : null };
      }
      conflict(w, profile(w, p.id));
      return lightProfile(profile(w, p.id));
    });
  if (operation === "migrate")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (a.strictRevision === true && a.expectedRevision !== p.revision) fail("conflito_revisao");
      if (p.cards.groupManager.configuration?.v4?.migrationVersion === 4)
        return { alreadyMigrated: true, profile: lightProfile(p) };
      if (a.expectedRevision !== p.revision) fail("conflito_revisao");
      saveSettings(w, p, {});
      return {
        alreadyMigrated: false,
        profile: lightProfile(profile(w, p.id)),
      };
    });
  if (operation === "duplicate")
    return store.transaction(() => {
      const original = profile(w, a.profileId);
      const p = store.createProfile({
        workspaceId: w,
        sessionId: original.sessionId,
        name: original.name + " — cópia",
      });
      store.updateProfile(w, p.id, {
        destinations: original.destinations,
        active: false,
      });
      store.state.workspaces[w].profiles[p.id].niche=original.niche||"";
      if (a.universal === true) store.state.workspaces[w].profiles[p.id].execution = { version: 4, activatedAt: null };
      for (const card of CARDS) {
        const copy = JSON.parse(JSON.stringify(original.cards[card]));
        if (card === "commands" && copy.configuration?.comandos)
          copy.configuration.comandos = copy.configuration.comandos.map(
            (c) => ({ ...c, perfilId: p.id }),
          );
        store.saveCard(w, p.id, card, { ...copy, active: false });
      }
      // Schedules/claims/ACKs are intentionally never cloned or replayed.
      return lightProfile(profile(w, p.id));
    });
  if (operation === "card")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (p.revision !== a.expectedRevision) fail("conflito_revisao");
      if (!CARDS.includes(a.card)) fail("card_invalido");
      const current = p.cards[a.card];
      validateImages(a.configuration, current.configuration);
      const configuration = { ...current.configuration, ...a.configuration };
      // V4 migration metadata is only writable through the validated settings path.
      if (current.configuration?.v4)
        configuration.v4 = current.configuration.v4;
      else delete configuration.v4;
      store.saveCard(w, p.id, a.card, {
        active: a.active === true,
        configuration,
      });
      conflict(w, profile(w, p.id));
      return lightProfile(profile(w, p.id));
    });
  if (operation === "select") {
    const selected = selectProfile(store, {
      workspaceId: w,
      sessionId: a.sessionId,
      card: a.card,
      groupId: a.groupId,
    });
    const selectedProfile=selected.profileId ? profile(w, selected.profileId) : null;
    if(selectedProfile?.cards[a.card]?.configuration?.universal) {
      for(const [name,card] of Object.entries(selectedProfile.cards)) if(name!==a.card) card.configuration=name==="groupManager"
        ? {v4:{migrationVersion:card.configuration?.v4?.migrationVersion}} : {};
      const prepare=value=> {
        if(!value||typeof value!=="object") return;
        if(value.media?.dataUri) {const m=value.media; value.media={type:m.type,mime:m.mime,bytes:m.bytes,prepared:Buffer.from(m.dataUri.split(",")[1],"base64")};}
        for(const [key,item] of Object.entries(value)) if(key!=="media") {
          if(Array.isArray(item)) item.forEach(prepare); else if(item&&typeof item==="object") prepare(item);
        }
      };
      prepare(selectedProfile.cards[a.card].configuration.universal);
    }
    return {
      ...selected,
      profile: selectedProfile,
    };
  }
  if (operation === "outbound_create")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      const parent = store.state.workspaces[w]?.claims[a.parentKey];
      if (!parent || parent.profileId !== p.id || parent.status !== "claimed" ||
          p.sessionId !== a.sessionId || !p.active ||
          a.identity?.workspaceId !== w || a.identity?.operationId !== a.key ||
          a.identity?.destinationId !== a.groupId || a.identity?.origin !== "mensageiro_v4")
        fail("outbound_scope_invalid");
      return store.claimExecution(w, a.key, { profileId: p.id, card: "v4_outbound",
        parentKey: a.parentKey, sessionId: a.sessionId, groupId: a.groupId,
        identity: a.identity, messageId: a.messageId, stage: "prepared" });
    });
  if (operation === "outbound_patch")
    return store.transaction(() => {
      const ws = store.state.workspaces[w], row = ws?.claims[a.key];
      if (!row || row.card !== "v4_outbound") fail("outbound_missing");
      const transitions = { prepared: ["send_started", "not_sent"],
        send_started: ["local_resolved", "ambiguous", "not_sent", "settled"], local_resolved: ["settled", "ambiguous"],
        ambiguous: ["settled"], settled: [], not_sent: [] };
      if (row.stage === a.stage || row.stage === "settled") return true;
      if (!transitions[row.stage]?.includes(a.stage)) fail("outbound_transition_invalid");
      if (a.messageId) {
        if (row.messageId && row.messageId !== a.messageId) fail("outbound_identity_changed");
        row.messageId = a.messageId;
      }
      if (a.stage === "settled" && !["delivery_ack", "read", "played"].includes(row.ack))
        fail("outbound_ack_required");
      row.stage = a.stage;
      // Preserve uncertain holds/claims from terminal-claim compaction.
      if (a.stage === "settled") { row.status = "confirmed"; row.completedAt = new Date().toISOString(); }
      if (a.stage === "not_sent") { row.status = "blocked"; row.completedAt = new Date().toISOString(); }
      store._touch(ws, "v4_outbound_state", { key: a.key, stage: a.stage });
      return true;
    });
  if (operation === "outbound_recover") {
    return Object.entries(store.state.workspaces[w]?.claims || {}).filter(([, row]) =>
      row.card === "v4_outbound" && row.profileId === a.profileId && row.sessionId === a.sessionId &&
      row.groupId === a.groupId && ["delivery_ack", "read", "played"].includes(row.ack) &&
      row.stage !== "settled").slice(0, 16).map(([key, row]) => ({ key, identity: row.identity }));
  }
  if (operation === "outbound_ack")
    return store.transaction(() => {
      if (!["delivery_ack", "read", "played"].includes(a.ack)) fail("outbound_ack_invalid");
      const ws = store.state.workspaces[w];
      const rows = Object.entries(ws?.claims || {}).filter(([, row]) =>
        row.card === "v4_outbound" && row.sessionId === a.sessionId &&
        row.profileId === a.profileId && row.groupId === a.groupId &&
        row.messageId === a.messageId && ["send_started", "local_resolved", "ambiguous"].includes(row.stage));
      if (rows.length > 1) fail("outbound_ack_ambiguous");
      return rows.map(([key, row]) => {
        if (!row.ack) {
          row.ack = a.ack; row.ackAt = new Date().toISOString();
          store._touch(ws, "v4_outbound_ack", { key, ack: a.ack });
        }
        return { key, identity: row.identity };
      });
    });
  if (operation === "claim")
    return store.transaction(() => {
      const p = profile(w, a.profileId);
      if (p.revision !== a.expectedRevision || !p.active) return false;
      return store.claimExecution(w, a.key, { profileId: p.id, card: a.card });
    });
  if (operation === "complete")
    return store.completeExecution(w, a.key, { status: a.status,
      ...(a.result?{result:Object.fromEntries(Object.entries(a.result).filter(([key,value])=>
        ["ruleId","reason","deleteAttempted","deleteResult","banAttempted","banResult","noticeResult","transportAccepted","deliveryConfirmed"].includes(key)&&
        (typeof value==="boolean"||typeof value==="string"&&value.length<=100)))}:{}) });
  fail("operacao_invalida");
}
parentPort.on("message", ({ id, operation, args }) => {
  try {
    parentPort.postMessage({ id, value: execute(operation, args) });
  } catch (error) {
    const code = String(error.code || error.message);
    parentPort.postMessage({
      id,
      error: /^[a-zA-Z0-9_:-]{1,100}$/.test(code)
        ? code
        : "v4_storage_indisponivel",
    });
  }
});
