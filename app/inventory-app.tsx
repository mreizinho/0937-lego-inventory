"use client";

import { useMemo, useRef, useState } from "react";
import { IconBrandGoogle, IconChevronRight, IconClipboardList, IconDownload, IconEye, IconFilter, IconLock, IconLogout, IconMenu2, IconPackageExport, IconPackageImport, IconRefresh, IconScan, IconSearch, IconTable, IconX } from "@tabler/icons-react";

type Mode = "entrada" | "saida" | "consulta" | "lote";
type LegoSet = { code: string; ean: string; name: string; theme: string; year: number; pieces: number; stock: number; location: string; color: string };

const sets: LegoSet[] = [
  { code: "10300", ean: "5702017153186", name: "Back to the Future Time Machine", theme: "LEGO Icons", year: 2022, pieces: 1872, stock: 1, location: "Vitrine A · 02", color: "#d5e5ef" },
  { code: "21325", ean: "5702016911985", name: "Medieval Blacksmith", theme: "LEGO Ideas", year: 2021, pieces: 2164, stock: 2, location: "Estante C · 03", color: "#e5d2b5" },
  { code: "42143", ean: "5702017159041", name: "Ferrari Daytona SP3", theme: "LEGO Technic", year: 2022, pieces: 3778, stock: 1, location: "Vitrine B · 01", color: "#efc5c5" },
  { code: "75257", ean: "5702016370799", name: "Millennium Falcon", theme: "LEGO Star Wars", year: 2019, pieces: 1353, stock: 3, location: "Estante A · 02", color: "#d4d4d1" },
];

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

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
  const [status, setStatus] = useState("Catálogo sincronizado há 2 min");
  const inputRef = useRef<HTMLInputElement>(null);
  const found = useMemo(() => sets.find(s => s.code === query.trim() || s.ean === query.trim()), [query]);

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
      {!loggedIn ? <button className="google-login" onClick={() => { setLoggedIn(true); setMenuOpen(false); }}><span><IconBrandGoogle /></span><span><strong>Entrar com Google</strong><small>Aceder ao inventário</small></span></button>
      : <button className="google-login signed-in" onClick={() => { setLoggedIn(false); setMode(null); setMenuOpen(false); setStatus("Sessão terminada"); }}><span><IconLogout /></span><span><strong>Terminar sessão</strong><small>Sessão Google de teste</small></span></button>}
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
          {!loggedIn && <button type="button" className="login-required" onClick={() => setLoggedIn(true)}><IconLock aria-hidden="true" /><span><strong>Inicia sessão para continuar</strong><small>As opções ficam disponíveis após o login com Google.</small></span></button>}
          <div className="options-grid">
            {(["entrada", "saida", "consulta", "lote"] as Mode[]).map(item => <button key={item} disabled={!loggedIn} onClick={() => chooseMode(item)} className={`option-card ${item}`}><span className="mode-option-image"><img src={`${basePath}/options/${item === "consulta" ? "lote" : item === "lote" ? "consultar" : item}.png`} alt="" /></span><span><strong>{item === "entrada" ? "Entrada" : item === "saida" ? "Saida" : item === "consulta" ? "Consultar" : "Modo Lote"}</strong><small>{item === "entrada" ? "Registar set recebido" : item === "saida" ? "Registar set enviado" : item === "consulta" ? "Ver detalhes e stock" : "Scan múltiplo rápido"}</small></span><b>›</b></button>)}
          </div>
        </section> : <section className="scan-panel">
          {mode === "entrada" || mode === "saida" ? <div className="entry-keypad">
            <div className="entry-keypad-title">
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
          {selected && <article className="set-result"><div className="set-art" style={{ background: selected.color }}><BrickMark /><span>#{selected.code}</span></div><div className="set-copy"><p>{selected.theme} · {selected.year}</p><h3>{selected.name}</h3><div className="set-meta"><span><small>PEÇAS</small><b>{selected.pieces.toLocaleString("pt-PT")}</b></span><span><small>STOCK</small><b>{selected.stock} un.</b></span><span><small>LOCAL</small><b>{selected.location}</b></span></div></div><button className={`confirm-button ${mode}`} onClick={register}>{mode === "entrada" ? "Continuar entrada" : mode === "saida" ? "Continuar saída" : mode === "lote" ? "Adicionar ao lote" : "Abrir ficha"} <span>→</span></button></article>}
        </section>}
      </section>
      <footer className="status-bar">
        {mode && <button className="status-back" onClick={() => { setMode(null); setSelected(null); setQuery(""); }}><span aria-hidden="true">←</span> VOLTAR</button>}
        {mode !== "entrada" && mode !== "saida" && <span className="status-message"><span className="status-dot" /> <span>{status}</span></span>}
        <b>Inventário LEGO · Comunidade 0937</b>
      </footer>
    </main>
  );
}
