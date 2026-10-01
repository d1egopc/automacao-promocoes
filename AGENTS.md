# Instrucoes do repositorio

## Produção oficial — Optimus Promo

PRODUÇÃO ATUAL E ÚNICA: Hostinger VPS.

Railway está RETIRADO da produção.

Quando uma tarefa mencionar produção, deploy, servidor, VPS, backend de produção, container, PostgreSQL de produção, `/data` de produção, baseline de produção ou health de produção, assumir sempre a Hostinger VPS, salvo instrução explícita do usuário em contrário.

Caminhos oficiais:

- Backend: `/opt/optimus/backend`
- Docker Compose: `/opt/optimus/infra`
- Compose service: `backend`
- Dados persistentes: `/opt/optimus/data`
- Endpoint publico canonico: `https://www.optimuspromo.com.br`

Regras permanentes:

- Não consultar Railway como baseline.
- Não deployar, reparar ou alterar Railway, Railway Postgres, Railway env ou Railway `/data`.
- Não considerar falha Railway como bloqueador da produção Hostinger.
- Railway só pode ser acessado se o usuário pedir explicitamente.
- Nunca usar `docker compose down` em produção.
- Nunca remover volumes.
- Nunca recriar PostgreSQL sem autorização explícita.
- Preservar `/data`.
- Rebuild/recreate somente do serviço necessário.
- Confirmar baseline antes de qualquer alteração.

Os detalhes operacionais estao em [docs/PRODUCTION.md](docs/PRODUCTION.md).
