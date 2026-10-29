# Ateliê — Casa de leilões

Solução do teste técnico Elite Dev / Verzel. Uma aplicação pequena de leilões de arte: React no frontend, Express no backend e PostgreSQL para persistência. O mesmo servidor entrega a API e o frontend em produção.

**Aplicação publicada:** http://15.228.247.112 — **Repositório:** https://github.com/magnoh/atelie-challenger

## Executar com Docker (recomendado)

Com Docker Engine e Docker Compose v2 disponíveis, entre na pasta do projeto e execute:

```sh
docker compose up --build -d
```

Acesse **http://localhost:3001**. Não é necessário instalar Node.js nem PostgreSQL na máquina ou criar um `.env`. O comando compila o React, inicia o PostgreSQL, espera o banco ficar pronto e executa migração e seed automaticamente. A ordem usa `service_healthy`, conforme a [documentação do Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/).

Se o Docker roda no Ubuntu via WSL, execute no terminal do Ubuntu:

```sh
cd /mnt/c/Users/Magno/Documents/challenger-leilao
docker compose up --build -d
```

Depois abra a aplicação no navegador do Windows. Se houver uma execução antiga com `npm start` na porta 3001, pare-a com Ctrl+C antes de subir os containers.

```sh
docker compose ps              # situação da aplicação e do banco
docker compose logs -f app     # acompanhar a inicialização; Ctrl+C sai dos logs
docker compose down            # parar, preservando os dados
```

Os volumes `postgres_data` e `app_data` preservam o banco e a chave de auditoria. A chave é gerada automaticamente no primeiro início se `AUDIT_SECRET` não estiver definido. Se existir `.env`, o Compose pode usar seus valores de `AUDIT_SECRET` e `SEED_PASSWORD`; a conexão com o banco é sempre a interna do container, sem usar a porta 55432 do Windows. Mantenha a mesma chave junto com os mesmos dados. **`docker compose down -v` apaga os volumes, incluindo todos os dados da demonstração.**

As contas e senhas de avaliação estão abaixo. O banco Docker é novo e separado do banco local existente. O PostgreSQL não publica uma porta no host; somente a aplicação publica a porta 3001 em loopback. Essa configuração é para demonstração local por HTTP; em um deploy HTTPS, configure `NODE_ENV=production` e `APP_ORIGIN` com a URL pública.

## Executar localmente sem Docker

Pré-requisitos: Node.js 22.12+ e PostgreSQL 17 (ou compatível). Não depende de Docker, Redis ou outros serviços.

1. Instale as dependências:

   ```sh
   npm ci
   ```

2. Crie um usuário e um banco. No `psql`, conectado como administrador:

   ```sql
   CREATE USER auction WITH PASSWORD 'auction';
   CREATE DATABASE auction OWNER auction;
   ```

3. Copie `.env.example` para `.env` e ajuste `DATABASE_URL` para seu PostgreSQL. Gere uma chave para `AUDIT_SECRET`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Cole o resultado em `AUDIT_SECRET` no `.env`. A chave deve permanecer igual entre reinícios. Não publique o `.env` no GitHub.

4. Crie as tabelas e os dados de demonstração:

   ```sh
   npm run db:migrate
   npm run db:seed
   ```

5. Inicie o desenvolvimento:

   ```sh
   npm run dev
   ```

   Frontend: **http://localhost:5173**. API: **http://localhost:3001/api/health**.

Para executar o frontend compilado junto com a API:

```sh
npm run build
npm start
```

A aplicação completa fica em **http://localhost:3001**. Use `NODE_ENV=development` em HTTP local; em produção, `NODE_ENV=production` habilita cookies `Secure` e exige HTTPS.

### Contas de demonstração

| Perfil | E-mail | Senha padrão |
| --- | --- | --- |
| Leiloeiro | leiloeiro@demo.com | Verzel2026! |
| Licitante Ana | ana@demo.com | Verzel2026! |
| Licitante Bruno | bruno@demo.com | Verzel2026! |

`SEED_PASSWORD` pode alterar a senha inicial. Os botões de avaliação preenchem a senha padrão; informe a nova senha manualmente se alterar essa variável.

