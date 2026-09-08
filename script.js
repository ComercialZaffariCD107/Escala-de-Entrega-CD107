// ============================================================
// Escala de Entrega — CD Nova Santa Rita
// Planilha colaborativa (Firestore) com fallback em modo local
// (localStorage) enquanto o Firebase não estiver configurado.
// Navegação, seleção de intervalo, copiar/colar e edição no
// estilo Excel.
// ============================================================

const COLS_ORDER = [
  "loja","pav","lojaNome","tipoCarga","qtdPallet","doca","peso",
  "observacao","master","cargasInformadas","status","liberacao",
  "tipoVeiculo","frota","nPedido","rateio","placaCavalo","motorista"
];
const SELECT_FIELDS = new Set(["observacao","status","tipoVeiculo","frota"]);
const EMPTY_MARKER = "__VAZIAS__";
const OBSERVACAO_OPTS = ["", "PICKING", "AGRUPADA", "SORTER", "PALETE BOX"];
const STATUS_OPTS = ["", "PENDENTE", "OK"];
const TIPO_VEICULO_OPTS = ["", "RODOTREM", "SIDER", "CARRETA", "BITRUCK", "TRUCK"];
const FROTA_OPTS = ["", "TRANSPIO", "DARCHEL", "TSG", "CATTO", "G10"];
const LOCAL_KEY = "escala_expedicao_local_v1";
const DIA_PADRAO = "2026-09-01";
const ACTIVE_DIA_KEY = "escala_expedicao_active_dia";

let rowsCache = [];
let metaCache = { dias: [DIA_PADRAO] };
let diasCache = [DIA_PADRAO];
let activeDia = localStorage.getItem(ACTIVE_DIA_KEY) || DIA_PADRAO;
let focusedKey = null;
let selectedIds = new Set();      // linhas marcadas p/ excluir (checkbox)
let visibleRowIds = [];           // ids das linhas de dados visíveis, na ordem renderizada
let columnFilters = {};           // { field: valor ou EMPTY_MARKER }
let selRangeAnchor = null;        // {rowpos, colpos}
let selRangeActive = null;        // {rowpos, colpos}
let internalClipboard = "";

const sheetBody = document.getElementById("sheetBody");
const filterRow = document.getElementById("filterRow");
const saveIndicator = document.getElementById("saveIndicator");
const connStatus = document.getElementById("connStatus");
const connLabel = document.getElementById("connLabel");
const searchBox = document.getElementById("searchBox");
const btnDeleteSelected = document.getElementById("btnDeleteSelected");
const dayTabsEl = document.getElementById("dayTabs");
const activeDiaLabel = document.getElementById("activeDiaLabel");

// dia efetivo de uma linha (linhas antigas, salvas antes das abas
// existirem, não têm o campo "dia" — tratamos como DIA_PADRAO)
function diaDe(row){ return row.dia || DIA_PADRAO; }

function fmtDiaLabel(iso){
  const partes = String(iso).split("-");
  if(partes.length !== 3) return iso;
  return `${partes[2]}.${partes[1]}`;
}

