"use strict";

const GOOGLE_CLIENT_ID = "903361544580-2q3vp79k7jv9moq8meincgtr3bhfrmua.apps.googleusercontent.com";
const SPREADSHEET_ID = "1uLDmcH1U2ayy08LkMXHKvqddYkmwUQqAmd520ilo_XI";
const TOKEN_KEY = "googleSheetsAccessToken";

const state = {
  mode: null,
  query: "",
  selected: null,
  menuOpen: false,
  loggedIn: false,
  accessToken: "",
  catalogRows: [],
  loginError: "",
  checkingCredentials: true,
  movementForm: { origin: "", status: "", storage: "", qty: "1" },
  photoMetaVisible: true,
  status: "Catálogo sincronizado há 2 min",
};

const fallbackSets = [
  { code: "10300", ean: "5702017153186", name: "Back to the Future Time Machine", theme: "LEGO Icons", year: 2022, pieces: 1872, stock: 1, location: "Vitrine A · 02", color: "#d5e5ef" },
  { code: "21325", ean: "5702016911985", name: "Medieval Blacksmith", theme: "LEGO Ideas", year: 2021, pieces: 2164, stock: 2, location: "Estante C · 03", color: "#e5d2b5" },
  { code: "42143", ean: "5702017159041", name: "Ferrari Daytona SP3", theme: "LEGO Technic", year: 2022, pieces: 3778, stock: 1, location: "Vitrine B · 01", color: "#efc5c5" },
  { code: "75257", ean: "5702016370799", name: "Millennium Falcon", theme: "LEGO Star Wars", year: 2019, pieces: 1353, stock: 3, location: "Estante A · 02", color: "#d4d4d1" },
];

const icons = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m15 4-8 8 8 8"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>',
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.2H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z"/><path fill="#34a853" d="M12 22c2.7 0 5-.9 6.7-2.4L15.4 17c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.7A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.4H3A10 10 0 0 0 3 16.6l3.4-2.7Z"/><path fill="#ea4335" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7A6 6 0 0 1 12 6Z"/></svg>',
  scanner: '<svg class="scanner-glyph" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 3H5a2 2 0 0 0-2 2v4M19 3h4a2 2 0 0 1 2 2v4M9 25H5a2 2 0 0 1-2-2v-4M19 25h4a2 2 0 0 0 2-2v-4M7 9v10M10 9v10M14 9v10M17 9v10M21 9v10"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function menuMarkup(id) {
  const login = state.loggedIn
    ? `<button class="google-login signed-in" data-action="logout"><span>↪</span><span><strong>Terminar sessão</strong><small>Sessão Google ativa</small></span></button>`
    : `<button class="google-login" data-action="login"><span>${icons.google}</span><span><strong>Entrar com Google</strong><small>Aceder ao inventário</small></span></button>`;
  return `<div class="menu-popover" id="${id}">${login}
    <p class="menu-group-title">BASE DE DADOS</p>
    ${menuItem("↓", "yellow", "Transferir Base de Dados", "Download offline da BD")}
    ${menuItem("▦", "green", "Abrir Google Sheets", "Ver tabela completa", "open-sheet")}
    ${menuItem("↻", "blue", "Atualizar Catálogos", "Sync via API Brickset")}
    <p class="menu-group-title extras">EXTRAS</p>
    ${menuItem("▣", "orange", "Modo Inventário", "Iniciar novo inventário")}
    ${menuItem("▽", "blue", "Consultas Avançadas", "Filtros por tema, período...")}
  </div>`;
}

function menuItem(symbol, color, title, description, action = "noop") {
  return `<button class="menu-action" data-action="${action}"><span class="menu-action-icon ${color}">${symbol}</span><span><strong>${title}</strong><small>${description}</small></span><b class="menu-chevron">›</b></button>`;
}

