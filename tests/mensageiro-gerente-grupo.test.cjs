const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-mensageiro-gerente-"));
process.env.DATA_DIR = dataDir;

const { writeGlobalJson } = require("../utils/storage");
const storage = require("../modules/mensageiro/storage");
const mensageiro = require("../modules/mensageiro");
const criarRotasMensageiro = require("../modules/mensageiro/routes");
const {
  resolverBotAdminGerente
} = require("../modules/mensageiro/gerente-identidade");

writeGlobalJson("usuarios.json", [{ id: "cliente_gerente", ativo: true }]);

const clienteId = "cliente_gerente";
const sessaoId = "sessao_gerente";
const grupoId = "grupo_gerente@g.us";
const participante = "5511999999999@s.whatsapp.net";
const botJid = "559988776655@s.whatsapp.net";

function regra(id, patch = {}) {
  return {
    id,
    ativo: true,
    nome: patch.nome || id,
    tipo: patch.tipo || "palavras_proibidas",
    parametros: patch.parametros || { palavras: ["proibido"] },
    acao: patch.acao || "apagar_avisar",
    limiteInfracoes: patch.limiteInfracoes || 3,
    avisoTexto: patch.avisoTexto || "",
    temporizarAviso: patch.temporizarAviso,
    apagarAvisoAposSegundos: patch.apagarAvisoAposSegundos || 1
  };
}

function perfilGerente(patch = {}) {
  return {
    id: patch.id || "perfil_gerente",
    nome: patch.nome || "Perfil Gerente",
    ativo: patch.ativo === undefined ? true : patch.ativo,
    sessaoId: patch.sessaoId || sessaoId,
    grupos: patch.grupos || [grupoId],
    modulos: {
      boasVindas: { ativo: false, configuracao: { mensagem: "", imagem: "", envio: { destino: "privado" } } },
      despedida: { ativo: false, configuracao: { mensagem: "", imagem: "", envio: { destino: "privado" } } },
      comandos: { ativo: true },
      programacoes: { ativo: true },
      gerente: {
        ativo: patch.gerenteAtivo === undefined ? true : patch.gerenteAtivo,
        grupos: patch.gerenteGrupos || [],
        gruposConfigurados: patch.gerenteGruposConfigurados === true,
        configuracao: {
          regras: patch.regras || [regra("r_palavra")],
          isentarAdmins: patch.isentarAdmins === undefined ? true : patch.isentarAdmins,
          isentarDono: patch.isentarDono === undefined ? true : patch.isentarDono,
          autorizados: patch.autorizados || [],
          moderadores: patch.moderadores || [],
          resetInfracoesDias: patch.resetInfracoesDias || 30,
          avisoTemporario: patch.avisoTemporario === undefined ? true : patch.avisoTemporario,
          apagarAvisoAposSegundos: patch.apagarAvisoAposSegundos || 1
        }
      }
    }
  };
}

function configurar({ perfis = [perfilGerente()], grupos = [grupoId], ativo = true } = {}) {
  storage.setMensageiroCliente(clienteId, {
    ativo,
    sessaoId,
    sessaoWhatsappId: sessaoId,
    sessaoGruposId: sessaoId,
    grupos,
    perfis,
    comandos: [{
      id: "cmd_pix",
      ativo: true,
      nome: "Pix",
      gatilhos: ["!pix"],
      correspondencia: "exato",
      resposta: { tipo: "texto", texto: "pix ok", imagem: "" },
      cooldownSegundos: 5,
      cooldownParticipanteSegundos: 5
    }]
  });
}

