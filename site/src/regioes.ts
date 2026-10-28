// Seções Regiões, Estados e Cidades (porte e capital × interior), com roscas e barras 100%.
import { Municipio, Candidato, Curiosidade, num, pct, pts, titulo, esc, barra, cabecalhoMedia, media } from "./util";
import { corCandidato } from "./cores";
import { htmlCard } from "./cards";
import { REGIOES, NOME_UF, PORTES, Turno, Soma, Somas, agregar, regiao, porte, ehCapital, pA, pB, pO } from "./agregados";
import { rosca, ativarRoscas, empilhadas, ativarDicas, linhaTip, Fatia } from "./graficos";

type Cands = Record<string, Candidato>;

export function criarRegioes(munis: Map<string, Municipio>, cand: Cands, finalistas: [string, string], observar: () => void) {
  const [A, B] = finalistas;
  const nA = titulo(cand[A]?.n ?? "?"), nB = titulo(cand[B]?.n ?? "?");
  const todos = [...munis.values()];
  const porRegiao = agregar(todos, regiao, finalistas);
  const porUf = agregar(todos, (m) => (m.uf === "ZZ" ? null : m.uf), finalistas);
  const brasil = agregar(todos, () => "BR", finalistas).get("BR")!;
  const ctx: Ctx = { A, B, nA, nB, brasil, porRegiao, porUf, observar };

  secaoRegioes(ctx);
  secaoEstados(ctx);
  secaoCidades(ctx, todos);
}

interface Ctx {
  A: string; B: string; nA: string; nB: string;
  brasil: Somas; porRegiao: Map<string, Somas>; porUf: Map<string, Somas>;
  observar: () => void;
}

const COR_A = "var(--lula)", COR_B = "var(--flavio)", COR_O = "var(--outro)";

function fatias(c: Ctx, s: Soma, t: Turno): Fatia[] {
  const f: Fatia[] = [{ nome: c.nA, valor: s.a, cor: COR_A }, { nome: c.nB, valor: s.b, cor: COR_B }];
  if (t === "1") f.push({ nome: "Outros candidatos", valor: s.o, cor: COR_O });
  return f;
}

/** Texto do centro da rosca: % de quem ficou na frente. */
function centro(c: Ctx, s: Soma): [string, string] {
  const frente = s.a >= s.b;
  return [pct(frente ? pA(s) : pB(s)), frente ? c.nA : c.nB];
}

/** Margem de quem venceu, em pontos: "Lula +12,3". */
const margem = (c: Ctx, s: Soma) => {
  const d = pA(s) - pB(s);
  return `${d >= 0 ? c.nA : c.nB} +${pct(Math.abs(d)).replace("%", "")}`;
};

function dica(c: Ctx, nome: string, s: Soma, t: Turno) {
  return `<b>${esc(nome)} · ${t}º turno</b>` +
    linhaTip(esc(c.nA), `${pct(pA(s))} · ${num(s.a)}`) +
    linhaTip(esc(c.nB), `${pct(pB(s))} · ${num(s.b)}`) +
    (t === "1" ? linhaTip("Outros", `${pct(pO(s))} · ${num(s.o)}`) : "") +
    linhaTip("Votos válidos", num(s.t));
}

/** Seletor de turno logo abaixo do título do tópico; chama `desenha` ao trocar. */
function seletorTurno(el: HTMLElement, desenha: (t: Turno) => void, rotulo = "Turno") {
  el.innerHTML = `<button type="button" data-t="2" aria-pressed="true">2º turno</button><button type="button" data-t="1" aria-pressed="false">1º turno</button>`;
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", rotulo);
  el.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-t]");
    if (!b) return;
    el.querySelectorAll("[data-t]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    desenha(b.dataset.t as Turno);
  });
  desenha("2");
}

function cards(c: Ctx, onde: string, secao: string, itens: Curiosidade[]) {
  const el = document.querySelector(onde)!;
  el.innerHTML = itens.map((x) => htmlCard(secao, x)).join("");
  c.observar();
}

