// Protótipo: o site em páginas. Cada <section> de <main> vira uma página (?p=urnas), a capa (?p ausente)
// mostra a busca e os cartões, e a troca entre páginas usa a View Transitions API quando o navegador tem.
import { Municipio, esc, num, normalizar, nomeCidade } from "./util";

export const PAGINAS: { id: string; nome: string; desc: string }[] = [
  { id: "mapa", nome: "Mapa", desc: "Cidade por cidade, nos dois turnos" },
  { id: "regioes", nome: "Regiões", desc: "Quem venceu em cada região" },
  { id: "estados", nome: "Estados", desc: "Ranking, viradas e crescimento" },
  { id: "cidades", nome: "Cidades", desc: "Mais votados, viradas e voto misturado" },
  { id: "urnas", nome: "Urnas", desc: "Zeradas, biometria e horários" },
  { id: "outros", nome: "Outros candidatos", desc: "Para onde foram os votos" },
  { id: "cidade", nome: "Sua cidade", desc: "O resultado completo de qualquer cidade" },
  { id: "abstencao", nome: "Abstenção", desc: "Quem faltou, brancos e nulos" },
];

// rótulos curtos das sub-abas, pelo começo do título de cada parte (h3.sub)
const CURTOS: [string, string][] = [
  ["Os 27 estados", "Ranking"], ["Os estados que trocaram", "Viradas"], ["Os 10 estados", "Crescimento"],
  ["Onde cada finalista foi mais", "Mais e menos votados"], ["Onde cada finalista mais e menos cresceu", "Crescimento"],
  ["As cidades que viraram", "Viradas"], ["Voto misturado", "Voto misturado"], ["Cidade pequena", "Por tamanho"],
  ["As urnas com mais votos", "Mais votos"], ["Urnas que viraram", "Viradas"], ["Urnas em que cada finalista perdeu", "Perderam votos"],
  ["Urnas zeradas", "Zeradas"], ["Urnas com no máximo 10", "Quase zeradas"], ["O que os logs", "Biometria e horários"],
  ["O 1º turno além", "1º turno"], ["De onde vieram", "Votos a mais"], ["O que aconteceu nos redutos", "Redutos"],
  ["O mapa da abstenção", "Mapa"], ["Estados onde a abstenção", "Estados"], ["Cidades onde a abstenção", "Cidades"], ["Cidades onde brancos", "Brancos e nulos"],
];
const curto = (t: string) => CURTOS.find(([k]) => t.startsWith(k))?.[1] ?? t.split(" ").slice(0, 3).join(" ");
const slug = (t: string) => normalizar(t).replace(/ +/g, "-");

let atual = "";
const secoes = () => [...document.querySelectorAll<HTMLElement>("main > section")];

