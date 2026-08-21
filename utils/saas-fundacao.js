"use strict";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
}

function normalizarPlanoIdEstavel(valor = "") {
  return texto(valor);
}

function chaveComparacaoPlano(valor = "") {
  return textoLower(valor);
}

function aliasesPlano(plano = {}, chave = "") {
  const fonte = plano && typeof plano === "object" ? plano : {};
  const aliases = [
    chave,
    fonte.id,
    fonte.planoId,
    fonte.nome
  ];

  if (Array.isArray(fonte.aliasesLegados)) {
    aliases.push(...fonte.aliasesLegados);
  }

  return [...new Set(
    aliases
      .map(chaveComparacaoPlano)
      .filter(Boolean)
  )];
}

function buscarEntradaPlano(planos = {}, identidade = "") {
  const alvoExato = texto(identidade);
  const alvo = chaveComparacaoPlano(identidade);
  if (!alvoExato && !alvo) return null;

  if (Object.prototype.hasOwnProperty.call(planos || {}, alvoExato)) {
    return { chave: alvoExato, plano: planos[alvoExato] };
  }

  const idExato = Object.entries(planos || {}).find(([, plano]) =>
    texto(plano?.id || plano?.planoId) === alvoExato
  );
  if (idExato) return { chave: idExato[0], plano: idExato[1] };

  const direto = Object.entries(planos || {}).find(([chave]) => chaveComparacaoPlano(chave) === alvo);
  if (direto) return { chave: direto[0], plano: direto[1] };

  const porAlias = Object.entries(planos || {}).find(([chave, plano]) =>
    aliasesPlano(plano, chave).includes(alvo)
  );

  return porAlias ? { chave: porAlias[0], plano: porAlias[1] } : null;
}

function numero(valor, fallback = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : fallback;
}

function booleano(valor, fallback = false) {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor !== 0;
  if (typeof valor === "string") {
    const v = valor.trim().toLowerCase();
    if (["true", "1", "sim", "yes", "on"].includes(v)) return true;
    if (["false", "0", "nao", "no", "off"].includes(v)) return false;
  }
  return fallback;
}

function normalizarSaasConfig(config = {}) {
  const fonte = config && typeof config === "object" ? config : {};
  return {
    betaAtivo: booleano(fonte.betaAtivo, false),
    cadastroPublicoAtivo: booleano(fonte.cadastroPublicoAtivo, false),
    maxContasFreeBeta: Math.max(0, numero(fonte.maxContasFreeBeta, 0)),
    textoBeta: texto(fonte.textoBeta),
    seloBeta: texto(fonte.seloBeta)
  };
}

function normalizarPlanoSaas(plano = {}, chave = "") {
  const fonte = plano && typeof plano === "object" ? plano : {};
  return {
    ...fonte,
    nome: texto(fonte.nome || chave),
    preco: texto(fonte.preco),
    fraseComercial: texto(fonte.fraseComercial),
    selo: texto(fonte.selo),
    ordem: numero(fonte.ordem, 0),
    visivelPublicamente: booleano(fonte.visivelPublicamente, false),
    contratavel: booleano(fonte.contratavel, false),
    emBreve: booleano(fonte.emBreve, false)
  };
}

function normalizarPlanoSaasComId(plano = {}, chave = "") {
  const normalizado = normalizarPlanoSaas(plano, chave);
  return {
    ...normalizado,
    id: normalizarPlanoIdEstavel(normalizado.id || chave || normalizado.nome)
  };
}

function detectarConflitosIdentidadePlanos(planos = {}) {
  const grupos = new Map();

  for (const [chave, plano] of Object.entries(planos || {})) {
    const normalizado = normalizarPlanoSaasComId(plano, chave);
    for (const alias of aliasesPlano(normalizado, chave)) {
      if (!grupos.has(alias)) grupos.set(alias, []);
      grupos.get(alias).push({
        chave,
        id: normalizado.id,
        nome: normalizado.nome
      });
    }
  }

  return [...grupos.entries()]
    .map(([alias, entradas]) => ({
      alias,
      entradas: entradas.filter((entrada, indice, lista) =>
        lista.findIndex((item) => item.chave === entrada.chave) === indice
      )
    }))
    .filter((grupo) => grupo.entradas.length > 1);
}

