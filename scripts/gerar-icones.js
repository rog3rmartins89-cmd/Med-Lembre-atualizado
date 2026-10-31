#!/usr/bin/env node
/*
 * Gera os ícones e as telas de abertura do MedLembre em PNG.
 *
 * Não usa nenhuma dependência externa: desenha as formas com distância
 * assinada (SDF), o que já produz bordas suaves em qualquer tamanho, e grava
 * o PNG com o zlib nativo do Node.
 *
 * Uso: npm run icones
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const RAIZ = path.resolve(__dirname, "..");
const PASTA_ICONES = path.join(RAIZ, "assets", "icons");
const PASTA_SPLASH = path.join(RAIZ, "assets", "splash");

const TEAL_CLARO = [22, 179, 168];
const TEAL_ESCURO = [4, 92, 98];
const BRANCO = [255, 255, 255];
const BRANCO_SUAVE = [212, 242, 239];
const DIVISOR = [10, 125, 128];
const FUNDO_CLARO = [234, 245, 242];
const FUNDO_ESCURO = [12, 20, 30];

const ANGULO = -Math.PI / 4;
const EIXO_X = Math.cos(ANGULO);
const EIXO_Y = Math.sin(ANGULO);

/* ---------------------------- utilidades -------------------------------- */

function limitar(valor, minimo, maximo) {
  return valor < minimo ? minimo : valor > maximo ? maximo : valor;
}

function suave(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

function cobertura(distancia) {
  return limitar(0.5 - distancia, 0, 1);
}

/* ------------------------------- formas --------------------------------- */

function sdfRetanguloArredondado(x, y, cx, cy, meiaLargura, meiaAltura, raio) {
  const qx = Math.abs(x - cx) - (meiaLargura - raio);
  const qy = Math.abs(y - cy) - (meiaAltura - raio);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);

  return (
    Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - raio
  );
}

function sdfCapsula(x, y, cx, cy, metade, raio) {
  const dx = x - cx;
  const dy = y - cy;
  const t = limitar(dx * EIXO_X + dy * EIXO_Y, -metade, metade);
  const px = dx - EIXO_X * t;
  const py = dy - EIXO_Y * t;

  return Math.sqrt(px * px + py * py) - raio;
}

/* ----------------------------- composição -------------------------------- */

function pintar(dados, indice, r, g, b, alfa) {
  if (alfa <= 0) return;

  const alfaDestino = dados[indice + 3] / 255;
  const alfaFinal = alfa + alfaDestino * (1 - alfa);

  if (alfaFinal <= 0) return;

  dados[indice] = Math.round(
    (r * alfa + dados[indice] * alfaDestino * (1 - alfa)) / alfaFinal
  );
  dados[indice + 1] = Math.round(
    (g * alfa + dados[indice + 1] * alfaDestino * (1 - alfa)) / alfaFinal
  );
  dados[indice + 2] = Math.round(
    (b * alfa + dados[indice + 2] * alfaDestino * (1 - alfa)) / alfaFinal
  );
  dados[indice + 3] = Math.round(alfaFinal * 255);
}

function corGradiente(t) {
  const fator = suave(limitar(t, 0, 1));

  return [
    Math.round(TEAL_CLARO[0] + (TEAL_ESCURO[0] - TEAL_CLARO[0]) * fator),
    Math.round(TEAL_CLARO[1] + (TEAL_ESCURO[1] - TEAL_CLARO[1]) * fator),
    Math.round(TEAL_CLARO[2] + (TEAL_ESCURO[2] - TEAL_CLARO[2]) * fator)
  ];
}

/**
 * Desenha uma pílula (cápsula) com metade clara e metade levemente colorida,
 * separadas por uma linha fina.
 */