function headerMarkup() {
  if (state.mode === "entrada" || state.mode === "saida") {
    return `<header class="masthead movement-header">
      <button class="movement-header-back" data-action="back" aria-label="Voltar às opções">${icons.back}</button>
      <h1>${state.mode === "entrada" ? "ENTRADA" : "SAÍDA"}</h1>
      <div class="header-menu movement-header-menu">
        <button class="hamburger-button" data-action="toggle-menu" aria-expanded="${state.menuOpen}" aria-controls="movement-menu" aria-label="${state.menuOpen ? "Fechar" : "Abrir"} menu">${state.menuOpen ? icons.close : icons.menu}</button>
        ${state.menuOpen ? menuMarkup("movement-menu") : ""}
      </div>
    </header>`;
  }
  return `<header class="masthead">
    <a class="brand" href="https://comunidade0937.com/forum/" aria-label="Comunidade 0937">
      <picture><source media="(max-width:850px)" srcset="public/comunidade-0937-bricks.svg"><img src="public/comunidade-0937.svg" alt="Comunidade 0937"></picture>
    </a>
    <div class="header-menu">
      <button class="header-search-button" aria-label="Pesquisar">${icons.search}</button>
      <button class="hamburger-button" data-action="toggle-menu" aria-expanded="${state.menuOpen}" aria-controls="main-menu" aria-label="${state.menuOpen ? "Fechar" : "Abrir"} menu">${state.menuOpen ? icons.close : icons.menu}</button>
      ${state.menuOpen ? menuMarkup("main-menu") : ""}
    </div>
  </header>`;
}

function optionCard(mode, title, description, image) {
  return `<button data-mode="${mode}" ${state.loggedIn ? "" : "disabled"} class="option-card ${mode}"><span class="mode-option-image"><img src="public/options/${image}.png" alt=""></span><span><strong>${title}</strong><small>${description}</small></span><b>›</b></button>`;
}

function optionsMarkup() {
  const loginTitle = state.loginError || (state.checkingCredentials ? "A verificar credenciais..." : "Inicia sessão para continuar");
  const loginHelp = state.loginError ? "Toca aqui para tentar novamente." : state.checkingCredentials ? "A confirmar o acesso ao Google Sheets." : "As opções ficam disponíveis após o login com Google.";
  const login = state.loggedIn ? "" : `<button type="button" class="login-required ${state.loginError ? "has-error" : ""}" data-action="login">${icons.lock}<span><strong>${escapeHtml(loginTitle)}</strong><small>${loginHelp}</small></span></button>`;
  return `<section class="intro" id="inventario"><p class="tagline">O que queres fazer hoje?</p></section>
    <section class="workspace"><section class="options-panel"><h2 class="options-title">Opções</h2>${login}<div class="options-grid">
      ${optionCard("entrada", "Entrada", "Registar set recebido", "entrada")}
      ${optionCard("saida", "Saída", "Registar set enviado", "saida")}
      ${optionCard("consulta", "Consultar", "Ver detalhes e stock", "lote")}
      ${optionCard("lote", "Modo Lote", "Scan múltiplo rápido", "consultar")}
    </div></section></section>`;
}

function keypadMarkup() {
  const numbers = [1,2,3,4,5,6,7,8,9].map(number => `<button data-digit="${number}">${number}</button>`).join("");
  return `<section class="workspace"><section class="scan-panel"><div class="entry-keypad ${state.mode}">
    <label for="entry-code">Digite o N.º do Set ou Código de Barras</label>
    <input id="entry-code" class="keypad-display" value="${escapeHtml(state.query)}" readonly inputmode="none" tabindex="-1" aria-label="Código introduzido através do teclado no ecrã">
    <div class="number-grid">${numbers}<button class="delete-key" data-action="delete" aria-label="Apagar último dígito">C</button><button data-digit="0">0</button><button class="ok-key" data-action="lookup">OK</button></div>
    <div class="keypad-actions"><button class="clear-key" data-action="clear">LIMPAR</button><button class="scanner-key" data-action="scanner">${icons.scanner} SCANNER</button></div>
  </div></section></section>`;
}

