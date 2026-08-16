const assert = require("assert");
const fs = require("fs");
const path = require("path");

const indexFonte = fs.readFileSync(path.resolve(__dirname, "../index.js"), "utf8");

function pos(agulha) {
  const indice = indexFonte.indexOf(agulha);
  assert.ok(indice >= 0, `Trecho nao encontrado: ${agulha}`);
  return indice;
}

function blocoEntre(inicio, fim) {
  const a = pos(inicio);
  const b = indexFonte.indexOf(fim, a + inicio.length);
  assert.ok(b >= 0, `Marcador final nao encontrado apos ${inicio}: ${fim}`);
  assert.ok(a < b, `${inicio} deve vir antes de ${fim}`);
  return indexFonte.slice(a, b);
}

const inicioExecutor = pos("async function enviarParaDestinoInteligente");
const inicioWhatsapp = pos('if (String(destino.tipo || "").toLowerCase() === "whatsapp")');
const inicioDiscord = pos('if (String(destino.tipo || "").toLowerCase() === "discord")');
const inicioTelegram = pos('if (String(destino.tipo || "").toLowerCase() === "telegram")');

assert.ok(inicioExecutor < inicioWhatsapp, "Executor deve preservar branch WhatsApp existente");
assert.ok(inicioWhatsapp < inicioDiscord, "Discord deve ser branch explicito apos WhatsApp, sem mexer no sender WA");
assert.ok(inicioDiscord < inicioTelegram, "Discord deve vir antes do Telegram e nunca cair no fallback Telegram/WhatsApp");

const blocoDiscord = blocoEntre('if (String(destino.tipo || "").toLowerCase() === "discord")', "// ================= ENVIO TELEGRAM =================");
assert.ok(blocoDiscord.includes("validarDestinoDiscord"), "Executor automatico deve validar destino Discord antes de enviar");
assert.ok(blocoDiscord.includes("listarConexoesDiscord(clienteId)"), "Executor deve resolver conexao Discord no backend");
assert.ok(blocoDiscord.includes("channelId: destinoDiscordValidado.channelId"), "Executor deve usar channelId validado como autoridade");
assert.ok(blocoDiscord.includes("enviarDiscord"), "Executor deve reutilizar sender Discord homologado");
assert.ok(blocoDiscord.includes("imagemUrl: imagemEnvioExecutor.ok ? imagemEnvioExecutor.url : \"\""), "Discord deve usar imagem do contrato comum do Executor/Fila");
assert.ok(blocoDiscord.includes("if (!resultadoDiscord?.ok)"), "Discord deve tratar falha do sender como erro");
assert.ok(blocoDiscord.includes("messageId: resultadoDiscord.messageId"), "Resultado Discord deve persistir messageId sanitizado");
assert.ok(blocoDiscord.includes("statusHttp: resultadoDiscord.statusHttp"), "Resultado Discord deve persistir statusHttp sanitizado");
assert.ok(blocoDiscord.includes("imagemEnviada: resultadoDiscord.imagemEnviada === true"), "Resultado Discord deve persistir imagemEnviada sanitizado");
assert.ok(blocoDiscord.includes('tipo: "discord"'), "destinosEnviados deve registrar tipo discord");

assert.ok(
  blocoDiscord.indexOf("usuarioTemCreditos(clienteId, 1)") < blocoDiscord.indexOf("enviarDiscord"),
  "Credito deve ser verificado antes da tentativa Discord"
);
assert.ok(
  blocoDiscord.indexOf("if (!resultadoDiscord?.ok)") < blocoDiscord.indexOf("debitarCreditos(clienteId, 1)"),
  "Credito Discord so pode ser debitado apos sucesso real do sender"
);
assert.ok(
  blocoDiscord.indexOf("debitarCreditos(clienteId, 1)") < blocoDiscord.indexOf("oferta.destinosEnviados.push"),
  "Historico de sucesso Discord deve ocorrer no caminho de sucesso comprovado"
);
assert.ok(
  !/sendMessage\(|sendPhoto\(|api\.telegram\.org|sock\.sendMessage/.test(blocoDiscord),
  "Discord nao pode cair em primitiva WA/TG"
);

const blocoWhatsapp = blocoEntre('if (String(destino.tipo || "").toLowerCase() === "whatsapp")', "// ================= ENVIO DISCORD =================");
assert.ok(blocoWhatsapp.includes("sock.sendMessage(grupo"), "WhatsApp continua chamando sender WA atual");
assert.ok(!blocoWhatsapp.includes("enviarDiscord"), "WhatsApp nao deve conhecer sender Discord");

const blocoTelegram = blocoEntre('if (String(destino.tipo || "").toLowerCase() === "telegram")', "} catch (e) {");
assert.ok(blocoTelegram.includes("https://api.telegram.org/bot"), "Telegram continua chamando sender TG atual");
assert.ok(!blocoTelegram.includes("enviarDiscord"), "Telegram nao deve conhecer sender Discord");

const blocoDiagnostico = blocoEntre("function diagnosticarDisponibilidadeEnvioWorkspace", "function logEnvioDestinoDebug");
assert.ok(blocoDiagnostico.includes("const destinosDiscord = destinosBase.filter(destinoEhDiscord)"), "Diagnostico deve reconhecer Discord explicitamente");
assert.ok(blocoDiagnostico.includes("diagnosticarDestinoDiscordAptoEnvio"), "Diagnostico nao deve considerar Discord apto apenas por existir");
assert.ok(blocoDiagnostico.includes('tipo !== "discord"'), "Discord deve sair de destinosOutros genericos");
assert.ok(blocoDiagnostico.includes('discordTotal: destinosDiscord.length'), "Diagnostico deve reportar total Discord");
assert.ok(blocoDiagnostico.includes('"discord_indisponivel"'), "Diagnostico deve falhar controlado quando so Discord estiver indisponivel");

assert.ok(indexFonte.includes("function diagnosticarDestinoDiscordAptoEnvio"), "Helper de disponibilidade Discord deve existir");
assert.ok(indexFonte.includes("typeof enviarDiscord !== \"function\""), "Disponibilidade deve exigir sender Discord");
assert.ok(indexFonte.includes("obterConfigDiscord(process.env).botToken"), "Disponibilidade deve exigir bot token via config Discord encapsulada");
assert.ok(indexFonte.includes("listarConexoesDiscord(clienteId).find"), "Disponibilidade deve validar conexao do workspace");

for (const proibido of [
  "filaDiscord",
  "discordQueue",
  "schedulerDiscord",
  "processarFilaDiscord",
  "DistributorDiscord",
  "executorDiscordParalelo"
]) {
  assert.ok(!indexFonte.includes(proibido), `Nao deve criar pipeline paralelo Discord: ${proibido}`);
}

console.log("discord-executor-automatico.test.js OK");