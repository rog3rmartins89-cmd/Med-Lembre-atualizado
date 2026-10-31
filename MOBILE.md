# MedLembre no Android (APK)

Este guia explica como gerar, instalar e configurar o APK do MedLembre **sem instalar Android Studio, Java ou o SDK do Android no seu computador**. A compilação acontece na nuvem, pelo GitHub Actions.

## 1. O que já está pronto

- Aplicativo Android nativo (Capacitor 8) com o mesmo visual e as mesmas funções do site: login com Google e com e-mail/senha, painel, cadastro e busca de medicamentos, frequência, histórico, edição/exclusão, tema claro/escuro, alto contraste, tamanho de fonte, logout e SAMU.
- Busca de medicamentos feita **direto do celular** pela API oficial. O APK não depende do `server.js` nem do seu computador.
- Lembretes por **notificação local do Android**, que funcionam com o aplicativo fechado.
- Ícone, tela de abertura e permissões configurados.
- Compilação automática em `.github/workflows/android.yml`.

## 2. Baixar o APK (compilação na nuvem)

1. Envie o projeto para o GitHub (veja o passo 3).
2. No repositório, abra **Actions** e entre na execução **Android APK**.
3. Aguarde o término e baixe o arquivo em **Artifacts > MedLembre-apk**.
4. No celular, abra o `.apk` baixado e permita a instalação de fontes desconhecidas quando o Android pedir.

O APK gerado é de **debug**, assinado com a chave de debug do GitHub Actions. Ele serve para instalar e testar no celular; não é publicado na Play Store.

> O workflow guarda a chave de debug em cache. Assim o SHA-1 não muda entre compilações, o que evita ter de recadastrar a impressão digital no Firebase a cada build.

## 3. Enviar o projeto para o GitHub

O repositório já configurado é `camilasantos1989/MedHora`.

Pelo VS Code (recomendado):

1. Abra a aba **Source Control**.
2. Confirme as alterações e clique em **Commit**.
3. Clique em **Sync Changes** / **Push**.

Ou pelo terminal:

```powershell
git add -A
git commit -m "Versao Android com Capacitor"
git push
```

Se o Git pedir login, use o GitHub Desktop ou o próprio VS Code.

## 4. Configurar a chave da API de medicamentos

A busca usa a API `https://medicamentos.api.br`, que exige uma chave (`X-API-Key`). Ela já está no seu `.env` local, mas o GitHub não envia esse arquivo (ele é privado).

1. No GitHub, abra **Settings > Secrets and variables > Actions**.
2. Clique em **New repository secret**.
3. Nome: `MEDICAMENTOS_API_KEY`
4. Valor: a chave que está em `MEDICAMENTOS_API_KEY` no arquivo `.env`.
5. Salve e rode o workflow novamente.

Sem esse secret o APK ainda abre e o login funciona, mas a busca de medicamentos mostra uma mensagem de aviso.

## 5. Configurar o login com Google (opcional)

O login por **e-mail e senha funciona sem nenhuma configuração extra**. Para o botão **Entrar com Google** funcionar no APK, o Firebase precisa conhecer o aplicativo Android e a assinatura do APK.

### 5.1 Cadastrar o app Android no Firebase