function resolverIdentidadePlanoEdicao(planos = {}, body = {}) {
  const nome = texto(body?.nome);
  const identidade = texto(
    body?.id ||
    body?.planoId ||
    body?.chaveOriginal ||
    body?.identidadeOriginal ||
    nome
  );
  const entradaAnterior =
    buscarEntradaPlano(planos, identidade) ||
    buscarEntradaPlano(planos, nome);
  const chavePlano = entradaAnterior?.chave || normalizarPlanoIdEstavel(identidade || nome);
  const planoAnterior = entradaAnterior?.plano || {};
  const id = normalizarPlanoIdEstavel(planoAnterior.id || chavePlano || identidade || nome);

  return {
    nome,
    identidade,
    entradaAnterior,
    chavePlano,
    planoAnterior,
    id
  };
}

function normalizarPlanosSaasRuntime(planos = {}) {
  if (!planos || typeof planos !== "object") return planos;
  for (const [chave, plano] of Object.entries(planos)) {
    if (!plano || typeof plano !== "object") continue;
    Object.assign(plano, normalizarPlanoSaasComId(plano, chave));
  }
  return planos;
}

function listaMarketplacesPublica(valor = []) {
  if (Array.isArray(valor)) {
    return valor.map(textoLower).filter(Boolean);
  }
  if (valor && typeof valor === "object") {
    return Object.entries(valor)
      .filter(([, ativo]) => ativo === true)
      .map(([chave]) => textoLower(chave))
      .filter(Boolean);
  }
  return [];
}

function recursosPublicos(valor = {}) {
  if (!valor || typeof valor !== "object") return {};
  return Object.entries(valor).reduce((acc, [chave, ativo]) => {
    const id = texto(chave);
    const idLower = textoLower(id);
    if (!id) return acc;
    if (idLower.includes("senha") || idLower.includes("token") || idLower.includes("secret") || idLower.includes("segredo")) return acc;
    if (idLower.includes("admin") || idLower.includes("master")) return acc;
    if (booleano(ativo, false)) acc[id] = true;
    return acc;
  }, {});
}

function politicaCreditosPlano(plano = {}) {
  const limites = plano?.limites && typeof plano.limites === "object" ? plano.limites : {};
  const modeloInformado = textoLower(plano.creditosModelo || limites.creditosModelo);
  const temCreditosUnicos =
    plano.creditosUnicos !== undefined ||
    limites.creditosUnicos !== undefined;
  const temCreditosCiclo =
    plano.creditosPorCiclo !== undefined ||
    limites.creditosPorCiclo !== undefined ||
    limites.creditosMes !== undefined ||
    limites.creditos !== undefined;
  const creditosModelo =
    modeloInformado === "unicos" || modeloInformado === "unico" || modeloInformado === "teste"
      ? "unicos"
      : modeloInformado === "ciclo" || modeloInformado === "recorrente" || modeloInformado === "mensal"
        ? "ciclo"
        : temCreditosUnicos && !temCreditosCiclo
          ? "unicos"
          : "ciclo";

  const creditosLegado = limites.creditosMes ?? limites.creditos ?? plano.creditos;
  const creditosUnicos = Math.max(0, numero(plano.creditosUnicos ?? limites.creditosUnicos ?? creditosLegado, 0));
  const creditosPorCiclo = Math.max(0, numero(plano.creditosPorCiclo ?? limites.creditosPorCiclo ?? creditosLegado, 0));
  const cicloDias = Math.max(1, numero(plano.cicloDias ?? limites.cicloDias, 30));

  return {
    creditosModelo,
    creditosUnicos,
    creditosPorCiclo,
    cicloDias
  };
}

function assinaturaAutorizaCreditos(usuario = {}) {
  const status = textoLower(usuario.assinaturaStatus);
  if (!status) return usuario.origemCadastro !== "publico";
  return [
    "ativa",
    "autorizada",
    "pagamento_confirmado",
    "teste_ciclo_autorizado",
    "trial_autorizado",
    "ativa_legacy",
    "manual"
  ].includes(status);
}

