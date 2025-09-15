// ===== Imports
import { app, db } from './firebase-config.js';
import {
  doc, setDoc, updateDoc, onSnapshot,
  getDoc, getDocFromServer,
  serverTimestamp, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ===== Estado
let objetivo = 0;
let inicioProduccion = null;
let authed = false;
let unsubscribe = null;
let lastSnap = { parciales:{}, updatedAt:null };
let session = 1;

// ===== Refs UI
const saborSelect   = document.getElementById('sabor');
const formatoSelect = document.getElementById('formato');
const turnoSelect   = document.getElementById('turno');
const operadorSelect= document.getElementById('operador');

const objetivoInput      = document.getElementById('objetivo');
const guardarObjetivoBtn = document.getElementById('guardarObjetivoBtn');

const lblEstado      = document.getElementById('lblEstado');
const panelObjetivo  = document.getElementById('panelObjetivo');
const resumenDiv     = document.getElementById('resumen');
const ctxSabor       = document.getElementById('ctxSabor');
const ctxFormato     = document.getElementById('ctxFormato');

const objetivoMostrar = document.getElementById('objetivoMostrar');
const acumuladoSpan   = document.getElementById('acumulado');
const faltanteSpan    = document.getElementById('faltante');
const inicioSpan      = document.getElementById('inicio');

const parcialInput     = document.getElementById('parcialInput');
const agregarParcialBtn= document.getElementById('agregarParcialBtn');
const resetBtn         = document.getElementById('resetBtn');
const listaParciales   = document.getElementById('listaParciales');
const barraProgreso    = document.getElementById('barraProgreso');

// ===== Helpers
const getText = (sel)=> sel?.options?.[sel.selectedIndex]?.text?.trim() || sel?.value || '';
function BA_YYYYMMDD(){
  const fmt = new Intl.DateTimeFormat('es-AR',{ timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit'});
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const safe = s => (s && String(s).trim()) ? String(s).replace(/[^\w-]+/g,'_') : 'ND';
function turnoKey(){
  const t = getText(turnoSelect); const m = t.match(/([ABCD])$/i);
  return m ? m[1].toUpperCase() : safe(t);
}
function docId(){ return `${BA_YYYYMMDD()}__${safe(getText(saborSelect))}_${safe(getText(formatoSelect))}`; }
function refActual(){ return doc(db, 'produccion', docId()); }
function setEstado(t){ if (lblEstado) lblEstado.textContent = t; }
function fmt(ts){ const d=new Date(ts),p=n=>String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// ===== Auth
async function initAuth(){
  const auth = getAuth(app);
  return new Promise(res=>{
    onAuthStateChanged(auth, async user=>{
      if (user){ authed=true; subscribe(); res(); }
      else { try{ await signInAnonymously(auth); } catch(e){ authed=false; alert('Habilitá Anonymous en Firebase Auth'); res(); } }
    });
  });
}

// ===== Server-first (solo lectura)
async function getFreshData(){
  const ref = refActual();
  let snap;
  try { snap = await getDocFromServer(ref); }
  catch { snap = await getDoc(ref); }
  return snap?.exists() ? (snap.data() || {}) : null;
}

// ===== Suscripción
function subscribe(){
  if (!authed) return;
  if (unsubscribe) { unsubscribe(); unsubscribe=null; }

  getFreshData().finally(()=>{
    const ref = refActual();
    unsubscribe = onSnapshot(ref, { includeMetadataChanges:true }, snap=>{
      if (!snap.exists()){
        // No hay doc → UI en modo “nuevo objetivo”
        objetivo = 0;
        inicioProduccion = null;
        lastSnap = { parciales:{}, updatedAt:null };
        pintar();
        return;
      }
      const data = snap.data() || {};
      lastSnap = data;
      objetivo = Number(data.objetivo || 0);
      inicioProduccion = data.inicio || null;
      pintar();

      if (snap.metadata.hasPendingWrites) setEstado('Enviando cambios…');
      else if (snap.metadata.fromCache)  setEstado('Sincronizando…');
      else                               setEstado('Conectado');
    }, err=>{ console.error(err); setEstado('Error de conexión'); });
  });
}

// ===== Pintar UI
function pintar(){
  const sabor=getText(saborSelect), formato=getText(formatoSelect);
  const tieneObj = objetivo>0;

  panelObjetivo.style.display = tieneObj ? 'none':'block';
  resumenDiv.style.display    = tieneObj ? 'block':'none';

  if (tieneObj){
    ctxSabor.textContent = `Sabor: ${sabor}`;
    ctxFormato.textContent = `Formato: ${formato}`;
    document.getElementById('contexto').style.display = 'flex';
  } else {
    document.getElementById('contexto').style.display = 'none';
    objetivoInput.value = '';
  }

  objetivoMostrar.textContent = (objetivo||0).toLocaleString('es-AR');

  const parcialesByTurno = lastSnap.parciales || {};
  const items = [];
  Object.entries(parcialesByTurno).forEach(([k,arr])=>{
    (Array.isArray(arr)?arr:[]).forEach(p=> items.push({k,p}));
  });
  items.sort((a,b)=> (a.p?.ts||0) - (b.p?.ts||0));

  const acumulado = items.reduce((acc,it)=> acc + (parseInt(it.p?.cantidad)||0), 0);
  acumuladoSpan.textContent = acumulado.toLocaleString('es-AR');
  faltanteSpan.textContent  = Math.max((objetivo||0)-acumulado,0).toLocaleString('es-AR');
  inicioSpan.textContent    = inicioProduccion ? fmt(inicioProduccion) : '—';

  listaParciales.innerHTML = '';
  items.slice().reverse().forEach((it,idx)=>{
    const tsTxt = it.p?.ts ? fmt(it.p.ts) : '—';
    const opTxt = it.p?.op ? ` — ${it.p.op}` : '';
    const li = document.createElement('li');
    li.textContent = `#${idx+1} — ${it.p.cantidad?.toLocaleString('es-AR')} — Turno ${it.k}${opTxt} — ${tsTxt}`;
    listaParciales.appendChild(li);
  });

  let pct = 0;
  if (objetivo>0) pct = Math.round( (acumulado / objetivo) * 100 );
  pct = Math.max(0, Math.min(100, pct));
  barraProgreso.style.width = `${pct}%`;
  barraProgreso.textContent = pct ? `${pct}%` : '';
  barraProgreso.style.background = pct<30 ? '#dc3545' : (pct<70 ? '#ffc107' : '#28a745');
}

// ===== Acciones
guardarObjetivoBtn.addEventListener('click', async ()=>{
  if (!authed) return;
  const val = parseInt(String(objetivoInput.value).replace(/\D/g,''));
  if (!val || val<=0){ alert('Ingresá un objetivo válido (>0)'); return; }

  const ref = refActual();
  objetivo = val;
  if (!inicioProduccion) inicioProduccion = Date.now();

  await setDoc(ref, {
    objetivo,
    inicio: inicioProduccion,
    updatedAt: serverTimestamp(),
    session: session || 1,
    // conservamos parciales existentes si los hubiera
  }, { merge:true });
});

agregarParcialBtn.addEventListener('click', async ()=>{
  if (!authed) return;
  const val = parseInt(String(parcialInput.value).replace(/\D/g,''));
  if (!val || val<=0){ alert('Ingresá un número válido (>0)'); return; }

  // (opcional) impedir superar objetivo
  const acumulado = Object.values(lastSnap.parciales||{}).flat()
    .reduce((a,p)=>a+(parseInt(p?.cantidad)||0),0);
  const restante = Math.max((objetivo||0)-acumulado,0);
  if (restante && val>restante){
    if (!confirm(`Este parcial (${val.toLocaleString('es-AR')}) supera el restante (${restante.toLocaleString('es-AR')}). ¿Agregar igual?`)) return;
  }

  const ref = refActual();
  const k = turnoKey();
  const item = { cantidad: val, ts: Date.now(), op: getText(operadorSelect) };

  try{
    await updateDoc(ref, {
      [`parciales.${k}`]: arrayUnion(item), // append atómico → no pisa a otros
      updatedAt: serverTimestamp()
    });
    parcialInput.value='';
  }catch(e){
    if (e.code === 'not-found'){
      await setDoc(ref, {
        objetivo: objetivo||0,
        inicio: inicioProduccion||null,
        session: session||1,
        parciales: { [k]: [item] },
        updatedAt: serverTimestamp()
      }, { merge:true });
      parcialInput.value='';
    }else{
      console.error(e); alert(`No se pudo agregar el parcial: ${e.message||e}`);
    }
  }
});

resetBtn.addEventListener('click', async ()=>{
  if (!authed) return;
  if (!confirm('¿Reiniciar objetivo y parciales de este combo?')) return;

  const ref = refActual();
  await setDoc(ref, {
    objetivo: 0,
    parciales: {},
    inicio: null,
    session: increment(1),
    resetAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge:true });
});

// ===== Selectores
[saborSelect, formatoSelect, turnoSelect].forEach(sel=>{
  sel.addEventListener('change', ()=>{ subscribe(); });
});

// ===== Init
(async ()=>{
  setEstado('Conectando…');
  await initAuth();
  subscribe();
})();
