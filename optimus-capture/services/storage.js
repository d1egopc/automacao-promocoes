(function publicarStorage(global) {
  const CHAVE = "optimus_capture_auth";

  function chromeStorage() {
    return global.chrome?.storage?.local || null;
  }

  async function lerAuth() {
    const storage = chromeStorage();
    if (!storage) return null;
    const dados = await storage.get(CHAVE);
    return dados?.[CHAVE] || null;
  }

  async function salvarAuth(auth) {
    const storage = chromeStorage();
    if (!storage) return false;
    await storage.set({ [CHAVE]: auth || null });
    return true;
  }

  async function limparAuth() {
    const storage = chromeStorage();
    if (!storage) return false;
    await storage.remove(CHAVE);
    return true;
  }

  const api = { lerAuth, salvarAuth, limparAuth };
  global.OptimusCaptureStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
