# FacturaFácil

SaaS multitenant para pequenas empresas em Moçambique criarem cotações comerciais, gerarem PDF A4 e partilharem no WhatsApp. Interface em português, valores em Meticais.

Versão 1 gera **cotações** apenas. Não emite facturas, recibos nem documentos fiscais, e não se apresenta como certificado pela Autoridade Tributária.

## Estado atual

Tudo o que está descrito abaixo funciona e foi testado neste ambiente:

- Registo, login, logout, reposição de palavra-passe e onboarding do negócio.
- Painel com estatísticas reais da base de dados.
- Clientes e catálogo de produtos/serviços com pesquisa, edição e arquivo.
- Construtor de cotações com totais recalculados ao vivo, desconto de linha, desconto global, IVA configurável e cliente criado sem sair do fluxo.
- Emissão atómica com numeração sequencial por empresa (`ORC-2026-0001`), snapshot imutável e estados.
- Histórico com pesquisa, filtros de estado, cliente e datas, ordenação e paginação no servidor.
- PDF A4 multiplágina, página pública de consulta e partilha por WhatsApp com link opaco e revogável.
- Definições do negócio, logótipo, valores por omissão e alteração de palavra-passe.
- Testes automatizados: 15 testes executados com sucesso (aritmética monetária, numeração, emissão, isolamento entre empresas).

### Nota importante sobre a base de dados

O pedido original especifica Supabase. Este ambiente não tem credenciais Supabase, por isso a aplicação corre com um backend real em **SQLite** (`node:sqlite`), incluído no Node 24, para que todas as funcionalidades possam ser executadas e demonstradas sem serviços externos.

O caminho de produção está preparado em `supabase/migrations/0001_init.sql`: esquema PostgreSQL completo, políticas RLS, bucket de logótipos e função atómica de numeração. **Essa migração ainda não foi executada num projeto Supabase.** Para produção, é necessário aplicar a migração e substituir a camada de acesso a dados pelo cliente Supabase (ou ligar o Postgres diretamente). Não há aqui qualquer afirmação de que o Supabase esteja a correr. Na Vercel, o SQLite e os uploads usam `/tmp` para evitar escritas no sistema de ficheiros imutável da função; esses dados são temporários e não substituem uma base de dados persistente.

## Arranque rápido

Requisitos: Node.js 24 ou superior.

```bash
npm install
npm run seed      # cria a base de dados local e dados de demonstração
npm run dev
```

Abrir http://localhost:3000

Conta de demonstração:

```text
Email:  demo@facturafacil.co.mz
Palavra-passe: demo1234
```

Sem executar o seed, a aplicação arranca vazia e o registo cria a primeira empresa.

A página de entrada mostra o botão **Explorar demonstração** quando a conta de demonstração existe. O botão desaparece em produção, a menos que `DEMO_MODE=1` seja definido. Use `DEMO_MODE=0` para o desativar por completo.

## Comandos

```bash
npm run dev        # servidor de desenvolvimento
npm run build      # build de produção
npm start          # servir o build
npm run typecheck  # TypeScript sem emissão
npm test           # Vitest
npm run seed       # repor dados de demonstração
```

## Estrutura

```text
app/
  (auth)/          entrar, registar, recuperar palavra-passe
  onboarding/      configuração inicial do negócio
  (app)/           painel, clientes, catálogo, cotações, definições
  s/[token]/       consulta pública de uma cotação partilhada
  api/             PDF autenticado, PDF público, logótipos
  actions/         Server Actions com validação Zod e autorização no servidor
components/        interface, construtor de cotações, documento, PDF, formulários
lib/               base de dados, dinheiro, autenticação, cotações, PDF, tokens
supabase/          migração PostgreSQL com RLS para produção
tests/             testes de aritmética e de emissão/isolamento
scripts/seed.ts    dados de demonstração
data/              base SQLite e uploads (ignorados pelo git)
```

## Decisões de engenharia

### Dinheiro exato

Todos os valores monetários são inteiros em cêntimos (`1250000` = `12.500,00 MT`). Quantidades usam milésimos (`2500` = `2,5`). Descontos e IVA usam pontos base (`1600` = `16%`).

Nenhum total é calculado com vírgula flutuante. O servidor recebe os valores em texto e recalcula tudo antes de guardar, ignorando totais enviados pelo cliente. O desconto global é distribuído proporcionalmente pelas linhas, com ajuste de resto, antes do IVA.

Ficheiros principais: `lib/money.ts`, `app/actions/quotations.ts`.

### Numeração

Rascunhos não têm número (`quotation_number` nulo). O número é atribuído apenas na emissão, dentro de `BEGIN IMMEDIATE`, com o contador anual da empresa em `quotation_sequences` e restrição `UNIQUE(business_id, quotation_number)`. Números emitidos nunca são reutilizados. A migração Supabase usa uma função `SECURITY DEFINER` equivalente.

