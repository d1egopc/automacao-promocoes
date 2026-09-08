const ORIGEM_FLUXO_OPTIMUS = "optimus";
const ORIGEM_FLUXO_CLONADOR_GRUPOS = "clonador_grupos";

function texto(valor = "") {
  return String(valor || "").trim().toLowerCase();
}

function objeto(valor = {}) {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

function normalizarOrigemFluxo(valor = "") {
  const origem = texto(valor);
  if (origem === ORIGEM_FLUXO_OPTIMUS) return ORIGEM_FLUXO_OPTIMUS;
  if (origem === ORIGEM_FLUXO_CLONADOR_GRUPOS) return ORIGEM_FLUXO_CLONADOR_GRUPOS;
  return "";
}

function resolverOrigemFluxoExplicita(...fontes) {
  for (const fonte of fontes) {
    const valor = objeto(fonte);
    const metadata = objeto(valor.metadata);
    const jobMetadata = objeto(valor.job_metadata || valor.jobMetadata);
    const eventoMetadata = objeto(valor.evento_metadata || valor.eventoMetadata);
    const metadataEventoJob = objeto(jobMetadata.metadataEvento);
    const metadataEventoOferta = objeto(metadata.metadataEvento);
    const candidatos = [
      valor.origemFluxo,
      valor.origem_fluxo,
      metadata.origemFluxo,
      metadata.origem_fluxo,
      jobMetadata.origemFluxo,
      jobMetadata.origem_fluxo,
      eventoMetadata.origemFluxo,
      eventoMetadata.origem_fluxo,
      metadataEventoJob.origemFluxo,
      metadataEventoJob.origem_fluxo,
      metadataEventoOferta.origemFluxo,
      metadataEventoOferta.origem_fluxo
    ];
    const origem = candidatos.map(normalizarOrigemFluxo).find(Boolean);
    if (origem) return origem;
  }
  return "";
}

function resolverOrigemFluxoLegada(...fontes) {
  for (const fonte of fontes) {
    const valor = objeto(fonte);
    const metadata = objeto(valor.metadata);
    const jobMetadata = objeto(valor.job_metadata || valor.jobMetadata);
    const eventoMetadata = objeto(valor.evento_metadata || valor.eventoMetadata);
    const metadataEventoJob = objeto(jobMetadata.metadataEvento);
    const metadataEventoOferta = objeto(metadata.metadataEvento);
    const clonadorGrupos = objeto(metadata.clonadorGrupos);
    const origensTecnicas = [
      valor.origem,
      valor.fonte,
      metadata.origem,
      eventoMetadata.origem,
      metadataEventoJob.origem,
      metadataEventoOferta.origem
    ].map(texto);

    if (
      origensTecnicas.includes(ORIGEM_FLUXO_CLONADOR_GRUPOS) ||
      String(clonadorGrupos.bufferId || "").trim()
    ) {
      return ORIGEM_FLUXO_CLONADOR_GRUPOS;
    }
    if (origensTecnicas.some(origem => origem === "radar" || origem === ORIGEM_FLUXO_OPTIMUS)) {
      return ORIGEM_FLUXO_OPTIMUS;
    }
  }
  return "";
}

function resolverOrigemFluxo(...fontes) {
  return resolverOrigemFluxoExplicita(...fontes) || resolverOrigemFluxoLegada(...fontes);
}

module.exports = {
  ORIGEM_FLUXO_OPTIMUS,
  ORIGEM_FLUXO_CLONADOR_GRUPOS,
  normalizarOrigemFluxo,
  resolverOrigemFluxoExplicita,
  resolverOrigemFluxoLegada,
  resolverOrigemFluxo
};
