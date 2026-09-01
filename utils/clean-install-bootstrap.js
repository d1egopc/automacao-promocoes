"use strict";

const saasFundacao = require("./saas-fundacao");
const { normalizarLimitesPlano } = require("./cotas-flexiveis-planos");

function texto(valor = "") {
  return String(valor ?? "").trim();
}

function textoLower(valor = "") {
  return texto(valor).toLowerCase();
}

function cloneJson(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function catalogoPlanosOficiaisAtuais() {
  return {
    beta_teste: {
      id: "beta_teste",
      nome: "Beta Teste",
      ordem: 1,
      visivelPublicamente: true,
      contratavel: true,
      emBreve: false,
      entradaBeta: true,
      renovacaoCreditos: "sem_renovacao",
      creditosModelo: "ciclo",
      limites: {
        creditosPorCiclo: 300,
        cicloDias: 30
      },
      recursos: {
        whatsapp: true
      }
    },
    plano_loja: {
      id: "plano_loja",
      nome: "Plano Loja",
      ordem: 2,
      visivelPublicamente: true,
      contratavel: true,
      emBreve: false,
      creditosModelo: "ciclo",
      limites: {
        creditosPorCiclo: 900,
        cicloDias: 30
      }
    },
    pro: {
      id: "pro",
      nome: "Pro",
      ordem: 3,
      visivelPublicamente: false,
      contratavel: true,
      emBreve: false,
      creditosModelo: "ciclo",
      limites: {
        creditosPorCiclo: 2000,
        cicloDias: 30
      }
    },
    ultimate: {
      id: "ultimate",
      nome: "Ultimate",
      ordem: 4,
      visivelPublicamente: false,
      contratavel: true,
      emBreve: false,
      creditosModelo: "ciclo",
      limites: {
        creditosPorCiclo: 4000,
        cicloDias: 30
      }
    }
  };
}

function normalizarCatalogoBootstrap(planos = {}) {
  const catalogo = cloneJson(planos || {});
  saasFundacao.normalizarPlanosSaasRuntime(catalogo);
  for (const plano of Object.values(catalogo)) {
    if (!plano || typeof plano !== "object") continue;
    plano.limites = normalizarLimitesPlano(plano, {});
    if (!plano.recursos || typeof plano.recursos !== "object") {
      plano.recursos = {};
    }
    if (!Object.prototype.hasOwnProperty.call(plano.recursos, "vitrine")) {
      plano.recursos.vitrine = false;
    }
    if (!Object.prototype.hasOwnProperty.call(plano.recursos, "copyIaGenerativa")) {
      plano.recursos.copyIaGenerativa = false;
    }
  }
  return catalogo;
}

function bootstrapPlanosOficiais({ planos = {}, salvarPlanos = null } = {}) {
  if (!planos || typeof planos !== "object") {
    return { alterou: false, motivo: "planos_invalidos" };
  }

  if (Object.keys(planos).length > 0) {
    return { alterou: false, motivo: "planos_existentes_preservados" };
  }

  const catalogo = normalizarCatalogoBootstrap(catalogoPlanosOficiaisAtuais());
  Object.assign(planos, catalogo);

  if (typeof salvarPlanos === "function") {
    salvarPlanos();
  }

  return {
    alterou: true,
    motivo: "planos_oficiais_bootstrap",
    total: Object.keys(catalogo).length,
    fonte: "utils/clean-install-bootstrap.catalogoPlanosOficiaisAtuais"
  };
}

function adminMasterExistenteValido(usuarios = []) {
  return (Array.isArray(usuarios) ? usuarios : []).some((usuario) =>
    usuario &&
    textoLower(usuario.papel) === "admin_master" &&
    usuario.ativo !== false &&
    (texto(usuario.senhaHash) || texto(usuario.passwordHash) || texto(usuario.hash) || texto(usuario.googleSub))
  );
}

function validarEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(textoLower(email));
}

function lerEnvAdminMaster(env = {}) {
  const id = texto(env.OPTIMUS_ADMIN_MASTER_ID || "admin") || "admin";
  const nome = texto(env.OPTIMUS_ADMIN_MASTER_NAME || "Admin Master") || "Admin Master";
  const email = textoLower(env.OPTIMUS_ADMIN_MASTER_EMAIL);
  const senha = String(env.OPTIMUS_ADMIN_MASTER_PASSWORD || "");

  return { id, nome, email, senha };
}

function bootstrapAdminMaster({
  usuarios = [],
  env = process.env,
  gerarSenhaHashSync = null,
  salvarUsuarios = null,
  agora = new Date()
} = {}) {
  if (!Array.isArray(usuarios)) {
    return { alterou: false, motivo: "usuarios_invalidos" };
  }

  if (adminMasterExistenteValido(usuarios)) {
    return { alterou: false, motivo: "admin_master_existente_preservado" };
  }

  const credenciais = lerEnvAdminMaster(env);
  if (!validarEmail(credenciais.email) || credenciais.senha.length < 8) {
    return {
      alterou: false,
      motivo: "env_admin_master_incompleta",
      envsNecessarias: [
        "OPTIMUS_ADMIN_MASTER_EMAIL",
        "OPTIMUS_ADMIN_MASTER_PASSWORD"
      ]
    };
  }

  if (usuarios.some((usuario) =>
    usuario &&
    (textoLower(usuario.email) === credenciais.email || texto(usuario.id) === credenciais.id)
  )) {
    return { alterou: false, motivo: "usuario_admin_bootstrap_ja_reservado" };
  }

  if (typeof gerarSenhaHashSync !== "function") {
    return { alterou: false, motivo: "gerador_hash_indisponivel" };
  }

  const criadoEm = new Date(agora).toISOString();
  const admin = {
    id: credenciais.id,
    nome: credenciais.nome,
    email: credenciais.email,
    senhaHash: gerarSenhaHashSync(credenciais.senha),
    papel: "admin_master",
    plano: "master",
    planoAssinatura: "master",
    creditos: 0,
    statusConta: "ativa",
    assinaturaStatus: "manual",
    origemCadastro: "bootstrap_clean_install",
    ativo: true,
    criadoEm,
    bootstrapCleanInstall: true
  };

  usuarios.push(admin);

  if (typeof salvarUsuarios === "function") {
    salvarUsuarios();
  }

  return {
    alterou: true,
    motivo: "admin_master_bootstrap",
    id: admin.id,
    email: admin.email
  };
}

function aplicarBootstrapInstalacaoLimpa({
  usuarios = [],
  planos = {},
  env = process.env,
  gerarSenhaHashSync = null,
  salvarUsuarios = null,
  salvarPlanos = null,
  logger = console
} = {}) {
  const resultadoPlanos = bootstrapPlanosOficiais({ planos, salvarPlanos });
  const resultadoAdmin = bootstrapAdminMaster({
    usuarios,
    env,
    gerarSenhaHashSync,
    salvarUsuarios
  });

  if (logger && typeof logger.log === "function") {
    logger.log("[CLEAN-INSTALL-BOOTSTRAP]", {
      planos: resultadoPlanos.motivo,
      adminMaster: resultadoAdmin.motivo,
      planosCriados: resultadoPlanos.total || 0,
      adminCriado: resultadoAdmin.alterou === true
    });
  }

  return {
    planos: resultadoPlanos,
    adminMaster: resultadoAdmin
  };
}

module.exports = {
  catalogoPlanosOficiaisAtuais,
  normalizarCatalogoBootstrap,
  bootstrapPlanosOficiais,
  adminMasterExistenteValido,
  lerEnvAdminMaster,
  bootstrapAdminMaster,
  aplicarBootstrapInstalacaoLimpa
};
