// Busca de município e painel com o resultado completo da cidade.
import { Municipio, Candidato, Disputa, num, pct, titulo, esc, barra, normalizar, nomeCidade, comparec } from "./util";
import { corCandidato } from "./cores";
import { ir } from "./paginas";

export function criarBusca(munis: Map<string, Municipio>, cand: Record<string, Candidato>, finalistas: [string, string]) {
  const input = document.getElementById("busca-input") as HTMLInputElement;
  const lista = document.getElementById("busca-sugestoes")!;
  const painel = document.getElementById("cidade-painel")!;
  const indice = [...munis.values()].map((m) => ({ m, k: normalizar(m.nome), a: m.aptos }));
  let sugestoes: Municipio[] = [], sel = -1;

  input.disabled = false;
  input.placeholder = `Digite o nome da cidade (${num(munis.size)} municípios e locais no exterior)…`;

  function buscar(q: string) {
    const n = normalizar(q);
    if (!n) return [];
    const comeca = indice.filter((x) => x.k.startsWith(n));
    const contem = indice.filter((x) => !x.k.startsWith(n) && x.k.includes(n));
    return [...comeca.sort((a, b) => b.a - a.a), ...contem.sort((a, b) => b.a - a.a)].slice(0, 8).map((x) => x.m);
  }
  function desenharSugestoes() {
    lista.hidden = !sugestoes.length;
    lista.innerHTML = sugestoes.map((m, i) =>
      `<li role="option" id="sug-${i}" aria-selected="${i === sel}" data-id="${m.id}">${esc(nomeCidade(m))}<small>${num(m.aptos)} eleitores</small></li>`).join("");
  }
  input.addEventListener("input", () => { sugestoes = buscar(input.value); sel = -1; desenharSugestoes(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + sugestoes.length) % Math.max(sugestoes.length, 1);
      desenharSugestoes();
    } else if (e.key === "Enter" && sugestoes.length) {
      abrir(sugestoes[Math.max(sel, 0)].id, false);
    } else if (e.key === "Escape") { lista.hidden = true; }
  });
  lista.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("li");
    if (li) { e.preventDefault(); abrir(li.dataset.id!, false); }
  });
  input.addEventListener("blur", () => setTimeout(() => (lista.hidden = true), 100));

  /** `anterior`: a disputa do 1º turno, para mostrar quanto cada finalista ganhou ou perdeu até o 2º. */
  function disputa(rot: string, d: Disputa | undefined, anterior?: Disputa, extra = ""): string {
    if (!d) return "";
    const max = d.c[0]?.[1] || 1;
    const sinal = (n: number, f: (x: number) => string) => (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n));
    const linhas = d.c.map(([sq, v]) => {
      const c = cand[sq];
      const v1 = anterior?.c.find((x) => x[0] === sq)?.[1];
      const dif = anterior && v1 != null && anterior.t
        ? `<p class="dif-turno">${sinal(v - v1, num)} votos · ${sinal((100 * v) / d.t - (100 * v1) / anterior.t, (x) => pct(x).replace("%", " pts"))} em relação ao 1º turno</p>`
        : "";
      return barra(`${esc(titulo(c?.n ?? sq))} <small>${c?.p ?? ""}</small>`,
        `${pct((100 * v) / d.t)}<small>${num(v)}</small>`, v / max, corCandidato(finalistas.indexOf(sq))) + dif;
    }).join("");
    return `<div class="painel"><h4>${rot}</h4><p class="meta">${num(d.t)} votos válidos na cidade</p>${linhas}${extra}</div>`;
  }

  /**
   * De onde vieram os votos a mais dos finalistas no 2º turno. A conta fecha exatamente:
   * ganho dos finalistas = votos dos outros candidatos no 1º turno + queda de brancos e nulos + aumento do comparecimento.
   */
  function fluxo(m: Municipio): string {
    const d1 = m.r.pres1, d2 = m.r.pres2, c1 = comparec(m, "1"), c2 = comparec(m, "2");
    if (!d1 || !d2 || !c1 || !c2) return "";
    const v = (d: Disputa, sq: string) => d.c.find((x) => x[0] === sq)?.[1] ?? 0;
    const [A, B] = finalistas;
    const gA = v(d2, A) - v(d1, A), gB = v(d2, B) - v(d1, B), total = gA + gB;
    const fontes = [
      { nome: "Votos dos outros candidatos no 1º turno", v: d1.t - v(d1, A) - v(d1, B), cor: "var(--outro)" },
      { nome: "Queda de brancos e nulos", v: (c1.brancos + c1.nulos) - (c2.brancos + c2.nulos), cor: "var(--text-3)" },
      { nome: "Mais eleitores foram votar (menos abstenção)", v: c2.comparec - c1.comparec, cor: "var(--neutro-2)" },
    ];
    const sinal = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(n));
    const positivos = fontes.filter((f) => f.v > 0), somaPos = positivos.reduce((s, f) => s + f.v, 0) || 1;
    const barraFontes = positivos.map((f) => `<i style="width:${(100 * f.v) / somaPos}%;background:${f.cor}"></i>`).join("");
    const nomeC = (sq: string) => esc(titulo(cand[sq]?.n ?? sq));
    const destinos = [{ sq: A, v: gA, i: 0 }, { sq: B, v: gB, i: 1 }];
    const somaDest = destinos.reduce((s, x) => s + Math.max(x.v, 0), 0) || 1;
    const linha = (cor: string, nome: string, val: number, base: number) => `<li><span class="marca" style="background:${cor}"></span>${nome}
      <b class="num">${sinal(val)}</b><small class="num">${val > 0 && base > 0 ? pct((100 * val) / base) : "—"}</small></li>`;
    return `<div class="fluxo">
      <p class="mini">${total >= 0 ? "De onde vieram os votos a mais" : "Por que os finalistas tiveram menos votos"}</p>
      <p class="fluxo-total num">${sinal(total)} <small>votos para os dois finalistas em relação ao 1º turno</small></p>
      <div class="fluxo-barra" role="img" aria-label="Origem dos votos a mais">${barraFontes}</div>
      <ul class="fluxo-leg">${fontes.map((f) => linha(f.cor, f.nome, f.v, somaPos)).join("")}</ul>
      <p class="mini">${destinos.every((x) => x.v >= 0) ? "Para quem foram" : "Quanto cada finalista ganhou ou perdeu"}</p>
      ${destinos.some((x) => x.v > 0) ? `<div class="fluxo-barra" role="img" aria-label="Divisão dos votos a mais entre os finalistas">${destinos.filter((x) => x.v > 0)
        .map((x) => `<i style="width:${(100 * x.v) / somaDest}%;background:${corCandidato(x.i)}"></i>`).join("")}</div>` : ""}
      <ul class="fluxo-leg">${destinos.map((x) => linha(corCandidato(x.i), nomeC(x.sq), x.v, somaDest)).join("")}</ul>
      ${fontes.some((f) => f.v < 0) ? `<p class="nota">Valores negativos indicam o caminho inverso (por exemplo, menos gente votou no 2º turno); eles reduzem o total.</p>` : ""}
    </div>`;
  }

  function tabelaComparec(m: Municipio) {
    const t1 = comparec(m, "1"), t2 = comparec(m, "2");
    if (!t1) return "";
    const col = (c: ReturnType<typeof comparec>, k: "comparec" | "abst" | "brancos" | "nulos", base?: "aptos" | "comparec") =>
      c ? `${num(c[k])}${base && c[base] ? ` <small>${pct((100 * c[k]) / c[base])}</small>` : ""}` : "–";
    const linha = (rot: string, k: "comparec" | "abst" | "brancos" | "nulos", base?: "aptos" | "comparec") => {
      const dif = t2 ? t2[k] - t1[k] : null;
      return `<tr><td>${rot}</td><td class="n">${col(t1, k, base)}</td><td class="n">${col(t2, k, base)}</td>
        <td class="n">${dif == null ? "–" : (dif > 0 ? "+" : dif < 0 ? "−" : "") + num(Math.abs(dif))}</td></tr>`;
    };
    return `<div class="tabela-wrap"><table>
      <thead><tr><th>Presidente</th><th class="n">1º turno</th><th class="n">2º turno</th><th class="n">Diferença</th></tr></thead>
      <tbody>
        <tr><td>Eleitores aptos</td><td class="n">${num(t1.aptos)}</td><td class="n">${t2 ? num(t2.aptos) : "–"}</td><td class="n"></td></tr>
        ${linha("Compareceram", "comparec", "aptos")}${linha("Abstenção", "abst", "aptos")}
        ${linha("Brancos", "brancos", "comparec")}${linha("Nulos", "nulos", "comparec")}
      </tbody></table></div>
      ${m.sup ? `<p class="nota">No dia do 2º turno, ${esc(titulo(m.nome))} também teve eleição suplementar para prefeito, o que costuma levar mais gente às urnas.</p>` : ""}`;
  }

  function abrir(id: string, rolar = true) {
    const m = munis.get(id);
    if (!m) return;
    input.value = nomeCidade(m);
    lista.hidden = true;
    history.replaceState(null, "", `#cidade=${id}`);
    const r = m.r;
    painel.innerHTML = `
      <div class="cidade-topo"><h3>${esc(nomeCidade(m))}</h3><button type="button" class="mais" id="ver-no-mapa">Ver no mapa</button></div>
      <div class="disputas">
        ${disputa("Presidente · 2º turno", r.pres2, r.pres1, fluxo(m))}
        ${disputa("Presidente · 1º turno", r.pres1)}
      </div>
      <div class="cidade-comparec">${tabelaComparec(m)}</div>`;
    painel.querySelector("#ver-no-mapa")!.addEventListener("click", () => {
      ir("mapa").then(() => document.querySelector(`#mapa-area path[data-id="${id}"]`)?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 })));
    });
    if (rolar) document.getElementById("cidade")!.scrollIntoView();
  }
  return abrir;
}
