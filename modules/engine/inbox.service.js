const crypto = require("crypto");

const { queryEngine, getEnginePool } = require("./database");
const { criarJobsParaClientes } = require("./jobs.service");
const { avaliarWorkspaceParaEngine } = require("../workspace");
const {
  persistirCapturaComIntencoes,
  promoverProximaIntencao
} = require("./radar-replay.candidate");
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
const coberturaRadar = require("../radar/cobertura-v1");
const { classificarLinkEngine } = require("./link-role.service");
const { resolverOrigemFluxo } = require("../../utils/origem-fluxo");
const { verificarCapturaIngressReal } = require("./universal-ingress-fence");

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
  const capturadoEmMs = new Date(evento.capturadoEm || Date.now()).getTime();
  const janelaCincoMinutosMs = 5 * 60 * 1000;
  const bucketCaptura = Number.isFinite(capturadoEmMs)
    ? Math.floor(capturadoEmMs / janelaCincoMinutosMs)
    : Math.floor(Date.now() / janelaCincoMinutosMs);
  const base = JSON.stringify({
    origem: evento.origem || "",
    grupoId: evento.grupoId || "",
    textoOriginal: evento.textoOriginal || "",
    linksExtraidos: evento.linksExtraidos || [],
    bucketCaptura
  });

  return crypto.createHash("sha256").update(base).digest("hex");
}

function marketplacePrincipal(links = []) {
  return (links || []).map(detectarMarketplaceLink).find(Boolean) || "";
}

function jsonbParam(valor, fallback) {
  const base = sanitizarJsonbValor(valor === undefined ? fallback : valor);
  const serializado = JSON.stringify(base);
  return serializado === undefined ? JSON.stringify(fallback) : serializado;
}

function diagnosticoJsonbSeguro(valor, serializado = "") {
  let stringifyOk = true;
  try {
    JSON.stringify(valor);
  } catch (_) {
    stringifyOk = false;
  }

  let parseOk = true;
  try {
    JSON.parse(serializado);
  } catch (_) {
    parseOk = false;
  }

  return {
    tipo: typeof valor,
    array: Array.isArray(valor),
    tamanhoSerializado: Buffer.byteLength(String(serializado || ""), "utf8"),
    hashSerializado: crypto.createHash("sha256").update(String(serializado || "")).digest("hex"),
    jsonStringifyOk: stringifyOk,
    jsonParseSerializadoOk: parseOk
  };
}

function diagnosticoErroInsertEvento({ insert = {}, linksExtraidos, linksSerializados, metadata, metadataSerializada } = {}) {
  return {
    operacao: "evento_insert",
    postgres: {
      code: insert.erroCodigo || null,
      position: insert.erroPosicao || null,
      detail: insert.erroDetalhe || null,
      constraint: insert.erroConstraint || null
    },
    parametros: {
      links_extraidos: diagnosticoJsonbSeguro(linksExtraidos, linksSerializados),
      metadata: diagnosticoJsonbSeguro(metadata, metadataSerializada)
    }
  };
}

