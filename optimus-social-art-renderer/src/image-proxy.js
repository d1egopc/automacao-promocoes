const dns = require("dns").promises;
const net = require("net");

const MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function isIpv4Privado(ip = "") {
  if (!net.isIP(ip)) return false;
  if (ip === "127.0.0.1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  return false;
}

function isIpv6Privado(ip = "") {
  const valor = ip.toLowerCase();
  return valor === "::1" || valor.startsWith("fc") || valor.startsWith("fd") || valor.startsWith("fe80:");
}

function ipPrivado(ip = "") {
  const tipo = net.isIP(ip);
  if (tipo === 4) return isIpv4Privado(ip);
  if (tipo === 6) return isIpv6Privado(ip);
  return true;
}

function validarUrlImagem(url = "") {
  const valor = texto(url);
  let parsed;
  try {
    parsed = new URL(valor);
  } catch {
    throw new Error("imagem_url_invalida");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("imagem_protocolo_invalido");
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || net.isIP(host) && ipPrivado(host)) {
    throw new Error("imagem_host_bloqueado");
  }
  return parsed;
}

async function validarDnsPublico(hostname = "") {
  const registros = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!registros.length) throw new Error("imagem_dns_sem_resposta");
  if (registros.some(item => ipPrivado(item.address))) throw new Error("imagem_host_privado");
  return registros.map(item => item.address);
}

function detectarMime(buffer = Buffer.alloc(0)) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.slice(0, 5).toString("utf8").toLowerCase().includes("<svg")) return "image/svg+xml";
  return "";
}

async function baixarImagemSegura(url = "", {
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.RENDERER_IMAGE_TIMEOUT_MS || 8000),
  maxBytes = Number(process.env.RENDERER_IMAGE_MAX_BYTES || 6 * 1024 * 1024),
  maxRedirects = Number(process.env.RENDERER_IMAGE_MAX_REDIRECTS || 3)
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch_indisponivel");
  let atual = validarUrlImagem(url);
  let redirects = 0;

  while (redirects <= maxRedirects) {
    await validarDnsPublico(atual.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    let resposta;
    try {
      resposta = await fetchImpl(atual.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "OptimusSocialArtRenderer/1.0",
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8"
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(resposta.status)) {
      const location = resposta.headers.get("location");
      if (!location) throw new Error("imagem_redirect_sem_location");
      atual = validarUrlImagem(new URL(location, atual).toString());
      redirects += 1;
      continue;
    }

    if (!resposta.ok) throw new Error(`imagem_http_${resposta.status}`);
    const contentType = texto(resposta.headers.get("content-type")).split(";")[0].toLowerCase();
    if (contentType && !MIME_PERMITIDOS.has(contentType)) throw new Error("imagem_mime_invalido");

    const chunks = [];
    let total = 0;
    const reader = resposta.body?.getReader ? resposta.body.getReader() : null;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("imagem_muito_grande");
        chunks.push(Buffer.from(value));
      }
    } else {
      const arrayBuffer = await resposta.arrayBuffer();
      total = arrayBuffer.byteLength;
      if (total > maxBytes) throw new Error("imagem_muito_grande");
      chunks.push(Buffer.from(arrayBuffer));
    }

    const buffer = Buffer.concat(chunks);
    const mimeReal = detectarMime(buffer);
    if (!MIME_PERMITIDOS.has(mimeReal)) throw new Error("imagem_mime_real_invalido");
    return {
      buffer,
      mimeType: mimeReal,
      bytes: buffer.length,
      host: atual.hostname
    };
  }

  throw new Error("imagem_redirects_excedidos");
}

module.exports = {
  MIME_PERMITIDOS,
  ipPrivado,
  validarUrlImagem,
  validarDnsPublico,
  detectarMime,
  baixarImagemSegura
};
