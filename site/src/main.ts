// fontes hospedadas no próprio site (assim também entram nas imagens dos cards)
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/800.css";
import { Resumo, Candidato, Municipio, esc, nomeCidade, contarEvento, num, pct } from "./util";
import { htmlCard, ativarCards } from "./cards";
import { placar, listas, crescimento, viradas } from "./presidente";
import { criarMapa, corrigirOrientacao } from "./mapa";
import { criarBusca } from "./cidade";
import { criarUrnas, DadosUrnas, DadosLogs } from "./urnas";
import { comparecimento, abstencaoEstados } from "./comparecimento";
import { criarRegioes } from "./regioes";
import { criarOutros } from "./outros";
import { criarMistura } from "./mistura";
import { agregar, regiao, REGIOES, NOME_UF } from "./agregados";
import { iniciarPaginas, ir, mostrarElemento, atualizarAbas, ativarBuscaDeCidades, cartao, miniaturaDoMapa, PAGINAS } from "./paginas";

const dados = (nome: string) => fetch(`${import.meta.env.BASE_URL}data/${nome}`).then((r) => {
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.json();
});

// Seção do resumo (gerado em Python) -> elemento onde os cards entram.
// Seções que não estão aqui (governadores, deputados etc.) ficam fora do site, que é só de presidente.
const DESTINO: Record<string, string> = {
  "Urnas": "#urnas .cards",
};

function tema() {
  const raiz = document.documentElement;
  const bt = document.getElementById("tema")!;
  const escuro = () => raiz.dataset.theme === "dark" ||
    (raiz.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const rotular = () => bt.setAttribute("aria-label", escuro() ? "Mudar para o tema claro" : "Mudar para o tema escuro");
  try { const t = localStorage.getItem("tema"); if (t) raiz.dataset.theme = t; } catch { /* sem storage */ }
  rotular();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rotular);
  bt.addEventListener("click", () => {
    raiz.dataset.theme = escuro() ? "light" : "dark";
    try { localStorage.setItem("tema", raiz.dataset.theme); } catch { /* sem storage */ }
    rotular();
    window.dispatchEvent(new Event("tema"));
  });
}

