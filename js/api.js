/*
 * Consulta de medicamentos.
 *
 * Navegador: usa o proxy do server.js (/api/medicamentos), que guarda a chave
 * da API no servidor.
 *
 * APK: não existe servidor Node no celular, então a chamada é feita direto
 * pela API usando CapacitorHttp (sem bloqueio de CORS). A chave é injetada no
 * build por scripts/build-mobile.js.
 */

import { isNativo, chamarNativo } from "./nativo.js";

const API_PADRAO = "https://medicamentos.api.br/api/v1";
const TEMPO_LIMITE = 15000;

function configuracao() {
  return window.MEDLEMBRE_CONFIG || {};
}

function baseApi() {
  const config = configuracao();
  const base = String(config.apiBase || API_PADRAO).replace(/\/+$/, "");
  return base;
}

export function buscaDisponivelNoAparelho() {
  const config = configuracao();
  return Boolean(isNativo() && config.apiKey);
}

async function respostaJson(resposta) {
  if (resposta && typeof resposta.data === "string") {
    try {
      return JSON.parse(resposta.data);
    } catch (erro) {
      throw new Error("A API retornou uma resposta inválida.");
    }
  }

  return resposta ? resposta.data : null;
}

async function pedirNaturo(caminho, parametros = {}) {
  const config = configuracao();

  if (!config.apiKey) {
    throw new Error(
      "A busca de medicamentos não está configurada neste aplicativo. " +
        "Gere o APK com a variável MEDICAMENTOS_API_KEY."
    );
  }

  let resposta;

  try {
    resposta = await chamarNativo("CapacitorHttp", "get", {
      url: `${baseApi()}${caminho}`,
      params: parametros,
      headers: {
        Accept: "application/json",
        "X-API-Key": config.apiKey
      },
      connectTimeout: TEMPO_LIMITE,
      readTimeout: TEMPO_LIMITE
    });
  } catch (erro) {
    console.error("Falha na consulta nativa:", erro);
    throw new Error("Erro de conexão com a API de medicamentos.");
  }

  const dados = await respostaJson(resposta);

  if (resposta.status < 200 || resposta.status >= 300) {
    const mensagem =
      (dados && (dados.erro || dados.message)) ||
      "Não foi possível consultar a base de medicamentos.";

    throw new Error(mensagem);
  }

  return dados;
}

async function pedirProxy(caminho, parametros = {}) {
  const query = new URLSearchParams(parametros).toString();
  const url = `/api${caminho}${query ? `?${query}` : ""}`;

  let resposta;

  try {
    resposta = await fetch(url, {
      headers: { Accept: "application/json" }
    });
  } catch (erro) {
    console.error("Falha na consulta ao servidor:", erro);
    throw new Error(
      "Não foi possível conectar ao servidor do MedLembre. " +
        "Verifique sua internet e tente novamente."
    );
  }

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new Error(
      dados.erro || "Não foi possível consultar a base de medicamentos."
    );
  }

  return dados;
}

function pedir(caminho, parametros) {
  if (isNativo()) {
    return pedirNaturo(caminho, parametros);
  }

  return pedirProxy(caminho, parametros);
}

export async function buscarMedicamentos(nome) {
  const termo = String(nome || "").trim();

  if (termo.length < 2) {
    throw new Error("Digite pelo menos 2 letras do nome do medicamento.");
  }

  return pedir("/medicamentos", {
    nome: termo,
    pagina: "1"
  });
}

/*
 * O detalhe do medicamento chega em dois formatos:
 * - pela API oficial (usado no APK): cmed.apresentacoes com "apresentacao";
 * - pelo proxy do servidor: apresentacoes com "descricao".
 * A normalização deixa o painel independente de onde a consulta foi feita.
 */
function normalizarDetalhe(dados, registro) {
  const detalhe = dados || {};
  const lista = Array.isArray(detalhe.apresentacoes)
    ? detalhe.apresentacoes
    : Array.isArray(detalhe.cmed?.apresentacoes)
      ? detalhe.cmed.apresentacoes
      : [];

  const apresentacoes = lista
    .map((item) => ({
      codigo: item.codigo ?? item.codigoGgrem ?? "",
      descricao: item.descricao ?? item.apresentacao ?? "",
      ean: Array.isArray(item.ean) ? item.ean : []
    }))
    .filter((item) => item.descricao);

  return {
    registro: detalhe.registro || registro,
    nome: detalhe.nome || "",
    fabricante: detalhe.fabricante || "",
    principioAtivo: detalhe.principioAtivo || "",
    apresentacoes
  };
}

export async function buscarApresentacoes(registro) {
  const numero = String(registro || "").trim();

  if (!/^\d{9}$/.test(numero)) {
    throw new Error("Registro Anvisa inválido.");
  }

  return normalizarDetalhe(await pedir(`/medicamentos/${numero}`), numero);
}