// ------------------------------------------------------------
// DADOS INICIAIS (PV 1)
// ------------------------------------------------------------
function dadosIniciais(){
  const linha = (loja,qtd,doca,peso,obs,cargas) => ({
    loja: String(loja), pav:"PV1", lojaNome:`Loja ${String(loja).padStart(2,"0")} - Passo Fundo`,
    tipoCarga:"MERCEARIA", qtdPallet: qtd||"", doca: doca||"", peso: peso||"",
    observacao: obs||"", master:"", cargasInformadas: cargas||"",
    status:"", liberacao:"", tipoVeiculo:"", frota:"",
    nPedido:"", rateio:"", placaCavalo:"", motorista:"", dia: DIA_PADRAO
  });
  return [
    {isGroup:true, groupLabel:"CARGAS DO PV 1", dia: DIA_PADRAO},
    linha(1,"","",1544,"AGRUPADA","AGRUPADA"),
    linha(1,"","",1103,"SORTER","SORTER"),
    linha(1,1,55,600,"PICKING","1600378"),
    linha(1,1,55,55,"PICKING","1598142"),
    linha(2,1,54,100,"PICKING","1600379"),
    linha(2,1,54,37,"PICKING","1598143"),
    linha(2,"","",1821,"AGRUPADA","AGRUPADA"),
    linha(2,"","",593,"SORTER","SORTER"),
    linha(2,1,54,1090,"PALETE BOX","1598105"),
    linha(5,1,58,50,"PICKING","1600380"),
    linha(5,1,58,74,"PICKING","1598144"),
    linha(5,1,58,1090,"PALETE BOX","1598106"),
    linha(5,"","",1329,"AGRUPADA","AGRUPADA"),
    linha(5,"","",514,"SORTER","SORTER"),
    linha(8,1,56,100,"PICKING","1600385"),
    linha(8,1,56,37,"PICKING","1598150"),
    linha(8,"","",1281,"AGRUPADA","AGRUPADA"),
    linha(8,"","",604,"SORTER","SORTER"),
    linha(9,1,57,100,"PICKING","1600381"),
    linha(9,1,57,92,"PICKING","1598145"),
  ].map((d,i)=>({...d, ordem:i}));
}

// ============================================================
// CAMADA DE DADOS — Firestore (colaborativo) ou local (fallback)
// ============================================================
let onRowsChanged = () => {};
let onMetaChanged = () => {};

function uid(){ return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function localLoad(){
  try{ const raw = localStorage.getItem(LOCAL_KEY); if(raw) return JSON.parse(raw); }
  catch(e){ console.error(e); }
  return null;
}
function localSave(state){ localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); }
function localState(){
  let s = localLoad();
  if(!s){
    s = { rows: dadosIniciais().map(r=>({...r, id: uid()})), meta: { dias: [DIA_PADRAO] } };
    localSave(s);
  }
  if(!s.meta) s.meta = { dias: [DIA_PADRAO] };
  if(!Array.isArray(s.meta.dias) || !s.meta.dias.length) s.meta.dias = [DIA_PADRAO];
  return s;
}

const localBackend = {
  init(){
    const s = localState();
    rowsCache = s.rows; metaCache = s.meta;
    onRowsChanged(rowsCache); onMetaChanged(metaCache);
    connStatus.className = "conn-status online";
    connLabel.textContent = "modo local · salvo neste navegador";
  },
  addRow(){
    const s = localState();
    const maxOrdem = s.rows.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    s.rows.push({
      id: uid(), loja:"", pav:"", lojaNome:"", tipoCarga:"", qtdPallet:"", doca:"", peso:"",
      observacao:"", master:"", cargasInformadas:"", status:"", liberacao:"",
      tipoVeiculo:"", frota:"", nPedido:"", rateio:"", placaCavalo:"", motorista:"",
      dia: activeDia, ordem: maxOrdem + 1
    });
    localSave(s); rowsCache = s.rows; onRowsChanged(rowsCache);
  },
  addGroup(){
    const s = localState();
    const maxOrdem = s.rows.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    s.rows.push({ id: uid(), isGroup:true, groupLabel:"NOVO GRUPO", dia: activeDia, ordem: maxOrdem + 1 });
    localSave(s); rowsCache = s.rows; onRowsChanged(rowsCache);
  },
  commitField(id, field, value){
    const s = localState();
    const row = s.rows.find(r=>r.id===id);
    if(row){ row[field] = value; localSave(s); rowsCache = s.rows; }
    saveIndicator.textContent = "Tudo salvo"; saveIndicator.className = "";
  },
  deleteRows(ids){
    const s = localState();
    s.rows = s.rows.filter(r=> !ids.has(r.id));
    localSave(s); rowsCache = s.rows; onRowsChanged(rowsCache);
  },
  addDia(dateStr){
    const s = localState();
    if(!s.meta.dias.includes(dateStr)) s.meta.dias.push(dateStr);
    s.meta.dias.sort();
    localSave(s); metaCache = s.meta; onMetaChanged(metaCache);
    setActiveDia(dateStr);
  },
  removeDia(dateStr){
    const s = localState();
    s.meta.dias = s.meta.dias.filter(d=> d!==dateStr);
    if(!s.meta.dias.length) s.meta.dias = [DIA_PADRAO];
    s.rows = s.rows.filter(r=> diaDe(r) !== dateStr);
    localSave(s); rowsCache = s.rows; metaCache = s.meta;
    onRowsChanged(rowsCache); onMetaChanged(metaCache);
  }
};

