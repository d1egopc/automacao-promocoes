"use strict";

const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const net = require("net");
const { performance } = require("node:perf_hooks");

const bloqueados = new net.BlockList();
const ipv6Global = new net.BlockList();
ipv6Global.addSubnet("2000::", 3, "ipv6");
for (const [rede, prefixo] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
]) bloqueados.addSubnet(rede, prefixo, "ipv4");
for (const [rede, prefixo] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96],
  ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
]) bloqueados.addSubnet(rede, prefixo, "ipv6");

function validarUrlPublica(valor) {
  let url;
  try { url = new URL(String(valor || "")); } catch { throw new Error("URL_BLOQUEADA_SEGURANCA"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port)) || !url.hostname || url.href.length > 4096) {
    throw new Error("URL_BLOQUEADA_SEGURANCA");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || !host.includes(".")) throw new Error("URL_BLOQUEADA_SEGURANCA");
  if (host.startsWith("::ffff:") ||
      (net.isIP(host) === 6 && !ipv6Global.check(host, "ipv6")) ||
      (net.isIP(host) && bloqueados.check(host, net.isIP(host) === 4 ? "ipv4" : "ipv6"))) {
    throw new Error("URL_BLOQUEADA_SEGURANCA");
  }
  return url;
}

async function enderecoPublico(url, lookup = dns.lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = net.isIP(host);
  const respostas = literal ? [{ address: host, family: literal }] : await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(respostas) || !respostas.length || respostas.some(item =>
    !net.isIP(item.address) || item.address.toLowerCase().startsWith("::ffff:") ||
    (item.family === 6 && !ipv6Global.check(item.address, "ipv6")) ||
    bloqueados.check(item.address, item.family === 4 ? "ipv4" : "ipv6"))) {
    throw new Error("URL_BLOQUEADA_SEGURANCA");
  }
  return respostas[0];
}

function erroTimeout() { return new Error("REDIRECT_TIMEOUT"); }

function umaRequisicao(url, endereco, { deadlineAt, maxBytes, headers, requestImpl } = {}) {
  return new Promise((resolve, reject) => {
    const request = requestImpl || (url.protocol === "https:" ? https.request : http.request);
    let req;
    let res;
    let timer;
    let settled = false;
    let tamanho = 0;
    const partes = [];
    const restante = deadlineAt - performance.now();

    if (restante <= 0) {
      reject(erroTimeout());
      return;
    }

    const limpar = () => {
      clearTimeout(timer);
      if (req) {
        req.off("timeout", aoInativo);
      }
      if (res) {
        res.off("data", aoDado);
        res.off("end", aoFim);
        res.off("aborted", aoAbortado);
        res.off("close", aoFechar);
      }
      // Erros de transporte podem chegar depois do settle/close. Manter os
      // handlers locais evita um evento "error" sem listener; settled preserva o resultado.
    };
    const concluirErro = (erro, abortar = true) => {
      if (settled) return;
      settled = true;
      if (abortar) {
        // Não gerar outro erro ao destruir; erros tardios mantêm seus handlers.
        if (res && !res.destroyed && typeof res.destroy === "function") res.destroy();
        if (req && !req.destroyed && typeof req.destroy === "function") req.destroy();
      }
      limpar();
      reject(erro);
    };
    const aoInativo = () => concluirErro(erroTimeout());
    const aoErroRequisicao = erro => concluirErro(erro);
    const aoErroResposta = erro => concluirErro(erro);
    const aoAbortado = () => concluirErro(new Error("REDIRECT_RESPONSE_ABORTED"));
    const aoFechar = () => {
      if (res && res.complete === false) concluirErro(new Error("REDIRECT_RESPONSE_ABORTED"));
    };
    const aoDado = chunk => {
      if (settled) return;
      tamanho += chunk.length;
      if (tamanho > maxBytes) {
        concluirErro(new Error("REDIRECT_BODY_LIMIT"));
        return;
      }
      partes.push(chunk);
    };
    const aoFim = () => {
      if (settled) return;
      settled = true;
      limpar();
      resolve({ status: res.statusCode || 0, location: res.headers.location || "",
        data: Buffer.concat(partes).toString("utf8") });
    };

    timer = setTimeout(() => concluirErro(erroTimeout()), Math.max(1, restante));
    try {
      req = request(url, {
        method: "GET", headers, timeout: Math.max(1, restante), agent: false,
        lookup: (_hostname, options, callback) => options?.all === true
          ? callback(null, [endereco])
          : callback(null, endereco.address, endereco.family)
      }, resposta => {
        resposta.on("error", aoErroResposta);
        if (settled) {
          resposta.destroy();
          return;
        }
        res = resposta;
        res.on("data", aoDado);
        res.on("end", aoFim);
        res.on("aborted", aoAbortado);
        res.on("close", aoFechar);
      });
      req.on("timeout", aoInativo);
      req.on("error", aoErroRequisicao);
      req.end();
    } catch (erro) {
      concluirErro(erro);
    }
  });
}

async function obterHttpSeguro(urlTexto, { timeout = 4500, maxRedirects = 5, maxBytes = 1024 * 1024,
  headers = {}, lookup = dns.lookup, requestImpl, deadlineAt: deadlineConfigurado } = {}) {
  const prazo = Number.isFinite(Number(deadlineConfigurado))
    ? Number(deadlineConfigurado)
    : performance.now() + Math.max(0, Number(timeout) || 0);
  const visitados = new Set();
  let atual = urlTexto;
  const hops = [];
  for (let passo = 0; passo <= maxRedirects; passo += 1) {
    const url = validarUrlPublica(atual);
    if (visitados.has(url.href)) throw new Error("REDIRECT_LOOP");
    visitados.add(url.href);
    const restanteDns = prazo - performance.now();
    if (restanteDns <= 0) throw new Error("REDIRECT_TIMEOUT");
    let timerDns;
    const endereco = await Promise.race([
      enderecoPublico(url, lookup),
      new Promise((_resolve, reject) => { timerDns = setTimeout(() => reject(new Error("REDIRECT_TIMEOUT")), restanteDns); })
    ]).finally(() => clearTimeout(timerDns));
    const restante = prazo - performance.now();
    if (restante <= 0) throw new Error("REDIRECT_TIMEOUT");
    const resposta = await umaRequisicao(url, endereco, { deadlineAt: prazo, maxBytes, headers, requestImpl });
    hops.push({ url: url.href, status: resposta.status });
    if (resposta.status >= 300 && resposta.status < 400 && resposta.location) {
      if (passo === maxRedirects) throw new Error("REDIRECT_LIMIT");
      atual = new URL(resposta.location, url).href;
      continue;
    }
    return { status: resposta.status, data: resposta.data,
      request: { res: { responseUrl: url.href } }, hops };
  }
  throw new Error("REDIRECT_LIMIT");
}

module.exports = { validarUrlPublica, enderecoPublico, obterHttpSeguro };
