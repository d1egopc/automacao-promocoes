"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createVercelDomainProvider } = require("./vercel-domains");

const RESERVED = new Set([
  "admin",
  "api",
  "auth",
  "login",
  "logout",
  "cadastro",
  "planos",
  "landing-page",
  "landing-preview",
  "public",
  "static",
  "assets",
  "support",
  "suporte",
  "www",
  "optimus",
  "optimuspromo",
  "billing",
  "health",
  "robots",
  "favicon",
  "privacy",
  "terms",
  "contact",
  "dashboard",
  "help",
]);
function error(code, statusCode = 400) {
  return Object.assign(new Error(code), { statusCode });
}
function slug(value = "") {
  if (typeof value !== "string") throw error("slug_invalido");
  const name = value.trim().toLowerCase();
  if (!name) return "";
  if (
    !/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(name) ||
    name.includes("--") ||
    /^[a-f0-9]{32}$/.test(name) ||
    RESERVED.has(name)
  )
    throw error("slug_invalido_ou_reservado");
  return name;
}
function customerDomain(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (
    name.length > 253 ||
    !name.includes(".") ||
    name
      .split(".")
      .some((x) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x)) ||
    !/^[a-z]{2,63}$/.test(name.split(".").at(-1)) ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test|vercel\.app|vercel\.com|optimuspromo\.com\.br)$/.test(
      name,
    )
  )
    throw error("dominio_invalido_ou_protegido");
  return name;
}

