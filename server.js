/*
 * Servidor do MedLembre para uso no navegador.
 *
 * Serve apenas os arquivos do aplicativo (lista explícita) e faz o proxy da
 * API de medicamentos, mantendo a chave no servidor.
 *
 * O APK Android não usa este arquivo: lá o app chama a API diretamente.
 */

const express = require("express");
const dotenv = require("dotenv");
const path = require("node:path");

dotenv.config();

const app = express();
const PORTA = Number(process.env.PORT) || 3000;
const RAIZ = __dirname;

const API = "https://medicamentos.api.br/api/v1";
const CHAVE = String(process.env.MEDICAMENTOS_API_KEY || "").trim();

const ESTATICOS = new Set([
  "index.html",
  "painel.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/config.js",
  "js/nativo.js",
  "js/armazenamento.js",
  "js/api.js",
  "js/notificacoes.js",
  "js/script.js",
  "js/painel.js"
]);

const ICONES = new Set([
  "assets/icons/favicon-32.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-512-maskable.png"
]);

/* ----------------------------- segurança -------------------------------- */

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' https://www.gstatic.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com https://*.firebaseio.com",
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://apis.google.com",
  "form-action 'self'"
].join("; ");

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });

  next();
});

/* --------------------------- arquivos estáticos -------------------------- */

function caminhoSeguro(url) {
  let decodificado;

  try {
    decodificado = decodeURIComponent(url);
  } catch (erro) {
    return null;
  }

  if (decodificado.includes("\0")) return null;

  const normalizado = path.posix
    .normalize(decodificado)
    .replace(/^\/+/, "");

  if (!normalizado || normalizado === "." || normalizado.startsWith("..")) {
    return null;
  }

  return normalizado;
}

app.get("/", (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(RAIZ, "index.html"));
});

app.get("/painel", (req, res) => {
  res.redirect(302, "/painel.html");
});

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const caminho = caminhoSeguro(req.path);

  if (!caminho) {
    res.status(400).type("text").send("Requisição inválida.");
    return;
  }

  if (!ESTATICOS.has(caminho) && !ICONES.has(caminho)) {
    next();
    return;
  }

  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(RAIZ, caminho), { dotfiles: "deny" }, (erro) => {
    if (erro) next(erro);
  });
});

/* ------------------------------- API ------------------------------------- */

function responderErroApi(res, status, mensagem) {
  res.status(status).json({ erro: mensagem });
}

function validarChave(res) {
  if (CHAVE) return true;

  responderErroApi(
    res,
    500,
    "A chave da API não está configurada no servidor. Crie o arquivo .env com MEDICAMENTOS_API_KEY."
  );

  return false;
}

app.get("/api/medicamentos", async (req, res) => {
  const nome = String(req.query.nome || "").trim();
  const pagina = Number(req.query.pagina || 1);

  if (nome.length < 2 || nome.length > 100) {
    responderErroApi(res, 400, "Digite um nome de medicamento válido.");
    return;
  }

  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100) {
    responderErroApi(res, 400, "Página de pesquisa inválida.");
    return;
  }

  if (!validarChave(res)) return;

  const url = new URL(`${API}/medicamentos`);
  url.searchParams.set("nome", nome);
  url.searchParams.set("pagina", String(pagina));

  try {
    const resposta = await fetch(url, {
      headers: { "X-API-Key": CHAVE, Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!resposta.ok) {
      responderErroApi(
        res,
        502,
        "Não foi possível consultar a base de medicamentos."
      );
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(await resposta.json());
  } catch (erro) {
    console.error("Falha na consulta:", erro.message);
    responderErroApi(res, 502, "Erro de conexão com a API de medicamentos.");
  }
});

app.get("/api/medicamentos/:registro", async (req, res) => {
  const registro = String(req.params.registro || "").trim();

  if (!/^\d{9}$/.test(registro)) {
    responderErroApi(res, 400, "Registro Anvisa inválido.");
    return;
  }

  if (!validarChave(res)) return;

  try {
    const resposta = await fetch(`${API}/medicamentos/${registro}`, {
      headers: { "X-API-Key": CHAVE, Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!resposta.ok) {
      responderErroApi(
        res,
        502,
        "Não foi possível consultar os detalhes do medicamento."
      );
      return;
    }

    const dados = await resposta.json();

    const apresentacoes = Array.isArray(dados.cmed?.apresentacoes)
      ? dados.cmed.apresentacoes.map((item) => ({
          codigo: item.codigoGgrem,
          descricao: item.apresentacao,
          ean: item.ean || []
        }))
      : [];

    res.set("Cache-Control", "no-store");
    res.json({
      registro: dados.registro,
      nome: dados.nome,
      fabricante: dados.fabricante,
      principioAtivo: dados.principioAtivo,
      apresentacoes
    });
  } catch (erro) {
    console.error("Erro ao consultar detalhes:", erro.message);
    responderErroApi(
      res,
      502,
      "Erro de conexão ao consultar o medicamento."
    );
  }
});

/* ------------------- diagnóstico temporário de login --------------------- */
/*
 * O login no celular é difícil de investigar sem ver a tela do aparelho.
 * O app envia para o servidor apenas o código do erro e o navegador usado —
 * nunca e-mail, senha ou token. O registro fica em logs/login.log e pode ser
 * removido quando o problema estiver resolvido.
 */

const fs = require("node:fs");
const LOG_DIAGNOSTICO = path.join(RAIZ, "logs", "login.log");

app.post(
  "/diagnostico/login",
  express.json({ limit: "8kb" }),
  (req, res) => {
    const dados = req.body || {};
    const linha = JSON.stringify({
      quando: new Date().toISOString(),
      etapa: String(dados.etapa || "").slice(0, 80),
      codigo: String(dados.codigo || "").slice(0, 120),
      mensagem: String(dados.mensagem || "").slice(0, 300),
      agente: String(dados.agente || "").slice(0, 300)
    });

    try {
      fs.mkdirSync(path.dirname(LOG_DIAGNOSTICO), { recursive: true });
      fs.appendFileSync(LOG_DIAGNOSTICO, linha + "\n", "utf8");
    } catch (erro) {
      console.warn("Não foi possível gravar o diagnóstico:", erro.message);
    }

    console.log("[diagnóstico]", linha);
    res.status(204).end();
  }
);

/* ------------------------------ 404 / erro ------------------------------- */

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    responderErroApi(res, 404, "Rota não encontrada.");
    return;
  }

  res
    .status(404)
    .type("html")
    .send(
      '<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8">' +
        "<title>Página não encontrada</title>" +
        '<body style="font-family:system-ui;padding:32px">' +
        "<h1>404</h1><p>Página não encontrada.</p>" +
        '<p><a href="/">Voltar para o MedLembre</a></p>'
    );
});

app.use((erro, req, res, _next) => {
  console.error("Erro inesperado:", erro);

  if (req.path.startsWith("/api/")) {
    responderErroApi(res, 500, "Erro interno no servidor.");
    return;
  }

  res.status(500).type("text").send("Erro interno no servidor.");
});

/* ------------------------------- inicialização --------------------------- */

if (require.main === module) {
  app.listen(PORTA, () => {
    console.log(`MedLembre funcionando em http://localhost:${PORTA}`);

    if (!CHAVE) {
      console.warn(
        "Aviso: MEDICAMENTOS_API_KEY não configurada. A busca ficará indisponível."
      );
    }
  });
}

module.exports = app;
