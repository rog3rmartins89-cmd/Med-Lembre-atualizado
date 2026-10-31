/*
 * MedLembre - autenticação (login, cadastro e Google).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import { isNativo, chamarNativo } from "./nativo.js";

const firebaseConfig = {
  apiKey: "AIzaSyAZtDFkleYZrh5coDVfpLyNniU5cBxqWro",
  authDomain: "medlembre-b0267.firebaseapp.com",
  projectId: "medlembre-b0267",
  storageBucket: "medlembre-b0267.firebasestorage.app",
  messagingSenderId: "67386414641",
  appId: "1:67386414641:web:4750920b90539b9ce4a710",
  measurementId: "G-1LN9N8LSND"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provedorGoogle = new GoogleAuthProvider();

const persistencia = setPersistence(auth, browserLocalPersistence).catch(
  (erro) => {
    console.warn("Não foi possível manter a sessão:", erro);
  }
);

/*
 * O Google devolve o nome dentro do ID token (campo "name"). Lemos o token
 * para garantir que o painel mostre o nome da conta mesmo quando o Firebase
 * não preenche displayName sozinho (é o que acontece no login nativo do APK).
 */
function nomeDoIdToken(idToken) {
  try {
    const partes = String(idToken || "").split(".");
    if (partes.length < 2) return "";

    let base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    base64 += "=".repeat((4 - (base64.length % 4)) % 4);

    const bytes = Uint8Array.from(atob(base64), (letra) =>
      letra.charCodeAt(0)
    );
    const dados = JSON.parse(new TextDecoder().decode(bytes));

    return String(dados.name || "").trim();
  } catch (erro) {
    return "";
  }
}

/*
 * iPhone/iPad (inclusive Safari e Chrome no iOS) bloqueiam pop-up com muita
 * frequência, então nesses aparelhos usamos redirecionamento. No Android o
 * pop-up funciona melhor porque o retorno é imediato.
 */
function usarRedirecionamento() {
  const agente = navigator.userAgent || "";

  return /iPhone|iPad|iPod/i.test(agente);
}

const formCadastro = document.getElementById("formCadastro");
const btnGoogle = document.getElementById("btnGoogle");
const mensagem = document.getElementById("mensagemLogin");

const campoNome = document.getElementById("nomeCompleto");
const campoEmail = document.getElementById("email");
const campoSenha = document.getElementById("senha");
const campoConfirmar = document.getElementById("confirmarSenha");

const grupoNome = document.getElementById("grupoNome");
const grupoConfirmarSenha = document.getElementById("grupoConfirmarSenha");

const btnCadastrar = formCadastro.querySelector('button[type="submit"]');
const btnEsqueciSenha = document.getElementById("btnEsqueciSenha");
const linkEntrar = document.getElementById("linkEntrar");
const textoAlternar = document.getElementById("textoAlternar");

let modoLogin = false;
let fluxoManual = false;
let redirecionando = false;

/* ------------------------------ mensagens ------------------------------ */

function mostrarMensagem(texto, tipo = "neutro") {
  mensagem.textContent = texto;
  mensagem.className = "mensagem";

  if (tipo === "sucesso") mensagem.classList.add("sucesso");
  if (tipo === "erro") mensagem.classList.add("erro");
}

function irParaPainel() {
  if (redirecionando) return;

  redirecionando = true;
  window.location.replace("painel.html");
}

function descreverErroAuth(erro) {
  const codigo = (erro && erro.code) || "";
  const texto = String((erro && erro.message) || "");

  switch (codigo) {
    case "auth/email-already-in-use":
      return "Este e-mail já possui uma conta. Toque em 'Entrar'.";

    case "auth/invalid-email":
      return "Digite um endereço de e-mail válido.";

    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Escolha uma senha mais forte, com pelo menos 8 caracteres.";

    case "auth/operation-not-allowed":
      return "Este tipo de login não está habilitado no Firebase.";

    case "auth/network-request-failed":
      return "Erro de conexão. Verifique sua internet e tente novamente.";

    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-mail ou senha incorretos. Confira seus dados.";

    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";

    case "auth/user-disabled":
      return "Esta conta foi desativada. Entre em contato com o suporte.";

    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Login com Google cancelado.";

    case "auth/popup-blocked":
      return "O navegador bloqueou a janela do Google. Permita pop-ups e tente de novo.";

    case "auth/unauthorized-domain":
      return (
        "Este endereço não está autorizado no Firebase. " +
        "Adicione o domínio em Authentication > Settings > Authorized domains."
      );

    case "auth/unauthorized-continue-uri":
      return (
        "O endereço deste app não está autorizado no Firebase. " +
        "Adicione o domínio em Authentication > Settings > Authorized domains."
      );

    case "auth/web-storage-unsupported":
      return "O navegador bloqueou o armazenamento. Saia da janela anônima e tente novamente.";

    case "auth/missing-email":
      return "Digite seu e-mail para recuperar a senha.";

    default:
      break;
  }

  // Erros do login nativo do Google quando o APK não tem google-services.json
  // ou o SHA-1 ainda não foi cadastrado no Firebase.
  if (
    /default_web_client_id|DEVELOPER_ERROR|10:|12500|12501|ApiException|google-services/i.test(
      texto
    )
  ) {
    return (
      "O login com Google não está configurado neste APK. " +
      "Use e-mail e senha ou siga o guia MOBILE.md para configurar o Firebase."
    );
  }

  return "Não foi possível concluir. Tente novamente.";
}

