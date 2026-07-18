const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  getClientePath,
  readClienteJson,
  writeClienteJson,
  normalizarClienteId
} = require("../utils/storage");

const ARQUIVO_INDICE = "campanhas-midia-temp.json";
const DIR_PADRAO = "campanhas-midia-temp";
const TTL_ORFA_MS_PADRAO = 24 * 60 * 60 * 1000;

const TIPOS = {
  imagem: {
    maxEnv: "CAMPANHAS_MEDIA_MAX_IMAGE_BYTES",
    maxPadrao: 8 * 1024 * 1024,
    mimes: {
      "image/jpeg": ["jpg", "jpeg"],
      "image/png": ["png"],
      "image/webp": ["webp"]
    }
  },
  video: {
    maxEnv: "CAMPANHAS_MEDIA_MAX_VIDEO_BYTES",
    maxPadrao: 50 * 1024 * 1024,
    mimes: {
      "video/mp4": ["mp4"],
      "video/webm": ["webm"],
      "video/quicktime": ["mov"]
    }
  },
  documento: {
    maxEnv: "CAMPANHAS_MEDIA_MAX_DOCUMENT_BYTES",
    maxPadrao: 20 * 1024 * 1024,
    mimes: {
      "application/pdf": ["pdf"],
      "application/msword": ["doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
      "application/vnd.ms-excel": ["xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
      "text/plain": ["txt"],
      "text/csv": ["csv"]
    }
  }
};

const STATUS_PROTEGIDOS = new Set(["associada", "pendente", "processando", "retentativa"]);

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function agoraIso(agora = new Date()) {
  const data = agora instanceof Date ? agora : new Date(agora);
  return Number.isFinite(data.getTime()) ? data.toISOString() : new Date().toISOString();
}

function numeroEnv(nome, padrao) {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

function ttlOrfaMs() {
  return numeroEnv("CAMPANHAS_MEDIA_ORFA_TTL_MS", TTL_ORFA_MS_PADRAO);
}

function clienteSeguro(clienteId = "admin") {
  return normalizarClienteId(clienteId || "admin");
}

function raizStorage(clienteId = "admin") {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const raizEnv = texto(process.env.CAMPANHAS_MEDIA_STORAGE_DIR);
  const raiz = raizEnv
    ? path.resolve(raizEnv, clienteIdSeguro)
    : path.resolve(getClientePath(clienteIdSeguro), DIR_PADRAO);
  fs.mkdirSync(raiz, { recursive: true });
  return raiz;
}

function caminhoSeguro(clienteId = "admin", nomeArquivo = "") {
  const raiz = raizStorage(clienteId);
  const destino = path.resolve(raiz, nomeArquivo);
  if (!destino.startsWith(raiz + path.sep)) throw new Error("campanhas_midia_caminho_inseguro");
  return destino;
}

function nomeOriginalSeguro(nome = "arquivo") {
  const base = path.basename(texto(nome) || "arquivo").replace(/[\u0000-\u001f]/g, "");
  const limpo = base.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  return (limpo || "arquivo").slice(0, 120);
}

function extensao(nome = "") {
  const ext = path.extname(nomeOriginalSeguro(nome)).replace(".", "").toLowerCase();
  return ext;
}

function detectarMimeReal(buffer = Buffer.alloc(0), mimeDeclarado = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.slice(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "video/webm";
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") {
    const marca = buffer.slice(8, 16).toString("ascii").toLowerCase();
    if (marca.includes("qt")) return "video/quicktime";
    return "video/mp4";
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return texto(mimeDeclarado).toLowerCase();
  }
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return texto(mimeDeclarado).toLowerCase();
  }
  if (!buffer.includes(0x00)) return texto(mimeDeclarado).toLowerCase();
  return "";
}

function tipoPorMime(mime = "") {
  const alvo = texto(mime).toLowerCase();
  return Object.entries(TIPOS).find(([, config]) => config.mimes[alvo])?.[0] || "";
}

function validarEntrada({ buffer, nomeOriginal, mimeType, tipo }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("campanhas_midia_arquivo_obrigatorio");

  const nome = nomeOriginalSeguro(nomeOriginal);
  const ext = extensao(nome);
  const mimeDeclarado = texto(mimeType).toLowerCase().split(";")[0];
  const mimeReal = detectarMimeReal(buffer, mimeDeclarado);
  const tipoEntrada = texto(tipo).toLowerCase();
  const tipoResolvido = tipoEntrada || tipoPorMime(mimeDeclarado) || tipoPorMime(mimeReal);
  const config = TIPOS[tipoResolvido];

  if (!config) throw new Error("campanhas_midia_tipo_invalido");
  if (!config.mimes[mimeDeclarado]) throw new Error("campanhas_midia_mime_invalido");
  if (!config.mimes[mimeDeclarado].includes(ext)) throw new Error("campanhas_midia_extensao_invalida");
  if (mimeReal && mimeReal !== mimeDeclarado) throw new Error("campanhas_midia_mime_invalido");

  const limite = numeroEnv(config.maxEnv, config.maxPadrao);
  if (buffer.length > limite) throw new Error("campanhas_midia_tamanho_excedido");

  return { nomeOriginal: nome, extensao: ext, mimeType: mimeDeclarado, tipo: tipoResolvido, limite };
}

function lerIndice(clienteId = "admin") {
  return Array.isArray(readClienteJson(clienteSeguro(clienteId), ARQUIVO_INDICE, []))
    ? readClienteJson(clienteSeguro(clienteId), ARQUIVO_INDICE, [])
    : [];
}

function salvarIndice(clienteId = "admin", itens = []) {
  writeClienteJson(clienteSeguro(clienteId), ARQUIVO_INDICE, Array.isArray(itens) ? itens : []);
}

function respostaPublica(meta = {}) {
  return {
    id: meta.id,
    midiaId: meta.id,
    tipo: meta.tipo,
    mimeType: meta.mimeType,
    extensao: meta.extensao,
    nomeOriginal: meta.nomeOriginal,
    bytes: meta.bytes,
    hash: texto(meta.hash).slice(0, 12),
    status: meta.status,
    associado: Boolean(meta.associado),
    campanhaId: texto(meta.campanhaId),
    criadoEm: meta.criadoEm,
    expiraEm: meta.expiraEm
  };
}

function salvarMidiaTemporaria({ clienteId = "admin", buffer, nomeOriginal = "arquivo", mimeType = "", tipo = "", campanhaId = "", agora = new Date() } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const validada = validarEntrada({ buffer, nomeOriginal, mimeType, tipo });
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const id = `midia_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
  const nomeArquivo = `${id}.${validada.extensao}`;
  const caminho = caminhoSeguro(clienteIdSeguro, nomeArquivo);
  const criadoMs = new Date(agora).getTime();
  const criadoEm = agoraIso(agora);
  const associado = Boolean(texto(campanhaId));
  const meta = {
    id,
    clienteId: clienteIdSeguro,
    tipo: validada.tipo,
    mimeType: validada.mimeType,
    extensao: validada.extensao,
    nomeOriginal: validada.nomeOriginal,
    nomeArquivo,
    bytes: buffer.length,
    hash,
    status: associado ? "associada" : "temporaria",
    associado,
    campanhaId: texto(campanhaId),
    criadoEm,
    expiraEm: associado ? "" : new Date(criadoMs + ttlOrfaMs()).toISOString()
  };

  fs.writeFileSync(caminho, buffer, { flag: "wx" });
  const indice = lerIndice(clienteIdSeguro).filter(item => item.id !== id);
  indice.push(meta);
  salvarIndice(clienteIdSeguro, indice);
  return respostaPublica(meta);
}

function obterMidiaTemporaria(clienteId = "admin", midiaId = "") {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(midiaId);
  if (!id) throw new Error("campanhas_midia_id_obrigatorio");
  const meta = lerIndice(clienteIdSeguro).find(item => item.id === id);
  if (!meta) throw new Error("campanhas_midia_nao_encontrada");
  const caminho = caminhoSeguro(clienteIdSeguro, meta.nomeArquivo);
  if (!fs.existsSync(caminho)) throw new Error("campanhas_midia_arquivo_ausente");
  return { ...meta, caminho, buffer: fs.readFileSync(caminho) };
}

function associarMidiaTemporaria({ clienteId = "admin", midiaId = "", campanhaId = "" } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(midiaId);
  const indice = lerIndice(clienteIdSeguro);
  const pos = indice.findIndex(item => item.id === id);
  if (pos < 0) throw new Error("campanhas_midia_nao_encontrada");
  const atualizada = {
    ...indice[pos],
    associado: true,
    campanhaId: texto(campanhaId),
    status: "associada",
    expiraEm: ""
  };
  indice[pos] = atualizada;
  salvarIndice(clienteIdSeguro, indice);
  return respostaPublica(atualizada);
}

function atualizarMidiaTemporaria({ clienteId = "admin", midiaId = "", alterar } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(midiaId);
  if (!id) throw new Error("campanhas_midia_id_obrigatorio");
  const indice = lerIndice(clienteIdSeguro);
  const pos = indice.findIndex(item => item.id === id);
  if (pos < 0) throw new Error("campanhas_midia_nao_encontrada");
  const atual = indice[pos];
  const proxima = typeof alterar === "function" ? alterar({ ...atual }) : atual;
  indice[pos] = proxima;
  salvarIndice(clienteIdSeguro, indice);
  return respostaPublica(proxima);
}

function marcarMidiaEmUso({ clienteId = "admin", midiaId = "" } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(midiaId);
  return atualizarMidiaTemporaria({
    clienteId: clienteIdSeguro,
    midiaId: id,
    alterar: meta => {
      const status = texto(meta.status).toLowerCase();
      if (status === "processando" || status === "em_uso") {
        throw new Error("campanhas_midia_em_processamento");
      }
      const caminho = caminhoSeguro(clienteIdSeguro, meta.nomeArquivo);
      if (!fs.existsSync(caminho)) throw new Error("campanhas_midia_arquivo_ausente");
      return {
        ...meta,
        associado: true,
        status: "processando",
        expiraEm: "",
        emUsoDesde: agoraIso()
      };
    }
  });
}

function liberarMidiaTemporaria({ clienteId = "admin", midiaId = "", status = "associada" } = {}) {
  return atualizarMidiaTemporaria({
    clienteId,
    midiaId,
    alterar: meta => ({
      ...meta,
      associado: true,
      status: texto(status) || "associada",
      expiraEm: "",
      emUsoDesde: ""
    })
  });
}
function removerArquivoSilencioso(clienteId, meta) {
  try {
    const caminho = caminhoSeguro(clienteId, meta.nomeArquivo);
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
  } catch {}
}

function excluirMidiaTemporaria(clienteId = "admin", midiaId = "", opcoes = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const id = texto(midiaId);
  if (!id) throw new Error("campanhas_midia_id_obrigatorio");
  const indice = lerIndice(clienteIdSeguro);
  const meta = indice.find(item => item.id === id);
  if (!meta) throw new Error("campanhas_midia_nao_encontrada");
  if (!opcoes.forcar && (meta.associado || STATUS_PROTEGIDOS.has(texto(meta.status)))) {
    throw new Error("campanhas_midia_em_uso");
  }
  removerArquivoSilencioso(clienteIdSeguro, meta);
  salvarIndice(clienteIdSeguro, indice.filter(item => item.id !== id));
  return respostaPublica(meta);
}

function limparMidiasOrfas({ clienteId = "admin", agora = new Date() } = {}) {
  const clienteIdSeguro = clienteSeguro(clienteId);
  const agoraMs = new Date(agora).getTime();
  const indice = lerIndice(clienteIdSeguro);
  const mantidas = [];
  const removidas = [];

  for (const meta of indice) {
    const protegida = meta.associado || STATUS_PROTEGIDOS.has(texto(meta.status));
    const expiraMs = meta.expiraEm ? new Date(meta.expiraEm).getTime() : NaN;
    const expirou = Number.isFinite(expiraMs) && Number.isFinite(agoraMs) && expiraMs <= agoraMs;
    if (!protegida && expirou) {
      removerArquivoSilencioso(clienteIdSeguro, meta);
      removidas.push(respostaPublica(meta));
    } else {
      mantidas.push(meta);
    }
  }

  if (removidas.length) salvarIndice(clienteIdSeguro, mantidas);
  return { ok: true, clienteId: clienteIdSeguro, removidas: removidas.length, itens: removidas };
}

function parseContentDisposition(valor = "") {
  const saida = {};
  for (const parte of String(valor || "").split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (!resto.length) continue;
    saida[chave.toLowerCase()] = resto.join("=").trim().replace(/^"|"$/g, "");
  }
  return saida;
}

function extrairBoundary(contentType = "") {
  const match = String(contentType || "").match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  return texto(match?.[1] || match?.[2]);
}

function parseMultipartFormData(buffer = Buffer.alloc(0), contentType = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("campanhas_midia_payload_obrigatorio");
  const boundaryTexto = extrairBoundary(contentType);
  if (!boundaryTexto) throw new Error("campanhas_midia_boundary_ausente");
  const boundary = Buffer.from(`--${boundaryTexto}`);
  const campos = {};
  const arquivos = [];
  let pos = 0;

  while (pos < buffer.length) {
    const inicio = buffer.indexOf(boundary, pos);
    if (inicio < 0) break;
    let parteInicio = inicio + boundary.length;
    if (buffer.slice(parteInicio, parteInicio + 2).toString("ascii") === "--") break;
    if (buffer.slice(parteInicio, parteInicio + 2).toString("ascii") === "\r\n") parteInicio += 2;
    const proximo = buffer.indexOf(boundary, parteInicio);
    if (proximo < 0) break;
    let parte = buffer.slice(parteInicio, proximo);
    if (parte.slice(-2).toString("ascii") === "\r\n") parte = parte.slice(0, -2);
    const sep = parte.indexOf(Buffer.from("\r\n\r\n"));
    if (sep < 0) {
      pos = proximo;
      continue;
    }
    const cabecalhos = parte.slice(0, sep).toString("latin1").split("\r\n");
    const body = parte.slice(sep + 4);
    const headers = {};
    for (const linha of cabecalhos) {
      const idx = linha.indexOf(":");
      if (idx > -1) headers[linha.slice(0, idx).trim().toLowerCase()] = linha.slice(idx + 1).trim();
    }
    const disp = parseContentDisposition(headers["content-disposition"] || "");
    const nome = disp.name;
    if (!nome) {
      pos = proximo;
      continue;
    }
    if (disp.filename != null) {
      arquivos.push({ campo: nome, nomeOriginal: disp.filename, mimeType: headers["content-type"] || "", buffer: body });
    } else {
      campos[nome] = body.toString("utf8");
    }
    pos = proximo;
  }

  return { campos, arquivos };
}

module.exports = {
  ARQUIVO_INDICE,
  TIPOS,
  salvarMidiaTemporaria,
  obterMidiaTemporaria,
  associarMidiaTemporaria,
  marcarMidiaEmUso,
  liberarMidiaTemporaria,
  excluirMidiaTemporaria,
  limparMidiasOrfas,
  parseMultipartFormData,
  respostaPublica
};