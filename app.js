// app.js — Un doc por día+sabor+formato. Objetivo GLOBAL. Listado con TODOS los parciales.
// Requiere firebase-config.js con export { app, db }.
import { app, db } from "./firebase-config.js";
import { doc, setDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ===== Estado ===== */
let objetivo = 0;
let inicioProduccion = null;
let unsubscribe = null;
let authed = false;
let lastSnap = { parciales: {} };

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
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
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
  const t = getSelectedText(turnoSelect); // "Turno A"
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
function refActual(){ return doc(db, "produccion", getDocId()); }
function setBotonesEnabled(enabled){
  guardarObjetivoBtn.disabled = !enabled;
  agregarParcialBtn.disabled  = !enabled;
  resetBtn.disabled           = !enabled;
}

/* ===== Auth ===== */
async function initAuth(){
  const auth = getAuth(app);
  return new Promise((resolve)=>{
    onAuthStateChanged(auth, async(user)=>{
      if (user){
        authed = true; setBotonesEnabled(true); escucharDocumentoActual(); resolve();
      } else {
        try { await signInAnonymously(auth); }
        catch(e){ authed=false; setBotonesEnabled(false);
          alert('No se pudo iniciar sesión anónima.\nActivá "Anonymous" en Firebase → Authentication.\n'
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
    const data = snap.data() || {};
    lastSnap = { ...data, parciales: data.parciales || {} };

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

/* ===== Render (GLOBAL) + Listado de TODOS los parciales ===== */
function actualizarResumen(){
  const totalGlobal  = sumAllTurnos(lastSnap.parciales || {});
  const restanteGlob = Math.max((objetivo || 0) - totalGlobal, 0);

  objetivoMostrar.textContent = objetivo.toLocaleString('es-AR');
  acumuladoSpan.textContent   = totalGlobal.toLocaleString('es-AR');
  faltanteSpan.textContent    = restanteGlob.toLocaleString('es-AR');
  inicioSpan.textContent      = inicioProduccion ? fmtFechaHora(inicioProduccion) : '—';

  // ---- LISTA: TODOS LOS PARCIALES (A+B+C+D), ordenados por fecha desc ----
  const items = [];
  for (const [k, arr] of Object.entries(lastSnap.parciales || {})) {
    (Array.isArray(arr) ? arr : []).forEach((p, i) => {
      items.push({ k, i, p });
    });
  }
  items.sort((a,b)=> (b.p?.ts||0) - (a.p?.ts||0)); // más recientes primero

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
      <button onclick="eliminarParcial('${k}', ${i})" title="Eliminar parcial">❌</button>
    `;
    listaParciales.appendChild(li);
  });

  // Visibilidad bloque resumen
  resumenDiv.style.display = objetivo > 0 ? 'block' : 'none';

  // Habilitar/deshabilitar carga de parciales según restante GLOBAL
  agregarParcialBtn.disabled = !authed || (restanteGlob <= 0);
  parcialInput.disabled      = (restanteGlob <= 0);

  // ---- Barra de progreso (GLOBAL) — % en el contenedor .barra-externa ----
  const barraProgreso = document.getElementById('barraProgreso');       // .barra-interna
  const barraWrap     = barraProgreso ? barraProgreso.parentElement : null; // .barra-externa
  let porcentaje = 0;
  if (objetivo > 0) porcentaje = Math.round((totalGlobal / objetivo) * 100);
  porcentaje = Math.max(0, Math.min(100, porcentaje)); // clamp 0..100

  if (barraProgreso) {
    barraProgreso.style.width = `${porcentaje}%`;
    if (barraWrap) barraWrap.setAttribute('data-label', `${porcentaje}%`);
    if (porcentaje < 30)      barraProgreso.style.backgroundColor = '#dc3545';
    else if (porcentaje < 70) barraProgreso.style.backgroundColor = '#ffc107';
    else                      barraProgreso.style.backgroundColor = '#28a745';
  }

  // Placeholder y tope del parcial según restante GLOBAL
  parcialInput.max = restanteGlob;
  parcialInput.placeholder = restanteGlob > 0
    ? `Máx: ${restanteGlob.toLocaleString('es-AR')} (global)`
    : 'Sin restante';
}

/* ===== Acciones UI ===== */
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

  // Chequeo contra restante GLOBAL
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
    // path específico: no toca otros turnos
    await updateDoc(ref, { [`parciales.${k}`]: nuevos });
    parcialInput.value = '';
    // onSnapshot refresca todo
  } catch (e) {
    // si el doc aún no existe, crealo y reintenta
    if (e.code === 'not-found') {
      await setDoc(ref, { parciales: { [k]: nuevos } }, { merge: true });
      parcialInput.value = '';
    } else {
      console.error(e);
      alert(`No se pudo agregar el parcial.\n${e.code || ''} ${e.message || ''}`);
    }
  }
}

// eliminar recibe (turno, index)
window.eliminarParcial = async function(k, index){
  if (!authed) return;
  const arr = (lastSnap.parciales?.[k] || []);
  if (!Number.isInteger(index) || index < 0 || index >= arr.length) return;
  if (!confirm(`¿Eliminar el Parcial ${index + 1} del Turno ${k}?`)) return;

  const nuevos = arr.slice(0, index).concat(arr.slice(index + 1));
  const ref = refActual();
  try {
    await updateDoc(ref, { [`parciales.${k}`]: nuevos });
  } catch (e) {
    console.error(e);
    alert(`No se pudo eliminar el parcial.\n${e.code || ''} ${e.message || ''}`);
  }
};

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

/* ===== Selectores ===== */
function onSelectorChange(){
  actualizarColorFormato();
  escucharDocumentoActual(); // mismo doc (sabor+formato). Listado y totales son globales.
  renderContexto();
}
saborSelect.addEventListener('change', onSelectorChange);
formatoSelect.addEventListener('change', onSelectorChange);
turnoSelect.addEventListener('change', onSelectorChange);

/* Eventos de botones */
guardarObjetivoBtn.addEventListener('click', guardarObjetivoHandler);
agregarParcialBtn.addEventListener('click', agregarParcialHandler);

/* ===== Init ===== */
(async function init(){
  actualizarColorFormato();
  mostrarObjetivoControls(true);
  setBotonesEnabled(false);
  await initAuth();
  renderContexto();
})();
