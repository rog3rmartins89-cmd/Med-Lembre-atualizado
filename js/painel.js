/*
 * MedLembre - painel principal.
 */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";

import { getAuth, onAuthStateChanged, signOut, updateProfile }
  from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

import { isNativo } from "./nativo.js";
import { buscarMedicamentos, buscarApresentacoes } from "./api.js";

/*
 * Diagnóstico do login no navegador: envia apenas o passo do fluxo e o
 * navegador usado. Nunca envia dados da conta.
 */
function registrarDiagnostico(etapa) {
  if (isNativo()) return;

  try {
    fetch("/diagnostico/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        etapa,
        codigo: "",
        mensagem: "",
        agente: navigator.userAgent || ""
      }),
      keepalive: true
    }).catch(() => {});
  } catch (erro) {
    // diagnóstico nunca deve atrapalhar o app
  }
}

import {
  CHAVES,
  gerarId,
  getMedicamentos,
  adicionarMedicamento,
  atualizarMedicamento,
  removerMedicamento,
  getHistorico,
  registrarDose,
  removerRegistroHistorico,
  doseJaRegistrada,
  dosesTomadasHoje,
  formatarApresentacao
} from "./armazenamento.js";

import {
  ativarLembretes,
  desativarLembretes,
  sincronizarLembretes,
  statusLembretes,
  testarAlarme,
  registrarListeners,
  lembretesAtivos
} from "./notificacoes.js";

/* ------------------------------ Firebase -------------------------------- */

const firebaseConfig = {
  apiKey: "AIzaSyAZtDFkleYZrh5coDVfpLyNniU5cBxqWro",
  authDomain: "medlembre-b0267.firebaseapp.com",
  projectId: "medlembre-b0267",
  storageBucket: "medlembre-b0267.firebasestorage.app",
  messagingSenderId: "67386414641",
  appId: "1:67386414641:web:4750920b90539b9ce4a710",
  measurementId: "G-1LN9N8LSND"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

/* -------------------------------- DOM ----------------------------------- */

const $ = (id) => document.getElementById(id);

const nomeUsuario = $("nomeUsuario");
const nomeUsuarioCabecalho = $("nomeUsuarioCabecalho");
const campoNomeConta = $("nomeConta");
const btnSalvarNome = $("btnSalvarNome");

const btnAcessibilidade = $("btnAcessibilidade");
const painelAcessibilidade = $("painelAcessibilidade");
const btnLogout = $("btnLogout");

const btnTemaClaro = $("btnTemaClaro");
const btnTemaEscuro = $("btnTemaEscuro");
const btnDaltonismo = $("btnDaltonismo");
const btnAumentarFonte = $("btnAumentarFonte");
const btnDiminuirFonte = $("btnDiminuirFonte");

const formMedicamento = $("formMedicamento");
const campoMedicamento = $("nomeMedicamento");
const btnBuscarMedicamento = $("btnBuscarMedicamento");
const resultadoBusca = $("resultadoBusca");
const campoSelecionado = $("medicamentoSelecionado");
const chipSelecao = $("apresentacaoSelecionada");
const campoQuantidade = $("quantidadeMedicamento");
const campoHorario = $("horarioMedicamento");

const btnTodosDias = $("btnTodosDias");
const btnDiasEspecificos = $("btnDiasEspecificos");
const areaDiasSemana = $("areaDiasSemana");

const listaMedicamentos = $("listaMedicamentos");
const listaHistorico = $("listaHistorico");

const totalMedicamentos = $("totalMedicamentos");
const dosesHoje = $("dosesHoje");
const proximaDose = $("proximaDose");

const btnAtivarLembretes = $("btnAtivarLembretes");
const btnTestarAlarme = $("btnTestarAlarme");
const statusLembretesTexto = $("statusLembretes");

const dialogEditar = $("dialogEditar");
const formEditar = $("formEditar");
const btnFecharEdicao = $("btnFecharEdicao");
const btnCancelarEdicao = $("btnCancelarEdicao");
const editarNome = $("editarNome");
const editarQuantidade = $("editarQuantidade");
const editarHorario = $("editarHorario");
const diasEditarArea = $("diasEditarArea");

const toasts = $("toasts");

/* ------------------------------- estado --------------------------------- */

let usuarioAtual = null;
let iniciado = false;
let medicamentos = [];

let selecionado = null;
let frequenciaSelecionada = "todos";
let diasSelecionados = new Set();

let edicaoId = null;
let edicaoFrequencia = "todos";
let edicaoDias = new Set();

const FONTE_MINIMA = 100;
const FONTE_MAXIMA = 160;
const PASSO_FONTE = 10;

const TELAS = {
  inicio: ["inicio", "cadastroMedicamento"],
  meusMedicamentos: ["meusMedicamentos"],
  historico: ["historico"],
  minhaConta: ["minhaConta"]
};

const NOMES_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/* ------------------------------ utilidades ------------------------------ */

function criar(tag, classe, texto) {
  const elemento = document.createElement(tag);

  if (classe) elemento.className = classe;
  if (texto !== undefined && texto !== null) elemento.textContent = texto;

  return elemento;
}

function toast(texto, tipo = "") {
  const elemento = criar("div", `toast ${tipo}`.trim(), texto);

  toasts.appendChild(elemento);
  window.setTimeout(() => elemento.remove(), 4500);
}

function horarioValido(horario) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(horario || ""));
}

