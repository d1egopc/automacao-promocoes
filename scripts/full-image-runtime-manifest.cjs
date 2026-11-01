#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const NON_RUNTIME_EXACT = new Set([
  "AGENTS.md",
  "scripts/deploy-backend-vps-manual.sh",
  "scripts/full-image-runtime-manifest.cjs",
  "scripts/verify-full-image-equivalence.cjs",
  "scripts/guardian-v1.cjs",
  "scripts/benchmark-gerente-observability-v2.cjs",
  "scripts/benchmark-garimpei-sensor24h.cjs",
  "scripts/garimpei-infra-guard.py",
  "scripts/garimpei-journal-cleanup.py",
  "optimus-capture/adapters/magalu.js",
  "optimus-capture/local-worker/magalu-identity.js"
]);
const NON_RUNTIME_PREFIXES = ["docs/", "tests/", ".github/"];

function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function isExcluded(relative) {
  return relative === ".git" || relative.startsWith(".git/") ||
    relative === "node_modules" || relative.startsWith("node_modules/") ||
    NON_RUNTIME_PREFIXES.some(prefix => relative === prefix.slice(0, -1) || relative.startsWith(prefix)) ||
    NON_RUNTIME_EXACT.has(relative);
}

async function walkFiles(root, { appTree = false } = {}) {
  const entries = [];
  let bytes = 0;
  async function visit(directory, parent = "") {
    let hasIncludedDescendant = false;
    const names = (await fs.promises.readdir(directory)).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const relative = parent ? `${parent}/${name}` : name;
      if (appTree && isExcluded(relative)) continue;
      const absolute = path.join(directory, name);
      const stat = await fs.promises.lstat(absolute);
      const mode = stat.mode & 0o777;
      const owner = { uid: Number.isInteger(stat.uid) ? stat.uid : null, gid: Number.isInteger(stat.gid) ? stat.gid : null };
      if (stat.isSymbolicLink()) {
        entries.push({ path: relative, type: "symlink", mode, ...owner, target: await fs.promises.readlink(absolute) });
        hasIncludedDescendant = true;
      } else if (stat.isDirectory()) {
        if (await visit(absolute, relative)) {
          entries.push({ path: relative, type: "directory", mode, ...owner });
          hasIncludedDescendant = true;
        }
      } else if (stat.isFile()) {
        entries.push({ path: relative, type: "file", mode, ...owner, size: stat.size, sha256: await hashFile(absolute) });
        bytes += stat.size;
        hasIncludedDescendant = true;
      } else {
        throw new Error("unsupported_filesystem_entry");
      }
    }
    return hasIncludedDescendant;
  }
  await visit(root);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, bytes };
}

function installedDpkgDigest(statusPath = "/var/lib/dpkg/status") {
  const raw = fs.readFileSync(statusPath, "utf8");
  const installed = raw.split(/\n\n+/).map(block => {
    const fields = Object.fromEntries(block.split("\n").filter(line => /^[A-Za-z0-9-]+: /.test(line))
      .map(line => { const index = line.indexOf(": "); return [line.slice(0, index), line.slice(index + 2)]; }));
    if (fields.Status !== "install ok installed") return null;
    if (!fields.Package || !fields.Version || !fields.Architecture) throw new Error("incomplete_package_inventory");
    return `${fields.Package}\t${fields.Version}\t${fields.Architecture}`;
  }).filter(Boolean).sort();
  if (!installed.length) throw new Error("empty_package_inventory");
  return { sha256: digest(Buffer.from(installed.join("\n"), "utf8")), count: installed.length };
}

function readNpmVersion() {
  for (const file of ["/usr/local/lib/node_modules/npm/package.json", "/usr/lib/node_modules/npm/package.json"]) {
    try {
      const version = JSON.parse(fs.readFileSync(file, "utf8")).version;
      if (typeof version === "string" && version) return version;
    } catch { /* Try the other fixed image path. */ }
  }
  throw new Error("npm_version_unavailable");
}

async function createManifest({ root = "/app", osReleasePath = "/etc/os-release", dpkgStatusPath = "/var/lib/dpkg/status", npmVersion } = {}) {
  const absoluteRoot = path.resolve(root);
  const app = await walkFiles(absoluteRoot, { appTree: true });
  const dependencies = await walkFiles(path.join(absoluteRoot, "node_modules"));
  const dependencyIndex = dependencies.entries.map(entry => JSON.stringify(entry)).join("\n");
  const effectiveNpmVersion = npmVersion || readNpmVersion();
  if (!effectiveNpmVersion) throw new Error("npm_version_unavailable");
  const osRelease = fs.readFileSync(osReleasePath);
  const dpkg = installedDpkgDigest(dpkgStatusPath);
  return {
    schemaVersion: 1,
    metadata: {
      nodeVersion: process.version,
      npmVersion: effectiveNpmVersion,
      runtimeUid: typeof process.getuid === "function" ? process.getuid() : null,
      runtimeGid: typeof process.getgid === "function" ? process.getgid() : null,
      osReleaseSha256: digest(osRelease),
      installedPackagesSha256: dpkg.sha256,
      installedPackageCount: dpkg.count,
      dependencyTreeSha256: digest(Buffer.from(dependencyIndex, "utf8")),
      dependencyEntryCount: dependencies.entries.length,
      dependencyBytes: dependencies.bytes
    },
    entries: app.entries,
    summary: { runtimeEntryCount: app.entries.length, runtimeBytes: app.bytes }
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--root" && argv[index + 1]) result.root = argv[++index];
    else throw new Error("invalid_manifest_argument");
  }
  return result;
}

function shouldRunAsCli({ isMainModule, stdinMarker } = {}) {
  return isMainModule === true || stdinMarker === "-";
}

if (shouldRunAsCli({ isMainModule: require.main === module, stdinMarker: process.argv[1] })) {
  createManifest(parseArgs(process.argv.slice(2)))
    .then(manifest => process.stdout.write(`${JSON.stringify(manifest)}\n`))
    .catch(() => { process.stderr.write("full_image_manifest_failed\n"); process.exitCode = 1; });
}

module.exports = { createManifest, installedDpkgDigest, walkFiles, isExcluded, readNpmVersion, shouldRunAsCli };
