"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-identidade-visual-"));

const { writeGlobalJson } = require("../utils/storage");
const identidadeVisual = require("../modules/identidade-visual-ofertas");

writeGlobalJson("usuarios.json", [
  { id: "workspace_engine", ativo: true, plano: "pro" },
  { id: "workspace_manual", ativo: true, plano: "pro" }
]);

function requestJson(app, metodo, caminho, body = null) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const payload = body ? JSON.stringify(body) : "";
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: metodo,
        path: caminho,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload)
        }
      }, (res) => {
        let dados = "";
        res.on("data", chunk => { dados += chunk; });
        res.on("end", () => {
          server.close(() => {
            try {
              resolve({
                status: res.statusCode,
                body: dados ? JSON.parse(dados) : {}
              });
            } catch (erro) {
              reject(erro);
            }
          });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function criarRepoMemoria(configInicial = {}) {
  const store = { ...configInicial };
  return {
    lerConfig: (clienteId) => ({ ...(store[clienteId] || {}) }),
    salvarConfig: (clienteId, config) => {
      store[clienteId] = { ...config };
      return { ...store[clienteId] };
    },
    atualizarConfig: (clienteId, patch) => {
      store[clienteId] = { ...(store[clienteId] || {}), ...patch };
      return { ...store[clienteId] };
    },
    store
  };
}

async function main() {
  try {
    assert.strictEqual(
      identidadeVisual.normalizarPoliticaIdentidadeVisual(undefined),
      "desabilitada",
      "recurso legado ausente deve nascer desabilitado"
    );
    assert.strictEqual(
      identidadeVisual.normalizarPoliticaIdentidadeVisual(true),
      "desabilitada",
      "identidade visual nao pode passar pelo pipeline booleano"
    );

    assert.deepStrictEqual(
      identidadeVisual.resolverPermissoesPoliticaIdentidadeVisual("obrigatoria"),
      {
        politica: "obrigatoria",
        habilitada: true,
        obrigatoria: true,
        editavel: false,
        podeDesligar: false
      }
    );
    assert.deepStrictEqual(
      identidadeVisual.resolverPermissoesPoliticaIdentidadeVisual("obrigatoria_editavel"),
      {
        politica: "obrigatoria_editavel",
        habilitada: true,
        obrigatoria: true,
        editavel: true,
        podeDesligar: false
      }
    );
    assert.deepStrictEqual(
      identidadeVisual.resolverPermissoesPoliticaIdentidadeVisual("opcional_editavel"),
      {
        politica: "opcional_editavel",
        habilitada: true,
        obrigatoria: false,
        editavel: true,
        podeDesligar: true
      }
    );
    assert.deepStrictEqual(
      identidadeVisual.resolverPermissoesPoliticaIdentidadeVisual("desabilitada"),
      {
        politica: "desabilitada",
        habilitada: false,
        obrigatoria: false,
        editavel: false,
        podeDesligar: false
      }
    );

    const logoClienteSalvo = `cliente:${"a".repeat(64)}`;
    const repo = criarRepoMemoria({
      workspace_custom: {
        ativo: false,
        logo: logoClienteSalvo,
        frase: "Minha curadoria",
        corIdentidade: "vermelho"
      }
    });
    const service = identidadeVisual.criarServicoIdentidadeVisualOfertas({
      repository: repo,
      baixarImagemBuffer: async () => {
        throw new Error("download_indisponivel");
      }
    });

    const obrigatoriaFixa = service.resolverConfig("workspace_custom", {
      plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } }
    });
    assert.strictEqual(obrigatoriaFixa.configEfetiva.ativo, true, "politica obrigatoria deve aplicar identidade ativa");
    assert.strictEqual(obrigatoriaFixa.configEfetiva.logo, "optimus_oficial", "politica obrigatoria deve forcar logo oficial");
    assert.strictEqual(obrigatoriaFixa.configEfetiva.frase, "AS MELHORES OFERTAS, EM UM SÓ LUGAR", "politica obrigatoria deve forcar frase oficial");
    assert.strictEqual(obrigatoriaFixa.configEfetiva.corIdentidade, "azul", "politica obrigatoria deve forcar cor oficial");
    assert.strictEqual(repo.store.workspace_custom.logo, logoClienteSalvo, "politica obrigatoria nao deve apagar logo salva");
    assert.strictEqual(repo.store.workspace_custom.frase, "Minha curadoria", "politica obrigatoria nao deve apagar frase salva");
    assert.strictEqual(repo.store.workspace_custom.corIdentidade, "vermelho", "politica obrigatoria nao deve apagar cor salva");

    const obrigatoria = service.resolverConfig("workspace_custom", {
      plano: { recursos: { identidade_visual_ofertas: "obrigatoria_editavel" } }
    });
    assert.strictEqual(obrigatoria.configEfetiva.ativo, true, "politica obrigatoria liga a identidade mesmo com config off");
    assert.strictEqual(obrigatoria.configEfetiva.logo, logoClienteSalvo, "obrigatoria_editavel deve restaurar logo salva");
    assert.strictEqual(obrigatoria.configEfetiva.frase, "Minha curadoria", "customizacao deve sobreviver a troca de politica");
    assert.strictEqual(obrigatoria.configEfetiva.corIdentidade, "vermelho", "obrigatoria_editavel deve restaurar cor salva");

    const opcional = service.resolverConfig("workspace_custom", {
      plano: { recursos: { identidade_visual_ofertas: "opcional_editavel" } }
    });
    assert.strictEqual(opcional.configEfetiva.ativo, false, "opcional_editavel respeita ativo do workspace");

    const estadoAntesPreview = JSON.stringify(repo.store);
    const previewObrigatorio = await service.gerarPreview("workspace_custom", {
      frase: "Tentativa de troca",
      corIdentidade: "verde",
      ativo: false
    }, {
      plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } }
    });
    assert.strictEqual(previewObrigatorio.aplicada, true, "preview obrigatorio deve renderizar identidade");
    assert.strictEqual(previewObrigatorio.configEfetiva.logo, "optimus_oficial", "preview obrigatorio deve forcar logo oficial");
    assert.strictEqual(previewObrigatorio.configEfetiva.frase, "AS MELHORES OFERTAS, EM UM SÓ LUGAR", "preview obrigatorio deve forcar frase oficial");
    assert.strictEqual(previewObrigatorio.configEfetiva.ativo, true, "preview obrigatorio nao pode ser desligado");
    assert.strictEqual(previewObrigatorio.preview.rendererVersion, "identidade-visual-ofertas-v2.4");
    assert.ok(/^data:image\/png;base64,/.test(previewObrigatorio.preview.dataUrl), "preview deve devolver PNG base64");
    assert.strictEqual(previewObrigatorio.preview.persistida, false, "preview nao deve persistir arte");
    assert.strictEqual(JSON.stringify(repo.store), estadoAntesPreview, "preview nao deve alterar config do workspace");

    const previewOpcionalOff = await service.gerarPreview("workspace_custom", {
      ativo: false,
      frase: "Minha curadoria",
      corIdentidade: "vermelho"
    }, {
      plano: { recursos: { identidade_visual_ofertas: "opcional_editavel" } }
    });
    assert.strictEqual(previewOpcionalOff.aplicada, false, "opcional desligada deve respeitar estado atual");
    assert.strictEqual(previewOpcionalOff.motivo, "config_inativa");
    assert.ok(/^data:image\/png;base64,/.test(previewOpcionalOff.preview.dataUrl), "preview desligado deve devolver estado visual claro");

    const previewDeps = identidadeVisual.criarServicoIdentidadeVisualOfertas({
      repository: criarRepoMemoria(),
      adicionarOfertaNaFilaGlobal: () => {
        throw new Error("preview_nao_deve_criar_fila");
      },
      debitarCreditos: () => {
        throw new Error("preview_nao_deve_consumir_credito");
      }
    });
    await previewDeps.gerarPreview("workspace_preview_deps", {}, {
      plano: { recursos: { identidade_visual_ofertas: "obrigatoria_editavel" } }
    });

    assert.throws(
      () => service.atualizarConfig("workspace_custom", { ativo: false }, {
        plano: { recursos: { identidade_visual_ofertas: "obrigatoria_editavel" } }
      }),
      /identidade_visual_ofertas_nao_pode_desligar/,
      "plano obrigatorio nao pode ser desligado por adulteracao de payload"
    );
    assert.throws(
      () => service.atualizarConfig("workspace_custom", { frase: "Nova" }, {
        plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } }
      }),
      /identidade_visual_ofertas_edicao_bloqueada/,
      "plano obrigatorio nao editavel nao pode customizar visual"
    );

    const passthrough = await service.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_custom",
      oferta: { origem: "radar", imagem: "https://img.example/oferta.jpg" },
      imagemAtual: "https://img.example/oferta.jpg",
      contexto: { origem: "radar" }
    }, {
      plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } }
    });
    assert.strictEqual(passthrough.aplicada, false);
    assert.strictEqual(passthrough.motivo, "render_fallback");
    assert.strictEqual(passthrough.imagemFinal, "https://img.example/oferta.jpg", "falha de render deve preservar imagem original");

    const semImagem = await service.aplicarIdentidadeVisualOferta({
      clienteId: "workspace_custom",
      oferta: {},
      imagemAtual: "",
      contexto: { origem: "clonador_grupos" }
    }, {
      plano: { recursos: { identidade_visual_ofertas: "obrigatoria" } }
    });
    assert.strictEqual(semImagem.motivo, "imagem_ausente", "imagem inutilizavel nao deve forcar identidade visual");

    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use("/identidade-visual-ofertas", identidadeVisual.criarRotasIdentidadeVisualOfertas({
      getClienteId: () => "workspace_rota",
      getPlanoUsuario: () => ({ recursos: { identidade_visual_ofertas: "opcional_editavel" } }),
      service: identidadeVisual.criarServicoIdentidadeVisualOfertas({ repository: criarRepoMemoria() })
    }));

    const getConfig = await requestJson(app, "GET", "/identidade-visual-ofertas/config");
    assert.strictEqual(getConfig.status, 200);
    assert.strictEqual(getConfig.body.ok, true);
    assert.strictEqual(getConfig.body.politica, "opcional_editavel");
    assert.strictEqual(getConfig.body.podeDesligar, true);

    const patchConfig = await requestJson(app, "PATCH", "/identidade-visual-ofertas/config", {
      ativo: false,
      frase: "Ofertas selecionadas",
      corIdentidade: "verde"
    });
    assert.strictEqual(patchConfig.status, 200);
    assert.strictEqual(patchConfig.body.config.ativo, false);
    assert.strictEqual(patchConfig.body.config.corIdentidade, "verde");
    assert.strictEqual(patchConfig.body.configEfetiva.ativo, false);

    const previewRota = await requestJson(app, "POST", "/identidade-visual-ofertas/preview", {
      ativo: true,
      frase: "Preview real pelo backend",
      corIdentidade: "rosa"
    });
    assert.strictEqual(previewRota.status, 200);
    assert.strictEqual(previewRota.body.ok, true);
    assert.strictEqual(previewRota.body.aplicada, true);
    assert.strictEqual(previewRota.body.preview.rendererVersion, "identidade-visual-ofertas-v2.4");
    assert.ok(/^data:image\/png;base64,/.test(previewRota.body.preview.dataUrl), "rota preview deve usar renderer real");

    const fonteModulo = fs.readFileSync(path.join(__dirname, "..", "modules", "identidade-visual-ofertas", "service.js"), "utf8");
    assert.ok(!/origem\s*===\s*["']radar["']/.test(fonteModulo), "servico nao pode ter renderer/regra especifica de Radar");
    assert.ok(!/origem\s*===\s*["']clonador_grupos["']/.test(fonteModulo), "servico nao pode ter renderer/regra especifica de Clonador");
    assert.ok(!/Template Universal|montarMensagemOferta/.test(fonteModulo), "foundation nao deve tocar Template Universal");
    assert.ok(
      fonteModulo.includes("renderizarIdentidadeVisualBuffer") && fonteModulo.includes("gerarPreview"),
      "preview deve usar o mesmo renderer oficial"
    );

    const { adicionarOfertaNaFilaCliente } = require("../modules/engine/distributor/distributor.service");
    const chamadasEngine = [];
    const enfileirados = [];
    const fila = await adicionarOfertaNaFilaCliente({
      id: "oferta_engine_identidade",
      uuid: "uuid_engine_identidade",
      job_id: 1,
      cliente_id: "workspace_engine",
      marketplace: "amazon",
      titulo: "Oferta Engine",
      preco: 99,
      link_afiliado: "https://amazon.com.br/dp/ABC?tag=workspace",
      imagem: "https://img.example/engine.jpg",
      categoria: "Diversos",
      metadata: { origem: "inteligencia_universal" }
    }, {
      deps: {
        aplicarIdentidadeVisualOferta: async (entrada) => {
          chamadasEngine.push(entrada);
          return {
            aplicada: false,
            motivo: "renderer_nao_implementado",
            politica: "obrigatoria",
            imagemOriginal: entrada.imagemAtual,
            imagemFinal: entrada.imagemAtual
          };
        },
        adicionarOfertaNaFilaGlobal: (clienteId, itemFila) => {
          enfileirados.push({ clienteId, itemFila });
          return { ok: true, itemFila };
        }
      }
    });
    assert.strictEqual(fila.ok, true);
    assert.strictEqual(chamadasEngine.length, 1, "Engine deve chamar o servico universal uma vez por oferta/workspace");
    assert.strictEqual(chamadasEngine[0].contexto.fluxo, "engine_distributor");
    assert.strictEqual(enfileirados[0].itemFila.imagem, "https://img.example/engine.jpg", "hook Engine nao altera imagem na foundation");

    const { enviarOfertaManualV2 } = require("../modules/manual-v2/manual-dispatcher");
    const chamadasManual = [];
    const retornoManual = await enviarOfertaManualV2({
      clienteId: "workspace_manual",
      ofertaId: "oferta_manual_identidade",
      destinosIds: ["destino_manual"]
    }, {
      buscarOfertaManualV2: () => ({
        id: "oferta_manual_identidade",
        clienteId: "workspace_manual",
        titulo: "Oferta Manual",
        precoAtual: "88,00",
        urlAfiliada: "https://example.com/manual",
        imagem: "https://img.example/manual.jpg"
      }),
      resolverPlanoManualV2: () => ({ recursos: { whatsapp: true, identidade_visual_ofertas: "obrigatoria" } }),
      destinosPorCliente: {
        workspace_manual: [{
          id: "destino_manual",
          nome: "Destino Manual",
          tipo: "whatsapp",
          ativo: true,
          conexaoId: "sessao_manual",
          gruposWhatsapp: ["120363manual@g.us"]
        }]
      },
      sessoes: {
        sessao_manual: { id: "sock_manual" }
      },
      statusSessao: {
        sessao_manual: "open"
      },
      aplicarIdentidadeVisualOferta: async (entrada) => {
        chamadasManual.push(entrada);
        return {
          aplicada: false,
          motivo: "renderer_nao_implementado",
          politica: "obrigatoria",
          imagemOriginal: entrada.imagemAtual,
          imagemFinal: entrada.imagemAtual
        };
      },
      usuarioTemCreditos: () => true,
      debitarCreditos: () => true,
      enviarWhatsApp: async () => ({ ok: true })
    });
    assert.strictEqual(retornoManual.ok, true);
    assert.strictEqual(chamadasManual.length, 1, "Manual V2 deve chamar o mesmo servico uma vez antes dos destinos");
    assert.strictEqual(chamadasManual[0].contexto.fluxo, "manual_v2");
    assert.strictEqual(chamadasManual[0].imagemAtual, "https://img.example/manual.jpg");

    const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert.ok(indexFonte.includes("normalizarPoliticaIdentidadeVisual("), "Admin/planos deve salvar enum por normalizador proprio");
    assert.ok(indexFonte.includes('app.use("/identidade-visual-ofertas"'), "rota autenticada de config deve estar montada");

    const saasFonte = fs.readFileSync(path.join(__dirname, "..", "utils", "saas-fundacao.js"), "utf8");
    assert.ok(saasFonte.includes('id === "identidade_visual_ofertas"'), "sanitizacao publica deve tratar enum de forma explicita");

    console.log("identidade-visual-ofertas-foundation.test.js OK");
  } finally {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((erro) => {
  console.error(erro);
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
