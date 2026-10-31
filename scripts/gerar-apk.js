#!/usr/bin/env node
/*
 * Gera o APK de debug direto no computador.
 *
 * Requer Java 21 e o Android SDK instalados (o que NÃO é necessário quando o
 * APK é compilado pelo GitHub Actions). Se preferir não instalar nada, use o
 * workflow do GitHub: ele gera o APK na nuvem.
 *
 * Uso: npm run android:apk
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RAIZ = path.resolve(__dirname, "..");
const ANDROID = path.join(RAIZ, "android");

function existeSdk() {
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) return true;

  const caminhosPadrao = [
    path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk"),
    path.join(process.env.HOME || "", "Android", "Sdk")
  ];

  return caminhosPadrao.some((caminho) => caminho && fs.existsSync(caminho));
}

function executar(comando, argumentos, pasta) {
  const resultado = spawnSync(comando, argumentos, {
    cwd: pasta,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (resultado.error) throw resultado.error;

  if (resultado.status !== 0) {
    throw new Error(`O comando falhou: ${comando} ${argumentos.join(" ")}`);
  }
}

function principal() {
  if (!existeSdk()) {
    console.error(
      "\n  Android SDK não encontrado neste computador.\n" +
        "  Opção recomendada: envie o projeto para o GitHub e baixe o APK\n" +
        "  gerado pelo workflow 'Android APK' (veja MOBILE.md).\n"
    );
    process.exit(1);
  }

  if (!fs.existsSync(ANDROID)) {
    console.error(
      "\n  Pasta android/ não encontrada. Rode 'npx cap add android' primeiro.\n"
    );
    process.exit(1);
  }

  console.log("Atualizando o conteúdo web...");
  executar("npm", ["run", "build:mobile"], RAIZ);
  executar("npx", ["cap", "sync", "android"], RAIZ);

  console.log("Compilando o APK de debug...");

  const gradle =
    process.platform === "win32"
      ? path.join(ANDROID, "gradlew.bat")
      : path.join(ANDROID, "gradlew");

  if (process.platform !== "win32") {
    fs.chmodSync(gradle, 0o755);
  }

  executar(gradle, ["assembleDebug", "--no-daemon"], ANDROID);

  const apk = path.join(
    ANDROID,
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk"
  );

  if (!fs.existsSync(apk)) {
    console.error("\n  O Gradle terminou, mas o APK não foi encontrado.\n");
    process.exit(1);
  }

  const tamanho = (fs.statSync(apk).size / (1024 * 1024)).toFixed(1);

  console.log(`\n  APK gerado: ${apk} (${tamanho} MB)\n`);
}

try {
  principal();
} catch (erro) {
  console.error(`\n  ERRO: ${erro.message}\n`);
  process.exit(1);
}
