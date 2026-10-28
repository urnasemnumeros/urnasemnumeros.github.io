// Os candidatos que não foram ao 2º turno: quem eram, onde foram fortes e o que aconteceu nos redutos deles.
import { Municipio, Candidato, Resumo, Curiosidade, num, pct, pts, titulo, esc, barra, nomeCidade } from "./util";
import { htmlCard } from "./cards";
import { NOME_UF, agregar, pA, pB } from "./agregados";
import { rosca, ativarRoscas } from "./graficos";

const COR_A = "var(--lula)", COR_B = "var(--flavio)", COR_O = "var(--outro)";
const TAM_REDUTO = 100;     // cidades no reduto de cada candidato
const MIN_VALIDOS = 1000;   // para não deixar cidades minúsculas dominarem as %

export function criarOutros(
  r: Resumo, munis: Map<string, Municipio>, cand: Record<string, Candidato>, finalistas: [string, string],
  abrir: (id: string) => void, observar: () => void,
) {
  const [A, B] = finalistas;
  const nA = titulo(cand[A]?.n ?? "?"), nB = titulo(cand[B]?.n ?? "?");
  const nome = (sq: string) => titulo(cand[sq]?.n ?? "?");
  const t1 = r.presidente.totais["1"], t2 = r.presidente.totais["2"];
  const v = (t: typeof t1, sq: string) => t.c.find((x) => x[0] === sq)?.[1] ?? 0;
  const outros = t1.c.filter(([sq]) => sq !== A && sq !== B);
  const somaOutros = outros.reduce((s, [, x]) => s + x, 0);
  const todos = [...munis.values()];
  const votoEm = (m: Municipio, sq: string) => m.r.pres1?.c.find((x) => x[0] === sq)?.[1] ?? 0;

  // ---- visão geral: rosca do 1º turno + lista dos outros
  const melhorUf = (sq: string) => {
    const porUf = new Map<string, [number, number]>();
    for (const m of todos) {
      if (m.uf === "ZZ" || !m.r.pres1) continue;
      const x = porUf.get(m.uf) ?? [0, 0];
      x[0] += votoEm(m, sq); x[1] += m.r.pres1.t;
      porUf.set(m.uf, x);
    }
    const [uf, [vv, tt]] = [...porUf].sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1])[0];
    return { uf, p: (100 * vv) / tt };
  };
  const cidadesDe = (sq: string) => todos
    .filter((m) => m.uf !== "ZZ" && (m.r.pres1?.t ?? 0) >= MIN_VALIDOS && m.r.pres2)
    .map((m) => ({ m, p: (100 * votoEm(m, sq)) / m.r.pres1!.t }))
    .sort((a, b) => b.p - a.p);

  const max = Math.max(...outros.map(([, x]) => x));
  document.getElementById("out-geral")!.innerHTML = `
    <div class="painel centro-rosca">
      ${rosca([
        { nome: nA, valor: v(t1, A), cor: COR_A }, { nome: nB, valor: v(t1, B), cor: COR_B },
        { nome: `Outros ${outros.length} candidatos`, valor: somaOutros, cor: COR_O },
      ], { tam: 200, titulo: "Votos válidos no 1º turno", centro: [pct((100 * somaOutros) / t1.validos), "foram para os outros"], legenda: true })}
    </div>
    <div class="painel lista quebra"><h4><span class="marca" style="background:${COR_O}"></span>Os ${outros.length} que ficaram no 1º turno</h4><ol>
      ${outros.map(([sq, x]) => {
        const u = melhorUf(sq);
        const c = cidadesDe(sq)[0];
        return barra(
          `${esc(nome(sq))} <small>${esc(cand[sq]?.p ?? "")}</small><br><small>Mais forte em ${esc(NOME_UF[u.uf])} (${pct(u.p)})` +
            (c ? ` e em ${esc(nomeCidade(c.m))} (${pct(c.p)})` : "") + `</small>`,
          `${num(x)}<small>${pct((100 * x) / t1.validos, 2)}</small>`, x / max, COR_O, c ? `data-cidade="${c.m.id}"` : "", "li");
      }).join("")}</ol></div>`;
  ativarRoscas(document.getElementById("out-geral")!);

  // ---- de onde vieram e para onde foram os votos a mais dos finalistas
  const b1 = r.comparecimento.brasil["1"], b2 = r.comparecimento.brasil["2"];
  const bn = (b: Record<string, number>) => b.QT_VOTOS_BRANCOS + b.QT_VOTOS_NULOS;
  const quedaBN = bn(b1) - bn(b2), maisComp = b2.QT_COMPARECIMENTO - b1.QT_COMPARECIMENTO;
  const ganhoA = v(t2, A) - v(t1, A), ganhoB = v(t2, B) - v(t1, B);
  const fontes = [
    { nome: "Votos dos outros candidatos no 1º turno", valor: somaOutros, cor: COR_O },
    ...(quedaBN > 0 ? [{ nome: "Queda de brancos e nulos", valor: quedaBN, cor: "var(--text-3)" }] : []),
    ...(maisComp > 0 ? [{ nome: "Eleitores a mais que foram votar", valor: maisComp, cor: "var(--neutro-2)" }] : []),
  ];
  const fluxo = document.getElementById("out-fluxo")!;
  fluxo.innerHTML = `
    <div class="painel centro-rosca">${rosca(fontes, { tam: 180, titulo: "De onde vieram", centro: [`${(fontes.reduce((s, f) => s + f.valor, 0) / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`, "votos em jogo"], legenda: true })}</div>
    <div class="painel centro-rosca">${rosca([{ nome: nA, valor: ganhoA, cor: COR_A }, { nome: nB, valor: ganhoB, cor: COR_B }],
      { tam: 180, titulo: "Para quem foram (votos a mais no 2º turno)", centro: [pct((100 * Math.max(ganhoA, ganhoB)) / (ganhoA + ganhoB)), `para ${ganhoA >= ganhoB ? nA : nB}`], legenda: true })}</div>`;
  ativarRoscas(fluxo);

  // ---- redutos: as cidades onde cada um dos 4 maiores foi mais forte
  const br = agregar(todos, (m) => (m.uf === "ZZ" ? null : "BR"), finalistas).get("BR")!;
  const dA = pA(br["2"]) - pA(br["1"]), dB = pB(br["2"]) - pB(br["1"]);
  const redutos = outros.slice(0, 4).map(([sq]) => {
    const top = cidadesDe(sq).slice(0, TAM_REDUTO);
    const ids = new Set(top.map((x) => x.m.id));
    const s = agregar(top.map((x) => x.m), () => "R", finalistas).get("R")!;
    const ufs = new Map<string, number>();
    top.forEach((x) => ufs.set(x.m.uf, (ufs.get(x.m.uf) ?? 0) + 1));
    const media = (100 * top.reduce((a, x) => a + votoEm(x.m, sq), 0)) / s["1"].t;
    return { sq, top, ids, s, ufs: [...ufs].sort((a, b) => b[1] - a[1]), media,
      dA: pA(s["2"]) - pA(s["1"]), dB: pB(s["2"]) - pB(s["1"]), gA: s["2"].a - s["1"].a, gB: s["2"].b - s["1"].b };
  });
  const maxD = Math.max(...redutos.flatMap((x) => [Math.abs(x.dA), Math.abs(x.dB)]), Math.abs(dA), Math.abs(dB));
  const red = document.getElementById("out-redutos")!;
  red.innerHTML = redutos.map((x) => `<div class="painel reduto">
      <h4>Redutos de ${esc(nome(x.sq))} <small>${esc(cand[x.sq]?.p ?? "")}</small></h4>
      <p class="meta">As ${TAM_REDUTO} cidades onde teve a maior % (média de ${pct(x.media)} dos válidos) · ${x.ufs.slice(0, 3).map(([u, n]) => `${n} em ${u}`).join(", ")}${x.ufs.length > 3 ? "…" : ""}</p>
      <div class="reduto-corpo">
        <div class="lista">
          <p class="mini">Crescimento do 1º para o 2º turno</p>
          ${barra(esc(nA), `${pts(x.dA)}<small>Brasil ${pts(dA)}</small>`, Math.abs(x.dA) / maxD, COR_A)}
          ${barra(esc(nB), `${pts(x.dB)}<small>Brasil ${pts(dB)}</small>`, Math.abs(x.dB) / maxD, COR_B)}
          <p class="mini">Onde foi mais forte</p>
          <ol class="mini-lista">${x.top.slice(0, 3).map((c) => `<li data-cidade="${c.m.id}"><span>${esc(nomeCidade(c.m))}</span><b class="num">${pct(c.p)}</b></li>`).join("")}</ol>
        </div>
        ${rosca([{ nome: nA, valor: x.gA, cor: COR_A }, { nome: nB, valor: x.gB, cor: COR_B }],
          { tam: 120, titulo: "Votos a mais no 2º turno", centro: [pct((100 * Math.max(x.gA, x.gB)) / (x.gA + x.gB)), `para ${x.gA >= x.gB ? nA : nB}`] })}
      </div></div>`).join("");
  ativarRoscas(red);
  for (const el of [red, document.getElementById("out-geral")!]) el.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-cidade]");
    if (li) abrir(li.dataset.cidade!);
  });

  // ---- curiosidades
  const pctA = (100 * ganhoA) / (ganhoA + ganhoB);
  const maisB = [...redutos].sort((a, b) => b.dB / Math.max(dB, 0.01) - a.dB / Math.max(dB, 0.01))[0];
  // para Lula: o reduto (de outro candidato) onde ele mais abriu distância de Flávio no crescimento
  const maisA = redutos.filter((x) => x !== maisB).sort((a, b) => (b.dA - b.dB) - (a.dA - a.dB))[0];
  const nanicos = outros.filter(([, x]) => (100 * x) / t1.validos < 1);
  const somaNanicos = nanicos.reduce((s, [, x]) => s + x, 0);
  const itens: Curiosidade[] = [
    {
      titulo: "Para onde foram os votos a mais",
      destaque: `${pct(pctA)} para ${nA}`,
      texto: `Do 1º para o 2º turno, ${nA} ganhou ${num(ganhoA)} votos e ${nB}, ${num(ganhoB)}. Os outros candidatos tinham somado ${num(somaOutros)} votos no 1º turno.`,
    },
    {
      titulo: `Nos redutos de ${nome(maisB.sq)}, ${nB} cresceu mais`,
      destaque: pts(maisB.dB),
      texto: `Nas ${TAM_REDUTO} cidades onde ${nome(maisB.sq)} foi mais forte, ${nB} cresceu ${pts(maisB.dB)} entre os turnos, contra ${pts(dB)} no Brasil. ${nA} cresceu ${pts(maisB.dA)}.`,
    },
    {
      titulo: `Nos redutos de ${nome(maisA.sq)}, ${nA} cresceu mais`,
      destaque: pts(maisA.dA),
      texto: `Nas ${TAM_REDUTO} cidades onde ${nome(maisA.sq)} foi mais forte, ${nA} cresceu ${pts(maisA.dA)} entre os turnos (Brasil: ${pts(dA)}), enquanto ${nB} cresceu só ${pts(maisA.dB)}.`,
    },
  ];
  if (nanicos.length > 1) itens.push({
    titulo: `${nanicos.length} candidatos com menos de 1% cada`,
    destaque: num(somaNanicos),
    texto: `Somados, ${nanicos.map(([sq]) => nome(sq)).join(", ").replace(/, ([^,]*)$/, " e $1")} tiveram ${num(somaNanicos)} votos (${pct((100 * somaNanicos) / t1.validos, 2)} dos válidos).`,
  });
  document.querySelector("#outros .cards")!.innerHTML = itens.map((c) => htmlCard("Outros candidatos", c)).join("");
  observar();
}
