const crypto = require("crypto");

const { queryEngine } = require("./database");
const { criarJobsParaClientes } = require("./jobs.service");
const {
  detectarMarketplaceLink,
  normalizarEventoBruto,
  normalizarUrl
} = require("./normalizers");
const {
  logEngineEventoBrutoSalvo,
  logEngineEventoBrutoDuplicado,
  logEngineEventoBrutoErro
} = require("./logger");

let proximoIdOperacaoEventoBruto = 1;
let chamadasAtivasEventoBruto = 0;

function perfMsEventoBruto(inicio) {
  return Number(process.hrtime.bigint() - inicio) / 1e6;
}

function criarOperacaoIdEventoBruto() {
  return `evento_bruto_${Date.now()}_${proximoIdOperacaoEventoBruto++}`;
}

function logPerfEventoBruto(tag, payload = {}) {
  console.log(tag, {
    operacaoId: payload.operacaoId || "",
    rodadaId: payload.rodadaId || "",
    clienteId: payload.clienteId || "",
    origem: payload.origem || "",
    origemTipo: payload.origemTipo || "",
    sessaoId: payload.sessaoId || "",
    grupoId: payload.grupoId || "",
    tamanhoTextoOriginal: Number(payload.tamanhoTextoOriginal || 0),
    indiceItem: Number(payload.indiceItem || 0),
    totalItens: Number(payload.totalItens || 0),
    chamadasAtivasDaOperacao: Number(payload.chamadasAtivasDaOperacao || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    duracaoTotalMs: payload.duracaoTotalMs,
    tempoPoolMs: payload.tempoPoolMs,
    tempoSqlMs: payload.tempoSqlMs,
    sucesso: payload.sucesso,
    encontrouDuplicado: payload.encontrouDuplicado,
    erroMensagem: payload.erroMensagem || ""
  });
}

function dominioUrl(url = "") {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function gerarHashEvento(evento = {}) {
  const base = JSON.stringify({
    grupoId: evento.grupoId || "",
    textoOriginal: evento.textoOriginal || "",
    linksExtraidos: evento.linksExtraidos || []
  });

  return crypto.createHash("sha256").update(base).digest("hex");
}

function marketplacePrincipal(links = []) {
  return (links || []).map(detectarMarketplaceLink).find(Boolean) || "";
}

async function existeEventoDuplicado(evento = {}, contextoPerf = {}) {
  const inicio = process.hrtime.bigint();
  const operacaoId = criarOperacaoIdEventoBruto();
  chamadasAtivasEventoBruto += 1;
  const contextoLog = {
    operacaoId,
    rodadaId: contextoPerf.rodadaId || "",
    clienteId: contextoPerf.clienteId || "",
    origem: contextoPerf.origem || evento.origem || "",
    origemTipo: contextoPerf.origemTipo || evento.origemTipo || "",
    sessaoId: contextoPerf.sessaoId || evento.sessaoId || "",
    grupoId: contextoPerf.grupoId || evento.grupoId || "",
    tamanhoTextoOriginal: String(evento.textoOriginal || "").length,
    indiceItem: contextoPerf.indiceItem || 0,
    totalItens: contextoPerf.totalItens || 1,
    chamadasAtivasDaOperacao: chamadasAtivasEventoBruto
  };

  logPerfEventoBruto("[PERF ENGINE EVENTO BRUTO INICIO]", contextoLog);

  try {
    const resultado = await queryEngine(
      `SELECT id
         FROM engine_eventos_brutos
        WHERE COALESCE(grupo_id, '') = COALESCE($1, '')
          AND COALESCE(texto_original, '') = COALESCE($2, '')
          AND links_extraidos = $3::jsonb
          AND criado_em >= NOW() - INTERVAL '5 minutes'
        ORDER BY id DESC
        LIMIT 1`,
      [evento.grupoId, evento.textoOriginal, JSON.stringify(evento.linksExtraidos)]
    );

    const duplicado = resultado.ok ? (resultado.resultado.rows[0] || null) : null;
    chamadasAtivasEventoBruto = Math.max(0, chamadasAtivasEventoBruto - 1);
    logPerfEventoBruto("[PERF ENGINE EVENTO BRUTO FIM]", {
      ...contextoLog,
      chamadasAtivasDaOperacao: chamadasAtivasEventoBruto,
      duracaoTotalMs: Math.round(perfMsEventoBruto(inicio)),
      tempoPoolMs: resultado.metricas?.tempoPoolMs ?? null,
      tempoSqlMs: resultado.metricas?.tempoSqlMs ?? null,
      sucesso: Boolean(resultado.ok),
      encontrouDuplicado: Boolean(duplicado),
      erroMensagem: resultado.ok ? "" : String(resultado.erro || resultado.motivo || "").slice(0, 180)
    });

    if (!resultado.ok) return null;
    return duplicado;
  } catch (e) {
    chamadasAtivasEventoBruto = Math.max(0, chamadasAtivasEventoBruto - 1);
    logPerfEventoBruto("[PERF ENGINE EVENTO BRUTO FIM]", {
      ...contextoLog,
      chamadasAtivasDaOperacao: chamadasAtivasEventoBruto,
      duracaoTotalMs: Math.round(perfMsEventoBruto(inicio)),
      tempoPoolMs: null,
      tempoSqlMs: null,
      sucesso: false,
      encontrouDuplicado: false,
      erroMensagem: String(e.message || "erro_inesperado").slice(0, 180)
    });
    throw e;
  }
}

function localizarRedirectRadar(metadata = {}, linkResolvido = "") {
  const redirects = Array.isArray(metadata?.redirectsRadar) ? metadata.redirectsRadar : [];
  return redirects.find(item => String(item?.linkResolvido || "") === String(linkResolvido || "")) || null;
}

async function salvarLinksEvento(eventoId, links = [], metadataEvento = {}) {
  for (const link of links) {
    const redirectRadar = localizarRedirectRadar(metadataEvento, link);
    const urlOriginal = redirectRadar?.linkOriginalCapturado || link;
    const urlNormalizada = normalizarUrl(urlOriginal);
    const urlExpandida = redirectRadar?.linkResolvido || null;
    const marketplaceDetectado = detectarMarketplaceLink(urlExpandida || urlNormalizada || urlOriginal);
    const resultado = await queryEngine(
      `INSERT INTO engine_links (
         evento_id, url_original, url_normalizada, url_expandida,
         dominio_original, dominio_final, redirect_ok, motivo_redirect,
         marketplace_detectado, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        eventoId,
        urlOriginal,
        urlNormalizada,
        urlExpandida,
        dominioUrl(urlOriginal),
        urlExpandida ? dominioUrl(urlExpandida) : null,
        redirectRadar ? redirectRadar.status === "resolvido" : null,
        redirectRadar ? (redirectRadar.motivo || redirectRadar.status || "") : null,
        marketplaceDetectado,
        JSON.stringify({
          fase: "1.1",
          linkOriginalCapturado: redirectRadar?.linkOriginalCapturado || "",
          linkResolvido: redirectRadar?.linkResolvido || "",
          tipoLink: redirectRadar ? "redirect_conhecido" : "direto"
        })
      ]
    );

    if (!resultado.ok) {
      logEngineEventoBrutoErro({ eventoId, motivo: "link_insert_falhou", erro: resultado.erro || resultado.motivo || "" });
    }
  }
}

async function registrarEventoBruto(eventoBruto = {}, opcoes = {}) {
  const evento = normalizarEventoBruto(eventoBruto);
  const hashEvento = eventoBruto.hashEvento || eventoBruto.hash_evento || gerarHashEvento(evento);
  const marketplaceDetectado = eventoBruto.marketplaceDetectado || eventoBruto.marketplace_detectado || marketplacePrincipal(evento.linksExtraidos);

  try {
    const duplicado = await existeEventoDuplicado(evento, {
      ...(opcoes.perf || {}),
      clienteId: opcoes.perf?.clienteId || (Array.isArray(opcoes.clientes) ? opcoes.clientes[0] : ""),
      origem: evento.origem,
      origemTipo: evento.origemTipo,
      sessaoId: evento.sessaoId,
      grupoId: evento.grupoId
    });
    if (duplicado) {
      logEngineEventoBrutoDuplicado({ id: duplicado.id, grupoId: evento.grupoId, links: evento.linksExtraidos.length });
      return { ok: true, duplicado: true, id: duplicado.id };
    }

    const insert = await queryEngine(
      `INSERT INTO engine_eventos_brutos (
         origem, fonte, origem_tipo, sessao_id, grupo_id, grupo_nome,
         texto_original, links_extraidos, marketplace_detectado, hash_evento,
         metadata, capturado_em
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)
       ON CONFLICT (hash_evento) WHERE hash_evento IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        evento.origem,
        eventoBruto.fonte || evento.origem || "radar",
        evento.origemTipo,
        evento.sessaoId,
        evento.grupoId,
        evento.grupoNome,
        evento.textoOriginal,
        JSON.stringify(evento.linksExtraidos),
        marketplaceDetectado,
        hashEvento,
        JSON.stringify(eventoBruto.metadata || {}),
        evento.capturadoEm
      ]
    );

    if (!insert.ok) {
      logEngineEventoBrutoErro({ motivo: insert.motivo || "insert_falhou", erro: insert.erro || "" });
      return { ok: false, motivo: insert.motivo || "insert_falhou", erro: insert.erro || "" };
    }

    const id = insert.resultado.rows[0]?.id;
    if (!id) {
      logEngineEventoBrutoDuplicado({ grupoId: evento.grupoId, links: evento.linksExtraidos.length, hashEvento });
      return { ok: true, duplicado: true, id: null };
    }

    await salvarLinksEvento(id, evento.linksExtraidos, eventoBruto.metadata || {});

    logEngineEventoBrutoSalvo({ id, origem: evento.origem, origemTipo: evento.origemTipo, grupoId: evento.grupoId, links: evento.linksExtraidos.length });

    const clientes = opcoes.clientes || eventoBruto.clientes || ["admin"];
    await criarJobsParaClientes({
      eventoId: id,
      clientes,
      marketplaceDetectado,
      linksExtraidos: evento.linksExtraidos,
      metadataEvento: eventoBruto.metadata || {}
    });

    return { ok: true, id, duplicado: false };
  } catch (e) {
    logEngineEventoBrutoErro({ motivo: "erro_inesperado", erro: e.message });
    return { ok: false, motivo: "erro_inesperado", erro: e.message };
  }
}

module.exports = {
  registrarEventoBruto
};
