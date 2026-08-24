const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-copy-v2-fase1-"));

const copy = require("../modules/copy-inteligente");
const { montarMensagemOferta } = require("../utils/mensagens-ofertas");

function plano(recursos = {}) {
  return { recursos: { tituloIa: true, templatePersonalizado: true, ...recursos } };
}

function ofertaBase(extra = {}) {
  return {
    id: "oferta_copy_v2",
    engineOfertaId: "engine_copy_v2",
    clienteId: "cliente_copy_v2",
    marketplace: "amazon",
    titulo: "Produto Oficial para Teste V2",
    nome: "Produto Oficial para Teste V2",
    categoria: "Casa",
    precoAtual: 100,
    cupom: "",
    linkAfiliado: "https://go.example/produto-v2",
    ...extra
  };
}

function contexto(extraOferta = {}, extraResultado = {}, extraOpcoes = {}) {
  const oferta = ofertaBase(extraOferta);
  const resultadoV1 = copy.resolverIntencaoCopy(oferta);
  return copy.criarContextoCopyV2(oferta, { ...resultadoV1, ...extraResultado }, {
    clienteId: "cliente_copy_v2",
    ...extraOpcoes
  });
}

(async () => {
  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparInflightCopyV2();
  copy.limparCircuitBreakersCopyV2();

  const contextoSanitizado = contexto({
    telefone: "5511999999999",
    jid: "grupo@g.us",
    token: "segredo",
    cookie: "cookie-secreto",
    html: "<html>privado</html>",
    titulo: "Produto seguro token=abc https://privado.example/path"
  });
  const contextoJson = JSON.stringify(contextoSanitizado).toLowerCase();
  assert.strictEqual(contextoSanitizado.versaoContexto, "copy-v2-context-v1", "contexto V2 tem versao oficial");
  assert.ok(contextoSanitizado.workspaceHash, "contexto tem workspaceHash");
  assert.ok(contextoSanitizado.ofertaKeyHash, "contexto tem ofertaKeyHash");
  assert.ok(!contextoJson.includes("5511999999999"), "contexto nao inclui telefone");
  assert.ok(!contextoJson.includes("grupo@g.us"), "contexto nao inclui JID");
  assert.ok(!contextoJson.includes("segredo"), "contexto nao inclui token/segredo");
  assert.ok(!contextoJson.includes("cookie-secreto"), "contexto nao inclui cookie");
  assert.ok(!contextoJson.includes("<html>"), "contexto nao inclui HTML");
  assert.ok(!contextoJson.includes("https://privado.example"), "contexto nao inclui URL bruta");

  const ctxCupom = contexto({ cupom: "PROMO10" });
  assert.deepStrictEqual(
    Object.keys(ctxCupom.fatosPermitidos).sort(),
    ["beneficioSeguro", "cupom", "descontoOficial", "freteGratis", "parcelamento", "resgate", "sazonal"].sort(),
    "contexto expõe apenas fatos permitidos esperados"
  );

  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Achado seguro para aproveitar", contexto: contexto() }).valida, true, "validador aceita frase segura");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Essa vale conferir", contexto: contexto() }).valida, true, "validador aceita frase generica segura");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Olha essa 👀", contexto: contexto() }).valida, true, "validador aceita frase segura com um emoji");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Seu setup merece atencao", contexto: contexto() }).valida, true, "validador aceita frase segura de categoria");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Essa frase foi criada de forma propositalmente enorme para ultrapassar o limite seguro de sessenta e quatro caracteres", contexto: contexto() }).motivoCodigo, "texto_longo", "validador rejeita >64 chars");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Linha um\nLinha dois", contexto: contexto() }).motivoCodigo, "multiplas_linhas", "validador rejeita multiplas linhas");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Veja em https://example.com", contexto: contexto() }).motivoCodigo, "url_detectada", "validador rejeita URL");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Use o cupom PROMO10", contexto: contexto({ cupom: "PROMO10" }) }).motivoCodigo, "codigo_cupom_detectado", "validador rejeita codigo de cupom");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Tem cupom nessa oferta", contexto: contexto() }).motivoCodigo, "cupom_sem_permissao", "validador rejeita cupom inventado");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Frete gratis nessa oferta", contexto: contexto() }).motivoCodigo, "frete_gratis_sem_permissao", "validador rejeita frete gratis inventado");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Cashback nessa oferta especial", contexto: contexto({ beneficioExtra: "brinde" }) }).motivoCodigo, "cashback_sem_permissao", "validador rejeita cashback");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Ultimas unidades para aproveitar", contexto: contexto() }).motivoCodigo, "estoque_inventado", "validador rejeita ultimas unidades");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Menor preco para aproveitar", contexto: contexto({ descontoPercentual: 10 }) }).motivoCodigo, "comparativo_preco_sem_prova", "validador rejeita menor preco");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Melhor preco para aproveitar", contexto: contexto({ descontoPercentual: 10 }) }).motivoCodigo, "comparativo_preco_sem_prova", "validador rejeita melhor preco");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Corre para aproveitar agora", contexto: contexto() }).motivoCodigo, "urgencia_falsa", "validador rejeita urgencia falsa");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "OFERTA IMPERDIVEL PARA APROVEITAR", contexto: contexto() }).motivoCodigo, "caixa_alta_exagerada", "validador rejeita caixa alta");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Achado bom para aproveitar!!!", contexto: contexto() }).motivoCodigo, "pontuacao_exagerada", "validador rejeita pontuacao excessiva");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Achado bom 😊🔥", contexto: contexto() }).motivoCodigo, "multiplos_emojis", "validador rejeita multiplos emojis");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "Oferta exclusiva!", contexto: contexto() }).motivoCodigo, "exclusividade_sem_permissao", "validador rejeita exclusividade");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "entrega gratis", contexto: contexto() }).motivoCodigo, "frete_gratis_sem_permissao", "validador rejeita entrega gratis");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "frete 0", contexto: contexto() }).motivoCodigo, "frete_gratis_sem_permissao", "validador rejeita frete 0");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "preco imbativel", contexto: contexto() }).motivoCodigo, "comparativo_preco_sem_prova", "validador rejeita preco imbativel");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "mais barato", contexto: contexto() }).motivoCodigo, "comparativo_preco_sem_prova", "validador rejeita mais barato");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "ultima chance", contexto: contexto() }).motivoCodigo, "urgencia_falsa", "validador rejeita ultima chance");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "garanta ja", contexto: contexto() }).motivoCodigo, "urgencia_falsa", "validador rejeita garanta ja");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "corra para ver", contexto: contexto() }).motivoCodigo, "urgencia_falsa", "validador rejeita corra");
  assert.strictEqual(copy.validarCopyV2({ textoGerado: "estoque acabando", contexto: contexto() }).motivoCodigo, "estoque_inventado", "validador rejeita estoque acabando");

  const fake = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const providerOk = await copy.gerarCopy(contexto(), { provider: fake, timeoutMs: 50 });
  assert.strictEqual(providerOk.ok, true, "FakeProvider funciona");
  assert.strictEqual(fake.chamadas, 1, "FakeProvider registra chamada");

  const providerTimeout = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar", atrasoMs: 30 });
  let signalRecebido = null;
  const timeout = await copy.gerarCopy(contexto(), {
    provider: {
      gerar: (_contexto, opcoes) => {
        signalRecebido = opcoes.signal;
        return providerTimeout.gerar(_contexto, opcoes);
      }
    },
    timeoutMs: 5
  });
  assert.strictEqual(timeout.ok, false, "timeout retorna ok false");
  assert.strictEqual(timeout.motivo, "timeout", "timeout usa motivo estrutural");
  assert.ok(signalRecebido, "provider recebe AbortSignal preparado");

  const breaker = copy.criarCircuitBreakerCopyV2({ falhasParaAbrir: 2, cooldownMs: 10 });
  breaker.registrarFalha({ nowMs: 100 });
  breaker.registrarFalha({ nowMs: 100 });
  assert.strictEqual(breaker.estado(), "open", "circuit breaker abre");
  assert.strictEqual(breaker.podeTentar({ nowMs: 105 }), false, "circuit breaker bloqueia durante cooldown");
  assert.strictEqual(breaker.podeTentar({ nowMs: 111 }), true, "circuit breaker recupera para half_open");
  assert.strictEqual(breaker.estado(), "half_open", "circuit breaker entra em half_open");
  breaker.registrarSucesso();
  assert.strictEqual(breaker.estado(), "closed", "circuit breaker fecha apos sucesso");

  copy.limparCacheCopyV2();
  const chaveA = copy.chaveCacheCopyV2(contexto({}, {}, { clienteId: "workspace_a" }));
  const chaveB = copy.chaveCacheCopyV2(contexto({}, {}, { clienteId: "workspace_b" }));
  assert.notStrictEqual(chaveA, chaveB, "cache V2 isola workspace");
  copy.salvarCacheCopyV2(chaveA, { texto: "Achado seguro para aproveitar" }, 1000);
  assert.strictEqual(copy.lerCacheCopyV2(chaveA).texto, "Achado seguro para aproveitar", "cache V2 hit");
  assert.strictEqual(copy.lerCacheCopyV2(chaveB), null, "cache V2 nao vaza multi-workspace");

  const chaveSemCupom = copy.chaveCacheCopyV2(contexto({ id: "fatos", engineOfertaId: "fatos" }));
  const chaveComCupom = copy.chaveCacheCopyV2(contexto({ id: "fatos", engineOfertaId: "fatos", cupom: "PROMO10" }));
  assert.notStrictEqual(chaveSemCupom, chaveComCupom, "mudanca de fatos invalida cache V2");

  copy.limparCacheCopyV2();
  copy.salvarCacheCopyV2("expirada_v2", { texto: "Velha" }, 1000);
  copy.removerExpiradasCopyV2(Date.now() + 2000);
  assert.strictEqual(copy.lerCacheCopyV2("expirada_v2"), null, "cache V2 remove expiradas");
  for (let i = 0; i < copy.MAX_ENTRIES_COPY_V2 + 5; i += 1) {
    copy.salvarCacheCopyV2(`v2_${i}`, { texto: `Copy ${i}` }, 60 * 1000);
  }
  assert.ok(copy.tamanhoCacheCopyV2() <= copy.MAX_ENTRIES_COPY_V2, "cache V2 respeita MAX_ENTRIES");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparInflightCopyV2();
  copy.limparCircuitBreakersCopyV2();
  const providerSingleflight = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar", atrasoMs: 20 });
  const ctxSingleflight = contexto({ id: "singleflight", engineOfertaId: "singleflight" });
  const [sfA, sfB, sfC] = await Promise.all(Array.from({ length: 20 }, () =>
    copy.resolverCopyV2({ contexto: ctxSingleflight, plano: plano({ copyIaGenerativa: true }), provider: providerSingleflight, shadowMode: true })
  ));
  assert.strictEqual(providerSingleflight.chamadas, 1, "singleflight faz apenas uma geracao");
  assert.strictEqual(sfA.texto, sfB.texto, "singleflight reutiliza resultado A/B");
  assert.strictEqual(sfB.texto, sfC.texto, "singleflight reutiliza resultado B/C");

  const cacheDepoisSingleflight = await copy.resolverCopyV2({ contexto: ctxSingleflight, plano: plano({ copyIaGenerativa: true }), provider: providerSingleflight, shadowMode: true });
  assert.strictEqual(cacheDepoisSingleflight.cacheHit, true, "servico V2 reutiliza cache depois da geracao");
  assert.strictEqual(providerSingleflight.chamadas, 1, "cache evita nova chamada do fake provider");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparCircuitBreakersCopyV2();
  const providerQuota = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const quotaOk = await copy.resolverCopyV2({
    contexto: contexto({ id: "quota_a", engineOfertaId: "quota_a" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerQuota,
    shadowMode: true,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 1000 }
  });
  const quotaFalha = await copy.resolverCopyV2({
    contexto: contexto({ id: "quota_b", engineOfertaId: "quota_b" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerQuota,
    shadowMode: true,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 1000 }
  });
  assert.strictEqual(quotaOk.ok, true, "quota por workspace permite primeira geracao");
  assert.strictEqual(quotaFalha.motivo, "quota_excedida", "quota por workspace bloqueia excesso");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparInflightCopyV2();
  copy.limparCircuitBreakersCopyV2();
  const providerQuotaSingleflight = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar", atrasoMs: 20 });
  await Promise.all(Array.from({ length: 20 }, () =>
    copy.resolverCopyV2({
      contexto: contexto({ id: "quota_sf", engineOfertaId: "quota_sf" }),
      plano: plano({ copyIaGenerativa: true }),
      provider: providerQuotaSingleflight,
      shadowMode: true,
      quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 1000 }
    })
  ));
  const quotaAposSingleflight = await copy.resolverCopyV2({
    contexto: contexto({ id: "quota_sf_nova", engineOfertaId: "quota_sf_nova" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerQuotaSingleflight,
    shadowMode: true,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 1000 }
  });
  assert.strictEqual(providerQuotaSingleflight.chamadas, 1, "singleflight 20 consumidores consome uma geracao");
  assert.strictEqual(quotaAposSingleflight.motivo, "quota_excedida", "singleflight compartilha uma quota");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparCircuitBreakersCopyV2();
  const providerCacheQuota = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const ctxCacheQuota = contexto({ id: "quota_cache", engineOfertaId: "quota_cache" });
  const cacheQuotaA = await copy.resolverCopyV2({
    contexto: ctxCacheQuota,
    plano: plano({ copyIaGenerativa: true }),
    provider: providerCacheQuota,
    shadowMode: true,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 1000 }
  });
  const cacheQuotaB = await copy.resolverCopyV2({
    contexto: ctxCacheQuota,
    plano: plano({ copyIaGenerativa: true }),
    provider: providerCacheQuota,
    shadowMode: true,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 1000 }
  });
  assert.strictEqual(cacheQuotaA.ok, true, "provider tentado consome quota");
  assert.strictEqual(cacheQuotaB.cacheHit, true, "cache hit nao consome quota");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  const breakerAberto = copy.criarCircuitBreakerCopyV2({ falhasParaAbrir: 1, cooldownMs: 1000 });
  breakerAberto.registrarFalha({ nowMs: 100 });
  const providerCircuitOpen = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const circuitoAberto = await copy.resolverCopyV2({
    contexto: contexto({ id: "circuit_quota_a", engineOfertaId: "circuit_quota_a" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerCircuitOpen,
    shadowMode: true,
    circuitBreaker: breakerAberto,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 100 }
  });
  const depoisCircuitoAberto = await copy.resolverCopyV2({
    contexto: contexto({ id: "circuit_quota_b", engineOfertaId: "circuit_quota_b" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerCircuitOpen,
    shadowMode: true,
    quota: { limiteMinuto: 1, limiteDia: 10, nowMs: 100 }
  });
  assert.strictEqual(circuitoAberto.motivo, "circuit_open", "circuit open retorna antes da quota");
  assert.strictEqual(depoisCircuitoAberto.ok, true, "circuit open injetado nao consome quota global");

  const providerDesligado = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const shadowOff = await copy.resolverCopyV2({
    contexto: contexto({ id: "shadow_off", engineOfertaId: "shadow_off" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerDesligado
  });
  assert.strictEqual(shadowOff.motivo, "shadow_desligado", "shadow mode fica desligado por padrao");
  assert.strictEqual(providerDesligado.chamadas, 0, "shadow desligado nao chama provider");

  const providerSemFeature = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const semFeature = await copy.resolverCopyV2({
    contexto: contexto({ id: "sem_feature", engineOfertaId: "sem_feature" }),
    plano: plano({ copyIaGenerativa: false }),
    provider: providerSemFeature,
    shadowMode: true
  });
  assert.strictEqual(semFeature.motivo, "feature_copyIaGenerativa_indisponivel", "feature separada bloqueia V2");
  assert.strictEqual(providerSemFeature.chamadas, 0, "sem feature nao chama provider");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparInflightCopyV2();
  copy.limparCircuitBreakersCopyV2();
  const providerFalhaWorkspaceA = new copy.FakeCopyV2Provider({ falhar: true });
  await copy.resolverCopyV2({ contexto: contexto({ id: "breaker_a1", engineOfertaId: "breaker_a1" }, {}, { clienteId: "workspace_a" }), plano: plano({ copyIaGenerativa: true }), provider: providerFalhaWorkspaceA, shadowMode: true, quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 } });
  await copy.resolverCopyV2({ contexto: contexto({ id: "breaker_a2", engineOfertaId: "breaker_a2" }, {}, { clienteId: "workspace_a" }), plano: plano({ copyIaGenerativa: true }), provider: providerFalhaWorkspaceA, shadowMode: true, quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 } });
  await copy.resolverCopyV2({ contexto: contexto({ id: "breaker_a3", engineOfertaId: "breaker_a3" }, {}, { clienteId: "workspace_a" }), plano: plano({ copyIaGenerativa: true }), provider: providerFalhaWorkspaceA, shadowMode: true, quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 } });
  const providerWorkspaceB = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const workspaceB = await copy.resolverCopyV2({ contexto: contexto({ id: "breaker_b", engineOfertaId: "breaker_b" }, {}, { clienteId: "workspace_b" }), plano: plano({ copyIaGenerativa: true }), provider: providerWorkspaceB, shadowMode: true, quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 } });
  assert.strictEqual(workspaceB.ok, true, "Workspace B nao herda circuito aberto do Workspace A");
  assert.strictEqual(providerWorkspaceB.chamadas, 1, "Workspace B continua chamando provider");

  copy.limparCacheCopyV2();
  copy.limparQuotasCopyV2();
  copy.limparInflightCopyV2();
  copy.limparCircuitBreakersCopyV2();
  const providerModeloA = new copy.FakeCopyV2Provider({ falhar: true });
  for (let i = 0; i < 3; i += 1) {
    await copy.resolverCopyV2({
      contexto: contexto({ id: `breaker_model_a_${i}`, engineOfertaId: `breaker_model_a_${i}` }),
      plano: plano({ copyIaGenerativa: true }),
      provider: providerModeloA,
      shadowMode: true,
      opcoesProvider: { providerAlias: "provider_a", modelAlias: "model_a" },
      quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 }
    });
  }
  const providerModeloB = new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" });
  const modeloB = await copy.resolverCopyV2({
    contexto: contexto({ id: "breaker_model_b", engineOfertaId: "breaker_model_b" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerModeloB,
    shadowMode: true,
    opcoesProvider: { providerAlias: "provider_b", modelAlias: "model_b" },
    quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 }
  });
  assert.strictEqual(modeloB.ok, true, "provider/model diferente nao compartilha circuito");
  assert.strictEqual(providerModeloB.chamadas, 1, "provider/model diferente continua chamando");

  const providerErroSegredo = {
    gerar: async () => {
      throw new Error("token=segredo-super-secreto");
    }
  };
  const erroSeguro = await copy.resolverCopyV2({
    contexto: contexto({ id: "reason_secret", engineOfertaId: "reason_secret" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: providerErroSegredo,
    shadowMode: true,
    opcoesProvider: { providerAlias: "provider_reason", modelAlias: "model_reason" },
    quota: { limiteMinuto: 10, limiteDia: 10, nowMs: 100 }
  });
  assert.strictEqual(erroSeguro.motivo, "internal_error", "erro desconhecido usa reasonCode seguro");
  assert.ok(!JSON.stringify(erroSeguro).includes("segredo-super-secreto"), "erro cru com segredo nao atravessa resultado");
  assert.ok(copy.REASON_CODES_COPY_V2.includes("internal_error"), "allowlist contem internal_error");

  const direta = contexto({}, {}, { estilo: "direta" });
  const divertida = contexto({}, {}, { estilo: "divertida" });
  assert.deepStrictEqual(direta.fatosPermitidos, divertida.fatosPermitidos, "estilos nao alteram fatos");
  assert.strictEqual(copy.normalizarEstiloCopyV2("fora"), "direta", "estilo invalido cai no default conservador");

  const contextoTelefone = contexto({ titulo: "Contato 16999999999 Produto Seguro", nome: "Contato 16999999999 Produto Seguro" });
  const contextoJid = contexto({ titulo: "Grupo user@s.whatsapp.net Produto", nome: "Grupo user@s.whatsapp.net Produto" });
  const contextoEmail = contexto({ titulo: "Oferta teste@gmail.com Produto", nome: "Oferta teste@gmail.com Produto" });
  assert.ok(!JSON.stringify(contextoTelefone).includes("16999999999"), "contexto remove telefone embutido");
  assert.ok(!JSON.stringify(contextoJid).includes("user@s.whatsapp.net"), "contexto remove JID embutido");
  assert.ok(!JSON.stringify(contextoEmail).includes("teste@gmail.com"), "contexto remove email embutido");

  async function naoRejeita(nome, montarEntrada) {
    try {
      const resultado = await copy.resolverCopyV2(montarEntrada());
      assert.strictEqual(resultado.ok, false, `${nome} retorna fallback`);
      assert.ok(copy.REASON_CODES_COPY_V2.includes(resultado.motivo), `${nome} usa reasonCode fechado`);
      return resultado;
    } catch (erro) {
      assert.fail(`${nome} nao deve rejeitar Promise: ${erro.message}`);
    }
  }

  const ctxFailSafe = contexto({ id: "failsafe_base", engineOfertaId: "failsafe_base" });
  await naoRejeita("provider throw", () => ({
    contexto: ctxFailSafe,
    plano: plano({ copyIaGenerativa: true }),
    provider: { gerar: async () => { throw new Error("token=segredo"); } },
    shadowMode: true,
    opcoesProvider: { providerAlias: "fs_provider_throw", modelAlias: "fs_model" }
  }));

  try {
    const loggerFalhou = await copy.resolverCopyV2({
      contexto: contexto({ id: "failsafe_logger", engineOfertaId: "failsafe_logger" }),
      plano: plano({ copyIaGenerativa: true }),
      provider: new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" }),
      shadowMode: true,
      logger: () => { throw new Error("logger boom"); },
      opcoesProvider: { providerAlias: "fs_logger", modelAlias: "fs_model" }
    });
    assert.strictEqual(loggerFalhou.ok, true, "observabilidade throw nao rejeita nem derruba geracao valida");
  } catch (erro) {
    assert.fail(`observabilidade throw nao deve rejeitar Promise: ${erro.message}`);
  }

  const caminhoService = require.resolve("../modules/copy-inteligente/copy-v2.service");

  async function naoRejeitaComResolver(nome, resolver) {
    try {
      const resultado = await resolver({
        contexto: contexto({ id: `failsafe_${nome}`, engineOfertaId: `failsafe_${nome}` }),
        plano: plano({ copyIaGenerativa: true }),
        provider: new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" }),
        shadowMode: true,
        opcoesProvider: { providerAlias: `fs_${nome}`, modelAlias: "fs_model" }
      });
      assert.strictEqual(resultado.ok, false, `${nome} retorna fallback`);
      assert.ok(copy.REASON_CODES_COPY_V2.includes(resultado.motivo), `${nome} usa reasonCode fechado`);
    } catch (erro) {
      assert.fail(`${nome} nao deve rejeitar Promise: ${erro.message}`);
    }
  }

  delete require.cache[caminhoService];
  delete require.cache[require.resolve("../modules/copy-inteligente/cache-v2")];
  const cacheThrowLer = require("../modules/copy-inteligente/cache-v2");
  cacheThrowLer.lerCacheCopyV2 = () => { throw new Error("cache ler boom"); };
  await naoRejeitaComResolver("cache.ler throw", require("../modules/copy-inteligente/copy-v2.service").resolverCopyV2);

  delete require.cache[caminhoService];
  delete require.cache[require.resolve("../modules/copy-inteligente/cache-v2")];
  const cacheThrowSalvar = require("../modules/copy-inteligente/cache-v2");
  cacheThrowSalvar.salvarCacheCopyV2 = () => { throw new Error("cache salvar boom"); };
  await naoRejeitaComResolver("cache.salvar throw", require("../modules/copy-inteligente/copy-v2.service").resolverCopyV2);

  delete require.cache[caminhoService];
  delete require.cache[require.resolve("../modules/copy-inteligente/quota-v2")];
  const quotaThrow = require("../modules/copy-inteligente/quota-v2");
  quotaThrow.consumirQuotaCopyV2 = () => { throw new Error("quota boom"); };
  await naoRejeitaComResolver("quota throw", require("../modules/copy-inteligente/copy-v2.service").resolverCopyV2);

  delete require.cache[caminhoService];
  delete require.cache[require.resolve("../modules/copy-inteligente/validator-v2")];
  const validatorThrow = require("../modules/copy-inteligente/validator-v2");
  validatorThrow.validarCopyV2 = () => { throw new Error("validator boom"); };
  await naoRejeitaComResolver("validator throw", require("../modules/copy-inteligente/copy-v2.service").resolverCopyV2);

  delete require.cache[caminhoService];
  const serviceBreakerThrow = require("../modules/copy-inteligente/copy-v2.service");
  const breakerThrow = {
    podeTentar: () => { throw new Error("breaker boom"); },
    registrarFalha: () => {},
    registrarSucesso: () => {}
  };
  const breakerThrowResultado = await serviceBreakerThrow.resolverCopyV2({
    contexto: contexto({ id: "failsafe_breaker", engineOfertaId: "failsafe_breaker" }),
    plano: plano({ copyIaGenerativa: true }),
    provider: new copy.FakeCopyV2Provider({ texto: "Achado seguro para aproveitar" }),
    shadowMode: true,
    circuitBreaker: breakerThrow
  });
  assert.strictEqual(breakerThrowResultado.ok, false, "breaker throw retorna fallback");
  assert.ok(copy.REASON_CODES_COPY_V2.includes(breakerThrowResultado.motivo), "breaker throw usa reasonCode fechado");

  const eventos = [];
  const evento = copy.emitirEventoCopyV2("copy_v2_gerada", {
    workspaceHash: "workspace_hash",
    ofertaKeyHash: "oferta_hash",
    intencao: "oportunidade",
    estilo: "direta",
    promptVersion: "v",
    providerAlias: "fake",
    modelAlias: "fake",
    latencyBucket: "lt_250ms",
    reasonCode: "ok",
    token: "segredo",
    prompt: "prompt bruto",
    resposta: "resposta bruta",
    link: "https://privado.example"
  }, { logger: (nome, payload) => eventos.push({ nome, payload }) });
  assert.strictEqual(evento.evento, "copy_v2_gerada", "observabilidade aceita evento oficial");
  assert.ok(!JSON.stringify(evento).includes("segredo"), "observabilidade remove segredo");
  assert.ok(!JSON.stringify(evento).includes("prompt bruto"), "observabilidade remove prompt bruto");
  assert.ok(!JSON.stringify(evento).includes("https://privado.example"), "observabilidade remove link");
  assert.strictEqual(eventos.length, 1, "observabilidade usa logger injetado");

  copy.limparCacheCopyInteligente();
  const fakeNaoIntegrado = new copy.FakeCopyV2Provider({ texto: "Nao pode aparecer" });
  const ofertaV1 = ofertaBase({ id: "renderer_v1", engineOfertaId: "renderer_v1", categoria: "Gamer e Hardware" });
  const mensagemSemV2 = montarMensagemOferta(ofertaV1, {
    clienteId: "cliente_copy_v2",
    destino: { id: "destino", tipo: "whatsapp", tituloOferta: "ia" },
    plano: plano({ copyIaGenerativa: false })
  });
  const mensagemComFeatureV2 = montarMensagemOferta(ofertaV1, {
    clienteId: "cliente_copy_v2",
    destino: { id: "destino", tipo: "whatsapp", tituloOferta: "ia" },
    plano: plano({ copyIaGenerativa: true })
  });
  assert.strictEqual(mensagemComFeatureV2, mensagemSemV2, "Copy V1 continua igual mesmo com feature V2");
  assert.strictEqual(fakeNaoIntegrado.chamadas, 0, "renderer nao chama provider V2");
  assert.ok(!mensagemComFeatureV2.includes("Nao pode aparecer"), "mensagem enviada nao muda por V2");

  const sourceRenderer = fs.readFileSync(path.join(__dirname, "../utils/mensagens-ofertas.js"), "utf8");
  assert.ok(!sourceRenderer.includes("resolverCopyV2"), "renderer nao integra Copy V2");
  assert.ok(!sourceRenderer.includes("copyIaGenerativa"), "renderer nao altera resultado por feature V2");

  const sourceProvider = fs.readFileSync(path.join(__dirname, "../modules/copy-inteligente/provider-client.js"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(sourceProvider), "provider abstrato nao usa fetch real");
  assert.ok(!/\baxios\b/.test(sourceProvider), "provider abstrato nao usa axios");
  assert.ok(!/openai|gemini|claude|anthropic/i.test(sourceProvider), "provider abstrato nao referencia provider real");

  const backendIndex = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.ok(backendIndex.includes('copyIaGenerativa: booleanPlano("copyIaGenerativa", recursosAnteriores.copyIaGenerativa)'), "backend persiste feature copyIaGenerativa");
  assert.ok(backendIndex.includes('plano.recursos.copyIaGenerativa = false'), "backend default copyIaGenerativa false");
  assert.ok(!/copyIaGenerativa[\s\S]{0,160}\b(free|gratis|grátis|pro|ultimate)\b|\b(free|gratis|grátis|pro|ultimate)\b[\s\S]{0,160}copyIaGenerativa/i.test(backendIndex), "backend nao hardcoda plano para copyIaGenerativa");

  const frontendRoot = path.resolve(__dirname, "../../optimuspromo-frontend/src");
  const adminSource = fs.readFileSync(path.join(frontendRoot, "routes/admin.tsx"), "utf8");
  const planosStoreSource = fs.readFileSync(path.join(frontendRoot, "lib/planos-store.ts"), "utf8");
  const featureAccessSource = fs.readFileSync(path.join(frontendRoot, "lib/feature-access.ts"), "utf8");
  assert.ok(adminSource.includes('"copy_ia_generativa"'), "Admin exibe Copy IA Generativa na ordem de recursos");
  assert.ok(adminSource.includes('copy_ia_generativa: "copyIaGenerativa"'), "Admin mapeia copy_ia_generativa para backend");
  assert.ok(planosStoreSource.includes('copy_ia_generativa: { label: "Copy IA Generativa"'), "catalogo do plano mostra Copy IA Generativa");
  assert.ok(featureAccessSource.includes('copy_ia_generativa: ["copyIaGenerativa"]'), "feature-access reconhece alias copyIaGenerativa");

  console.log("copy-inteligente-v2-fase1.test.js OK");
})();
