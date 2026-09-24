"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const express = require("express");
const { classificarLinkEngine } = require("../modules/engine/link-role.service");
const { criarRegistroDinamico, inferirFamilia } = require("../modules/radar/redirect/dynamic-resolver-registry");
const { obterHttpSeguro, validarUrlPublica } = require("../modules/radar/redirect/safe-redirect-http");
const { dominioRedirectPermitido, resolverRedirectUniversal } = require("../modules/radar/redirect/redirect-resolver");
const { criarRotasResolversDinamicos, diagnosticoSeguro, tipoResultado } = require("../modules/radar/redirect/dynamic-resolver-admin.routes");

function transporte(respostas, chamadas, enderecosFixados = null) {
  return (_url, _options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      chamadas.push(_url.href);
      if (enderecosFixados) _options.lookup(_url.hostname, {}, (_erro, endereco) => enderecosFixados.push(endereco));
      const resposta = respostas.shift() || { status: 200, body: "" };
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = resposta.status;
        res.headers = { location: resposta.location };
        res.complete = true;
        res.destroyed = false;
        res.destroy = () => { res.destroyed = true; };
        callback(res);
        if (resposta.body) res.emit("data", Buffer.from(resposta.body));
        res.emit("end");
      });
    };
    req.destroy = error => { if (error) req.emit("error", error); };
    return req;
  };
}

function transporteAtrasado(atrasoMs, chamadas) {
  return (url, _options, callback) => {
    const req = new EventEmitter();
    let timer;
    let destruida = false;
    req.end = () => {
      chamadas.push(url.href);
      timer = setTimeout(() => {
        if (destruida) return;
        const res = new EventEmitter();
        res.statusCode = 302;
        res.headers = { location: `https://publico.example/r/hop-${chamadas.length}` };
        res.complete = true;
        callback(res);
        res.emit("end");
      }, atrasoMs);
    };
    req.destroy = () => { destruida = true; clearTimeout(timer); };
    return req;
  };
}

const lookupPublico = async () => [{ address: "8.8.8.8", family: 4 }];

