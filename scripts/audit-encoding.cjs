#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { TextDecoder } = require("util");

const ROOT = process.cwd();
const decoderFatal = new TextDecoder("utf-8", { fatal: true });
const decoderUtf8 = new TextDecoder("utf-8");
const MAX_OCCURRENCES_PER_FILE = 8;
const MAX_FILES_PER_GROUP = 50;
const SNIPPET_RADIUS = 28;

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".vercel",
  "coverage",
  "uploads",
  "upload",
  "media",
  "midia",
  "storage",
  "data",
  "dados",
  ".output",
  ".nitro",
  ".cache",
  "tmp",
  "temp"
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".ogg",
  ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".exe", ".dll", ".so",
  ".woff", ".woff2", ".ttf", ".eot", ".bin", ".sqlite", ".db"
]);

const STRONG_CORRUPTION_PATTERNS = [
  { pattern: new RegExp("\\uFFFD", "g"), reason: "caractere de substituicao" },
  { pattern: new RegExp("\\u00c3[\\u0080-\\u00bf\\u00a0-\\u00ff]", "g"), reason: "mojibake UTF-8 como Latin-1/Windows-1252" },
  { pattern: new RegExp("\\u00c2[\\u0080-\\u00bf\\u00a0]", "g"), reason: "mojibake com marcador U+00C2" },
  { pattern: new RegExp("\\u00e2[\\u0080-\\u017f\\u2020\\u2026\\u20ac\\u2122]+", "g"), reason: "mojibake de pontuacao tipografica" },
  { pattern: new RegExp("\\u00f0[\\u0080-\\u00ff\\u0178\\u2018-\\u201d]+", "g"), reason: "mojibake de emoji" },
  {
    pattern: new RegExp("Autom\\uFFFDtico|Autom\\u00c3\\u00a1tico|Publica\\uFFFD\\uFFFDes|Publica\\u00c3\\u00a7\\u00c3\\u00b5es|Configura\\uFFFD\\uFFFDo|Configura\\u00c3\\u00a7\\u00c3\\u00a3o|M\\uFFFDnimo|M\\u00c3\\u00adnimo|N\\uFFFDo|N\\u00c3\\u00a3o|inv\\uFFFDlido|inv\\u00c3\\u00a1lido", "gi"),
    reason: "palavra conhecida corrompida"
  }
];

const INCONCLUSIVE_PATTERNS = [
  { pattern: new RegExp("[\\u0080-\\u009f]", "g"), reason: "controle C1 incomum em texto" }
];

function toPosix(file) {
  return file.replace(/\\/g, "/");
}

function hasIgnoredDir(file) {
  return toPosix(file).split("/").some(part => IGNORE_DIRS.has(part));
}

function isBinaryExtension(file) {
  return BINARY_EXTS.has(path.extname(file).toLowerCase());
}

function listVersionableFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (error) {
    throw new Error(`falha ao listar arquivos versionaveis: ${error.message}`);
  }
}

function hasNullByte(buffer) {
  return buffer.includes(0);
}

function decodeUtf8(buffer) {
  try {
    return { ok: true, text: decoderFatal.decode(buffer) };
  } catch {
    return { ok: false, text: decoderUtf8.decode(buffer) };
  }
}

function detectEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const semCrLf = text.replace(/\r\n/g, "");
  const lf = (semCrLf.match(/\n/g) || []).length;
  const cr = (semCrLf.match(/\r/g) || []).length;
  const tipos = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
  return {
    crlf,
    lf,
    cr,
    tipo: tipos > 1 ? "mixed" : crlf > 0 ? "CRLF" : lf > 0 ? "LF" : cr > 0 ? "CR" : "none"
  };
}

function suspectWindows1252(buffer, utf8Ok) {
  if (utf8Ok) return false;
  return buffer.some(byte => byte >= 0x80 && byte <= 0x9f) || buffer.some(byte => byte >= 0xa0);
}

function getLineColumn(text, index) {
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lastLineStart = i + 1;
    }
  }
  return { line, column: index - lastLineStart + 1 };
}

function getSnippet(text, index, length) {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return text.slice(start, end).replace(/[\r\n\t]+/g, " ");
}