async function iniciar() {
  tema();
  iniciarPaginas();
  const [resumo, cand] = await Promise.all([dados("resumo.json") as Promise<Resumo>, dados("candidatos.json") as Promise<Record<string, Candidato>>]);
  // vermelho fica sempre com o PT: finalista do PT na posição 0
  if (cand[resumo.finalistas[1]]?.p === "PT") resumo.finalistas.reverse();

  let abrirCidade: (id: string) => void = () => {};
  const abrir = (id: string) => { ir("cidade").then(() => abrirCidade(id)); };

  placar(resumo, cand);
  cartoesDaCapa(resumo, cand);
  listas(resumo, cand, abrir);
  crescimento(resumo, cand, abrir);
  if (resumo.comparecimento) comparecimento(resumo, abrir);
  viradas(resumo, cand, abrir);
  for (const [secao, itens] of Object.entries(resumo.secoes)) {
    const destino = Object.entries(DESTINO).find(([k]) => k === secao)?.[1] ??
      (secao.startsWith("Comparecimento") ? "#abstencao .cards" : null);
    const el = destino && document.querySelector(destino);
    // nas urnas, as mais movimentadas vêm antes das curiosidades de urnas com poucos votos
    const ordem = secao === "Urnas" ? [...itens].sort((x, y) => Number(y.titulo.startsWith("A urna mais")) - Number(x.titulo.startsWith("A urna mais"))) : itens;
    if (el) el.insertAdjacentHTML("beforeend", ordem.map((c) => htmlCard(secao.replace(/ \(.*\)$/, ""), c)).join(""));
  }
  const observar = ativarCards();
  observar();
  document.getElementById("sobre-geracao")!.textContent = `Arquivos do TSE gerados em: ${Object.entries(resumo.geracao).map(([k, v]) => `${k} ${v}`).join(" · ")}.`;
  document.getElementById("fonte")!.innerHTML = `Site independente, sem vínculo com o TSE, partidos ou candidatos. Fonte: <a href="https://dadosabertos.tse.jus.br/dataset/resultados-2026">Portal de Dados Abertos do TSE</a> (votação para presidente por município, zona e seção eleitoral, detalhe da apuração por seção e logs das urnas eletrônicas) e malhas territoriais do <a href="https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html">IBGE</a>.
    Arquivos do TSE gerados em: ${Object.entries(resumo.geracao).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ")}.
    Os arquivos ainda podem ser atualizados por recontagens e decisões judiciais.`;

  // card citado no link (#id) depois que os cards existem
  citadoNoLink();

  // logs.json vem de logs_urna.py (processamento à parte, demorado); sem ele a seção sai sem os logs
  Promise.all([dados("urnas.json") as Promise<DadosUrnas>, (dados("logs.json") as Promise<DadosLogs>).catch(() => undefined)])
    .then(([u, l]) => {
      criarUrnas(u, cand, resumo.finalistas, abrir, l);
      if (document.body.dataset.pagina === "urnas") atualizarAbas();
      cartoesDasUrnas(u, l, cand, resumo.finalistas);
    })
    .catch((e) => falha("urnas-app", e));

  try {
    const [munList, malha, ufs] = await Promise.all([dados("municipios.json") as Promise<Municipio[]>, dados("malha.json"), dados("malha_ufs.json")]);
    const munis = new Map(munList.map((m) => [m.id, m]));
    abrirCidade = criarBusca(munis, cand, resumo.finalistas);
    ativarBuscaDeCidades(munis, abrir);
    cartoesDosMunicipios(munis, cand, resumo.finalistas);
    // seções que dependem dos municípios: cada uma isolada, para um erro não derrubar as outras
    for (const [onde, f] of [
      ["reg-roscas", () => criarRegioes(munis, cand, resumo.finalistas, observar)],
      ["out-geral", () => criarOutros(resumo, munis, cand, resumo.finalistas, abrir, observar)],
      ["mistura", () => criarMistura(resumo, cand, resumo.finalistas, abrir, observar)],
      ["abst-estados", () => abstencaoEstados(munis.values())],
    ] as [string, () => void][]) {
      try { f(); } catch (e) { falha(onde, e); }
    }
    // card citado no link (#id) que só existe depois dessas seções
    citadoNoLink();
    corrigirOrientacao(malha);
    corrigirOrientacao(ufs);
    const mapas = [
      criarMapa(malha, ufs, munis, cand, resumo.finalistas, abrir, { area: "mapa-area", legenda: "mapa-legenda", modos: "mapa-modos", inicial: "pres2" }),
      criarMapa(malha, ufs, munis, cand, resumo.finalistas, abrir, { area: "abst-area", legenda: "abst-legenda", modos: "abst-modos", inicial: "abst2" }),
    ];
    // municípios sem contorno na malha do IBGE (ex.: criados depois dela): avisa em vez de sumirem calados
    const naMalha = new Set(malha.features.map((f: any) => f.properties.id));
    const semMapa = munList.filter((m) => m.uf !== "ZZ" && !naMalha.has(m.id));
    if (semMapa.length) for (const id of ["mapa-legenda", "abst-legenda"]) document.getElementById(id)!.insertAdjacentHTML("afterend",
      `<p class="nota">${semMapa.map((m) => esc(nomeCidade(m))).join(", ")} ainda não ${semMapa.length > 1 ? "têm" : "tem"} contorno na malha de municípios do IBGE, por isso não ${semMapa.length > 1 ? "aparecem" : "aparece"} no mapa; os votos estão em todas as contas e na busca.</p>`);
    miniaturaDoMapa();
    const repintar = () => { mapas.forEach((m) => m.repintar()); miniaturaDoMapa(); };
    window.addEventListener("tema", repintar);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repintar);
    const cidadeNoLink = () => {
      const m = location.hash.match(/^#cidade=(.+)$/);
      if (m) abrirCidade(m[1]);
    };
    cidadeNoLink();
    window.addEventListener("hashchange", cidadeNoLink);
  } catch (e) {
    falha("mapa-area", e);
    falha("abst-area", e);
  }
}

