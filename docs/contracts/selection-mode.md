# Selection Mode

## Objetivo e arquitetura

Selection Mode identifica produtos visuais na página e encaminha suas URLs ao pipeline oficial de captura. Ele não possui uma autoridade comercial própria: título, preço, imagem, identidade e elegibilidade continuam sendo resolvidos pelo Registry e pelos adapters oficiais.

O fluxo é:

`ativar Selection Mode → descobrir itens canônicos → selecionar/desselecionar → escolher uma lista → captura oficial → Preview oficial → Add to List`

O lote é limitado a 30 itens. A barra inferior oferece `Marcar todos`, `Desfazer`, `Limpar`, `+ Nova lista` e a ação de adicionar à lista. `+ Nova lista` reutiliza o contrato oficial de criação de listas e atualiza a lista disponível no próprio fluxo.

## Lifecycle e controles

Cada produto individual pode produzir no máximo um controle por card canônico. Swatches, variantes, badges, links auxiliares, carrosséis e wrappers não são produtos independentes. O estado de seleção é associado à identidade canônica, de modo que instâncias visuais duplicadas do mesmo produto permaneçam coerentes.

O controle e o outline pertencem ao `canonicalItemRoot`, nunca a uma grade, seção, linha ou container geral. A geometria é recalculada durante scroll, resize e mudanças relevantes já observadas pelo singleton existente; controles fora da região visível de um ancestral com clipping podem permanecer descobertos, mas não visíveis, até o card entrar na área útil. O teardown remove listeners, observers, controles e estado temporário sem deixar launcher duplicado.

Enquanto Selection Mode está ativo, o launcher fica oculto. Ao sair pelo controle de fechamento, o launcher é restaurado. Fora do modo, a navegação e as ações do marketplace permanecem inalteradas.

## Shopee

Shopee Selection usa o mesmo Capture oficial do Produto atual. Depois de a aba PDP atingir `complete`, a orquestração pode aguardar semantic readiness bounded para a fonte oficial de preço; essa espera apenas decide quando chamar o Capture e não extrai nem redefine valores comerciais. A espera é limitada, desmontável e não usa sleep fixo como autoridade.

O processamento Shopee permanece sequencial quando necessário para hidratação confiável. A List API, dedupe, Preview e adapters não são substituídos por um segundo pipeline.

## Listas e teardown

Os itens capturados seguem as mesmas validações e o mesmo endpoint de listas do fluxo normal. Erros de captura não são convertidos em itens comerciais e não alteram a semântica de membership/dedupe. Ao concluir ou cancelar, abas temporárias são fechadas em `finally`, a aba original permanece disponível e nenhum estado operacional fica pendente no painel.

## Limitações conhecidas desta versão

- KaBuM pode ter cobertura parcial de controles em alguns blocos ou carrosséis.
- Shopee pode exigir processamento de uma PDP visível para hidratação comercial confiável; a tentativa de processar no-focus foi rejeitada.

Esses pontos são limitações conhecidas da versão distribuída, não contratos desejados para novas implementações.
