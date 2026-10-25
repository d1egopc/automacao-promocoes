"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const sharp = require("sharp");
const { detectarMime } = require("../social/social-media-storage");
const vitrine = require("../vitrine/storage");
const { createLandingAddresses, slug } = require("./addresses");

const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_DOCUMENT = 64 * 1024;
const ASSET_RE = /^[a-f0-9]{64}\.webp$/;
const PAGE_RE = /^[a-f0-9]{32}$/;
const LANDING_THEME_IDS = new Set([
  "optimus",
  "preto",
  "verde",
  "azul",
  "rosa",
  "laranja",
  "vermelho",
  "amarelo",
]);
const ICONS = new Set([
  "whatsapp",
  "telegram",
  "discord",
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "link",
]);

function erro(code, statusCode = 400) {
  return Object.assign(new Error(code), { statusCode });
}

function workspaceId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw erro("workspace_invalido", 401);
  return id;
}

function text(value, max, field) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  ) {
    throw erro(`${field}_invalido`);
  }
  return value.trim();
}

function hostname(value) {
  const host = String(value || "").toLowerCase();
  if (
    !host.includes(".") ||
    host.length > 253 ||
    host
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    host === "localhost" ||
    net.isIP(host.replace(/^\[|\]$/g, "")) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
  )
    throw erro("dominio_invalido");
  return host;
}

function httpsUrl(value, field = "link") {
  if (!value) return "";
  const raw = text(value, 2048, field);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw erro(`${field}_invalido`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    /\\/.test(raw)
  ) {
    throw erro(`${field}_invalido`);
  }
  hostname(url.hostname);
  return url.toString();
}

function pixelId(value = "") {
  if (typeof value !== "string" || value.length > 10000)
    throw erro("pixel_invalido");
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d{10,20}$/.test(raw)) return raw;
  const ids = [
    ...raw.matchAll(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g),
  ].map((match) => match[1]);
  if (!ids.length || new Set(ids).size !== 1) throw erro("pixel_invalido");
  return ids[0]; // Only the numeric ID is retained; pasted code is never stored or executed.
}

function links(value, max, field) {
  if (!Array.isArray(value) || value.length > max)
    throw erro(`${field}_invalidos`);
  const seen = new Set();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw erro(`${field}_invalidos`);
    const id = text(item.id, 80, "botao_id");
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      seen.has(id) ||
      !ICONS.has(item.icon)
    )
      throw erro(`${field}_invalidos`);
    seen.add(id);
    const label = text(item.label, 60, "nome_botao");
    const url = httpsUrl(item.url);
    if (!label || !url) throw erro(`${field}_invalidos`);
    return { id, label, url, icon: item.icon };
  });
}

function emptyConfig() {
  return {
    name: "",
    title: "As melhores ofertas, em um só lugar.",
    description: "Entre na nossa comunidade e acompanhe as novidades.",
    banner: "",
    logo: "",
    theme: "optimus",
    accent: "#7c3aed",
    buttons: [],
    socials: [],
    showcase: { enabled: false, label: "Explorar a vitrine", url: "" },
    customDomain: "",
    metaPixelId: "",
    metaPixelEnabled: false,
    metaPixelConsent: "required",
    slug: "",
  };
}

