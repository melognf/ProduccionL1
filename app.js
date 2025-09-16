// ===== app.js =====
// - Arranca en blanco (no restaura combo al inicio).
// - No lee ni se suscribe hasta que Sabor+Formato+Turno estén elegidos.
// - DocID incluye el TURNO para evitar pisadas entre combos.
// - Mantiene tu lógica de "nuevo objetivo" y session++ en reset.
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

// --- Estado ---
let objetivo = 0;
let inicioProduccion = null;
let authed = false;
let unsubscribe = null;
let lastSnap = { parciales:{}, updatedAt:null };
let session = 1;

// “Modo nuevo objetivo” para NO revivir objetivos viejos al cambiar combo.
let preferirModoNuevoObjetivo = true;
let modoNuevoDesdeMs = Date.now();

// Flag para distinguir recarga vs cambio de combo (lo mantenemos por compatibilidad)
let ultimaAccionFueCambioCombo = false;

// --- Refs UI ---
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

// --- LocalStorage (sólo si hay combo completo) ---
const LS_KEYS = {
  sabor:   'prod.sabor',
  formato: 'prod.formato',
  turno:   'prod.turno',
};

function comboCompleto(){
  return !!(getText(saborSelect) && getText(formatoSelect) && getText(turnoSelect));
}
function saveSelectors(){
  if (!comboCompleto()) return; // guardamos sólo combos válidos
  try {
    localStorage.setItem(LS_KEYS.sabor,   getText(saborSelect));
    localStorage.setItem(LS_KEYS.formato, getText(formatoSelect));
    localStorage.setItem(LS_KEYS.turno,   getText(turnoSelect));
  } catch {}
}

// NOTA: NO restauramos al inicio (pedido tuyo). Si querés restaurar manualmente,
// llamá a esta función en algún botón propio.
function restoreSelectors(){
  try {
    const s  = localStorage.getItem(LS_KEYS.sabor);
    const f  = localStorage.getItem(LS_KEYS.formato);
    const t  = localStorage.getItem(LS_KEYS.turno);
    if (s) selectByText(saborSelect, s);
    if (f) selectByText(formatoSelect, f);
    if (t) selectByText(turnoSelect, t);
  } catch {}
}

function selectByText(selectEl, text){
  if (!selectEl || !text) return;
  const norm = v => String(v).trim().toLowerCase();
  const want = norm(text);
  for (let i=0;i<selectEl.options.length;i++){
    if (norm(selectEl.options[i].text) === want || norm(selectEl.options[i].value) === want){
      selectEl.selectedIndex = i;
      break;
    }
  }
}

// --- Helpers ---
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

// ⚠️ CAMBIO CLAVE: ahora el doc incluye el TURNO → evita mezclas entre turnos
function docId(){
  return `${BA_YYYYMMDD()}__${safe(getText(saborSelect))}_${safe(getText(formatoSelect))}__${turnoKey()}`;
}
function refActual(){ return doc(db, 'produccion', docId()); }

