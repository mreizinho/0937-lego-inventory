"use strict";

const GOOGLE_CLIENT_ID = "903361544580-2q3vp79k7jv9moq8meincgtr3bhfrmua.apps.googleusercontent.com";
const SPREADSHEET_ID = "1uLDmcH1U2ayy08LkMXHKvqddYkmwUQqAmd520ilo_XI";
const APPS_SCRIPT_ID = "AKfycbylP4b2SrjUHjHZhFdQAOkda65AXJTS8tRiYASjQuB12qaMvS3DsJIE_P1mC8eexdC_Aw";
const GOOGLE_OAUTH_SCOPE = "openid email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/script.external_request";
const TOKEN_KEY = "googleSheetsAccessToken";
const TOKEN_SCOPE_KEY = "googleSheetsAccessTokenScope";
const APP_HISTORY_ID = "0937-lego-inventory";
const BATCH_DRAFT_KEY = "legoInventoryBatchDraft";
const MOBILE_SWIPE_MODES = [null, "sheets", "update"];

function emptyMovementForm(defaults = {}) {
  const storage = defaults.storage || "";
  return { origin: defaults.origin || "", storage, storageChoice: storage, qty: "1", obs: "", allocations: Object.create(null) };
}

function emptyBatchState(userEmail = "") {
  return {
    version: 1,
    userEmail,
    id: createMovementId(),
    movementType: "",
    phase: "type",
    items: [],
    form: emptyMovementForm(),
    saving: false,
  };
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
  catalogUpdating: false,
  movementNotice: null,
  lastMovementDefaults: { origin: "", storage: "" },
  storageOptions: [],
  locationStock: [],
  photoMetaVisible: true,
  scannerOpen: false,
  scannerStatus: "",
  batch: emptyBatchState(),
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

function batchUnitCount() {
  return state.batch.items.reduce((total, item) => total + (Number.parseInt(item.qty, 10) || 0), 0);
}

function persistBatchDraft() {
  state.batch.userEmail = state.userEmail;
  state.batch.saving = false;
  state.batch.updatedAt = Date.now();
  localStorage.setItem(BATCH_DRAFT_KEY, JSON.stringify(state.batch));
}

function restoreBatchDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(BATCH_DRAFT_KEY) || "null");
    if (!saved || saved.version !== 1 || !Array.isArray(saved.items)) return emptyBatchState(state.userEmail);
    if (saved.userEmail && state.userEmail && saved.userEmail !== state.userEmail) return emptyBatchState(state.userEmail);
    saved.saving = false;
    saved.form = { ...emptyMovementForm(), ...(saved.form || {}) };
    return saved;
  } catch {
    localStorage.removeItem(BATCH_DRAFT_KEY);
    return emptyBatchState(state.userEmail);
  }
}

function clearBatchDraft() {
  localStorage.removeItem(BATCH_DRAFT_KEY);
  state.batch = emptyBatchState(state.userEmail);
}

function setBatchPhase(phase, addHistory = true) {
  state.batch.phase = phase;
  persistBatchDraft();
  if (addHistory) writeAppHistory(`batch-${phase}`);
  render();
}

function batchItemByCode(code) {
  return state.batch.items.find(item => String(item.code) === String(code));
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
  if (content) {
    content.scrollTop = scrollTop;
    updateLotMobileHeaderSummary();
  }
}

let barcodeStream = null;
let barcodeScanTimer = null;
let barcodeSession = 0;
let barcodeFocusTimer = null;
let quaggaScanPending = false;
let lastQuaggaScanAt = Number.NEGATIVE_INFINITY;
let barcodeFrameCanvas = null;
let movementNoticeTimer = null;
let mobileSwipeGesture = null;
let mobileSwipeAnimating = false;
let batchKeypadWindow = null;

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
  scanner: '<svg class="scanner-glyph" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 3H5a2 2 0 0 0-2 2v4M19 3h4a2 2 0 0 1 2 2v4M9 25H5a2 2 0 0 1-2-2v-4M19 25h4a2 2 0 0 0 2-2v-4M7 9v10M10 9v10M14 9v10M17 9v10M21 9v10"/></svg>',
  popout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8"/><path d="M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  dock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M10 20H4v-6M4 20l8-8"/><path d="M14 18h5a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v5"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function menuMarkup(id) {
  const sessionAction = state.loggedIn ? "logout" : "login";
  const sessionLabel = state.loggedIn ? "Logout" : "Login";
  return `<div class="menu-popover" id="${id}">
    ${simpleMenuItem("Início", "home", !state.mode)}
    ${simpleMenuItem("Google Sheets", "show-sheets", state.mode === "sheets")}
    ${simpleMenuItem("Actualizar Brickset", "show-update", state.mode === "update")}
    <div class="menu-separator" role="separator"></div>
    ${simpleMenuItem("Inventário", "noop")}
    ${simpleMenuItem("Consultas", "noop")}
    <div class="menu-separator" role="separator"></div>
    ${simpleMenuItem(sessionLabel, sessionAction)}
  </div>`;
}

function simpleMenuItem(title, action, active = false) {
  return `<button type="button" class="menu-simple-item${active ? " active" : ""}" data-action="${action}"${active ? ' aria-current="page"' : ""}>${title}</button>`;
}

function desktopTabsMarkup() {
  const sessionAction = state.loggedIn ? "logout" : "login";
  const sessionLabel = state.loggedIn ? "Logout" : "Login";
  return `<nav class="desktop-tabs" aria-label="Navegação principal">
    <button type="button" class="desktop-tab${state.mode ? "" : " active"}" data-action="home"${state.mode ? "" : ' aria-current="page"'}>Início</button>
    <button type="button" class="desktop-tab${state.mode === "sheets" ? " active" : ""}" data-action="show-sheets"${state.mode === "sheets" ? ' aria-current="page"' : ""}>Google Sheets</button>
    <button type="button" class="desktop-tab${state.mode === "update" ? " active" : ""}" data-action="show-update"${state.mode === "update" ? ' aria-current="page"' : ""}>Actualizar</button>
    <button type="button" class="desktop-tab" data-action="noop">Inventário</button>
    <button type="button" class="desktop-tab" data-action="noop">Consultas</button>
    <button type="button" class="desktop-tab desktop-session" data-action="${sessionAction}">${sessionLabel}</button>
  </nav>`;
}

function mainHeaderMarkup(extraClass = "", menuId = "main-menu") {
  return `<header class="masthead${extraClass ? ` ${extraClass}` : ""}">
    <a class="brand" href="https://comunidade0937.com/forum/" aria-label="Comunidade 0937">
      <picture><source media="(max-width:850px)" srcset="public/comunidade-0937-bricks.svg?v=20260826c"><img src="public/comunidade-0937.svg?v=20260826c" alt="Comunidade 0937"></picture>
    </a>
    ${desktopTabsMarkup()}
    <div class="header-menu">
      <button class="header-search-button" aria-label="Pesquisar">${icons.search}</button>
      <button class="hamburger-button" data-action="toggle-menu" aria-expanded="${state.menuOpen}" aria-controls="${menuId}" aria-label="${state.menuOpen ? "Fechar" : "Abrir"} menu">${state.menuOpen ? icons.close : icons.menu}</button>
      ${state.menuOpen ? menuMarkup(menuId) : ""}
    </div>
  </header>`;
}

