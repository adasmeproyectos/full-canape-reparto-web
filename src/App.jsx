import { useState, useRef, useEffect } from 'react';
import { procesarPedidos } from './lib/gemini';
import { supabase } from './lib/supabase';
import { 
  ChevronLeft, ChevronRight, Package, MapPin, Loader2, CheckCircle2, 
  Map, Zap, Truck, Home, Phone, MessageCircle, RefreshCcw, ListOrdered, 
  X, ArrowUp, ArrowDown, AlertTriangle, Pencil, Save, Clock, ChevronDown 
} from 'lucide-react';

const getMemoria = (clave, valorPorDefecto) => {
  try {
    const guardado = localStorage.getItem(clave);
    return guardado !== null ? JSON.parse(guardado) : valorPorDefecto;
  } catch {
    return valorPorDefecto;
  }
};

function App() {
  const [input, setInput]           = useState(() => getMemoria('fc_input', ""));
  const [pedidos, setPedidos]       = useState(() => getMemoria('fc_pedidos', []));
  const [historial, setHistorial]   = useState(() => getMemoria('fc_historial', null));
  const [cargando, setCargando]     = useState(false);
  const [index, setIndex]           = useState(() => getMemoria('fc_index', 0));
  const [modo, setModo]             = useState(() => getMemoria('fc_modo', 'carga'));
  const [eta, setEta]               = useState(() => getMemoria('fc_eta', ""));
  const [presionando, setPresionando] = useState(false);
  const [absorbiendo, setAbsorbiendo] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [resetProgress, setResetProgress] = useState(0);

  // --- ESTADO FASE 1: Alerta Modal Multicontrol ---
  const [alertaSinTelefono, setAlertaSinTelefono] = useState(null);
  const [modalEditId, setModalEditId] = useState(null);
  const [modalEditPhone, setModalEditPhone] = useState('');

  // --- ESTADOS FASE 2: MODO LÁPIZ ---
  const [modoEdicion, setModoEdicion] = useState(false);
  const [formEdicion, setFormEdicion] = useState({ cliente: '', telefono: '', direccion: '' });
  const [editProgress, setEditProgress] = useState(0);
  const editTimer = useRef(null);

  // --- ESTADOS FASE 3: ANIMACIÓN Y ACORDEÓN ---
  const [animatingMover, setAnimatingMover] = useState(null);
  const [expandedAdminId, setExpandedAdminId] = useState(null);

  // --- ESTADOS ADMIN "FILTRO FANTASMA" ---
  const [hiddenRutas, setHiddenRutas] = useState(() => getMemoria('fc_hidden_rutas', {}));
  const [hideProgress, setHideProgress] = useState({ id: null, progress: 0 });
  const hideTimer = useRef(null);

  const pressTimer  = useRef(null);
  const resetTimer  = useRef(null);

  // --- ESTADOS SUPABASE Y ADMIN ---
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminProgress, setAdminProgress] = useState(0);
  const [rutasEnVivo, setRutasEnVivo] = useState([]);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [adminError, setAdminError] = useState(null);
  const adminTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem('fc_input',        JSON.stringify(input));
    localStorage.setItem('fc_pedidos',      JSON.stringify(pedidos));
    localStorage.setItem('fc_historial',    JSON.stringify(historial));
    localStorage.setItem('fc_index',        JSON.stringify(index));
    localStorage.setItem('fc_modo',         JSON.stringify(modo));
    localStorage.setItem('fc_eta',          JSON.stringify(eta));
    localStorage.setItem('fc_hidden_rutas', JSON.stringify(hiddenRutas));
  }, [input, pedidos, historial, index, modo, eta, hiddenRutas]);

  // --- LÓGICA DE SINCRONIZACIÓN EN LA NUBE ---
  const sincronizarConNube = async () => {
    if (pedidos.length === 0) return;
    
    if (!supabase) {
      console.error("❌ SUPABASE APAGADO: Vite no está leyendo tu archivo .env");
      return;
    }

    try {
      const { data, error } = await supabase.from('monitoreo_rutas').upsert({
        id: sessionId,
        nombre_repartidor: "Repartidor " + sessionId.substring(0,3).toUpperCase(),
        progreso_actual: index,
        total_pedidos: pedidos.length,
        pedidos_json: pedidos,
        ultima_actualizacion: new Date().toISOString(),
        esta_activo: modo !== 'fin'
      });

      if (error) {
        console.error("❌ ERROR DE SUPABASE RECHAZANDO EL DATO:", error.message, error.details);
      } else {
        console.log("✅ DATO ENVIADO A LA NUBE CON ÉXITO");
      }
    } catch (e) { 
      console.error("❌ Error de red intentando conectar a la nube:", e); 
    }
  };

  useEffect(() => {
    sincronizarConNube();
  }, [index, pedidos, modo]);

  // --- LÓGICA DEL MODO DIOS (ADMIN) ---
  const cargarRutasEnVivo = async () => {
    if (!supabase) {
      setAdminError("Sin conexión a la nube.");
      return;
    }
    setLoadingAdmin(true);
    setAdminError(null);
    try {
      // Filtramos estrictamente las últimas 48h para evitar timeouts
      // y solicitamos solo las columnas necesarias (no SELECT *)
      const fechaLimite = new Date();
      fechaLimite.setHours(fechaLimite.getHours() - 48);

      // AbortController para cortar la consulta si tarda más de 8 segundos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const { data, error } = await supabase
        .from('monitoreo_rutas')
        .select('id, nombre_repartidor, progreso_actual, total_pedidos, pedidos_json, ultima_actualizacion, esta_activo')
        .gte('ultima_actualizacion', fechaLimite.toISOString())
        .eq('esta_activo', true)
        .order('ultima_actualizacion', { ascending: false })
        .limit(20)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);

      if (error) {
        console.error("❌ Error radar:", error.message);
        setAdminError("Error al cargar datos. Intenta de nuevo.");
      } else if (data) {
        console.log(`✅ Radar: ${data.length} ruta(s) activa(s) recibidas.`);
        setRutasEnVivo(data);
      }
    } catch(e) {
      if (e.name === 'AbortError') {
        setAdminError("Tiempo de espera agotado. Verifica tu conexión.");
      } else {
        setAdminError("Error de red inesperado.");
      }
      console.error("❌ Error cargarRutasEnVivo:", e);
    } finally {
      setLoadingAdmin(false);
    }
  };

  const startAdmin = () => {
    adminTimer.current = setInterval(() => {
      setAdminProgress(prev => {
        if (prev >= 100) {
          clearInterval(adminTimer.current);
          cargarRutasEnVivo();
          setShowAdmin(true);
          return 0;
        }
        return prev + 5;
      });
    }, 50);
  };
  const stopAdmin = () => { clearInterval(adminTimer.current); setAdminProgress(0); };

  // --- LÓGICA FILTRO FANTASMA (Ocultar Repartidor) ---
  const startHide = (id) => {
    setHideProgress({ id, progress: 0 });
    hideTimer.current = setInterval(() => {
      setHideProgress(prev => {
        if (prev.progress >= 100) {
          clearInterval(hideTimer.current);
          setHiddenRutas(h => ({ ...h, [id]: Date.now() })); // Guardamos la hora de ocultamiento
          return { id: null, progress: 0 };
        }
        return { id, progress: prev.progress + 5 };
      });
    }, 40);
  };
  
  const stopHide = () => {
    clearInterval(hideTimer.current);
    setHideProgress({ id: null, progress: 0 });
  };
  
  const handleProcesar = async () => {
    setCargando(true);
    try {
      const data = await procesarPedidos(input);
      const preparar = (ruta) => ruta.map(p => ({
        ...p,
        id: Math.random().toString(36).substring(2, 9), // 🪪 Carnet de Identidad oculto para que no se maree la UI
        items: p.items.map(i => ({ nombre: i, marcado: false, sacado: false, entrega_at: null }))
      }));
      if (data.pedidos && data.pedidos.length > 0) {
        const nuevosPedidos = preparar(data.pedidos);
        setHistorial(nuevosPedidos); 
        setPedidos(nuevosPedidos);
        setIndex(0);
        setModo('carga');
      } else {
        alert("No se encontraron pedidos válidos en el texto.");
      }
    } catch (error) {
      console.error(error);
      alert("Error al procesar. Revisa el formato del texto.");
    }
    setCargando(false);
  };

  const restaurarUltima = () => {
    if (historial && historial.length > 0) {
      setPedidos(JSON.parse(JSON.stringify(historial))); 
      setIndex(0);
      setModo('carga');
    }
  };

  const startReset = () => {
    resetTimer.current = setInterval(() => {
      setResetProgress(prev => {
        if (prev >= 100) { clearInterval(resetTimer.current); limpiarTodo(); return 0; }
        return prev + 5;
      });
    }, 50);
  };
  const stopReset = () => { clearInterval(resetTimer.current); setResetProgress(0); };

  const limpiarTodo = () => {
    ['fc_input','fc_pedidos','fc_index','fc_modo','fc_eta'].forEach(k => localStorage.removeItem(k));
    setPedidos([]); setInput(""); setIndex(0); setModo('carga'); setEta("");
  };

  // --- LÓGICA MODO SPOTIFY (FASE 3 - CORREGIDA) ---
  const moverPedido = (from, to) => {
    const nuevos = [...pedidos];
    const [removido] = nuevos.splice(from, 1);
    nuevos.splice(to, 0, removido);
    setPedidos(nuevos);
  };

  const moverPedidoConAnimacion = (from, to) => {
    if (animatingMover) return;
    setAnimatingMover({ from, to });
    
    setTimeout(() => {
      moverPedido(from, to);
      setAnimatingMover(null); // Al borrar esto, el CSS se apaga justo cuando la tarjeta cae en su nueva posición física
    }, 300);
  };

  // --- NUEVAS FUNCIONES OPERATIVAS (FASE 1) ---
  const pedirTelefonoAdmin = () => {
    const numAdmin = "56988589058";
    const msj = `Necesito el número de teléfono de ${pedidoActual.direccion}`;
    window.open(`https://wa.me/${numAdmin}?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const intentarComenzarRuta = () => {
    // Escaneamos toda la lista y guardamos el índice real de cada pedido sin teléfono
    const faltan = pedidos.map((p, i) => ({ ...p, originalIndex: i })).filter(p => !p.telefono);
    if (faltan.length > 0) {
      setAlertaSinTelefono(faltan); // Array completo
    } else {
      cambiarAModoReparto();
    }
  };

  // Lógica para guardar un teléfono desde adentro del modal
  const guardarTelefonoModal = (idx) => {
    const nuevos = [...pedidos];
    nuevos[idx].telefono = modalEditPhone;
    setPedidos(nuevos);
    setModalEditId(null);
    setModalEditPhone('');
    
    // Filtramos la lista del modal para quitar el que acabamos de arreglar
    const restantes = alertaSinTelefono.filter(item => item.originalIndex !== idx);
    if (restantes.length === 0) {
      // Si ya no quedan errores, cerramos el modal y salimos a ruta automáticamente
      setAlertaSinTelefono(null);
      cambiarAModoReparto();
    } else {
      setAlertaSinTelefono(restantes);
    }
  };

  // --- NUEVAS FUNCIONES FASE 2: MODO LÁPIZ ---
  const startEditPress = () => {
    editTimer.current = setInterval(() => {
      setEditProgress(prev => {
        if (prev >= 100) {
          clearInterval(editTimer.current);
          setFormEdicion({ 
            cliente: pedidos[index]?.cliente || '', 
            telefono: pedidos[index]?.telefono || '', 
            direccion: pedidos[index]?.direccion || '' 
          });
          setModoEdicion(true);
          return 0;
        }
        return prev + 5;
      });
    }, 40);
  };
  
  const stopEditPress = () => {
    clearInterval(editTimer.current);
    setEditProgress(0);
  };

  const guardarEdicion = () => {
    const nuevos = [...pedidos];
    nuevos[index] = { ...nuevos[index], ...formEdicion };
    setPedidos(nuevos);
    setModoEdicion(false);
  };

  const enviarAvisoCliente = () => {
    const min  = eta || "unos";
    const texto = `¡Hola! 🥨 Le habla el repartidor de Full Canapé. Ya voy en camino a su dirección. Llego aproximadamente en ${min} minutos. ¡Nos vemos pronto! 🚚✨`;
    window.open(`https://wa.me/${pedidoActual.telefono}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  const enviarAvisoLlegada = () => {
    const texto = `¡Hola! 👋 Ya estoy llegando a su domicilio. Por favor, esté atento/a para recibir su pedido. ¡Muchas gracias! 🚚✨`;
    window.open(`https://wa.me/${pedidoActual.telefono}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  const avisarAdmin = () => {
    const numAdmin = "56988589058";
    const dir = pedidoActual.direccion;
    const msj = index === 0
      ? `Saliendo! ${eta} min a ${dir}`
      : `Entregado ${pedidos[index - 1].direccion}. Ahora ${eta} min a ${dir}`;
    window.open(`https://wa.me/${numAdmin}?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const abrirMapa = (dir) => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}`, '_blank');
  
  const finalizarRuta = () => { setAbsorbiendo(true); setTimeout(() => { setModo('fin'); setAbsorbiendo(false); }, 800); };
  
  const toggleCaja  = (i) => {
    const n = [...pedidos];
    if (modo === 'carga') {
      n[index].items[i].marcado = !n[index].items[i].marcado;
    } else {
      n[index].items[i].sacado  = !n[index].items[i].sacado;
      n[index].items[i].entrega_at = n[index].items[i].sacado ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    }
    setPedidos(n);
  };
  
  const cambiarAModoReparto = () => { setIndex(0); setEta(""); setModo('reparto'); };
  const avanzar   = () => setIndex(i => Math.min(pedidos.length - 1, i + 1));
  const retroceder = () => setIndex(i => Math.max(0, i - 1));
  const todoCargado = pedidos.length > 0 && pedidos.every(p => p.items.every(it => it.marcado));

  const BotonRayo = () => (
    <button
      onPointerDown={() => {
        setPresionando(true);
        pressTimer.current = setTimeout(() => {
          const n = [...pedidos];
          n[index].items.forEach(it => {
            if (modo === 'carga') {
              it.marcado = true;
            } else {
              it.sacado = true;
              it.entrega_at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
          });
          setPedidos(n); setPresionando(false);
        }, 800);
      }}
      onPointerUp={() => { setPresionando(false); clearTimeout(pressTimer.current); }}
      onPointerLeave={() => { setPresionando(false); clearTimeout(pressTimer.current); }}
      aria-label="Marcar todo (mantén presionado)"
      className="relative overflow-hidden bg-stone-100 w-[72px] h-[72px] rounded-3xl flex flex-col items-center justify-center border-2 border-stone-200 active:scale-90 transition-transform duration-150 select-none touch-none shrink-0 cursor-pointer shadow-card"
      style={{ WebkitUserSelect: 'none' }}
    >
      <div
        className="absolute bottom-0 left-0 w-full bg-emerald-400 transition-all ease-linear rounded-b-2xl"
        style={{ height: presionando ? '100%' : '0%', transitionDuration: presionando ? '800ms' : '200ms' }}
      />
      <Zap size={22} className={`relative z-10 transition-colors ${presionando ? 'text-white' : 'text-stone-400'}`} />
      <span className={`text-[9px] font-black relative z-10 transition-colors mt-1 tracking-wider ${presionando ? 'text-white' : 'text-stone-400'}`}>
        TODO
      </span>
    </button>
  );

  const BotonPrincipalAccion = () => (
    <div className="pt-5 border-t border-stone-100 bg-white w-full">
      {modo === 'carga' ? (
        <button
          onClick={intentarComenzarRuta}
          disabled={!todoCargado}
          aria-label={todoCargado ? 'Comenzar ruta' : 'Faltan cajas por marcar'}
          className={`
            w-full h-[68px] rounded-3xl font-black text-sm sm:text-base text-white
            transition-all duration-200 flex items-center justify-center gap-3 cursor-pointer
            ${todoCargado
              ? 'bg-emerald-500 active:scale-[0.97] shadow-[0_4px_12px_rgba(16,185,129,0.3),0_8px_24px_rgba(16,185,129,0.2)]'
              : 'bg-stone-300 cursor-not-allowed'}
          `}
        >
          {todoCargado
            ? <><CheckCircle2 size={20} /> ¡TODO LISTO! COMENZAR RUTA</>
            : <><Package size={20} /> FALTAN CAJAS POR MARCAR</>}
        </button>
      ) : (
        <button
          onClick={index === pedidos.length - 1 ? finalizarRuta : () => { avanzar(); setEta(""); }}
          disabled={!pedidoActual.items.every(it => it.sacado)}
          aria-label={index === pedidos.length - 1 ? 'Terminar ruta' : 'Siguiente entrega'}
          className="
            w-full h-[68px] bg-stone-900 text-white rounded-3xl font-black text-sm sm:text-base
            active:scale-[0.97] transition-all duration-200 disabled:opacity-40
            shadow-dark flex items-center justify-center gap-3 cursor-pointer
          "
        >
          <Truck size={20} />
          {index === pedidos.length - 1 ? 'TERMINAR RUTA' : 'ENTREGADO — SIGUIENTE'}
        </button>
      )}
    </div>
  );

  if (showAdmin) {
    // Filtro Fantasma: solo mostramos rutas no ocultadas o con actividad posterior al ocultamiento
    const rutasVisibles = rutasEnVivo.filter(ruta => {
      const hiddenAt = hiddenRutas[ruta.id];
      if (!hiddenAt) return true;
      const updatedAt = new Date(ruta.ultima_actualizacion).getTime();
      return updatedAt > hiddenAt;
    });

    return (
      <div
        className="min-h-screen bg-stone-950 flex flex-col relative max-w-xl mx-auto text-white"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.5rem, env(safe-area-inset-right))'
        }}
      >
        {/* Header Admin */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-dot inline-block" />
              <p className="text-red-500 text-xs font-black uppercase tracking-widest">Radar en vivo</p>
            </div>
            <h2 className="text-white text-3xl font-black tracking-tight">PANEL ADMIN</h2>
          </div>
          <button
            onClick={() => setShowAdmin(false)}
            className="bg-white/10 p-3 rounded-2xl text-white hover:bg-white/20 active:scale-90 transition-all duration-150 cursor-pointer"
            aria-label="Cerrar panel admin"
          >
            <X size={20} />
          </button>
        </div>

        {/* Botón actualizar */}
        <button
          onClick={cargarRutasEnVivo}
          disabled={loadingAdmin}
          className="mb-5 flex items-center justify-center gap-2 w-full bg-white/5 border border-white/10 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 active:scale-95 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-wait"
        >
          <RefreshCcw size={14} className={loadingAdmin ? 'animate-spin' : ''} />
          {loadingAdmin ? 'Cargando...' : 'Actualizar Radar'}
        </button>

        {/* Estado de error */}
        {adminError && (
          <div className="mb-4 flex items-center gap-3 bg-red-950/60 border border-red-800 text-red-300 text-xs font-bold p-4 rounded-2xl animate-fade-in">
            <AlertTriangle size={16} className="shrink-0 text-red-400" />
            {adminError}
          </div>
        )}

        {/* Lista de rutas */}
        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          {loadingAdmin && rutasEnVivo.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-16 gap-4 text-stone-500">
              <Loader2 size={32} className="animate-spin" />
              <p className="text-sm font-bold">Conectando con el radar...</p>
            </div>
          ) : rutasVisibles.length === 0 ? (
            <div className="flex flex-col items-center mt-16 text-center gap-3">
              <div className="bg-stone-900 p-6 rounded-3xl">
                <Truck size={40} className="text-stone-700 mb-2" />
              </div>
              <p className="text-stone-500 font-bold">No hay repartidores activos</p>
              <p className="text-stone-600 text-xs font-semibold">en las últimas 48 horas</p>
            </div>
          ) : (
            rutasVisibles.map(ruta => {
              const porcentaje = Math.round((ruta.progreso_actual / ruta.total_pedidos) * 100) || 0;
              const horasPasadas = (new Date() - new Date(ruta.ultima_actualizacion)) / (1000 * 60 * 60);
              const isStale = horasPasadas > 12;
              const isExpanded = expandedAdminId === ruta.id;

              return (
                <div
                  key={ruta.id}
                  className={`bg-stone-900 rounded-3xl border transition-all duration-300 ${
                    isStale ? 'border-amber-700/70' : 'border-white/8'
                  }`}
                >
                  {/* Cabecera acordeón */}
                  <div
                    className="flex justify-between items-center cursor-pointer select-none p-5"
                    onClick={() => setExpandedAdminId(isExpanded ? null : ruta.id)}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <h3 className="font-black text-base flex items-center gap-2 truncate">
                        {!isStale && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot shrink-0" />}
                        {ruta.nombre_repartidor}
                        {isStale && <Clock size={14} className="text-amber-500 shrink-0" />}
                      </h3>

                      {/* Barra de progreso */}
                      <div className="mt-2.5 flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${porcentaje}%`,
                              backgroundColor: porcentaje === 100 ? '#10b981' : '#ef4444'
                            }}
                          />
                        </div>
                        <span className="text-[11px] font-black text-stone-400 shrink-0">
                          {ruta.progreso_actual}/{ruta.total_pedidos}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <ChevronDown
                        size={18}
                        className={`text-stone-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                      {/* Botón ocultar (mantener presionado) */}
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); startHide(ruta.id); }}
                        onPointerUp={(e) => { e.stopPropagation(); stopHide(); }}
                        onPointerLeave={(e) => { e.stopPropagation(); stopHide(); }}
                        className="relative overflow-hidden bg-white/8 p-2 rounded-xl text-stone-500 active:scale-90 transition-transform"
                        style={{ WebkitUserSelect: 'none', touchAction: 'none' }}
                        aria-label="Mantén para ocultar repartidor"
                      >
                        <div
                          className="absolute bottom-0 left-0 h-full bg-red-500 transition-all ease-linear"
                          style={{ width: hideProgress.id === ruta.id ? `${hideProgress.progress}%` : '0%' }}
                        />
                        <X size={14} className="relative z-10" />
                      </button>
                    </div>
                  </div>

                  {/* Detalle acordeón */}
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="px-5 pb-5 pt-1 border-t border-white/8">
                      <div className="space-y-2.5 mt-4">
                        {(ruta.pedidos_json || []).map((p, i) => {
                          const entregado = Array.isArray(p.items) && p.items.some(it => it.sacado);
                          const horaEntrega = Array.isArray(p.items) && p.items.find(it => it.sacado)?.entrega_at;
                          const esCurrent = i === ruta.progreso_actual;
                          return (
                            <div
                              key={i}
                              className={`flex justify-between items-center p-3 rounded-2xl border transition-colors ${
                                esCurrent
                                  ? 'bg-red-600/15 border-red-600/30'
                                  : entregado
                                    ? 'bg-emerald-950/30 border-emerald-900/20'
                                    : 'bg-black/20 border-white/5'
                              }`}
                            >
                              <div className="min-w-0 pr-3">
                                <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${
                                  esCurrent ? 'text-red-400' : entregado ? 'text-emerald-600' : 'text-stone-600'
                                }`}>
                                  {esCurrent ? '▶ EN CAMINO' : `Parada ${i + 1}`}
                                </p>
                                <p className="text-sm font-bold text-stone-300 truncate">{p.direccion}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                {entregado
                                  ? <span className="text-emerald-400 font-black text-sm">{horaEntrega || '✓'}</span>
                                  : <span className="text-stone-600 font-black text-[10px] uppercase">Pendiente</span>
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
            })
          )}
        </div>
      </div>
    );
  }

  if (modo === 'fin') {
    return (
      <div
        className="min-h-screen bg-white flex flex-col items-center justify-center text-stone-900 overflow-hidden relative"
        style={{
          paddingTop: 'max(2rem, env(safe-area-inset-top))',
          paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(2rem, env(safe-area-inset-left))',
          paddingRight: 'max(2rem, env(safe-area-inset-right))'
        }}
      >
        <style>{`
          @keyframes truck-cross { 
            0% { transform: translateX(-150px); } 
            100% { transform: translateX(120vw); } 
          }
          @keyframes confetti-fall {
            0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
            100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
          }
        `}</style>

        {[...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute w-3 h-3 rounded-sm opacity-80 z-0"
            style={{
              backgroundColor: ['#ef4444','#10b981','#f59e0b','#3b82f6', '#8b5cf6'][i % 5],
              left: `${Math.random() * 100}%`,
              top: `-5%`,
              animation: `confetti-fall ${Math.random() * 3 + 2}s linear infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}

        <div className="relative z-10 flex flex-col items-center w-full max-w-sm text-center animate-pop-in">
          <div className="bg-emerald-100 text-emerald-600 p-10 rounded-full mb-6 shadow-card">
            <CheckCircle2 size={80} strokeWidth={1.5} />
          </div>
          
          <h1 className="text-5xl font-black mb-1 tracking-tight">¡RUTA</h1>
          <h1 className="text-5xl font-black tracking-tight text-red-600 mb-8">COMPLETADA!</h1>
          
          <div className="w-full relative h-24 mb-10 flex items-center justify-center">
            <div className="absolute bottom-6 left-0 w-full h-0 border-t-4 border-dashed border-stone-200"></div>
            <div className="absolute bottom-[20px] left-0 flex items-center animate-[truck-cross_4s_infinite_linear] w-full">
              <Truck className="text-red-500 drop-shadow-md" size={48} strokeWidth={2} />
            </div>
          </div>

          <div className="flex flex-col gap-4 w-full">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("fundo el bosque 95, maipú")}`}
              className="bg-emerald-500 text-white h-[68px] rounded-3xl w-full font-black text-base sm:text-lg active:scale-[0.97] transition-all flex items-center justify-center gap-3 shadow-[0_4px_12px_rgba(16,185,129,0.3),0_8px_24px_rgba(16,185,129,0.2)] cursor-pointer tracking-wider"
            >
              <Home size={22} /> ¡VAMOS A CASA!
            </a>
            
            <button
              onClick={limpiarTodo}
              className="bg-stone-100 text-stone-700 h-[68px] rounded-3xl w-full font-black text-sm sm:text-base active:scale-95 transition-transform shadow-card cursor-pointer tracking-wider"
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
        className="min-h-screen bg-stone-50 flex flex-col justify-center max-w-xl mx-auto overflow-y-auto relative"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.5rem, env(safe-area-inset-right))'
        }}
      >
        <button
          onPointerDown={startAdmin}
          onPointerUp={stopAdmin}
          onPointerLeave={stopAdmin}
          className="absolute top-0 right-0 w-28 h-28 flex items-start justify-end cursor-pointer"
          style={{
            paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
            paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
            WebkitUserSelect: 'none',
            touchAction: 'none'
          }}
        >
          <div className="relative">
            <Zap size={22} className="text-stone-300" />
            <div className="absolute top-7 right-0 h-1 bg-red-500 transition-all duration-75 rounded-full" style={{ width: `${adminProgress}%` }} />
          </div>
        </button>
        <div className="mb-10 text-center flex flex-col items-center animate-slide-up mt-10">
          <img src="/logo.png" alt="Logo Full Canapé" className="w-32 h-auto mb-5 drop-shadow-md" />
          <h1 className="text-4xl font-black text-stone-900 tracking-tight leading-none">Full Canapé</h1>
          <p className="text-stone-400 font-semibold mt-2 text-sm tracking-wider uppercase">Sistema logístico de ruta</p>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: '60ms' }}>
          <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-3 pl-1">
            Pegar pedidos aquí
          </label>
          <textarea
            className="w-full h-52 p-5 bg-white rounded-3xl border-2 border-stone-200 mb-5 outline-none text-base resize-none font-medium text-stone-800 placeholder:text-stone-300 placeholder:font-normal focus:border-red-500 transition-colors duration-200 shadow-card"
            placeholder="Pega los pedidos aquí..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3 animate-slide-up" style={{ animationDelay: '120ms' }}>
          <button
            onClick={handleProcesar}
            disabled={cargando || !input.trim()}
            className={`h-[68px] rounded-3xl font-black text-base transition-all duration-200 cursor-pointer flex items-center justify-center gap-3 ${cargando || !input.trim() ? 'bg-stone-300 text-stone-500 cursor-not-allowed' : 'bg-red-600 text-white shadow-cta active:scale-[0.97]'}`}
          >
            {cargando ? <><Loader2 className="animate-spin" size={22} /> PROCESANDO...</> : <><Package size={22} /> CARGAR RUTA</>}
          </button>

          {historial && (
            <button
              onClick={restaurarUltima}
              className="h-[56px] rounded-3xl font-bold text-stone-600 bg-white border-2 border-stone-200 flex items-center justify-center gap-2 hover:bg-stone-50 transition-colors shadow-card cursor-pointer"
            >
              <RefreshCcw size={16} /> RESTAURAR ÚLTIMA CARGA
            </button>
          )}
        </div>
      </div>
    );
  }

  const pedidoActual = pedidos[index] || pedidos[0];

  return (
    <div
      className="min-h-screen bg-stone-100 flex flex-col relative max-w-7xl mx-auto"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))'
      }}
    >
      {/* CSS GLOBAL PARA EL JIGGLE MODE (MODO IOS) */}
      <style>{`
        @keyframes jiggle {
          0% { transform: rotate(-1deg); }
          50% { transform: rotate(1deg); }
          100% { transform: rotate(-1deg); }
        }
        .animate-jiggle {
          animation: jiggle 0.25s infinite ease-in-out;
        }
      `}</style>

      <div className={`fixed inset-0 bg-white z-[100] transition-all duration-700 pointer-events-none ${absorbiendo ? 'opacity-100 scale-150 rounded-none' : 'opacity-0 scale-0 rounded-full'}`} style={{ transformOrigin: 'bottom center' }} />

      {/* --- NUEVO MODAL MULTICONTROL DE TELÉFONOS --- */}
      {alertaSinTelefono && (
        <div className="fixed inset-0 bg-stone-950/80 z-[300] flex items-center justify-center p-4 sm:p-6 animate-pop-in">
          <div className="bg-white rounded-[2rem] p-6 max-w-sm w-full shadow-2xl flex flex-col max-h-[90vh]">
            
            <div className="flex flex-col items-center text-center mb-6 shrink-0">
              <div className="bg-amber-100 text-amber-600 p-4 rounded-full w-16 h-16 flex items-center justify-center mb-4">
                <AlertTriangle size={32} strokeWidth={2.5} />
              </div>
              <h3 className="text-2xl font-black text-stone-900 mb-2 leading-tight tracking-tight">Faltan Teléfonos</h3>
              <p className="text-stone-500 text-sm font-medium leading-relaxed">
                A las siguientes <strong className="text-stone-900">{alertaSinTelefono.length}</strong> paradas les falta el número:
              </p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 mb-6 pr-1">
              {alertaSinTelefono.map((p) => (
                <div key={p.originalIndex} className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                  <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Parada {p.originalIndex + 1}</p>
                  <p className="text-sm font-bold text-stone-800 leading-snug mb-3 truncate">{p.direccion}</p>
                  
                  {modalEditId === p.originalIndex ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={modalEditPhone}
                        onChange={e => setModalEditPhone(e.target.value)}
                        placeholder="Ej: 569..."
                        className="flex-1 bg-white border-2 border-stone-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-red-400"
                      />
                      <button onClick={() => guardarTelefonoModal(p.originalIndex)} className="bg-emerald-500 text-white p-2 rounded-xl shadow-sm active:scale-95 cursor-pointer">
                        <Save size={16} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setModalEditId(p.originalIndex); setModalEditPhone(''); }} className="w-full flex items-center justify-center gap-2 bg-white border-2 border-stone-200 text-stone-500 py-2 rounded-xl text-xs font-black hover:border-stone-300 active:scale-95 transition-all cursor-pointer">
                      <Pencil size={12} /> AGREGAR TELÉFONO
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={() => { setAlertaSinTelefono(null); cambiarAModoReparto(); }}
              className="w-full shrink-0 bg-stone-900 text-white h-[60px] rounded-2xl font-black text-sm active:scale-[0.97] transition-transform shadow-dark cursor-pointer tracking-wider"
            >
              CONTINUAR DE TODAS FORMAS
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-4 px-1">
        <button
          onPointerDown={startReset}
          onPointerUp={stopReset}
          onPointerLeave={stopReset}
          aria-label="Mantén presionado para reiniciar"
          className="relative overflow-hidden bg-white text-stone-500 px-5 py-3 rounded-2xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-all duration-150 select-none touch-none cursor-pointer shadow-card border border-stone-100"
          style={{ WebkitUserSelect: 'none' }}
        >
          <div className="absolute bottom-0 left-0 h-[3px] bg-red-500 transition-all duration-75 rounded-full" style={{ width: `${resetProgress}%` }} />
          <RefreshCcw size={14} className={resetProgress > 0 ? 'animate-spin' : ''} />
          <span className="tracking-wider">{resetProgress > 0 ? 'MANTÉN...' : 'REINICIAR'}</span>
        </button>

        <button
          onClick={() => setShowReorder(true)}
          className="bg-stone-900 text-white px-5 py-3 rounded-2xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-all duration-150 shadow-dark cursor-pointer hover:bg-stone-800"
        >
          <ListOrdered size={14} />
          <span className="tracking-wider">COLA DE REPARTO</span>
        </button>
      </div>

      {showReorder && (
        <div className="fixed inset-0 bg-stone-950/96 z-[200] p-6 flex flex-col overflow-y-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <p className="text-red-500 text-xs font-black uppercase tracking-widest mb-1">Ordenar paradas</p>
              <h2 className="text-white text-3xl font-black tracking-tight">COLA DE REPARTO</h2>
            </div>
            <button onClick={() => setShowReorder(false)} className="bg-white/10 p-3 rounded-2xl text-white hover:bg-white/20 transition-colors cursor-pointer">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 space-y-3 pb-8">
            {pedidos.map((p, i) => {
              const isMoving = animatingMover?.from === i;
              const isDisplaced = animatingMover?.to === i;

              const transClasses = animatingMover !== null ? "transition-all duration-300 ease-in-out" : "";
              let animClasses = "";

              if (isMoving) {
                const up = animatingMover.to < animatingMover.from;
                animClasses = `${up ? "-translate-y-[calc(100%+0.75rem)]" : "translate-y-[calc(100%+0.75rem)]"} z-20 scale-[1.03] shadow-2xl`;
              } else if (isDisplaced) {
                const up = animatingMover.from < animatingMover.to;
                animClasses = `${up ? "-translate-y-[calc(100%+0.75rem)]" : "translate-y-[calc(100%+0.75rem)]"} z-0 opacity-40 scale-[0.98]`;
              }

              return (
                <div key={p.id || p.cliente + p.direccion} className={`flex items-center p-5 rounded-3xl border-2 relative ${transClasses} ${i === index ? 'bg-red-600 border-red-400 shadow-cta' : 'bg-white/5 border-white/10 hover:bg-white/8'} ${animClasses}`}>
                  <div className="flex-1 pr-3 min-w-0">
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${i === index ? 'text-red-200' : 'text-white/40'}`}>
                      Parada {i + 1} {i === index && ' · EN CURSO'}
                    </p>
                    <p className="text-white font-bold leading-tight truncate">{p.direccion}</p>
                    <p className={`text-[11px] mt-1 font-semibold ${i === index ? 'text-red-200' : 'text-white/40'}`}>{p.cliente}</p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 relative z-30">
                    <button 
                      onClick={() => moverPedidoConAnimacion(i, i - 1)} 
                      disabled={i === 0 || animatingMover !== null} 
                      className="p-3 bg-white/10 rounded-xl disabled:opacity-20 hover:bg-white/20 transition-colors active:scale-90 cursor-pointer"
                    >
                      <ArrowUp size={16} className="text-white" />
                    </button>
                    <button 
                      onClick={() => moverPedidoConAnimacion(i, i + 1)} 
                      disabled={i === pedidos.length - 1 || animatingMover !== null} 
                      className="p-3 bg-white/10 rounded-xl disabled:opacity-20 hover:bg-white/20 transition-colors active:scale-90 cursor-pointer"
                    >
                      <ArrowDown size={16} className="text-white" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button onClick={() => setShowReorder(false)} className="sticky bottom-4 bg-white text-stone-900 py-5 rounded-[2rem] font-black text-lg w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)] active:scale-[0.97] transition-transform cursor-pointer">
            CONFIRMAR ORDEN
          </button>
        </div>
      )}

      <div className="bg-white p-1.5 rounded-2xl flex mb-4 shadow-card border border-stone-100 shrink-0">
        <button
          onClick={() => setModo('carga')}
          className={`flex-1 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all duration-200 cursor-pointer ${
            modo === 'carga' ? 'bg-red-600 text-white shadow-cta scale-[1.02]' : 'text-stone-400 hover:text-stone-700'
          }`}
        >
          1 · CHECK-IN
        </button>
        <button
          onClick={intentarComenzarRuta}
          disabled={!todoCargado}
          className={`flex-1 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all duration-200 cursor-pointer ${
            modo === 'reparto' ? 'bg-red-600 text-white shadow-cta scale-[1.02]' : 'text-stone-400 hover:text-stone-700 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          2 · EN RUTA
        </button>
      </div>

      <div className="flex-1 bg-white rounded-[2.5rem] p-6 sm:p-8 shadow-card card-accent-top flex flex-col relative animate-slide-up">
        <div className="flex items-center justify-between mb-7 bg-stone-50 p-2 rounded-2xl border border-stone-100">
          <button onClick={retroceder} disabled={index === 0} aria-label="Parada anterior" className="w-14 h-14 flex items-center justify-center bg-white text-stone-700 rounded-xl shadow-card disabled:opacity-25 active:scale-90 transition-all duration-150 cursor-pointer border border-stone-100"><ChevronLeft size={26} strokeWidth={2.5} /></button>
          <div className="text-center">
            <p className="text-red-600 text-xs font-black uppercase tracking-widest">Parada</p>
            <p className="text-stone-900 text-2xl font-black leading-none">{index + 1}<span className="text-stone-300 font-semibold text-lg"> / {pedidos.length}</span></p>
          </div>
          <button onClick={avanzar} disabled={index === pedidos.length - 1} aria-label="Parada siguiente" className="w-14 h-14 flex items-center justify-center bg-white text-stone-700 rounded-xl shadow-card disabled:opacity-25 active:scale-90 transition-all duration-150 cursor-pointer border border-stone-100"><ChevronRight size={26} strokeWidth={2.5} /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 flex-1">
          <div className="flex flex-col gap-5">
            
            {/* INICIO BLOQUE: LÁPIZ Y DATOS DEL CLIENTE */}
            {modoEdicion ? (
              <div className="animate-jiggle bg-stone-100/50 p-5 rounded-[2rem] border-2 border-stone-200 shadow-inner flex flex-col gap-4 relative z-10">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-black text-stone-500 uppercase tracking-widest flex items-center gap-2">
                    <Pencil size={14}/> Editando Datos
                  </p>
                </div>
                <input 
                  type="text" value={formEdicion.cliente} onChange={e => setFormEdicion({...formEdicion, cliente: e.target.value})}
                  className="w-full bg-white border-2 border-stone-200 rounded-xl px-4 py-3 font-black text-stone-900 text-lg outline-none focus:border-red-400 shadow-sm" placeholder="Nombre del cliente"
                />
                <input 
                  type="number" value={formEdicion.telefono} onChange={e => setFormEdicion({...formEdicion, telefono: e.target.value})}
                  className="w-full bg-white border-2 border-stone-200 rounded-xl px-4 py-3 font-bold text-stone-700 outline-none focus:border-red-400 shadow-sm" placeholder="Teléfono (ej: 569...)"
                />
                <textarea 
                  value={formEdicion.direccion} onChange={e => setFormEdicion({...formEdicion, direccion: e.target.value})}
                  className="w-full bg-white border-2 border-stone-200 rounded-xl px-4 py-3 font-bold text-stone-700 outline-none focus:border-red-400 shadow-sm resize-none h-24" placeholder="Dirección exacta"
                />
                <button onClick={guardarEdicion} className="mt-2 w-full bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-wa active:scale-95 flex items-center justify-center gap-2 cursor-pointer transition-transform">
                  <Save size={18}/> GUARDAR CAMBIOS
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <p className="text-xs font-black text-stone-400 uppercase tracking-widest">Cliente</p>
                      
                      {/* BOTÓN FANTASMA: LÁPIZ */}
                      <button
                        onPointerDown={startEditPress}
                        onPointerUp={stopEditPress}
                        onPointerLeave={stopEditPress}
                        className="relative overflow-hidden bg-stone-100 p-1.5 rounded-lg text-stone-400 active:scale-90 transition-transform cursor-pointer shadow-sm"
                        style={{ WebkitUserSelect: 'none', touchAction: 'none' }}
                      >
                        <div className="absolute bottom-0 left-0 h-full bg-stone-300 transition-all" style={{ width: `${editProgress}%` }} />
                        <Pencil size={12} className="relative z-10" />
                      </button>
                    </div>
                    
                    <h2 className="text-2xl sm:text-3xl font-black text-stone-900 leading-tight tracking-tight wrap-break-word">
                      {pedidoActual.cliente.startsWith('569') ? 'Cliente Web' : pedidoActual.cliente}
                    </h2>
                    {pedidoActual.telefono && (
                      <a href={`tel:+${pedidoActual.telefono}`} className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-stone-400 hover:text-stone-600 transition-colors">
                        <Phone size={13} /> +{pedidoActual.telefono}
                      </a>
                    )}
                  </div>
                  <BotonRayo />
                </div>

                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 flex items-start gap-3">
                  <div className="bg-red-100 p-2 rounded-xl shrink-0"><MapPin size={16} className="text-red-600" /></div>
                  <p className="text-sm font-bold text-stone-700 leading-snug">{pedidoActual.direccion}</p>
                </div>
              </>
            )}
            {/* FIN BLOQUE: LÁPIZ Y DATOS */}

            {modo === 'reparto' && (
              <>
                <button
                  onClick={() => abrirMapa(pedidoActual.direccion)}
                  className="w-full bg-stone-900 text-white h-[60px] rounded-2xl font-black flex justify-center items-center gap-3 active:scale-[0.97] transition-all duration-200 text-sm shadow-dark cursor-pointer hover:bg-stone-800 group"
                >
                  <Map size={20} className="group-active:scale-110 transition-transform duration-150" />
                  NAVEGAR CON MAPS
                </button>

                <div className="bg-stone-50 p-5 rounded-3xl border-2 border-stone-100">
                  <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <MessageCircle size={13} /> Avisos automáticos
                  </h3>

                  <div className="flex gap-3 mb-3">
                    <div className="relative shrink-0">
                      <input type="number" value={eta} onChange={(e) => setEta(e.target.value)} placeholder="–" aria-label="Minutos estimados de llegada" className="w-[68px] h-[52px] text-center font-black bg-white border-2 border-stone-200 rounded-2xl outline-none text-stone-900 focus:border-red-400 transition-colors text-lg" />
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-stone-100 text-[9px] px-2 py-0.5 font-black text-stone-500 rounded-full tracking-wider">MIN</span>
                    </div>

                    {pedidoActual.telefono ? (
                      <button
                        onClick={enviarAvisoCliente}
                        disabled={!eta}
                        className="flex-1 bg-[#25D366] text-white font-black h-[52px] rounded-2xl active:scale-[0.97] transition-all duration-150 flex items-center justify-center text-xs gap-2 shadow-wa disabled:opacity-40 disabled:saturate-0 cursor-pointer tracking-wider hover:brightness-105"
                      >
                        <MessageCircle size={15} /> AVISAR SALIDA
                      </button>
                    ) : (
                      <button
                        onClick={pedirTelefonoAdmin}
                        className="flex-1 bg-stone-800 text-white font-black h-[52px] rounded-2xl active:scale-[0.97] transition-all duration-150 flex items-center justify-center text-[10px] sm:text-xs gap-2 shadow-dark cursor-pointer tracking-wider hover:bg-stone-700"
                      >
                        <MessageCircle size={15} /> PEDIR TELÉFONO
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {pedidoActual.telefono && (
                      <button onClick={enviarAvisoLlegada} className="flex-1 bg-white border-2 border-[#25D366] text-[#25D366] font-black py-3 rounded-xl text-xs active:scale-95 cursor-pointer tracking-wider">
                        ESTOY AFUERA
                      </button>
                    )}
                    <button onClick={avisarAdmin} className="flex-1 bg-stone-200 text-stone-700 font-black py-3 rounded-xl text-xs border border-stone-300 active:scale-95 cursor-pointer tracking-wider">
                      INFORMAR ADMIN
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="hidden lg:block mt-auto">
              <BotonPrincipalAccion />
            </div>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-5">
              <div className={`w-2 h-2 rounded-full ${modo === 'carga' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <h3 className={`text-[11px] font-black uppercase tracking-widest ${modo === 'carga' ? 'text-emerald-600' : 'text-red-600'}`}>
                {modo === 'carga' ? 'Verificar en cocina:' : 'Entregar estos ítems:'}
              </h3>
            </div>

            <div className="flex flex-col space-y-3 pb-4">
              {pedidoActual.items.map((it, i) => {
                const activo = modo === 'carga' ? it.marcado : it.sacado;
                return (
                  <label key={i} className={`flex items-center p-5 rounded-2xl border-2 transition-all duration-200 cursor-pointer ${modo === 'carga' ? activo ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-stone-200 shadow-card hover:border-stone-300' : activo ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200 shadow-card hover:border-stone-300'}`}>
                    <input type="checkbox" checked={activo} onChange={() => toggleCaja(i)} className={`w-7 h-7 rounded-lg border-2 mr-4 shrink-0 ${modo === 'carga' ? 'accent-emerald-500' : 'accent-red-600'}`} />
                    <span className={`text-base sm:text-lg font-bold leading-tight transition-all ${activo ? 'line-through opacity-50' : 'text-stone-800'}`}>{it.nombre}</span>
                    {activo && <CheckCircle2 size={18} className={`ml-auto shrink-0 ${modo === 'carga' ? 'text-emerald-500' : 'text-red-400'}`} />}
                  </label>
                );
              })}
            </div>

            <div className="lg:hidden mt-4 pt-2">
              <BotonPrincipalAccion />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;