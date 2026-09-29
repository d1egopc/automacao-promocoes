# Optimus Social Art Renderer

Servico isolado para renderizar a arte visual do Social em PNG 1080x1080.

## Contrato

`POST /render/social/post-art`

Headers:

- `Authorization: Bearer ${SOCIAL_ART_RENDERER_TOKEN}`
- `Content-Type: application/json`

Payload:

```json
{
  "clienteIdInterno": "cliente_123",
  "ofertaId": "oferta_123",
  "template": { "versao": 1 },
  "dados": {
    "titulo": "Produto",
    "precoAntigo": "299.90",
    "preco": "199.90",
    "cupom": "PROMO10",
    "marketplace": "amazon",
    "imagem": "https://cdn.exemplo/produto.png"
  },
  "cta": "COMENTE \"PROMO\"",
  "hash": "sha256"
}
```

Resposta:

```json
{
  "ok": true,
  "imagemUrlPublica": "https://cdn.exemplo/posts/cliente/oferta/hash.png",
  "hash": "sha256",
  "templateVersao": 1,
  "cache": false
}
```

## Variaveis

- `SOCIAL_ART_RENDERER_TOKEN`
- `SOCIAL_ART_STORAGE_PROVIDER=r2`
- `SOCIAL_ART_PUBLIC_BASE_URL`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `RENDERER_RATE_LIMIT_PER_MINUTE`
- `RENDERER_MAX_PAYLOAD`
- `RENDERER_IMAGE_TIMEOUT_MS`
- `RENDERER_IMAGE_MAX_BYTES`
- `RENDERER_IMAGE_MAX_REDIRECTS`

No backend principal:

- `SOCIAL_ART_RENDERER_URL`
- `SOCIAL_ART_RENDERER_TOKEN`
- `SOCIAL_ART_RENDERER_TIMEOUT_MS`

## Deploy

O deploy deve seguir a infraestrutura operacional atualmente documentada para o Optimus Promo.
Este repositorio nao define um provedor ou procedimento de deploy para o renderer.

## Consumo estimado

- RAM minima recomendada: 768 MB.
- RAM confortavel: 1 GB a 1.5 GB.
- CPU: 1 vCPU para baixa concorrencia.
- Concorrencia inicial recomendada: 1 a 2 renders simultaneos por instancia.
