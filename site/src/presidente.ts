// Placar do topo, barras dos dois turnos, listas top/bottom e cidades que viraram.
import { Resumo, Candidato, CidadeLista, Crescimento, Virada, num, pct, pts, titulo, esc, barra, nomeCidade, cabecalhoMedia, media } from "./util";
import { corCandidato } from "./cores";

type Cands = Record<string, Candidato>;
type AbrirCidade = (id: string) => void;

export function placar(r: Resumo, cand: Cands) {
  const t2 = r.presidente.totais["2"];
  const [a, b] = r.finalistas;
  const va = t2.c.find((x) => x[0] === a)![1], vb = t2.c.find((x) => x[0] === b)![1];
  // foto oficial de divulgação do TSE (copiada por gerar_dados_site.py para public/fotos)
  const foto = (sq: string, i: number) => `<img class="avatar" src="${import.meta.env.BASE_URL}fotos/${sq}.jpg" width="88" height="88"
    alt="Foto oficial de ${esc(titulo(cand[sq].n))}" style="--cor:${corCandidato(i)}" onerror="this.remove()">`;
  const lado = (sq: string, v: number, i: number) => `<div class="lado">${foto(sq, i)}<div class="lado-txt">
    <div class="nome"><span class="marca" style="background:${corCandidato(i)}"></span>${esc(titulo(cand[sq].n))} <small>${cand[sq].p}</small></div>
    <div class="pct num">${pct((100 * v) / t2.validos, 2)}</div>
    <div class="votos num">${num(v)} votos</div></div></div>`;
  document.getElementById("placar")!.innerHTML = `
    <div class="placar-nomes">${lado(a, va, 0)}${lado(b, vb, 1)}</div>
    <div class="placar-barra" role="img" aria-label="Divisão dos votos válidos no 2º turno">
      <span style="width:${(100 * va) / t2.validos}%;background:var(--lula)"></span>
      <span style="flex:1;background:var(--flavio)"></span></div>
    <p class="placar-meio">2º turno · ${num(t2.validos)} votos válidos · diferença de <b class="num">${num(Math.abs(va - vb))}</b> votos</p>
    <p class="credito">Fotos: divulgação/TSE</p>`;
}

export function listas(r: Resumo, cand: Cands, abrir: AbrirCidade) {
  const el = document.getElementById("pres-listas")!;
  const nota = document.getElementById("nota-listas")!;
  const desenha = (medida: "pct" | "votos") => {
    nota.textContent = medida === "pct"
      ? `Proporção sobre os votos válidos de cada cidade. Para evitar distorção de cidades minúsculas, só entram municípios com ${num(r.presidente.minValidos)}+ votos válidos.`
      : "Votos absolutos recebidos em cada cidade (todas as cidades do Brasil; exterior fora).";
    el.innerHTML = r.finalistas.map((sq, i) => {
      const c = r.presidente.cidades[sq];
      const nome = esc(titulo(cand[sq].n));
      const bloco = (rot: string, lista: CidadeLista[]) => {
        const max = Math.max(...lista.map((x) => (medida === "pct" ? x.pct : x.votos)), 1);
        const linhas = lista.map((x) => barra(
          esc(nomeCidade(x)),
          medida === "pct" ? `${pct(x.pct)}<small>${num(x.votos)} de ${num(x.validos)}</small>`
                           : `${num(x.votos)}<small>${pct(x.pct)}</small>`,
          (medida === "pct" ? x.pct : x.votos) / (medida === "pct" ? 100 : max),
          corCandidato(i), `data-cidade="${x.id}"`, "li")).join("");
        // média da % dos válidos nas cidades da lista (nos dois modos, as % aparecem em cada linha)
        const cab = cabecalhoMedia(`<span class="marca" style="background:${corCandidato(i)}"></span>${rot} ${nome}`, pct(media(lista.map((x) => x.pct))), "média dos válidos");
        return `<div class="painel lista">${cab}<ol>${linhas}</ol></div>`;
      };
      return medida === "pct"
        ? bloco("10 cidades com mais votos (%) em", c.maiorPct) + bloco("10 cidades com menos votos (%) em", c.menorPct)
        : bloco("10 cidades com mais votos em", c.maiorVotos) + bloco("10 cidades com menos votos em", c.menorVotos);
    }).join("");
  };
  desenha("pct");
  document.querySelectorAll<HTMLButtonElement>("[data-medida]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-medida]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    desenha(b.dataset.medida as "pct" | "votos");
  }));
  el.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-cidade]");
    if (li) abrir(li.dataset.cidade!);
  });
}

