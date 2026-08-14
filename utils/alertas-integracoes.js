const {
  readClienteJson,
  writeClienteJson
} = require("./storage");
const crypto = require("crypto");
const {
  normalizarCredenciaisAwin
} = require("./integracoes");

const ARQUIVO = "alertas-integracoes.json";
const ARQUIVO_SAUDE = "saude-integracoes.json";
const JANELA_CONFIRMACAO_FALHA_MS = 3 * 60 * 1000;

function normalizarMarketplace(marketplace = "") {
  return String(marketplace || "").trim().toLowerCase();
}

function normalizarIntegracaoId(integracaoId = "") {
  return String(integracaoId || "").trim().toLowerCase();
}

function chaveSaude(marketplace = "", integracaoId = "") {
  const mp = normalizarMarketplace(marketplace);
  const id = normalizarIntegracaoId(integracaoId);
  return id ? `${mp}:${id}` : mp;
}

function ordenarObjeto(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarObjeto);
  if (!valor || typeof valor !== "object") return valor;
  return Object.keys(valor).sort().reduce((acc, chave) => {
    acc[chave] = ordenarObjeto(valor[chave]);
    return acc;
  }, {});
}

function valorTexto(obj = {}, campos = []) {
  for (const campo of campos) {
    const valor = obj?.[campo];
    if (valor !== undefined && valor !== null && String(valor).trim()) {
      return String(valor).trim();
    }
  }
  return "";
}

function hashPayloadSeguro(payload = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(ordenarObjeto(payload)), "utf8")
    .digest("hex");
}

function credencialFingerprintIntegracao(marketplace = "", config = {}, opcoes = {}) {
  const mp = normalizarMarketplace(marketplace);
  const cred = config?.credenciais || config || {};
  let payload = null;

  if (mp === "mercadolivre") {
    payload = {
      marketplace: mp,
      cookies: valorTexto(cred, ["cookies", "cookie"]),
      tag: valorTexto(cred, ["tag", "tagId", "tagID", "tag_id", "codigoAfiliado", "trackingId", "partnerTag", "affiliateTag"]).toLowerCase()
    };
  } else if (mp === "amazon") {
    const modo = String(config?.modo || cred.modo || (cred.cookies ? "cookies" : "api")).trim().toLowerCase();
    payload = modo === "api"
      ? {
        marketplace: mp,
        modo,
        appId: valorTexto(cred, ["appId", "app_id"]),
        accessKey: valorTexto(cred, ["accessKey", "access_key"]),
        secretKey: valorTexto(cred, ["secretKey", "secret_key"])
      }
      : {
        marketplace: mp,
        modo: "cookies",
        cookies: valorTexto(cred, ["cookies", "cookie"]),
        tag: valorTexto(cred, ["trackingId", "partnerTag", "tag", "tagId", "affiliateTag", "appId"]).toLowerCase()
      };
  } else if (mp === "shopee") {
    payload = {
      marketplace: mp,
      appId: valorTexto(cred, ["appId", "app_id"]),
      secret: valorTexto(cred, ["secret", "appSecret", "app_secret"])
    };
  } else if (mp === "aliexpress") {
    payload = {
      marketplace: mp,
      appKey: valorTexto(cred, ["appKey", "app_key"]),
      secret: valorTexto(cred, ["secret", "appSecret", "app_secret"]),
      trackingId: valorTexto(cred, ["trackingId", "tracking_id"])
    };
  } else if (mp === "awin" || mp === "kabum") {
    const normalizada = normalizarCredenciaisAwin(cred);
    const integracaoId = normalizarIntegracaoId(opcoes.integracaoId || "");
    const advertiserIdAlvo = integracaoId.startsWith("advertiser:") ? integracaoId.replace("advertiser:", "") : "";
    const programas = normalizada.programas
      .filter(programa => programa?.ativo !== false)
      .filter(programa => !advertiserIdAlvo || String(programa.advertiserId || "") === advertiserIdAlvo)
      .map(programa => ({
        advertiserId: String(programa.advertiserId || "").trim(),
        nome: String(programa.nome || "").trim().toLowerCase(),
        ativo: programa.ativo !== false
      }))
      .sort((a, b) => a.advertiserId.localeCompare(b.advertiserId) || a.nome.localeCompare(b.nome));

    payload = {
      marketplace: mp,
      integracaoId: integracaoId || "",
      publisherId: normalizada.publisherId,
      apiToken: normalizada.apiToken,
      programas
    };
  } else if (mp === "magalu") {
    payload = {
      marketplace: mp,
      promoterId: valorTexto(cred, ["promoterId", "promoter_id"])
    };
  }

  if (!payload) return "";
  const possuiValor = Object.entries(payload).some(([chave, valor]) => {
    if (["marketplace", "modo", "integracaoId"].includes(chave)) return false;
    if (Array.isArray(valor)) return valor.length > 0;
    return String(valor || "").trim() !== "";
  });
  if (!possuiValor) return "";
  return `sha256:${hashPayloadSeguro(payload)}`;
}

