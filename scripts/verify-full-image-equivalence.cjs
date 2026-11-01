#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

function isSafeManifestPath(value) {
  if (typeof value !== "string" || !value || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) ||
      value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split("/").every(segment => segment && segment !== "." && segment !== "..");
}

function load(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.schemaVersion !== 1 || !value.metadata || !Array.isArray(value.entries))
    throw new Error("invalid_manifest");
  const paths = new Set();
  for (const entry of value.entries) {
    if (!entry || !isSafeManifestPath(entry.path) || paths.has(entry.path))
      throw new Error("invalid_manifest_path");
    if (!Number.isInteger(entry.mode) || !["file", "symlink", "directory"].includes(entry.type) ||
        !Number.isInteger(entry.uid) || !Number.isInteger(entry.gid)) throw new Error("invalid_manifest_entry");
    if (entry.type === "file" && (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0))
      throw new Error("invalid_manifest_hash");
    if (entry.type === "symlink" && typeof entry.target !== "string") throw new Error("invalid_manifest_symlink");
    paths.add(entry.path);
  }
  return value;
}

function entryMap(manifest) { return new Map(manifest.entries.map(entry => [entry.path, JSON.stringify(entry)])); }
function changedPaths(before, after) {
  const left = entryMap(before), right = entryMap(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  return paths.flatMap(file => {
    if (left.get(file) === right.get(file)) return [];
    const status = !left.has(file) ? "A" : !right.has(file) ? "D" : "M";
    return [{ path: file, status }];
  });
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function compare({ active, base, candidate, approvedChanges }) {
  const activeManifest = load(active), baseManifest = load(base), candidateManifest = load(candidate);
  if (!same(activeManifest.metadata, baseManifest.metadata)) throw new Error("active_base_runtime_metadata_mismatch");
  if (!same(activeManifest.entries, baseManifest.entries)) throw new Error("active_base_runtime_tree_mismatch");
  if (!same(baseManifest.metadata, candidateManifest.metadata)) throw new Error("candidate_runtime_metadata_mismatch");
  const actual = changedPaths(baseManifest, candidateManifest);
  const expected = [...approvedChanges].sort((a, b) => a.path.localeCompare(b.path));
  if (!same(actual, expected)) throw new Error("candidate_runtime_delta_mismatch");
  return {
    result: "PASS",
    activeBaseParity: "PASS",
    candidateMetadataParity: "PASS",
    changedRuntimeFiles: actual.map(item => `${item.status}:${item.path}`),
    runtimeEntryCount: candidateManifest.summary?.runtimeEntryCount ?? candidateManifest.entries.length,
    dependencyEntryCount: candidateManifest.metadata.dependencyEntryCount
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || !argv[index + 1]) throw new Error("invalid_compare_argument");
    values[key.slice(2)] = argv[++index];
  }
  const allowed = (values.changes || "").split(",").filter(Boolean).map(value => {
    const separator = value.lastIndexOf("=");
    if (separator < 1) throw new Error("invalid_approved_change");
    return { path: value.slice(0, separator), status: value.slice(separator + 1) };
  });
  if (allowed.some(item => !["A", "M"].includes(item.status))) throw new Error("invalid_approved_change");
  return { active: values.active, base: values.base, candidate: values.candidate, approvedChanges: allowed };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(compare(parseArgs(process.argv.slice(2)) ))}\n`);
  } catch (error) {
    process.stderr.write(`full_image_equivalence_failed reason=${String(error?.message || "unknown")}\n`);
    process.exitCode = 1;
  }
}

module.exports = { compare, load, changedPaths, isSafeManifestPath };
