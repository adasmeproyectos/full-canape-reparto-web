import { useState, useRef, useEffect } from 'react';
import { procesarPedidos } from './lib/gemini';
import { supabase } from './lib/supabase';
import { 
  ChevronLeft, ChevronRight, Package, MapPin, Loader2, CheckCircle2, 
  Map, Zap, Truck, Home, Phone, MessageCircle, RefreshCcw, ListOrdered, 
  X, ArrowUp, ArrowDown 
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

  const pressTimer  = useRef(null);
  const resetTimer  = useRef(null);

  // --- ESTADOS SUPABASE Y ADMIN ---
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminProgress, setAdminProgress] = useState(0);
  const [rutasEnVivo, setRutasEnVivo] = useState([]);
  const adminTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem('fc_input',    JSON.stringify(input));
    localStorage.setItem('fc_pedidos',  JSON.stringify(pedidos));
    localStorage.setItem('fc_historial',JSON.stringify(historial));
    localStorage.setItem('fc_index',    JSON.stringify(index));
    localStorage.setItem('fc_modo',     JSON.stringify(modo));
    localStorage.setItem('fc_eta',      JSON.stringify(eta));
  }, [input, pedidos, historial, index, modo, eta]);

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
    try {
      const { data } = await supabase.from('monitoreo_rutas')
        .select('*').eq('esta_activo', true).order('ultima_actualizacion', { ascending: false });
      if (data) setRutasEnVivo(data);
    } catch(e) {}
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
  
  const handleProcesar = async () => {
    setCargando(true);
    try {
      const data = await procesarPedidos(input);
      const preparar = (ruta) => ruta.map(p => ({
        ...p,
        items: p.items.map(i => ({ nombre: i, marcado: false, sacado: false }))
      }));
      if (data.pedidos && data.pedidos.length > 0) {
        const nuevosPedidos = preparar(data.pedidos);
        // Ahora guardamos el respaldo SIEMPRE que se procese una ruta nueva
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
      // Clona el historial para no afectar el respaldo original al interactuar con las cajas
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

  const moverPedido = (from, to) => {
    const nuevos = [...pedidos];
    const [removido] = nuevos.splice(from, 1);
    nuevos.splice(to, 0, removido);
    setPedidos(nuevos);
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

  // 🗺️ Enlace oficial y corregido de Google Maps
  const abrirMapa = (dir) => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}`, '_blank');
  
  const finalizarRuta = () => { setAbsorbiendo(true); setTimeout(() => { setModo('fin'); setAbsorbiendo(false); }, 800); };
  
  const toggleCaja  = (i) => {
    const n = [...pedidos];
    if (modo === 'carga') n[index].items[i].marcado = !n[index].items[i].marcado;
    else                  n[index].items[i].sacado  = !n[index].items[i].sacado;
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
            if (modo === 'carga') it.marcado = true;
            else it.sacado = true;
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
          onClick={cambiarAModoReparto}
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
    return (
      <div className="min-h-screen bg-stone-950 p-6 flex flex-col relative max-w-xl mx-auto text-white">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-red-500 text-xs font-black uppercase tracking-widest mb-1">Panel de Trackeo</p>
            <h2 className="text-white text-3xl font-black tracking-tight italic">PANEL ADMIN</h2>
          </div>
          <button onClick={() => setShowAdmin(false)} className="bg-white/10 p-3 rounded-2xl text-white hover:bg-white/20 transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <button onClick={cargarRutasEnVivo} className="mb-6 flex items-center justify-center gap-2 w-full bg-white/5 border border-white/10 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95 cursor-pointer">
          <RefreshCcw size={14} /> Actualizar Radar
        </button>

        <div className="flex-1 space-y-4 overflow-y-auto pb-8">
          {rutasEnVivo.length === 0 ? (
            <p className="text-stone-500 text-center mt-10 font-bold">No hay repartidores activos en la calle.</p>
          ) : (
            rutasEnVivo.map(ruta => {
              const porcentaje = Math.round((ruta.progreso_actual / ruta.total_pedidos) * 100) || 0;
              const pedidoActual = ruta.pedidos_json[ruta.progreso_actual] || ruta.pedidos_json[ruta.pedidos_json.length - 1];
              
              return (
                <div key={ruta.id} className="bg-stone-900 border-2 border-white/5 p-6 rounded-3xl shadow-2xl">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-black text-xl uppercase tracking-widest">{ruta.nombre_repartidor}</h3>
                    <span className="text-red-500 font-black text-lg">{porcentaje}%</span>
                  </div>
                  
                  <div className="w-full h-3 bg-black rounded-full overflow-hidden mb-4 border border-white/5">
                    <div className="h-full bg-red-600 transition-all duration-1000 ease-out relative" style={{ width: `${porcentaje}%` }}>
                      <div className="absolute top-0 right-0 bottom-0 w-4 bg-white/30 animate-pulse"></div>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2 bg-black/50 p-3 rounded-xl border border-white/5">
                    <MapPin size={14} className="text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-stone-500 font-black uppercase tracking-widest">Entregando ahora:</p>
                      <p className="text-sm font-bold text-stone-300 leading-snug truncate">{pedidoActual?.direccion || 'Ruta finalizada'}</p>
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
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-stone-900 overflow-hidden relative">
        {/* Estilos para animaciones exclusivas de la pantalla final */}
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

        {/* Confetti dinámico cayendo */}
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
          
          {/* El Camión cruzando la pantalla */}
          <div className="w-full relative h-24 mb-10 flex items-center justify-center">
            <div className="absolute bottom-6 left-0 w-full h-0 border-t-4 border-dashed border-stone-200"></div>
            <div className="absolute bottom-[20px] left-0 flex items-center animate-[truck-cross_4s_infinite_linear] w-full">
              <Truck className="text-red-500 drop-shadow-md" size={48} strokeWidth={2} />
            </div>
          </div>

          {/* Botones de acción final */}
          <div className="flex flex-col gap-4 w-full">
            
            {/* CORRECCIÓN PWA: Convertido de <button> a enlace <a> nativo */}
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
      <div className="min-h-screen bg-stone-50 flex flex-col justify-center p-6 max-w-xl mx-auto overflow-y-auto relative">
        {/* BOTÓN FANTASMA ADMIN: Ahora es una Hitbox gigante transparente de 128x128px en la esquina */}
        <button
          onPointerDown={startAdmin}
          onPointerUp={stopAdmin}
          onPointerLeave={stopAdmin}
          className="absolute top-0 right-0 w-32 h-32 flex items-start justify-end p-6 cursor-pointer opacity-100"
          style={{ WebkitUserSelect: 'none', touchAction: 'none' }}
        >
          <div className="relative">
            <Zap size={24} className="text-stone-300" />
            <div className="absolute top-8 right-0 h-1 bg-red-500 transition-all rounded-full" style={{ width: `${adminProgress}%` }} />
          </div>
        </button>
        <div className="mb-10 text-center flex flex-col items-center animate-slide-up mt-10">
          {/* 🖼️ Aquí volvió el logo de Full Canapé */}
          <img src="/logo.png" alt="Logo Full Canapé" className="w-32 h-auto mb-5 drop-shadow-md" />
          <h1 className="text-4xl font-black text-stone-900 tracking-tight leading-none">Full Canapé</h1>
          <p className="text-stone-400 font-semibold mt-2 text-sm tracking-wider uppercase">Sistema logístico de ruta</p>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: '60ms' }}>
          <label className="block text-xs font-black text-stone-400 uppercase tracking-widest mb-3 pl-1">
            Pegar pedidos aquí
          </label>
          <textarea
            className="
              w-full h-52 p-5 bg-white rounded-3xl border-2 border-stone-200 mb-5
              outline-none text-base resize-none font-medium text-stone-800
              placeholder:text-stone-300 placeholder:font-normal
              focus:border-red-500 transition-colors duration-200 shadow-card
            "
            placeholder="Pega los pedidos aquí..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3 animate-slide-up" style={{ animationDelay: '120ms' }}>
          <button
            onClick={handleProcesar}
            disabled={cargando || !input.trim()}
            className={`
              h-[68px] rounded-3xl font-black text-base transition-all duration-200 cursor-pointer
              flex items-center justify-center gap-3
              ${cargando || !input.trim()
                ? 'bg-stone-300 text-stone-500 cursor-not-allowed'
                : 'bg-red-600 text-white shadow-cta active:scale-[0.97]'}
            `}
          >
            {cargando
              ? <><Loader2 className="animate-spin" size={22} /> PROCESANDO...</>
              : <><Package size={22} /> CARGAR RUTA</>}
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
    <div className="min-h-screen bg-stone-100 p-4 sm:p-6 flex flex-col relative max-w-7xl mx-auto">
      <div
        className={`fixed inset-0 bg-white z-100 transition-all duration-700 pointer-events-none ${
          absorbiendo ? 'opacity-100 scale-150 rounded-none' : 'opacity-0 scale-0 rounded-full'
        }`}
        style={{ transformOrigin: 'bottom center' }}
      />

      <div className="flex justify-between items-center mb-5 px-1">
        <button
          onPointerDown={startReset}
          onPointerUp={stopReset}
          onPointerLeave={stopReset}
          aria-label="Mantén presionado para reiniciar"
          className="relative overflow-hidden bg-white text-stone-500 px-5 py-3 rounded-2xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform select-none touch-none cursor-pointer shadow-card border border-stone-100"
          style={{ WebkitUserSelect: 'none' }}
        >
          <div
            className="absolute bottom-0 left-0 h-[3px] bg-red-500 transition-all rounded-full"
            style={{ width: `${resetProgress}%` }}
          />
          <RefreshCcw size={14} />
          <span className="tracking-wider">{resetProgress > 0 ? 'MANTÉN...' : 'REINICIAR'}</span>
        </button>

        <button
          onClick={() => setShowReorder(true)}
          className="bg-stone-900 text-white px-5 py-3 rounded-2xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform shadow-dark cursor-pointer"
        >
          <ListOrdered size={14} />
          <span className="tracking-wider">COLA DE REPARTO</span>
        </button>
      </div>

      {showReorder && (
        <div className="fixed inset-0 bg-stone-950/96 z-200 p-6 flex flex-col overflow-y-auto">
          <div className="flex justify-between items-center mb-8">
            <div>
              <p className="text-red-500 text-xs font-black uppercase tracking-widest mb-1">Ordenar paradas</p>
              <h2 className="text-white text-3xl font-black tracking-tight">COLA DE REPARTO</h2>
            </div>
            <button
              onClick={() => setShowReorder(false)}
              className="bg-white/10 p-3 rounded-2xl text-white hover:bg-white/20 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 space-y-3 pb-8">
            {pedidos.map((p, i) => (
              <div
                key={i}
                className={`
                  flex items-center p-5 rounded-3xl border-2 transition-all duration-200
                  ${i === index
                    ? 'bg-red-600 border-red-400 shadow-cta'
                    : 'bg-white/5 border-white/10 hover:bg-white/8'}
                `}
              >
                <div className="flex-1 pr-3 min-w-0">
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${i === index ? 'text-red-200' : 'text-white/40'}`}>
                    Parada {i + 1}
                    {i === index && ' · EN CURSO'}
                  </p>
                  <p className="text-white font-bold leading-tight truncate">{p.direccion}</p>
                  <p className={`text-[11px] mt-1 font-semibold ${i === index ? 'text-red-200' : 'text-white/40'}`}>{p.cliente}</p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => moverPedido(i, i - 1)}
                    disabled={i === 0}
                    className="p-3 bg-white/10 rounded-xl disabled:opacity-20 hover:bg-white/20 transition-colors active:scale-90 cursor-pointer"
                  >
                    <ArrowUp size={16} className="text-white" />
                  </button>
                  <button
                    onClick={() => moverPedido(i, i + 1)}
                    disabled={i === pedidos.length - 1}
                    className="p-3 bg-white/10 rounded-xl disabled:opacity-20 hover:bg-white/20 transition-colors active:scale-90 cursor-pointer"
                  >
                    <ArrowDown size={16} className="text-white" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowReorder(false)}
            className="sticky bottom-4 bg-white text-stone-900 py-5 rounded-[2rem] font-black text-lg w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)] active:scale-[0.97] transition-transform cursor-pointer"
          >
            CONFIRMAR ORDEN
          </button>
        </div>
      )}

      <div className="bg-white p-1.5 rounded-2xl flex mb-5 shadow-card border border-stone-100 shrink-0">
        <button
          onClick={() => setModo('carga')}
          className={`
            flex-1 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all duration-200 cursor-pointer
            ${modo === 'carga'
              ? 'bg-red-600 text-white shadow-cta scale-[1.02]'
              : 'text-stone-400 hover:text-stone-600'}
          `}
        >
          1 · CHECK-IN
        </button>
        <button
          onClick={cambiarAModoReparto}
          disabled={!todoCargado}
          className={`
            flex-1 py-3.5 rounded-xl font-black text-xs sm:text-sm transition-all duration-200 cursor-pointer
            ${modo === 'reparto'
              ? 'bg-red-600 text-white shadow-cta scale-[1.02]'
              : 'text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed'}
          `}
        >
          2 · EN RUTA
        </button>
      </div>

      <div className="flex-1 bg-white rounded-[2.5rem] p-6 sm:p-8 shadow-card card-accent-top flex flex-col relative animate-slide-up">
        <div className="flex items-center justify-between mb-7 bg-stone-50 p-2 rounded-2xl border border-stone-100">
          <button
            onClick={retroceder}
            disabled={index === 0}
            aria-label="Parada anterior"
            className="w-14 h-14 flex items-center justify-center bg-white text-stone-700 rounded-xl shadow-card disabled:opacity-25 active:scale-90 transition-all duration-150 cursor-pointer border border-stone-100"
          >
            <ChevronLeft size={26} strokeWidth={2.5} />
          </button>

          <div className="text-center">
            <p className="text-red-600 text-xs font-black uppercase tracking-widest">Parada</p>
            <p className="text-stone-900 text-2xl font-black leading-none">
              {index + 1}
              <span className="text-stone-300 font-semibold text-lg"> / {pedidos.length}</span>
            </p>
          </div>

          <button
            onClick={avanzar}
            disabled={index === pedidos.length - 1}
            aria-label="Parada siguiente"
            className="w-14 h-14 flex items-center justify-center bg-white text-stone-700 rounded-xl shadow-card disabled:opacity-25 active:scale-90 transition-all duration-150 cursor-pointer border border-stone-100"
          >
            <ChevronRight size={26} strokeWidth={2.5} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 flex-1">
          <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-stone-400 uppercase tracking-widest mb-1">Cliente</p>
                <h2 className="text-2xl sm:text-3xl font-black text-stone-900 leading-tight tracking-tight wrap-break-word">
                  {pedidoActual.cliente.startsWith('569') ? 'Cliente Web' : pedidoActual.cliente}
                </h2>
                {pedidoActual.telefono && (
                  <a
                    href={`tel:+${pedidoActual.telefono}`}
                    className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    <Phone size={13} /> +{pedidoActual.telefono}
                  </a>
                )}
              </div>
              <BotonRayo />
            </div>

            <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 flex items-start gap-3">
              <div className="bg-red-100 p-2 rounded-xl shrink-0">
                <MapPin size={16} className="text-red-600" />
              </div>
              <p className="text-sm font-bold text-stone-700 leading-snug">{pedidoActual.direccion}</p>
            </div>

            {modo === 'reparto' && (
              <>
                <button
                  onClick={() => abrirMapa(pedidoActual.direccion)}
                  className="w-full bg-stone-900 text-white h-[60px] rounded-2xl font-black flex justify-center items-center gap-3 active:scale-[0.97] transition-all text-sm shadow-dark cursor-pointer"
                >
                  <Map size={20} /> NAVEGAR CON MAPS
                </button>

                <div className="bg-stone-50 p-5 rounded-3xl border-2 border-stone-100">
                  <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <MessageCircle size={13} /> Avisos automáticos
                  </h3>

                  <div className="flex gap-3 mb-3">
                    <div className="relative shrink-0">
                      <input
                        type="number"
                        value={eta}
                        onChange={(e) => setEta(e.target.value)}
                        placeholder="–"
                        aria-label="Minutos estimados de llegada"
                        className="w-[68px] h-[52px] text-center font-black bg-white border-2 border-stone-200 rounded-2xl outline-none text-stone-900 focus:border-red-400 transition-colors text-lg"
                      />
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-stone-100 text-[9px] px-2 py-0.5 font-black text-stone-500 rounded-full tracking-wider">MIN</span>
                    </div>

                    {pedidoActual.telefono ? (
                      <button
                        onClick={enviarAvisoCliente}
                        disabled={!eta}
                        className="flex-1 bg-[#25D366] text-white font-black h-[52px] rounded-2xl active:scale-[0.97] flex items-center justify-center text-xs gap-2 shadow-wa disabled:opacity-40 cursor-pointer tracking-wider"
                      >
                        <MessageCircle size={15} /> AVISAR SALIDA
                      </button>
                    ) : (
                      <div className="flex-1 bg-stone-200 text-stone-400 font-bold h-[52px] rounded-2xl flex items-center justify-center text-xs">
                        Sin teléfono
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {pedidoActual.telefono && (
                      <button
                        onClick={enviarAvisoLlegada}
                        className="flex-1 bg-white border-2 border-[#25D366] text-[#25D366] font-black py-3 rounded-xl text-xs active:scale-95 cursor-pointer tracking-wider"
                      >
                        ESTOY AFUERA
                      </button>
                    )}
                    <button
                      onClick={avisarAdmin}
                      className="flex-1 bg-stone-200 text-stone-700 font-black py-3 rounded-xl text-xs border border-stone-300 active:scale-95 cursor-pointer tracking-wider"
                    >
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
                  <label
                    key={i}
                    className={`
                      flex items-center p-5 rounded-2xl border-2 transition-all duration-200 cursor-pointer
                      ${modo === 'carga'
                        ? activo
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-white border-stone-200 shadow-card hover:border-stone-300'
                        : activo
                          ? 'bg-red-50 border-red-200'
                          : 'bg-white border-stone-200 shadow-card hover:border-stone-300'}
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={activo}
                      onChange={() => toggleCaja(i)}
                      className={`
                        w-7 h-7 rounded-lg border-2 mr-4 shrink-0
                        ${modo === 'carga' ? 'accent-emerald-500' : 'accent-red-600'}
                      `}
                    />
                    <span className={`
                      text-base sm:text-lg font-bold leading-tight transition-all
                      ${activo ? 'line-through opacity-50' : 'text-stone-800'}
                    `}>
                      {it.nombre}
                    </span>
                    {activo && (
                      <CheckCircle2
                        size={18}
                        className={`ml-auto shrink-0 ${modo === 'carga' ? 'text-emerald-500' : 'text-red-400'}`}
                      />
                    )}
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