function agoraIso() {
  return new Date().toISOString();
}

function timestampMs(valor = "") {
  const ms = Date.parse(valor || "");
  return Number.isFinite(ms) ? ms : 0;
}

function logSaudeFailOpen(etapa = "", erro = {}) {
  try {
    console.warn("[SAUDE-INTEGRACOES-FAIL-OPEN]", JSON.stringify({
      etapa,
      erro: erro?.code || erro?.name || "erro_observabilidade"
    }));
  } catch {
    // Observabilidade nunca deve interferir no fluxo principal.
  }
}

function executarSaudeFailOpen(etapa = "", fn = () => null, fallback = null) {
  try {
    return fn();
  } catch (erro) {
    logSaudeFailOpen(etapa, erro);
    return fallback;
  }
}

function detalhesSanitizados(valor = {}) {
  if (!valor || typeof valor !== "object") return {};
  const saida = {};
  const segredo = /cookie|secret|token|authorization|password|senha|apikey|api_key|access|refresh|header|payload|html|raw|resposta|stack|url|link/i;

  for (const [chave, item] of Object.entries(valor)) {
    if (segredo.test(chave)) continue;
    if (item === undefined || item === null) continue;
    if (typeof item === "string") {
      saida[chave] = item.slice(0, 160);
    } else if (typeof item === "number" || typeof item === "boolean") {
      saida[chave] = item;
    } else if (Array.isArray(item)) {
      saida[chave] = item.slice(0, 5).map(v =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? v
          : "[omitido]"
      );
    }
  }

  return saida;
}

function classificarCodigoSaude(codigo = "", detalhes = {}) {
  const cod = String(codigo || "").toLowerCase();
  const statusHttp = Number(detalhes?.httpStatus || detalhes?.statusHttp || 0);
  const diagnostico = `${cod} ${detalhes?.motivo || ""} ${detalhes?.codigoApi || ""}`.toLowerCase();

  if (["ok", "afiliado_ok", "teste_ok", "cookie_valido", "api_valida", "sucesso_pipeline"].includes(cod)) {
    return "saudavel";
  }

  if (/captcha|bloqueio|suspicious|anti.?bot|robot|timeout|erro_rede|\brede\b|rate.?limit|429|5\d\d/.test(diagnostico)) {
    return "desconhecida";
  }

  if ([
    "cookie_expirado",
    "cookie_invalido",
    "cookies_invalidos",
    "cookie_ausente",
    "tag_ausente",
    "credencial_ausente",
    "credencial_invalida",
    "invalid_credentials",
    "token_invalido",
    "configuracao_invalida",
    "programa_invalido",
    "nao_configurado"
  ].includes(cod)) {
    return "invalida";
  }

  if ([401, 403, 419].includes(statusHttp) && /credencial|credential|cookie|login|signin|token|auth|expirad|invalid/.test(diagnostico)) {
    return "invalida";
  }
  return "desconhecida";
}

function mensagemSaude(status = "desconhecida", codigo = "") {
  if (status === "saudavel") return "Integracao funcionando";
  if (status === "invalida") return "Integracao invalida ou expirada";
  if (String(codigo || "") === "teste_paapi_nao_disponivel") return "Teste real PA-API ainda nao disponivel";
  if (String(codigo || "") === "teste_magalu_nao_disponivel") return "Teste real Magalu ainda nao disponivel";
  return "Saude da integracao desconhecida";
}