function formatarDias(dias) {
  const lista = [...new Set(dias)].sort((a, b) => a - b);

  if (lista.length === 7) return "Todos os dias";

  return lista.map((dia) => NOMES_DIAS[dia]).join(", ");
}

function descricaoFrequencia(medicamento) {
  if (medicamento.frequencia !== "especificos") return "Todos os dias";

  return formatarDias(medicamento.diasSemana);
}

function simplificarApresentacao(descricaoOriginal) {
  const descricao = String(descricaoOriginal || "").toUpperCase();

  const concentracoes = descricao.match(
    /\d+(?:[.,]\d+)?\s*(?:MCG|MG|G|UI)(?:\s*\/\s*(?:ML|G))?/g
  );

  let forma = "";

  if (/\bCOM\b|\bCOMP\b|\bCOMPRIMIDO\b/.test(descricao)) {
    forma = "Comprimido";
  } else if (/\bGTS\b|\bGOTAS\b/.test(descricao)) {
    forma = "Gotas";
  } else if (/\bINJ\b|\bINJETAVEL\b|\bINJETÁVEL\b/.test(descricao)) {
    forma = "Injetável";
  } else if (/\bSOL\s+OR\b|\bSOLUÇÃO ORAL\b/.test(descricao)) {
    forma = "Solução oral";
  } else if (/\bSUSP\s+OR\b|\bSUSPENSÃO ORAL\b/.test(descricao)) {
    forma = "Suspensão oral";
  }

  const concentracaoTexto = concentracoes
    ? [...new Set(concentracoes)].join(" + ").toLowerCase()
    : "";

  if (!concentracaoTexto || !forma) {
    return String(descricaoOriginal || "").trim();
  }

  return `${concentracaoTexto} — ${forma}`;
}

function agruparMedicamentos(lista) {
  const grupos = new Map();

  for (const medicamento of lista) {
    const nome = String(medicamento.nome || "").trim();
    const fabricante = String(medicamento.fabricante || "").trim();

    const chave =
      `${nome.toLocaleLowerCase("pt-BR")}::` +
      `${fabricante.toLocaleLowerCase("pt-BR")}`;

    if (!grupos.has(chave)) {
      grupos.set(chave, {
        nome,
        fabricante,
        registro: medicamento.registro || "",
        registros: []
      });
    }

    const grupo = grupos.get(chave);

    if (medicamento.registro && !grupo.registros.includes(medicamento.registro)) {
      grupo.registros.push(medicamento.registro);
    }
  }

  return Array.from(grupos.values());
}

function agruparPorNome(lista) {
  const grupos = new Map();

  for (const medicamento of lista) {
    const nome = String(medicamento.nome || "").trim();

    if (!nome) continue;

    const chave = nome.toLocaleLowerCase("pt-BR");

    if (!grupos.has(chave)) {
      grupos.set(chave, { nome, registros: [] });
    }

    const grupo = grupos.get(chave);

    for (const registro of medicamento.registros || []) {
      if (!grupo.registros.includes(registro)) {
        grupo.registros.push(registro);
      }
    }
  }

  return Array.from(grupos.values());
}

function rotuloDia(data) {
  const hoje = new Date();
  const amanha = new Date();

  amanha.setDate(hoje.getDate() + 1);

  if (data.toDateString() === hoje.toDateString()) return "hoje";
  if (data.toDateString() === amanha.toDateString()) return "amanhã";

  return data.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  });
}

/* ------------------------------- sessão --------------------------------- */

/*
 * Quando a conta não tem nome salvo (contas antigas ou criadas só com e-mail),
 * monta um nome apresentável a partir do e-mail: "roger.martins" vira
 * "Roger Martins".
 */
