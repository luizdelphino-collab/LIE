# Onboarding — colaboradores do LIE

Este doc é a fonte oficial pra novos devs / colaboradores entrarem no projeto LIE (Sistema de Gestão de Projetos da Lei de Incentivo ao Esporte).

## 1. Acessos necessários

Antes de tudo, garanta que recebeu:

- [ ] **GitHub**: convite de colaboração no repo `luizdelphino-collab/LIE` (aceitar no e-mail).
- [ ] **Firebase Console**: convite via "Usuários e permissões" do projeto `lie-projetos`.
- [ ] **Conta no Firebase Auth** da app: usuário `pereirarfms@gmail.com` (ou seu e-mail) com senha provisória — troque no 1º login.
- [ ] **Arquivo `.env`**: enviado por canal seguro (PrivateBin/Bitwarden Send/Drive privado). NUNCA comite no repo.

## 2. Setup local

Pré-requisitos:
- Node.js **20+** (https://nodejs.org)
- Git
- IDE/agent de preferência: Antigravity, Cursor, Claude Code, VS Code, etc.

```bash
# 1) clone
git clone https://github.com/luizdelphino-collab/LIE.git
cd LIE

# 2) variáveis de ambiente
cp .env.exemple .env
# edite .env e cole o conteúdo do envelope seguro

# 3) deps
npm install

# 4) dev server
npm run dev
# abre http://localhost:3001
```

## 3. Convenções

Leia o `CLAUDE.md` na raiz — descreve stack, modelo de dados (Firestore), perfis de acesso e estrutura de pastas. Resumo rápido:

- **Stack**: Vite + React 19 + TypeScript + Tailwind (CDN) + Firebase.
- **Roteador**: HashRouter (`projetos.lie.com.br/#/projetos`).
- **Estado de auth**: `contexts/AuthContext.tsx` (provider envolve toda a app autenticada).
- **Datas**: `Timestamp` do Firestore, formatar com `date-fns`.
- **Moeda**: `number` em reais, formatar com `toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **Perfis**: `admin`, `coordenador`, `captador`, `financeiro`, `beneficiado`, `leitor` (ver `types.ts`).

## 4. Fluxo de trabalho

### Branches

- `main` → produção (deploy automático em `projetos.lie.com.br`).
- `homolog` → staging (deploy automático em projeto `lie-stage`, ainda a criar).
- Feature/fix branches: `feature/<descricao-curta>` ou `hotfix/<descricao-curta>`.

### Regra de ouro

⚠️ **NUNCA dar push direto em `main`.** Sempre via Pull Request.

Tecnicamente o GitHub não bloqueia push direto (limitação de plano free em repo privado pessoal), mas é convenção firme do time:

1. Cria branch nova: `git checkout -b feature/minha-feature`
2. Faz commits seguindo Conventional Commits em PT-BR: `feat(projeto): adicionar exportação de despesas`, `fix(captacao): corrigir cálculo de valor pendente`, etc.
3. Push: `git push -u origin feature/minha-feature`
4. Abre PR no GitHub pra `main`, marca Luiz como reviewer.
5. Aguarda aprovação. Pode ajustar com novos commits — o PR atualiza sozinho.
6. Luiz faz **Squash and merge** (ou **Merge commit**, dependendo do caso).
7. GitHub Actions roda automaticamente o deploy em produção.

### Commits

- Padrão **Conventional Commits** em PT-BR.
- Exemplos:
  - `feat(despesas): adicionar filtro por categoria`
  - `fix(login): corrigir mensagem de erro com credencial inválida`
  - `refactor(dashboard): extrair card de estatística para componente`
  - `docs(readme): atualizar instruções de setup`
  - `chore(deps): atualizar firebase para 12.8.0`
- 1ª linha curta (até ~70 chars). Corpo opcional explicando o porquê.

## 5. Slash commands (Claude Code)

Se você usa **Claude Code**, há 3 comandos prontos em `.claude/commands/`:

- `/iniciar-trabalhos` — checkout main + pull antes de começar.
- `/iniciar-teste` — cria branch, commita, manda pra homolog (staging).
- `/finalizar-trabalho` — merge da branch atual em main (produção).

Se usa outro agent (Antigravity, Cursor) os arquivos `.md` viram apenas documentação. Você pode rodar os passos manualmente seguindo o conteúdo deles.

## 6. Modelo de dados (Firestore)

Coleções principais (ver detalhes em `types.ts` e `firestore.rules`):

```
users/{uid}              → perfil do usuário
projects/{projectId}     → projeto LIE (esfera, valor aprovado, status…)
  ├── schedule/          → cronograma físico-financeiro
  ├── funding/           → aportes/captação
  ├── expenses/          → despesas
  ├── beneficiaries/     → atletas/alunos beneficiados
  ├── documents/         → planos, ofícios, contratos
  └── reports/           → relatórios e prestações de contas
activity_logs/{logId}    → auditoria (admin-only read)
system_settings/{docId}  → configs gerais
```

## 7. Deploy

Não precisa rodar `firebase deploy` localmente — o GitHub Actions cuida:

- Merge em `main` → workflow `deploy-production.yml` → `projetos.lie.com.br`.
- Merge em `homolog` → workflow `deploy-staging.yml` → `lie-stage` (quando o projeto de staging for criado).

Acompanhe em: https://github.com/luizdelphino-collab/LIE/actions

## 8. Segurança

❌ **NUNCA commite**:
- `.env` ou qualquer credencial real
- `chave-prod.json`, `serviceAccountKey.json`, qualquer JSON de service account
- Senhas, tokens, API keys de produção

Se commitar por engano, **não tente "limpar" com um novo commit** — o segredo fica no histórico. Chame o Luiz imediatamente pra invalidar a credencial e fazer um rewrite do histórico (`git filter-repo`).

## 9. Suporte

Qualquer dúvida → WhatsApp do Luiz ou PR/Issue no GitHub.