function lotMobileHeaderMarkup() {
  return `<header class="masthead movement-header lot-mobile-header">
    <button class="movement-header-back" data-action="back" aria-label="Voltar às opções">${icons.back}</button>
    <h1 data-lot-mobile-title>LOTE</h1>
    <div class="header-menu movement-header-menu">
      <button class="hamburger-button" data-action="toggle-menu" aria-expanded="${state.menuOpen}" aria-controls="lot-mobile-menu" aria-label="${state.menuOpen ? "Fechar" : "Abrir"} menu">${state.menuOpen ? icons.close : icons.menu}</button>
      ${state.menuOpen ? menuMarkup("lot-mobile-menu") : ""}
    </div>
  </header>`;
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
  if (state.mode === "lote") return `${mainHeaderMarkup("lot-desktop-header", "lot-desktop-menu")}${lotMobileHeaderMarkup()}`;
  return mainHeaderMarkup();
}

function optionCard(mode, title, description, image) {
  return `<button data-mode="${mode}" ${state.loggedIn ? "" : "disabled"} class="option-card ${mode}"><span class="mode-option-image"><img src="public/options/${image}.png" alt=""></span><span><strong>${title}</strong><small>${description}</small></span><b>›</b></button>`;
}

function optionsMarkup() {
  const loginTitle = state.loginError || (state.checkingCredentials ? "A verificar credenciais..." : "Inicia sessão para continuar");
  const loginHelp = state.loginError ? "Toca aqui para tentar novamente." : state.checkingCredentials ? "A confirmar o acesso ao Google Sheets." : "As opções ficam disponíveis após o login com Google.";
  const login = state.loggedIn ? "" : `<button type="button" class="login-required ${state.loginError ? "has-error" : ""}" data-action="login">${icons.lock}<span><strong>${escapeHtml(loginTitle)}</strong><small>${loginHelp}</small></span></button>`;
  return `<section class="workspace sheets-page actions-page" id="inventario">
    <article class="sheets-explainer actions-explainer">
    <div class="sheets-copy actions-copy">
      <p class="sheets-eyebrow actions-eyebrow">INÍCIO</p>
      <p class="actions-tagline">O que queres fazer hoje?</p>
      ${login}
      <div class="options-grid">
        ${optionCard("entrada", "Entrada", "Registar set recebido", "entrada")}
        ${optionCard("saida", "Saída", "Registar set enviado", "saida")}
        ${optionCard("consulta", "Consultar", "Ver detalhes e stock", "consultar")}
        ${optionCard("lote", "Modo Lote", "Scan múltiplo rápido", "lote")}
      </div>
    </div>
    </article>
    <p class="legal-links actions-legal"><a href="privacy.html">Política de Privacidade</a></p>
  </section>`;
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

function bricksetLastUpdated() {
  const cellValue = String(state.catalogRows?.[0]?.[0] ?? "").trim();
  const updatedAt = cellValue.replace(/^Last updated:\s*/i, "").trim();
  return updatedAt || (state.checkingCredentials ? "A carregar…" : "Não disponível");
}

function bricksetUpdateMarkup() {
  const updateValue = state.catalogUpdating
    ? `Em execução<span class="update-running-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>`
    : escapeHtml(bricksetLastUpdated());
  return `<section class="workspace sheets-page update-page"><article class="sheets-explainer">
    <div class="sheets-visual update-visual"><img src="public/brickset.png" alt="Logótipo Brickset"></div>
    <div class="sheets-copy update-copy">
      <p class="sheets-eyebrow update-eyebrow">CATÁLOGO</p>
      <h2>Actualizar a base de dados Brickset</h2>
      <div class="update-date"><strong class="${state.catalogUpdating ? "is-running" : ""}" aria-live="polite">${updateValue}</strong><span>Última actualização</span></div>
      <p>A nossa App utiliza a Base de Dados do Brickset. Se um set for muito recente e não for encontrado na pesquisa, devemos actualizar a informação dos sets existentes, carregando no botão abaixo:</p>
      <button type="button" class="sheets-open-button update-button" data-action="run-brickset-update"${state.catalogUpdating ? " disabled" : ""}>ACTUALIZAR <span aria-hidden="true">↻</span></button>
    </div>
  </article></section>`;
}

function keypadControlsMarkup(lookupAction = "lookup") {
  const numbers = [1,2,3,4,5,6,7,8,9].map(number => `<button data-digit="${number}">${number}</button>`).join("");
  return `
    <label for="entry-code">Digite o N.º do Set ou Código de Barras</label>
    <input id="entry-code" class="keypad-display" value="${escapeHtml(state.query)}" readonly inputmode="none" tabindex="-1" aria-label="Código introduzido através do teclado no ecrã">
    <div class="number-grid">${numbers}<button class="delete-key" data-action="delete" aria-label="Apagar último dígito">C</button><button data-digit="0">0</button><button class="ok-key" data-action="${lookupAction}">OK</button></div>
    <div class="keypad-actions"><button class="clear-key" data-action="clear">LIMPAR</button><button class="scanner-key" data-action="scanner">${icons.scanner} SCANNER</button></div>`;
}

function keypadMarkup() {
  return `<section class="workspace"><section class="scan-panel"><div class="entry-keypad ${state.mode}">
    ${keypadControlsMarkup()}
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
  const title = "Consultar conjunto";
  const result = state.selected ? resultMarkup(state.selected) : "";
  return `<section class="workspace"><section class="scan-panel"><div class="scan-heading"><span class="big-icon ${state.mode}">▦</span><div><h2>${title}</h2></div></div>
    <label class="code-label" for="lego-code">Código do conjunto ou EAN</label><div class="code-row"><div class="code-input"><span>▥</span><input id="lego-code" value="${escapeHtml(state.query)}" placeholder="Ex.: 10300 ou 5702017153186" inputmode="numeric" autocomplete="off"><kbd>ENTER</kbd></div><button class="search-button" data-action="lookup">Pesquisar</button></div>
    <div class="divider"><span>ou</span></div><button class="scanner-button" data-action="scanner"><span class="scan-corners">▦</span><strong>Ler com scanner</strong><small>O leitor envia o EAN automaticamente</small></button><p class="scanner-tip"><b>i</b> Leitores USB/Bluetooth funcionam como teclado: basta apontar e ler.</p>${result}</section></section>`;
}

function batchTypeMarkup() {
  return `<section class="workspace batch-page"><section class="batch-panel">
    <div class="batch-heading"><p>LOTE</p><h2>Que movimento queres preparar?</h2><span>As condições comuns serão pedidas apenas quando concluíres a picagem.</span></div>
    <div class="batch-type-options">
      <button type="button" class="option-card batch-type entrada" data-action="batch-type" data-batch-type="entrada"><span class="mode-option-image"><img src="public/options/entrada.png" alt=""></span><span><strong>ENTRADA</strong><small>Registar todos os sets recebidos</small></span><b>›</b></button>
      <button type="button" class="option-card batch-type saida" data-action="batch-type" data-batch-type="saida"><span class="mode-option-image"><img src="public/options/saida.png" alt=""></span><span><strong>SAÍDA</strong><small>Retirar todos os sets picados</small></span><b>›</b></button>
    </div>
    <button type="button" class="batch-text-button" data-action="batch-cancel">Cancelar</button>
  </section></section>`;
}

function batchResumePromptMarkup() {
  const units = batchUnitCount();
  const references = state.batch.items.length;
  return `<section class="workspace batch-page"><section class="batch-panel batch-resume-prompt">
    <div class="batch-heading"><p>LOTE EM CURSO</p><h2>Existe uma picagem por concluir</h2><span>Encontrámos uma ${state.batch.movementType === "saida" ? "saída" : "entrada"} em lote com ${units} ${units === 1 ? "unidade" : "unidades"} e ${references} ${references === 1 ? "referência" : "referências"}.</span></div>
    <p>Queres continuar a leitura corrente ou apagá-la e começar um novo lote?</p>
    <div class="batch-actions"><button type="button" class="secondary batch-view-draft" data-action="batch-view-draft">VER LOTE</button><button type="button" class="secondary batch-delete-draft" data-action="batch-discard-draft">APAGAR LEITURA</button><button type="button" class="primary" data-action="batch-continue-draft">CONTINUAR</button></div>
  </section></section>`;
}

function batchMiniListMarkup() {
  if (!state.batch.items.length) return `<p class="batch-empty">Ainda não foi picado nenhum conjunto.</p>`;
  return `<div class="batch-mini-list">${state.batch.items.slice(-4).reverse().map(item => `<div><span><b>${escapeHtml(item.code)}</b><small>${escapeHtml(item.name)}</small></span><strong>${item.qty} un.</strong></div>`).join("")}</div>`;
}

function isBatchKeypadPoppedOut() {
  return Boolean(batchKeypadWindow && !batchKeypadWindow.closed);
}

function batchScanMarkup() {
  const references = state.batch.items.length;
  const units = batchUnitCount();
  const keypadPoppedOut = isBatchKeypadPoppedOut();
  const keypadSection = keypadPoppedOut ? "" : `
    <div class="batch-heading"><p>${state.batch.movementType === "entrada" ? "ENTRADA" : "SAÍDA"} EM LOTE</p><h2>Picar conjuntos</h2><span>Cada leitura adiciona uma unidade. A câmara permanece aberta para leituras consecutivas.</span></div>
    <div class="batch-keypad-shell"><button type="button" class="batch-keypad-popout-button" data-action="batch-keypad-popout" aria-label="Abrir teclado numa janela sempre visível" title="Abrir teclado numa janela sempre visível">${icons.popout}</button><div class="entry-keypad lote batch-keypad">${keypadControlsMarkup("batch-add-code")}</div></div>
    <hr class="batch-keypad-divider">`;
  return `<section class="workspace batch-page"><section class="batch-panel batch-scan-panel${keypadPoppedOut ? " batch-keypad-detached" : ""}">
    ${keypadSection}
    <div class="batch-counter"><strong>${units}</strong><span>${units === 1 ? "unidade" : "unidades"}</span><i></i><strong>${references}</strong><span>${references === 1 ? "referência" : "referências"}</span></div>
    <p class="batch-mini-title">Últimas picagens</p>
    ${batchMiniListMarkup()}
    <div class="batch-actions"><button type="button" class="secondary" data-action="batch-cancel">CANCELAR</button><button type="button" class="secondary" data-action="batch-review"${references ? "" : " disabled"}>PAUSAR / REVER</button><button type="button" class="primary" data-action="batch-conditions"${references ? "" : " disabled"}>CONCLUIR</button></div>
  </section></section>`;
}

function batchKeypadPopoutMarkup() {
  return `<div class="batch-keypad-popout-root">
    <header class="batch-keypad-popout-header"><strong>TECLADO DO LOTE</strong><button type="button" data-action="batch-keypad-dock">${icons.dock}<span>DOCK</span></button></header>
    <main class="batch-keypad-popout-main"><div class="entry-keypad lote batch-keypad">${keypadControlsMarkup("batch-add-code")}</div></main>
  </div>`;
}

function copyStylesToBatchKeypadWindow(targetDocument) {
  document.querySelectorAll('link[rel="stylesheet"],style').forEach(source => {
    const clone = source.cloneNode(true);
    if (clone.tagName === "LINK") clone.href = source.href;
    targetDocument.head.append(clone);
  });
}

function renderBatchKeypadWindow() {
  if (!isBatchKeypadPoppedOut()) return;
  const root = batchKeypadWindow.document.querySelector(".batch-keypad-popout-root");
  if (root) root.outerHTML = batchKeypadPopoutMarkup();
}

function closeBatchKeypadPopout(renderMain = true) {
  const popoutWindow = batchKeypadWindow;
  batchKeypadWindow = null;
  if (popoutWindow && !popoutWindow.closed) popoutWindow.close();
  if (renderMain) render();
}

async function handleBatchKeypadPopoutClick(event) {
  const digit = event.target.closest("[data-digit]");
  if (digit) {
    state.query += digit.dataset.digit;
    state.selected = null;
    renderBatchKeypadWindow();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "batch-keypad-dock") {
    closeBatchKeypadPopout();
    return;
  }
  if (action === "delete") {
    state.query = state.query.slice(0, -1);
    state.selected = null;
    renderBatchKeypadWindow();
    return;
  }
  if (action === "clear") {
    Object.assign(state, { query: "", selected: null });
    renderBatchKeypadWindow();
    return;
  }
  if (action === "batch-add-code") {
    await addCodeToBatch(state.query);
    return;
  }
  if (action === "scanner") {
    closeBatchKeypadPopout();
    await openBarcodeScanner();
  }
}

async function handleBatchKeypadPopoutKeydown(event) {
  if (/^\d$/.test(event.key)) {
    event.preventDefault();
    state.query += event.key;
    state.selected = null;
    renderBatchKeypadWindow();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    state.query = state.query.slice(0, -1);
    state.selected = null;
    renderBatchKeypadWindow();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    Object.assign(state, { query: "", selected: null });
    renderBatchKeypadWindow();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    await addCodeToBatch(state.query);
  }
}

async function openBatchKeypadPopout() {
  if (!window.matchMedia("(min-width:851px)").matches) return;
  if (isBatchKeypadPoppedOut()) {
    batchKeypadWindow.focus();
    return;
  }
  if (!window.documentPictureInPicture?.requestWindow) {
    showMovementNotice("Este navegador não suporta a janela de teclado always on top. Usa uma versão atual do Chrome ou Edge.", "error");
    render();
    return;
  }
  try {
    const popoutWindow = await window.documentPictureInPicture.requestWindow({ width: 500, height: 640, disallowReturnToOpener: true });
    batchKeypadWindow = popoutWindow;
    const popoutDocument = popoutWindow.document;
    popoutDocument.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teclado do lote</title>';
    copyStylesToBatchKeypadWindow(popoutDocument);
    popoutDocument.documentElement.className = "batch-keypad-popout-html";
    popoutDocument.body.className = "batch-keypad-popout-body";
    popoutDocument.body.innerHTML = batchKeypadPopoutMarkup();
    popoutDocument.addEventListener("click", handleBatchKeypadPopoutClick);
    popoutDocument.addEventListener("keydown", handleBatchKeypadPopoutKeydown);
    popoutWindow.addEventListener("pagehide", () => {
      if (batchKeypadWindow !== popoutWindow) return;
      batchKeypadWindow = null;
      if (document.querySelector("#app")) render();
    }, { once: true });
    render();
  } catch {
    batchKeypadWindow = null;
    showMovementNotice("Não foi possível abrir a janela de teclado always on top.", "error");
    render();
  }
}

function batchAllocationMarkup(item) {
  if (state.batch.movementType !== "saida") return "";
  const allocations = Object.entries(item.allocations || {}).filter(([, quantity]) => Number(quantity) > 0);
  const used = new Set(allocations.map(([storage]) => storage));
  const rows = allocations.map(([storage, quantity], index) => {
    const location = item.locations.find(entry => entry.storage === storage);
    if (!location) return "";
    const options = item.locations.filter(entry => entry.storage === storage || !used.has(entry.storage)).map(entry => `<option value="${escapeHtml(entry.storage)}"${entry.storage === storage ? " selected" : ""}>${escapeHtml(entry.storage)} · disponível ${entry.stock}</option>`).join("");
    return `<div class="batch-allocation-row"><div class="select-control"><select data-batch-allocation-choice="${escapeHtml(storage)}" data-batch-code="${escapeHtml(item.code)}" aria-label="Localização ${index + 1}">${options}</select><span class="select-arrow">▾</span></div><div class="batch-inline-qty"><span>${quantity}</span><div><button type="button" data-action="batch-allocation-increase" data-batch-code="${escapeHtml(item.code)}" data-storage="${escapeHtml(storage)}">▴</button><button type="button" data-action="batch-allocation-decrease" data-batch-code="${escapeHtml(item.code)}" data-storage="${escapeHtml(storage)}">▾</button></div></div>${allocations.length > 1 ? `<button type="button" class="batch-remove-allocation" data-action="batch-allocation-remove" data-batch-code="${escapeHtml(item.code)}" data-storage="${escapeHtml(storage)}" aria-label="Remover localização">×</button>` : ""}</div>`;
  }).join("");
  const canAdd = allocations.length < item.locations.length && allocations.some(([, quantity]) => Number(quantity) > 1);
  return `<div class="batch-allocations"><small>Distribuição por localização</small>${rows}${canAdd ? `<button type="button" class="batch-add-location" data-action="batch-allocation-add" data-batch-code="${escapeHtml(item.code)}">+ ADICIONAR LOCALIZAÇÃO</button>` : ""}</div>`;
}

function batchReviewMarkup() {
  return `<section class="workspace batch-page"><section class="batch-panel batch-review-panel">
    <div class="batch-heading"><p>PICAGEM EM PAUSA</p><h2>Rever lote</h2><span>${state.batch.items.length} ${state.batch.items.length === 1 ? "referência" : "referências"} · ${batchUnitCount()} ${batchUnitCount() === 1 ? "unidade" : "unidades"}</span></div>
    <div class="batch-review-list">${[...state.batch.items].reverse().map(item => `<article class="batch-item">
      <div class="batch-item-main"><span class="batch-item-image">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : "#"}</span><span><b>${escapeHtml(item.code)} · ${escapeHtml(item.name)}</b><small>${escapeHtml(item.theme || "")} ${item.year ? `· ${escapeHtml(item.year)}` : ""}</small>${state.batch.movementType === "saida" ? `<em>Stock disponível: ${item.locations.reduce((total, location) => total + location.stock, 0)}</em>` : ""}</span><div class="batch-inline-qty"><strong>${item.qty}</strong><div><button type="button" data-action="batch-item-increase" data-batch-code="${escapeHtml(item.code)}">▴</button><button type="button" data-action="batch-item-decrease" data-batch-code="${escapeHtml(item.code)}">▾</button></div></div><button type="button" class="batch-remove-item" data-action="batch-item-remove" data-batch-code="${escapeHtml(item.code)}" aria-label="Remover ${escapeHtml(item.code)}">×</button></div>
      ${batchAllocationMarkup(item)}
    </article>`).join("")}</div>
    <div class="batch-actions"><button type="button" class="secondary" data-action="batch-resume">RETOMAR</button><button type="button" class="secondary batch-delete-action" data-action="batch-cancel">APAGAR</button><button type="button" class="primary" data-action="batch-conditions">CONCLUIR</button></div>
  </section></section>`;
}

function batchConditionsMarkup() {
  const form = state.batch.form;
  const isExit = state.batch.movementType === "saida";
  const memberSelected = isExit && form.origin === "Membro";
  const obsRequired = isExit && (memberSelected || form.origin === "Outro");
  const origin = isExit
    ? `<label><span>Destino <b>*</b></span><div class="select-control"><select data-batch-field="origin" required><option value="">Selecionar…</option>${["Espólio", "Membro", "Peças"].map(option => `<option value="${option}"${form.origin === option ? " selected" : ""}>${option}</option>`).join("")}<hr><option value="Outro"${form.origin === "Outro" ? " selected" : ""}>Outro</option></select><span class="select-arrow">▾</span></div></label>`
    : `<label><span>Origem <b>*</b></span><input data-batch-field="origin" value="${escapeHtml(form.origin)}" required autocomplete="off"></label>`;
  const creatingStorage = form.storageChoice === "__other__";
  const storages = state.storageOptions.map(storage => `<option value="${escapeHtml(storage)}"${form.storageChoice === storage ? " selected" : ""}>${escapeHtml(storage)}</option>`).join("");
  const storage = isExit ? "" : `<label><span>Local <b>*</b></span><div class="select-control"><select data-batch-storage-choice required><option value="">Selecionar…</option>${storages}<hr><option value="__other__"${creatingStorage ? " selected" : ""}>Outro…</option></select><span class="select-arrow">▾</span></div><input id="batch-new-storage" data-batch-field="storage" value="${creatingStorage ? escapeHtml(form.storage) : ""}" placeholder="Nova localização"${creatingStorage ? " required" : " hidden"} autocomplete="off"></label>`;
  return `<section class="workspace batch-page"><section class="batch-panel batch-conditions-panel">
    <div class="batch-heading"><p>CONCLUIR ${isExit ? "SAÍDA" : "ENTRADA"}</p><h2>Condições comuns</h2><span>Serão aplicadas a ${batchUnitCount()} ${batchUnitCount() === 1 ? "unidade" : "unidades"} deste lote.</span></div>
    <div class="batch-condition-fields">${origin}<label><span>${memberSelected ? "Nome do Membro" : "Obs"} ${obsRequired ? "<b>*</b>" : ""}</span><input data-batch-field="obs" value="${escapeHtml(form.obs)}"${obsRequired ? " required" : ""} autocomplete="off"></label>${storage}</div>
    <p class="batch-id">BatchID: ${escapeHtml(state.batch.id)}</p>
    <div class="batch-actions"><button type="button" class="secondary" data-action="batch-review">VOLTAR</button><button type="button" class="primary" data-action="batch-submit"${state.batch.saving ? " disabled" : ""}>${state.batch.saving ? "A REGISTAR…" : "CONCLUIR LOTE"}</button></div>
  </section></section>`;
}

function batchMarkup() {
  if (!state.batch.movementType || state.batch.phase === "type") return batchTypeMarkup();
  if (state.batch.phase === "resume") return batchResumePromptMarkup();
  if (state.batch.phase === "review") return batchReviewMarkup();
  if (state.batch.phase === "conditions") return batchConditionsMarkup();
  return batchScanMarkup();
}

function resultMarkup(item) {
  return `<article class="set-result"><div class="set-art" style="background:${escapeHtml(item.color)}"><span>#${escapeHtml(item.code)}</span></div><div class="set-copy"><p>${escapeHtml(item.theme)} · ${escapeHtml(item.year)}</p><h3>${escapeHtml(item.name)}</h3><div class="set-meta"><span><small>PEÇAS</small><b>${Number(item.pieces).toLocaleString("pt-PT")}</b></span><span><small>STOCK</small><b>${item.stock} un.</b></span><span><small>LOCAL</small><b>${escapeHtml(item.location)}</b></span></div></div><button class="confirm-button ${state.mode}" data-action="register">${state.mode === "lote" ? "Adicionar ao lote" : "Abrir ficha"} <span>→</span></button></article>`;
}

function render() {
  if (isBatchKeypadPoppedOut() && (state.mode !== "lote" || state.batch.phase !== "scan")) closeBatchKeypadPopout(false);
  const content = !state.mode ? optionsMarkup() : state.mode === "sheets" ? googleSheetsMarkup() : state.mode === "update" ? bricksetUpdateMarkup() : state.mode === "lote" ? batchMarkup() : state.selected && (state.mode === "entrada" || state.mode === "saida") ? foundMarkup() : state.mode === "entrada" || state.mode === "saida" ? keypadMarkup() : genericModeMarkup();
  const notice = state.movementNotice ? `<div class="app-toast ${state.movementNotice.type}" role="status">${escapeHtml(state.movementNotice.message)}</div>` : "";
  document.querySelector("#app").innerHTML = `${headerMarkup()}<div class="app-content">${content}</div>${state.scannerOpen ? scannerMarkup() : ""}${notice}`;
  const appContent = document.querySelector(".app-content");
  appContent?.addEventListener("scroll", updateLotMobileHeaderSummary, { passive: true });
  updateLotMobileHeaderSummary();
  renderBatchKeypadWindow();
}

function updateLotMobileHeaderSummary() {
  const title = document.querySelector("[data-lot-mobile-title]");
  if (!title) return;
  const content = document.querySelector(".app-content");
  const summary = document.querySelector(".batch-review-panel .batch-heading span");
  const summaryHasScrolledAway = Boolean(content && summary && summary.getBoundingClientRect().bottom <= content.getBoundingClientRect().top);
  title.textContent = summaryHasScrolledAway ? `LOTE: ${state.batch.items.length} Refs - ${batchUnitCount()} un.` : "LOTE";
}

function waitForMobileSwipeAnimation(element) {
  return new Promise(resolve => {
    let timer;
    const finish = event => {
      if (event && event.target !== element) return;
      window.clearTimeout(timer);
      element.removeEventListener("animationend", finish);
      resolve();
    };
    element.addEventListener("animationend", finish, { once: true });
    timer = window.setTimeout(finish, 260);
  });
}

function waitForMobileSwipeTransition(element) {
  return new Promise(resolve => {
    let timer;
    const finish = event => {
      if (event && (event.target !== element || event.propertyName !== "transform")) return;
      window.clearTimeout(timer);
      element.removeEventListener("transitionend", finish);
      resolve();
    };
    element.addEventListener("transitionend", finish);
    timer = window.setTimeout(finish, 260);
  });
}

function clearMobileSwipeStyles(element) {
  if (!element) return;
  element.classList.remove("mobile-swipe-dragging", "mobile-swipe-completing", "mobile-swipe-returning");
  element.style.removeProperty("transform");
  element.style.removeProperty("opacity");
}

function mobileSwipeVisualOffset(deltaX) {
  const currentIndex = MOBILE_SWIPE_MODES.indexOf(state.mode);
  const direction = deltaX < 0 ? 1 : -1;
  return MOBILE_SWIPE_MODES[currentIndex + direction] === undefined ? deltaX * .22 : deltaX;
}

async function returnMobileSwipeContent(element) {
  if (!element) return;
  mobileSwipeAnimating = true;
  try {
    element.classList.remove("mobile-swipe-dragging");
    element.classList.add("mobile-swipe-returning");
    element.getBoundingClientRect();
    element.style.transform = "translate3d(0,0,0)";
    await waitForMobileSwipeTransition(element);
  } finally {
    clearMobileSwipeStyles(element);
    mobileSwipeAnimating = false;
  }
}

async function activateAdjacentMobileTab(direction, outgoing, startOffset = 0) {
  const currentIndex = MOBILE_SWIPE_MODES.indexOf(state.mode);
  const nextMode = MOBILE_SWIPE_MODES[currentIndex + direction];
  if (currentIndex < 0 || nextMode === undefined || mobileSwipeAnimating) {
    await returnMobileSwipeContent(outgoing);
    return;
  }
  const action = nextMode === null ? "home" : nextMode === "sheets" ? "show-sheets" : "show-update";
  const tab = document.querySelector(`.desktop-tabs [data-action="${action}"]`);
  if (!tab) {
    await returnMobileSwipeContent(outgoing);
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
    clearMobileSwipeStyles(outgoing);
    tab.click();
    return;
  }
  mobileSwipeAnimating = true;
  try {
    if (outgoing) {
      outgoing.classList.remove("mobile-swipe-dragging");
      outgoing.classList.add("mobile-swipe-completing");
      outgoing.getBoundingClientRect();
      outgoing.style.transform = `translate3d(${startOffset + (direction > 0 ? -30 : 30)}px,0,0)`;
      outgoing.style.opacity = "0";
      await waitForMobileSwipeTransition(outgoing);
    }
    tab.click();
    const incoming = document.querySelector(".app-content");
    const incomingClass = direction > 0 ? "mobile-swipe-enter-right" : "mobile-swipe-enter-left";
    incoming?.classList.add(incomingClass);
    if (incoming) {
      await waitForMobileSwipeAnimation(incoming);
      incoming.classList.remove(incomingClass);
    }
  } finally {
    clearMobileSwipeStyles(outgoing);
    mobileSwipeAnimating = false;
  }
}

function canStartMobileTabSwipe(event) {
  if (!window.matchMedia("(max-width:850px)").matches || mobileSwipeAnimating || state.menuOpen || state.scannerOpen || !MOBILE_SWIPE_MODES.includes(state.mode)) return false;
  if (!event.target.closest?.(".app-content")) return false;
  return !event.target.closest?.("input, textarea, select, [contenteditable='true']");
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

async function runBricksetImport() {
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${APPS_SCRIPT_ID}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ function: "importBricksetSets" }),
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("SCRIPT_ACCESS_DENIED");
  if (response.status === 404) throw new Error("SCRIPT_NOT_FOUND");
  if (!response.ok) throw new Error(`SCRIPT_API_ERROR_${response.status}`);
  if (result.error) {
    const scriptError = new Error("SCRIPT_EXECUTION_FAILED");
    scriptError.details = result.error.details?.find(detail => detail.errorMessage)?.errorMessage || result.error.message || "";
    throw scriptError;
  }
  await loadCatalog(state.accessToken);
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

async function loadMovementStockRows() {
  const range = encodeURIComponent("Movimentos!D2:L");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${state.accessToken}` },
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("READ_DENIED");
  if (response.status === 400 || response.status === 404) throw new Error("MOVEMENTS_SHEET_NOT_FOUND");
  if (!response.ok) throw new Error(`SHEETS_READ_ERROR_${response.status}`);
  return (await response.json()).values || [];
}

function locationStockFromRows(rows, setNumber) {
  const stockByStorage = new Map();
  rows.forEach(row => {
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

async function getLocationStock(setNumber) {
  return locationStockFromRows(await loadMovementStockRows(), setNumber);
}

async function addCodeToBatch(rawCode, fromScanner = false) {
  const code = String(rawCode || "").replace(/\D/g, "");
  if (!code) return false;
  const found = findSet(code);
  if (!found) {
    showMovementNotice(`O código ${code} não foi encontrado no catálogo.`, "error");
    if (!fromScanner) render();
    return false;
  }
  let item = batchItemByCode(found.code);
  let locations = item?.locations || [];
  if (state.batch.movementType === "saida") {
    try {
      locations = await getLocationStock(found.code);
    } catch (error) {
      showMovementNotice(error.message === "AUTH_EXPIRED" ? "A sessão Google expirou. Inicia sessão novamente." : "Não foi possível verificar o stock deste conjunto.", "error");
      if (!fromScanner) render();
      return false;
    }
    const available = locations.reduce((total, location) => total + location.stock, 0);
    const nextQuantity = (Number(item?.qty) || 0) + 1;
    if (nextQuantity > available) {
      showMovementNotice(available ? `Stock máximo atingido para ${found.code}: ${available} un.` : `Não há stock do conjunto ${found.code}.`, "error");
      if (!fromScanner) render();
      return false;
    }
  }
  if (!item) {
    item = { ...found, qty: 0, locations, allocations: Object.create(null) };
  }
  item.locations = locations;
  item.qty = (Number(item.qty) || 0) + 1;
  if (state.batch.movementType === "saida") item.allocations = allocateAcrossLocations(locations, item.qty);
  const previousIndex = state.batch.items.indexOf(item);
  if (previousIndex >= 0) state.batch.items.splice(previousIndex, 1);
  state.batch.items.push(item);
  state.query = "";
  persistBatchDraft();
  showMovementNotice(`${found.code} adicionado · ${item.qty} ${item.qty === 1 ? "unidade" : "unidades"}.`, "success");
  if (!fromScanner) render();
  return true;
}

function setBatchItemQuantity(item, requestedQuantity) {
  if (!item) return false;
  let quantity = Math.max(1, Number.parseInt(requestedQuantity, 10) || 1);
  if (state.batch.movementType === "saida") {
    const available = item.locations.reduce((total, location) => total + location.stock, 0);
    quantity = Math.min(quantity, available);
    if (quantity < 1) return false;
    item.allocations = allocateAcrossLocations(item.locations, quantity);
  }
  item.qty = quantity;
  persistBatchDraft();
  return true;
}

async function ensureBatchColumnAndCheckDuplicate(batchId) {
  const metadataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title,gridProperties(columnCount)))`, {
    headers: { Authorization: `Bearer ${state.accessToken}` },
    cache: "no-store",
  });
  if (metadataResponse.status === 401) throw new Error("AUTH_EXPIRED");
  if (metadataResponse.status === 403) throw new Error("READ_DENIED");
  if (!metadataResponse.ok) throw new Error(`SHEETS_METADATA_ERROR_${metadataResponse.status}`);
  const movementSheet = (await metadataResponse.json()).sheets?.find(sheet => sheet.properties?.title === "Movimentos");
  if (!movementSheet) throw new Error("MOVEMENTS_SHEET_NOT_FOUND");
  const currentColumnCount = Number(movementSheet.properties.gridProperties?.columnCount) || 0;
  if (currentColumnCount < 16) {
    const dimensionResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: movementSheet.properties.sheetId, dimension: "COLUMNS", length: 16 - currentColumnCount } }] }),
    });
    if (dimensionResponse.status === 401) throw new Error("AUTH_EXPIRED");
    if (dimensionResponse.status === 403) throw new Error("WRITE_DENIED");
    if (!dimensionResponse.ok) throw new Error(`SHEETS_DIMENSION_ERROR_${dimensionResponse.status}`);
  }
  const range = encodeURIComponent("Movimentos!P1:P");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${state.accessToken}` },
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (response.status === 403) throw new Error("READ_DENIED");
  if (!response.ok) throw new Error(`SHEETS_READ_ERROR_${response.status}`);
  const values = (await response.json()).values || [];
  const header = String(values[0]?.[0] || "").trim();
  if (header && header !== "BatchID") throw new Error("BATCH_HEADER_CONFLICT");
  if (values.slice(1).some(row => String(row[0] || "").trim() === batchId)) return true;
  if (!header) {
    const headerRange = encodeURIComponent("Movimentos!P1");
    const headerResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${headerRange}?valueInputOption=RAW`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${state.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [["BatchID"]] }),
    });
    if (headerResponse.status === 401) throw new Error("AUTH_EXPIRED");
    if (headerResponse.status === 403) throw new Error("WRITE_DENIED");
    if (!headerResponse.ok) throw new Error(`SHEETS_WRITE_ERROR_${headerResponse.status}`);
  }
  return false;
}