function nomeDeEmail(email) {
  const prefixo = String(email || "").split("@")[0];

  const palavras = prefixo
    .replace(/[._\-+]+/g, " ")
    .replace(/[0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!palavras.length) return "usuário";

  return palavras
    .map(
      (palavra) =>
        palavra.charAt(0).toLocaleUpperCase("pt-BR") +
        palavra.slice(1).toLocaleLowerCase("pt-BR")
    )
    .join(" ");
}

function aplicarUsuario(usuario) {
  const nomeCompleto =
    (usuario.displayName || "").trim() || nomeDeEmail(usuario.email);

  const primeiroNome = nomeCompleto.split(/\s+/)[0];

  nomeUsuario.textContent = primeiroNome;
  nomeUsuarioCabecalho.textContent = primeiroNome;

  if (campoNomeConta) campoNomeConta.value = nomeCompleto;

  const emailConta = $("emailConta");
  const senhaConta = $("senhaConta");
  const provedorConta = $("provedorConta");

  if (emailConta) emailConta.value = usuario.email || "E-mail não disponível";
  if (senhaConta) senhaConta.value = "********";

  if (provedorConta) {
    const loginGoogle = (usuario.providerData || []).some(
      (provedor) => provedor.providerId === "google.com"
    );

    provedorConta.textContent = loginGoogle
      ? "🔐 Conta conectada com Google"
      : "🔐 Conta autenticada por e-mail";
  }
}

onAuthStateChanged(auth, (usuario) => {
  if (!usuario) {
    // Diagnóstico: mostra no servidor se o painel abriu sem sessão (é o que
    // provoca o "volta para o login").
    registrarDiagnostico("painel:sem-usuario");

    // Uma única leitura nula pode acontecer logo depois do login (enquanto o
    // Firebase termina de restaurar a sessão). Antes de devolver para a tela
    // de login, confirma que realmente não há usuário autenticado.
    setTimeout(() => {
      if (auth.currentUser) return;

      if (!iniciado) {
        window.location.replace("index.html");
      }
    }, 1500);

    return;
  }

  registrarDiagnostico("painel:com-usuario");
  usuarioAtual = usuario;
  aplicarUsuario(usuario);
  iniciarPainel();
});

function iniciarPainel() {
  if (iniciado) return;

  iniciado = true;

  aplicarTema(
    localStorage.getItem(CHAVES.tema) ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "escuro"
        : "claro")
  );

  aplicarAltoContraste(
    localStorage.getItem(CHAVES.contraste) === "true"
  );

  aplicarTamanhoFonte(
    Number(localStorage.getItem(CHAVES.fonte)) || 100
  );

  carregarDados();

  const telaInicial = window.location.hash.substring(1);
  abrirTela(TELAS[telaInicial] ? telaInicial : "inicio", false);

  atualizarStatusLembretes();
  sincronizarLembretes().catch((erro) =>
    console.warn("Falha ao sincronizar lembretes:", erro)
  );

  registrarListeners({
    aoReceber: (_notificacao, medicamento) => {
      toast(
        medicamento
          ? `Hora de tomar ${medicamento.nome}`
          : "Hora do remédio",
        "sucesso"
      );
      atualizarResumo();
    }
  }).catch((erro) => console.warn("Listener de notificações:", erro));

  window.setInterval(atualizarResumo, 60000);
}

/* ------------------------------- dados ---------------------------------- */

function carregarDados() {
  medicamentos = getMedicamentos();
  renderizarMedicamentos();
  renderizarHistorico();
  atualizarResumo();
}

function atualizarResumo() {
  medicamentos = getMedicamentos();

  totalMedicamentos.textContent = String(medicamentos.length);
  dosesHoje.textContent = String(dosesTomadasHoje());

  const agora = new Date();

  const pendente = medicamentos.find((medicamento) => {
    if (!horarioValido(medicamento.horario)) return false;

    const [hora, minuto] = medicamento.horario.split(":").map(Number);
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    const minutosMedicamento = hora * 60 + minuto;

    const dias =
      medicamento.frequencia === "especificos"
        ? medicamento.diasSemana
        : [0, 1, 2, 3, 4, 5, 6];

    return (
      dias.includes(agora.getDay()) &&
      minutosMedicamento <= minutosAgora &&
      !doseJaRegistrada(medicamento.id, medicamento.horario)
    );
  });

  if (pendente) {
    proximaDose.textContent =
      `⏰ ${pendente.nome} — ${pendente.horario} (ainda não confirmado hoje)`;
    return;
  }

  let melhor = null;

  for (const medicamento of medicamentos) {
    if (!horarioValido(medicamento.horario)) continue;

    const [hora, minuto] = medicamento.horario.split(":").map(Number);

    const dias =
      medicamento.frequencia === "especificos"
        ? medicamento.diasSemana
        : [0, 1, 2, 3, 4, 5, 6];

    for (let deslocamento = 0; deslocamento < 8; deslocamento += 1) {
      const data = new Date(agora);

      data.setDate(agora.getDate() + deslocamento);
      data.setHours(hora, minuto, 0, 0);

      if (data <= agora) continue;
      if (!dias.includes(data.getDay())) continue;

      if (!melhor || data < melhor.data) {
        melhor = { medicamento, data };
      }

      break;
    }
  }

  if (melhor) {
    const hora = melhor.data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    proximaDose.textContent =
      `${melhor.medicamento.nome} — ${rotuloDia(melhor.data)} às ${hora}`;
    return;
  }

  proximaDose.textContent = medicamentos.length
    ? "Sem próximas doses agendadas. Confira os dias da semana."
    : "Cadastre um medicamento para começar.";
}

function renderizarMedicamentos() {
  medicamentos = getMedicamentos();

  listaMedicamentos.replaceChildren();

  if (!medicamentos.length) {
    const vazio = criar(
      "div",
      "estado-vazio",
      "Nenhum medicamento cadastrado ainda."
    );

    const botao = criar("button", "btn-primario", "＋ Adicionar remédio");

    botao.type = "button";
    botao.style.marginTop = "12px";
    botao.addEventListener("click", () => {
      abrirTela("inicio");
      $("cadastroMedicamento")?.scrollIntoView({ behavior: "smooth" });
    });

    vazio.appendChild(criar("br"));
    vazio.appendChild(botao);
    listaMedicamentos.appendChild(vazio);
    return;
  }

  const ordenados = [...medicamentos].sort((a, b) =>
    a.horario.localeCompare(b.horario)
  );

  for (const medicamento of ordenados) {
    listaMedicamentos.appendChild(criarCartaoMedicamento(medicamento));
  }
}

