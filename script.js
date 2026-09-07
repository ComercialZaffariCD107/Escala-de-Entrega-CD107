// ============================================================
// Escala de Entrega — CD Nova Santa Rita
// Planilha colaborativa (Firestore) com fallback em modo local
// (localStorage) enquanto o Firebase não estiver configurado.
// Navegação por teclado no estilo Excel + filtros no cabeçalho.
// ============================================================

const COLS_ORDER = [
  "loja","pav","lojaNome","tipoCarga","qtdPallet","doca","peso",
  "observacao","master","cargasInformadas","status","liberacao",
  "tipoVeiculo","frota","placaCavalo"
];
const SELECT_FIELDS = new Set(["observacao","status","tipoVeiculo","frota"]);
const EMPTY_MARKER = "__VAZIAS__";
const OBSERVACAO_OPTS = ["", "PICKING", "AGRUPADA", "SORTER", "PALETE BOX"];
const STATUS_OPTS = ["", "PENDENTE", "OK"];
const TIPO_VEICULO_OPTS = ["", "RODOTREM", "SIDER", "CARRETA", "BITRUCK", "TRUCK"];
const FROTA_OPTS = ["", "TRANSPIO", "DARCHEL", "TSG", "CATTO", "G10"];
const LOCAL_KEY = "escala_expedicao_local_v1";

let rowsCache = [];
let metaCache = { data: "" };
let focusedKey = null;      // "<rowId>:<field>" — usado p/ manter foco após re-render
let selectedIds = new Set();
let visibleRowIds = [];     // ids das linhas de dados visíveis, na ordem renderizada
let columnFilters = {};     // { field: valorEscolhido }

const sheetBody = document.getElementById("sheetBody");
const filterRow = document.getElementById("filterRow");
const saveIndicator = document.getElementById("saveIndicator");
const connStatus = document.getElementById("connStatus");
const connLabel = document.getElementById("connLabel");
const searchBox = document.getElementById("searchBox");
const btnDeleteSelected = document.getElementById("btnDeleteSelected");

// ------------------------------------------------------------
// DADOS INICIAIS (PV 1)
// ------------------------------------------------------------
function dadosIniciais(){
  const linha = (loja,qtd,doca,peso,obs,cargas) => ({
    loja: String(loja), pav:"PV1", lojaNome:`Loja ${String(loja).padStart(2,"0")} - Passo Fundo`,
    tipoCarga:"MERCEARIA", qtdPallet: qtd||"", doca: doca||"", peso: peso||"",
    observacao: obs||"", master:"", cargasInformadas: cargas||"",
    status:"", liberacao:"", tipoVeiculo:"", frota:"", placaCavalo:""
  });
  return [
    {isGroup:true, groupLabel:"CARGAS DO PV 1"},
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
    s = { rows: dadosIniciais().map(r=>({...r, id: uid()})), meta: { data: "2026-07-01" } };
    localSave(s);
  }
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
      tipoVeiculo:"", frota:"", placaCavalo:"", ordem: maxOrdem + 1
    });
    localSave(s); rowsCache = s.rows; onRowsChanged(rowsCache);
  },
  addGroup(){
    const s = localState();
    const maxOrdem = s.rows.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    s.rows.push({ id: uid(), isGroup:true, groupLabel:"NOVO GRUPO", ordem: maxOrdem + 1 });
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
  setMetaDate(dateStr){
    const s = localState();
    s.meta.data = dateStr; localSave(s); metaCache = s.meta;
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
        batch.set(db.doc(DOC_META), { data: "2026-07-01" }, {merge:true});
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
      if(data){ metaCache = data; onMetaChanged(metaCache); }
    });
  },
  addRow(){
    const maxOrdem = rowsCache.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    db.collection(COLLECTION_LINHAS).add({
      loja:"", pav:"", lojaNome:"", tipoCarga:"", qtdPallet:"", doca:"", peso:"",
      observacao:"", master:"", cargasInformadas:"", status:"", liberacao:"",
      tipoVeiculo:"", frota:"", placaCavalo:"", ordem: maxOrdem + 1
    });
  },
  addGroup(){
    const maxOrdem = rowsCache.reduce((m,r)=>Math.max(m, r.ordem||0), 0);
    db.collection(COLLECTION_LINHAS).add({ isGroup:true, groupLabel:"NOVO GRUPO", ordem: maxOrdem + 1 });
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
  setMetaDate(dateStr){ db.doc(DOC_META).set({data: dateStr}, {merge:true}); }
};

const backend = isFirebaseConfigured ? firestoreBackend : localBackend;