function adicionarDias(data, dias) {
  const d = new Date(data);
  d.setUTCDate(d.getUTCDate() + Math.max(1, numero(dias, 30)));
  return d;
}

function carenciaPagamentoDiasPlano(plano = {}) {
  const limites = plano?.limites && typeof plano.limites === "object" ? plano.limites : {};
  return Math.max(0, numero(plano.carenciaPagamentoDias ?? limites.carenciaPagamentoDias, 1));
}

function inicializarCreditosUsuario({ usuario = {}, plano = {}, agora = new Date(), origemCadastro = "admin" } = {}) {
  if (usuario.creditosInicializadosEm) {
    return usuario;
  }

  const politica = politicaCreditosPlano(plano);
  const iso = new Date(agora).toISOString();
  usuario.creditosModelo = politica.creditosModelo;
  usuario.origemCadastro = usuario.origemCadastro || origemCadastro;
  usuario.statusConta = usuario.statusConta || "ativa";
  usuario.assinaturaStatus = usuario.assinaturaStatus || (politica.creditosModelo === "ciclo" ? "pendente_pagamento" : "nao_aplicavel");
  usuario.pagamentoUltimoStatus = usuario.pagamentoUltimoStatus || "";

  if (politica.creditosModelo === "unicos") {
    usuario.creditos = politica.creditosUnicos;
    usuario.creditosInicializadosEm = usuario.creditosInicializadosEm || iso;
    usuario.cicloAtualInicio = usuario.cicloAtualInicio || "";
    usuario.proximaRenovacao = usuario.proximaRenovacao || "";
    return usuario;
  }

  usuario.creditos = assinaturaAutorizaCreditos(usuario) ? politica.creditosPorCiclo : 0;
  usuario.cicloAtualInicio = usuario.cicloAtualInicio || (usuario.creditos > 0 ? iso : "");
  usuario.proximaRenovacao = usuario.proximaRenovacao || (usuario.creditos > 0 ? adicionarDias(agora, politica.cicloDias).toISOString() : "");
  usuario.creditosInicializadosEm = usuario.creditosInicializadosEm || iso;
  return usuario;
}

function abrirCicloCreditosAutorizado(usuario = {}, plano = {}, {
  agora = new Date(),
  idempotencyKey = "",
  assinaturaStatus = "teste_ciclo_autorizado",
  pagamentoId = ""
} = {}) {
  const politica = politicaCreditosPlano(plano);
  if (politica.creditosModelo !== "ciclo") {
    return { alterou: false, motivo: "plano_nao_ciclico" };
  }

  const chave = texto(idempotencyKey || pagamentoId);
  if (chave && (
    usuario.ultimoCicloCreditoIdempotencyKey === chave ||
    usuario.ultimoCicloCreditoId === chave
  )) {
    return { alterou: false, motivo: "ciclo_ja_aberto" };
  }

  const iso = new Date(agora).toISOString();
  const fim = adicionarDias(agora, politica.cicloDias).toISOString();
  usuario.assinaturaStatus = assinaturaStatus;
  usuario.pagamentoUltimoStatus = assinaturaStatus;
  usuario.creditosModelo = "ciclo";
  usuario.creditos = politica.creditosPorCiclo;
  usuario.planoAssinatura = usuario.planoAssinatura || plano.nome || usuario.plano || "";
  usuario.cicloAtualInicio = iso;
  usuario.cicloAtualFim = fim;
  usuario.proximaRenovacao = fim;
  usuario.creditosInicializadosEm = usuario.creditosInicializadosEm || iso;
  usuario.ultimoCicloCreditoIdempotencyKey = chave || usuario.ultimoCicloCreditoIdempotencyKey || `ciclo:${iso}`;
  usuario.ultimoCicloCreditoId = chave || usuario.ultimoCicloCreditoId || usuario.ultimoCicloCreditoIdempotencyKey;
  if (pagamentoId || chave) usuario.pagamentoUltimoId = texto(pagamentoId || chave);
  return { alterou: true, motivo: "ciclo_aberto" };
}