### Imutabilidade do documento emitido

Ao emitir, é guardado um snapshot JSON com os dados do negócio, cliente, itens, totais e textos. A página de detalhe, o PDF e o link público leem o snapshot. Alterações posteriores a preços, cliente ou dados da empresa não mudam documentos já emitidos. Rascunhos continuam editáveis.

### Partilha segura

O link público usa um token aleatório de 32 bytes (base64url), guardado apenas como hash SHA-256 para procura. O token é imprevisível, expira em 30 dias e pode ser revogado. A página pública mostra apenas o documento daquela cotação, nunca listas nem identificadores internos previsíveis. O endpoint público tem limitação de pedidos.

O botão de WhatsApp abre uma mensagem pré-preenchida com número, valor e link. O PDF é descarregado e anexado manualmente, porque a API do WhatsApp não permite anexos automáticos por este meio.

### Autenticação e isolamento

Palavras-passe com `scrypt` e sal individual. Sessões guardadas por hash do token num cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção. Todas as leituras e escritas incluem `business_id` obtido da sessão, nunca de parâmetros do pedido. As Server Actions validam com Zod e voltam a verificar a empresa antes de tocar nos dados.

A migração Supabase replica esta regra com RLS em todas as tabelas da empresa e políticas que verificam a empresa do utilizador autenticado, incluindo nas linhas filhas das cotações.

## Rotas

| Rota | Descrição |
| --- | --- |
| `/painel` | Estatísticas e cotações recentes |
| `/clientes`, `/clientes/novo`, `/clientes/[id]` | Gestão e histórico de clientes |
| `/catalogo`, `/catalogo/novo`, `/catalogo/[id]` | Produtos e serviços |
| `/cotacoes` | Histórico, filtros e paginação |
| `/cotacoes/nova`, `/cotacoes/[id]/editar` | Construtor |
| `/cotacoes/[id]` | Documento, estado, PDF, partilha |
| `/definicoes` | Perfil, logótipo, valores por omissão, conta |
| `/s/[token]` | Consulta pública do documento |
| `/api/cotacoes/[id]/pdf` | PDF autenticado |
| `/s/[token]/pdf` | PDF público do link partilhado |

## Testes

```bash
npm test
npm run typecheck
```

Resultado verificado neste ambiente:

```text
tests/money.test.ts    8 passed
tests/issuance.test.ts 7 passed
Total                 15 passed
```

Os testes cobrem arredondamento e descontos, IVA, numeração sequencial, congelamento do snapshot, duplicação sem número, bloqueio de edição de cotação emitida e impossibilidade de ler uma cotação de outra empresa.

Verificação manual no browser: emissão de `ORC-2026-0003` (`9.860,00 MT`), PDF com 200 e `application/pdf`, link público com o número e total corretos, WhatsApp com mensagem preenchida, registo de nova conta a cair no onboarding, painel com estatísticas reais e estado vazio por empresa.

## Deploy

1. Criar um projeto Supabase.
2. Aplicar `supabase/migrations/0001_init.sql` no editor SQL ou via CLI (`supabase db push`).
3. Criar o bucket `logos` (a migração inclui as políticas de storage).
4. Adaptar a camada de dados para o cliente Supabase e configurar as variáveis de `.env.example`.
5. Publicar na Vercel com `NEXT_PUBLIC_APP_URL` e as chaves do projeto.
6. Manter `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor. Nunca a expor em variáveis `NEXT_PUBLIC_*`.

O PDF usa `@react-pdf/renderer` no runtime Node, por isso as rotas de PDF declaram `runtime = "nodejs"`.

## Limitações conhecidas

- O Supabase não está ligado neste ambiente. A migração é entregue, mas não executada.
- Não há provedor de email. Em desenvolvimento, o pedido de reposição mostra o link diretamente na interface. Em produção é necessário ligar um provedor e remover essa exposição.
- O ficheiro SQLite é único e local. Não serve múltiplas instâncias em produção. Essa função pertence ao Postgres/Supabase.
- Uma conta gere uma empresa. O esquema já prevê associação de vários utilizadores, mas a gestão de equipas não está implementada.
- O envio por WhatsApp é manual: link com mensagem pronta e PDF descarregado pelo utilizador.
- Cotações emitidas não voltam a rascunho; para alterar, duplique e emita uma nova versão.
- Não há integração fiscal, assinatura digital nem certificação.

## Variáveis de ambiente

Ver `.env.example`. Em modo local apenas `DATA_DIR` e `NEXT_PUBLIC_APP_URL` são usados. As variáveis Supabase estão reservadas para o caminho de produção e não são lidas pela demonstração SQLite.