function foundMarkup() {
  const item = state.selected;
  return `<section class="workspace"><section class="scan-panel"><div class="set-found-screen"><article class="set-found-card">
    <h3>${escapeHtml(item.code)} <span>–</span> ${escapeHtml(item.name)}</h3>
    <button type="button" class="set-found-photo" data-action="toggle-photo-meta" aria-label="Mostrar ou ocultar Ano e Tema" aria-pressed="${!state.photoMetaVisible}">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(`${item.code} - ${item.name}`)}">` : "<span>Imagem indisponível</span>"}${state.photoMetaVisible ? `<span class="set-photo-meta"><span><small>ANO</small><b>${escapeHtml(item.year || "—")}</b></span><span><small>TEMA</small><b>${escapeHtml(item.theme || "—")}</b></span></span>` : ""}</button>
    <div class="movement-fields">
      <label><span>Origem <b aria-hidden="true">*</b></span><input type="text" name="origin" data-movement-field="origin" value="${escapeHtml(state.movementForm.origin)}" required autocomplete="off"></label>
      <label><span>Estado</span><input type="text" name="status" data-movement-field="status" value="${escapeHtml(state.movementForm.status)}" autocomplete="off"></label>
      <label><span>Local <b aria-hidden="true">*</b></span><input type="text" name="storage" data-movement-field="storage" value="${escapeHtml(state.movementForm.storage)}" required autocomplete="off"></label>
      <div class="movement-field qty-field"><label for="movement-qty"><span>Qtd <b aria-hidden="true">*</b></span></label><div class="qty-control"><input id="movement-qty" type="number" name="qty" data-movement-field="qty" value="${escapeHtml(state.movementForm.qty)}" min="1" step="1" inputmode="numeric" required autocomplete="off"><div class="qty-stepper"><button type="button" data-action="qty-increase" aria-label="Aumentar quantidade">▴</button><button type="button" data-action="qty-decrease" aria-label="Diminuir quantidade">▾</button></div></div></div>
    </div>
    <div class="movement-form-actions"><button type="button" class="movement-cancel" data-action="movement-cancel">CANCELAR</button><button type="button" class="movement-ok" data-action="movement-confirm">OK</button></div>
  </article></div></section></section>`;
}

function genericModeMarkup() {
  const title = state.mode === "lote" ? "Adicionar conjuntos ao lote" : "Consultar conjunto";
  const result = state.selected ? resultMarkup(state.selected) : "";
  return `<section class="workspace"><section class="scan-panel"><div class="scan-heading"><span class="big-icon ${state.mode}">▦</span><div><h2>${title}</h2></div></div>
    <label class="code-label" for="lego-code">Código do conjunto ou EAN</label><div class="code-row"><div class="code-input"><span>▥</span><input id="lego-code" value="${escapeHtml(state.query)}" placeholder="Ex.: 10300 ou 5702017153186" inputmode="numeric" autocomplete="off"><kbd>ENTER</kbd></div><button class="search-button" data-action="lookup">Pesquisar</button></div>
    <div class="divider"><span>ou</span></div><button class="scanner-button" data-action="scanner"><span class="scan-corners">▦</span><strong>Ler com scanner</strong><small>O leitor envia o EAN automaticamente</small></button><p class="scanner-tip"><b>i</b> Leitores USB/Bluetooth funcionam como teclado: basta apontar e ler.</p>${result}</section></section>`;
}

function resultMarkup(item) {
  return `<article class="set-result"><div class="set-art" style="background:${escapeHtml(item.color)}"><span>#${escapeHtml(item.code)}</span></div><div class="set-copy"><p>${escapeHtml(item.theme)} · ${escapeHtml(item.year)}</p><h3>${escapeHtml(item.name)}</h3><div class="set-meta"><span><small>PEÇAS</small><b>${Number(item.pieces).toLocaleString("pt-PT")}</b></span><span><small>STOCK</small><b>${item.stock} un.</b></span><span><small>LOCAL</small><b>${escapeHtml(item.location)}</b></span></div></div><button class="confirm-button ${state.mode}" data-action="register">${state.mode === "lote" ? "Adicionar ao lote" : "Abrir ficha"} <span>→</span></button></article>`;
}