function renovarCreditosPorPlano(usuario = {}, plano = {}, agora = new Date()) {
  if (!usuario || !plano) return { alterou: false, motivo: "usuario_ou_plano_ausente" };
  const politica = politicaCreditosPlano(plano);

  usuario.creditosModelo = usuario.creditosModelo || politica.creditosModelo;

  if (politica.creditosModelo === "unicos") {
    if (Number(usuario.creditos || 0) <= 0 && usuario.statusConta !== "teste_esgotado") {
      usuario.statusConta = "teste_esgotado";
      usuario.testeEsgotadoEm = usuario.testeEsgotadoEm || new Date(agora).toISOString();
      return { alterou: true, motivo: "teste_esgotado" };
    }
    return { alterou: false, motivo: "creditos_unicos_nao_renovam" };
  }

  if (!usuario.assinaturaStatus) {
    usuario.assinaturaStatus = "ativa_legacy";
  }

  if (!usuario.cicloAtualInicio || !usuario.proximaRenovacao) {
    const iso = new Date(agora).toISOString();
    usuario.cicloAtualInicio = usuario.cicloAtualInicio || iso;
    usuario.cicloAtualFim = usuario.cicloAtualFim || adicionarDias(agora, politica.cicloDias).toISOString();
    usuario.proximaRenovacao = usuario.proximaRenovacao || usuario.cicloAtualFim;
    return { alterou: true, motivo: "ciclo_inicializado_sem_credito_novo" };
  }

  const proxima = new Date(usuario.proximaRenovacao);
  if (Number.isFinite(proxima.getTime()) && proxima <= new Date(agora)) {
    return processarVencimentoAssinatura(usuario, plano, agora);
  }

  if (!assinaturaAutorizaCreditos(usuario)) {
    return { alterou: false, motivo: "assinatura_nao_autorizada" };
  }

  if (!Number.isFinite(proxima.getTime()) || proxima > new Date(agora)) {
    return { alterou: false, motivo: "ciclo_vigente" };
  }
}

function processarVencimentoAssinatura(usuario = {}, plano = {}, agora = new Date()) {
  if (!usuario || !plano) return { alterou: false, motivo: "usuario_ou_plano_ausente" };
  const politica = politicaCreditosPlano(plano);

  usuario.creditosModelo = usuario.creditosModelo || politica.creditosModelo;

  if (politica.creditosModelo === "unicos") {
    if (Number(usuario.creditos || 0) <= 0 && usuario.statusConta !== "teste_esgotado") {
      usuario.statusConta = "teste_esgotado";
      usuario.testeEsgotadoEm = usuario.testeEsgotadoEm || new Date(agora).toISOString();
      return { alterou: true, motivo: "teste_esgotado" };
    }
    return { alterou: false, motivo: "creditos_unicos_nao_renovam" };
  }

  const referenciaFim = usuario.proximaRenovacao || usuario.cicloAtualFim;
  const vencimento = new Date(referenciaFim || "");
  if (!Number.isFinite(vencimento.getTime())) {
    return { alterou: false, motivo: "vencimento_ausente" };
  }

  const agoraData = new Date(agora);
  if (vencimento > agoraData) {
    return { alterou: false, motivo: "ciclo_vigente" };
  }

  const carenciaFim = adicionarDias(vencimento, carenciaPagamentoDiasPlano(plano));
  usuario.pagamentoUltimoStatus = usuario.pagamentoUltimoStatus || "pagamento_pendente";

  if (carenciaFim > agoraData) {
    if (usuario.assinaturaStatus !== "pagamento_pendente") {
      usuario.assinaturaStatus = "pagamento_pendente";
      usuario.pagamentoPendenteDesde = usuario.pagamentoPendenteDesde || new Date(agora).toISOString();
      return { alterou: true, motivo: "pagamento_pendente_carencia" };
    }
    return { alterou: false, motivo: "pagamento_pendente_carencia" };
  }

  const jaSuspensa = usuario.assinaturaStatus === "suspensa" && Number(usuario.creditos || 0) === 0;
  usuario.assinaturaStatus = "suspensa";
  usuario.pagamentoUltimoStatus = "vencido_sem_pagamento";
  usuario.suspensoEm = usuario.suspensoEm || new Date(agora).toISOString();
  usuario.creditos = 0;
  return { alterou: !jaSuspensa, motivo: "assinatura_suspensa_sem_pagamento" };
}