function validateConfig(input, assets = []) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw erro("configuracao_invalida");
  const allowedAssets = new Set(assets.map((asset) => asset.name));
  const asset = (value) => {
    if (value === "") return "";
    if (
      typeof value !== "string" ||
      !ASSET_RE.test(value) ||
      !allowedAssets.has(value)
    )
      throw erro("imagem_nao_pertence_ao_workspace");
    return value;
  };
  const domain = text(input.customDomain || "", 253, "dominio");
  let normalizedDomain = "";
  if (domain) {
    const url = httpsUrl(`https://${domain}`, "dominio");
    const parsed = new URL(url);
    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.host !== parsed.hostname
    )
      throw erro("dominio_invalido");
    normalizedDomain = parsed.hostname;
  }
  if (!/^#[a-fA-F0-9]{6}$/.test(input.accent || "")) throw erro("cor_invalida");
  const theme = input.theme === undefined ? "optimus" : input.theme;
  if (!LANDING_THEME_IDS.has(theme)) throw erro("tema_invalido");
  const showcase = input.showcase || {};
  const result = {
    name: text(input.name, 80, "nome"),
    title: text(input.title, 140, "titulo"),
    description: text(input.description, 500, "descricao"),
    banner: asset(input.banner),
    logo: asset(input.logo),
    theme,
    accent: input.accent.toLowerCase(),
    buttons: links(input.buttons, 8, "botoes"),
    socials: links(input.socials, 6, "redes_sociais"),
    showcase: {
      enabled: showcase.enabled === true,
      label: text(showcase.label || "Explorar a vitrine", 60, "vitrine_nome"),
      url: httpsUrl(showcase.url || "", "vitrine_url"),
    },
    customDomain: normalizedDomain,
    metaPixelId: pixelId(input.metaPixelId || ""),
    metaPixelEnabled: input.metaPixelEnabled === true,
    metaPixelConsent: "required",
    slug: slug(input.slug || ""),
  };
  if (result.metaPixelEnabled && !result.metaPixelId) throw erro("pixel_id_obrigatorio");
  if (result.showcase.enabled && !result.showcase.url)
    throw erro("vitrine_url_obrigatoria");
  return result;
}

async function readJson(file, maxBytes, fallback) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      throw erro("fonte_indisponivel", 503);
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw erro("fonte_em_alteracao", 503);
    return JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    if (error.statusCode) throw error;
    throw erro("persistencia_indisponivel", 503);
  } finally {
    await handle?.close();
  }
}