function render() {
  const content = !state.mode ? optionsMarkup() : state.selected && (state.mode === "entrada" || state.mode === "saida") ? foundMarkup() : state.mode === "entrada" || state.mode === "saida" ? keypadMarkup() : genericModeMarkup();
  document.querySelector("#app").innerHTML = headerMarkup() + content;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function findSet(code) {
  const query = code.trim();
  if (!state.catalogRows.length) return fallbackSets.find(item => item.code === query || item.ean === query);
  const headers = state.catalogRows.slice(0, 2);
  const row = state.catalogRows.slice(2).find(item => String(item[1] ?? "").trim() === query || item.some((cell, column) => headers.some(header => normalizeHeader(header[column]) === "ean") && String(cell).trim() === query));
  if (!row) return undefined;
  const value = name => {
    const wanted = normalizeHeader(name);
    const index = row.findIndex((unused, column) => headers.some(header => normalizeHeader(header[column]) === wanted));
    return index >= 0 ? String(row[index] ?? "") : "";
  };
  const number = value("Number") || String(row[1] ?? query);
  const filename = value("ImageFilename");
  const imageFile = filename && /\.[a-z0-9]+$/i.test(filename) ? filename : filename ? `${filename}.jpg` : "";
  return { code: number, ean: value("EAN"), name: value("SetName") || `Conjunto ${number}`, theme: value("Theme") || "LEGO", year: Number(value("Year") || value("YearFrom")) || 0, pieces: Number(value("Pieces")) || 0, stock: 0, location: "—", color: "#e5edf3", imageUrl: imageFile ? `https://images.brickset.com/sets/images/${imageFile}` : "" };
}

async function loadCatalog(token) {
  const range = encodeURIComponent("BricksetSets!A1:ZZ");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("NO_ACCESS");
  if (response.status === 404) throw new Error("SPREADSHEET_NOT_FOUND");
  if (response.status === 400) throw new Error("SHEET_NOT_FOUND");
  if (!response.ok) throw new Error(`SHEETS_ERROR_${response.status}`);
  const data = await response.json();
  state.catalogRows = (data.values || []).map(row => row.map(String));
  state.loggedIn = true;
  state.loginError = "";
  state.status = "Sessão iniciada · catálogo BricksetSets disponível";
}

function loginWithGoogle() {
  if (state.checkingCredentials) return;
  state.menuOpen = false;
  state.loginError = "";
  if (!window.google?.accounts?.oauth2) {
    state.loginError = "A preparar o login Google. Tenta novamente.";
    render();
    return;
  }
  const client = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: "https://www.googleapis.com/auth/spreadsheets", callback: async response => {
    if (!response.access_token) {
      state.checkingCredentials = false;
      state.loginError = `Não foi possível iniciar sessão com Google${response.error ? ` (${response.error})` : ""}.`;
      render();
      return;
    }
    state.checkingCredentials = true;
    render();
    try {
      await loadCatalog(response.access_token);
      state.accessToken = response.access_token;
      sessionStorage.setItem(TOKEN_KEY, response.access_token);
    } catch (error) {
      const messages = { NO_ACCESS: "Esta conta Google não tem acesso ao inventário.", AUTH_EXPIRED: "A autorização Google expirou. Inicia sessão novamente.", SPREADSHEET_NOT_FOUND: "O spreadsheet do inventário não foi encontrado.", SHEET_NOT_FOUND: "A folha BricksetSets não foi encontrada." };
      state.loggedIn = false;
      state.catalogRows = [];
      state.loginError = messages[error.message] || `Não foi possível consultar o Google Sheets (${error.message}).`;
    }
    state.checkingCredentials = false;
    render();
  }});
  client.requestAccessToken({ prompt: "select_account" });
}

