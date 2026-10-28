// Somas por região, estado, porte de cidade e capital × interior, feitas no navegador a partir de municipios.json.
import { Municipio } from "./util";

export type Turno = "1" | "2";

export const REGIOES: { id: string; nome: string; ufs: string[] }[] = [
  { id: "N", nome: "Norte", ufs: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"] },
  { id: "NE", nome: "Nordeste", ufs: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"] },
  { id: "CO", nome: "Centro-Oeste", ufs: ["DF", "GO", "MS", "MT"] },
  { id: "SE", nome: "Sudeste", ufs: ["ES", "MG", "RJ", "SP"] },
  { id: "S", nome: "Sul", ufs: ["PR", "RS", "SC"] },
];
export const REGIAO_DA_UF: Record<string, string> = Object.fromEntries(REGIOES.flatMap((r) => r.ufs.map((u) => [u, r.id])));

export const NOME_UF: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** Códigos IBGE das capitais. */
export const CAPITAIS = new Set([
  1200401, 2704302, 1600303, 1302603, 2927408, 2304400, 5300108, 3205309, 5208707, 2111300, 5103403, 5002704, 3106200, 1501402,
  2507507, 4106902, 2611606, 2211001, 3304557, 2408102, 4314902, 1100205, 1400100, 4205407, 3550308, 2800308, 1721000,
]);

export const PORTES = [
  { id: "p1", nome: "Até 10 mil eleitores", max: 10_000 },
  { id: "p2", nome: "10 mil a 50 mil", max: 50_000 },
  { id: "p3", nome: "50 mil a 200 mil", max: 200_000 },
  { id: "p4", nome: "200 mil a 1 milhão", max: 1_000_000 },
  { id: "p5", nome: "Mais de 1 milhão", max: Infinity },
];

/** Votos de um turno somados: finalistas A e B, outros, válidos, e cidades vencidas por cada lado. */
export interface Soma { a: number; b: number; o: number; t: number; cidA: number; cidB: number; cidO: number; cidades: number; aptos: number }
export type Somas = Record<Turno, Soma>;

const vazio = (): Soma => ({ a: 0, b: 0, o: 0, t: 0, cidA: 0, cidB: 0, cidO: 0, cidades: 0, aptos: 0 });

export function agregar(munis: Iterable<Municipio>, chave: (m: Municipio) => string | null, [A, B]: [string, string]) {
  const res = new Map<string, Somas>();
  for (const m of munis) {
    const k = chave(m);
    if (k == null) continue;
    let s = res.get(k);
    if (!s) res.set(k, (s = { "1": vazio(), "2": vazio() }));
    for (const t of ["1", "2"] as Turno[]) {
      const d = m.r[`pres${t}`];
      if (!d || !d.t) continue;
      const x = s[t];
      const a = d.c.find((c) => c[0] === A)?.[1] ?? 0, b = d.c.find((c) => c[0] === B)?.[1] ?? 0;
      x.a += a; x.b += b; x.o += d.t - a - b; x.t += d.t; x.cidades++; x.aptos += m.aptos;
      const lider = d.c[0]?.[0];
      if (lider === A) x.cidA++; else if (lider === B) x.cidB++; else x.cidO++;
    }
  }
  return res;
}

export const porte = (m: Municipio) => (m.uf === "ZZ" ? null : PORTES.find((p) => m.aptos < p.max)!.id);
export const regiao = (m: Municipio) => (m.uf === "ZZ" ? "ZZ" : REGIAO_DA_UF[m.uf] ?? null);
export const ehCapital = (m: Municipio) => m.ibge != null && CAPITAIS.has(m.ibge);

/** % de A sobre os válidos. */
export const pA = (s: Soma) => (s.t ? (100 * s.a) / s.t : 0);
export const pB = (s: Soma) => (s.t ? (100 * s.b) / s.t : 0);
export const pO = (s: Soma) => (s.t ? (100 * s.o) / s.t : 0);