/** Mostra a página `id` ("" = capa). Devolve uma promessa resolvida quando o DOM novo já está na tela. */
export function ir(id: string, opc: { empilhar?: boolean; aba?: string; origem?: HTMLElement; alvo?: string } = {}): Promise<void> {
  if (!PAGINAS.some((p) => p.id === id)) id = "";
  const { empilhar = true, aba, origem, alvo } = opc;
  if (empilhar) {
    const u = new URL(location.href);
    u.search = id ? `?p=${id}${aba ? `&aba=${aba}` : ""}` : "";
    if (!(id === "cidade" && location.hash.startsWith("#cidade="))) u.hash = "";
    if (u.href !== location.href) history.pushState(null, "", u);
  }
  const elAlvo = alvo ? document.getElementById(alvo) : null;
  if (id === atual && !aba) { elAlvo?.scrollIntoView({ behavior: "smooth" }); return Promise.resolve(); }
  const mudar = () => {
    if (origem) origem.style.viewTransitionName = "";
    mostrar(id);
    const h2 = id ? document.querySelector<HTMLElement>(`#${id} h2`) : null;
    if (origem && h2) h2.style.viewTransitionName = "destino";
    if (elAlvo) elAlvo.scrollIntoView({ behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
    if (aba) rolarAba(aba);
  };
  if (origem) origem.style.viewTransitionName = "destino";
  const doc = document as Document & { startViewTransition?: (f: () => void) => { finished: Promise<void>; updateCallbackDone: Promise<void> } };
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) { mudar(); return Promise.resolve(); }
  const t = doc.startViewTransition(mudar);
  t.finished.finally(() => document.querySelectorAll<HTMLElement>("[style*='view-transition-name']").forEach((e) => (e.style.viewTransitionName = "")));
  return t.updateCallbackDone;
}

function mostrar(id: string) {
  atual = id;
  document.body.dataset.pagina = id || "inicio";
  // o Sobre fica no fim da capa
  secoes().forEach((s) => (s.hidden = s.id !== (id || "sobre")));
  document.getElementById("capa")!.hidden = !!id;
  document.querySelector<HTMLElement>(".hero")!.hidden = !!id;
  // newsletter e apoio: na capa, logo abaixo do subtítulo do Sobre; nas outras páginas, no fim
  const chamadas = document.querySelector<HTMLElement>(".chamadas")!;
  if (id) document.querySelector("main")!.after(chamadas);
  else document.querySelector("#sobre .sobre-lede")!.after(chamadas);
  document.querySelectorAll<HTMLAnchorElement>(".nav-itens a").forEach((a) => {
    const ativo = a.dataset.p === id && !a.dataset.alvo;
    a.classList.toggle("ativo", ativo);
    if (ativo) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const barra = document.querySelector<HTMLElement>(".nav-itens")!;
  const a = barra.querySelector<HTMLElement>("a.ativo");
  if (a) barra.scrollTo({ left: a.offsetLeft - (barra.clientWidth - a.offsetWidth) / 2 });
  document.title = `${id ? `${PAGINAS.find((p) => p.id === id)!.nome} · ` : ""}Sem Clarim · Eleições 2026 em curiosidades`;
  montarAbas();
  montarProxima();
}

/** Abre a página da seção que contém `el` (cards citados por #id em links antigos) e rola até ele. */
export function mostrarElemento(el: Element) {
  const s = el.closest("main > section");
  const pag = s?.id === "sobre" ? "" : s?.id; // o Sobre fica na capa
  if (s && pag !== atual) mostrar(pag!);
  el.scrollIntoView({ behavior: "instant" });
}

// ---------- sub-abas: os h3.sub da página, fixos logo abaixo do menu, com a parte visível destacada
let pararEspiao = () => {};
function montarAbas() {
  const barra = document.getElementById("subabas")!;
  pararEspiao();
  const s = document.getElementById(atual);
  const hs = s ? [...s.querySelectorAll<HTMLElement>("h3.sub")] : [];
  barra.hidden = hs.length < 2;
  if (barra.hidden) return;
  const itens: { id: string; rot: string; alvo: HTMLElement }[] = [];
  if (!hs[0].classList.contains("primeiro")) itens.push({ id: "resumo", rot: "Visão geral", alvo: s!.querySelector("h2")! });
  for (const h of hs) { h.id ||= `aba-${slug(curto(h.textContent ?? ""))}`; itens.push({ id: h.id.replace(/^aba-/, ""), rot: curto(h.textContent ?? ""), alvo: h }); }
  barra.innerHTML = `<div class="wrap"><div class="subabas-in">${itens.map((x) => `<a href="?p=${atual}&aba=${x.id}" data-aba="${x.id}">${esc(x.rot)}</a>`).join("")}</div></div>`;
  const links = [...barra.querySelectorAll<HTMLAnchorElement>("a")];
  const marcar = (aba: string) => links.forEach((a) => a.classList.toggle("ativo", a.dataset.aba === aba));
  marcar(itens[0].id);
  links.forEach((a, i) => a.addEventListener("click", (e) => {
    e.preventDefault();
    history.replaceState(null, "", a.href);
    itens[i].alvo.scrollIntoView({ behavior: "smooth" });
  }));
  // a parte ativa é a última cujo título já passou de 40% da altura da tela
  const aoRolar = () => {
    let it = itens[0];
    for (const x of itens) if (x.alvo.getBoundingClientRect().top < innerHeight * .4) it = x;
    if (links.find((a) => a.classList.contains("ativo"))?.dataset.aba === it.id) return;
    marcar(it.id);
    const a = links.find((x) => x.dataset.aba === it.id)!, faixa = a.parentElement!;
    if (a.offsetLeft < faixa.scrollLeft || a.offsetLeft + a.offsetWidth > faixa.scrollLeft + faixa.clientWidth) faixa.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
  };
  addEventListener("scroll", aoRolar, { passive: true });
  pararEspiao = () => removeEventListener("scroll", aoRolar);
}

function rolarAba(aba: string) {
  const alvo = aba === "resumo" ? document.querySelector(`#${atual} h2`) : document.getElementById(`aba-${aba}`);
  alvo?.scrollIntoView();
}

/** As abas da página de Urnas só existem depois que urnas.json chega: chamado de novo quando a página é preenchida. */
export function atualizarAbas() {
  montarAbas();
  const aba = new URLSearchParams(location.search).get("aba");
  if (aba) rolarAba(aba);
}

function montarProxima() {
  const el = document.getElementById("proxima")!;
  const i = PAGINAS.findIndex((p) => p.id === atual);
  const prox = atual ? PAGINAS[i + 1] : undefined;
  el.hidden = !prox;
  if (prox) el.innerHTML = `<a href="?p=${prox.id}" data-p="${prox.id}"><small>Próxima</small><b>${esc(prox.nome)}</b><span>${esc(prox.desc)}</span><i aria-hidden="true">→</i></a>`;
}

// ---------- busca geral: páginas e partes de página, e cidades quando municipios.json chegar
type Item = { tipo: "pagina" | "cidade"; rot: string; extra: string; ir: () => void };
let cidades: { m: Municipio; k: string }[] = [];
let abrirCidade: (id: string) => void = () => {};

function buscar(q: string): Item[] {
  const n = normalizar(q).trim();
  if (!n) return PAGINAS.slice(0, 6).map((p) => ({ tipo: "pagina", rot: p.nome, extra: p.desc, ir: () => ir(p.id) }));
  const pags: Item[] = [];
  for (const p of PAGINAS) if (normalizar(`${p.nome} ${p.desc}`).includes(n)) pags.push({ tipo: "pagina", rot: p.nome, extra: p.desc, ir: () => ir(p.id) });
  for (const [k, rot] of CURTOS) if (normalizar(`${k} ${rot}`).includes(n)) {
    const h = [...document.querySelectorAll<HTMLElement>("main h3.sub")].find((x) => x.textContent?.startsWith(k));
    const s = h?.closest("section");
    if (h && s && pags.length < 5) pags.push({ tipo: "pagina", rot, extra: PAGINAS.find((p) => p.id === s.id)!.nome, ir: () => ir(s.id, { aba: slug(rot) }) });
  }
  const comeca = cidades.filter((x) => x.k.startsWith(n)).sort((a, b) => b.m.aptos - a.m.aptos);
  const contem = cidades.filter((x) => !x.k.startsWith(n) && x.k.includes(n)).sort((a, b) => b.m.aptos - a.m.aptos);
  const cid: Item[] = [...comeca, ...contem].slice(0, 6).map(({ m }) => ({ tipo: "cidade", rot: nomeCidade(m), extra: `${num(m.aptos)} eleitores`, ir: () => abrirCidade(m.id) }));
  return [...pags.slice(0, 4), ...cid];
}

function ligarBusca(input: HTMLInputElement, lista: HTMLElement, aoEscolher = () => {}) {
  let itens: Item[] = [], sel = 0;
  const desenhar = () => {
    lista.hidden = !itens.length;
    lista.innerHTML = itens.map((x, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}"><span class="ico-${x.tipo}" aria-hidden="true"></span>${esc(x.rot)}<small>${esc(x.extra)}</small></li>`).join("");
  };
  const escolher = (i: number) => { const x = itens[i]; if (!x) return; input.value = ""; lista.hidden = true; aoEscolher(); x.ir(); };
  input.addEventListener("focus", () => { itens = buscar(input.value); sel = 0; desenhar(); });
  input.addEventListener("input", () => { itens = buscar(input.value); sel = 0; desenhar(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % Math.max(itens.length, 1); desenhar(); }
    else if (e.key === "Enter") { e.preventDefault(); escolher(sel); }
    else if (e.key === "Escape") lista.hidden = true;
  });
  lista.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li");
    if (li) { e.preventDefault(); escolher(Number(li.dataset.i)); }
  });
  input.addEventListener("blur", () => setTimeout(() => (lista.hidden = true), 120));
}

export function ativarBuscaDeCidades(munis: Map<string, Municipio>, abrir: (id: string) => void) {
  cidades = [...munis.values()].map((m) => ({ m, k: normalizar(m.nome) }));
  abrirCidade = abrir;
  document.querySelectorAll<HTMLInputElement>(".busca-geral input").forEach((i) => (i.placeholder = "Busque sua cidade, um tema ou uma página…"));
}

// ---------- paleta (lupa do menu ou Ctrl+K / ⌘K): a mesma busca, de qualquer página
function paleta() {
  const dlg = document.getElementById("paleta") as HTMLDialogElement;
  const input = dlg.querySelector("input")!;
  ligarBusca(input, dlg.querySelector("ul")!, () => dlg.close());
  const abrir = () => { dlg.showModal(); input.value = ""; input.focus(); input.dispatchEvent(new Event("input")); };
  document.getElementById("lupa")!.addEventListener("click", abrir);
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (dlg.open) dlg.close(); else abrir(); }
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
}

/** Preenche um cartão da capa (data-cartao) com o número de destaque, quando o dado chega. */
export function cartao(id: string, numero: string, texto: string) {
  const el = document.querySelector(`[data-cartao="${id}"]`);
  if (!el) return;
  el.querySelector(".c-num")!.innerHTML = numero;
  el.querySelector(".c-txt")!.innerHTML = texto;
  el.classList.add("pronto");
}

/** Miniatura do mapa na capa: cópia estática do SVG já desenhado na página do mapa. */
export function miniaturaDoMapa() {
  const svg = document.querySelector("#mapa-area svg");
  const alvo = document.querySelector("[data-cartao='mapa'] .c-fig");
  if (!svg || !alvo) return;
  const copia = svg.cloneNode(true) as SVGElement;
  copia.removeAttribute("id");
  copia.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
  copia.setAttribute("aria-hidden", "true");
  alvo.replaceChildren(copia);
}

export function iniciarPaginas() {
  ligarBusca(document.querySelector("#capa .busca-geral input")!, document.querySelector("#capa .busca-geral ul")!);
  paleta();
  // links internos (?p=…): sem recarregar a página
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-p]");
    if (!a) return;
    e.preventDefault();
    ir(a.dataset.p!, { aba: a.dataset.aba, alvo: a.dataset.alvo, origem: a.closest<HTMLElement>(".cartao") ?? undefined });
  });
  addEventListener("popstate", () => ir(paginaDaUrl(), { empilhar: false }));
  mostrar(paginaDaUrl());
  const q = new URLSearchParams(location.search).get("p");
  if (q === "sobre" || location.hash === "#sobre") document.getElementById("sobre")!.scrollIntoView();
  const aba = new URLSearchParams(location.search).get("aba");
  if (aba) rolarAba(aba);
}

/** ?p=urnas; links antigos (#urnas, #cidade=…) continuam funcionando. */
function paginaDaUrl() {
  const p = new URLSearchParams(location.search).get("p");
  if (p) return p;
  const h = location.hash.slice(1);
  if (h.startsWith("cidade=")) return "cidade";
  if (PAGINAS.some((x) => x.id === h)) return h;
  return "";
}
