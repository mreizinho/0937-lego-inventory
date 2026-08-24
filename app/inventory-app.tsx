"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconBrandGoogle, IconChevronLeft, IconChevronRight, IconClipboardList, IconDownload, IconEye, IconFilter, IconLock, IconLogout, IconMenu2, IconPackageExport, IconPackageImport, IconRefresh, IconScan, IconSearch, IconTable, IconX } from "@tabler/icons-react";

type Mode = "entrada" | "saida" | "consulta" | "lote";
type LegoSet = { code: string; ean: string; name: string; theme: string; year: number; pieces: number; stock: number; location: string; color: string; imageUrl?: string };

const sets: LegoSet[] = [
  { code: "10300", ean: "5702017153186", name: "Back to the Future Time Machine", theme: "LEGO Icons", year: 2022, pieces: 1872, stock: 1, location: "Vitrine A · 02", color: "#d5e5ef" },
  { code: "21325", ean: "5702016911985", name: "Medieval Blacksmith", theme: "LEGO Ideas", year: 2021, pieces: 2164, stock: 2, location: "Estante C · 03", color: "#e5d2b5" },
  { code: "42143", ean: "5702017159041", name: "Ferrari Daytona SP3", theme: "LEGO Technic", year: 2022, pieces: 3778, stock: 1, location: "Vitrine B · 01", color: "#efc5c5" },
  { code: "75257", ean: "5702016370799", name: "Millennium Falcon", theme: "LEGO Star Wars", year: 2019, pieces: 1353, stock: 3, location: "Estante A · 02", color: "#d4d4d1" },
];

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const spreadsheetId = "1uLDmcH1U2ayy08LkMXHKvqddYkmwUQqAmd520ilo_XI";

type GoogleTokenResponse = { access_token?: string; error?: string };

declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (config: { client_id: string; scope: string; callback: (response: GoogleTokenResponse) => void }) => { requestAccessToken: (options?: { prompt?: string }) => void }; revoke: (token: string, callback?: () => void) => void } } };
  }
}

function BrickMark() { return <span className="brick-mark" aria-hidden="true"><i /><i /><i /><i /></span>; }
function ScannerGlyph() { return <svg className="scanner-glyph" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M9 3H5a2 2 0 0 0-2 2v4M19 3h4a2 2 0 0 1 2 2v4M9 25H5a2 2 0 0 1-2-2v-4M19 25h4a2 2 0 0 0 2-2v-4M7 9v10M10 9v10M14 9v10M17 9v10M21 9v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>; }
function ModeGlyph({ mode, size = 22 }: { mode: Mode; size?: number }) {
  const props = { size, stroke: 2.2, "aria-hidden": true as const };
  if (mode === "entrada") return <IconPackageImport {...props} />;
  if (mode === "saida") return <IconPackageExport {...props} />;
  if (mode === "consulta") return <IconEye {...props} />;
  return <IconScan {...props} />;
}