function registrarAuditoriaAssinatura(usuario = {}, evento = {}) {
  usuario.auditoriaAssinatura = Array.isArray(usuario.auditoriaAssinatura)
    ? usuario.auditoriaAssinatura
    : [];
  usuario.auditoriaAssinatura.push({
    tipo: texto(evento.tipo || "pagamento_simulado"),
    estado: texto(evento.estado),
    pagamentoId: texto(evento.pagamentoId),
    plano: texto(evento.plano),
    operador: texto(evento.operador),
    resultado: texto(evento.resultado),
    motivo: texto(evento.motivo).slice(0, 200),
    data: new Date(evento.data || new Date()).toISOString()
  });
}

function aplicarPagamentoSimulado(usuario = {}, plano = {}, {
  estado = "",
  pagamentoId = "",
  agora = new Date(),
  operador = ""
} = {}) {
  if (!usuario || !usuario.id) {
    return { ok: false, status: 404, codigo: "usuario_nao_encontrado", erro: "Usuario nao encontrado" };
  }
  if (!plano || !plano.nome) {
    return { ok: false, status: 404, codigo: "plano_nao_encontrado", erro: "Plano nao encontrado" };
  }

  const estadoNormalizado = textoLower(estado);
  if (!["aprovado", "recusado", "pendente"].includes(estadoNormalizado)) {
    return { ok: false, status: 400, codigo: "estado_pagamento_invalido", erro: "Estado de pagamento invalido" };
  }

  const politica = politicaCreditosPlano(plano);
  if (politica.creditosModelo !== "ciclo") {
    return { ok: false, status: 400, codigo: "plano_nao_ciclico", erro: "Plano nao participa de assinatura paga" };
  }

  const idPagamento = texto(pagamentoId);
  if (estadoNormalizado === "aprovado" && !idPagamento) {
    return { ok: false, status: 400, codigo: "pagamento_id_obrigatorio", erro: "pagamentoId obrigatorio" };
  }

  if (estadoNormalizado === "pendente") {
    usuario.pagamentoUltimoStatus = estadoNormalizado;
    if (idPagamento) usuario.pagamentoUltimoId = idPagamento;
    usuario.assinaturaStatus = "pagamento_pendente";
    registrarAuditoriaAssinatura(usuario, {
      estado: estadoNormalizado,
      pagamentoId: idPagamento,
      plano: plano.nome,
      operador,
      resultado: "registrado",
      motivo: "pagamento_pendente",
      data: agora
    });
    return { ok: true, alterou: true, motivo: "pagamento_pendente", idempotente: false };
  }

  if (estadoNormalizado === "recusado") {
    usuario.pagamentoUltimoStatus = estadoNormalizado;
    if (idPagamento) usuario.pagamentoUltimoId = idPagamento;
    usuario.assinaturaStatus = "pagamento_pendente";
    registrarAuditoriaAssinatura(usuario, {
      estado: estadoNormalizado,
      pagamentoId: idPagamento,
      plano: plano.nome,
      operador,
      resultado: "registrado",
      motivo: "pagamento_recusado",
      data: agora
    });
    return { ok: true, alterou: true, motivo: "pagamento_recusado", idempotente: false };
  }

  if (usuario.ultimoCicloCreditoId === idPagamento || usuario.ultimoCicloCreditoIdempotencyKey === idPagamento) {
    registrarAuditoriaAssinatura(usuario, {
      estado: estadoNormalizado,
      pagamentoId: idPagamento,
      plano: plano.nome,
      operador,
      resultado: "idempotente",
      motivo: "pagamento_ja_processado",
      data: agora
    });
    return { ok: true, alterou: false, motivo: "pagamento_ja_processado", idempotente: true };
  }

  const planoNome = plano.nome;
  usuario.plano = planoNome;
  usuario.planoAssinatura = planoNome;
  usuario.statusConta = "ativa";
  usuario.assinaturaStatus = "ativa";
  usuario.pagamentoUltimoStatus = "aprovado";
  usuario.creditosModelo = "ciclo";

  const ciclo = abrirCicloCreditosAutorizado(usuario, plano, {
    agora,
    idempotencyKey: idPagamento,
    pagamentoId: idPagamento,
    assinaturaStatus: "ativa"
  });
  usuario.assinaturaStatus = "ativa";
  usuario.pagamentoUltimoStatus = "aprovado";
  usuario.pagamentoUltimoId = idPagamento;
  usuario.ultimoCicloCreditoId = idPagamento;
  usuario.ultimoCicloCreditoIdempotencyKey = idPagamento;

  registrarAuditoriaAssinatura(usuario, {
    estado: estadoNormalizado,
    pagamentoId: idPagamento,
    plano: planoNome,
    operador,
    resultado: ciclo.alterou ? "ciclo_aberto" : "idempotente",
    motivo: ciclo.motivo,
    data: agora
  });

  return { ok: true, alterou: ciclo.alterou, motivo: ciclo.motivo, idempotente: false };
}

