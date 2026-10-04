# Produção Optimus Promo

## Alvo oficial

A única produção atual é a Hostinger VPS. Railway está **RETIRED** e não deve ser usado como baseline, alvo de deploy ou fonte de diagnóstico da produção.

| Item | Valor |
| --- | --- |
| Backend | `/opt/optimus/backend` |
| Docker Compose | `/opt/optimus/infra` |
| Compose file | `/opt/optimus/infra/compose.yml` |
| Compose service | `backend` |
| Dados persistentes | `/opt/optimus/data` |
| Frontend publico | `https://www.optimuspromo.com.br` (Vercel) |
| API/backend publico | `https://go.optimuspromo.com.br` (Hostinger/Caddy -> `127.0.0.1:3000`) |

Os contratos canonicos atuais de topologia e deploy sao [docs/contracts/PLATFORM-TOPOLOGY.md](contracts/PLATFORM-TOPOLOGY.md) e [docs/contracts/PRODUCTION-DEPLOYMENT.md](contracts/PRODUCTION-DEPLOYMENT.md).

## Regras de operacao

- Confirmar SHA, status do checkout, containers, PostgreSQL, HTTP, flags e `/data` antes de alterar produção.
- Não usar `docker compose down`.
- Não remover volumes.
- Não recriar PostgreSQL sem autorização explícita.
- Rebuild/recreate somente do serviço necessário, usando o Compose oficial.
- Preservar `/opt/optimus/data`.
- Não alterar env, flags ou dados como parte de um deploy sem escopo explícito.
- Em qualquer alvo diferente dos caminhos e serviço acima, abortar com `alvo de producao nao reconhecido`.

## Preflight

O workflow `.github/workflows/deploy-backend-vps.yml` valida, antes do deploy, a existência do backend, do Compose e do serviço `backend`. Essa validação é fail-closed e não contém credenciais, IPs ou tokens.

## Railway

Referências a Railway podem existir apenas como histórico ou contexto legado. Railway não é produção atual e só pode ser acessado mediante pedido explícito do usuário.
