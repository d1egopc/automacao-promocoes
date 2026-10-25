"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { publicUrl } = require("./model");
// Only published documents and ownership indices, never session credentials,
// personal telephone numbers, offer queues or draft links.
function createPublicResources({
  dataDir,
  canUse = () => false,
  origin = "https://www.optimuspromo.com.br",
}) {
  const cache = new Map();
  const read = async (file, max) => {
    try {
      const handle = await fs.open(file, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > max) return null;
        return JSON.parse(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  };
  return async (workspaceId) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId)) return {};
    const old = cache.get(workspaceId);
    if (old && Date.now() - old.at < 30000) return old.value;
    const value = {};
    if (canUse(workspaceId, "landing_page")) {
      const state = await read(
        path.join(
          dataDir,
          "landing-pages",
          "workspaces",
          workspaceId + ".json",
        ),
        65536,
      );
      if (
        state?.workspaceId === workspaceId &&
        state.published &&
        /^[a-f0-9]{32}$/.test(state.publicId)
      ) {
        const pointer = await read(
          path.join(
            dataDir,
            "landing-pages",
            "public",
            state.publicId + ".json",
          ),
          512,
        );
        if (pointer?.workspaceId === workspaceId) {
          value.landing =
            origin +
            "/l/" +
            encodeURIComponent(state.published.config.slug || state.publicId);
          value.businessName = state.published.config.name || "";
          value.groupInvites = (state.published.config.buttons || [])
            .map((b) => {
              try {
                return publicUrl(b.url || "");
              } catch {
                return "";
              }
            })
            .filter((url) => {
              try {
                return ["chat.whatsapp.com", "t.me", "discord.gg"].includes(
                  new URL(url).hostname,
                );
              } catch {
                return false;
              }
            })
            .slice(0, 10);
        }
      }
    }
    if (canUse(workspaceId, "vitrine")) {
      const vitrine = await read(
        path.join(dataDir, "clientes", workspaceId, "vitrine.json"),
        2 * 1024 * 1024,
      );
      const index = await read(
        path.join(dataDir, "vitrine-slugs.json"),
        1024 * 1024,
      );
      const slug = vitrine?.config?.slug;
      if (
        vitrine?.clienteId === workspaceId &&
        vitrine.config.ativa === true &&
        /^[a-z0-9][a-z0-9-]{2,59}$/.test(slug || "") &&
        index?.slugs?.[slug] === workspaceId
      ) {
        value.storefront = origin + "/v/" + slug;
        value.businessName ||= vitrine.config.nomePublico || "";
        try {
          value.publicContact = publicUrl(vitrine.config.links?.whatsapp || "");
        } catch {}
      }
    }
    if (cache.size >= 1000 && !cache.has(workspaceId))
      cache.delete(cache.keys().next().value);
    cache.set(workspaceId, { at: Date.now(), value });
    return value;
  };
}
module.exports = { createPublicResources };
