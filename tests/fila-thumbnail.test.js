"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const thumbnailService = require("../modules/fila/fila-thumbnail.service");
const filaOperacionalV2 = require("../modules/fila/fila-operacional-v2");
const autoCleanService = require("../modules/engine/auto-clean/auto-clean.service");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "optimus-fila-thumb-"));
}

function depsFila(root, extras = {}) {
  return {
    getClientePath: clienteId => path.join(root, "clientes", clienteId),
    getClienteJsonPath: (clienteId, arquivo) => path.join(root, "clientes", clienteId, arquivo),
    readClienteJson(clienteId, arquivo, fallback) {
      const file = path.join(root, "clientes", clienteId, arquivo);
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
    writeClienteJson(clienteId, arquivo, valor) {
      const dir = path.join(root, "clientes", clienteId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, arquivo), JSON.stringify(valor), "utf8");
      return true;
    },
    logger: { log() {} },
    ...extras
  };
}

async function jpegFonte(largura = 800, altura = 400, semente = 17) {
  const pixels = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const indice = (y * largura + x) * 3;
      pixels[indice] = (x * 7 + y * 3 + semente) % 256;
      pixels[indice + 1] = (x * 2 + y * 11 + semente * 2) % 256;
      pixels[indice + 2] = (x * 13 + y * 5 + semente * 3) % 256;
    }
  }
  return sharp(pixels, { raw: { width: largura, height: altura, channels: 3 } })
    .jpeg({ quality: 88 })
    .toBuffer();
}

function respostaImagem(buffer, url = "https://cdn.oficial.test/produto.jpg", contentType = "image/jpeg") {
  return {
    ok: true,
    status: 200,
    url,
    headers: {
      get(nome) {
        if (String(nome).toLowerCase() === "content-type") return contentType;
        if (String(nome).toLowerCase() === "content-length") return String(buffer.length);
        return null;
      }
    },
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  };
}

function itemTerminal(id, imagemRef, extra = {}) {
  return {
    id,
    ofertaId: id,
    engineOfertaId: id,
    clienteId: extra.clienteId || "cliente_thumb",
    marketplace: extra.marketplace || "amazon",
    titulo: `Produto ${id}`,
    preco: "99.90",
    status: "enviado",
    criadoEm: extra.criadoEm || "2026-09-20T10:00:00.000Z",
    enviadoEm: extra.enviadoEm || "2026-09-20T10:05:00.000Z",
    updatedAt: extra.updatedAt || "2026-09-20T10:05:00.000Z",
    imagem: imagemRef,
    imagemEnviavel: true,
    imagemOrigem: "jsonld.image",
    ...extra
  };
}

function ultimoRegistroLeve(root, clienteId) {
  const dir = path.join(root, "clientes", clienteId, filaOperacionalV2.HISTORICO_LEVE_INCREMENTAL_DIR);
  const registros = [];
  for (const nome of fs.readdirSync(dir).filter(item => item.endsWith(".jsonl")).sort()) {
    for (const linha of fs.readFileSync(path.join(dir, nome), "utf8").split(/\r?\n/)) {
      if (linha.trim()) registros.push(JSON.parse(linha));
    }
  }
  return registros[registros.length - 1];
}

