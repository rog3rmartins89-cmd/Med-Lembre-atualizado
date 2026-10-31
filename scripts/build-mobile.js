#!/usr/bin/env node
/*
 * Monta a pasta build/, que é o conteúdo web empacotado no APK pelo Capacitor.
 *
 * - copia somente os arquivos usados pelo aplicativo;
 * - gera build/js/config.js com a chave da API de medicamentos;
 * - limpa a pasta antes de cada build.
 *
 * A chave é lida da variável de ambiente MEDICAMENTOS_API_KEY ou do arquivo
 * .env na raiz do projeto. Ela nunca é copiada para o código-fonte.
 */

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const DESTINO = path.join(RAIZ, "build");

const ARQUIVOS = [
  "index.html",
  "painel.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/nativo.js",
  "js/armazenamento.js",
  "js/api.js",
  "js/notificacoes.js",
  "js/script.js",
  "js/painel.js"
];

const PASTAS = ["assets/icons"];

const API_BASE = "https://medicamentos.api.br/api/v1";

/* ------------------------------- utilidades ------------------------------ */

function lerEnv() {
  const caminho = path.join(RAIZ, ".env");

  if (!fs.existsSync(caminho)) return;

  const conteudo = fs.readFileSync(caminho, "utf8");

  for (const linha of conteudo.split(/\r?\n/)) {
    const texto = linha.trim();

    if (!texto || texto.startsWith("#")) continue;

    const separador = texto.indexOf("=");

    if (separador <= 0) continue;

    const chave = texto.slice(0, separador).trim();
    let valor = texto.slice(separador + 1).trim();

    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

function copiar(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
}

function copiarPasta(relativa) {
  const origem = path.join(RAIZ, relativa);

  if (!fs.existsSync(origem)) {
    console.warn(`  aviso: pasta ignorada (não existe): ${relativa}`);
    return;
  }

  for (const entrada of fs.readdirSync(origem, { withFileTypes: true })) {
    const caminhoRelativo = path.posix.join(relativa, entrada.name);

    if (entrada.isDirectory()) {
      copiarPasta(caminhoRelativo);
    } else {
      copiar(
        path.join(RAIZ, caminhoRelativo),
        path.join(DESTINO, caminhoRelativo)
      );
    }
  }
}

/* --------------------------------- build --------------------------------- */

console.log("Montando a versão mobile em build/ ...");

lerEnv();

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });

for (const relativo of ARQUIVOS) {
  const origem = path.join(RAIZ, relativo);

  if (!fs.existsSync(origem)) {
    console.error(`  erro: arquivo obrigatório não encontrado: ${relativo}`);
    process.exitCode = 1;
    continue;
  }

  copiar(origem, path.join(DESTINO, relativo));
  console.log(`  + ${relativo}`);
}

for (const pasta of PASTAS) {
  copiarPasta(pasta);
  console.log(`  + ${pasta}/`);
}

const apiKey = String(process.env.MEDICAMENTOS_API_KEY || "").trim();

if (!apiKey) {
  console.warn(
    "\n  ATENÇÃO: MEDICAMENTOS_API_KEY não encontrada.\n" +
      "  O app vai abrir e funcionar, mas a busca de medicamentos ficará\n" +
      "  indisponível até a chave ser configurada (arquivo .env ou secret\n" +
      "  no GitHub Actions).\n"
  );
}

const configuracao = `/*
 * Arquivo gerado automaticamente por scripts/build-mobile.js.
 * Não edite o conteúdo de build/: ele é refeito a cada build.
 */
window.MEDLEMBRE_CONFIG = {
  apiKey: ${JSON.stringify(apiKey)},
  apiBase: ${JSON.stringify(API_BASE)}
};
`;

fs.writeFileSync(path.join(DESTINO, "js", "config.js"), configuracao, "utf8");
console.log("  + js/config.js (gerado)");

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  `\nBuild concluído: ${fs
    .readdirSync(DESTINO)
    .filter((item) => fs.statSync(path.join(DESTINO, item)).isFile())
    .length} arquivos na raiz e pastas auxiliares.`
);
