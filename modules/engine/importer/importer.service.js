const { queryEngine } = require("../database");
const {
  marcarJobStatus,
  registrarProcessamento,
  carregarEventoBruto,
  carregarLinksEvento,
  limitarJobs
} = require("../processor.service");
const { normalizarTexto } = require("../normalizers");
const { classificarCategoriaOferta } = require("../../../marketplaces/inteligencia/classificador-categorias");
const {
  logEngineImporterErro,
  logEngineImporterOfertaCriada
} = require("../logger");

let engineOfertasMetadataDisponivel = null;

async function engineOfertasTemMetadata() {
  if (engineOfertasMetadataDisponivel !== null) return engineOfertasMetadataDisponivel;

  const resultado = await queryEngine(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_name = 'engine_ofertas'
          AND column_name = 'metadata'
     ) AS existe`
  );

  engineOfertasMetadataDisponivel = Boolean(resultado.ok && resultado.resultado.rows[0]?.existe);
  return engineOfertasMetadataDisponivel;
}

function normalizarNumero(valor = null) {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = String(valor)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!texto) return null;

  let numero = Number(texto);
  if (!Number.isFinite(numero)) {
    numero = Number(texto.replace(/\./g, "").replace(",", "."));
  }

  return Number.isFinite(numero) ? numero : null;
}

function categoriaGenericaEngine(categoria = "") {
  const texto = normalizarTexto(categoria)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return !texto || texto === "mercadolivre" || texto === "ml" || texto === "marketplace" || texto === "generica" || texto === "geral";
}

function resolverCategoriaEngine(resultado = {}, job = {}) {
  const categoria = normalizarTexto(resultado.categoria || resultado.categoriaProduto || "");
  if (!categoriaGenericaEngine(categoria)) return categoria;

  const titulo = normalizarTexto(resultado.titulo || resultado.nome || "");
  return classificarCategoriaOferta({
    titulo,
    nome: titulo,
    marketplace: resultado.marketplace || job.marketplace || job.marketplace_detectado || ""
  }, titulo);
}
function normalizarTitulo(titulo = "") {
  return normalizarTexto(titulo)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function buscarJobsProntos({ limite = 10, marketplace = "" } = {}) {
  const params = [];
  const filtros = ["status = 'pronto_para_importar'"];
  const marketplaceExpr = "LOWER(COALESCE(NULLIF(TRIM(marketplace), ''), NULLIF(TRIM(marketplace_detectado), ''), ''))";
  const marketplaceFiltro = String(marketplace || "").trim().toLowerCase();

  if (marketplaceFiltro) {
    params.push(marketplaceFiltro);
    filtros.push(`${marketplaceExpr} = $${params.length}`);
  }

  params.push(limitarJobs(limite));

  const resultado = await queryEngine(
    `SELECT id, uuid, evento_id, oferta_id, cliente_id, marketplace_detectado,
            marketplace, status, motivo_final, criado_em, atualizado_em
       FROM engine_jobs_cliente
      WHERE ${filtros.join(" AND ")}
      ORDER BY atualizado_em ASC NULLS FIRST, id ASC
      LIMIT $${params.length}`,
    params
  );

  const resumoMarketplace = await queryEngine(
    `SELECT ${marketplaceExpr} AS marketplace, COUNT(*)::int AS total
       FROM engine_jobs_cliente
      WHERE status = 'pronto_para_importar'
      GROUP BY ${marketplaceExpr}
      ORDER BY total DESC, marketplace ASC
      LIMIT 20`
  );

  const amostra = await queryEngine(
    `SELECT id, cliente_id, marketplace, marketplace_detectado, status, motivo_final,
            atualizado_em
       FROM engine_jobs_cliente
      WHERE status = 'pronto_para_importar'
      ORDER BY atualizado_em ASC NULLS FIRST, id ASC
      LIMIT 5`
  );

  console.log("[ENGINE-IMPORTER-BUSCA-JOBS]", {
    statusBuscado: "pronto_para_importar",
    marketplaceFiltro,
    totalEncontrados: resultado.ok ? resultado.resultado.rows.length : 0,
    totalProntoPorMarketplace: resumoMarketplace.ok ? resumoMarketplace.resultado.rows : [],
    amostraJobs: amostra.ok ? amostra.resultado.rows : [],
    erro: resultado.ok ? "" : (resultado.erro || resultado.motivo || "")
  });

  if (!resultado.ok) return { ok: false, jobs: [], motivo: resultado.motivo, erro: resultado.erro };
  return { ok: true, jobs: resultado.resultado.rows };
}
async function tentarMarcarImportando(jobId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'importando', atualizado_em = NOW()
      WHERE id = $1 AND status = 'pronto_para_importar'
      RETURNING id, status`,
    [jobId]
  );

  if (!resultado.ok) return { ok: false, motivo: resultado.motivo, erro: resultado.erro };
  return { ok: resultado.resultado.rowCount > 0, ignorado: resultado.resultado.rowCount === 0 };
}

