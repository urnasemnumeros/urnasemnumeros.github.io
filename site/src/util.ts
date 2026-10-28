// Tipos dos JSONs gerados por gerar_dados_site.py e formatação pt-BR.

export interface Curiosidade { titulo: string; destaque: string; texto: string }
export interface CidadeLista { id: string; nome: string; uf: string; votos: number; validos: number; pct: number }
export interface Crescimento {
  id: string; nome: string; uf: string; v1: number; t1: number; p1: number; v2: number; t2: number; p2: number;
  dpp: number; dv: number;
}
export interface CompCidade {
  id: string; nome: string; uf: string; aptos: number; ab1: number; ab2: number; a1: number; a2: number; da: number;
  bn1: number; bn2: number; pbn1: number; pbn2: number; dbn: number; sup: boolean;
}
export interface Virada {
  id: string; nome: string; uf: string; venceu1: string; venceu2: string;
  t1: Record<string, number>; validos1: number; t2: Record<string, number>; validos2: number;
}
export interface Resumo {
  geracao: Record<string, string>;
  finalistas: [string, string];
  presidente: {
    totais: Record<string, { validos: number; c: [string, number][] }>;
    cidades: Record<string, { nome: string; partido: string; maiorPct: CidadeLista[]; menorPct: CidadeLista[]; maiorVotos: CidadeLista[]; menorVotos: CidadeLista[];
      crescimento: Record<"maiorPct" | "menorPct" | "maiorVotos" | "menorVotos", Crescimento[]> }>;
    viradas: Virada[];
    minValidos: number;
  };
  comparecimento: {
    brasil: Record<"1" | "2", Record<string, number>>;
    abstCaiu: CompCidade[]; abstSubiu: CompCidade[]; bnCaiu: CompCidade[]; bnSubiu: CompCidade[];
    minimo: number; cidadesAbstCaiu: number; cidadesComparadas: number;
  };
  secoes: Record<string, Curiosidade[]>;
  mistura?: import("./mistura").Mistura;
}
export interface Candidato {
  n: string; p: string; uf: string; c: string; s: string; v1: number; v2: number | null;
  g: string; i: number | null; o: string; b: number; pv: number;
}
export interface Disputa { t: number; c: [string, number][] }
export interface Municipio {
  id: string; ibge: number | null; uf: string; nome: string;
  aptos: number; comparec: number; abst: number; brancos: number; nulos: number;
  r: Partial<Record<"pres1" | "pres2" | "gov1" | "gov2" | "sen1" | "depf1" | "depe1", Disputa>>;
  /** comparecimento para presidente por turno: [aptos, compareceram, abstenções, brancos, nulos] */
  c?: Partial<Record<"1" | "2", [number, number, number, number, number]>>;
  /** teve eleição suplementar para prefeito no dia do 2º turno */
  sup?: boolean;
}

export function comparec(m: Municipio, turno: "1" | "2") {
  const c = m.c?.[turno];
  if (!c) return turno === "1" ? { aptos: m.aptos, comparec: m.comparec, abst: m.abst, brancos: m.brancos, nulos: m.nulos } : null;
  const [aptos, comp, abst, brancos, nulos] = c;
  return { aptos, comparec: comp, abst, brancos, nulos };
}

export const pts = (v: number, casas = 1) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + pct(Math.abs(v), casas).replace("%", " pts");

const nf = new Intl.NumberFormat("pt-BR");
export const num = (n: number) => nf.format(n);
export const pct = (p: number, casas = 1) =>
  p.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";
export const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "d'"]);
export function titulo(s: string): string {
  return s.toLowerCase().split(/(\s+|-)/).map((p, i) =>
    i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "");

export const ELEITO = new Set(["ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA"]);
const SITUACAO: Record<string, string> = {
  "ELEITO": "Eleito",
  "ELEITO POR QP": "Eleito por quociente partidário",
  "ELEITO POR MÉDIA": "Eleito por média",
  "SUPLENTE": "Suplente",
  "NÃO ELEITO": "Não eleito",
  "2º TURNO": "Foi ao 2º turno",
};
export const situacao = (s: string) => SITUACAO[s] ?? titulo(s);

export function nomeCidade(m: { nome: string; uf: string }) {
  return m.uf === "ZZ" ? `${titulo(m.nome)} (exterior)` : `${titulo(m.nome)} – ${m.uf}`;
}

export function aviso(msg: string) {
  const el = document.getElementById("aviso")!;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((el as any)._t);
  (el as any)._t = setTimeout(() => (el.hidden = true), 2400);
}

/** Linha de barra horizontal: rótulo, valor e trilho proporcional. */
export function barra(rotulo: string, valor: string, fracao: number, cor: string, extra = "", tag = "div"): string {
  const w = Math.max(0, Math.min(1, fracao)) * 100;
  return `<${tag} class="barra-linha" ${extra}><span class="rotulo">${rotulo}</span><span class="valor">${valor}</span>` +
    `<div class="trilho"><span style="width:${w}%;background:${cor}"></span></div></${tag}>`;
}

/** Cabeçalho de quadro com um número de resumo (ex.: média) no canto superior direito. */
export function cabecalhoMedia(titulo: string, valor: string, rotulo: string): string {
  return `<div class="tit-media"><h4>${titulo}</h4><p class="media num">${valor}<small>${rotulo}</small></p></div>`;
}
export const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Conta um evento no GoatCounter (ex.: download de card), se o contador estiver carregado. Nunca quebra o site. */
export function contarEvento(caminho: string, titulo: string) {
  try {
    (window as any).goatcounter?.count?.({ path: caminho, title: titulo, event: true });
  } catch { /* contador bloqueado ou fora do ar */ }
}
