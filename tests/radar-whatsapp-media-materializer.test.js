const assert = require("assert");

const {
  materializarImagemRadarWhatsApp,
  aplicarMidiaMaterializadaRadarMirror,
  encontrarImageMessage
} = require("../modules/radar/whatsapp-media-materializer");

function pngMinimo() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfab6d0000000049454e44ae426082",
    "hex"
  );
}

function criarLogger() {
  const entradas = [];
  return {
    entradas,
    log(tag, payload) {
      entradas.push({ tag, payload });
    }
  };
}

function criarStorage() {
  const chamadas = [];
  return {
    chamadas,
    detectarMime(buffer) {
      assert(Buffer.isBuffer(buffer));
      return "image/png";
    },
    salvar(entrada) {
      chamadas.push(entrada);
      assert(Buffer.isBuffer(entrada.buffer));
      assert.strictEqual(entrada.mimeType, "image/png");
      return {
        ok: true,
        url: "https://cdn.optimus.test/engine/radar_whatsapp_msg_1.png",
        mimeType: "image/png",
        bytes: entrada.buffer.length
      };
    }
  };
}

(async () => {
  {
    const mensagem = {
      key: { id: "msg_1", remoteJid: "120@g.us" },
      message: {
        imageMessage: {
          url: "https://mmg.whatsapp.net/o1/v/t24/f2/m239/img?oh=assinatura",
          mediaKey: Buffer.from("media-key"),
          mimetype: "image/jpeg",
          fileLength: 12345
        }
      }
    };
    const storage = criarStorage();
    const logger = criarLogger();
    let downloads = 0;

    const resultado = await materializarImagemRadarWhatsApp({
      mensagem,
      sock: { updateMediaMessage: async msg => msg },
      sessaoId: "sessao_1",
      remoteJid: "120@g.us",
      grupoNome: "Radar Teste",
      clienteId: "engine",
      storage,
      logger,
      downloadMediaMessageImpl: async (msg, tipo, opcoes, contexto) => {
        downloads += 1;
        assert.strictEqual(msg, mensagem);
        assert.strictEqual(tipo, "buffer");
        assert.strictEqual(typeof contexto.reuploadRequest, "function");
        return pngMinimo();
      }
    });

    assert.strictEqual(downloads, 1);
    assert.strictEqual(storage.chamadas.length, 1);
    assert.strictEqual(resultado.ok, true);
    assert.strictEqual(resultado.midia.imagemMaterializada, "https://cdn.optimus.test/engine/radar_whatsapp_msg_1.png");
    assert.strictEqual(resultado.midia.imagemDuravel, "https://cdn.optimus.test/engine/radar_whatsapp_msg_1.png");
    assert.strictEqual(resultado.midia.imagemEnviavel, "https://cdn.optimus.test/engine/radar_whatsapp_msg_1.png");
    assert.strictEqual(resultado.midia.imagemStatus, "radar_mirror_baileys_materializada");
    assert(logger.entradas.some(item => item.payload.etapa === "detectada"));
    assert(logger.entradas.some(item => item.payload.etapa === "tentativa"));
    assert(logger.entradas.some(item => item.payload.etapa === "sucesso" && item.payload.imagemEnviavel === true));
  }

  {
    const radarMirror = {
      preco: { atualCapturado: 64.9 },
      cupom: { codigoCapturado: "PROMO10" },
      midia: {
        imagemOrigem: "mensagem",
        imagemOriginal: "https://mmg.whatsapp.net/o1/v/t24/f2/m239/img?oh=assinatura"
      }
    };
    const atualizado = aplicarMidiaMaterializadaRadarMirror(radarMirror, {
      ok: true,
      midia: {
        imagemMaterializada: "https://cdn.optimus.test/engine/radar.png",
        imagemDuravel: "https://cdn.optimus.test/engine/radar.png",
        imagemEnviavel: "https://cdn.optimus.test/engine/radar.png",
        imagemStatus: "radar_mirror_baileys_materializada"
      }
    });

    assert.strictEqual(atualizado.preco.atualCapturado, 64.9);
    assert.strictEqual(atualizado.cupom.codigoCapturado, "PROMO10");
    assert.strictEqual(atualizado.midia.imagemOriginal, radarMirror.midia.imagemOriginal);
    assert.strictEqual(atualizado.midia.imagemMaterializada, "https://cdn.optimus.test/engine/radar.png");
    assert.strictEqual(atualizado.midia.imagemEnviavel, "https://cdn.optimus.test/engine/radar.png");
  }

  {
    const logger = criarLogger();
    let downloads = 0;
    const resultado = await materializarImagemRadarWhatsApp({
      mensagem: {
        key: { id: "msg_sem_imagem" },
        message: { conversation: "texto" }
      },
      sock: { updateMediaMessage: async msg => msg },
      logger,
      downloadMediaMessageImpl: async () => {
        downloads += 1;
        return pngMinimo();
      }
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.detectada, false);
    assert.strictEqual(resultado.motivo, "sem_image_message");
    assert.strictEqual(downloads, 0);
    assert.strictEqual(logger.entradas.length, 0);
  }

  {
    const logger = criarLogger();
    const resultado = await materializarImagemRadarWhatsApp({
      mensagem: {
        key: { id: "msg_falha" },
        message: { imageMessage: { url: "https://mmg.whatsapp.net/o1/v/t24/f2/m239/img" } }
      },
      sock: { updateMediaMessage: async msg => msg },
      logger,
      downloadMediaMessageImpl: async () => {
        throw new Error("download_indisponivel_teste");
      }
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(resultado.detectada, true);
    assert.strictEqual(resultado.motivo, "download_indisponivel_teste");
    assert(logger.entradas.some(item => item.payload.etapa === "falha" && item.payload.motivo === "download_indisponivel_teste"));
  }

  {
    const encontrada = encontrarImageMessage({
      ephemeralMessage: {
        message: {
          imageMessage: {
            url: "https://mmg.whatsapp.net/o1/v/t24/f2/m239/img"
          }
        }
      }
    });
    assert(encontrada);
    assert.strictEqual(encontrada.url, "https://mmg.whatsapp.net/o1/v/t24/f2/m239/img");
  }

  console.log("radar-whatsapp-media-materializer.test.js OK");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
