const {
  consultarReservatorioOfc,
  consultarConsumoOfc
} = require("./metrics.repository");

function paraNumero(valor) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function idadeMs(data) {
  const tempo = data ? new Date(data).getTime() : 0;
  if (!Number.isFinite(tempo) || tempo <= 0) return null;
  return Math.max(0, Date.now() - tempo);
}

function resumirPorStatus(linhas = []) {
  return linhas.reduce((acc, item) => {
    const status = String(item.status || "desconhecido");
    acc[status] = {
      total: paraNumero(item.total),
      idadeMaisAntigoMs: idadeMs(item.mais_antigo_em),
      idadeMaisNovoMs: idadeMs(item.mais_novo_em)
    };
    return acc;
  }, {});
}

function agruparTotais(linhas = [], chave) {
  const mapa = new Map();
  for (const item of linhas) {
    const nome = String(item[chave] || "desconhecido");
    const atual = mapa.get(nome) || { nome, total: 0, status: {} };
    const status = String(item.status || "desconhecido");
    atual.total += paraNumero(item.total);
    atual.status[status] = paraNumero(item.total);
    const idadeAntigo = idadeMs(item.mais_antigo_em);
    if (idadeAntigo !== null) {
      atual.idadeMaisAntigoMs = Math.max(atual.idadeMaisAntigoMs || 0, idadeAntigo);
    }
    mapa.set(nome, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total).slice(0, 20);
}

function calcularConsumoReal(consumo = {}) {
  const etapas = Array.isArray(consumo.etapas) ? consumo.etapas : [];
  const totalEventos = etapas.reduce((acc, item) => acc + paraNumero(item.total), 0);
  const janelaMinutos = Math.max(1, paraNumero(consumo.janelaMinutos || 15));
  const porMinuto = totalEventos / janelaMinutos;

  return {
    janelaMinutos,
    eventos: totalEventos,
    eventosPorMinuto: Number(porMinuto.toFixed(2)),
    etapas: etapas.slice(0, 20).map(item => ({
      etapa: item.etapa || "",
      status: item.status || "",
      total: paraNumero(item.total)
    }))
  };
}

function calcularPressaoOperacional(reservatorio = {}, consumoReal = {}) {
  const porStatus = resumirPorStatus(reservatorio.status || []);
  const pendentes = porStatus.pendente?.total || 0;
  const diagnosticados = porStatus.diagnosticado?.total || 0;
  const prontos = porStatus.pronto_para_importar?.total || 0;
  const emCurso = (porStatus.processando?.total || 0) + (porStatus.importando?.total || 0);
  const idadePendenteMaisAntigoMs = porStatus.pendente?.idadeMaisAntigoMs || null;
  const consumoPorMinuto = Number(consumoReal.eventosPorMinuto || 0);

  return {
    pendentes,
    diagnosticados,
    prontosParaImportar: prontos,
    emCurso,
    backlogOperacional: pendentes + diagnosticados + prontos,
    idadePendenteMaisAntigoMs,
    consumoPorMinuto,
    pressaoSemConsumo: pendentes > 0 && consumoPorMinuto <= 0,
    backlogMaiorQueConsumo: consumoPorMinuto > 0 ? pendentes > consumoPorMinuto * 15 : pendentes > 0
  };
}

async function coletarMetricasOfc({ janelaConsumoMinutos = 15 } = {}) {
  const [reservatorio, consumo] = await Promise.all([
    consultarReservatorioOfc(),
    consultarConsumoOfc({ minutos: janelaConsumoMinutos })
  ]);

  const consumoReal = calcularConsumoReal(consumo);
  const pressao = calcularPressaoOperacional(reservatorio, consumoReal);

  return {
    ok: Boolean(reservatorio.ok && consumo.ok),
    coletadoEm: new Date().toISOString(),
    reservatorio: {
      porStatus: resumirPorStatus(reservatorio.status || []),
      porMarketplace: agruparTotais(reservatorio.marketplaces || [], "marketplace"),
      porCliente: agruparTotais(reservatorio.clientes || [], "cliente_id")
    },
    consumoReal,
    pressao,
    erro: reservatorio.erro || consumo.erro || "",
    motivo: reservatorio.motivo || consumo.motivo || ""
  };
}

module.exports = {
  coletarMetricasOfc,
  calcularConsumoReal,
  calcularPressaoOperacional,
  resumirPorStatus,
  agruparTotais
};
