/*
 * Lembretes de medicamentos.
 *
 * No APK: notificações locais agendadas pelo Android (funcionam mesmo com o
 * app fechado) usando @capacitor/local-notifications.
 *
 * No navegador: notificação do sistema (quando permitida) + fala, enquanto a
 * página estiver aberta.
 */

import { isNativo, chamarNativo, pluginNativo } from "./nativo.js";
import {
  getMedicamentos,
  dataLocalDe,
  doseJaRegistrada,
  CHAVES
} from "./armazenamento.js";

const CANAL = "lembretes";
const ICONE = "assets/icons/icon-192.png";

let intervaloWeb = null;
let listenersRegistrados = false;

/* ------------------------------- voz ----------------------------------- */

/*
 * Falar no celular tem três pegadinhas que fazem a voz sumir sem erro:
 *
 *  1. getVoices() costuma vir vazio nas primeiras chamadas, porque o aparelho
 *     ainda está carregando as vozes. Se falarmos nesse momento, silêncio.
 *  2. speechSynthesis.cancel() seguido de speak() na mesma tarefa faz o Chrome
 *     descartar a fala sem avisar.
 *  3. No Android a síntese às vezes começa "pausada" e nunca sai do lugar.
 *
 * Além disso, o WebView do APK nem sempre tem síntese de voz. Por isso o app
 * tenta primeiro o plugin nativo de voz e só depois a voz do navegador.
 */

let filaDeFala = Promise.resolve();
let vozesCarregando = null;
let contextoAudio = null;
let toqueRegistrado = false;

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/* ------------------------- som de alerta (bipe) ------------------------- */

/*
 * No iPhone o Chrome não tem notificações do site. Se a voz falhar, o bipe
 * ainda avisa. Também serve para Android/desktop quando o volume de mídia
 * está baixo e o usuário não percebe só a fala.
 */

function obterContextoAudio() {
  if (typeof window === "undefined") return null;

  const Ctor = window.AudioContext || window.webkitAudioContext;

  if (!Ctor) return null;

  if (!contextoAudio) {
    try {
      contextoAudio = new Ctor();
    } catch (erro) {
      return null;
    }
  }

  return contextoAudio;
}

function prepararSom() {
  const contexto = obterContextoAudio();

  if (!contexto) return;

  try {
    if (contexto.state === "suspended") contexto.resume().catch(() => {});

    // Toque inaudível: destrava o áudio depois do toque do usuário.
    const oscilador = contexto.createOscillator();
    const volume = contexto.createGain();

    volume.gain.value = 0.0001;
    oscilador.connect(volume).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.02);
  } catch (erro) {
    /* sem áudio */
  }
}

function alertaSonoro() {
  const contexto = obterContextoAudio();

  if (!contexto) return;

  try {
    if (contexto.state === "suspended") contexto.resume().catch(() => {});

    const inicio = contexto.currentTime;

    [0, 0.4].forEach((atraso) => {
      const oscilador = contexto.createOscillator();
      const volume = contexto.createGain();

      oscilador.type = "sine";
      oscilador.frequency.value = 880;

      volume.gain.setValueAtTime(0.0001, inicio + atraso);
      volume.gain.exponentialRampToValueAtTime(0.3, inicio + atraso + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, inicio + atraso + 0.3);

      oscilador.connect(volume).connect(contexto.destination);
      oscilador.start(inicio + atraso);
      oscilador.stop(inicio + atraso + 0.32);
    });
  } catch (erro) {
    /* sem áudio */
  }
}

/*
 * Diagnóstico temporário: registra no servidor o que aconteceu com a voz
 * (nunca o nome do medicamento nem dados da conta).
 */
function relatarVoz(etapa, detalhe = "") {
  if (isNativo()) return;

  try {
    fetch("/diagnostico/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        etapa,
        codigo: String(detalhe || "").slice(0, 120),
        mensagem: "",
        agente: navigator.userAgent || ""
      }),
      keepalive: true
    }).catch(() => {});
  } catch (erro) {
    /* diagnóstico nunca deve atrapalhar o alarme */
  }
}