function desenharPilula(dados, tamanho, centroX, centroY, comprimento, espessura) {
  const raio = espessura / 2;
  const metade = Math.max(0, comprimento / 2 - raio);

  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const distancia = sdfCapsula(px, py, centroX, centroY, metade, raio);
      const alfa = cobertura(distancia);

      if (alfa <= 0) continue;

      const indice = (y * tamanho + x) * 4;
      const u = (px - centroX) * EIXO_X + (py - centroY) * EIXO_Y;

      if (u > 0) {
        pintar(dados, indice, BRANCO_SUAVE[0], BRANCO_SUAVE[1], BRANCO_SUAVE[2], alfa);
      } else {
        pintar(dados, indice, BRANCO[0], BRANCO[1], BRANCO[2], alfa);
      }

      const divisor = 1 - suave(Math.abs(u) / 5);

      if (divisor > 0) {
        pintar(
          dados,
          indice,
          DIVISOR[0],
          DIVISOR[1],
          DIVISOR[2],
          alfa * divisor * 0.9
        );
      }
    }
  }
}

/**
 * Ícone quadrado com fundo em gradiente (opcionalmente arredondado) e pílula.
 */
function renderizarIcone(tamanho, opcoes = {}) {
  const {
    arredondado = true,
    fundo = true,
    escalaPilula = 1,
    pilula = true
  } = opcoes;

  const dados = new Uint8ClampedArray(tamanho * tamanho * 4);
  const raioCanto = arredondado ? tamanho * 0.225 : 0;

  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const indice = (y * tamanho + x) * 4;

      if (fundo) {
        const t = (px + py) / (2 * tamanho);
        const cor = corGradiente(t);

        let alfa = 1;

        if (arredondado) {
          const distancia = sdfRetanguloArredondado(
            px,
            py,
            tamanho / 2,
            tamanho / 2,
            tamanho / 2,
            tamanho / 2,
            raioCanto
          );

          alfa = cobertura(distancia);
        }

        pintar(dados, indice, cor[0], cor[1], cor[2], alfa);
      }
    }
  }

  // Sombra suave embaixo da pílula.
  const comprimento = tamanho * 0.56 * escalaPilula;
  const espessura = tamanho * 0.24 * escalaPilula;

  if (!pilula) return dados;

  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const indice = (y * tamanho + x) * 4;

      const distancia = sdfCapsula(
        px,
        py,
        tamanho / 2,
        tamanho / 2 + tamanho * 0.022,
        Math.max(0, comprimento / 2 - espessura / 2),
        espessura / 2
      );

      const desfoque = tamanho * 0.025;
      const alfa =
        0.26 * (1 - suave((distancia + desfoque) / (2 * desfoque)));

      if (alfa <= 0) continue;

      pintar(dados, indice, 2, 45, 44, alfa);
    }
  }

  desenharPilula(
    dados,
    tamanho,
    tamanho / 2,
    tamanho / 2,
    comprimento,
    espessura
  );

  return dados;
}

/**
 * Splash quadrada: fundo liso e um "selo" com o logotipo no centro.
 */
