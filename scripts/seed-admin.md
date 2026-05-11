# Criar primeiro usuário admin

O sistema exige um documento em `users/{uid}` com `role: 'admin'` para que o usuário consiga fazer tudo. Como o LIE ainda não tem tela de cadastro, o primeiro admin é criado manualmente.

## Opção A — Console do Firebase (mais simples)

1. Acesse o [Firebase Console](https://console.firebase.google.com/project/lie-projetos).
2. **Authentication → Users → Add user**: e-mail + senha. Copie o **UID** gerado.
3. **Firestore Database → Start collection** `users`, document ID = **UID** copiado.
   Campos:
   ```
   email      (string)  → mesmo e-mail acima
   nome       (string)  → seu nome
   role       (string)  → "admin"
   ativo      (boolean) → true
   criadoEm   (timestamp) → agora
   ```
4. Pronto. Faça login na app com esse e-mail/senha.

## Opção B — Script Node (`firebase-admin`)

Use quando quiser criar vários usuários de uma vez.

```bash
npm install firebase-admin --save-dev
```

Coloque a chave de serviço (Service Account JSON) em `chave-prod.json` (já está no `.gitignore`).

```js
// scripts/create-admin.mjs
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('./chave-prod.json', 'utf-8'));
admin.initializeApp({ credential: admin.credential.cert(sa) });

const EMAIL = 'luiz@exemplo.com';
const SENHA = 'TROCAR-ESTA-SENHA';

const user = await admin.auth().createUser({ email: EMAIL, password: SENHA });
await admin.firestore().collection('users').doc(user.uid).set({
  email: EMAIL,
  nome: 'Luiz Delphino',
  role: 'admin',
  ativo: true,
  criadoEm: admin.firestore.FieldValue.serverTimestamp(),
});
console.log('Admin criado:', user.uid);
process.exit(0);
```

Rodar: `node scripts/create-admin.mjs`.

> **Lembre de deletar** `chave-prod.json` depois (já é ignorado, mas não vacile).