Cada licitante recebe R$ 10.000 de saldo simulado. O seed inclui três lotes ao vivo, um agendado e um já arrematado com comprovante. Ana já deu um lance em um dos lotes ao vivo e venceu o lote encerrado. Seus saldos refletem essas operações.

O seed não repõe saldos nem altera prazos ou históricos existentes. Na primeira execução, um dos lotes fica aberto por 7 dias; os demais permitem testar prazos curtos. Ao executar o seed novamente, se o leiloeiro de demonstração não tiver nenhum lote ao vivo, é criado um novo lote aberto por 7 dias. Isso acontece também na inicialização do Docker. Não há renovação automática durante a execução: antes de uma avaliação futura, confira a vitrine e, se necessário, publique um lote pelo painel ou execute `npm run db:seed` com o mesmo banco e a mesma chave de auditoria. Não é necessário apagar o banco.

### Roteiro rápido para avaliar

1. Entre como Ana e confira os saldos total, comprometido e disponível na carteira.
2. Abra o lote em que ela já lidera e veja que não pode cobrir o próprio lance.
3. Entre como Bruno em outra janela/perfil do navegador. Cubra o lance e confira a atualização e a liberação do saldo de Ana.
4. Entre como leiloeiro, busque uma obra ou selecione o catálogo salvo e crie um lote com fim próximo. Um lance nos dois minutos finais prorroga o prazo para dois minutos após o lance.
5. Cancele um lote sem lances. Ele desaparece da vitrine. Lotes com lances não podem ser cancelados.
6. Abra “Meus arremates” como Ana para ver o comprovante já semeado. O link abre sem autenticação.
7. Abra a auditoria de qualquer lote, também sem login.

As contas compartilham o cookie dentro do mesmo perfil de navegador. Use perfis ou janelas privadas separados para simular dois licitantes simultâneos.

## Funcionalidades

- Cadastro e login com perfis de leiloeiro e licitante.
- Botão de sol/lua para alternar entre tema claro e escuro, com preferência salva no navegador e sincronizada entre abas. Na primeira visita, acompanha o sistema.
- Vitrine separada em lotes ao vivo, agendados e encerrados.
- Acervo público na página inicial, com busca e paginação das obras do Metropolitan, sem necessidade de login.
- Busca de obras na API pública do The Metropolitan Museum of Art.
- Criação de lote com imagem, atributos, lance inicial, incremento e horários.
- Cancelamento pelo dono antes do primeiro lance.
- Sala com lance atual, histórico, contagem regressiva e posição do usuário.
- Atualizações via Server-Sent Events, com consulta a cada 15 segundos como alternativa durante reconexões.
- Carteira com depósito simulado, saldo comprometido, saldo disponível e extrato.
- Liquidação automática, débito do vencedor e crédito do leiloeiro.
- Meus arremates, comprovante público compartilhável e auditoria pública.

## Regras e decisões técnicas

**Estrutura:** `server/app.mjs` contém as rotas; `server/service.mjs`, as operações do leilão; `server/domain.mjs`, validações e assinaturas; `server/catalog.mjs`, a API externa. O frontend usa componentes React e navegação por hash, sem biblioteca de rotas ou estado global adicional. Estilos são CSS comum.

**Temas:** `client/theme/tokens.css` centraliza as cores semânticas. `theme-store.js` encapsula persistência, eventos do sistema e sincronização entre abas; `ThemeProvider` integra esse estado ao React com `useSyncExternalStore`, e `ThemeSwitcher` oferece um botão acessível com ícone de sol/lua indicando o tema que será ativado. O padrão segue o sistema; uma escolha explícita prevalece e funciona mesmo se o armazenamento estiver bloqueado. `public/theme-init.js` aplica a preferência antes da primeira renderização, sem script inline nem alteração da CSP. A impressão usa cores claras e as imagens das obras mantêm suas cores originais. Não foram adicionadas dependências.

**Dinheiro e concorrência:** todos os valores são centavos inteiros. Operações financeiras usam uma transação PostgreSQL e um único advisory lock transacional. Isso ordena lances e depósitos, inclusive em lotes diferentes, e impede duas reservas simultâneas sobre o mesmo saldo. É uma escolha simples para o volume de um desafio; não foi projetada para alto tráfego. Leia a documentação de [advisory locks do PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).