/** Link antigo para um card ou trecho (#id): abre a página onde ele está. */
function citadoNoLink() {
  const h = location.hash.slice(1);
  if (!h || h.startsWith("cidade=") || PAGINAS.some((p) => p.id === h)) return;
  const el = document.getElementById(h);
  if (el) mostrarElemento(el);
}

// números de destaque dos cartões da capa
const milhoes = (n: number) => `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milhões`;
// no número grande do cartão, a unidade vai menor
const milhoesN = (n: number) => `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}<span class="u"> milhões</span>`;
const lados = (a: number | string, b: number | string) => `<span style="color:var(--lula)">${a}</span><em>×</em><span style="color:var(--flavio)">${b}</span>`;

function cartoesDaCapa(resumo: Resumo, cand: Record<string, Candidato>) {
  const nome = (id: string) => esc(cand[id]?.n ?? "");
  const v = resumo.presidente.viradas;

  const paraA = v.filter((x) => x.venceu2 === resumo.finalistas[0]).length;
  cartao("cidades", num(v.length), `cidades trocaram de vencedor entre os turnos: <b>${num(paraA)}</b> passaram para ${nome(resumo.finalistas[0])} e <b>${num(v.length - paraA)}</b> para ${nome(resumo.finalistas[1])}`);
  const comp = resumo.comparecimento;
  const b = comp?.brasil["2"], subiu = comp?.abstSubiu[0];
  if (b && subiu) cartao("abstencao", milhoesN(b.QT_ABSTENCOES), `de eleitores não foram votar no 2º turno. Em <b>${esc(subiu.nome)} (${subiu.uf})</b>, a abstenção subiu de ${pct(subiu.a1, 0)} para ${pct(subiu.a2, 0)}`);
  const t1 = resumo.presidente.totais["1"];
  const [A, B] = resumo.finalistas;
  const outros = t1.c.filter(([id]) => id !== A && id !== B).sort((x, y) => y[1] - x[1]);
  const fora = outros.reduce((s, [, n]) => s + n, 0);
  if (outros[0]) cartao("outros", milhoesN(fora), `de votos foram para os outros ${outros.length} candidatos no 1º turno. O 3º colocado, <b>${nome(outros[0][0])}</b>, teve ${milhoes(outros[0][1])}. Para onde foram no 2º turno?`);
}

function cartoesDosMunicipios(munis: Map<string, Municipio>, cand: Record<string, Candidato>, [A, B]: [string, string]) {
  const nome = (id: string) => esc(cand[id]?.n ?? "");
  // vencidos por cada lado e, para cada um, onde teve a maior porcentagem
  const lider = (ag: Map<string, { "2": { a: number; b: number; t: number } }>) => {
    let a = 0, b = 0;
    const topoA = { k: "", p: 0 }, topoB = { k: "", p: 0 };
    for (const [k, s] of ag) {
      if (k === "ZZ") continue;
      const x = s["2"];
      if (x.a > x.b) a++; else b++;
      if (100 * x.a / x.t > topoA.p) Object.assign(topoA, { k, p: 100 * x.a / x.t });
      if (100 * x.b / x.t > topoB.p) Object.assign(topoB, { k, p: 100 * x.b / x.t });
    }
    return { a, b, topoA, topoB };
  };
  const brasil = agregar(munis.values(), (m) => (m.uf === "ZZ" ? null : "BR"), [A, B]).get("BR")!["2"];
  cartao("mapa", lados(num(brasil.cidA), num(brasil.cidB)), `cidades vencidas por <b>${nome(A)}</b> e por <b>${nome(B)}</b> no 2º turno. Veja o mapa, cidade por cidade`);
  const e = lider(agregar(munis.values(), (m) => (m.uf === "ZZ" ? null : m.uf), [A, B]));
  cartao("estados", lados(e.a, e.b), `estados vencidos por cada finalista. Maior votação: <b>${pct(e.topoA.p, 0)}</b> para ${nome(A)} (${esc(NOME_UF[e.topoA.k])}) e <b>${pct(e.topoB.p, 0)}</b> para ${nome(B)} (${esc(NOME_UF[e.topoB.k])})`);
  const r = lider(agregar(munis.values(), regiao, [A, B]));
  const nomeReg = (id: string) => REGIOES.find((x) => x.id === id)!.nome;
  cartao("regioes", lados(r.a, r.b), `regiões vencidas por cada finalista. Maior votação: <b>${pct(r.topoA.p, 0)}</b> para ${nome(A)} (${nomeReg(r.topoA.k)}) e <b>${pct(r.topoB.p, 0)}</b> para ${nome(B)} (${nomeReg(r.topoB.k)})`);
}

