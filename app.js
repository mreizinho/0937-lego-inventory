"use strict";

const GOOGLE_CLIENT_ID = "903361544580-2q3vp79k7jv9moq8meincgtr3bhfrmua.apps.googleusercontent.com";
const SPREADSHEET_ID = "1uLDmcH1U2ayy08LkMXHKvqddYkmwUQqAmd520ilo_XI";
const TOKEN_KEY = "googleSheetsAccessToken";
const APP_HISTORY_ID = "0937-lego-inventory";

function emptyMovementForm(defaults = {}) {
  const storage = defaults.storage || "";
  return { origin: defaults.origin || "", storage, storageChoice: storage, qty: "1", obs: "", allocations: Object.create(null) };
}

const state = {
  mode: null,
  query: "",
  selected: null,
  menuOpen: false,
  loggedIn: false,
  accessToken: "",
  userEmail: "",
  catalogRows: [],
  loginError: "",
  checkingCredentials: true,
  movementForm: emptyMovementForm(),
  movementSaving: false,
  movementNotice: null,
  lastMovementDefaults: { origin: "", storage: "" },
  storageOptions: [],
  locationStock: [],
  photoMetaVisible: true,
  scannerOpen: false,
  scannerStatus: "",
  status: "Catálogo sincronizado há 2 min",
};

function writeAppHistory(step, replace = false) {
  const historyState = { app: APP_HISTORY_ID, step, mode: state.mode, query: state.query };
  window.history[replace ? "replaceState" : "pushState"](historyState, "", window.location.href);
}

function isCurrentHistoryStep(step) {
  return window.history.state?.app === APP_HISTORY_ID && window.history.state.step === step;
}