function criarCartaoMedicamento(medicamento) {
  const cartao = criar("article", "cartao-medicamento");

  const cabecalho = criar("div", "cartao-medicamento-cabecalho");
  const icone = criar("span", "cartao-medicamento-icone", "💊");

  const info = criar("div", "cartao-medicamento-info");
  const titulo = criar("h3", "", medicamento.nome);

  info.appendChild(titulo);

  const apresentacao = formatarApresentacao(medicamento.apresentacao);

  if (apresentacao) {
    info.appendChild(
      criar(
        "p",
        "cartao-medicamento-apresentacao",
        simplificarApresentacao(apresentacao)
      )
    );
  }

  const etiquetas = criar("div", "etiquetas");
  etiquetas.appendChild(criar("span", "etiqueta", medicamento.quantidade));
  etiquetas.appendChild(
    criar("span", "etiqueta", descricaoFrequencia(medicamento))
  );

  info.appendChild(etiquetas);

  const horario = criar(
    "span",
    "cartao-medicamento-horario",
    medicamento.horario
  );

  cabecalho.append(icone, info, horario);

  const acoes = criar("div", "cartao-medicamento-acoes");

  const jaTomei = criar("button", "btn-ja-tomei");
  jaTomei.type = "button";

  const tomado = doseJaRegistrada(medicamento.id, medicamento.horario);

  if (tomado) {
    jaTomei.textContent = "✔️ Tomado hoje";
    jaTomei.disabled = true;
    jaTomei.classList.add("tomado");
    jaTomei.setAttribute("aria-label", `${medicamento.nome} já tomado hoje`);
  } else {
    jaTomei.textContent = "✅ Já tomei";
    jaTomei.setAttribute("aria-label", `Confirmar que tomou ${medicamento.nome}`);

    jaTomei.addEventListener("click", () => {
      const confirmar = window.confirm(
        `Você confirma que tomou ${medicamento.nome} agora?`
      );

      if (!confirmar) return;

      const resultado = registrarDose(medicamento);

      if (!resultado.ok) {
        if (resultado.motivo === "duplicada") {
          toast("Essa dose já foi registrada hoje.", "sucesso");
        } else {
          toast("Não foi possível registrar. Verifique o armazenamento.", "erro");
        }

        renderizarMedicamentos();
        atualizarResumo();
        return;
      }

      toast(`${medicamento.nome} registrado no histórico!`, "sucesso");
      renderizarMedicamentos();
      renderizarHistorico();
      atualizarResumo();
    });
  }

  const editar = criar("button", "btn-editar-medicamento", "✏️ Editar");
  editar.type = "button";
  editar.addEventListener("click", () => abrirEdicao(medicamento.id));

  const excluir = criar("button", "btn-excluir-medicamento", "🗑️ Excluir");
  excluir.type = "button";
  excluir.setAttribute(
    "aria-label",
    `Excluir cadastro de ${medicamento.nome} às ${medicamento.horario}`
  );

  excluir.addEventListener("click", async () => {
    const confirmar = window.confirm(
      `Deseja excluir ${medicamento.nome} das ${medicamento.horario}?\n\n` +
        "Essa ação não poderá ser desfeita."
    );

    if (!confirmar) return;

    removerMedicamento(medicamento.id);
    medicamentos = getMedicamentos();

    renderizarMedicamentos();
    atualizarResumo();
    await sincronizarLembretes();

    toast("Medicamento excluído.", "sucesso");
  });

  acoes.append(jaTomei, editar, excluir);
  cartao.append(cabecalho, acoes);

  return cartao;
}

function renderizarHistorico() {
  const historico = getHistorico();

  listaHistorico.replaceChildren();

  if (!historico.length) {
    listaHistorico.appendChild(
      criar(
        "p",
        "estado-vazio",
        "Nenhum medicamento tomado registrado ainda."
      )
    );
    return;
  }

  const ordenado = [...historico].sort(
    (a, b) => new Date(b.tomadoEm) - new Date(a.tomadoEm)
  );

  for (const registro of ordenado) {
    const cartao = criar("article", "cartao-historico");

    const topo = criar("div", "cartao-historico-topo");
    topo.append(
      criar("h3", "", `💊 ${registro.nome}`),
      criar("span", "etiqueta", registro.horarioProgramado)
    );

    const quantidade = criar(
      "p",
      "",
      registro.quantidade ? `Quantidade: ${registro.quantidade}` : ""
    );

    const quando = criar(
      "p",
      "texto-ajuda",
      "Confirmado em " +
        new Date(registro.tomadoEm).toLocaleString("pt-BR", {
          dateStyle: "short",
          timeStyle: "short"
        })
    );

    const excluir = criar(
      "button",
      "btn-excluir-historico",
      "🗑️ Excluir registro"
    );

    excluir.type = "button";

    excluir.addEventListener("click", () => {
      const confirmar = window.confirm(
        `Deseja excluir o registro de ${registro.nome}?`
      );

      if (!confirmar) return;

      removerRegistroHistorico(registro.id);
      renderizarHistorico();
      atualizarResumo();
      toast("Registro excluído.", "sucesso");
    });

    cartao.append(topo);

    if (registro.quantidade) cartao.appendChild(quantidade);

    cartao.append(quando, excluir);
    listaHistorico.appendChild(cartao);
  }
}

