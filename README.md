# Grid Arcade

Dois jogos fan-made inspirados em TRON (1982), feitos só com HTML, CSS e JavaScript puro.
Sem build, sem dependências, sem servidor: é só publicar no GitHub Pages.

| Jogo | Arquivo | Resumo |
|---|---|---|
| **Light Cycles** | `lightcycles.html` | Arena de eliminação com motos de luz. 1 ou 2 jogadores (mesmo teclado) + até 5 IAs. O último de pé vence o round; o primeiro a 3 rounds vence a partida. |
| **Space Paranoids** | `spaceparanoids.html` | Batalha de tanques em labirinto neon. Setores infinitos, tanques inimigos, Recognizers voadores, itens e recorde salvo no navegador. |

## Controles

Os dois jogos mostram **joysticks virtuais na tela** (toque no celular, mouse no computador). O botão 🎮 no topo mostra/esconde os controles. Também funcionam com **controle de videogame** (Xbox, PlayStation etc. via USB/Bluetooth).

**Light Cycles**
- 1 jogador: setas ou WASD para virar, `Espaço` para turbo
- 2 jogadores: P1 `WASD` + `Espaço`, P2 setas + `Enter`
- Na tela: joystick para virar e botão TURBO (no modo 2 jogadores, um par de cada lado)
- Controle: analógico/direcional vira, `A`/`RT` turbo, `Start` pausa (1º controle = P1, 2º = P2)
- `P`/`Esc` pausa, `M` liga/desliga o som

**Space Paranoids**
- `WASD` ou setas: mover
- Mouse: mirar, clique para atirar
- Só teclado: `Q`/`E` giram a torre, `Espaço` atira
- Na tela: joystick esquerdo move, joystick direito mira e atira, botão FOGO atira
- Controle: analógico esquerdo move, direito mira e atira, `RT`/`A` atira, `Start` pausa

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo `grid-arcade`).
2. Envie os arquivos:
   ```bash
   git init
   git add .
   git commit -m "Grid Arcade"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/grid-arcade.git
   git push -u origin main
   ```
3. No GitHub, abra **Settings → Pages**, em *Build and deployment* escolha **Deploy from a branch**, branch `main`, pasta `/ (root)` e salve.
4. Em um ou dois minutos o site fica no ar em `https://SEU_USUARIO.github.io/grid-arcade/`.

Se o repositório se chamar `SEU_USUARIO.github.io`, o site fica direto em `https://SEU_USUARIO.github.io/`.

## Rodar localmente

Abra `index.html` no navegador, ou sirva a pasta:

```bash
python -m http.server 8000
```

## Estrutura

```
index.html            menu principal
lightcycles.html      Light Cycles
spaceparanoids.html   Space Paranoids
css/style.css         estilo neon compartilhado
js/common.js          sons sintetizados (Web Audio), ajuste do canvas, armazenamento
js/lightcycles.js     lógica do Light Cycles (grade, IA com flood fill, rounds)
js/spaceparanoids.js  lógica do Space Paranoids (labirinto, IA com BFS, ricochete)
```

Fan game não oficial, sem fins lucrativos. TRON é marca da Disney.
