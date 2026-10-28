// Confere os números que o site EXIBE (inclusive as contas feitas no navegador) contra auditoria/esperado.json.
// Rodar no console da página com o site carregado; o esperado.json precisa estar servido em /auditoria-esperado.json.
(async () => {
  const E = await (await fetch("/auditoria-esperado.json")).json();
  const R = [];
  const conferir = (area, item, site, esperado, tol = 0) => {
    const ok = typeof site === "number" && typeof esperado === "number" ? Math.abs(site - esperado) <= tol + 1e-9 : JSON.stringify(site) === JSON.stringify(esperado);
    R.push({ area, item, site, esperado, ok });
  };
  const n = (s) => Number(String(s).replace(/[^\d,−-]/g, "").replace("−", "-").replace(/\./g, "").replace(",", "."));
  const pctDe = (s) => n(String(s).match(/[−-]?[\d.]+,\d+(?=\s*%| pts)/)?.[0] ?? "NaN");
  const r1 = (x) => Math.round(x * 10) / 10;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const UF = { "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM", "Bahia": "BA", "Ceará": "CE", "Distrito Federal": "DF",
    "Espírito Santo": "ES", "Goiás": "GO", "Maranhão": "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS", "Minas Gerais": "MG",
    "Pará": "PA", "Paraíba": "PB", "Paraná": "PR", "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN",
    "Rio Grande do Sul": "RS", "Rondônia": "RO", "Roraima": "RR", "Santa Catarina": "SC", "São Paulo": "SP", "Sergipe": "SE", "Tocantins": "TO" };
  const linhasTip = (el) => {
    const d = document.createElement("div"); d.innerHTML = el.dataset.tip;
    return Object.fromEntries([...d.querySelectorAll(".l")].map((l) => [l.children[0].textContent.trim(), l.children[1].textContent.trim()]));
  };

  // placar
  const lados = [...document.querySelectorAll("#placar .lado")];
  conferir("Placar", "% Lula", n(lados[0].querySelector(".pct").textContent), E.placar.pctA, 0.005);
  conferir("Placar", "% Flávio", n(lados[1].querySelector(".pct").textContent), E.placar.pctB, 0.005);
  conferir("Placar", "votos Lula", n(lados[0].querySelector(".votos").textContent), E.placar.votosA);
  conferir("Placar", "votos Flávio", n(lados[1].querySelector(".votos").textContent), E.placar.votosB);
  const meio = document.querySelector("#placar .placar-meio").textContent.match(/[\d.]{5,}/g).map(n);
  conferir("Placar", "válidos e diferença", meio, [E.placar.validos, E.placar.dif]);

  // regiões (roscas), nos dois turnos
  for (const t of ["2", "1"]) {
    document.querySelector(`#reg-turno [data-t="${t}"]`).click(); await espera(50);
    for (const fig of document.querySelectorAll("#reg-roscas .rosca")) {
      const nome = fig.querySelector("figcaption").textContent.replace("›", "").trim();
      const e = E.regioes[t][nome];
      if (!e) { conferir("Regiões", `${t}º turno: região desconhecida`, nome, null); continue; }
      const li = [...fig.querySelectorAll(".rosca-leg li")];
      conferir("Regiões", `${t}º turno ${nome}: % e votos de Lula`, [pctDe(li[0].textContent), n(li[0].querySelector("small").textContent)], [r1(100 * e.a / e.t), e.a]);
      conferir("Regiões", `${t}º turno ${nome}: % e votos de Flávio`, [pctDe(li[1].textContent), n(li[1].querySelector("small").textContent)], [r1(100 * e.b / e.t), e.b]);
      if (t === "1") conferir("Regiões", `1º turno ${nome}: votos dos outros`, n(li[2].querySelector("small").textContent), e.o);
    }
  }
  document.querySelector('#reg-turno [data-t="2"]').click();

  // estados (barras), nos dois turnos: votos e % no tooltip, ordem e margem
  for (const t of ["2", "1"]) {
    document.querySelector(`#est-turno [data-t="${t}"]`).click(); await espera(50);
    const linhas = [...document.querySelectorAll("#est-barras .emp-linha")];
    conferir("Estados", `${t}º turno: 27 estados no gráfico`, linhas.length, 27);
    for (const l of linhas) {
      const nome = l.querySelector(".emp-rot").firstChild.textContent.trim(), uf = UF[nome], e = E.estados[t][uf];
      const tip = Object.values(linhasTip(l));
      conferir("Estados", `${t}º turno ${uf}: votos Lula, Flávio e válidos`, [n(tip[0].split("·")[1]), n(tip[1].split("·")[1]), n(tip.at(-1))], [e.a, e.b, e.t]);
      const marg = l.querySelector(".emp-dir").textContent;
      conferir("Estados", `${t}º turno ${uf}: margem`, n(marg.split("+")[1]), r1(Math.abs(100 * (e.a - e.b) / e.t)), 0.051);
    }
    const ordem = linhas.map((l) => UF[l.querySelector(".emp-rot").firstChild.textContent.trim()]);
    const esp = Object.keys(E.estados[t]).sort((x, y) => (E.estados[t][y].a - E.estados[t][y].b) / E.estados[t][y].t - (E.estados[t][x].a - E.estados[t][x].b) / E.estados[t][x].t);
    conferir("Estados", `${t}º turno: ordem do mais Lula ao mais Flávio`, ordem, esp);
  }
  document.querySelector('#est-turno [data-t="2"]').click();
  const virou = Object.keys(E.estados[1]).filter((u) => (E.estados[1][u].a > E.estados[1][u].b) !== (E.estados[2][u].a > E.estados[2][u].b));
  conferir("Estados", "estados que trocaram de líder", [...document.querySelectorAll("#est-viradas .par-roscas h4")].map((h) => UF[h.textContent.trim()]).sort(), virou.sort());

  // 10 estados onde cada um mais cresceu (pontos e votos)
  for (const medida of ["pp", "votos"]) {
    document.querySelector(`#est-cresc-medida [data-m="${medida}"]`).click(); await espera(50);
    [...document.querySelectorAll("#est-cresc .painel")].forEach((p, i) => {
      const k = i === 0 ? "a" : "b";
      const val = (u) => medida === "pp" ? 100 * E.estados[2][u][k] / E.estados[2][u].t - 100 * E.estados[1][u][k] / E.estados[1][u].t : E.estados[2][u][k] - E.estados[1][u][k];
      const esp = Object.keys(E.estados[2]).sort((x, y) => val(y) - val(x)).slice(0, 10);
      const site = [...p.querySelectorAll("li")].map((li) => UF[li.querySelector(".rotulo").textContent.trim()]);
      conferir("Estados: crescimento", `${i === 0 ? "Lula" : "Flávio"} (${medida}): os 10 estados e a ordem`, site, esp);
      const v0 = p.querySelector("li .valor").firstChild.textContent;
      conferir("Estados: crescimento", `${i === 0 ? "Lula" : "Flávio"} (${medida}): valor do 1º`, medida === "pp" ? pctDe(v0) : n(v0.split(/\s/)[0]), medida === "pp" ? r1(val(esp[0])) : val(esp[0]), medida === "pp" ? 0.051 : 0);
    });
  }
  document.querySelector('#est-cresc-medida [data-m="pp"]').click();

  // porte das cidades
  for (const t of ["2", "1"]) {
    document.querySelector(`#cid-porte-turno [data-t="${t}"]`).click(); await espera(50);
    for (const l of document.querySelectorAll("#cid-porte .emp-linha")) {
      const nome = l.querySelector(".emp-rot").firstChild.textContent.trim(), e = E.porte[t][nome];
      const tip = Object.values(linhasTip(l));
      conferir("Cidades: porte", `${t}º turno ${nome}: votos Lula, Flávio, válidos`, [n(tip[0].split("·")[1]), n(tip[1].split("·")[1]), n(tip.at(-1))], [e.a, e.b, e.t]);
    }
  }
  document.querySelector('#cid-porte-turno [data-t="2"]').click();

  // abstenção por estado
  const abst = (t, u) => 100 * E.abstEstados[t][u].abst / E.abstEstados[t][u].aptos;
  const dAbst = (u) => abst(2, u) - abst(1, u);
  const painéis = [...document.querySelectorAll("#abst-estados .painel")];
  const ufsAbs = Object.keys(E.abstEstados[1]);
  conferir("Abstenção por estado", "estados onde subiu (ordem)", [...painéis[0].querySelectorAll("li .rotulo")].map((r) => UF[r.textContent.trim()]),
    ufsAbs.filter((u) => dAbst(u) > 0).sort((a, b) => dAbst(b) - dAbst(a)).slice(0, 10));
  conferir("Abstenção por estado", "estados onde caiu (ordem)", [...painéis[1].querySelectorAll("li .rotulo")].map((r) => UF[r.textContent.trim()]),
    ufsAbs.filter((u) => dAbst(u) < 0).sort((a, b) => dAbst(a) - dAbst(b)).slice(0, 10));
  for (const li of document.querySelectorAll("#abst-estados li")) {
    const u = UF[li.querySelector(".rotulo").textContent.trim()]; if (!u) continue;
    const nums = li.querySelector(".valor small").textContent.match(/[\d.]{3,}(?!,)/g).map(n);
    conferir("Abstenção por estado", `${u}: abstenções 1º → 2º turno`, nums.slice(-2), [E.abstEstados[1][u].abst, E.abstEstados[2][u].abst]);
    conferir("Abstenção por estado", `${u}: variação em pontos`, pctDe(li.querySelector(".valor").textContent), r1(dAbst(u)), 0.051);
  }

  // outros candidatos
  const lis = [...document.querySelectorAll("#out-geral ol li")];
  conferir("Outros candidatos", "10 candidatos, na ordem de votos", lis.map((li) => n(li.querySelector(".valor").firstChild.textContent)), E.outros.lista.map((x) => x.votos));
  lis.forEach((li, i) => {
    const x = E.outros.lista[i], txt = li.querySelector(".rotulo").textContent;
    const uf = Object.entries(UF).find(([nome]) => txt.includes(`Mais forte em ${nome} (`))?.[1];
    conferir("Outros candidatos", `${x.nome}: estado mais forte e %`, [uf, pctDe(txt.split("Mais forte em")[1])], [x.melhorUf, x.melhorUfPct], );
  });
  const legFluxo = [...document.querySelectorAll("#out-fluxo .rosca-leg li small")].map((s) => n(s.textContent));
  conferir("Outros candidatos", "de onde vieram (outros, brancos/nulos, comparecimento)", legFluxo.slice(0, 3), [E.outros.somaOutros, E.fluxo.quedaBN, E.fluxo.maisComp]);
  conferir("Outros candidatos", "para quem foram (Lula, Flávio)", legFluxo.slice(3, 5), [E.outros.ganhoA, E.outros.ganhoB]);
  for (const p of document.querySelectorAll("#out-redutos .reduto")) {
    const nome = p.querySelector("h4").firstChild.textContent.replace("Redutos de ", "").trim();
    const e = E.outros.redutos[Object.keys(E.outros.redutos).find((k) => k.toLowerCase() === nome.toLowerCase())];
    const v = [...p.querySelectorAll(".barra-linha .valor")].map((x) => pctDe(x.firstChild.textContent));
    conferir("Outros candidatos", `redutos de ${nome}: crescimento de Lula e Flávio`, v, e ? [e.dA, e.dB] : null, 0.051);
    conferir("Outros candidatos", `redutos de ${nome}: cidade mais forte`, p.querySelector(".mini-lista li span").textContent.split(" – ")[0].toLowerCase(), e?.maisForte.toLowerCase());
  }
  const br = [...document.querySelectorAll("#out-redutos .barra-linha .valor small")].slice(0, 2).map((s) => pctDe(s.textContent));
  conferir("Outros candidatos", "crescimento no Brasil (Lula, Flávio)", br, [E.outros.dA, E.outros.dB], 0.051);

  const porArea = {};
  for (const x of R) porArea[x.area] = (porArea[x.area] ?? 0) + 1;
  return { total: R.length, porArea, divergencias: R.filter((x) => !x.ok) };
})();