/* ------------------------------ navegação -------------------------------- */

function abrirTela(tela, atualizarHash = true) {
  if (!TELAS[tela]) tela = "inicio";

  document.querySelectorAll("main.painel > section").forEach((secao) => {
    secao.hidden = true;
  });

  for (const id of TELAS[tela]) {
    const secao = $(id);

    if (secao) secao.hidden = false;
  }

  const cabecalho = document.querySelector(".painel-cabecalho");

  if (cabecalho) cabecalho.hidden = tela !== "inicio";

  document.querySelectorAll(".menu-item").forEach((link) => {
    link.classList.toggle(
      "ativo",
      link.getAttribute("href") === `#${tela}`
    );
  });

  if (atualizarHash) {
    history.replaceState(null, "", `#${tela}`);
  }

  if (tela === "historico") renderizarHistorico();
  if (tela === "meusMedicamentos") renderizarMedicamentos();
  if (tela === "inicio") atualizarResumo();

  window.scrollTo({ top: 0, behavior: "auto" });
}

document.querySelectorAll(".menu-item, .menu-adicionar").forEach((link) => {
  link.addEventListener("click", (evento) => {
    const destino = link.getAttribute("href");

    if (!destino || !destino.startsWith("#")) return;

    evento.preventDefault();

    const tela = destino.substring(1);

    painelAcessibilidade.hidden = true;
    btnAcessibilidade.setAttribute("aria-expanded", "false");

    if (tela === "cadastroMedicamento") {
      abrirTela("inicio");

      window.setTimeout(() => {
        $("cadastroMedicamento")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        campoMedicamento.focus({ preventScroll: true });
      }, 60);

      return;
    }

    abrirTela(tela);
  });
});

window.addEventListener("hashchange", () => {
  const tela = window.location.hash.substring(1);

  if (TELAS[tela]) abrirTela(tela, false);
});

/* --------------------------- acessibilidade ----------------------------- */

btnAcessibilidade.addEventListener("click", () => {
  const aberto = !painelAcessibilidade.hidden;

  painelAcessibilidade.hidden = aberto;
  btnAcessibilidade.setAttribute("aria-expanded", String(!aberto));
});

function aplicarTema(tema) {
  const escuro = tema === "escuro";

  document.body.classList.toggle("tema-escuro", escuro);
  localStorage.setItem(CHAVES.tema, escuro ? "escuro" : "claro");

  btnTemaClaro.setAttribute("aria-pressed", String(!escuro));
  btnTemaEscuro.setAttribute("aria-pressed", String(escuro));

  const meta = document.querySelector('meta[name="theme-color"]');

  if (meta) meta.setAttribute("content", escuro ? "#0e1620" : "#087e83");
}

btnTemaClaro.addEventListener("click", () => aplicarTema("claro"));
btnTemaEscuro.addEventListener("click", () => aplicarTema("escuro"));

function aplicarAltoContraste(ativado) {
  document.body.classList.toggle("alto-contraste", ativado);

  btnDaltonismo.setAttribute("aria-pressed", String(ativado));

  localStorage.setItem(CHAVES.contraste, ativado ? "true" : "false");
}

btnDaltonismo.addEventListener("click", () => {
  aplicarAltoContraste(
    !document.body.classList.contains("alto-contraste")
  );
});

function aplicarTamanhoFonte(tamanho) {
  const valor = Math.min(
    FONTE_MAXIMA,
    Math.max(FONTE_MINIMA, Number(tamanho) || FONTE_MINIMA)
  );

  document.documentElement.style.setProperty("--escala-fonte", valor / 100);

  localStorage.setItem(CHAVES.fonte, String(valor));

  btnDiminuirFonte.disabled = valor <= FONTE_MINIMA;
  btnAumentarFonte.disabled = valor >= FONTE_MAXIMA;

  btnAumentarFonte.title = `Aumentar fonte (atual ${valor}%)`;
  btnDiminuirFonte.title = `Diminuir fonte (atual ${valor}%)`;
}

function tamanhoFonteAtual() {
  return Number(localStorage.getItem(CHAVES.fonte)) || FONTE_MINIMA;
}

btnAumentarFonte.addEventListener("click", () =>
  aplicarTamanhoFonte(tamanhoFonteAtual() + PASSO_FONTE)
);

btnDiminuirFonte.addEventListener("click", () =>
  aplicarTamanhoFonte(tamanhoFonteAtual() - PASSO_FONTE)
);

/* -------------------------------- logout -------------------------------- */

btnLogout.addEventListener("click", async () => {
  const confirmar = window.confirm("Deseja realmente sair da sua conta?");

  if (!confirmar) return;

  btnLogout.disabled = true;

  try {
    await signOut(auth);
    window.location.replace("index.html");
  } catch (erro) {
    console.error("Erro ao sair da conta:", erro);
    toast("Não foi possível sair da conta. Tente novamente.", "erro");
    btnLogout.disabled = false;
  }
});

