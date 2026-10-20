"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Candidate-only migration fence. It is intentionally dependency-injected so
// no production workspace is migrated by merely loading this module.
function createWorkspaceFence({ migratedWorkspaceIds = [] } = {}) {
  const migrated = new Set(migratedWorkspaceIds.map(value => String(value).trim()).filter(Boolean));
  return Object.freeze({
    isMigrated(workspaceId) { return migrated.has(String(workspaceId || "")); },
    legacyAllowed(workspaceId) { return !migrated.has(String(workspaceId || "")); },
    v3Required(workspaceId) { return migrated.has(String(workspaceId || "")); }
  });
}

function createPersistentWorkspaceFence({ filePath } = {}) {
  if (!filePath) throw new Error("fence_file_path_obrigatorio");
  const read = () => {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return value && value.version === 1 && value.workspaces && typeof value.workspaces === "object"
        ? value
        : { version: 1, workspaces: {} };
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, workspaces: {} };
      throw error;
    }
  };
  const write = value => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    if (process.platform === "win32") {
      fs.copyFileSync(tmp, filePath);
      fs.rmSync(tmp, { force: true });
    } else {
      fs.renameSync(tmp, filePath);
    }
  };
  return {
    isMigrated(workspaceId) { return read().workspaces[String(workspaceId || "")]?.migrated === true; },
    legacyAllowed(workspaceId) { return !this.isMigrated(workspaceId); },
    v3Required(workspaceId) { return this.isMigrated(workspaceId); },
    markMigrated(workspaceId, details = {}) {
      const state = read();
      const id = String(workspaceId || "").trim();
      if (!id) throw new Error("workspace_obrigatoria");
      state.workspaces[id] = { migrated: true, ...details, updatedAt: new Date().toISOString() };
      write(state);
      return state.workspaces[id];
    },
    markLegacy(workspaceId) {
      const state = read();
      delete state.workspaces[String(workspaceId || "")];
      write(state);
    }
  };
}

module.exports = { createWorkspaceFence, createPersistentWorkspaceFence };