function listarAlertasIntegracoes(clienteId = "admin") {
  return readClienteJson(clienteId, ARQUIVO, []);
}

function listarSaudeIntegracoes(clienteId = "admin") {
  const dados = readClienteJson(clienteId, ARQUIVO_SAUDE, []);
  return Array.isArray(dados) ? dados : [];
}

function obterSaudeIntegracao(clienteId = "admin", marketplace = "", integracaoId = "") {
  const chave = chaveSaude(marketplace, integracaoId);
  return listarSaudeIntegracoes(clienteId).find(item => chaveSaude(item.marketplace, item.integracaoId) === chave) || null;
}

function estadoDesconhecidoCredencialAtual(marketplace = "", credencialFingerprint = "", integracaoId = "") {
  const mp = normalizarMarketplace(marketplace);
  return {
    marketplace: mp,
    ...(integracaoId ? { integracaoId: normalizarIntegracaoId(integracaoId) } : {}),
    status: "desconhecida",
    codigo: "credencial_atual_sem_prova",
    mensagem: mensagemSaude("desconhecida", "credencial_atual_sem_prova"),
    origem: "credencial_atual",
    ultimaProvaPositivaEm: null,
    ultimaFalhaQualificadaEm: null,
    atualizadoEm: agoraIso(),
    detalhes: {},
    falhaQualificadaPendenteEm: null,
    falhasQualificadas: 0,
    ...(credencialFingerprint ? { credencialFingerprint } : {})
  };
}

function obterSaudeIntegracaoAtual(clienteId = "admin", marketplace = "", config = {}, integracaoId = "") {
  const mp = normalizarMarketplace(marketplace);
  const id = normalizarIntegracaoId(integracaoId);
  const fingerprintAtual = credencialFingerprintIntegracao(mp, config, { integracaoId: id });
  const atual = obterSaudeIntegracao(clienteId, mp, id);

  if (!fingerprintAtual) return atual;
  if (atual?.credencialFingerprint && atual.credencialFingerprint === fingerprintAtual) return atual;
  return estadoDesconhecidoCredencialAtual(mp, fingerprintAtual, id);
}

function listarSaudeIntegracoesAtuais(clienteId = "admin", integracoesCliente = {}) {
  const lista = listarSaudeIntegracoes(clienteId);
  const marketplacesComGranularidade = new Set(
    lista
      .filter(item => normalizarIntegracaoId(item.integracaoId || ""))
      .map(item => normalizarMarketplace(item.marketplace))
      .filter(mp => mp === "awin" || mp === "kabum")
  );

  return lista
    .filter(item => {
      const mp = normalizarMarketplace(item.marketplace);
      const integracaoId = normalizarIntegracaoId(item.integracaoId || "");
      return !((mp === "awin" || mp === "kabum") && !integracaoId && marketplacesComGranularidade.has(mp));
    })
    .map(item => {
      const mp = normalizarMarketplace(item.marketplace);
      const config = integracoesCliente?.[mp] || (mp === "kabum" ? integracoesCliente?.awin : null) || {};
      return obterSaudeIntegracaoAtual(clienteId, mp, config, item.integracaoId || "");
    });
}

function salvarSaudeIntegracoes(clienteId = "admin", lista = []) {
  writeClienteJson(clienteId, ARQUIVO_SAUDE, Array.isArray(lista) ? lista : []);
  return lista;
}