const firestoreBackend = {
  async init(){
    try{
      const snap = await db.collection(COLLECTION_LINHAS).limit(1).get();
      if(snap.empty){
        const batch = db.batch();
        dadosIniciais().forEach(d=>{
          const ref = db.collection(COLLECTION_LINHAS).doc();
          batch.set(ref, d);
        });
        batch.set(db.doc(DOC_META), { dias: [DIA_PADRAO] }, {merge:true});
        await batch.commit();
      }
    }catch(e){ console.error("Erro ao semear dados:", e); }

    db.collection(COLLECTION_LINHAS).orderBy("ordem").onSnapshot(snap=>{
      rowsCache = snap.docs.map(d=>({id:d.id, ...d.data()}));
      onRowsChanged(rowsCache);
      const online = !snap.metadata.fromCache;
      connStatus.className = "conn-status " + (online ? "online" : "offline");
      connLabel.textContent = online ? "sincronizado" : "sem conexão · salvando localmente";
    }, err=>{
      console.error("Erro no listener:", err);
      connStatus.className = "conn-status offline";
      connLabel.textContent = "erro de conexão";
    });

    db.doc(DOC_META).onSnapshot(snap=>{
      const data = snap.data();
      if(data){
        if(!Array.isArray(data.dias) || !data.dias.length) data.dias = [DIA_PADRAO];
        metaCache = data; onMetaChanged(metaCache);
      }
    });
  },
  addRow(){
    const maxOrdem = rowsCache.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    db.collection(COLLECTION_LINHAS).add({
      loja:"", pav:"", lojaNome:"", tipoCarga:"", qtdPallet:"", doca:"", peso:"",
      observacao:"", master:"", cargasInformadas:"", status:"", liberacao:"",
      tipoVeiculo:"", frota:"", nPedido:"", rateio:"", placaCavalo:"", motorista:"",
      dia: activeDia, ordem: maxOrdem + 1
    });
  },
  addGroup(){
    const maxOrdem = rowsCache.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    db.collection(COLLECTION_LINHAS).add({ isGroup:true, groupLabel:"NOVO GRUPO", dia: activeDia, ordem: maxOrdem + 1 });
  },
  commitField(id, field, value){
    saveIndicator.textContent = "Salvando…"; saveIndicator.className = "saving";
    db.collection(COLLECTION_LINHAS).doc(id).update({[field]: value})
      .then(()=>{ saveIndicator.textContent = "Tudo salvo"; saveIndicator.className = ""; })
      .catch(err=>{
        console.error("Erro ao salvar:", err);
        saveIndicator.textContent = "Erro ao salvar"; saveIndicator.className = "error";
      });
  },
  deleteRows(ids){
    const batch = db.batch();
    ids.forEach(id=> batch.delete(db.collection(COLLECTION_LINHAS).doc(id)));
    return batch.commit();
  },
  async addDia(dateStr){
    const dias = Array.isArray(metaCache.dias) ? [...metaCache.dias] : [DIA_PADRAO];
    if(!dias.includes(dateStr)) dias.push(dateStr);
    dias.sort();
    await db.doc(DOC_META).set({ dias }, {merge:true});
    setActiveDia(dateStr);
  },
  async removeDia(dateStr){
    const dias = (Array.isArray(metaCache.dias) ? metaCache.dias : [DIA_PADRAO])
      .filter(d=> d!==dateStr);
    const batch = db.batch();
    batch.set(db.doc(DOC_META), { dias: dias.length ? dias : [DIA_PADRAO] }, {merge:true});
    rowsCache.filter(r=> diaDe(r) === dateStr).forEach(r=>{
      batch.delete(db.collection(COLLECTION_LINHAS).doc(r.id));
    });
    await batch.commit();
  }
};

