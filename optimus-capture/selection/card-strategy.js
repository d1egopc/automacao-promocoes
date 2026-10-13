(function publishSelectionCardStrategy(global) {
  "use strict";

  const detector = global.OptimusCaptureDetector || require("../core/marketplace-detector");
  const ROOT_SELECTORS = Object.freeze({
    mercadolivre: "li.ui-search-layout__item,.poly-card,article,li",
    amazon: "[data-component-type='s-search-result'],[data-testid='product-card'],[data-testid='deal-card'],[data-testid='dealCard'],[class*='GridItem-module__container'],[class*='DealCard-module__card'],.a-cardui",
    shopee: ".shopee-search-item-result__item,[data-sqe='item'],article,li",
    aliexpress: ".search-item-card-wrapper-gallery,[class*='search-card'],article,li",
    kabum: ".productCard,[class*='productCard'],article,li",
    magalu: "[data-testid='product-card'],[data-testid*='product'],article,li"
  });

  function identityFor(detection = {}) {
    return String(detection.asin || detection.itemId || detection.produtoId || detection.url || "").trim();
  }

  function anchorsIn(root) {
    const anchors = [];
    if (root?.matches?.("a[href]")) anchors.push(root);
    if (typeof root?.querySelectorAll === "function") anchors.push(...root.querySelectorAll("a[href]"));
    return anchors;
  }

  function nodeTag(node) {
    return String(node?.tagName || node?.nodeName || node?.tag || "").toLowerCase();
  }

  function validProductLinks(root, marketplace) {
    const byIdentity = new Map();
    for (const anchor of anchorsIn(root)) {
      const rawUrl = anchor?.href || anchor?.getAttribute?.("href") || "";
      const detection = detector.detectarMarketplacePorUrl(rawUrl);
      if (!detection.suportado || detection.marketplace !== marketplace) continue;
      const identity = identityFor(detection);
      if (identity && !byIdentity.has(identity)) byIdentity.set(identity, { anchor, detection });
    }
    return [...byIdentity.values()];
  }

  function hasProductImage(root) {
    // Require an actual media node. Placeholder classes/data-testids alone do
    // not make an empty carousel region a commercial product card.
    return Boolean(root?.querySelector?.("img[src],img[data-src],img[data-lazy-src],picture"));
  }

  function hasProductTitle(root) {
    return Boolean(root?.querySelector?.("h1,h2,h3,[data-testid*='title' i],[class*='title' i],[aria-label*='produto' i]"));
  }

  function hasProductPrice(root) {
    if (root?.querySelector?.("[data-testid*='price' i],[class*='price' i],[aria-label*='preço' i],[aria-label*='preco' i]")) return true;
    return /R\$\s*\d/.test(String(root?.textContent || ""));
  }

  function candidateAncestors(anchor, limit = 14) {
    const ancestors = [];
    for (let node = anchor, depth = 0; node && depth < limit; node = node.parentElement, depth++) {
      ancestors.push({ node, depth });
    }
    return ancestors;
  }

  function isNonCardContainer(node) {
    return !node || ["body", "html", "main", "ul", "ol", "section"].includes(nodeTag(node));
  }

  function productCardEvidence(node, marketplace) {
    if (isNonCardContainer(node)) return null;
    const links = validProductLinks(node, marketplace);
    if (links.length !== 1) return null;
    const image = hasProductImage(node);
    const title = hasProductTitle(node);
    const price = hasProductPrice(node);
    if (!image || !title || !price) return null;
    return { node, link: links[0], image, title, price };
  }

  function cardMarkerScore(node, marketplace) {
    const text = `${node?.getAttribute?.("class") || ""} ${node?.getAttribute?.("data-testid") || ""}`;
    if (marketplace === "kabum") {
      if (node.matches?.("[data-testid='product-card'],[data-testid*='product-card' i]")) return 160;
      if (node.matches?.("[data-product-id],[data-sku]")) return 150;
      if (/(?:productCard|product-card)/i.test(text)) return 140;
    }
    if (marketplace === "magalu") {
      if (node.matches?.("[data-testid='product-card'],[data-testid*='product' i]")) return 160;
      if (node.matches?.("[data-product-id],[data-sku]")) return 150;
      if (/(?:product[-_ ]?card|product[-_ ]?item)/i.test(text)) return 140;
    }
    if (nodeTag(node) === "article") return 100;
    return 0;
  }

  function canonicalCommercialCardFor(anchor, marketplace) {
    // Test/host shims may expose only closest/parentElement. Real browser
    // Elements always provide querySelectorAll and go through the evidence
    // gate below; this compatibility path does not weaken the production DOM
    // filter or admit an uninspectable browser container.
    if (anchor?.parentElement && typeof anchor.parentElement.querySelectorAll !== "function") {
      return { node: anchor.parentElement, score: 0, depth: 0 };
    }
    let best = null;
    for (const candidate of candidateAncestors(anchor)) {
      const evidence = productCardEvidence(candidate.node, marketplace);
      if (!evidence) continue;
      const score = cardMarkerScore(candidate.node, marketplace) + Math.max(0, 14 - candidate.depth) * 0.01;
      // The nearest evidence-complete tile wins. A wrapper with multiple
      // products is rejected by productCardEvidence before it can be chosen.
      if (!best || score > best.score || (score === best.score && candidate.depth < best.depth)) {
        best = { ...evidence, score, depth: candidate.depth };
      }
    }
    return best;
  }

  function kabumCanonicalCardFor(anchor) {
    return canonicalCommercialCardFor(anchor, "kabum")?.node || null;
  }

  function magaluCanonicalCardFor(anchor) {
    return canonicalCommercialCardFor(anchor, "magalu")?.node || null;
  }

  function cardRootFor(anchor, marketplace) {
    const selector = ROOT_SELECTORS[marketplace] || "article,li";
    if (marketplace === "amazon") {
      // Prefer the complete product/deal card over nested variant/swatch lists.
      return anchor.closest?.(selector) || anchor.closest?.("[data-asin],article,li") || null;
    }
    if (marketplace === "kabum") return kabumCanonicalCardFor(anchor);
    if (marketplace === "magalu") return magaluCanonicalCardFor(anchor);
    return anchor.closest?.(selector) || anchor.parentElement || null;
  }

  const AMAZON_AUXILIARY = "button,[role='button'],[role='radio'],[role='tab'],[role='option'],[class*='swatch' i],[class*='twister' i],[class*='variant' i],[class*='variation' i],[class*='thumbnail' i],[data-testid*='swatch' i],[data-testid*='variant' i],[data-testid*='thumbnail' i],[data-testid*='carousel' i],[data-action*='swatch' i],[data-action*='variant' i]";

  function amazonAuxiliaryAnchor(anchor, card) {
    for (let node = anchor; node; node = node.parentElement) {
      if (node.matches?.(AMAZON_AUXILIARY)) return true;
      if (node === card) break;
    }
    return false;
  }

  function amazonPrimaryProduct(card, fallbackAnchor) {
    const anchors = anchorsIn(card);
    if (!anchors.length) anchors.push(fallbackAnchor);
    const cardAsin = String(card.getAttribute?.("data-asin") || "").trim().toUpperCase();
    let first = null;
    let primary = null;
    for (const anchor of anchors) {
      if (amazonAuxiliaryAnchor(anchor, card)) continue;
      const detection = detector.detectarMarketplacePorUrl(anchor.href || anchor.getAttribute?.("href") || "");
      if (!detection.suportado || detection.marketplace !== "amazon") continue;
      const candidate = { anchor, detection };
      if (cardAsin && detection.asin === cardAsin) return candidate;
      if (!primary && (anchor.querySelector?.("h2,h3,img") || anchor.closest?.("h2,h3") ||
        anchor.matches?.("[data-testid='product-card-link'],[data-testid='deal-card-link']"))) primary = candidate;
      if (!first) first = candidate;
    }
    return primary || first;
  }

  function discover(root, pageUrl = "") {
    const page = detector.detectarMarketplacePorUrl(pageUrl);
    const pageMarketplace = page.marketplace || "";
    const found = [];
    const seen = new Set();
    const seenAmazonCards = new Set();
    for (let anchor of anchorsIn(root)) {
      const rawUrl = anchor?.href || anchor?.getAttribute?.("href") || "";
      let detection = detector.detectarMarketplacePorUrl(rawUrl);
      if (!detection.suportado || !detection.marketplace || detection.marketplace !== pageMarketplace) continue;
      const card = cardRootFor(anchor, detection.marketplace);
      if (!card) continue;
      if (detection.marketplace === "amazon") {
        if (amazonAuxiliaryAnchor(anchor, card) || seenAmazonCards.has(card)) continue;
        const primary = amazonPrimaryProduct(card, anchor);
        if (!primary) continue;
        anchor = primary.anchor;
        detection = primary.detection;
        seenAmazonCards.add(card);
      }
      const url = String(detection.url || rawUrl).trim();
      const identity = identityFor(detection);
      const key = `${detection.marketplace}:${identity || url}`;
      if (!url || !identity || seen.has(key)) continue;
      seen.add(key);
      found.push(Object.freeze({ key, url, identity, marketplace: detection.marketplace, anchor, card }));
    }
    return found;
  }

  const api = Object.freeze({ ROOT_SELECTORS, discover, identityFor });
  global.OptimusSelectionCardStrategy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