function makeFinding(text, match, index, classification, reason) {
  const pos = getLineColumn(text, index);
  return {
    line: pos.line,
    column: pos.column,
    sequence: match,
    classification,
    reason,
    snippet: getSnippet(text, index, match.length)
  };
}

function isInsideRange(index, ranges) {
  return ranges.some(range => index >= range.start && index < range.end);
}

function collectPatternFindings(text, specs, classification) {
  const findings = [];
  const ranges = [];
  for (const spec of specs) {
    spec.pattern.lastIndex = 0;
    let match;
    while ((match = spec.pattern.exec(text))) {
      const value = match[0];
      if (!value) {
        spec.pattern.lastIndex += 1;
        continue;
      }
      findings.push(makeFinding(text, value, match.index, classification, spec.reason));
      ranges.push({ start: match.index, end: match.index + value.length });
    }
  }
  return { findings, ranges };
}

function classifyUnicodeChar(char) {
  if (/^[\u00c0-\u017f]$/u.test(char)) return "acento latino valido";
  if (/^[\u2190-\u21ff]$/u.test(char)) return "seta/simbolo valido";
  if (/^[\u2600-\u27bf]$/u.test(char)) return "simbolo ou emoji valido";
  if (/^[\u{1f000}-\u{1ffff}]$/u.test(char)) return "emoji valido";
  if (/^[\u2010-\u201f]$/u.test(char)) return "pontuacao tipografica valida";
  if (/^[\u20a0-\u20cf]$/u.test(char)) return "simbolo monetario valido";
  return "unicode nao ASCII valido";
}

function findEncodingFindings(text) {
  const strong = collectPatternFindings(text, STRONG_CORRUPTION_PATTERNS, "corrupcao forte");
  const inconclusive = collectPatternFindings(text, INCONCLUSIVE_PATTERNS, "inconclusivo");
  const occupiedRanges = [...strong.ranges, ...inconclusive.ranges];
  const legitimate = [];
  const unicodePattern = /[^\x00-\x7f]/gu;
  let match;
  while ((match = unicodePattern.exec(text))) {
    const value = match[0];
    if (isInsideRange(match.index, occupiedRanges)) continue;
    legitimate.push(makeFinding(text, value, match.index, "unicode legitimo", classifyUnicodeChar(value)));
  }
  return {
    strong: strong.findings,
    inconclusive: inconclusive.findings,
    legitimate
  };
}

function formatFinding(item) {
  return `${item.file}:${item.line}:${item.column} [${item.classification}; ${item.reason}] "${item.sequence}" em "${item.snippet}"`;
}

function summarizeFindingsByFile(file, findings) {
  return findings.map(finding => ({ file, ...finding }));
}

function printGroup(title, items, formatter = item => item) {
  console.log(`\n${title}: ${items.length}`);
  for (const item of items.slice(0, MAX_FILES_PER_GROUP)) {
    console.log(`  - ${formatter(item)}`);
  }
  if (items.length > MAX_FILES_PER_GROUP) console.log(`  ... mais ${items.length - MAX_FILES_PER_GROUP}`);
}

function printFindingGroup(title, reports, key) {
  const files = reports.filter(item => item.findings[key].length);
  const total = files.reduce((sum, item) => sum + item.findings[key].length, 0);
  console.log(`\n${title}: ${files.length} arquivo(s), ${total} ocorrencia(s)`);
  for (const item of files.slice(0, MAX_FILES_PER_GROUP)) {
    const count = item.findings[key].length;
    const visible = summarizeFindingsByFile(item.file, item.findings[key].slice(0, MAX_OCCURRENCES_PER_FILE));
    console.log(`  - ${item.file}: ${count} ocorrencia(s)`);
    for (const finding of visible) {
      console.log(`    * ${formatFinding(finding)}`);
    }
    if (count > MAX_OCCURRENCES_PER_FILE) {
      console.log(`    ... mais ${count - MAX_OCCURRENCES_PER_FILE} ocorrencia(s) neste arquivo`);
    }
  }
  if (files.length > MAX_FILES_PER_GROUP) console.log(`  ... mais ${files.length - MAX_FILES_PER_GROUP} arquivo(s)`);
}

