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

/*
 * Sem armazenamento o login funciona, mas a sessão se perde ao trocar de
 * página (o painel devolveria para a tela de login). Avisamos o usuário em vez
 * de fingir que entrou.
 */
let armazenamentoBloqueado = false;

const persistencia = setPersistence(auth, browserLocalPersistence).catch(
  (erro) => {
    armazenamentoBloqueado = true;
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
 * iPhone/iPad (Safari e Chrome no iOS) costumam "perder" a sessão quando o
 * login do Google volta por redirecionamento: a página retorna sem usuário e
 * o app parece voltar para a tela de login. Por isso tentamos primeiro a
 * janela do Google (pop-up) em todos os aparelhos. Se o navegador bloquear a
 * janela, o fluxo cai automaticamente para o redirecionamento.
 */
function marcarRedirecionamentoPendente() {
  try {
    sessionStorage.setItem("medlembre_redirect_pendente", "1");
  } catch (erro) {
    /* sem armazenamento */
  }
}

function consumirRedirecionamentoPendente() {
  try {
    const pendente = sessionStorage.getItem("medlembre_redirect_pendente");

    sessionStorage.removeItem("medlembre_redirect_pendente");

    return pendente === "1";
  } catch (erro) {
    return false;
  }
}

/* Navegador interno de WhatsApp, Instagram, Facebook etc. */
function navegadorDeAplicativo() {
  const agente = navigator.userAgent || "";

  return /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|WhatsApp|Snapchat|Twitter|TikTok|Pinterest/i.test(
    agente
  );
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

function mostrarMensagem(texto, tipo = "neutro", codigo = "") {
  mensagem.textContent = texto;
  mensagem.className = "mensagem";

  if (tipo === "sucesso") mensagem.classList.add("sucesso");
  if (tipo === "erro") mensagem.classList.add("erro");

  // Mostra o código técnico do Firebase. Ajuda a identificar o problema sem
  // precisar abrir o console do navegador.
  if (codigo) {
    const detalhe = document.createElement("small");
    detalhe.className = "mensagem-codigo";
    detalhe.textContent = `código: ${codigo}`;
    mensagem.appendChild(detalhe);
  }
}

function irParaPainel() {
  if (redirecionando) return;

  redirecionando = true;
  window.location.replace("painel.html");
}

/*
 * Depois de autenticar, só entra no painel se a sessão vai sobreviver à troca
 * de página. Sem armazenamento o painel abriria e voltaria para o login — o
 * famoso "simula que entrou e volta".
 */
function concluirLogin() {
  if (armazenamentoBloqueado) {
    mostrarMensagem(
      "Sua conta foi aceita, mas o navegador está bloqueando o armazenamento " +
        "do site, então a sessão não é mantida. Permita cookies para este " +
        "endereço (e saia da navegação anônima) e tente novamente.",
      "erro",
      "storage"
    );
    return;
  }

  mostrarMensagem("Login realizado! Abrindo seu painel...", "sucesso");
  irParaPainel();
}

/*
 * Envia para o servidor local apenas o código do erro e o navegador usado,
 * para conseguirmos diagnosticar o login no celular. Nada de dados pessoais.
 */
function registrarDiagnostico(etapa, erro) {
  if (isNativo()) return;

  try {
    fetch("/diagnostico/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        etapa,
        codigo: (erro && erro.code) || "",
        mensagem: (erro && erro.message) || "",
        agente: navigator.userAgent || ""
      }),
      keepalive: true
    }).catch(() => {});
  } catch (erroEnvio) {
    // diagnóstico nunca deve atrapalhar o login
  }
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

    case "auth/account-exists-with-different-credential":
      return (
        "Este e-mail já tem uma conta criada de outra forma (e-mail e senha). " +
        "Entre com e-mail e senha; se não lembrar a senha, use 'Esqueci minha senha'."
      );

    case "auth/credential-already-in-use":
      return "Esta conta Google já está ligada a outro cadastro.";

    case "auth/internal-error":
    case "auth/argument-error":
      return (
        "O Google respondeu, mas o Firebase recusou a sessão. " +
        "Feche o app, abra de novo e tente outra vez."
      );

    case "auth/web-storage-unsupported":
      return "O navegador está bloqueando o armazenamento do site. Permita cookies e tente novamente.";

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
    concluirLogin();
  } catch (erro) {
    console.error("Erro na autenticação:", erro);
    mostrarMensagem(descreverErroAuth(erro), "erro", (erro && erro.code) || "");
  } finally {
    fluxoManual = false;
    btnCadastrar.disabled = false;
  }
});

/* --------------------------- login com Google -------------------------- */

