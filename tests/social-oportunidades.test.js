const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-social-oportunidades-"));
process.env.DATA_DIR = dataDir;
process.env.INSTAGRAM_APP_ID = "app_optimus";
process.env.INSTAGRAM_APP_SECRET = "secret_optimus";
process.env.INSTAGRAM_REDIRECT_URI = "https://api.optimus.test/social/instagram/callback";
process.env.INSTAGRAM_OAUTH_STATE_SECRET = "state_secret_optimus";
const POLLING_TESTE = { primeiraEsperaMs: 0, intervaloMs: 0, maxTentativas: 3 };

const storage = require("../modules/social/storage");
const instagram = require("../modules/social/instagram");
const { readClienteJson, writeClienteJson } = require("../utils/storage");

function filaBase(item = {}) {
  return {
    marketplace: "amazon",
    titulo: "Echo Dot 5",
    precoAtual: 199.9,
    precoOriginal: 299.9,
    cupom: "PROMO10",
    score: 91,
    prioridade: 100,
    categoria: "eletronicos",
    origem: "engine",
    imagem: "https://cdn.optimus.test/echo.jpg",
    linkAfiliado: "https://go.optimus.test/cliente-a/echo",
    linkOriginal: "https://amazon.test/echo",
    ofertaUniversal: true,
    versaoOfertaUniversal: "v2-oficial",
    criadoEm: "2026-07-11T10:00:00.000Z",
    ...item
  };
}

function mockHttpClient() {
  return {
    async post(url) {
      if (url.endsWith("/subscribed_apps")) return { data: { success: true } };
      if (url.endsWith("/media")) return { data: { id: "container_oportunidade" } };
      if (url.endsWith("/media_publish")) return { data: { id: "media_oportunidade" } };
      return { data: { access_token: "short_token", token_type: "bearer" } };
    },
    async get(url) {
      if (url.includes("graph.instagram.com/container_oportunidade")) {
        return { data: { status_code: "FINISHED", status: "FINISHED" } };
      }
      if (url.endsWith("/access_token")) {
        return { data: { access_token: "long_token", token_type: "bearer", expires_in: 5184000 } };
      }
      if (url.endsWith("/subscribed_apps")) {
        return { data: { data: [{ subscribed_fields: ["comments", "messages"] }] } };
      }
      return {
        data: {
          user_id: "ig_cliente_a",
          username: "optimus_cliente_a",
          account_type: "BUSINESS",
          profile_picture_url: "https://cdn.optimus.test/avatar.jpg"
        }
      };
    }
  };
}