/* ---------------------------- nome da conta ----------------------------- */

if (btnSalvarNome && campoNomeConta) {
  btnSalvarNome.addEventListener("click", async () => {
    if (!usuarioAtual) return;

    const nome = campoNomeConta.value.replace(/\s+/g, " ").trim();

    if (nome.length < 2) {
      toast("Digite seu nome para salvar.", "erro");
      campoNomeConta.focus();
      return;
    }

    btnSalvarNome.disabled = true;

    try {
      await updateProfile(usuarioAtual, { displayName: nome });
      aplicarUsuario(auth.currentUser || usuarioAtual);
      toast("Nome atualizado!", "sucesso");
    } catch (erro) {
      console.error("Erro ao salvar o nome:", erro);
      toast("Não foi possível salvar o nome. Tente novamente.", "erro");
    } finally {
      btnSalvarNome.disabled = false;
    }
  });
}

/* ------------------------- frequência do cadastro ----------------------- */

function selecionarFrequencia(frequencia) {
  frequenciaSelecionada = frequencia;

  const todos = frequencia === "todos";

  btnTodosDias.classList.toggle("ativo", todos);
  btnDiasEspecificos.classList.toggle("ativo", !todos);

  btnTodosDias.setAttribute("aria-pressed", String(todos));
  btnDiasEspecificos.setAttribute("aria-pressed", String(!todos));

  areaDiasSemana.hidden = todos;
}

btnTodosDias.addEventListener("click", () => selecionarFrequencia("todos"));
btnDiasEspecificos.addEventListener("click", () =>
  selecionarFrequencia("especificos")
);

function alternarDia(botao, conjunto) {
  const dia = Number(botao.dataset.dia);
  const selecionadoAgora = conjunto.has(dia);

  if (selecionadoAgora) {
    conjunto.delete(dia);
  } else {
    conjunto.add(dia);
  }

  botao.classList.toggle("selecionado", !selecionadoAgora);
  botao.setAttribute("aria-pressed", String(!selecionadoAgora));
}

document
  .querySelectorAll("#areaDiasSemana .dias-semana button")
  .forEach((botao) => {
    botao.setAttribute("aria-pressed", "false");
    botao.addEventListener("click", () =>
      alternarDia(botao, diasSelecionados)
    );
  });

function resetarFormulario() {
  formMedicamento.reset();

  selecionado = null;
  campoSelecionado.value = "";
  chipSelecao.hidden = true;
  chipSelecao.textContent = "";

  diasSelecionados = new Set();
  selecionarFrequencia("todos");

  document
    .querySelectorAll("#areaDiasSemana .dias-semana button")
    .forEach((botao) => {
      botao.classList.remove("selecionado");
      botao.setAttribute("aria-pressed", "false");
    });

  resultadoBusca.replaceChildren(
    criar(
      "p",
      "",
      "Digite o nome de um medicamento e toque em Buscar."
    )
  );
}

/* --------------------------- busca de remédio --------------------------- */

function mensagemBusca(texto) {
  resultadoBusca.replaceChildren(criar("p", "", texto));
}

btnBuscarMedicamento.addEventListener("click", buscarMedicamentoSelecionado);

campoMedicamento.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") {
    evento.preventDefault();
    buscarMedicamentoSelecionado();
  }
});

async function buscarMedicamentoSelecionado() {
  const nome = campoMedicamento.value.trim();

  if (nome.length < 2) {
    mensagemBusca("Digite pelo menos 2 letras.");
    campoMedicamento.focus();
    return;
  }

  campoSelecionado.value = "";
  selecionado = null;
  chipSelecao.hidden = true;

  btnBuscarMedicamento.disabled = true;
  mensagemBusca("🔎 Pesquisando medicamentos...");

  try {
    const dados = await buscarMedicamentos(nome);

    const grupos = agruparPorNome(
      agruparMedicamentos(
        Array.isArray(dados.resultados) ? dados.resultados : []
      )
    );

    resultadoBusca.replaceChildren();

    if (!grupos.length) {
      mensagemBusca("Nenhum medicamento encontrado. Confira o nome digitado.");
      return;
    }

    for (const medicamento of grupos) {
      resultadoBusca.appendChild(
        criarItemBusca(medicamento)
      );
    }
  } catch (erro) {
    console.error(erro);
    mensagemBusca(
      `⚠️ ${erro.message} Você pode digitar o nome e salvar o medicamento ` +
        "mesmo sem a busca."
    );
    toast(erro.message, "erro");
  } finally {
    btnBuscarMedicamento.disabled = false;
  }
}

