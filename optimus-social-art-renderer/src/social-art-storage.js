function texto(valor = "") {
  return String(valor ?? "").trim();
}

function clienteSeguro(valor = "") {
  return texto(valor || "admin").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "admin";
}

function ofertaSegura(valor = "") {
  return texto(valor || "oferta").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "oferta";
}

function assertHash(hash = "") {
  const h = texto(hash).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h)) throw new Error("hash_invalido");
  return h;
}

function publicBaseUrl() {
  const base = texto(process.env.SOCIAL_ART_PUBLIC_BASE_URL);
  if (!base) throw new Error("social_art_public_base_url_ausente");
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error("social_art_public_base_url_invalida");
  }
  if (url.protocol !== "https:") throw new Error("social_art_public_base_url_invalida");
  return url;
}

function caminhoArte({ clienteId = "admin", ofertaId = "", hash = "" } = {}) {
  return `posts/${clienteSeguro(clienteId)}/${ofertaSegura(ofertaId)}/${assertHash(hash)}.png`;
}

function urlPublica(caminho = "") {
  return new URL(caminho, publicBaseUrl()).toString();
}

function endpointR2() {
  const accountId = texto(process.env.R2_ACCOUNT_ID);
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

async function criarS3Client() {
  const { S3Client } = require("@aws-sdk/client-s3");
  const endpoint = texto(process.env.SOCIAL_ART_S3_ENDPOINT || endpointR2());
  const region = texto(process.env.SOCIAL_ART_S3_REGION || "auto");
  const accessKeyId = texto(process.env.R2_ACCESS_KEY_ID || process.env.SOCIAL_ART_ACCESS_KEY_ID);
  const secretAccessKey = texto(process.env.R2_SECRET_ACCESS_KEY || process.env.SOCIAL_ART_SECRET_ACCESS_KEY);
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("social_art_storage_credenciais_ausentes");
  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true
  });
}

async function comandosS3() {
  return require("@aws-sdk/client-s3");
}

async function existeObjeto({ client, bucket = "", key = "", HeadObjectCommand = null } = {}) {
  const ComandoHead = HeadObjectCommand || (await comandosS3()).HeadObjectCommand;
  try {
    await client.send(new ComandoHead({ Bucket: bucket, Key: key }));
    return true;
  } catch (erro) {
    const status = erro?.$metadata?.httpStatusCode || erro?.Code || erro?.name;
    if (status === 404 || status === "NotFound") return false;
    throw erro;
  }
}

async function salvar({
  clienteId = "admin",
  ofertaId = "",
  hash = "",
  buffer = Buffer.alloc(0),
  mimeType = "image/png",
  s3Client = null,
  comandos = null
} = {}) {
  const provider = texto(process.env.SOCIAL_ART_STORAGE_PROVIDER || "r2").toLowerCase();
  if (!["r2", "s3"].includes(provider)) throw new Error("social_art_storage_provider_invalido");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("social_art_buffer_obrigatorio");
  if (mimeType !== "image/png") throw new Error("social_art_mime_invalido");

  const bucket = texto(process.env.R2_BUCKET || process.env.SOCIAL_ART_BUCKET);
  if (!bucket) throw new Error("social_art_bucket_ausente");
  const key = caminhoArte({ clienteId, ofertaId, hash });
  const client = s3Client || await criarS3Client();
  const comandosResolvidos = comandos || await comandosS3();
  const cached = await existeObjeto({
    client,
    bucket,
    key,
    HeadObjectCommand: comandosResolvidos.HeadObjectCommand
  });
  if (!cached) {
    await client.send(new comandosResolvidos.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable"
    }));
  }

  return {
    ok: true,
    cache: cached,
    key,
    imagemUrlPublica: urlPublica(key),
    mimeType: "image/png",
    bytes: buffer.length,
    hash: assertHash(hash)
  };
}

module.exports = {
  caminhoArte,
  urlPublica,
  salvar
};
