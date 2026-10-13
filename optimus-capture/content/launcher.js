(function initializeOptimusLauncher(global) {
  "use strict";
  const SINGLETON = "__optimusCaptureLauncherV1";
  if (global[SINGLETON]) {
    global[SINGLETON].refresh();
    return;
  }
  if (global.top !== global || !global.chrome?.runtime?.sendMessage) return;
  const doc = global.document;
  const policy = global.OptimusLauncherPolicy;
  if (!doc?.documentElement || !policy) return;

  function openCurrentProductMode() {
    return global.chrome.runtime.sendMessage({ type: "OPTIMUS_OPEN_CURRENT_PRODUCT" });
  }
  function openSelectionMode() {
    return global.OptimusSelectionMode?.start?.() || { ok: false, motivo: "selection_mode_unavailable" };
  }
  const modeActions = Object.freeze({ openCurrentProductMode, openSelectionMode });
  let host = null;
  let button = null;
  let menu = null;
  let status = null;
  let timer = null;
  let opening = false;
  let selectionModeActive = false;
  let lastUrl = "";
  const HOST_ID = "optimus-capture-launcher-v1";

  function shouldRenderLauncher() {
    return policy.contextForUrl(global.location.href).homologated;
  }

  function closeMenu() {
    if (!menu || !button) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function handleCurrentProductClick(event) {
    const context = policy.contextForUrl(global.location.href);
    if (!event.isTrusted || opening || !context.homologated) return;
    closeMenu();
    opening = true;
    button.disabled = true;
    // No async preparation precedes the sendMessage/user gesture.
    let request;
    try { request = modeActions.openCurrentProductMode(); }
    catch { request = Promise.reject(new Error("extension_context_invalid")); }
    Promise.resolve(request).then((result) => {
      if (!result?.ok) throw new Error(result?.motivo || "panel_open_failed");
      status.textContent = "Painel Optimus aberto.";
      button.title = "Abrir o produto atual no Optimus Capture";
    }).catch(() => {
      status.textContent = "Não foi possível abrir o painel. Recarregue a página ou use o ícone da extensão.";
      button.title = status.textContent;
    }).finally(() => { opening = false; button.disabled = false; });
  }

  function handleSelectionClick(event) {
    if (!event.isTrusted || !policy.contextForUrl(global.location.href).homologated) return;
    closeMenu();
    const result = modeActions.openSelectionMode();
    if (!result?.ok) {
      status.textContent = "Não foi possível iniciar o Modo Seleção.";
      return;
    }
    status.textContent = "Modo Seleção ativo.";
  }

  function handleLauncherClick(event) {
    if (!event.isTrusted || opening) return;
    const expanded = button.getAttribute("aria-expanded") === "true";
    menu.hidden = expanded;
    button.setAttribute("aria-expanded", expanded ? "false" : "true");
  }

  function mount() {
    if (host?.isConnected) return;
    // The singleton owns this node. A page-supplied duplicate is not adopted.
    doc.getElementById(HOST_ID)?.remove();
    host = doc.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "all:initial!important;position:fixed!important;right:16px!important;width:176px!important;height:44px!important;z-index:2147483646!important;display:none!important;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = `
      :host { color-scheme: light; }
      button { all:initial; box-sizing:border-box; display:flex; align-items:center;
        justify-content:center; gap:9px; width:100%; height:44px; padding:8px 12px;
        border:1px solid #ded9ed; border-radius:24px; background:#fff; color:#33215c;
        box-shadow:0 3px 14px #24183b26; font:600 14px/20px system-ui,sans-serif;
        cursor:pointer; }
      button:hover { background:#f6f3fc; }
      button:focus-visible { outline:3px solid #8c61d8; outline-offset:3px; }
      button:disabled { cursor:wait; opacity:.7; }
      img { width:24px; height:24px; object-fit:contain; flex:none; }
      .menu { position:absolute; right:0; bottom:52px; width:100%; box-sizing:border-box;
        display:grid; gap:6px; padding:7px; border:1px solid #ded9ed; border-radius:14px;
        background:#fff; box-shadow:0 7px 24px #24183b2e; }
      .menu[hidden] { display:none; }
      .menu button { height:38px; border-radius:10px; justify-content:flex-start; box-shadow:none;
        padding:7px 10px; font-size:13px; }
      .optimus-launcher-status { position:absolute; width:1px; height:1px;
        overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    `;
    button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Enviar oferta — abrir Optimus Capture");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.title = "Abrir o produto atual no Optimus Capture";
    const logo = doc.createElement("img");
    logo.src = global.chrome.runtime.getURL("assets/icon-32.png");
    logo.alt = "";
    logo.width = 24;
    logo.height = 24;
    const label = doc.createElement("span");
    label.textContent = "Enviar oferta";
    status = doc.createElement("span");
    status.className = "optimus-launcher-status";
    status.setAttribute("role", "status");
    button.append(logo, label);
    button.addEventListener("click", handleLauncherClick);
    menu = doc.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    const current = doc.createElement("button");
    current.type = "button";
    current.setAttribute("role", "menuitem");
    current.textContent = "📦 Produto atual";
    current.addEventListener("click", handleCurrentProductClick);
    const selection = doc.createElement("button");
    selection.type = "button";
    selection.setAttribute("role", "menuitem");
    selection.textContent = "☑ Modo Seleção";
    selection.addEventListener("click", handleSelectionClick);
    menu.append(current, selection);
    shadow.append(style, menu, button, status);
    doc.documentElement.append(host);
  }

  // Bounded hit tests, never a querySelectorAll/global DOM scan. Check the
  // footprint, not just its center, and lift above fixed/sticky controls.
  function blockerAt(rect) {
    let top = rect.bottom;
    for (const x of [rect.left + 2, (rect.left + rect.right) / 2, rect.right - 2]) {
      for (const y of [rect.top + 2, (rect.top + rect.bottom) / 2, rect.bottom - 2]) {
        for (const element of (doc.elementsFromPoint?.(x, y) || []).slice(0, 8)) {
          if (element === host) continue;
          let node = element;
          for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
            if (node === host || node === doc.body || node === doc.documentElement) break;
            const position = global.getComputedStyle(node).position;
            if (position === "fixed" || position === "sticky" ||
                node.matches?.("button,a,input,select,textarea,[role=button],[role=dialog]")) {
              const bounds = node.getBoundingClientRect();
              if (bounds.width && bounds.height && bounds.left < rect.right &&
                  bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top) {
                top = Math.min(top, bounds.top - 10);
              }
              break;
            }
          }
        }
      }
    }
    return top;
  }

  function refresh() {
    lastUrl = global.location.href;
    const context = policy.contextForUrl(global.location.href);
    if (!context.homologated) {
      host?.remove();
      return;
    }
    mount();
    host.style.setProperty("display", "none", "important");
    if (selectionModeActive) return;
    const viewportWidth = doc.documentElement.clientWidth || global.innerWidth;
    const width = Math.min(176, viewportWidth - 32);
    host.style.setProperty("width", `${width}px`, "important");
    // Shopee's fixed chat widget intercepts the bottom-right launcher. Keep a
    // marketplace-specific safe offset; all other domains retain 16px.
    const baselineBottom = context.marketplace === "shopee" ? 120 : 16;
    let bottom = global.innerHeight - baselineBottom;
    let clear = false;
    for (let attempt = 0; attempt < 8 && bottom >= 60 && width >= 120; attempt++) {
      const rect = { left: viewportWidth - 16 - width, right: viewportWidth - 16,
        top: bottom - 44, bottom };
      const next = blockerAt(rect);
      if (next === bottom) { clear = true; break; }
      bottom = next;
    }
    if (clear) {
      host.style.setProperty("bottom", `${global.innerHeight - bottom}px`, "important");
      host.style.setProperty("display", "block", "important");
    }
    // If no safe footprint exists, hide rather than cover a critical control.
  }

  function scheduleRefresh() {
    if (timer !== null) global.clearTimeout(timer);
    timer = global.setTimeout(() => { timer = null; refresh(); }, 120);
  }
  function setSelectionModeActive(value) {
    selectionModeActive = value === true;
    closeMenu();
    if (selectionModeActive) {
      host?.style?.setProperty("display", "none", "important");
      return;
    }
    refresh();
  }
  const onNavigation = () => { if (lastUrl !== global.location.href) scheduleRefresh(); };
  global.addEventListener("popstate", onNavigation);
  global.addEventListener("hashchange", onNavigation);
  global.navigation?.addEventListener("currententrychange", onNavigation);
  global.addEventListener("resize", scheduleRefresh, { passive: true });
  global.addEventListener("scroll", scheduleRefresh, { passive: true, capture: true });
  // DOM additions can introduce a chat/consent overlay or replace the SPA
  // root. One debounced observer, no attributes/characterData or idle timer.
  const observer = new global.MutationObserver((records) => {
    if (records.some((record) => record.target !== host && !host?.contains(record.target))) {
      scheduleRefresh();
    }
  });
  global[SINGLETON] = Object.freeze({ refresh, modeActions, setSelectionModeActive });
  refresh();
  observer.observe(doc.documentElement, { childList: true, subtree: true });
})(typeof globalThis !== "undefined" ? globalThis : window);