const backend = isFirebaseConfigured ? firestoreBackend : localBackend;

// ============================================================
// SELEÇÃO DE CÉLULA / INTERVALO (estilo Excel)
// ============================================================
function setSingleSelection(rowpos, colpos){
  selRangeAnchor = {rowpos, colpos};
  selRangeActive = {rowpos, colpos};
  updateRangeHighlight();
}
function extendSelection(rowpos, colpos){
  if(!selRangeAnchor) selRangeAnchor = {rowpos, colpos};
  selRangeActive = {rowpos, colpos};
  updateRangeHighlight();
}
function getRangeBounds(){
  if(!selRangeAnchor || !selRangeActive) return null;
  return {
    r0: Math.min(selRangeAnchor.rowpos, selRangeActive.rowpos),
    r1: Math.max(selRangeAnchor.rowpos, selRangeActive.rowpos),
    c0: Math.min(selRangeAnchor.colpos, selRangeActive.colpos),
    c1: Math.max(selRangeAnchor.colpos, selRangeActive.colpos),
  };
}
function updateRangeHighlight(){
  const b = getRangeBounds();
  const multi = b && (b.r0!==b.r1 || b.c0!==b.c1);
  sheetBody.querySelectorAll(".cell[data-rowpos]").forEach(el=>{
    const r = parseInt(el.dataset.rowpos,10), c = parseInt(el.dataset.colpos,10);
    const inRange = multi && r>=b.r0 && r<=b.r1 && c>=b.c0 && c<=b.c1;
    el.classList.toggle("in-range", inRange);
  });
}

function focusGridCell(rowpos, colpos){
  if(rowpos < 0 || rowpos >= visibleRowIds.length) return false;
  if(colpos < 0 || colpos >= COLS_ORDER.length) return false;
  const el = sheetBody.querySelector(`[data-rowpos="${rowpos}"][data-colpos="${colpos}"]`);
  if(el){ setSingleSelection(rowpos, colpos); el.focus({preventScroll:true}); return true; }
  return false;
}
function focusGridCellExtend(rowpos, colpos){
  if(rowpos < 0 || rowpos >= visibleRowIds.length) return false;
  if(colpos < 0 || colpos >= COLS_ORDER.length) return false;
  const el = sheetBody.querySelector(`[data-rowpos="${rowpos}"][data-colpos="${colpos}"]`);
  if(el){ extendSelection(rowpos, colpos); el.focus({preventScroll:true}); return true; }
  return false;
}

// ============================================================
// COPIAR / RECORTAR / COLAR
// ============================================================
function fieldOptions(field){
  if(field==="observacao") return OBSERVACAO_OPTS;
  if(field==="status") return STATUS_OPTS;
  if(field==="tipoVeiculo") return TIPO_VEICULO_OPTS;
  if(field==="frota") return FROTA_OPTS;
  return null;
}

function cellDisplayValue(rowId, field){
  const row = rowsCache.find(r=>r.id===rowId);
  if(!row) return "";
  let v = row[field] ?? "";
  if(field === "peso") v = fmtPeso(v);
  return String(v);
}

function setCellValue(rowId, field, rawValue){
  let value;
  const opts = fieldOptions(field);
  if(opts){
    const upper = String(rawValue).trim().toUpperCase();
    const match = opts.find(o=>o && o.toUpperCase()===upper);
    value = match || "";
  } else if(field === "peso"){
    const cleaned = String(rawValue).trim().replace(/\./g,"").replace(",", ".");
    value = (cleaned !== "" && !isNaN(cleaned)) ? Number(cleaned) : String(rawValue).trim();
  } else {
    value = String(rawValue).trim();
  }
  backend.commitField(rowId, field, value);
}

function copyRange(cut){
  const b = getRangeBounds();
  if(!b) return;
  const lines = [];
  for(let r=b.r0; r<=b.r1; r++){
    const rowId = visibleRowIds[r];
    if(!rowId) continue;
    const cols = [];
    for(let c=b.c0; c<=b.c1; c++) cols.push(cellDisplayValue(rowId, COLS_ORDER[c]));
    lines.push(cols.join("\t"));
  }
  const text = lines.join("\n");
  internalClipboard = text;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).catch(()=>{});
  }
  if(cut){
    for(let r=b.r0;r<=b.r1;r++){
      const rowId = visibleRowIds[r];
      if(!rowId) continue;
      for(let c=b.c0;c<=b.c1;c++) setCellValue(rowId, COLS_ORDER[c], "");
    }
  }
}

