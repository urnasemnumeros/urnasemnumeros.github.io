# Auditoria dos números do site — Eleições 2026 em Curiosidades

Data: 28/10/2026. Arquivos do TSE gerados em 27/10/2026; API oficial de resultados consultada em 28/10/2026.

## Resultado

| Etapa | Conferências | Divergências |
|---|---:|---:|
| Dados publicados pelo site (`site/public/data`) × API oficial e arquivos brutos | 690 | **0** |
| Números exibidos na tela, inclusive as contas do navegador | 233 | **0** |
| **Total** | **923** | **0** |

Antes das correções, a primeira rodada encontrou **4 erros reais** (abaixo). Todos foram corrigidos no gerador e no site, e a auditoria foi refeita do zero.

## Como foi feita

- **Fonte externa:** API oficial de divulgação de resultados do TSE (`resultados.tse.jus.br`, eleições 6257 e 6258), para presidente, Brasil, 27 estados e exterior, nos dois turnos. Ela é diferente dos arquivos de dados abertos que o site usa. Cópia em `auditoria/api_tse/`.
- **Recálculo independente:** `auditoria/auditar.py` não reaproveita nada de `gerar_dados_site.py`. Ele relê os arquivos brutos do TSE (votação por seção, detalhe por seção, votos por partido) e o cadastro de municípios do IBGE.
- **Tela:** `auditoria/conferir_dom.js` lê os números que o site mostra, inclusive as contas feitas no navegador (regiões, estados, porte, abstenção por estado e outros candidatos), e compara com os valores esperados (`auditoria/esperado.json`).

## O que foi conferido

| Área | Conferências |
|---|---:|
| Arquivos brutos × API oficial: votos de cada candidato e válidos, Brasil + 27 UFs + exterior, 2 turnos | 464 |
| Placar e totais nacionais | 16 |
| Votos por estado a partir dos municípios do site | 56 |
| Comparecimento, abstenção, brancos e nulos: Brasil e 27 estados | 67 |
| Cada um dos 11.431 pares município × turno (votos de todos os candidatos) e 11.514 de comparecimento | 2 |
| Listas de cidades: mais e menos votados, crescimento, viradas e abstenção | 24 |
| Aba Urnas: zeradas, até 10 votos, mais votadas, viradas e perdas | 37 |
| Voto misturado: 3 cargos × 2 lados | 12 |
| Mapa: polígonos, ligações e nomes TSE × IBGE, capitais | 5 |
| Consistência da própria API (estados + exterior = Brasil) | 8 |
| Tela: placar, regiões, estados, crescimento por estado, porte, abstenção por estado, outros candidatos | 233 |

## Erros encontrados e corrigidos

1. **5.246 votos anulados contados como válidos no 1º turno.** São votos no candidato nº 28 (Leonardo Alves de Araujo), cujo registro foi anulado. O TSE os conta como nulos técnicos, mas o arquivo de detalhe por seção os registra como "nominais".
   - Na tabela de comparecimento, os válidos do 1º turno apareciam como 119.306.034 (oficial: **119.300.788**) e os nulos como 3.669.003 (oficial: **3.674.249**).
   - O card "Menos brancos e nulos" passou de −1.816.000 para **−1.821.246**.
   - O placar e os votos de cada candidato já estavam certos.
   - Correção: nulos = comparecimento − brancos − válidos oficiais, por município e no Brasil.
2. **Os mesmos votos entravam como válidos em cada seção da aba Urnas**, distorcendo levemente as % "dos válidos". Correção: só é válido o voto em candidato com registro válido.
3. **Empate tratado como "partido mais votado" no voto misturado.** Em Ipumirim-SC, PT e PL empataram (1.368 votos para deputado estadual). Correção: empate não conta. A contagem estadual "Flávio à frente, PT o mais votado" passou de 92 para **91**.
4. **Cidade fora do mapa sem aviso.** Boa Esperança do Norte-MT é um município novo, ainda sem contorno na malha do IBGE (a API do IBGE não o devolve). Os votos estão em todas as contas. Correção: uma nota automática abaixo dos dois mapas lista os municípios sem contorno.

Durante as correções, a própria auditoria acusou um erro introduzido por mim: um conflito de nome de variável fez o gerador parar antes de gravar os arquivos. Ele foi corrigido antes da rodada final.

## O que foi verificado e não é erro

- **Nomes diferentes TSE × IBGE:** 13 municípios têm grafias diferentes (ex.: Dona Eusébia/Euzébia, Munhoz de Mello/Melo, Boa Saúde/Januário Cicco). Todos foram conferidos um a um: são a mesma cidade, e nenhuma está ligada à cidade errada no mapa.
- **Arquivos do TSE podem mudar** com recontagens e decisões judiciais. Os números refletem a data de geração indicada no rodapé do site.
- **Escolhas de método** (não são erros, mas mudam números e estão explicadas no site):
  - corte de 1.000 votos válidos em algumas listas;
  - comparação só entre os dois finalistas nas urnas que viraram;
  - "PT" e "PL" como partido isolado (sem as federações) no voto misturado;
  - exterior fora da aba Urnas.
- **Seções que mudaram de eleitorado entre os turnos** (ex.: Inácio Martins-PR, de 170 para 18 votos computados) aparecem como "queda". Esse é o dado oficial, mas reflete transferência de eleitores, não mudança de voto.

## Como repetir

```bash
python3 gerar_dados_site.py
python3 -I auditoria/auditar.py
```

Para a tela: sirva `auditoria/esperado.json` em `/auditoria-esperado.json` e rode `auditoria/conferir_dom.js` no console da página.
