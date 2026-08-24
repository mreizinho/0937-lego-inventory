# Inventário LEGO · Comunidade 0937

Aplicação web estática para consultar e movimentar conjuntos LEGO através de um Google Sheet.

## Estrutura

- `index.html` — estrutura e metadados da página.
- `styles.css` — apresentação desktop e mobile.
- `app.js` — navegação, login Google e consulta ao catálogo.
- `public/` — logótipos e imagens das opções.

Não utiliza React, Node.js nem processo de compilação.

## Desenvolvimento local

Pode abrir `index.html` diretamente para verificar o layout. Para testar login e pedidos ao Google, deve servi-lo através de HTTP:

```powershell
python -m http.server 3000
```

Depois aceda a `http://localhost:3000/`.

## Publicação

Cada alteração enviada para a branch `main` é publicada diretamente pelo workflow do GitHub Pages, sem instalar dependências nem compilar o projeto.
