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

## Fonte única de desenvolvimento

- Backend e frontend oficiais são a fonte única de trabalho.
- Pasta externa, worktree ou candidata só pode ser usada quando houver necessidade técnica explícita.
- Candidata anterior não é baseline implícita para trabalho novo.
- Ao terminar um experimento, reconciliar o resultado na árvore oficial.
- Backup manual é proteção e não fonte de desenvolvimento.

## Selection Mode — invariantes de distribuição

- Selection Mode escolhe produtos; a captura segue o pipeline oficial.
- Não criar uma segunda autoridade para título, preço ou imagem.
- Um card canônico não pode possuir múltiplos controles de Selection.
- Swatches, variantes, badges e wrappers não são produtos independentes.
- Shopee Selection preserva o Capture oficial e a semantic readiness de preço.
- Semantic readiness não pode ser substituída por sleep fixo.
- Mudanças de UX não podem alterar Capture, List API ou adapters.
- Scroll e infinite scroll preservam identidade e estado de seleção.
- `+ Nova lista` reutiliza o contrato oficial de criação de listas.
- O launcher fica oculto enquanto Selection Mode estiver ativo.
