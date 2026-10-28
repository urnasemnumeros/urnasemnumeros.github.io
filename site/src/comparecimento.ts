// Comparecimento, abstenção, brancos e nulos: 1º x 2º turno (Brasil e cidades).
import { Resumo, CompCidade, Municipio, num, pct, pts, esc, barra, nomeCidade, comparec } from "./util";
import { NOME_UF } from "./agregados";
import { corVarAbst } from "./cores";

export function comparecimento(r: Resumo, abrir: (id: string) => void) {
  const c = r.comparecimento;
  const [b1, b2] = [c.brasil["1"], c.brasil["2"]];
  const validos = (b: Record<string, number>) => b.QT_COMPARECIMENTO - b.QT_VOTOS_BRANCOS - b.QT_VOTOS_NULOS;
  const linhas: [string, (b: Record<string, number>) => number, ((b: Record<string, number>) => number) | null][] = [
    ["Eleitores aptos", (b) => b.QT_APTOS, null],
    ["Compareceram", (b) => b.QT_COMPARECIMENTO, (b) => b.QT_APTOS],
    ["Abstenção", (b) => b.QT_ABSTENCOES, (b) => b.QT_APTOS],
    ["Brancos", (b) => b.QT_VOTOS_BRANCOS, (b) => b.QT_COMPARECIMENTO],
    ["Nulos", (b) => b.QT_VOTOS_NULOS, (b) => b.QT_COMPARECIMENTO],
    ["Votos válidos", validos, (b) => b.QT_COMPARECIMENTO],
  ];
  const cel = (b: Record<string, number>, v: (b: Record<string, number>) => number, base: ((b: Record<string, number>) => number) | null) =>
    `${num(v(b))}${base ? ` <small>${pct((100 * v(b)) / base(b), 2)}</small>` : ""}`;
  document.getElementById("comp-brasil")!.innerHTML = `
    <div class="tabela-wrap"><table>
      <thead><tr><th>Brasil · presidente</th><th class="n">1º turno</th><th class="n">2º turno</th><th class="n">Diferença</th></tr></thead>
      <tbody>${linhas.map(([rot, v, base]) => {
        const d = v(b2) - v(b1);
        return `<tr><td>${rot}</td><td class="n">${cel(b1, v, base)}</td><td class="n">${cel(b2, v, base)}</td>
          <td class="n">${d === 0 ? "0" : (d > 0 ? "+" : "−") + num(Math.abs(d))}</td></tr>`;
      }).join("")}</tbody></table></div>
    <p class="nota">Fonte: detalhe da apuração por seção eleitoral (TSE). Abstenção sobre os aptos; brancos, nulos e válidos sobre quem compareceu.</p>`;

  const lista = (titulo: string, itens: CompCidade[], tipo: "abst" | "bn") => {
    const val = (x: CompCidade) => (tipo === "abst" ? x.da : x.dbn);
    const max = Math.max(...itens.map((x) => Math.abs(val(x))), 1);
    return `<div class="painel lista"><h4>${titulo}</h4><ol>${itens.map((x) => barra(
      `${esc(nomeCidade(x))}${x.sup ? ` <span class="selo sup" title="Eleição suplementar para prefeito no dia do 2º turno">suplementar</span>` : ""}`,
      tipo === "abst"
        ? `${pts(x.da)} <small>${pct(x.a1)} → ${pct(x.a2)} · ${num(x.ab1)} → ${num(x.ab2)}</small>`
        : `${pts(x.dbn)} <small>${pct(x.pbn1)} → ${pct(x.pbn2)} · ${num(x.bn1)} → ${num(x.bn2)}</small>`,
      Math.abs(val(x)) / max, "var(--text-3)", `data-cidade="${x.id}"`, "li")).join("")}</ol></div>`;
  };
  const el = document.getElementById("comp-listas")!;
  el.innerHTML = `
    <h3 class="sub">Cidades onde a abstenção mais mudou entre os turnos</h3>
    <p class="nota">Diferença na % de eleitores aptos que não votaram para presidente (cidades com ${num(c.minimo)}+ eleitores).
      A abstenção caiu em ${num(c.cidadesAbstCaiu)} de ${num(c.cidadesComparadas)} cidades.
      “Suplementar” marca cidades que também elegeram prefeito no dia do 2º turno.</p>
    <div class="listas">${lista("10 cidades onde a abstenção mais caiu", c.abstCaiu, "abst")}${lista("10 cidades onde a abstenção mais subiu", c.abstSubiu, "abst")}</div>
    <h3 class="sub">Cidades onde brancos e nulos mais mudaram</h3>
    <p class="nota">Diferença na % de brancos + nulos sobre quem compareceu.</p>
    <div class="listas">${lista("10 cidades onde brancos e nulos mais caíram", c.bnCaiu, "bn")}${lista("10 cidades onde brancos e nulos mais subiram", c.bnSubiu, "bn")}</div>`;
  el.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-cidade]");
    if (li) abrir(li.dataset.cidade!);
  });
}

/** Estados onde a abstenção mais subiu e mais caiu entre os turnos (soma dos municípios, sem o exterior). */
export function abstencaoEstados(munis: Iterable<Municipio>) {
  const soma = new Map<string, { ap1: number; ab1: number; ap2: number; ab2: number }>();
  for (const m of munis) {
    const c1 = comparec(m, "1"), c2 = comparec(m, "2");
    if (m.uf === "ZZ" || !c1 || !c2) continue;
    const s = soma.get(m.uf) ?? { ap1: 0, ab1: 0, ap2: 0, ab2: 0 };
    s.ap1 += c1.aptos; s.ab1 += c1.abst; s.ap2 += c2.aptos; s.ab2 += c2.abst;
    soma.set(m.uf, s);
  }
  const ufs = [...soma].map(([uf, s]) => {
    const p1 = (100 * s.ab1) / s.ap1, p2 = (100 * s.ab2) / s.ap2;
    return { uf, p1, p2, d: p2 - p1, ab1: s.ab1, ab2: s.ab2 };
  });
  const max = Math.max(...ufs.map((x) => Math.abs(x.d)), 0.01);
  const bloco = (rot: string, lista: typeof ufs) => `<div class="painel lista"><h4>${rot}</h4><ol>${lista.map((x) => barra(
    esc(NOME_UF[x.uf] ?? x.uf),
    `${pts(x.d)}<small>${pct(x.p1)} → ${pct(x.p2)} · ${num(x.ab1)} → ${num(x.ab2)}</small>`,
    Math.abs(x.d) / max, corVarAbst(x.d), "", "li")).join("") || "<li>Nenhum estado.</li>"}</ol></div>`;
  const subiu = ufs.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 10);
  const caiu = ufs.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 10);
  const nSubiu = ufs.filter((x) => x.d > 0).length, nCaiu = ufs.filter((x) => x.d < 0).length;
  document.getElementById("abst-estados")!.innerHTML =
    bloco(`Onde a abstenção mais subiu <small class="meta">(subiu em ${nSubiu} estados)</small>`, subiu) +
    bloco(`Onde a abstenção mais caiu <small class="meta">(caiu em ${nCaiu} estados)</small>`, caiu);
}
