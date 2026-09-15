const assert = require("assert");
const sharp = require("sharp");

const { montarItemFilaEngine } = require("../modules/engine/distributor/distributor.service");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");
const { montarPayloadTextoWhatsappPorTipoMidia } = require("../modules/destinos/tipo-midia-v2");

function ofertaComResgateEProduto({ origemFluxo = "optimus" } = {}) {
  const linkOriginal = "https://s.shopee.com.br/original";
  const linkAfiliado = "https://s.shopee.com.br/afiliado";
  const linkResgate = "https://s.shopee.com.br/resgate";
  return {
    id: 700,
    uuid: "imagem-link-700",
    job_id: 701,
    cliente_id: "cliente_imagem_link",
    marketplace: "shopee",
    titulo: "Produto com preview rico",
    preco: 99.9,
    preco_original: 120,
    link_original: linkOriginal,
    link_afiliado: linkAfiliado,
    origemFluxo,
    metadata: {
      integridadeComercial: {
        linksComerciais: [{
          tipo: "resgate",
          papel: "link_resgate",
          urlAfiliada: linkResgate,
          renderizavel: true,
          ordemCaptura: 1
        }],
        linksDescartadosRadar: [{
          tipo: "produto",
          urlOriginal: linkOriginal,
          destinoFuncionalFinal: { url: linkAfiliado }
        }]
      },
      ofcV24: {
        documentoComercialCanonico: {
          linkAfiliado,
          linksComerciais: [{
            tipo: "produto",
            papel: "link_produto",
            urlAfiliada: linkAfiliado,
            renderizavel: true
          }]
        }
      }
    }
  };
}

async function main() {
  const imagemIv = await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 20, g: 40, b: 60 } }
  }).png().toBuffer();
  const prepararMediaHq = async () => ({
    imageMessage: {
      directPath: "/mms/thumbnail-link",
      mediaKey: Buffer.alloc(32, 1),
      fileEncSha256: Buffer.alloc(32, 2),
      fileSha256: Buffer.alloc(32, 3),
      mediaKeyTimestamp: 1,
      width: 800,
      height: 800
    }
  });

  for (const origemFluxo of ["optimus", "clonador_grupos"]) {
    const item = montarItemFilaEngine(ofertaComResgateEProduto({ origemFluxo }));
    const mensagem = montarMensagemOferta(item, {
      clienteId: item.clienteId,
      destino: { tipoMidia: "imagem_link" },
      canal: "whatsapp"
    });
    const payload = await montarPayloadTextoWhatsappPorTipoMidia({
      mensagem,
      destino: { tipoMidia: "imagem_link" },
      linkFinal: item.linkAfiliado,
      oferta: { ...item, imagem: "memory://identidade-visual" },
      baixarImagem: async () => imagemIv,
      prepareWAMessageMedia: prepararMediaHq,
      upload: async () => {}
    });

    assert.ok(mensagem.includes(item.linkAfiliado), `${origemFluxo}: link final deve existir no texto`);
    assert.ok(payload.linkPreview, `${origemFluxo}: imagem_link deve montar preview rico`);
    assert.strictEqual(payload.linkPreview["matched-text"], item.linkAfiliado);
    assert.ok(Buffer.isBuffer(payload.linkPreview.jpegThumbnail));
    assert.strictEqual(payload.linkPreview.highQualityThumbnail.width, 800);
    assert.strictEqual(payload.linkPreview.highQualityThumbnail.height, 800);
  }

  const fallback = await montarPayloadTextoWhatsappPorTipoMidia({
    mensagem: "Oferta sem imagem\nhttps://s.shopee.com.br/afiliado",
    destino: { tipoMidia: "imagem_link" },
    linkFinal: "https://s.shopee.com.br/afiliado",
    oferta: { titulo: "Oferta", marketplace: "shopee", preco: 99.9, imagem: "" }
  });
  assert.deepStrictEqual(fallback, {
    text: "Oferta sem imagem\nhttps://s.shopee.com.br/afiliado",
    linkPreview: null
  }, "sem imagem válida deve preservar envio textual controlado");

  console.log("imagem-link-contrato-universal.test.js OK");
}

main().catch(erro => {
  console.error(erro);
  process.exit(1);
});
