"use client";

import { useMemo, useRef, useState } from "react";

type Mode = "entrada" | "saida" | "consulta";
type LegoSet = { code: string; ean: string; name: string; theme: string; year: number; pieces: number; stock: number; location: string; color: string };

const sets: LegoSet[] = [
  { code: "10300", ean: "5702017153186", name: "Back to the Future Time Machine", theme: "LEGO Icons", year: 2022, pieces: 1872, stock: 1, location: "Vitrine A · 02", color: "#d5e5ef" },
  { code: "21325", ean: "5702016911985", name: "Medieval Blacksmith", theme: "LEGO Ideas", year: 2021, pieces: 2164, stock: 2, location: "Estante C · 03", color: "#e5d2b5" },
  { code: "42143", ean: "5702017159041", name: "Ferrari Daytona SP3", theme: "LEGO Technic", year: 2022, pieces: 3778, stock: 1, location: "Vitrine B · 01", color: "#efc5c5" },
  { code: "75257", ean: "5702016370799", name: "Millennium Falcon", theme: "LEGO Star Wars", year: 2019, pieces: 1353, stock: 3, location: "Estante A · 02", color: "#d4d4d1" },
];

const movements = [
  { type: "Entrada", code: "75257", name: "Millennium Falcon", time: "Hoje, 14:32", qty: "+1" },
  { type: "Saída", code: "10300", name: "Back to the Future", time: "Hoje, 11:15", qty: "−1" },
  { type: "Entrada", code: "21325", name: "Medieval Blacksmith", time: "Ontem, 16:48", qty: "+2" },
];

function BrickMark() { return <span className="brick-mark" aria-hidden="true"><i /><i /><i /><i /></span>; }