1. Abra o [Firebase Console](https://console.firebase.google.com/) no projeto `medlembre-b0267`.
2. Vá em **Configurações do projeto > Seus apps > Adicionar app > Android**.
3. Nome do pacote: `br.com.medlembre.app`
4. Apelido: `MedLembre Android` (pode ser qualquer nome).
5. Em **SHA-1**, cole a impressão digital do APK. Você encontra o valor em dois lugares:
   - no resumo da execução do workflow, na seção **SHA-1 do keystore de debug**;
   - no arquivo `SHA1.txt` que vem dentro do artifact `MedLembre-apk`.
6. Conclua o cadastro **com o SHA-1 já preenchido**.
7. Só depois baixe o `google-services.json` (veja 5.3).

> O SHA-1 é o mesmo em todas as compilações do GitHub Actions porque a chave de debug fica guardada no cache do workflow.
>
> Se você gerar o APK localmente (`npm run android:apk`), o SHA-1 é o do seu computador. Para obter:
> `keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android`

### 5.2 Ativar o provedor Google

1. No Firebase, abra **Authentication > Sign-in method**.
2. Ative **Google**.
3. Em **Domínios autorizados**, confira se `medlembre-b0267.firebaseapp.com` e `localhost` estão na lista (o login do site depende disso).

### 5.3 Enviar o `google-services.json` para o GitHub

1. Baixe o `google-services.json` **depois** de cadastrar o app Android com o SHA-1 (passo 5.1).
2. Abra o arquivo em um editor de texto e confira se existe um bloco `client_info` com `package_name` = `br.com.medlembre.app` e uma lista `oauth_client` com `client_type: 3`. Se não existir, o SHA-1 não foi salvo: cadastre de novo e baixe o arquivo outra vez.
3. Copie **todo** o conteúdo do arquivo.
4. No GitHub, crie um secret chamado `GOOGLE_SERVICES_JSON` com esse conteúdo.
5. Rode o workflow novamente e instale o APK novo.

O build aplica esse arquivo automaticamente. Se o secret não existir, o workflow cria um arquivo de exemplo válido: o APK compila e o login por e-mail funciona; o login Google mostra uma mensagem amigável.

> Depois de trocar o `google-services.json` ou o SHA-1 no Firebase, aguarde alguns minutos e gere o APK de novo. O arquivo antigo não serve.

### 5.4 Erros comuns no login Google

| Mensagem | Causa provável | Solução |
| --- | --- | --- |
| `DEVELOPER_ERROR` / código 10 | SHA-1 ou pacote diferente do cadastrado | Confira `br.com.medlembre.app` e o SHA-1 do build |
| `O login com Google não está configurado neste APK` | `google-services.json` de exemplo ou sem o app Android | Cadastre o app com SHA-1 e crie o secret `GOOGLE_SERVICES_JSON` |
| `Não foi possível entrar com o Google` | Provedor Google desativado | Ative em **Authentication > Sign-in method** |
| `Este endereço não está autorizado no Firebase` | O domínio aberto no navegador não está na lista de domínios autorizados | Adicione o domínio em **Authentication > Settings > Authorized domains** |
| Login funciona no site, mas não no APK | `google-services.json` ausente ou de outro projeto | Atualize o secret `GOOGLE_SERVICES_JSON` |
| “App não instalado” ao atualizar | APK antigo assinado com outra chave | Desinstale o MedLembre e instale o APK novo |

## 6. Primeiro uso no celular

1. Abra o MedLembre e entre com e-mail/senha ou Google.
2. Toque em **Ativar lembretes** e permita **notificações**.
3. Em Android 12 ou superior, permita também **alarmes e lembretes** quando o sistema pedir. Isso garante o aviso no horário exato.
4. Em alguns aparelhos (Xiaomi, Samsung, Motorola), desative a otimização de bateria para o MedLembre em **Configurações > Bateria**. Sem isso o Android pode atrasar notificações.
5. Cadastre um medicamento, escolha a frequência e confirme com **Já tomei** para testar o histórico.

## 7. Rodar no computador (site)

```powershell
npm install
npm start
```

Abra `http://localhost:3000`. Nesse modo a busca passa pelo proxy do `server.js`, que lê a chave do `.env`.

### 7.1 Abrir no celular por um link temporário

O jeito mais rápido de testar no celular sem gerar APK é expor o computador com um túnel:

```powershell
node server.js
npx cloudflared tunnel --url http://localhost:3000
```

O comando mostra um endereço `https://algo.trycloudflare.com`. Para o login Google funcionar nesse endereço, ele **precisa** ser cadastrado antes em **Authentication > Settings > Authorized domains**. Sem isso aparece `auth/unauthorized-domain`.

> Cada vez que o túnel é reiniciado o endereço muda e precisa ser autorizado de novo. Para uso diário, prefira o APK.

## 8. Compilar o APK no computador (opcional)

Requer Java 21 e Android SDK instalados:

```powershell
npm run android:apk
```

O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`.

Sem o SDK, use o GitHub Actions (passo 2).

## 9. Atualizar o aplicativo

1. Depois de mudar o site, rode `npm run sync` para copiar o conteúdo para o Android.
2. No GitHub, faça commit e push. O workflow gera um novo APK.
3. Para trocar a versão exibida, edite `android/app/build.gradle`:

```gradle
versionCode 2
versionName "2.1"
```

O `versionCode` precisa aumentar a cada nova versão instalada por cima da anterior.

## 10. Segurança e arquivos importantes

- `.env` contém a chave da API e **não** é enviado ao GitHub.
- `build/` é gerado automaticamente e também não é versionado.
- A chave da API é gravada em `build/js/config.js` e fica dentro do APK. Isso é inevitável em aplicativos que chamam a API diretamente; não use uma chave com permissões administrativas.
- `android/app/google-services.json` não é versionado. O workflow o recria a partir do secret.
- `server.js` serve apenas o site no navegador; o APK não o utiliza.

## 11. Estrutura do projeto

```
index.html / painel.html     telas do site e do app
css/style.css                layout mobile-first e temas
js/script.js                 login e cadastro
js/painel.js                 painel, medicamentos e histórico
js/armazenamento.js          dados no aparelho (localStorage)
js/api.js                    busca na API (proxy no site, CapacitorHttp no APK)
js/notificacoes.js           lembretes nativos e do navegador
js/nativo.js                 ponte com os plugins do Capacitor
scripts/build-mobile.js      monta a pasta build/ com a chave da API
scripts/gerar-icones.js      gera ícones e splash sem dependências
scripts/google-services-placeholder.js  prepara o google-services.json
android/                     projeto Android gerado pelo Capacitor
.github/workflows/android.yml           compilação do APK na nuvem
```
