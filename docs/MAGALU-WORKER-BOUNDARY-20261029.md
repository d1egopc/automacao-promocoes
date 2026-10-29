# Magalu — fronteira Worker/content script, candidata isolada

Base publicada conferida na missão 14: `f02b5a590c6f01f8ceb430013990a1c86ddcd522`; nenhuma publicação nesta missão.

Classificação: tarefa de comunicação Worker/extensão; risco alto por identidade e afiliação. Contratos: EXTENSION, MARKETPLACES, MULTITENANCY e produção. Persistência: somente fixtures descartáveis, sem dado produtivo. Performance: até três mensagens locais na mesma aba, apenas após erro exato de receptor ausente; duas esperas de 150/300ms. Superfície: somente `optimus-capture/local-worker/magalu-identity.js`. Isolamento em worktree necessário para preservar candidatas e a base publicada. Reversibilidade: voltar ao artefato anterior da extensão em futura publicação autorizada. Áreas congeladas: backend, sessões, integrações, permissões Chrome, Radar, RIO, Clonador, demais marketplaces e filtros. Decisão humana: publicação/instalação e homologação real separadas.

## Contrato e causa reproduzida

OneLink HTTPS exato → tarefa `magalu_identity_v1` → resolver da extensão → redirect técnico sem cookies ou navegação normal existente → `OPTIMUS_CAPTURE_PAGE` no frame 0 → registro `content/capture-content.js` → registry/adapter Magalu → validação de canônica, SKU, título e imagem → contrato backend → cache técnico → adapter comercial da workspace.

O manifesto registra o content script nos hosts oficiais Magalu com `run_at=document_idle`; OneLink tem host permission, mas não recebe content script, pois sua página intermediária não é uma PDP. Não ampliar matches ou permissões. O tipo de mensagem e o envelope `{produto}` do receptor são compatíveis.

O código anterior enviava uma única mensagem assim que a aba reportava `complete`. A prontidão da página não é um handshake de prontidão do listener `document_idle`. A referência oficial do Chromium explica que esse content script pode executar após `window.onload`: https://chromium.googlesource.com/chromium/chromium.git/+/refs/heads/main/chrome/common/extensions/docs/extensions/content_scripts.html . A documentação atual é https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts . Isso sustenta a possibilidade de ordenação; não prova qual versão/situação ocorreu no PC do proprietário.

Reprodução determinística: aba pronta, receptor ainda não registrado, primeira mensagem rejeitada com `Could not establish connection. Receiving end does not exist.`; receptor real registrado na próxima tentativa. A base falha antes de confirmar identidade. A candidata recupera a comunicação e valida o resultado pelo contrato backend. A fixture carrega o receptor, registry e adapter reais; não substitui o retorno de produto por um objeto fabricado no sendMessage.

## Patch mínimo

Somente esse erro de ausência de receptor recebe até três tentativas na mesma aba/frame, com espera total de 450ms. Antes de repetir, relê a URL e exige a mesma identidade/canônica; prazo existente de 12 segundos continua limitando a captura. Ausência persistente vira código estável `magalu_identity_content_script_ausente`. Outros erros não recebem retry. Aba técnica é fechada em sucesso e falha pelo finally existente.

Nenhuma nova aba por retry, reload, `executeScript`, bypass de permissões, cookie/token, CAPTCHA, novo request HTTP ou resolvedor paralelo. Não repetir resposta comercial inválida. Navegação divergente, SKU conflitante, ausência de título/imagem, página de erro e browser indisponível continuam bloqueados. O caminho técnico 2xx já existente não foi alterado; a correção se limita ao receptor da navegação de fallback.

## Evidência real e limites

Reutilizadas as evidências da missão 14, sem reabrir ingresso. Uma única amostra foi também aberta em navegação Chrome legítima, sem executar tarefa comercial. Eventos 200268/200288/200316 têm JID Garimpei comprovado, origem `admin`, sessão persistida `admin_Zoiao Claro`, jobs comerciais em `user_pss60lus`. A equivalência desse rótulo com o ID interno `admin_ZOIAO` não foi presumida. Esse vínculo não transforma owner do Worker em dono da oferta; o adapter continua usando exclusivamente `job.cliente_id` para integração/prova afiliada.

A task 28915 registrou ausência de receptor. As demais falhas `magalu_identity_produto_nao_confirmado` não registram URL final/etapa suficiente para atribuir todas à corrida. Não afirmar que o patch recupera os três eventos produtivos. OneLinks chegaram a candidatos SKU 237736500, 238818200 e 242057800; PDP 403 e fontes convencionais sem PDP/campos oficiais não confirmam produto. Em 29/10 às 18:57:58 BRT, o OneLink q6mruvn4 abriu uma PDP oficial legível: SKU 242057800, Ar-condicionado Split 18.000 BTUs Philco Eco Inverter Frio PAC18FTW, imagem mlcdn, categoria oficial e R$ 3.103,03. O snapshot público sanitizado está em `tests/fixtures/magalu-official-pdp-242057800.json`; não contém parâmetros afiliados de terceiros. É evidência atual para uma amostra; não prova o conteúdo recebido nas tasks históricas nem a recuperação dos outros dois produtos.

