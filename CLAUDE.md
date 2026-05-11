# LIE — Sistema de Gestão de Projetos da Lei de Incentivo ao Esporte

## Stack

- **Vite + React 19 + TypeScript** (mesma base do SGE).
- **Tailwind CSS** via CDN (script no `index.html` — não há build CSS local).
- **Firebase**: Auth (e-mail/senha), Firestore (dados), Storage (anexos).
- **React Router DOM v7** (HashRouter).
- **Hospedagem**: Firebase Hosting (subdomínio `projetos.lie.com.br`).
- **Projeto Firebase**: `lie-projetos` (Blaze).

## Estrutura

```
LIE/
├── App.tsx                    # rotas principais
├── index.tsx                  # bootstrap React
├── index.html                 # carrega Tailwind CDN + fontes + tema
├── types.ts                   # modelo de domínio (Projeto, Aporte, Despesa, etc.)
├── lib/firebase.ts            # init do Firebase a partir das VITE_FIREBASE_*
├── contexts/AuthContext.tsx   # provider de autenticação
├── components/Layout.tsx      # header + nav protegida
├── pages/                     # LoginPage, DashboardPage, ProjetosPage…
├── firebase.json              # hosting + firestore + storage
├── firestore.rules            # regras de segurança Firestore
├── storage.rules              # regras de segurança Storage
├── firestore.indexes.json     # índices Firestore
└── .github/workflows/         # CI/CD (production + staging)
```

## Modelo de dados (Firestore)

- `users/{uid}` — perfil do usuário (`admin`, `coordenador`, `captador`, `financeiro`, `beneficiado`, `leitor`).
- `projects/{projectId}` — projeto LIE (proponente, esfera, valor aprovado/captado/executado, status).
  - `projects/{id}/schedule/{itemId}` — cronograma físico-financeiro.
  - `projects/{id}/funding/{entryId}` — aportes/captação.
  - `projects/{id}/expenses/{expenseId}` — despesas.
  - `projects/{id}/beneficiaries/{benefId}` — atletas/alunos beneficiados.
  - `projects/{id}/documents/{docId}` — documentos (planos, ofícios, contratos).
  - `projects/{id}/reports/{reportId}` — relatórios e prestações de contas.
- `activity_logs/{logId}` — auditoria (admin-only para leitura).
- `system_settings/{docId}` — configurações gerais.

## Ambientes e branches

- `main` → produção (`lie-projetos`) → projetos.lie.com.br.
- `homolog` → staging (`lie-stage`, ainda não criado). Crie o projeto Firebase de staging quando precisar.
- Feature branches: `feature/<descricao>` ou `hotfix/<descricao>`.

## Slash commands

- `/iniciar-trabalhos` — checkout `main` + pull antes de começar.
- `/iniciar-teste` — cria branch, commita, manda pra `homolog` (dispara staging).
- `/finalizar-trabalho` — merge da branch atual em `main` (dispara produção).

## Convenções

- Rotas autenticadas envolvidas por `<ProtectedRoutes />` (em `App.tsx`).
- Todos os valores monetários em `number` (centavos não — usar `Number` mesmo, formatar com `toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`).
- Datas em `Timestamp` do Firestore. Use `date-fns` pra formatação na UI.
- IDs gerados pelo Firestore (`doc(collection(db, ...))`), nunca manualmente.
- Mensagens de commit: Conventional Commits em PT-BR (`feat(projeto):`, `fix(despesa):`, etc.).

## Segredos / GitHub Actions

O workflow de deploy lê os seguintes secrets do repo:
- `FIREBASE_TOKEN` — `firebase login:ci` (gere com a conta dona do projeto `lie-projetos`).
- `ENV_PRODUCTION` — conteúdo completo do arquivo `.env` (variáveis `VITE_FIREBASE_*` apontando para `lie-projetos`).
- `ENV_STAGING` — conteúdo do `.env.development` (apontando para `lie-stage` quando criado).

## Observações importantes

- **Nada de mistura com SGE.** Banco, regras e auth são independentes. Não importar tipos/utils do SGE.
- **HashRouter**: a URL fica `projetos.lie.com.br/#/projetos`. Funciona bem em Firebase Hosting sem rewrites complicados.
- **Tailwind via CDN**: prático para o estágio inicial. Se a app crescer e quiser build local, migre depois pra `tailwindcss` + `postcss`.
- **`tsc --noEmit`** roda no CI antes do build — manter type-clean.