function aplicarDebitoConta(usuario = {}, plano = {}, quantidade = 1, agora = new Date()) {
  const restante = Number(usuario.creditos || 0) - Number(quantidade || 1);
  usuario.creditos = Math.max(0, restante);
  const politica = politicaCreditosPlano(plano);
  if (politica.creditosModelo === "unicos" && usuario.creditos <= 0) {
    usuario.statusConta = "teste_esgotado";
    usuario.testeEsgotadoEm = usuario.testeEsgotadoEm || new Date(agora).toISOString();
  }
  return usuario.creditos;
}

function planosPublicos(planos = {}) {
  return Object.entries(planos || {})
    .map(([chave, plano]) => normalizarPlanoSaasComId(plano, chave))
    .filter((plano) => plano.visivelPublicamente === true)
    .sort((a, b) => {
      const ordem = numero(a.ordem, 0) - numero(b.ordem, 0);
      if (ordem !== 0) return ordem;
      return texto(a.nome).localeCompare(texto(b.nome));
    });
}

function sanitizarPlanoPublico(plano = {}) {
  const p = normalizarPlanoSaasComId(plano);
  const politica = politicaCreditosPlano(p);
  const limites = p.limites && typeof p.limites === "object" ? p.limites : {};
  return {
    id: p.id,
    nome: p.nome,
    preco: p.preco,
    fraseComercial: p.fraseComercial,
    selo: p.selo,
    ordem: p.ordem,
    visivelPublicamente: p.visivelPublicamente,
    contratavel: p.contratavel,
    emBreve: p.emBreve,
    marketplaces: listaMarketplacesPublica(p.marketplaces),
    recursos: recursosPublicos(p.recursos),
    limites: {
      maxConexoes: limites.maxConexoes ?? limites.conexoes ?? limites.sessoes ?? null,
      maxMarketplacesSelecionados: limites.maxMarketplacesSelecionados ?? limites.marketplaces ?? null,
      destinos: limites.destinos ?? null,
      enviosDia: limites.enviosDia ?? null
    },
    creditos: {
      modelo: politica.creditosModelo,
      creditosUnicos: politica.creditosModelo === "unicos" ? politica.creditosUnicos : 0,
      creditosPorCiclo: politica.creditosModelo === "ciclo" ? politica.creditosPorCiclo : 0,
      cicloDias: politica.creditosModelo === "ciclo" ? politica.cicloDias : null
    }
  };
}

function contarVagasFreeBeta({ usuarios = [], planos = {}, maxContasFreeBeta = 0 } = {}) {
  const max = Math.max(0, numero(maxContasFreeBeta, 0));
  if (!max) return { ocupadas: 0, disponiveis: 0, max };

  const ocupadas = (Array.isArray(usuarios) ? usuarios : []).filter((usuario) => {
    if (!usuario || usuario.ativo === false) return false;
    if (textoLower(usuario.origemCadastro) !== "publico") return false;
    if (textoLower(usuario.statusConta) === "teste_esgotado") return false;
    const plano = buscarEntradaPlano(planos, usuario.plano)?.plano || null;
    return politicaCreditosPlano(plano || {}).creditosModelo === "unicos";
  }).length;

  return {
    ocupadas,
    disponiveis: Math.max(0, max - ocupadas),
    max
  };
}