function cartoesDasUrnas(u: DadosUrnas, l: DadosLogs | undefined, cand: Record<string, Candidato>, [A, B]: [string, string]) {
  const nome = (id: string) => esc(cand[id]?.n ?? "");
  const z = u.turnos["2"]?.zeradas;
  if (z) {
    const za = z[A]?.total ?? 0, zb = z[B]?.total ?? 0;
    cartao("zeradas", num(za + zb), `urnas sem nenhum voto para um dos finalistas no 2º turno: <b>${num(za)}</b> sem voto para ${nome(A)} e <b>${num(zb)}</b> sem voto para ${nome(B)}`);
  }
  const t2 = l?.turnos["2"], t1 = l?.turnos["1"];
  if (t2) {
    const es = t2.porUf.ES;
    cartao("biometria", milhoesN(t2.contadores.semBio ?? 0), `de eleitores votaram <b>sem a digital</b> no 2º turno (${pct((100 * (t2.contadores.semBio ?? 0)) / t2.contadores.votos)}).${es ? ` No Espírito Santo, foram ${pct((100 * es.semBio) / es.votos, 0)} dos eleitores` : ""}`);
  }
  const ult = t1?.depois17.lista[0];
  if (ult) {
    const [h, m] = (ult.ultimo as string).split(":").map(Number);
    const atraso = h * 60 + m - 17 * 60;
    cartao("ultimo", (ult.ultimo as string).replace(":", "h"), `foi o último voto do 1º turno, em <b>${esc(ult.mun)} (${ult.uf})</b>: ${Math.floor(atraso / 60)}h${String(atraso % 60).padStart(2, "0")} depois do fim da votação, e ${num(ult.depois as number)} votos depois das 17h`);
  }
}

function falha(onde: string, e: unknown) {
  console.error(e);
  document.getElementById(onde)!.innerHTML = `<p>Não foi possível carregar os dados (${esc(String((e as Error).message ?? e))}). Rode <code>python3 gerar_dados_site.py</code> na pasta do projeto.</p>`;
}

iniciar().catch((e) => falha("placar", e));

// cliques nos botões "Apoie" (topo e fim da página) entram como evento anônimo no contador de visitas
document.querySelectorAll<HTMLAnchorElement>("[data-apoie]").forEach((a) =>
  a.addEventListener("click", () => contarEvento(`apoie-${a.dataset.apoie}`, "Clique em Apoie")));

// botão flutuante: aparece depois do topo da página e some quando o bloco de apoio do fim está na tela
const flutuante = document.querySelector<HTMLElement>(".apoie-flutuante");
const blocoApoie = document.querySelector(".apoie-bloco");
if (flutuante && blocoApoie) {
  let blocoVisivel = false;
  const atualizar = () => {
    flutuante.hidden = scrollY < 500 || blocoVisivel;
    flutuante.tabIndex = flutuante.hidden ? -1 : 0; // escondido também sai da navegação por teclado
  };
  new IntersectionObserver(([e]) => { blocoVisivel = e.isIntersecting; atualizar(); }).observe(blocoApoie);
  addEventListener("scroll", atualizar, { passive: true });
  atualizar();
}

// inscrição na newsletter: só conta o envio (sem o e-mail) no contador anônimo
document.querySelector("[data-news]")?.addEventListener("submit", () => contarEvento("newsletter-envio", "Inscrição na newsletter"));