function renderizarSplash(tamanho, escuro = false) {
  const dados = new Uint8ClampedArray(tamanho * tamanho * 4);
  const fundo = escuro ? FUNDO_ESCURO : FUNDO_CLARO;

  const ladrilho = tamanho * 0.36;
  const raio = ladrilho * 0.24;
  const centro = tamanho / 2;

  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const indice = (y * tamanho + x) * 4;

      pintar(dados, indice, fundo[0], fundo[1], fundo[2], 1);

      // Sombra do ladrilho.
      const sombra = sdfRetanguloArredondado(
        px,
        py,
        centro,
        centro + ladrilho * 0.035,
        ladrilho / 2,
        ladrilho / 2,
        raio
      );

      const desfoque = ladrilho * 0.05;
      const alfaSombra =
        0.2 * (1 - suave((sombra + desfoque) / (2 * desfoque)));

      if (alfaSombra > 0.002) {
        pintar(dados, indice, 0, 40, 40, alfaSombra);
      }

      // Ladrilho em gradiente.
      const distancia = sdfRetanguloArredondado(
        px,
        py,
        centro,
        centro,
        ladrilho / 2,
        ladrilho / 2,
        raio
      );

      const alfaLadrilho = cobertura(distancia);

      if (alfaLadrilho > 0) {
        const t = (px - centro) / ladrilho + (py - centro) / ladrilho + 0.5;
        const cor = corGradiente(t);

        pintar(
          dados,
          indice,
          cor[0],
          cor[1],
          cor[2],
          alfaLadrilho
        );
      }
    }
  }

  const comprimento = ladrilho * 0.56;
  const espessura = ladrilho * 0.24;

  // Recorta a pílula para que ela não escape do ladrilho.
  const antes = new Uint8ClampedArray(dados);
  const pilula = new Uint8ClampedArray(tamanho * tamanho * 4);

  desenharPilula(pilula, tamanho, centro, centro, comprimento, espessura);

  for (let y = 0; y < tamanho; y += 1) {
    for (let x = 0; x < tamanho; x += 1) {
      const indice = (y * tamanho + x) * 4;
      const alfaPilula = pilula[indice + 3] / 255;

      if (alfaPilula <= 0) continue;

      const distancia = sdfRetanguloArredondado(
        x + 0.5,
        y + 0.5,
        centro,
        centro,
        ladrilho / 2,
        ladrilho / 2,
        raio
      );

      const dentro = cobertura(distancia);

      if (dentro <= 0) continue;

      pintar(
        dados,
        indice,
        antes[indice],
        antes[indice + 1],
        antes[indice + 2],
        alfaPilula * dentro
      );

      // Mantém a cor da pílula por cima do ladrilho.
      dados[indice] = Math.round(
        pilula[indice] * dentro + dados[indice] * (1 - dentro)
      );
      dados[indice + 1] = Math.round(
        pilula[indice + 1] * dentro + dados[indice + 1] * (1 - dentro)
      );
      dados[indice + 2] = Math.round(
        pilula[indice + 2] * dentro + dados[indice + 2] * (1 - dentro)
      );
      dados[indice + 3] = 255;
    }
  }

  return dados;
}

/* ------------------------------- PNG ------------------------------------ */

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    tabela[n] = c >>> 0;
  }

  return tabela;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (let i = 0; i < buffer.length; i += 1) {
    crc = TABELA_CRC[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const nome = Buffer.from(tipo, "ascii");
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([nome, dados])), 0);

  return Buffer.concat([tamanho, nome, dados, crc]);
}

function codificarPng(largura, altura, rgba) {
  const assinatura = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const bytesPorLinha = largura * 4;
  const bruto = Buffer.alloc((bytesPorLinha + 1) * altura);

  for (let y = 0; y < altura; y += 1) {
    const destino = y * (bytesPorLinha + 1);

    bruto[destino] = 0; // filtro "None"
    Buffer.from(rgba.buffer, rgba.byteOffset + y * bytesPorLinha, bytesPorLinha)
      .copy(bruto, destino + 1);
  }

  return Buffer.concat([
    assinatura,
    bloco("IHDR", ihdr),
    bloco("IDAT", zlib.deflateSync(bruto, { level: 9 })),
    bloco("IEND", Buffer.alloc(0))
  ]);
}

function salvar(caminho, largura, altura, rgba) {
  const png = codificarPng(largura, altura, rgba);

  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, png);

  console.log(
    `  ${path.relative(RAIZ, caminho)} (${largura}x${altura}, ${(
      png.length / 1024
    ).toFixed(1)} KB)`
  );
}

/* ------------------------------- saída ---------------------------------- */

console.log("Gerando ícones do MedLembre...");

const icone = renderizarIcone(1024);
const iconeQuadrado = renderizarIcone(1024, { arredondado: false });
const iconeFundo = renderizarIcone(1024, {
  arredondado: false,
  pilula: false
});
const iconeMascara = renderizarIcone(1024, {
  arredondado: false,
  escalaPilula: 0.82
});
const iconeFrente = renderizarIcone(1024, {
  arredondado: false,
  fundo: false,
  escalaPilula: 0.92
});

