/*
 * Ponte com o Capacitor.
 *
 * O app roda em dois lugares:
 *  - navegador (servido pelo server.js);
 *  - APK Android (WebView do Capacitor).
 *
 * Os plugins nativos são acessados por esta camada para que o restante do
 * código não precise saber se está no navegador ou no celular.
 */

export function capacior() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

export function isNativo() {
  const capacitor = capacior();
  return Boolean(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform());
}

export function plataforma() {
  const capacitor = capacior();
  return capacitor && capacitor.getPlatform ? capacitor.getPlatform() : "web";
}

/**
 * Devolve a instância de um plugin nativo.
 * Funciona com ou sem o wrapper JavaScript instalado via npm, porque usa o
 * registerPlugin exposto pelo runtime do Capacitor.
 */
export function pluginNativo(nome) {
  const capacitor = capacior();

  if (!capacitor) return null;

  if (capacitor.Plugins && capacitor.Plugins[nome]) {
    return capacitor.Plugins[nome];
  }

  if (typeof capacitor.registerPlugin === "function") {
    try {
      return capacitor.registerPlugin(nome);
    } catch (erro) {
      console.warn(`Plugin ${nome} indisponível:`, erro);
      return null;
    }
  }

  return null;
}

/**
 * Chama um método de um plugin nativo.
 * Usa o wrapper quando existe e, como reserva, o nativePromise do Capacitor.
 */
export async function chamarNativo(nome, metodo, opcoes = {}) {
  const capacitor = capacior();

  if (!capacitor) {
    throw new Error("Recursos nativos indisponíveis neste ambiente.");
  }

  const plugin = pluginNativo(nome);

  if (plugin && typeof plugin[metodo] === "function") {
    return plugin[metodo](opcoes);
  }

  if (typeof capacitor.nativePromise === "function") {
    return capacitor.nativePromise(nome, metodo, opcoes);
  }

  throw new Error(`O recurso ${nome}.${metodo} não está disponível.`);
}