function createLandingAddresses({
  root,
  read,
  mutate,
  editorDto,
  readJson,
  atomicJson,
  canPublish,
  provider = createVercelDomainProvider(),
  now = Date.now,
}) {
  const base = path.join(root, "addresses");
  const fileFor = (kind, key) =>
    path.join(
      base,
      kind,
      crypto.createHash("sha256").update(key).digest("hex") + ".json",
    );
  const record = (kind, key) => readJson(fileFor(kind, key), 65536, null);
  async function locked(kind, fn) {
    await fs.mkdir(path.join(base, kind), { recursive: true });
    const file = path.join(base, `${kind}.lock`);
    let handle;
    try {
      handle = await fs.open(file, "wx", 0o600);
    } catch (e) {
      if (e.code === "EEXIST") throw error("enderecos_em_atualizacao", 409);
      throw e;
    }
    const token = crypto.randomUUID();
    try {
      await handle.writeFile(token);
      return await fn();
    } finally {
      const stat = await fs.stat(file).catch(() => null);
      const held = await handle.stat();
      const owner = await fs.readFile(file, "utf8").catch(() => "");
      await handle.close();
      if (stat?.ino === held.ino && owner === token) await fs.unlink(file);
    }
  }
  function matches(value, state) {
    return (
      value &&
      value.workspaceId === state.workspaceId &&
      value.publicId === state.publicId
    );
  }
  function domainMatches(value, state) {
    return (
      matches(value, state) &&
      value.bindingId === state.domain?.bindingId &&
      value.hostname === state.domain?.hostname
    );
  }
  function checkRevision(state, revision) {
    if (!Number.isSafeInteger(revision) || state.revision !== revision)
      throw error("revisao_desatualizada_recarregue", 409);
  }
  function safeDomain(value) {
    if (!value)
      return {
        status: "disconnected",
        hostname: "",
        records: [],
        reason: "",
        https: false,
      };
    return {
      hostname: value.hostname,
      status: value.status,
      records: value.records || [],
      reason: value.reason || "",
      https: value.status === "active" && value.validUntil > now(),
      checkedAt: value.checkedAt || 0,
      nextCheckAt: value.nextCheckAt || 0,
    };
  }
  async function domainStatus(state) {
    if (!state.domain) return safeDomain(null);
    if (!provider.enabled)
      return {
        ...safeDomain(null),
        hostname: state.domain.hostname,
        status: "error",
        reason: "integracao_vercel_nao_configurada",
      };
    const value = await record("domains", state.domain.hostname);
    if (!domainMatches(value, state))
      return {
        ...safeDomain(null),
        status: "error",
        reason: "vinculo_de_dominio_inconsistente",
      };
    const dto = safeDomain(value);
    if (dto.status === "active" && value.validUntil <= now())
      return {
        ...dto,
        status: "pending",
        https: false,
        reason: "verificacao_expirada_aguardando_atualizacao",
      };
    return dto;
  }
  async function editor(state) {
    return { ...editorDto(state), domain: await domainStatus(state) };
  }
  async function removeClaim(kind, key, claim) {
    const current = await record(kind, key);
    if (
      current &&
      current.workspaceId === claim.workspaceId &&
      current.publicId === claim.publicId &&
      current.bindingId === claim.bindingId
    )
      await fs.unlink(fileFor(kind, key));
  }
  async function activeSlugClaim(name) {
    const claim = await record("slugs", name);
    if (!claim) return null;
    const owner = await read(claim.workspaceId);
    return matches(claim, owner) &&
      (owner.reservedSlug === name || owner.published?.config.slug === name)
      ? claim
      : null;
  }
  async function publish(id, revision, operation) {
    return locked("slugs", async () => {
      const before = await read(id);
      checkRevision(before, revision);
      const name = slug(before.draft.slug);
      const previous =
        before.reservedSlug || before.published?.config.slug || "";
      const state = await mutate(id, revision, async (state) => {
        if (name) {
          const claim = await record("slugs", name);
          const active = await activeSlugClaim(name);
          if (active && active.workspaceId !== id)
            throw error("slug_indisponivel", 409);
          if (claim && !active) await removeClaim("slugs", name, claim);
          if (!active)
            await atomicJson(fileFor("slugs", name), {
              workspaceId: id,
              publicId: state.publicId,
            });
        }
        await operation(state);
        state.reservedSlug = name;
      });
      if (previous && previous !== name)
        await removeClaim("slugs", previous, {
          workspaceId: id,
          publicId: state.publicId,
        });
      return state;
    });
  }
  async function availability(id, value) {
    const name = slug(value);
    if (!name) return { slug: "", available: false };
    const claim = await activeSlugClaim(name);
    return { slug: name, available: !claim || claim.workspaceId === id };
  }
  async function resolveSlug(name) {
    const claim = await activeSlugClaim(slug(name));
    if (!claim) throw error("pagina_nao_encontrada", 404);
    const state = await read(claim.workspaceId);
    if (state.published?.config.slug !== name)
      throw error("pagina_nao_encontrada", 404);
    return claim.publicId;
  }
  function dnsRecords(value, info, config) {
    const records = [
      {
        type: "TXT",
        name: `_optimus-verify.${value.hostname}`,
        value: value.challenge,
        purpose: "Titularidade do workspace",
      },
    ];
    for (const item of (info.verification || []).slice(0, 4))
      if (
        item.type === "TXT" &&
        typeof item.domain === "string" &&
        typeof item.value === "string" &&
        item.value.length <= 4096
      )
        records.push({
          type: "TXT",
          name: item.domain,
          value: item.value,
          purpose: "Verificação Vercel",
        });
    const cname = [...config.recommendedCNAME].sort(
      (a, b) => Number(a.rank) - Number(b.rank),
    )[0];
    const ips = [...config.recommendedIPv4].sort(
      (a, b) => Number(a.rank) - Number(b.rank),
    )[0];
    if (value.hostname !== info.apexName && cname?.value)
      records.push({
        type: "CNAME",
        name: value.hostname,
        value: String(cname.value),
        purpose: "Destino Vercel",
      });
    else
      for (const ip of (ips?.value || []).slice(0, 4))
        records.push({
          type: "A",
          name: value.hostname,
          value: String(ip),
          purpose: "Destino Vercel",
        });
    return records;
  }
  async function inspectAndVerify(state, value) {
    const storedAtStart = value.bindingId;
    try {
      let info = await provider.inspect(value.hostname);
      if (!info) {
        value.status = "error";
        value.reason = "associacao_ausente_conecte_novamente";
        value.validUntil = 0;
      } else {
        const config = await provider.config(value.hostname);
        value.records = dnsRecords(value, info, config);
        const owned = await provider.ownership(value.hostname, value.challenge);
        if (owned && !info.verified)
          info = await provider.verify(value.hostname);
        const ready =
          owned && info.verified === true && config.misconfigured === false;
        const secure = ready && (await provider.https(value.hostname));
        value.status = secure ? "active" : ready ? "verified" : "pending";
        value.reason = !owned
          ? "txt_de_titularidade_pendente"
          : !info.verified
            ? "verificacao_vercel_pendente"
            : config.misconfigured
              ? "dns_ainda_nao_propagado"
              : !secure
                ? "https_em_emissao"
                : "";
        value.validUntil = secure ? now() + 10 * 60 * 1000 : 0;
        if (owned) value.ownershipConfirmed = true;
      }
    } catch (e) {
      value.status = "error";
      value.reason = /^vercel_[a-z_0-9]+$/.test(e.message)
        ? e.message
        : "verificacao_temporariamente_indisponivel";
      value.validUntil = 0;
    }
    const current = await read(state.workspaceId);
    if (!domainMatches(value, current) || value.bindingId !== storedAtStart)
      throw error("vinculo_de_dominio_alterado", 409);
    value.checkedAt = now();
    value.nextCheckAt = now() + 60000;
    await atomicJson(fileFor("domains", value.hostname), value);
    return editor(current);
  }
  async function connect(id, revision, input) {
    if (!provider.enabled)
      throw error("integracao_vercel_nao_configurada", 503);
    const host = customerDomain(input);
    return locked("domains", async () => {
      let state = await read(id);
      checkRevision(state, revision);
      if (state.draft.customDomain !== host)
        throw error("salve_o_dominio_no_rascunho_primeiro", 409);
      if (state.domain && state.domain.hostname !== host)
        throw error("desconecte_o_dominio_atual_primeiro", 409);
      let value = await record("domains", host);
      if (value && value.workspaceId !== id)
        throw error("dominio_ja_associado", 409);
      let info = await provider.inspect(host);
      if (!value && info)
        throw error("dominio_ja_existente_na_vercel_nao_sera_alterado", 409);
      if (!value) {
        // A durable intent precedes any external association. Repeats reconcile it.
        value = {
          workspaceId: id,
          publicId: state.publicId,
          bindingId: crypto.randomUUID(),
          hostname: host,
          challenge: `optimus-${crypto.randomBytes(24).toString("hex")}`,
          status: "pending",
          stage: "reserved",
          records: [],
          validUntil: 0,
        };
        await atomicJson(fileFor("domains", host), value);
      }
      if (!state.domain) {
        state = await mutate(id, revision, (s) => {
          s.domain = { hostname: host, bindingId: value.bindingId };
        });
        value.publicId = state.publicId;
      }
      if (!domainMatches(value, state))
        throw error("vinculo_de_dominio_inconsistente", 409);
      await atomicJson(fileFor("domains", host), value);
      if (!info) {
        value.stage = "requested";
        await atomicJson(fileFor("domains", host), value);
        try {
          info = await provider.add(host);
          value.stage = "associated";
          await atomicJson(fileFor("domains", host), value);
        } catch (e) {
          value.status = "error";
          value.reason = "associacao_incerta_verifique_antes_de_repetir";
          value.nextCheckAt = now() + 60000;
          await atomicJson(fileFor("domains", host), value);
          return editor(state);
        }
      }
      return inspectAndVerify(state, value);
    });
  }
  async function verify(id, revision, automatic = false) {
    if (!provider.enabled)
      throw error("integracao_vercel_nao_configurada", 503);
    return locked("domains", async () => {
      const state = await read(id);
      if (!automatic) checkRevision(state, revision);
      if (!state.domain) throw error("dominio_nao_conectado", 404);
      const value = await record("domains", state.domain.hostname);
      if (!domainMatches(value, state))
        throw error("vinculo_de_dominio_inconsistente", 409);
      if (value.status === "disconnecting")
        throw error("desconexao_em_andamento", 409);
      if (value.checkedAt && now() - value.checkedAt < 10000)
        return editor(state);
      return inspectAndVerify(state, value);
    });
  }
  async function disconnect(id, revision) {
    if (!provider.enabled)
      throw error("integracao_vercel_nao_configurada", 503);
    return locked("domains", async () => {
      let state = await read(id);
      checkRevision(state, revision);
      if (!state.domain) return editor(state);
      const value = await record("domains", state.domain.hostname);
      if (!domainMatches(value, state))
        throw error("vinculo_de_dominio_inconsistente", 409);
      value.status = "disconnecting";
      value.validUntil = 0;
      await atomicJson(fileFor("domains", value.hostname), value);
      const info = await provider.inspect(value.hostname);
      if (info) {
        if (
          value.stage !== "associated" &&
          !(await provider.ownership(value.hostname, value.challenge))
        )
          throw error(
            "confirme_o_txt_antes_de_desconectar_associacao_incerta",
            409,
          );
        await provider.remove(value.hostname);
      }
      state = await read(id);
      if (!domainMatches(value, state))
        throw error("vinculo_de_dominio_alterado", 409);
      const updated = await mutate(id, state.revision, (s) => {
        delete s.domain;
      });
      await removeClaim("domains", value.hostname, value);
      return editor(updated);
    });
  }
  async function resolveDomain(input) {
    if (!provider.enabled) throw error("pagina_nao_encontrada", 404);
    const host = customerDomain(input);
    const value = await record("domains", host);
    if (!value || value.status !== "active" || !(value.validUntil > now()))
      throw error("pagina_nao_encontrada", 404);
    const state = await read(value.workspaceId);
    if (
      !domainMatches(value, state) ||
      !state.published ||
      state.published.config.customDomain !== host ||
      !(await canPublish(state.workspaceId))
    )
      throw error("pagina_nao_encontrada", 404);
    return state.publicId;
  }
  let iterator;
  let busy = false;
  async function verifyDueDomains() {
    if (!provider.enabled || busy) return;
    busy = true;
    try {
      iterator ||= await fs.opendir(path.join(base, "domains")).catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
      if (!iterator) return;
      // At most 32 tiny records scanned and two checks per tick. No workspace scan.
      const tasks = [];
      for (let count = 0; count < 32 && tasks.length < 2; count++) {
        const entry = await iterator.read();
        if (!entry) {
          await iterator.close();
          iterator = null;
          break;
        }
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const value = await readJson(
          path.join(base, "domains", entry.name),
          65536,
          null,
        );
        if (
          value &&
          value.status !== "disconnecting" &&
          (value.nextCheckAt || 0) <= now() &&
          (await canPublish(value.workspaceId))
        )
          tasks.push(value.workspaceId);
      }
      // Registry fencing serializes checks across processes; contention fails fast.
      for (const id of tasks) await verify(id, undefined, true).catch(() => {});
    } finally {
      busy = false;
    }
  }
  function start() {
    if (!provider.enabled) return () => {};
    const timer = setInterval(
      () => void verifyDueDomains().catch(() => {}),
      5000,
    );
    timer.unref();
    return () => {
      clearInterval(timer);
      const current = iterator;
      iterator = null;
      void current?.close().catch(() => {});
    };
  }
  return {
    publish,
    availability,
    resolveSlug,
    connect,
    verify,
    disconnect,
    resolveDomain,
    domainStatus,
    verifyDueDomains,
    start,
  };
}

module.exports = { createLandingAddresses, slug, customerDomain };