function criarSock({
  botAdmin = true,
  alvoAdmin = false,
  alvoDono = false,
  falharDelete = false,
  falharMetadata = false,
  botUser = null,
  botParticipant = null,
  authState = null
} = {}) {
  const envios = [];
  const remocoes = [];
  const participanteBot = botParticipant ? { ...botParticipant } : { id: botJid };
  if (participanteBot.admin === undefined) {
    participanteBot.admin = botAdmin ? "admin" : null;
  }
  return {
    user: botUser || { id: botJid },
    ...(authState ? { authState } : {}),
    envios,
    remocoes,
    async groupMetadata(jid) {
      if (falharMetadata) throw new Error("metadata_falhou");
      assert.strictEqual(jid, grupoId, "metadata usa grupo recebido");
      return {
        id: jid,
        participants: [
          participanteBot,
          { id: participante, admin: alvoDono ? "superadmin" : alvoAdmin ? "admin" : null },
          { id: "5511888888888@s.whatsapp.net", admin: null }
        ]
      };
    },
    async sendMessage(jid, payload) {
      envios.push({ jid, payload });
      if (payload.delete && falharDelete) throw new Error("delete_falhou");
      if (payload.delete) return {};
      return { key: { remoteJid: jid, id: `aviso_${envios.length}`, fromMe: true } };
    },
    async groupParticipantsUpdate(jid, participantes, action) {
      remocoes.push({ jid, participantes, action });
      return [{ status: "200" }];
    }
  };
}

function mensagem({ texto = "texto permitido", id = "msg_1", grupo = grupoId, fromMe = false, jidParticipante = participante, midia = "" } = {}) {
  const key = { remoteJid: grupo, participant: jidParticipante, fromMe, id };
  let message = { conversation: texto };
  if (midia === "imagem") message = { imageMessage: { caption: texto } };
  if (midia === "video") message = { videoMessage: { caption: texto } };
  if (midia === "audio") message = { audioMessage: {} };
  if (midia === "documento") message = { documentMessage: {} };
  if (midia === "sticker") message = { stickerMessage: {} };
  return { key, pushName: "Joao", message };
}

async function processar({ msg = mensagem({ texto: "proibido" }), sock = criarSock(), planoLiberado = true } = {}) {
  const resultado = await mensageiro.tratarMensagemGrupoGerente({
    clienteId,
    sessaoId,
    sock,
    mensagem: msg,
    planoLiberado
  });
  return { resultado, sock, msg };
}

function infracoes(filtro = {}) {
  return storage.listarInfracoesGerenteCliente(clienteId, filtro);
}

