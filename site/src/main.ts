// fontes hospedadas no próprio site (assim também entram nas imagens dos cards)
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/800.css";
import { Resumo, Candidato, Municipio, esc, nomeCidade, contarEvento } from "./util";
import { htmlCard, ativarCards } from "./cards";
import { placar, listas, crescimento, viradas } from "./presidente";
import { criarMapa, corrigirOrientacao } from "./mapa";
import { criarBusca } from "./cidade";
import { criarUrnas, DadosUrnas } from "./urnas";
import { comparecimento, abstencaoEstados } from "./comparecimento";
import { criarRegioes } from "./regioes";
import { criarOutros } from "./outros";
import { criarMistura } from "./mistura";

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

function navAtiva() {
  const barra = document.querySelector<HTMLElement>(".nav-itens")!;
  const links = [...barra.querySelectorAll<HTMLAnchorElement>("a")];
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) {
      links.forEach((a) => a.classList.toggle("ativo", a.hash === `#${e.target.id}`));
      // rola só o menu na horizontal: scrollIntoView mexeria na rolagem da página e brigaria com o usuário
      const a = links.find((x) => x.hash === `#${e.target.id}`);
      if (a && (a.offsetLeft < barra.scrollLeft || a.offsetLeft + a.offsetWidth > barra.scrollLeft + barra.clientWidth))
        barra.scrollTo({ left: a.offsetLeft - 16 });
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("main > section").forEach((s) => io.observe(s));
}

async function iniciar() {
  tema();
  navAtiva();
  const [resumo, cand] = await Promise.all([dados("resumo.json") as Promise<Resumo>, dados("candidatos.json") as Promise<Record<string, Candidato>>]);
  // vermelho fica sempre com o PT: finalista do PT na posição 0
  if (cand[resumo.finalistas[1]]?.p === "PT") resumo.finalistas.reverse();

  let abrirCidade: (id: string) => void = () => {
    document.getElementById("cidade")!.scrollIntoView();
  };
  const abrir = (id: string) => abrirCidade(id);

  placar(resumo, cand);
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
  document.getElementById("fonte")!.innerHTML = `Site independente, sem vínculo com o TSE, partidos ou candidatos. Fonte: <a href="https://dadosabertos.tse.jus.br/dataset/resultados-2026">Portal de Dados Abertos do TSE</a> (votação para presidente por município, zona e seção eleitoral, e detalhe da apuração por seção) e malhas territoriais do <a href="https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html">IBGE</a>.
    Arquivos do TSE gerados em: ${Object.entries(resumo.geracao).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ")}.
    Os arquivos ainda podem ser atualizados por recontagens e decisões judiciais.`;

  // card citado no link (#id) depois que os cards existem
  if (location.hash && !location.hash.startsWith("#cidade=")) document.querySelector(location.hash)?.scrollIntoView();

  dados("urnas.json")
    .then((u: DadosUrnas) => criarUrnas(u, cand, resumo.finalistas, abrir))
    .catch((e) => falha("urnas-app", e));

  try {
    const [munList, malha, ufs] = await Promise.all([dados("municipios.json") as Promise<Municipio[]>, dados("malha.json"), dados("malha_ufs.json")]);
    const munis = new Map(munList.map((m) => [m.id, m]));
    abrirCidade = criarBusca(munis, cand, resumo.finalistas);
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
    if (location.hash && !location.hash.startsWith("#cidade=")) document.querySelector(location.hash)?.scrollIntoView();
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
    const repintar = () => mapas.forEach((m) => m.repintar());
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

function falha(onde: string, e: unknown) {
  console.error(e);
  document.getElementById(onde)!.innerHTML = `<p>Não foi possível carregar os dados (${esc(String((e as Error).message ?? e))}). Rode <code>python3 gerar_dados_site.py</code> na pasta do projeto.</p>`;
}

iniciar().catch((e) => falha("placar", e));

// cliques nos botões "Apoie" (topo e fim da página) entram como evento anônimo no contador de visitas
document.querySelectorAll<HTMLAnchorElement>("[data-apoie]").forEach((a) =>
  a.addEventListener("click", () => contarEvento(`apoie-${a.dataset.apoie}`, "Clique em Apoie")));
