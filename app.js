// app.js — Producción L1 (Tiempo real con Firestore, sin persistencia)
console.log('[ProduccionL1] app.js cargado', new Date().toISOString());

import { app, db } from "./firebase-config.js";
import { doc, setDoc, updateDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ===== Estado ===== */
let objetivo = 0;
let inicioProduccion = null;
let unsubscribe = null;
let authed = false;
let lastSnap = { parciales: {}, cumplimientoObjetivo: 0 };

/* ===== Refs DOM ===== */
const objetivoLabel      = document.querySelector('label[for="objetivo"]');
const objetivoInput      = document.getElementById('objetivo');
const guardarObjetivoBtn = document.getElementById('guardarObjetivoBtn');

const resumenDiv         = document.getElementById('resumen');
const inicioSpan         = document.getElementById('inicio');
const objetivoMostrar    = document.getElementById('objetivoMostrar');
const acumuladoSpan      = document.getElementById('acumulado');
const faltanteSpan       = document.getElementById('faltante');

const parcialLabel       = document.getElementById('parcialLabel');
const parcialInput       = document.getElementById('parcialInput');
const agregarParcialBtn  = document.getElementById('agregarParcialBtn');
const listaParciales     = document.getElementById('listaParciales');
const resetBtn           = document.getElementById('resetBtn');

const saborSelect        = document.getElementById('sabor');
const formatoSelect      = document.getElementById('formato');
const turnoSelect        = document.getElementById('turno');

const contexto           = document.getElementById('contexto');
const ctxSabor           = document.getElementById('ctxSabor');
const ctxFormato         = document.getElementById('ctxFormato');

/* ===== Helpers ===== */
const getSelectedText = (sel) =>
  sel?.options?.[sel.selectedIndex]?.text?.trim() || sel?.value || '';

function hoyYYYYMMDD() {
  // Fecha fija a Buenos Aires (evita docIds distintos por TZ)
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function safeIdPart(s) {
  return (s && String(s).trim()) ? String(s).replace(/[^\w-]+/g,'_') : 'ND';
}
function getDocId() {
  const fecha      = hoyYYYYMMDD();
  const saborTxt   = safeIdPart(getSelectedText(saborSelect));
  const formatoTxt = safeIdPart(getSelectedText(formatoSelect));
  return `${fecha}__${saborTxt}_${formatoTxt}`; // SIN turno
}
function turnoKey() {
  const t = getSelectedText(turnoSelect);
  const m = t.match(/([ABCD])$/i);
  return m ? m[1].toUpperCase() : safeIdPart(t);
}

function getCantidad(p){ return typeof p==='number' ? p : (parseInt(p?.cantidad) || 0); }
function sumParciales(arr){ return arr.reduce((acc,p)=>acc+getCantidad(p),0); }
function sumAllTurnos(parcialesByTurno = {}) {
  return Object.values(parcialesByTurno)
    .reduce((acc, arr) => acc + sumParciales(Array.isArray(arr) ? arr : []), 0);
}
function fmtFechaHora(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}
function actualizarColorFormato(){
  const txt = getSelectedText(formatoSelect);
  let color = '#fff';
  if (txt.includes('500')) color = '#cceeff';
  else if (txt.includes('995')) color = '#f0a13c';
  else if (txt.includes('1500')) color = '#948d7b';
  formatoSelect.style.backgroundColor = color;
}
function mostrarObjetivoControls(mostrar){
  if (objetivoLabel) objetivoLabel.style.display = mostrar ? 'block' : 'none';
  objetivoInput.style.display = mostrar ? 'block' : 'none';
  guardarObjetivoBtn.style.display = mostrar ? 'block' : 'none';
}
function mostrarControlesProduccion(mostrar){
  parcialInput.style.display = mostrar ? 'block' : 'none';
  agregarParcialBtn.style.display = mostrar ? 'block' : 'none';
  parcialLabel.style.display = mostrar ? 'block' : 'none';
}

/* ===== UI extra ===== */
function ensureProdTitle(){
  const barraPrincipal = document.getElementById('barraProgreso');
  if (!barraPrincipal || !resumenDiv) return;
  const mainWrap = barraPrincipal.parentElement;
  if (!mainWrap) return;
  if (!document.getElementById('tituloProgresoProd')) {
    const t = document.createElement('div');
    t.id = 'tituloProgresoProd';
    t.textContent = 'Progreso de producción';
    t.style.marginTop = '10px';
    t.style.fontWeight = '700';
    resumenDiv.insertBefore(t, mainWrap);
  }
}

/* ===== Firestore ===== */
function refActual(){ return doc(db, "produccion", getDocId()); }
function setBotonesEnabled(enabled){
  guardarObjetivoBtn.disabled = !enabled;
  agregarParcialBtn.disabled  = !enabled;
  resetBtn.disabled           = !enabled;
  const btn = document.getElementById('guardarCumplBtn');
  if (btn) btn.disabled = !enabled;
}

/* ===== Auth ===== */
async function initAuth(){
  const auth = getAuth(app);
  return new Promise((resolve)=>{
    onAuthStateChanged(auth, async(user)=>{
      if (user){
        console.log('[auth] signed in anon uid=', user.uid);
        authed = true; setBotonesEnabled(true); escucharDocumentoActual(); resolve();
      } else {
        try { await signInAnonymously(auth); }
        catch(e){ authed=false; setBotonesEnabled(false);
          alert('No se pudo iniciar sesión anónima. Activá "Anonymous" en Firebase → Authentication.\n'
                + `${e.code || ''} ${e.message || ''}`); resolve();
        }
      }
    });
  });
}

/* ===== Snapshot ===== */
function escucharDocumentoActual(){
  if (!authed) return;
  if (typeof unsubscribe === 'function') { unsubscribe(); unsubscribe = null; }

  const ref = refActual();
  unsubscribe = onSnapshot(ref, (snap)=>{
    console.log('[SNAP]', getDocId(), 'exists:', snap.exists());
    const data = snap.data() || {};
    lastSnap = {
      ...data,
      parciales: data.parciales || {},
      cumplimientoObjetivo: Number(data.cumplimientoObjetivo || 0)
    };

    objetivo = Number(lastSnap.objetivo || 0);
    inicioProduccion = lastSnap.inicio || null;

    objetivoInput.value = objetivo > 0 ? objetivo : '';
    const tieneObjetivo = objetivo > 0;

    mostrarObjetivoControls(!tieneObjetivo);
    mostrarControlesProduccion(tieneObjetivo);

    actualizarResumen();
    renderContexto();
  }, (err)=>{
    console.error("onSnapshot error:", err);
    alert(`Error al leer datos: ${err.code || ''} ${err.message || ''}`);
  });
}

/* ===== Render ===== */
function renderContexto(){
  if (!contexto || !ctxSabor || !ctxFormato) return;
  if (objetivo > 0){
    ctxSabor.textContent   = `Sabor: ${getSelectedText(saborSelect)}`;
    ctxFormato.textContent = `Formato: ${getSelectedText(formatoSelect)}`;
    contexto.style.display = 'flex';
  } else {
    contexto.style.display = 'none';
  }
}

function actualizarResumen(){
  const totalGlobal  = sumAllTurnos(lastSnap.parciales || {});
  const restanteGlob = Math.max((objetivo || 0) - totalGlobal, 0);

  if (objetivoMostrar) objetivoMostrar.textContent = (objetivo || 0).toLocaleString('es-AR');
  if (acumuladoSpan)   acumuladoSpan.textContent   = totalGlobal.toLocaleString('es-AR');
  if (faltanteSpan)    faltanteSpan.textContent    = restanteGlob.toLocaleString('es-AR');
  if (inicioSpan)      inicioSpan.textContent      = inicioProduccion ? fmtFechaHora(inicioProduccion) : '—';

  // lista parciales
  const items = [];
  for (const [k, arr] of Object.entries(lastSnap.parciales || {})) {
    (Array.isArray(arr) ? arr : []).forEach((p, i) => items.push({ k, i, p }));
  }
  items.sort((a,b)=> (b.p?.ts||0) - (a.p?.ts||0));

  if (listaParciales) {
    listaParciales.innerHTML = '';
    items.forEach(({k, i, p}, idxGlobal) => {
      const cantidad = getCantidad(p);
      const turnoTxt = `Turno ${k}`;
      const fechaTxt = p?.ts ? fmtFechaHora(p.ts) : '—';
      const li = document.createElement('li');
      li.innerHTML = `
        <span>
          #${idxGlobal + 1} — ${cantidad.toLocaleString('es-AR')} botellas
          — ${turnoTxt}
          — ${fechaTxt}
        </span>
      `;
      listaParciales.appendChild(li);
    });
  }

  if (resumenDiv) resumenDiv.style.display = (objetivo > 0) ? 'block' : 'none';

  // progreso global
  ensureProdTitle();
  const barraProgreso = document.getElementById('barraProgreso');
  const barraWrap     = barraProgreso ? barraProgreso.parentElement : null;
  let porcentaje = 0;
  if (objetivo > 0) porcentaje = Math.round((totalGlobal / objetivo) * 100);
  porcentaje = Math.max(0, Math.min(100, porcentaje));
  if (barraProgreso) {
    barraProgreso.textContent = '';
    barraProgreso.style.width = `${porcentaje}%`;
    if (barraWrap) barraWrap.setAttribute('data-label', `${porcentaje}%`);
    if (porcentaje < 30)      barraProgreso.style.backgroundColor = '#dc3545';
    else if (porcentaje < 70) barraProgreso.style.backgroundColor = '#ffc107';
    else                      barraProgreso.style.backgroundColor = '#28a745';
  }
}

/* ===== Acciones ===== */
async function guardarObjetivoHandler(){
  if (!authed) { alert('No hay sesión. Activá Anonymous en Firebase Authentication.'); return; }
  const val = parseInt(String(objetivoInput.value).replace(/\D/g, ''));
  if (!val || val <= 0) { alert('Ingresá un objetivo válido (>0).'); return; }

  objetivo = val;
  if (!inicioProduccion) inicioProduccion = Date.now();

  const ref = refActual();
  try {
    await setDoc(ref, {
      objetivo,
      inicio: inicioProduccion,
      parciales: lastSnap.parciales || {}
    }, { merge: true });

    mostrarObjetivoControls(false);
    mostrarControlesProduccion(true);
    actualizarResumen();
    renderContexto();
  } catch (e) {
    console.error(e);
    alert(`No se pudo guardar el objetivo.\n${e.code || ''} ${e.message || ''}`);
  }
}

async function agregarParcialHandler(){
  if (!authed) { alert('No hay sesión. Activá Anonymous en Firebase Authentication.'); return; }
  const val = parseInt(String(parcialInput.value).replace(/\D/g, ''));
  if (!val || val <= 0) { alert('Ingresá un número válido (>0).'); return; }

  const totalGlobal  = sumAllTurnos(lastSnap.parciales || {});
  const restanteGlob = Math.max((objetivo || 0) - totalGlobal, 0);
  if (val > restanteGlob) {
    alert(`La producción parcial supera el restante global (${restanteGlob.toLocaleString('es-AR')}).`);
    return;
  }

  const ref = refActual();
  const k = turnoKey();
  const nuevos = (lastSnap.parciales?.[k] || []).concat([{ cantidad: val, ts: Date.now() }]);

  try {
    await updateDoc(ref, { [`parciales.${k}`]: nuevos });
    parcialInput.value = '';
  } catch (e) {
    if (e.code === 'not-found') {
      await setDoc(ref, { parciales: { [k]: nuevos } }, { merge: true });
      parcialInput.value = '';
    } else {
      console.error(e);
      alert(`No se pudo agregar el parcial.\n${e.code || ''} ${e.message || ''}`);
    }
  }
}

/* ===== Listeners ===== */
function onSelectorChange(){
  actualizarColorFormato();
  escucharDocumentoActual();
  renderContexto();
}
saborSelect.addEventListener('change', onSelectorChange);
formatoSelect.addEventListener('change', onSelectorChange);
turnoSelect.addEventListener('change', onSelectorChange);

guardarObjetivoBtn?.addEventListener('click', guardarObjetivoHandler);
agregarParcialBtn?.addEventListener('click', agregarParcialHandler);

resetBtn.addEventListener('click', async ()=>{
  if (!authed) return;
  if (!confirm('¿Reiniciar la producción completa de esta combinación (TODOS los turnos)?')) return;

  objetivo = 0;
  inicioProduccion = null;

  const ref = refActual();
  try {
    await setDoc(ref, { objetivo: 0, parciales: {}, inicio: null }, { merge: true });
  } catch (e) {
    console.error(e);
    alert(`No se pudo reiniciar.\n${e.code || ''} ${e.message || ''}`);
  }

  objetivoInput.value = '';
  parcialInput.value = '';
  mostrarObjetivoControls(true);
  mostrarControlesProduccion(false);
  actualizarResumen();
  renderContexto();
});

/* ===== Init ===== */
(async function init(){
  actualizarColorFormato();
  mostrarObjetivoControls(true);
  setBotonesEnabled(false);
  await initAuth();
  renderContexto();
})();

// === DEBUG BANNER ULTRA-VISIBLE ===
(function dbgBanner(){
  function ensure(){
    let host = document.getElementById('debugDoc');
    if (!host) {
      host = document.createElement('div');
      host.id = 'debugDoc';
      host.style.cssText = `
        position:fixed; left:8px; bottom:8px; right:auto; 
        background:#000; color:#0f0; padding:6px 8px; 
        border:2px solid #0f0; border-radius:8px; 
        font:12px/1.2 monospace; z-index:99999; opacity:.95`;
      host.textContent = 'cargando…';
      document.body.appendChild(host);
    }
    paint();
  }
  function paint(){
    try {
      const id = (typeof getDocId === 'function') ? getDocId() : '(getDocId no definido)';
      const total = (lastSnap && typeof lastSnap.parciales === 'object')
        ? Object.values(lastSnap.parciales).flat().reduce((a,p)=>a+(parseInt(p?.cantidad)||0),0)
        : 0;
      const obj = (typeof objetivo === 'number') ? objetivo : (window.objetivo||0);
      document.getElementById('debugDoc').textContent = `doc: ${id} | obj:${obj} | prod:${total}`;
    } catch(e){
      document.getElementById('debugDoc').textContent = `debug init… ${e.message||e}`;
    }
  }
  window.addEventListener('load', ensure);
  setInterval(()=> { if (document.body) ensure(); }, 1000);
})();
