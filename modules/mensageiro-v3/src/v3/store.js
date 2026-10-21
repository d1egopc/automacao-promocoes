const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertAbsolute, assertDurableStorage } = require("../../durable-path");

const SCHEMA_VERSION = 3;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sleepSync(milliseconds) {
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, milliseconds);
}

function nowIso(clock) {
  return new Date(typeof clock === "function" ? clock() : Date.now()).toISOString();
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, workspaces: {}, deletedIds: { profiles: {}, schedules: {} }, workspaceFences: {} };
}

function ensureState(state) {
  const base = state && typeof state === "object" ? state : emptyState();
  if (base.schemaVersion !== SCHEMA_VERSION) throw new Error("mensageiro_v3_schema_incompativel");
  base.revision = Number.isInteger(base.revision) ? base.revision : 0;
  base.workspaces = base.workspaces && typeof base.workspaces === "object" ? base.workspaces : {};
  base.deletedIds = base.deletedIds && typeof base.deletedIds === "object" ? base.deletedIds : { profiles: {}, schedules: {} };
  base.deletedIds.profiles ||= {};
  base.deletedIds.schedules ||= {};
  base.workspaceFences = base.workspaceFences && typeof base.workspaceFences === "object" ? base.workspaceFences : {};
  return base;
}

function freshWorkspace(workspaceId) {
  return {
    id: workspaceId,
    revision: 0,
    profiles: {},
    schedules: {},
    claims: {},
    audit: []
  };
}