salvar(path.join(PASTA_ICONES, "icon-512.png"), 512, 512, redimensionar(icone, 1024, 512));
salvar(
  path.join(PASTA_ICONES, "icon-192.png"),
  192,
  192,
  redimensionar(icone, 1024, 192)
);
salvar(
  path.join(PASTA_ICONES, "icon-512-maskable.png"),
  512,
  512,
  redimensionar(iconeMascara, 1024, 512)
);
salvar(
  path.join(PASTA_ICONES, "apple-touch-icon.png"),
  180,
  180,
  redimensionar(iconeQuadrado, 1024, 180)
);
salvar(
  path.join(PASTA_ICONES, "favicon-32.png"),
  32,
  32,
  redimensionar(icone, 1024, 32)
);

// Fontes usadas pelo @capacitor/assets para gerar os ícones do Android.
salvar(path.join(RAIZ, "assets", "icon-only.png"), 1024, 1024, icone);
salvar(path.join(RAIZ, "assets", "icon-background.png"), 1024, 1024, iconeFundo);
salvar(path.join(RAIZ, "assets", "icon-foreground.png"), 1024, 1024, iconeFrente);

console.log("Gerando telas de abertura...");

salvar(
  path.join(RAIZ, "assets", "splash.png"),
  2732,
  2732,
  renderizarSplash(2732, false)
);
salvar(
  path.join(RAIZ, "assets", "splash-dark.png"),
  2732,
  2732,
  renderizarSplash(2732, true)
);

console.log("Pronto! Ícones e splash gerados em assets/.");

/* --------------------------- redimensionamento --------------------------- */

function redimensionar(origem, tamanhoOrigem, tamanhoDestino) {
  if (tamanhoOrigem === tamanhoDestino) return origem;

  const destino = new Uint8ClampedArray(tamanhoDestino * tamanhoDestino * 4);
  const escala = tamanhoOrigem / tamanhoDestino;

  for (let y = 0; y < tamanhoDestino; y += 1) {
    const origemY = (y + 0.5) * escala - 0.5;
    const y0 = limitar(Math.floor(origemY), 0, tamanhoOrigem - 1);
    const y1 = limitar(y0 + 1, 0, tamanhoOrigem - 1);
    const fy = limitar(origemY - y0, 0, 1);

    for (let x = 0; x < tamanhoDestino; x += 1) {
      const origemX = (x + 0.5) * escala - 0.5;
      const x0 = limitar(Math.floor(origemX), 0, tamanhoOrigem - 1);
      const x1 = limitar(x0 + 1, 0, tamanhoOrigem - 1);
      const fx = limitar(origemX - x0, 0, 1);

      const indices = [
        (y0 * tamanhoOrigem + x0) * 4,
        (y0 * tamanhoOrigem + x1) * 4,
        (y1 * tamanhoOrigem + x0) * 4,
        (y1 * tamanhoOrigem + x1) * 4
      ];
      const pesos = [
        (1 - fx) * (1 - fy),
        fx * (1 - fy),
        (1 - fx) * fy,
        fx * fy
      ];

      const indiceDestino = (y * tamanhoDestino + x) * 4;

      let alfa = 0;

      for (let i = 0; i < 4; i += 1) {
        alfa += (origem[indices[i] + 3] / 255) * pesos[i];
      }

      if (alfa <= 0) continue;

      let r = 0;
      let g = 0;
      let b = 0;

      for (let i = 0; i < 4; i += 1) {
        const peso = pesos[i] * (origem[indices[i] + 3] / 255);

        r += origem[indices[i]] * peso;
        g += origem[indices[i] + 1] * peso;
        b += origem[indices[i] + 2] * peso;
      }

      destino[indiceDestino] = Math.round(r / alfa);
      destino[indiceDestino + 1] = Math.round(g / alfa);
      destino[indiceDestino + 2] = Math.round(b / alfa);
      destino[indiceDestino + 3] = Math.round(alfa * 255);
    }
  }

  return destino;
}
