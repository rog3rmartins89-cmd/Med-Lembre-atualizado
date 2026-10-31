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
import { getMedicamentos, dataLocalDe, CHAVES } from "./armazenamento.js";

const CANAL = "lembretes";
const ICONE = "assets/icons/icon-192.png";

let intervaloWeb = null;
let listenersRegistrados = false;

/* ----------------------------- utilidades ------------------------------ */

function falarTexto(texto) {
  try {
    if (!("speechSynthesis" in window)) return;

    const sintese = window.speechSynthesis;
    sintese.cancel();

    const vozes = sintese.getVoices();
    const vozPt =
      vozes.find(
        (voz) =>
          voz.lang &&
          voz.lang.toLowerCase().startsWith("pt-br") &&
          /female|feminina|maria|francisca|luciana|google/i.test(voz.name)
      ) ||
      vozes.find((voz) => voz.lang && voz.lang.toLowerCase().startsWith("pt-br")) ||
      null;

    const mensagem = new SpeechSynthesisUtterance(texto);
    mensagem.lang = "pt-BR";
    mensagem.rate = 0.9;
    mensagem.volume = 1;

    if (vozPt) mensagem.voice = vozPt;

    sintese.speak(mensagem);
  } catch (erro) {
    console.warn("Voz indisponível:", erro);
  }
}

export function falar(mensagem) {
  falarTexto(mensagem);
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

    if (hora * 60 + minuto !== minutosAgora) continue;

    const chave = `medlembre_disparo_${medicamento.id}_${medicamento.horario}_${dataLocal}`;

    if (localStorage.getItem(chave) === "true") continue;

    localStorage.setItem(chave, "true");

    const corpo = medicamento.quantidade
      ? `Tome ${medicamento.quantidade} de ${medicamento.nome}`
      : `Está na hora de tomar ${medicamento.nome}`;

    notificarWeb("💊 Hora do remédio", corpo, `med-${medicamento.id}`);
    falarTexto(`É hora de tomar ${medicamento.nome}`);
    vibrar();
  }
}

function iniciarVigiaWeb() {
  if (isNativo() || intervaloWeb) return;

  verificarWeb();
  intervaloWeb = window.setInterval(verificarWeb, 20000);
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
    notificarWeb(titulo, corpo, "med-teste");
  }

  falarTexto(`É hora de tomar ${nome}. É hora de tomar ${nome}.`);
  vibrar();

  return {
    ok: true,
    mensagem: "Alarme de teste disparado."
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