/*
 * Mensagens específicas da recuperação de senha. O erro "user-not-found" ali
 * significa "e-mail não cadastrado" — bem diferente de senha errada.
 */
function descreverErroReset(erro) {
  const codigo = (erro && erro.code) || "";

  switch (codigo) {
    case "auth/invalid-email":
      return "Digite um endereço de e-mail válido.";

    case "auth/missing-email":
      return "Digite seu e-mail para receber o link de recuperação.";

    case "auth/user-not-found":
      return (
        "Não encontramos uma conta com este e-mail. " +
        "Confira o endereço ou crie uma conta."
      );

    case "auth/too-many-requests":
      return "Muitos pedidos seguidos. Aguarde alguns minutos e tente novamente.";

    case "auth/network-request-failed":
      return "Erro de conexão. Verifique sua internet e tente novamente.";

    default:
      return descreverErroAuth(erro);
  }
}

/* --------------------------- modo login/cadastro ------------------------ */

function aplicarModo() {
  btnCadastrar.textContent = modoLogin ? "Entrar" : "Criar conta";

  textoAlternar.textContent = modoLogin
    ? "Ainda não tem uma conta?"
    : "Já tem uma conta?";

  linkEntrar.textContent = modoLogin ? "Criar conta" : "Entrar";

  grupoNome.hidden = modoLogin;
  grupoConfirmarSenha.hidden = modoLogin;

  campoConfirmar.required = !modoLogin;
  campoSenha.autocomplete = modoLogin ? "current-password" : "new-password";
  campoConfirmar.autocomplete = "new-password";

  btnEsqueciSenha.hidden = !modoLogin;

  mostrarMensagem("", "neutro");
}

linkEntrar.addEventListener("click", (evento) => {
  evento.preventDefault();

  modoLogin = !modoLogin;
  aplicarModo();

  if (modoLogin) {
    campoEmail.focus();
  } else {
    campoNome.focus();
  }
});

/* ------------------------------- login --------------------------------- */

formCadastro.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const nome = campoNome.value.trim();
  const email = campoEmail.value.trim();
  const senha = campoSenha.value;
  const confirmacao = campoConfirmar.value;

  if (!email || !senha) {
    mostrarMensagem("Preencha o e-mail e a senha.", "erro");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    mostrarMensagem("Digite um endereço de e-mail válido.", "erro");
    campoEmail.focus();
    return;
  }

  if (senha.length < 8) {
    mostrarMensagem("A senha precisa ter pelo menos 8 caracteres.", "erro");
    campoSenha.focus();
    return;
  }

  if (!modoLogin && senha !== confirmacao) {
    mostrarMensagem("As senhas não coincidem.", "erro");
    campoConfirmar.focus();
    return;
  }

  fluxoManual = true;
  btnCadastrar.disabled = true;

  mostrarMensagem(
    modoLogin ? "Entrando na sua conta..." : "Criando sua conta...",
    "neutro"
  );

  try {
    await persistencia;

    if (modoLogin) {
      await signInWithEmailAndPassword(auth, email, senha);
    } else {
      const credencial = await createUserWithEmailAndPassword(
        auth,
        email,
        senha
      );

      if (nome) {
        await updateProfile(credencial.user, { displayName: nome });
      }
    }

    mostrarMensagem("Tudo certo! Abrindo seu painel...", "sucesso");
    irParaPainel();
  } catch (erro) {
    console.error("Erro na autenticação:", erro);
    mostrarMensagem(descreverErroAuth(erro), "erro");
  } finally {
    fluxoManual = false;
    btnCadastrar.disabled = false;
  }
});