async function registrarEtapaImportacao(jobId, etapa, status, motivo = "", detalhes = {}) {
  return registrarProcessamento(jobId, etapa, status, motivo, {
    ...detalhes,
    fase: "importacao"
  });
}

function normalizarOfertaImportada(resultado = {}, job = {}) {
  return {
    ok: resultado.ok !== false,
    marketplace: normalizarTexto(resultado.marketplace || job.marketplace || job.marketplace_detectado),
    titulo: normalizarTexto(resultado.titulo || resultado.nome || ""),
    tituloNormalizado: normalizarTitulo(resultado.titulo || resultado.nome || ""),
    preco: normalizarNumero(resultado.preco ?? resultado.precoAtual),
    precoOriginal: normalizarNumero(resultado.precoOriginal ?? resultado.precoAntigo),
    imagem: normalizarTexto(resultado.imagem || resultado.image || ""),
    linkOriginal: normalizarTexto(resultado.linkOriginal || ""),
    linkExpandido: normalizarTexto(resultado.linkExpandido || resultado.urlFinal || ""),
    linkAfiliado: normalizarTexto(resultado.linkAfiliado || resultado.linkFinal || resultado.link || ""),
    categoria: resolverCategoriaEngine(resultado, job),
    cupom: normalizarTexto(resultado.cupom || ""),
    cupomTipo: normalizarTexto(resultado.cupomTipo || resultado.tipoCupom || ""),
    score: normalizarNumero(resultado.score),
    metadata: resultado.metadata || resultado
  };
}