function registrarSaudeIntegracao(clienteId = "admin", marketplace = "", estado = {}) {
  const mp = normalizarMarketplace(marketplace || estado.marketplace || "");
  if (!mp) return listarSaudeIntegracoes(clienteId);

  const integracaoId = normalizarIntegracaoId(estado.integracaoId || "");
  const chave = chaveSaude(mp, integracaoId);
  const lista = listarSaudeIntegracoes(clienteId);
  const anterior = lista.find(item => chaveSaude(item.marketplace, item.integracaoId) === chave) || {};
  const status = ["saudavel", "invalida", "desconhecida"].includes(String(estado.status || ""))
    ? String(estado.status)
    : "desconhecida";
  const agora = estado.timestamp || agoraIso();
  const temProvaPositiva = Object.prototype.hasOwnProperty.call(estado, "ultimaProvaPositivaEm");
  const temFalhaQualificada = Object.prototype.hasOwnProperty.call(estado, "ultimaFalhaQualificadaEm");
  const credencialFingerprint = String(estado.credencialFingerprint || anterior.credencialFingerprint || "").trim();

  const proximo = {
    marketplace: mp,
    ...(integracaoId ? { integracaoId } : {}),
    status,
    codigo: String(estado.codigo || anterior.codigo || status),
    mensagem: String(estado.mensagem || mensagemSaude(status, estado.codigo || anterior.codigo || "")),
    ultimaProvaPositivaEm: status === "saudavel"
      ? (estado.ultimaProvaPositivaEm || (estado.preservarProvaPositiva ? (anterior.ultimaProvaPositivaEm || null) : agora))
      : (temProvaPositiva ? estado.ultimaProvaPositivaEm : (anterior.ultimaProvaPositivaEm || null)),
    ultimaFalhaQualificadaEm: status === "invalida"
      ? agora
      : (temFalhaQualificada ? estado.ultimaFalhaQualificadaEm : (anterior.ultimaFalhaQualificadaEm || null)),
    origem: String(estado.origem || anterior.origem || "sensor"),
    atualizadoEm: agora,
    detalhes: detalhesSanitizados(estado.detalhes || {}),
    falhaQualificadaPendenteEm: estado.falhaQualificadaPendenteEm === null
      ? null
      : (estado.falhaQualificadaPendenteEm || anterior.falhaQualificadaPendenteEm || null),
    falhasQualificadas: Number.isFinite(Number(estado.falhasQualificadas))
      ? Number(estado.falhasQualificadas)
      : Number(anterior.falhasQualificadas || 0)
  };
  if (credencialFingerprint) proximo.credencialFingerprint = credencialFingerprint;

  const novaLista = lista.filter(item => chaveSaude(item.marketplace, item.integracaoId) !== chave);
  novaLista.push(proximo);
  return salvarSaudeIntegracoes(clienteId, novaLista);
}

function saudeAPartirResultado(marketplace = "", resultado = {}, origem = "manual", anterior = null) {
  const codigo = String(resultado.codigo || resultado.status || "desconhecida").toLowerCase();
  const detalhes = detalhesSanitizados(resultado.detalhes || {});
  const statusBase = classificarCodigoSaude(codigo, detalhes);
  const transitorio = statusBase === "desconhecida";
  const agora = agoraIso();

  if (statusBase === "saudavel") {
    return {
      marketplace: normalizarMarketplace(marketplace || resultado.marketplace || ""),
      status: "saudavel",
      codigo,
      mensagem: resultado.mensagem || mensagemSaude("saudavel", codigo),
      origem,
      detalhes,
      falhaQualificadaPendenteEm: null,
      falhasQualificadas: 0
    };
  }

  if (statusBase === "invalida" && anterior?.status === "saudavel" && origem !== "manual") {
    const primeiraFalha = anterior.falhaQualificadaPendenteEm || agora;
    const falhas = Number(anterior.falhasQualificadas || 0) + 1;
    const inicioFalha = timestampMs(primeiraFalha);
    const sucessoAposFalha = timestampMs(anterior.ultimaProvaPositivaEm) > inicioFalha;
    const janelaConfirmada = !sucessoAposFalha &&
      falhas > 1 &&
      inicioFalha > 0 &&
      Date.now() - inicioFalha >= JANELA_CONFIRMACAO_FALHA_MS;

    if (!janelaConfirmada) {
      return {
        marketplace: normalizarMarketplace(marketplace || resultado.marketplace || ""),
        status: "saudavel",
        codigo: anterior.codigo || "sucesso_pipeline",
        mensagem: anterior.mensagem || mensagemSaude("saudavel", anterior.codigo || "sucesso_pipeline"),
        origem: anterior.origem || origem,
        detalhes,
        preservarProvaPositiva: true,
        falhaQualificadaPendenteEm: sucessoAposFalha ? agora : primeiraFalha,
        falhasQualificadas: sucessoAposFalha ? 1 : falhas,
        ultimaFalhaQualificadaEm: agora
      };
    }
  }

  const status = transitorio && anterior?.status ? anterior.status : statusBase;
  const codigoFinal = transitorio && anterior?.status ? (anterior.codigo || codigo) : codigo;

  return {
    marketplace: normalizarMarketplace(marketplace || resultado.marketplace || ""),
    status,
    codigo: codigoFinal,
    mensagem: resultado.mensagem || mensagemSaude(status, codigoFinal),
    origem,
    detalhes,
    preservarProvaPositiva: transitorio && anterior?.status === "saudavel",
    falhaQualificadaPendenteEm: status === "invalida" ? null : undefined,
    falhasQualificadas: status === "invalida" ? 0 : undefined
  };
}