function logoutGoogle() {
  if (state.accessToken && window.google) window.google.accounts.oauth2.revoke(state.accessToken);
  sessionStorage.removeItem(TOKEN_KEY);
  Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, loggedIn: false, accessToken: "", catalogRows: [], loginError: "", checkingCredentials: false, movementForm: { origin: "", status: "", storage: "", qty: "1" }, status: "Sessão terminada" });
  render();
}

function lookup() {
  const found = findSet(state.query);
  state.selected = found || null;
  state.photoMetaVisible = true;
  state.status = found ? `Conjunto ${found.code} encontrado no catálogo` : state.query ? "Código não encontrado. Confirma o número ou EAN." : "Digite ou leia um código para continuar.";
  render();
}

document.addEventListener("click", event => {
  const modeButton = event.target.closest("[data-mode]");
  if (modeButton && !modeButton.disabled) {
    state.mode = modeButton.dataset.mode;
    state.query = "";
    state.selected = null;
    state.menuOpen = false;
    state.movementForm = { origin: "", status: "", storage: "", qty: "1" };
    state.photoMetaVisible = true;
    render();
    return;
  }
  const digit = event.target.closest("[data-digit]");
  if (digit) {
    state.query += digit.dataset.digit;
    state.selected = null;
    render();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "toggle-menu") state.menuOpen = !state.menuOpen;
  if (action === "back") Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, movementForm: { origin: "", status: "", storage: "", qty: "1" } });
  if (action === "delete") { state.query = state.query.slice(0, -1); state.selected = null; }
  if (action === "clear") Object.assign(state, { query: "", selected: null });
  if (action === "qty-increase") state.movementForm.qty = String(Math.max(1, (Number.parseInt(state.movementForm.qty, 10) || 1) + 1));
  if (action === "qty-decrease") state.movementForm.qty = String(Math.max(1, (Number.parseInt(state.movementForm.qty, 10) || 1) - 1));
  if (action === "toggle-photo-meta") state.photoMetaVisible = !state.photoMetaVisible;
  if (action === "movement-cancel") {
    Object.assign(state, { query: "", selected: null, movementForm: { origin: "", status: "", storage: "", qty: "1" }, photoMetaVisible: true });
    render();
    return;
  }
  if (action === "movement-confirm") {
    const requiredFields = [...document.querySelectorAll(".movement-fields [required]")];
    const invalidField = requiredFields.find(field => !field.checkValidity());
    if (invalidField) {
      invalidField.reportValidity();
      return;
    }
    state.status = `${state.mode === "entrada" ? "Entrada" : "Saída"} pronta para registar no sheet Movimentos.`;
    return;
  }
  if (action === "lookup") { lookup(); return; }
  if (action === "scanner") Object.assign(state, { query: "5702016370799", selected: null });
  if (action === "login") { loginWithGoogle(); return; }
  if (action === "logout") { logoutGoogle(); return; }
  if (action === "open-sheet") window.open(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`, "_blank", "noopener");
  if (action === "register") state.status = `${state.mode === "lote" ? "Item adicionado ao lote" : "Consulta"} preparada para ${state.selected.code}.`;
  render();
});

document.addEventListener("input", event => {
  const movementField = event.target.dataset?.movementField;
  if (movementField) {
    if (movementField === "qty" && event.target.value !== "" && (!/^\d+$/.test(event.target.value) || Number(event.target.value) < 1)) {
      event.target.value = state.movementForm.qty;
      return;
    }
    state.movementForm[movementField] = event.target.value;
    return;
  }
  if (event.target.id !== "lego-code") return;
  state.query = event.target.value.replace(/\D/g, "");
  state.selected = null;
  event.target.value = state.query;
});

document.addEventListener("keydown", event => {
  if (event.target.id === "lego-code" && event.key === "Enter") lookup();
});

async function restoreSession() {
  render();
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) {
    state.checkingCredentials = false;
    render();
    return;
  }
  try {
    await loadCatalog(token);
    state.accessToken = token;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    state.loginError = "A sessão Google expirou. Inicia sessão novamente.";
  }
  state.checkingCredentials = false;
  render();
}

restoreSession();
