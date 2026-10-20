import { useState, useRef, useEffect, useCallback } from 'react';
import { procesarPedidos, extraerItemDetalle, calcularCantidadBultos } from './lib/gemini';
import { supabase } from './lib/supabase';
import {
  registrarServiceWorker,
  solicitarPermisoPush,
  suscribirAdmin,
  dispararNotificacionPush,
  pushEsSoportado
} from './lib/push';
import { sanitizarTelefonoChileno, formatearTelefonoVisual } from './lib/sanitizer';
import { abrirWhatsApp, abrirNavegacion, dispararHaptico } from './lib/handoff';
import {
  ChevronLeft, ChevronRight, Package, MapPin, Loader2, CheckCircle2,
  Map, Zap, Truck, Home, Phone, MessageCircle, RefreshCcw, ListOrdered,
  X, ArrowUp, ArrowDown, AlertTriangle, Pencil, Save, Clock, ChevronDown,
  Trash2, Bell, BellOff, User, PhoneCall, Plus, Minus, Camera
} from 'lucide-react';

const REPARTIDORES = ['Javi', 'Mora', 'Sala', 'Nico'];
const TELEFONO_ADMIN = '56988589058';

// Estilo estricto para prevenir lupa/callout nativo de iOS Safari en gestos de pulsación larga
const ESTILO_PULSACION_LARGA = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  touchAction: 'manipulation'
};

// Partículas precalculadas a nivel de módulo para evitar Math.random() impuro en cada render
const PARTICULAS_CONFETI = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  color: ['#dc2626', '#10b981', '#f59e0b', '#2563eb', '#7c3aed'][i % 5],
  left: `${(i * 2.5 + ((i * 7) % 11)) % 100}%`,
  duration: `${2 + (i % 5) * 0.55}s`,
  delay: `${(i % 7) * 0.28}s`
}));

const getMemoria = (clave, valorPorDefecto) => {
  try {
    const guardado = localStorage.getItem(clave);
    return guardado !== null ? JSON.parse(guardado) : valorPorDefecto;
  } catch {
    return valorPorDefecto;
  }
};

const guardarMemoria = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Protección contra fallos de almacenamiento o cuota en navegador privado
  }
};

const prevenirMenuContextual = (e) => {
  e.preventDefault();
};

// --- Subcomponentes extraídos a nivel de módulo (evita desmontaje de DOM en mitad de gestos táctiles) ---

function BotonRayo({ presionando, onPointerDown, onPointerUp }) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={prevenirMenuContextual}
      onDragStart={prevenirMenuContextual}
      aria-label="Marcar todo (mantén presionado)"
      className="no-ios-callout relative overflow-hidden bg-slate-100 w-[72px] h-[72px] rounded-3xl flex flex-col items-center justify-center border-2 border-slate-300 active:scale-95 transition-transform duration-150 select-none shrink-0 cursor-pointer shadow-sm"
      style={ESTILO_PULSACION_LARGA}
    >
      <div
        className="absolute bottom-0 left-0 w-full bg-emerald-500 transition-all ease-linear rounded-b-2xl pointer-events-none"
        style={{ height: presionando ? '100%' : '0%', transitionDuration: presionando ? '750ms' : '150ms' }}
      />
      <Zap size={22} className={`relative z-10 transition-colors pointer-events-none ${presionando ? 'text-white' : 'text-slate-600'}`} />
      <span className={`text-[9px] font-black relative z-10 transition-colors mt-1 tracking-wider pointer-events-none ${presionando ? 'text-white' : 'text-slate-700'}`}>
        TODO
      </span>
    </button>
  );
}

function BotonPrincipalAccion({ modo, todoCargado, intentarComenzarRuta, esUltimaParada, todosSacadosParada, finalizarRuta, onAvanzarParada }) {
  return (
    <div className="pt-5 border-t border-slate-200 bg-white w-full">
      {modo === 'carga' ? (
        <button
          type="button"
          onClick={intentarComenzarRuta}
          disabled={!todoCargado}
          aria-label={todoCargado ? 'Comenzar ruta' : 'Faltan cajas por marcar'}
          className={`
            w-full h-[68px] rounded-3xl font-black text-sm sm:text-base text-white
            transition-all duration-200 flex items-center justify-center gap-3 cursor-pointer
            ${todoCargado
              ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.97] shadow-emerald'
              : 'bg-slate-200 text-slate-500 border border-slate-300 cursor-not-allowed'}
          `}
        >
          {todoCargado
            ? <><CheckCircle2 size={20} /> TODO LISTO — COMENZAR RUTA</>
            : <><Package size={20} /> FALTAN CAJAS POR MARCAR</>}
        </button>
      ) : (
        <button
          type="button"
          onClick={esUltimaParada ? finalizarRuta : onAvanzarParada}
          disabled={!todosSacadosParada}
          aria-label={esUltimaParada ? 'Terminar ruta' : 'Siguiente entrega'}
          className={`
            w-full h-[68px] text-white rounded-3xl font-black text-sm sm:text-base
            active:scale-[0.97] transition-all duration-200 disabled:opacity-40
            flex items-center justify-center gap-3 cursor-pointer
            ${esUltimaParada
              ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald'
              : 'bg-red-600 hover:bg-red-700 shadow-cta'}
          `}
        >
          <Truck size={20} />
          {esUltimaParada ? 'TERMINAR RUTA' : 'ENTREGADO — SIGUIENTE'}
        </button>
      )}
    </div>
  );
}