function ultimosMotivos(filtro = {}) {
  return storage.listarUltimosMotivosGerenteCliente(clienteId, filtro);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function consultarStatusGerente({ perfilId = "perfil_gerente", sock = criarSock() } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/mensageiro", criarRotasMensageiro({
    getClienteId: () => clienteId,
    usuarioTemRecurso: () => true,
    getMensageiroCliente: storage.getMensageiroCliente,
    setMensageiroCliente: storage.setMensageiroCliente,
    getAtendimentoConfigCliente: storage.getAtendimentoConfigCliente,
    setAtendimentoConfigCliente: storage.setAtendimentoConfigCliente,
    validarPerfisMensageiro: storage.validarPerfisMensageiro,
    listarInfracoesGerenteCliente: storage.listarInfracoesGerenteCliente,
    zerarInfracaoGerenteCliente: storage.zerarInfracaoGerenteCliente,
    listarUltimosMotivosGerenteCliente: storage.listarUltimosMotivosGerenteCliente,
    referenciaGrupoGerente: storage.referenciaGrupoGerente,
    listarSessoesMensageiro: () => [{ id: sessaoId, nome: "Sessao Teste" }],
    listarGruposSessaoMensageiro: () => [{ id: grupoId, nome: "Grupo Teste" }],
    getSockMensageiro: () => sock
  }));
  const server = app.listen(0);
  try {
    const porta = server.address().port;
    const resp = await fetch(`http://127.0.0.1:${porta}/mensageiro/gerente/status?perfilId=${encodeURIComponent(perfilId)}`);
    assert.strictEqual(resp.status, 200);
    return resp.json();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  let diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: botJid, admin: "admin" }] }
  );
  assert.deepStrictEqual(
    { encontrado: diagnosticoBot.botEncontrado, admin: diagnosticoBot.botAdmin, tipo: diagnosticoBot.tipoAliasMatch },
    { encontrado: true, admin: true, tipo: "id" },
    "bot PN + participant PN detecta admin"
  );

  const botLid = "123456789012345@lid";
  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: botLid, jid: botJid, lid: botLid, admin: "admin" }] }
  );
  assert.deepStrictEqual(
    { encontrado: diagnosticoBot.botEncontrado, admin: diagnosticoBot.botAdmin, tipo: diagnosticoBot.tipoAliasMatch },
    { encontrado: true, admin: true, tipo: "jid" },
    "bot PN + participant LID com participant.jid PN detecta admin"
  );

  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botLid } },
    { participants: [{ id: botJid, jid: botJid, lid: botLid, admin: "admin" }] }
  );
  assert.deepStrictEqual(
    { encontrado: diagnosticoBot.botEncontrado, admin: diagnosticoBot.botAdmin, tipo: diagnosticoBot.tipoAliasMatch },
    { encontrado: true, admin: true, tipo: "lid" },
    "bot LID + participant PN com participant.lid LID detecta admin"
  );

  diagnosticoBot = resolverBotAdminGerente(
    {
      user: { id: "nao_match@s.whatsapp.net", jid: botJid, lid: botLid },
      authState: { creds: { me: { id: "outro@s.whatsapp.net", jid: botJid, lid: botLid } } }
    },
    { participants: [{ id: botLid, jid: botJid, lid: botLid, admin: "admin" }] }
  );
  assert.strictEqual(diagnosticoBot.botAdmin, true, "bot com aliases multiplos detecta admin uma vez");

  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: botJid, admin: "superadmin" }] }
  );
  assert.strictEqual(diagnosticoBot.botAdmin, true, "participant superadmin detecta admin");

  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: botJid, admin: null }] }
  );
  assert.strictEqual(diagnosticoBot.botEncontrado, true, "participant sem admin ainda e encontrado");
  assert.strictEqual(diagnosticoBot.botAdmin, false, "participant sem admin nao vira admin");

  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: botLid, lid: botLid, admin: "admin" }] }
  );
  assert.strictEqual(diagnosticoBot.botEncontrado, false, "aliases nao relacionados nao fazem match");
  assert.strictEqual(diagnosticoBot.botAdmin, false, "aliases nao relacionados nao viram admin");

  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: "5511777777777@s.whatsapp.net", admin: "admin" }] }
  );
  assert.strictEqual(diagnosticoBot.botEncontrado, false, "metadata sem bot nao encontra admin");

  diagnosticoBot = resolverBotAdminGerente(
    { user: { id: botJid } },
    { participants: [{ id: botJid }] }
  );
  assert.strictEqual(diagnosticoBot.botEncontrado, true, "ausencia de lid/jid opcional nao quebra");
  assert.strictEqual(diagnosticoBot.botAdmin, false, "ausencia de admin opcional nao vira admin");

  configurar({ perfis: [] });
  let ctx = await processar();
  assert.strictEqual(ctx.resultado.bloqueada, false, "perfil legado nao ativa Gerente");
  assert.strictEqual(ctx.sock.envios.length, 0, "default off nao apaga");
  assert.strictEqual(infracoes().length, 0, "default off nao registra infracao");

  configurar({ perfis: [perfilGerente({ gerenteAtivo: false })] });
  ctx = await processar();
  assert.strictEqual(ctx.sock.envios.length, 0, "Gerente inativo nao age");
  assert.strictEqual(ultimosMotivos().at(-1)?.codigo, "perfil_nao_encontrado", "fluxo de mensagem registra gate sem modulo Gerente ativo");

  configurar({ perfis: [perfilGerente({ grupos: ["outro@g.us"] })] });
  ctx = await processar();
  assert.strictEqual(ctx.sock.envios.length, 0, "grupo fora do perfil nao age");

  configurar({ perfis: [perfilGerente({ sessaoId: "sessao_errada" })] });
  ctx = await processar();
  assert.strictEqual(ctx.sock.envios.length, 0, "sessao errada nao age");

  configurar({ perfis: [perfilGerente({ grupos: [], gerenteGrupos: [grupoId], gerenteGruposConfigurados: true, regras: [regra("r_gerente_alcance", { acao: "apagar" })] })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "gerente_alcance_proprio" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "gerente.grupos proprio funciona sem depender de perfil.grupos");

  configurar({ perfis: [perfilGerente({ grupos: [grupoId], gerenteGrupos: [], gerenteGruposConfigurados: true })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "gerente_vazio_explicito" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "gerente.grupos=[] explicito nao modera grupo algum");

  configurar({ perfis: [perfilGerente({ ativo: false })] });
  let statusGerente = await consultarStatusGerente();
  assert.strictEqual(statusGerente.estado, "perfil_inativo", "status operacional mostra perfil OFF");

  configurar({ perfis: [perfilGerente({ gerenteAtivo: false })] });
  statusGerente = await consultarStatusGerente();
  assert.strictEqual(statusGerente.estado, "gerente_inativo", "status operacional mostra Gerente OFF");

  configurar({ perfis: [perfilGerente({ regras: [] })] });
  statusGerente = await consultarStatusGerente();
  assert.strictEqual(statusGerente.estado, "sem_regras_ativas", "status operacional mostra ausencia de regras");

  configurar({ perfis: [perfilGerente({ grupos: [] })] });
  statusGerente = await consultarStatusGerente();
  assert.strictEqual(statusGerente.estado, "grupo_fora_do_perfil", "status operacional mostra ausencia de grupo no perfil");

  configurar();
  statusGerente = await consultarStatusGerente({ sock: criarSock({ botAdmin: false }) });
  assert.strictEqual(statusGerente.estado, "bot_sem_admin", "status operacional mostra bot sem admin");
  assert.strictEqual(statusGerente.perfis[0].grupos[0].permissao, "sem_permissao", "permissao sem admin fica explicita");

  configurar();
  statusGerente = await consultarStatusGerente();
  assert.strictEqual(statusGerente.estado, "pronto_para_moderar", "status operacional mostra pronto quando admin");
  assert.strictEqual(statusGerente.perfis[0].grupos[0].grupoId, undefined, "diagnostico nao expoe JID bruto");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_alias_jid", { acao: "apagar" })] })] });
  const sockBotPnGrupoLid = criarSock({
    botUser: { id: botJid },
    botParticipant: { id: botLid, jid: botJid, lid: botLid, admin: "admin" }
  });
  statusGerente = await consultarStatusGerente({ sock: sockBotPnGrupoLid });
  assert.strictEqual(statusGerente.estado, "pronto_para_moderar", "status detecta admin por participant.jid");
  assert.strictEqual(statusGerente.perfis[0].grupos[0].botEncontrado, true, "status informa bot encontrado sem JID bruto");
  assert.strictEqual(statusGerente.perfis[0].grupos[0].botAdmin, true, "status informa bot admin sem JID bruto");
  assert.strictEqual(statusGerente.perfis[0].grupos[0].tipoAliasMatch, "jid", "status informa tipo de alias sem valor bruto");
  ctx = await processar({ sock: sockBotPnGrupoLid, msg: mensagem({ texto: "proibido", id: "bot_pn_grupo_lid" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "runtime tambem detecta admin por participant.jid");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_alias_lid", { acao: "apagar" })] })] });
  const sockBotLidGrupoPn = criarSock({
    botUser: { id: botLid },
    botParticipant: { id: botJid, jid: botJid, lid: botLid, admin: "admin" }
  });
  statusGerente = await consultarStatusGerente({ sock: sockBotLidGrupoPn });
  assert.strictEqual(statusGerente.estado, "pronto_para_moderar", "status detecta admin por participant.lid");
  assert.strictEqual(statusGerente.perfis[0].grupos[0].tipoAliasMatch, "lid", "status informa alias lid sem valor bruto");
  ctx = await processar({ sock: sockBotLidGrupoPn, msg: mensagem({ texto: "proibido", id: "bot_lid_grupo_pn" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "runtime tambem detecta admin por participant.lid");

  configurar();
  ctx = await processar({ msg: mensagem({ fromMe: true }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "fromMe ignorado");

  ctx = await processar({ msg: mensagem({ grupo: "5511999999999@s.whatsapp.net" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "privado ignorado");

  ctx = await processar({ msg: mensagem({ texto: "mensagem normal", id: "sem_violacao" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "sem violacao permite");

  configurar({ perfis: [perfilGerente({ regras: [regra("incerta", { tipo: "palavras_proibidas", parametros: { palavras: [] } })] })] });
  ctx = await processar({ msg: mensagem({ texto: "qualquer texto", id: "incerto" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "regra incerta permite");

  configurar();
  const sockErro = criarSock({ falharMetadata: true });
  ctx = await processar({ sock: sockErro, msg: mensagem({ texto: "proibido", id: "erro_interno" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "erro interno permite sem apagar");
  assert.strictEqual(infracoes().length, 0, "erro interno nao registra infracao");

  const msgPalavra = mensagem({ texto: "isso e proibido", id: "palavra" });
  ctx = await processar({ msg: msgPalavra });
  assert.strictEqual(ctx.resultado.bloqueada, true, "palavra proibida gera acao");
  assert.strictEqual(ctx.sock.envios[0].payload.delete, msgPalavra.key, "delete usa exatamente a key original");
  assert.ok(infracoes().some(item => item.regraId === "r_palavra"), "apagar + avisar registra infracao");
  const arquivoOperacional = path.join(dataDir, "clientes", clienteId, "mensageiro-gerente-operacional.json");
  const diagnosticoOperacional = fs.readFileSync(arquivoOperacional, "utf8");
  assert.strictEqual(diagnosticoOperacional.includes("isso e proibido"), false, "diagnostico operacional nao persiste conteudo da mensagem");
  assert.strictEqual(diagnosticoOperacional.includes(grupoId), false, "diagnostico operacional nao persiste JID bruto do grupo");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_p", { tipo: "palavroes", parametros: { palavras: ["lixo"] } })] })] });
  ctx = await processar({ msg: mensagem({ texto: "palavra lixo aqui", id: "palavrao" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "palavrao customizado gera acao");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_link", { tipo: "links_externos", parametros: { dominiosPermitidos: ["optimuspromo.com.br"] } })] })] });
  ctx = await processar({ msg: mensagem({ texto: "acesse https://spam.example/oferta", id: "link" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "link externo gera acao");
  ctx = await processar({ msg: mensagem({ texto: "acesse https://www.optimuspromo.com.br/ok", id: "link_ok" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "dominio permitido passa");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_convite", { tipo: "convite_whatsapp" })] })] });
  ctx = await processar({ msg: mensagem({ texto: "entra https://chat.whatsapp.com/abcdef", id: "convite" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "convite WhatsApp gera acao");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_div", { tipo: "divulgacao", parametros: { palavras: ["me chama no pv"] } })] })] });
  ctx = await processar({ msg: mensagem({ texto: "me chama no pv", id: "divulgacao" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "divulgacao configurada gera acao");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_midia", { tipo: "midia_bloqueada", parametros: { tiposMidia: ["video"] } })] })] });
  ctx = await processar({ msg: mensagem({ texto: "", midia: "imagem", id: "midia_ok" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "midia permitida passa");
  ctx = await processar({ msg: mensagem({ texto: "", midia: "video", id: "midia_block" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "midia bloqueada gera delete");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_caption", { tipo: "links_externos" })] })] });
  ctx = await processar({ msg: mensagem({ texto: "caption https://x.example", midia: "imagem", id: "caption" }) });
  assert.strictEqual(ctx.resultado.bloqueada, true, "caption passa por regra textual");

  configurar();
  ctx = await processar({ sock: criarSock({ alvoAdmin: true }), msg: mensagem({ texto: "proibido", id: "admin" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "admin isento");

  ctx = await processar({ sock: criarSock({ alvoDono: true }), msg: mensagem({ texto: "proibido", id: "dono" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "dono isento");

  configurar({ perfis: [perfilGerente({ autorizados: [participante] })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "autorizado" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "autorizado isento");

  configurar({ perfis: [perfilGerente({ moderadores: [participante] })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "moderador" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "moderador isento");

  configurar();
  ctx = await processar({ sock: criarSock({ botAdmin: false }), msg: mensagem({ texto: "proibido", id: "sem_admin" }) });
  assert.strictEqual(ctx.sock.envios.length, 0, "bot sem admin nao executa destrutivo");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_apagar", { acao: "apagar" })] })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "apagar" }) });
  assert.strictEqual(ctx.sock.envios.length, 1, "apagar simples so deleta");
  assert.strictEqual(infracoes({ perfilId: "perfil_gerente" }).some(item => item.regraId === "r_apagar"), false, "apagar simples nao registra infracao");

  configurar({ perfis: [perfilGerente({ avisoTemporario: true, regras: [regra("r_aviso", { acao: "apagar_avisar", apagarAvisoAposSegundos: 1 })] })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "aviso" }) });
  assert.strictEqual(ctx.sock.envios.length, 2, "apagar + aviso envia delete e aviso");
  assert.ok(ctx.sock.envios[1].payload.text.includes("Aviso 1 de 3"), "aviso informa contador");
  await sleep(1100);
  assert.strictEqual(ctx.sock.envios.length, 3, "aviso temporario agenda delete do proprio aviso");
  assert.deepStrictEqual(ctx.sock.envios[2].payload.delete, { remoteJid: grupoId, id: "aviso_2", fromMe: true }, "delete temporario usa key do aviso");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_limite", { acao: "avisos_depois_remover", limiteInfracoes: 3, temporizarAviso: false })] })] });
  const sockLimite = criarSock();
  await processar({ sock: sockLimite, msg: mensagem({ texto: "proibido", id: "limite_1" }) });
  await processar({ sock: sockLimite, msg: mensagem({ texto: "proibido", id: "limite_2" }) });
  await processar({ sock: sockLimite, msg: mensagem({ texto: "proibido", id: "limite_3" }) });
  assert.strictEqual(sockLimite.remocoes.length, 1, "remove ao atingir limite");
  assert.deepStrictEqual(sockLimite.remocoes[0], { jid: grupoId, participantes: [participante], action: "remove" }, "remocao usa participante do grupo");
  assert.ok(infracoes({ regraId: "r_limite" }).some(item => item.status === "removido" && item.removidoEm), "remocao marca infracao como removida");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_remove", { acao: "remover_imediato" })] })] });
  ctx = await processar({ msg: mensagem({ texto: "proibido", id: "remove_imediato" }) });
  assert.strictEqual(ctx.sock.remocoes.length, 1, "remocao imediata so quando configurada");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_grupo", { acao: "apagar_avisar" })] })] });
  await processar({ msg: mensagem({ texto: "proibido", id: "persist_1" }) });
  await processar({ msg: mensagem({ texto: "proibido", id: "persist_2" }) });
  assert.ok(infracoes().some(item => item.regraId === "r_grupo" && item.contador >= 2), "contador persiste");
  storage.zerarInfracaoGerenteCliente(clienteId, { regraId: "r_grupo" });
  assert.ok(infracoes({ regraId: "r_grupo" }).every(item => item.contador === 0 || item.status === "zerada"), "reset manual zera");

  configurar({
    perfis: [perfilGerente({
      regras: [regra("r_reset", { acao: "apagar_avisar" })],
      resetInfracoesDias: 1
    })]
  });
  await processar({ msg: mensagem({ texto: "proibido", id: "reset_1" }) });
  const arquivo = path.join(dataDir, "clientes", clienteId, "mensageiro-gerente-infracoes.json");
  const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  dados.infracoes = dados.infracoes.map(item => item.regraId === "r_reset"
    ? { ...item, ultimaInfracaoEm: "2000-01-01T00:00:00.000Z" }
    : item);
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
  await processar({ msg: mensagem({ texto: "proibido", id: "reset_2" }) });
  assert.ok(infracoes({ regraId: "r_reset" }).some(item => item.contador === 1), "reset automatico por dias reinicia contador");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_flood", { tipo: "flood", parametros: { maxMensagens: 2, janelaSegundos: 60 } })] })] });
  const sockFlood = criarSock();
  await processar({ sock: sockFlood, msg: mensagem({ texto: "a", id: "flood_1" }) });
  await processar({ sock: sockFlood, msg: mensagem({ texto: "b", id: "flood_2" }) });
  await processar({ sock: sockFlood, msg: mensagem({ texto: "c", id: "flood_3" }) });
  assert.strictEqual(sockFlood.envios.length > 0, true, "flood conservador dispara apos limite");

  configurar({ perfis: [perfilGerente({ regras: [regra("r_rep", { tipo: "repeticao", parametros: { repeticoes: 3, janelaSegundos: 60, minCaracteres: 4 } })] })] });
  const sockRep = criarSock();
  await processar({ sock: sockRep, msg: mensagem({ texto: "repete agora", id: "rep_1" }) });
  await processar({ sock: sockRep, msg: mensagem({ texto: "repete agora", id: "rep_2" }) });
  await processar({ sock: sockRep, msg: mensagem({ texto: "repete agora", id: "rep_3" }) });
  assert.strictEqual(sockRep.envios.length > 0, true, "repeticao dispara no limite");

  configurar();
  const sockDedupe = criarSock();
  await processar({ sock: sockDedupe, msg: mensagem({ texto: "proibido", id: "dedupe" }) });
  await processar({ sock: sockDedupe, msg: mensagem({ texto: "proibido", id: "dedupe" }) });
  assert.strictEqual(sockDedupe.envios.filter(e => e.payload.delete).length, 1, "messageId duplicado nao apaga duas vezes");

  configurar();
  const sockBot = criarSock();
  const msgBot = mensagem({ texto: "proibido", id: "bot_bloqueado" });
  const resultadoGerente = await mensageiro.tratarMensagemGrupoGerente({ clienteId, sessaoId, sock: sockBot, mensagem: msgBot, planoLiberado: true });
  if (resultadoGerente.bloqueada !== true) {
    await mensageiro.tratarMensagemGrupoComando({ clienteId, sessaoId, sock: sockBot, mensagem: msgBot, planoLiberado: true });
  }
  assert.strictEqual(sockBot.envios.some(e => e.payload.text === "pix ok"), false, "mensagem bloqueada nao dispara Bot");

  const sockBotOk = criarSock();
  const msgBotOk = mensagem({ texto: "!pix", id: "bot_ok" });
  const resultadoGerenteOk = await mensageiro.tratarMensagemGrupoGerente({ clienteId, sessaoId, sock: sockBotOk, mensagem: msgBotOk, planoLiberado: true });
  if (resultadoGerenteOk.bloqueada !== true) {
    await mensageiro.tratarMensagemGrupoComando({ clienteId, sessaoId, sock: sockBotOk, mensagem: msgBotOk, planoLiberado: true });
  }
  assert.ok(sockBotOk.envios.some(e => e.payload.text === "pix ok"), "mensagem permitida ainda dispara Bot");

  const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.ok(indexFonte.indexOf("processarMensagemRadarAutomatica") < indexFonte.indexOf("tratarMensagemGrupoGerente"), "Radar continua antes do Gerente");
  assert.ok(indexFonte.indexOf("tratarMensagemGrupoGerente") < indexFonte.indexOf("tratarMensagemGrupoComando"), "Gerente entra antes do Bot");
  assert.ok(indexFonte.includes("resultadoGerente?.bloqueada !== true"), "Bot so roda quando Gerente nao bloqueia");
  assert.ok(indexFonte.match(/messages\.upsert/g).length >= 1, "listener unico preservado");

  const configAntiga = storage.setMensageiroCliente("cliente_antigo_gerente", { ativo: true });
  assert.deepStrictEqual(configAntiga.perfis, [], "config antiga continua valida");

  console.log("mensageiro-gerente-grupo.test.cjs OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
