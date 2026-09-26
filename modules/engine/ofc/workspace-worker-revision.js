"use strict";
const fs = require("node:fs");
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs"];
function identidade(stat) {
  if (!stat.isFile()) throw new Error("ofc_revision_not_regular_file");
  return Object.fromEntries(FIELDS.map(k => [k, String(stat[k])]));
}
function revisao(arquivo) {
  try { return identidade(fs.statSync(arquivo, { bigint: true })); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
function iguais(a, b) {
  if (a === null || b === null) return a === b;
  return !!a && !!b && FIELDS.every(k => typeof a[k] === "string" && a[k] === b[k]);
}
module.exports = { identidade, revisao, iguais };