function buscarPlanoCadastro(planos = {}, planoNome = "") {
  const planoEntrada = buscarEntradaPlano(planos, planoNome);
  if (!planoEntrada) return null;
  return normalizarPlanoSaasComId(planoEntrada.plano, planoEntrada.chave);
}

function validarCadastro({ body = {}, planos = {}, usuarios = [], saasConfig = {}, contexto = "publico" } = {}) {
  const nome = texto(body.nome);
  const email = textoLower(body.email);
  const senha = String(body.senha || "");
  const planoNome = texto(body.plano || body.planoNome || body.planoId);
  const contextoCadastro = textoLower(contexto || "publico") || "publico";
  const publico = contextoCadastro === "publico";

  if (publico && !saasConfig.cadastroPublicoAtivo) {
    return { ok: false, status: 403, codigo: "cadastro_publico_desativado", erro: "Cadastro publico desativado" };
  }
  if (!nome) return { ok: false, status: 400, codigo: "nome_obrigatorio", erro: "Nome obrigatorio" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, codigo: "email_invalido", erro: "Email invalido" };
  }
  if (senha.length < 8) {
    return { ok: false, status: 400, codigo: "senha_minima", erro: "Senha deve ter pelo menos 8 caracteres" };
  }
  if (!planoNome) return { ok: false, status: 400, codigo: "plano_obrigatorio", erro: "Plano obrigatorio" };
  if ((usuarios || []).some((u) => textoLower(u?.email) === email)) {
    return { ok: false, status: 409, codigo: "email_ja_cadastrado", erro: "Email ja cadastrado" };
  }

  const planoSaas = buscarPlanoCadastro(planos, planoNome);
  if (!planoSaas) {
    return { ok: false, status: 404, codigo: "plano_publico_nao_encontrado", erro: "Plano nao encontrado" };
  }
  if (publico && !planoSaas.visivelPublicamente) {
    return { ok: false, status: 404, codigo: "plano_publico_nao_encontrado", erro: "Plano nao encontrado" };
  }
  if (publico && (!planoSaas.contratavel || planoSaas.emBreve)) {
    return { ok: false, status: 403, codigo: "plano_nao_contratavel", erro: "Plano indisponivel para contratacao" };
  }

  const politica = politicaCreditosPlano(planoSaas);
  if (publico && saasConfig.betaAtivo && politica.creditosModelo === "unicos") {
    const vagas = contarVagasFreeBeta({
      usuarios,
      planos,
      maxContasFreeBeta: saasConfig.maxContasFreeBeta
    });
    if (vagas.disponiveis <= 0) {
      return { ok: false, status: 403, codigo: "vagas_beta_esgotadas", erro: "Vagas beta esgotadas" };
    }
  }

  return { ok: true, nome, email, senha, plano: planoSaas };
}

function validarCadastroPublico(opcoes = {}) {
  return validarCadastro({ ...opcoes, contexto: "publico" });
}

function restaurarArray(alvo = [], snapshot = []) {
  alvo.splice(0, alvo.length, ...snapshot);
}

function restaurarObjeto(alvo = {}, snapshot = {}) {
  for (const chave of Object.keys(alvo)) delete alvo[chave];
  Object.assign(alvo, snapshot);
}

function criarSerializadorCadastro(chave = "cadastro_saas_v1") {
  const emAndamento = new Set();
  const chaveLock = texto(chave) || "cadastro_saas_v1";

  return async function executarCadastroSerializado(fn) {
    if (emAndamento.has(chaveLock)) {
      const erro = new Error("Cadastro em andamento");
      erro.statusCode = 409;
      erro.codigo = "cadastro_em_andamento";
      throw erro;
    }

    emAndamento.add(chaveLock);

    try {
      return await fn();
    } finally {
      emAndamento.delete(chaveLock);
    }
  };
}

