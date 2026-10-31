# MedLembre

Lembrete de medicamentos com login, histórico, acessibilidade e aplicativo Android.

## Site (navegador)

```powershell
npm install
npm start
```

Acesse `http://localhost:3000`. A busca de medicamentos usa o proxy do `server.js`; a chave fica no arquivo `.env`.

## APK Android

O guia completo está em **[MOBILE.md](MOBILE.md)**: como baixar o APK pelo GitHub Actions, configurar a chave da API, o login com Google e instalar no celular.

Resumo:

1. Envie o projeto para o GitHub.
2. Cadastre o secret `MEDICAMENTOS_API_KEY`.
3. Abra **Actions > Android APK** e baixe o APK em **Artifacts**.

## Funcionalidades

- Login com Google e com e-mail/senha (Firebase).
- Busca de medicamentos na base oficial da Anvisa.
- Cadastro com apresentação, quantidade, horário e frequência.
- Histórico de doses com confirmação em “Já tomei”.
- Edição e exclusão de medicamentos e de registros do histórico.
- Lembretes com notificação local no Android (funcionam com o app fechado).
- Tema claro/escuro, alto contraste e tamanho de fonte.
- Botão de emergência para o SAMU (192).

## Estrutura

- `index.html`, `painel.html`, `css/`, `js/` — aplicação web.
- `android/` — projeto Android (Capacitor).
- `scripts/` — build mobile, ícones e preparação do Firebase.
- `.github/workflows/android.yml` — compilação do APK na nuvem.

## Licença

ISC.