function carregarVozes() {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);

  const sintese = window.speechSynthesis;
  const atuais = sintese.getVoices();

  if (atuais && atuais.length) return Promise.resolve(atuais);

  if (!vozesCarregando) {
    vozesCarregando = new Promise((resolver) => {
      let concluido = false;

      const terminar = () => {
        if (concluido) return;
        concluido = true;

        if (typeof sintese.removeEventListener === "function") {
          sintese.removeEventListener("voiceschanged", terminar);
        }

        resolver(sintese.getVoices() || []);
      };

      if (typeof sintese.addEventListener === "function") {
        sintese.addEventListener("voiceschanged", terminar);
      }

      // Se o aparelho não avisar quando as vozes carregarem, não travamos o app.
      setTimeout(terminar, 1500);
    }).then((vozes) => {
      // Lista vazia pode ser só demora: permite tentar de novo na próxima fala.
      if (!vozes.length) vozesCarregando = null;
      return vozes;
    });
  }

  return vozesCarregando;
}

function escolherVoz(vozes) {
  if (!Array.isArray(vozes) || !vozes.length) return null;

  const ehPortugues = (voz) =>
    String((voz && voz.lang) || "").toLowerCase().startsWith("pt");

  const feminina = /female|feminina|maria|francisca|luciana|google/i;

  return (
    vozes.find(
      (voz) => ehPortugues(voz) && feminina.test(String(voz.name || ""))
    ) ||
    vozes.find((voz) => ehPortugues(voz)) ||
    null
  );
}

async function falarNativo(texto) {
  const plugin = pluginNativo("TextToSpeech");

  if (!plugin) return false;

  try {
    await chamarNativo("TextToSpeech", "speak", {
      text: texto,
      lang: "pt-BR",
      rate: 0.9,
      pitch: 1,
      volume: 1
    });

    return true;
  } catch (erro) {
    console.warn("Voz nativa indisponível, tentando a do navegador:", erro);
    return false;
  }
}

async function falarNoNavegador(texto) {
  if (
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance !== "function"
  ) {
    relatarVoz("voz:sem-suporte");
    return;
  }

  const sintese = window.speechSynthesis;
  const vozes = await carregarVozes();
  const voz = escolherVoz(vozes);

  try {
    sintese.cancel();
  } catch (erro) {
    /* ignore */
  }

  // Sem este respiro o Chrome ignora a fala depois do cancel().
  await esperar(150);

  const mensagem = new SpeechSynthesisUtterance(texto);

  mensagem.lang = (voz && voz.lang) || "pt-BR";
  mensagem.rate = 0.9;
  mensagem.volume = 1;

  if (voz) mensagem.voice = voz;

  mensagem.onstart = () => relatarVoz("voz:iniciou");
  mensagem.onend = () => relatarVoz("voz:terminou");
  mensagem.onerror = (evento) =>
    relatarVoz(
      "voz:erro",
      (evento && (evento.error || evento.message)) || "desconhecido"
    );

  try {
    if (sintese.paused) sintese.resume();
    sintese.speak(mensagem);
  } catch (erro) {
    relatarVoz("voz:excecao", (erro && erro.message) || "");
    return;
  }

  relatarVoz(
    voz ? "voz:falando" : "voz:falando-sem-voz-pt",
    voz ? `${voz.lang}|${voz.name}` : `vozes=${vozes.length}`
  );

  // No Android a síntese pode ficar parada em "pausada".
  setTimeout(() => {
    try {
      if (sintese.paused) sintese.resume();
    } catch (erro) {
      /* ignore */
    }
  }, 600);
}

async function tentarFalar(texto) {
  if (isNativo() && (await falarNativo(texto))) return;

  await falarNoNavegador(texto);
}

/*
 * As falas entram numa fila: duas ao mesmo tempo se cancelariam no celular.
 * Quem chama não precisa esperar (o alarme toca em segundo plano).
 */
function falarTexto(texto) {
  const conteudo = String(texto || "").trim();

  if (!conteudo) return filaDeFala;

  filaDeFala = filaDeFala
    .then(() => tentarFalar(conteudo))
    .catch((erro) => {
      console.warn("Voz indisponível:", erro);
      relatarVoz("voz:falha", (erro && erro.message) || "");
    });

  return filaDeFala;
}

export function falar(mensagem) {
  return falarTexto(mensagem);
}

/* Usado pela tela de lembretes para avisar quando o aparelho não tem voz. */
export async function vozDisponivel() {
  if (isNativo()) return Boolean(pluginNativo("TextToSpeech"));
  if (!("speechSynthesis" in window)) return false;

  const vozes = await carregarVozes();

  return vozes.length > 0 || typeof SpeechSynthesisUtterance === "function";
}