function clearRange(){
  const b = getRangeBounds();
  if(!b) return;
  for(let r=b.r0;r<=b.r1;r++){
    const rowId = visibleRowIds[r];
    if(!rowId) continue;
    for(let c=b.c0;c<=b.c1;c++) setCellValue(rowId, COLS_ORDER[c], "");
  }
}

async function pasteRange(){
  const b = getRangeBounds();
  if(!b) return;
  let text = internalClipboard;
  try{
    if(navigator.clipboard && navigator.clipboard.readText){
      const t = await navigator.clipboard.readText();
      if(t) text = t;
    }
  }catch(e){ /* sem permissão do navegador — usa o que foi copiado dentro da planilha */ }
  if(!text) return;

  const srcLines = text.replace(/\r/g,"").split("\n");
  while(srcLines.length > 1 && srcLines[srcLines.length-1] === "") srcLines.pop();
  const srcRows = srcLines.map(l=>l.split("\t"));
  const srcH = srcRows.length, srcW = Math.max(...srcRows.map(r=>r.length));

  const destH = (b.r1-b.r0+1), destW = (b.c1-b.c0+1);
  const fillH = (srcH===1 && srcW===1) ? destH : srcH;
  const fillW = (srcH===1 && srcW===1) ? destW : srcW;

  for(let i=0;i<fillH;i++){
    const r = b.r0+i;
    const rowId = visibleRowIds[r];
    if(!rowId) continue;
    for(let j=0;j<fillW;j++){
      const c = b.c0+j;
      if(c >= COLS_ORDER.length) continue;
      const val = srcRows[i % srcH][j % srcW] ?? "";
      setCellValue(rowId, COLS_ORDER[c], val);
    }
  }
}

// ============================================================
// EDIÇÃO DE CÉLULA (Enter / duplo clique / Tab / Esc)
// ============================================================
function placeCaretAtEnd(el){
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function enterEdit(el){
  el.dataset.editing = "1";
  el.contentEditable = "true";
  el.focus();
  placeCaretAtEnd(el);
}
function exitEdit(el, commit){
  el.dataset.editing = "0";
  el.contentEditable = "false";
  if(commit) backend.commitField(el.dataset.id, el.dataset.field, el.textContent.trim());
  else el.textContent = el.dataset.original ?? "";
}

function attachGridNav(el){
  el.addEventListener("mousedown", (e)=>{
    const rp = parseInt(el.dataset.rowpos,10), cp = parseInt(el.dataset.colpos,10);
    if(e.shiftKey) extendSelection(rp, cp); else setSingleSelection(rp, cp);
  });

  if(el.tagName === "DIV"){
    el.addEventListener("dblclick", ()=>{ if(el.dataset.editing !== "1") enterEdit(el); });
  }

  el.addEventListener("keydown", (e)=>{
    const editing = el.dataset.editing === "1";
    const rp = parseInt(el.dataset.rowpos, 10);
    const cp = parseInt(el.dataset.colpos, 10);
    const isArrow = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key);

    if(!editing && isArrow){
      e.preventDefault();
      const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
      const [dr, dc] = moves[e.key];
      if(e.shiftKey) focusGridCellExtend(rp+dr, cp+dc);
      else focusGridCell(rp+dr, cp+dc);
      return;
    }

    if(el.tagName === "SELECT") return; // demais teclas: comportamento nativo do dropdown

    if(!editing && e.key === "Tab"){
      e.preventDefault();
      if(e.shiftKey) focusGridCell(rp, cp-1); else focusGridCell(rp, cp+1);
      return;
    }
    if(editing && e.key === "Tab"){
      e.preventDefault();
      exitEdit(el, true);
      if(e.shiftKey) focusGridCell(rp, cp-1); else focusGridCell(rp, cp+1);
      return;
    }

    if(!editing && (e.key === "Delete" || e.key === "Backspace")){
      e.preventDefault();
      clearRange();
      return;
    }

    if(e.key === "Enter"){
      e.preventDefault();
      if(!editing) enterEdit(el);
      else { exitEdit(el, true); focusGridCell(rp+1, cp); }
      return;
    }

    if(e.key === "Escape" && editing){
      e.preventDefault();
      exitEdit(el, false);
      el.blur();
    }
  });

  el.addEventListener("blur", ()=>{
    focusedKey = null;
    if(el.dataset.editing === "1") exitEdit(el, true);
  });
  el.addEventListener("focus", ()=> focusedKey = el.dataset.id+":"+el.dataset.field);
}

