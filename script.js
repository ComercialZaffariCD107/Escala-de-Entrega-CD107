// ============================================================
// Escala de Entrega — CD Nova Santa Rita
// Planilha colaborativa (Firestore) com fallback em modo local
// (localStorage) enquanto o Firebase não estiver configurado.
// ============================================================

const OBSERVACAO_OPTS = ["", "PICKING", "AGRUPADA", "SORTER", "PALETE BOX"];
const STATUS_OPTS = ["", "PENDENTE", "OK"];
const TIPO_VEICULO_OPTS = ["", "RODOTREM", "SIDER", "CARRETA", "BITRUCK", "TRUCK"];
const FROTA_OPTS = ["", "TRANSPIO", "DARCHEL", "TSG", "CATTO", "G10"];
const LOCAL_KEY = "escala_expedicao_local_v1";

let rowsCache = [];
let metaCache = { data: "" };
let focusedKey = null;
let selectedIds = new Set();

const sheetBody = document.getElementById("sheetBody");
const saveIndicator = document.getElementById("saveIndicator");
const connStatus = document.getElementById("connStatus");
const connLabel = document.getElementById("connLabel");
const searchBox = document.getElementById("searchBox");
const btnDeleteSelected = document.getElementById("btnDeleteSelected");

// ------------------------------------------------------------
// DADOS INICIAIS (PV 1) — usados no seed do Firestore e no modo local
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

// ---------- MODO LOCAL (localStorage, sem Firebase) ----------
function localLoad(){
  try{
    const raw = localStorage.getItem(LOCAL_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ console.error(e); }
  return null;
}
function localSave(state){
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}
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
    rowsCache = s.rows;
    metaCache = s.meta;
    onRowsChanged(rowsCache);
    onMetaChanged(metaCache);
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
    saveIndicator.textContent = "Tudo salvo";
    saveIndicator.className = "";
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

// ---------- MODO FIRESTORE (colaborativo em tempo real) ----------
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
    saveIndicator.textContent = "Salvando…";
    saveIndicator.className = "saving";
    db.collection(COLLECTION_LINHAS).doc(id).update({[field]: value})
      .then(()=>{ saveIndicator.textContent = "Tudo salvo"; saveIndicator.className = ""; })
      .catch(err=>{
        console.error("Erro ao salvar:", err);
        saveIndicator.textContent = "Erro ao salvar";
        saveIndicator.className = "error";
      });
  },
  deleteRows(ids){
    const batch = db.batch();
    ids.forEach(id=> batch.delete(db.collection(COLLECTION_LINHAS).doc(id)));
    return batch.commit();
  },
  setMetaDate(dateStr){
    db.doc(DOC_META).set({data: dateStr}, {merge:true});
  }
};

const backend = isFirebaseConfigured ? firestoreBackend : localBackend;

// ============================================================
// RENDER
// ============================================================
function fmtPeso(v){
  if(v === "" || v === undefined || v === null) return "";
  const n = Number(v);
  if(Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR");
}

function buildSelect(id, field, value, opts){
  const sel = document.createElement("select");
  sel.className = "cell";
  sel.dataset.id = id;
  sel.dataset.field = field;
  opts.forEach(o=>{
    const op = document.createElement("option");
    op.value = o; op.textContent = o || "—";
    if(o === (value||"")) op.selected = true;
    sel.appendChild(op);
  });
  sel.addEventListener("change", ()=> backend.commitField(id, field, sel.value));
  sel.addEventListener("focus", ()=> focusedKey = id+":"+field);
  sel.addEventListener("blur", ()=> focusedKey = null);
  return sel;
}

function buildEditable(id, field, value, opts={}){
  const div = document.createElement("div");
  div.className = "cell";
  div.contentEditable = "true";
  div.dataset.id = id;
  div.dataset.field = field;
  div.textContent = opts.format ? opts.format(value) : (value ?? "");
  div.addEventListener("focus", ()=> focusedKey = id+":"+field);
  div.addEventListener("blur", ()=>{
    focusedKey = null;
    backend.commitField(id, field, div.textContent.trim());
  });
  div.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ e.preventDefault(); div.blur(); }
  });
  return div;
}

function render(){
  const filtro = searchBox.value.trim().toLowerCase();
  sheetBody.innerHTML = "";

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

    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    tdCheck.className = "colcheck";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "row-check";
    chk.checked = selectedIds.has(row.id);
    chk.addEventListener("change", ()=>{
      if(chk.checked) selectedIds.add(row.id); else selectedIds.delete(row.id);
      btnDeleteSelected.disabled = selectedIds.size === 0;
    });
    tdCheck.appendChild(chk);
    tr.appendChild(tdCheck);

    const addCell = (el, extraClass="") => {
      const td = document.createElement("td");
      if(extraClass) td.className = extraClass;
      td.appendChild(el);
      tr.appendChild(td);
    };

    addCell(buildEditable(row.id,"loja",row.loja), "num");
    addCell(buildEditable(row.id,"pav",row.pav));
    addCell(buildEditable(row.id,"lojaNome",row.lojaNome));
    addCell(buildEditable(row.id,"tipoCarga",row.tipoCarga));
    addCell(buildEditable(row.id,"qtdPallet",row.qtdPallet), "num");
    addCell(buildEditable(row.id,"doca",row.doca), "num");
    addCell(buildEditable(row.id,"peso",row.peso,{format:fmtPeso}), "num");
    addCell(buildSelect(row.id,"observacao",row.observacao,OBSERVACAO_OPTS));
    addCell(buildEditable(row.id,"master",row.master));
    addCell(buildEditable(row.id,"cargasInformadas",row.cargasInformadas));
    addCell(buildSelect(row.id,"status",row.status,STATUS_OPTS));
    addCell(buildEditable(row.id,"liberacao",row.liberacao));
    addCell(buildSelect(row.id,"tipoVeiculo",row.tipoVeiculo,TIPO_VEICULO_OPTS));
    addCell(buildSelect(row.id,"frota",row.frota,FROTA_OPTS));
    addCell(buildEditable(row.id,"placaCavalo",row.placaCavalo));

    sheetBody.appendChild(tr);
  });

  restoreFocus();
  updateCounters();
}

function restoreFocus(){
  if(!focusedKey) return;
  const [id, field] = focusedKey.split(":");
  const el = sheetBody.querySelector(`[data-id="${id}"][data-field="${field}"]`);
  if(el && document.activeElement !== el) el.focus();
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
// INIT
// ============================================================
onRowsChanged = (rows) => { rowsCache = rows; render(); };
onMetaChanged = (meta) => {
  const input = document.getElementById("dataEntrega");
  if(meta && meta.data && document.activeElement !== input) input.value = meta.data;
};

document.getElementById("btnAddRow").addEventListener("click", ()=> backend.addRow());
document.getElementById("btnAddGroup").addEventListener("click", ()=> backend.addGroup());
document.getElementById("btnDeleteSelected").addEventListener("click", ()=>{
  if(selectedIds.size === 0) return;
  if(!confirm(`Excluir ${selectedIds.size} linha(s) selecionada(s)?`)) return;
  backend.deleteRows(selectedIds);
  selectedIds.clear();
  btnDeleteSelected.disabled = true;
});
searchBox.addEventListener("input", render);
document.getElementById("dataEntrega").addEventListener("change", (e)=> backend.setMetaDate(e.target.value));

backend.init();
