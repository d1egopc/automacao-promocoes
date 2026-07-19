const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const socialMediaStorage = require("../modules/social/social-media-storage");

function jpeg() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);
}

function png() {
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]);
}

function webp() {
  return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);
}

function mp4() {
  const buffer = Buffer.alloc(32);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return buffer;
}

function mov() {
  const buffer = Buffer.alloc(32);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("qt  ", 8, "ascii");
  return buffer;
}

function webm() {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
}

function restaurarEnv(nome, valor) {
  if (valor === undefined) delete process.env[nome];
  else process.env[nome] = valor;
}

function contentTypePorExt(nome = "") {
  if (nome.endsWith(".jpg")) return "image/jpeg";
  if (nome.endsWith(".png")) return "image/png";
  if (nome.endsWith(".webp")) return "image/webp";
  if (nome.endsWith(".mp4")) return "video/mp4";
  if (nome.endsWith(".mov")) return "video/quicktime";
  if (nome.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

function criarServidor({ storageDir }) {
  return http.createServer((req, res) => {
    const prefixo = "/social/midia/publica/";
    if (!req.url.startsWith(prefixo)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const relativo = decodeURIComponent(req.url.slice(prefixo.length));
    const destino = path.resolve(storageDir, relativo);
    const raiz = path.resolve(storageDir);
    if (!destino.startsWith(raiz + path.sep) || !fs.existsSync(destino)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": contentTypePorExt(destino),
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin"
    });
    res.end(fs.readFileSync(destino));
  });
}

function request(server, { method = "GET", path: urlPath, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      path: urlPath,
      method,
      headers
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
}

(async () => {
  const envStorageDir = process.env.SOCIAL_MEDIA_STORAGE_DIR;
  const envStorageBase = process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL;
  const envStorageMax = process.env.SOCIAL_MEDIA_MAX_BYTES;
  const envStorageVideoMax = process.env.SOCIAL_MEDIA_VIDEO_MAX_BYTES;
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-upload-"));
  let server;

  try {
    process.env.SOCIAL_MEDIA_STORAGE_DIR = storageDir;
    process.env.SOCIAL_MEDIA_PUBLIC_BASE_URL = "https://cdn-media.optimus.test/social/midia/publica/";
    process.env.SOCIAL_MEDIA_MAX_BYTES = String(32);
    process.env.SOCIAL_MEDIA_VIDEO_MAX_BYTES = String(1024);

    const casos = [
      { nome: "foto.jpg", buffer: jpeg(), mimeType: "image/jpeg", tipo: "imagem", ext: ".jpg" },
      { nome: "arte.png", buffer: png(), mimeType: "image/png", tipo: "imagem", ext: ".png" },
      { nome: "banner.webp", buffer: webp(), mimeType: "image/webp", tipo: "imagem", ext: ".webp" },
      { nome: "reels.mp4", buffer: mp4(), mimeType: "video/mp4", tipo: "video", ext: ".mp4" },
      { nome: "reels.mov", buffer: mov(), mimeType: "video/quicktime", tipo: "video", ext: ".mov" },
      { nome: "reels.webm", buffer: webm(), mimeType: "video/webm", tipo: "video", ext: ".webm" }
    ];

    for (const caso of casos) {
      const salvo = socialMediaStorage.salvar({
        clienteId: "cliente_a",
        buffer: caso.buffer,
        mimeType: caso.mimeType,
        nomeLogico: caso.nome
      });
      assert.strictEqual(salvo.mimeType, caso.mimeType);
      assert.strictEqual(salvo.tipo, caso.tipo);
      assert.ok(new URL(salvo.url).pathname.endsWith(caso.ext));
    }

    assert.throws(
      () => socialMediaStorage.salvar({ clienteId: "cliente_a", buffer: Buffer.from("html sem mime"), mimeType: "text/html" }),
      /social_media_tipo_invalido/
    );

    assert.throws(
      () => socialMediaStorage.salvar({ clienteId: "cliente_a", buffer: Buffer.alloc(0), mimeType: "image/png" }),
      /social_media_arquivo_obrigatorio/
    );

    assert.throws(
      () => socialMediaStorage.salvar({ clienteId: "cliente_a", buffer: Buffer.concat([png(), Buffer.alloc(32)]), mimeType: "image/png" }),
      /social_media_arquivo_muito_grande/
    );

    const videoSalvo = socialMediaStorage.salvar({
      clienteId: "cliente_a",
      buffer: mp4(),
      mimeType: "video/mp4",
      nomeLogico: "video_limite_separado"
    });
    assert.strictEqual(videoSalvo.tipo, "video");

    server = criarServidor({ storageDir });
    await listen(server);

    const publico = await request(server, { path: new URL(videoSalvo.url).pathname });
    assert.strictEqual(publico.status, 200);
    assert.ok(String(publico.headers["content-type"]).startsWith("video/mp4"));

    console.log("social-media-upload.test.js OK");
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    restaurarEnv("SOCIAL_MEDIA_STORAGE_DIR", envStorageDir);
    restaurarEnv("SOCIAL_MEDIA_PUBLIC_BASE_URL", envStorageBase);
    restaurarEnv("SOCIAL_MEDIA_MAX_BYTES", envStorageMax);
    restaurarEnv("SOCIAL_MEDIA_VIDEO_MAX_BYTES", envStorageVideoMax);
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
