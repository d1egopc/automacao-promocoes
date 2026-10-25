"use strict";

const dns = require("node:dns/promises");
const tls = require("node:tls");
const net = require("node:net");

const PRIVATE = new net.BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  PRIVATE.addSubnet(ip, prefix, "ipv4");
const GLOBAL6 = new net.BlockList();
GLOBAL6.addSubnet("2000::", 3, "ipv6");
const PRIVATE6 = new net.BlockList();
for (const [ip, prefix] of [
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
])
  PRIVATE6.addSubnet(ip, prefix, "ipv6");
function publicIp(ip) {
  return net.isIP(ip) === 4
    ? !PRIVATE.check(ip, "ipv4")
    : net.isIP(ip) === 6 &&
        GLOBAL6.check(ip, "ipv6") &&
        !PRIVATE6.check(ip, "ipv6");
}

async function httpsReady(host, dependencies = {}) {
  let timer;
  try {
    const records = await Promise.race([
      (dependencies.lookup || dns.lookup)(host, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("dns_timeout")), 4000);
      }),
    ]);
    clearTimeout(timer);
    if (!records.length || records.some(({ address }) => !publicIp(address)))
      return false;
    return await new Promise((resolve) => {
      const socket = (dependencies.connect || tls.connect)({
        host: records[0].address,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
      });
      const finish = (ready) => {
        socket.destroy();
        resolve(ready);
      };
      socket.setTimeout(4000, () => finish(false));
      socket.once("error", () => finish(false));
      socket.once("secureConnect", () =>
        finish(
          socket.authorized &&
            !tls.checkServerIdentity(host, socket.getPeerCertificate()),
        ),
      );
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function hasOwnershipTxt(host, expected) {
  try {
    const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
    const records = await resolver.resolveTxt(`_optimus-verify.${host}`);
    return records.some((parts) => parts.join("") === expected);
  } catch {
    return false;
  }
}

function createVercelDomainProvider(options = {}) {
  const env = options.env || process.env;
  const token = env.LANDING_VERCEL_TOKEN;
  const project = env.LANDING_VERCEL_PROJECT_ID;
  const team = env.LANDING_VERCEL_TEAM_ID;
  const enabled =
    env.LANDING_DOMAINS_ENABLED === "true" &&
    Boolean(
      token &&
      /^prj_[A-Za-z0-9]+$/.test(project || "") &&
      /^team_[A-Za-z0-9]+$/.test(team || ""),
    );
  const fetcher = options.fetch || global.fetch;
  async function request(endpoint, method = "GET", body) {
    if (!enabled)
      throw Object.assign(new Error("integracao_vercel_nao_configurada"), {
        statusCode: 503,
      });
    const url = new URL(endpoint, "https://api.vercel.com");
    url.searchParams.set("teamId", team);
    let response;
    try {
      response = await fetcher(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw Object.assign(new Error("vercel_conexao_indisponivel"), {
        statusCode: 503,
      });
    }
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok)
      throw Object.assign(
        new Error(`vercel_operacao_rejeitada_${response.status}`),
        { statusCode: response.status === 429 ? 429 : 503 },
      );
    if (response.status === 204) return {};
    const reader = response.body?.getReader();
    if (!reader)
      throw Object.assign(new Error("vercel_resposta_invalida"), {
        statusCode: 503,
      });
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) throw new Error("large");
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error("vercel_resposta_invalida"), {
        statusCode: 503,
      });
    }
  }
  const domainPath = (host) =>
    `/v9/projects/${project}/domains/${encodeURIComponent(host)}`;
  function checked(value, host) {
    if (
      !value ||
      value.name !== host ||
      value.projectId !== project ||
      value.gitBranch ||
      value.customEnvironmentId ||
      value.redirect ||
      typeof value.verified !== "boolean"
    )
      throw Object.assign(new Error("vercel_associacao_divergente"), {
        statusCode: 409,
      });
    return value;
  }
  async function checkProject() {
    const value = await request(`/v9/projects/${project}`);
    if (
      value?.id !== project ||
      value.accountId !== team ||
      value.link?.type !== "github" ||
      value.link.org !== "d1egopc" ||
      value.link.repo !== "optimuspromo-frontend" ||
      value.link.productionBranch !== "main"
    )
      throw Object.assign(
        new Error("vercel_projeto_ou_production_branch_divergente"),
        { statusCode: 409 },
      );
  }
  return {
    enabled,
    async inspect(host) {
      const value = await request(domainPath(host));
      return value ? checked(value, host) : null;
    },
    async add(host) {
      await checkProject();
      return checked(
        await request(`/v10/projects/${project}/domains`, "POST", {
          name: host,
          gitBranch: null,
        }),
        host,
      );
    },
    async verify(host) {
      return checked(await request(`${domainPath(host)}/verify`, "POST"), host);
    },
    async config(host) {
      const value = await request(
        `/v6/domains/${encodeURIComponent(host)}/config?projectIdOrName=${project}`,
      );
      if (
        !value ||
        typeof value.misconfigured !== "boolean" ||
        !Array.isArray(value.recommendedCNAME) ||
        !Array.isArray(value.recommendedIPv4)
      )
        throw Object.assign(new Error("vercel_dns_invalido"), {
          statusCode: 503,
        });
      return value;
    },
    async remove(host) {
      await checkProject();
      await request(domainPath(host), "DELETE");
    },
    checkProject,
    ownership: options.ownership || hasOwnershipTxt,
    https: options.https || httpsReady,
  };
}

module.exports = {
  createVercelDomainProvider,
  publicIp,
  httpsReady,
  hasOwnershipTxt,
};
