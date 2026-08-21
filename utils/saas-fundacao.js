"use strict";

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
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

function normalizarPlanosSaasRuntime(planos = {}) {
  if (!planos || typeof planos !== "object") return planos;
  for (const [chave, plano] of Object.entries(planos)) {
    if (!plano || typeof plano !== "object") continue;
    Object.assign(plano, normalizarPlanoSaas(plano, chave));
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

function inicializarCreditosUsuario({ usuario = {}, plano = {}, agora = new Date(), origemCadastro = "admin" } = {}) {
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

  if (!assinaturaAutorizaCreditos(usuario)) {
    return { alterou: false, motivo: "assinatura_nao_autorizada" };
  }

  if (!usuario.assinaturaStatus) {
    usuario.assinaturaStatus = "ativa_legacy";
  }

  if (!usuario.cicloAtualInicio || !usuario.proximaRenovacao) {
    const iso = new Date(agora).toISOString();
    usuario.cicloAtualInicio = usuario.cicloAtualInicio || iso;
    usuario.proximaRenovacao = usuario.proximaRenovacao || adicionarDias(agora, politica.cicloDias).toISOString();
    return { alterou: true, motivo: "ciclo_inicializado_sem_credito_novo" };
  }

  const proxima = new Date(usuario.proximaRenovacao);
  if (!Number.isFinite(proxima.getTime()) || proxima > new Date(agora)) {
    return { alterou: false, motivo: "ciclo_vigente" };
  }

  usuario.creditos = politica.creditosPorCiclo;
  usuario.cicloAtualInicio = new Date(agora).toISOString();
  usuario.proximaRenovacao = adicionarDias(agora, politica.cicloDias).toISOString();
  return { alterou: true, motivo: "ciclo_renovado" };
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
    .map(([chave, plano]) => normalizarPlanoSaas(plano, chave))
    .filter((plano) => plano.visivelPublicamente === true)
    .sort((a, b) => {
      const ordem = numero(a.ordem, 0) - numero(b.ordem, 0);
      if (ordem !== 0) return ordem;
      return texto(a.nome).localeCompare(texto(b.nome));
    });
}

function sanitizarPlanoPublico(plano = {}) {
  const p = normalizarPlanoSaas(plano);
  const politica = politicaCreditosPlano(p);
  const limites = p.limites && typeof p.limites === "object" ? p.limites : {};
  return {
    nome: p.nome,
    preco: p.preco,
    fraseComercial: p.fraseComercial,
    selo: p.selo,
    ordem: p.ordem,
    visivelPublicamente: p.visivelPublicamente,
    contratavel: p.contratavel,
    emBreve: p.emBreve,
    marketplaces: listaMarketplacesPublica(p.marketplaces),
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
    const planoEntrada = Object.entries(planos || {}).find(([chave, p]) =>
      textoLower(chave) === textoLower(usuario.plano) ||
      textoLower(p?.nome) === textoLower(usuario.plano) ||
      textoLower(p?.id) === textoLower(usuario.plano)
    );
    const plano = planoEntrada?.[1] || null;
    return politicaCreditosPlano(plano || {}).creditosModelo === "unicos";
  }).length;

  return {
    ocupadas,
    disponiveis: Math.max(0, max - ocupadas),
    max
  };
}

function validarCadastroPublico({ body = {}, planos = {}, usuarios = [], saasConfig = {} } = {}) {
  const nome = texto(body.nome);
  const email = textoLower(body.email);
  const senha = String(body.senha || "");
  const planoNome = textoLower(body.plano || body.planoNome);

  if (!saasConfig.cadastroPublicoAtivo) {
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

  const planoEntrada = Object.entries(planos || {}).find(([chave, p]) =>
    textoLower(chave) === planoNome ||
    textoLower(p?.nome) === planoNome ||
    textoLower(p?.id) === planoNome
  );
  const plano = planoEntrada?.[1] || null;
  const planoSaas = normalizarPlanoSaas(plano || {});
  if (!plano || !planoSaas.visivelPublicamente) {
    return { ok: false, status: 404, codigo: "plano_publico_nao_encontrado", erro: "Plano nao encontrado" };
  }
  if (!planoSaas.contratavel || planoSaas.emBreve) {
    return { ok: false, status: 403, codigo: "plano_nao_contratavel", erro: "Plano indisponivel para contratacao" };
  }

  const politica = politicaCreditosPlano(planoSaas);
  if (saasConfig.betaAtivo && politica.creditosModelo === "unicos") {
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

function restaurarArray(alvo = [], snapshot = []) {
  alvo.splice(0, alvo.length, ...snapshot);
}

function restaurarObjeto(alvo = {}, snapshot = {}) {
  for (const chave of Object.keys(alvo)) delete alvo[chave];
  Object.assign(alvo, snapshot);
}

async function executarCadastroAtomico({
  body = {},
  planos = {},
  usuarios = [],
  configsPorCliente = {},
  saasConfig = {},
  gerarId,
  gerarSenhaHash,
  prepararConfig,
  salvarUsuarios,
  salvarConfigsClientes,
  agora = new Date()
} = {}) {
  const validacao = validarCadastroPublico({ body, planos, usuarios, saasConfig });
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
    ativo: true,
    origemCadastro: "publico",
    statusConta: "ativa",
    criadoEm: new Date(agora).toISOString()
  };

  inicializarCreditosUsuario({
    usuario: novoUsuario,
    plano: validacao.plano,
    origemCadastro: "publico",
    agora
  });

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
  normalizarPlanosSaasRuntime,
  politicaCreditosPlano,
  inicializarCreditosUsuario,
  renovarCreditosPorPlano,
  aplicarDebitoConta,
  planosPublicos,
  sanitizarPlanoPublico,
  contarVagasFreeBeta,
  validarCadastroPublico,
  executarCadastroAtomico
};
