// Mapa municipal em SVG (d3-geo) com zoom, tooltip e modos de cor (votos ou abstenção).
import { geoArea, geoMercator, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, ZoomBehavior } from "d3-zoom";
import "d3-transition";
import { Municipio, Candidato, num, pct, pts, titulo, esc, nomeCidade, comparec } from "./util";
import { corMargem, corAbst, corOutro, corVarAbst, rampaMargem, rampaAbst, rampaVar, LIMITES_MARGEM, LIMITES_ABST, LIMITES_VAR } from "./cores";

export type Modo = "pres2" | "pres1" | "abst1" | "abst2" | "abstVar";
const turnoAbst = (m: Modo) => (m === "abst1" ? "1" : m === "abst2" ? "2" : null);
const ehAbst = (m: Modo) => m.startsWith("abst");

/** Variação da abstenção (2º − 1º turno), em pontos percentuais. */
function varAbst(m: Municipio): number | null {
  const c1 = comparec(m, "1"), c2 = comparec(m, "2");
  if (!c1?.aptos || !c2?.aptos) return null;
  return (100 * c2.abst) / c2.aptos - (100 * c1.abst) / c1.aptos;
}

/** O IBGE publica anéis no sentido do RFC 7946 (anti-horário); o d3-geo espera o
 *  sentido oposto e, sem inverter, cada polígono vira "o planeta menos a cidade". */
export function corrigirOrientacao(fc: any) {
  for (const f of fc.features) {
    if (geoArea(f) > 2 * Math.PI) {
      const g = f.geometry;
      const polis = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      for (const p of polis) for (const anel of p) anel.reverse();
    }
  }
  return fc;
}

export interface OpcoesMapa {
  area: string; legenda: string; modos: string; inicial: Modo;
}