// Copiar / recortar / colar — nível de documento (ignora quando o
// usuário está de fato digitando dentro de uma célula, pra não
// atrapalhar o copiar/colar nativo de texto parcial).
document.addEventListener("keydown", (e)=>{
  const el = document.activeElement;
  const isGridCell = el && el.classList && el.classList.contains("cell") && el.dataset.rowpos !== undefined;
  if(!isGridCell) return;
  const isTextEditing = el.dataset.editing === "1";
  const ctrl = e.ctrlKey || e.metaKey;
  if(!ctrl || isTextEditing) return;

  const k = e.key.toLowerCase();
  if(k === "c"){ e.preventDefault(); copyRange(false); }
  else if(k === "x"){ e.preventDefault(); copyRange(true); }
  else if(k === "v"){ e.preventDefault(); pasteRange(); }
});

// ============================================================
// RENDER
// ============================================================
function fmtPeso(v){
  if(v === "" || v === undefined || v === null) return "";
  const n = Number(v);
  if(Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR");
}

function buildSelect(rowId, field, value, opts, rowpos, colpos){
  const sel = document.createElement("select");
  sel.className = "cell";
  sel.dataset.id = rowId;
  sel.dataset.field = field;
  sel.dataset.rowpos = rowpos;
  sel.dataset.colpos = colpos;
  opts.forEach(o=>{
    const op = document.createElement("option");
    op.value = o; op.textContent = o || "—";
    if(o === (value||"")) op.selected = true;
    sel.appendChild(op);
  });
  sel.addEventListener("change", ()=> backend.commitField(rowId, field, sel.value));
  attachGridNav(sel);
  return sel;
}

function buildEditable(rowId, field, value, rowpos, colpos, opts={}){
  const div = document.createElement("div");
  div.className = "cell";
  div.contentEditable = "false";
  div.tabIndex = 0;
  div.dataset.id = rowId;
  div.dataset.field = field;
  div.dataset.editing = "0";
  if(rowpos !== undefined){ div.dataset.rowpos = rowpos; div.dataset.colpos = colpos; }
  const text = opts.format ? opts.format(value) : (value ?? "");
  div.textContent = text;
  div.dataset.original = text;
  attachGridNav(div);
  return div;
}

function render(){
  const filtro = searchBox.value.trim().toLowerCase();
  sheetBody.innerHTML = "";
  visibleRowIds = [];

  rowsCache.forEach(row=>{
    if(diaDe(row) !== activeDia) return;

    if(row.isGroup){
      const tr = document.createElement("tr");
      tr.className = "group-row";
      const td = document.createElement("td");
      td.colSpan = 19;
      td.appendChild(buildEditable(row.id, "groupLabel", row.groupLabel));
      tr.appendChild(td);
      sheetBody.appendChild(tr);
      return;
    }

    if(filtro){
      const haystack = [row.lojaNome,row.master,row.cargasInformadas,row.observacao,row.placaCavalo,row.motorista,row.nPedido]
        .join(" ").toLowerCase();
      if(!haystack.includes(filtro)) return;
    }
    for(const f in columnFilters){
      const wanted = columnFilters[f];
      if(!wanted) continue;
      const cellVal = String(row[f] ?? "").trim();
      if(wanted === EMPTY_MARKER){ if(cellVal !== "") return; }
      else if(cellVal !== wanted){ return; }
    }

    const rowpos = visibleRowIds.length;
    visibleRowIds.push(row.id);

    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    tdCheck.className = "colcheck";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "row-check";
    chk.checked = selectedIds.has(row.id);
    chk.addEventListener("change", ()=>{
      if(chk.checked) selectedIds.add(row.id); else selectedIds.delete(row.id);
    });
    tdCheck.appendChild(chk);
    tr.appendChild(tdCheck);

    COLS_ORDER.forEach((field, colpos)=>{
      const td = document.createElement("td");
      if(["loja","qtdPallet","doca","peso","nPedido","rateio"].includes(field)) td.className = "num";
      let el;
      if(field === "observacao") el = buildSelect(row.id,field,row[field],OBSERVACAO_OPTS,rowpos,colpos);
      else if(field === "status") el = buildSelect(row.id,field,row[field],STATUS_OPTS,rowpos,colpos);
      else if(field === "tipoVeiculo") el = buildSelect(row.id,field,row[field],TIPO_VEICULO_OPTS,rowpos,colpos);
      else if(field === "frota") el = buildSelect(row.id,field,row[field],FROTA_OPTS,rowpos,colpos);
      else if(field === "peso") el = buildEditable(row.id,field,row[field],rowpos,colpos,{format:fmtPeso});
      else el = buildEditable(row.id,field,row[field],rowpos,colpos);
      td.appendChild(el);
      tr.appendChild(td);
    });

    sheetBody.appendChild(tr);
  });

  restoreFocus();
  updateCounters();
  updateRangeHighlight();
}

function restoreFocus(){
  if(!focusedKey) return;
  const [id, field] = focusedKey.split(":");
  const el = sheetBody.querySelector(`[data-id="${id}"][data-field="${field}"]`);
  if(el && document.activeElement !== el) el.focus({preventScroll:true});
}

function updateCounters(){
  const rowsDoDia = rowsCache.filter(r=> diaDe(r) === activeDia);
  const countBy = (field) => {
    const map = {};
    rowsDoDia.forEach(r=>{
      if(r.isGroup || !r[field]) return;
      map[r[field]] = (map[r[field]]||0) + 1;
    });
    return map;
  };
  const veiculo = countBy("tipoVeiculo");
  const frota = countBy("frota");
  let totalP = 0, totalT = 0;
  document.querySelectorAll(".frota-row[data-key]").forEach(row=>{
    const key = row.dataset.key;
    const isFrotaCol = FROTA_OPTS.includes(key);
    const n = isFrotaCol ? (frota[key]||0) : (veiculo[key]||0);
    row.querySelector(".frota-count").textContent = n;
    if(isFrotaCol) totalT += n; else totalP += n;
  });
  document.getElementById("totalPropria").textContent = totalP;
  document.getElementById("totalTerceiro").textContent = totalT;
}

// ============================================================
// LINHA DE FILTROS (Ctrl+Shift+L)
// ============================================================
function buildFilterRow(){
  filterRow.innerHTML = "";
  filterRow.appendChild(document.createElement("th"));

  COLS_ORDER.forEach(field=>{
    const th = document.createElement("th");
    const uniques = [...new Set(rowsCache.filter(r=>!r.isGroup && diaDe(r)===activeDia).map(r=> String(r[field] ?? "")).filter(v=>v!==""))].sort();
    const sel = document.createElement("select");
    sel.className = "col-filter";

    const optAll = document.createElement("option");
    optAll.value = ""; optAll.textContent = "Todos";
    sel.appendChild(optAll);

    const optEmpty = document.createElement("option");
    optEmpty.value = EMPTY_MARKER; optEmpty.textContent = "Vazias";
    if(columnFilters[field] === EMPTY_MARKER) optEmpty.selected = true;
    sel.appendChild(optEmpty);

    uniques.forEach(v=>{
      const op = document.createElement("option");
      op.value = v; op.textContent = v;
      if(columnFilters[field] === v) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", ()=>{
      if(sel.value) columnFilters[field] = sel.value; else delete columnFilters[field];
      render();
    });
    th.appendChild(sel);
    filterRow.appendChild(th);
  });
}

document.addEventListener("keydown", (e)=>{
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l"){
    e.preventDefault();
    filterRow.classList.toggle("hidden");
    if(!filterRow.classList.contains("hidden")) buildFilterRow();
  }
});

