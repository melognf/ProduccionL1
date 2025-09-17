// ===== app.js (robusto) =====
// Namespace nuevo + validación por VALUE (evita engancharse con el placeholder)
// - Arranca en blanco (no restaura combo al inicio).
// - No lee ni se suscribe hasta que Sabor+Formato+Turno estén elegidos.
// - DocID incluye el TURNO y usa los VALUEs de los <select> (no el texto).
// - Parciales con arrayUnion (sin pisadas entre dispositivos).

// --- Imports ---
import { app, db } from './firebase-config.js';
import {
  doc, setDoc, updateDoc, onSnapshot,
  getDoc, getDocFromServer,
  serverTimestamp, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// === Namespace limpio para datos nuevos ===
const COLLECTION = 'produccionV2'; // cambiar a 'produccion' si querés volver

// --- Estado ---
let objetivo = 0;
let inicioProduccion = null;
let authed = false;
let unsubscribe = null;
let lastSnap = { parciales:{}, updatedAt:null };
let session = 1;

let preferirModoNuevoObjetivo = true;
let modoNuevoDesdeMs = Date.now();
let ultimaAccionFueCambioCombo = false;

// --- Refs UI (pueden ser null; protegemos todo el código) ---
const saborSelect   = document.getElementById('sabor');
const formatoSelect = document.getElementById('formato');
const turnoSelect   = document.getElementById('turno');

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
const contextoBox      = document.getElementById('contexto');

// --- LocalStorage (sólo si hay combo completo) ---
const LS_KEYS = {
  sabor:   'prod.sabor',
  formato: 'prod.formato',
  turno:   'prod.turno',
};

// === Helpers de lectura ===
const getText = (sel)=> sel?.options?.[sel.selectedIndex]?.text?.trim() || '';
const getVal  = (sel)=> (sel?.value ?? '').trim();

// Valida combo completo por VALUE (placeholder tiene value="")
function comboCompleto(){
  return !!(getVal(saborSelect) && getVal(formatoSelect) && getVal(turnoSelect));
}

// Guardar SOLO cuando el combo es válido, y guardar VALUE
function saveSelectors(){
  if (!comboCompleto()) return;
  try {
    localStorage.setItem(LS_KEYS.sabor,   getVal(saborSelect));
    localStorage.setItem(LS_KEYS.formato, getVal(formatoSelect));
    localStorage.setItem(LS_KEYS.turno,   getVal(turnoSelect));
  } catch {}
}

// (opcional) restaurar manualmente por VALUE si quisieras (no se usa en init)
function restoreSelectors(){
  try {
    const s = localStorage.getItem(LS_KEYS.sabor);
    const f = localStorage.getItem(LS_KEYS.formato);
    const t = localStorage.getItem(LS_KEYS.turno);
    if (s && saborSelect)   saborSelect.value   = s;
    if (f && formatoSelect) formatoSelect.value = f;
    if (t && turnoSelect)   turnoSelect.value   = t;
  } catch {}
}

// --- Helpers generales ---
function BA_YYYYMMDD(){
  const fmt = new Intl.DateTimeFormat('es-AR',{
    timeZone:'America/Argentina/Buenos_Aires', year:'numeric', month:'2-digit', day:'2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const safe = s => (s && String(s).trim()) ? String(s).replace(/[^\w-]+/g,'_') : 'ND';

// Normaliza turno a "A/B/C/D" si coincide al final
function turnoKey(){
  const v = getVal(turnoSelect);           // ej: "Turno A"
  const m = v.match(/([ABCD])$/i);
  return m ? m[1].toUpperCase() : (v ? v.replace(/[^\w-]+/g,'_') : 'ND');
}

// ⚠️ DocID por VALUE
function docId(){
  const saborVal   = safe(getVal(saborSelect));
  const formatoVal = safe(getVal(formatoSelect));
  const turnoVal   = turnoKey();
  return `${BA_YYYYMMDD()}__${saborVal}_${formatoVal}__${turnoVal}`;
}
function refActual(){ return doc(db, COLLECTION, docId()); }

function setEstado(t){ if (lblEstado) lblEstado.textContent = t; }
function fmt(tsMs){
  if (!tsMs) return '—';
  const d = new Date(tsMs);
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Convierte posibles tipos (number | string | Firestore Timestamp) a ms number
function toMs(v){
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  // Timestamp de Firestore
  if (typeof v === 'object' && typeof v.toMillis === 'function') {
    try { return v.toMillis(); } catch {}
  }
  return 0;
}

// --- Auth + robustez ---
async function initAuth(){
  const auth = getAuth(app);
  return new Promise(res=>{
    onAuthStateChanged(auth, async user=>{
      if (user){ authed=true; await subscribe(); res(); }
      else {
        try{ await signInAnonymously(auth); authed=true; }
        catch(e){ authed=false; console.error(e); setEstado('Auth anónima deshabilitada'); }
        res();
      }
    });
  });
}
async function ensureAuthReady(){
  if (authed) return true;
  try{
    const auth = getAuth(app);
    await signInAnonymously(auth);
    authed = true;
    return true;
  }catch(e){
    console.error(e);
    setEstado('Error de autenticación');
    alert('No se pudo autenticar (Auth). Revisá que esté habilitada la autenticación anónima.');
    return false;
  }
}

// --- Lectura server-first (NO crea el doc) ---
async function getFreshData(){
  const ref = refActual();
  let snap;
  try { snap = await getDocFromServer(ref); }
  catch { snap = await getDoc(ref); }
  return snap?.exists() ? (snap.data() || {}) : null;
}

// --- Suscripción ---
async function subscribe(){
  if (!authed) return;

  if (!comboCompleto()){
    objetivo = 0; inicioProduccion = null;
    lastSnap = { parciales:{}, updatedAt:null };
    render();
    return;
  }
  if (unsubscribe) { unsubscribe(); unsubscribe=null; }

  // 1) Lectura server-first previa
  const data = await getFreshData();

  // 2) Adopción sólo en refresco inicial (no en cambio de combo)
  if (data && Number(data.objetivo || 0) > 0 && !ultimaAccionFueCambioCombo) {
    preferirModoNuevoObjetivo = false;  // mostrar producción ya
    modoNuevoDesdeMs = 0;               // ignorar filtro “reciente”
  }
  ultimaAccionFueCambioCombo = false;

  // 3) Enganche en tiempo real
  const ref = refActual();
  unsubscribe = onSnapshot(ref, { includeMetadataChanges:true }, snap=>{
    if (!snap.exists()){
      objetivo = 0; inicioProduccion = null;
      lastSnap = { parciales:{}, updatedAt:null };
      render();
      return;
    }
    const d = snap.data() || {};
    lastSnap = d;

    objetivo = Number(d.objetivo || 0);
    inicioProduccion = toMs(d.inicio) || null;

    // Normaliza ts de parciales a ms para orden/mostrar
    const normParciales = {};
    const src = d.parciales || {};
    for (const k of Object.keys(src)) {
      const arr = Array.isArray(src[k]) ? src[k] : [];
      normParciales[k] = arr.map(item => ({
        cantidad: Number(item?.cantidad || 0),
        ts: toMs(item?.ts) || 0
      }));
    }
    lastSnap.parciales = normParciales;

    const vinoDeServidor = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
    const inputVacio     = !objetivoInput || !objetivoInput.value?.trim();
    const updatedAtMs    = toMs(d.updatedAt);
    const objetivoReciente = updatedAtMs > modoNuevoDesdeMs;

    if (preferirModoNuevoObjetivo && objetivo>0 && vinoDeServidor && inputVacio && objetivoReciente){
      preferirModoNuevoObjetivo = false;
    }

    render();

    if (snap.metadata.hasPendingWrites) setEstado('Enviando cambios…');
    else if (snap.metadata.fromCache)  setEstado('Sincronizando…');
    else                               setEstado('Conectado');
  }, err=>{
    console.error(err);
    setEstado('Error de conexión: ' + (err.code || err.message));
  });
}

// --- Render ---
function render(){
  // Para mostrar en la UI usamos el TEXTO visible
  const saborTxt   = getText(saborSelect);
  const formatoTxt = getText(formatoSelect);

  const tieneObj = objetivo>0 && !preferirModoNuevoObjetivo;

  if (panelObjetivo) panelObjetivo.style.display = tieneObj ? 'none':'block';
  if (resumenDiv)    resumenDiv.style.display    = tieneObj ? 'block':'none';
  if (contextoBox)   contextoBox.style.display   = tieneObj ? 'flex' : 'none';

  if (tieneObj){
    if (ctxSabor)   ctxSabor.textContent   = `Sabor: ${saborTxt}`;
    if (ctxFormato) ctxFormato.textContent = `Formato: ${formatoTxt}`;
    if (objetivoInput) objetivoInput.value = '';
  } else {
    if (objetivoInput) objetivoInput.value = '';
  }

  if (objetivoMostrar) objetivoMostrar.textContent = tieneObj ? (objetivo||0).toLocaleString('es-AR') : '0';

  const parcialesByTurno = lastSnap.parciales || {};
  const items = [];
  Object.entries(parcialesByTurno).forEach(([k,arr])=>{
    (Array.isArray(arr)?arr:[]).forEach(p=> items.push({k,p}));
  });
  items.sort((a,b)=> (a.p?.ts||0) - (b.p?.ts||0));

  const acumulado = items.reduce((acc,it)=> acc + (parseInt(it.p?.cantidad)||0), 0);
  if (acumuladoSpan) acumuladoSpan.textContent = acumulado.toLocaleString('es-AR');
  if (faltanteSpan)  faltanteSpan.textContent  = Math.max((objetivo||0)-acumulado,0).toLocaleString('es-AR');
  if (inicioSpan)    inicioSpan.textContent    = inicioProduccion ? fmt(inicioProduccion) : '—';

  if (listaParciales) {
    listaParciales.innerHTML = '';
    items.slice().reverse().forEach((it,idx)=>{
      const tsTxt = it.p?.ts ? fmt(it.p.ts) : '—';
      const li = document.createElement('li');
      li.textContent = `#${idx+1} — ${Number(it.p.cantidad||0).toLocaleString('es-AR')} — Turno ${it.k} — ${tsTxt}`;
      listaParciales.appendChild(li);
    });
  }

  let pct = 0;
  if (tieneObj && objetivo>0) pct = Math.round( (acumulado / objetivo) * 100 );
  pct = Math.max(0, Math.min(100, pct));
  if (barraProgreso) {
    barraProgreso.style.width = `${pct}%`;
    barraProgreso.textContent = pct ? `${pct}%` : '';
    barraProgreso.style.background = pct<30 ? '#dc3545' : (pct<70 ? '#ffc107' : '#28a745');
  }

  // Guardar combo actual sólo si es válido (por VALUE)
  saveSelectors();
}

// --- Acciones ---
// Guardar objetivo
if (guardarObjetivoBtn) {
  guardarObjetivoBtn.addEventListener('click', async ()=>{
    if (!comboCompleto()){ alert('Elegí Sabor, Formato y Turno.'); return; }
    if (!await ensureAuthReady()) return;

    const val = parseInt(String(objetivoInput?.value ?? '').replace(/\D/g,'')) || 0;
    if (!val || val<=0){ alert('Ingresá un objetivo válido (>0)'); objetivoInput?.focus(); return; }

    const ref = refActual();
    objetivo = val;
    if (!inicioProduccion) inicioProduccion = Date.now();

    try{
      setEstado('Guardando objetivo…');
      await setDoc(ref, {
        objetivo,
        inicio: inicioProduccion, // guardamos ms; al leer se normaliza
        updatedAt: serverTimestamp(),
        session: session || 1
      }, { merge:true });

      preferirModoNuevoObjetivo = false;
      setEstado('Objetivo guardado');
      render();
    }catch(e){
      console.error(e);
      setEstado('Error al guardar: ' + (e.code || e.message));
      alert('No se pudo guardar el objetivo:\n' + (e.code || e.message));
    }
  });
}

// Agregar parcial
if (agregarParcialBtn) {
  agregarParcialBtn.addEventListener('click', async ()=>{
    if (!comboCompleto()){ alert('Elegí Sabor, Formato y Turno.'); return; }
    if (!await ensureAuthReady()) return;

    const val = parseInt(String(parcialInput?.value ?? '').replace(/\D/g,'')) || 0;
    if (!val || val<=0){ alert('Ingresá un número válido (>0)'); parcialInput?.focus(); return; }

    const ref = refActual();
    const k = turnoKey();
    const item = { cantidad: val, ts: Date.now() };

    try{
      setEstado('Guardando parcial…');
      await updateDoc(ref, {
        [`parciales.${k}`]: arrayUnion(item),
        updatedAt: serverTimestamp()
      });
      if (parcialInput) parcialInput.value='';
      setEstado('Parcial guardado');
    }catch(e){
      if (e.code === 'not-found'){
        try{
          await setDoc(ref, {
            objetivo: objetivo||0,
            inicio: inicioProduccion||null,
            session: session||1,
            parciales: { [k]: [item] },
            updatedAt: serverTimestamp()
          }, { merge:true });
          if (parcialInput) parcialInput.value='';
          setEstado('Parcial guardado (doc creado)');
        }catch(e2){
          console.error(e2);
          setEstado('Error al crear doc: ' + (e2.code || e2.message));
          alert('No se pudo crear el documento:\n' + (e2.code || e2.message));
        }
      }else{
        console.error(e);
        setEstado('Error al guardar parcial: ' + (e.code || e.message));
        alert('No se pudo agregar el parcial:\n' + (e.code || e.message));
      }
    }
  });
}

// Reset
if (resetBtn) {
  resetBtn.addEventListener('click', async ()=>{
    if (!comboCompleto()){ alert('Elegí Sabor, Formato y Turno.'); return; }
    if (!await ensureAuthReady()) return;
    if (!confirm('¿Reiniciar objetivo y parciales de este combo?')) return;

    const ref = refActual();
    try{
      setEstado('Reiniciando…');
      await setDoc(ref, {
        objetivo: 0,
        parciales: {},
        inicio: null,
        session: increment(1),
        resetAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge:true });

      preferirModoNuevoObjetivo = true;
      modoNuevoDesdeMs = Date.now();
      setEstado('Reiniciado');
      render();
    }catch(e){
      console.error(e);
      setEstado('Error al reiniciar: ' + (e.code || e.message));
      alert('No se pudo reiniciar:\n' + (e.code || e.message));
    }
  });
}

// --- Selectores (cambio de combo) ---
[saborSelect, formatoSelect, turnoSelect].forEach(sel=>{
  if (!sel) return;
  sel.addEventListener('change', async ()=>{
    preferirModoNuevoObjetivo = true;
    modoNuevoDesdeMs = Date.now();
    ultimaAccionFueCambioCombo = true;

    saveSelectors();

    if (!comboCompleto()){
      if (unsubscribe){ unsubscribe(); unsubscribe=null; }
      objetivo = 0; inicioProduccion = null;
      lastSnap = { parciales:{}, updatedAt:null };
      render();
      return;
    }

    if (unsubscribe){ unsubscribe(); unsubscribe=null; }
    await subscribe();
  });
});

// --- Init ---
(async ()=>{
  setEstado('Conectando…');
  // Arranca en blanco: no restauramos selección automáticamente
  await initAuth();
  await subscribe(); // sólo se engancha si el combo está completo
})();