async function gravarOfertaEngine(job = {}, evento = {}, link = {}, ofertaEntrada = {}) {
  const oferta = normalizarOfertaImportada(ofertaEntrada, job);
  const valores = [
    job.evento_id,
    link?.id || null,
    oferta.marketplace,
    oferta.titulo,
    oferta.tituloNormalizado,
    oferta.preco,
    oferta.precoOriginal,
    oferta.cupom,
    oferta.cupomTipo,
    ofertaEntrada.beneficioExtra || "",
    oferta.imagem,
    oferta.linkOriginal || link?.url_original || "",
    oferta.linkExpandido || link?.url_expandida || link?.url_normalizada || "",
    oferta.linkAfiliado,
    oferta.categoria,
    oferta.score,
    evento?.capturado_em || new Date()
  ];

  let resultado;
  const metadataOferta = JSON.stringify(oferta.metadata || ofertaEntrada.metadata || {});
  const usarMetadata = await engineOfertasTemMetadata();

  if (job.oferta_id) {
    if (usarMetadata) {
      resultado = await queryEngine(
        `UPDATE engine_ofertas
            SET evento_id = $1,
                link_id = $2,
                marketplace = $3,
                titulo = $4,
                titulo_normalizado = $5,
                preco = $6,
                preco_original = $7,
                moeda = 'BRL',
                cupom = $8,
                tipo_cupom = $9,
                beneficio_extra = $10,
                imagem = $11,
                link_original = $12,
                link_expandido = $13,
                link_afiliado = $14,
                categoria = $15,
                score = $16,
                origem = 'engine_importer',
                status = 'importada',
                motivo_status = NULL,
                capturada_em = $17,
                metadata = $18::jsonb,
                atualizada_em = NOW()
          WHERE id = $19
          RETURNING id, uuid`,
        [...valores, metadataOferta, job.oferta_id]
      );
    } else {
      resultado = await queryEngine(
        `UPDATE engine_ofertas
            SET evento_id = $1,
                link_id = $2,
                marketplace = $3,
                titulo = $4,
                titulo_normalizado = $5,
                preco = $6,
                preco_original = $7,
                moeda = 'BRL',
                cupom = $8,
                tipo_cupom = $9,
                beneficio_extra = $10,
                imagem = $11,
                link_original = $12,
                link_expandido = $13,
                link_afiliado = $14,
                categoria = $15,
                score = $16,
                origem = 'engine_importer',
                status = 'importada',
                motivo_status = NULL,
                capturada_em = $17,
                atualizada_em = NOW()
          WHERE id = $18
          RETURNING id, uuid`,
        [...valores, job.oferta_id]
      );
    }
  } else if (usarMetadata) {
    resultado = await queryEngine(
      `INSERT INTO engine_ofertas (
         evento_id, link_id, marketplace, titulo, titulo_normalizado,
         preco, preco_original, moeda, cupom, tipo_cupom, beneficio_extra,
         imagem, link_original, link_expandido, link_afiliado, categoria,
         score, prioridade, origem, status, motivo_status, capturada_em, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, $10, $11, $12, $13, $14, $15, $16, 0, 'engine_importer', 'importada', NULL, $17, $18::jsonb)
       RETURNING id, uuid`,
      [...valores, metadataOferta]
    );
  } else {
    resultado = await queryEngine(
      `INSERT INTO engine_ofertas (
         evento_id, link_id, marketplace, titulo, titulo_normalizado,
         preco, preco_original, moeda, cupom, tipo_cupom, beneficio_extra,
         imagem, link_original, link_expandido, link_afiliado, categoria,
         score, prioridade, origem, status, motivo_status, capturada_em
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, $10, $11, $12, $13, $14, $15, $16, 0, 'engine_importer', 'importada', NULL, $17)
       RETURNING id, uuid`,
      valores
    );
  }

  if (!resultado.ok) {
    logEngineImporterErro({ jobId: job.id, etapa: "oferta_gravada", motivo: resultado.motivo, erro: resultado.erro || "" });
    return { ok: false, motivo: resultado.motivo || "oferta_gravacao_falhou", erro: resultado.erro || "" };
  }

  const ofertaId = resultado.resultado.rows[0]?.id;
  if (!ofertaId) {
    return { ok: false, motivo: "oferta_nao_retornada" };
  }

  logEngineImporterOfertaCriada({
    jobId: job.id,
    ofertaId,
    clienteId: job.cliente_id || job.clienteId || "",
    marketplace: oferta.marketplace,
    titulo: oferta.titulo,
    preco: oferta.preco,
    precoOriginal: oferta.precoOriginal,
    cupom: oferta.cupom,
    linkAfiliado: oferta.linkAfiliado,
    categoria: oferta.categoria,
    status: "importada",
    atualizada: Boolean(job.oferta_id)
  });
  return { ok: true, ofertaId, ofertaUuid: resultado.resultado.rows[0]?.uuid, oferta };
}
async function marcarJobOfertaCriada(jobId, ofertaId) {
  const resultado = await queryEngine(
    `UPDATE engine_jobs_cliente
        SET status = 'oferta_criada', oferta_id = $2, motivo_final = 'oferta_criada', atualizado_em = NOW()
      WHERE id = $1
      RETURNING id, status, oferta_id`,
    [jobId, ofertaId]
  );

  if (!resultado.ok) {
    logEngineImporterErro({ jobId, etapa: "marcar_oferta_criada", motivo: resultado.motivo, erro: resultado.erro || "" });
  }

  return resultado;
}

async function marcarJobErroImportacao(jobId, motivo = "erro_importacao", detalhes = {}) {
  await registrarEtapaImportacao(jobId, "importacao_finalizada", "erro", motivo, detalhes);
  return marcarJobStatus(jobId, "erro_importacao", motivo);
}

module.exports = {
  buscarJobsProntos,
  tentarMarcarImportando,
  registrarEtapaImportacao,
  carregarEventoBruto,
  carregarLinksEvento,
  gravarOfertaEngine,
  marcarJobOfertaCriada,
  marcarJobErroImportacao,
  normalizarOfertaImportada
};