function sanitizarJsonbValor(valor) {
  if (typeof valor === "string") {
    let textoSanitizado = "";
    for (let indice = 0; indice < valor.length; indice += 1) {
      const codigo = valor.charCodeAt(indice);
      const highSurrogate = codigo >= 0xD800 && codigo <= 0xDBFF;
      const lowSurrogate = codigo >= 0xDC00 && codigo <= 0xDFFF;

      if (highSurrogate) {
        const proximo = valor.charCodeAt(indice + 1);
        if (proximo >= 0xDC00 && proximo <= 0xDFFF) {
          textoSanitizado += valor[indice] + valor[indice + 1];
          indice += 1;
        } else {
          textoSanitizado += "\uFFFD";
        }
      } else if (lowSurrogate) {
        textoSanitizado += "\uFFFD";
      } else {
        textoSanitizado += valor[indice];
      }
    }
    return textoSanitizado.replace(/\u0000/g, "");
  }
  if (Array.isArray(valor)) {
    return valor.map(sanitizarJsonbValor);
  }
  if (valor && typeof valor === "object") {
    const saida = {};
    for (const [chave, item] of Object.entries(valor)) {
      saida[sanitizarJsonbValor(chave)] = sanitizarJsonbValor(item);
    }
    return saida;
  }
  return valor;
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
        WHERE COALESCE(origem, '') = COALESCE($1, '')
          AND COALESCE(grupo_id, '') = COALESCE($2, '')
          AND COALESCE(texto_original, '') = COALESCE($3, '')
          AND links_extraidos = $4::jsonb
          AND criado_em >= NOW() - INTERVAL '5 minutes'
        ORDER BY id DESC
        LIMIT 1`,
      [evento.origem, evento.grupoId, evento.textoOriginal, jsonbParam(evento.linksExtraidos, [])]
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

function listarRedirectsEvento(metadata = {}) {
  return [
    ...(Array.isArray(metadata?.redirectsRadar) ? metadata.redirectsRadar : []),
    ...(Array.isArray(metadata?.redirects) ? metadata.redirects : []),
    ...(Array.isArray(metadata?.clonadorGrupos?.redirects) ? metadata.clonadorGrupos.redirects : [])
  ];
}

function urlResolvidaRedirect(item = {}) {
  return item?.linkResolvido || item?.urlExpandida || item?.urlFinal || "";
}

function localizarRedirectEvento(metadata = {}, linkResolvido = "") {
  const alvo = String(linkResolvido || "");
  return listarRedirectsEvento(metadata).find(item =>
    String(urlResolvidaRedirect(item)) === alvo ||
    String(item?.linkOriginalCapturado || "") === alvo
  ) || null;
}

async function salvarLinksEvento(eventoId, links = [], metadataEvento = {}, evento = {},
  { query = queryEngine, estrito = false } = {}) {
  for (const link of links) {
    const redirectEvento = localizarRedirectEvento(metadataEvento, link);
    const urlOriginal = redirectEvento?.linkOriginalCapturado || link;
    const urlNormalizada = normalizarUrl(urlOriginal);
    const urlExpandida = urlResolvidaRedirect(redirectEvento) || null;
    const marketplaceDetectado = detectarMarketplaceLink(urlExpandida || urlNormalizada || urlOriginal);
    const classificacao = classificarLinkEngine({
      marketplace: marketplaceDetectado,
      evento,
      link: {
        url_original: urlOriginal,
        url_normalizada: urlNormalizada,
        url_expandida: urlExpandida,
        marketplace_detectado: marketplaceDetectado,
        metadata: {
          linkOriginalCapturado: redirectEvento?.linkOriginalCapturado || "",
          linkResolvido: urlResolvidaRedirect(redirectEvento)
        }
      },
      url: urlExpandida || urlNormalizada || urlOriginal
    });
    const resultado = await query(
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
        redirectEvento ? redirectEvento.status === "resolvido" : null,
        redirectEvento ? (redirectEvento.motivo || redirectEvento.status || "") : null,
        marketplaceDetectado,
        jsonbParam({
          fase: "1.1",
          linkOriginalCapturado: redirectEvento?.linkOriginalCapturado || "",
          linkResolvido: urlResolvidaRedirect(redirectEvento),
          tipoLink: redirectEvento ? "redirect_conhecido" : "direto",
          papelLink: classificacao.papelLink,
          papelLinkMotivo: classificacao.motivo,
          papelLinkConfianca: classificacao.confianca,
          urlProduto: classificacao.urlProduto || ""
        }, {})
      ]
    );

    if (!resultado.ok) {
      logEngineEventoBrutoErro({ eventoId, motivo: "link_insert_falhou", erro: resultado.erro || resultado.motivo || "" });
      if (estrito) throw new Error("radar_intent_link_insert_failed");
    }
  }
}

// Opt-in local candidate. The ordinary Radar/Clonador/TeleRadar path is
// unchanged until a separate gate approves the schema and bootstrap.
async function registrarRadarComReplayCandidato({ evento, eventoBruto, opcoes,
  hashEvento, marketplaceDetectado, metadataEvento }) {
  const pool = getEnginePool();
  if (!pool) return { ok: false, motivo: "radar_intent_pool_indisponivel" };
  const clientes = Array.isArray(opcoes.clientes) ? opcoes.clientes : [];
  const validarWorkspace = typeof opcoes.validarWorkspaceRadarCandidate === "function"
    ? opcoes.validarWorkspaceRadarCandidate
    : id => avaliarWorkspaceParaEngine(id, { origemFluxo: "optimus" }).elegivelEngine === true;
  const client = await pool.connect();
  let persisted;
  try {
    persisted = await persistirCapturaComIntencoes(client, {
      hashEvento, clientes, validarWorkspace,
      origemTipo: evento.origemTipo, sessaoId: evento.sessaoId,
      grupoId: evento.grupoId, grupoNome: evento.grupoNome,
      textoOriginal: evento.textoOriginal, linksExtraidos: evento.linksExtraidos,
      marketplaceDetectado, metadata: metadataEvento,
      capturadoEm: evento.capturadoEm
    }, {
      persistLinks: async (db, id) => salvarLinksEvento(id, evento.linksExtraidos,
        metadataEvento, evento, {
          query: async (sql, params) => ({ ok: true,
            resultado: await db.query(sql, params) }), estrito: true
        })
    });
  } catch (error) {
    return { ok: false, motivo: "radar_intent_persist_failed",
      erro: String(error.message || error) };
  } finally {
    client.release();
  }
  let jobsCriados = 0;
  let jobsExistentes = 0;
  const clientesAdmissaoPendente = [];
  for (const clienteId of clientes) {
    const worker = await pool.connect();
    try {
      const promoted = await promoverProximaIntencao(worker, {
        eventoId: persisted.eventoId, clienteId,
        criarJob: intent => criarJobsParaClientes({
          eventoId: intent.evento_id, clientes: [intent.cliente_id],
          marketplaceDetectado: intent.marketplace_detectado || "",
          linksExtraidos: intent.links_extraidos || [],
          metadataEvento: intent.metadata || {}
        })
      });
      if (promoted.estado === "admission_negada") clientesAdmissaoPendente.push(clienteId);
      if (promoted.estado === "criada") jobsCriados += 1;
      if (promoted.estado === "existente") jobsExistentes += 1;
    } catch (error) {
      return { ok: false, motivo: "radar_intent_replay_failed",
        erro: String(error.message || error), id: persisted.eventoId,
        clientesAdmissaoPendente: [clienteId] };
    } finally {
      worker.release();
    }
  }
  if (clientesAdmissaoPendente.length) return { ok: false,
    motivo: "hot_admission_denied", id: persisted.eventoId,
    duplicado: !persisted.novoEvento, jobsCriados, jobsExistentes,
    clientesAdmissaoPendente };
  return { ok: true, id: persisted.eventoId, duplicado: !persisted.novoEvento,
    jobsCriados, jobsExistentes };
}

async function registrarEventoBruto(eventoBruto = {}, opcoes = {}) {
  const epochIngress = verificarCapturaIngressReal(
    eventoBruto.capturadoEm || eventoBruto.capturado_em);
  if (!epochIngress.ok) {
    return { ok: false, motivo: epochIngress.reason,
      jobsCriados: 0, jobsExistentes: 0 };
  }
  const fonteAutomatica = String(eventoBruto.fonte || eventoBruto.origem || "")
    .trim().toLowerCase();
  if (["radar", "teleradar", "clonador_grupos"].includes(fonteAutomatica)) {
    const capturaOriginal = eventoBruto.capturadoEm || eventoBruto.capturado_em;
    if (!capturaOriginal || !Number.isFinite(new Date(capturaOriginal).getTime())) {
      return { ok: false, motivo: "captura_sem_tempo_factual" };
    }
  }
  const evento = normalizarEventoBruto(eventoBruto);
  const hashEventoExplicito = Boolean(eventoBruto.hashEvento || eventoBruto.hash_evento);
  const idempotenciaTransporteTeleRadar = hashEventoExplicito && eventoBruto.fonte === "teleradar";
  const hashEvento = eventoBruto.hashEvento || eventoBruto.hash_evento || gerarHashEvento(evento);
  const marketplaceDetectado = eventoBruto.marketplaceDetectado || eventoBruto.marketplace_detectado || marketplacePrincipal(evento.linksExtraidos);
  const metadataEvento = eventoBruto.metadata && typeof eventoBruto.metadata === "object" ? eventoBruto.metadata : {};
  const origemFluxo = resolverOrigemFluxo(eventoBruto, { metadata: metadataEvento });
  const metadataEventoFinal = origemFluxo ? { ...metadataEvento, origemFluxo } : metadataEvento;
  const clientes = opcoes.clientes || eventoBruto.clientes || ["admin"];
  if (opcoes.radarReplayCandidate === true && eventoBruto.fonte === "radar") {
    return registrarRadarComReplayCandidato({ evento, eventoBruto, opcoes,
      hashEvento, marketplaceDetectado, metadataEvento: metadataEventoFinal });
  }
  const contextoCobertura = {
    coberturaTraceId: eventoBruto.coberturaTraceId || metadataEvento.coberturaTraceId || "",
    fidelidadeTraceId: eventoBruto.fidelidadeTraceId || metadataEvento.fidelidadeTraceId || "",
    clienteId: Array.isArray(opcoes.clientes) ? opcoes.clientes[0] : "",
    sessaoId: evento.sessaoId,
    grupoId: evento.grupoId,
    grupoNome: evento.grupoNome,
    marketplace: marketplaceDetectado,
    links: evento.linksExtraidos,
    chaveDeduplicacao: hashEvento
  };
  coberturaRadar.registrar("engine_evento_inicio", {
    ...contextoCobertura,
    decisao: "iniciado"
  });

  try {
    const duplicado = idempotenciaTransporteTeleRadar
      ? null
      : await existeEventoDuplicado(evento, {
          ...(opcoes.perf || {}),
          clienteId: opcoes.perf?.clienteId || (Array.isArray(opcoes.clientes) ? opcoes.clientes[0] : ""),
          origem: evento.origem,
          origemTipo: evento.origemTipo,
          sessaoId: evento.sessaoId,
          grupoId: evento.grupoId
        });
    if (duplicado) {
      const jobs = await criarJobsParaClientes({
        eventoId: duplicado.id,
        clientes,
        marketplaceDetectado,
        linksExtraidos: evento.linksExtraidos,
        metadataEvento: metadataEventoFinal
      });
      if (jobs.motivo === "hot_admission_denied") {
        return { ok: false, motivo: jobs.motivo, id: duplicado.id,
          duplicado: true, jobsCriados: jobs.criados,
          jobsExistentes: jobs.existentes,
          clientesAdmissaoPendente: jobs.clientesAdmissaoPendente };
      }
      if (jobs.ok === false) {
        return { ok: false, motivo: jobs.motivo || "jobs_not_created",
          id: duplicado.id, duplicado: true,
          jobsCriados: Number(jobs.criados || 0),
          jobsExistentes: Number(jobs.existentes || 0) };
      }
      logEngineEventoBrutoDuplicado({ id: duplicado.id, grupoId: evento.grupoId, links: evento.linksExtraidos.length });
      coberturaRadar.registrar("engine_evento_duplicado", {
        ...contextoCobertura,
        decisao: "reaproveitado",
        motivo: "duplicidade",
        eventoEngineId: duplicado.id,
        eventoOriginalId: duplicado.id,
        jobNovoCriado: Number(jobs.criados || 0) > 0
      });
      return {
        ok: true,
        duplicado: true,
        id: duplicado.id,
        jobsCriados: Number(jobs.criados || 0),
        jobsExistentes: Number(jobs.existentes || 0),
        ...(coberturaRadar.flagAtiva() ? { hashEvento, jobNovoCriado: Number(jobs.criados || 0) > 0 } : {})
      };
    }

    const linksSerializados = jsonbParam(evento.linksExtraidos, []);
    const metadataSerializada = jsonbParam(metadataEventoFinal, {});
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
        linksSerializados,
        marketplaceDetectado,
        hashEvento,
        metadataSerializada,
        evento.capturadoEm
      ]
    );

    if (!insert.ok) {
      const diagnostico = diagnosticoErroInsertEvento({
        insert,
        linksExtraidos: evento.linksExtraidos,
        linksSerializados,
        metadata: metadataEventoFinal,
        metadataSerializada
      });
      logEngineEventoBrutoErro({ motivo: insert.motivo || "insert_falhou", erro: insert.erro || "", diagnostico });
      coberturaRadar.registrar("engine_evento_erro", {
        ...contextoCobertura,
        decisao: "erro",
        motivo: insert.motivo || "insert_falhou",
        erro: insert.erro || ""
      });
      return { ok: false, motivo: insert.motivo || "insert_falhou", erro: insert.erro || "", diagnostico };
    }

    const id = insert.resultado.rows[0]?.id;
    if (!id) {
      const existente = await queryEngine(
        `SELECT id
           FROM engine_eventos_brutos
          WHERE hash_evento = $1
          ORDER BY id DESC
          LIMIT 1`,
        [hashEvento]
      );
      const eventoExistenteId = existente.ok ? existente.resultado.rows[0]?.id : null;
      const jobs = eventoExistenteId
        ? await criarJobsParaClientes({
            eventoId: eventoExistenteId,
            clientes,
            marketplaceDetectado,
            linksExtraidos: evento.linksExtraidos,
            metadataEvento: metadataEventoFinal
          })
        : { criados: 0, existentes: 0 };
      if (jobs.motivo === "hot_admission_denied") {
        return { ok: false, motivo: jobs.motivo, id: eventoExistenteId,
          duplicado: true, jobsCriados: jobs.criados,
          jobsExistentes: jobs.existentes,
          clientesAdmissaoPendente: jobs.clientesAdmissaoPendente };
      }
      if (jobs.ok === false) {
        return { ok: false, motivo: jobs.motivo || "jobs_not_created",
          id: eventoExistenteId || null, duplicado: true,
          jobsCriados: Number(jobs.criados || 0),
          jobsExistentes: Number(jobs.existentes || 0) };
      }
      logEngineEventoBrutoDuplicado({ grupoId: evento.grupoId, links: evento.linksExtraidos.length, hashEvento });
      coberturaRadar.registrar("engine_evento_duplicado", {
        ...contextoCobertura,
        decisao: "reaproveitado",
        motivo: "duplicidade",
        eventoEngineId: eventoExistenteId || "",
        eventoOriginalId: eventoExistenteId || "",
        jobNovoCriado: Number(jobs.criados || 0) > 0
      });
      return {
        ok: true,
        duplicado: true,
        id: eventoExistenteId || null,
        jobsCriados: Number(jobs.criados || 0),
        jobsExistentes: Number(jobs.existentes || 0),
        ...(coberturaRadar.flagAtiva() ? { hashEvento, jobNovoCriado: Number(jobs.criados || 0) > 0 } : {})
      };
    }

    await salvarLinksEvento(id, evento.linksExtraidos, metadataEventoFinal, evento);

    logEngineEventoBrutoSalvo({ id, origem: evento.origem, origemTipo: evento.origemTipo, grupoId: evento.grupoId, links: evento.linksExtraidos.length });

    const jobs = await criarJobsParaClientes({
      eventoId: id,
      clientes,
      marketplaceDetectado,
      linksExtraidos: evento.linksExtraidos,
      metadataEvento: metadataEventoFinal
    });
    if (jobs.motivo === "hot_admission_denied") {
      return { ok: false, motivo: jobs.motivo, id, duplicado: false,
        jobsCriados: jobs.criados, jobsExistentes: jobs.existentes,
        clientesAdmissaoPendente: jobs.clientesAdmissaoPendente };
    }
    if (jobs.ok === false) {
      return { ok: false, motivo: jobs.motivo || "jobs_not_created",
        id, duplicado: false,
        jobsCriados: Number(jobs.criados || 0),
        jobsExistentes: Number(jobs.existentes || 0) };
    }

    coberturaRadar.registrar("engine_evento_criado", {
      ...contextoCobertura,
      decisao: "aceito",
      motivo: "evento_criado",
      eventoEngineId: id,
      jobNovoCriado: Number(jobs.criados || 0) > 0
    });
    return {
      ok: true,
      id,
      duplicado: false,
      jobsCriados: Number(jobs.criados || 0),
      jobsExistentes: Number(jobs.existentes || 0),
      ...(coberturaRadar.flagAtiva() ? { hashEvento, jobNovoCriado: Number(jobs.criados || 0) > 0 } : {})
    };
  } catch (e) {
    logEngineEventoBrutoErro({ motivo: "erro_inesperado", erro: e.message });
    coberturaRadar.registrar("engine_evento_erro", {
      ...contextoCobertura,
      decisao: "erro",
      motivo: "erro_inesperado",
      erro: e.message
    });
    return { ok: false, motivo: "erro_inesperado", erro: e.message };
  }
}

module.exports = {
  registrarEventoBruto
};
