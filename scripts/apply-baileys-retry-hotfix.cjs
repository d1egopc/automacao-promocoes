const fs = require("node:fs");
const path = require("node:path");

const BAILEYS_VERSION = "6.7.22";
const TARGET_RELATIVE = path.join(
  "node_modules",
  "@whiskeysockets",
  "baileys",
  "lib",
  "Socket",
  "messages-recv.js"
);

const ORIGINAL_BLOCK = [
  "                        retryMutex.mutex(async () => {",
  "                            if (ws.isOpen) {",
  "                                if (getBinaryNodeChild(node, 'unavailable')) {",
  "                                    return;",
  "                                }",
  "                                const encNode = getBinaryNodeChild(node, 'enc');",
  "                                await sendRetryRequest(node, !encNode);",
  "                                if (retryRequestDelayMs) {",
  "                                    await delay(retryRequestDelayMs);",
  "                                }",
  "                            }",
  "                            else {",
  "                                logger.debug({ node }, 'connection closed, ignoring retry req');",
  "                            }",
  "                        });"
].join("\n");

const PATCHED_BLOCK = [
  "                        await retryMutex.mutex(async () => {",
  "                            if (!ws.isOpen) {",
  "                                logger.debug('connection closed, ignoring retry req');",
  "                                return;",
  "                            }",
  "                            if (getBinaryNodeChild(node, 'unavailable')) {",
  "                                return;",
  "                            }",
  "                            const encNode = getBinaryNodeChild(node, 'enc');",
  "                            try {",
  "                                await sendRetryRequest(node, !encNode);",
  "                                if (retryRequestDelayMs) {",
  "                                    await delay(retryRequestDelayMs);",
  "                                }",
  "                            }",
  "                            catch (error) {",
  "                                const statusCode = error?.output?.statusCode;",
  "                                const connectionClosed =",
  "                                    error?.message === 'Connection Closed' && statusCode === 428;",
  "                                if (!connectionClosed) {",
  "                                    throw error;",
  "                                }",
  "                                logger.debug({ statusCode }, 'connection closed during retry req, ignoring');",
  "                            }",
  "                        });"
].join("\n");

function contarOcorrencias(texto, trecho) {
  if (!trecho) return 0;
  return texto.split(trecho).length - 1;
}

function aplicarPatch({ rootDir = process.cwd(), log = console.log } = {}) {
  const packagePath = path.join(
    rootDir,
    "node_modules",
    "@whiskeysockets",
    "baileys",
    "package.json"
  );
  const targetPath = path.join(rootDir, TARGET_RELATIVE);

  if (!fs.existsSync(packagePath) || !fs.existsSync(targetPath)) {
    throw new Error("Baileys instalado não encontrado para aplicar o hotfix de retry");
  }

  const versaoInstalada = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  if (versaoInstalada !== BAILEYS_VERSION) {
    throw new Error(
      `Versão Baileys inesperada: ${versaoInstalada}; esperado ${BAILEYS_VERSION}`
    );
  }

  const source = fs.readFileSync(targetPath, "utf8");
  const originais = contarOcorrencias(source, ORIGINAL_BLOCK);
  const aplicados = contarOcorrencias(source, PATCHED_BLOCK);

  if (originais === 0 && aplicados === 1) {
    log(`[BAILEYS-RETRY-HOTFIX] already_applied version=${versaoInstalada}`);
    return { status: "already_applied", targetPath, versaoInstalada };
  }

  if (originais !== 1 || aplicados !== 0) {
    throw new Error(
      `Assinatura Baileys inesperada: original=${originais}, patched=${aplicados}`
    );
  }

  const patched = source.replace(ORIGINAL_BLOCK, PATCHED_BLOCK);
  if (
    contarOcorrencias(patched, ORIGINAL_BLOCK) !== 0 ||
    contarOcorrencias(patched, PATCHED_BLOCK) !== 1
  ) {
    throw new Error("Validação pós-patch do Baileys falhou");
  }

  fs.writeFileSync(targetPath, patched, "utf8");
  log(`[BAILEYS-RETRY-HOTFIX] applied version=${versaoInstalada}`);
  return { status: "applied", targetPath, versaoInstalada };
}

if (require.main === module) {
  try {
    aplicarPatch();
  } catch (error) {
    console.error(`[BAILEYS-RETRY-HOTFIX] failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BAILEYS_VERSION,
  TARGET_RELATIVE,
  ORIGINAL_BLOCK,
  PATCHED_BLOCK,
  aplicarPatch
};