/*
 * "Destrava" o áudio do navegador. Precisa ser chamado de dentro de um toque
 * do usuário (um clique), senão o celular mantém a voz bloqueada.
 */
export function prepararVoz() {
  // O bipe também precisa de um toque para ser liberado no celular.
  prepararSom();

  if (!("speechSynthesis" in window)) return;

  try {
    const sintese = window.speechSynthesis;
    sintese.resume();

    const aquece = new SpeechSynthesisUtterance(" ");
    aquece.volume = 0.01;
    aquece.lang = "pt-BR";
    sintese.speak(aquece);
  } catch (erro) {
    /* sem áudio liberado */
  }
}

function vibrar(padrao = [200, 120, 200]) {
  try {
    if (navigator.vibrate) navigator.vibrate(padrao);
  } catch (erro) {
    /* sem vibração */
  }
}

function idNotificacao(chave) {
  let hash = 2166136261;

  for (let i = 0; i < chave.length; i += 1) {
    hash ^= chave.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const positivo = Math.abs(hash) % 2000000000;

  return positivo === 0 ? 1 : positivo;
}

function horarioValido(horario) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(horario || ""));
}

function partesHorario(horario) {
  const [hora, minuto] = String(horario).split(":").map(Number);
  return { hora, minuto };
}

export function lembretesAtivos() {
  return localStorage.getItem(CHAVES.lembretes) === "true";
}

function definirAtivos(ativo) {
  localStorage.setItem(CHAVES.lembretes, ativo ? "true" : "false");
}

/* --------------------------- Android / nativo -------------------------- */

async function criarCanal() {
  try {
    await chamarNativo("LocalNotifications", "createChannel", {
      id: CANAL,
      name: "Lembretes de medicamentos",
      description: "Avisos nos horários dos seus medicamentos",
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: "#087E83"
    });
  } catch (erro) {
    console.warn("Não foi possível criar o canal de notificações:", erro);
  }
}

async function pedirPermissaoNotificacoes() {
  const atual = await chamarNativo("LocalNotifications", "checkPermissions").catch(
    () => null
  );

  if (atual && atual.display === "granted") return "granted";

  const pedido = await chamarNativo("LocalNotifications", "requestPermissions")
    .catch(() => null);

  return pedido ? pedido.display : "denied";
}

async function cancelarNotificacoesDoApp() {
  try {
    const pendentes = await chamarNativo("LocalNotifications", "getPending");
    const nossas = (pendentes.notifications || [])
      .filter((item) => item.extra && item.extra.medlembre)
      .map((item) => ({ id: item.id }));

    if (nossas.length) {
      await chamarNativo("LocalNotifications", "cancel", {
        notifications: nossas
      });
    }
  } catch (erro) {
    console.warn("Não foi possível limpar notificações antigas:", erro);
  }
}

function montarNotificacoes(medicamentos) {
  const notificacoes = [];

  for (const medicamento of medicamentos) {
    if (!horarioValido(medicamento.horario)) continue;

    const { hora, minuto } = partesHorario(medicamento.horario);
    const dias =
      medicamento.frequencia === "especificos"
        ? medicamento.diasSemana
        : [0, 1, 2, 3, 4, 5, 6];

    const corpo = medicamento.quantidade
      ? `Está na hora de tomar ${medicamento.nome} — ${medicamento.quantidade}`
      : `Está na hora de tomar ${medicamento.nome}`;

    for (const dia of dias) {
      const id = idNotificacao(`${medicamento.id}-${dia}-${medicamento.horario}`);

      notificacoes.push({
        id,
        title: "💊 Hora do remédio",
        body: corpo,
        largeBody: corpo,
        summaryText: "MedLembre",
        channelId: CANAL,
        schedule: {
          on: {
            weekday: dia + 1,
            hour: hora,
            minute: minuto
          },
          repeats: true,
          allowWhileIdle: true,
          isExactNotification: true
        },
        extra: {
          medlembre: true,
          medicamentoId: medicamento.id,
          horario: medicamento.horario
        }
      });
    }
  }

  return notificacoes;
}