// ============================================================
// ABAS DE DIAS
// ============================================================
function computeDias(){
  const set = new Set(Array.isArray(metaCache.dias) ? metaCache.dias : []);
  rowsCache.forEach(r=> set.add(diaDe(r)));
  if(!set.size) set.add(DIA_PADRAO);
  diasCache = [...set].sort();
}

function setActiveDia(dateStr){
  activeDia = dateStr;
  localStorage.setItem(ACTIVE_DIA_KEY, activeDia);
  renderDayTabs();
  render();
  if(!filterRow.classList.contains("hidden")) buildFilterRow();
}

function renderDayTabs(){
  if(!diasCache.includes(activeDia)) activeDia = diasCache[0];
  activeDiaLabel.textContent = fmtDiaLabel(activeDia);

  dayTabsEl.innerHTML = "";
  diasCache.forEach(dia=>{
    const btn = document.createElement("button");
    btn.className = "day-tab" + (dia === activeDia ? " active" : "");
    btn.title = dia;

    const label = document.createElement("span");
    label.textContent = fmtDiaLabel(dia);
    btn.appendChild(label);

    const remove = document.createElement("span");
    remove.className = "day-tab-remove";
    remove.textContent = "×";
    remove.title = "Excluir esta aba";
    remove.addEventListener("click", (ev)=>{
      ev.stopPropagation();
      if(diasCache.length <= 1){
        alert("Precisa sobrar pelo menos uma aba.");
        return;
      }
      if(!confirm(`Excluir a aba ${fmtDiaLabel(dia)}? As linhas dela também serão apagadas.`)) return;
      backend.removeDia(dia);
    });
    btn.appendChild(remove);

    btn.addEventListener("click", ()=> setActiveDia(dia));
    dayTabsEl.appendChild(btn);
  });
}

