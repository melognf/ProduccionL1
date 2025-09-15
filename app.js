// app.js — Un doc por día+sabor+formato. Objetivo GLOBAL. Parciales por turno (suman global).
// + Cumplimiento (cajas) editable en la línea de contexto y barra de % dentro del recuadro.
// Requiere firebase-config.js con export { app, db }.

import { app, db } from "./firebase-config.js";
import {
  doc, setDoc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ===== Estado ===== */
let objetivo = 0;                // botellas (global Sabor+Formato+Hoy)
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
// "A|B|C|D" desde "Turno A"
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

/* ===== Cumplimiento (cajas) ===== */
// tamaño de pack según formato: solo 1500 => 4; el resto => 6
function packSize(){
  const f = (getSelectedText(formatoSelect) || '').toLowerCase();
  return f.includes('1500') ? 4 : 6;
}

// crea (una vez) el campo de cumplimiento en la línea de contexto
function ensureCumplInputUI(){
  if (!contexto) return;
  let chip = document.getElementById('chipCumpl');
  if (!chip) {
    chip = document.createElement('span');
    chip.id = 'chipCumpl';
    chip.className = 'chip';
    chip.style.display = 'flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '6px';
    chip.innerHTML = `
      <span>Cumpl. (cajas)</span>
      <input type="number" id="cumplInput" min="0" style="width:90px; padding:.25rem .4rem; border:1px solid #e5e7eb; border-radius:8px;" />
      <button id="guardarCumplBtn" style="padding:.35rem .6rem; border-radius:8px; background:#007BFF; color:#fff; border:none; cursor:pointer;">Guardar</button>
    `;
    contexto.appendChild(chip);
    const btn = document.getElementById('guardarCumplBtn');
    const inp = document.getElementById('cumplInput');
    btn.addEventListener('click', guardarCumplHandler);
    inp.addEventListener('keydown', (e)=> { if (e.key === 'Enter') guardarCumplHandler(); });
  }
  const inp = document.getElementById('cumplInput');
  if (inp) inp.value = lastSnap.cumplimientoObjetivo ? String(lastSnap.cumplimientoObjetivo) : '';
}

// crea (una vez) la barra de cumplimiento dentro del recuadro de parciales
function ensureCumplBar(){
  if (document.getElementById('barraCumpl')) return;

  const barraPrincipal = document.getElementById('barraProgreso'); // ya existe en HTML
  if (!barraPrincipal) return;
  const mainWrap = barraPrincipal.parentElement;

  // Título
  const titulo = document.createElement('div');
  titulo.id = 'tituloCumpl';
  titulo.textContent = 'CUMPLIMIENTO TURNO —';
  titulo.style.marginTop = '10px';
  titulo.style.fontWeight = '700';

  // Barra
  const wrap = document.createElement('div');
  wrap.className = 'barra-externa';
  wrap.id = 'barraCumplWrap';
  const inner = document.createElement('div');
  inner.className = 'barra-interna';
  inner.id = 'barraCumpl';
  wrap.appendChild(inner);

  // Insertar ANTES de la barra principal
  resumenDiv.insertBefore(titulo, mainWrap);
  resumenDiv.insertBefore(wrap, mainWrap);
}

async function guardarCumplHandler(){
  if (!authed) { alert('No hay sesión. Activá Anonymous en Firebase Authentication.'); return; }
  const inp = document.getElementById('cumplInput');
  const val = parseInt(String(inp?.value || '').replace(/\D/g,'')) || 0;
  const ref = refActual();
  try {
    await setDoc(ref, { cumplimientoObjetivo: val }, { merge: true });
  } catch (e) {
    console.error(e);
    alert(`No se pudo guardar el cumplimiento (cajas).\n${e.code||''} ${e.message||''}`);
  }
}

/* ===== Contexto ===== */
function renderContexto(){
  if (!contexto || !ctxSabor || !ctxFormato) return;
  if (objetivo > 0){
    ctxSabor.textContent   = `Sabor: ${getSelectedText(saborSelect)}`;
    ctxFormato.textContent = `Formato: ${getSelectedText(formatoSelect)}`;
    contexto.style.display = 'flex';
    ensureCumplInputUI(); // input de cumplimiento en la misma línea
  } else {
    contexto.style.display = 'none';
  }
}

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

/* ===== Helper: título arriba de la barra de producción ===== */
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

/* ===== Render producción + lista + cumplimiento (último parcial) ===== */
function actualizarResumen(){
  const totalGlobal  = sumAllTurnos(lastSnap.parciales || {});
  const restanteGlob = Math.max((objetivo || 0) - totalGlobal, 0);

  if (objetivoMostrar) objetivoMostrar.textContent = (objetivo || 0).toLocaleString('es-AR');
  if (acumuladoSpan)   acumuladoSpan.textContent   = totalGlobal.toLocaleString('es-AR');
  if (faltanteSpan)    faltanteSpan.textContent    = restanteGlob.toLocaleString('es-AR');
  if (inicioSpan)      inicioSpan.textContent      = inicioProduccion ? fmtFechaHora(inicioProduccion) : '—';

  // ---- Lista: TODOS los parciales ordenados desc por fecha ----
  const items = [];
  for (const [k, arr] of Object.entries(lastSnap.parciales || {})) {
    (Array.isArray(arr) ? arr : []).forEach((p, i) => items.push({ k, i, p }));
  }
  items.sort((a,b)=> (b.p?.ts||0) - (a.p?.ts||0)); // más recientes primero

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
        <button onclick="eliminarParcial('${k}', ${i})" title="Eliminar parcial">❌</button>
      `;
      listaParciales.appendChild(li);
    });
  }

  // Visibilidad del bloque resumen
  if (resumenDiv) resumenDiv.style.display = (objetivo > 0) ? 'block' : 'none';

  // Habilitar/deshabilitar carga de parciales según restante GLOBAL
  if (agregarParcialBtn) agregarParcialBtn.disabled = !authed || (restanteGlob <= 0);
  if (parcialInput) {
    parcialInput.disabled   = (restanteGlob <= 0);
    parcialInput.max        = restanteGlob;
    parcialInput.placeholder = restanteGlob > 0
      ? `Máx: ${restanteGlob.toLocaleString('es-AR')} (global)`
      : 'Sin restante';
  }

  // ===== Cumplimiento (cajas) — SOLO el último parcial (sin decimales) =====
  ensureCumplBar(); // crea título y barra si no existen

  // Título dinámico con el turno del último parcial (o turno seleccionado si no hay)
  const tituloCumpl = document.getElementById('tituloCumpl');
  const ultimo      = items[0];
  const turnoUltimo = ultimo ? ultimo.k : turnoKey();
  if (tituloCumpl) tituloCumpl.textContent = `CUMPLIMIENTO TURNO ${turnoUltimo}`;

  const barraCumpl     = document.getElementById('barraCumpl');
  const barraCumplWrap = barraCumpl ? barraCumpl.parentElement : null;

  const pack            = packSize(); // 1500 => 4; resto => 6
  const objetivoCajas   = Number(lastSnap.cumplimientoObjetivo || 0);
  const botellasParcial = ultimo ? getCantidad(ultimo.p) : 0;
  const cajasParcial    = (pack > 0) ? (botellasParcial / pack) : 0;

  let pctCumpl = (objetivoCajas > 0)
    ? Math.round((cajasParcial / objetivoCajas) * 100)
    : 0;
  pctCumpl = Math.max(0, Math.min(100, pctCumpl)); // clamp 0..100

  if (barraCumpl) {
    barraCumpl.textContent = ''; // sin texto interno
    barraCumpl.style.width = `${pctCumpl}%`;
    if (barraCumplWrap) {
      barraCumplWrap.setAttribute('data-label', `${pctCumpl}%`);
      const cajasParcialInt = Math.round(cajasParcial);
      barraCumplWrap.title = `Parcial: ${cajasParcialInt.toLocaleString('es-AR')} / ${objetivoCajas.toLocaleString('es-AR')} cajas (pack x${pack})`;
    }
    // ✅ Regla pedida: >=58% verde, <58% rojo (sin amarillo)
    barraCumpl.style.backgroundColor = (pctCumpl >= 58) ? '#28a745' : '#dc3545';
  }

  // ===== Título + Barra de progreso (botellas GLOBAL) =====
  ensureProdTitle(); // agrega "Progreso de producción" si falta

  const barraProgreso = document.getElementById('barraProgreso');           // .barra-interna
  const barraWrap     = barraProgreso ? barraProgreso.parentElement : null; // .barra-externa
  let porcentaje = 0;
  if (objetivo > 0) porcentaje = Math.round((totalGlobal / objetivo) * 100); // entero
  porcentaje = Math.max(0, Math.min(100, porcentaje));
  if (barraProgreso) {
    barraProgreso.textContent = ''; // evitar "0%" interno
    barraProgreso.style.width = `${porcentaje}%`;
    if (barraWrap) barraWrap.setAttribute('data-label', `${porcentaje}%`);
    // (La barra global mantiene su esquema rojo/ámbar/verde)
    if (porcentaje < 30)      barraProgreso.style.backgroundColor = '#dc3545';
    else if (porcentaje < 70) barraProgreso.style.backgroundColor = '#ffc107';
    else                      barraProgreso.style.backgroundColor = '#28a745';
  }
}


/* ===== Acciones UI: Objetivo & Parciales ===== */
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
      parciales: lastSnap.parciales || {},
      cumplimientoObjetivo: Number(lastSnap.cumplimientoObjetivo || 0)
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
    // onSnapshot refresca todo (incluida la barra de cumplimiento)
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

/* ===== Listeners ===== */
function onSelectorChange(){
  actualizarColorFormato();
  escucharDocumentoActual(); // mismo doc (sabor+formato)
  renderContexto();          // reinyecta input de cumplimiento si hace falta
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
    await setDoc(ref, { objetivo: 0, parciales: {}, inicio: null, cumplimientoObjetivo: lastSnap.cumplimientoObjetivo || 0 }, { merge: true });
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

// === DEBUG: mostrar docId y estado actual en pantalla ===
(function dbg() {
  const host = document.createElement('div');
  host.id = 'debugDoc';
  host.style.cssText = 'position:fixed;left:8px;bottom:8px;background:#111;color:#fff;padding:6px 8px;border-radius:8px;font:12px monospace;z-index:9999;opacity:.85';
  document.body.appendChild(host);

  function paint() {
    const id = getDocId();
    const total = (typeof lastSnap?.parciales === 'object')
      ? Object.values(lastSnap.parciales).flat().reduce((a,p)=>a+(parseInt(p?.cantidad)||0),0)
      : 0;
    host.textContent = `doc: ${id} | obj:${objetivo||0} | prod:${total}`;
  }

  // repintar ante cambios relevantes
  ['change','input','click'].forEach(evt => document.addEventListener(evt, paint, true));
  setInterval(paint, 1000);
  paint();
})();