async function sincronizarNativo() {
  const medicamentos = getMedicamentos();

  await criarCanal();
  await cancelarNotificacoesDoApp();

  if (!medicamentos.length) return;

  const notificacoes = montarNotificacoes(medicamentos);

  if (!notificacoes.length) return;

  try {
    await chamarNativo("LocalNotifications", "schedule", { notifications });
  } catch (erro) {
    console.error("Falha ao agendar lembretes:", erro);

    // Sem permissão de alarme exato o Android ainda pode entregar, só que com
    // alguns minutos de tolerância.
    const tolerantes = notificacoes.map((notificacao) => ({
      ...notificacao,
      schedule: {
        ...notificacao.schedule,
        isExactNotification: false
      }
    }));

    await chamarNativo("LocalNotifications", "schedule", {
      notifications: tolerantes
    }).catch((erroTolerante) => {
      console.error("Falha ao agendar lembretes tolerantes:", erroTolerante);
    });
  }
}

/* ------------------------------ Navegador ------------------------------ */

function notificarWeb(titulo, corpo, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  try {
    const notificacao = new Notification(titulo, {
      body: corpo,
      icon: ICONE,
      tag,
      badge: ICONE
    });

    notificacao.onclick = () => {
      window.focus();
      notificacao.close();
    };

    setTimeout(() => notificacao.close(), 30000);
  } catch (erro) {
    console.warn("Notificação do navegador indisponível:", erro);
  }
}

function diaPermitido(medicamento, diaSemana) {
  if (medicamento.frequencia !== "especificos") return true;

  return (medicamento.diasSemana || []).includes(diaSemana);
}

function verificarWeb() {
  const agora = new Date();
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const dataLocal = dataLocalDe(agora);
  const diaSemana = agora.getDay();

  for (const medicamento of getMedicamentos()) {
    if (!horarioValido(medicamento.horario)) continue;
    if (!diaPermitido(medicamento, diaSemana)) continue;

    const { hora, minuto } = partesHorario(medicamento.horario);
    const minutosAlvo = hora * 60 + minuto;
    const atraso = minutosAgora - minutosAlvo;

    /*
     * O navegador atrasa (ou congela) os timers quando a aba fica em segundo
     * plano. Antes só disparava no minuto exato — qualquer atraso fazia o
     * alarme passar em branco. Agora aceitamos alguns minutos de tolerância.
     */
    if (atraso < 0 || atraso > 4) continue;

    const chave = `medlembre_disparo_${medicamento.id}_${medicamento.horario}_${dataLocal}`;

    if (localStorage.getItem(chave) === "true") continue;

    // Se a dose já foi registrada no histórico, não avisa de novo.
    if (doseJaRegistrada(medicamento.id, medicamento.horario, dataLocal)) {
      localStorage.setItem(chave, "true");
      continue;
    }

    localStorage.setItem(chave, "true");

    const corpo = medicamento.quantidade
      ? `Tome ${medicamento.quantidade} de ${medicamento.nome}`
      : `Está na hora de tomar ${medicamento.nome}`;

    notificarWeb("💊 Hora do remédio", corpo, `med-${medicamento.id}`);
    alertaSonoro();
    falarTexto(
      `É hora de tomar ${medicamento.nome}. É hora de tomar ${medicamento.nome}.`
    );
    vibrar();
    relatarVoz("alarme:disparado", `atraso=${atraso}`);
  }
}

function iniciarVigiaWeb() {
  if (isNativo() || intervaloWeb) return;

  verificarWeb();
  intervaloWeb = window.setInterval(verificarWeb, 20000);

  /*
   * Ao voltar para o app (ou destravar a tela), confere na hora se algum
   * horário passou enquanto a página estava congelada.
   */
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") verificarWeb();
    });

    /*
     * No iPhone a voz e o som só são liberados depois de um toque na página.
     * Destravamos no primeiro toque, seja qual for, para o alarme poder falar
     * mais tarde sem depender do botão de lembretes.
     */
    if (!toqueRegistrado) {
      toqueRegistrado = true;

      document.addEventListener(
        "pointerdown",
        () => {
          prepararVoz();
        },
        { once: true, passive: true }
      );
    }
  }
}

function pararVigiaWeb() {
  if (intervaloWeb) {
    window.clearInterval(intervaloWeb);
    intervaloWeb = null;
  }
}

/* ------------------------------- API ----------------------------------- */

export async function sincronizarLembretes() {
  if (!lembretesAtivos()) return;

  if (isNativo()) {
    await sincronizarNativo();
    return;
  }

  iniciarVigiaWeb();
}