function registrarResultadoSaudeIntegracao(clienteId = "admin", marketplace = "", resultado = {}, origem = "manual") {
  return executarSaudeFailOpen("registrar_resultado", () => {
    const mp = normalizarMarketplace(marketplace || resultado.marketplace || "");
    const integracaoId = normalizarIntegracaoId(resultado.integracaoId || resultado.saude?.integracaoId || "");
    const anterior = obterSaudeIntegracao(clienteId, mp, integracaoId);
    const estado = saudeAPartirResultado(mp, resultado, origem, anterior);
    if (integracaoId) estado.integracaoId = integracaoId;
    if (resultado.credencialFingerprint) estado.credencialFingerprint = resultado.credencialFingerprint;
    registrarSaudeIntegracao(clienteId, mp, estado);

    if (Array.isArray(resultado.saudeFilhas)) {
      for (const filha of resultado.saudeFilhas) {
        const marketplaceFilha = normalizarMarketplace(filha.marketplace || mp);
        const integracaoIdFilha = normalizarIntegracaoId(filha.integracaoId || "");
        if (!marketplaceFilha || !integracaoIdFilha) continue;
        const anteriorFilha = obterSaudeIntegracao(clienteId, marketplaceFilha, integracaoIdFilha);
        const estadoFilha = saudeAPartirResultado(marketplaceFilha, filha, origem, anteriorFilha);
        estadoFilha.integracaoId = integracaoIdFilha;
        if (filha.credencialFingerprint) estadoFilha.credencialFingerprint = filha.credencialFingerprint;
        registrarSaudeIntegracao(clienteId, marketplaceFilha, estadoFilha);
      }
    }

    return obterSaudeIntegracao(clienteId, mp, integracaoId);
  }, null);
}

function registrarSucessoIntegracao(
  clienteId = "admin",
  marketplace = "",
  detalhes = {},
  origem = "sensor"
) {
  return executarSaudeFailOpen("registrar_sucesso", () => {
    const mp = normalizarMarketplace(marketplace);
    const integracaoId = normalizarIntegracaoId(detalhes?.integracaoId || "");
    limparAlertaIntegracao(clienteId, mp, integracaoId ? { integracaoId, apenasAlerta: true } : {});
    registrarSaudeIntegracao(clienteId, mp, {
      status: "saudavel",
      codigo: detalhes?.codigo || "sucesso_pipeline",
      mensagem: "Integracao funcionando",
      origem: String(detalhes?.origem || origem),
      integracaoId,
      credencialFingerprint: detalhes?.credencialFingerprint || "",
      detalhes
    });
    return obterSaudeIntegracao(clienteId, mp, integracaoId);
  }, {
    ok: false,
    erro: "saude_integracoes_indisponivel",
    marketplace: normalizarMarketplace(marketplace)
  });
}

function registrarAlertaIntegracao(
  clienteId = "admin",
  marketplace = "",
  alerta = {}
) {
  return executarSaudeFailOpen("registrar_alerta", () => {
    const alertas = listarAlertasIntegracoes(clienteId);
    const mp = normalizarMarketplace(marketplace);
    const integracaoId = normalizarIntegracaoId(alerta.integracaoId || alerta.detalhes?.integracaoId || "");

    const novaLista = alertas.filter(
      item => normalizarMarketplace(item.marketplace) !== mp ||
        normalizarIntegracaoId(item.integracaoId || "") !== integracaoId
    );

    novaLista.push({
      marketplace: mp,
      ...(integracaoId ? { integracaoId } : {}),
      tipo: alerta.tipo || "desconhecido",
      status: alerta.status || "atencao",
      mensagem: alerta.mensagem || "",
      detalhes: detalhesSanitizados(alerta.detalhes || {}),
      ultimaOcorrencia: new Date().toISOString()
    });

    writeClienteJson(clienteId, ARQUIVO, novaLista);
    registrarResultadoSaudeIntegracao(clienteId, mp, {
      status: alerta.tipo || alerta.status || "desconhecido",
      codigo: alerta.tipo || alerta.status || "desconhecido",
      mensagem: alerta.mensagem || "",
      detalhes: alerta.detalhes || {},
      credencialFingerprint: alerta.credencialFingerprint || alerta.detalhes?.credencialFingerprint || "",
      ...(integracaoId ? { integracaoId } : {})
    }, "sensor");

    return novaLista;
  }, []);
}