export default function Home() {
  const [mode, setMode] = useState<Mode>("entrada");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LegoSet | null>(null);
  const [status, setStatus] = useState("Catálogo sincronizado há 2 min");
  const inputRef = useRef<HTMLInputElement>(null);
  const found = useMemo(() => sets.find(s => s.code === query.trim() || s.ean === query.trim()), [query]);

  function chooseMode(next: Mode) { setMode(next); setSelected(null); setTimeout(() => inputRef.current?.focus(), 50); }
  function lookup() {
    if (found) { setSelected(found); setStatus(`Conjunto ${found.code} encontrado no catálogo`); }
    else { setSelected(null); setStatus(query ? "Código não encontrado. Confirma o número ou EAN." : "Digite ou leia um código para continuar."); }
  }
  function register() {
    if (!selected) return;
    setStatus(`${mode === "entrada" ? "Entrada" : mode === "saida" ? "Saída" : "Consulta"} preparada para ${selected.code}. Ligação ao Google Sheets por configurar.`);
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <a className="brand" href="https://comunidade0937.com/forum/" aria-label="Comunidade 0937">
          <img src="/comunidade-0937-logo.png" alt="Comunidade 0937" />
        </a>
        <nav aria-label="Navegação principal"><a className="active" href="#inventario">Inventário</a><a href="#movimentos">Movimentos</a><a href="#catalogo">Catálogo</a></nav>
        <button className="user-chip" aria-label="Menu do utilizador"><span>MR</span><b>Mário</b></button>
      </header>
      <section className="intro" id="inventario">
        <div><p className="eyebrow">INVENTÁRIO LEGO · COMUNIDADE 0937</p><h1>Olá, Mário.</h1><p>O que queres movimentar hoje?</p></div>
        <div className="sync"><span />{status}</div>
      </section>
      <section className="workspace">
        <aside className="mode-panel">
          <p className="panel-label">TIPO DE MOVIMENTO</p>
          {(["entrada", "saida", "consulta"] as Mode[]).map(item => <button key={item} onClick={() => chooseMode(item)} className={`mode-button ${mode === item ? "selected" : ""}`}><span className={`mode-icon ${item}`}>{item === "entrada" ? "↘" : item === "saida" ? "↗" : "⌕"}</span><span><strong>{item === "entrada" ? "Dar entrada" : item === "saida" ? "Dar saída" : "Consultar conjunto"}</strong><small>{item === "entrada" ? "Adicionar ao inventário" : item === "saida" ? "Retirar do inventário" : "Ver ficha e disponibilidade"}</small></span><b>›</b></button>)}
          <div className="sheet-card"><div className="sheet-icon">▦</div><div><small>FONTE DE DADOS</small><strong>Google Sheets</strong><span>Catálogo + Movimentos</span></div><i>Ligação<br/>pendente</i></div>
        </aside>
        <section className="scan-panel">
          <div className="scan-heading"><span className={`big-icon ${mode}`}>{mode === "entrada" ? "↘" : mode === "saida" ? "↗" : "⌕"}</span><div><p>PASSO 1 DE 2</p><h2>{mode === "entrada" ? "Identificar conjunto para entrada" : mode === "saida" ? "Identificar conjunto para saída" : "Consultar conjunto"}</h2></div></div>
          <label className="code-label" htmlFor="lego-code">Código do conjunto ou EAN</label>
          <div className="code-row"><div className="code-input"><span>▥</span><input ref={inputRef} id="lego-code" value={query} onChange={e => { setQuery(e.target.value.replace(/\D/g, "")); setSelected(null); }} onKeyDown={e => e.key === "Enter" && lookup()} placeholder="Ex.: 10300 ou 5702017153186" inputMode="numeric" autoComplete="off" /><kbd>ENTER</kbd></div><button className="search-button" onClick={lookup}>Pesquisar</button></div>
          <div className="divider"><span>ou</span></div>
          <button className="scanner-button" onClick={() => { setQuery("5702016370799"); setTimeout(() => inputRef.current?.focus(), 30); }}><span className="scan-corners">▦</span><strong>Ler com scanner</strong><small>O leitor envia o EAN automaticamente</small></button>
          <p className="scanner-tip"><b>i</b> Leitores USB/Bluetooth funcionam como teclado: basta apontar e ler.</p>
          {selected && <article className="set-result"><div className="set-art" style={{ background: selected.color }}><BrickMark /><span>#{selected.code}</span></div><div className="set-copy"><p>{selected.theme} · {selected.year}</p><h3>{selected.name}</h3><div className="set-meta"><span><small>PEÇAS</small><b>{selected.pieces.toLocaleString("pt-PT")}</b></span><span><small>STOCK</small><b>{selected.stock} un.</b></span><span><small>LOCAL</small><b>{selected.location}</b></span></div></div><button className={`confirm-button ${mode}`} onClick={register}>{mode === "entrada" ? "Continuar entrada" : mode === "saida" ? "Continuar saída" : "Abrir ficha"} <span>→</span></button></article>}
        </section>
      </section>
      <section className="lower-grid" id="movimentos">
        <article className="activity-card"><div className="card-title"><div><p>ATIVIDADE RECENTE</p><h2>Últimos movimentos</h2></div><button>Ver todos →</button></div>{movements.map(m => <div className="movement" key={m.code + m.time}><span className={m.type === "Entrada" ? "in" : "out"}>{m.type === "Entrada" ? "↘" : "↗"}</span><div><strong>{m.code} · {m.name}</strong><small>{m.type} · {m.time}</small></div><b className={m.type === "Entrada" ? "positive" : "negative"}>{m.qty}</b></div>)}</article>
        <article className="stats-card"><p>RESUMO DO INVENTÁRIO</p><div className="stats"><span><small>CONJUNTOS</small><b>247</b></span><span><small>UNIDADES</small><b>318</b></span><span><small>TEMAS</small><b>18</b></span></div><div className="stock-bar"><i /><span>92% catalogado</span></div><small className="updated">Última atualização: hoje, 14:32</small></article>
      </section>
      <footer><BrickMark /><span>Ferramenta de inventário da Comunidade 0937</span><b>Protótipo funcional · Dados de demonstração</b></footer>
    </main>
  );
}