async function main() {
  const root = tmpRoot();
  const storageDir = path.join(root, "fila-thumbnails");
  const publicBaseUrl = "https://go.optimus.test/fila/thumbnails/public/";
  const fonte = await jpegFonte();
  const fonteOriginal = Buffer.from(fonte);
  let downloads = 0;
  const depsThumb = {
    storageDir,
    dataDir: root,
    publicBaseUrl,
    fetchImpl: async url => {
      downloads += 1;
      return respostaImagem(fonte, url);
    },
    logger: { log() {} }
  };
  const entrada = {
    clienteId: "cliente_thumb",
    marketplace: "amazon",
    identidade: "oferta_1",
    imagemRef: "https://cdn.oficial.test/produto.jpg",
    item: itemTerminal("oferta_1", "https://cdn.oficial.test/produto.jpg")
  };

  const rejeitadaRadar = await thumbnailService.gerarThumbnail({
    ...entrada,
    identidade: "oferta_radar",
    item: itemTerminal("oferta_radar", entrada.imagemRef, { imagemOrigem: "radar_mirror/mensagem" })
  }, depsThumb);
  assert.strictEqual(rejeitadaRadar.ok, false);
  assert.strictEqual(rejeitadaRadar.motivo, "imagem_fonte_nao_oficial");
  assert.strictEqual(downloads, 0, "midia Radar/grupo nao pode sequer ser baixada para thumbnail publica");

  const primeira = await thumbnailService.gerarThumbnail(entrada, depsThumb);
  assert.strictEqual(primeira.ok, true);
  assert.strictEqual(primeira.gerada, true);
  assert.strictEqual(primeira.width, 240);
  assert.strictEqual(primeira.height, 120, "proporcao 2:1 deve ser preservada");
  assert(primeira.bytes > 0 && primeira.bytes < fonte.length + 5_000, "thumbnail deve ser pequena e nao vazia");
  assert.strictEqual(Buffer.compare(fonte, fonteOriginal), 0, "imagem fonte nao pode ser alterada");
  assert.strictEqual((await sharp(primeira.file).metadata()).format, "webp");

  const segunda = await thumbnailService.gerarThumbnail(entrada, depsThumb);
  assert.strictEqual(segunda.reutilizada, true);
  assert.strictEqual(segunda.thumbRef, primeira.thumbRef);
  assert.strictEqual(downloads, 1, "mesmo input deve reutilizar indice sem baixar novamente");

  let downloadsConcorrentes = 0;
  let liberarDownload;
  const bloqueio = new Promise(resolve => { liberarDownload = resolve; });
  const concorrente = {
    ...entrada,
    identidade: "oferta_concorrente",
    imagemRef: "https://cdn.oficial.test/concorrente.jpg",
    item: itemTerminal("oferta_concorrente", "https://cdn.oficial.test/concorrente.jpg")
  };
  const depsConcorrentes = {
    ...depsThumb,
    fetchImpl: async url => {
      downloadsConcorrentes += 1;
      await bloqueio;
      return respostaImagem(fonte, url);
    }
  };
  const promessaA = thumbnailService.gerarThumbnail(concorrente, depsConcorrentes);
  const promessaB = thumbnailService.gerarThumbnail(concorrente, depsConcorrentes);
  liberarDownload();
  const [resultadoA, resultadoB] = await Promise.all([promessaA, promessaB]);
  assert.strictEqual(downloadsConcorrentes, 1, "concorrencia no mesmo processo deve executar uma unica geracao");
  assert.strictEqual(resultadoA.thumbRef, resultadoB.thumbRef);

  const alterada = await thumbnailService.gerarThumbnail({
    ...entrada,
    imagemRef: "https://cdn.oficial.test/produto-novo.jpg",
    item: itemTerminal("oferta_1", "https://cdn.oficial.test/produto-novo.jpg")
  }, {
    ...depsThumb,
    fetchImpl: async url => respostaImagem(await jpegFonte(800, 400, 31), url)
  });
  assert.strictEqual(alterada.ok, true);
  assert.notStrictEqual(alterada.thumbRef, primeira.thumbRef, "mudanca da fonte deve gerar nova thumbnail");

  const mesmaUrlNovoHash = await thumbnailService.gerarThumbnail({
    ...entrada,
    item: itemTerminal("oferta_1", entrada.imagemRef, { imagemHash: "b".repeat(64) })
  }, {
    ...depsThumb,
    fetchImpl: async url => respostaImagem(await jpegFonte(800, 400, 47), url)
  });
  assert.strictEqual(mesmaUrlNovoHash.ok, true);
  assert.notStrictEqual(mesmaUrlNovoHash.thumbRef, primeira.thumbRef, "hash declarado novo na mesma URL deve gerar nova thumbnail");

  const rootIntegracao = tmpRoot();
  const cliente = "cliente_integracao_thumb";
  const item = itemTerminal("terminal_1", "https://cdn.oficial.test/terminal.jpg", { clienteId: cliente });
  let liberarFetchIntegracao;
  const esperaFetchIntegracao = new Promise(resolve => { liberarFetchIntegracao = resolve; });
  const depsIntegracao = depsFila(rootIntegracao, {
    thumbnailDeps: {
      storageDir: path.join(rootIntegracao, "fila-thumbnails"),
      dataDir: rootIntegracao,
      publicBaseUrl,
      logger: { log() {} },
      fetchImpl: async url => {
        await esperaFetchIntegracao;
        return respostaImagem(fonte, url);
      }
    }
  });
  const terminal = filaOperacionalV2.registrarHistoricoLeveTerminalLegado(cliente, item, depsIntegracao);
  assert.strictEqual(terminal.ok, true, "terminalizacao deve concluir antes da thumbnail");
  assert.strictEqual(terminal.thumbnailsAgendadas, 1);
  assert.strictEqual(filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, depsIntegracao).itens[0].thumbRef, "");
  liberarFetchIntegracao();
  await thumbnailService.aguardarPendencias();
  const [comThumb] = filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, depsIntegracao).itens;
  assert(comThumb.thumbRef.startsWith(publicBaseUrl));
  assert.strictEqual(comThumb.imagemRef, item.imagem, "imagem original do snapshot permanece intacta");
  assert.strictEqual(comThumb.statusPublico, "enviado");
  const chaveSnapshot = ultimoRegistroLeve(rootIntegracao, cliente).chave;
  const idempotenteSnapshot = filaOperacionalV2.persistirThumbRefHistoricoLeve(cliente, {
    chave: chaveSnapshot,
    imagemRefEsperada: item.imagem,
    thumbRef: comThumb.thumbRef
  }, depsIntegracao);
  assert.strictEqual(idempotenteSnapshot.ok, true);
  assert.strictEqual(idempotenteSnapshot.idempotente, true, "mesma thumb nao deve criar nova versao do snapshot");

  const itemNovo = itemTerminal("terminal_1", "https://cdn.oficial.test/terminal-novo.jpg", {
    clienteId: cliente,
    enviadoEm: "2026-09-20T10:10:00.000Z",
    updatedAt: "2026-09-20T10:10:00.000Z"
  });
  filaOperacionalV2.registrarHistoricoLeveTerminalLegado(cliente, itemNovo, {
    ...depsIntegracao,
    gerarThumbnailHistorico: false
  });
  const stale = filaOperacionalV2.persistirThumbRefHistoricoLeve(cliente, {
    chave: chaveSnapshot,
    imagemRefEsperada: item.imagem,
    thumbRef: primeira.thumbRef
  }, depsIntegracao);
  assert.strictEqual(stale.motivo, "thumbnail_snapshot_fonte_alterada", "geracao atrasada nao deve sobrescrever fonte mais nova");
  assert.strictEqual(filaOperacionalV2.listarHistoricoLeveIncremental(cliente, {}, depsIntegracao).itens[0].imagemRef, itemNovo.imagem);

  for (const [sufixo, thumbnailDeps] of [
    ["download", { ...depsThumb, fetchImpl: async () => { throw new Error("rede_indisponivel"); } }],
    ["sharp", {
      ...depsThumb,
      fetchImpl: async url => respostaImagem(fonte, url),
      sharpImpl() {
        return {
          rotate() { return this; },
          resize() { return this; },
          webp() { return this; },
          async toBuffer() { throw new Error("sharp_indisponivel"); }
        };
      }
    }],
    ["storage", {
      ...depsThumb,
      storageDir: path.join(root, "storage-falha"),
      fetchImpl: async url => respostaImagem(fonte, url),
      fs: {
        ...fs,
        writeFileSync() { throw new Error("storage_indisponivel"); }
      }
    }]
  ]) {
    const clienteFalha = `cliente_falha_${sufixo}`;
    const res = filaOperacionalV2.registrarHistoricoLeveTerminalLegado(
      clienteFalha,
      itemTerminal(`falha_${sufixo}`, `https://cdn.oficial.test/${sufixo}.jpg`, { clienteId: clienteFalha }),
      depsFila(rootIntegracao, { thumbnailDeps })
    );
    assert.strictEqual(res.ok, true, `${sufixo}: falha de thumbnail nao bloqueia terminalizacao`);
  }
  await thumbnailService.aguardarPendencias();
  for (const sufixo of ["download", "sharp", "storage"]) {
    const clienteFalha = `cliente_falha_${sufixo}`;
    const [snapshotFalha] = filaOperacionalV2.listarHistoricoLeveIncremental(
      clienteFalha,
      {},
      depsFila(rootIntegracao, { gerarThumbnailHistorico: false })
    ).itens;
    assert(snapshotFalha, `${sufixo}: snapshot terminal deve permanecer disponivel`);
    assert.strictEqual(snapshotFalha.thumbRef, "", `${sufixo}: falha nao pode inventar thumbRef`);
  }

  const config = thumbnailService.configuracaoStorage(depsThumb);
  const dirLimpeza = path.join(config.raiz, "cliente_limpeza", "amazon");
  fs.mkdirSync(dirLimpeza, { recursive: true });
  const referenciada = path.join(dirLimpeza, "referenciada.webp");
  const orfa = path.join(dirLimpeza, "orfa.webp");
  const indiceOrfao = path.join(dirLimpeza, "orfa.json");
  fs.writeFileSync(referenciada, Buffer.from("ref"));
  fs.writeFileSync(orfa, Buffer.from("orfa"));
  fs.writeFileSync(indiceOrfao, JSON.stringify({ thumbRef: "https://go.optimus.test/fila/thumbnails/public/orfa.webp" }));
  const antigo = new Date(Date.now() - 10_000);
  fs.utimesSync(referenciada, antigo, antigo);
  fs.utimesSync(orfa, antigo, antigo);
  fs.utimesSync(indiceOrfao, antigo, antigo);
  const refUrl = new URL("cliente_limpeza/amazon/referenciada.webp", publicBaseUrl).toString();
  autoCleanService.executarArquivosAutoClean({
    dataDir: root,
    fs,
    agoraMs: Date.now()
  });
  assert.strictEqual(fs.existsSync(referenciada), true, "auto-clean generico nao deve remover thumbnails gerenciadas");
  assert.strictEqual(fs.existsSync(orfa), true, "limpeza generica nao substitui retencao referencial");
  const limpeza = autoCleanService.executarFilaThumbnailsAutoClean({
    ...depsThumb,
    agora: Date.now(),
    thumbnailRetentionMs: 1_000,
    referenciasAtivas: new Set([refUrl])
  });
  assert.strictEqual(limpeza.ok, true);
  assert.strictEqual(fs.existsSync(referenciada), true, "thumbnail referenciada deve ser preservada");
  assert.strictEqual(fs.existsSync(orfa), false, "thumbnail orfa expirada deve ser removida");
  assert.strictEqual(fs.existsSync(indiceOrfao), false, "indice orfao expirado deve ser removido");

  const orfaCiclo = path.join(dirLimpeza, "orfa-ciclo.webp");
  fs.writeFileSync(orfaCiclo, Buffer.from("orfa-ciclo"));
  fs.utimesSync(orfaCiclo, antigo, antigo);
  const ciclo = await autoCleanService.executarAutoCleanExecute({
    dataDir: root,
    storageDir,
    publicBaseUrl,
    thumbnailRetentionMs: 1_000,
    referenciasAtivas: new Set([refUrl]),
    incluirPostgres: false,
    incluirArquivos: true,
    fs,
    agora: Date.now(),
    agoraMs: Date.now()
  });
  assert(ciclo.etapas.some(etapa => etapa.origem === "fila_thumbnails"), "auto-clean deve incluir etapa dedicada de thumbnails");
  assert.strictEqual(fs.existsSync(orfaCiclo), false, "ciclo auto-clean existente deve executar a retencao dedicada");

  const readModelSource = fs.readFileSync(path.join(__dirname, "..", "modules", "fila", "fila-read-model-publico.js"), "utf8");
  assert(!/fila-thumbnail\.service|\bsharp\b/.test(readModelSource), "GET /fila nao pode gerar thumbnail");
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert(indexSource.includes('app.use("/fila/thumbnails/public", express.static(config.raiz'), "rota publica deve servir somente a raiz dedicada");
  assert(indexSource.includes('dotfiles: "deny"'));
  assert(indexSource.includes('immutable: true'));

  console.log(JSON.stringify({
    ok: true,
    thumbnailBytes: primeira.bytes,
    thumbnailWidth: primeira.width,
    thumbnailHeight: primeira.height,
    generationMs: primeira.duracaoMs,
    reusedMs: segunda.duracaoMs,
    concurrentDownloads: downloadsConcorrentes,
    cleanupRemoved: limpeza.removidas
  }));
}

main().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});