function setEstado(t){ if (lblEstado) lblEstado.textContent = t; }
function fmt(ts){ const d=new Date(ts),p=n=>String(n).padStart(2,'0'); return `${p(d.getDate())}/${p(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// --- Auth ---
async function initAuth(){
  const auth = getAuth(app);
  return new Promise(res=>{
    onAuthStateChanged(auth, async user=>{
      if (user){ authed=true; await subscribe(); res(); }
      else {
        try{ await signInAnonymously(auth); }
        catch(e){ authed=false; alert('Habilitá Anonymous en Firebase Auth'); res(); }
      }
    });
  });
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

  // ⛔ No arrancar si no hay combo completo
  if (!comboCompleto()){
    // limpiar estado visual para evitar “revivir” datos
    objetivo = 0;
    inicioProduccion = null;
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
    modoNuevoDesdeMs = 0;               // ignorar filtro “reciente” en este ciclo
  }
  ultimaAccionFueCambioCombo = false;

  // 3) Enganche en tiempo real
  const ref = refActual();
  unsubscribe = onSnapshot(ref, { includeMetadataChanges:true }, snap=>{
    if (!snap.exists()){
      // No hay doc → modo “nuevo objetivo”
      objetivo = 0;
      inicioProduccion = null;
      lastSnap = { parciales:{}, updatedAt:null };
      render();
      return;
    }

    const d = snap.data() || {};
    lastSnap = d;
    objetivo = Number(d.objetivo || 0);
    inicioProduccion = d.inicio || null;

    // Anti-objetivo-viejo + adopción automática de objetivo NUEVO
    const vinoDeServidor = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
    const inputVacio     = !objetivoInput || !objetivoInput.value.trim();
    const updatedAtMs    = (d.updatedAt && d.updatedAt.toMillis) ? d.updatedAt.toMillis() : 0;
    const objetivoReciente = updatedAtMs > modoNuevoDesdeMs;

    if (preferirModoNuevoObjetivo && objetivo>0 && vinoDeServidor && inputVacio && objetivoReciente){
      preferirModoNuevoObjetivo = false;
    }

    render();

    if (snap.metadata.hasPendingWrites) setEstado('Enviando cambios…');
    else if (snap.metadata.fromCache)  setEstado('Sincronizando…');
    else                               setEstado('Conectado');
  }, err=>{ console.error(err); setEstado('Error de conexión'); });
}

// --- Render ---
function render(){
  const sabor=getText(saborSelect), formato=getText(formatoSelect);

  // Mostrar producción SOLO si hay objetivo y no estamos en modo nuevo
  const tieneObj = objetivo>0 && !preferirModoNuevoObjetivo;

  panelObjetivo.style.display = tieneObj ? 'none':'block';
  resumenDiv.style.display    = tieneObj ? 'block':'none';

  if (tieneObj){
    ctxSabor.textContent = `Sabor: ${sabor}`;
    ctxFormato.textContent = `Formato: ${formato}`;
    document.getElementById('contexto').style.display = 'flex';
  } else {
    document.getElementById('contexto').style.display = 'none';
    if (objetivoInput) objetivoInput.value = ''; // NO prellenar con viejo
  }

  // Objetivo visible
  objetivoMostrar.textContent = tieneObj ? (objetivo||0).toLocaleString('es-AR') : '0';

  // Parciales + resumen
  const parcialesByTurno = lastSnap.parciales || {};
  const items = [];
  Object.entries(parcialesByTurno).forEach(([k,arr])=>{
    (Array.isArray(arr)?arr:[]).forEach(p=> items.push({k,p}));
  });
  items.sort((a,b)=> (a.p?.ts||0) - (b.p?.ts||0)); // asc

  const acumulado = items.reduce((acc,it)=> acc + (parseInt(it.p?.cantidad)||0), 0);
  acumuladoSpan.textContent = acumulado.toLocaleString('es-AR');
  faltanteSpan.textContent  = Math.max((objetivo||0)-acumulado,0).toLocaleString('es-AR');
  inicioSpan.textContent    = inicioProduccion ? fmt(inicioProduccion) : '—';

  listaParciales.innerHTML = '';
  items.slice().reverse().forEach((it,idx)=>{
    const tsTxt = it.p?.ts ? fmt(it.p.ts) : '—';
    const li = document.createElement('li');
    li.textContent = `#${idx+1} — ${it.p.cantidad?.toLocaleString('es-AR')} — Turno ${it.k} — ${tsTxt}`;
    listaParciales.appendChild(li);
  });

  // Barra
  let pct = 0;
  if (tieneObj) pct = Math.round( (acumulado / objetivo) * 100 );
  pct = Math.max(0, Math.min(100, pct));
  barraProgreso.style.width = `${pct}%`;
  barraProgreso.textContent = pct ? `${pct}%` : '';
  barraProgreso.style.background = pct<30 ? '#dc3545' : (pct<70 ? '#ffc107' : '#28a745');

  // Guardar combo actual sólo si es válido
  saveSelectors();
}

// --- Acciones ---
guardarObjetivoBtn.addEventListener('click', async ()=>{
  if (!authed) return;
  if (!comboCompleto()){ alert('Elegí Sabor, Formato y Turno.'); return; }

  const val = parseInt(String(objetivoInput.value).replace(/\D/g,''));
  if (!val || val<=0){ alert('Ingresá un objetivo válido (>0)'); return; }

  const ref = refActual();
  objetivo = val;
  if (!inicioProduccion) inicioProduccion = Date.now();

  await setDoc(ref, {
    objetivo,
    inicio: inicioProduccion,
    updatedAt: serverTimestamp(),
    session: session || 1
  }, { merge:true });

  // Este equipo sale del modo nuevo inmediatamente
  preferirModoNuevoObjetivo = false;
  render();
});

agregarParcialBtn.addEventListener('click', async ()=>{
  if (!authed) return;
  if (!comboCompleto()){ alert('Elegí Sabor, Formato y Turno.'); return; }

  const val = parseInt(String(parcialInput.value).replace(/\D/g,''));
  if (!val || val<=0){ alert('Ingresá un número válido (>0)'); return; }

  const ref = refActual();
  const k = turnoKey();
  const item = { cantidad: val, ts: Date.now() };

  try{
    await updateDoc(ref, {
      [`parciales.${k}`]: arrayUnion(item),  // append atómico (sin pisadas)
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
  if (!comboCompleto()){ alert('Elegí Sabor, Formato y Turno.'); return; }
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

  // Volvemos a “nuevo objetivo” y arrancamos un ciclo limpio
  preferirModoNuevoObjetivo = true;
  modoNuevoDesdeMs = Date.now();
  render();
});

// --- Selectores (cambio de combo) ---
[saborSelect, formatoSelect, turnoSelect].forEach(sel=>{
  sel.addEventListener('change', async ()=>{
    // nuevo combo → “nuevo objetivo” hasta que alguien lo fije
    preferirModoNuevoObjetivo = true;
    modoNuevoDesdeMs = Date.now();
    ultimaAccionFueCambioCombo = true;

    // guardamos el combo sólo si está completo
    saveSelectors();

    // si no hay combo completo, cortamos suscripción y limpiamos UI
    if (!comboCompleto()){
      if (unsubscribe){ unsubscribe(); unsubscribe=null; }
      objetivo = 0;
      inicioProduccion = null;
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

  // ⚠️ NO restauramos selección al inicio (arranque en blanco).
  // Si en alguna prueba querés restaurar manualmente: descomentá
  // restoreSelectors();

  await initAuth();
  await subscribe(); // sólo se engancha si el combo está completo
})();