async function executarCadastroAtomico({
  body = {},
  planos = {},
  usuarios = [],
  configsPorCliente = {},
  saasConfig = {},
  contexto = "publico",
  origemCadastro,
  ativo = true,
  autorizarCicloTeste = false,
  idempotencyKey = "",
  gerarId,
  gerarSenhaHash,
  prepararConfig,
  salvarUsuarios,
  salvarConfigsClientes,
  agora = new Date()
} = {}) {
  const contextoCadastro = textoLower(contexto || "publico") || "publico";
  const validacao = validarCadastro({ body, planos, usuarios, saasConfig, contexto: contextoCadastro });
  if (!validacao.ok) {
    const erro = new Error(validacao.erro || "Cadastro invalido");
    erro.statusCode = validacao.status || 400;
    erro.codigo = validacao.codigo || "cadastro_invalido";
    throw erro;
  }

  if (typeof gerarId !== "function") throw new Error("gerarId_obrigatorio");
  if (typeof gerarSenhaHash !== "function") throw new Error("gerarSenhaHash_obrigatorio");
  if (typeof salvarUsuarios !== "function") throw new Error("salvarUsuarios_obrigatorio");
  if (typeof salvarConfigsClientes !== "function") throw new Error("salvarConfigsClientes_obrigatorio");

  const snapshotUsuarios = JSON.parse(JSON.stringify(usuarios));
  const snapshotConfigs = JSON.parse(JSON.stringify(configsPorCliente));

  const novoUsuario = {
    id: gerarId(),
    nome: validacao.nome,
    email: validacao.email,
    senhaHash: await gerarSenhaHash(validacao.senha),
    papel: "cliente",
    plano: validacao.plano.nome,
    ativo: ativo !== false,
    origemCadastro: origemCadastro || (contextoCadastro === "publico" ? "publico" : "admin/teste"),
    statusConta: "ativa",
    criadoEm: new Date(agora).toISOString()
  };

  if (autorizarCicloTeste === true) {
    novoUsuario.assinaturaStatus = "teste_ciclo_autorizado";
    novoUsuario.pagamentoUltimoStatus = "teste_ciclo_autorizado";
  }

  inicializarCreditosUsuario({
    usuario: novoUsuario,
    plano: validacao.plano,
    origemCadastro: novoUsuario.origemCadastro,
    agora
  });

  if (autorizarCicloTeste === true) {
    abrirCicloCreditosAutorizado(novoUsuario, validacao.plano, {
      agora,
      idempotencyKey: idempotencyKey || `cadastro:${novoUsuario.id}`,
      assinaturaStatus: "teste_ciclo_autorizado"
    });
  }

  try {
    usuarios.push(novoUsuario);
    configsPorCliente[novoUsuario.id] = typeof prepararConfig === "function"
      ? prepararConfig(configsPorCliente[novoUsuario.id], novoUsuario)
      : {};
    salvarUsuarios();
    salvarConfigsClientes();
  } catch (e) {
    restaurarArray(usuarios, snapshotUsuarios);
    restaurarObjeto(configsPorCliente, snapshotConfigs);
    try {
      salvarUsuarios();
      salvarConfigsClientes();
    } catch {}
    const erro = new Error("Falha ao criar conta");
    erro.statusCode = 500;
    erro.codigo = "cadastro_rollback_executado";
    throw erro;
  }

  return novoUsuario;
}

module.exports = {
  normalizarSaasConfig,
  normalizarPlanoSaas,
  normalizarPlanoSaasComId,
  normalizarPlanoIdEstavel,
  aliasesPlano,
  buscarEntradaPlano,
  detectarConflitosIdentidadePlanos,
  resolverIdentidadePlanoEdicao,
  normalizarPlanosSaasRuntime,
  politicaCreditosPlano,
  inicializarCreditosUsuario,
  renovarCreditosPorPlano,
  processarVencimentoAssinatura,
  aplicarDebitoConta,
  abrirCicloCreditosAutorizado,
  aplicarPagamentoSimulado,
  planosPublicos,
  sanitizarPlanoPublico,
  contarVagasFreeBeta,
  buscarPlanoCadastro,
  validarCadastro,
  validarCadastroPublico,
  criarSerializadorCadastro,
  executarCadastroAtomico
};