function criarItemBusca(medicamento) {
  const item = criar("div", "resultado-item");

  const cabecalho = criar("button", "resultado-cabecalho");
  cabecalho.type = "button";
  cabecalho.setAttribute("aria-expanded", "false");

  const icone = criar("span", "resultado-icone", "💊");
  const titulo = criar("span", "resultado-titulo", medicamento.nome);

  cabecalho.append(icone, titulo);

  const detalhes = criar("div", "resultado-apresentacoes");
  detalhes.hidden = true;

  item.append(cabecalho, detalhes);

  let carregado = false;

  cabecalho.addEventListener("click", async () => {
    const abrir = detalhes.hidden;

    resultadoBusca
      .querySelectorAll(".resultado-apresentacoes")
      .forEach((outro) => {
        outro.hidden = true;
      });

    resultadoBusca
      .querySelectorAll(".resultado-cabecalho")
      .forEach((outro) => outro.setAttribute("aria-expanded", "false"));

    if (!abrir) return;

    detalhes.hidden = false;
    cabecalho.setAttribute("aria-expanded", "true");

    if (carregado) return;

    detalhes.textContent = "Consultando apresentações...";

    try {
      const registros = [...new Set(medicamento.registros || [])].slice(0, 5);

      const respostas = await Promise.all(
        registros.map((registro) =>
          buscarApresentacoes(registro).catch(() => null)
        )
      );

      const apresentacoes = [];

      respostas.forEach((dados, indice) => {
        if (!dados) return;

        for (const apresentacao of dados.apresentacoes || []) {
          if (typeof apresentacao.descricao === "string") {
            apresentacoes.push({
              ...apresentacao,
              registro: dados.registro || registros[indice],
              nome: dados.nome || medicamento.nome
            });
          }
        }
      });

      detalhes.replaceChildren();

      if (!apresentacoes.length) {
        detalhes.textContent = "Apresentações não disponíveis.";
        carregado = true;
        return;
      }

      const vistos = new Set();

      for (const apresentacao of apresentacoes) {
        const descricao = apresentacao.descricao.trim();
        const texto = simplificarApresentacao(descricao);
        const chave = texto.toLowerCase();

        if (vistos.has(chave)) continue;

        vistos.add(chave);

        const opcao = criar(
          "button",
          "resultado-opcao",
          texto
        );

        opcao.type = "button";

        opcao.addEventListener("click", () => {
          selecionado = {
            registro: apresentacao.registro,
            codigo: apresentacao.codigo || "",
            descricao,
            ean: apresentacao.ean || []
          };

          campoSelecionado.value = JSON.stringify(selecionado);
          campoMedicamento.value = medicamento.nome;

          chipSelecao.textContent =
            `✔️ ${medicamento.nome}: ${simplificarApresentacao(descricao)}`;
          chipSelecao.hidden = false;

          resultadoBusca.replaceChildren();
          campoQuantidade.focus();

          toast("Apresentação selecionada.", "sucesso");
        });

        detalhes.appendChild(opcao);
      }

      carregado = true;
    } catch (erro) {
      console.error(erro);
      detalhes.textContent =
        "Não foi possível consultar as apresentações. Tente novamente.";
    }
  });

  return item;
}

/* ------------------------- salvar medicamento --------------------------- */

formMedicamento.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const nome = campoMedicamento.value.trim();
  const quantidade = campoQuantidade.value.trim();
  const horario = campoHorario.value;

  if (!nome) {
    toast("Informe o nome do medicamento.", "erro");
    campoMedicamento.focus();
    return;
  }

  // A apresentação é opcional: a busca depende da API de medicamentos e pode
  // estar indisponível. Nesse caso o cadastro segue só com o nome digitado.

  if (!quantidade) {
    toast("Informe a quantidade a tomar.", "erro");
    campoQuantidade.focus();
    return;
  }

  if (!horarioValido(horario)) {
    toast("Informe um horário válido.", "erro");
    campoHorario.focus();
    return;
  }

  if (frequenciaSelecionada === "especificos" && !diasSelecionados.size) {
    toast("Escolha pelo menos um dia da semana.", "erro");
    return;
  }

  const salvoSemApresentacao = !selecionado;

  adicionarMedicamento({
    id: gerarId(),
    nome,
    quantidade,
    horario,
    apresentacao: selecionado,
    frequencia: frequenciaSelecionada,
    diasSemana:
      frequenciaSelecionada === "todos"
        ? [0, 1, 2, 3, 4, 5, 6]
        : [...diasSelecionados]
  });

  resetarFormulario();

  renderizarMedicamentos();
  atualizarResumo();
  await sincronizarLembretes();

  toast(
    salvoSemApresentacao
      ? "Medicamento cadastrado sem apresentação."
      : "Medicamento cadastrado com sucesso!",
    "sucesso"
  );
});

/* --------------------------- editar medicamento ------------------------- */

function abrirEdicao(id) {
  const medicamento = getMedicamentos().find((item) => item.id === id);

  if (!medicamento) {
    toast("Medicamento não encontrado.", "erro");
    return;
  }

  edicaoId = id;
  edicaoFrequencia = medicamento.frequencia;
  edicaoDias = new Set(medicamento.diasSemana);

  editarNome.textContent = medicamento.nome;
  editarQuantidade.value = medicamento.quantidade;
  editarHorario.value = medicamento.horario;

  const radios = formEditar.querySelectorAll(
    'input[name="frequenciaEdicao"]'
  );

  radios.forEach((radio) => {
    radio.checked = radio.value === edicaoFrequencia;
  });

  diasEditarArea.hidden = edicaoFrequencia !== "especificos";

  diasEditarArea.querySelectorAll("button").forEach((botao) => {
    const dia = Number(botao.dataset.dia);
    const ativo = edicaoDias.has(dia);

    botao.classList.toggle("selecionado", ativo);
    botao.setAttribute("aria-pressed", String(ativo));
  });

  if (typeof dialogEditar.showModal === "function") {
    dialogEditar.showModal();
  } else {
    dialogEditar.setAttribute("open", "");
  }

  editarQuantidade.focus();
}