Não foi possível inspecionar `chrome://extensions`: política do navegador bloqueou a ação, e não houve contorno por outra superfície, CDP, arquivo de perfil ou execução indireta. O proprietário informou ID bhdlnillcdifolbnbacbicnekncbeopb e origem unpacked `C:\Users\Liva D1EGOPC\Documents\BACKEND-OFICIAL-2026\optimus-capture`. Leitura autorizada dessa pasta encontrou manifesto 0.2.0; manifest, Worker Magalu, capture-content, background e adapter Magalu coincidem byte a byte com a base f02b5a59. SHA-256 do Worker em disco: 151a23e1646c62a188493617a88eb126335d408fd6d14960f25a5d4ad6fd720a. O launcher está presente na PDP oficial observada. Isso comprova arquivos em disco e injeção atual, não o estado em cache do service worker ou receptor no instante histórico. Nenhuma extensão foi recarregada ou instalada.

Não há evidência que autorize trocar credenciais, exigir novo login ou acrescentar sessão de navegador. Navegação legítima já existente permanece opcional; página 403/CAPTCHA/login sem fatos suficientes continua falhando. Worker offline mantém o fail-closed para identidade não comprovada; não cria dependência nova para os demais marketplaces.

## Testes e interpretação

`magalu-worker-boundary.test.cjs`: corrida de receptor, ausência permanente, 403 sem fatos, SKU divergente, navegação divergente, erro não elegível a retry, DOM oficial público sanitizado de uma amostra, mais dois controles sintéticos → contrato backend → adapter → duas afiliações distintas por workspace; serviço real de persistência com banco fake registra seis ofertas isoladas. Nenhum dispatcher/provider é invocado.

As URLs OneLink e SKUs candidatos vêm das amostras reais. Uma fixture reproduz somente os campos Product JSON-LD efetivamente observados na PDP oficial; as outras duas são sintéticas. Todas as credenciais, conversões afiliadas, respostas do resolvedor de fatos e operações de banco são simuladas. O replay usa receptor, registry, adapter, contrato backend e serviço de criação reais, mas não comprova comissão, consulta oficial do backend nem gravação PostgreSQL. O Worker de identidade devolve canônica/SKU e prova técnica, não transporta todos os fatos da PDP ao backend. Portanto a PDP legível no Chrome não garante que o resolvedor backend posterior deixará de receber 403. Não ampliar esta correção de comunicação para resolver fatos ou alterar o contrato comercial.

CI Linux/Node24 executa reprodução negativa da base, positiva da candidata, regressões existentes de Magalu/Worker/autenticação, captura dos seis marketplaces e afiliação Shopee/AliExpress, além do Guardião inalterado. Manifesto, permissões, backend, banco e interfaces comerciais devem permanecer sem diff. O Guardian trata esse arquivo da extensão como artefato fora do runtime backend; isso não autoriza deploy na VPS.

## Resultado e menor ação restante

- Defeito corrigível comprovado por reprodução: envio único antes da disponibilidade do receptor, compatível com a falha da task 28915. Não há prova para atribuir todos os erros de identidade a essa corrida.
- Comunicação local: 7/7 testes focais, incluindo amostra pública oficial, criação de seis ofertas em banco fake e dois tenants; 15 scripts de regressão existentes passaram localmente em Node 24.
- Pipeline local: PASS COM DEPENDÊNCIAS SIMULADAS. Pipeline com Worker real, resolvedor oficial e integração comercial: BLOQUEADO/NÃO HOMOLOGADO; não houve tarefa produtiva, envio ou alteração da extensão instalada.
- CI e Guardião: executar na branch isolada e registrar os IDs e resultados na entrega. O Guardião permanece inalterado; sua exclusão preexistente deste arquivo do runtime backend não deve ser interpretada como validação funcional da extensão.

Menor homologação futura: mediante autorização separada de instalação do artefato versionado, testar uma única OneLink com o Worker real e integração da workspace comercial, sem envio, comprovando receptor, identidade, fatos oficiais e prova afiliada. Se a PDP normal não oferecer fatos ou o resolvedor continuar bloqueado por 403, parar nesse ponto; não adicionar retries HTTP, contornar autenticação ou reaproveitar a afiliação do grupo.

Decisão: candidata de comunicação verificável e preservada; NO-GO para declarar recuperação comercial concluída ou para instalação/publicação automática. Backend, VPS, sessões, Radar, RIO, Clonador, demais marketplaces, credenciais e filtros permanecem sem alteração.