function main() {
  const files = listVersionableFiles();
  const ignored = [];
  const binary = [];
  const reports = [];

  for (const file of files) {
    const rel = toPosix(file);
    if (hasIgnoredDir(rel)) {
      ignored.push(rel);
      continue;
    }
    if (isBinaryExtension(rel)) {
      binary.push(rel);
      continue;
    }

    const abs = path.join(ROOT, file);
    let buffer;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
      buffer = fs.readFileSync(abs);
    } catch {
      ignored.push(`${rel} (indisponivel)`);
      continue;
    }

    if (hasNullByte(buffer)) {
      binary.push(rel);
      continue;
    }

    const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    const decoded = decodeUtf8(buffer);
    const text = decoded.text;
    const eol = detectEol(text);
    const findings = findEncodingFindings(text);
    const win1252 = suspectWindows1252(buffer, decoded.ok);

    reports.push({ file: rel, utf8Ok: decoded.ok, hasBom, eol, findings, win1252 });
  }

  const utf8Invalid = reports.filter(item => !item.utf8Ok);
  const withBom = reports.filter(item => item.hasBom);
  const crlf = reports.filter(item => item.eol.tipo === "CRLF");
  const lf = reports.filter(item => item.eol.tipo === "LF");
  const mixed = reports.filter(item => item.eol.tipo === "mixed");
  const win1252 = reports.filter(item => item.win1252);
  const strongFiles = reports.filter(item => item.findings.strong.length);
  const legitimateFiles = reports.filter(item => item.findings.legitimate.length);
  const inconclusiveFiles = reports.filter(item => item.findings.inconclusive.length);
  const strongTotal = strongFiles.reduce((sum, item) => sum + item.findings.strong.length, 0);
  const legitimateTotal = legitimateFiles.reduce((sum, item) => sum + item.findings.legitimate.length, 0);
  const inconclusiveTotal = inconclusiveFiles.reduce((sum, item) => sum + item.findings.inconclusive.length, 0);

  console.log("AUDITORIA DE ENCODING E FINAIS DE LINHA");
  console.log(`Projeto: ${ROOT}`);
  console.log(`Arquivos candidatos: ${files.length}`);
  console.log(`Arquivos analisados: ${reports.length}`);
  console.log(`Arquivos ignorados por regra: ${ignored.length}`);
  console.log(`Arquivos binarios ignorados: ${binary.length}`);
  console.log(`UTF-8 valido: ${reports.length - utf8Invalid.length}`);
  console.log(`UTF-8 invalido: ${utf8Invalid.length}`);
  console.log(`UTF-8 com BOM: ${withBom.length}`);
  console.log(`LF: ${lf.length}`);
  console.log(`CRLF: ${crlf.length}`);
  console.log(`Finais mistos: ${mixed.length}`);
  console.log(`Suspeitos Windows-1252/Latin-1: ${win1252.length}`);
  console.log(`Corrupcao forte: ${strongFiles.length} arquivo(s), ${strongTotal} ocorrencia(s)`);
  console.log(`Unicode legitimo: ${legitimateFiles.length} arquivo(s), ${legitimateTotal} ocorrencia(s)`);
  console.log(`Inconclusivo: ${inconclusiveFiles.length} arquivo(s), ${inconclusiveTotal} ocorrencia(s)`);

  printGroup("UTF-8 com BOM", withBom, item => item.file);
  printGroup("UTF-8 invalido / possivel Windows-1252", win1252, item => item.file);
  printGroup("Finais CRLF", crlf, item => item.file);
  printGroup("Finais mistos", mixed, item => `${item.file} (CRLF=${item.eol.crlf}, LF=${item.eol.lf}, CR=${item.eol.cr})`);
  printFindingGroup("Corrupcao forte", reports, "strong");
  printFindingGroup("Inconclusivo", reports, "inconclusive");
  printFindingGroup("Unicode legitimo (amostra, nao tratado como corrupcao)", reports, "legitimate");
  printGroup("Arquivos ignorados por regra", ignored, item => item);
  printGroup("Arquivos binarios ignorados", binary, item => item);
}

try {
  main();
} catch (error) {
  console.error("audit:encoding falhou:", error.message);
  process.exitCode = 1;
}