export async function ativarLembretes() {
  if (isNativo()) {
    const permissao = await pedirPermissaoNotificacoes().catch(() => "denied");

    if (permissao !== "granted") {
      return {
        ok: false,
        motivo: "permissao",
        mensagem:
          "Permita as notificações do MedLembre nas configurações do celular para receber os lembretes."
      };
    }

    await criarCanal();
    definirAtivos(true);
    await sincronizarNativo();

    let aviso = "";

    try {
      const alarmeExato = await chamarNativo(
        "LocalNotifications",
        "checkExactNotificationSetting"
      );

      if (alarmeExato && alarmeExato.exact_alarm !== "granted") {
        aviso =
          "Dica: permita 'Alarmes e lembretes' nas configurações para os avisos chegarem no horário exato.";
      }
    } catch (erro) {
      /* recurso opcional */
    }

    return {
      ok: true,
      mensagem:
        "Lembretes ativados! Você será avisado nos horários cadastrados." +
        (aviso ? ` ${aviso}` : "")
    };
  }

  definirAtivos(true);

  // Aproveita o toque para liberar o áudio do navegador.
  prepararVoz();

  if ("Notification" in window && Notification.permission !== "granted") {
    const permissao = await Notification.requestPermission().catch(
      () => "denied"
    );

    if (permissao !== "granted") {
      return {
        ok: true,
        mensagem:
          "Lembretes ativados, mas o navegador não permitiu notificações. " +
          "O aviso por voz continuará funcionando com a página aberta."
      };
    }
  }

  iniciarVigiaWeb();

  // Aproveita o toque para liberar a voz no celular.
  falarTexto("Lembretes ativados.");

  return {
    ok: true,
    mensagem:
      "Lembretes ativados! No navegador eles funcionam enquanto o app estiver aberto."
  };
}

export async function desativarLembretes() {
  definirAtivos(false);
  pararVigiaWeb();

  if (isNativo()) {
    await cancelarNotificacoesDoApp();
  }

  return { ok: true, mensagem: "Lembretes desativados." };
}

export async function statusLembretes() {
  let plataforma = "navegador";
  let permissao = "indefinida";

  if (isNativo()) {
    plataforma = "app";

    const atual = await chamarNativo("LocalNotifications", "checkPermissions")
      .catch(() => null);

    permissao = atual ? atual.display : "desconhecida";
  } else if ("Notification" in window) {
    permissao = Notification.permission;
  } else {
    permissao = "indisponivel";
  }

  return {
    ativo: lembretesAtivos(),
    plataforma,
    permissao,
    suportado: isNativo() || "Notification" in window
  };
}

export async function testarAlarme(nome = "Losartana") {
  const titulo = "💊 Hora do remédio";
  const corpo = `Está na hora de tomar ${nome}`;

  if (isNativo()) {
    await criarCanal();

    const permissao = await pedirPermissaoNotificacoes().catch(() => "denied");

    if (permissao === "granted") {
      await chamarNativo("LocalNotifications", "schedule", {
        notifications: [
          {
            id: idNotificacao(`teste-${Date.now()}`),
            title: titulo,
            body: corpo,
            channelId: CANAL,
            schedule: { at: new Date(Date.now() + 1000) },
            extra: { medlembre: true, teste: true }
          }
        ]
      }).catch((erro) => console.warn("Teste de notificação falhou:", erro));
    }
  } else {
    prepararVoz();
    notificarWeb(titulo, corpo, "med-teste");
    alertaSonoro();
  }

  falarTexto(`É hora de tomar ${nome}. É hora de tomar ${nome}.`);
  vibrar();

  return {
    ok: true,
    mensagem:
      "Alarme de teste disparado. Se a voz não sair, aumente o volume de mídia do celular."
  };
}

export async function registrarListeners({ aoReceber } = {}) {
  if (!isNativo() || listenersRegistrados) return;

  listenersRegistrados = true;

  const instancia = pluginNativo("LocalNotifications");

  if (!instancia || typeof instancia.addListener !== "function") return;

  try {
    await instancia.addListener("localNotificationReceived", (notificacao) => {
      const idMedicamento =
        (notificacao.extra && notificacao.extra.medicamentoId) || "";

      const encontrado = getMedicamentos().find(
        (item) => item.id === idMedicamento
      );

      falarTexto(
        `É hora de tomar ${encontrado ? encontrado.nome : "seu medicamento"}`
      );
      vibrar();

      if (typeof aoReceber === "function") {
        aoReceber(notificacao, encontrado);
      }
    });
  } catch (erro) {
    console.warn("Não foi possível ouvir notificações:", erro);
  }
}