async function appendBatchMovements() {
  if (!state.accessToken || !state.userEmail || !state.batch.items.length) throw new Error("NOT_AUTHENTICATED");
  const alreadyRecorded = await ensureBatchColumnAndCheckDuplicate(state.batch.id);
  if (alreadyRecorded) return { duplicate: true };
  const form = state.batch.form;
  const isExit = state.batch.movementType === "saida";
  const stockRows = isExit ? await loadMovementStockRows() : [];
  const timestamp = createMovementTimestamp();
  const rows = [];
  for (const item of state.batch.items) {
    let storageQuantities = [{ storage: form.storage.trim(), quantity: Number(item.qty) }];
    if (isExit) {
      const currentLocations = locationStockFromRows(stockRows, item.code);
      const available = currentLocations.reduce((total, location) => total + location.stock, 0);
      if (Number(item.qty) > available) {
        const error = new Error("INSUFFICIENT_STOCK");
        error.setCode = item.code;
        error.availableStock = available;
        throw error;
      }
      storageQuantities = Object.entries(item.allocations || {}).map(([storage, quantity]) => ({ storage, quantity: Number(quantity) || 0 })).filter(allocation => allocation.storage && allocation.quantity > 0);
      if (storageQuantities.reduce((total, allocation) => total + allocation.quantity, 0) !== Number(item.qty)) throw new Error("INVALID_ALLOCATION");
      const invalid = storageQuantities.find(allocation => allocation.quantity > (currentLocations.find(location => location.storage === allocation.storage)?.stock || 0));
      if (invalid) {
        const error = new Error("LOCATION_STOCK_CHANGED");
        error.setCode = item.code;
        throw error;
      }
    }
    storageQuantities.forEach(allocation => rows.push([
      createMovementId(), timestamp, item.ean, item.code, item.name, item.year, item.theme, item.subTheme || "",
      form.origin.trim(), item.imageUrl, allocation.storage, allocation.quantity * (isExit ? -1 : 1), state.userEmail,
      item.rrp || "", form.obs.trim(), state.batch.id,
    ]));
  }
  const range = encodeURIComponent("Movimentos!A:P");
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
  const client = window.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: GOOGLE_OAUTH_SCOPE, callback: async response => {
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
      sessionStorage.setItem(TOKEN_SCOPE_KEY, GOOGLE_OAUTH_SCOPE);
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
  sessionStorage.removeItem(TOKEN_SCOPE_KEY);
  Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, loggedIn: false, accessToken: "", userEmail: "", catalogRows: [], loginError: "", checkingCredentials: false, movementForm: emptyMovementForm(), movementSaving: false, catalogUpdating: false, movementNotice: null, lastMovementDefaults: { origin: "", storage: "" }, storageOptions: [], locationStock: [], status: "Sessão terminada" });
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
    let lastBatchEan = "";
    let lastBatchEanAt = Number.NEGATIVE_INFINITY;

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
              if (state.mode === "lote") {
                const acceptedAt = performance.now();
                if (ean !== lastBatchEan || acceptedAt - lastBatchEanAt >= 1000) {
                  lastBatchEan = ean;
                  lastBatchEanAt = acceptedAt;
                  const added = await addCodeToBatch(ean, true);
                  updateScannerStatus(added
                    ? `${found.code} adicionado · ${batchUnitCount()} un. no lote. Aponte para o próximo código.`
                    : `Não foi possível adicionar ${found.code}. Aponte para outro código.`);
                  if (navigator.vibrate && added) navigator.vibrate(45);
                }
                barcodeScanTimer = window.setTimeout(scanFrame, 140);
                return;
              }
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