const btnAddDia = document.getElementById("btnAddDia");
const diaPopover = document.getElementById("diaPopover");
const novoDiaInput = document.getElementById("novoDiaInput");

btnAddDia.addEventListener("click", (ev)=>{
  ev.stopPropagation();
  diaPopover.classList.toggle("hidden");
  if(!diaPopover.classList.contains("hidden")){
    // sugere o dia seguinte ao último já cadastrado
    const ultimo = diasCache[diasCache.length - 1];
    const prox = new Date(ultimo + "T00:00:00");
    prox.setDate(prox.getDate() + 1);
    novoDiaInput.value = prox.toISOString().slice(0,10);
    novoDiaInput.focus();
  }
});
document.getElementById("confirmarNovoDia").addEventListener("click", ()=>{
  const val = novoDiaInput.value;
  if(!val) return;
  diaPopover.classList.add("hidden");
  backend.addDia(val);
});
document.addEventListener("click", (ev)=>{
  if(!diaPopover.contains(ev.target) && ev.target !== btnAddDia){
    diaPopover.classList.add("hidden");
  }
});

// ============================================================
// INIT
// ============================================================
onRowsChanged = (rows) => {
  rowsCache = rows;
  computeDias();
  renderDayTabs();
  render();
  if(!filterRow.classList.contains("hidden")) buildFilterRow();
};
onMetaChanged = (meta) => {
  computeDias();
  renderDayTabs();
};

document.getElementById("btnAddRow").addEventListener("click", ()=> backend.addRow());
document.getElementById("btnAddGroup").addEventListener("click", ()=> backend.addGroup());
document.getElementById("btnDeleteSelected").addEventListener("click", ()=>{
  if(selectedIds.size === 0){
    alert("Marque a caixinha da linha (ou linhas) que deseja excluir e clique em \"Excluir linha\" de novo.");
    return;
  }
  if(!confirm(`Excluir ${selectedIds.size} linha(s) selecionada(s)?`)) return;
  backend.deleteRows(selectedIds);
  selectedIds.clear();
});
searchBox.addEventListener("input", render);

backend.init();