export function viradas(r: Resumo, cand: Cands, abrir: AbrirCidade) {
  const el = document.getElementById("viradas")!;
  const v = r.presidente.viradas;
  const [a, b] = r.finalistas;
  const nome = (sq: string) => esc(titulo(cand[sq]?.n ?? "?"));
  const porVencedor = (sq: string) => v.filter((x) => x.venceu2 === sq).length;
  const ufs = [...new Set(v.map((x) => x.uf))].sort();
  el.innerHTML = `
    <div class="resumo-viradas">
      <div class="bloco"><b class="num">${num(v.length)}</b>cidades trocaram de vencedor</div>
      <div class="bloco"><b class="num" style="color:var(--lula)">${num(porVencedor(a))}</b>viraram para ${nome(a)}</div>
      <div class="bloco"><b class="num" style="color:var(--flavio)">${num(porVencedor(b))}</b>viraram para ${nome(b)}</div>
    </div>
    <div class="filtros">
      <input type="search" id="vir-busca" placeholder="Filtrar cidade…" aria-label="Filtrar cidade">
      <select id="vir-uf" aria-label="Estado"><option value="">Todos os estados</option>${ufs.map((u) => `<option>${u}</option>`).join("")}</select>
      <select id="vir-dir" aria-label="Direção da virada"><option value="">Todas as viradas</option>
        <option value="${a}">Viraram para ${nome(a)}</option><option value="${b}">Viraram para ${nome(b)}</option></select>
    </div>
    <div class="tabela-wrap"><table>
      <thead><tr><th>Cidade</th><th>Venceu no 1º turno</th><th class="n">Votos 1º turno</th><th>Venceu no 2º turno</th><th class="n">${nome(a)} · 2º turno</th><th class="n">${nome(b)} · 2º turno</th></tr></thead>
      <tbody></tbody></table></div>
    <button type="button" class="mais" hidden>Mostrar mais</button>`;
  const tbody = el.querySelector("tbody")!, mais = el.querySelector<HTMLButtonElement>(".mais")!;
  const fBusca = el.querySelector<HTMLInputElement>("#vir-busca")!, fUf = el.querySelector<HTMLSelectElement>("#vir-uf")!, fDir = el.querySelector<HTMLSelectElement>("#vir-dir")!;
  let limite = 25;
  const linha = (x: Virada) => {
    const v1 = x.t1[x.venceu1] ?? 0;
    return `<tr class="clicavel" data-cidade="${x.id}"><td>${esc(nomeCidade(x))}</td>
      <td>${nome(x.venceu1)}</td><td class="n">${num(v1)} de ${num(x.validos1)} (${pct((100 * v1) / x.validos1)})</td>
      <td>${nome(x.venceu2)}</td>
      <td class="n">${num(x.t2[a])} (${pct((100 * x.t2[a]) / x.validos2)})</td>
      <td class="n">${num(x.t2[b])} (${pct((100 * x.t2[b]) / x.validos2)})</td></tr>`;
  };
  const desenha = () => {
    const q = fBusca.value.trim().toLowerCase();
    const lista = v.filter((x) => (!fUf.value || x.uf === fUf.value) && (!fDir.value || x.venceu2 === fDir.value) &&
      (!q || x.nome.toLowerCase().includes(q)));
    tbody.innerHTML = lista.slice(0, limite).map(linha).join("") ||
      `<tr><td colspan="6">Nenhuma cidade com esses filtros.</td></tr>`;
    mais.hidden = lista.length <= limite;
    mais.textContent = `Mostrar mais (${num(lista.length - limite)} restantes)`;
  };
  [fBusca, fUf, fDir].forEach((f) => f.addEventListener("input", () => { limite = 25; desenha(); }));
  mais.addEventListener("click", () => { limite += 50; desenha(); });
  tbody.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("[data-cidade]");
    if (tr) abrir(tr.dataset.cidade!);
  });
  desenha();
}

export function crescimento(r: Resumo, cand: Cands, abrir: AbrirCidade) {
  const el = document.getElementById("pres-cresc")!;
  const nota = document.getElementById("nota-cresc")!;
  const sinal = (n: number, f: (x: number) => string) => (n > 0 ? "+" : n < 0 ? "−" : "") + f(Math.abs(n));
  const desenha = (medida: "pp" | "votos") => {
    nota.textContent = medida === "pp"
      ? `Diferença entre a % dos votos válidos no 2º e no 1º turno, em pontos percentuais (cidades com ${num(r.presidente.minValidos)}+ votos válidos). Valores negativos indicam queda.`
      : "Votos no 2º turno menos votos no 1º turno, em todas as cidades do Brasil. Valores negativos indicam que o candidato perdeu votos.";
    el.innerHTML = r.finalistas.map((sq, i) => {
      const c = r.presidente.cidades[sq].crescimento;
      const nome = esc(titulo(cand[sq].n));
      const bloco = (rot: string, lista: Crescimento[]) => {
        const val = (x: Crescimento) => (medida === "pp" ? x.dpp : x.dv);
        const max = Math.max(...lista.map((x) => Math.abs(val(x))), 1);
        const linhas = lista.map((x) => barra(
          esc(nomeCidade(x)),
          medida === "pp"
            ? `${sinal(x.dpp, (v) => pct(v).replace("%", " pts"))} <small>${pct(x.p1)} → ${pct(x.p2)}</small>`
            : `${sinal(x.dv, num)} <small>${num(x.v1)} → ${num(x.v2)}</small>`,
          Math.abs(val(x)) / max, val(x) < 0 ? "var(--text-3)" : corCandidato(i), `data-cidade="${x.id}"`, "li")).join("");
        // média do crescimento (em pontos) das cidades da lista
        const cab = cabecalhoMedia(`<span class="marca" style="background:${corCandidato(i)}"></span>${rot} ${nome}`, pts(media(lista.map((x) => x.dpp))), "média, em pontos");
        return `<div class="painel lista">${cab}<ol>${linhas}</ol></div>`;
      };
      return medida === "pp"
        ? bloco("10 cidades onde mais cresceu", c.maiorPct) + bloco("10 cidades onde menos cresceu (ou caiu)", c.menorPct)
        : bloco("10 cidades onde mais ganhou votos", c.maiorVotos) + bloco("10 cidades onde menos ganhou votos (ou perdeu)", c.menorVotos);
    }).join("");
  };
  desenha("pp");
  document.querySelectorAll<HTMLButtonElement>("[data-cresc]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-cresc]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    desenha(b.dataset.cresc as "pp" | "votos");
  }));
  el.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-cidade]");
    if (li) abrir(li.dataset.cidade!);
  });
}