document.addEventListener("touchstart", event => {
  if (event.touches.length !== 1 || !canStartMobileTabSwipe(event)) {
    mobileSwipeGesture = null;
    return;
  }
  const touch = event.touches[0];
  mobileSwipeGesture = { x: touch.clientX, y: touch.clientY, startedAt: performance.now(), horizontal: false, cancelled: false, offset: 0, content: document.querySelector(".app-content") };
}, { passive: true });

document.addEventListener("touchmove", event => {
  if (!mobileSwipeGesture || event.touches.length !== 1) return;
  const touch = event.touches[0];
  const deltaX = touch.clientX - mobileSwipeGesture.x;
  const deltaY = touch.clientY - mobileSwipeGesture.y;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (!mobileSwipeGesture.horizontal && verticalDistance > 12 && verticalDistance > horizontalDistance) mobileSwipeGesture.cancelled = true;
  if (!mobileSwipeGesture.cancelled && horizontalDistance > 12 && horizontalDistance > verticalDistance * 1.15) mobileSwipeGesture.horizontal = true;
  if (mobileSwipeGesture.horizontal) {
    event.preventDefault();
    mobileSwipeGesture.offset = mobileSwipeVisualOffset(deltaX);
    mobileSwipeGesture.content?.classList.add("mobile-swipe-dragging");
    if (mobileSwipeGesture.content) mobileSwipeGesture.content.style.transform = `translate3d(${mobileSwipeGesture.offset}px,0,0)`;
  }
}, { passive: false });

