"use strict";

async function autenticarUsuarioGoogleExistente({
  usuario,
  identidade,
  usuarios = [],
  resolverUsuarioAtual = () => usuario,
  serializar = fn => fn(),
  emitirJwt,
  lerSaldo,
  vincular,
  salvarUsuarios,
  onStage = () => {}
} = {}) {
  if (!usuario || typeof usuario !== "object") {
    throw new Error("google_existing_user_required");
  }
  if (typeof emitirJwt !== "function" || typeof lerSaldo !== "function" ||
      typeof vincular !== "function" || typeof salvarUsuarios !== "function" ||
      typeof resolverUsuarioAtual !== "function" || typeof serializar !== "function") {
    throw new Error("google_existing_login_dependencies_required");
  }

  return serializar(async () => {
    // Revalidate under the same SaaS lock used by signup/admin mutations so
    // concurrent Google subjects cannot overwrite one another's association.
    const usuarioAtual = resolverUsuarioAtual(identidade);
    if (!usuarioAtual || usuarioAtual.id !== usuario.id) {
      const erro = new Error("Google identity changed during authentication");
      erro.codigo = "google_identidade_alterada";
      erro.statusCode = 409;
      throw erro;
    }

    // Prepare every fallible read/credential operation before staging the link.
    onStage("google.jwt_issue");
    const token = emitirJwt(usuarioAtual);
    onStage("google.balance_read");
    const creditos = await lerSaldo(usuarioAtual.id, usuarioAtual);
    const indice = usuarios.indexOf(usuarioAtual);
    if (indice < 0) throw new Error("google_existing_user_not_in_registry");

    const atualizado = structuredClone(usuarioAtual);
    onStage("google.link_stage");
    vincular(atualizado, identidade);
    const usuariosAtualizados = usuarios.slice();
    usuariosAtualizados[indice] = atualizado;

    // Persist a detached snapshot first. A failed write must not mutate RAM state.
    onStage("google.link_persist");
    await salvarUsuarios(usuariosAtualizados);
    Object.assign(usuarioAtual, atualizado);

    return { usuario: usuarioAtual, token, creditos };
  });
}

module.exports = { autenticarUsuarioGoogleExistente };