function sortStorageNames(names) {
  return [...new Set(names.map(value => String(value ?? "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "pt", { sensitivity: "base", numeric: true }));
}

function allocateAcrossLocations(locations, requestedQuantity) {
  let remaining = Math.max(0, Number.parseInt(requestedQuantity, 10) || 0);
  const allocations = Object.create(null);
  [...locations]
    .sort((left, right) => right.stock - left.stock || left.storage.localeCompare(right.storage, "pt", { sensitivity: "base", numeric: true }))
    .forEach(location => {
      const quantity = Math.min(location.stock, remaining);
      if (quantity > 0) allocations[location.storage] = quantity;
      remaining -= quantity;
    });
  return allocations;
}

function updateAllocationControls() {
  document.querySelectorAll("[data-allocation-storage]").forEach(input => {
    input.value = String(state.movementForm.allocations[input.dataset.allocationStorage] || 1);
  });
  const allocated = Object.values(state.movementForm.allocations).reduce((total, quantity) => total + (Number(quantity) || 0), 0);
  state.movementForm.qty = String(allocated);
  const total = document.querySelector("#location-allocation-total");
  if (total) total.textContent = `Total: ${allocated} un.`;
}

function renderPreservingContentScroll() {
  const scrollTop = document.querySelector(".app-content")?.scrollTop || 0;
  render();
  const content = document.querySelector(".app-content");
  if (content) content.scrollTop = scrollTop;
}

let barcodeStream = null;
let barcodeScanTimer = null;
let barcodeSession = 0;
let barcodeFocusTimer = null;
let quaggaScanPending = false;
let lastQuaggaScanAt = Number.NEGATIVE_INFINITY;
let barcodeFrameCanvas = null;
let movementNoticeTimer = null;

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
    ${menuItem("⌂", "blue", "Acções", "Voltar ao ecrã inicial", "home")}
    <p class="menu-group-title">BASE DE DADOS</p>
    ${menuItem("▦", "green", "Abrir Google Sheets", "Ver tabela completa", "show-sheets")}
    ${menuItem("↻", "blue", "Atualizar Catálogos", "Sync via API Brickset")}
    <p class="menu-group-title extras">EXTRAS</p>
    ${menuItem("▣", "orange", "Modo Inventário", "Iniciar novo inventário")}
    ${menuItem("▽", "blue", "Consultas Avançadas", "Filtros por tema, período...")}
  </div>`;
}

function menuItem(symbol, color, title, description, action = "noop") {
  return `<button class="menu-action" data-action="${action}"><span class="menu-action-icon ${color}">${symbol}</span><span><strong>${title}</strong><small>${description}</small></span><b class="menu-chevron">›</b></button>`;
}

function desktopTabsMarkup() {
  const sessionAction = state.loggedIn ? "logout" : "login";
  const sessionLabel = state.loggedIn ? "Logout" : "Login";
  return `<nav class="desktop-tabs" aria-label="Navegação principal">
    <button type="button" class="desktop-tab${state.mode ? "" : " active"}" data-action="home"${state.mode ? "" : ' aria-current="page"'}>Acções</button>
    <button type="button" class="desktop-tab${state.mode === "sheets" ? " active" : ""}" data-action="show-sheets"${state.mode === "sheets" ? ' aria-current="page"' : ""}>Google Sheets</button>
    <button type="button" class="desktop-tab" data-action="noop">Atualizar</button>
    <button type="button" class="desktop-tab" data-action="noop">Inventário</button>
    <button type="button" class="desktop-tab" data-action="noop">Consultas</button>
    <button type="button" class="desktop-tab desktop-session" data-action="${sessionAction}">${sessionLabel}</button>
  </nav>`;
}

function headerMarkup() {
  if (state.mode === "entrada" || state.mode === "saida") {
    return `<header class="masthead movement-header">
      <button class="movement-header-back" data-action="back" aria-label="Voltar às opções">${icons.back}</button>
      <h1>${state.mode === "entrada" ? "ENTRADA" : "SAÍDA"}</h1>
      ${desktopTabsMarkup()}
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
    ${desktopTabsMarkup()}
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
  return `<section class="workspace" id="inventario"><section class="options-panel"><p class="options-prompt">O que queres fazer hoje?</p>${login}<div class="options-grid">
      ${optionCard("entrada", "Entrada", "Registar set recebido", "entrada")}
      ${optionCard("saida", "Saída", "Registar set enviado", "saida")}
      ${optionCard("consulta", "Consultar", "Ver detalhes e stock", "lote")}
      ${optionCard("lote", "Modo Lote", "Scan múltiplo rápido", "consultar")}
    </div></section></section>`;
}

function googleSheetsMarkup() {
  return `<section class="workspace sheets-page"><article class="sheets-explainer">
    <div class="sheets-visual"><img src="public/google-sheets.png" alt="Ilustração do Google Sheets"></div>
    <div class="sheets-copy">
      <p class="sheets-eyebrow">BASE DE DADOS</p>
      <h2>Abrir o inventário no Google Sheets</h2>
      <p>O spreadsheet será aberto num novo separador do browser. Esta aplicação continuará disponível no separador atual.</p>
      <ul><li>Poderás consultar os movimentos e as existências diretamente na folha.</li><li>O acesso continua protegido pela conta Google e pelas permissões do spreadsheet.</li></ul>
      <button type="button" class="sheets-open-button" data-action="open-sheet">ABRIR GOOGLE SHEETS <span aria-hidden="true">↗</span></button>
    </div>
  </article></section>`;
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

function scannerMarkup() {
  return `<section class="camera-scanner" role="dialog" aria-modal="true" aria-labelledby="camera-scanner-title">
    <div class="camera-scanner-panel">
      <header><strong id="camera-scanner-title">LER CÓDIGO DE BARRAS</strong><button type="button" data-action="close-scanner" aria-label="Fechar leitor">${icons.close}</button></header>
      <div class="camera-preview" data-action="focus-camera" role="button" tabindex="0" aria-label="Toque para focar a câmara"><video id="barcode-camera" autoplay muted playsinline></video><span class="camera-guide" aria-hidden="true"></span><span class="camera-focus-point" aria-hidden="true"></span></div>
      <p id="camera-scanner-status" role="status" aria-live="polite">${escapeHtml(state.scannerStatus)}</p>
    </div>
  </section>`;
}

function locationAllocationMarkup() {
  if (state.mode !== "saida") return "";
  const activeAllocations = Object.entries(state.movementForm.allocations).filter(([, quantity]) => Number(quantity) > 0);
  const activeStorages = new Set(activeAllocations.map(([storage]) => storage));
  const rows = activeAllocations.map(([storageName, storedQuantity], index) => {
    const location = state.locationStock.find(item => item.storage === storageName);
    if (!location) return "";
    const storage = escapeHtml(storageName);
    const quantity = Math.min(location.stock, Math.max(1, Number(storedQuantity) || 1));
    const options = state.locationStock.filter(item => item.storage === storageName || !activeStorages.has(item.storage)).map(item => `<option value="${escapeHtml(item.storage)}"${item.storage === storageName ? " selected" : ""}>${escapeHtml(item.storage)} · disponível ${item.stock}</option>`).join("");
    const storageId = `movement-allocation-storage-${index}`;
    const quantityId = `movement-allocation-qty-${index}`;
    return `<div class="location-allocation-row movement-fields"><div class="movement-field storage-field"><label for="${storageId}"><span>Local</span></label><div class="select-control"><select id="${storageId}" data-allocation-choice="${storage}" aria-label="Localização da saída">${options}</select><span class="select-arrow" aria-hidden="true">▾</span></div></div><div class="movement-field qty-field"><label for="${quantityId}"><span>Qtd <b aria-hidden="true">*</b></span></label><div class="qty-control"><input id="${quantityId}" type="number" value="${quantity}" min="1" max="${location.stock}" step="1" inputmode="numeric" data-allocation-storage="${storage}" aria-label="Quantidade a retirar de ${storage}" required><div class="qty-stepper"><button type="button" data-action="allocation-increase" data-storage="${storage}" aria-label="Aumentar quantidade em ${storage}">▴</button><button type="button" data-action="allocation-decrease" data-storage="${storage}" aria-label="Diminuir quantidade em ${storage}">▾</button></div></div></div></div>`;
  }).join("");
  const allocated = Object.values(state.movementForm.allocations).reduce((total, quantity) => total + (Number(quantity) || 0), 0);
  const canAddLocation = activeAllocations.length < state.locationStock.length;
  const lastStorage = escapeHtml(activeAllocations.at(-1)?.[0] || "");
  return `<section class="location-allocations" aria-label="Localizações da saída">${rows}<div class="location-allocation-footer"><strong id="location-allocation-total">Total: ${allocated} un.</strong><span>${activeAllocations.length > 1 ? `<button type="button" data-action="allocation-remove" data-storage="${lastStorage}">− REMOVER ÚLTIMA</button>` : ""}${canAddLocation ? `<button type="button" data-action="allocation-add">+ ADICIONAR LOCALIZAÇÃO</button>` : ""}</span></div></section>`;
}

function foundMarkup() {
  const item = state.selected;
  const memberSelected = state.mode === "saida" && state.movementForm.origin === "Membro";
  const obsRequired = memberSelected || (state.mode === "saida" && state.movementForm.origin === "Outro");
  const originField = state.mode === "saida"
    ? `<label><span>Destino <b aria-hidden="true">*</b></span><div class="select-control"><select name="origin" data-movement-field="origin" required><option value=""${state.movementForm.origin ? "" : " selected"}>Selecionar…</option>${["Espólio", "Membro", "Peças"].map(option => `<option value="${option}"${state.movementForm.origin === option ? " selected" : ""}>${option}</option>`).join("")}<hr><option value="Outro"${state.movementForm.origin === "Outro" ? " selected" : ""}>Outro</option></select><span class="select-arrow" aria-hidden="true">▾</span></div></label>`
    : `<label><span>Origem <b aria-hidden="true">*</b></span><input type="text" name="origin" data-movement-field="origin" value="${escapeHtml(state.movementForm.origin)}" required autocomplete="off"></label>`;
  const creatingStorage = state.movementForm.storageChoice === "__other__";
  const storageOptions = state.storageOptions.map(storage => `<option value="${escapeHtml(storage)}"${state.movementForm.storageChoice === storage ? " selected" : ""}>${escapeHtml(storage)}</option>`).join("");
  const storageField = state.mode === "saida" ? "" : `<div class="movement-field storage-field"><label for="movement-storage-choice"><span>Local <b aria-hidden="true">*</b></span></label><div class="select-control"><select id="movement-storage-choice" name="storageChoice" data-storage-choice required><option value=""${state.movementForm.storageChoice ? "" : " selected"}>Selecionar…</option>${storageOptions}<hr><option value="__other__"${creatingStorage ? " selected" : ""}>Outro…</option></select><span class="select-arrow" aria-hidden="true">▾</span></div><input id="movement-new-storage" type="text" name="storage" data-movement-field="storage" value="${creatingStorage ? escapeHtml(state.movementForm.storage) : ""}" placeholder="Nova localização"${creatingStorage ? " required" : " hidden"} autocomplete="off"></div>`;
  const quantityField = state.mode === "saida" ? "" : `<div class="movement-field qty-field"><label for="movement-qty"><span>Qtd <b aria-hidden="true">*</b></span></label><div class="qty-control"><input id="movement-qty" type="number" name="qty" data-movement-field="qty" value="${escapeHtml(state.movementForm.qty)}" min="1" step="1" inputmode="numeric" required autocomplete="off"><div class="qty-stepper"><button type="button" data-action="qty-increase" aria-label="Aumentar quantidade">▴</button><button type="button" data-action="qty-decrease" aria-label="Diminuir quantidade">▾</button></div></div></div>`;
  return `<section class="workspace"><section class="scan-panel"><div class="set-found-screen"><article class="set-found-card">
    <h3>${escapeHtml(item.code)} <span>–</span> ${escapeHtml(item.name)}</h3>
    <button type="button" class="set-found-photo" data-action="toggle-photo-meta" aria-label="Mostrar ou ocultar Ano e Tema" aria-pressed="${!state.photoMetaVisible}">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(`${item.code} - ${item.name}`)}" draggable="false">` : "<span>Imagem indisponível</span>"}<span class="set-photo-meta"${state.photoMetaVisible ? "" : " hidden"}><span><small>ANO</small><b>${escapeHtml(item.year || "—")}</b></span><span><small>TEMA</small><b>${escapeHtml(item.theme || "—")}</b></span></span></button>
    <div class="movement-fields${state.mode === "saida" ? " no-storage" : ""}">
      ${originField}
      <label><span><span id="movement-obs-label">${memberSelected ? "Nome do Membro" : "Obs"}</span> <b id="movement-obs-required" aria-hidden="true"${obsRequired ? "" : " hidden"}>*</b></span><input id="movement-obs" type="text" name="obs" data-movement-field="obs" value="${escapeHtml(state.movementForm.obs)}"${obsRequired ? " required" : ""} autocomplete="off"></label>
      ${storageField}
      ${quantityField}
      ${locationAllocationMarkup()}
    </div>
    <div class="movement-form-actions"><button type="button" class="movement-cancel" data-action="movement-cancel"${state.movementSaving ? " disabled" : ""}>CANCELAR</button><button type="button" class="movement-ok" data-action="movement-confirm"${state.movementSaving ? " disabled" : ""}>${state.movementSaving ? "A REGISTAR…" : "OK"}</button></div>
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
  const content = !state.mode ? optionsMarkup() : state.mode === "sheets" ? googleSheetsMarkup() : state.selected && (state.mode === "entrada" || state.mode === "saida") ? foundMarkup() : state.mode === "entrada" || state.mode === "saida" ? keypadMarkup() : genericModeMarkup();
  const notice = state.movementNotice ? `<div class="app-toast ${state.movementNotice.type}" role="status">${escapeHtml(state.movementNotice.message)}</div>` : "";
  document.querySelector("#app").innerHTML = `${headerMarkup()}<div class="app-content">${content}</div>${state.scannerOpen ? scannerMarkup() : ""}${notice}`;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function findSet(code) {
  const query = code.trim();
  if (!state.catalogRows.length) return fallbackSets.find(item => item.code === query || item.ean === query);
  const headers = state.catalogRows.slice(0, 2);
  const eanColumn = 24; // Coluna Y da folha BricksetSets.
  const row = state.catalogRows.slice(2).find(item => String(item[1] ?? "").trim() === query || String(item[eanColumn] ?? "").trim() === query);
  if (!row) return undefined;
  const value = name => {
    const wanted = normalizeHeader(name);
    const index = row.findIndex((unused, column) => headers.some(header => normalizeHeader(header[column]) === wanted));
    return index >= 0 ? String(row[index] ?? "") : "";
  };
  const number = value("Number") || String(row[1] ?? query);
  const filename = value("ImageFilename");
  const imageFile = filename && /\.[a-z0-9]+$/i.test(filename) ? filename : filename ? `${filename}.jpg` : "";
  return {
    code: number,
    ean: String(row[eanColumn] ?? value("EAN")),
    name: value("SetName") || `Conjunto ${number}`,
    year: Number(value("Year") || value("YearFrom")) || 0,
    theme: value("Theme") || "LEGO",
    subTheme: value("SubTheme"),
    rrp: value("DERetailPrice"),
    pieces: Number(value("Pieces")) || 0,
    stock: 0,
    location: "—",
    color: "#e5edf3",
    imageUrl: imageFile ? `https://images.brickset.com/sets/images/${imageFile}` : "",
  };
}

function isValidEan(value) {
  if (!/^\d{8}$|^\d{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const expectedCheckDigit = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === expectedCheckDigit;
}

function findSetByEan(ean) {
  if (!state.catalogRows.length) return fallbackSets.find(item => item.ean === ean);
  const eanColumn = 24;
  const hasExactEan = state.catalogRows.slice(2).some(row => String(row[eanColumn] ?? "").trim() === ean);
  return hasExactEan ? findSet(ean) : undefined;
}

function movementFormForMode(mode) {
  return emptyMovementForm(mode === "entrada" ? state.lastMovementDefaults : undefined);
}

async function loadLastMovementDefaults(token) {
  const range = encodeURIComponent("Movimentos!I2:L");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("NO_ACCESS");
  if (response.status === 400 || response.status === 404) throw new Error("MOVEMENTS_SHEET_NOT_FOUND");
  if (!response.ok) throw new Error(`SHEETS_ERROR_${response.status}`);
  const rows = (await response.json()).values || [];
  const lastRow = [...rows].reverse().find(row => {
    const quantity = Number(String(row[3] ?? "0").replace(",", "."));
    return quantity > 0 && (String(row[0] ?? "").trim() || String(row[2] ?? "").trim());
  });
  state.lastMovementDefaults = {
    origin: String(lastRow?.[0] ?? ""),
    storage: String(lastRow?.[2] ?? ""),
  };
  state.storageOptions = sortStorageNames(rows.map(row => row[2]));
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
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  if (profileResponse.status === 401) throw new Error("AUTH_EXPIRED");
  if (!profileResponse.ok) throw new Error("USERINFO_ERROR");
  const profile = await profileResponse.json();
  if (!profile.email) throw new Error("USER_EMAIL_MISSING");
  state.catalogRows = (data.values || []).map(row => row.map(String));
  await loadLastMovementDefaults(token);
  state.userEmail = String(profile.email);
  state.loggedIn = true;
  state.loginError = "";
  state.status = "Sessão iniciada · catálogo BricksetSets disponível";
}

function createMovementId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showMovementNotice(message, type) {
  if (movementNoticeTimer) window.clearTimeout(movementNoticeTimer);
  state.movementNotice = { message, type };
  movementNoticeTimer = window.setTimeout(() => {
    state.movementNotice = null;
    document.querySelector(".app-toast")?.remove();
  }, 5000);
}

function createMovementTimestamp() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

async function getLocationStock(setNumber) {
  const range = encodeURIComponent("Movimentos!D2:L");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${state.accessToken}` },
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("READ_DENIED");
  if (response.status === 400 || response.status === 404) throw new Error("MOVEMENTS_SHEET_NOT_FOUND");
  if (!response.ok) throw new Error(`SHEETS_READ_ERROR_${response.status}`);
  const data = await response.json();
  const stockByStorage = new Map();
  (data.values || []).forEach(row => {
    if (String(row[0] ?? "").trim() !== String(setNumber).trim()) return;
    const storage = String(row[7] ?? "").trim();
    if (!storage) return;
    const quantity = Number(String(row[8] ?? "0").replace(",", "."));
    if (!Number.isFinite(quantity)) return;
    stockByStorage.set(storage, (stockByStorage.get(storage) || 0) + quantity);
  });
  return [...stockByStorage.entries()]
    .map(([storage, stock]) => ({ storage, stock }))
    .filter(location => location.stock > 0)
    .sort((left, right) => left.storage.localeCompare(right.storage, "pt", { sensitivity: "base", numeric: true }));
}

async function appendMovement() {
  if (!state.selected || !state.accessToken || !state.userEmail) throw new Error("NOT_AUTHENTICATED");
  const requestedQuantity = Math.max(1, Number.parseInt(state.movementForm.qty, 10) || 1);
  let storageQuantities = [{ storage: state.movementForm.storage.trim(), quantity: requestedQuantity }];
  if (state.mode === "saida") {
    const currentLocations = await getLocationStock(state.selected.code);
    const availableStock = currentLocations.reduce((total, location) => total + location.stock, 0);
    if (requestedQuantity > availableStock) {
      const error = new Error("INSUFFICIENT_STOCK");
      error.availableStock = availableStock;
      throw error;
    }
    storageQuantities = Object.entries(state.movementForm.allocations)
      .map(([storage, quantity]) => ({ storage: storage.trim(), quantity: Number.parseInt(quantity, 10) || 0 }))
      .filter(allocation => allocation.storage && allocation.quantity > 0);
    const allocatedQuantity = storageQuantities.reduce((total, allocation) => total + allocation.quantity, 0);
    if (allocatedQuantity !== requestedQuantity) throw new Error("INVALID_ALLOCATION");
    const changedLocation = storageQuantities.find(allocation => {
      const current = currentLocations.find(location => location.storage === allocation.storage);
      return !current || allocation.quantity > current.stock;
    });
    if (changedLocation) throw new Error("LOCATION_STOCK_CHANGED");
  }
  const timestamp = createMovementTimestamp();
  const rows = storageQuantities.map(allocation => [
      createMovementId(),
      timestamp,
      state.selected.ean,
      state.selected.code,
      state.selected.name,
      state.selected.year,
      state.selected.theme,
      state.selected.subTheme || "",
      state.movementForm.origin.trim(),
      state.selected.imageUrl,
      allocation.storage,
      allocation.quantity * (state.mode === "saida" ? -1 : 1),
      state.userEmail,
      state.selected.rrp || "",
      state.movementForm.obs.trim(),
    ]);
  const range = encodeURIComponent("Movimentos!A:O");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ majorDimension: "ROWS", values: rows }),
  });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("WRITE_DENIED");
  if (response.status === 400 || response.status === 404) throw new Error("MOVEMENTS_SHEET_NOT_FOUND");
  if (!response.ok) throw new Error(`SHEETS_WRITE_ERROR_${response.status}`);
  return response.json();
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
  const client = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: "openid email https://www.googleapis.com/auth/spreadsheets", callback: async response => {
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
      const messages = { NO_ACCESS: "Esta conta Google não tem acesso ao inventário.", AUTH_EXPIRED: "A autorização Google expirou. Inicia sessão novamente.", SPREADSHEET_NOT_FOUND: "O spreadsheet do inventário não foi encontrado.", SHEET_NOT_FOUND: "A folha BricksetSets não foi encontrada.", MOVEMENTS_SHEET_NOT_FOUND: "A folha Movimentos não foi encontrada.", USERINFO_ERROR: "Não foi possível obter o email da conta Google.", USER_EMAIL_MISSING: "A conta Google não disponibilizou um endereço de email." };
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
  Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, loggedIn: false, accessToken: "", userEmail: "", catalogRows: [], loginError: "", checkingCredentials: false, movementForm: emptyMovementForm(), movementSaving: false, movementNotice: null, lastMovementDefaults: { origin: "", storage: "" }, storageOptions: [], locationStock: [], status: "Sessão terminada" });
  render();
}

async function lookup() {
  const found = findSet(state.query);
  state.photoMetaVisible = true;
  if (!found && state.query) {
    state.selected = null;
    state.status = "Código não encontrado. Confirma o número ou EAN.";
    showMovementNotice(`Código ${state.query} não encontrado.`, "error");
    render();
    return;
  }
  if (!found) {
    state.selected = null;
    state.status = "Digite ou leia um código para continuar.";
    render();
    return;
  }
  if (state.mode === "saida") {
    try {
      const locations = await getLocationStock(found.code);
      const availableStock = locations.reduce((total, location) => total + location.stock, 0);
      if (availableStock <= 0) {
        state.selected = null;
        state.status = `O conjunto ${found.code} não tem stock disponível.`;
        showMovementNotice(`Não existe stock disponível para o conjunto ${found.code}.`, "error");
        render();
        return;
      }
      state.locationStock = locations;
      state.movementForm.allocations = allocateAcrossLocations(locations, state.movementForm.qty);
    } catch (error) {
      state.selected = null;
      state.status = "Não foi possível verificar o stock.";
      const messages = {
        AUTH_EXPIRED: "A sessão Google expirou. Inicia sessão novamente.",
        READ_DENIED: "Esta conta não tem permissão para consultar o stock.",
        MOVEMENTS_SHEET_NOT_FOUND: "Não foi possível encontrar o sheet Movimentos.",
      };
      showMovementNotice(messages[error.message] || "Não foi possível verificar o stock. Tenta novamente.", "error");
      render();
      return;
    }
  } else {
    state.locationStock = [];
  }
  state.selected = found;
  state.status = `Conjunto ${found.code} encontrado no catálogo`;
  if (movementNoticeTimer) window.clearTimeout(movementNoticeTimer);
  movementNoticeTimer = null;
  state.movementNotice = null;
  if (!isCurrentHistoryStep("found")) writeAppHistory("found");
  render();
}

function updateScannerStatus(message) {
  state.scannerStatus = message;
  const status = document.querySelector("#camera-scanner-status");
  if (status) status.textContent = message;
}

function stopBarcodeCamera() {
  barcodeSession += 1;
  if (barcodeScanTimer) window.clearTimeout(barcodeScanTimer);
  if (barcodeFocusTimer) window.clearTimeout(barcodeFocusTimer);
  barcodeScanTimer = null;
  barcodeFocusTimer = null;
  quaggaScanPending = false;
  lastQuaggaScanAt = Number.NEGATIVE_INFINITY;
  if (barcodeStream) barcodeStream.getTracks().forEach(track => track.stop());
  barcodeStream = null;
  const video = document.querySelector("#barcode-camera");
  if (video) video.srcObject = null;
}

function decodeEanWithQuagga(video) {
  if (!window.Quagga || quaggaScanPending || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return Promise.resolve("");
  }

  quaggaScanPending = true;
  barcodeFrameCanvas ||= document.createElement("canvas");
  const maximumWidth = 1280;
  const scale = Math.min(1, maximumWidth / video.videoWidth);
  barcodeFrameCanvas.width = Math.round(video.videoWidth * scale);
  barcodeFrameCanvas.height = Math.round(video.videoHeight * scale);
  const context = barcodeFrameCanvas.getContext("2d", { alpha: false });
  context.drawImage(video, 0, 0, barcodeFrameCanvas.width, barcodeFrameCanvas.height);
  const source = barcodeFrameCanvas.toDataURL("image/jpeg", .92);

  return new Promise(resolve => {
    try {
      window.Quagga.decodeSingle({
        src: source,
        numOfWorkers: 0,
        locate: true,
        inputStream: { size: 800 },
        locator: { halfSample: true, patchSize: "medium" },
        decoder: { readers: ["ean_reader", "ean_8_reader"], multiple: false },
      }, result => {
        quaggaScanPending = false;
        const ean = String(result?.codeResult?.code || "").replace(/\D/g, "");
        resolve(isValidEan(ean) ? ean : "");
      });
    } catch {
      quaggaScanPending = false;
      resolve("");
    }
  });
}

function getCameraFocusModes(track) {
  if (typeof track?.getCapabilities !== "function") return [];
  const modes = track.getCapabilities().focusMode;
  return Array.isArray(modes) ? modes : [];
}

async function enableContinuousCameraFocus(track) {
  const focusModes = getCameraFocusModes(track);
  if (!focusModes.includes("continuous")) return false;
  await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
  return true;
}

async function focusBarcodeCamera(event) {
  const track = barcodeStream?.getVideoTracks()[0];
  if (!track) return;

  const preview = event.target.closest(".camera-preview");
  const focusPoint = preview?.querySelector(".camera-focus-point");
  if (preview && focusPoint) {
    const bounds = preview.getBoundingClientRect();
    const x = event.clientX || bounds.left + bounds.width / 2;
    const y = event.clientY || bounds.top + bounds.height / 2;
    focusPoint.style.left = `${x - bounds.left}px`;
    focusPoint.style.top = `${y - bounds.top}px`;
    focusPoint.classList.remove("is-focusing");
    void focusPoint.offsetWidth;
    focusPoint.classList.add("is-focusing");
  }

  const focusModes = getCameraFocusModes(track);
  try {
    if (focusModes.includes("single-shot")) {
      await track.applyConstraints({ advanced: [{ focusMode: "single-shot" }] });
      updateScannerStatus("A focar… mantenha o código imóvel.");
      if (barcodeFocusTimer) window.clearTimeout(barcodeFocusTimer);
      barcodeFocusTimer = window.setTimeout(async () => {
        try { await enableContinuousCameraFocus(track); } catch { /* O dispositivo mantém o foco disponível. */ }
        if (state.scannerOpen) updateScannerStatus("Aponte a câmara para o código EAN. Toque na imagem para focar.");
      }, 900);
      return;
    }
    if (await enableContinuousCameraFocus(track)) {
      updateScannerStatus("Foco automático ativo. Mantenha o código imóvel.");
      return;
    }
    updateScannerStatus("O foco manual não está disponível neste dispositivo. Afaste ou aproxime ligeiramente a câmara.");
  } catch {
    updateScannerStatus("Não foi possível ajustar o foco neste dispositivo.");
  }
}

function closeBarcodeScanner() {
  stopBarcodeCamera();
  state.scannerOpen = false;
  state.scannerStatus = "";
  document.querySelector(".camera-scanner")?.remove();
}

async function openBarcodeScanner(addHistory = true) {
  if (state.scannerOpen) return;
  state.scannerOpen = true;
  state.scannerStatus = "A preparar a câmara…";
  if (addHistory && !isCurrentHistoryStep("scanner")) writeAppHistory("scanner");
  document.querySelector("#app")?.insertAdjacentHTML("beforeend", scannerMarkup());

  if (!navigator.mediaDevices?.getUserMedia) {
    updateScannerStatus("Este navegador não permite aceder à câmara.");
    return;
  }
  const quaggaAvailable = Boolean(window.Quagga?.decodeSingle);
  if (!("BarcodeDetector" in window) && !quaggaAvailable) {
    updateScannerStatus("Este navegador não suporta a leitura automática de códigos de barras.");
    return;
  }

  const session = ++barcodeSession;
  try {
    const desiredFormats = ["ean_13", "ean_8"];
    let detector = null;
    if ("BarcodeDetector" in window) {
      const supportedFormats = typeof window.BarcodeDetector.getSupportedFormats === "function"
        ? await window.BarcodeDetector.getSupportedFormats()
        : desiredFormats;
      const formats = desiredFormats.filter(format => supportedFormats.includes(format));
      if (formats.length) detector = new window.BarcodeDetector({ formats });
    }
    if (!detector && !quaggaAvailable) throw new Error("EAN_NOT_SUPPORTED");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (!state.scannerOpen || session !== barcodeSession) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    barcodeStream = stream;
    const video = document.querySelector("#barcode-camera");
    if (!video) {
      stopBarcodeCamera();
      return;
    }
    video.srcObject = stream;
    await video.play();
    const videoTrack = stream.getVideoTracks()[0];
    let continuousFocusEnabled = false;
    try { continuousFocusEnabled = await enableContinuousCameraFocus(videoTrack); } catch { /* Continua com o foco escolhido pelo dispositivo. */ }
    updateScannerStatus(continuousFocusEnabled ? "Aponte a câmara para o código EAN. Toque na imagem para focar." : "Aponte a câmara para o código EAN.");
    let lastUnknownEan = "";

    const scanFrame = async () => {
      if (!state.scannerOpen || session !== barcodeSession) return;
      try {
        if (video.readyState >= 2) {
          const now = performance.now();
          let ean = "";
          if (quaggaAvailable && now - lastQuaggaScanAt >= 450) {
            lastQuaggaScanAt = now;
            ean = await decodeEanWithQuagga(video);
          }
          if (!ean && detector) {
            try {
              const codes = await detector.detect(video);
              ean = codes.map(code => String(code.rawValue || "").replace(/\D/g, "")).find(isValidEan) || "";
            } catch { /* Mantém o Quagga2 como leitor principal. */ }
          }
          if (!state.scannerOpen || session !== barcodeSession) return;
          if (ean) {
            const found = findSetByEan(ean);
            if (found) {
              state.query = ean;
              state.photoMetaVisible = true;
              stopBarcodeCamera();
              state.scannerOpen = false;
              state.scannerStatus = "";
              writeAppHistory("mode", true);
              await lookup();
              return;
            }
            if (lastUnknownEan !== ean) {
              lastUnknownEan = ean;
              updateScannerStatus(`EAN ${ean} não encontrado no catálogo. Continue a apontar para outro código.`);
            }
          }
        }
      } catch {
        updateScannerStatus("Não foi possível ler este código. Tente aproximar ou melhorar a iluminação.");
      }
      barcodeScanTimer = window.setTimeout(scanFrame, 140);
    };
    scanFrame();
  } catch (error) {
    stopBarcodeCamera();
    const messages = {
      NotAllowedError: "O acesso à câmara foi recusado. Autorize a câmara nas definições do navegador.",
      NotFoundError: "Não foi encontrada uma câmara neste dispositivo.",
      NotReadableError: "A câmara está a ser utilizada por outra aplicação.",
      EAN_NOT_SUPPORTED: "Este navegador não suporta a leitura de códigos EAN.",
    };
    updateScannerStatus(messages[error.name] || messages[error.message] || "Não foi possível iniciar a câmara.");
  }
}

document.addEventListener("click", async event => {
  const modeButton = event.target.closest("[data-mode]");
  if (modeButton && !modeButton.disabled) {
    state.mode = modeButton.dataset.mode;
    state.query = "";
    state.selected = null;
    state.menuOpen = false;
    state.movementForm = movementFormForMode(state.mode);
    state.locationStock = [];
    state.photoMetaVisible = true;
    writeAppHistory("mode");
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
  if (action === "scanner") { openBarcodeScanner(); return; }
  if (action === "close-scanner") { window.history.back(); return; }
  if (action === "focus-camera") { focusBarcodeCamera(event); return; }
  if (action === "toggle-photo-meta") {
    state.photoMetaVisible = !state.photoMetaVisible;
    const photo = event.target.closest(".set-found-photo");
    const meta = photo?.querySelector(".set-photo-meta");
    if (meta) meta.hidden = !state.photoMetaVisible;
    photo?.setAttribute("aria-pressed", String(!state.photoMetaVisible));
    return;
  }
  if (action === "qty-increase" || action === "qty-decrease") {
    const currentQty = Math.max(1, Number.parseInt(state.movementForm.qty, 10) || 1);
    state.movementForm.qty = String(action === "qty-increase" ? currentQty + 1 : Math.max(1, currentQty - 1));
    const qtyInput = document.querySelector("#movement-qty");
    if (qtyInput) qtyInput.value = state.movementForm.qty;
    return;
  }
  if (action === "allocation-increase" || action === "allocation-decrease") {
    const button = event.target.closest("[data-storage]");
    const storage = button?.dataset.storage || "";
    const location = state.locationStock.find(item => item.storage === storage);
    if (!location) return;
    const current = Math.max(1, Number.parseInt(state.movementForm.allocations[storage], 10) || 1);
    state.movementForm.allocations[storage] = action === "allocation-increase" ? Math.min(location.stock, current + 1) : Math.max(1, current - 1);
    updateAllocationControls();
    return;
  }
  if (action === "allocation-add") {
    const activeStorages = new Set(Object.keys(state.movementForm.allocations));
    const nextLocation = state.locationStock.find(location => !activeStorages.has(location.storage));
    if (nextLocation) state.movementForm.allocations[nextLocation.storage] = 1;
    updateAllocationControls();
    renderPreservingContentScroll();
    return;
  }
  if (action === "allocation-remove") {
    const storage = event.target.closest("[data-storage]")?.dataset.storage || "";
    if (storage && Object.keys(state.movementForm.allocations).length > 1) delete state.movementForm.allocations[storage];
    updateAllocationControls();
    renderPreservingContentScroll();
    return;
  }
  if (action === "toggle-menu") state.menuOpen = !state.menuOpen;
  if (action === "show-sheets") {
    if (state.mode === "sheets") return;
    Object.assign(state, { mode: "sheets", query: "", selected: null, menuOpen: false, movementForm: emptyMovementForm(), movementNotice: null, locationStock: [], photoMetaVisible: true });
    writeAppHistory("sheets");
    render();
    return;
  }
  if (action === "home") {
    if (!state.mode) {
      state.menuOpen = false;
      render();
      return;
    }
    Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, movementForm: emptyMovementForm(), movementNotice: null, locationStock: [], photoMetaVisible: true });
    writeAppHistory("home");
    render();
    return;
  }
  if (action === "back") {
    if (window.history.state?.app === APP_HISTORY_ID) window.history.back();
    else Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, movementForm: emptyMovementForm(), movementNotice: null });
    return;
  }
  if (action === "delete") { state.query = state.query.slice(0, -1); state.selected = null; }
  if (action === "clear") Object.assign(state, { query: "", selected: null });
  if (action === "movement-cancel") {
    window.history.back();
    return;
  }
  if (action === "movement-confirm") {
    if (state.movementSaving) return;
    const requiredFields = [...document.querySelectorAll(".movement-fields [required]")];
    const invalidField = requiredFields.find(field => !field.checkValidity());
    if (invalidField) {
      invalidField.reportValidity();
      return;
    }
    if (state.mode === "saida") {
      const allocated = Object.values(state.movementForm.allocations).reduce((total, quantity) => total + (Number(quantity) || 0), 0);
      if (allocated < 1) {
        showMovementNotice("Indica pelo menos uma localização e uma quantidade para a saída.", "error");
        render();
        return;
      }
      state.movementForm.qty = String(allocated);
    }
    const setCode = state.selected.code;
    const movementName = state.mode === "entrada" ? "Entrada" : "Saída";
    const submittedDefaults = { origin: state.movementForm.origin.trim(), storage: state.movementForm.storage.trim() };
    state.movementSaving = true;
    state.movementNotice = null;
    render();
    try {
      await appendMovement();
      if (state.mode === "entrada") {
        state.lastMovementDefaults = submittedDefaults;
        state.storageOptions = sortStorageNames([...state.storageOptions, submittedDefaults.storage]);
      }
      Object.assign(state, { mode: null, query: "", selected: null, movementForm: emptyMovementForm(), movementSaving: false, locationStock: [], photoMetaVisible: true, status: `${movementName} do conjunto ${setCode} registada em Movimentos.` });
      showMovementNotice(`${movementName} registada com sucesso.`, "success");
      if (isCurrentHistoryStep("found")) {
        window.history.go(-2);
        return;
      }
      writeAppHistory("home", true);
    } catch (error) {
      const messages = {
        NOT_AUTHENTICATED: "Inicia novamente a sessão Google antes de registar o movimento.",
        AUTH_EXPIRED: "A sessão Google expirou. Inicia sessão novamente.",
        READ_DENIED: "Esta conta não tem permissão para consultar os movimentos e validar o stock.",
        WRITE_DENIED: "Esta conta não tem permissão para escrever no sheet Movimentos.",
        MOVEMENTS_SHEET_NOT_FOUND: "Não foi possível encontrar o sheet Movimentos.",
        INVALID_ALLOCATION: "A distribuição por localizações não corresponde à quantidade pedida.",
        LOCATION_STOCK_CHANGED: "O stock de uma das localizações foi alterado. Volta a procurar o conjunto.",
      };
      if (error.message === "AUTH_EXPIRED") {
        sessionStorage.removeItem(TOKEN_KEY);
        Object.assign(state, { loggedIn: false, accessToken: "", userEmail: "", loginError: messages.AUTH_EXPIRED });
      }
      state.movementSaving = false;
      const message = error.message === "INSUFFICIENT_STOCK"
        ? `Stock insuficiente. Disponível: ${Math.max(0, error.availableStock)}.`
        : messages[error.message] || "Não foi possível registar o movimento. Tenta novamente.";
      showMovementNotice(message, "error");
    }
    render();
    return;
  }
  if (action === "lookup") { lookup(); return; }
  if (action === "login") { loginWithGoogle(); return; }
  if (action === "logout") { logoutGoogle(); return; }
  if (action === "open-sheet") window.open(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`, "_blank", "noopener");
  if (action === "register") state.status = `${state.mode === "lote" ? "Item adicionado ao lote" : "Consulta"} preparada para ${state.selected.code}.`;
  render();
});

document.addEventListener("input", event => {
  if (event.target.dataset?.storageChoice !== undefined) {
    const choice = event.target.value;
    const creatingStorage = choice === "__other__";
    state.movementForm.storageChoice = choice;
    state.movementForm.storage = creatingStorage ? "" : choice;
    const newStorageInput = document.querySelector("#movement-new-storage");
    if (newStorageInput) {
      newStorageInput.hidden = !creatingStorage;
      newStorageInput.required = creatingStorage;
      newStorageInput.value = "";
      if (creatingStorage) newStorageInput.focus({ preventScroll: true });
    }
    return;
  }
  const previousAllocationStorage = event.target.dataset?.allocationChoice;
  if (previousAllocationStorage) {
    const nextStorage = event.target.value;
    const nextLocation = state.locationStock.find(item => item.storage === nextStorage);
    if (!nextLocation || nextStorage === previousAllocationStorage) return;
    const quantity = Math.min(nextLocation.stock, Math.max(1, Number(state.movementForm.allocations[previousAllocationStorage]) || 1));
    state.movementForm.allocations = Object.entries(state.movementForm.allocations).reduce((allocations, [storage, storedQuantity]) => {
      allocations[storage === previousAllocationStorage ? nextStorage : storage] = storage === previousAllocationStorage ? quantity : storedQuantity;
      return allocations;
    }, Object.create(null));
    updateAllocationControls();
    renderPreservingContentScroll();
    return;
  }
  const allocationStorage = event.target.dataset?.allocationStorage;
  if (allocationStorage) {
    const location = state.locationStock.find(item => item.storage === allocationStorage);
    if (!location) return;
    const rawQuantity = event.target.value;
    if (rawQuantity !== "" && !/^\d+$/.test(rawQuantity)) {
      event.target.value = String(state.movementForm.allocations[allocationStorage] || 0);
      return;
    }
    if (rawQuantity === "") return;
    const quantity = Math.min(location.stock, Math.max(1, Number.parseInt(rawQuantity, 10) || 1));
    state.movementForm.allocations[allocationStorage] = quantity;
    if (rawQuantity !== "" && Number(rawQuantity) !== quantity) event.target.value = String(quantity);
    updateAllocationControls();
    return;
  }
  const movementField = event.target.dataset?.movementField;
  if (movementField) {
    if (movementField === "qty" && event.target.value !== "" && (!/^\d+$/.test(event.target.value) || Number(event.target.value) < 1)) {
      event.target.value = state.movementForm.qty;
      return;
    }
    state.movementForm[movementField] = event.target.value;
    if (movementField === "origin" && state.mode === "saida") {
      const memberSelected = event.target.value === "Membro";
      const obsRequired = memberSelected || event.target.value === "Outro";
      const obsInput = document.querySelector("#movement-obs");
      const obsLabel = document.querySelector("#movement-obs-label");
      const requiredMark = document.querySelector("#movement-obs-required");
      if (obsInput) obsInput.required = obsRequired;
      if (obsLabel) obsLabel.textContent = memberSelected ? "Nome do Membro" : "Obs";
      if (requiredMark) requiredMark.hidden = !obsRequired;
    }
    return;
  }
  if (event.target.id !== "lego-code") return;
  state.query = event.target.value.replace(/\D/g, "");
  state.selected = null;
  event.target.value = state.query;
});

document.addEventListener("keydown", event => {
  if (state.scannerOpen && event.key === "Escape") {
    window.history.back();
    return;
  }
  if (event.target.id === "lego-code" && event.key === "Enter") lookup();
  const keypadActive = (state.mode === "entrada" || state.mode === "saida") && !state.selected && !state.scannerOpen;
  if (!keypadActive || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^\d$/.test(event.key)) {
    event.preventDefault();
    state.query += event.key;
    const display = document.querySelector("#entry-code");
    if (display) display.value = state.query;
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    state.query = state.query.slice(0, -1);
    const display = document.querySelector("#entry-code");
    if (display) display.value = state.query;
    return;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    state.query = "";
    const display = document.querySelector("#entry-code");
    if (display) display.value = "";
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    lookup();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.scannerOpen) {
    closeBarcodeScanner();
    writeAppHistory("mode", true);
  }
});

window.addEventListener("beforeunload", stopBarcodeCamera);

window.addEventListener("popstate", async event => {
  const historyState = event.state;
  if (historyState?.app !== APP_HISTORY_ID) return;
  if (state.scannerOpen) closeBarcodeScanner();
  state.menuOpen = false;

  if (historyState.step === "home") {
    Object.assign(state, { mode: null, query: "", selected: null, movementForm: emptyMovementForm(), locationStock: [], photoMetaVisible: true });
    render();
    return;
  }

  state.mode = historyState.mode;
  state.query = historyState.query || "";
  state.selected = null;
  state.movementForm = movementFormForMode(state.mode);
  state.photoMetaVisible = true;

  if (historyState.step === "found") {
    state.selected = findSet(state.query) || null;
    if (state.mode === "saida" && state.selected) {
      try {
        state.locationStock = await getLocationStock(state.selected.code);
        state.movementForm.allocations = allocateAcrossLocations(state.locationStock, state.movementForm.qty);
      } catch {
        state.selected = null;
        showMovementNotice("Não foi possível atualizar o stock por localização.", "error");
      }
    }
  }
  render();
  if (historyState.step === "scanner") openBarcodeScanner(false);
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

writeAppHistory("home", true);
restoreSession();