document.addEventListener("touchend", event => {
  const gesture = mobileSwipeGesture;
  mobileSwipeGesture = null;
  const touch = event.changedTouches[0];
  if (!gesture || gesture.cancelled || !touch) return;
  const deltaX = touch.clientX - gesture.x;
  const deltaY = touch.clientY - gesture.y;
  if (gesture.horizontal) event.preventDefault();
  const direction = deltaX < 0 ? 1 : -1;
  const currentIndex = MOBILE_SWIPE_MODES.indexOf(state.mode);
  const hasAdjacentTab = MOBILE_SWIPE_MODES[currentIndex + direction] !== undefined;
  const shouldNavigate = gesture.horizontal && hasAdjacentTab && Math.abs(deltaX) >= 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && performance.now() - gesture.startedAt <= 900;
  if (shouldNavigate) void activateAdjacentMobileTab(direction, gesture.content, gesture.offset);
  else if (gesture.horizontal) void returnMobileSwipeContent(gesture.content);
}, { passive: false });

document.addEventListener("touchcancel", () => {
  const gesture = mobileSwipeGesture;
  mobileSwipeGesture = null;
  if (gesture?.horizontal) void returnMobileSwipeContent(gesture.content);
}, { passive: true });

window.addEventListener("resize", () => {
  if (isBatchKeypadPoppedOut() && !window.matchMedia("(min-width:851px)").matches) closeBatchKeypadPopout();
});

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
    if (state.mode === "lote") {
      state.batch = restoreBatchDraft();
      if (state.batch.items.length) {
        state.batch.resumePhase = state.batch.phase;
        state.batch.phase = "resume";
      }
    }
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
  if (action === "batch-keypad-popout") { await openBatchKeypadPopout(); return; }
  if (action === "scanner") { openBarcodeScanner(); return; }
  if (action === "close-scanner") { window.history.back(); return; }
  if (action === "focus-camera") { focusBarcodeCamera(event); return; }
  if (action === "batch-continue-draft") {
    state.batch.phase = state.batch.resumePhase || "scan";
    delete state.batch.resumePhase;
    persistBatchDraft();
    writeAppHistory(`batch-${state.batch.phase}`, true);
    render();
    return;
  }
  if (action === "batch-view-draft") {
    state.batch.phase = "review";
    delete state.batch.resumePhase;
    persistBatchDraft();
    writeAppHistory("batch-review", true);
    render();
    return;
  }
  if (action === "batch-discard-draft") {
    clearBatchDraft();
    writeAppHistory("mode", true);
    render();
    return;
  }
  if (action === "batch-type") {
    const movementType = event.target.closest("[data-batch-type]")?.dataset.batchType;
    if (!['entrada', 'saida'].includes(movementType)) return;
    state.batch = emptyBatchState(state.userEmail);
    state.batch.movementType = movementType;
    state.batch.phase = "scan";
    state.batch.form = movementFormForMode(movementType);
    persistBatchDraft();
    writeAppHistory("batch-scan");
    render();
    document.querySelector("#lego-code")?.focus();
    return;
  }
  if (action === "batch-add-code") { await addCodeToBatch(state.query); document.querySelector("#lego-code")?.focus(); return; }
  if (action === "batch-review") {
    if (!state.batch.items.length) return;
    const replaceHistory = state.batch.phase === "conditions";
    state.batch.phase = "review";
    persistBatchDraft();
    writeAppHistory("batch-review", replaceHistory);
    render();
    return;
  }
  if (action === "batch-resume") { setBatchPhase("scan"); return; }
  if (action === "batch-conditions") {
    if (!state.batch.items.length) return;
    setBatchPhase("conditions");
    return;
  }
  if (action === "batch-cancel") {
    if (state.batch.items.length && !window.confirm("Cancelar esta picagem e apagar o rascunho do lote?")) return;
    clearBatchDraft();
    Object.assign(state, { mode: null, query: "", selected: null, menuOpen: false, movementNotice: null });
    writeAppHistory("home");
    render();
    return;
  }
  if (action === "batch-item-increase" || action === "batch-item-decrease") {
    const item = batchItemByCode(event.target.closest("[data-batch-code]")?.dataset.batchCode);
    if (!item) return;
    const change = action === "batch-item-increase" ? 1 : -1;
    const before = Number(item.qty);
    setBatchItemQuantity(item, before + change);
    if (action === "batch-item-increase" && Number(item.qty) === before) showMovementNotice(`Stock máximo atingido para ${item.code}.`, "error");
    renderPreservingContentScroll();
    return;
  }
  if (action === "batch-item-remove") {
    const code = event.target.closest("[data-batch-code]")?.dataset.batchCode;
    const item = batchItemByCode(code);
    if (!item || !window.confirm(`Apagar ${item.code} · ${item.name} do lote?`)) return;
    state.batch.items = state.batch.items.filter(item => String(item.code) !== String(code));
    if (!state.batch.items.length) state.batch.phase = "scan";
    persistBatchDraft();
    if (state.batch.phase === "review") renderPreservingContentScroll();
    else render();
    return;
  }
  if (action.startsWith("batch-allocation-")) {
    const button = event.target.closest("[data-batch-code]");
    const item = batchItemByCode(button?.dataset.batchCode);
    if (!item) return;
    const storage = button.dataset.storage;
    if (action === "batch-allocation-add") {
      const used = new Set(Object.keys(item.allocations || {}));
      const next = item.locations.find(location => !used.has(location.storage));
      const donor = Object.entries(item.allocations).find(([, quantity]) => Number(quantity) > 1);
      if (next && donor) {
        item.allocations[donor[0]] = Number(donor[1]) - 1;
        item.allocations[next.storage] = 1;
      }
    } else if (action === "batch-allocation-remove") {
      const removedQuantity = Number(item.allocations[storage]) || 0;
      const receiver = Object.keys(item.allocations).find(name => name !== storage && (Number(item.allocations[name]) || 0) + removedQuantity <= (item.locations.find(location => location.storage === name)?.stock || 0));
      if (receiver) {
        item.allocations[receiver] = Number(item.allocations[receiver]) + removedQuantity;
        delete item.allocations[storage];
      }
    } else {
      const location = item.locations.find(entry => entry.storage === storage);
      if (!location) return;
      const current = Math.max(1, Number(item.allocations[storage]) || 1);
      if (action === "batch-allocation-increase" && current < location.stock) {
        const donor = Object.entries(item.allocations).find(([name, quantity]) => name !== storage && Number(quantity) > 1);
        if (donor) {
          item.allocations[storage] = current + 1;
          item.allocations[donor[0]] = Number(donor[1]) - 1;
        }
      }
      if (action === "batch-allocation-decrease" && current > 1) {
        const receiver = Object.keys(item.allocations).find(name => name !== storage && (Number(item.allocations[name]) || 0) < (item.locations.find(location => location.storage === name)?.stock || 0));
        if (receiver) {
          item.allocations[storage] = current - 1;
          item.allocations[receiver] = Number(item.allocations[receiver]) + 1;
        }
      }
    }
    persistBatchDraft();
    renderPreservingContentScroll();
    return;
  }
  if (action === "batch-submit") {
    if (state.batch.saving) return;
    const requiredFields = [...document.querySelectorAll(".batch-condition-fields [required]")];
    const invalidField = requiredFields.find(field => !field.checkValidity());
    if (invalidField) { invalidField.reportValidity(); return; }
    state.batch.saving = true;
    state.movementNotice = null;
    render();
    try {
      const result = await appendBatchMovements();
      const movementName = state.batch.movementType === "entrada" ? "Entrada" : "Saída";
      const units = batchUnitCount();
      if (state.batch.movementType === "entrada") {
        state.lastMovementDefaults = { origin: state.batch.form.origin.trim(), storage: state.batch.form.storage.trim() };
        state.storageOptions = sortStorageNames([...state.storageOptions, state.batch.form.storage]);
      }
      clearBatchDraft();
      Object.assign(state, { mode: null, query: "", selected: null, movementNotice: null, status: `${movementName} em lote registada.` });
      showMovementNotice(result.duplicate ? "Este lote já estava registado." : `Lote concluído com sucesso · ${units} un.`, "success");
      writeAppHistory("home", true);
    } catch (error) {
      state.batch.saving = false;
      const messages = {
        NOT_AUTHENTICATED: "Inicia novamente a sessão Google antes de concluir o lote.",
        AUTH_EXPIRED: "A sessão Google expirou. Inicia sessão novamente.",
        READ_DENIED: "Sem permissão para validar os movimentos.",
        WRITE_DENIED: "Sem permissão para escrever no sheet Movimentos.",
        MOVEMENTS_SHEET_NOT_FOUND: "Não foi possível encontrar o sheet Movimentos.",
        INVALID_ALLOCATION: "A distribuição por localizações não corresponde à quantidade do lote.",
        LOCATION_STOCK_CHANGED: `O stock por localização de ${error.setCode || "um conjunto"} foi alterado. Revê o lote.`,
        BATCH_HEADER_CONFLICT: "A coluna P de Movimentos já tem outro cabeçalho. Deve chamar-se BatchID.",
      };
      const message = error.message === "INSUFFICIENT_STOCK"
        ? `Stock insuficiente para ${error.setCode}. Disponível: ${Math.max(0, error.availableStock)}.`
        : messages[error.message] || (error.message.startsWith("SHEETS_") ? `O Google Sheets recusou a operação (${error.message}).` : "Não foi possível concluir o lote. Tenta novamente.");
      showMovementNotice(message, "error");
    }
    render();
    return;
  }
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
    if (state.mode === "sheets") {
      state.menuOpen = false;
      render();
      return;
    }
    Object.assign(state, { mode: "sheets", query: "", selected: null, menuOpen: false, movementForm: emptyMovementForm(), movementNotice: null, locationStock: [], photoMetaVisible: true });
    writeAppHistory("sheets");
    render();
    return;
  }
  if (action === "show-update") {
    if (state.mode === "update") {
      state.menuOpen = false;
      render();
      return;
    }
    Object.assign(state, { mode: "update", query: "", selected: null, menuOpen: false, movementForm: emptyMovementForm(), movementNotice: null, locationStock: [], photoMetaVisible: true });
    writeAppHistory("update");
    render();
    return;
  }
  if (action === "run-brickset-update") {
    if (state.catalogUpdating) return;
    if (!state.loggedIn || !state.accessToken) {
      showMovementNotice("Inicia sessão com Google antes de actualizar o catálogo.", "error");
      render();
      return;
    }
    state.catalogUpdating = true;
    state.movementNotice = null;
    render();
    try {
      await runBricksetImport();
      state.catalogUpdating = false;
      state.status = "Catálogo Brickset actualizado.";
      showMovementNotice("Catálogo Brickset actualizado com sucesso.", "success");
    } catch (error) {
      const messages = {
        AUTH_EXPIRED: "A sessão Google expirou. Inicia sessão novamente.",
        SCRIPT_ACCESS_DENIED: "Sem permissão para executar o Apps Script. Inicia sessão novamente e confirma o acesso solicitado.",
        SCRIPT_NOT_FOUND: "O Apps Script ou a implantação API não foi encontrado.",
        SCRIPT_EXECUTION_FAILED: "A função importBricksetSets terminou com um erro. Consulta as execuções no Apps Script.",
      };
      if (error.message === "AUTH_EXPIRED") {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_SCOPE_KEY);
        Object.assign(state, { loggedIn: false, accessToken: "", userEmail: "", loginError: messages.AUTH_EXPIRED });
      }
      state.catalogUpdating = false;
      showMovementNotice(messages[error.message] || "Não foi possível actualizar o catálogo Brickset.", "error");
    }
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
        sessionStorage.removeItem(TOKEN_SCOPE_KEY);
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
  if (event.target.dataset?.batchStorageChoice !== undefined) {
    const choice = event.target.value;
    const creatingStorage = choice === "__other__";
    state.batch.form.storageChoice = choice;
    state.batch.form.storage = creatingStorage ? "" : choice;
    persistBatchDraft();
    const newStorageInput = document.querySelector("#batch-new-storage");
    if (newStorageInput) {
      newStorageInput.hidden = !creatingStorage;
      newStorageInput.required = creatingStorage;
      newStorageInput.value = "";
      if (creatingStorage) newStorageInput.focus({ preventScroll: true });
    }
    return;
  }
  const batchField = event.target.dataset?.batchField;
  if (batchField) {
    state.batch.form[batchField] = event.target.value;
    persistBatchDraft();
    if (batchField === "origin" && state.batch.movementType === "saida") renderPreservingContentScroll();
    return;
  }
  const previousBatchStorage = event.target.dataset?.batchAllocationChoice;
  if (previousBatchStorage) {
    const item = batchItemByCode(event.target.dataset.batchCode);
    const nextStorage = event.target.value;
    const nextLocation = item?.locations.find(location => location.storage === nextStorage);
    if (!item || !nextLocation || nextStorage === previousBatchStorage) return;
    const quantity = Math.max(1, Number(item.allocations[previousBatchStorage]) || 1);
    if (quantity > nextLocation.stock) {
      showMovementNotice(`${nextStorage} só tem ${nextLocation.stock} un. disponíveis.`, "error");
      renderPreservingContentScroll();
      return;
    }
    delete item.allocations[previousBatchStorage];
    item.allocations[nextStorage] = quantity;
    persistBatchDraft();
    renderPreservingContentScroll();
    return;
  }
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