function ModalSelectorRepartidorComponent({ repartidorNombre, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[350] flex items-center justify-center p-4 sm:p-6 animate-pop-in">
      <div className="bg-white border-2 border-slate-300 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <div>
            <p className="text-red-600 text-xs font-black uppercase tracking-widest mb-1">Identificación</p>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">¿Quién conduce hoy?</h3>
          </div>
          {repartidorNombre && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-800 rounded-xl cursor-pointer"
              aria-label="Cerrar modal"
            >
              <X size={20} />
            </button>
          )}
        </div>
        <p className="text-slate-600 text-xs font-semibold mb-5 leading-relaxed">
          Selecciona tu nombre para registrar tus entregas y mantener informada a la central de Full Canapé:
        </p>

        <div className="grid grid-cols-2 gap-3 mb-2">
          {REPARTIDORES.map((nom) => {
            const activo = repartidorNombre === nom;
            return (
              <button
                type="button"
                key={nom}
                onClick={() => onSelect(nom)}
                className={`
                  h-20 rounded-2xl font-black text-lg flex flex-col items-center justify-center gap-1
                  transition-all duration-200 cursor-pointer active:scale-95
                  ${activo
                    ? 'bg-red-600 text-white shadow-cta border-2 border-red-700'
                    : 'bg-slate-50 border-2 border-slate-300 text-slate-800 hover:bg-slate-100 shadow-sm'}
                `}
              >
                <span>{nom}</span>
                {activo && <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">Activo</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ModalEditarParada({
  paradaNumero,
  formEdicion,
  setFormEdicion,
  onGuardar,
  onCancelar
}) {
  const items = Array.isArray(formEdicion.items) ? formEdicion.items : [];
  const totalBultosEdicion = items.reduce((sum, it) => sum + (Math.max(1, parseInt(it.cantidad, 10) || 1)), 0);

  const actualizarCampoItem = (idx, campo, valor) => {
    const copia = items.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it));
    setFormEdicion({ ...formEdicion, items: copia });
  };

  const cambiarCantidadItem = (idx, delta) => {
    dispararHaptico(10);
    const actual = Math.max(1, parseInt(items[idx]?.cantidad, 10) || 1);
    const nueva = Math.max(1, actual + delta);
    actualizarCampoItem(idx, 'cantidad', nueva);
  };

  const eliminarItem = (idx) => {
    dispararHaptico(15);
    const copia = items.filter((_, i) => i !== idx);
    setFormEdicion({ ...formEdicion, items: copia });
  };

  const agregarProducto = () => {
    dispararHaptico(15);
    const nuevoItem = {
      nombre: '',
      cantidad: 1,
      textoOriginal: '',
      marcado: false,
      sacado: false,
      entrega_at: null
    };
    setFormEdicion({ ...formEdicion, items: [...items, nuevoItem] });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm z-[320] flex items-center justify-center p-3 sm:p-6 animate-pop-in">
      <div className="bg-white border-2 border-slate-300 rounded-[2rem] p-5 sm:p-6 max-w-lg w-full shadow-2xl flex flex-col max-h-[92dvh] text-slate-900">
        {/* Encabezado del Modal */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 shrink-0">
          <div>
            <p className="text-red-600 text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5">
              <Pencil size={12} /> Parada {paradaNumero}
            </p>
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Editar Parada y Productos</h3>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-2.5 rounded-2xl border border-slate-300 active:scale-95 transition-all cursor-pointer"
            aria-label="Cancelar edición"
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo scrollable */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Sección 1: Datos Generales */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
            <p className="text-[11px] font-black text-slate-600 uppercase tracking-widest">
              Datos del cliente y entrega
            </p>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Horario / Día</label>
              <input
                type="text"
                value={formEdicion.cliente}
                onChange={e => setFormEdicion({ ...formEdicion, cliente: e.target.value })}
                className="w-full bg-white border-2 border-slate-300 rounded-xl px-3.5 py-2.5 font-black text-slate-900 text-sm outline-none focus:border-red-600 shadow-sm"
                placeholder="Ej: Sábado 18. 08:00 a 09:00"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Nombre del Cliente</label>
                <input
                  type="text"
                  value={formEdicion.nombre_cliente}
                  onChange={e => setFormEdicion({ ...formEdicion, nombre_cliente: e.target.value })}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 text-sm outline-none focus:border-red-600 shadow-sm"
                  placeholder="Ej: Josefina Bilbao"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Teléfono Móvil</label>
                <input
                  type="tel"
                  value={formEdicion.telefono}
                  onChange={e => setFormEdicion({ ...formEdicion, telefono: e.target.value })}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 text-sm outline-none focus:border-red-600 shadow-sm"
                  placeholder="Ej: 56912345678"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Dirección Completa</label>
              <textarea
                value={formEdicion.direccion}
                onChange={e => setFormEdicion({ ...formEdicion, direccion: e.target.value })}
                rows={2}
                className="w-full bg-white border-2 border-slate-300 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 text-sm outline-none focus:border-red-600 shadow-sm resize-none"
                placeholder="Calle, número, depto, comuna"
              />
            </div>
          </div>

          {/* Sección 2: CRUD de Productos / Bultos */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                <Package size={14} className="text-red-600" /> Productos ({items.length})
              </p>
              <span className="text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-0.5 rounded-lg">
                Total: {totalBultosEdicion} {totalBultosEdicion === 1 ? 'caja' : 'cajas'}
              </span>
            </div>

            {items.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-4 text-center">
                <p className="text-xs font-bold text-slate-500">Sin productos. Agrega al menos un ítem para esta parada.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((it, idx) => {
                  const esMultilinea = String(it.nombre || '').includes('\n');
                  return (
                    <div
                      key={idx}
                      className="bg-white p-3 rounded-xl border-2 border-slate-200 shadow-sm flex flex-col gap-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          {esMultilinea ? (
                            <textarea
                              value={it.nombre}
                              onChange={e => actualizarCampoItem(idx, 'nombre', e.target.value)}
                              rows={3}
                              placeholder="Descripción del producto y sabores..."
                              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs sm:text-sm font-bold text-slate-900 outline-none focus:border-red-600 focus:bg-white resize-y"
                            />
                          ) : (
                            <input
                              type="text"
                              value={it.nombre}
                              onChange={e => actualizarCampoItem(idx, 'nombre', e.target.value)}
                              placeholder="Ej: 120 crostinis champiñón / canapé sin salmón"
                              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs sm:text-sm font-bold text-slate-900 outline-none focus:border-red-600 focus:bg-white"
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => eliminarItem(idx)}
                          className="p-2 text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-lg active:scale-95 transition-all cursor-pointer shrink-0"
                          aria-label={`Eliminar producto ${idx + 1}`}
                          title="Eliminar producto"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                          Cajas / Bultos físicos:
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => cambiarCantidadItem(idx, -1)}
                            disabled={(Number(it.cantidad) || 1) <= 1}
                            className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-800 disabled:opacity-30 active:scale-90 cursor-pointer"
                            aria-label="Disminuir cajas"
                          >
                            <Minus size={13} />
                          </button>
                          <input
                            type="number"
                            min="1"
                            max="99"
                            value={it.cantidad}
                            onChange={e => actualizarCampoItem(idx, 'cantidad', e.target.value)}
                            className="w-12 h-7 text-center font-black text-xs bg-white border border-slate-300 rounded-lg text-slate-900 outline-none focus:border-red-600"
                            aria-label="Cantidad de cajas"
                          />
                          <button
                            type="button"
                            onClick={() => cambiarCantidadItem(idx, 1)}
                            className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-800 active:scale-90 cursor-pointer"
                            aria-label="Aumentar cajas"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={agregarProducto}
              className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-red-600 bg-white hover:bg-red-50/50 text-slate-800 hover:text-red-700 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer shadow-sm"
            >
              <Plus size={16} /> + Agregar producto
            </button>
          </div>
        </div>

        {/* Botonera Inferior */}
        <div className="pt-4 mt-4 border-t border-slate-200 flex gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onCancelar}
            className="px-5 py-3.5 rounded-2xl border-2 border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-black text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onGuardar}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3.5 rounded-2xl shadow-emerald active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer transition-transform text-xs sm:text-sm uppercase tracking-wider"
          >
            <Save size={18} /> GUARDAR CAMBIOS
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  // --- Identidad del Repartidor ---
  const [repartidorNombre, setRepartidorNombre] = useState(() => getMemoria('fc_repartidor_nombre', ''));
  const [modalSelectorRepartidor, setModalSelectorRepartidor] = useState(() => !getMemoria('fc_repartidor_nombre', ''));

  const [input, setInput]               = useState(() => getMemoria('fc_input', ''));
  const [pedidos, setPedidos]           = useState(() => getMemoria('fc_pedidos', []));
  const [historial, setHistorial]       = useState(() => getMemoria('fc_historial', null));
  const [cargando, setCargando]         = useState(false);
  const [index, setIndex]               = useState(() => getMemoria('fc_index', 0));
  const [modo, setModo]                 = useState(() => getMemoria('fc_modo', 'carga'));
  const [eta, setEta]                   = useState(() => getMemoria('fc_eta', ''));
  const [presionando, setPresionando]   = useState(false);
  const [absorbiendo, setAbsorbiendo]   = useState(false);
  const [showReorder, setShowReorder]   = useState(false);
  const [resetProgress, setResetProgress] = useState(0);

  // --- Alerta Modal Multicontrol ---
  const [alertaSinTelefono, setAlertaSinTelefono] = useState(null);
  const [modalEditId, setModalEditId] = useState(null);
  const [modalEditPhone, setModalEditPhone] = useState('');

  // --- Modo Edición de Parada e Ítems ---
  const [modoEdicion, setModoEdicion] = useState(false);
  const [formEdicion, setFormEdicion] = useState({
    cliente: '',
    nombre_cliente: '',
    telefono: '',
    direccion: '',
    items: []
  });
  const [editProgress, setEditProgress] = useState(0);
  const editTimer = useRef(null);

  // --- Animación y Acordeón ---
  const [animatingMover, setAnimatingMover] = useState(null);
  const [expandedAdminId, setExpandedAdminId] = useState(null);

  // --- Transición de tarjeta ---
  const [slideVisible, setSlideVisible] = useState(true);

  // --- Admin Filtro Fantasma ---
  const [hiddenRutas, setHiddenRutas] = useState(() => getMemoria('fc_hidden_rutas', {}));
  const [hideProgress, setHideProgress] = useState({ id: null, progress: 0 });
  const hideTimer = useRef(null);

  const pressTimer     = useRef(null);
  const resetTimer     = useRef(null);
  const syncTimeoutRef = useRef(null);
  const adminTimer     = useRef(null);

  // --- Identificador de sesión persistente ---
  const [sessionId] = useState(() => {
    const cached = getMemoria('fc_session_id', null);
    if (cached) return cached;
    const nuevo = 'rep_' + Math.random().toString(36).substring(2, 9);
    guardarMemoria('fc_session_id', nuevo);
    return nuevo;
  });

  const [showAdmin, setShowAdmin] = useState(false);
  const [adminProgress, setAdminProgress] = useState(0);
  const [rutasEnVivo, setRutasEnVivo] = useState([]);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [adminError, setAdminError] = useState(null);

  // --- Web Push ---
  const [pushEstado, setPushEstado] = useState('idle');
  const pushInicializado = useRef(false);

  const seleccionarRepartidor = (nombre) => {
    dispararHaptico(25);
    setRepartidorNombre(nombre);
    guardarMemoria('fc_repartidor_nombre', nombre);
    setModalSelectorRepartidor(false);
  };

  // Limpieza preventiva de temporizadores al desmontar componente
  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (resetTimer.current) clearInterval(resetTimer.current);
      if (editTimer.current) clearInterval(editTimer.current);
      if (hideTimer.current) clearInterval(hideTimer.current);
      if (adminTimer.current) clearInterval(adminTimer.current);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  // Persistencia desacoplada por clave para evitar re-serializar toda la ruta al escribir en inputs
  useEffect(() => { guardarMemoria('fc_input', input); }, [input]);
  useEffect(() => { guardarMemoria('fc_pedidos', pedidos); }, [pedidos]);
  useEffect(() => { guardarMemoria('fc_historial', historial); }, [historial]);
  useEffect(() => { guardarMemoria('fc_index', index); }, [index]);
  useEffect(() => { guardarMemoria('fc_modo', modo); }, [modo]);
  useEffect(() => { guardarMemoria('fc_eta', eta); }, [eta]);
  useEffect(() => { guardarMemoria('fc_hidden_rutas', hiddenRutas); }, [hiddenRutas]);

  // Registro del Service Worker al montar
  useEffect(() => {
    if (pushInicializado.current) return;
    pushInicializado.current = true;

    if (!pushEsSoportado()) {
      setPushEstado('unsupported');
      return;
    }
    registrarServiceWorker();
    const permisoActual = Notification.permission;
    if (permisoActual === 'granted') setPushEstado('granted');
    else if (permisoActual === 'denied') setPushEstado('denied');
  }, []);

  // Transición suave de tarjeta al cambiar índice
  useEffect(() => {
    const prefReducida = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefReducida) return;
    setSlideVisible(false);
    const t = setTimeout(() => setSlideVisible(true), 160);
    return () => clearTimeout(t);
  }, [index]);

  // Limpieza de gestos activos al regresar desde una app externa (WhatsApp / Maps)
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        setPresionando(false);
        setAbsorbiendo(false);
        setResetProgress(0);
        setEditProgress(0);
        setAdminProgress(0);
        setHideProgress({ id: null, progress: 0 });
        if (pressTimer.current) clearTimeout(pressTimer.current);
        if (resetTimer.current) clearInterval(resetTimer.current);
        if (editTimer.current) clearInterval(editTimer.current);
        if (hideTimer.current) clearInterval(hideTimer.current);
        if (adminTimer.current) clearInterval(adminTimer.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, []);

  // Sincronización enriquecida con Supabase
  const sincronizarConNube = useCallback(async () => {
    if (pedidos.length === 0 || !supabase) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const nombreFinal = repartidorNombre || ('Repartidor ' + sessionId.substring(0, 5).toUpperCase());
      const direccionActual = pedidos[index]?.direccion || '';

      const datosUpsert = {
        id: sessionId,
        nombre_repartidor: nombreFinal,
        progreso_actual: index,
        total_pedidos: pedidos.length,
        pedidos_json: pedidos,
        ultima_actualizacion: new Date().toISOString(),
        esta_activo: modo !== 'fin'
      };

      let res = await supabase.from('monitoreo_rutas').upsert({
        ...datosUpsert,
        direccion_actual: direccionActual
      }).abortSignal(controller.signal);

      if (res.error && res.error.message?.includes('direccion_actual')) {
        res = await supabase.from('monitoreo_rutas').upsert(datosUpsert).abortSignal(controller.signal);
      }

      if (res.error) {
        console.warn('Sincronización en la nube rechazada:', res.error.message);
      }
    } catch {
      // Degradar silenciosamente sin bloquear la UI en desconexión móvil
    } finally {
      clearTimeout(timeoutId);
    }
  }, [pedidos, index, modo, sessionId, repartidorNombre]);

  // Ejecución de sincronización con debounce
  useEffect(() => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      sincronizarConNube();
    }, 600);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [sincronizarConNube]);

  // Lógica del Panel Admin
  const cargarRutasEnVivo = async () => {
    if (!supabase) {
      setAdminError('Sin conexión configurada a Supabase.');
      return;
    }
    setLoadingAdmin(true);
    setAdminError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const fechaLimite = new Date();
      fechaLimite.setHours(fechaLimite.getHours() - 48);

      const { data, error } = await supabase
        .from('monitoreo_rutas')
        .select('id, nombre_repartidor, progreso_actual, total_pedidos, pedidos_json, ultima_actualizacion, esta_activo')
        .gte('ultima_actualizacion', fechaLimite.toISOString())
        .eq('esta_activo', true)
        .order('ultima_actualizacion', { ascending: false })
        .limit(20)
        .abortSignal(controller.signal);

      if (error) {
        console.error('Error al consultar radar:', error.message);
        setAdminError('Error al cargar datos. Intenta de nuevo.');
      } else if (data) {
        const mapaDeduplicado = new Map();
        for (const ruta of data) {
          const clave = ruta.nombre_repartidor;
          if (!mapaDeduplicado.has(clave)) {
            mapaDeduplicado.set(clave, ruta);
          } else {
            const existente = mapaDeduplicado.get(clave);
            if (new Date(ruta.ultima_actualizacion) > new Date(existente.ultima_actualizacion)) {
              mapaDeduplicado.set(clave, ruta);
            }
          }
        }
        setRutasEnVivo(Array.from(mapaDeduplicado.values()));
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setAdminError('Tiempo de espera agotado. Verifica tu conexión.');
      } else {
        setAdminError('Error de red inesperado.');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoadingAdmin(false);
    }
  };

  const limpiarRadar = () => {
    setRutasEnVivo([]);
    setHiddenRutas({});
    setExpandedAdminId(null);
    setAdminError(null);
    dispararHaptico(20);
  };

  const startAdmin = (e) => {
    if (e?.button && e.button !== 0) return;
    if (e?.cancelable) e.preventDefault();
    if (adminTimer.current) clearInterval(adminTimer.current);
    adminTimer.current = setInterval(() => {
      setAdminProgress(prev => {
        if (prev >= 100) {
          clearInterval(adminTimer.current);
          cargarRutasEnVivo();
          setShowAdmin(true);
          dispararHaptico(30);
          return 0;
        }
        return prev + 5;
      });
    }, 40);
  };

  const stopAdmin = () => {
    if (adminTimer.current) clearInterval(adminTimer.current);
    setAdminProgress(0);
  };

  const startHide = (id, e) => {
    if (e) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    }
    if (hideTimer.current) clearInterval(hideTimer.current);
    setHideProgress({ id, progress: 0 });
    hideTimer.current = setInterval(() => {
      setHideProgress(prev => {
        if (prev.progress >= 100) {
          clearInterval(hideTimer.current);
          setHiddenRutas(h => ({ ...h, [id]: Date.now() }));
          dispararHaptico(20);
          return { id: null, progress: 0 };
        }
        return { id, progress: prev.progress + 5 };
      });
    }, 40);
  };

  const stopHide = (e) => {
    if (e) e.stopPropagation();
    if (hideTimer.current) clearInterval(hideTimer.current);
    setHideProgress({ id: null, progress: 0 });
  };

  const handleProcesar = async () => {
    if (!input.trim()) return;
    setCargando(true);
    dispararHaptico(25);
    try {
      const data = await procesarPedidos(input);
      const preparar = (ruta) => ruta.map(p => ({
        ...p,
        id: Math.random().toString(36).substring(2, 9),
        items: (p.items || []).map(i => {
          const detalle = extraerItemDetalle(i);
          return {
            nombre: detalle.nombre,
            cantidad: detalle.cantidad,
            textoOriginal: detalle.textoOriginal,
            marcado: false,
            sacado: false,
            entrega_at: null
          };
        })
      }));
      if (data.pedidos && data.pedidos.length > 0) {
        const nuevosPedidos = preparar(data.pedidos);
        // Clonación profunda para evitar que mutaciones de sesión contaminen el historial
        setHistorial(JSON.parse(JSON.stringify(nuevosPedidos)));
        setPedidos(nuevosPedidos);
        setIndex(0);
        setModo('carga');
      } else {
        alert('No se encontraron pedidos válidos en el texto.');
      }
    } catch (error) {
      console.error(error);
      alert('Error al procesar el texto ingresado.');
    } finally {
      setCargando(false);
    }
  };

  const restaurarUltima = () => {
    if (historial && historial.length > 0) {
      dispararHaptico(20);
      setPedidos(JSON.parse(JSON.stringify(historial)));
      setIndex(0);
      setModo('carga');
    }
  };

  const activarPush = async () => {
    if (pushEstado === 'requesting') return;
    dispararHaptico(15);
    setPushEstado('requesting');
    const permiso = await solicitarPermisoPush();
    if (permiso === 'granted') {
      await suscribirAdmin();
      setPushEstado('granted');
    } else if (permiso === 'denied') {
      setPushEstado('denied');
    } else {
      setPushEstado('idle');
    }
  };

  const startReset = (e) => {
    if (e?.button && e.button !== 0) return;
    if (e?.cancelable) e.preventDefault();
    if (resetTimer.current) clearInterval(resetTimer.current);
    resetTimer.current = setInterval(() => {
      setResetProgress(prev => {
        if (prev >= 100) {
          clearInterval(resetTimer.current);
          limpiarTodo();
          dispararHaptico(40);
          return 0;
        }
        return prev + 5;
      });
    }, 40);
  };

  const stopReset = () => {
    if (resetTimer.current) clearInterval(resetTimer.current);
    setResetProgress(0);
  };

  const limpiarTodo = () => {
    ['fc_input', 'fc_pedidos', 'fc_index', 'fc_modo', 'fc_eta'].forEach(k => localStorage.removeItem(k));
    setPedidos([]);
    setInput('');
    setIndex(0);
    setModo('carga');
    setEta('');
    setModoEdicion(false);
  };

  const moverPedido = (from, to) => {
    setPedidos(prev => {
      const nuevos = [...prev];
      const [removido] = nuevos.splice(from, 1);
      nuevos.splice(to, 0, removido);
      return nuevos;
    });
  };

  const moverPedidoConAnimacion = (from, to) => {
    if (animatingMover) return;
    dispararHaptico(15);
    setAnimatingMover({ from, to });

    setTimeout(() => {
      moverPedido(from, to);
      setAnimatingMover(null);
    }, 280);
  };

  const pedidoActual = pedidos[index] || pedidos[0];

  const pedirTelefonoAdmin = () => {
    const dir = pedidoActual?.direccion || 'dirección';
    const msj = `Necesito el número de teléfono de ${dir}`;
    abrirWhatsApp({ telefono: TELEFONO_ADMIN, mensaje: msj });
  };

  const intentarComenzarRuta = () => {
    dispararHaptico(20);
    const faltan = pedidos.map((p, i) => ({ ...p, originalIndex: i })).filter(p => !p.telefono);
    if (faltan.length > 0) {
      setAlertaSinTelefono(faltan);
    } else {
      cambiarAModoReparto();
    }
  };

  const guardarTelefonoModal = (idx) => {
    dispararHaptico(15);
    const telLimpio = sanitizarTelefonoChileno(modalEditPhone);
    setPedidos(prev => prev.map((p, i) => (i === idx ? { ...p, telefono: telLimpio } : p)));
    setModalEditId(null);
    setModalEditPhone('');

    const restantes = alertaSinTelefono.filter(item => item.originalIndex !== idx);
    if (restantes.length === 0) {
      setAlertaSinTelefono(null);
      cambiarAModoReparto();
    } else {
      setAlertaSinTelefono(restantes);
    }
  };

  const abrirModalEdicion = useCallback(() => {
    const actual = pedidos[index];
    if (!actual) return;
    setFormEdicion({
      cliente: actual.cliente || '',
      nombre_cliente: actual.nombre_cliente || '',
      telefono: actual.telefono || '',
      direccion: actual.direccion || '',
      items: (actual.items || []).map(it => ({
        nombre: it.nombre || '',
        cantidad: Number(it.cantidad) > 0 ? Number(it.cantidad) : 1,
        textoOriginal: it.textoOriginal || it.nombre || '',
        marcado: Boolean(it.marcado),
        sacado: Boolean(it.sacado),
        entrega_at: it.entrega_at || null
      }))
    });
    setModoEdicion(true);
    dispararHaptico(25);
  }, [pedidos, index]);

  const startEditPress = (e) => {
    if (e?.button && e.button !== 0) return;
    if (e?.cancelable) e.preventDefault();
    if (editTimer.current) clearInterval(editTimer.current);
    editTimer.current = setInterval(() => {
      setEditProgress(prev => {
        if (prev >= 100) {
          clearInterval(editTimer.current);
          abrirModalEdicion();
          return 0;
        }
        return prev + 5;
      });
    }, 35);
  };

  const stopEditPress = () => {
    if (editTimer.current) clearInterval(editTimer.current);
    setEditProgress(0);
  };

  const guardarEdicion = () => {
    dispararHaptico(20);
    const itemsValidos = (formEdicion.items || [])
      .map(it => {
        const nombreLimpio = String(it.nombre || '').trim();
        if (!nombreLimpio) return null;
        const cantidadManual = parseInt(it.cantidad, 10);
        const cantidadFinal = Number.isInteger(cantidadManual) && cantidadManual > 0
          ? cantidadManual
          : calcularCantidadBultos(nombreLimpio.split(/\r?\n/)[0]);

        return {
          nombre: nombreLimpio,
          cantidad: cantidadFinal,
          textoOriginal: nombreLimpio,
          marcado: Boolean(it.marcado),
          sacado: Boolean(it.sacado),
          entrega_at: it.entrega_at || null
        };
      })
      .filter(Boolean);

    const itemsFinales = itemsValidos.length > 0
      ? itemsValidos
      : [{
          nombre: '1x Pedido',
          cantidad: 1,
          textoOriginal: '1x Pedido',
          marcado: false,
          sacado: false,
          entrega_at: null
        }];

    setPedidos(prev => prev.map((p, i) => (
      i === index
        ? {
            ...p,
            cliente: formEdicion.cliente.trim() || 'Sin horario',
            nombre_cliente: formEdicion.nombre_cliente.trim(),
            telefono: sanitizarTelefonoChileno(formEdicion.telefono),
            direccion: formEdicion.direccion.trim() || 'Sin dirección',
            items: itemsFinales
          }
        : p
    )));
    setModoEdicion(false);
  };

  // --- Plantillas de WhatsApp Cálidas, Cercanas y Directas ---
  const enviarAvisoCliente = () => {
    if (!pedidoActual?.telefono) return;
    const min = eta || 'unos';
    const texto = `¡Hola! Te escribe el repartidor de Full Canapé. Te cuento que ya voy en camino a tu domicilio con tu pedido. Estaré llegando en aproximadamente ${min} minutos. ¡Quedo atento/a! 🚗💨✨`;
    abrirWhatsApp({ telefono: pedidoActual.telefono, mensaje: texto });
  };

  const enviarMensajeTrafico = () => {
    if (!pedidoActual?.telefono) return;
    const texto = '¡Hola! Te escribe el repartidor de Full Canapé. Hay un poco de tráfico en la ruta, por lo que me demoraré unos 10 minutitos más de lo previsto. ¡Muchas gracias por tu comprensión! 🚗💨🙏';
    abrirWhatsApp({ telefono: pedidoActual.telefono, mensaje: texto });
  };

  const enviarMensajeAfuera = () => {
    if (!pedidoActual?.telefono) return;
    const texto = '¡Hola! Te aviso que ya estoy afuera de tu domicilio con tu pedido de Full Canapé. ¡Quedo atento/a para hacer la entrega! 📦✨';
    abrirWhatsApp({ telefono: pedidoActual.telefono, mensaje: texto });
  };

  const enviarMensajeRecepcion = () => {
    if (!pedidoActual?.telefono) return;
    const texto = '¡Hola! Ya llegué y estoy en recepción con tu pedido de Full Canapé. ¿Me podrías confirmar tu número de departamento o casa, por favor? ¡Muchas gracias! 🏢🙌';
    abrirWhatsApp({ telefono: pedidoActual.telefono, mensaje: texto });
  };

  const abrirFotoEntrega = () => {
    if (!pedidoActual?.telefono) return;
    abrirWhatsApp({ telefono: pedidoActual.telefono });
  };

  const llamarCliente = () => {
    if (!pedidoActual?.telefono) return;
    dispararHaptico(20);
    window.location.href = `tel:+${pedidoActual.telefono}`;
  };

  const avisarAdmin = () => {
    const dir = pedidoActual?.direccion || 'dirección';
    const msj = index === 0
      ? `Saliendo! ${eta} min a ${dir}`
      : `Entregado ${pedidos[index - 1]?.direccion || ''}. Ahora ${eta} min a ${dir}`;
    abrirWhatsApp({ telefono: TELEFONO_ADMIN, mensaje: msj });
  };

  const finalizarRuta = () => {
    dispararHaptico(40);
    const ultimaDireccion = pedidos[pedidos.length - 1]?.direccion || '';
    dispararNotificacionPush(
      `Ruta completada — ${repartidorNombre || 'Repartidor'}`,
      `Última parada: ${ultimaDireccion}`
    );
    setAbsorbiendo(true);
    setTimeout(() => { setModo('fin'); setAbsorbiendo(false); }, 750);
  };

  const toggleCaja = (itemIdx) => {
    dispararHaptico(15);
    const horaActual = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setPedidos(prev => prev.map((p, pIdx) => {
      if (pIdx !== index) return p;
      return {
        ...p,
        items: (p.items || []).map((it, i) => {
          if (i !== itemIdx) return it;
          if (modo === 'carga') {
            return { ...it, marcado: !it.marcado };
          }
          const nuevoSacado = !it.sacado;
          return {
            ...it,
            sacado: nuevoSacado,
            entrega_at: nuevoSacado ? horaActual : null
          };
        })
      };
    }));
  };

  const cambiarAModoReparto = () => {
    dispararHaptico(30);
    const yaHabiaIniciadoEntregas = pedidos.some(p => (p.items || []).some(it => it.sacado));
    if (!yaHabiaIniciadoEntregas) {
      setIndex(0);
      setEta('');
      if (pedidos.length > 0) {
        dispararNotificacionPush(
          `Ruta iniciada — ${repartidorNombre || 'Repartidor'}`,
          `Próxima parada: ${pedidos[0]?.direccion || ''}`
        );
      }
    }
    setModo('reparto');
  };

  const avanzar = () => {
    dispararHaptico(20);
    const siguiente = Math.min(pedidos.length - 1, index + 1);
    if (siguiente > index && modo === 'reparto') {
      const dirSiguiente = pedidos[siguiente]?.direccion || '';
      const titulo = `Parada ${index + 1}/${pedidos.length} entregada — ${repartidorNombre || 'Repartidor'}`;
      const cuerpo = dirSiguiente
        ? `Próxima parada: ${dirSiguiente}`
        : 'Ruta completada sin paradas pendientes';
      dispararNotificacionPush(titulo, cuerpo);
    }
    setIndex(siguiente);
  };

  const retroceder = () => {
    dispararHaptico(15);
    setIndex(i => Math.max(0, i - 1));
  };

  // Handlers del Botón Rayo (Marcar Todo en la parada actual)
  const iniciarRayoTodo = (e) => {
    if (e?.button && e.button !== 0) return;
    if (e?.cancelable) e.preventDefault();
    setPresionando(true);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      dispararHaptico(35);
      const horaActual = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setPedidos(prev => prev.map((p, pIdx) => {
        if (pIdx !== index) return p;
        return {
          ...p,
          items: (p.items || []).map(it => (
            modo === 'carga'
              ? { ...it, marcado: true }
              : { ...it, sacado: true, entrega_at: horaActual }
          ))
        };
      }));
      setPresionando(false);
      if (modo === 'reparto' && index < pedidos.length - 1) {
        setTimeout(() => { avanzar(); setEta(''); }, 300);
      }
    }, 750);
  };

  const detenerRayoTodo = () => {
    setPresionando(false);
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  const todoCargado = pedidos.length > 0 && pedidos.every(p => (p.items || []).every(it => it.marcado));

  // Totales dinámicos de bultos (recalculados automáticamente ante cualquier edición de ítems)
  const totalCajasRuta = pedidos.reduce(
    (acc, p) => acc + (p.items || []).reduce((sum, it) => sum + (Number(it.cantidad) || 1), 0),
    0
  );
  const cajasCargadas = pedidos.reduce(
    (acc, p) => acc + (p.items || []).filter(it => it.marcado).reduce((sum, it) => sum + (Number(it.cantidad) || 1), 0),
    0
  );
  const bultosParadaActual = (pedidoActual?.items || []).reduce(
    (sum, it) => sum + (Number(it.cantidad) || 1),
    0
  );
  const bultosEntregadosParada = (pedidoActual?.items || []).filter(it => it.sacado).reduce(
    (sum, it) => sum + (Number(it.cantidad) || 1),
    0
  );
  const todosSacadosParada = (pedidoActual?.items || []).every(it => it.sacado);

  if (showAdmin) {
    const rutasVisibles = rutasEnVivo.filter(ruta => {
      const hiddenAt = hiddenRutas[ruta.id];
      if (!hiddenAt) return true;
      const updatedAt = new Date(ruta.ultima_actualizacion).getTime();
      return updatedAt > hiddenAt;
    });

    return (
      <div
        className="min-h-screen bg-slate-50 flex flex-col relative max-w-xl mx-auto text-slate-900"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.5rem, env(safe-area-inset-right))'
        }}
      >
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse-dot inline-block" />
              <p className="text-red-700 text-xs font-black uppercase tracking-widest">Radar en vivo</p>
            </div>
            <h2 className="text-slate-900 text-3xl font-black tracking-tight">PANEL ADMIN</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowAdmin(false)}
            className="bg-white border-2 border-slate-200 p-3 rounded-2xl text-slate-700 hover:bg-slate-100 active:scale-95 transition-all cursor-pointer shadow-sm"
            aria-label="Cerrar panel admin"
          >
            <X size={20} />
          </button>
        </div>

        <button
          type="button"
          onClick={cargarRutasEnVivo}
          disabled={loadingAdmin}
          className="mb-5 flex items-center justify-center gap-2 w-full bg-white border-2 border-slate-300 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-800 hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 shadow-sm"
        >
          <RefreshCcw size={14} className={loadingAdmin ? 'animate-spin' : ''} />
          {loadingAdmin ? 'Cargando radar...' : 'Actualizar Radar'}
        </button>

        {adminError && (
          <div className="mb-4 flex items-center gap-3 bg-red-50 border-2 border-red-300 text-red-800 text-xs font-bold p-4 rounded-2xl animate-fade-in shadow-sm">
            <AlertTriangle size={16} className="shrink-0 text-red-600" />
            {adminError}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          {loadingAdmin && rutasEnVivo.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-16 gap-4 text-slate-500">
              <Loader2 size={32} className="animate-spin text-slate-600" />
              <p className="text-sm font-bold text-slate-700">Conectando con el radar logístico...</p>
            </div>
          ) : rutasVisibles.length === 0 ? (
            <div className="flex flex-col items-center mt-16 text-center gap-3">
              <div className="bg-white p-6 rounded-3xl border-2 border-slate-200 shadow-sm">
                <Truck size={40} className="text-slate-400 mb-2" />
              </div>
              <p className="text-slate-700 font-bold">No hay repartidores activos</p>
              <p className="text-slate-500 text-xs font-semibold">en las últimas 48 horas</p>
            </div>
          ) : (
            <>
              {rutasVisibles.map(ruta => {
                const porcentaje = Math.round((ruta.progreso_actual / ruta.total_pedidos) * 100) || 0;
                const horasPasadas = (new Date() - new Date(ruta.ultima_actualizacion)) / (1000 * 60 * 60);
                const isStale = horasPasadas > 12;
                const isExpanded = expandedAdminId === ruta.id;
                const paradaActualObj = ruta.pedidos_json?.[ruta.progreso_actual];
                const dirDestinoActual = paradaActualObj?.direccion || (ruta.progreso_actual >= ruta.total_pedidos ? 'Ruta completada' : 'En tránsito');

                return (
                  <div
                    key={ruta.id}
                    className={`bg-white rounded-3xl border-2 transition-all duration-200 shadow-sm ${
                      isStale ? 'border-amber-400' : 'border-slate-200'
                    }`}
                  >
                    <div
                      className="flex justify-between items-center cursor-pointer select-none p-5"
                      onClick={() => setExpandedAdminId(isExpanded ? null : ruta.id)}
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <h3 className="font-black text-base flex items-center gap-2 truncate text-slate-900">
                          {!isStale && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-dot shrink-0" />}
                          {ruta.nombre_repartidor}
                          {isStale && <Clock size={14} className="text-amber-600 shrink-0" />}
                        </h3>

                        <p className="text-xs font-bold text-red-600 mt-1 truncate">
                          Parada {Math.min(ruta.progreso_actual + 1, ruta.total_pedidos)}/{ruta.total_pedidos} en camino a: {dirDestinoActual}
                        </p>

                        <p className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">
                          ID: {String(ruta.id).substring(0, 12)}
                        </p>

                        <div className="mt-2.5 flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${porcentaje}%`,
                                backgroundColor: porcentaje === 100 ? '#10b981' : '#dc2626'
                              }}
                            />
                          </div>
                          <span className="text-[11px] font-black text-slate-700 shrink-0">
                            {ruta.progreso_actual}/{ruta.total_pedidos}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <ChevronDown
                          size={18}
                          className={`text-slate-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                        <button
                          type="button"
                          onPointerDown={(e) => startHide(ruta.id, e)}
                          onPointerUp={stopHide}
                          onPointerLeave={stopHide}
                          onPointerCancel={stopHide}
                          onContextMenu={prevenirMenuContextual}
                          onDragStart={prevenirMenuContextual}
                          className="no-ios-callout relative overflow-hidden bg-slate-100 border border-slate-200 p-2 rounded-xl text-slate-600 active:scale-95 transition-transform hover:bg-slate-200 select-none"
                          style={ESTILO_PULSACION_LARGA}
                          aria-label="Mantén para ocultar repartidor"
                        >
                          <div
                            className="absolute bottom-0 left-0 h-full bg-red-500 transition-all ease-linear pointer-events-none"
                            style={{ width: hideProgress.id === ruta.id ? `${hideProgress.progress}%` : '0%' }}
                          />
                          <X size={14} className="relative z-10 pointer-events-none" />
                        </button>
                      </div>
                    </div>

                    <div
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${
                        isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <div className="px-5 pb-5 pt-1 border-t border-slate-200 bg-slate-50/70 rounded-b-3xl">
                        <div className="space-y-2 mt-4">
                          {(ruta.pedidos_json || []).map((p, i) => {
                            const entregado = Array.isArray(p.items) && p.items.some(it => it.sacado);
                            const horaEntrega = Array.isArray(p.items) && p.items.find(it => it.sacado)?.entrega_at;
                            const esCurrent = i === ruta.progreso_actual;
                            return (
                              <div
                                key={p.id || i}
                                className={`flex justify-between items-center p-3.5 rounded-2xl border-2 transition-colors ${
                                  esCurrent
                                    ? 'bg-red-50 border-red-300'
                                    : entregado
                                      ? 'bg-emerald-50 border-emerald-200'
                                      : 'bg-white border-slate-200'
                                }`}
                              >
                                <div className="min-w-0 pr-3">
                                  <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${
                                    esCurrent ? 'text-red-700' : entregado ? 'text-emerald-700' : 'text-slate-500'
                                  }`}>
                                    {esCurrent ? '▶ EN CAMINO' : `Parada ${i + 1}`}
                                  </p>
                                  <p className="text-sm font-bold text-slate-900 truncate">{p.direccion}</p>
                                  {p.nombre_cliente && (
                                    <p className="text-xs font-semibold text-slate-600 truncate">{p.nombre_cliente}</p>
                                  )}
                                </div>
                                <div className="shrink-0 text-right">
                                  {entregado
                                    ? <span className="text-emerald-700 font-black text-sm">{horaEntrega || '✓'}</span>
                                    : <span className="text-slate-500 font-black text-[10px] uppercase">Pendiente</span>
                                  }
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="pt-2 pb-2">
                <button
                  type="button"
                  onClick={limpiarRadar}
                  className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl border-2 border-dashed border-slate-300 bg-white text-slate-700 text-xs font-black uppercase tracking-widest hover:border-red-600 hover:text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all cursor-pointer group shadow-sm"
                  aria-label="Limpiar todos los repartidores del radar"
                >
                  <Trash2 size={14} className="group-hover:text-red-600 transition-colors" />
                  Limpiar todo el radar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (modo === 'fin') {
    return (
      <div
        className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-900 overflow-hidden relative"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(2rem, env(safe-area-inset-left))',
          paddingRight: 'max(2rem, env(safe-area-inset-right))'
        }}
      >
        {PARTICULAS_CONFETI.map((particula) => (
          <div
            key={particula.id}
            className="absolute w-2.5 h-2.5 rounded-sm opacity-60 z-0 pointer-events-none"
            style={{
              backgroundColor: particula.color,
              left: particula.left,
              top: '-5%',
              animation: `confetti-fall ${particula.duration} linear infinite`,
              animationDelay: particula.delay
            }}
          />
        ))}

        <div className="relative z-10 flex flex-col items-center w-full max-w-sm text-center animate-pop-in">
          <div className="bg-emerald-100 border-2 border-emerald-300 text-emerald-700 p-8 rounded-full mb-6 shadow-md">
            <CheckCircle2 size={72} strokeWidth={2} />
          </div>

          <h1 className="text-4xl font-black mb-1 tracking-tight text-slate-900">RUTA</h1>
          <h1 className="text-4xl font-black tracking-tight text-red-600 mb-8">COMPLETADA</h1>

          <div className="w-full relative h-20 mb-8 flex items-center justify-center">
            <div className="absolute bottom-5 left-0 w-full h-0 border-t-2 border-dashed border-slate-300" />
            <div className="absolute bottom-[16px] left-0 flex items-center animate-truck-cross w-full">
              <Truck className="text-red-600 drop-shadow-sm" size={44} strokeWidth={2} />
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full">
            <button
              type="button"
              onClick={() => abrirNavegacion('fundo el bosque 95, maipú')}
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-[66px] rounded-3xl w-full font-black text-base active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-emerald cursor-pointer tracking-wider"
            >
              <Home size={22} /> VAMOS A CASA
            </button>

            <button
              type="button"
              onClick={limpiarTodo}
              className="bg-white border-2 border-slate-300 text-slate-800 h-[64px] rounded-3xl w-full font-black text-sm active:scale-[0.98] transition-all cursor-pointer tracking-wider hover:bg-slate-100 shadow-sm"
            >
              VOLVER AL INICIO
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div
        className="min-h-screen bg-slate-50 flex flex-col justify-center max-w-xl mx-auto overflow-y-auto relative text-slate-900"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.5rem, env(safe-area-inset-right))'
        }}
      >
        {modalSelectorRepartidor && (
          <ModalSelectorRepartidorComponent
            repartidorNombre={repartidorNombre}
            onSelect={seleccionarRepartidor}
            onClose={() => setModalSelectorRepartidor(false)}
          />
        )}

        {/* Botón de cambio de identidad y Radar Admin */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModalSelectorRepartidor(true)}
            title="Cambiar repartidor"
            className="bg-white text-slate-800 border-2 border-slate-300 px-3.5 py-2.5 rounded-2xl font-black text-xs flex items-center gap-1.5 active:scale-95 shadow-sm hover:bg-slate-50 cursor-pointer select-none"
          >
            <User size={14} className="text-red-600 shrink-0" />
            <span>{repartidorNombre || 'Repartidor'}</span>
          </button>

          <button
            type="button"
            onPointerDown={startAdmin}
            onPointerUp={stopAdmin}
            onPointerLeave={stopAdmin}
            onPointerCancel={stopAdmin}
            onContextMenu={prevenirMenuContextual}
            onDragStart={prevenirMenuContextual}
            className="no-ios-callout p-2.5 rounded-2xl bg-white border-2 border-slate-300 cursor-pointer text-slate-500 hover:text-slate-700 active:scale-95 transition-transform relative overflow-hidden select-none shadow-sm"
            style={ESTILO_PULSACION_LARGA}
            aria-label="Acceso panel admin (mantén presionado)"
          >
            <Zap size={18} className="pointer-events-none" />
            <div
              className="absolute bottom-0 left-0 h-1 bg-red-600 transition-all duration-75 pointer-events-none"
              style={{ width: `${adminProgress}%` }}
            />
          </button>
        </div>

        <div className="mb-8 text-center flex flex-col items-center animate-slide-up mt-6">
          <img src="/logo.png" alt="Logo Full Canapé" className="w-28 h-auto mb-4 drop-shadow-sm select-none" draggable={false} />
          <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Full Canapé</h1>
          <p className="text-slate-600 font-bold mt-2 text-xs tracking-wider uppercase">Sistema logístico de reparto</p>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: '50ms' }}>
          <label className="block text-xs font-black text-slate-700 uppercase tracking-widest mb-2 pl-1">
            Pegar pedidos aquí
          </label>
          <textarea
            className="w-full h-48 p-4 bg-white rounded-3xl border-2 border-slate-300 mb-4 outline-none text-base resize-none font-medium text-slate-900 placeholder:text-slate-400 focus:border-red-600 transition-colors shadow-sm"
            placeholder="Pega los pedidos aquí (WhatsApp)..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3 animate-slide-up" style={{ animationDelay: '100ms' }}>
          <button
            type="button"
            onClick={handleProcesar}
            disabled={cargando || !input.trim()}
            className={`h-[66px] rounded-3xl font-black text-base transition-all duration-200 cursor-pointer flex items-center justify-center gap-3 ${
              cargando || !input.trim()
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-2 border-slate-300'
                : 'bg-red-600 hover:bg-red-700 text-white shadow-cta active:scale-[0.98]'
            }`}
          >
            {cargando ? <><Loader2 className="animate-spin" size={22} /> PROCESANDO RUTA...</> : <><Package size={22} /> CARGAR RUTA</>}
          </button>

          {historial && (
            <button
              type="button"
              onClick={restaurarUltima}
              className="h-[54px] rounded-3xl font-bold text-slate-800 bg-white border-2 border-slate-300 flex items-center justify-center gap-2 hover:bg-slate-50 active:scale-[0.98] transition-all shadow-sm cursor-pointer"
            >
              <RefreshCcw size={16} /> RESTAURAR ÚLTIMA CARGA
            </button>
          )}

          {pushEstado !== 'unsupported' && (
            <button
              type="button"
              onClick={activarPush}
              disabled={pushEstado === 'requesting' || pushEstado === 'denied'}
              className={`h-[50px] rounded-3xl font-bold text-xs flex items-center justify-center gap-2.5 transition-all duration-200 cursor-pointer border-2 ${
                pushEstado === 'granted'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800 cursor-default shadow-sm'
                  : pushEstado === 'denied'
                  ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                  : pushEstado === 'requesting'
                  ? 'bg-slate-100 border-slate-200 text-slate-500 cursor-wait'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 active:scale-[0.98] shadow-sm'
              }`}
              aria-label="Activar notificaciones push para el administrador"
            >
              {pushEstado === 'granted' ? (
                <><Bell size={15} className="text-emerald-700" /> Alertas push activas</>
              ) : pushEstado === 'denied' ? (
                <><BellOff size={15} /> Alertas bloqueadas en ajustes</>
              ) : pushEstado === 'requesting' ? (
                <><Loader2 size={15} className="animate-spin" /> Activando alertas...</>
              ) : (
                <><Bell size={15} /> Activar alertas al admin</>
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-100 flex flex-col relative max-w-7xl mx-auto text-slate-900"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))'
      }}
    >
      {modalSelectorRepartidor && (
        <ModalSelectorRepartidorComponent
          repartidorNombre={repartidorNombre}
          onSelect={seleccionarRepartidor}
          onClose={() => setModalSelectorRepartidor(false)}
        />
      )}

      {/* Modal de Edición Completa de Parada e Ítems (CRUD) */}
      {modoEdicion && (
        <ModalEditarParada
          paradaNumero={index + 1}
          formEdicion={formEdicion}
          setFormEdicion={setFormEdicion}
          onGuardar={guardarEdicion}
          onCancelar={() => setModoEdicion(false)}
        />
      )}

      <div
        className={`fixed inset-0 bg-white z-[100] transition-all duration-700 pointer-events-none ${
          absorbiendo ? 'opacity-100 scale-150 rounded-none' : 'opacity-0 scale-0 rounded-full'
        }`}
        style={{ transformOrigin: 'bottom center' }}
      />

      {/* Modal Multicontrol de Teléfonos Faltantes */}
      {alertaSinTelefono && (
        <div className="fixed inset-0 bg-slate-600/30 backdrop-blur-sm z-[300] flex items-center justify-center p-4 sm:p-6 animate-pop-in">
          <div className="bg-white border-2 border-slate-300 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex flex-col items-center text-center mb-5 shrink-0">
              <div className="bg-amber-100 border border-amber-300 text-amber-700 p-4 rounded-full w-16 h-16 flex items-center justify-center mb-3">
                <AlertTriangle size={30} strokeWidth={2.5} />
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-1 tracking-tight">Faltan Teléfonos</h3>
              <p className="text-slate-700 text-xs font-semibold leading-relaxed">
                A las siguientes <strong className="text-slate-900">{alertaSinTelefono.length}</strong> paradas les falta el número móvil:
              </p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 mb-5 pr-1">
              {alertaSinTelefono.map((p) => (
                <div key={p.originalIndex} className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-200">
                  <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1">Parada {p.originalIndex + 1}</p>
                  <p className="text-sm font-bold text-slate-900 leading-snug mb-3 truncate">{p.direccion}</p>

                  {modalEditId === p.originalIndex ? (
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={modalEditPhone}
                        onChange={e => setModalEditPhone(e.target.value)}
                        placeholder="Ej: 56912345678"
                        className="flex-1 bg-white border-2 border-slate-300 text-slate-900 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-red-600 shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => guardarTelefonoModal(p.originalIndex)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white p-2.5 rounded-xl shadow-sm active:scale-95 cursor-pointer"
                        aria-label="Guardar teléfono"
                      >
                        <Save size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setModalEditId(p.originalIndex); setModalEditPhone(''); }}
                      className="w-full flex items-center justify-center gap-2 bg-white border-2 border-slate-300 text-slate-800 py-2.5 rounded-xl text-xs font-black hover:border-slate-400 active:scale-95 transition-all cursor-pointer shadow-sm"
                    >
                      <Pencil size={12} /> AGREGAR TELÉFONO
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => { setAlertaSinTelefono(null); cambiarAModoReparto(); }}
              className="w-full shrink-0 bg-white border-2 border-slate-300 hover:bg-slate-100 text-slate-800 h-[58px] rounded-2xl font-black text-sm active:scale-[0.98] transition-transform cursor-pointer tracking-wider shadow-sm"
            >
              CONTINUAR DE TODAS FORMAS
            </button>
          </div>
        </div>
      )}

      {/* Barra superior de controles */}
      <div className="flex justify-between items-center mb-4 px-1 gap-2">
        <button
          type="button"
          onPointerDown={startReset}
          onPointerUp={stopReset}
          onPointerLeave={stopReset}
          onPointerCancel={stopReset}
          onContextMenu={prevenirMenuContextual}
          onDragStart={prevenirMenuContextual}
          aria-label="Mantén presionado para reiniciar"
          className="no-ios-callout relative overflow-hidden bg-white text-slate-700 px-4 py-3 rounded-2xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-all select-none cursor-pointer shadow-sm border-2 border-slate-200 shrink-0"
          style={ESTILO_PULSACION_LARGA}
        >
          <div className="absolute bottom-0 left-0 h-[3px] bg-red-600 transition-all duration-75 rounded-full pointer-events-none" style={{ width: `${resetProgress}%` }} />
          <RefreshCcw size={14} className={`pointer-events-none ${resetProgress > 0 ? 'animate-spin' : ''}`} />
          <span className="tracking-wider pointer-events-none">{resetProgress > 0 ? 'MANTÉN...' : 'REINICIAR'}</span>
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Badge del repartidor con opción de reasignar */}
          <button
            type="button"
            onClick={() => setModalSelectorRepartidor(true)}
            title="Cambiar repartidor activo"
            className="bg-white text-slate-800 border-2 border-slate-300 px-3 py-3 rounded-2xl font-black text-xs flex items-center gap-1.5 active:scale-95 shadow-sm hover:bg-slate-50 cursor-pointer select-none"
          >
            <User size={14} className="text-red-600 shrink-0" />
            <span className="truncate max-w-[68px] sm:max-w-none">{repartidorNombre || 'Repartidor'}</span>
          </button>

          <button
            type="button"
            onClick={() => { dispararHaptico(15); setShowReorder(true); }}
            className="bg-white text-slate-900 border-2 border-slate-200 px-3.5 py-3 rounded-2xl font-black text-xs flex items-center gap-1.5 active:scale-95 transition-all shadow-sm cursor-pointer hover:bg-slate-50 select-none"
          >
            <ListOrdered size={14} />
            <span className="tracking-wider hidden sm:inline">COLA DE REPARTO</span>
            <span className="tracking-wider sm:hidden">COLA</span>
          </button>

          {/* Acceso a Radar Admin también disponible en barra operativa por pulsación larga */}
          <button
            type="button"
            onPointerDown={startAdmin}
            onPointerUp={stopAdmin}
            onPointerLeave={stopAdmin}
            onPointerCancel={stopAdmin}
            onContextMenu={prevenirMenuContextual}
            onDragStart={prevenirMenuContextual}
            className="no-ios-callout p-3 rounded-2xl bg-white border-2 border-slate-200 cursor-pointer text-slate-500 hover:text-slate-700 active:scale-95 transition-transform relative overflow-hidden select-none shadow-sm shrink-0"
            style={ESTILO_PULSACION_LARGA}
            aria-label="Acceso panel admin (mantén presionado)"
          >
            <Zap size={16} className="pointer-events-none" />
            <div
              className="absolute bottom-0 left-0 h-1 bg-red-600 transition-all duration-75 pointer-events-none"
              style={{ width: `${adminProgress}%` }}
            />
          </button>
        </div>
      </div>

      {/* Modal Cola de Reparto */}
      {showReorder && (
        <div className="fixed inset-0 bg-slate-100/98 backdrop-blur-md z-[200] p-6 flex flex-col overflow-y-auto text-slate-900">
          <div className="flex justify-between items-center mb-6">
            <div>
              <p className="text-red-600 text-xs font-black uppercase tracking-widest mb-1">Ordenar paradas</p>
              <h2 className="text-slate-900 text-3xl font-black tracking-tight">COLA DE REPARTO</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowReorder(false)}
              className="bg-white border-2 border-slate-300 p-3 rounded-2xl text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer shadow-sm"
              aria-label="Cerrar modal de orden"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 space-y-3 pb-8">
            {pedidos.map((p, i) => {
              const isMoving = animatingMover?.from === i;
              const isDisplaced = animatingMover?.to === i;

              const transClasses = animatingMover !== null ? 'transition-all duration-300 ease-in-out' : '';
              let animClasses = '';

              if (isMoving) {
                const up = animatingMover.to < animatingMover.from;
                animClasses = `${up ? '-translate-y-[calc(100%+0.75rem)]' : 'translate-y-[calc(100%+0.75rem)]'} z-20 scale-[1.03] shadow-2xl`;
              } else if (isDisplaced) {
                const up = animatingMover.from < animatingMover.to;
                animClasses = `${up ? '-translate-y-[calc(100%+0.75rem)]' : 'translate-y-[calc(100%+0.75rem)]'} z-0 opacity-40 scale-[0.98]`;
              }

              return (
                <div
                  key={p.id || p.cliente + p.direccion}
                  className={`flex items-center p-4 sm:p-5 rounded-3xl border-2 relative ${transClasses} ${
                    i === index ? 'bg-red-50 border-red-500 shadow-md' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                  } ${animClasses}`}
                >
                  <div className="flex-1 pr-3 min-w-0">
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${i === index ? 'text-red-700' : 'text-slate-500'}`}>
                      Parada {i + 1} {i === index && ' · EN CURSO'}
                    </p>
                    <p className="text-slate-900 font-bold leading-tight truncate">{p.direccion}</p>
                    {p.nombre_cliente && (
                      <p className="text-xs font-black text-slate-800 mt-0.5 truncate flex items-center gap-1">
                        <User size={12} className="shrink-0 text-slate-500" /> {p.nombre_cliente}
                      </p>
                    )}
                    <p className={`text-[11px] mt-1 font-semibold ${i === index ? 'text-red-600' : 'text-slate-600'}`}>{p.cliente}</p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 relative z-30">
                    <button
                      type="button"
                      onClick={() => moverPedidoConAnimacion(i, i - 1)}
                      disabled={i === 0 || animatingMover !== null}
                      className="p-3 bg-slate-100 border border-slate-300 rounded-xl disabled:opacity-20 hover:bg-slate-200 transition-colors active:scale-90 cursor-pointer text-slate-800"
                      aria-label="Subir parada"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moverPedidoConAnimacion(i, i + 1)}
                      disabled={i === pedidos.length - 1 || animatingMover !== null}
                      className="p-3 bg-slate-100 border border-slate-300 rounded-xl disabled:opacity-20 hover:bg-slate-200 transition-colors active:scale-90 cursor-pointer text-slate-800"
                      aria-label="Bajar parada"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowReorder(false)}
            className="sticky bottom-4 bg-red-600 hover:bg-red-700 text-white py-5 rounded-[2rem] font-black text-base w-full shadow-cta active:scale-[0.98] transition-transform cursor-pointer"
          >
            CONFIRMAR ORDEN
          </button>
        </div>
      )}

      {/* Selector de Modo (Check-in vs Reparto) */}
      <div className="bg-slate-200/90 p-1.5 rounded-2xl flex mb-4 shadow-sm border border-slate-300 shrink-0">
        <button
          type="button"
          onClick={() => { dispararHaptico(15); setModo('carga'); }}
          className={`flex-1 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all duration-200 cursor-pointer ${
            modo === 'carga' ? 'bg-red-600 text-white shadow-cta scale-[1.01]' : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          1 · CHECK-IN
        </button>
        <button
          type="button"
          onClick={intentarComenzarRuta}
          disabled={!todoCargado}
          className={`flex-1 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all duration-200 cursor-pointer ${
            modo === 'reparto' ? 'bg-red-600 text-white shadow-cta scale-[1.01]' : 'text-slate-700 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          2 · EN RUTA
        </button>
      </div>

      {/* Contenedor Principal de la Tarjeta */}
      <div className="flex-1 bg-white rounded-[2.5rem] p-6 sm:p-8 shadow-card card-accent-top flex flex-col relative animate-slide-up border-2 border-slate-200/90">
        {/* Badge Global de Cajas Durante Check-In */}
        {modo === 'carga' && (
          <div className="bg-emerald-100 border-2 border-emerald-400 text-emerald-950 font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl mb-4 flex items-center justify-between shadow-sm animate-fade-in">
            <div className="flex items-center gap-2">
              <Package size={18} className="text-emerald-700 shrink-0" />
              <span>Total cajas a cargar: <strong>{totalCajasRuta} cajas</strong></span>
            </div>
            <span className="text-[11px] font-bold bg-white/90 px-2 py-0.5 rounded-lg border border-emerald-300 shrink-0">
              {cajasCargadas}/{totalCajasRuta} marcadas
            </span>
          </div>
        )}

        <div className="flex items-center justify-between mb-5 bg-slate-50 p-2 rounded-2xl border border-slate-200">
          <button
            type="button"
            onClick={retroceder}
            disabled={index === 0}
            aria-label="Parada anterior"
            className="w-14 h-14 flex items-center justify-center bg-white text-slate-800 rounded-xl shadow-sm disabled:opacity-25 active:scale-95 transition-all cursor-pointer border-2 border-slate-200"
          >
            <ChevronLeft size={26} strokeWidth={2.5} />
          </button>
          <div className="text-center">
            <p className="text-red-600 text-xs font-black uppercase tracking-widest">Parada</p>
            <p className="text-slate-900 text-2xl font-black leading-none">
              {index + 1}<span className="text-slate-400 font-semibold text-lg"> / {pedidos.length}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={avanzar}
            disabled={index === pedidos.length - 1}
            aria-label="Parada siguiente"
            className="w-14 h-14 flex items-center justify-center bg-white text-slate-800 rounded-xl shadow-sm disabled:opacity-25 active:scale-95 transition-all cursor-pointer border-2 border-slate-200"
          >
            <ChevronRight size={26} strokeWidth={2.5} />
          </button>
        </div>

        <div
          className={`grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 flex-1 transition-all duration-200 ease-out ${
            slideVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
          }`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-1">
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Cliente / Horario</p>

                  <button
                    type="button"
                    onClick={abrirModalEdicion}
                    onPointerDown={startEditPress}
                    onPointerUp={stopEditPress}
                    onPointerLeave={stopEditPress}
                    onPointerCancel={stopEditPress}
                    onContextMenu={prevenirMenuContextual}
                    onDragStart={prevenirMenuContextual}
                    className="no-ios-callout relative overflow-hidden bg-slate-100 px-2.5 py-1 rounded-lg text-slate-700 active:scale-90 transition-transform cursor-pointer shadow-sm border border-slate-300 hover:bg-slate-200 flex items-center gap-1 select-none"
                    style={ESTILO_PULSACION_LARGA}
                    aria-label="Editar parada y productos"
                  >
                    <div
                      className="absolute bottom-0 left-0 h-full bg-slate-300 transition-all pointer-events-none"
                      style={{ width: `${editProgress}%` }}
                    />
                    <Pencil size={11} className="relative z-10 pointer-events-none" />
                    <span className="text-[10px] font-black uppercase tracking-wider relative z-10 pointer-events-none">Editar</span>
                  </button>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 leading-tight tracking-tight break-words">
                  {pedidoActual?.cliente?.startsWith('569') ? 'Cliente Web' : (pedidoActual?.cliente || 'Cliente')}
                </h2>
                {pedidoActual?.telefono && (
                  <a
                    href={`tel:+${pedidoActual.telefono}`}
                    className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    <Phone size={13} /> {formatearTelefonoVisual(pedidoActual.telefono)}
                  </a>
                )}
              </div>
              <BotonRayo
                presionando={presionando}
                onPointerDown={iniciarRayoTodo}
                onPointerUp={detenerRayoTodo}
              />
            </div>

            {pedidoActual?.nombre_cliente ? (
              <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-200 flex items-center gap-3 shadow-sm">
                <div className="bg-slate-200 p-2 rounded-xl shrink-0"><User size={16} className="text-slate-700" /></div>
                <p className="font-black text-slate-900 text-base leading-snug truncate">{pedidoActual.nombre_cliente}</p>
              </div>
            ) : null}

            <div className="bg-slate-50 p-4 rounded-2xl border-2 border-slate-200 flex items-start gap-3">
              <div className="bg-red-100 p-2 rounded-xl shrink-0"><MapPin size={16} className="text-red-600" /></div>
              <p className="text-sm font-bold text-slate-900 leading-snug">{pedidoActual?.direccion}</p>
            </div>

            {modo === 'reparto' && (
              <>
                <button
                  type="button"
                  onClick={() => abrirNavegacion(pedidoActual?.direccion)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white h-[60px] rounded-2xl font-black flex justify-center items-center gap-3 active:scale-[0.98] transition-all text-sm shadow-md cursor-pointer group"
                >
                  <Map size={20} className="group-active:scale-110 transition-transform" />
                  NAVEGAR CON MAPS
                </button>

                <div className="bg-slate-50 p-4 sm:p-5 rounded-3xl border-2 border-slate-300 shadow-sm">
                  {/* Fila 1: ETA y Salida */}
                  <div className="flex gap-2.5 mb-3.5">
                    <div className="relative shrink-0">
                      <input
                        type="number"
                        value={eta}
                        onChange={(e) => setEta(e.target.value)}
                        placeholder="–"
                        aria-label="Minutos estimados de llegada"
                        className="w-[68px] h-[52px] text-center font-black bg-white border-2 border-slate-300 rounded-2xl outline-none text-slate-900 focus:border-red-600 transition-colors text-lg shadow-sm"
                      />
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-slate-200 text-[9px] px-2 py-0.5 font-black text-slate-700 rounded-full tracking-wider border border-slate-300">
                        MIN
                      </span>
                    </div>

                    {pedidoActual?.telefono ? (
                      <button
                        type="button"
                        onClick={enviarAvisoCliente}
                        disabled={!eta}
                        className="flex-1 bg-[#25D366] hover:bg-[#20ba5a] text-white font-black h-[52px] rounded-2xl active:scale-[0.97] transition-all flex items-center justify-center text-xs gap-2 shadow-wa disabled:opacity-40 disabled:saturate-0 cursor-pointer tracking-wider hover:brightness-105"
                      >
                        <MessageCircle size={16} /> AVISAR SALIDA
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={pedirTelefonoAdmin}
                        className="flex-1 bg-amber-100 hover:bg-amber-200 text-amber-950 border-2 border-amber-300 font-black h-[52px] rounded-2xl active:scale-[0.97] transition-all flex items-center justify-center text-xs gap-2 shadow-sm cursor-pointer tracking-wider"
                      >
                        <MessageCircle size={16} /> PEDIR TELÉFONO
                      </button>
                    )}
                  </div>

                  {/* Fila 2: Respuestas Rápidas WhatsApp y Foto Entrega */}
                  {pedidoActual?.telefono && (
                    <div className="mb-3.5">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <MessageCircle size={12} className="text-[#25D366]" /> Respuestas rápidas WhatsApp
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        <button
                          type="button"
                          onClick={enviarMensajeTrafico}
                          className="bg-white border-2 border-slate-300 hover:border-[#25D366] hover:bg-emerald-50 text-slate-800 font-bold py-2.5 px-2 rounded-xl text-xs active:scale-[0.97] transition-all text-center shadow-sm cursor-pointer whitespace-nowrap flex items-center justify-center min-w-0"
                        >
                          Tráfico
                        </button>
                        <button
                          type="button"
                          onClick={enviarMensajeAfuera}
                          className="bg-white border-2 border-slate-300 hover:border-[#25D366] hover:bg-emerald-50 text-slate-800 font-bold py-2.5 px-2 rounded-xl text-xs active:scale-[0.97] transition-all text-center shadow-sm cursor-pointer whitespace-nowrap flex items-center justify-center min-w-0"
                        >
                          Afuera
                        </button>
                        <button
                          type="button"
                          onClick={enviarMensajeRecepcion}
                          className="bg-white border-2 border-slate-300 hover:border-[#25D366] hover:bg-emerald-50 text-slate-800 font-bold py-2.5 px-2 rounded-xl text-xs active:scale-[0.97] transition-all text-center shadow-sm cursor-pointer whitespace-nowrap flex items-center justify-center min-w-0"
                        >
                          Recepción
                        </button>
                        <button
                          type="button"
                          onClick={abrirFotoEntrega}
                          className="bg-white border-2 border-slate-300 hover:border-[#25D366] hover:bg-emerald-50 text-slate-800 font-bold py-2.5 px-2 rounded-xl text-xs active:scale-[0.97] transition-all text-center shadow-sm cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 min-w-0"
                          title="Abrir chat para enviar foto de comprobante de entrega"
                        >
                          <Camera size={13} className="text-emerald-700 shrink-0" />
                          <span>Foto Entrega</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Fila 3: Llamada Directa y Aviso Admin */}
                  <div className="flex gap-2">
                    {pedidoActual?.telefono && (
                      <button
                        type="button"
                        onClick={llamarCliente}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-xl text-xs active:scale-[0.97] transition-all cursor-pointer tracking-wider flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <PhoneCall size={14} /> LLAMAR DIRECTO
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={avisarAdmin}
                      className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black py-3 rounded-xl text-xs border border-slate-300 active:scale-[0.97] transition-all cursor-pointer tracking-wider shadow-sm text-center"
                    >
                      INFORMAR ADMIN
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="hidden lg:block mt-auto">
              <BotonPrincipalAccion
                modo={modo}
                todoCargado={todoCargado}
                intentarComenzarRuta={intentarComenzarRuta}
                esUltimaParada={index === pedidos.length - 1}
                todosSacadosParada={todosSacadosParada}
                finalizarRuta={finalizarRuta}
                onAvanzarParada={() => { avanzar(); setEta(''); }}
              />
            </div>
          </div>

          <div className="flex flex-col">
            {/* Badge de Bultos Por Parada (En Ruta) */}
            {modo === 'reparto' && (
              <div className="bg-amber-100 border-2 border-amber-400 text-amber-950 font-black text-xs sm:text-sm px-4 py-2.5 rounded-2xl mb-3 flex items-center justify-between shadow-sm animate-fade-in">
                <div className="flex items-center gap-2">
                  <Package size={18} className="text-amber-800 shrink-0" />
                  <span>Bultos parada: <strong>{bultosParadaActual} cajas</strong></span>
                </div>
                <span className="text-[11px] font-bold bg-white/90 px-2 py-0.5 rounded-lg border border-amber-300 shrink-0">
                  {bultosEntregadosParada}/{bultosParadaActual} entregadas
                </span>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${modo === 'carga' ? 'bg-emerald-600' : 'bg-red-600'}`} />
                <h3 className={`text-[11px] font-black uppercase tracking-widest ${modo === 'carga' ? 'text-emerald-800' : 'text-red-700'}`}>
                  {modo === 'carga' ? 'Verificar en cocina:' : 'Entregar estos ítems:'}
                </h3>
              </div>
              <button
                type="button"
                onClick={abrirModalEdicion}
                className="text-[11px] font-black text-slate-600 hover:text-red-600 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus size={13} /> Editar / Agregar
              </button>
            </div>

            <div className="flex flex-col space-y-2.5 pb-4">
              {(pedidoActual?.items || []).map((it, i) => {
                const activo = modo === 'carga' ? it.marcado : it.sacado;
                const lineasItem = String(it.nombre || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                const tituloPrincipal = lineasItem[0] || it.nombre;
                const subLineas = lineasItem.slice(1);
                const cantBultos = Number(it.cantidad) || 1;

                return (
                  <label
                    key={`${i}-${tituloPrincipal}`}
                    className={`
                      flex items-start p-4 sm:p-5 rounded-2xl border-2
                      transition-all duration-200 ease-out cursor-pointer active:scale-[0.98]
                      ${
                        modo === 'carga'
                          ? activo
                            ? 'bg-emerald-50 border-emerald-400 shadow-sm'
                            : 'bg-white border-slate-200 shadow-card hover:border-slate-300'
                          : activo
                            ? 'bg-red-50 border-red-400 shadow-sm'
                            : 'bg-white border-slate-200 shadow-card hover:border-slate-300'
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(activo)}
                      onChange={() => toggleCaja(i)}
                      className={`w-6 h-6 rounded-lg border-2 mr-4 mt-0.5 shrink-0 ${
                        modo === 'carga' ? 'accent-emerald-600' : 'accent-red-600'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-base sm:text-lg font-bold leading-tight transition-all duration-200 break-words ${
                            activo ? 'line-through opacity-45 text-slate-500' : 'text-slate-900'
                          }`}
                        >
                          {tituloPrincipal}
                        </span>
                        {cantBultos > 1 && (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border shrink-0 ${
                            activo
                              ? 'bg-slate-100 text-slate-400 border-slate-200'
                              : 'bg-slate-100 text-slate-700 border-slate-300'
                          }`}>
                            {cantBultos} cajas
                          </span>
                        )}
                      </div>

                      {subLineas.length > 0 && (
                        <div
                          className={`mt-2 pl-3 border-l-2 space-y-1 ${
                            activo
                              ? 'border-slate-300 opacity-50'
                              : modo === 'carga'
                                ? 'border-emerald-400'
                                : 'border-red-400'
                          }`}
                        >
                          {subLineas.map((sub, idxSub) => (
                            <p
                              key={idxSub}
                              className={`text-xs sm:text-sm font-semibold leading-snug ${
                                activo ? 'line-through text-slate-500' : 'text-slate-700'
                              }`}
                            >
                              {sub}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    {activo && (
                      <CheckCircle2
                        size={18}
                        className={`ml-3 mt-0.5 shrink-0 transition-all ${
                          modo === 'carga' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      />
                    )}
                  </label>
                );
              })}
            </div>

            <div className="lg:hidden mt-4 pt-2">
              <BotonPrincipalAccion
                modo={modo}
                todoCargado={todoCargado}
                intentarComenzarRuta={intentarComenzarRuta}
                esUltimaParada={index === pedidos.length - 1}
                todosSacadosParada={todosSacadosParada}
                finalizarRuta={finalizarRuta}
                onAvanzarParada={() => { avanzar(); setEta(''); }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