function limparAlertaIntegracao(
  clienteId = "admin",
  marketplace = "",
  opcoes = {}
) {
  return executarSaudeFailOpen("limpar_alerta", () => {
    const alertas = listarAlertasIntegracoes(clienteId);
    const mp = normalizarMarketplace(marketplace);
    const integracaoId = normalizarIntegracaoId(opcoes.integracaoId || "");

    const novaLista = alertas.filter(
      item => normalizarMarketplace(item.marketplace) !== mp ||
        (integracaoId && normalizarIntegracaoId(item.integracaoId || "") !== integracaoId)
    );

    writeClienteJson(clienteId, ARQUIVO, novaLista);
    if (opcoes.apenasAlerta) return novaLista;

    const anterior = obterSaudeIntegracao(clienteId, mp, integracaoId);
    if (anterior?.status === "saudavel" && anterior.ultimaProvaPositivaEm) {
      return novaLista;
    }

    registrarSaudeIntegracao(clienteId, mp, {
      status: "desconhecida",
      codigo: "alerta_limpo_sem_prova",
      mensagem: "Saude da integracao desconhecida",
      origem: "sensor",
      ...(integracaoId ? { integracaoId } : {})
    });

    return novaLista;
  }, []);
}

function reiniciarSaudeIntegracaoSeCredencialMudou(clienteId = "admin", marketplace = "", config = {}) {
  return executarSaudeFailOpen("reiniciar_saude_credencial", () => {
    const mp = normalizarMarketplace(marketplace);
    const alvos = [];
    if (mp === "awin" || mp === "kabum") {
      const cred = normalizarCredenciaisAwin(config?.credenciais || config || {});
      for (const programa of cred.programas || []) {
        if (programa?.ativo === false || !programa?.advertiserId) continue;
        alvos.push({
          marketplace: mp,
          integracaoId: `advertiser:${String(programa.advertiserId).trim()}`
        });
      }
    }
    if (!alvos.length) alvos.push({ marketplace: mp, integracaoId: "" });

    for (const alvo of alvos) {
      const fingerprintAtual = credencialFingerprintIntegracao(alvo.marketplace, config, {
        integracaoId: alvo.integracaoId
      });
      if (!fingerprintAtual) continue;
      const anterior = obterSaudeIntegracao(clienteId, alvo.marketplace, alvo.integracaoId);
      if (anterior?.credencialFingerprint === fingerprintAtual) continue;
      registrarSaudeIntegracao(clienteId, alvo.marketplace, {
        ...(alvo.integracaoId ? { integracaoId: alvo.integracaoId } : {}),
        status: "desconhecida",
        codigo: "credencial_alterada_sem_teste",
        mensagem: "Saude da integracao desconhecida",
        origem: "credencial_atual",
        credencialFingerprint: fingerprintAtual,
        ultimaProvaPositivaEm: null,
        ultimaFalhaQualificadaEm: null,
        falhaQualificadaPendenteEm: null,
        falhasQualificadas: 0
      });
    }

    return listarSaudeIntegracoes(clienteId);
  }, null);
}

module.exports = {
  listarAlertasIntegracoes,
  registrarAlertaIntegracao,
  limparAlertaIntegracao,
  listarSaudeIntegracoes,
  obterSaudeIntegracao,
  obterSaudeIntegracaoAtual,
  listarSaudeIntegracoesAtuais,
  registrarSaudeIntegracao,
  registrarResultadoSaudeIntegracao,
  registrarSucessoIntegracao,
  classificarCodigoSaude,
  detalhesSanitizados,
  credencialFingerprintIntegracao,
  reiniciarSaudeIntegracaoSeCredencialMudou
};