**Reserva:** o saldo comprometido é a soma dos lances em que o usuário lidera lotes ainda não liquidados. Ao ser superado, o lote deixa de compor essa soma imediatamente. O líder não pode dar outro lance. O primeiro lance é pelo menos o inicial; os seguintes precisam alcançar o atual mais o incremento.

**Posição na sala:** cada licitante ocupa uma única posição, ordenada pelo seu maior lance no lote. A API calcula a posição do usuário autenticado; a sala atualiza esse número junto com os lances. Quem ainda não participou não possui posição. Identificadores privados dos demais participantes não são publicados.

**Tempo:** o servidor decide o horário válido. Um lance aceito nos últimos 120 segundos move o fim para 120 segundos após o aceite. O servidor verifica vencimentos a cada segundo e também antes de operações relevantes. A liquidação é transacional e só acontece uma vez. Se o servidor ficar desligado, os lotes vencidos são liquidados quando ele retornar. Lotes sem lances encerram sem vencedor e sem transferência.

**API externa:** foi usada a [Collection API do Metropolitan Museum](https://metmuseum.github.io/), sem chave. Somente obras com imagem e marcadas como domínio público são importadas. Dados e imagens são persistidos no PostgreSQL; o lote guarda uma cópia dos atributos na publicação. A vitrine, a sala, a auditoria e os comprovantes não consultam a API externa. Em falhas de busca, o sistema oferece o catálogo já salvo. Se a imagem de uma obra nova não puder ser salva, a publicação solicita outra obra ou uma nova tentativa. O seed contém seis registros reais da API e suas imagens em `server/data/catalog.json` e `public/art/`, permitindo a avaliação mesmo sem rede.

**Auditoria:** cada lance tem um hash SHA-256 calculado sobre ID, lote, sequência, licitante, apelido, valor, horário e hash anterior. O lote guarda a quantidade e a raiz final, assinadas com HMAC-SHA-256 usando `AUDIT_SECRET`, que fica fora do banco. A assinatura também inclui líder, valor, dados do item, vendedor, prazos e situação. A auditoria recalcula a cadeia e verifica a assinatura; detecta edição, inserção e exclusão de lances, inclusive a remoção do último ou de todo o histórico. Apenas recalcular os hashes via SQL não permite gerar uma assinatura válida. Um lote adulterado bloqueia novos lances e liquidação para não movimentar dinheiro com base em registros divergentes.

Essa proteção pressupõe que o atacante tenha acesso ao banco, mas não à chave nem ao servidor. Ela não protege contra controle do servidor ou restauração conjunta de um backup completo já válido e sua assinatura antiga. Não há blockchain nem carimbo de tempo externo. A interface verifica a integridade pelo servidor; não é uma prova independente dele. Trocar `AUDIT_SECRET` invalida assinaturas antigas.

Os horários vindos do PostgreSQL preservam microssegundos na assinatura, mantendo compatibilidade com os registros anteriores em milissegundos. Alterações de um microssegundo nos lances ou prazos são detectadas. Hashes malformados retornam auditoria inválida sem interromper a consulta pública ou a liquidação dos demais lotes.

**Privacidade e autenticação:** páginas públicas mostram apelidos, nunca e-mail, nome ou ID interno do licitante. Senhas usam scrypt com salt aleatório; sessões usam tokens aleatórios armazenados como hash no banco e cookies HttpOnly/SameSite. Há validação dos dados e da origem nas mutações. Os depósitos são somente simulados.

**Escopo:** uma instância Node com PostgreSQL é suficiente. Há Docker Compose para iniciar esses dois serviços. Não há microsserviços, ORM, Redis, pagamentos reais ou infraestrutura de filas. SSE usa eventos em memória; em múltiplas instâncias, a consulta periódica ainda atualiza as telas, mas o evento imediato só alcança clientes da instância que recebeu a ação. Requisições financeiras não são repetidas automaticamente; um novo depósito confirmado é uma nova operação. Rate limit de login é local à instância.

## Testes

```sh
npm test
npm run test:catalog
npm run test:theme
npm run test:integration
```

São 38 testes: 9 de domínio, 13 de integração, 9 de catálogo e 7 de tema. Incluem concorrência no mesmo lote e entre lotes, reserva/liberação, liquidação única, comprovante público, autorização, posição do licitante, preparação da demonstração e adulteração direta via SQL, inclusive microssegundos e hashes malformados. Os testes de integração usam `DATABASE_URL`, criam um schema temporário isolado e o removem no final. O usuário do banco precisa de permissão para criar schemas. Não apagam os dados da demonstração.

Há também 9 testes de catálogo sem banco real, cobrindo busca, importação, fallback, domínio público e navegação do acervo. A busca usa `/public/collection/v1.1/search` com paginação; os detalhes continuam em `/public/collection/v1/objects/{id}`. O endpoint antigo `/v1/search` foi desativado e retorna HTTP 410, conforme a [migração documentada pelo Metropolitan](https://metmuseum.github.io/).

A página inicial oferece “Acervo em exposição”, sem login, consultando `/api/exhibition`. A navegação sem termo usa a lista completa de IDs do endpoint `/v1/objects`, em páginas de até 24 registros; exibe somente os que têm imagem pública. A busca por termo usa a API paginada, que permite acessar até os primeiros 10.000 resultados; a tela avisa quando é necessário refinar a busca. As imagens da exposição são servidas pelo museu. A aplicação mantém a lista de IDs e até 40 páginas recentes em memória, sem baixar todo o acervo para o disco da EC2. Se a API falhar, oferece os itens já salvos. Somente ao importar uma obra para o catálogo do leiloeiro e publicar um lote seus dados/imagem são persistidos no banco, mantendo os leilões independentes da API externa.

Os lotes para lance continuam na seção “Em leilão”. Uma obra em exposição não é automaticamente um lote, não possui preço ou prazo fictício e leva ao registro original do museu para detalhes.

### Verificação em 28/10/2026

- Testes automatizados executados com PostgreSQL 17 local e schemas isolados.
- Build de produção com Vite validado; aplicação publicada na EC2 com Docker Compose.
- Dependências atualizadas; `npm audit` não reporta vulnerabilidades conhecidas nesta verificação.
- Conferência visual manual em navegador e celular ainda pendente: a ferramenta de automação não teve acesso ao Chrome. Os testes automatizados não substituem essa revisão.

## Deploy na AWS EC2

Para criar a EC2 do zero e subir aplicação e banco com Docker, siga [o passo a passo da EC2](deploy/ec2/README.md). Foram incluídos `compose.ec2.yaml`, configuração do proxy e script de instalação do Docker no Ubuntu 24.04. Nenhuma instância AWS foi criada automaticamente.

## Deploy no Render

O arquivo `render.yaml` declara uma aplicação Node e um PostgreSQL, ambos no plano `free`. Confira a disponibilidade e os limites vigentes na conta antes de confirmar a criação. A configuração segue a [referência oficial de Blueprints](https://render.com/docs/blueprint-spec).

1. Publique os arquivos do projeto em um repositório público no GitHub, sem `.env`, `node_modules`, `tmp` ou `.local`.
2. No Render, crie um Blueprint a partir desse repositório e confira os recursos declarados.
3. O Blueprint gera `AUDIT_SECRET`, conecta `DATABASE_URL`, instala as dependências e compila o React.
4. No início, são executados migração, seed e servidor. O seed não altera dados já existentes.
5. Quando o serviço ficar saudável, abra a URL HTTPS fornecida pelo Render e teste os dois perfis. Configure `APP_ORIGIN` com essa URL caso utilize outra origem de frontend. No deploy padrão, frontend e API têm a mesma origem.
6. Coloque a URL pública e o link do repositório no formulário do teste. Essa etapa é obrigatória no enunciado.

O banco está configurado sem acesso externo, para uso pela aplicação na rede interna do provedor. Hospedagens gratuitas podem suspender processos ou limitar a duração do banco; veja os [limites do plano gratuito](https://render.com/docs/free). Durante uma suspensão, a liquidação ocorre no retorno do servidor.

## Uso de IA

IA foi utilizada na leitura do enunciado, implementação inicial do frontend e backend, elaboração da auditoria e criação dos testes. As verificações executadas e as limitações observadas estão registradas acima. O candidato deve revisar o código, entender as escolhas de transação, reserva e assinatura e informar no formulário o que revisou ou ajustou; este README não afirma que essa revisão humana já aconteceu.
