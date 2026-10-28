// Gráficos em HTML/SVG sem biblioteca: rosca interativa e barras empilhadas 100%.
import { esc, num, pct } from "./util";

export interface Fatia { nome: string; valor: number; cor: string }

/** Ponto do arco na rosca: ângulo 0 = topo, sentido horário. */
const ponto = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;

function arco(a0: number, a1: number, R: number, r: number) {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) a1 = a0 + 2 * Math.PI - 1e-4; // fatia única: quase um círculo
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  return `M${ponto(R, a0)}A${R},${R} 0 ${grande} 1 ${ponto(R, a1)}L${ponto(r, a1)}A${r},${r} 0 ${grande} 0 ${ponto(r, a0)}Z`;
}

/**
 * Rosca com o rótulo no centro. Passar o mouse, tocar ou focar uma fatia troca o centro por ela.
 * `centro` é o texto padrão (normalmente o vencedor).
 */
export function rosca(fatias: Fatia[], o: { tam: number; titulo: string; centro: [string, string]; extra?: string; legenda?: boolean; }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0) || 1;
  const R = o.tam / 2, r = R * 0.62;
  let a = 0;
  const paths = fatias.filter((f) => f.valor > 0).map((f) => {
    const a1 = a + (2 * Math.PI * f.valor) / total;
    const d = arco(a, a1, R - 2, r);
    a = a1;
    const p = (100 * f.valor) / total;
    return `<path d="${d}" fill="${f.cor}" tabindex="0" data-fatia data-nome="${esc(f.nome)}" data-pct="${pct(p)}" data-votos="${num(f.valor)}"
      aria-label="${esc(f.nome)}: ${pct(p)}, ${num(f.valor)} votos"></path>`;
  }).join("");
  const leg = o.legenda ? `<ul class="rosca-leg">${fatias.map((f) => `<li><span class="marca" style="background:${f.cor}"></span>${esc(f.nome)}
      <b class="num">${pct((100 * f.valor) / total)}</b><small class="num">${num(f.valor)}</small></li>`).join("")}</ul>` : "";
  return `<figure class="rosca" ${o.extra ?? ""}>
    <div class="rosca-svg" style="width:${o.tam}px;height:${o.tam}px">
      <svg viewBox="${-R} ${-R} ${o.tam} ${o.tam}" role="img" aria-label="${esc(o.titulo)}">${paths}</svg>
      <div class="rosca-centro" data-padrao-a="${esc(o.centro[0])}" data-padrao-b="${esc(o.centro[1])}"><b>${esc(o.centro[0])}</b><small>${esc(o.centro[1])}</small></div>
    </div>
    <figcaption>${esc(o.titulo)}</figcaption>${leg}</figure>`;
}

/** Liga a interatividade de todas as roscas dentro de `raiz` (uma vez por raiz). */
export function ativarRoscas(raiz: HTMLElement) {
  const centro = (p: Element) => p.closest(".rosca")!.querySelector<HTMLElement>(".rosca-centro")!;
  const mostra = (p: HTMLElement) => {
    const c = centro(p);
    c.innerHTML = `<b>${esc(p.dataset.pct!)}</b><small>${esc(p.dataset.nome!)}<br>${esc(p.dataset.votos!)} votos</small>`;
    p.closest("svg")!.classList.add("foco");
    p.classList.add("ativa");
  };
  const volta = (p: HTMLElement) => {
    const c = centro(p);
    c.innerHTML = `<b>${esc(c.dataset.padraoA!)}</b><small>${esc(c.dataset.padraoB!)}</small>`;
    p.closest("svg")!.classList.remove("foco");
    p.classList.remove("ativa");
  };
  for (const ev of ["pointerover", "focusin"]) raiz.addEventListener(ev, (e) => {
    const p = (e.target as Element).closest<HTMLElement>("[data-fatia]");
    if (p) mostra(p);
  });
  for (const ev of ["pointerout", "focusout"]) raiz.addEventListener(ev, (e) => {
    const p = (e.target as Element).closest<HTMLElement>("[data-fatia]");
    if (p) volta(p);
  });
}

export interface Segmento { valor: number; cor: string }
export interface LinhaEmpilhada { rot: string; segs: Segmento[]; dir: string; tip: string; extra?: string; selo?: string }

/** Barras 100% empilhadas, uma por linha, com marca nos 50%. */
export function empilhadas(linhas: LinhaEmpilhada[], meio = true) {
  return `<div class="empilhadas">${linhas.map((l) => {
    const tot = l.segs.reduce((s, x) => s + x.valor, 0) || 1;
    return `<div class="emp-linha" data-tip="${esc(l.tip)}" ${l.extra ?? ""}>
      <span class="emp-rot">${l.rot}${l.selo ? ` <span class="selo">${esc(l.selo)}</span>` : ""}</span>
      <span class="emp-barra">${l.segs.filter((s) => s.valor > 0).map((s) => `<i style="width:${(100 * s.valor) / tot}%;background:${s.cor}"></i>`).join("")}${meio ? '<b class="emp-meio"></b>' : ""}</span>
      <span class="emp-dir num">${l.dir}</span></div>`;
  }).join("")}</div>`;
}

/** Dica (tooltip) para qualquer elemento com data-tip dentro de `raiz`. */
export function ativarDicas(raiz: HTMLElement) {
  const tip = document.getElementById("tooltip")!;
  let atual: HTMLElement | null = null;
  const mover = (e: PointerEvent) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tip]");
    if (!el || !raiz.contains(el)) { if (atual) { tip.hidden = true; atual = null; } return; }
    if (el !== atual) { tip.innerHTML = el.dataset.tip!; atual = el; }
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = e.clientY + 14 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 14 : e.clientY + 14;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y}px`;
  };
  raiz.addEventListener("pointermove", mover);
  raiz.addEventListener("pointerdown", mover);
  raiz.addEventListener("pointerleave", () => { tip.hidden = true; atual = null; });
}

/** Linha de dica: rótulo à esquerda, valor à direita (mesmo estilo do mapa). */
export const linhaTip = (k: string, v: string) => `<div class="l"><span>${k}</span><span>${v}</span></div>`;
