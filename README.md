# LIE — Gestão de Projetos da Lei de Incentivo ao Esporte

Aplicação web para gestão de projetos aprovados pela LIE (federal, estadual ou municipal): cronograma físico-financeiro, captação, despesas, beneficiários, documentos e relatórios/prestação de contas.

## Stack

Vite + React 19 + TypeScript · Tailwind (CDN) · Firebase (Auth + Firestore + Storage) · React Router DOM 7 · GitHub Actions.

## Setup local

```bash
# 1) instalar dependências
npm install

# 2) configurar variáveis de ambiente
cp .env.exemple .env
# preencha .env com os valores do projeto Firebase lie-projetos:
#   apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId

# 3) rodar em dev
npm run dev
# abre em http://localhost:3001
```

## Credenciais Firebase atuais (lie-projetos)

```
apiKey: AIzaSyAEg1oLEe8FtqbKdC77JB71OWEGgoakf5s
authDomain: lie-projetos.firebaseapp.com
projectId: lie-projetos
storageBucket: lie-projetos.firebasestorage.app
messagingSenderId: 988020603329
appId: 1:988020603329:web:942327c64db8f127159740
```

## Estrutura

Veja [CLAUDE.md](./CLAUDE.md) — descreve stack, branches, modelo de dados, slash commands e convenções.

## Deploy

- Push em `homolog` → deploy automático em staging (projeto Firebase `lie-stage`, ainda a criar).
- Push em `main` → deploy automático em produção (projeto Firebase `lie-projetos`, subdomínio `projetos.lie.com.br`).

Workflows em `.github/workflows/`. Secrets necessários no repositório:

- `FIREBASE_TOKEN` (gere com `firebase login:ci`).
- `ENV_PRODUCTION` (conteúdo do `.env` para produção).
- `ENV_STAGING` (conteúdo do `.env.development` para staging).

## Próximos passos (setup inicial)

Veja a seção **"O que falta para ir pra produção"** no final do CLAUDE.md ou consulte o autor.

## Licença

Privado — uso interno.
