import { useState, useRef, useEffect } from 'react';
import { procesarPedidos } from './lib/gemini';
import { ChevronLeft, Package, MapPin, Loader2, CheckCircle2, Map, Zap, Check, Truck, Home, Phone, MessageCircle } from 'lucide-react';

const getMemoria = (clave, valorPorDefecto) => {
  try {
    const guardado = localStorage.getItem(clave);
    return guardado !== null ? JSON.parse(guardado) : valorPorDefecto;
  } catch {
    return valorPorDefecto;
  }
};

function App() {
  const [input, setInput] = useState(() => getMemoria('fc_input', ""));
  const [pedidos, setPedidos] = useState(() => getMemoria('fc_pedidos', []));
  const [cargando, setCargando] = useState(false);
  const [index, setIndex] = useState(() => getMemoria('fc_index', 0));
  const [modo, setModo] = useState(() => getMemoria('fc_modo', 'carga')); 
  const [eta, setEta] = useState(() => getMemoria('fc_eta', ""));
  const [presionando, setPresionando] = useState(false);
  const [absorbiendo, setAbsorbiendo] = useState(false);
  
  const pressTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem('fc_input', JSON.stringify(input));
    localStorage.setItem('fc_pedidos', JSON.stringify(pedidos));
    localStorage.setItem('fc_index', JSON.stringify(index));
    localStorage.setItem('fc_modo', JSON.stringify(modo));
    localStorage.setItem('fc_eta', JSON.stringify(eta));
  }, [input, pedidos, index, modo, eta]);

  const handleProcesar = async () => {
    setCargando(true);
    try {
      const data = await procesarPedidos(input);
      // Ahora usamos data.pedidos según el nuevo formato de gemini.js
      const preparar = (ruta) => ruta.map(p => ({
        ...p, 
        items: p.items.map(i => ({ nombre: i, marcado: false, sacado: false }))
      }));
      
      if (data.pedidos && data.pedidos.length > 0) {
        setPedidos(preparar(data.pedidos)); 
        setIndex(0); 
        setModo('carga');
      } else {
        alert("No se encontraron pedidos en el texto.");
      }
    } catch (error) { 
      console.error(error);
      alert("Error al procesar pedidos. Intenta nuevamente."); 
    }
    setCargando(false);
  };

  // Funciones de WhatsApp Directo usando el teléfono detectado
  const enviarAvisoCliente = () => {
    const min = eta || "unos";
    const texto = `¡Hola! 🥨 Le habla el repartidor de Full Canapé. Ya voy en camino a su dirección. Llego aproximadamente en ${min} minutos. ¡Nos vemos pronto! 🚚✨`;
    window.open(`https://wa.me/${pedidoActual.telefono}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  const enviarAvisoLlegada = () => {
    const texto = `¡Hola! 👋 Ya estoy llegando a su domicilio. Por favor, esté atento/a para recibir su pedido. ¡Muchas gracias! 🚚✨`;
    window.open(`https://wa.me/${pedidoActual.telefono}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  const avisarAdmin = () => {
    const numAdmin = "56988589058"; // El número de tu primo
    const dir = pedidoActual.direccion;
    const msj = index === 0 
      ? `Saliendo! ${eta} min a ${dir}` 
      : `Entregado ${pedidos[index-1].direccion}. Ahora ${eta} min a ${dir}`;
    window.open(`https://wa.me/${numAdmin}?text=${encodeURIComponent(msj)}`, '_blank');
  };

  const abrirMapa = (direccion) => {
    const url = `http://maps.google.com/?q=${encodeURIComponent(direccion)}`;
    window.open(url, '_blank');
  };

  const finalizarRuta = () => {
    setAbsorbiendo(true);
    setTimeout(() => { setModo('fin'); setAbsorbiendo(false); }, 800);
  };

  const limpiarTodo = () => {
    ['fc_input','fc_pedidos','fc_index','fc_modo','fc_eta'].forEach(k => localStorage.removeItem(k));
    setPedidos([]); setInput(""); setIndex(0); setModo('carga'); setEta("");
  };

  const toggleCaja = (i) => {
    const n = [...pedidos];
    if (modo === 'carga') n[index].items[i].marcado = !n[index].items[i].marcado;
    else n[index].items[i].sacado = !n[index].items[i].sacado;
    setPedidos(n);
  };

  const cambiarAModoReparto = () => { setIndex(0); setEta(""); setModo('reparto'); };

  const BotonRayo = () => (
    <button onPointerDown={() => {
      setPresionando(true);
      pressTimer.current = setTimeout(() => {
        const n = [...pedidos];
        n[index].items.forEach(it => { if (modo === 'carga') it.marcado = true; else it.sacado = true; });
        setPedidos(n); setPresionando(false);
      }, 800);
    }} onPointerUp={() => {setPresionando(false); clearTimeout(pressTimer.current);}} 
      className="relative overflow-hidden bg-stone-100 w-20 h-20 rounded-2xl flex flex-col items-center justify-center border-2 border-stone-200 active:scale-90 transition-transform select-none touch-none shrink-0">
      <div className="absolute bottom-0 left-0 w-full bg-emerald-400 transition-all ease-linear" style={{ height: presionando ? '100%' : '0%', transitionDuration: presionando ? '800ms' : '200ms' }}></div>
      <Zap size={24} className={`relative z-10 ${presionando ? 'text-white' : 'text-stone-400'}`} />
      <span className={`text-[9px] font-black relative z-10 ${presionando ? 'text-white' : 'text-stone-400'}`}>CHECK TODO</span>
    </button>
  );

  if (modo === 'fin') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-stone-900 overflow-hidden relative">
        {[...Array(40)].map((_, i) => (
          <div key={i} className="absolute animate-bounce w-2 h-2 rounded-full opacity-40"
            style={{ backgroundColor: ['#ef4444', '#10b981', '#f59e0b', '#3b82f6'][i % 4], left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, animationDuration: `${Math.random() * 3 + 2}s` }} />
        ))}
        <div className="relative z-10 flex flex-col items-center w-full max-w-sm text-center">
          <div className="bg-emerald-100 text-emerald-600 p-8 rounded-full mb-8 shadow-sm animate-in zoom-in duration-700 delay-300 fill-mode-both"><CheckCircle2 size={80} /></div>
          <h1 className="text-4xl font-black mb-2 animate-in slide-in-from-bottom-10 duration-1000 delay-700 fill-mode-both tracking-tight">¡RUTA COMPLETADA!</h1>
          <p className="text-stone-500 text-lg mb-12 animate-in fade-in duration-1000 delay-700 fill-mode-both">¡Buen trabajo hoy! 🚚</p>
          <div className="w-full relative h-32 mb-12 flex items-center justify-center animate-in fade-in duration-1000 delay-[1200ms] fill-mode-both">
            <div className="absolute bottom-8 left-0 w-full h-0 border-t-4 border-dashed border-red-200"></div>
            <div className="absolute bottom-[34px] left-0 flex items-center animate-[truck-cross_5s_infinite_linear] w-full"><Truck className="text-red-500 drop-shadow-md" size={60} /></div>
          </div>
          <div className="flex flex-col gap-4 w-full animate-in fade-in duration-700 delay-[1800ms] fill-mode-both">
            <button onClick={() => abrirMapa("fundo el bosque 95, maipú")} className="bg-emerald-600 text-white p-6 rounded-[2.5rem] w-full font-black text-xl active:scale-95 transition-transform flex items-center justify-center shadow-lg"><Home className="mr-3" />  ¡VAMOS A CASA!</button>
            <button onClick={limpiarTodo} className="bg-stone-100 text-stone-500 p-5 rounded-[2.5rem] w-full font-black text-lg active:scale-95 transition-transform">VOLVER AL INICIO</button>
          </div>
        </div>
        <style>{` @keyframes truck-cross { 0% { transform: translateX(-150px); } 100% { transform: translateX(120vw); } } `}</style>
      </div>
    );
  }

  if (pedidos.length === 0) {
    return (
      <div className="min-h-screen bg-stone-50 p-6 flex flex-col justify-center max-w-xl mx-auto">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4"><Truck size={40}/></div>
          <h1 className="text-3xl font-black text-stone-900 tracking-tight">Full Despachos</h1>
          <p className="text-stone-500 font-medium mt-2">Pega la lista de WhatsApp para comenzar</p>
        </div>
        <textarea className="w-full h-64 p-5 bg-white rounded-3xl border-2 mb-8 outline-none text-base resize-none focus:border-red-400 transition-colors shadow-inner" placeholder="Ej: 1. Cliente: 56912345678, Dirección: Av Siempre Viva 123..." value={input} onChange={(e) => setInput(e.target.value)} />
        <button onClick={handleProcesar} disabled={cargando || !input.trim()} className={`relative p-5 rounded-[2rem] font-black text-xl transition-all ${cargando ? 'bg-stone-400 translate-y-2 shadow-none text-stone-200' : 'bg-red-600 text-white shadow-[0_8px_0_rgb(153,27,27)] active:shadow-none active:translate-y-2 hover:bg-red-500 flex items-center justify-center'}`}>
          {cargando ? <><Loader2 className="animate-spin mr-3" size={24}/> PROCESANDO...</> : <><Package className="mr-3" size={24}/> CARGAR RUTA</>}
        </button>
      </div>
    );
  }

  const pedidoActual = pedidos[index] || pedidos[0];

  return (
    <div className="min-h-screen bg-stone-100 p-4 sm:p-6 flex flex-col relative overflow-hidden max-w-2xl mx-auto">
      <div className={`fixed inset-0 bg-white z-[100] transition-all duration-700 pointer-events-none ${absorbiendo ? 'opacity-100 scale-150 rounded-none' : 'opacity-0 scale-0 rounded-full'}`} style={{ transformOrigin: 'bottom center' }}></div>
      
      <div className="bg-stone-200/70 p-1.5 rounded-2xl flex mb-6 shadow-inner">
        <button onClick={() => setModo('carga')} className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${modo === 'carga' ? 'bg-white text-red-600 shadow-sm scale-105' : 'text-stone-500 hover:text-stone-700'}`}>1. CHECK-IN DE CARGA</button>
        <button onClick={cambiarAModoReparto} className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${modo === 'reparto' ? 'bg-white text-red-600 shadow-sm scale-105' : 'text-stone-500 hover:text-stone-700'}`}>2. EN RUTA (DESPACHO)</button>
      </div>

      <div className="flex-1 bg-white rounded-[2.5rem] p-6 sm:p-8 shadow-xl border-t-8 border-red-600 flex flex-col relative">
        <div className="flex justify-between items-start mb-6">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-2">
               <span className="bg-red-100 text-red-600 text-xs font-black px-3 py-1 rounded-full uppercase tracking-widest">Parada {index + 1} de {pedidos.length}</span>
            </div>
            {/* Si el cliente es solo un número, muestra un texto amigable */}
            <h2 className="text-3xl font-black text-stone-900 leading-tight tracking-tight break-words">
              {pedidoActual.cliente.startsWith('569') ? "Cliente Web" : pedidoActual.cliente}
            </h2>
            {pedidoActual.telefono && (
               <p className="text-sm font-bold text-stone-500 mt-2 flex items-center bg-stone-50 w-fit px-3 py-1 rounded-lg border border-stone-200">
                 <Phone size={14} className="mr-2 text-stone-400"/> +{pedidoActual.telefono}
               </p>
            )}
            <p className="text-sm font-bold text-stone-600 mt-3 flex items-start bg-stone-100 p-3 rounded-xl"><MapPin size={16} className="mr-2 mt-0.5 text-red-500 shrink-0"/> <span className="leading-snug">{pedidoActual.direccion}</span></p>
          </div>
          <BotonRayo />
        </div>

        {modo === 'reparto' ? (
          <div className="flex flex-col flex-1">
            <button onClick={() => abrirMapa(pedidoActual.direccion)} className="w-full bg-stone-800 text-white p-4 rounded-2xl mb-6 font-black flex justify-center items-center active:scale-95 transition-all shadow-md"><Map size={20} className="mr-2" /> NAVEGAR CON MAPS</button>
            
            {/* PANEL DE COMUNICACIÓN (Solo aparece si hay teléfono) */}
            <div className="bg-stone-50 p-4 rounded-3xl border-2 border-stone-100 mb-6">
              <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest mb-3 flex items-center gap-2"><MessageCircle size={14}/> Centro de Avisos</h3>
              
              <div className="flex gap-2 mb-3">
                <div className="flex-shrink-0 relative">
                   <input type="number" value={eta} onChange={(e) => setEta(e.target.value)} placeholder="Min" className="w-20 h-full text-center font-black bg-white border-2 border-stone-200 rounded-xl outline-none focus:border-[#25D366] transition-colors text-lg" />
                   <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-stone-100 text-[9px] px-2 font-bold text-stone-500 rounded-full">ETA</span>
                </div>
                
                {pedidoActual.telefono ? (
                  <button onClick={enviarAvisoCliente} disabled={!eta} className="flex-1 bg-[#25D366] hover:bg-[#20bd5a] text-white font-black p-4 rounded-xl active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center text-sm sm:text-base shadow-sm">
                    <MessageCircle size={18} className="mr-2"/> AVISAR SALIDA AL CLIENTE
                  </button>
                ) : (
                  <div className="flex-1 bg-stone-200 text-stone-400 font-bold p-4 rounded-xl flex items-center justify-center text-sm text-center">
                    Sin teléfono registrado
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                 {pedidoActual.telefono && (
                   <button onClick={enviarAvisoLlegada} className="flex-1 bg-white border-2 border-[#25D366] text-[#25D366] font-black p-3 rounded-xl active:scale-95 transition-all text-xs sm:text-sm flex flex-col items-center justify-center">
                     <span>ESTOY AFUERA</span>
                   </button>
                 )}
                 <button onClick={avisarAdmin} disabled={!eta} className="flex-1 bg-stone-200 text-stone-600 font-black p-3 rounded-xl active:scale-95 transition-all disabled:opacity-50 text-xs sm:text-sm flex flex-col items-center justify-center">
                    <span>INFORMAR AL ADMIN</span>
                 </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar pb-4">
              <h3 className="text-[11px] font-black text-red-500 uppercase tracking-widest mb-2 flex items-center"><Package size={14} className="mr-1"/> Entregar estos items:</h3>
              {pedidoActual.items.map((it, i) => (
                <label key={i} className={`flex items-start p-4 rounded-2xl border transition-all cursor-pointer ${it.sacado ? 'bg-red-50 border-red-200 opacity-60' : 'bg-white border-stone-200 shadow-sm'}`}>
                  <input type="checkbox" checked={it.sacado} onChange={() => toggleCaja(i)} className="w-6 h-6 rounded-lg accent-red-600 mr-3 mt-0.5 shrink-0" />
                  <span className={`text-base font-bold leading-tight ${it.sacado ? 'line-through text-red-800' : 'text-stone-800'}`}>{it.nombre}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 no-scrollbar pb-4">
            <h3 className="text-[11px] font-black text-stone-400 uppercase tracking-widest mb-2 flex items-center"><Package size={14} className="mr-1"/> Verificar en cocina:</h3>
            {pedidoActual.items.map((it, i) => (
              <label key={i} className={`flex items-start p-4 rounded-2xl border transition-all cursor-pointer ${it.marcado ? 'bg-emerald-50 border-emerald-300 shadow-inner' : 'bg-white border-stone-200 shadow-sm'}`}>
                <input type="checkbox" checked={it.marcado} onChange={() => toggleCaja(i)} className="w-7 h-7 rounded-xl border-2 accent-emerald-500 mr-4 shrink-0" />
                <span className={`text-lg font-bold leading-tight ${it.marcado ? 'line-through text-emerald-800 opacity-70' : 'text-stone-800'}`}>{it.nombre}</span>
              </label>
            ))}
          </div>
        )}

        <div className="pt-5 mt-auto flex justify-between gap-3 border-t-2 border-stone-100 bg-white">
          <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} className="w-16 h-16 flex items-center justify-center bg-stone-100 text-stone-500 rounded-[1.5rem] active:scale-95 disabled:opacity-30 transition-transform shrink-0"><ChevronLeft size={32} /></button>
          
          {modo === 'carga' ? (
            <button onClick={index === pedidos.length - 1 ? cambiarAModoReparto : () => setIndex(i => i + 1)} disabled={!pedidoActual.items.every(it => it.marcado)} className="flex-1 h-16 rounded-[1.5rem] font-black text-xl text-white bg-red-600 active:scale-95 transition-transform disabled:opacity-50 disabled:bg-stone-300 disabled:text-stone-500 shadow-lg shadow-red-200">
              SIGUIENTE
            </button>
          ) : (
            <button onClick={index === pedidos.length - 1 ? finalizarRuta : () => { setIndex(i => i + 1); setEta(""); }} disabled={!pedidoActual.items.every(it => it.sacado)} className="flex-1 h-16 bg-stone-900 text-white rounded-[1.5rem] font-black text-xl active:scale-95 transition-transform disabled:opacity-50 shadow-lg shadow-stone-300">
              {index === pedidos.length - 1 ? 'TERMINAR DÍA' : 'ENTREGADO'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;