/* --------------------------- login com Google -------------------------- */

async function entrarComGoogle() {
  btnGoogle.disabled = true;
  mostrarMensagem("Conectando ao Google...", "neutro");

  try {
    await persistencia;

    if (isNativo()) {
      const resultado = await chamarNativo(
        "FirebaseAuthentication",
        "signInWithGoogle",
        {}
      );

      const credencial = resultado && resultado.credential;
      const idToken =
        credencial && (credencial.idToken || credencial.accessToken);

      if (!idToken) {
        throw new Error(
          "O Google não devolveu um token válido. Verifique a configuração " +
            "do Firebase no guia MOBILE.md."
        );
      }

      const sessao = await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(idToken)
      );

      // Garante que o nome da conta Google apareça no painel.
      const nomeGoogle =
        String((resultado.user && resultado.user.displayName) || "").trim() ||
        nomeDoIdToken(idToken);

      if (
        sessao &&
        sessao.user &&
        nomeGoogle &&
        !String(sessao.user.displayName || "").trim()
      ) {
        await updateProfile(sessao.user, { displayName: nomeGoogle }).catch(
          (erro) => {
            console.warn("Não foi possível salvar o nome do Google:", erro);
          }
        );
      }
    } else if (usarRedirecionamento()) {
      // No iPhone/iPad o pop-up é bloqueado com frequência; o redirecionamento
      // é o caminho recomendado pelo Firebase.
      await signInWithRedirect(auth, provedorGoogle);
      return;
    } else {
      // No Android/desktop o pop-up devolve a credencial por postMessage e
      // costuma ser mais confiável do que o redirecionamento.
      try {
        await signInWithPopup(auth, provedorGoogle);
      } catch (erroPopup) {
        const codigo = (erroPopup && erroPopup.code) || "";

        if (
          codigo === "auth/popup-blocked" ||
          codigo === "auth/operation-not-supported-in-this-environment" ||
          codigo === "auth/cancelled-popup-request"
        ) {
          // Navegador sem suporte a pop-up: cai para o redirecionamento.
          await signInWithRedirect(auth, provedorGoogle);
          return;
        }

        throw erroPopup;
      }
    }

    mostrarMensagem("Login realizado! Abrindo seu painel...", "sucesso");
    irParaPainel();
  } catch (erro) {
    console.error("Erro no login com Google:", erro);
    mostrarMensagem(descreverErroAuth(erro), "erro");
  } finally {
    btnGoogle.disabled = false;
  }
}

btnGoogle.addEventListener("click", entrarComGoogle);

/* ------------------------- recuperar senha ----------------------------- */

btnEsqueciSenha.addEventListener("click", async () => {
  const email = campoEmail.value.trim();

  if (!email) {
    mostrarMensagem(
      "Digite seu e-mail no campo acima para receber o link de recuperação.",
      "erro"
    );
    campoEmail.focus();
    return;
  }

  btnEsqueciSenha.disabled = true;

  try {
    await sendPasswordResetEmail(auth, email);
    mostrarMensagem(
      "Enviamos um e-mail para redefinir sua senha. Confira a caixa de " +
        "entrada e o spam. Se a conta foi criada com o Google, use o botão " +
        "Entrar com Google — ela não tem senha para redefinir.",
      "sucesso"
    );
  } catch (erro) {
    console.error("Erro ao enviar recuperação:", erro);
    mostrarMensagem(descreverErroReset(erro), "erro");
  } finally {
    btnEsqueciSenha.disabled = false;
  }
});

/* ------------------------------- sessão -------------------------------- */

// Retorno do login com Google por redirecionamento (celular).
getRedirectResult(auth)
  .then((resultado) => {
    if (resultado && resultado.user) {
      mostrarMensagem("Login realizado! Abrindo seu painel...", "sucesso");
      irParaPainel();
    }
  })
  .catch((erro) => {
    console.error("Erro no retorno do login com Google:", erro);
    mostrarMensagem(descreverErroAuth(erro), "erro");
  });

// Se o usuário já estiver autenticado, vai direto para o painel.
// Durante um login/cadastro manual o redirecionamento é feito pelo próprio
// fluxo, depois de salvar o nome do usuário.
onAuthStateChanged(auth, (usuario) => {
  if (usuario && !fluxoManual) {
    irParaPainel();
  }
});

aplicarModo();