// ---------------------------------------------------------------- Regiões
function secaoRegioes(c: Ctx) {
  const roscas = document.getElementById("reg-roscas")!;
  seletorTurno(document.getElementById("reg-turno")!, (t) => {
    const fig = (nome: string, s: Soma) => rosca(fatias(c, s, t), { tam: 128, titulo: nome, centro: centro(c, s), legenda: true });
    roscas.innerHTML = fig("Brasil", c.brasil[t]) +
      REGIOES.map((r) => fig(r.nome, c.porRegiao.get(r.id)![t])).join("") +
      (c.porRegiao.get("ZZ") ? fig("Exterior", c.porRegiao.get("ZZ")![t]) : "");
  });
  ativarRoscas(roscas);

  // curiosidades
  const regs = REGIOES.map((r) => ({ ...r, s: c.porRegiao.get(r.id)!["2"] }));
  const venceuA = regs.filter((r) => r.s.a > r.s.b), venceuB = regs.filter((r) => r.s.b > r.s.a);
  const lista = (rs: typeof regs) => rs.map((r) => `no ${r.nome}`).join(", ").replace(/, ([^,]*)$/, " e $1");
  const apertada = [...regs].sort((x, y) => Math.abs(x.s.a - x.s.b) - Math.abs(y.s.a - y.s.b))[0];
  // região onde cada finalista abriu mais vantagem (um card para os dois lados, sem contrafactual)
  const maiorA = [...regs].sort((x, y) => (y.s.a - y.s.b) - (x.s.a - x.s.b))[0];
  const maiorB = [...regs].sort((x, y) => (y.s.b - y.s.a) - (x.s.b - x.s.a))[0];
  const mi = (v: number) => `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  const itens: Curiosidade[] = [
    {
      titulo: "Placar das regiões",
      destaque: `${venceuA.length} × ${venceuB.length}`,
      texto: `${c.nA} venceu ${lista(venceuA)}; ${c.nB}, ${lista(venceuB)} (2º turno).`,
    },
    {
      titulo: `A região mais dividida: ${apertada.nome}`,
      destaque: `${num(Math.abs(apertada.s.a - apertada.s.b))} votos`,
      texto: `No ${apertada.nome}, ${apertada.s.a > apertada.s.b ? c.nA : c.nB} venceu por ${pct(pA(apertada.s), 2)} a ${pct(pB(apertada.s), 2)}, entre ${num(apertada.s.t)} votos válidos.`,
    },
    {
      titulo: "Onde cada um abriu mais vantagem",
      destaque: `${mi(maiorA.s.a - maiorA.s.b)} × ${mi(maiorB.s.b - maiorB.s.a)}`,
      texto: `A maior vantagem de ${c.nA} foi no ${maiorA.nome}: ${num(maiorA.s.a - maiorA.s.b)} votos. A de ${c.nB}, no ${maiorB.nome}: ${num(maiorB.s.b - maiorB.s.a)} votos (2º turno).`,
    },
  ];
  cards(c, "#regioes .cards", "Regiões", itens);
}

// ---------------------------------------------------------------- Estados
function secaoEstados(c: Ctx) {
  const ufs = [...c.porUf.keys()];
  const virou = (uf: string) => {
    const s = c.porUf.get(uf)!;
    return s["1"].a > s["1"].b !== s["2"].a > s["2"].b;
  };

  const barras = document.getElementById("est-barras")!;
  seletorTurno(document.getElementById("est-turno")!, (t) => {
    const ord = [...ufs].sort((x, y) => (pA(c.porUf.get(y)![t]) - pB(c.porUf.get(y)![t])) - (pA(c.porUf.get(x)![t]) - pB(c.porUf.get(x)![t])));
    barras.innerHTML = empilhadas(ord.map((uf) => {
      const s = c.porUf.get(uf)![t];
      return {
        rot: `${esc(NOME_UF[uf])}`, selo: virou(uf) ? "virou no 2º turno" : undefined,
        segs: [{ valor: s.a, cor: COR_A }, ...(t === "1" ? [{ valor: s.o, cor: COR_O }] : []), { valor: s.b, cor: COR_B }],
        dir: margem(c, s), tip: dica(c, NOME_UF[uf], s, t),
      };
    }));
  });
  ativarDicas(barras);

  // estados que trocaram de líder: rosca do 1º e do 2º turno lado a lado
  const viradas = ufs.filter(virou).sort((x, y) => c.porUf.get(y)!["2"].t - c.porUf.get(x)!["2"].t);
  const vir = document.getElementById("est-viradas")!;
  vir.innerHTML = viradas.length ? viradas.map((uf) => {
    const s = c.porUf.get(uf)!;
    return `<div class="painel par-roscas"><h4>${esc(NOME_UF[uf])}</h4>
      <div class="par">${rosca(fatias(c, s["1"], "1"), { tam: 128, titulo: "1º turno", centro: centro(c, s["1"]) })}
      <span class="seta" aria-hidden="true">→</span>
      ${rosca(fatias(c, s["2"], "2"), { tam: 128, titulo: "2º turno", centro: centro(c, s["2"]) })}</div>
      <p class="meta">${s["1"].a > s["1"].b ? c.nA : c.nB} liderou o 1º turno por ${num(Math.abs(s["1"].a - s["1"].b))} votos; ${s["2"].a > s["2"].b ? c.nA : c.nB} venceu o 2º por ${num(Math.abs(s["2"].a - s["2"].b))}.</p></div>`;
  }).join("") : `<p class="nota">Nenhum estado trocou de líder entre os turnos.</p>`;
  ativarRoscas(vir);

  // os 10 estados onde cada finalista mais cresceu entre os turnos
  const cresc = document.getElementById("est-cresc")!;
  const notaCresc = document.getElementById("nota-est-cresc")!;
  const desenhaCresc = (medida: "pp" | "votos") => {
    notaCresc.textContent = medida === "pp"
      ? "Diferença entre a % dos votos válidos no 2º e no 1º turno, em pontos percentuais."
      : "Votos no 2º turno menos votos no 1º turno.";
    cresc.innerHTML = ([[c.A, "a", pA], [c.B, "b", pB]] as const).map(([sq, k, p], i) => {
      const linhas = ufs.map((uf) => {
        const s = c.porUf.get(uf)!;
        return { uf, p1: p(s["1"]), p2: p(s["2"]), v1: s["1"][k], v2: s["2"][k] };
      }).map((x) => ({ ...x, dpp: x.p2 - x.p1, dv: x.v2 - x.v1 }))
        .sort((x, y) => (medida === "pp" ? y.dpp - x.dpp : y.dv - x.dv)).slice(0, 10);
      const val = (x: (typeof linhas)[number]) => (medida === "pp" ? x.dpp : x.dv);
      const max = Math.max(...linhas.map((x) => Math.abs(val(x))), 1e-9);
      const nome = sq === c.A ? c.nA : c.nB;
      const cab = cabecalhoMedia(`<span class="marca" style="background:${corCandidato(i)}"></span>Onde ${esc(nome)} mais cresceu`,
        pts(media(linhas.map((x) => x.dpp))), "média, em pontos");
      return `<div class="painel lista">${cab}<ol>${
        linhas.map((x) => barra(esc(NOME_UF[x.uf]),
          medida === "pp" ? `${pts(x.dpp)}<small>${pct(x.p1)} → ${pct(x.p2)}</small>`
                          : `${x.dv >= 0 ? "+" : "−"}${num(Math.abs(x.dv))}<small>${num(x.v1)} → ${num(x.v2)}</small>`,
          Math.abs(val(x)) / max, val(x) < 0 ? "var(--text-3)" : corCandidato(i), "", "li")).join("")}</ol></div>`;
    }).join("");
  };
  const botoes = document.querySelectorAll<HTMLButtonElement>("#est-cresc-medida [data-m]");
  botoes.forEach((b) => b.addEventListener("click", () => {
    botoes.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    desenhaCresc(b.dataset.m as "pp" | "votos");
  }));
  desenhaCresc("pp");

  // curiosidades
  const s2 = (uf: string) => c.porUf.get(uf)!["2"];
  const maisA = [...ufs].sort((x, y) => pA(s2(y)) - pA(s2(x)))[0];
  const maisB = [...ufs].sort((x, y) => pB(s2(y)) - pB(s2(x)))[0];
  const empate1 = [...ufs].sort((x, y) => Math.abs(c.porUf.get(x)!["1"].a - c.porUf.get(x)!["1"].b) - Math.abs(c.porUf.get(y)!["1"].a - c.porUf.get(y)!["1"].b))[0];
  const e1 = c.porUf.get(empate1)!;
  const zeroB = ufs.filter((u) => s2(u).cidB === 0 && s2(u).cidades > 1).map((u) => NOME_UF[u]);
  const zeroA = ufs.filter((u) => s2(u).cidA === 0).map((u) => NOME_UF[u]);
  const lista = (l: string[]) => l.join(", ").replace(/, ([^,]*)$/, " e $1");
  const itens: Curiosidade[] = [];
  if (viradas.length) {
    const uf = viradas[0], s = c.porUf.get(uf)!;
    itens.push({
      titulo: `${NOME_UF[uf]}: o estado que virou`,
      destaque: `${pct(pA(s["1"]))} → ${pct(pA(s["2"]))}`,
      texto: `${c.nA} tinha ${pct(pA(s["1"]))} dos válidos no 1º turno e chegou a ${pct(pA(s["2"]))} no 2º. ` +
        `${viradas.length > 1 ? `Também viraram: ${lista(viradas.slice(1).map((u) => NOME_UF[u]))}.` : "Foi o único estado a trocar de líder."}`,
    });
  }
  itens.push(
    {
      titulo: "Os dois extremos",
      destaque: `${pct(pA(s2(maisA)))} × ${pct(pB(s2(maisB)))}`,
      texto: `${NOME_UF[maisA]} deu a maior votação proporcional a ${c.nA} (${pct(pA(s2(maisA)))}); ${NOME_UF[maisB]}, a maior a ${c.nB} (${pct(pB(s2(maisB)))}).`,
    },
    {
      titulo: `${NOME_UF[empate1]}: empate no 1º turno`,
      destaque: `${num(Math.abs(e1["1"].a - e1["1"].b))} votos`,
      texto: `Foi a diferença entre ${c.nA} (${num(e1["1"].a)}) e ${c.nB} (${num(e1["1"].b)}) no 1º turno. No 2º, ${e1["2"].a > e1["2"].b ? c.nA : c.nB} venceu com ${pct(Math.max(pA(e1["2"]), pB(e1["2"])))}.`,
    },
  );
  if (zeroB.length || zeroA.length) itens.push({
    titulo: "Estados sem uma única cidade para um finalista",
    destaque: `${zeroB.length + zeroA.length} estados`,
    texto: [zeroB.length ? `${c.nB} não venceu em nenhuma cidade destes estados: ${lista(zeroB)}.` : "",
      zeroA.length ? `${c.nA} não venceu em nenhuma cidade destes: ${lista(zeroA)}${zeroA.includes("Distrito Federal") ? " (o DF tem um município só)" : ""}.` : ""].join(" "),
  });
  cards(c, "#estados .cards", "Estados", itens);
}

// ---------------------------------------------------------------- Cidades
function secaoCidades(c: Ctx, todos: Municipio[]) {
  const porPorte = agregar(todos, porte, [c.A, c.B]);
  const barras = document.getElementById("cid-porte")!;
  seletorTurno(document.getElementById("cid-porte-turno")!, (t) => {
    barras.innerHTML = empilhadas(PORTES.map((p) => {
      const s = porPorte.get(p.id)![t];
      return {
        rot: `${esc(p.nome)}<small>${num(s.cidades)} cidades · ${num(s.t)} votos válidos</small>`,
        segs: [{ valor: s.a, cor: COR_A }, ...(t === "1" ? [{ valor: s.o, cor: COR_O }] : []), { valor: s.b, cor: COR_B }],
        dir: margem(c, s), tip: dica(c, p.nome, s, t),
      };
    }));
  });
  ativarDicas(barras);

  // capital × interior, por estado (o DF é um município só)
  const cap = agregar(todos, (m) => (m.uf === "ZZ" || m.uf === "DF" ? null : `${m.uf}|${ehCapital(m) ? "c" : "i"}`), [c.A, c.B]);
  const ufs = [...new Set([...cap.keys()].map((k) => k.split("|")[0]))];
  const nomeCap = new Map(todos.filter(ehCapital).map((m) => [m.uf, titulo(m.nome)]));
  // curiosidades
  const ps = PORTES.map((p) => ({ ...p, s: porPorte.get(p.id)!["2"] }));
  const ladoA = ps.filter((p) => p.s.a > p.s.b), ladoB = ps.filter((p) => p.s.b > p.s.a);
  const capitais = todos.filter(ehCapital).map((m) => ({ m, d: m.r.pres2! }))
    .map(({ m, d }) => ({ m, a: d.c.find((x) => x[0] === c.A)?.[1] ?? 0, b: d.c.find((x) => x[0] === c.B)?.[1] ?? 0, t: d.t }));
  const capA = capitais.filter((x) => x.a > x.b), capB = capitais.filter((x) => x.b > x.a);
  const contra = ufs.filter((uf) => {
    const sc = cap.get(`${uf}|c`)!["2"], si = cap.get(`${uf}|i`)!["2"];
    return sc.a > sc.b !== si.a > si.b;
  });
  const lista = (l: string[]) => l.join(", ").replace(/, ([^,]*)$/, " e $1");
  const gap = ufs.map((uf) => ({ uf, d: pA(cap.get(`${uf}|c`)!["2"]) - pA(cap.get(`${uf}|i`)!["2"]) }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
  const itens: Curiosidade[] = [
    {
      titulo: "Cidade pequena, média ou grande",
      destaque: `${ladoA.length} × ${ladoB.length} faixas`,
      texto: `${c.nA} venceu nas faixas ${lista(ladoA.map((p) => p.nome.toLowerCase()))}; ${c.nB}, nas faixas ${lista(ladoB.map((p) => p.nome.toLowerCase()))} (eleitores aptos por cidade).`,
    },
    {
      titulo: "Placar das capitais",
      destaque: `${capA.length} × ${capB.length}`,
      texto: `${c.nA} venceu em ${capA.length} capitais e ${c.nB} em ${capB.length} (contando Brasília). A maior votação de ${c.nA} numa capital foi em ${titulo([...capitais].sort((x, y) => y.a / y.t - x.a / x.t)[0].m.nome)}; a de ${c.nB}, em ${titulo([...capitais].sort((x, y) => y.b / y.t - x.b / x.t)[0].m.nome)}.`,
    },
    {
      titulo: "Capital na contramão do estado",
      destaque: `${contra.length} estados`,
      texto: contra.length
        ? `Em ${lista(contra.map((u) => NOME_UF[u]))}, a capital escolheu um vencedor diferente do interior. A maior distância foi em ${NOME_UF[gap.uf]}: ${c.nA} teve ${pct(Math.abs(gap.d)).replace("%", " pontos")} a ${gap.d < 0 ? "menos" : "mais"} em ${nomeCap.get(gap.uf)} do que no interior do estado.`
        : `Em todos os estados, capital e interior escolheram o mesmo vencedor.`,
    },
  ];
  cards(c, "#cidades .cards", "Cidades", itens);
}