(async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "optimus-link-resolvers-"));
  try {
    const file = path.join(pasta, "resolvers.json");
    const registro = criarRegistroDinamico({ file });
    const familia = inferirFamilia("https://www.seuhardware.com/r/abc123");
    assert.equal(familia.host, "www.seuhardware.com");
    assert.equal(familia.pathPrefix, "/r/");
    assert.throws(() => inferirFamilia("https://www.seuhardware.com/r/abc?token=segredo"), /URL_EXEMPLO_INVALIDA/);
    assert.throws(() => inferirFamilia("https://www.seuhardware.com/abc123"), /FAMILIA_NAO_INFERIVEL/);
    const salvo = registro.adicionar(familia, { marketplace: "shopee", tipo: "produto" });
    assert.throws(() => registro.adicionar(familia), /RESOLVER_DUPLICADO/);
    assert.equal(registro.localizar("https://www.seuhardware.com/r/xyz")?.id, salvo.id);
    assert.equal(registro.localizar("https://www.seuhardware.com/outro/xyz"), null);
    assert.equal(registro.localizar("https://evil.seuhardware.com/r/xyz"), null);
    assert.equal(dominioRedirectPermitido("https://www.seuhardware.com/r/xyz", { dynamicRegistry: registro }), true);
    registro.atualizar(salvo.id, { ativo: false });
    assert.equal(dominioRedirectPermitido("https://www.seuhardware.com/r/xyz", { dynamicRegistry: registro }), false);
    registro.atualizar(salvo.id, { ativo: true });
    assert.equal(dominioRedirectPermitido("https://www.seuhardware.com/r/xyz", { dynamicRegistry: registro }), true);
    assert.equal(criarRegistroDinamico({ file }).buscar(salvo.id).host, familia.host);

    const chamadas = [];
    const fonte = "https://www.seuhardware.com/r/xyz";
    const resultado = await resolverRedirectUniversal(fonte, {
      dynamicRegistry: registro, safeHttpDeps: {
        lookup: lookupPublico,
        requestImpl: transporte([{ status: 302, location: "https://shopee.com.br/product/1/2" }, { status: 200 }], chamadas)
      }
    });
    assert.equal(resultado.ok, true);
    assert.equal(resultado.marketplaceDetectado, "shopee");
    assert.equal(chamadas.length, 2);
    assert.equal(resultado.urlFinal, "https://shopee.com.br/product/1/2");
    const fixados = [];
    await obterHttpSeguro("https://publico.example/r/seguro", {
      lookup: lookupPublico,
      requestImpl: transporte([{ status: 200 }], [], fixados)
    });
    assert.deepEqual(fixados, ["8.8.8.8"]);
    const resultadoMl = await resolverRedirectUniversal("https://www.seuhardware.com/r/ml", {
      dynamicRegistry: registro, safeHttpDeps: {
        lookup: lookupPublico,
        requestImpl: transporte([{ status: 302, location: "https://www.mercadolivre.com.br/produto/p/MLB123456789" }, { status: 200 }], [])
      }
    });
    assert.equal(resultadoMl.marketplaceDetectado, "mercadolivre");
    assert.equal(tipoResultado(resultadoMl), "produto");
    const resultadoCupom = await resolverRedirectUniversal("https://www.seuhardware.com/r/cupom", {
      dynamicRegistry: registro, safeHttpDeps: {
        lookup: lookupPublico,
        requestImpl: transporte([{ status: 302, location: "https://shopee.com.br/coupon/100off" }, { status: 200 }], [])
      }
    });
    assert.equal(resultadoCupom.marketplaceDetectado, "shopee");
    assert.equal(resultadoCupom.urlFinal, "https://shopee.com.br/coupon/100off");
    const fonteApp = "https://www.seuhardware.com/r/app";
    const fontePc = "https://www.seuhardware.com/r/pc";
    const textoAli = `Link APP: ${fonteApp}\nLink PC: ${fontePc}`;
    assert.equal(classificarLinkEngine({ marketplace: "aliexpress", evento: { texto_original: textoAli },
      link: { url_original: fonteApp, url_expandida: "https://a.aliexpress.com/_APP" },
      url: "https://a.aliexpress.com/_APP" }).papelLink, "link_app");
    assert.equal(classificarLinkEngine({ marketplace: "aliexpress", evento: { texto_original: textoAli },
      link: { url_original: fontePc, url_expandida: "https://www.aliexpress.com/item/1005001234567890.html" },
      url: "https://www.aliexpress.com/item/1005001234567890.html" }).papelLink, "link_pc");
    const resultadoSemMarketplace = await resolverRedirectUniversal("https://www.seuhardware.com/r/externo", {
      dynamicRegistry: registro, safeHttpDeps: {
        lookup: lookupPublico,
        requestImpl: transporte([{ status: 302, location: "https://example.com/externo" }, { status: 200 }], [])
      }
    });
    assert.equal(resultadoSemMarketplace.ok, false);
    const promozone = await resolverRedirectUniversal("https://go.promozone.ai/ABC123", {
      httpClient: { get: async url => url.includes("/resolve/")
        ? { status: 404, data: {} }
        : { status: 200, data: '<meta http-equiv="refresh" content="0;url=https://shopee.com.br/product/1/3">',
          request: { res: { responseUrl: url } } } }
    });
    assert.equal(promozone.ok, true);
    assert.equal(promozone.marketplaceDetectado, "shopee");
    assert.equal(promozone.metodo, "meta_refresh");
    const debug = diagnosticoSeguro("https://seuhardware.com/r/abc123?token=nao_mostrar", {
      ...resultado, urlOriginal: "https://usuario:senha@seuhardware.com/r/abc123?token=nao_mostrar",
      urlFinal: "https://shopee.com.br/product/123/456?affiliate_id=999",
      marketplaceDetectado: "shopee", metodo: "http_redirect",
      hops: [
        { url: "https://intermediario.com/go/XYZ987?token=SECRET", status: 302 },
        { url: "https://shopee.com.br/product/123/456?affiliate_id=999", status: 302 }
      ],
      headers: { Authorization: "Bearer senha" }, cookie: "secreta"
    });
    assert.equal(debug.entrada, "seuhardware.com/r/[redacted]");
    assert.equal(debug.hops[0], "intermediario.com/go/[redacted]");
    assert.equal(debug.destino, "shopee.com.br/product/[redacted]/[redacted]");
    assert.equal(debug.marketplace, "shopee");
    assert.equal(debug.tipo, "produto");
    assert.equal(JSON.stringify(debug).includes("nao_mostrar"), false);
    assert.equal(JSON.stringify(debug).includes("senha"), false);
    assert.equal(JSON.stringify(debug).includes("secreta"), false);
    assert.equal(JSON.stringify(debug).includes("SECRET"), false);
    assert.equal(JSON.stringify(debug).includes("affiliate_id"), false);

    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/body", {
      maxBytes: 2, lookup: lookupPublico,
      requestImpl: transporte([{ status: 200, body: "123" }], [])
    }), /REDIRECT_BODY_LIMIT/);

    assert.throws(() => validarUrlPublica("http://127.0.0.1/private"), /URL_BLOQUEADA_SEGURANCA/);
    assert.throws(() => validarUrlPublica("http://localhost/private"), /URL_BLOQUEADA_SEGURANCA/);
    assert.throws(() => validarUrlPublica("http://[::1]/private"), /URL_BLOQUEADA_SEGURANCA/);
    assert.throws(() => validarUrlPublica("http://10.2.3.4/private"), /URL_BLOQUEADA_SEGURANCA/);
    assert.throws(() => validarUrlPublica("file:///etc/passwd"), /URL_BLOQUEADA_SEGURANCA/);
    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/abc", {
      lookup: lookupPublico,
      requestImpl: transporte([{ status: 302, location: "http://169.254.169.254/latest/meta-data" }], [])
    }), /URL_BLOQUEADA_SEGURANCA/);
    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/abc", {
      lookup: lookupPublico,
      requestImpl: transporte([{ status: 302, location: "https://publico.example/r/abc" }], [])
    }), /REDIRECT_LOOP/);
    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/abc", {
      lookup: async () => [{ address: "10.1.2.3", family: 4 }],
      requestImpl: () => { throw new Error("network_must_not_be_reached"); }
    }), /URL_BLOQUEADA_SEGURANCA/);
    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/abc", {
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      requestImpl: () => { throw new Error("network_must_not_be_reached"); }
    }), /URL_BLOQUEADA_SEGURANCA/);
    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/abc", {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      requestImpl: transporte([{ status: 302, location: "http://169.254.169.254/latest/meta-data" }], [])
    }), /URL_BLOQUEADA_SEGURANCA/);

    const chamadasHops = [];
    const inicioHops = Date.now();
    await assert.rejects(() => obterHttpSeguro("https://publico.example/r/a", {
      timeout: 120, maxRedirects: 5, lookup: lookupPublico,
      requestImpl: transporteAtrasado(75, chamadasHops)
    }), /REDIRECT_TIMEOUT/);
    const duracaoHops = Date.now() - inicioHops;
    assert.equal(chamadasHops.length, 2, "o prazo global não deve reiniciar a cada redirect");
    assert.ok(duracaoHops < 500, `deadline de redirects deveria encerrar cedo; elapsed=${duracaoHops}ms`);

    let bytesTrickle = 0;
    let servidorTerminouNaturalmente = false;
    let clienteAbortou = false;
    let resolverBodyFechado;
    const bodyFechado = new Promise(resolve => { resolverBodyFechado = resolve; });
    let timerTrickle;
    const servidorTrickle = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const fimNatural = Date.now() + 1800;
      timerTrickle = setInterval(() => {
        if (Date.now() >= fimNatural) {
          servidorTerminouNaturalmente = true;
          clearInterval(timerTrickle);
          res.end();
          return;
        }
        bytesTrickle += 1;
        res.write("x");
      }, 20);
      res.on("close", () => {
        if (!res.writableEnded) clienteAbortou = true;
        clearInterval(timerTrickle);
        resolverBodyFechado();
      });
    });
    await new Promise(resolve => servidorTrickle.listen(0, "127.0.0.1", resolve));
    try {
      const inicioTrickle = Date.now();
      await assert.rejects(() => obterHttpSeguro("https://publico.example/r/trickle", {
        timeout: 260,
        lookup: lookupPublico,
        // O transporte do teste roteia para o servidor local; a URL segue pública
        // para exercitar o mesmo validador/prazo sem abrir rede externa.
        requestImpl: (_url, opcoes, callback) => http.request({
          hostname: "127.0.0.1", port: servidorTrickle.address().port, path: "/",
          method: opcoes.method, headers: opcoes.headers, timeout: opcoes.timeout, agent: false
        }, callback)
      }), /REDIRECT_TIMEOUT/);
      const elapsedTrickle = Date.now() - inicioTrickle;
      await Promise.race([bodyFechado, new Promise(resolve => setTimeout(resolve, 300))]);
      assert.ok(bytesTrickle >= 3, "o fixture deve enviar vários chunks dentro do timeout de inatividade");
      assert.equal(servidorTerminouNaturalmente, false);
      assert.equal(clienteAbortou, true, "o deadline precisa abortar o socket e fechar o body");
      assert.ok(elapsedTrickle < 1200, `trickle deveria ser abortado antes do fim natural; elapsed=${elapsedTrickle}ms`);
      console.log(`[SAFE-REDIRECT-TRICKLE] elapsedMs=${elapsedTrickle} bytes=${bytesTrickle} natural=false`);
    } finally {
      clearInterval(timerTrickle);
      servidorTrickle.closeAllConnections?.();
      await new Promise(resolve => servidorTrickle.close(resolve));
    }

    const entradas = [];
    const app = express();
    app.use(express.json());
    app.use("/admin/links/resolvers", (req, res, next) => {
      if (req.headers["x-test-admin"] !== "yes") return res.status(403).json({ ok: false });
      next();
    }, criarRotasResolversDinamicos({
      registry: registro,
      resolve: async entrada => {
        entradas.push(entrada);
        const destino = entrada.includes("/bad/") ? "https://example.com/not-marketplace" :
          entrada.includes("/ml/") ? "https://www.mercadolivre.com.br/MLB-123456789-produto-_JM" :
          entrada.includes("/coupon/") ? "https://shopee.com.br/coupon/123" :
          "https://shopee.com.br/product/1/2";
        return { ok: true, urlFinal: destino, urlExpandida: destino,
          marketplaceDetectado: destino.includes("mercadolivre") ? "mercadolivre" : destino.includes("shopee") ? "shopee" : "",
          metodo: "http_redirect", hops: [{ url: `${entrada}?secret=redacted`, status: 302 }] };
      }
    }));
    const indexFonte = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert.match(indexFonte, /app\.use\("\/admin\/links\/resolvers",\s*exigirAdminMasterEstrito,\s*criarRotasResolversDinamicos\(\)\)/);
    assert.match(indexFonte, /const redirect = await resolverRedirectUniversal\(capturada/);
    assert.match(indexFonte, /resolverRedirectUniversal:\s*resolverRedirectClonador/);
    const bridgeFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "clonador-grupos", "bridge.js"), "utf8");
    assert.match(bridgeFonte, /const \{ resolverRedirectClonador \} = require\("\.\.\/radar\/redirect\/redirect-resolver"\)/);
    const ingressoFonte = fs.readFileSync(path.join(__dirname, "..", "modules", "teleradar", "radar-ingress.adapter.js"), "utf8");
    assert.match(ingressoFonte, /processarMensagemRadar/);
    const server = await new Promise(resolve => {
      const opened = app.listen(0, "127.0.0.1", () => resolve(opened));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}/admin/links/resolvers`;
      const headers = { "content-type": "application/json", "x-test-admin": "yes" };
      assert.equal((await fetch(base)).status, 403);
      const create = await fetch(base, { method: "POST", headers,
        body: JSON.stringify({ urlExemplo: "https://www.seuhardware.com/coupon/abc" }) });
      assert.equal(create.status, 201);
      const created = (await create.json()).resolver;
      assert.equal(created.ultimoTipoDetectado, "cupom");
      assert.equal(created.urlExemplo, undefined);
      assert.equal((await fetch(base, { method: "POST", headers,
        body: JSON.stringify({ urlExemplo: "https://www.seuhardware.com/coupon/xyz" }) })).status, 409);
      assert.equal((await fetch(base, { method: "POST", headers,
        body: JSON.stringify({ urlExemplo: "https://www.seuhardware.com/bad/abc" }) })).status, 422);
      assert.equal((await fetch(base, { method: "POST", headers,
        body: JSON.stringify({ urlExemplo: "http://127.0.0.1/r/private" }) })).status, 400);
      const tested = await fetch(`${base}/${created.id}/test`, { method: "POST", headers, body: "{}" });
      assert.equal(tested.status, 200);
      assert.equal((await tested.json()).ok, true);
      assert.equal(entradas.at(-1), "https://www.seuhardware.com/coupon/abc");
      const debugResponse = await fetch(`${base}/${created.id}/debug`, { headers });
      const debugJson = await debugResponse.json();
      assert.equal(JSON.stringify(debugJson).includes("secret"), false);
      const disabled = await fetch(`${base}/${created.id}`, { method: "PATCH", headers, body: '{"ativo":false}' });
      assert.equal((await disabled.json()).resolver.ativo, false);
      assert.equal(registro.localizar("https://www.seuhardware.com/coupon/abc"), null);
      assert.equal((await fetch(`${base}/${created.id}`, { method: "DELETE", headers })).status, 200);
      assert.equal(registro.buscar(created.id), null);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    registro.excluir(salvo.id);
    assert.equal(registro.localizar(fonte), null);
    fs.writeFileSync(file, "{broken");
    assert.throws(() => criarRegistroDinamico({ file }), /LINK_RESOLVERS_STORAGE_INVALIDO/);
    console.log("dynamic-link-resolvers PASS");
  } finally {
    const resolved = path.resolve(pasta);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("TEMP_PATH_INVALID");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
