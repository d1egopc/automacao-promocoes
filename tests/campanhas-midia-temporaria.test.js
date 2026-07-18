const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-campanhas-midia-"));
process.env.DATA_DIR = dataDir;
process.env.CAMPANHAS_MEDIA_ORFA_TTL_MS = "1000";

const {
  salvarMidiaTemporaria,
  obterMidiaTemporaria,
  associarMidiaTemporaria,
  excluirMidiaTemporaria,
  limparMidiasOrfas,
  parseMultipartFormData
} = require("../campanhas/midiaTemporaria");

function png() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
}

function mp4() {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42", "ascii"), Buffer.alloc(64, 2)]);
}

function pdf() {
  return Buffer.concat([Buffer.from("%PDF-1.4\n", "ascii"), Buffer.alloc(64, 3)]);
}

function multipart({ boundary = "x-boundary", fields = {}, file }) {
  const partes = [];
  for (const [nome, valor] of Object.entries(fields)) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`, "utf8"));
  }
  partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="${file.nome}"\r\nContent-Type: ${file.mime}\r\n\r\n`, "utf8"));
  partes.push(file.buffer);
  partes.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  return { body: Buffer.concat(partes), contentType: `multipart/form-data; boundary=${boundary}` };
}

(() => {
  const imagem = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "arte.png", mimeType: "image/png", tipo: "imagem" });
  assert.strictEqual(imagem.tipo, "imagem");
  assert.strictEqual(imagem.mimeType, "image/png");
  assert.strictEqual(imagem.associado, false);
  assert.ok(imagem.midiaId);
  const imagemInterna = obterMidiaTemporaria("cliente_a", imagem.midiaId);
  assert.ok(Buffer.isBuffer(imagemInterna.buffer));
  assert.ok(imagemInterna.caminho.endsWith(".png"));
  assert.throws(() => obterMidiaTemporaria("cliente_b", imagem.midiaId), /campanhas_midia_nao_encontrada/);

  const video = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: mp4(), nomeOriginal: "video.mp4", mimeType: "video/mp4", tipo: "video" });
  assert.strictEqual(video.tipo, "video");
  assert.strictEqual(video.mimeType, "video/mp4");

  const doc = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: pdf(), nomeOriginal: "regulamento.pdf", mimeType: "application/pdf", tipo: "documento" });
  assert.strictEqual(doc.tipo, "documento");
  assert.strictEqual(doc.mimeType, "application/pdf");

  assert.throws(
    () => salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: Buffer.from("<html></html>"), nomeOriginal: "x.html", mimeType: "text/html", tipo: "documento" }),
    /campanhas_midia_mime_invalido|campanhas_midia_extensao_invalida/
  );

  process.env.CAMPANHAS_MEDIA_MAX_IMAGE_BYTES = "4";
  assert.throws(
    () => salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "grande.png", mimeType: "image/png", tipo: "imagem" }),
    /campanhas_midia_tamanho_excedido/
  );
  delete process.env.CAMPANHAS_MEDIA_MAX_IMAGE_BYTES;

  const removivel = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "remover.png", mimeType: "image/png", tipo: "imagem" });
  const removido = excluirMidiaTemporaria("cliente_a", removivel.midiaId);
  assert.strictEqual(removido.midiaId, removivel.midiaId);
  assert.throws(() => obterMidiaTemporaria("cliente_a", removivel.midiaId), /campanhas_midia_nao_encontrada/);

  const protegida = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "uso.png", mimeType: "image/png", tipo: "imagem" });
  associarMidiaTemporaria({ clienteId: "cliente_a", midiaId: protegida.midiaId, campanhaId: "campanha_1" });
  assert.throws(() => excluirMidiaTemporaria("cliente_a", protegida.midiaId), /campanhas_midia_em_uso/);
  excluirMidiaTemporaria("cliente_a", protegida.midiaId, { forcar: true });

  const antiga = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "antiga.png", mimeType: "image/png", tipo: "imagem", agora: new Date("2026-01-01T00:00:00.000Z") });
  const recente = salvarMidiaTemporaria({ clienteId: "cliente_a", buffer: png(), nomeOriginal: "recente.png", mimeType: "image/png", tipo: "imagem", agora: new Date("2026-01-01T00:00:02.000Z") });
  const limpeza = limparMidiasOrfas({ clienteId: "cliente_a", agora: new Date("2026-01-01T00:00:01.500Z") });
  assert.strictEqual(limpeza.removidas, 1);
  assert.throws(() => obterMidiaTemporaria("cliente_a", antiga.midiaId), /campanhas_midia_nao_encontrada/);
  assert.strictEqual(obterMidiaTemporaria("cliente_a", recente.midiaId).id, recente.midiaId);

  const mp = multipart({ fields: { tipo: "imagem" }, file: { nome: "upload.png", mime: "image/png", buffer: png() } });
  const parsed = parseMultipartFormData(mp.body, mp.contentType);
  assert.strictEqual(parsed.campos.tipo, "imagem");
  assert.strictEqual(parsed.arquivos.length, 1);
  assert.strictEqual(parsed.arquivos[0].nomeOriginal, "upload.png");
  assert.strictEqual(parsed.arquivos[0].mimeType, "image/png");

  console.log("campanhas-midia-temporaria.test.js OK");
})();