export default function Home() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LegoSet | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [catalogRows, setCatalogRows] = useState<string[][]>([]);
  const [loginError, setLoginError] = useState("");
  const [status, setStatus] = useState("Catálogo sincronizado há 2 min");
  const inputRef = useRef<HTMLInputElement>(null);
  const found = useMemo(() => {
    const code = query.trim();
    if (catalogRows.length) {
      const headers = catalogRows.slice(0, 2);
      const row = catalogRows.slice(2).find(item => String(item[1] ?? "").trim() === code);
      if (row) {
        const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
        const value = (name: string) => {
          const wanted = normalizeHeader(name);
          const index = row.findIndex((_, column) => headers.some(headerRow => normalizeHeader(String(headerRow?.[column] ?? "")) === wanted));
          return index >= 0 ? String(row[index] ?? "") : "";
        };
        const number = value("Number") || String(row[1] ?? code);
        const imageFilename = value("ImageFilename");
        const imageFile = imageFilename && /\.[a-z0-9]+$/i.test(imageFilename) ? imageFilename : imageFilename ? `${imageFilename}.jpg` : "";
        return {
          code: number, ean: value("EAN"), name: value("SetName") || `Conjunto ${number}`,
          theme: value("Theme") || "LEGO", year: Number(value("Year") || value("YearFrom")) || 0,
          pieces: Number(value("Pieces")) || 0, stock: 0, location: "—", color: "#e5edf3",
          imageUrl: imageFile ? `https://images.brickset.com/sets/images/${imageFile}` : undefined,
        } satisfies LegoSet;
      }
      return undefined;
    }
    return sets.find(s => s.code === code || s.ean === code);
  }, [catalogRows, query]);

  useEffect(() => {
    if (window.google?.accounts?.oauth2) { setGoogleReady(true); return; }
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    const script = existing ?? document.createElement("script");
    const ready = () => setGoogleReady(true);
    script.addEventListener("load", ready);
    if (!existing) { script.src = "https://accounts.google.com/gsi/client"; script.async = true; document.head.appendChild(script); }
    return () => script.removeEventListener("load", ready);
  }, []);

  useEffect(() => {
    const savedToken = sessionStorage.getItem("googleSheetsAccessToken");
    if (!savedToken) return;
    setAccessToken(savedToken);
    loadCatalog(savedToken).catch(() => {
      sessionStorage.removeItem("googleSheetsAccessToken");
      setAccessToken(""); setCatalogRows([]); setLoggedIn(false);
      setLoginError("A sessão Google expirou. Inicia sessão novamente.");
    });
  }, []);

  async function loadCatalog(token: string) {
    const range = encodeURIComponent("BricksetSets!A1:ZZ");
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) throw new Error("AUTH_EXPIRED");
    if (response.status === 403) throw new Error("NO_ACCESS");
    if (response.status === 404) throw new Error("SPREADSHEET_NOT_FOUND");
    if (response.status === 400) throw new Error("SHEET_NOT_FOUND");
    if (!response.ok) throw new Error(`SHEETS_ERROR_${response.status}`);
    const data = await response.json() as { values?: Array<Array<string | number>> };
    const rows = (data.values ?? []).map(row => row.map(value => String(value)));
    setCatalogRows(rows);
    setLoggedIn(true);
    setLoginError("");
    setStatus("Sessão iniciada · catálogo BricksetSets disponível");
  }

  function loginWithGoogle() {
    setMenuOpen(false);
    setLoginError("");
    if (!googleClientId) { setLoginError("Login Google ainda não configurado."); setStatus("Login Google ainda não configurado."); return; }
    if (!googleReady || !window.google) { setLoginError("A preparar o login Google. Tenta novamente."); setStatus("A preparar o login Google. Tenta novamente dentro de instantes."); return; }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: async response => {
        if (!response.access_token) { const message = `Não foi possível iniciar sessão com Google${response.error ? ` (${response.error})` : ""}.`; setLoggedIn(false); setLoginError(message); setStatus(message); return; }
        try { await loadCatalog(response.access_token); setAccessToken(response.access_token); sessionStorage.setItem("googleSheetsAccessToken", response.access_token); }
        catch (error) {
          setLoggedIn(false); setCatalogRows([]); setAccessToken("");
          const code = error instanceof Error ? error.message : "SHEETS_ERROR";
          const message = code === "NO_ACCESS" ? "Esta conta Google não tem acesso ao inventário."
            : code === "AUTH_EXPIRED" ? "A autorização Google expirou. Inicia sessão novamente."
            : code === "SPREADSHEET_NOT_FOUND" ? "O spreadsheet do inventário não foi encontrado."
            : code === "SHEET_NOT_FOUND" ? "A folha BricksetSets não foi encontrada."
            : `Não foi possível consultar o Google Sheets (${code}).`;
          setLoginError(message); setStatus(message);
        }
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  }

  function logoutGoogle() {
    if (accessToken && window.google) window.google.accounts.oauth2.revoke(accessToken);
    sessionStorage.removeItem("googleSheetsAccessToken");
    setAccessToken(""); setCatalogRows([]); setLoggedIn(false); setLoginError(""); setMode(null); setMenuOpen(false); setStatus("Sessão terminada");
  }

  function chooseMode(next: Mode) {
    setMode(next);
    setSelected(null);
    if (next !== "entrada" && next !== "saida") setTimeout(() => inputRef.current?.focus(), 50);
  }
  function lookup() {
    if (found) { setSelected(found); setStatus(`Conjunto ${found.code} encontrado no catálogo`); }
    else { setSelected(null); setStatus(query ? "Código não encontrado. Confirma o número ou EAN." : "Digite ou leia um código para continuar."); }
  }
  function register() {
    if (!selected) return;
    setStatus(`${mode === "entrada" ? "Entrada" : mode === "saida" ? "Saída" : mode === "lote" ? "Item adicionado ao lote" : "Consulta"} preparada para ${selected.code}. Ligação ao Google Sheets por configurar.`);
  }

  function renderMenu(id: string) {
    return menuOpen && <div className="menu-popover" id={id}>
      {!loggedIn ? <button className="google-login" onClick={loginWithGoogle}><span><IconBrandGoogle /></span><span><strong>Entrar com Google</strong><small>Aceder ao inventário</small></span></button>
      : <button className="google-login signed-in" onClick={logoutGoogle}><span><IconLogout /></span><span><strong>Terminar sessão</strong><small>Sessão Google ativa</small></span></button>}
      <p className="menu-group-title">BASE DE DADOS</p>
      <button className="menu-action"><span className="menu-action-icon yellow"><IconDownload /></span><span><strong>Transferir Base de Dados</strong><small>Download offline da BD</small></span><IconChevronRight className="menu-chevron" /></button>
      <button className="menu-action"><span className="menu-action-icon green"><IconTable /></span><span><strong>Abrir Google Sheets</strong><small>Ver tabela completa</small></span><IconChevronRight className="menu-chevron" /></button>
      <button className="menu-action"><span className="menu-action-icon blue"><IconRefresh /></span><span><strong>Atualizar Catálogos</strong><small>Sync via API Brickset</small></span><IconChevronRight className="menu-chevron" /></button>
      <p className="menu-group-title extras">EXTRAS</p>
      <button className="menu-action"><span className="menu-action-icon orange"><IconClipboardList /></span><span><strong>Modo Inventário</strong><small>Iniciar novo inventário</small></span><IconChevronRight className="menu-chevron" /></button>
      <button className="menu-action"><span className="menu-action-icon blue"><IconFilter /></span><span><strong>Consultas Avançadas</strong><small>Filtros por tema, período...</small></span><IconChevronRight className="menu-chevron" /></button>
    </div>;
  }

  return (
    <main className="app-shell">
      <header className={`masthead ${mode === "entrada" || mode === "saida" ? "movement-screen" : ""}`}>
        <a className="brand" href="https://comunidade0937.com/forum/" aria-label="Comunidade 0937">
          <picture>
            <source media="(max-width: 850px)" srcSet={`${basePath}/comunidade-0937-bricks.svg`} />
            <img src={`${basePath}/comunidade-0937.svg`} alt="Comunidade 0937" />
          </picture>
        </a>
        <div className="header-menu">
          <button className="header-search-button" aria-label="Pesquisar">
            <IconSearch aria-hidden="true" />
          </button>
          <button className="hamburger-button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-controls="main-menu" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}>
            {menuOpen ? <IconX aria-hidden="true" /> : <IconMenu2 aria-hidden="true" />}
          </button>
          {renderMenu("main-menu")}
        </div>
      </header>
      {mode !== "entrada" && mode !== "saida" && <section className="intro" id="inventario">
        <p className="tagline">O que queres fazer hoje?</p>
      </section>}
      <section className="workspace">
        {!mode ? <section className="options-panel">
          <h2 className="options-title">Opções</h2>
          {!loggedIn && <button type="button" className={`login-required ${loginError ? "has-error" : ""}`} onClick={loginWithGoogle}><IconLock aria-hidden="true" /><span><strong>{loginError || "Inicia sessão para continuar"}</strong><small>{loginError ? "Toca aqui para tentar novamente." : "As opções ficam disponíveis após o login com Google."}</small></span></button>}
          <div className="options-grid">
            {(["entrada", "saida", "consulta", "lote"] as Mode[]).map(item => <button key={item} disabled={!loggedIn} onClick={() => chooseMode(item)} className={`option-card ${item}`}><span className="mode-option-image"><img src={`${basePath}/options/${item === "consulta" ? "lote" : item === "lote" ? "consultar" : item}.png`} alt="" /></span><span><strong>{item === "entrada" ? "Entrada" : item === "saida" ? "Saida" : item === "consulta" ? "Consultar" : "Modo Lote"}</strong><small>{item === "entrada" ? "Registar set recebido" : item === "saida" ? "Registar set enviado" : item === "consulta" ? "Ver detalhes e stock" : "Scan múltiplo rápido"}</small></span><b>›</b></button>)}
          </div>
        </section> : <section className="scan-panel">
          {mode === "entrada" || mode === "saida" ? selected ? <div className="set-found-screen">
            <div className="entry-keypad-title">
              <button className="entry-title-back" onClick={() => { setMode(null); setSelected(null); setQuery(""); }} aria-label="Voltar às opções"><IconChevronLeft stroke={3.5} aria-hidden="true" /></button>
              <h2>{mode === "entrada" ? "ENTRADA" : "SAÍDA"}</h2>
              <div className="entry-title-menu">
                <button className="hamburger-button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-controls="movement-menu" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}>
                  {menuOpen ? <IconX aria-hidden="true" /> : <IconMenu2 aria-hidden="true" />}
                </button>
                {renderMenu("movement-menu")}
              </div>
            </div>
            <article className="set-found-card">
              <h3>{selected.code} <span>–</span> {selected.name}</h3>
              <div className="set-found-photo">
                {selected.imageUrl ? <img src={selected.imageUrl} alt={`${selected.code} - ${selected.name}`} /> : <span>Imagem indisponível</span>}
              </div>
              <dl>
                <div><dt>ANO</dt><dd>{selected.year || "—"}</dd></div>
                <div><dt>TEMA</dt><dd>{selected.theme || "—"}</dd></div>
              </dl>
            </article>
          </div> : <div className="entry-keypad">
            <div className="entry-keypad-title">
              <button className="entry-title-back" onClick={() => { setMode(null); setSelected(null); setQuery(""); }} aria-label="Voltar às opções"><IconChevronLeft stroke={3.5} aria-hidden="true" /></button>
              <h2>{mode === "entrada" ? "ENTRADA" : "SAÍDA"}</h2>
              <div className="entry-title-menu">
                <button className="hamburger-button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-controls="movement-menu" aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}>
                  {menuOpen ? <IconX aria-hidden="true" /> : <IconMenu2 aria-hidden="true" />}
                </button>
                {renderMenu("movement-menu")}
              </div>
            </div>
            <label htmlFor="entry-code">Digite o N.º do Set ou Código de Barras</label>
            <input ref={inputRef} id="entry-code" className="keypad-display" value={query} readOnly inputMode="none" tabIndex={-1} onPointerDown={event => event.preventDefault()} aria-label="Código introduzido através do teclado no ecrã" />
            <div className="number-grid">
              {[1,2,3,4,5,6,7,8,9].map(number => <button key={number} onClick={() => { setQuery(value => value + number); setSelected(null); }}>{number}</button>)}
              <button className="delete-key" aria-label="Apagar último dígito" onClick={() => { setQuery(value => value.slice(0,-1)); setSelected(null); }}>C</button>
              <button onClick={() => { setQuery(value => value + "0"); setSelected(null); }}>0</button>
              <button className="ok-key" onClick={lookup}>OK</button>
            </div>
            <div className="keypad-actions">
              <button className="clear-key" onClick={() => { setQuery(""); setSelected(null); }}>LIMPAR</button>
              <button className="scanner-key" onClick={() => { setQuery("5702016370799"); setSelected(null); }}><ScannerGlyph /> SCANNER</button>
            </div>
          </div> : <>
            <div className="scan-heading"><span className={`big-icon ${mode}`}><ModeGlyph mode={mode} size={27} /></span><div><h2>{mode === "saida" ? "Identificar conjunto para saída" : mode === "lote" ? "Adicionar conjuntos ao lote" : "Consultar conjunto"}</h2></div></div>
            <label className="code-label" htmlFor="lego-code">Código do conjunto ou EAN</label>
            <div className="code-row"><div className="code-input"><span>▥</span><input ref={inputRef} id="lego-code" value={query} onChange={e => { setQuery(e.target.value.replace(/\D/g, "")); setSelected(null); }} onKeyDown={e => e.key === "Enter" && lookup()} placeholder="Ex.: 10300 ou 5702017153186" inputMode="numeric" autoComplete="off" /><kbd>ENTER</kbd></div><button className="search-button" onClick={lookup}>Pesquisar</button></div>
            <div className="divider"><span>ou</span></div>
            <button className="scanner-button" onClick={() => { setQuery("5702016370799"); setTimeout(() => inputRef.current?.focus(), 30); }}><span className="scan-corners">▦</span><strong>Ler com scanner</strong><small>O leitor envia o EAN automaticamente</small></button>
            <p className="scanner-tip"><b>i</b> Leitores USB/Bluetooth funcionam como teclado: basta apontar e ler.</p>
          </>}
          {selected && mode !== "entrada" && mode !== "saida" && <article className="set-result"><div className="set-art" style={{ background: selected.color }}><BrickMark /><span>#{selected.code}</span></div><div className="set-copy"><p>{selected.theme} · {selected.year}</p><h3>{selected.name}</h3><div className="set-meta"><span><small>PEÇAS</small><b>{selected.pieces.toLocaleString("pt-PT")}</b></span><span><small>STOCK</small><b>{selected.stock} un.</b></span><span><small>LOCAL</small><b>{selected.location}</b></span></div></div><button className={`confirm-button ${mode}`} onClick={register}>{mode === "lote" ? "Adicionar ao lote" : "Abrir ficha"} <span>→</span></button></article>}
        </section>}
      </section>
    </main>
  );
}