async function atomicJson(file, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_DOCUMENT) throw erro("configuracao_muito_grande", 413);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
    let directory;
    try {
      directory = await fs.open(path.dirname(file), "r");
      await directory.sync();
    } catch (error) {
      if (!["EINVAL", "EPERM", "EISDIR", "ENOTSUP"].includes(error.code))
        throw error;
    } finally {
      await directory?.close();
    }
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function createLandingPageService(options = {}) {
  const root = path.resolve(
    options.dataDir || process.env.DATA_DIR || "/data",
    "landing-pages",
  );
  const canPublish = options.canPublish || (() => false);
  const offers =
    options.getOffers || (async () => ({ status: "unavailable", offers: [] }));
  const uploading = new Set();
  const documentPath = (id) =>
    path.join(root, "workspaces", `${workspaceId(id)}.json`);
  const publicPath = (id) => {
    if (!PAGE_RE.test(id || "")) throw erro("pagina_nao_encontrada", 404);
    return path.join(root, "public", `${id}.json`);
  };
  const defaultState = (id) => ({
    version: 1,
    workspaceId: workspaceId(id),
    revision: 0,
    publicId: "",
    draft: emptyConfig(),
    published: null,
    assets: [],
    updatedAt: "",
  });

  async function read(id) {
    const state = await readJson(documentPath(id), MAX_DOCUMENT, null);
    if (!state) return defaultState(id);
    if (
      state.version !== 1 ||
      state.workspaceId !== id ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      !PAGE_RE.test(state.publicId) ||
      !Array.isArray(state.assets) ||
      state.assets.length > 32 ||
      state.assets.some(
        (asset) =>
          !asset ||
          !ASSET_RE.test(asset.name) ||
          !Number.isSafeInteger(asset.bytes) ||
          asset.bytes <= 0,
      ) ||
      new Set(state.assets.map((asset) => asset.name)).size !==
        state.assets.length
    )
      throw erro("persistencia_invalida", 503);
    state.draft = validateConfig(state.draft, state.assets);
    if (state.published)
      state.published.config = validateConfig(
        state.published.config,
        state.assets,
      );
    return state;
  }

  async function mutate(id, revision, operation) {
    const file = documentPath(id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    let lock;
    try {
      lock = await fs.open(`${file}.lock`, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") throw erro("landing_em_edicao", 409);
      throw error;
    }
    const token = crypto.randomUUID();
    try {
      await lock.writeFile(token);
      const state = await read(id);
      if (!Number.isSafeInteger(revision) || revision !== state.revision)
        throw erro("revisao_desatualizada_recarregue", 409);
      if (!state.publicId)
        state.publicId = crypto.randomBytes(16).toString("hex");
      await operation(state);
      state.revision += 1;
      state.updatedAt = new Date().toISOString();
      await fs.mkdir(path.join(root, "public"), { recursive: true });
      const pointer = publicPath(state.publicId);
      const currentPointer = await readJson(pointer, 512, null);
      if (currentPointer && currentPointer.workspaceId !== id)
        throw erro("identidade_publica_invalida", 409);
      if (!currentPointer)
        await fs.writeFile(pointer, JSON.stringify({ workspaceId: id }), {
          flag: "wx",
          mode: 0o600,
        });
      await atomicJson(file, state);
      return state;
    } finally {
      const owner = await fs.readFile(`${file}.lock`, "utf8").catch(() => "");
      const current = await fs.stat(`${file}.lock`).catch(() => null);
      const held = await lock.stat();
      await lock.close();
      if (owner === token && current?.ino === held.ino)
        await fs.unlink(`${file}.lock`);
    }
  }

  const editorDto = (state) => ({
    revision: state.revision,
    publicId: state.publicId,
    publicSlug: state.published?.config.slug || "",
    publishedDomain: state.published?.config.customDomain || "",
    draft: state.draft,
    published: Boolean(state.published),
    publishedAt: state.published?.at || "",
    updatedAt: state.updatedAt,
    integrations: { customDomain: "not_verified", metaPixel: state.published?.config.metaPixelEnabled ? "published_not_confirmed" : "not_activated" },
  });

  const addresses = createLandingAddresses({ root, read, mutate, editorDto, readJson, atomicJson, canPublish, provider: options.domainProvider, now: options.now });

  async function resolvePublic(pageId) {
    if (!PAGE_RE.test(pageId || "")) {
      try { pageId = await addresses.resolveSlug(pageId); }
      catch { throw erro("pagina_nao_encontrada", 404); }
    }
    const pointer = await readJson(publicPath(pageId), 512, null);
    if (!pointer || !(await canPublish(pointer.workspaceId)))
      throw erro("pagina_nao_encontrada", 404);
    const state = await read(workspaceId(pointer.workspaceId));
    if (state.publicId !== pageId || !state.published)
      throw erro("pagina_nao_encontrada", 404);
    return state;
  }

  return {
    async get(id) {
      const state = await read(workspaceId(id));
      return { ...editorDto(state), domain: await addresses.domainStatus(state), source: await offers(id) };
    },
    async save(id, revision, config) {
      return editorDto(
        await mutate(workspaceId(id), revision, (state) => {
          state.draft = validateConfig(config, state.assets);
        }),
      );
    },
    async publish(id, revision) {
      return editorDto(
        await addresses.publish(workspaceId(id), revision, async (state) => {
          if (!(await canPublish(id)))
            throw erro("recurso_nao_disponivel_no_plano", 403);
          if (!state.draft.name || !state.draft.title)
            throw erro("nome_e_titulo_obrigatorios");
          state.published = {
            config: validateConfig(state.draft, state.assets),
            at: new Date().toISOString(),
            key: crypto.randomUUID(),
          };
        }),
      );
    },
    async unpublish(id, revision) {
      return editorDto(
        await mutate(workspaceId(id), revision, (state) => {
          state.published = null;
        }),
      );
    },
    async publicPage(pageId) {
      const state = await resolvePublic(pageId);
      const { customDomain, metaPixelId, metaPixelEnabled, metaPixelConsent, ...config } = state.published.config;
      return {
        publicId: state.publicId,
        config,
        source: await offers(state.workspaceId),
        ...(metaPixelEnabled && metaPixelId ? { pixel: { id: metaPixelId, consentRequired: true, publicationKey: state.published.key || state.published.at } } : {}),
      };
    },
    slugAvailability: addresses.availability,
    connectDomain: addresses.connect,
    verifyDomain: addresses.verify,
    disconnectDomain: addresses.disconnect,
    async publicDomain(host) { return this.publicPage(await addresses.resolveDomain(host)); },
    verifyDueDomains: addresses.verifyDueDomains,
    startDomainVerification: addresses.start,
    async upload(id, revision, kind, buffer, declaredMime) {
      if (
        !["banner", "logo"].includes(kind) ||
        !Buffer.isBuffer(buffer) ||
        !buffer.length ||
        buffer.length > MAX_UPLOAD
      )
        throw erro("imagem_invalida", 413);
      const mime = detectarMime(buffer);
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(mime) ||
        mime !== declaredMime
      )
        throw erro("imagem_tipo_invalido");
      workspaceId(id);
      if (uploading.has(id) || uploading.size >= 2)
        throw erro("imagem_em_processamento_tente_novamente", 429);
      uploading.add(id);
      try {
        const current = await read(id);
        if (!Number.isSafeInteger(revision) || current.revision !== revision)
          throw erro("revisao_desatualizada_recarregue", 409);
        let output;
        try {
          output = await sharp(buffer, { limitInputPixels: 16000000 })
            .rotate()
            .resize({
              width: kind === "logo" ? 512 : 1920,
              height: kind === "logo" ? 512 : 1200,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 85 })
            .toBuffer();
        } catch {
          throw erro("imagem_invalida");
        }
        const name = `${crypto.createHash("sha256").update(output).digest("hex")}.webp`;
        return editorDto(
          await mutate(workspaceId(id), revision, async (state) => {
            if (!state.assets.some((asset) => asset.name === name)) {
              if (
                state.assets.length >= 32 ||
                state.assets.reduce((sum, asset) => sum + asset.bytes, 0) +
                  output.length >
                  32 * 1024 * 1024
              )
                throw erro("limite_de_imagens_atingido", 409);
              const dir = path.join(root, "assets", state.publicId);
              await fs.mkdir(dir, { recursive: true });
              let image;
              try {
                image = await fs.open(path.join(dir, name), "wx", 0o600);
                await image.writeFile(output);
                await image.sync();
              } catch (error) {
                if (error.code !== "EEXIST") throw error;
                const existing = await fs.readFile(path.join(dir, name));
                if (
                  existing.length !== output.length ||
                  crypto.createHash("sha256").update(existing).digest("hex") !==
                    name.slice(0, -5)
                )
                  throw erro("imagem_persistida_invalida", 503);
              } finally {
                await image?.close();
              }
              state.assets.push({ name, bytes: output.length });
            }
            state.draft[kind] = name;
          }),
        );
      } finally {
        uploading.delete(id);
      }
    },
    async asset(id, name, isPublic = false) {
      const state = isPublic
        ? await resolvePublic(id)
        : await read(workspaceId(id));
      if (
        !ASSET_RE.test(name || "") ||
        !state.assets.some((asset) => asset.name === name) ||
        (isPublic &&
          ![
            state.published.config.banner,
            state.published.config.logo,
          ].includes(name))
      )
        throw erro("imagem_nao_encontrada", 404);
      return path.join(root, "assets", state.publicId, name);
    },
  };
}

function createVitrineOfferReader({ getWorkspaceDir, canRead = () => false }) {
  return async (id) => {
    if (!(await canRead(id)))
      return { status: "vitrine_unavailable", offers: [] };
    try {
      const source = await readJson(
        path.join(getWorkspaceDir(workspaceId(id)), "vitrine.json"),
        2 * 1024 * 1024,
        null,
      );
      if (!source || source.clienteId !== id || source.config?.ativa !== true)
        return { status: "vitrine_unavailable", offers: [] };
      const now = Date.now();
      const eligible = vitrine
        .aplicarRetencaoOfertas(source.ofertas)
        .filter(
          (offer) =>
            offer.titulo &&
            offer.linksComerciais.length > 0 &&
            Number.isFinite(Date.parse(offer.enviadoEm)) &&
            Date.parse(offer.enviadoEm) <= now,
        );
      return { status: "ready", offers: eligible.slice(0, 4) };
    } catch {
      return { status: "source_unavailable", offers: [] };
    }
  };
}

module.exports = {
  createLandingPageService,
  createVitrineOfferReader,
  validateConfig,
  emptyConfig,
  httpsUrl,
  pixelId,
  MAX_UPLOAD,
  LANDING_THEME_IDS,
};