/** Desenha um mapa municipal. As malhas já devem ter passado por corrigirOrientacao. */
export function criarMapa(
  malha: any, ufs: any, munis: Map<string, Municipio>, cand: Record<string, Candidato>,
  finalistas: [string, string], abrir: (id: string) => void, op: OpcoesMapa,
) {
  const area = document.getElementById(op.area)!;
  const legenda = document.getElementById(op.legenda)!;
  const tip = document.getElementById("tooltip")!;
  area.innerHTML = "";
  const W = 900, H = 900;
  const proj = geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], malha);
  const caminho = geoPath(proj);
  const svg = select(area).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
    .attr("aria-label", "Mapa do Brasil por município");
  const g = svg.append("g");
  const paths = g.selectAll<SVGPathElement, any>("path.m").data(malha.features).join("path")
    .attr("class", "m").attr("d", caminho as any).attr("data-id", (f: any) => f.properties.id ?? "");
  g.selectAll("path.uf").data(ufs.features).join("path").attr("class", "uf").attr("d", caminho as any);

  let modo: Modo = op.inicial;
  const nomeC = (sq: string) => titulo(cand[sq]?.n ?? "?");

  function cor(m: Municipio | undefined): string {
    if (!m) return "var(--surface-2)";
    if (modo === "abstVar") {
      const v = varAbst(m);
      return v == null ? "var(--surface-2)" : corVarAbst(v);
    }
    const ta = turnoAbst(modo);
    if (ta) {
      const c = comparec(m, ta);
      return c?.aptos ? corAbst((100 * c.abst) / c.aptos) : "var(--surface-2)";
    }
    const d = m.r[modo as "pres1" | "pres2"];
    if (!d || !d.c.length) return "var(--surface-2)";
    const [lider, vl] = d.c[0];
    const lado = finalistas.indexOf(lider);
    if (lado === -1) return corOutro();
    const segundo = d.c[1]?.[1] ?? 0;
    return corMargem(lado as 0 | 1, (100 * (vl - segundo)) / d.t);
  }

  function pintar() {
    paths.attr("fill", (f: any) => cor(munis.get(f.properties.id)));
    legenda.innerHTML = modo === "abstVar" ? legendaVar() : turnoAbst(modo) ? legendaAbst() : legendaMargem();
  }

  function legendaMargem() {
    const [a, b] = finalistas;
    const L = LIMITES_MARGEM;
    const faixas = [`<${L[0]}`, ...L.slice(1).map((l, i) => `${L[i]}–${l}`), `>${L.at(-1)}`]; // da mais apertada à mais folgada
    const celula = (c: string, t: string) => `<span><i style="background:${c}"></i><small class="num">${t}</small></span>`;
    const ladoA = rampaMargem(0).map((c, i) => celula(c, faixas[i])).reverse().join("");
    const ladoB = rampaMargem(1).map((c, i) => celula(c, faixas[i])).join("");
    return `<div class="divergente"><div class="ticks"><span>◀ ${esc(nomeC(a))} venceu</span><span>${esc(nomeC(b))} venceu ▶</span></div>
      <div class="escala">${ladoA}${ladoB}</div><div class="ticks"><span>margem de vitória, em pontos percentuais</span></div></div>
      ${modo === "pres1" ? `<span><span class="marca" style="background:${corOutro()}"></span>Outro candidato venceu</span>` : ""}`;
  }

  function legendaAbst() {
    const r = rampaAbst();
    const rot = [`<${LIMITES_ABST[0]}%`, ...LIMITES_ABST.slice(1).map((l, i) => `${LIMITES_ABST[i]}–${l}%`), `≥${LIMITES_ABST.at(-1)}%`];
    return r.map((c, i) => `<span><span class="marca" style="background:${c}"></span>${rot[i]}</span>`).join("") +
      `<span>dos eleitores aptos não votaram</span>`;
  }

  function legendaVar() {
    const L = LIMITES_VAR;
    const faixas = [`<${L[0]}`, ...L.slice(1).map((l, i) => `${L[i]}–${l}`), `>${L.at(-1)}`];
    const celula = (c: string, t: string) => `<span><i style="background:${c}"></i><small class="num">${t}</small></span>`;
    const caiu = rampaVar("caiu").map((c, i) => celula(c, faixas[i])).reverse().join("");
    const subiu = rampaVar("subiu").map((c, i) => celula(c, faixas[i])).join("");
    return `<div class="divergente"><div class="ticks"><span>◀ abstenção caiu</span><span>abstenção subiu ▶</span></div>
      <div class="escala">${caiu}${subiu}</div><div class="ticks"><span>variação do 1º para o 2º turno, em pontos percentuais</span></div></div>`;
  }

  function conteudoTip(m: Municipio): string {
    let h = `<b>${esc(nomeCidade(m))}</b>`;
    const l = (k: string, v: string) => `<div class="l"><span>${k}</span><span>${v}</span></div>`;
    if (ehAbst(modo)) {
      const c1 = comparec(m, "1"), c2 = comparec(m, "2");
      const v = varAbst(m);
      const linha = (rot: string, c: ReturnType<typeof comparec>) =>
        c?.aptos ? l(rot, `${pct((100 * c.abst) / c.aptos)} · ${num(c.abst)}`) : "";
      return h + linha("Abstenção 1º turno", c1) + linha("Abstenção 2º turno", c2) +
        (v != null ? l("Variação", pts(v)) : "") +
        l("Eleitores aptos", num((c2 ?? c1)?.aptos ?? 0)) +
        (m.sup ? `<div class="l"><span>Teve eleição suplementar para prefeito no dia do 2º turno</span></div>` : "");
    }
    const d = m.r[modo as "pres1" | "pres2"];
    if (!d) return h + "<div>Sem dados</div>";
    const mostrar = modo === "pres2" ? d.c : d.c.slice(0, 3);
    for (const [sq, v] of mostrar) h += l(esc(nomeC(sq)), `${pct((100 * v) / d.t)} · ${num(v)}`);
    return h + l("Votos válidos", num(d.t));
  }

  const ativo = { el: null as SVGPathElement | null };
  function mostrar(ev: PointerEvent, el: SVGPathElement) {
    const m = munis.get(el.dataset.id ?? "");
    if (!m) return;
    if (ativo.el !== el) { ativo.el?.classList.remove("sel"); el.classList.add("sel"); ativo.el = el; el.parentNode!.appendChild(el); }
    tip.innerHTML = conteudoTip(m);
    tip.hidden = false;
    const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = ev.clientY + 14 + tip.offsetHeight > innerHeight ? ev.clientY - tip.offsetHeight - 14 : ev.clientY + 14;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y}px`;
  }
  function esconder() { tip.hidden = true; ativo.el?.classList.remove("sel"); ativo.el = null; }

  const svgEl = svg.node()!;
  svgEl.addEventListener("pointermove", (ev) => {
    const el = (ev.target as Element).closest?.("path.m") as SVGPathElement | null;
    el ? mostrar(ev, el) : esconder();
  });
  svgEl.addEventListener("pointerleave", esconder);
  window.addEventListener("scroll", () => { if (!tip.hidden) esconder(); }, { passive: true });
  let inicio: [number, number] | null = null;
  svgEl.addEventListener("pointerdown", (ev) => { inicio = [ev.clientX, ev.clientY]; });
  svgEl.addEventListener("click", (ev) => {
    // ignora o clique que encerra um arrasto
    if (inicio && Math.hypot(ev.clientX - inicio[0], ev.clientY - inicio[1]) > 5) return;
    const el = (ev.target as Element).closest?.("path.m") as SVGPathElement | null;
    if (el?.dataset.id) abrir(el.dataset.id);
  });

  // A roda do mouse e um dedo só rolam a página; zoom pede Ctrl/⌘ + roda, pinça ou dois dedos.
  const dica = document.createElement("div");
  dica.className = "mapa-dica";
  dica.hidden = true;
  area.appendChild(dica);
  let tDica = 0;
  const avisar = (texto: string) => {
    dica.textContent = texto;
    dica.hidden = false;
    clearTimeout(tDica);
    tDica = window.setTimeout(() => (dica.hidden = true), 1400);
  };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  svgEl.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) avisar(`Use ${mac ? "⌘" : "Ctrl"} + rolagem para dar zoom no mapa`);
  }, { passive: true });
  svgEl.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 1) avisar("Use dois dedos para mover e dar zoom no mapa");
  }, { passive: true });

  const z: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>().scaleExtent([1, 40])
    .translateExtent([[0, 0], [W, H]])
    .filter((ev: any) => {
      if (ev.type === "wheel") return ev.ctrlKey || ev.metaKey;
      if (ev.type.startsWith("touch")) return ev.touches.length >= 2;
      return !ev.button;
    })
    // pinça do trackpad chega como ctrl+roda com passos pequenos; roda do mouse, com passos grandes
    .wheelDelta((ev: WheelEvent) => -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.deltaMode ? 1 : 0.002) * (Math.abs(ev.deltaY) < 50 ? 6 : 1))
    .on("zoom", (e) => { g.attr("transform", e.transform.toString()); esconder(); dica.hidden = true; });
  svg.call(z as any);
  const btns = document.createElement("div");
  btns.className = "zoom-btns";
  btns.innerHTML = `<button type="button" aria-label="Aproximar">+</button><button type="button" aria-label="Afastar">−</button><button type="button" aria-label="Ver o Brasil inteiro">⟲</button>`;
  area.appendChild(btns);
  const [mais, menos, reset] = btns.querySelectorAll("button");
  mais.onclick = () => svg.transition().call(z.scaleBy as any, 2);
  menos.onclick = () => svg.transition().call(z.scaleBy as any, 0.5);
  reset.onclick = () => svg.transition().call(z.transform as any, zoomIdentity);

  const botoes = document.querySelectorAll<HTMLButtonElement>(`#${op.modos} [data-modo]`);
  botoes.forEach((b) => b.addEventListener("click", () => {
    botoes.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    modo = b.dataset.modo as Modo;
    pintar();
  }));
  pintar();
  return { repintar: pintar };
}
