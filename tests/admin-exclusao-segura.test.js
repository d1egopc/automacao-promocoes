const assert = require("assert");
const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const frontendRoot = path.resolve(backendRoot, "..", "optimuspromo-frontend");

const indexFonte = fs.readFileSync(path.join(backendRoot, "index.js"), "utf8");
const adminFonte = fs.readFileSync(path.join(frontendRoot, "src", "routes", "admin.tsx"), "utf8");

function trechoEntre(fonte, inicio, fim) {
  const i = fonte.indexOf(inicio);
  const j = fonte.indexOf(fim, i + inicio.length);
  assert.ok(i >= 0, `inicio ausente: ${inicio}`);
  assert.ok(j > i, `fim ausente: ${fim}`);
  return fonte.slice(i, j);
}

const rotaExcluirUsuario = trechoEntre(
  indexFonte,
  'app.delete("/admin/usuarios/:id"',
  'app.post("/admin/usuarios"'
);
const rotaExcluirPlano = trechoEntre(
  indexFonte,
  'app.delete("/admin/planos/:nome"',
  'app.delete("/admin/usuarios/:id"'
);

assert.ok(indexFonte.includes("function confirmacaoExclusaoValida"), "backend deve validar confirmacao forte");
assert.ok(indexFonte.includes("[ADMIN-EXCLUSAO]"), "backend deve registrar auditoria da exclusao");
assert.ok(rotaExcluirUsuario.includes("confirmacaoExclusaoValida(req)"), "excluir usuario exige EXCLUIR no backend");
assert.ok(rotaExcluirUsuario.includes('usuarioExcluir.papel === "admin_master"'), "admin_master nao pode ser excluido");
assert.ok(rotaExcluirUsuario.includes("salvarUsuarios();"), "exclusao remove apenas registro de usuarios.json");
assert.ok(!rotaExcluirUsuario.includes("delete configsPorCliente"), "exclusao de usuario nao apaga configuracoes");
assert.ok(!rotaExcluirUsuario.includes("delete destinosPorCliente"), "exclusao de usuario nao apaga destinos");
assert.ok(!rotaExcluirUsuario.includes("delete integracoesPorCliente"), "exclusao de usuario nao apaga integracoes");
assert.ok(!rotaExcluirUsuario.includes("salvarConfigsClientes"), "exclusao de usuario nao persiste remocao de configs");
assert.ok(!rotaExcluirUsuario.includes("salvarDestinosClientes"), "exclusao de usuario nao persiste remocao de destinos");
assert.ok(!rotaExcluirUsuario.includes("salvarIntegracoesPersistidas"), "exclusao de usuario nao persiste remocao de integracoes");

assert.ok(rotaExcluirPlano.includes("confirmacaoExclusaoValida(req)"), "excluir plano exige EXCLUIR no backend");
assert.ok(rotaExcluirPlano.includes("usuariosUsandoPlano.length > 0"), "plano em uso deve ser bloqueado");
assert.ok(rotaExcluirPlano.includes('motivo: "plano_em_uso"'), "bloqueio de plano em uso deve ser auditado");

assert.ok(adminFonte.includes("DialogFooter"), "frontend deve usar modal de confirmacao");
assert.ok(adminFonte.includes("Digite EXCLUIR para confirmar"), "modal deve orientar palavra de confirmacao");
assert.ok(adminFonte.includes('confirmacaoExclusao.trim() !== "EXCLUIR"'), "botao destrutivo fica desabilitado sem EXCLUIR");
assert.ok(adminFonte.includes('apiDelete(endpoint, { confirmacao: "EXCLUIR" })'), "frontend envia confirmacao ao backend");
assert.ok(adminFonte.includes('variant="destructive"'), "botao final deve ser visualmente destrutivo");
assert.ok(adminFonte.includes('if (event.key === "Enter") event.preventDefault();'), "Enter nao confirma acidentalmente");
assert.ok(adminFonte.includes("Cancelar"), "modal deve permitir cancelar");

console.log("admin-exclusao-segura.test.js OK");