class V3Store {
  constructor({ filePath, clock = Date.now, requireExisting = false } = {}) {
    if (!filePath) throw new Error("filePath_obrigatorio");
    this.filePath = assertAbsolute(filePath, "filePath_invalido");
    if (requireExisting) assertDurableStorage(this.filePath);
    this.clock = clock;
    this.lockPath = `${this.filePath}.lock`;
    this.migrationMarkerPath = `${this.filePath}.migration-authority`;
    this.state = ensureState(this.read());
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") {
        if (fs.existsSync(this.migrationMarkerPath)) throw new Error("mensageiro_v3_authority_missing");
        return emptyState();
      }
      throw error;
    }
  }

  reload() { this.state = ensureState(this.read()); return clone(this.state); }

  _withFileLock(fn) {
    const startedAt = Date.now();
    let fd;
    for (;;) {
      try {
        fd = fs.openSync(this.lockPath, "wx", 0o600);
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          const stat = fs.statSync(this.lockPath);
          let ownerAlive = true;
          try {
            const lock = JSON.parse(fs.readFileSync(this.lockPath, "utf8"));
            if (Number.isInteger(lock.pid) && lock.pid !== process.pid) {
              try { process.kill(lock.pid, 0); } catch (probeError) {
                if (probeError.code === "ESRCH") ownerAlive = false;
              }
            }
          } catch {
            // A partially-written lock is treated as live until its age is
            // clearly stale; never remove a lock merely because it is unreadable.
            ownerAlive = true;
          }
          if (!ownerAlive || (Date.now() - stat.mtimeMs > 10 * 60_000 && stat.size === 0)) {
            fs.rmSync(this.lockPath, { force: true });
          }
        } catch (statError) {
          if (statError.code !== "ENOENT") throw statError;
        }
        if (Date.now() - startedAt >= 10_000) throw new Error("mensageiro_v3_lock_timeout");
        sleepSync(10);
      }
    }
    try { return fn(); }
    finally {
      try { fs.closeSync(fd); } catch {}
      try { fs.rmSync(this.lockPath, { force: true }); } catch {}
    }
  }

  _workspace(workspaceId, create = false) {
    const key = String(workspaceId || "").trim();
    if (!key) throw new Error("workspace_obrigatoria");
    let workspace = this.state.workspaces[key];
    if (!workspace && create) workspace = this.state.workspaces[key] = freshWorkspace(key);
    if (!workspace) throw new Error("workspace_nao_encontrada");
    return workspace;
  }

  _fenceEntry(workspaceId) {
    const idValue = String(workspaceId || "").trim();
    if (!idValue) throw new Error("workspace_obrigatoria");
    return this.state.workspaceFences[idValue] || { status: "LEGACY", revision: 0 };
  }

  getWorkspaceFence(workspaceId) { return clone(this._fenceEntry(workspaceId)); }

  transitionWorkspaceFence(workspaceId, nextStatus, details = {}) {
    const allowed = { LEGACY: ["PREPARING"], PREPARING: ["QUIESCED"], QUIESCED: ["V3_MIGRATED"], V3_MIGRATED: [] };
    return this._mutate(() => {
      const idValue = String(workspaceId || "").trim();
      if (!idValue || !Object.prototype.hasOwnProperty.call(allowed, nextStatus)) throw new Error("fence_estado_invalido");
      const current = this._fenceEntry(idValue);
      if (current.status === nextStatus) return clone(current);
      if (!allowed[current.status]?.includes(nextStatus)) throw new Error("fence_transicao_invalida");
      const next = { ...current, ...clone(details), status: nextStatus, revision: Number(current.revision || 0) + 1, updatedAt: nowIso(this.clock) };
      if (nextStatus === "V3_MIGRATED") {
        fs.mkdirSync(path.dirname(this.migrationMarkerPath), { recursive: true });
        fs.writeFileSync(this.migrationMarkerPath, JSON.stringify({ workspaceId: idValue, revision: next.revision, at: next.updatedAt }), { mode: 0o600 });
      }
      this.state.workspaceFences[idValue] = next;
      this._touch(this._workspace(idValue, true), "workspace_fence_transition", { status: nextStatus, fenceRevision: next.revision });
      return next;
    });
  }

  _persist() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(this.state, null, 2), "utf8");
      // Windows disposable fixtures may reject fsync on this handle. Linux
      // CI/production keeps the durability barrier required by the contract.
      if (process.platform !== "win32") fs.fsyncSync(fd);
    } catch (error) {
      try { fs.closeSync(fd); } catch {}
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw error;
    }
    fs.closeSync(fd);
    try {
      if (process.platform === "win32" && fs.existsSync(this.filePath)) {
        // Windows disposable fixtures may reject rename-over-open-file. The
        // production/CI path is Linux and remains same-filesystem rename.
        fs.copyFileSync(tmp, this.filePath);
        fs.rmSync(tmp, { force: true });
      } else {
        fs.renameSync(tmp, this.filePath);
        if (process.platform !== "win32") {
          try {
            const dirFd = fs.openSync(dir, "r");
            try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
          } catch (error) {
            if (error.code !== "EINVAL" && error.code !== "EISDIR") throw error;
          }
        }
      }
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw error;
    }
  }

  _touch(workspace, event, details = {}) {
    const at = nowIso(this.clock);
    workspace.revision += 1;
    this.state.revision += 1;
    workspace.audit.push({ at, event, ...details });
    workspace.audit = workspace.audit.slice(-500);
    this._persist();
    return at;
  }

  _mutate(fn) {
    return this._withFileLock(() => {
      // Always load the last committed revision while holding the lock. This
      // makes two independent scheduler/store instances serialize safely.
      this.state = ensureState(this.read());
      const before = clone(this.state);
      try {
        const result = fn();
        return clone(result);
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
  }

  _newEntityId(prefix, collection, deletedCollection) {
    let value;
    do { value = id(prefix); } while (collection[value] || this.state.deletedIds[deletedCollection]?.[value]);
    return value;
  }

  createProfile({ workspaceId, sessionId, name }) {
    return this._mutate(() => {
      const workspace = this._workspace(workspaceId, true);
      const profileId = this._newEntityId("profile", workspace.profiles, "profiles");
      const profile = {
        id: profileId,
        workspaceId: String(workspaceId),
        sessionId: String(sessionId || ""),
        name: String(name || "").trim(),
        active: false,
        revision: 1,
        cards: {
          scheduled: { active: false, revision: 1 },
          commands: { active: false, revision: 1 },
          attendance: { active: false, revision: 1 },
          groupManager: { active: false, revision: 1 },
          welcome: { active: false, revision: 1 },
          farewell: { active: false, revision: 1 },
          faq: { active: false, revision: 1 },
          flows: { active: false, revision: 1 },
          quickReplies: { active: false, revision: 1 }
        },
        destinations: [],
        createdAt: nowIso(this.clock),
        updatedAt: nowIso(this.clock)
      };
      workspace.profiles[profileId] = profile;
      this._touch(workspace, "profile_created", { profileId });
      return profile;
    });
  }

  getProfile(workspaceId, profileId) {
    const p = this._workspace(workspaceId).profiles[String(profileId || "")];
    return p ? clone(p) : null;
  }

  listProfiles(workspaceId) {
    return Object.values(this._workspace(workspaceId).profiles).map(clone);
  }

  updateProfile(workspaceId, profileId, patch, { expectedRevision } = {}) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const p = w.profiles[String(profileId || "")];
      if (!p) throw new Error("perfil_nao_encontrado");
      if (expectedRevision !== undefined && Number(expectedRevision) !== p.revision) throw new Error("conflito_revisao");
      const allowed = ["name", "sessionId", "active", "destinations"];
      for (const key of allowed) if (patch && patch[key] !== undefined) p[key] = clone(patch[key]);
      p.revision += 1; p.updatedAt = nowIso(this.clock);
      this._touch(w, "profile_updated", { profileId, profileRevision: p.revision });
      return p;
    });
  }

  saveCard(workspaceId, profileId, card, patch, { expectedRevision } = {}) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const p = w.profiles[String(profileId || "")];
      if (!p) throw new Error("perfil_nao_encontrado");
      if (!Object.prototype.hasOwnProperty.call(p.cards, card)) throw new Error("card_invalido");
      const current = p.cards[card];
      if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) throw new Error("conflito_revisao");
      p.cards[card] = { ...current, ...clone(patch), revision: current.revision + 1, updatedAt: nowIso(this.clock) };
      p.revision += 1; p.updatedAt = nowIso(this.clock);
      this._touch(w, "card_saved", { profileId, card, cardRevision: p.cards[card].revision });
      return p.cards[card];
    });
  }

  canExecuteCard(workspaceId, profileId, card) {
    const profile = this.getProfile(workspaceId, profileId);
    return Boolean(profile && profile.active === true && profile.cards?.[card]?.active === true);
  }

  createSchedule(workspaceId, profileId, input) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const p = w.profiles[String(profileId || "")];
      if (!p) throw new Error("perfil_nao_encontrado");
      if (!p.cards.scheduled || p.cards.scheduled.active !== true) throw new Error("card_programacoes_inativo");
      const destinations = [...new Set((input?.destinations || []).map(String).map(x => x.trim()).filter(Boolean))];
      if (!destinations.length) throw new Error("destinos_obrigatorios");
      if (input?.content === null || input?.content === undefined) throw new Error("conteudo_obrigatorio");
      const scheduleId = this._newEntityId("schedule", w.schedules, "schedules");
      const schedule = {
        id: scheduleId, workspaceId: String(workspaceId), profileId: String(profileId),
        active: false, revision: 1, name: String(input?.name || "").trim(),
        timezone: String(input?.timezone || "America/Sao_Paulo"),
        nextRunAt: input?.nextRunAt || null, intervalMs: Number(input?.intervalMs || 0) || 0,
        destinations, content: clone(input?.content || null), artifactId: input?.artifactId ? String(input.artifactId) : null,
        createdAt: nowIso(this.clock), updatedAt: nowIso(this.clock)
      };
      w.schedules[scheduleId] = schedule;
      this._touch(w, "schedule_created", { profileId, scheduleId });
      return schedule;
    });
  }

  getSchedule(workspaceId, scheduleId) {
    const s = this._workspace(workspaceId).schedules[String(scheduleId || "")];
    return s ? clone(s) : null;
  }

  listSchedules(workspaceId, { includeInactive = false } = {}) {
    return Object.values(this._workspace(workspaceId).schedules)
      .filter(s => includeInactive || s.active === true).map(clone);
  }

  updateSchedule(workspaceId, scheduleId, patch, { expectedRevision } = {}) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const s = w.schedules[String(scheduleId || "")];
      if (!s) throw new Error("programacao_nao_encontrada");
      if (expectedRevision !== undefined && Number(expectedRevision) !== s.revision) throw new Error("conflito_revisao");
      if (patch?.profileId && patch.profileId !== s.profileId) throw new Error("proprietario_imutavel");
      if (patch?.workspaceId && patch.workspaceId !== s.workspaceId) throw new Error("workspace_imutavel");
      const allowed = ["name", "active", "timezone", "nextRunAt", "intervalMs", "destinations", "content", "artifactId"];
      for (const key of allowed) if (patch[key] !== undefined) s[key] = clone(patch[key]);
      if (Array.isArray(s.destinations)) s.destinations = [...new Set(s.destinations.map(String).map(x => x.trim()).filter(Boolean))];
      s.revision += 1; s.updatedAt = nowIso(this.clock);
      this._touch(w, "schedule_updated", { profileId: s.profileId, scheduleId, scheduleRevision: s.revision });
      return s;
    });
  }

  activateSchedule(workspaceId, scheduleId, expectedRevision) { return this.updateSchedule(workspaceId, scheduleId, { active: true }, { expectedRevision }); }
  deactivateSchedule(workspaceId, scheduleId, expectedRevision) { return this.updateSchedule(workspaceId, scheduleId, { active: false }, { expectedRevision }); }

  deleteSchedule(workspaceId, scheduleId, { expectedRevision } = {}) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const idValue = String(scheduleId || ""); const s = w.schedules[idValue];
      if (!s) return { deleted: false, alreadyDeleted: Boolean(this.state.deletedIds.schedules[idValue]) };
      if (expectedRevision !== undefined && Number(expectedRevision) !== s.revision) throw new Error("conflito_revisao");
      delete w.schedules[idValue];
      this.state.deletedIds.schedules[idValue] = { workspaceId: String(workspaceId), profileId: s.profileId, deletedAt: nowIso(this.clock) };
      this._touch(w, "schedule_deleted", { profileId: s.profileId, scheduleId: idValue });
      return { deleted: true, scheduleId: idValue };
    });
  }

  deleteProfile(workspaceId, profileId, { expectedRevision } = {}) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const idValue = String(profileId || ""); const p = w.profiles[idValue];
      if (!p) return { deleted: false, alreadyDeleted: Boolean(this.state.deletedIds.profiles[idValue]) };
      if (expectedRevision !== undefined && Number(expectedRevision) !== p.revision) throw new Error("conflito_revisao");
      const scheduleIds = Object.values(w.schedules).filter(s => s.profileId === idValue).map(s => s.id);
      for (const sid of scheduleIds) { delete w.schedules[sid]; this.state.deletedIds.schedules[sid] = { workspaceId: String(workspaceId), profileId: idValue, deletedAt: nowIso(this.clock) }; }
      delete w.profiles[idValue];
      this.state.deletedIds.profiles[idValue] = { workspaceId: String(workspaceId), deletedAt: nowIso(this.clock) };
      this._touch(w, "profile_deleted", { profileId: idValue, scheduleIds });
      return { deleted: true, profileId: idValue, scheduleIds };
    });
  }

  effectiveSchedules(workspaceId, now = Date.now()) {
    const w = this._workspace(workspaceId);
    const ownerWorkspaceId = String(workspaceId);
    return Object.values(w.schedules).filter(s => s.workspaceId === ownerWorkspaceId && s.active === true && Array.isArray(s.destinations) && s.destinations.length > 0 && s.nextRunAt && Date.parse(s.nextRunAt) <= now)
      .filter(s => w.profiles[s.profileId]?.workspaceId === ownerWorkspaceId && w.profiles[s.profileId]?.active === true && w.profiles[s.profileId]?.cards?.scheduled?.active === true)
      .map(clone);
  }

  claimExecution(workspaceId, key, details = {}) {
    return this._mutate(() => {
      const w = this._workspace(workspaceId); const k = String(key);
      if (w.claims[k]) return false;
      w.claims[k] = { ...clone(details), claimedAt: nowIso(this.clock) };
      this._touch(w, "execution_claimed", { key: k });
      return true;
    });
  }

  /**
   * Compact only claims that are older than an explicitly supplied replay
   * horizon.  Claims are the idempotency fence, so deleting them without a
   * proven horizon could allow an old event to be sent twice.  The method is
   * intentionally opt-in and bounded: callers must provide both the replay
   * horizon and a positive batch limit.  Claims with an invalid timestamp are
   * retained (fail-closed).
   */
  compactClaims(workspaceId, {
    now = typeof this.clock === "function" ? this.clock() : Date.now(),
    retentionMs,
    replayHorizonMs,
    maxRemovals
  } = {}) {
    return this._mutate(() => {
      const retention = Number(retentionMs);
      const replayHorizon = Number(replayHorizonMs);
      const limit = Number(maxRemovals);
      if (!Number.isFinite(retention) || retention <= 0 ||
        !Number.isFinite(replayHorizon) || replayHorizon <= 0 ||
        retention < replayHorizon) {
        throw new Error("claims_retencao_insegura");
      }
      if (!Number.isInteger(limit) || limit < 1) throw new Error("claims_lote_obrigatorio");

      const workspace = this._workspace(workspaceId);
      const cutoff = Number(now) - retention;
      const eligible = Object.entries(workspace.claims || {})
        .map(([key, claim]) => ({ key, claim, claimedAt: Date.parse(claim?.claimedAt || "") }))
        .filter(entry => Number.isFinite(entry.claimedAt) && entry.claimedAt <= cutoff)
        .sort((a, b) => a.claimedAt - b.claimedAt)
        .slice(0, limit);

      for (const entry of eligible) delete workspace.claims[entry.key];
      if (eligible.length) {
        this._touch(workspace, "claims_compacted", {
          removed: eligible.length,
          retentionMs: retention,
          replayHorizonMs: replayHorizon,
          cutoff: new Date(cutoff).toISOString()
        });
      }
      return {
        removed: eligible.length,
        remaining: Object.keys(workspace.claims || {}).length,
        cutoff: new Date(cutoff).toISOString(),
        retentionMs: retention,
        replayHorizonMs: replayHorizon
      };
    });
  }

  recordDecision(workspaceId, decision) {
    return this._mutate(() => { const w = this._workspace(workspaceId); this._touch(w, "scheduler_decision", clone(decision)); return true; });
  }

  snapshot() { return clone(this.state); }
}

module.exports = { V3Store, SCHEMA_VERSION, emptyState };