async function entrarComGoogle() {
  btnGoogle.disabled = true;
  mostrarMensagem("Conectando ao Google...", "neutro");
  registrarDiagnostico("google:clique");

  /*
   * Se a janela do Google ficar aberta e o retorno nunca chegar, o botão não
   * pode ficar travado para sempre. Depois de 2 minutos liberamos a tentativa.
   */
  const prazo = window.setTimeout(() => {
    if (redirecionando) return;

    btnGoogle.disabled = false;
    mostrarMensagem(
      "Se a janela do Google ainda estiver aberta, conclua o login nela e " +
        "volte para esta aba. Se ela já fechou, toque em Entrar com Google de novo.",
      "neutro"
    );
  }, 120000);

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
    } else {
      /*
       * Janela do Google primeiro: no iPhone é o caminho que devolve a sessão
       * de forma confiável. Se o navegador barrar a janela, redirecionamos.
       */
      try {
        await signInWithPopup(auth, provedorGoogle);
      } catch (erroPopup) {
        const codigo = (erroPopup && erroPopup.code) || "";

        if (
          codigo === "auth/popup-blocked" ||
          codigo === "auth/operation-not-supported-in-this-environment" ||
          codigo === "auth/cancelled-popup-request" ||
          codigo === "auth/popup-closed-by-user"
        ) {
          // Navegador sem suporte (ou janela fechada): usa o redirecionamento.
          marcarRedirecionamentoPendente();
          await signInWithRedirect(auth, provedorGoogle);
          return;
        }

        throw erroPopup;
      }
    }

    mostrarMensagem("Login realizado! Abrindo seu painel...", "sucesso");
    registrarDiagnostico("google:sucesso");
    concluirLogin();
  } catch (erro) {
    console.error("Erro no login com Google:", erro);
    registrarDiagnostico("google:erro", erro);
    mostrarMensagem(descreverErroAuth(erro), "erro", (erro && erro.code) || "");
  } finally {
    window.clearTimeout(prazo);
    btnGoogle.disabled = false;
  }
}

btnGoogle.addEventListener("click", entrarComGoogle);

/*
 * WhatsApp, Instagram e afins abrem o link dentro do próprio aplicativo, e o
 * Google recusa o login nesses navegadores. Melhor avisar do que deixar o
 * usuário tentando sem entender.
 */
if (navegadorDeAplicativo()) {
  mostrarMensagem(
    "Você abriu o MedLembre dentro de outro aplicativo (WhatsApp, Instagram...). " +
      "O Google não permite entrar por aqui. Toque no menu (⋯) e escolha " +
      "'Abrir no Chrome' ou 'Abrir no Safari'.",
    "erro",
    "navegador-de-app"
  );
}

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
    mostrarMensagem(descreverErroReset(erro), "erro", (erro && erro.code) || "");
  } finally {
    btnEsqueciSenha.disabled = false;
  }
});

/* ------------------------------- sessão -------------------------------- */

// Retorno do login com Google por redirecionamento (quando o pop-up falhou).
const veioDeRedirecionamento = consumirRedirecionamentoPendente();

getRedirectResult(auth)
  .then((resultado) => {
    if (resultado && resultado.user) {
      mostrarMensagem("Login realizado! Abrindo seu painel...", "sucesso");
      registrarDiagnostico("redirect:usuario");
      concluirLogin();
      return;
    }

    registrarDiagnostico("redirect:sem-resultado");

    if (veioDeRedirecionamento) {
      mostrarMensagem(
        "O Google concluiu, mas este navegador não devolveu a sessão. " +
          "Toque em Entrar com Google de novo: agora o app abre a janela do " +
          "Google, que funciona melhor no iPhone. Se ainda assim não entrar, " +
          "use o login com e-mail e senha.",
        "erro",
        "redirect-sem-sessao"
      );
    }
  })
  .catch((erro) => {
    console.error("Erro no retorno do login com Google:", erro);
    registrarDiagnostico("redirect:erro", erro);
    mostrarMensagem(descreverErroAuth(erro), "erro", (erro && erro.code) || "");
  });

// Se o usuário já estiver autenticado, vai direto para o painel.
// Durante um login/cadastro manual o redirecionamento é feito pelo próprio
// fluxo, depois de salvar o nome do usuário.
onAuthStateChanged(auth, (usuario) => {
  registrarDiagnostico(usuario ? "auth:com-usuario" : "auth:sem-usuario");

  if (usuario && !fluxoManual) {
    // Passa pela mesma verificação de armazenamento: se a sessão não vai
    // sobreviver à troca de página, o painel devolveria para o login.
    concluirLogin();
  }
});

aplicarModo();