document.addEventListener("keydown", async event => {
  if (state.scannerOpen && event.key === "Escape") {
    window.history.back();
    return;
  }
  if (event.target.id === "lego-code" && event.key === "Enter") {
    event.preventDefault();
    if (state.mode === "lote") await addCodeToBatch(state.query);
    else lookup();
  }
  const keypadActive = ((state.mode === "entrada" || state.mode === "saida") && !state.selected || state.mode === "lote" && state.batch.phase === "scan") && !state.scannerOpen;
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
    if (state.mode === "lote") await addCodeToBatch(state.query);
    else lookup();
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

  if (state.mode === "lote") {
    state.batch = restoreBatchDraft();
    if (historyState.step.startsWith("batch-")) {
      state.batch.phase = historyState.step.replace("batch-", "");
      persistBatchDraft();
    } else if (historyState.step === "mode") {
      if (state.batch.items.length) {
        state.batch.resumePhase = state.batch.phase;
        state.batch.phase = "resume";
      } else {
        state.batch.phase = "type";
      }
    }
    render();
    if (historyState.step === "scanner") openBarcodeScanner(false);
    return;
  }

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
  const storedScope = sessionStorage.getItem(TOKEN_SCOPE_KEY);
  if (!token) {
    state.checkingCredentials = false;
    render();
    return;
  }
  if (storedScope !== GOOGLE_OAUTH_SCOPE) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_SCOPE_KEY);
    state.checkingCredentials = false;
    state.loginError = "Inicia sessão novamente para autorizar a actualização do catálogo Brickset.";
    render();
    return;
  }
  try {
    await loadCatalog(token);
    state.accessToken = token;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_SCOPE_KEY);
    state.loginError = "A sessão Google expirou. Inicia sessão novamente.";
  }
  state.checkingCredentials = false;
  render();
}

writeAppHistory("home", true);
restoreSession();
