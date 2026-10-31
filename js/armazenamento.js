/*
 * Camada de armazenamento do MedLembre.
 * Mantém medicamentos e histórico no localStorage, já normalizados, para que
 * versões antigas dos dados continuem funcionando.
 */

export const CHAVES = {
  medicamentos: "medlembre_medicamentos",
  historico: "medlembre_historico",
  tema: "medlembre_tema",
  contraste: "medlembre_alto_contraste",
  fonte: "medlembre_tamanho_fonte",
  lembretes: "medlembre_lembretes_ativos",
  canal: "medlembre_canal_notificacoes"
};

export function gerarId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `med-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function lerJson(chave, padrao) {
  try {
    const valor = JSON.parse(localStorage.getItem(chave));

    if (valor === null || valor === undefined) return padrao;

    return valor;
  } catch (erro) {
    console.warn(`Não foi possível ler ${chave}:`, erro);
    return padrao;
  }
}

function gravarJson(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (erro) {
    console.error(`Não foi possível salvar ${chave}:`, erro);
    return false;
  }
}

export function dataLocalDe(data = new Date()) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0")
  ].join("-");
}

export function normalizarMedicamento(medicamento = {}) {
  const frequencia =
    medicamento.frequencia === "especificos" ? "especificos" : "todos";

  let diasSemana = Array.isArray(medicamento.diasSemana)
    ? medicamento.diasSemana.map(Number)
    : [];

  diasSemana = [...new Set(diasSemana.filter((dia) => dia >= 0 && dia <= 6))];

  if (frequencia === "todos") {
    diasSemana = [0, 1, 2, 3, 4, 5, 6];
  }

  if (frequencia === "especificos" && diasSemana.length === 0) {
    diasSemana = [0, 1, 2, 3, 4, 5, 6];
  }

  diasSemana.sort((a, b) => a - b);

  return {
    id: medicamento.id || gerarId(),
    nome: String(medicamento.nome || "").trim(),
    quantidade: String(medicamento.quantidade || "").trim(),
    horario: String(medicamento.horario || "").trim(),
    apresentacao: medicamento.apresentacao || null,
    frequencia,
    diasSemana,
    criadoEm: medicamento.criadoEm || new Date().toISOString()
  };
}

export function getMedicamentos() {
  const lista = lerJson(CHAVES.medicamentos, []);

  if (!Array.isArray(lista)) return [];

  return lista
    .filter((item) => item && typeof item === "object")
    .map(normalizarMedicamento)
    .filter((item) => item.nome && item.horario);
}

export function salvarMedicamentos(lista) {
  return gravarJson(
    CHAVES.medicamentos,
    (Array.isArray(lista) ? lista : []).map(normalizarMedicamento)
  );
}

export function adicionarMedicamento(medicamento) {
  const lista = getMedicamentos();
  const novo = normalizarMedicamento(medicamento);

  lista.push(novo);
  salvarMedicamentos(lista);

  return novo;
}

export function atualizarMedicamento(id, alteracoes) {
  const lista = getMedicamentos();
  const indice = lista.findIndex((item) => item.id === id);

  if (indice === -1) return null;

  lista[indice] = normalizarMedicamento({
    ...lista[indice],
    ...alteracoes,
    id
  });

  salvarMedicamentos(lista);

  return lista[indice];
}

export function removerMedicamento(id) {
  const lista = getMedicamentos().filter((item) => item.id !== id);
  salvarMedicamentos(lista);
  return lista;
}

export function formatarApresentacao(apresentacao) {
  if (!apresentacao) return "";

  if (typeof apresentacao === "string") return apresentacao;

  return String(
    apresentacao.descricao || apresentacao.apresentacao || ""
  ).trim();
}

export function getHistorico() {
  const lista = lerJson(CHAVES.historico, []);

  if (!Array.isArray(lista)) return [];

  return lista.filter(
    (item) => item && typeof item === "object" && item.nome && item.tomadoEm
  );
}

export function salvarHistorico(lista) {
  return gravarJson(CHAVES.historico, Array.isArray(lista) ? lista : []);
}

export function doseJaRegistrada(
  medicamentoId,
  horarioProgramado,
  dataLocal = dataLocalDe()
) {
  return getHistorico().some(
    (registro) =>
      registro.medicamentoId === medicamentoId &&
      registro.dataLocal === dataLocal &&
      registro.horarioProgramado === horarioProgramado
  );
}

export function dosesTomadasHoje(dataLocal = dataLocalDe()) {
  return getHistorico().filter((registro) => registro.dataLocal === dataLocal)
    .length;
}

/**
 * Registra uma dose no histórico.
 * Retorna { ok: true, registro } ou { ok: false, motivo }.
 */
export function registrarDose(medicamento, agora = new Date()) {
  const historico = getHistorico();
  const dataLocal = dataLocalDe(agora);

  const duplicada = historico.some(
    (registro) =>
      registro.medicamentoId === medicamento.id &&
      registro.dataLocal === dataLocal &&
      registro.horarioProgramado === medicamento.horario
  );

  if (duplicada) {
    return { ok: false, motivo: "duplicada" };
  }

  const registro = {
    id: gerarId(),
    medicamentoId: medicamento.id,
    nome: medicamento.nome,
    quantidade: medicamento.quantidade,
    apresentacao: formatarApresentacao(medicamento.apresentacao),
    horarioProgramado: medicamento.horario,
    dataLocal,
    tomadoEm: agora.toISOString()
  };

  historico.push(registro);

  if (!salvarHistorico(historico)) {
    return { ok: false, motivo: "armazenamento" };
  }

  return { ok: true, registro };
}

export function removerRegistroHistorico(id) {
  const atualizado = getHistorico().filter((registro) => registro.id !== id);
  salvarHistorico(atualizado);
  return atualizado;
}