function fecharEdicao() {
  edicaoId = null;

  if (typeof dialogEditar.close === "function") {
    dialogEditar.close();
  } else {
    dialogEditar.removeAttribute("open");
  }
}

btnFecharEdicao.addEventListener("click", fecharEdicao);
btnCancelarEdicao.addEventListener("click", fecharEdicao);

dialogEditar.addEventListener("click", (evento) => {
  if (evento.target === dialogEditar) fecharEdicao();
});

formEditar
  .querySelectorAll('input[name="frequenciaEdicao"]')
  .forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;

      edicaoFrequencia = radio.value;
      diasEditarArea.hidden = edicaoFrequencia !== "especificos";
    });
  });

diasEditarArea.querySelectorAll("button").forEach((botao) => {
  botao.addEventListener("click", () => alternarDia(botao, edicaoDias));
});

formEditar.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!edicaoId) return;

  const quantidade = editarQuantidade.value.trim();
  const horario = editarHorario.value;

  if (!quantidade) {
    toast("Informe a quantidade a tomar.", "erro");
    editarQuantidade.focus();
    return;
  }

  if (!horarioValido(horario)) {
    toast("Informe um horário válido.", "erro");
    editarHorario.focus();
    return;
  }

  if (edicaoFrequencia === "especificos" && !edicaoDias.size) {
    toast("Escolha pelo menos um dia da semana.", "erro");
    return;
  }

  atualizarMedicamento(edicaoId, {
    quantidade,
    horario,
    frequencia: edicaoFrequencia,
    diasSemana:
      edicaoFrequencia === "todos"
        ? [0, 1, 2, 3, 4, 5, 6]
        : [...edicaoDias]
  });

  fecharEdicao();

  renderizarMedicamentos();
  atualizarResumo();
  await sincronizarLembretes();

  toast("Medicamento atualizado.", "sucesso");
});

/* -------------------------------- alarmes ------------------------------- */

async function atualizarStatusLembretes() {
  const status = await statusLembretes().catch(() => null);

  if (!status) {
    statusLembretesTexto.textContent =
      "Não foi possível verificar os lembretes neste dispositivo.";
    return;
  }

  const ativo = status.ativo;

  btnAtivarLembretes.textContent = ativo
    ? "Desativar lembretes"
    : "Ativar lembretes";

  btnAtivarLembretes.classList.toggle("btn-secundario", ativo);
  btnAtivarLembretes.classList.toggle("btn-primario", !ativo);

  if (!ativo) {
    statusLembretesTexto.textContent =
      "Ative os lembretes para receber um aviso no horário de cada medicamento.";
    return;
  }

  if (status.plataforma === "app") {
    statusLembretesTexto.textContent =
      status.permissao === "granted"
        ? "Lembretes ativos. As notificações chegam mesmo com o app fechado."
        : "Notificações bloqueadas no celular. Permita as notificações do MedLembre nas configurações do Android.";
    return;
  }

  statusLembretesTexto.textContent =
    status.permissao === "granted"
      ? "Lembretes ativos. No navegador, o aviso (notificação e voz) toca com esta página aberta."
      : "As notificações do navegador estão bloqueadas. O aviso por voz continua com a página aberta e o volume de mídia ligado.";
}

btnAtivarLembretes.addEventListener("click", async () => {
  btnAtivarLembretes.disabled = true;

  try {
    if (lembretesAtivos()) {
      const confirmar = window.confirm("Deseja desativar os lembretes?");

      if (!confirmar) return;

      const resultado = await desativarLembretes();
      toast(resultado.mensagem, "sucesso");
    } else {
      const resultado = await ativarLembretes();
      toast(resultado.mensagem, resultado.ok ? "sucesso" : "erro");
    }
  } catch (erro) {
    console.error("Erro nos lembretes:", erro);
    toast("Não foi possível configurar os lembretes.", "erro");
  } finally {
    btnAtivarLembretes.disabled = false;
    atualizarStatusLembretes();
  }
});

btnTestarAlarme.addEventListener("click", async () => {
  btnTestarAlarme.disabled = true;

  try {
    const nome = medicamentos[0]?.nome || "Losartana";
    const resultado = await testarAlarme(nome);

    toast(resultado.mensagem, "sucesso");
  } catch (erro) {
    console.error("Erro no teste de alarme:", erro);
    toast("Não foi possível tocar o alarme de teste.", "erro");
  } finally {
    btnTestarAlarme.disabled = false;
  }
});

/* ------------------------------- retomada -------------------------------- */

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !iniciado) return;

  medicamentos = getMedicamentos();
  renderizarMedicamentos();
  renderizarHistorico();
  atualizarResumo();
});

// Em APK, o botão físico "voltar" do Android é tratado pelo Capacitor;
// a navegação por hash continua funcionando normalmente.
if (isNativo()) {
  document.documentElement.classList.add("modo-nativo");
}
