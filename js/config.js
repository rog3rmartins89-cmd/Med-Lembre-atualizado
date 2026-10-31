/*
 * Configuração de tempo de execução.
 *
 * No navegador este arquivo pode ficar vazio: a busca de medicamentos passa
 * pelo proxy do server.js (/api/medicamentos).
 *
 * No APK, o script scripts/build-mobile.js gera uma cópia deste arquivo dentro
 * de build/ com a chave da API, porque o celular não tem acesso ao servidor
 * Node. A chave vem da variável de ambiente MEDICAMENTOS_API_KEY.
 */
window.MEDLEMBRE_CONFIG = window.MEDLEMBRE_CONFIG || {
  apiKey: "",
  apiBase: "https://medicamentos.api.br/api/v1"
};
