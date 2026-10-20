const assert = require("assert");
const express = require("express");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-route-delete-"));
const { writeGlobalJson } = require("../utils/storage");
writeGlobalJson("usuarios.json", [{ id: "cliente_route", ativo: true }]);
const storage = require("../modules/mensageiro/storage");
const criarRotasMensageiro = require("../modules/mensageiro/routes");

function perfil() {
  return {
    id: "perfil_route",
    nome: "Perfil Route",
    ativo: true,
    sessaoId: "sessao_route",
    grupos: ["grupo_route@g.us"],
    modulos: {
      boasVindas: { ativo: true },
      despedida: { ativo: true },
      comandos: { ativo: true },
      programacoes: { ativo: true },
      gerente: { ativo: false, configuracao: {} }
    }
  };
}

function request(port, method, body) {
  return new Promise((resolve, reject) => {
    const serialized = body ? JSON.stringify(body) : "";
    const req = http.request({
      port,
      path: "/mensageiro/perfis/perfil_route",
      method,
      headers: body ? { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) } : {}
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (body) req.end(serialized);
    else req.end();
  });
}

(async () => {
  storage.setMensageiroCliente("cliente_route", { ativo: true, perfis: [perfil()] });
  const app = express();
  app.use(express.json());
  app.use("/mensageiro", criarRotasMensageiro({
    getClienteId: () => "cliente_route",
    usuarioTemRecurso: () => true,
    getMensageiroCliente: storage.getMensageiroCliente,
    setMensageiroCliente: storage.setMensageiroCliente,
    excluirPerfilMensageiro: storage.excluirPerfilMensageiro,
    getAtendimentoConfigCliente: storage.getAtendimentoConfigCliente,
    setAtendimentoConfigCliente: storage.setAtendimentoConfigCliente,
    getAtendimentoConfigPerfilCliente: storage.getAtendimentoConfigPerfilCliente,
    setAtendimentoConfigPerfilCliente: storage.setAtendimentoConfigPerfilCliente,
    listarVinculosContatoPerfilCliente: storage.listarVinculosContatoPerfilCliente,
    salvarVinculoContatoPerfilCliente: storage.salvarVinculoContatoPerfilCliente,
    removerVinculoContatoPerfilCliente: storage.removerVinculoContatoPerfilCliente,
    validarPerfisMensageiro: storage.validarPerfisMensageiro,
    moduloPossuiAlcanceProprio: storage.moduloPossuiAlcanceProprio,
    gruposAlcanceModuloPerfil: storage.gruposAlcanceModuloPerfil,
    referenciaGrupoGerente: storage.referenciaGrupoGerente
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const semConfirmacao = await request(port, "DELETE");
    assert.strictEqual(semConfirmacao.status, 400, "exclusao exige confirmacao explicita");
    const primeira = await request(port, "DELETE", { confirmar: true });
    assert.strictEqual(primeira.status, 200, "exclusao autorizada retorna sucesso");
    assert.strictEqual(primeira.body.ok, true);
    const segunda = await request(port, "DELETE", { confirmar: true });
    assert.strictEqual(segunda.status, 200, "repeticao permanece idempotente");
    assert.strictEqual(segunda.body.jaExcluido, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("mensageiro-profile-delete-route.test.cjs OK");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
