function limitarInteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, Math.floor(numero)));
}

function calcularReservaDinamicaOfc(metricas = {}, opcoes = {}) {
  const pressao = metricas.pressao || {};
  const consumo = metricas.consumoReal || {};
  const pendentes = Number(pressao.pendentes || 0);
  const consumoPorMinuto = Number(consumo.eventosPorMinuto || 0);
  const janelaAlvoMinutos = limitarInteiro(opcoes.janelaAlvoMinutos, 5, 1, 60);
  const pisoOperacional = limitarInteiro(opcoes.pisoOperacional, 10, 1, 100);
  const tetoShadow = limitarInteiro(opcoes.tetoShadow, 100, 1, 500);

  const reservaPorConsumo = Math.ceil(consumoPorMinuto * janelaAlvoMinutos);
  const reservaBase = Math.max(pisoOperacional, reservaPorConsumo);
  const reservaDesejada = Math.min(tetoShadow, reservaBase, Math.max(pendentes, 0));

  return {
    janelaAlvoMinutos,
    pisoOperacional,
    tetoShadow,
    reservaPorConsumo,
    reservaDesejada,
    pendentesObservados: pendentes,
    consumoPorMinuto
  };
}

function criarPlanoShadowOfc(metricas = {}, opcoes = {}) {
  const reserva = calcularReservaDinamicaOfc(metricas, opcoes);
  const porMarketplace = metricas.reservatorio?.porMarketplace || [];
  const porCliente = metricas.reservatorio?.porCliente || [];
  const pressao = metricas.pressao || {};

  const marketplacesPressionados = porMarketplace
    .filter(item => Number(item.status?.pendente || 0) > 0)
    .slice(0, 10)
    .map(item => ({
      marketplace: item.nome,
      pendentes: Number(item.status?.pendente || 0),
      total: Number(item.total || 0),
      idadeMaisAntigoMs: item.idadeMaisAntigoMs || null
    }));

  const clientesPressionados = porCliente
    .filter(item => Number(item.status?.pendente || 0) > 0)
    .slice(0, 10)
    .map(item => ({
      clienteId: item.nome,
      pendentes: Number(item.status?.pendente || 0),
      total: Number(item.total || 0),
      idadeMaisAntigoMs: item.idadeMaisAntigoMs || null
    }));

  return {
    modo: "shadow",
    aplicouMudancas: false,
    criadoEm: new Date().toISOString(),
    reserva,
    pressao: {
      backlogOperacional: Number(pressao.backlogOperacional || 0),
      idadePendenteMaisAntigoMs: pressao.idadePendenteMaisAntigoMs || null,
      pressaoSemConsumo: Boolean(pressao.pressaoSemConsumo),
      backlogMaiorQueConsumo: Boolean(pressao.backlogMaiorQueConsumo)
    },
    marketplacesPressionados,
    clientesPressionados,
    recomendacaoOperacional: reserva.reservaDesejada > 0 ? "manter_fila_ativa_shadow" : "sem_acao_shadow"
  };
}

module.exports = {
  calcularReservaDinamicaOfc,
  criarPlanoShadowOfc
};
