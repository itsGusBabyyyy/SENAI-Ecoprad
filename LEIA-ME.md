# Modelo 3D interativo: controle de erosão e águas pluviais

Site estático (HTML + Three.js) com 11 etapas, do terreno natural ao projeto aplicado. Não precisa de servidor pago nem de instalação.

## Como abrir
- **No computador, sem internet:** dê dois cliques em `index.html`. Funciona direto do pendrive.
- **Pelo link:** publique a pasta como descrito abaixo e abra o endereço em qualquer navegador, no computador ou no celular.

## Controles
| Ação | Mouse / teclado | Celular |
|---|---|---|
| Girar a cena | arrastar | arrastar com um dedo |
| Aproximar / afastar | rodinha | pinça com dois dedos |
| Mover o enquadramento | botão direito e arrastar | arrastar com dois dedos |
| Próxima etapa | → , espaço, Enter ou PageDown (passador de slides) | botão › |
| Etapa anterior | ← , PageUp | botão ‹ |
| Antes / Depois | A / D | botões no topo |
| Etiquetas | L | botão de etiqueta |
| Câmera automática por etapa | C | botão de câmera |
| Voltar à vista da etapa | R | botão ↺ |
| Esconder o painel (modo palestra) | H | botão do olho |
| Mostrar ou esconder o texto | T | botão Texto |
| Tela cheia | F | botão de tela cheia |

Clicar nos traços da barra de progresso salta direto para qualquer etapa.

**Qualidade:** o site escolhe sozinho uma versão leve no celular. Para forçar outra, acrescente ao endereço `?q=alta`, `?q=media` ou `?q=baixa`.

## Publicar de graça no GitHub Pages
1. Crie uma conta em https://github.com (gratuita).
2. Clique em **New repository**, dê um nome (ex.: `erosao-3d`), marque **Public** e crie.
3. Na página do repositório, clique em **uploading an existing file** e arraste **todo o conteúdo desta pasta** (`index.html`, `app.js`, `terreno.js`, as pastas `lib` e `src`). Clique em **Commit changes**.
4. Vá em **Settings → Pages**. Em *Branch*, escolha `main` e a pasta `/ (root)` e salve.
5. Em um ou dois minutos o link aparece no topo da mesma página, no formato `https://SEU-USUARIO.github.io/erosao-3d/`.

Alternativas também gratuitas: Netlify Drop (https://app.netlify.com/drop, basta arrastar a pasta) e Cloudflare Pages.

## Editar os textos
Os textos das etapas e o título ficam no começo de `src/app.js` (`CONFIG` e `ETAPAS`). Depois de editar, gere de novo o `app.js` com o esbuild:

```
npx esbuild src/app.js --bundle --format=iife --minify --alias:three=./lib/three.module.js --outfile=app.js
```

Se preferir, peça ao Sky para fazer a troca.

## Arquivos
- `index.html`: página e interface.
- `app.js`: etapas, câmera e interface, já empacotado com o Three.js (gerado a partir de `src/app.js`).
- `terreno.js`: motor do terreno (o mesmo do vídeo, adaptado para tempo real).
- `lib/`: Three.js r160 e OrbitControls (licença MIT em `LICENSE.three.txt`).
