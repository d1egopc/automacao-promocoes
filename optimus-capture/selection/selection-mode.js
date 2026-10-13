(function publishSelectionMode(global) {
  "use strict";

  const SINGLETON = "__optimusCaptureSelectionModeV1";
  if (global[SINGLETON]) return;
  const MAX_SELECTION = 30;
  const strategy = global.OptimusSelectionCardStrategy;
  const doc = global.document;
  if (!strategy || !doc?.documentElement) return;

  let active = false;
  let observer = null;
  let overlayHost = null;
  let overlayRoot = null;
  let barHost = null;
  let countNode = null;
  let progressNode = null;
  let currentRequestId = "";
  const cards = new Map();
  const selected = new Set();
  const history = [];
  let registeredCards = new WeakSet();
  let cardKeys = new WeakMap();
  let layoutFrame = 0;

  function restoreCardOutline(surface) {
    if (!surface.outlineBefore) return;
    const style = surface.card.style;
    for (const [name, previous] of Object.entries(surface.outlineBefore)) {
      if (previous.value) {
        if (style.setProperty) style.setProperty(name, previous.value, previous.priority);
        else style[name] = previous.value;
      } else if (style.removeProperty) style.removeProperty(name);
      else style[name] = "";
    }
    surface.outlineBefore = null;
  }

  function updateCardOutline(surface, checked) {
    if (!checked) { restoreCardOutline(surface); return; }
    const style = surface.card?.style;
    if (!style || surface.outlineBefore) return;
    surface.outlineBefore = Object.fromEntries(["outline", "outline-offset"].map((name) => [name, {
      value: style.getPropertyValue?.(name) || style[name] || "",
      priority: style.getPropertyPriority?.(name) || ""
    }]));
    if (style.setProperty) {
      style.setProperty("outline", "2px solid #6f42c1", "important");
      style.setProperty("outline-offset", "2px", "important");
    } else { style.outline = "2px solid #6f42c1"; style["outline-offset"] = "2px"; }
  }

  function onCardInteraction(event) {
    if (!active) return;
    const path = event.composedPath?.() || [];
    let key = path.map((node) => cardKeys.get(node)).find(Boolean);
    if (!key) {
      for (let node = event.target; node; node = node.parentElement) {
        key = cardKeys.get(node);
        if (key) break;
      }
    }
    if (!key) return;
    // Keep touch scrolling available while suppressing the card's own gestures.
    if (event.type !== "pointerdown" || event.pointerType !== "touch") event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (event.type === "click") toggle(key);
  }

  const CARD_INTERACTION_EVENTS = ["pointerdown", "mousedown", "mouseup", "click", "auxclick"];

  function snapshot() { return new Set(selected); }
  function pushHistory() { history.push(snapshot()); if (history.length > 50) history.shift(); }
  function updateControl(entry) {
    const checked = selected.has(entry.item.key);
    for (const surface of entry.surfaces) {
      updateCardOutline(surface, checked);
      surface.control.setAttribute("aria-checked", checked ? "true" : "false");
      surface.control.textContent = checked ? "✓" : "";
      if (surface.control.style.setProperty) {
        surface.control.style.setProperty("background", checked ? "#6f42c1" : "#fff", "important");
        surface.control.style.setProperty("color", checked ? "#fff" : "#33215c", "important");
      } else {
        surface.control.style.background = checked ? "#6f42c1" : "#fff";
        surface.control.style.color = checked ? "#fff" : "#33215c";
      }
    }
  }
  function updateBar(message = "") {
    if (countNode) countNode.textContent = `☑ ${selected.size} selecionado${selected.size === 1 ? "" : "s"}`;
    if (progressNode) {
      progressNode.hidden = !message;
      progressNode.textContent = message;
    }
    const add = barHost?.shadowRoot?.querySelector?.("[data-action='add']");
    const create = barHost?.shadowRoot?.querySelector?.("[data-action='create-list']");
    const listActionDisabled = selected.size === 0 || Boolean(currentRequestId);
    if (add) add.disabled = listActionDisabled;
    if (create) create.disabled = listActionDisabled;
    for (const entry of cards.values()) updateControl(entry);
  }
  function restoreSelection(value) {
    selected.clear();
    for (const key of value) if (cards.has(key) && selected.size < MAX_SELECTION) selected.add(key);
    updateBar();
  }
  function toggle(key) {
    if (!cards.has(key)) return;
    pushHistory();
    if (selected.has(key)) selected.delete(key);
    else if (selected.size < MAX_SELECTION) selected.add(key);
    else updateBar(`Limite de ${MAX_SELECTION} produtos.`);
    updateBar();
  }
  function selectAll() {
    pushHistory();
    for (const key of cards.keys()) {
      if (selected.size >= MAX_SELECTION) break;
      selected.add(key);
    }
    updateBar(cards.size > MAX_SELECTION ? `Máximo de ${MAX_SELECTION} selecionados.` : "");
  }
  function clearSelection() { pushHistory(); selected.clear(); updateBar(); }
  function undo() { const previous = history.pop(); if (previous) restoreSelection(previous); }

  function createControl(item) {
    const control = doc.createElement("button");
    control.type = "button";
    control.className = "optimus-selection-checkbox";
    control.dataset.optimusSelectionKey = item.key;
    control.setAttribute("role", "checkbox");
    control.setAttribute("aria-label", "Selecionar produto no Optimus");
    control.style.cssText = "all:initial!important;position:fixed!important;top:0!important;left:0!important;width:28px!important;height:28px!important;border:2px solid #6f42c1!important;border-radius:7px!important;background:#fff!important;color:#33215c!important;display:flex!important;align-items:center!important;justify-content:center!important;pointer-events:auto!important;touch-action:manipulation!important;user-select:none!important;z-index:1!important;font:700 18px/1 system-ui,sans-serif!important;cursor:pointer!important;box-shadow:0 2px 8px #24183b33!important;";
    const consume = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    control.addEventListener("pointerdown", consume);
    control.addEventListener("mousedown", consume);
    control.addEventListener("mouseup", consume);
    control.addEventListener("click", (event) => {
      consume(event);
      toggle(item.key);
    });
    return control;
  }

  function pruneDisconnectedControls() {
    for (const [key, entry] of cards) {
      entry.surfaces = entry.surfaces.filter((surface) => {
        if (surface.card?.isConnected !== false) return true;
        restoreCardOutline(surface);
        surface.control.remove();
        registeredCards.delete(surface.card);
        cardKeys.delete(surface.card);
        return false;
      });
      // A selected item remains available to Add to List if the page virtualizes
      // its card. Only its disconnected visual control is retired.
      if (!entry.surfaces.length && !selected.has(key)) cards.delete(key);
    }
  }

  function clipsOverflow(value) {
    return /^(?:hidden|clip|auto|scroll)$/i.test(String(value || "").trim());
  }

  function clippedVisibleArea(card) {
    const viewport = {
      left: 0,
      top: 0,
      right: global.innerWidth || doc.documentElement.clientWidth || 0,
      bottom: global.innerHeight || doc.documentElement.clientHeight || 0
    };
    let area = { ...viewport };
    for (let node = card?.parentElement; node && node !== doc.documentElement; node = node.parentElement) {
      const style = global.getComputedStyle?.(node);
      const overflowX = style?.overflowX || style?.overflow;
      const overflowY = style?.overflowY || style?.overflow;
      if (!clipsOverflow(overflowX) && !clipsOverflow(overflowY)) continue;
      const bounds = node.getBoundingClientRect?.();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
      if (clipsOverflow(overflowX)) {
        area.left = Math.max(area.left, bounds.left);
        area.right = Math.min(area.right, bounds.right);
      }
      if (clipsOverflow(overflowY)) {
        area.top = Math.max(area.top, bounds.top);
        area.bottom = Math.min(area.bottom, bounds.bottom);
      }
      if (area.right <= area.left || area.bottom <= area.top) return null;
    }
    return area;
  }

  function controlIsInsideVisibleArea(rect, area) {
    const left = rect.left + 8;
    const top = rect.top + 8;
    const size = 28;
    return left >= area.left && top >= area.top && left + size <= area.right && top + size <= area.bottom;
  }

  function layoutControls() {
    layoutFrame = 0;
    if (!active) return;
    pruneDisconnectedControls();
    const positions = [];
    for (const entry of cards.values()) {
      for (const surface of entry.surfaces) {
        const rect = surface.card?.getBoundingClientRect?.();
        const connected = surface.card?.isConnected !== false;
        const visibleArea = connected && rect && rect.width > 0 && rect.height > 0
          ? clippedVisibleArea(surface.card)
          : null;
        const visible = Boolean(visibleArea && controlIsInsideVisibleArea(rect, visibleArea));
        positions.push({ control: surface.control, visible,
          left: visible ? `${Math.round(rect.left + 8)}px` : "",
          top: visible ? `${Math.round(rect.top + 8)}px` : "" });
      }
    }
    // Read all card rectangles before writing styles to avoid layout thrashing.
    for (const { control, visible, left, top } of positions) {
      control.hidden = !visible;
      if (control.style.setProperty) {
        // hidden alone cannot override the checkbox's inline display!important.
        control.style.setProperty("display", visible ? "flex" : "none", "important");
        if (visible) {
          control.style.setProperty("left", left, "important");
          control.style.setProperty("top", top, "important");
        }
      } else {
        control.style.display = visible ? "flex" : "none";
        if (visible) { control.style.left = left; control.style.top = top; }
      }
    }
  }

  function scheduleLayout() {
    if (!active || layoutFrame) return;
    const request = global.requestAnimationFrame || ((callback) => { callback(); return 0; });
    layoutFrame = request(layoutControls) || 0;
  }

  function mountOverlay() {
    overlayHost = doc.createElement("div");
    overlayHost.id = "optimus-selection-overlay-v1";
    overlayHost.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:2147483646!important;";
    overlayRoot = overlayHost.attachShadow({ mode: "open" });
    doc.documentElement.append(overlayHost);
  }

  function register(item) {
    if (!active || !item.card || registeredCards.has(item.card)) return;
    registeredCards.add(item.card);
    cardKeys.set(item.card, item.key);
    const control = createControl(item);
    overlayRoot.append(control);
    const entry = cards.get(item.key) || { item, surfaces: [] };
    entry.surfaces.push({ card: item.card, control });
    cards.set(item.key, entry);
    updateControl(entry);
    scheduleLayout();
  }

  function discover(root) {
    for (const item of strategy.discover(root, global.location.href)) register(item);
    updateBar();
    scheduleLayout();
  }

  function mountBar() {
    barHost = doc.createElement("div");
    barHost.id = "optimus-selection-bar-v1";
    barHost.style.cssText = "all:initial!important;position:fixed!important;left:50%!important;bottom:18px!important;transform:translateX(-50%)!important;z-index:2147483647!important;";
    const shadow = barHost.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = `:host{color-scheme:light}.bar{display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:10px 12px;border:1px solid #ded9ed;border-radius:16px;background:#fff;box-shadow:0 8px 30px #24183b38;font:600 13px/18px system-ui,sans-serif;color:#33215c;white-space:nowrap}.actions{display:flex;gap:6px}button{border:1px solid #ded9ed;border-radius:9px;background:#f7f4fc;color:#33215c;padding:7px 9px;font:600 12px/16px system-ui,sans-serif;cursor:pointer}button.primary{background:#6f42c1;color:#fff}button:disabled{opacity:.55;cursor:wait}.progress{max-width:240px;overflow:hidden;text-overflow:ellipsis}@media(max-width:680px){.bar{align-items:stretch;flex-direction:column;white-space:normal}.actions{flex-wrap:wrap;justify-content:center}}`;
    const bar = doc.createElement("div"); bar.className = "bar";
    countNode = doc.createElement("strong");
    progressNode = doc.createElement("span"); progressNode.className = "progress"; progressNode.hidden = true;
    const actions = doc.createElement("div"); actions.className = "actions";
    const specs = [["all", "Marcar todos"], ["undo", "Desfazer"], ["clear", "Limpar"], ["create-list", "+ Nova lista"], ["add", "Adicionar à lista"], ["close", "✕"]];
    for (const [action, label] of specs) {
      const button = doc.createElement("button"); button.type = "button"; button.dataset.action = action;
      button.textContent = label; if (action === "add") button.className = "primary";
      button.addEventListener("click", (event) => {
        if (!event.isTrusted) return;
        if (action === "all") selectAll();
        else if (action === "undo") undo();
        else if (action === "clear") clearSelection();
        else if (action === "close") stop();
        else if (action === "add") void addToList();
        else if (action === "create-list") void addToList({ createList: true });
      });
      actions.append(button);
    }
    bar.append(countNode, progressNode, actions); shadow.append(style, bar); doc.documentElement.append(barHost);
  }

  function requestId() { return global.crypto?.randomUUID?.() || `selection-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  async function addToList({ createList = false } = {}) {
    if (!selected.size || currentRequestId) return;
    currentRequestId = requestId();
    const items = Array.from(selected).slice(0, MAX_SELECTION).map((key) => {
      const item = cards.get(key).item;
      return { key: item.key, url: item.url, marketplace: item.marketplace, identity: item.identity };
    });
    updateBar("Abrindo suas listas...");
    try {
      const message = { type: "OPTIMUS_OPEN_SELECTION", requestId: currentRequestId, items };
      if (createList) message.createList = true;
      const response = await global.chrome.runtime.sendMessage(message);
      if (!response?.ok) throw new Error(response?.motivo || "selection_panel_failed");
    } catch {
      currentRequestId = "";
      updateBar("Não foi possível abrir o seletor de listas.");
    }
  }

  function onRuntimeMessage(message) {
    if (message?.type !== "OPTIMUS_SELECTION_PROGRESS" || message.requestId !== currentRequestId) return false;
    if (message.done) {
      const summary = message.summary || {};
      currentRequestId = "";
      updateBar(message.cancelled
        ? "Adição cancelada."
        : `Adicionados ${summary.added || 0} | Já existentes ${summary.existing || 0} | Erro ${summary.errors || 0}`);
    } else updateBar(`Adicionando... ${message.completed || 0}/${message.total || selected.size}`);
    return false;
  }

  function start() {
    if (active) return { ok: true, alreadyActive: true };
    active = true; history.length = 0; selected.clear(); cards.clear(); currentRequestId = "";
    global.__optimusCaptureLauncherV1?.setSelectionModeActive?.(true);
    mountOverlay(); mountBar(); discover(doc);
    observer = new global.MutationObserver((records) => {
      if (!active) return;
      if (records.some((record) => record.removedNodes?.length)) pruneDisconnectedControls();
      for (const record of records) for (const node of record.addedNodes || []) discover(node);
      // Removals and class/style changes can move existing cards without adding
      // a discoverable subtree. Reuse this observer for the same coalesced layout.
      scheduleLayout();
    });
    observer.observe(doc.body || doc.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"]
    });
    global.addEventListener?.("scroll", scheduleLayout, true);
    global.addEventListener?.("resize", scheduleLayout);
    global.addEventListener?.("load", scheduleLayout, true);
    for (const type of CARD_INTERACTION_EVENTS) global.addEventListener?.(type, onCardInteraction, true);
    return { ok: true };
  }

  function stop() {
    active = false;
    observer?.disconnect?.(); observer = null;
    global.removeEventListener?.("scroll", scheduleLayout, true);
    global.removeEventListener?.("resize", scheduleLayout);
    global.removeEventListener?.("load", scheduleLayout, true);
    for (const type of CARD_INTERACTION_EVENTS) global.removeEventListener?.(type, onCardInteraction, true);
    if (layoutFrame && global.cancelAnimationFrame) global.cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
    for (const entry of cards.values()) {
      for (const surface of entry.surfaces) {
        restoreCardOutline(surface);
        surface.control.remove();
      }
    }
    cards.clear(); selected.clear(); history.length = 0; currentRequestId = "";
    overlayHost?.remove(); overlayHost = null; overlayRoot = null; registeredCards = new WeakSet(); cardKeys = new WeakMap();
    barHost?.remove(); barHost = null; countNode = null; progressNode = null; active = false;
    global.__optimusCaptureLauncherV1?.setSelectionModeActive?.(false);
    return { ok: true };
  }

  global.chrome?.runtime?.onMessage?.addListener?.(onRuntimeMessage);
  const api = Object.freeze({ start, stop, isActive: () => active, MAX_SELECTION });
  global[SINGLETON] = api;
  global.OptimusSelectionMode = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