// ============================================================
// NAVEGAÇÃO ESTILO EXCEL
// ============================================================
function focusGridCell(rowpos, colpos){
  if(rowpos < 0 || rowpos >= visibleRowIds.length) return false;
  if(colpos < 0 || colpos >= COLS_ORDER.length) return false;
  const el = sheetBody.querySelector(`[data-rowpos="${rowpos}"][data-colpos="${colpos}"]`);
  if(el){ el.focus({preventScroll:true}); return true; }
  return false;
}

function attachGridNav(el){
  el.addEventListener("keydown", (e)=>{
    const editing = el.dataset.editing === "1";
    const rp = parseInt(el.dataset.rowpos, 10);
    const cp = parseInt(el.dataset.colpos, 10);

    if(!editing && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)){
      e.preventDefault();
      if(e.key === "ArrowUp") focusGridCell(rp-1, cp);
      else if(e.key === "ArrowDown") focusGridCell(rp+1, cp);
      else if(e.key === "ArrowLeft") focusGridCell(rp, cp-1);
      else if(e.key === "ArrowRight") focusGridCell(rp, cp+1);
      return;
    }

    if(el.tagName === "SELECT") return; // demais teclas: comportamento nativo do dropdown

    if(e.key === "Enter"){
      e.preventDefault();
      if(!editing){
        el.dataset.editing = "1";
        el.contentEditable = "true";
        el.focus();
        document.execCommand && placeCaretAtEnd(el);
      } else {
        el.dataset.editing = "0";
        el.contentEditable = "false";
        backend.commitField(el.dataset.id, el.dataset.field, el.textContent.trim());
        focusGridCell(rp+1, cp);
      }
      return;
    }

    if(e.key === "Escape" && editing){
      e.preventDefault();
      el.dataset.editing = "0";
      el.contentEditable = "false";
      el.textContent = el.dataset.original ?? "";
      el.blur();
    }
  });

  el.addEventListener("blur", ()=>{
    focusedKey = null;
    if(el.dataset.editing === "1"){
      el.dataset.editing = "0";
      el.contentEditable = "false";
      backend.commitField(el.dataset.id, el.dataset.field, el.textContent.trim());
    }
  });
  el.addEventListener("focus", ()=> focusedKey = el.dataset.id+":"+el.dataset.field);
}

function placeCaretAtEnd(el){
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

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
    if(row.isGroup){
      const tr = document.createElement("tr");
      tr.className = "group-row";
      const td = document.createElement("td");
      td.colSpan = 16;
      td.appendChild(buildEditable(row.id, "groupLabel", row.groupLabel));
      tr.appendChild(td);
      sheetBody.appendChild(tr);
      return;
    }

    if(filtro){
      const haystack = [row.lojaNome,row.master,row.cargasInformadas,row.observacao,row.placaCavalo]
        .join(" ").toLowerCase();
      if(!haystack.includes(filtro)) return;
    }
    for(const f in columnFilters){
      const wanted = columnFilters[f];
      if(!wanted) continue;
      const cellVal = String(row[f] ?? "").trim();
      if(wanted === EMPTY_MARKER){
        if(cellVal !== "") return;
      } else if(cellVal !== wanted){
        return;
      }
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
      if(["loja","qtdPallet","doca","peso"].includes(field)) td.className = "num";
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
}

function restoreFocus(){
  if(!focusedKey) return;
  const [id, field] = focusedKey.split(":");
  const el = sheetBody.querySelector(`[data-id="${id}"][data-field="${field}"]`);
  if(el && document.activeElement !== el) el.focus({preventScroll:true});
}

function updateCounters(){
  const countBy = (field) => {
    const map = {};
    rowsCache.forEach(r=>{
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
  const thCheck = document.createElement("th");
  filterRow.appendChild(thCheck);

  COLS_ORDER.forEach(field=>{
    const th = document.createElement("th");
    const uniques = [...new Set(rowsCache.filter(r=>!r.isGroup).map(r=> String(r[field] ?? "")).filter(v=>v!==""))].sort();
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
// INIT
// ============================================================
onRowsChanged = (rows) => { rowsCache = rows; render(); if(!filterRow.classList.contains("hidden")) buildFilterRow(); };
onMetaChanged = (meta) => {
  const input = document.getElementById("dataEntrega");
  if(meta && meta.data && document.activeElement !== input) input.value = meta.data;
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
document.getElementById("dataEntrega").addEventListener("change", (e)=> backend.setMetaDate(e.target.value));

backend.init();