(async () => {
  writeClienteJson("cliente_a", "fila.json", [
    filaBase({
      id: "social_engine_visual_123",
      engineOfertaId: "oferta_engine_oficial_123"
    }),
    filaBase({
      id: "engine_sem_link_visual",
      ofertaId: "oferta_sem_link",
      linkAfiliado: "",
      linkFinal: "",
      linkOriginal: "https://amazon.test/sem-link"
    })
  ]);
  writeClienteJson("cliente_b", "fila.json", [
    filaBase({
      id: "social_engine_visual_123",
      engineOfertaId: "oferta_cliente_b",
      linkAfiliado: "https://go.optimus.test/cliente-b/echo"
    })
  ]);

  const filaAntes = JSON.stringify(readClienteJson("cliente_a", "fila.json", []));
  const oportunidadesA = storage.listarOportunidadesSocial("cliente_a", 10);
  const oportunidadesB = storage.listarOportunidadesSocial("cliente_b", 10);
  const comLink = oportunidadesA.find(item => item.ofertaId === "oferta_engine_oficial_123");
  const semLink = oportunidadesA.find(item => item.ofertaId === "oferta_sem_link");

  assert.ok(comLink, "oportunidade com link deve preservar ofertaId oficial");
  assert.strictEqual(comLink.id, "social_social_engine_visual_123");
  assert.strictEqual(comLink.ofertaId, "oferta_engine_oficial_123");
  assert.strictEqual(comLink.linkAfiliadoPresente, true);
  assert.strictEqual(comLink.publicavel, true);
  assert.strictEqual(comLink.preco, 199.9);
  assert.strictEqual(comLink.origem, "engine");
  assert.strictEqual(typeof comLink.idadeEmMinutos, "number");
  assert.strictEqual(comLink.recenciaConfiavel, true);
  assert.strictEqual(typeof comLink.antigaParaAutomatico, "boolean");
  assert.ok(!JSON.stringify(oportunidadesA).includes("https://go.optimus.test"), "oportunidades nao devem expor link afiliado");

  assert.ok(semLink, "oportunidade sem link deve continuar visivel");
  assert.strictEqual(semLink.linkAfiliadoPresente, false);
  assert.strictEqual(semLink.publicavel, false);
  assert.strictEqual(semLink.motivoIndisponivel, "sem_link_afiliado");

  assert.ok(!oportunidadesA.some(item => item.ofertaId === "oferta_cliente_b"), "cliente A nao recebe oferta do cliente B");
  assert.ok(oportunidadesB.some(item => item.ofertaId === "oferta_cliente_b"), "cliente B mantem propria oportunidade");
  assert.strictEqual(JSON.stringify(readClienteJson("cliente_a", "fila.json", [])), filaAntes, "listar oportunidades nao altera fila historica");

  const agoraRecencia = Date.now();
  const isoRecente = new Date(agoraRecencia - 10 * 60 * 1000).toISOString();
  const isoRecente2 = new Date(agoraRecencia - 20 * 60 * 1000).toISOString();
  const timestampRecente = agoraRecencia - 30 * 60 * 1000;
  const isoAntiga = new Date(agoraRecencia - 10 * 60 * 60 * 1000).toISOString();
  writeClienteJson("cliente_recencia_datas", "fila.json", [
    filaBase({
      ofertaId: "ptbr_com_iso",
      produtoId: "produto_ptbr_com_iso",
      criadoEm: "15/07/2026, 20:01:02",
      dataEntradaFila: isoRecente
    }),
    filaBase({
      ofertaId: "vazio_segundo_iso",
      produtoId: "produto_vazio_segundo_iso",
      criadoEm: "",
      dataEntradaFila: "",
      emFilaEm: isoRecente2
    }),
    filaBase({
      ofertaId: "timestamp_numerico",
      produtoId: "produto_timestamp_numerico",
      criadoEm: "",
      dataEntradaFila: timestampRecente
    }),
    filaBase({
      ofertaId: "datas_invalidas",
      produtoId: "produto_datas_invalidas",
      criadoEm: "32/15/2026, 99:99:99",
      dataEntradaFila: "sem-data",
      emFilaEm: "tambem-invalida"
    }),
    filaBase({
      ofertaId: "antiga_real",
      produtoId: "produto_antiga_real",
      criadoEm: "15/07/2026, 20:01:02",
      dataEntradaFila: isoAntiga
    })
  ]);
  storage.setConfigAutomaticoSocial("cliente_recencia_datas", { idadeMaximaHoras: 6 });
  const oportunidadesRecencia = storage.listarOportunidadesSocial("cliente_recencia_datas", 10);
  const porIdRecencia = Object.fromEntries(oportunidadesRecencia.map(item => [item.ofertaId, item]));
  assert.strictEqual(porIdRecencia.ptbr_com_iso.criadoEm, isoRecente, "dataEntradaFila ISO deve vencer criadoEm pt-BR");
  assert.strictEqual(porIdRecencia.ptbr_com_iso.recenciaConfiavel, true);
  assert.strictEqual(porIdRecencia.vazio_segundo_iso.criadoEm, isoRecente2, "campo vazio deve cair para o segundo valido");
  assert.strictEqual(porIdRecencia.vazio_segundo_iso.recenciaConfiavel, true);
  assert.strictEqual(porIdRecencia.timestamp_numerico.criadoEm, String(timestampRecente), "timestamp numerico valido deve ser aceito");
  assert.strictEqual(porIdRecencia.timestamp_numerico.recenciaConfiavel, true);
  assert.strictEqual(porIdRecencia.datas_invalidas.recenciaConfiavel, false, "datas invalidas seguem sem recencia confiavel");
  assert.strictEqual(porIdRecencia.datas_invalidas.motivoForaAutomatico, "sem_data_confiavel");
  assert.strictEqual(porIdRecencia.antiga_real.recenciaConfiavel, true);
  assert.strictEqual(porIdRecencia.antiga_real.antigaParaAutomatico, true, "oferta antiga real continua fora do automatico");
  assert.strictEqual(porIdRecencia.antiga_real.motivoForaAutomatico, "idade_acima_limite");

  writeClienteJson("cliente_validacao", "fila.json", [
    filaBase({ ofertaId: "manual_antiga", criadoEm: "2026-07-01T10:00:00.000Z" }),
    filaBase({ ofertaId: "manual_retida", status: "retida" }),
    filaBase({ ofertaId: "manual_expirada", validadeCupom: "2026-07-01T10:00:00.000Z" }),
    filaBase({ ofertaId: "manual_sem_imagem", imagem: "" }),
    filaBase({ ofertaId: "manual_sem_link", linkAfiliado: "" }),
    filaBase({ ofertaId: "manual_publicada" }),
    filaBase({ ofertaId: "manual_agendada" }),
    filaBase({ ofertaId: "manual_inativa", ativo: false })
  ]);
  writeClienteJson("cliente_validacao", "social-publicacoes.json", [{
    id: "pub_manual_publicada",
    rede: "instagram",
    status: "publicada",
    ofertaId: "manual_publicada"
  }]);
  storage.salvarAgendamentoSocial("cliente_validacao", {
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "manual_agendada",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-20T10:00:00.000Z"
  });
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_antiga").ok, true, "manual aceita oferta antiga valida");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_retida").motivo, "oferta_status_invalido");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_expirada").motivo, "oferta_cupom_expirado");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_sem_imagem").motivo, "imagem_ausente");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_sem_link").motivo, "oferta_link_ausente");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_publicada").motivo, "oferta_ja_publicada");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_agendada").motivo, "oferta_ja_agendada");
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_agendada", { ignorarAgendamentoId: storage.listarAgendamentosSocial("cliente_validacao")[0].id }).ok, true);
  assert.strictEqual(storage.validarOportunidadeSocialManual("cliente_validacao", "manual_inativa").motivo, "oferta_bloqueada_inativa");

  const agoraTeste = Date.now();
  const recenteTeste = new Date(agoraTeste - 60 * 60 * 1000).toISOString();
  const antigaTeste = new Date(agoraTeste - 10 * 60 * 60 * 1000).toISOString();
  writeClienteJson("cliente_limpeza", "fila.json", [
    filaBase({ ofertaId: "nova_limpeza", produtoId: "produto_nova_limpeza", linkOriginal: "https://amazon.test/nova-limpeza", criadoEm: recenteTeste }),
    filaBase({ ofertaId: "velha_limpeza", produtoId: "produto_velha_limpeza", linkOriginal: "https://amazon.test/velha-limpeza", criadoEm: antigaTeste }),
    filaBase({ ofertaId: "velha_publicada", produtoId: "produto_velha_publicada", linkOriginal: "https://amazon.test/velha-publicada", criadoEm: antigaTeste }),
    filaBase({ ofertaId: "velha_agendada", produtoId: "produto_velha_agendada", linkOriginal: "https://amazon.test/velha-agendada", criadoEm: antigaTeste })
  ]);
  storage.setConfigAutomaticoSocial("cliente_limpeza", { idadeMaximaHoras: 6 });
  writeClienteJson("cliente_limpeza", "social-publicacoes.json", [{
    id: "pub_velha_publicada",
    rede: "instagram",
    status: "publicada",
    ofertaId: "velha_publicada"
  }]);
  storage.salvarAgendamentoSocial("cliente_limpeza", {
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "velha_agendada",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-20T10:00:00.000Z"
  });
  const filaLimpezaAntes = JSON.stringify(readClienteJson("cliente_limpeza", "fila.json", []));
  const antigas = storage.limparOportunidadesSocial("cliente_limpeza", { modo: "antigas", idadeMaximaHoras: 6 });
  assert.strictEqual(antigas.ocultadas, 3, "limpeza antiga oculta todas as velhas, inclusive publicadas/agendadas");
  const aposAntigas = storage.listarOportunidadesSocial("cliente_limpeza", 10);
  assert.ok(aposAntigas.some(item => item.ofertaId === "nova_limpeza"));
  assert.ok(!aposAntigas.some(item => item.ofertaId === "velha_limpeza"));
  assert.ok(!aposAntigas.some(item => item.ofertaId === "velha_publicada"));
  assert.ok(!aposAntigas.some(item => item.ofertaId === "velha_agendada"));
  assert.strictEqual(JSON.stringify(readClienteJson("cliente_limpeza", "fila.json", [])), filaLimpezaAntes, "limpeza nao altera fila oficial");

  writeClienteJson("cliente_limpeza_galeria", "fila.json", [
    filaBase({ ofertaId: "galeria_nova", produtoId: "produto_galeria_nova", linkOriginal: "https://amazon.test/galeria-nova", criadoEm: recenteTeste }),
    filaBase({ ofertaId: "galeria_publicada", produtoId: "produto_galeria_publicada", linkOriginal: "https://amazon.test/galeria-publicada", criadoEm: recenteTeste }),
    filaBase({ ofertaId: "galeria_agendada", produtoId: "produto_galeria_agendada", linkOriginal: "https://amazon.test/galeria-agendada", criadoEm: recenteTeste })
  ]);
  writeClienteJson("cliente_limpeza_galeria", "social-publicacoes.json", [{
    id: "pub_galeria_publicada",
    rede: "instagram",
    status: "publicada",
    ofertaId: "galeria_publicada"
  }]);
  storage.salvarAgendamentoSocial("cliente_limpeza_galeria", {
    origem: "manual",
    tipoPublicacao: "oferta",
    ofertaId: "galeria_agendada",
    status: "agendada",
    ativo: true,
    agendadoPara: "2026-07-20T10:00:00.000Z"
  });
  const filaGaleriaAntes = JSON.stringify(readClienteJson("cliente_limpeza_galeria", "fila.json", []));
  const historicoGaleriaAntes = JSON.stringify(readClienteJson("cliente_limpeza_galeria", "social-publicacoes.json", []));
  const agendaGaleriaAntes = storage.listarAgendamentosSocial("cliente_limpeza_galeria");
  const antesGaleria = storage.listarOportunidadesSocial("cliente_limpeza_galeria", 10);
  assert.ok(antesGaleria.some(item => item.ofertaId === "galeria_publicada"), "oferta publicada esta visivel antes da limpeza");
  assert.ok(antesGaleria.some(item => item.ofertaId === "galeria_agendada"), "oferta agendada esta visivel antes da limpeza");
  const galeria = storage.limparOportunidadesSocial("cliente_limpeza_galeria", { modo: "galeria", idadeMaximaHoras: 6 });
  assert.strictEqual(galeria.ocultadas, 3, "limpeza de galeria oculta todas as oportunidades visiveis");
  assert.strictEqual(storage.listarOportunidadesSocial("cliente_limpeza_galeria", 10).length, 0, "limpeza de galeria remove publicadas/agendadas da galeria");
  assert.strictEqual(JSON.stringify(readClienteJson("cliente_limpeza_galeria", "fila.json", [])), filaGaleriaAntes, "limpeza de galeria nao altera fila oficial");
  assert.strictEqual(JSON.stringify(readClienteJson("cliente_limpeza_galeria", "social-publicacoes.json", [])), historicoGaleriaAntes, "limpeza de galeria preserva historico");
  const agendaGaleriaDepois = storage.listarAgendamentosSocial("cliente_limpeza_galeria");
  assert.strictEqual(agendaGaleriaDepois.length, agendaGaleriaAntes.length, "limpeza de galeria preserva quantidade de agendamentos");
  assert.ok(
    agendaGaleriaDepois.some(item => item.ofertaId === "galeria_agendada" && item.status === "agendada" && item.ativo === true),
    "limpeza de galeria preserva agendamento ativo"
  );

  await instagram.concluirCallbackInstagram({
    code: "code_cliente_a",
    state: instagram.iniciarConexaoInstagram({ clienteId: "cliente_a" }).state,
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI,
    httpClient: mockHttpClient()
  });
  const publicada = await instagram.publicarImagemInstagram({
    clienteId: "cliente_a",
    ofertaId: comLink.ofertaId,
    templateId: "padrao-instagram",
    httpClient: mockHttpClient(),
    polling: POLLING_TESTE
  });
  assert.strictEqual(publicada.publicacao.status, "publicada");
  assert.strictEqual(publicada.publicacao.ofertaId, "oferta_engine_oficial_123");

  console.log("social-oportunidades: ok");
})().catch(erro => {
  console.error(erro);
  process.exit(1);
});
