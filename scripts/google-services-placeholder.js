#!/usr/bin/env node
/*
 * Prepara o android/app/google-services.json antes do build do APK.
 *
 * 1. Se a variável GOOGLE_SERVICES_JSON existir (secret do GitHub Actions),
 *    grava o conteúdo no lugar certo.
 * 2. Se o arquivo já existir (configuração local), mantém.
 * 3. Caso contrário, cria um arquivo de exemplo válido para o build não
 *    falhar. Nesse caso o login com Google não funciona no APK, mas e-mail e
 *    senha continuam funcionando.
 *
 * Uso: node scripts/google-services-placeholder.js
 */

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const DESTINO = path.join(RAIZ, "android", "app", "google-services.json");

const APP_ID = "br.com.medlembre.app";
const PROJETO = "medlembre-b0267";

const PLACEHOLDER = {
  project_info: {
    project_number: "67386414641",
    project_id: PROJETO,
    storage_bucket: `${PROJETO}.firebasestorage.app`
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: "1:67386414641:android:0000000000000000000000",
        android_client_info: {
          package_name: APP_ID
        }
      },
      oauth_client: [
        {
          client_id:
            "000000000000-00000000000000000000000000000000.apps.googleusercontent.com",
          client_type: 3
        }
      ],
      api_key: [
        {
          current_key: "AIzaSyPLACEHOLDER-NAO-USE-ESTE-APK-PARA-GOOGLE"
        }
      ],
      services: {
        appinvite_service: {
          other_platform_oauth_client: []
        }
      }
    }
  ],
  configuration_version: "1"
};

function validar(conteudo) {
  let dados;

  try {
    dados = JSON.parse(conteudo);
  } catch (erro) {
    throw new Error(
      "GOOGLE_SERVICES_JSON não é um JSON válido. " +
        "Copie o arquivo inteiro baixado do Firebase Console."
    );
  }

  const clientes = Array.isArray(dados.client) ? dados.client : [];
  const pacotes = clientes
    .map((cliente) => cliente?.client_info?.android_client_info?.package_name)
    .filter(Boolean);

  if (pacotes.length && !pacotes.includes(APP_ID)) {
    throw new Error(
      `O google-services.json não contém o pacote ${APP_ID}.\n` +
        "No Firebase Console, adicione um app Android com esse nome de pacote " +
        "e baixe o arquivo novamente."
    );
  }

  return dados;
}

function principal() {
  const pastaAndroid = path.join(RAIZ, "android");

  if (!fs.existsSync(pastaAndroid)) {
    console.log(
      "Pasta android/ não encontrada. Rode 'npx cap add android' primeiro."
    );
    return;
  }

  const secreto = String(process.env.GOOGLE_SERVICES_JSON || "").trim();

  if (secreto) {
    const dados = validar(secreto);

    fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
    fs.writeFileSync(
      DESTINO,
      `${JSON.stringify(dados, null, 2)}\n`,
      "utf8"
    );

    console.log("google-services.json criado a partir do secret do GitHub.");
    return;
  }

  if (fs.existsSync(DESTINO)) {
    console.log("google-services.json já existe; mantendo o arquivo atual.");
    return;
  }

  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(
    DESTINO,
    `${JSON.stringify(PLACEHOLDER, null, 2)}\n`,
    "utf8"
  );

  console.warn(
    "\n  ATENÇÃO: google-services.json de exemplo criado.\n" +
      "  O APK compila e o login por e-mail funciona, mas o login com Google\n" +
      "  só funcionará depois de configurar o Firebase (veja MOBILE.md) ou\n" +
      "  cadastrar o secret GOOGLE_SERVICES_JSON no GitHub.\n"
  );
}

try {
  principal();
} catch (erro) {
  console.error(`\n  ERRO: ${erro.message}\n`);
  process.exit(1);
}
