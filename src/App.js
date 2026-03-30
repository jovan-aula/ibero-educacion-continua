import { useState, useEffect, useRef } from "react";

// ─── CONSTANTES ───────────────────────────────────────
const SK  = "ibero_programas";
const RK  = "ibero_responsables";
const NK  = "ibero_notif";
const SK2 = "ibero_session";
const UK  = "ibero_users";
const FK  = "ibero_fieldmap";
const DK  = "ibero_docentes";

const RED = "#C8102E";
const DIAS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const COLORES = ["#C8102E","#1a1a1a","#7c3aed","#1d4ed8","#0f766e","#b45309","#6b2d2d","#374151"];
const MESES_L = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const MODALIDADES = [
  {valor:"Presencial Playas",    },
  {valor:"Presencial Campus Río",},
  {valor:"Online",               },
  {valor:"Híbrido",              },
];

const GENERACIONES = ["Primera","Segunda","Tercera","Cuarta","Quinta","Sexta","Séptima","Octava","Novena","Décima"];
const NUMEROS_MOD  = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];
const HORARIOS_PRE = ["18:00 – 22:00","09:00 – 13:00","08:00 – 14:00","07:00 – 13:00","16:00 – 20:00","Otro"];
const PROMOCIONES_DEFAULT = [
  {id:"promo_pronto",     nombre:"Pronto pago",              descuento:20, editable:false},
  {id:"promo_alumni",     nombre:"Alumni IBERO",             descuento:30, editable:false},
  {id:"promo_contado",    nombre:"Pago de contado",          descuento:25, editable:false},
  {id:"promo_grupal2",    nombre:"Descuento grupal (2 pax)", descuento:30, editable:false},
  {id:"promo_grupal5",    nombre:"Descuento grupal (5+ pax)",descuento:40, editable:false},
  {id:"promo_colaborador",nombre:"Colaborador IBERO",        descuento:90, editable:false},
  {id:"promo_beca",       nombre:"Beca especial",            descuento:0,  editable:true},
];

// ─── FESTIVOS MÉXICO ──────────────────────────────────
const FESTIVOS_FIJOS = {
  "01-01":"Año Nuevo","02-05":"Día de la Constitución","03-21":"Natalicio de Benito Juárez",
  "05-01":"Día del Trabajo","09-16":"Día de la Independencia","11-02":"Día de Muertos",
  "11-20":"Revolución Mexicana","12-12":"Día de la Virgen de Guadalupe","12-25":"Navidad",
};
const calcViernesSanto = y => {
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mes=Math.floor((h+l-7*m+114)/31),dia=((h+l-7*m+114)%31)+1;
  const pascua=new Date(y,mes-1,dia); pascua.setDate(pascua.getDate()-2);
  return y+"-"+String(pascua.getMonth()+1).padStart(2,"0")+"-"+String(pascua.getDate()).padStart(2,"0");
};
const isFestivo = fecha => {
  if(!fecha)return null;
  const[y,m,d]=fecha.split("-"),clave=m+"-"+d;
  if(FESTIVOS_FIJOS[clave])return FESTIVOS_FIJOS[clave];
  const vs=calcViernesSanto(parseInt(y));
  const js=new Date(vs+"T12:00:00"); js.setDate(js.getDate()-1);
  const jsStr=y+"-"+String(js.getMonth()+1).padStart(2,"0")+"-"+String(js.getDate()).padStart(2,"0");
  if(fecha===vs)return"Viernes Santo";
  if(fecha===jsStr)return"Jueves Santo";
  return null;
};

// Genera fechas de clase automáticamente respetando festivos
const generarFechasClase = (fechaInicio,fechaFin,dias,clases,excepciones=[]) => {
  if(!fechaInicio||!fechaFin||!dias||!dias.length)return[];
  const DIAS_S=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  const ini=new Date(fechaInicio+"T12:00:00"),fin=new Date(fechaFin+"T12:00:00"),cur=new Date(ini);
  const resultado=[];
  while(cur<=fin&&resultado.length<(clases||99)){
    const da=DIAS_S[(cur.getDay()+6)%7];
    const iso=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
    if(dias.includes(da)&&!isFestivo(iso)&&!(excepciones||[]).includes(iso))resultado.push(iso);
    cur.setDate(cur.getDate()+1);
  }
  return resultado;
};
const MESES_C = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DIAS_S  = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const TIPOS_PROG = [
  {valor:"Diplomado", desc:"80+ hrs"},
  {valor:"Curso",     desc:"20–79 hrs"},
  {valor:"Seminario", desc:"8–20 hrs"},
  {valor:"Taller",    desc:"4–16 hrs"},
  {valor:"Otro",      desc:"Personalizable"},
];
const ALL_PERMISOS = [
  {key:"verProgramas",        label:"Ver programas y módulos"},
  {key:"editarProgramas",     label:"Agregar / editar programas"},
  {key:"editarModulos",       label:"Agregar / editar módulos"},
  {key:"confirmarDocentes",   label:"Confirmar docentes"},
  {key:"gestionarUsuarios",   label:"Gestionar usuarios"},
  {key:"configurarNotif",     label:"Configurar notificaciones"},
  {key:"verReportes",         label:"Ver reportes / estadísticas"},
  {key:"importarEstudiantes", label:"Importar estudiantes desde CRM"},
  {key:"gestionarDocentes",   label:"Gestionar catálogo de docentes"},
];
const ADMIN_P  = Object.fromEntries(ALL_PERMISOS.map(p=>[p.key,true]));
const VIEWER_P = {verProgramas:true,...Object.fromEntries(ALL_PERMISOS.slice(1).map(p=>[p.key,false]))};
const DEFAULT_USERS = [{nombre:"Administrador",email:"admin@ibero.mx",password:"ibero2026",permisos:ADMIN_P}];
const ST_STYLE = {
  activo:    {label:"Activo",    bg:"#f0fdf4",color:"#16a34a",border:"#bbf7d0"},
  proximo:   {label:"Próximo",   bg:"#eff6ff",color:"#2563eb",border:"#bfdbfe"},
  finalizado:{label:"Finalizado",bg:"#f3f4f6",color:"#6b7280",border:"#e5e7eb"},
  sin_fechas:{label:"Sin fechas",bg:"#fffbeb",color:"#d97706",border:"#fde68a"},
};
const GRADO_C = {
  Licenciatura:{bg:"#eff6ff",color:"#2563eb"},
  Maestría:    {bg:"#f5f3ff",color:"#7c3aed"},
  Doctorado:   {bg:"#fef2f2",color:"#dc2626"},
};
const CATEGORIA_DOCENTE = {
  A: {label:"Categoría A", tarifa:650, bg:"#f0fdf4", color:"#16a34a"},
  B: {label:"Categoría B", tarifa:500, bg:"#eff6ff", color:"#2563eb"},
};

const INIT_DATA = [{
  id:"prog1", nombre:"Diplomado en Alta Dirección", tipo:"Diplomado", color:"#C8102E", estudiantes:[], modulos:[
    {id:"m1",numero:"I",  nombre:"Liderazgo y Dirección con Sentido Humano",              docenteId:"",docente:"Gonzalo González",clases:4,horasPorClase:3,horario:"",fechaInicio:"2025-04-14",fechaFin:"2025-05-05",dias:["Lun"],estatus:"confirmado",emailDocente:""},
    {id:"m2",numero:"II", nombre:"Pensamiento Estratégico y Toma de Decisiones Complejas",docenteId:"",docente:"Jorge Loera",    clases:4,horasPorClase:3,horario:"",fechaInicio:"2025-05-12",fechaFin:"2025-06-02",dias:["Lun"],estatus:"confirmado",emailDocente:""},
    {id:"m3",numero:"III",nombre:"Gestión del Potencial Humano y Equipos de Alto Desempeño",docenteId:"",docente:"",            clases:4,horasPorClase:3,horario:"",fechaInicio:"2025-06-09",fechaFin:"2025-06-30",dias:["Lun"],estatus:"propuesta", emailDocente:""},
    {id:"m4",numero:"IV", nombre:"Gestión Financiera Estratégica",                         docenteId:"",docente:"Rogelio Herrera",clases:4,horasPorClase:3,horario:"",fechaInicio:"2025-07-07",fechaFin:"2025-08-11",dias:["Lun"],estatus:"confirmado",emailDocente:""},
    {id:"m5",numero:"V",  nombre:"Gobierno Corporativo, Sustentabilidad y Responsabilidad Social",docenteId:"",docente:"Claudia Flores",clases:4,horasPorClase:3,horario:"",fechaInicio:"2025-08-18",fechaFin:"2025-09-08",dias:["Lun"],estatus:"confirmado",emailDocente:""},
  ]
}];

// ─── HELPERS ──────────────────────────────────────────
const fmtFecha = d => {
  if (!d) return "";
  const [y,m,day] = d.split("-");
  return parseInt(day)+" "+MESES_C[parseInt(m)-1]+" "+y;
};
const fmtMXN = n => n!=null ? "$"+Number(n).toLocaleString("es-MX",{minimumFractionDigits:0,maximumFractionDigits:0}) : "—";
const newId  = () => Math.random().toString(36).slice(2,9);
const can    = (s,p) => !!(s && s.permisos && s.permisos[p]);
const today  = () => new Date().toISOString().split("T")[0];
const mods   = p => (p && p.modulos) || [];
const ests   = p => (p && p.estudiantes) || [];

const progStatus = p => {
  const starts = mods(p).map(m=>m.fechaInicio).filter(Boolean).sort();
  const ends   = mods(p).map(m=>m.fechaFin).filter(Boolean).sort().reverse();
  if (!starts.length) return "sin_fechas";
  const t = today();
  if (t < starts[0]) return "proximo";
  if (t > ends[0])   return "finalizado";
  return "activo";
};

const calcPct = (est, modulos) => {
  if (!est || !modulos || !modulos.length) return null;
  const total = modulos.reduce((a,m)=>a+(m.clases||0), 0);
  if (!total) return null;
  const asist = modulos.reduce((a,m)=>{
    const v = est.asistencia && est.asistencia["mod_"+m.id];
    return a + (v || 0);
  }, 0);
  return Math.round(asist/total*100);
};

const RECARGO_PCT = 6;

// Calcula honorarios de un módulo según categoría del docente
const calcHonorarios = (mod, docentes) => {
  if (!mod.docente&&!mod.docenteId) return 0;
  const doc = docentes.find(d=>d.id===mod.docenteId||d.nombre===mod.docente);
  const cat = CATEGORIA_DOCENTE[doc?.categoria||"A"];
  const horas = (mod.clases||0)*(mod.horasPorClase||0);
  return horas * cat.tarifa;
};

// Proyección mensual: por cada parcialidad pendiente o pagada, asigna al mes de vencimiento
const proyeccionMensual = (programas, docentes) => {
  const byMes = {}; // "2025-04" -> {esperado, cobrado, honorarios}

  (programas||[]).forEach(prog=>{
    // Ingresos por parcialidades
    ests(prog).forEach(est=>{
      const p=est.pago;
      if(!p||!p.monto_acordado) return;
      const mf=p.monto_acordado*(1-(p.descuento_pct||0)/100);

      if(p.tipo==="unico"){
        // Pago único: asignar al mes de inicio del programa
        const mesKey=(mods(prog).map(m=>m.fechaInicio).filter(Boolean).sort()[0]||"").substring(0,7);
        if(!mesKey)return;
        if(!byMes[mesKey])byMes[mesKey]={esperado:0,cobrado:0,honorarios:0};
        byMes[mesKey].esperado+=mf;
        const pagado=(p.parcialidades||[]).some(x=>x.pagado);
        if(pagado)byMes[mesKey].cobrado+=mf;
      } else {
        // Parcialidades: asignar cada una a su mes de vencimiento
        (p.parcialidades||[]).forEach(parc=>{
          const mesKey=(parc.fecha_vencimiento||parc.fecha_pago||"").substring(0,7);
          if(!mesKey)return;
          if(!byMes[mesKey])byMes[mesKey]={esperado:0,cobrado:0,honorarios:0};
          const montoParcialidad=mf/(p.parcialidades.length||1);
          byMes[mesKey].esperado+=montoParcialidad;
          if(parc.pagado)byMes[mesKey].cobrado+=montoParcialidad;
        });
      }
    });

    // Honorarios por módulo: asignar al mes de inicio del módulo
    mods(prog).forEach(mod=>{
      if(!mod.fechaInicio)return;
      const mesKey=mod.fechaInicio.substring(0,7);
      if(!byMes[mesKey])byMes[mesKey]={esperado:0,cobrado:0,honorarios:0};
      byMes[mesKey].honorarios+=calcHonorarios(mod,docentes);
    });
  });

  return byMes;
};

// Calcula el estado de pagos de un estudiante
const calcEstadoPagos = (est) => {
  const p = est.pago;
  if (!p||p.tipo!=="parcialidades"||!(p.parcialidades||[]).length) return null;
  const hoy = today();
  // Vencida: fecha de vencimiento ya pasó y no está pagada
  const vencidas = (p.parcialidades||[]).filter(parc=>
    !parc.pagado && parc.fecha_vencimiento && parc.fecha_vencimiento < hoy
  );
  // Con recargo: no pagada y ya pasó la fecha de vencimiento (día 15)
  // A partir del día 16 aplica recargo
  const conRecargo = (p.parcialidades||[]).filter(parc=>{
    if (parc.pagado||!parc.fecha_vencimiento) return false;
    return parc.fecha_vencimiento < hoy; // si hoy > día 15 del mes → vencida con recargo
  });
  return {vencidas, conRecargo, total:(p.parcialidades||[]).length, pagadas:(p.parcialidades||[]).filter(x=>x.pagado).length};
};

const getAlertas = programas => {
  const alerts = [];
  (programas||[]).forEach(prog => {
    mods(prog).forEach(mod => {
      if (!mod.docente && mod.fechaInicio) {
        const diff = Math.round((new Date(mod.fechaInicio) - new Date(today()))/(86400000));
        if (diff >= 0 && diff <= 14) alerts.push({tipo:"sin_docente",prog,mod,dias:diff});
      }
    });
    ests(prog).forEach(est => {
      const pct = calcPct(est, mods(prog));
      if (pct !== null && pct < 80 && progStatus(prog)==="activo")
        alerts.push({tipo:"asistencia",prog,est,pct});

      // Alertas de pago
      const ep = calcEstadoPagos(est);
      if (!ep) return;
      const mf = (est.pago.monto_acordado||0)*(1-(est.pago.descuento_pct||0)/100);
      const montoParcialidad = ep.total ? mf/ep.total : 0;
      const recargo = montoParcialidad * (RECARGO_PCT/100);

      if (ep.conRecargo.length >= 2) {
        // Alerta roja: 2+ mensualidades sin pagar después del día 15
        alerts.push({tipo:"pago_critico",prog,est,vencidas:ep.conRecargo.length,montoParcialidad,recargo:recargo*ep.conRecargo.length});
      } else if (ep.conRecargo.length === 1) {
        // Alerta amarilla: 1 mensualidad vencida después del día 15
        alerts.push({tipo:"pago_recargo",prog,est,vencidas:ep.conRecargo,montoParcialidad,recargo});
      }
    });
  });
  return alerts;
};

// ─── COMPONENTES BASE ─────────────────────────────────
const IberoLogo = ({h=44}) => (
  <svg height={h} viewBox="0 0 220 80" xmlns="http://www.w3.org/2000/svg">
    <rect width="220" height="80" fill="#C8102E"/>
    <text x="12" y="58" fontFamily="Georgia,serif" fontSize="56" fontWeight="900" fill="white" letterSpacing="2">IBERO</text>
    <text x="14" y="74" fontFamily="Arial,sans-serif" fontSize="16" fill="white" letterSpacing="6">TIJUANA</text>
  </svg>
);

const StatusBadge = ({p}) => {
  const ss = ST_STYLE[progStatus(p)];
  return <span style={{background:ss.bg,border:"1px solid "+ss.border,color:ss.color,borderRadius:4,padding:"2px 8px",fontSize:11,fontFamily:"system-ui",fontWeight:700}}>{ss.label}</span>;
};

// ─── CONFIRMACIÓN SIMPLE ──────────────────────────────
function ConfirmSimple({titulo,mensaje,onConfirm,onClose}) {
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",overflow:"hidden"}}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif",marginBottom:4}}>{titulo}</div>
          <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",lineHeight:1.6}}>{mensaje}</div>
        </div>
        <div style={{padding:"16px 24px",background:"#fafafa",display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{background:"#f3f4f6",color:"#374151",border:"none",borderRadius:6,padding:"9px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>Cancelar</button>
          <button onClick={()=>{onConfirm();onClose();}} style={{background:"#dc2626",color:"#fff",border:"none",borderRadius:6,padding:"9px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>Sí, eliminar</button>
        </div>
      </div>
    </div>
  );
}

// ─── CONFIRMACIÓN CON TEXTO ESCRITO ──────────────────
function ConfirmEscrita({titulo,subtitulo,mensaje,onConfirm,onClose}) {
  const [texto,setTexto] = useState("");
  const valido = texto === "ELIMINAR";
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",overflow:"hidden"}}>
        <div style={{background:"#fef2f2",padding:"20px 24px",borderBottom:"1px solid #fca5a5"}}>
          <div style={{fontWeight:700,fontSize:16,color:"#dc2626",fontFamily:"Georgia,serif"}}>{titulo}</div>
          {subtitulo&&<div style={{fontSize:13,color:"#dc2626",marginTop:4,fontFamily:"system-ui"}}>{subtitulo}</div>}
        </div>
        <div style={{padding:"20px 24px"}}>
          <p style={{fontSize:14,color:"#374151",fontFamily:"system-ui",margin:"0 0 16px",lineHeight:1.6}}>{mensaje}</p>
          <p style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",margin:"0 0 8px"}}>Para confirmar escribe <strong style={{color:"#dc2626"}}>ELIMINAR</strong>:</p>
          <input value={texto} onChange={e=>setTexto(e.target.value)} placeholder="ELIMINAR"
            style={{width:"100%",border:"2px solid "+(valido?"#dc2626":"#e5e7eb"),borderRadius:6,padding:"10px 12px",fontSize:15,boxSizing:"border-box",fontFamily:"system-ui",outline:"none",fontWeight:700,color:"#dc2626",letterSpacing:"1px"}}/>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
            <button onClick={onClose} style={{background:"#f3f4f6",color:"#374151",border:"none",borderRadius:6,padding:"10px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>Cancelar</button>
            <button onClick={()=>{if(valido){onConfirm();onClose();}}} disabled={!valido}
              style={{background:valido?"#dc2626":"#e5e7eb",color:valido?"#fff":"#9ca3af",border:"none",borderRadius:6,padding:"10px 20px",cursor:valido?"pointer":"default",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>
              Eliminar definitivamente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const S = { // estilos reutilizables
  inp: {width:"100%",border:"1px solid #e5e7eb",borderRadius:6,padding:"9px 12px",fontSize:14,boxSizing:"border-box",fontFamily:"system-ui",outline:"none"},
  lbl: {fontSize:11,fontWeight:700,color:"#6b7280",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:"system-ui"},
  card:{background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
  btn: (bg,color,extra={}) => ({border:"none",borderRadius:6,padding:"8px 16px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui",background:bg,color,...extra}),
};

// ─── LOGIN ────────────────────────────────────────────
function LoginScreen({onLogin}) {
  const [email,setEmail] = useState("");
  const [pw,setPw]       = useState("");
  const [err,setErr]     = useState("");
  const [busy,setBusy]   = useState(false);

  const go = () => {
    setBusy(true); setErr("");
    setTimeout(()=>{
      const users = JSON.parse(localStorage.getItem(UK)||JSON.stringify(DEFAULT_USERS));
      const u = users.find(u=>u.email.toLowerCase()===email.toLowerCase()&&u.password===pw);
      if (u) { localStorage.setItem(SK2,JSON.stringify(u)); onLogin(u); }
      else setErr("Correo o contraseña incorrectos.");
      setBusy(false);
    },500);
  };

  return (
    <div style={{minHeight:"100vh",background:"#f2f2f2",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:10,boxShadow:"0 4px 32px rgba(0,0,0,0.10)",width:"100%",maxWidth:400,overflow:"hidden"}}>
        <div style={{background:RED,padding:"24px 36px",display:"flex",justifyContent:"center"}}><IberoLogo h={60}/></div>
        <div style={{padding:"32px 36px"}}>
          <div style={{fontWeight:700,fontSize:17,marginBottom:4,fontFamily:"Georgia,serif"}}>Acceso al sistema</div>
          <div style={{fontSize:13,color:"#9ca3af",marginBottom:24,fontFamily:"system-ui"}}>Coordinación de Educación Continua</div>
          {[["Correo electrónico","email",email,setEmail],["Contraseña","password",pw,setPw]].map(([l,t,v,sv])=>(
            <div key={t} style={{marginBottom:16}}>
              <label style={S.lbl}>{l}</label>
              <input type={t} value={v} onChange={e=>sv(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={S.inp}/>
            </div>
          ))}
          {err&&<div style={{background:"#fef2f2",color:"#dc2626",borderRadius:6,padding:"10px 14px",fontSize:13,marginBottom:16,fontFamily:"system-ui"}}>{err}</div>}
          <button onClick={go} disabled={busy} style={{...S.btn(RED,"#fff"),width:"100%",padding:"12px"}}>{busy?"Verificando...":"Iniciar sesión"}</button>
        </div>
      </div>
      <div style={{marginTop:20,fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>© 2026 IBERO Tijuana · Sistema interno</div>
    </div>
  );
}

// ─── LISTA PÚBLICA DOCENTE ────────────────────────────
function ListaDocente({programas, onSave}) {
  const token = new URLSearchParams(window.location.search).get("lista");
  let progId, modId;
  try { const d=JSON.parse(atob(token)); progId=d.progId; modId=d.modId; } catch(e) { return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:RED}}>Enlace inválido.</div>; }

  const prog = (programas||[]).find(p=>p.id===progId);
  const mod  = prog && mods(prog).find(m=>m.id===modId);
  if (!prog||!mod) return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:RED}}>Módulo no encontrado.</div>;

  const hoy = today();
  const fmtHoy = () => { const d=new Date(); return d.getDate()+" de "+MESES_L[d.getMonth()]+" de "+d.getFullYear(); };

  // Calcular si hoy es día de clase
  const fechasClase = mod.fechasClase&&mod.fechasClase.length
    ? mod.fechasClase
    : generarFechasClase(mod.fechaInicio,mod.fechaFin,mod.dias,mod.clases);
  const esHoyClase = fechasClase.includes(hoy);
  const festivo = isFestivo(hoy);
  const numClaseHoy = fechasClase.indexOf(hoy)+1;
  const maxClases = fechasClase.length||mod.clases||0;

  const [local,setLocal] = useState(()=>ests(prog).map(e=>({...e,asistencia:{...(e.asistencia||{})}})));
  const [saved,setSaved] = useState(false);

  // Presente/ausente por fecha — asistencia guardada como array de fechas
  const presenteHoy = e => {
    const v = e.asistencia&&e.asistencia["mod_"+modId];
    return Array.isArray(v) ? v.includes(hoy) : false;
  };

  const totalAsist = e => {
    const v = e.asistencia&&e.asistencia["mod_"+modId];
    return Array.isArray(v) ? v.length : (v||0);
  };

  const toggle = id => {
    if (!esHoyClase) return;
    setLocal(prev=>prev.map(e=>{
      if (e.id!==id) return e;
      const k="mod_"+modId;
      const cur = e.asistencia&&e.asistencia[k];
      let fechas = Array.isArray(cur) ? [...cur] : [];
      if (fechas.includes(hoy)) fechas=fechas.filter(f=>f!==hoy);
      else fechas=[...fechas,hoy];
      return {...e,asistencia:{...(e.asistencia||{}),[k]:fechas}};
    }));
    setSaved(false);
  };

  const presentes = local.filter(presenteHoy).length;

  return (
    <div style={{minHeight:"100vh",background:"#f2f2f2",fontFamily:"system-ui"}}>
      <div style={{background:RED,padding:"16px 24px",display:"flex",alignItems:"center",gap:16}}>
        <IberoLogo h={40}/>
        <div style={{color:"rgba(255,255,255,0.85)",fontSize:13}}>Lista de Asistencia · Coordinación de Educación Continua</div>
      </div>

      <div style={{maxWidth:680,margin:"0 auto",padding:"24px 16px"}}>
        {/* Info del módulo */}
        <div style={{...S.card,padding:24,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:RED,letterSpacing:"1px",marginBottom:4}}>PROGRAMA</div>
          <div style={{fontWeight:700,fontSize:17,fontFamily:"Georgia,serif",marginBottom:2}}>{prog.nombre}</div>
          <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>Módulo {mod.numero} · {mod.nombre}</div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,color:"#374151"}}>
            {mod.docente&&<div><span style={{color:"#9ca3af"}}>Docente: </span><strong>{mod.docente}</strong></div>}
            {mod.fechaInicio&&<div><span style={{color:"#9ca3af"}}>Período: </span><strong>{fmtFecha(mod.fechaInicio)} — {fmtFecha(mod.fechaFin)}</strong></div>}
            {mod.horario&&<div><span style={{color:"#9ca3af"}}>Horario: </span><strong>{mod.horario}</strong></div>}
          </div>
        </div>

        {/* Estado del día */}
        {festivo&&(
          <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"14px 18px",marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:14,color:"#92400e"}}>Día festivo: {festivo}</div>
            <div style={{fontSize:13,color:"#92400e",marginTop:2}}>No hay clase programada hoy.</div>
          </div>
        )}
        {!esHoyClase&&!festivo&&(
          <div style={{background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,padding:"14px 18px",marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:14,color:"#374151"}}>Hoy no hay clase programada</div>
            <div style={{fontSize:13,color:"#6b7280",marginTop:2}}>
              {fechasClase.filter(f=>f>hoy).length>0
                ? "Próxima clase: "+fmtFecha(fechasClase.filter(f=>f>hoy)[0])
                : "No hay más clases programadas."}
            </div>
          </div>
        )}
        {esHoyClase&&(
          <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"14px 18px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:"#16a34a"}}>Clase {numClaseHoy} de {maxClases} · {fmtHoy()}</div>
              <div style={{fontSize:13,color:"#16a34a",marginTop:2}}>{presentes} de {local.length} presentes</div>
            </div>
            <div style={{fontSize:22,fontWeight:800,color:"#16a34a"}}>{local.length>0?Math.round(presentes/local.length*100):0}%</div>
          </div>
        )}

        {/* Lista estudiantes — solo si hay clase hoy */}
        {esHoyClase&&(
          <>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>Toca el nombre para marcar presente o ausente.</div>
            <div style={{display:"grid",gap:8,marginBottom:20}}>
              {local.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:40}}>Sin estudiantes en este módulo.</div>}
              {local.map(e=>{
                const presente=presenteHoy(e);
                const tot=totalAsist(e);
                const pct=maxClases?Math.round(tot/maxClases*100):0;
                return(
                  <div key={e.id} onClick={()=>toggle(e.id)}
                    style={{...S.card,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",border:"2px solid "+(presente?"#16a34a":"#e5e7eb"),background:presente?"#f0fdf4":"#fff",transition:"all 0.12s"}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:presente?"#16a34a":"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontWeight:800,fontSize:15,color:presente?"#fff":"#9ca3af"}}>
                      {presente?"✓":""}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:15,color:presente?"#16a34a":"#1a1a1a"}}>{e.nombre}</div>
                      <div style={{fontSize:12,color:"#6b7280",marginTop:2,display:"flex",gap:10,flexWrap:"wrap"}}>
                        {e.puesto&&<span>{e.puesto}</span>}
                        {e.empresa&&<span>{e.empresa}</span>}
                        {e.email&&<span>{e.email}</span>}
                      </div>
                      <div style={{marginTop:6,display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:80,height:3,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                          <div style={{width:pct+"%",height:"100%",background:pct>=80?"#16a34a":"#dc2626",borderRadius:4}}/>
                        </div>
                        <span style={{fontSize:11,color:pct>=80?"#16a34a":"#dc2626",fontWeight:700}}>{tot}/{maxClases} · {pct}%</span>
                      </div>
                    </div>
                    <div style={{fontWeight:700,fontSize:13,color:presente?"#16a34a":"#9ca3af",flexShrink:0}}>
                      {presente?"Presente":"Ausente"}
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={()=>{onSave(progId,modId,local);setSaved(true);}}
              style={{...S.btn(RED,"#fff"),width:"100%",padding:14,fontSize:15}}>
              {saved?"Asistencia guardada":"Guardar asistencia"}
            </button>
            {saved&&<div style={{textAlign:"center",fontSize:13,color:"#16a34a",marginTop:12,fontWeight:600}}>Guardado correctamente.</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── IMPORT MODAL ─────────────────────────────────────
// ─── MODAL DE PAGO POR ESTUDIANTE ─────────────────────
function PagoModal({est,prog,onSave,onClose}) {
  const pago0 = est.pago||{tipo:"unico",monto_acordado:est.monto_ghl||0,descuento_pct:0,promocion_id:"",parcialidades:[],notas:""};
  const [pago,setPago] = useState(pago0);
  const [newPromo,setNewPromo] = useState({nombre:"",descuento:0});

  const precioLista = prog.precioLista||0;
  const parcDefault = prog.parcialidadesDefault||5;
  const promociones = prog.promociones||[];

  const montoFinal = pago.monto_acordado * (1 - (pago.descuento_pct||0)/100);
  const montoParcialidad = pago.tipo==="parcialidades" && pago.parcialidades.length>0
    ? montoFinal / pago.parcialidades.length : 0;

  const aplicarPromocion = id => {
    const pr = promociones.find(p=>p.id===id);
    setPago({...pago,promocion_id:id,descuento_pct:pr?pr.descuento:0});
  };

  // Calcula fecha de vencimiento mensual a partir del mes siguiente al inicio del programa
  const calcFechasVencimiento = (n, fechaInicioProg) => {
    const base = fechaInicioProg ? new Date(fechaInicioProg+"T12:00:00") : new Date();
    // Primera parcialidad ya está pagada (pago al inscribirse)
    // Vencen el día 15 del mes siguiente, mes a mes
    return Array.from({length:n},(_,i)=>{
      const d = new Date(base.getFullYear(), base.getMonth()+i+1, 1);
      return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-15";
    });
  };

  const fechaInicioProg = mods(prog).map(m=>m.fechaInicio).filter(Boolean).sort()[0]||"";

  const generarParcialidades = n => {
    const fechas = calcFechasVencimiento(n, fechaInicioProg);
    const parcs = Array.from({length:n},(_,i)=>({
      id:newId(),
      numero:i+1,
      pagado:i===0, // primera ya pagada
      fecha_pago:i===0?today():"",       // fecha real de pago
      fecha_vencimiento:fechas[i],        // fecha programada de vencimiento
    }));
    setPago({...pago,parcialidades:parcs});
  };

  const toggleParcialidad = (id,fecha) => {
    setPago({...pago,parcialidades:pago.parcialidades.map(p=>
      p.id===id?{...p,pagado:!p.pagado,fecha_pago:!p.pagado?fecha||today():""}:p
    )});
  };

  const pagosPagados = (pago.parcialidades||[]).filter(p=>p.pagado).length;
  const totalParcialidades = (pago.parcialidades||[]).length;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:540,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Configurar pago</div>
            <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>{est.nombre}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
        </div>
        <div style={{padding:"20px 24px"}}>

          {/* Referencia GHL */}
          {est.monto_ghl>0&&(
            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",marginBottom:8,fontFamily:"system-ui",fontSize:13}}>
              <span style={{color:"#92400e"}}>Monto GHL (referencia): </span>
              <strong style={{color:"#92400e"}}>{fmtMXN(est.monto_ghl)}</strong>
            </div>
          )}
          {(est.requiere_factura||est.csf_url)&&(
            <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
              {est.requiere_factura&&<span style={{fontSize:12,background:est.requiere_factura==="Sí"?"#fef2f2":"#f3f4f6",borderRadius:6,padding:"4px 12px",color:est.requiere_factura==="Sí"?RED:"#6b7280",fontFamily:"system-ui",fontWeight:600,border:"1px solid "+(est.requiere_factura==="Sí"?"#fca5a5":"#e5e7eb")}}>Factura: {est.requiere_factura}</span>}
              {est.csf_url&&<a href={est.csf_url} target="_blank" rel="noreferrer" style={{fontSize:12,background:"#f0fdf4",borderRadius:6,padding:"4px 12px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600,textDecoration:"none",border:"1px solid #bbf7d0"}}>Descargar CSF</a>}
            </div>
          )}

          {/* Precio lista y monto acordado */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <div>
              <label style={S.lbl}>Precio lista del programa</label>
              <div style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"9px 12px",fontFamily:"system-ui",fontSize:14,color:"#6b7280",background:"#f9f9f9"}}>{precioLista>0?fmtMXN(precioLista):"Sin definir"}</div>
            </div>
            <div>
              <label style={S.lbl}>Precio acordado (MXN)</label>
              <input type="number" min="0" value={pago.monto_acordado||""} onChange={e=>setPago({...pago,monto_acordado:parseFloat(e.target.value)||0})} placeholder="0" style={S.inp}/>
            </div>
          </div>

          {/* Promoción */}
          <div style={{marginBottom:14}}>
            <label style={S.lbl}>Promoción aplicada</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              <button onClick={()=>setPago({...pago,promocion_id:"",descuento_pct:0})} style={{border:"2px solid "+(pago.promocion_id===""?RED:"#e5e7eb"),borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:pago.promocion_id===""?"#fef2f2":"#fff",color:pago.promocion_id===""?RED:"#6b7280",fontWeight:600}}>Sin promoción</button>
              {promociones.map(pr=>(
                <button key={pr.id} onClick={()=>aplicarPromocion(pr.id)} style={{border:"2px solid "+(pago.promocion_id===pr.id?RED:"#e5e7eb"),borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:pago.promocion_id===pr.id?"#fef2f2":"#fff",color:pago.promocion_id===pr.id?RED:"#6b7280",fontWeight:600}}>{pr.nombre} {pr.descuento}%</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <label style={{...S.lbl,margin:0,minWidth:80}}>Descuento %</label>
              <input type="number" min="0" max="100" value={pago.descuento_pct||0} onChange={e=>setPago({...pago,descuento_pct:parseFloat(e.target.value)||0,promocion_id:""})} style={{...S.inp,width:80,textAlign:"center"}}/>
              {pago.descuento_pct>0&&<span style={{fontFamily:"system-ui",fontSize:13,color:"#16a34a",fontWeight:700}}>Ahorro: {fmtMXN(pago.monto_acordado*(pago.descuento_pct/100))}</span>}
            </div>
          </div>

          {/* Monto final */}
          <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:"system-ui",fontSize:13,color:"#16a34a",fontWeight:600}}>Monto final a cobrar</span>
            <span style={{fontFamily:"system-ui",fontSize:20,fontWeight:800,color:"#16a34a"}}>{fmtMXN(montoFinal)}</span>
          </div>

          {/* Tipo de pago */}
          <div style={{marginBottom:14}}>
            <label style={S.lbl}>Tipo de pago</label>
            <div style={{display:"flex",gap:8}}>
              {[["unico","Pago único"],["parcialidades","Parcialidades"]].map(([v,l])=>(
                <button key={v} onClick={()=>{
                  if(v==="parcialidades"&&pago.parcialidades.length===0) generarParcialidades(parcDefault);
                  else setPago({...pago,tipo:v});
                }} style={{flex:1,border:"2px solid "+(pago.tipo===v?RED:"#e5e7eb"),borderRadius:8,padding:"10px",cursor:"pointer",fontFamily:"system-ui",fontWeight:700,fontSize:13,background:pago.tipo===v?"#fef2f2":"#fff",color:pago.tipo===v?RED:"#6b7280"}}>{l}</button>
              ))}
            </div>
          </div>

          {/* Parcialidades */}
          {pago.tipo==="parcialidades"&&(
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <label style={S.lbl}>Parcialidades ({pagosPagados}/{totalParcialidades} pagadas)</label>
                <div style={{display:"flex",gap:6}}>
                  {[3,5,6,10,12].map(n=>(
                    <button key={n} onClick={()=>generarParcialidades(n)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:totalParcialidades===n?"#fef2f2":"#fff",color:totalParcialidades===n?RED:"#6b7280",fontWeight:totalParcialidades===n?700:400}}>{n}</button>
                  ))}
                </div>
              </div>
              {totalParcialidades>0&&(
                <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginBottom:8,display:"flex",gap:16}}>
                  <span>{fmtMXN(montoFinal/totalParcialidades)} por parcialidad</span>
                  <span style={{color:"#16a34a"}}>1ª parcialidad cubierta al inscribirse · Las siguientes vencen el día 15 de cada mes</span>
                </div>
              )}
              <div style={{display:"grid",gap:6}}>
                {(pago.parcialidades||[]).map((p,i)=>{
                  const vencido = !p.pagado && p.fecha_vencimiento && p.fecha_vencimiento < today();
                  const hoy15 = today().substring(0,8)+"15";
                  const proxima = !p.pagado && p.fecha_vencimiento && p.fecha_vencimiento >= today() && p.fecha_vencimiento <= hoy15;
                  return(
                    <div key={p.id} style={{padding:"10px 12px",background:p.pagado?"#f0fdf4":vencido?"#fef2f2":"#f9f9f9",borderRadius:6,border:"1px solid "+(p.pagado?"#bbf7d0":vencido?"#fca5a5":"#e5e7eb")}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <button onClick={()=>toggleParcialidad(p.id)} style={{width:24,height:24,borderRadius:"50%",border:"2px solid "+(p.pagado?"#16a34a":vencido?"#dc2626":"#d1d5db"),background:p.pagado?"#16a34a":"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:12,color:"#fff",fontWeight:700}}>{p.pagado?"✓":""}</button>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:"system-ui",fontSize:13,fontWeight:600}}>
                            Parcialidad {p.numero} — {fmtMXN(totalParcialidades?montoFinal/totalParcialidades:0)}
                            {p.numero===1&&<span style={{fontSize:11,color:"#16a34a",marginLeft:6,fontWeight:400}}>(primer pago al inscribirse)</span>}
                          </div>
                          {p.fecha_vencimiento&&(
                            <div style={{fontSize:11,color:vencido?"#dc2626":proxima?"#d97706":"#9ca3af",fontFamily:"system-ui",marginTop:2}}>
                              Vencimiento: {fmtFecha(p.fecha_vencimiento)}
                              {vencido&&" — Vencido"}
                              {proxima&&" — Próximo a vencer"}
                            </div>
                          )}
                        </div>
                        {/* Editar fecha de vencimiento */}
                        <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                          {!p.pagado&&(
                            <input type="date" value={p.fecha_vencimiento||""} onChange={e=>{const parcs=[...(pago.parcialidades||[])];parcs[i]={...parcs[i],fecha_vencimiento:e.target.value};setPago({...pago,parcialidades:parcs});}} style={{border:"1px solid #e5e7eb",borderRadius:4,padding:"3px 8px",fontSize:11,fontFamily:"system-ui",background:"#fff",color:"#6b7280"}} title="Fecha de vencimiento"/>
                          )}
                          {p.pagado&&(
                            <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"flex-end"}}>
                              <span style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui"}}>Fecha de pago:</span>
                              <input type="date" value={p.fecha_pago||""} onChange={e=>{const parcs=[...(pago.parcialidades||[])];parcs[i]={...parcs[i],fecha_pago:e.target.value};setPago({...pago,parcialidades:parcs});}} style={{border:"1px solid #bbf7d0",borderRadius:4,padding:"3px 8px",fontSize:11,fontFamily:"system-ui",background:"#fff"}}/>
                            </div>
                          )}
                        </div>
                        <span style={{fontSize:12,fontWeight:700,color:p.pagado?"#16a34a":vencido?"#dc2626":"#9ca3af",fontFamily:"system-ui",minWidth:56,textAlign:"right"}}>{p.pagado?"Pagado":vencido?"Vencido":"Pendiente"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notas */}
          <div style={{marginBottom:20}}>
            <label style={S.lbl}>Notas de pago</label>
            <textarea value={pago.notas||""} onChange={e=>setPago({...pago,notas:e.target.value})} placeholder="Convenios, condiciones especiales..." rows={2} style={{...S.inp,resize:"vertical"}}/>
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
            <button onClick={()=>{onSave(pago);onClose();}} style={S.btn(RED,"#fff")}>Guardar pago</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportModal({prog,notifConfig,fieldMap,onImport,onClose}) {
  const [pipelines,setPipelines] = useState([]);
  const [stages,setStages]       = useState([]);
  const [contacts,setContacts]   = useState([]);
  const [selected,setSelected]   = useState([]);
  const [filters,setFilters]     = useState({pipelineId:"",stageId:"",status:"open"});
  const [step,setStep]           = useState("filter");
  const [busy,setBusy]           = useState(false);
  const [err,setErr]             = useState("");

  const hasApi = !!(notifConfig&&notifConfig.apiKey&&notifConfig.locationId);
  const MOCK_PL = [{id:"pipe1",name:"Diplomados 2025"},{id:"pipe2",name:"Cursos Ejecutivos"}];
  const MOCK_ST = {pipe1:[{id:"s1",name:"Inscrito"},{id:"s2",name:"Pagado"}],pipe2:[{id:"s3",name:"Confirmado"}]};
  const MOCK_CT = [
    {id:"c1",name:"José Alberto Gómez",email:"alberto@hotmail.com",phone:"+52311111",company:"Grupo Industrial Norte",source:"Sitio Web",customFields:[{fieldKey:"contact.programa_de_intersz",fieldName:"Programa de interés",fieldValue:"Diplomado en Alta Dirección"},{fieldKey:"contact.puesto_que_desempeas",fieldName:"Puesto",fieldValue:"Director General"}]},
    {id:"c2",name:"María Fernanda López",email:"mflopez@empresa.com",phone:"+52664111",company:"Corporativo TJ",source:"Referido",customFields:[{fieldKey:"contact.programa_de_intersz",fieldName:"Programa de interés",fieldValue:"Diplomado en Alta Dirección"},{fieldKey:"contact.puesto_que_desempeas",fieldName:"Puesto",fieldValue:"Gerente Financiero"}]},
    {id:"c3",name:"Roberto Sánchez",email:"rsanchez@mx.com",phone:"+52664222",company:"Negocios Frontera",source:"LinkedIn",customFields:[{fieldKey:"contact.programa_de_intersz",fieldName:"Programa de interés",fieldValue:"Diplomado en Alta Dirección"},{fieldKey:"contact.puesto_que_desempeas",fieldName:"Puesto",fieldValue:"CEO"}]},
  ];

  useEffect(()=>{
    hasApi
      ? fetch("https://services.leadconnectorhq.com/opportunities/pipelines?locationId="+notifConfig.locationId,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}}).then(r=>r.json()).then(d=>setPipelines(d.pipelines||[])).catch(()=>setPipelines(MOCK_PL))
      : setPipelines(MOCK_PL);
  },[]);

  useEffect(()=>{
    if (!filters.pipelineId) return;
    hasApi ? setStages((pipelines.find(p=>p.id===filters.pipelineId)||{}).stages||[]) : setStages(MOCK_ST[filters.pipelineId]||[]);
    setFilters(f=>({...f,stageId:""}));
  },[filters.pipelineId]);

  const search = async () => {
    if (!filters.pipelineId){setErr("Selecciona un pipeline.");return;}
    setBusy(true); setErr("");
    try {
      if (hasApi) {
        let url="https://services.leadconnectorhq.com/opportunities/search?location_id="+notifConfig.locationId+"&pipeline_id="+filters.pipelineId+"&status="+filters.status;
        if (filters.stageId) url+="&pipeline_stage_id="+filters.stageId;
        const r=await fetch(url,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}});
        const d=await r.json();
        const enriched=await Promise.all((d.opportunities||[]).map(async op=>{
          try{
            const cr=await fetch("https://services.leadconnectorhq.com/contacts/"+op.contactId,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}});
            const cd=await cr.json();
            // Pasamos monetaryValue desde la oportunidad al contacto
            const contact={...cd.contact,opportunityStatus:op.status,monetaryValue:op.monetaryValue||cd.contact?.monetaryValue||0};
            if(cd.contact?.businessId){
              try{
                const br=await fetch("https://services.leadconnectorhq.com/businesses/"+cd.contact.businessId,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}});
                const bd=await br.json();
                contact._empresaNombre=bd.business?.name||bd.name||"";
              }catch(e){}
            }
            return contact;
          }
          catch(e){return{id:op.contactId,name:op.name,opportunityStatus:op.status,monetaryValue:op.monetaryValue||0};}
        }));
        setContacts(enriched);
      } else {
        setContacts(MOCK_CT);
      }
      setStep("preview");
    } catch(e){setErr("Error al conectar. Verifica las credenciales.");}
    setBusy(false);
  };

  const doImport = () => {
    const existing = ests(prog);
    const existIds = new Set(existing.map(e=>e.id));

    const getCF = (customFields, id, fieldKey) => {
      const cf = (customFields||[]).find(f=>f.id===id||f.fieldKey===fieldKey||f.fieldKey==="contact."+fieldKey);
      const val = cf ? cf.value||cf.fieldValue||"" : "";
      return typeof val === "string" ? val.trim() : "";
    };

    // Extrae la URL del campo CSF (es un objeto anidado con url)
    const getCSFUrl = (customFields) => {
      const cf = (customFields||[]).find(f=>f.id==="aPGkrDmlbph34lrEyDmc");
      if (!cf||!cf.value) return "";
      if (typeof cf.value === "string") return cf.value;
      // El valor es un objeto con UUIDs como keys, cada uno tiene {url, documentId}
      const entries = Object.values(cf.value||{});
      if (entries.length>0) return entries[0].url||"";
      return "";
    };

    // Fecha de inicio del primer módulo del programa
    const fechaInicioPrograma = (prog.modulos||[]).map(m=>m.fechaInicio).filter(Boolean).sort()[0]||"";

    // Genera fechas de vencimiento mensuales a partir del mes siguiente al inicio
    const calcVencimientosImport = (n, fechaBase) => {
      const base = fechaBase ? new Date(fechaBase+"T12:00:00") : new Date();
      return Array.from({length:n},(_,i)=>{
        const d = new Date(base.getFullYear(), base.getMonth()+i+1, 1);
        return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-15";
      });
    };

    // Detecta tipo de pago según monto y genera parcialidades
    const buildPago = (monto, parcDefault) => {
      const n = parcDefault||5;
      if (!monto||monto===0) {
        return {tipo:"parcialidades",monto_acordado:0,descuento_pct:0,promocion_id:"",parcialidades:[],notas:""};
      }
      if (monto > 10000) {
        // Pago único — ya cubierto
        return {
          tipo:"unico",
          monto_acordado:monto,
          descuento_pct:0,
          promocion_id:"",
          parcialidades:[{id:newId(),numero:1,pagado:true,fecha_pago:today(),fecha_vencimiento:""}],
          notas:"Pago único — cubierto al inscribirse",
        };
      }
      // Parcialidades (monto < 5000 o entre 5000-10000)
      const fechas = calcVencimientosImport(n, fechaInicioPrograma);
      const parcialidades = Array.from({length:n},(_,i)=>({
        id:newId(),
        numero:i+1,
        pagado:i===0,               // primera ya pagada
        fecha_pago:i===0?today():"",
        fecha_vencimiento:fechas[i],
      }));
      return {
        tipo:"parcialidades",
        monto_acordado:monto,
        descuento_pct:0,
        promocion_id:"",
        parcialidades,
        notas:monto<5000?"Parcialidades — primer pago cubierto al inscribirse":"",
      };
    };

    const toAdd = contacts.filter(c=>selected.includes(c.id)&&!existIds.has(c.id)).map(c=>{
      const cf = c.customFields||[];
      const monto = c.monetaryValue||c.opportunityValue||0;
      return {
        id:               c.id,
        nombre:           c.name||((c.firstName||"")+" "+(c.lastName||"")).trim(),
        email:            c.email||"",
        telefono:         c.phone||"",
        empresa:          c._empresaNombre||c.company||c.company_name||"",
        puesto:           getCF(cf,"Bh2QzKI7oWxAlK61XJLA","contact.puesto_que_desempeas"),
        carrera:          getCF(cf,"jvN3GJ9rxhrXdfcpI1zS","contact.cul_es_tu_carrera_profesional"),
        grado:            getCF(cf,"e7xQs2aAb5UpEwemgShB","contact.ltimo_grado_de_estudios"),
        egresado_ibero:   getCF(cf,"6yYRPsode1sse8Vir7tK","contact.eres_egresada_o_egresado_ibero"),
        programa_interes: getCF(cf,"rWoFzI5aT07JEzAuUhTe","contact.programa_de_intersz"),
        fuente:           getCF(cf,"zGLvQcNfeatO2c4GyxCi","source")||c.source||"",
        requiere_factura: getCF(cf,"HoscJ6RVoX90tYqlkcUb","contact.requiere_factura"),
        csf_url:          getCSFUrl(cf),
        estatus:          "activo",
        asistencia:       {},
        campos_extra:     {},
        monto_ghl:        monto,
        pago:             buildPago(monto, prog.parcialidadesDefault),
      };
    });
    onImport([...existing,...toAdd]);
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Importar / Sincronizar estudiantes</div>
            <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>{prog.nombre}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
        </div>
        <div style={{padding:"20px 24px"}}>
          {!hasApi&&<div style={{marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",fontSize:13,color:"#92400e",fontFamily:"system-ui"}}>Modo simulación — configura credenciales en ⚙️ para usar tu CRM real.</div>}
          {step==="filter"&&(
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                <div><label style={S.lbl}>Pipeline</label><select value={filters.pipelineId} onChange={e=>setFilters(f=>({...f,pipelineId:e.target.value}))} style={S.inp}><option value="">Seleccionar...</option>{pipelines.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                <div><label style={S.lbl}>Etapa</label><select value={filters.stageId} onChange={e=>setFilters(f=>({...f,stageId:e.target.value}))} style={S.inp} disabled={!filters.pipelineId}><option value="">Todas</option>{stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              </div>
              <div style={{marginBottom:20}}>
                <label style={S.lbl}>Estatus</label>
                <div style={{display:"flex",gap:8}}>
                  {[["open","Abierta"],["won","Ganada"],["lost","Perdida"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setFilters(f=>({...f,status:v}))} style={{border:"2px solid "+(filters.status===v?RED:"#e5e7eb"),borderRadius:6,padding:"7px 16px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui",background:filters.status===v?"#fef2f2":"#fff",color:filters.status===v?RED:"#9ca3af"}}>{l}</button>
                  ))}
                </div>
              </div>
              {err&&<div style={{background:"#fef2f2",color:"#dc2626",borderRadius:6,padding:"10px 14px",fontSize:13,marginBottom:14,fontFamily:"system-ui"}}>{err}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={onClose} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={search} disabled={busy} style={S.btn(RED,"#fff")}>{busy?"Buscando...":"Buscar contactos"}</button>
              </div>
            </div>
          )}
          {step==="preview"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{contacts.length} contactos · {selected.length} seleccionados</div>
                <button onClick={()=>setSelected(selected.length===contacts.length?[]:contacts.map(c=>c.id))} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>{selected.length===contacts.length?"Deseleccionar todos":"Seleccionar todos"}</button>
              </div>
              <div style={{display:"grid",gap:8,marginBottom:20}}>
                {contacts.map(c=>{
                  const sel=selected.includes(c.id), already=ests(prog).some(e=>e.id===c.id);
                  return(
                    <div key={c.id} onClick={()=>!already&&setSelected(s=>sel?s.filter(x=>x!==c.id):[...s,c.id])} style={{border:"1px solid "+(sel?"#fca5a5":"#e5e7eb"),borderRadius:8,padding:"12px 16px",cursor:already?"default":"pointer",background:already?"#f9f9f9":sel?"#fef2f2":"#fff",display:"flex",gap:12}}>
                      <div style={{width:18,height:18,border:"2px solid "+(sel?RED:"#d1d5db"),borderRadius:4,background:sel?RED:"#fff",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {sel&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600,fontSize:14,display:"flex",gap:8,alignItems:"center"}}>
                          {c.name}
                          {already&&<span style={{fontSize:11,background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:4,padding:"1px 8px",fontWeight:600,fontFamily:"system-ui"}}>Ya importado</span>}
                        </div>
                        <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
                          {c.email&&<span>{c.email}</span>}{c.phone&&<span>{c.phone}</span>}{c.company&&<span>{c.company}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{marginBottom:12,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",fontFamily:"system-ui",fontSize:12,color:"#92400e"}}>
                <strong>Pago asignado automáticamente:</strong><br/>
                Menor de $5,000 → Parcialidades ({prog.parcialidadesDefault||5}, primera cubierta) · Mayor de $10,000 → Pago único cubierto · Entre ambos → Parcialidades
                {(prog.modulos||[]).map(m=>m.fechaInicio).filter(Boolean).sort()[0]&&(
                  <span> · Vencimientos desde {MESES_L[parseInt(((prog.modulos||[]).map(m=>m.fechaInicio).filter(Boolean).sort()[0]||"").split("-")[1]||1)-1]}</span>
                )}
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"space-between"}}>
                <button onClick={()=>{setStep("filter");setContacts([]);setSelected([]);}} style={S.btn("#f3f4f6","#374151")}>← Volver</button>
                <button onClick={doImport} disabled={!selected.length} style={S.btn(selected.length?RED:"#e5e7eb",selected.length?"#fff":"#9ca3af")}>Importar {selected.length?"("+selected.length+")":""}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CALENDARIO ───────────────────────────────────────
function CalendarioView({programas}) {
  const hoy = new Date();
  const [modo,setModo]         = useState("mes");
  const [dia,setDia]           = useState(hoy.getDate());
  const [mes,setMes]           = useState(hoy.getMonth());
  const [anio,setAnio]         = useState(hoy.getFullYear());
  const [selDia,setSelDia]     = useState(null);
  const [filtroProg,setFiltro] = useState("");
  const TD=hoy.getDate(), TM=hoy.getMonth(), TY=hoy.getFullYear();

  const progs = filtroProg ? (programas||[]).filter(p=>p.id===filtroProg) : (programas||[]);

  const getEvts = (fm,fa,fd) => {
    const evs=[];
    progs.forEach(prog=>{
      mods(prog).forEach(mod=>{
        if (!mod.fechaInicio||!mod.fechaFin) return;
        const ini=new Date(mod.fechaInicio+"T12:00:00"), fin=new Date(mod.fechaFin+"T12:00:00"), cur=new Date(ini);
        while(cur<=fin){
          const dm=cur.getMonth(),dy=cur.getFullYear(),dd=cur.getDate(),da=DIAS_S[(cur.getDay()+6)%7];
          if(mod.dias&&mod.dias.includes(da)&&(fa==null||dy===fa)&&(fm==null||dm===fm)&&(fd==null||dd===fd))
            evs.push({dia:dd,mes:dm,anio:dy,prog,mod});
          cur.setDate(cur.getDate()+1);
        }
      });
    });
    return evs;
  };

  const iniSem = () => { const d=new Date(anio,mes,dia); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; };

  const nav = dir => {
    if (modo==="dia"){const d=new Date(anio,mes,dia+dir);setDia(d.getDate());setMes(d.getMonth());setAnio(d.getFullYear());}
    else if(modo==="semana"){const d=new Date(anio,mes,dia+dir*7);setDia(d.getDate());setMes(d.getMonth());setAnio(d.getFullYear());}
    else if(modo==="mes"){const nm=mes+dir;if(nm<0){setMes(11);setAnio(a=>a-1);}else if(nm>11){setMes(0);setAnio(a=>a+1);}else setMes(nm);}
    else setAnio(a=>a+dir);
    setSelDia(null);
  };

  const titulo = () => {
    if(modo==="dia") return dia+" de "+MESES_L[mes]+" de "+anio;
    if(modo==="semana"){const i=iniSem();return "Semana del "+i.getDate()+" de "+MESES_L[i.getMonth()];}
    if(modo==="mes") return MESES_L[mes]+" "+anio;
    return ""+anio;
  };

  const EvCard = ({e}) => (
    <div style={{display:"flex",gap:10,padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}>
      <div style={{width:4,minHeight:36,borderRadius:4,background:e.prog.color,flexShrink:0}}/>
      <div>
        <div style={{fontWeight:700,fontSize:14}}>{e.mod.nombre}</div>
        <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginTop:2,display:"flex",gap:10,flexWrap:"wrap"}}>
          <span>{e.prog.nombre}</span>{e.mod.horario&&<span>{e.mod.horario}</span>}{e.mod.docente&&<span>{e.mod.docente}</span>}
          <span style={{background:e.mod.estatus==="confirmado"?"#f0fdf4":"#fffbeb",color:e.mod.estatus==="confirmado"?"#16a34a":"#d97706",border:"1px solid "+(e.mod.estatus==="confirmado"?"#bbf7d0":"#fde68a"),borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:700}}>{e.mod.estatus==="confirmado"?"Confirmado":"Propuesta"}</span>
        </div>
      </div>
    </div>
  );

  const RenderDia = () => {
    const evs=getEvts(mes,anio,dia), isT=dia===TD&&mes===TM&&anio===TY;
    return(
      <div style={{...S.card,padding:24}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <div style={{width:48,height:48,borderRadius:12,background:isT?RED:"#f3f4f6",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:20,fontWeight:800,color:isT?"#fff":"#1a1a1a",fontFamily:"system-ui",lineHeight:1}}>{dia}</span>
            <span style={{fontSize:9,color:isT?"rgba(255,255,255,0.8)":"#9ca3af",fontFamily:"system-ui"}}>{DIAS_S[(new Date(anio,mes,dia).getDay()+6)%7]}</span>
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{dia+" de "+MESES_L[mes]+" de "+anio}</div>
            <div style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>{evs.length} clases</div>
          </div>
        </div>
        {evs.length===0?<div style={{textAlign:"center",color:"#9ca3af",padding:"32px 0",fontFamily:"system-ui"}}>Sin clases este día.</div>:evs.map((e,i)=><EvCard key={i} e={e}/>)}
      </div>
    );
  };

  const RenderSemana = () => {
    const ini=iniSem(), dSem=Array.from({length:7}).map((_,i)=>{const d=new Date(ini);d.setDate(ini.getDate()+i);return d;});
    return(
      <div style={{...S.card,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid #e5e7eb"}}>
          {dSem.map((d,i)=>{const isT=d.getDate()===TD&&d.getMonth()===TM&&d.getFullYear()===TY;return(
            <div key={i} style={{padding:"10px 8px",textAlign:"center",background:isT?"#fef2f2":"#fff",borderRight:i<6?"1px solid #f3f4f6":"none"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#6b7280",fontFamily:"system-ui",marginBottom:4}}>{DIAS_S[i]}</div>
              <div style={{width:28,height:28,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>
                <span style={{fontSize:14,fontWeight:isT?700:400,color:isT?"#fff":"#1a1a1a",fontFamily:"system-ui"}}>{d.getDate()}</span>
              </div>
            </div>
          );})}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
          {dSem.map((d,i)=>{const evs=getEvts(d.getMonth(),d.getFullYear(),d.getDate());return(
            <div key={i} style={{minHeight:120,padding:"8px 6px",borderRight:i<6?"1px solid #f3f4f6":"none"}}>
              {evs.map((e,j)=>(
                <div key={j} style={{background:e.prog.color,color:"#fff",borderRadius:4,padding:"3px 6px",fontSize:10,fontFamily:"system-ui",fontWeight:600,marginBottom:3,lineHeight:1.3}}>
                  <div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.mod.numero}</div>
                  <div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",opacity:0.9}}>{e.mod.nombre.split(" ").slice(0,2).join(" ")}</div>
                  {e.mod.horario&&<div style={{opacity:0.8,fontSize:9}}>{e.mod.horario}</div>}
                </div>
              ))}
            </div>
          );})}
        </div>
      </div>
    );
  };

  const RenderMes = () => {
    const pD=new Date(anio,mes,1),uD=new Date(anio,mes+1,0),off=(pD.getDay()+6)%7,tot=Math.ceil((off+uD.getDate())/7)*7;
    const evsMes=getEvts(mes,anio,null),byD={};
    evsMes.forEach(e=>{if(!byD[e.dia])byD[e.dia]=[];byD[e.dia].push(e);});
    return(
      <div>
        <div style={{...S.card,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid #e5e7eb"}}>
            {DIAS_S.map(d=><div key={d} style={{padding:"10px 0",textAlign:"center",fontSize:11,fontWeight:700,color:"#6b7280",fontFamily:"system-ui"}}>{d}</div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
            {Array.from({length:tot}).map((_,i)=>{
              const d=i-off+1,valid=d>=1&&d<=uD.getDate(),isT=valid&&d===TD&&mes===TM&&anio===TY,ev=valid?(byD[d]||[]):[],isSel=selDia===d;
              return(
                <div key={i} onClick={()=>valid&&setSelDia(isSel?null:d)} style={{minHeight:88,padding:"6px 8px",borderRight:(i+1)%7!==0?"1px solid #f3f4f6":"none",borderBottom:i<tot-7?"1px solid #f3f4f6":"none",background:isSel?"#fef2f2":isT?"#fffbeb":"#fff",cursor:valid?"pointer":"default"}}>
                  {valid&&<>
                    <div style={{width:24,height:24,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:4}}>
                      <span style={{fontSize:12,fontWeight:isT?800:400,color:isT?"#fff":"#374151",fontFamily:"system-ui"}}>{d}</span>
                    </div>
                    {ev.slice(0,3).map((e,j)=><div key={j} style={{background:e.prog.color,color:"#fff",borderRadius:3,padding:"2px 5px",fontSize:10,fontFamily:"system-ui",fontWeight:600,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.mod.numero+" · "+e.mod.nombre.split(" ").slice(0,2).join(" ")}</div>)}
                    {ev.length>3&&<div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui"}}>+{ev.length-3} más</div>}
                  </>}
                </div>
              );
            })}
          </div>
        </div>
        {selDia&&byD[selDia]&&<div style={{...S.card,marginTop:16,padding:20}}><div style={{fontWeight:700,fontSize:15,marginBottom:12,fontFamily:"Georgia,serif"}}>{selDia+" de "+MESES_L[mes]+" de "+anio}</div>{byD[selDia].map((e,i)=><EvCard key={i} e={e}/>)}</div>}
      </div>
    );
  };

  const RenderAnio = () => {
    const evs=getEvts(null,anio,null),byM={};
    evs.forEach(e=>{if(!byM[e.mes])byM[e.mes]=[];byM[e.mes].push(e);});
    return(
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {Array.from({length:12}).map((_,m)=>{
          const mEvs=byM[m]||[],pD=new Date(anio,m,1),uD=new Date(anio,m+1,0),off=(pD.getDay()+6)%7,tot=Math.ceil((off+uD.getDate())/7)*7;
          const byD={};mEvs.forEach(e=>{if(!byD[e.dia])byD[e.dia]=[];byD[e.dia].push(e);});
          const isCur=m===TM&&anio===TY;
          return(
            <div key={m} onClick={()=>{setMes(m);setModo("mes");setSelDia(null);}} style={{...S.card,overflow:"hidden",cursor:"pointer",border:"1px solid "+(isCur?"#fca5a5":"#e5e7eb")}}>
              <div style={{background:isCur?RED:"#f9f9f9",padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontWeight:700,fontSize:13,fontFamily:"system-ui",color:isCur?"#fff":"#1a1a1a"}}>{MESES_L[m]}</span>
                {mEvs.length>0&&<span style={{fontSize:11,background:isCur?"rgba(255,255,255,0.2)":"#f3f4f6",color:isCur?"#fff":"#6b7280",borderRadius:20,padding:"2px 8px",fontFamily:"system-ui",fontWeight:600}}>{mEvs.length} clases</span>}
              </div>
              <div style={{padding:"8px 10px"}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:2}}>{DIAS_S.map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"#9ca3af",fontFamily:"system-ui",fontWeight:700}}>{d[0]}</div>)}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
                  {Array.from({length:tot}).map((_,i)=>{
                    const d=i-off+1,valid=d>=1&&d<=uD.getDate(),isT=valid&&d===TD&&m===TM&&anio===TY,hEv=valid&&(byD[d]||[]).length>0,cols=[...new Set((byD[d]||[]).map(e=>e.prog.color))];
                    return(
                      <div key={i} style={{height:18,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {valid&&<div style={{width:16,height:16,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                          <span style={{fontSize:9,color:isT?"#fff":"#374151",fontFamily:"system-ui"}}>{d}</span>
                          {hEv&&!isT&&<div style={{position:"absolute",bottom:-2,left:"50%",transform:"translateX(-50%)",display:"flex",gap:1}}>{cols.slice(0,3).map((c,ci)=><div key={ci} style={{width:3,height:3,borderRadius:"50%",background:c}}/>)}</div>}
                        </div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <h1 style={{fontSize:24,fontWeight:700,margin:0,letterSpacing:"-0.5px"}}>Calendario</h1>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <select value={filtroProg} onChange={e=>setFiltro(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"6px 10px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
            <option value="">Todos los programas</option>
            {(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <div style={{display:"flex",background:"#f3f4f6",borderRadius:8,padding:3,gap:2}}>
            {[["dia","Día"],["semana","Semana"],["mes","Mes"],["anio","Año"]].map(([v,l])=>(
              <button key={v} onClick={()=>{setModo(v);setSelDia(null);}} style={{background:modo===v?"#fff":"transparent",color:modo===v?"#1a1a1a":"#6b7280",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:600,fontSize:12,fontFamily:"system-ui"}}>{l}</button>
            ))}
          </div>
          <button onClick={()=>{setDia(TD);setMes(TM);setAnio(TY);setSelDia(null);}} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px"})}>Hoy</button>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>nav(-1)} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px"})}>←</button>
            <button onClick={()=>nav(1)}  style={S.btn("#f3f4f6","#374151",{padding:"6px 12px"})}>→</button>
          </div>
          <span style={{fontWeight:700,fontSize:14,fontFamily:"system-ui"}}>{titulo()}</span>
        </div>
      </div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
        {progs.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:6,fontFamily:"system-ui",fontSize:12}}><div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/><span style={{color:"#374151"}}>{p.nombre}</span></div>)}
      </div>
      {modo==="dia"    &&<RenderDia/>}
      {modo==="semana" &&<RenderSemana/>}
      {modo==="mes"    &&<RenderMes/>}
      {modo==="anio"   &&<RenderAnio/>}
    </div>
  );
}

// ─── DOCENTES ─────────────────────────────────────────
function DocentesView({docentes,saveDocentes,programas}) {
  const [showM,setShowM]   = useState(false);
  const [form,setForm]     = useState({id:"",nombre:"",telefono:"",email:"",grado:"Licenciatura",categoria:"A",programasIds:[],semblanza:""});
  const [editId,setEditId] = useState(null);
  const [busq,setBusq]     = useState("");

  const openNew = () => { setForm({id:newId(),nombre:"",telefono:"",email:"",grado:"Licenciatura",categoria:"A",programasIds:[],semblanza:""}); setEditId(null); setShowM(true); };
  const openEdit= d => { setForm({...d,programasIds:d.programasIds||[]}); setEditId(d.id); setShowM(true); };
  const saveDoc = () => { if(!form.nombre)return; editId?saveDocentes((docentes||[]).map(d=>d.id===editId?form:d)):saveDocentes([...(docentes||[]),form]); setShowM(false); };
  const delDoc  = id => saveDocentes((docentes||[]).filter(d=>d.id!==id));

  const historial = doc => {
    const r=[];
    (programas||[]).forEach(prog=>mods(prog).forEach(m=>{if(m.docenteId===doc.id||m.docente===doc.nombre)r.push({prog,mod:m});}));
    return r;
  };

  const filtrados = (docentes||[]).filter(d=>{
    const q=busq.toLowerCase();
    return !busq||(d.nombre&&d.nombre.toLowerCase().includes(q))||(d.email&&d.email.toLowerCase().includes(q))||(d.telefono&&d.telefono.includes(q));
  });

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
        <div><h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Docentes</h1><p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>Catálogo de docentes de educación continua</p></div>
        <button onClick={openNew} style={S.btn(RED,"#fff")}>Agregar docente</button>
      </div>
      {(docentes||[]).length>0&&(
        <div style={{display:"flex",gap:10,marginBottom:20}}>
          <input placeholder="Buscar por nombre, correo o teléfono..." value={busq} onChange={e=>setBusq(e.target.value)} style={{...S.inp,flex:1}}/>
          {busq&&<button onClick={()=>setBusq("")} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
        </div>
      )}
      {(docentes||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:80,fontFamily:"system-ui"}}>Sin docentes registrados.</div>}
      <div style={{display:"grid",gap:14}}>
        {filtrados.map(doc=>{
          const hist=historial(doc), horas=hist.reduce((a,{mod})=>a+(mod.clases||0)*(mod.horasPorClase||0),0);
          const gc=GRADO_C[doc.grado]||GRADO_C.Licenciatura;
          const cat=CATEGORIA_DOCENTE[doc.categoria||"A"];
          return(
            <div key={doc.id} style={{...S.card,borderLeft:"4px solid "+RED,padding:"18px 22px"}}>
              <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                    <span style={{fontWeight:700,fontSize:16}}>{doc.nombre}</span>
                    <span style={{background:gc.bg,color:gc.color,borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"system-ui",fontWeight:700}}>{doc.grado}</span>
                    <span style={{background:cat.bg,color:cat.color,borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"system-ui",fontWeight:700}}>{cat.label} · {fmtMXN(cat.tarifa)}/hr</span>
                  </div>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>
                    {doc.email&&<span>{doc.email}</span>}{doc.telefono&&<span>{doc.telefono}</span>}
                  </div>
                  {(doc.programasIds||[]).length>0&&(
                    <div style={{marginTop:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>PROGRAMAS ASIGNADOS</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {(doc.programasIds||[]).map(pid=>{const pr=(programas||[]).find(p=>p.id===pid);if(!pr)return null;return <span key={pid} style={{fontSize:11,background:"#fef2f2",borderRadius:4,padding:"2px 8px",color:RED,fontFamily:"system-ui",border:"1px solid #fca5a5",fontWeight:600}}>{pr.nombre}</span>;})}
                      </div>
                    </div>
                  )}
                  {hist.length>0&&(
                    <div style={{marginTop:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>HISTORIAL · {horas}H IMPARTIDAS</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {hist.map(({prog,mod},i)=><span key={i} style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>{prog.nombre+" · "+mod.numero}</span>)}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>openEdit(doc)} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px",fontSize:12})}>Editar</button>
                  <button onClick={()=>setCS({titulo:"Eliminar docente",mensaje:`¿Estás seguro de que deseas eliminar a "${doc.nombre}"? Esta acción es irreversible.`,onConfirm:()=>delDoc(doc.id)})} style={S.btn("#fef2f2","#dc2626",{padding:"6px 12px",fontSize:12})}>Eliminar</button>
                </div>
              </div>
            </div>
          );
        })}
        {filtrados.length===0&&busq&&<div style={{textAlign:"center",color:"#9ca3af",padding:40,fontFamily:"system-ui"}}>Sin resultados para "{busq}".</div>}
      </div>

      {showM&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{editId?"Editar docente":"Nuevo docente"}</span>
              <button onClick={()=>setShowM(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
            </div>
            <div style={{padding:"20px 24px"}}>
              {[["Nombre completo","nombre","text"],["Correo electrónico","email","email"],["Teléfono","telefono","tel"]].map(([l,k,t])=>(
                <div key={k} style={{marginBottom:13}}><label style={S.lbl}>{l}</label><input type={t} value={form[k]||""} onChange={e=>setForm({...form,[k]:e.target.value})} style={S.inp}/></div>
              ))}
              <div style={{marginBottom:16}}>
                <label style={S.lbl}>Grado académico</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Licenciatura","Maestría","Doctorado"].map(g=>{const gc=GRADO_C[g];return(
                    <button key={g} onClick={()=>setForm({...form,grado:g})} style={{border:"2px solid "+(form.grado===g?gc.color:"#e5e7eb"),borderRadius:6,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",background:form.grado===g?gc.bg:"#fff",color:form.grado===g?gc.color:"#9ca3af"}}>{g}</button>
                  );})}
                </div>
              </div>
              <div style={{marginBottom:16}}>
                <label style={S.lbl}>Categoría de pago</label>
                <div style={{display:"flex",gap:8}}>
                  {Object.entries(CATEGORIA_DOCENTE).map(([k,cat])=>(
                    <button key={k} onClick={()=>setForm({...form,categoria:k})}
                      style={{flex:1,border:"2px solid "+(form.categoria===k?cat.color:"#e5e7eb"),borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"system-ui",background:form.categoria===k?cat.bg:"#fff",textAlign:"left"}}>
                      <div style={{fontWeight:700,fontSize:13,color:form.categoria===k?cat.color:"#1a1a1a"}}>{cat.label}</div>
                      <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>{fmtMXN(cat.tarifa)} / hora</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:20}}>
                <label style={S.lbl}>Programas en los que participa</label>
                <div style={{display:"flex",flexDirection:"column",gap:6,background:"#f9f9f9",borderRadius:8,padding:12}}>
                  {(programas||[]).length===0&&<span style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>No hay programas registrados.</span>}
                  {(programas||[]).map(p=>{
                    const sel=(form.programasIds||[]).includes(p.id);
                    return(
                      <label key={p.id} onClick={()=>setForm({...form,programasIds:sel?(form.programasIds||[]).filter(x=>x!==p.id):[...(form.programasIds||[]),p.id]})}
                        style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"8px 10px",borderRadius:6,background:sel?"#fef2f2":"#fff",border:"1px solid "+(sel?"#fca5a5":"#e5e7eb")}}>
                        <div style={{width:16,height:16,border:"2px solid "+(sel?RED:"#d1d5db"),borderRadius:4,background:sel?RED:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {sel&&<span style={{color:"#fff",fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                          <span style={{fontSize:13,fontFamily:"system-ui",fontWeight:sel?600:400,color:sel?"#1a1a1a":"#374151"}}>{p.nombre}</span>
                          <span style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>{p.tipo}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div style={{marginBottom:20}}>
                <label style={S.lbl}>Semblanza</label>
                <textarea value={form.semblanza||""} onChange={e=>setForm({...form,semblanza:e.target.value})} placeholder="Describe la trayectoria académica y profesional del docente..." rows={5} style={{...S.inp,resize:"vertical",lineHeight:1.6}}/>
                <div style={{fontSize:11,color:"#9ca3af",marginTop:4,fontFamily:"system-ui"}}>{(form.semblanza||"").length} caracteres</div>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowM(false)} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={saveDoc} style={S.btn(RED,"#fff")}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ASISTENCIA GLOBAL ────────────────────────────────
function AsistenciaGlobal({programas, generarLink, linkCopiado, onToggleAsist}) {
  const [selProgId, setSelProgId] = useState(null);
  const [selModId,  setSelModId]  = useState(null);
  const hoy = today();

  const prog = selProgId ? (programas||[]).find(p=>p.id===selProgId) : null;

  // ── Lista de programas ──────────────────────────────
  if (!selProgId) return (
    <div>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Asistencia</h1>
        <p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>Selecciona un programa para tomar lista</p>
      </div>
      <div style={{display:"grid",gap:10}}>
        {(programas||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:60,fontFamily:"system-ui"}}>Sin programas registrados.</div>}
        {(programas||[]).map(p=>{
          const totalEst=ests(p).length;
          const modsActivos=mods(p).filter(m=>m.fechaInicio&&m.fechaFin);
          const modHoy=modsActivos.find(m=>{
            const fechas=m.fechasClase&&m.fechasClase.length?m.fechasClase:generarFechasClase(m.fechaInicio,m.fechaFin,m.dias,m.clases);
            return fechas.includes(hoy);
          });
          return(
            <div key={p.id} onClick={()=>setSelProgId(p.id)}
              style={{...S.card,padding:"18px 22px",cursor:"pointer",borderLeft:"4px solid "+p.color,display:"flex",alignItems:"center",gap:14}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                  <span style={{fontWeight:700,fontSize:16}}>{p.nombre}</span>
                  <span style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#6b7280",fontFamily:"system-ui"}}>{p.tipo}</span>
                  {p.modalidad&&<span style={{fontSize:11,background:"#eff6ff",borderRadius:4,padding:"2px 8px",color:"#2563eb",fontFamily:"system-ui"}}>{p.modalidad}</span>}
                  {modHoy&&<span style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:700}}>Clase hoy</span>}
                </div>
                <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",display:"flex",gap:14,flexWrap:"wrap"}}>
                  <span>{mods(p).length} módulos</span>
                  <span>{totalEst} estudiantes</span>
                  {p.generacion&&<span>{p.generacion} generación</span>}
                </div>
              </div>
              <span style={{fontSize:20,color:"#d1d5db"}}>›</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Detalle del programa: todos los módulos y sesiones ──
  const modulos = mods(prog);
  const estudiantes = ests(prog);

  const getFechas = mod => mod.fechasClase&&mod.fechasClase.length
    ? mod.fechasClase
    : generarFechasClase(mod.fechaInicio,mod.fechaFin,mod.dias,mod.clases);

  const presenteEnFecha = (est, modId, fecha) => {
    const v = est.asistencia&&est.asistencia["mod_"+modId];
    return Array.isArray(v) ? v.includes(fecha) : false;
  };

  const pctEst = (est, mod) => {
    const fechas = getFechas(mod);
    const total = fechas.length||mod.clases||0;
    if (!total) return null;
    const v = est.asistencia&&est.asistencia["mod_"+mod.id];
    const asist = Array.isArray(v) ? v.length : (v||0);
    return Math.round(asist/total*100);
  };

  const modActivo = selModId ? modulos.find(m=>m.id===selModId) : null;

  return(
    <div>
      {/* Header con breadcrumb */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <button onClick={()=>{setSelProgId(null);setSelModId(null);}} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",padding:0}}>← Programas</button>
        {selModId&&<><span style={{color:"#d1d5db"}}>›</span><button onClick={()=>setSelModId(null)} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",padding:0}}>{prog.nombre}</button></>}
        {!selModId&&<><span style={{color:"#d1d5db"}}>›</span><span style={{fontSize:13,color:"#374151",fontFamily:"system-ui",fontWeight:700}}>{prog.nombre}</span></>}
        {selModId&&<><span style={{color:"#d1d5db"}}>›</span><span style={{fontSize:13,color:"#374151",fontFamily:"system-ui",fontWeight:700}}>{modActivo?.nombre}</span></>}
      </div>

      {/* Vista de módulos del programa */}
      {!selModId&&(
        <div>
          <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
            <div>
              <h2 style={{fontSize:20,fontWeight:700,margin:"0 0 2px"}}>{prog.nombre}</h2>
              <p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>{modulos.length} módulos · {estudiantes.length} estudiantes</p>
            </div>
          </div>
          <div style={{display:"grid",gap:10}}>
            {modulos.map(mod=>{
              const fechas = getFechas(mod);
              const sesionHoy = fechas.includes(hoy);
              const numHoy = fechas.indexOf(hoy)+1;
              const presHoy = sesionHoy ? estudiantes.filter(e=>presenteEnFecha(e,mod.id,hoy)).length : null;
              const progGrupal = fechas.length>0
                ? Math.round(estudiantes.reduce((a,e)=>{const v=e.asistencia&&e.asistencia["mod_"+mod.id];return a+(Array.isArray(v)?v.length:(v||0));},0)/(fechas.length*estudiantes.length||1)*100)
                : null;
              return(
                <div key={mod.id} style={{...S.card,padding:"16px 20px",cursor:"pointer",borderLeft:"3px solid "+(sesionHoy?"#16a34a":mod.estatus==="confirmado"?"#2563eb":"#e5e7eb")}}
                  onClick={()=>setSelModId(mod.id)}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <span style={{background:prog.color,color:"#fff",borderRadius:4,padding:"2px 9px",fontSize:12,fontWeight:800,fontFamily:"system-ui",flexShrink:0}}>{mod.numero}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{mod.nombre}</div>
                      <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",display:"flex",gap:12,flexWrap:"wrap"}}>
                        {mod.docente&&<span>{mod.docente}</span>}
                        {mod.horario&&<span>{mod.horario}</span>}
                        <span>{fechas.length} sesiones</span>
                        {progGrupal!==null&&estudiantes.length>0&&<span style={{fontWeight:700,color:progGrupal>=80?"#16a34a":"#dc2626"}}>{progGrupal}% grupal</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                      {sesionHoy&&<span style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:4,padding:"3px 10px",fontSize:12,fontFamily:"system-ui",fontWeight:700}}>Sesión {numHoy} hoy · {presHoy}/{estudiantes.length}</span>}
                      <button onClick={e=>{e.stopPropagation();generarLink(prog.id,mod.id);}} style={S.btn(linkCopiado===prog.id+"_"+mod.id?"#f0fdf4":"#f3f4f6",linkCopiado===prog.id+"_"+mod.id?"#16a34a":"#374151",{fontSize:11,padding:"5px 10px",border:"1px solid "+(linkCopiado===prog.id+"_"+mod.id?"#bbf7d0":"#e5e7eb"),whiteSpace:"nowrap"})}>
                        {linkCopiado===prog.id+"_"+mod.id?"Copiado":"Enlace docente"}
                      </button>
                      <span style={{fontSize:18,color:"#d1d5db"}}>›</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vista de sesiones de un módulo */}
      {selModId&&modActivo&&(()=>{
        const fechas = getFechas(modActivo);
        const activos = estudiantes.filter(e=>e.estatus!=="baja");
        return(
          <div>
            <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                  <span style={{background:prog.color,color:"#fff",borderRadius:4,padding:"2px 9px",fontSize:12,fontWeight:800,fontFamily:"system-ui"}}>{modActivo.numero}</span>
                  <span style={{fontWeight:700,fontSize:16}}>{modActivo.nombre}</span>
                </div>
                <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",display:"flex",gap:12,flexWrap:"wrap"}}>
                  {modActivo.docente&&<span>{modActivo.docente}</span>}
                  {modActivo.horario&&<span>{modActivo.horario}</span>}
                  <span>{fechas.length} sesiones · {activos.length} estudiantes activos</span>
                </div>
              </div>
              <button onClick={()=>generarLink(prog.id,modActivo.id)} style={S.btn(linkCopiado===prog.id+"_"+modActivo.id?"#f0fdf4":"#f3f4f6",linkCopiado===prog.id+"_"+modActivo.id?"#16a34a":"#374151",{fontSize:12,padding:"6px 14px",border:"1px solid "+(linkCopiado===prog.id+"_"+modActivo.id?"#bbf7d0":"#e5e7eb")})}>
                {linkCopiado===prog.id+"_"+modActivo.id?"Enlace copiado":"Copiar enlace docente"}
              </button>
            </div>

            {fechas.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin sesiones programadas. Configura las fechas de clase en el módulo.</div>}

            {fechas.length>0&&(
              <div style={{...S.card,overflow:"hidden"}}>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13}}>
                    <thead>
                      <tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>
                        <th style={{textAlign:"left",padding:"10px 16px",fontSize:12,fontWeight:700,color:"#6b7280",minWidth:160,position:"sticky",left:0,background:"#f9f9f9",zIndex:1}}>Estudiante</th>
                        {fechas.map((f,i)=>{
                          const esHoy=f===hoy;
                          const fest=isFestivo(f);
                          return(
                            <th key={f} style={{textAlign:"center",padding:"8px 6px",fontSize:11,fontWeight:700,color:esHoy?"#16a34a":"#6b7280",background:esHoy?"#f0fdf4":fest?"#fffbeb":"#f9f9f9",minWidth:64,whiteSpace:"nowrap"}}>
                              <div style={{fontWeight:800}}>S{i+1}</div>
                              <div style={{fontSize:10,fontWeight:400,color:esHoy?"#16a34a":fest?"#d97706":"#9ca3af"}}>{f.slice(5).replace("-","/")}</div>
                              {esHoy&&<div style={{fontSize:9,color:"#16a34a",fontWeight:700}}>HOY</div>}
                            </th>
                          );
                        })}
                        <th style={{textAlign:"center",padding:"10px 12px",fontSize:11,fontWeight:700,color:"#6b7280",minWidth:80}}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activos.map((e,ri)=>{
                        const pct = pctEst(e,modActivo);
                        return(
                          <tr key={e.id} style={{borderBottom:"1px solid #f3f4f6",background:ri%2===0?"#fff":"#fafafa"}}>
                            <td style={{padding:"10px 16px",fontWeight:600,fontSize:13,position:"sticky",left:0,background:ri%2===0?"#fff":"#fafafa",zIndex:1}}>
                              <div>{e.nombre}</div>
                              {e.empresa&&<div style={{fontSize:11,color:"#9ca3af",fontWeight:400}}>{e.empresa}</div>}
                            </td>
                            {fechas.map(f=>{
                              const pres=presenteEnFecha(e,modActivo.id,f);
                              const esFutura=f>hoy;
                              const fest=isFestivo(f);
                              return(
                                <td key={f} style={{textAlign:"center",padding:"6px",background:fest?"#fffbeb":undefined}}>
                                  <button
                                    onClick={()=>!fest&&onToggleAsist(prog.id,modActivo.id,e.id,f)}
                                    disabled={!!fest}
                                    style={{width:32,height:32,borderRadius:6,border:"none",cursor:fest?"default":"pointer",
                                      background:pres?"#16a34a":esFutura?"#f9f9f9":"#fee2e2",
                                      color:pres?"#fff":esFutura?"#d1d5db":"#fca5a5",
                                      fontWeight:700,fontSize:14,display:"inline-flex",alignItems:"center",justifyContent:"center",
                                      opacity:fest?0.4:1}}>
                                    {pres?"✓":esFutura?"·":"✗"}
                                  </button>
                                </td>
                              );
                            })}
                            <td style={{textAlign:"center",padding:"6px 12px"}}>
                              <span style={{fontWeight:700,fontSize:13,color:pct===null?"#9ca3af":pct>=80?"#16a34a":"#dc2626"}}>{pct===null?"—":pct+"%"}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Fila de totales por sesión */}
                      <tr style={{borderTop:"2px solid #e5e7eb",background:"#f9f9f9",fontWeight:700}}>
                        <td style={{padding:"8px 16px",fontSize:12,color:"#6b7280",position:"sticky",left:0,background:"#f9f9f9"}}>TOTAL</td>
                        {fechas.map(f=>{
                          const pres=activos.filter(e=>presenteEnFecha(e,modActivo.id,f)).length;
                          const pct=activos.length?Math.round(pres/activos.length*100):0;
                          return(
                            <td key={f} style={{textAlign:"center",padding:"8px 6px"}}>
                              <div style={{fontSize:12,fontWeight:700,color:pct>=80?"#16a34a":"#dc2626"}}>{pres}/{activos.length}</div>
                              <div style={{fontSize:10,color:"#9ca3af"}}>{pct}%</div>
                            </td>
                          );
                        })}
                        <td/>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────
export default function App() {
  const [session,setSession]     = useState(null);
  const [ready,setReady]         = useState(false);
  const [programas,setProgramas] = useState([]);
  const [responsables,setResp]   = useState([]);
  const [notifCfg,setNotifCfg]   = useState({apiKey:"",locationId:""});
  const [fieldMap,setFieldMap]   = useState([]);
  const [docentes,setDocentes]   = useState([]);
  const [showApiKey,setShowAK]   = useState(false);
  const [view,setView]           = useState("lista");
  const [selProg,setSelProg]     = useState(null);
  const [progTab,setProgTab]     = useState("modulos");
  const [showModM,setShowModM]   = useState(false);
  const [editMod,setEditMod]     = useState(null);
  const [showProgM,setShowProgM] = useState(false);
  const [showImport,setShowImp]  = useState(false);
  const [showAlertas,setShowAl]  = useState(false);
  const [pagoModal,setPagoModal] = useState(null); // {est, prog}
  const [notif,setNotif]         = useState(null);
  const [confirmSimple,setCS]    = useState(null); // {titulo,mensaje,onConfirm}
  const [confirmEscrita,setCE]   = useState(null); // {titulo,subtitulo,mensaje,onConfirm}
  const [sending,setSending]     = useState(null);
  const [newResp,setNewResp]     = useState({nombre:"",email:""});
  const [users,setUsers]         = useState([]);
  const [newUser,setNewUser]     = useState({nombre:"",email:"",password:"",permisos:{...VIEWER_P}});
  const [showUP,setShowUP]       = useState(false);
  const [newFM,setNewFM]         = useState({id:"",label:""});
  const [repExp,setRepExp]       = useState(null);
  const [linkCopiado,setLinkCop] = useState("");
  const [repVistaFin,setRepVistaFin] = useState("global");
  const [repMesFin,setRepMesFin]     = useState(today().substring(0,7));
  const [busqProg,setBusqProg]   = useState("");
  const [filtroProg,setFiltroPr] = useState("");
  const [filtroSt,setFiltroSt]   = useState("");
  const [busqEst,setBusqEst]     = useState("");
  const [filtroEst,setFiltroEst] = useState("");
  const alertRef = useRef(null);

  const eMod  = {id:"",numero:"I",nombre:"",docenteId:"",docente:"",emailDocente:"",clases:4,horasPorClase:4,horario:"",fechaInicio:"",fechaFin:"",dias:["Lun"],estatus:"propuesta",fechasClase:[]};
  const eProg = {id:"",nombre:"",tipo:"Diplomado",tipoCustom:"",color:RED,modulos:[],estudiantes:[],modalidad:"Presencial Playas",generacion:"Primera",precioLista:0,parcialidadesDefault:5,promociones:PROMOCIONES_DEFAULT.map(p=>({...p,id:p.id+"_"+newId()}))};
  const [modForm,setModForm]   = useState(eMod);
  const [progForm,setProgForm] = useState(eProg);

  useEffect(()=>{
    const s=localStorage.getItem(SK2); if(s) setSession(JSON.parse(s));
    const p=localStorage.getItem(SK);  setProgramas(p?JSON.parse(p):INIT_DATA);
    const r=localStorage.getItem(RK);  setResp(r?JSON.parse(r):[]);
    const n=localStorage.getItem(NK);  setNotifCfg(n?JSON.parse(n):{apiKey:"",locationId:""});
    const u=localStorage.getItem(UK);  setUsers(u?JSON.parse(u):DEFAULT_USERS);
    const f=localStorage.getItem(FK);  setFieldMap(f?JSON.parse(f):[]);
    const d=localStorage.getItem(DK);  setDocentes(d?JSON.parse(d):[]);
    setReady(true);
  },[]);

  useEffect(()=>{
    const h=e=>{if(alertRef.current&&!alertRef.current.contains(e.target))setShowAl(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  const save      = d=>{setProgramas(d);localStorage.setItem(SK,JSON.stringify(d));};
  const saveResp  = d=>{setResp(d);localStorage.setItem(RK,JSON.stringify(d));};
  const saveUsers = d=>{setUsers(d);localStorage.setItem(UK,JSON.stringify(d));};
  const saveFM    = d=>{setFieldMap(d);localStorage.setItem(FK,JSON.stringify(d));};
  const saveDoc   = d=>{setDocentes(d);localStorage.setItem(DK,JSON.stringify(d));};
  const notify    = (msg,type="success")=>{setNotif({msg,type});setTimeout(()=>setNotif(null),4500);};
  const getProg   = ()=>(programas||[]).find(p=>p.id===selProg);
  const logout    = ()=>{localStorage.removeItem(SK2);setSession(null);setView("lista");};

  const generarLink = (progId,modId) => {
    const token=btoa(JSON.stringify({progId,modId}));
    const url=window.location.href.split("?")[0]+"?lista="+token;
    navigator.clipboard.writeText(url).then(()=>{setLinkCop(progId+"_"+modId);setTimeout(()=>setLinkCop(""),3000);});
  };

  const saveAsistDocente = (progId,modId,updated) => {
    save((programas||[]).map(p=>{
      if(p.id!==progId) return p;
      return{...p,estudiantes:ests(p).map(e=>{const u=updated.find(eu=>eu.id===e.id);return u?{...e,asistencia:{...(e.asistencia||{}),...(u.asistencia||{})}}:e;})};
    }));
  };

  const isPublic = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("lista");
  if (!ready) return null;
  if (isPublic) return <ListaDocente programas={programas} onSave={saveAsistDocente}/>;
  if (!session) return <LoginScreen onLogin={u=>setSession(u)}/>;

  const prog    = getProg();
  const alertas = getAlertas(programas);

  const progsF = (programas||[]).filter(p=>{
    const q=busqProg.toLowerCase();
    return (!busqProg||p.nombre.toLowerCase().includes(q))&&(!filtroProg||p.tipo===filtroProg)&&(!filtroSt||progStatus(p)===filtroSt);
  });

  const egresados = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus==="egresado").map(e=>({...e,programa:p.nombre})));
  const activos   = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus!=="egresado"&&e.estatus!=="baja"&&progStatus(p)==="activo"));
  const bajas     = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus==="baja"));
  const porConf   = (programas||[]).reduce((a,p)=>a+mods(p).filter(m=>m.estatus==="propuesta"&&m.docente).length,0);
  // Egresados IBERO: activos en programa vigente con egresado_ibero="Sí"
  const egresadosIberoActivos  = (programas||[]).flatMap(p=>ests(p).filter(e=>e.egresado_ibero==="Sí"&&progStatus(p)==="activo").map(e=>({...e,programa:p.nombre,estatus_prog:"activo"})));
  // Egresados IBERO que concluyeron: estatus egresado O en programa finalizado
  const egresadosIberoConcluyeron = (programas||[]).flatMap(p=>ests(p).filter(e=>e.egresado_ibero==="Sí"&&(e.estatus==="egresado"||progStatus(p)==="finalizado")).map(e=>({...e,programa:p.nombre,estatus_prog:"finalizado"})));

  const updateEst = (progId,est)=>{save((programas||[]).map(p=>p.id===progId?{...p,estudiantes:est}:p));notify("Estudiantes importados.");};

  const savePago = (progId,estId,pago)=>{
    save((programas||[]).map(p=>p.id!==progId?p:{...p,estudiantes:ests(p).map(e=>e.id!==estId?e:{...e,pago})}));
    notify("Pago actualizado.");
  };

  const toggleAsist = (progId,modId,estId)=>{
    save((programas||[]).map(p=>{
      if(p.id!==progId)return p;
      return{...p,estudiantes:ests(p).map(e=>{
        if(e.id!==estId)return e;
        const k="mod_"+modId,cur=(e.asistencia&&e.asistencia[k])||0,max=(mods(p).find(m=>m.id===modId)||{}).clases||0;
        return{...e,asistencia:{...(e.asistencia||{}),[k]:cur>=max?0:cur+1}};
      })};
    }));
  };

  // Toggle asistencia por fecha específica (nueva vista admin)
  const toggleAsistFecha = (progId,modId,estId,fecha)=>{
    save((programas||[]).map(p=>{
      if(p.id!==progId)return p;
      return{...p,estudiantes:ests(p).map(e=>{
        if(e.id!==estId)return e;
        const k="mod_"+modId;
        const cur=e.asistencia&&e.asistencia[k];
        let fechas=Array.isArray(cur)?[...cur]:[];
        if(fechas.includes(fecha))fechas=fechas.filter(f=>f!==fecha);
        else fechas=[...fechas,fecha];
        return{...e,asistencia:{...(e.asistencia||{}),[k]:fechas}};
      })};
    }));
  };

  const exportCSV = prog=>{
    const rows=ests(prog).map(e=>{
      const base={Nombre:e.nombre||"",Correo:e.email||"",Teléfono:e.telefono||"",Empresa:e.empresa||"",Puesto:e.puesto||"",Carrera:e.carrera||"","Grado de estudios":e.grado||"","Programa de interés":e.programa_interes||"","Egresado IBERO":e.egresado_ibero||"",Fuente:e.fuente||"",Estatus:e.estatus||"activo"};
      (fieldMap||[]).forEach(fm=>{base[fm.label]=(e.campos_extra&&e.campos_extra[fm.label])||e[fm.label]||""});
      mods(prog).forEach(m=>{base["Asist."+m.numero]=((e.asistencia&&e.asistencia["mod_"+m.id])||0)+"/"+m.clases;});
      return base;
    });
    if(!rows.length)return;
    const hdr=Object.keys(rows[0]),csv=[hdr.join(","),...rows.map(r=>hdr.map(h=>'"'+(r[h]||"").toString().replace(/"/g,'""')+'"').join(","))].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));a.download=prog.nombre.replace(/\s+/g,"_")+"_estudiantes.csv";a.click();notify("Exportado.");
  };

  const exportDocente = prog=>{
    const rows=ests(prog).map(e=>({Nombre:e.nombre||"",Empresa:e.empresa||"",Puesto:e.puesto||e["Puesto"]||""}));
    if(!rows.length)return;
    const hdr=["Nombre","Empresa","Puesto"],csv=[hdr.join(","),...rows.map(r=>hdr.map(h=>'"'+(r[h]||"").replace(/"/g,'""')+'"').join(","))].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));a.download="Lista_"+prog.nombre.replace(/\s+/g,"_")+".csv";a.click();notify("Lista para docente exportada.");
  };

  const exportPDF = prog => {
    const ms = mods(prog);
    const DIAS_S = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

    // Recopilar todas las fechas de clase por módulo
    const todasFechas = [];
    ms.forEach(mod => {
      const fechas = mod.fechasClase&&mod.fechasClase.length
        ? mod.fechasClase
        : generarFechasClase(mod.fechaInicio,mod.fechaFin,mod.dias,mod.clases);
      fechas.forEach(f=>todasFechas.push({fecha:f,mod}));
    });
    todasFechas.sort((a,b)=>a.fecha.localeCompare(b.fecha));

    // Agrupar por mes para el calendario visual
    const byMes = {};
    todasFechas.forEach(({fecha,mod})=>{
      const [y,m] = fecha.split("-");
      const key = y+"-"+m;
      if(!byMes[key]) byMes[key]={anio:parseInt(y),mes:parseInt(m)-1,clases:[]};
      byMes[key].clases.push({fecha,mod});
    });

    const colores = ["#C8102E","#1d4ed8","#0f766e","#7c3aed","#b45309","#6b2d2d"];
    const modColor = {};
    ms.forEach((m,i)=>modColor[m.id]=colores[i%colores.length]);

    // Construir HTML del PDF
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      body{font-family:Georgia,serif;margin:0;padding:0;color:#1a1a1a;}
      .page{max-width:800px;margin:0 auto;padding:40px;}
      .header{background:#C8102E;padding:24px 36px;margin-bottom:32px;}
      .header h1{color:#fff;font-size:36px;font-weight:900;margin:0;letter-spacing:3px;}
      .header p{color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:11px;letter-spacing:4px;font-family:Arial,sans-serif;}
      .prog-title{font-size:22px;font-weight:700;margin-bottom:4px;}
      .prog-meta{font-size:13px;color:#6b7280;margin-bottom:24px;font-family:Arial,sans-serif;}
      .section-title{font-size:11px;font-weight:700;color:#C8102E;letter-spacing:1px;text-transform:uppercase;margin:24px 0 12px;font-family:Arial,sans-serif;}
      table.modulos{width:100%;border-collapse:collapse;font-size:13px;font-family:Arial,sans-serif;}
      table.modulos th{text-align:left;padding:8px 12px;background:#f9f9f9;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e5e7eb;}
      table.modulos td{padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:top;}
      .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;}
      .mes-grid{margin-bottom:28px;}
      .mes-titulo{font-size:15px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #C8102E;}
      .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-family:Arial,sans-serif;}
      .cal-head{text-align:center;font-size:10px;font-weight:700;color:#6b7280;padding:4px;}
      .cal-day{min-height:52px;padding:4px;border:1px solid #f3f4f6;border-radius:4px;font-size:11px;}
      .cal-day.vacio{background:#fafafa;}
      .cal-day.festivo{background:#fffbeb;}
      .cal-num{font-weight:600;color:#374151;margin-bottom:2px;}
      .cal-num.fest{color:#d97706;}
      .clase-chip{font-size:9px;padding:2px 4px;border-radius:3px;color:#fff;margin-bottom:2px;line-height:1.3;}
      .leyenda{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-family:Arial,sans-serif;font-size:12px;}
      .leyenda-item{display:flex;align-items:center;gap:6px;}
      .leyenda-dot{width:12px;height:12px;border-radius:3px;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head><body><div class="page">
    <div class="header"><h1>IBERO</h1><p>TIJUANA &nbsp;·&nbsp; COORDINACIÓN DE EDUCACIÓN CONTINUA</p></div>
    <div class="prog-title">${prog.nombre}</div>
    <div class="prog-meta">${prog.tipo}${prog.modalidad?" · "+prog.modalidad:""}${prog.generacion?" · "+prog.generacion+" generación":""}</div>`;

    // Tabla de módulos
    html += `<div class="section-title">Módulos del programa</div>
    <table class="modulos"><thead><tr>
      <th>Módulo</th><th>Nombre</th><th>Docente</th><th>Fechas</th><th>Días</th><th>Horas</th>
    </tr></thead><tbody>`;
    ms.forEach(m=>{
      const totalH=(m.clases||0)*(m.horasPorClase||0);
      const fechas=m.fechasClase&&m.fechasClase.length?m.fechasClase:generarFechasClase(m.fechaInicio,m.fechaFin,m.dias,m.clases);
      html+=`<tr>
        <td><span class="badge" style="background:${modColor[m.id]};color:#fff">${m.numero}</span></td>
        <td style="font-weight:600">${m.nombre}</td>
        <td style="color:#6b7280">${m.docente||"Por confirmar"}</td>
        <td style="color:#6b7280;font-size:12px">${m.fechaInicio?fmtFecha(m.fechaInicio)+" — "+fmtFecha(m.fechaFin):"-"}<br/>${m.horario||""}</td>
        <td style="color:#6b7280">${(m.dias||[]).join(", ")}</td>
        <td><strong>${totalH}h</strong><br/><span style="color:#9ca3af;font-size:11px">${m.clases} cl · ${m.horasPorClase}h</span></td>
      </tr>`;
    });
    html += `</tbody></table>`;

    // Leyenda
    html += `<div class="section-title" style="margin-top:20px">Calendario de clases</div>
    <div class="leyenda">
      ${ms.map(m=>`<div class="leyenda-item"><div class="leyenda-dot" style="background:${modColor[m.id]}"></div><span>${m.numero} · ${m.nombre.split(" ").slice(0,4).join(" ")}</span></div>`).join("")}
      <div class="leyenda-item"><div class="leyenda-dot" style="background:#fde68a;border:1px solid #d97706"></div><span>Festivo</span></div>
    </div>`;

    // Calendarios por mes
    Object.values(byMes).forEach(({anio,mes,clases})=>{
      const pD=new Date(anio,mes,1),uD=new Date(anio,mes+1,0),off=(pD.getDay()+6)%7;
      const tot=Math.ceil((off+uD.getDate())/7)*7;
      const byD={};
      clases.forEach(({fecha,mod})=>{const d=parseInt(fecha.split("-")[2]);if(!byD[d])byD[d]=[];byD[d].push(mod);});

      html+=`<div class="mes-grid"><div class="mes-titulo">${MESES_L[mes]} ${anio}</div><div class="cal">`;
      DIAS_S.forEach(d=>{html+=`<div class="cal-head">${d}</div>`;});
      for(let i=0;i<tot;i++){
        const d=i-off+1,valid=d>=1&&d<=uD.getDate();
        if(!valid){html+=`<div class="cal-day vacio"></div>`;continue;}
        const iso=anio+"-"+String(mes+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
        const fest=isFestivo(iso);
        const clasesDelDia=byD[d]||[];
        html+=`<div class="cal-day${fest?" festivo":""}">
          <div class="cal-num${fest?" fest":""}">${d}${fest?`<div style="font-size:8px;color:#d97706">${fest}</div>`:""}</div>
          ${clasesDelDia.map(m=>`<div class="clase-chip" style="background:${modColor[m.id]}">${m.numero}</div>`).join("")}
        </div>`;
      }
      html+=`</div></div>`;
    });

    html+=`<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;text-align:center">
      Coordinación de Educación Continua · IBERO Tijuana · Av. Centro Universitario #2501, Playas de Tijuana<br/>
      Tel: 664 630 1577 Ext. 2576 · info@tijuana.ibero.mx · © ${new Date().getFullYear()} IBERO Tijuana
    </div></div></body></html>`;

    // Abrir en nueva ventana para imprimir/guardar como PDF
    const win=window.open("","_blank");
    win.document.write(html);
    win.document.close();
    win.onload=()=>{win.print();};
    notify("Calendario abierto — guarda como PDF desde el diálogo de impresión.");
  };

  const confirmar = async (progId,modId)=>{
    const p=(programas||[]).find(x=>x.id===progId),m=mods(p).find(x=>x.id===modId);
    save((programas||[]).map(x=>x.id===progId?{...x,modulos:mods(x).map(y=>y.id===modId?{...y,estatus:"confirmado"}:y)}:x));
    const dests=[];
    if(m.emailDocente)dests.push({email:m.emailDocente,nombre:m.docente});
    (responsables||[]).forEach(r=>{if(r.email)dests.push({email:r.email,nombre:r.nombre});});
    if(!notifCfg.apiKey||!notifCfg.locationId){notify("Confirmado. Configura notificaciones en ⚙️.","warning");return;}
    if(!dests.length){notify("Confirmado. Agrega correos en ⚙️.","warning");return;}
    setSending(modId);
    try{
      const totalH=(m.clases||0)*(m.horasPorClase||0);
      const html=`<div style='font-family:Georgia,serif;max-width:620px;margin:0 auto'>
        <div style='background:#C8102E;padding:24px 36px'>
          <div style='color:#fff;font-size:32px;font-weight:900;letter-spacing:3px'>IBERO</div>
          <div style='color:rgba(255,255,255,0.75);font-size:9px;letter-spacing:4px;font-family:system-ui'>TIJUANA</div>
          <div style='color:rgba(255,255,255,0.7);font-size:11px;margin-top:6px;font-family:system-ui'>Coordinación de Educación Continua</div>
        </div>
        <div style='padding:32px 36px;border:1px solid #e5e7eb;border-top:none'>
          <div style='display:inline-block;background:#fef2f2;color:#C8102E;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:20px;font-family:system-ui'>DOCENTE CONFIRMADO</div>
          <h2 style='font-size:20px;color:#1a1a1a;margin:0 0 20px;font-family:Georgia,serif'>${m.nombre}</h2>
          <table style='width:100%;border-collapse:collapse;font-size:14px;font-family:system-ui'>
            <tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280;width:130px'>Programa</td><td style='font-weight:600'>${p.nombre}</td></tr>
            ${p.generacion?`<tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Generación</td><td>${p.generacion} generación</td></tr>`:""}
            ${p.modalidad?`<tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Modalidad</td><td>${p.modalidad}</td></tr>`:""}
            <tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Docente</td><td style='font-weight:600'>${m.docente}</td></tr>
            <tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Período</td><td>${fmtFecha(m.fechaInicio)} — ${fmtFecha(m.fechaFin)}</td></tr>
            ${m.horario?`<tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Horario</td><td>${m.horario}</td></tr>`:""}
            <tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Días</td><td>${(m.dias||[]).join(", ")}</td></tr>
            <tr><td style='padding:10px 0;color:#6b7280'>Horas</td><td>${m.clases} clases · ${m.horasPorClase}h c/u · <strong>${totalH}h total</strong></td></tr>
          </table>
          <div style='margin-top:24px;padding-top:20px;border-top:2px solid #C8102E;font-family:system-ui;font-size:14px;color:#374151;line-height:1.8'>
            <p>Estimado/a <strong>${m.docente}</strong>,</p>
            <p>Nos complace confirmar su participación como docente en el programa de Educación Continua de IBERO Tijuana. Su colaboración es fundamental para el desarrollo académico y profesional de nuestra comunidad universitaria.</p>
            <p>Le pedimos de favor confirmar la recepción de este correo y contactarnos si tiene alguna pregunta o necesita información adicional.</p>
            <p>Agradecemos de antemano su valiosa participación.</p>
            <p>Atentamente,<br/><strong>Coordinación de Educación Continua</strong><br/>IBERO Tijuana</p>
          </div>
        </div>
        <div style='background:#f9f9f9;padding:20px 36px;border:1px solid #e5e7eb;border-top:none;font-family:system-ui;font-size:12px;color:#6b7280;line-height:1.8'>
          <strong style='color:#1a1a1a'>Coordinación de Educación Continua · IBERO Tijuana</strong><br/>
          Av. Centro Universitario #2501, Playas de Tijuana, C.P. 22500<br/>
          Tel: 664 630 1577 Ext. 2576 · WhatsApp: 664 764 1119<br/>
          info@tijuana.ibero.mx<br/><br/>
          <span style='font-size:10px;color:#9ca3af'>© 2026 IBERO Tijuana. Todos los derechos reservados.</span>
        </div>
      </div>`;
      let ok=0;
      for(const dest of dests){try{const res=await fetch("https://services.leadconnectorhq.com/conversations/messages/outbound",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+notifCfg.apiKey,"Version":"2021-04-15"},body:JSON.stringify({type:"Email",locationId:notifCfg.locationId,toEmail:dest.email,subject:"Confirmación — "+m.nombre,html})});if(res.ok)ok++;}catch(e){}}
      notify(ok+"/"+dests.length+" notificaciones enviadas.");
    }catch(e){notify("Confirmado. Error al enviar.","warning");}
    setSending(null);
  };

  const openNewMod = ()=>{setModForm({...eMod,id:newId()});setEditMod(null);setShowModM(true);};
  const openEditMod= m=>{setModForm({...m});setEditMod(m.id);setShowModM(true);};
  const saveMod = ()=>{
    if(!modForm.nombre||!modForm.fechaInicio||!modForm.fechaFin){notify("Completa nombre y fechas","error");return;}
    save((programas||[]).map(p=>p.id===selProg?{...p,modulos:editMod?mods(p).map(m=>m.id===editMod?modForm:m):[...mods(p),modForm]}:p));
    setShowModM(false);notify(editMod?"Módulo actualizado":"Módulo agregado");
  };
  const delMod  = id=>{save((programas||[]).map(p=>p.id===selProg?{...p,modulos:mods(p).filter(m=>m.id!==id)}:p));notify("Módulo eliminado","warning");};
  const openNewProg=()=>{setProgForm({...eProg,id:newId()});setShowProgM(true);};
  const saveProg=()=>{
    if(!progForm.nombre){notify("Ingresa el nombre","error");return;}
    const tipo=progForm.tipo==="Otro"?(progForm.tipoCustom||"Otro"):progForm.tipo;
    save([...(programas||[]),{...progForm,tipo}]);setShowProgM(false);notify("Programa agregado");
  };
  const delProg = id=>{save((programas||[]).filter(p=>p.id!==id));notify("Programa eliminado","warning");};

  return(
    <div style={{fontFamily:"Georgia,serif",minHeight:"100vh",background:"#f2f2f2",color:"#1a1a1a"}}>
      {notif&&<div style={{position:"fixed",top:16,right:16,zIndex:9999,background:notif.type==="error"?"#fef2f2":notif.type==="warning"?"#fffbeb":"#f0fdf4",border:"1px solid "+(notif.type==="error"?"#fca5a5":notif.type==="warning"?"#fcd34d":"#86efac"),borderRadius:8,padding:"12px 20px",fontSize:13,maxWidth:380,boxShadow:"0 4px 24px rgba(0,0,0,0.1)",fontFamily:"system-ui"}}>{notif.msg}</div>}

      {/* HEADER */}
      <div style={{background:RED,padding:"0 20px",display:"flex",alignItems:"center",height:64,gap:16}}>
        <div style={{cursor:"pointer"}} onClick={()=>setView("lista")}><IberoLogo h={44}/></div>
        <div style={{width:1,height:32,background:"rgba(255,255,255,0.3)"}}/>
        <div style={{color:"rgba(255,255,255,0.9)",fontSize:13,fontFamily:"system-ui"}}>Educación Continua</div>
        <div style={{flex:1}}/>
        <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
          {[["lista","Programas"],["hoy","Hoy"],["calendario","Calendario"],["asistencia","Asistencia"],["docentes","Docentes"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?"rgba(255,255,255,0.2)":"transparent",color:"#fff",border:view===v?"1px solid rgba(255,255,255,0.35)":"1px solid transparent",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:500}}>{l}</button>
          ))}
          {can(session,"verReportes")&&<button onClick={()=>setView("reportes")} style={{background:view==="reportes"?"rgba(255,255,255,0.2)":"transparent",color:"#fff",border:view==="reportes"?"1px solid rgba(255,255,255,0.35)":"1px solid transparent",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:500}}>Reportes</button>}
          {(can(session,"gestionarUsuarios")||can(session,"configurarNotif"))&&<button onClick={()=>setView("config")} style={{background:view==="config"?"rgba(255,255,255,0.2)":"transparent",color:"#fff",border:view==="config"?"1px solid rgba(255,255,255,0.35)":"1px solid transparent",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:500}}>Configuración</button>}
          {/* ALERTAS */}
          <div ref={alertRef} style={{position:"relative",marginLeft:4}}>
            <button onClick={()=>setShowAl(!showAlertas)} style={{background:alertas.length>0?"#fff":"rgba(255,255,255,0.15)",border:"1px solid "+(alertas.length>0?"#fff":"rgba(255,255,255,0.3)"),borderRadius:6,padding:"6px 14px",cursor:"pointer",color:alertas.length>0?RED:"#fff",fontFamily:"system-ui",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:alertas.length>0?RED:"rgba(255,255,255,0.5)",flexShrink:0}}/>
              {alertas.length>0?"Alertas ("+alertas.length+")":"Sin alertas"}
            </button>
            {showAlertas&&alertas.length>0&&(
              <div style={{position:"absolute",right:0,top:"calc(100% + 8px)",background:"#fff",border:"1px solid #e5e7eb",borderRadius:10,boxShadow:"0 8px 32px rgba(0,0,0,0.15)",width:340,zIndex:999,overflow:"hidden"}}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:14,fontFamily:"Georgia,serif"}}>Alertas activas</div>
                <div style={{maxHeight:320,overflowY:"auto"}}>
                  {alertas.map((a,i)=>(
                    <div key={i} style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6",display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:a.tipo==="sin_docente"?"#f59e0b":a.tipo==="pago_recargo"?"#d97706":"#dc2626",marginTop:5,flexShrink:0}}/>
                      <div style={{flex:1,fontFamily:"system-ui"}}>
                        {a.tipo==="sin_docente"&&<><div style={{fontWeight:600,fontSize:13}}>Módulo sin docente</div><div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.mod.nombre}<br/>{a.prog.nombre} · Inicia en {a.dias} días</div></>}
                        {a.tipo==="asistencia"&&<><div style={{fontWeight:600,fontSize:13,color:"#dc2626"}}>Asistencia baja: {a.pct}%</div><div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.est.nombre}<br/>{a.prog.nombre}</div></>}
                        {a.tipo==="pago_recargo"&&<><div style={{fontWeight:600,fontSize:13,color:"#d97706"}}>Pago vencido — recargo {RECARGO_PCT}%</div><div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.est.nombre} · {a.prog.nombre}<br/>Recargo: {fmtMXN(a.recargo)}</div></>}
                        {a.tipo==="pago_critico"&&<><div style={{fontWeight:700,fontSize:13,color:"#dc2626"}}>Acción requerida — {a.vencidas} pagos sin cubrir</div><div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.est.nombre} · {a.prog.nombre}<br/>Recargo acumulado: {fmtMXN(a.recargo)}</div></>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{width:1,height:24,background:"rgba(255,255,255,0.3)",margin:"0 4px"}}/>
          <div style={{color:"rgba(255,255,255,0.85)",fontSize:12,fontFamily:"system-ui"}}>{session.nombre}</div>
          <button onClick={logout} style={{background:"rgba(255,255,255,0.15)",color:"#fff",border:"1px solid rgba(255,255,255,0.25)",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:12,fontFamily:"system-ui"}}>Salir</button>
        </div>
      </div>

      <div style={{maxWidth:980,margin:"0 auto",padding:"32px 20px"}}>

        {view==="calendario"&&<CalendarioView programas={programas}/>}
        {view==="docentes"&&<DocentesView docentes={docentes} saveDocentes={saveDoc} programas={programas}/>}
        {view==="asistencia"&&<AsistenciaGlobal programas={programas} generarLink={generarLink} linkCopiado={linkCopiado} onToggleAsist={toggleAsistFecha}/>}

        {/* VISTA HOY */}
        {view==="hoy"&&(()=>{
          const hoy = today();
          const fmtHoyLargo = () => { const d=new Date(); return d.getDate()+" de "+MESES_L[d.getMonth()]+" de "+d.getFullYear(); };

          // Módulos con clase hoy
          const modulosHoy = [];
          (programas||[]).forEach(prog=>{
            mods(prog).forEach(mod=>{
              const fechas = mod.fechasClase&&mod.fechasClase.length
                ? mod.fechasClase
                : generarFechasClase(mod.fechaInicio,mod.fechaFin,mod.dias,mod.clases);
              if(fechas.includes(hoy)) modulosHoy.push({prog,mod,fechas});
            });
          });

          const toggleHoy = (progId,modId,estId) => toggleAsistFecha(progId,modId,estId,hoy);

          const presenteHoy = (e,modId) => {
            const v=e.asistencia&&e.asistencia["mod_"+modId];
            return Array.isArray(v)?v.includes(hoy):false;
          };

          return(
            <div>
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
                <div>
                  <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Lista de hoy</h1>
                  <p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>{fmtHoyLargo()} · {modulosHoy.length} {modulosHoy.length===1?"módulo":"módulos"} con clase</p>
                </div>
              </div>

              {modulosHoy.length===0&&(
                <div style={{...S.card,padding:48,textAlign:"center"}}>
                  <div style={{fontSize:16,fontWeight:600,color:"#374151",marginBottom:8}}>No hay clases programadas hoy</div>
                  <div style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>
                    {isFestivo(hoy)?`Hoy es ${isFestivo(hoy)}. Disfruta el descanso.`:"Consulta el Calendario para ver los próximos días con clase."}
                  </div>
                </div>
              )}

              <div style={{display:"grid",gap:24}}>
                {modulosHoy.map(({prog,mod,fechas})=>{
                  const numClase=fechas.indexOf(hoy)+1;
                  const maxClases=fechas.length||mod.clases||0;
                  const estudiantes=ests(prog);
                  const presentes=estudiantes.filter(e=>presenteHoy(e,mod.id)).length;
                  return(
                    <div key={prog.id+"_"+mod.id} style={{...S.card,overflow:"hidden"}}>
                      {/* Header del módulo */}
                      <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:prog.color,flexShrink:0}}/>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:15}}>{mod.nombre}</div>
                          <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",marginTop:2,display:"flex",gap:12,flexWrap:"wrap"}}>
                            <span>{prog.nombre}</span>
                            {mod.docente&&<span>{mod.docente}</span>}
                            {mod.horario&&<span>{mod.horario}</span>}
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          <div style={{fontWeight:800,fontSize:18,color:RED}}>{presentes}/{estudiantes.length}</div>
                          <div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>Clase {numClase} de {maxClases}</div>
                        </div>
                      </div>

                      {/* Lista de estudiantes */}
                      {estudiantes.length===0&&(
                        <div style={{padding:"24px",textAlign:"center",color:"#9ca3af",fontFamily:"system-ui",fontSize:13}}>Sin estudiantes importados.</div>
                      )}
                      <div style={{display:"grid",gap:0}}>
                        {estudiantes.map((e,i)=>{
                          const presente=presenteHoy(e,mod.id);
                          const tot=Array.isArray(e.asistencia&&e.asistencia["mod_"+mod.id])?(e.asistencia["mod_"+mod.id]).length:((e.asistencia&&e.asistencia["mod_"+mod.id])||0);
                          const pct=maxClases?Math.round(tot/maxClases*100):0;
                          return(
                            <div key={e.id} onClick={()=>toggleHoy(prog.id,mod.id,e.id)}
                              style={{padding:"12px 20px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",borderBottom:i<estudiantes.length-1?"1px solid #f3f4f6":"none",background:presente?"#f0fdf4":"#fff",transition:"background 0.1s"}}>
                              <div style={{width:28,height:28,borderRadius:"50%",background:presente?"#16a34a":"#f3f4f6",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontWeight:700,fontSize:13,color:presente?"#fff":"#9ca3af"}}>
                                {presente?"✓":""}
                              </div>
                              <div style={{flex:1}}>
                                <div style={{fontWeight:600,fontSize:14,color:presente?"#16a34a":"#1a1a1a"}}>{e.nombre}</div>
                                {(e.puesto||e.empresa)&&<div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",marginTop:1}}>{[e.puesto,e.empresa].filter(Boolean).join(" · ")}</div>}
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                                <div style={{width:48,height:3,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                                  <div style={{width:pct+"%",height:"100%",background:pct>=80?"#16a34a":"#dc2626",borderRadius:4}}/>
                                </div>
                                <span style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui",minWidth:36}}>{tot}/{maxClases}</span>
                                <span style={{fontWeight:700,fontSize:13,color:presente?"#16a34a":"#9ca3af",minWidth:56,textAlign:"right"}}>{presente?"Presente":"Ausente"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* LISTA DE PROGRAMAS */}
        {view==="lista"&&(
          <div>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
              <div><h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Programas</h1><p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>Gestión de diplomados y cursos de educación continua</p></div>
              {can(session,"editarProgramas")&&<button onClick={openNewProg} style={S.btn(RED,"#fff")}>Nuevo programa</button>}
            </div>
            <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
              <input placeholder="Buscar programa..." value={busqProg} onChange={e=>setBusqProg(e.target.value)} style={{...S.inp,flex:1,minWidth:200}}/>
              <select value={filtroProg} onChange={e=>setFiltroPr(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                <option value="">Todos los tipos</option>
                {TIPOS_PROG.filter(t=>t.valor!=="Otro").map(t=><option key={t.valor} value={t.valor}>{t.valor} · {t.desc}</option>)}
              </select>
              <select value={filtroSt} onChange={e=>setFiltroSt(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                <option value="">Todos los estatus</option>
                <option value="activo">Activo</option>
                <option value="proximo">Próximo</option>
                <option value="finalizado">Finalizado</option>
              </select>
              {(busqProg||filtroProg||filtroSt)&&<button onClick={()=>{setBusqProg("");setFiltroPr("");setFiltroSt("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
            </div>
            <div style={{display:"grid",gap:14}}>
              {progsF.map(p=>{
                const conf=mods(p).filter(m=>m.estatus==="confirmado").length, tot=mods(p).length;
                const inicio=mods(p).map(m=>m.fechaInicio).filter(Boolean).sort()[0], fin=mods(p).map(m=>m.fechaFin).filter(Boolean).sort().reverse()[0];
                const horas=mods(p).reduce((a,m)=>a+(m.clases||0)*(m.horasPorClase||0),0), pct=tot?Math.round(conf/tot*100):0;
                return(
                  <div key={p.id} style={{...S.card,borderLeft:"4px solid "+p.color,padding:"20px 24px",display:"flex",gap:20,alignItems:"center"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:16}}>{p.nombre}</span>
                        <span style={{background:"#f3f4f6",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#6b7280",fontFamily:"system-ui",fontWeight:600}}>{p.tipo.toUpperCase()}</span>
                        <StatusBadge p={p}/>
                      </div>
                      <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui",marginBottom:12}}>
                        {inicio&&<span>{fmtFecha(inicio)} — {fmtFecha(fin)}</span>}
                        {horas>0&&<span>{horas}h totales</span>}
                        <span>{tot} módulos</span>
                        <span>{ests(p).length} estudiantes</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:160,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                          <div style={{width:pct+"%",height:"100%",background:conf===tot&&tot>0?"#16a34a":RED,borderRadius:4}}/>
                        </div>
                        <span style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui"}}>{conf}/{tot} docentes confirmados</span>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={()=>{setSelProg(p.id);setProgTab("modulos");setView("programa");}} style={S.btn(RED,"#fff")}>Ver</button>
                      {can(session,"editarProgramas")&&<button onClick={()=>setCE({titulo:"Eliminar programa",subtitulo:p.nombre,mensaje:"Esta acción eliminará permanentemente el programa y todos sus módulos. Los estudiantes importados también serán desvinculados. Esta acción es irreversible.",onConfirm:()=>delProg(p.id)})} style={S.btn("#fef2f2","#dc2626",{padding:"8px 12px"})}>Eliminar</button>}
                    </div>
                  </div>
                );
              })}
              {progsF.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:60,fontFamily:"system-ui"}}>{busqProg||filtroProg||filtroSt?"Sin resultados. Intenta con otros filtros.":"Sin programas registrados."}</div>}
            </div>
            <div style={{marginTop:48,padding:"22px 28px",...S.card,display:"flex",gap:32,flexWrap:"wrap",justifyContent:"space-between"}}>
              <div><div style={{fontWeight:700,fontSize:11,marginBottom:8,color:RED,letterSpacing:"1px",fontFamily:"system-ui"}}>DIRECCIÓN DE EDUCACIÓN CONTINUA</div><div style={{fontSize:12,color:"#6b7280",lineHeight:1.9,fontFamily:"system-ui"}}>Av. Centro Universitario #2501, Playas de Tijuana, C.P. 22500<br/>Tel: 664 630 1577 Ext. 2576 · WhatsApp: 664 764 1119<br/><a href="mailto:info@tijuana.ibero.mx" style={{color:RED,textDecoration:"none"}}>info@tijuana.ibero.mx</a></div></div>
              <div style={{maxWidth:260,fontSize:11,color:"#9ca3af",fontFamily:"system-ui",lineHeight:1.7,alignSelf:"flex-end"}}>Pertenecemos a la red universitaria más grande del mundo, con más de 220 instituciones en los 5 continentes.<br/>© 2026 IBERO Tijuana.</div>
            </div>
          </div>
        )}

        {/* DETALLE PROGRAMA */}
        {view==="programa"&&prog&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <button onClick={()=>setView("lista")} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:13,padding:0,fontWeight:700,fontFamily:"system-ui"}}>← Volver</button>
              <button onClick={()=>exportPDF(prog)} style={S.btn(RED,"#fff",{fontSize:12})}>Descargar calendario PDF</button>
            </div>
            <div style={{...S.card,padding:"22px 26px",marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:prog.color}}/>
                <h1 style={{fontSize:20,fontWeight:700,margin:0}}>{prog.nombre}</h1>
                <span style={{background:"#f3f4f6",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#6b7280",fontFamily:"system-ui",fontWeight:600}}>{prog.tipo.toUpperCase()}</span>
                {prog.modalidad&&<span style={{background:"#eff6ff",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#2563eb",fontFamily:"system-ui",fontWeight:600}}>{prog.modalidad}</span>}
                {prog.generacion&&<span style={{background:"#f0fdf4",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#16a34a",fontFamily:"system-ui",fontWeight:600}}>{prog.generacion} generación</span>}
                <StatusBadge p={prog}/>
              </div>
              <div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>
                <span>{mods(prog).length} módulos</span>
                <span>{mods(prog).filter(m=>m.estatus==="confirmado").length} confirmados</span>
                <span>{mods(prog).reduce((a,m)=>a+(m.clases||0)*(m.horasPorClase||0),0)}h totales</span>
                <span>{ests(prog).length} estudiantes</span>
              </div>
            </div>

            {/* TABS */}
            <div style={{display:"flex",marginBottom:20,...S.card,overflow:"hidden"}}>
              {[["modulos","Módulos",mods(prog).length],["estudiantes","Estudiantes",ests(prog).length],["asistencia","Asistencia",ests(prog).length],["pagos","Pagos",ests(prog).length]].map(([t,l,cnt])=>(
                <button key={t} onClick={()=>setProgTab(t)} style={{flex:1,padding:"12px 16px",border:"none",borderBottom:progTab===t?"3px solid "+RED:"3px solid transparent",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui",background:"#fff",color:progTab===t?RED:"#6b7280"}}>
                  {l+" ("+cnt+")"}
                </button>
              ))}
            </div>

            {/* MÓDULOS */}
            {progTab==="modulos"&&(
              <div>
                {can(session,"editarModulos")&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}><button onClick={openNewMod} style={S.btn(RED,"#fff")}>Agregar módulo</button></div>}
                <div style={{display:"grid",gap:12}}>
                  {mods(prog).map((m,i)=>{
                    const totalH=(m.clases||0)*(m.horasPorClase||0), conf=m.estatus==="confirmado";
                    return(
                      <div key={m.id} style={{...S.card,borderLeft:"3px solid "+(conf?"#16a34a":"#d97706"),padding:"18px 22px"}}>
                        <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                          <div style={{background:prog.color,color:"#fff",borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:800,flexShrink:0,marginTop:2,fontFamily:"system-ui"}}>{m.numero||"M"+(i+1)}</div>
                          <div style={{flex:1,minWidth:200}}>
                            <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>{m.nombre}</div>
                            <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>
                              <span>{m.docente||"Sin asignar"}</span>
                              <span>{fmtFecha(m.fechaInicio)} — {fmtFecha(m.fechaFin)}</span>
                              {m.dias&&m.dias.length>0&&<span>{m.dias.join(", ")}</span>}
                              {m.horario&&<span>{m.horario}</span>}
                              <span>{m.clases+" clases · "+m.horasPorClase+"h c/u · "}<strong style={{color:"#1a1a1a"}}>{totalH+"h"}</strong></span>
                            </div>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",flexShrink:0}}>
                            <span style={{fontSize:11,padding:"3px 10px",borderRadius:4,background:conf?"#f0fdf4":"#fffbeb",color:conf?"#16a34a":"#d97706",fontWeight:700,fontFamily:"system-ui",border:"1px solid "+(conf?"#bbf7d0":"#fde68a")}}>{conf?"Confirmado":"Propuesta"}</span>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                              {can(session,"confirmarDocentes")&&!conf&&m.docente&&<button onClick={()=>confirmar(prog.id,m.id)} disabled={sending===m.id} style={S.btn("#f0fdf4","#16a34a",{border:"1px solid #bbf7d0",padding:"5px 11px",fontSize:12})}>{sending===m.id?"Enviando...":"Confirmar"}</button>}
                              {can(session,"editarModulos")&&<button onClick={()=>openEditMod(m)} style={S.btn("#f3f4f6","#374151",{padding:"5px 11px",fontSize:12})}>Editar</button>}
                              {can(session,"editarModulos")&&<button onClick={()=>setCS({titulo:"Eliminar módulo",mensaje:`¿Estás seguro de que deseas eliminar el módulo "${m.nombre}"? Esta acción es irreversible.`,onConfirm:()=>delMod(m.id)})} style={S.btn("#fef2f2","#dc2626",{padding:"5px 11px",fontSize:12})}>Eliminar</button>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {mods(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Sin módulos registrados.</div>}
                </div>
              </div>
            )}

            {/* ESTUDIANTES */}
            {progTab==="estudiantes"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
                  <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{ests(prog).length} estudiantes</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {can(session,"importarEstudiantes")&&<button onClick={()=>setShowImp(true)} style={S.btn(RED,"#fff")}>Importar / Sincronizar</button>}
                    {ests(prog).length>0&&<><button onClick={()=>exportCSV(prog)} style={S.btn("#f3f4f6","#374151")}>Exportar CSV</button><button onClick={()=>exportDocente(prog)} style={S.btn("#f3f4f6","#374151")}>Lista para docente</button></>}
                  </div>
                </div>
                {ests(prog).length>0&&(
                  <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                    <input placeholder="Buscar por nombre, empresa o correo..." value={busqEst} onChange={e=>setBusqEst(e.target.value)} style={{...S.inp,flex:1,minWidth:180}}/>
                    <select value={filtroEst} onChange={e=>setFiltroEst(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                      <option value="">Todos los estatus</option>
                      <option value="activo">Activo</option>
                      <option value="egresado">Egresado</option>
                      <option value="baja">Baja</option>
                    </select>
                    {(busqEst||filtroEst)&&<button onClick={()=>{setBusqEst("");setFiltroEst("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
                  </div>
                )}
                <div style={{display:"grid",gap:10}}>
                  {ests(prog).filter(e=>{const q=busqEst.toLowerCase();return(!busqEst||(e.nombre&&e.nombre.toLowerCase().includes(q))||(e.empresa&&e.empresa.toLowerCase().includes(q))||(e.email&&e.email.toLowerCase().includes(q)))&&(!filtroEst||(e.estatus||"activo")===filtroEst);}).map(e=>{
                    const pct=calcPct(e,mods(prog)), riesgo=pct!==null&&pct<80;
                    return(
                      <div key={e.id} style={{...S.card,border:"1px solid "+(riesgo?"#fca5a5":"#e5e7eb"),padding:"14px 18px"}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:200}}>
                            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                              <span style={{fontWeight:700,fontSize:15}}>{e.nombre}</span>
                              <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,fontFamily:"system-ui",fontWeight:700,background:e.estatus==="egresado"?"#f0fdf4":e.estatus==="baja"?"#fef2f2":"#eff6ff",color:e.estatus==="egresado"?"#16a34a":e.estatus==="baja"?"#dc2626":"#2563eb",border:"1px solid "+(e.estatus==="egresado"?"#bbf7d0":e.estatus==="baja"?"#fca5a5":"#bfdbfe")}}>{e.estatus==="egresado"?"Egresado":e.estatus==="baja"?"Baja":"Activo"}</span>
                              {riesgo&&<span style={{fontSize:11,background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:4,padding:"2px 8px",fontFamily:"system-ui",fontWeight:700}}>Asistencia: {pct}%</span>}
                            </div>
                            <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>
                              {e.email&&<span>{e.email}</span>}{e.telefono&&<span>{e.telefono}</span>}{e.empresa&&<span>{e.empresa}</span>}
                            </div>
                            {(e.puesto||e.carrera||e.grado||e.egresado_ibero||e.programa_interes)&&(
                              <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                                {e.puesto&&<span style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>Puesto: {e.puesto}</span>}
                                {e.programa_interes&&<span style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>Programa: {e.programa_interes}</span>}
                                {e.carrera&&<span style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>Carrera: {e.carrera}</span>}
                                {e.grado&&<span style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>Grado: {e.grado}</span>}
                                {e.egresado_ibero&&<span style={{fontSize:11,background:"#eff6ff",borderRadius:4,padding:"2px 8px",color:"#2563eb",fontFamily:"system-ui"}}>Egresado IBERO: {e.egresado_ibero}</span>}
                                {e.requiere_factura&&<span style={{fontSize:11,background:e.requiere_factura==="Sí"?"#fef2f2":"#f3f4f6",borderRadius:4,padding:"2px 8px",color:e.requiere_factura==="Sí"?RED:"#6b7280",fontFamily:"system-ui",fontWeight:600}}>Factura: {e.requiere_factura}</span>}
                                {e.csf_url&&<a href={e.csf_url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600,textDecoration:"none",border:"1px solid #bbf7d0"}}>Ver CSF</a>}
                              </div>
                            )}
                            {(fieldMap||[]).length>0&&<div style={{marginTop:4,display:"flex",gap:6,flexWrap:"wrap"}}>{(fieldMap||[]).map(fm=>{const val=(e.campos_extra&&e.campos_extra[fm.label])||e[fm.label];return val?<span key={fm.id} style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>{fm.label+": "+val}</span>:null;})}</div>}
                            {/* Resumen de pago */}
                            {e.pago&&(e.pago.monto_acordado>0)&&(()=>{
                              const p=e.pago;
                              const montoFinal=p.monto_acordado*(1-(p.descuento_pct||0)/100);
                              const pagadas=(p.parcialidades||[]).filter(x=>x.pagado).length;
                              const total=(p.parcialidades||[]).length;
                              const cobrado=p.tipo==="unico"?(pagadas>0?montoFinal:0):pagadas*(total?montoFinal/total:0);
                              return(
                                <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                                  <span style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:700}}>{fmtMXN(montoFinal)}</span>
                                  {p.tipo==="parcialidades"&&<span style={{fontSize:11,background:"#eff6ff",borderRadius:4,padding:"2px 8px",color:"#2563eb",fontFamily:"system-ui"}}>{pagadas}/{total} pagadas</span>}
                                  {p.tipo==="unico"&&<span style={{fontSize:11,background:cobrado>0?"#f0fdf4":"#fff7ed",borderRadius:4,padding:"2px 8px",color:cobrado>0?"#16a34a":"#d97706",fontFamily:"system-ui",fontWeight:600}}>{cobrado>0?"Pagado":"Pendiente"}</span>}
                                  {p.descuento_pct>0&&<span style={{fontSize:11,background:"#fef2f2",borderRadius:4,padding:"2px 8px",color:RED,fontFamily:"system-ui"}}>Desc. {p.descuento_pct}%</span>}
                                </div>
                              );
                            })()}
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                            <button onClick={()=>setPagoModal({est:e,prog})} style={S.btn("#f3f4f6","#374151",{padding:"5px 10px",fontSize:12})}>Pago</button>
                            <select value={e.estatus||"activo"} onChange={ev=>save((programas||[]).map(p=>p.id===prog.id?{...p,estudiantes:ests(p).map(es=>es.id===e.id?{...es,estatus:ev.target.value}:es)}:p))}
                              style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"5px 8px",fontSize:12,fontFamily:"system-ui",outline:"none",cursor:"pointer"}}>
                              <option value="activo">Activo</option><option value="egresado">Egresado</option><option value="baja">Baja</option>
                            </select>
                            <button onClick={()=>setCS({titulo:"Quitar estudiante",mensaje:`¿Estás seguro de que deseas quitar a "${e.nombre}" de este programa? Se perderá su registro de asistencia.`,onConfirm:()=>save((programas||[]).map(p=>p.id===prog.id?{...p,estudiantes:ests(p).filter(es=>es.id!==e.id)}:p))})} style={S.btn("#fef2f2","#dc2626",{padding:"5px 10px",fontSize:12})}>Quitar</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {ests(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Sin estudiantes. Importa desde tu CRM.</div>}
                </div>
              </div>
            )}

            {/* ASISTENCIA */}
            {progTab==="asistencia"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>Mínimo requerido: 80% de asistencia</div>
                  {ests(prog).length>0&&<button onClick={()=>exportDocente(prog)} style={S.btn("#f3f4f6","#374151")}>Exportar lista para docente</button>}
                </div>
                {mods(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Agrega módulos primero.</div>}
                {mods(prog).length>0&&ests(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Importa estudiantes primero.</div>}
                {mods(prog).length>0&&ests(prog).length>0&&(
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8}}>
                      <thead>
                        <tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>
                          <th style={{textAlign:"left",padding:"12px 16px",fontWeight:700,color:"#374151",fontSize:12,position:"sticky",left:0,background:"#f9f9f9"}}>Estudiante</th>
                          {mods(prog).map(m=><th key={m.id} style={{padding:"10px 12px",fontWeight:700,color:"#374151",fontSize:11,textAlign:"center",whiteSpace:"nowrap",minWidth:90}}>{m.numero}<br/><span style={{fontWeight:400,color:"#9ca3af",fontSize:10}}>{m.clases+" cl."}</span></th>)}
                          <th style={{padding:"10px 12px",fontWeight:700,color:"#374151",fontSize:11,textAlign:"center"}}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ests(prog).map(e=>{
                          const pct=calcPct(e,mods(prog)), riesgo=pct!==null&&pct<80;
                          return(
                            <tr key={e.id} style={{borderBottom:"1px solid #f3f4f6",background:riesgo?"#fef9f9":"#fff"}}>
                              <td style={{padding:"12px 16px",fontWeight:600,position:"sticky",left:0,background:riesgo?"#fef9f9":"#fff"}}>
                                <div>{e.nombre}</div>
                                {e.empresa&&<div style={{fontSize:11,color:"#9ca3af",fontWeight:400}}>{e.empresa}</div>}
                              </td>
                              {mods(prog).map(m=>{
                                const k="mod_"+m.id, asist=(e.asistencia&&e.asistencia[k])||0, max=m.clases||0, pm=max?Math.round(asist/max*100):0;
                                return(
                                  <td key={m.id} style={{padding:"10px 12px",textAlign:"center"}}>
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                      <button onClick={()=>toggleAsist(prog.id,m.id,e.id)} style={{background:asist>0?"#f0fdf4":"#f3f4f6",color:asist>0?"#16a34a":"#9ca3af",border:"1px solid "+(asist>0?"#bbf7d0":"#e5e7eb"),borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"system-ui"}}>{asist+"/"+max}</button>
                                      <div style={{width:48,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:pm+"%",height:"100%",background:pm>=80?"#16a34a":"#dc2626",borderRadius:4}}/></div>
                                    </div>
                                  </td>
                                );
                              })}
                              <td style={{padding:"10px 12px",textAlign:"center"}}>
                                <span style={{fontSize:12,fontWeight:800,color:riesgo?"#dc2626":"#16a34a"}}>{pct!==null?pct+"%":"—"}</span>
                                {riesgo&&<div style={{fontSize:10,color:"#dc2626",marginTop:2}}>En riesgo</div>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* PAGOS */}
            {progTab==="pagos"&&(()=>{
              const estudiantes=ests(prog);
              const totalEsperado=estudiantes.reduce((a,e)=>{
                const p=e.pago;if(!p||!p.monto_acordado)return a;
                return a+p.monto_acordado*(1-(p.descuento_pct||0)/100);
              },0);
              const totalCobrado=estudiantes.reduce((a,e)=>{
                const p=e.pago;if(!p)return a;
                if(p.tipo==="unico"){const pagadas=(p.parcialidades||[]).filter(x=>x.pagado).length;return a+(pagadas>0?p.monto_acordado*(1-(p.descuento_pct||0)/100):0);}
                const mf=p.monto_acordado*(1-(p.descuento_pct||0)/100);
                const tot=(p.parcialidades||[]).length;
                const pag=(p.parcialidades||[]).filter(x=>x.pagado).length;
                return a+(tot?mf/tot*pag:0);
              },0);
              const totalDescuentos=estudiantes.reduce((a,e)=>{
                const p=e.pago;if(!p||!p.monto_acordado||!p.descuento_pct)return a;
                return a+p.monto_acordado*(p.descuento_pct/100);
              },0);
              const pendiente=totalEsperado-totalCobrado;
              return(
                <div>
                  {/* Resumen financiero */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:20}}>
                    {[[`Total esperado`,totalEsperado,"#1a1a1a"],[`Cobrado`,totalCobrado,"#16a34a"],[`Pendiente`,pendiente,"#d97706"],[`Descuentos`,totalDescuentos,RED]].map(([l,v,c])=>(
                      <div key={l} style={{...S.card,padding:"16px 18px"}}>
                        <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:4}}>{l.toUpperCase()}</div>
                        <div style={{fontSize:22,fontWeight:800,color:c,fontFamily:"system-ui"}}>{fmtMXN(v)}</div>
                      </div>
                    ))}
                  </div>
                  {/* Barra de progreso */}
                  {totalEsperado>0&&(
                    <div style={{...S.card,padding:"14px 18px",marginBottom:20}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"system-ui",marginBottom:8}}>
                        <span style={{color:"#6b7280"}}>Progreso de cobranza</span>
                        <span style={{fontWeight:700,color:"#16a34a"}}>{Math.round(totalCobrado/totalEsperado*100)}%</span>
                      </div>
                      <div style={{height:8,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                        <div style={{width:Math.round(totalCobrado/totalEsperado*100)+"%",height:"100%",background:"#16a34a",borderRadius:4,transition:"width 0.3s"}}/>
                      </div>
                    </div>
                  )}
                  {/* Tabla por estudiante */}
                  <div style={{...S.card,overflow:"hidden"}}>
                    <div style={{padding:"14px 18px",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>Desglose por estudiante</div>
                    {estudiantes.length===0&&<div style={{padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Importa estudiantes primero.</div>}
                    {estudiantes.map((e,i)=>{
                      const p=e.pago||{};
                      const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
                      const tot=(p.parcialidades||[]).length;
                      const pag=(p.parcialidades||[]).filter(x=>x.pagado).length;
                      const cobrado=p.tipo==="unico"?(pag>0?mf:0):(tot?mf/tot*pag:0);
                      const pendienteEst=mf-cobrado;
                      const sinConfig=!p.monto_acordado;
                      return(
                        <div key={e.id} style={{padding:"14px 18px",borderBottom:i<estudiantes.length-1?"1px solid #f3f4f6":"none",display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:160}}>
                            <div style={{fontWeight:600,fontSize:14}}>{e.nombre}</div>
                            {e.empresa&&<div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>{e.empresa}</div>}
                            {sinConfig&&<div style={{fontSize:11,color:"#d97706",fontFamily:"system-ui",marginTop:2}}>Sin configurar</div>}
                          </div>
                          {!sinConfig&&(
                            <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,fontFamily:"system-ui"}}>
                              <div style={{textAlign:"center"}}>
                                <div style={{fontSize:10,color:"#9ca3af",fontWeight:700}}>ACORDADO</div>
                                <div style={{fontWeight:700}}>{fmtMXN(mf)}</div>
                                {p.descuento_pct>0&&<div style={{fontSize:10,color:RED}}>-{p.descuento_pct}%</div>}
                              </div>
                              <div style={{textAlign:"center"}}>
                                <div style={{fontSize:10,color:"#9ca3af",fontWeight:700}}>TIPO</div>
                                <div style={{fontWeight:600,fontSize:12}}>{p.tipo==="unico"?"Único":`${tot} parcialidades`}</div>
                              </div>
                              <div style={{textAlign:"center"}}>
                                <div style={{fontSize:10,color:"#9ca3af",fontWeight:700}}>COBRADO</div>
                                <div style={{fontWeight:700,color:"#16a34a"}}>{fmtMXN(cobrado)}</div>
                              </div>
                              <div style={{textAlign:"center"}}>
                                <div style={{fontSize:10,color:"#9ca3af",fontWeight:700}}>PENDIENTE</div>
                                <div style={{fontWeight:700,color:pendienteEst>0?"#d97706":"#16a34a"}}>{fmtMXN(pendienteEst)}</div>
                              </div>
                            </div>
                          )}
                          <button onClick={()=>setPagoModal({est:e,prog})} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12,flexShrink:0})}>{sinConfig?"Configurar":"Editar"}</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* REPORTES */}
        {view==="reportes"&&can(session,"verReportes")&&(
          <div>
            <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 24px",letterSpacing:"-0.5px"}}>Reportes y estadísticas</h1>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:14,marginBottom:28}}>
              {[["Programas",(programas||[]).length],["Est. activos",activos.length],["Egresados",egresados.length],["Bajas",bajas.length],["Docentes",(docentes||[]).length],["Por confirmar",porConf],["Eg. IBERO cursando",egresadosIberoActivos.length],["Eg. IBERO concluyeron",egresadosIberoConcluyeron.length]].map(([l,v])=>(
                <div key={l} style={{...S.card,padding:"20px 22px"}}>
                  <div style={{fontSize:28,fontWeight:800,color:RED,fontFamily:"system-ui"}}>{v}</div>
                  <div style={{fontSize:13,color:"#6b7280",marginTop:4,fontFamily:"system-ui"}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{...S.card,marginBottom:16}}>
              <button onClick={()=>setRepExp(repExp==="egresados"?null:"egresados")} style={{width:"100%",padding:"16px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"system-ui"}}>
                <span style={{fontWeight:700,fontSize:14}}>{"Egresados ("+egresados.length+")"}</span>
                <span style={{color:"#9ca3af"}}>{repExp==="egresados"?"▲":"▼"}</span>
              </button>
              {repExp==="egresados"&&<div style={{borderTop:"1px solid #e5e7eb",padding:"0 20px 16px"}}>
                {egresados.length===0?<div style={{color:"#9ca3af",padding:"20px 0",fontFamily:"system-ui",textAlign:"center"}}>Sin egresados registrados.</div>:egresados.map((e,i)=>(
                  <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f3f4f6",display:"flex",gap:12,fontFamily:"system-ui",fontSize:13}}>
                    <div style={{flex:1}}><span style={{fontWeight:600}}>{e.nombre}</span>{e.empresa&&<span style={{color:"#9ca3af",marginLeft:8}}>{e.empresa}</span>}</div>
                    <div style={{color:"#6b7280"}}>{e.programa}</div>
                  </div>
                ))}
              </div>}
            </div>

            {/* EGRESADOS IBERO */}
            <div style={{...S.card,marginBottom:16,border:"1px solid #bfdbfe"}}>
              <button onClick={()=>setRepExp(repExp==="egresadosIbero"?null:"egresadosIbero")} style={{width:"100%",padding:"16px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"system-ui"}}>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <span style={{fontWeight:700,fontSize:14}}>Egresados IBERO</span>
                  <span style={{background:"#eff6ff",color:"#2563eb",borderRadius:4,padding:"2px 10px",fontSize:12,fontWeight:700,fontFamily:"system-ui"}}>Cursando: {egresadosIberoActivos.length}</span>
                  <span style={{background:"#f0fdf4",color:"#16a34a",borderRadius:4,padding:"2px 10px",fontSize:12,fontWeight:700,fontFamily:"system-ui"}}>Concluyeron: {egresadosIberoConcluyeron.length}</span>
                </div>
                <span style={{color:"#9ca3af"}}>{repExp==="egresadosIbero"?"▲":"▼"}</span>
              </button>
              {repExp==="egresadosIbero"&&(
                <div style={{borderTop:"1px solid #e5e7eb",padding:"0 20px 16px"}}>
                  {egresadosIberoActivos.length===0&&egresadosIberoConcluyeron.length===0&&(
                    <div style={{color:"#9ca3af",padding:"20px 0",fontFamily:"system-ui",textAlign:"center"}}>Sin egresados IBERO registrados.</div>
                  )}
                  {egresadosIberoActivos.length>0&&(
                    <div style={{marginTop:16}}>
                      <div style={{fontWeight:700,fontSize:11,color:"#2563eb",letterSpacing:"1px",fontFamily:"system-ui",marginBottom:8}}>CURSANDO ACTUALMENTE ({egresadosIberoActivos.length})</div>
                      {egresadosIberoActivos.map((e,i)=>(
                        <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f3f4f6",display:"flex",gap:12,fontFamily:"system-ui",fontSize:13,alignItems:"center"}}>
                          <div style={{flex:1}}>
                            <span style={{fontWeight:600}}>{e.nombre}</span>
                            {e.puesto&&<span style={{color:"#6b7280",marginLeft:8,fontSize:12}}>{e.puesto}</span>}
                            {e.empresa&&<span style={{color:"#9ca3af",marginLeft:8,fontSize:12}}>{e.empresa}</span>}
                          </div>
                          <div style={{color:"#6b7280",fontSize:12}}>{e.programa}</div>
                          <span style={{background:"#eff6ff",color:"#2563eb",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Activo</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {egresadosIberoConcluyeron.length>0&&(
                    <div style={{marginTop:16}}>
                      <div style={{fontWeight:700,fontSize:11,color:"#16a34a",letterSpacing:"1px",fontFamily:"system-ui",marginBottom:8}}>CONCLUYERON ({egresadosIberoConcluyeron.length})</div>
                      {egresadosIberoConcluyeron.map((e,i)=>(
                        <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f3f4f6",display:"flex",gap:12,fontFamily:"system-ui",fontSize:13,alignItems:"center"}}>
                          <div style={{flex:1}}>
                            <span style={{fontWeight:600}}>{e.nombre}</span>
                            {e.puesto&&<span style={{color:"#6b7280",marginLeft:8,fontSize:12}}>{e.puesto}</span>}
                            {e.empresa&&<span style={{color:"#9ca3af",marginLeft:8,fontSize:12}}>{e.empresa}</span>}
                          </div>
                          <div style={{color:"#6b7280",fontSize:12}}>{e.programa}</div>
                          <span style={{background:"#f0fdf4",color:"#16a34a",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Egresado</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{...S.card,padding:24}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:16,color:RED,fontFamily:"system-ui",letterSpacing:"0.5px"}}>DETALLE POR PROGRAMA</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13}}>
                  <thead><tr style={{borderBottom:"2px solid #e5e7eb"}}>{["Programa","Tipo","Estatus","Módulos","Confirmados","Estudiantes","Horas"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(programas||[]).map(p=>{
                      const c=mods(p).filter(m=>m.estatus==="confirmado").length, t=mods(p).length, h=mods(p).reduce((a,m)=>a+(m.clases||0)*(m.horasPorClase||0),0), ss=ST_STYLE[progStatus(p)];
                      return(<tr key={p.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                        <td style={{padding:"10px 12px",fontWeight:600}}>{p.nombre}</td>
                        <td style={{padding:"10px 12px",color:"#6b7280"}}>{p.tipo}</td>
                        <td style={{padding:"10px 12px"}}><span style={{background:ss.bg,color:ss.color,border:"1px solid "+ss.border,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>{ss.label}</span></td>
                        <td style={{padding:"10px 12px"}}>{t}</td>
                        <td style={{padding:"10px 12px",color:"#16a34a",fontWeight:600}}>{c}</td>
                        <td style={{padding:"10px 12px",fontWeight:600}}>{ests(p).length}</td>
                        <td style={{padding:"10px 12px",fontWeight:600}}>{h}h</td>
                      </tr>);
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* REPORTE FINANCIERO */}
            {(()=>{
              const [repVista,setRepVista] = [repVistaFin,setRepVistaFin];
              const [repMes,setRepMes]     = [repMesFin,setRepMesFin];

              const calcFinProg = p => {
                const es=ests(p);
                const esperado=es.reduce((a,e)=>{const pg=e.pago;if(!pg||!pg.monto_acordado)return a;return a+pg.monto_acordado*(1-(pg.descuento_pct||0)/100);},0);
                const cobrado=es.reduce((a,e)=>{const pg=e.pago;if(!pg)return a;if(pg.tipo==="unico"){const pag=(pg.parcialidades||[]).filter(x=>x.pagado).length;return a+(pag>0?pg.monto_acordado*(1-(pg.descuento_pct||0)/100):0);}const mf=pg.monto_acordado*(1-(pg.descuento_pct||0)/100);const tot=(pg.parcialidades||[]).length;const pag=(pg.parcialidades||[]).filter(x=>x.pagado).length;return a+(tot?mf/tot*pag:0);},0);
                const descuentos=es.reduce((a,e)=>{const pg=e.pago;if(!pg||!pg.monto_acordado||!pg.descuento_pct)return a;return a+pg.monto_acordado*(pg.descuento_pct/100);},0);
                const honorarios=mods(p).reduce((a,m)=>a+calcHonorarios(m,docentes),0);
                return{esperado,cobrado,pendiente:esperado-cobrado,descuentos,honorarios,margen:esperado-honorarios};
              };

              const proyMens = proyeccionMensual(programas,docentes);
              const mesesDisp = Object.keys(proyMens).sort();
              const aniosDisp  = [...new Set(mesesDisp.map(m=>m.substring(0,4)))].sort();

              const totalEsperado=(programas||[]).reduce((a,p)=>a+calcFinProg(p).esperado,0);
              const totalCobrado=(programas||[]).reduce((a,p)=>a+calcFinProg(p).cobrado,0);
              const totalHonorarios=(programas||[]).reduce((a,p)=>a+calcFinProg(p).honorarios,0);
              const totalMargen=totalEsperado-totalHonorarios;

              return(
                <div style={{marginTop:16}}>
                  {/* Selector de vista */}
                  <div style={{...S.card,padding:"16px 20px",marginBottom:12}}>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      <span style={{fontSize:12,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginRight:4}}>VER POR</span>
                      {[["global","Todo el período"],["mes","Mes"],["programa","Programa"],["anual","Año"]].map(([v,l])=>(
                        <button key={v} onClick={()=>setRepVista(v)} style={{border:"2px solid "+(repVista===v?RED:"#e5e7eb"),borderRadius:6,padding:"5px 14px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:repVista===v?700:400,background:repVista===v?"#fef2f2":"#fff",color:repVista===v?RED:"#6b7280"}}>{l}</button>
                      ))}
                      {repVista==="mes"&&(
                        <select value={repMes} onChange={e=>setRepMes(e.target.value)} style={{...S.inp,width:"auto",marginLeft:8}}>
                          {mesesDisp.map(m=><option key={m} value={m}>{MESES_L[parseInt(m.split("-")[1])-1]} {m.split("-")[0]}</option>)}
                        </select>
                      )}
                      {repVista==="anual"&&(
                        <select value={repMes} onChange={e=>setRepMes(e.target.value)} style={{...S.inp,width:"auto",marginLeft:8}}>
                          {aniosDisp.map(a=><option key={a} value={a}>{a}</option>)}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* VISTA GLOBAL */}
                  {repVista==="global"&&(
                    <div style={{...S.card}}>
                      <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:14,fontFamily:"Georgia,serif"}}>Resumen global</div>
                      <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,borderBottom:"1px solid #e5e7eb"}}>
                        {[["Ingresos esperados",totalEsperado,"#1a1a1a"],["Cobrado",totalCobrado,"#16a34a"],["Pendiente",totalEsperado-totalCobrado,"#d97706"],["Honorarios docentes",totalHonorarios,RED],["Margen neto estimado",totalMargen,"#7c3aed"]].map(([l,v,c])=>(
                          <div key={l} style={{textAlign:"center",padding:"8px 0"}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:4}}>{l.toUpperCase()}</div>
                            <div style={{fontSize:18,fontWeight:800,color:c,fontFamily:"system-ui"}}>{fmtMXN(v)}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13}}>
                          <thead><tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>{["Programa","Estudiantes","Esperado","Cobrado","Honorarios","Margen neto","Avance"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                          <tbody>
                            {(programas||[]).map(p=>{
                              const {esperado,cobrado,honorarios,margen}=calcFinProg(p);
                              const pct=esperado?Math.round(cobrado/esperado*100):0;
                              return(<tr key={p.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                                <td style={{padding:"10px 12px",fontWeight:600}}>{p.nombre}</td>
                                <td style={{padding:"10px 12px",color:"#6b7280"}}>{ests(p).length}</td>
                                <td style={{padding:"10px 12px",fontWeight:600}}>{fmtMXN(esperado)}</td>
                                <td style={{padding:"10px 12px",color:"#16a34a",fontWeight:600}}>{fmtMXN(cobrado)}</td>
                                <td style={{padding:"10px 12px",color:RED}}>{fmtMXN(honorarios)}</td>
                                <td style={{padding:"10px 12px",color:margen>=0?"#7c3aed":"#dc2626",fontWeight:700}}>{fmtMXN(margen)}</td>
                                <td style={{padding:"10px 12px"}}>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <div style={{width:60,height:6,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:pct>=100?"#16a34a":pct>=50?"#d97706":RED,borderRadius:4}}/></div>
                                    <span style={{fontSize:12,fontWeight:700,color:pct>=100?"#16a34a":pct>=50?"#d97706":RED}}>{pct}%</span>
                                  </div>
                                </td>
                              </tr>);
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* VISTA MES */}
                  {repVista==="mes"&&(()=>{
                    const d=proyMens[repMes]||{esperado:0,cobrado:0,honorarios:0};
                    const margen=d.esperado-d.honorarios;
                    // Programas activos ese mes
                    const progsDelMes=(programas||[]).filter(p=>
                      mods(p).some(m=>m.fechaInicio&&m.fechaInicio.substring(0,7)===repMes)||
                      ests(p).some(e=>(e.pago?.parcialidades||[]).some(pa=>pa.fecha_vencimiento?.substring(0,7)===repMes))
                    );
                    return(
                      <div style={{...S.card}}>
                        <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:14,fontFamily:"Georgia,serif"}}>{MESES_L[parseInt(repMes.split("-")[1])-1]} {repMes.split("-")[0]}</div>
                        <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,borderBottom:"1px solid #e5e7eb"}}>
                          {[["Ingresos esperados",d.esperado,"#1a1a1a"],["Cobrado",d.cobrado,"#16a34a"],["Pendiente",d.esperado-d.cobrado,"#d97706"],["Honorarios",d.honorarios,RED],["Margen neto",margen,"#7c3aed"]].map(([l,v,c])=>(
                            <div key={l} style={{textAlign:"center"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:4}}>{l.toUpperCase()}</div>
                              <div style={{fontSize:18,fontWeight:800,color:c,fontFamily:"system-ui"}}>{fmtMXN(v)}</div>
                            </div>
                          ))}
                        </div>
                        {progsDelMes.length>0&&(
                          <div style={{padding:"14px 20px"}}>
                            <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:10}}>PROGRAMAS ACTIVOS ESTE MES</div>
                            {progsDelMes.map(p=>{
                              const modsDelMes=mods(p).filter(m=>m.fechaInicio?.substring(0,7)===repMes);
                              const honMes=modsDelMes.reduce((a,m)=>a+calcHonorarios(m,docentes),0);
                              const ingMes=ests(p).reduce((a,e)=>{
                                const pg=e.pago;if(!pg)return a;
                                if(pg.tipo==="parcialidades"){
                                  return a+(pg.parcialidades||[]).filter(pa=>pa.fecha_vencimiento?.substring(0,7)===repMes).reduce((s,pa)=>s+(pg.monto_acordado*(1-(pg.descuento_pct||0)/100))/(pg.parcialidades.length||1),0);
                                }
                                return a;
                              },0);
                              return(
                                <div key={p.id} style={{display:"flex",gap:12,padding:"8px 0",borderBottom:"1px solid #f3f4f6",flexWrap:"wrap",alignItems:"center"}}>
                                  <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                                  <span style={{flex:1,fontWeight:600,fontSize:13}}>{p.nombre}</span>
                                  {ingMes>0&&<span style={{fontSize:12,fontFamily:"system-ui",color:"#16a34a"}}>Cobros: {fmtMXN(ingMes)}</span>}
                                  {honMes>0&&<span style={{fontSize:12,fontFamily:"system-ui",color:RED}}>Honorarios: {fmtMXN(honMes)}</span>}
                                  {modsDelMes.map(m=><span key={m.id} style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",fontFamily:"system-ui",color:"#6b7280"}}>{m.numero} · {m.docente||"Sin docente"} · {(m.clases||0)*(m.horasPorClase||0)}h</span>)}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* VISTA ANUAL */}
                  {repVista==="anual"&&(()=>{
                    const anio=repMes||aniosDisp[0]||new Date().getFullYear().toString();
                    const mesesAnio=Array.from({length:12},(_,i)=>anio+"-"+String(i+1).padStart(2,"0"));
                    return(
                      <div style={{...S.card}}>
                        <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",fontWeight:700,fontSize:14,fontFamily:"Georgia,serif"}}>Proyección anual {anio}</div>
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13,minWidth:700}}>
                            <thead><tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>
                              {["Mes","Esperado","Cobrado","Pendiente","Honorarios","Margen"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {mesesAnio.map(m=>{
                                const d=proyMens[m]||{esperado:0,cobrado:0,honorarios:0};
                                if(d.esperado===0&&d.honorarios===0)return null;
                                const margen=d.esperado-d.honorarios;
                                return(<tr key={m} style={{borderBottom:"1px solid #f3f4f6",background:m===today().substring(0,7)?"#fef2f2":"#fff"}}>
                                  <td style={{padding:"10px 12px",fontWeight:600}}>{MESES_L[parseInt(m.split("-")[1])-1]}</td>
                                  <td style={{padding:"10px 12px",fontWeight:600}}>{fmtMXN(d.esperado)}</td>
                                  <td style={{padding:"10px 12px",color:"#16a34a",fontWeight:600}}>{fmtMXN(d.cobrado)}</td>
                                  <td style={{padding:"10px 12px",color:"#d97706"}}>{fmtMXN(d.esperado-d.cobrado)}</td>
                                  <td style={{padding:"10px 12px",color:RED}}>{fmtMXN(d.honorarios)}</td>
                                  <td style={{padding:"10px 12px",color:margen>=0?"#7c3aed":"#dc2626",fontWeight:700}}>{fmtMXN(margen)}</td>
                                </tr>);
                              })}
                              {/* Totales */}
                              {(()=>{
                                const tot=mesesAnio.reduce((a,m)=>{const d=proyMens[m]||{esperado:0,cobrado:0,honorarios:0};return{esperado:a.esperado+d.esperado,cobrado:a.cobrado+d.cobrado,honorarios:a.honorarios+d.honorarios};},{esperado:0,cobrado:0,honorarios:0});
                                return(<tr style={{borderTop:"2px solid #e5e7eb",background:"#f9f9f9",fontWeight:700}}>
                                  <td style={{padding:"10px 12px"}}>TOTAL {anio}</td>
                                  <td style={{padding:"10px 12px"}}>{fmtMXN(tot.esperado)}</td>
                                  <td style={{padding:"10px 12px",color:"#16a34a"}}>{fmtMXN(tot.cobrado)}</td>
                                  <td style={{padding:"10px 12px",color:"#d97706"}}>{fmtMXN(tot.esperado-tot.cobrado)}</td>
                                  <td style={{padding:"10px 12px",color:RED}}>{fmtMXN(tot.honorarios)}</td>
                                  <td style={{padding:"10px 12px",color:"#7c3aed"}}>{fmtMXN(tot.esperado-tot.honorarios)}</td>
                                </tr>);
                              })()}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {/* VISTA POR PROGRAMA */}
                  {repVista==="programa"&&(
                    <div style={{display:"grid",gap:12}}>
                      {(programas||[]).map(p=>{
                        const {esperado,cobrado,honorarios,margen,descuentos}=calcFinProg(p);
                        const pct=esperado?Math.round(cobrado/esperado*100):0;
                        // Meses de este programa
                        const mesesProg=[...new Set([
                          ...mods(p).map(m=>m.fechaInicio?.substring(0,7)).filter(Boolean),
                          ...ests(p).flatMap(e=>(e.pago?.parcialidades||[]).map(pa=>pa.fecha_vencimiento?.substring(0,7)).filter(Boolean))
                        ])].sort();
                        return(
                          <div key={p.id} style={{...S.card,overflow:"hidden"}}>
                            <div style={{padding:"14px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",gap:10,alignItems:"center",background:"#f9f9f9"}}>
                              <div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/>
                              <span style={{fontWeight:700,fontSize:14,flex:1}}>{p.nombre}</span>
                              <span style={{fontSize:12,fontFamily:"system-ui",color:"#6b7280"}}>{ests(p).length} estudiantes</span>
                            </div>
                            <div style={{padding:"14px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,borderBottom:mesesProg.length?"1px solid #e5e7eb":"none"}}>
                              {[["Esperado",esperado,"#1a1a1a"],["Cobrado",cobrado,"#16a34a"],["Pendiente",esperado-cobrado,"#d97706"],["Honorarios",honorarios,RED],["Margen",margen,"#7c3aed"]].map(([l,v,c])=>(
                                <div key={l} style={{textAlign:"center"}}>
                                  <div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui",fontWeight:700,marginBottom:2}}>{l.toUpperCase()}</div>
                                  <div style={{fontSize:16,fontWeight:800,color:c,fontFamily:"system-ui"}}>{fmtMXN(v)}</div>
                                </div>
                              ))}
                            </div>
                            {mesesProg.length>0&&(
                              <div style={{overflowX:"auto"}}>
                                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:12,minWidth:500}}>
                                  <thead><tr style={{borderBottom:"1px solid #e5e7eb"}}>{["Mes","Ingresos","Cobrado","Honorarios","Margen"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 14px",fontSize:10,fontWeight:700,color:"#9ca3af",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
                                  <tbody>
                                    {mesesProg.map(m=>{
                                      const d=proyMens[m]||{esperado:0,cobrado:0,honorarios:0};
                                      // Filtrar solo ingresos de este programa en este mes
                                      const ingEst=ests(p).reduce((a,e)=>{
                                        const pg=e.pago;if(!pg)return a;
                                        if(pg.tipo==="parcialidades"){return a+(pg.parcialidades||[]).filter(pa=>pa.fecha_vencimiento?.substring(0,7)===m).reduce((s,pa)=>s+(pg.monto_acordado*(1-(pg.descuento_pct||0)/100))/(pg.parcialidades.length||1),0);}
                                        if(pg.tipo==="unico"&&mods(p).some(mod=>mod.fechaInicio?.substring(0,7)===m)){const mf=pg.monto_acordado*(1-(pg.descuento_pct||0)/100);return a+mf;}
                                        return a;
                                      },0);
                                      const ingCob=ests(p).reduce((a,e)=>{
                                        const pg=e.pago;if(!pg)return a;
                                        if(pg.tipo==="parcialidades"){return a+(pg.parcialidades||[]).filter(pa=>pa.pagado&&pa.fecha_vencimiento?.substring(0,7)===m).reduce((s,pa)=>s+(pg.monto_acordado*(1-(pg.descuento_pct||0)/100))/(pg.parcialidades.length||1),0);}
                                        return a;
                                      },0);
                                      const honMes=mods(p).filter(mod=>mod.fechaInicio?.substring(0,7)===m).reduce((a,mod)=>a+calcHonorarios(mod,docentes),0);
                                      if(ingEst===0&&honMes===0)return null;
                                      const margenMes=ingEst-honMes;
                                      return(<tr key={m} style={{borderBottom:"1px solid #f3f4f6",background:m===today().substring(0,7)?"#fef9ff":"#fff"}}>
                                        <td style={{padding:"8px 14px",fontWeight:600}}>{MESES_L[parseInt(m.split("-")[1])-1]} {m.split("-")[0]}</td>
                                        <td style={{padding:"8px 14px"}}>{fmtMXN(ingEst)}</td>
                                        <td style={{padding:"8px 14px",color:"#16a34a"}}>{fmtMXN(ingCob)}</td>
                                        <td style={{padding:"8px 14px",color:RED}}>{fmtMXN(honMes)}</td>
                                        <td style={{padding:"8px 14px",color:margenMes>=0?"#7c3aed":"#dc2626",fontWeight:700}}>{fmtMXN(margenMes)}</td>
                                      </tr>);
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* TABLA DE MOROSIDAD */}
                  {(()=>{
                    const morosos=[];
                    (programas||[]).forEach(prog=>{
                      ests(prog).forEach(est=>{
                        const ep=calcEstadoPagos(est);
                        if(!ep||ep.conRecargo.length===0)return;
                        const mf=(est.pago.monto_acordado||0)*(1-(est.pago.descuento_pct||0)/100);
                        const montoParcialidad=ep.total?mf/ep.total:0;
                        const recargo=montoParcialidad*ep.conRecargo.length*(RECARGO_PCT/100);
                        morosos.push({est,prog,ep,montoParcialidad,recargo,critico:ep.conRecargo.length>=2});
                      });
                    });
                    if(!morosos.length)return null;
                    return(
                      <div style={{...S.card,marginTop:16}}>
                        <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontWeight:700,fontSize:14,fontFamily:"Georgia,serif",color:"#dc2626"}}>Cartera vencida — {morosos.length} estudiante{morosos.length!==1?"s":""}</div>
                          <div style={{fontSize:13,fontFamily:"system-ui",color:"#6b7280"}}>Recargo total: <strong style={{color:"#dc2626"}}>{fmtMXN(morosos.reduce((a,m)=>a+m.recargo,0))}</strong></div>
                        </div>
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13}}>
                            <thead><tr style={{borderBottom:"2px solid #e5e7eb",background:"#fef2f2"}}>{["Estudiante","Programa","Pagos vencidos","Monto/parcialidad","Recargo (6%)","Total a cobrar","Acción"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#dc2626",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                            <tbody>
                              {morosos.map(({est,prog,ep,montoParcialidad,recargo,critico},i)=>(
                                <tr key={i} style={{borderBottom:"1px solid #f3f4f6",background:critico?"#fff5f5":"#fff"}}>
                                  <td style={{padding:"10px 12px"}}><div style={{fontWeight:600}}>{est.nombre}</div>{est.empresa&&<div style={{fontSize:11,color:"#9ca3af"}}>{est.empresa}</div>}</td>
                                  <td style={{padding:"10px 12px",color:"#6b7280"}}>{prog.nombre}</td>
                                  <td style={{padding:"10px 12px",textAlign:"center"}}><span style={{background:critico?"#fef2f2":"#fffbeb",color:critico?"#dc2626":"#d97706",border:"1px solid "+(critico?"#fca5a5":"#fde68a"),borderRadius:4,padding:"2px 8px",fontWeight:700}}>{ep.conRecargo.length}</span></td>
                                  <td style={{padding:"10px 12px",fontWeight:600}}>{fmtMXN(montoParcialidad)}</td>
                                  <td style={{padding:"10px 12px",color:"#dc2626",fontWeight:700}}>{fmtMXN(recargo)}</td>
                                  <td style={{padding:"10px 12px",fontWeight:700}}>{fmtMXN(montoParcialidad*ep.conRecargo.length+recargo)}</td>
                                  <td style={{padding:"10px 12px"}}>{critico?<span style={{fontSize:11,background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:4,padding:"2px 8px",fontWeight:700}}>Dar de baja</span>:<span style={{fontSize:11,background:"#fffbeb",color:"#d97706",border:"1px solid #fde68a",borderRadius:4,padding:"2px 8px",fontWeight:700}}>Contactar</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        )}

        {/* CONFIG */}
        {view==="config"&&(
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:24,letterSpacing:"-0.3px"}}>Configuración</h1>
            {can(session,"gestionarUsuarios")&&(
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>USUARIOS CON ACCESO</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Gestiona accesos y permisos por usuario.</p>
                {(users||[]).map((u,i)=>(
                  <div key={i} style={{marginBottom:12,padding:"14px 16px",background:"#f9f9f9",borderRadius:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,fontFamily:"system-ui"}}>{u.nombre}</div><div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{u.email}</div></div>
                      {u.email!==session.email&&<button onClick={()=>setCS({titulo:"Eliminar usuario",mensaje:`¿Estás seguro de que deseas eliminar al usuario "${u.nombre}"? Perderá acceso al sistema.`,onConfirm:()=>saveUsers((users||[]).filter((_,j)=>j!==i))})} style={S.btn("#fef2f2","#dc2626",{padding:"5px 12px",fontSize:12})}>Eliminar</button>}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ALL_PERMISOS.map(p=>(
                        <label key={p.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,cursor:u.email===session.email?"default":"pointer",background:u.permisos&&u.permisos[p.key]?"#fef2f2":"#f3f4f6",padding:"3px 10px",borderRadius:4,border:"1px solid "+(u.permisos&&u.permisos[p.key]?"#fca5a5":"#e5e7eb"),color:u.permisos&&u.permisos[p.key]?"#1a1a1a":"#9ca3af",fontFamily:"system-ui"}}>
                          <input type="checkbox" checked={!!(u.permisos&&u.permisos[p.key])} disabled={u.email===session.email} onChange={e=>saveUsers((users||[]).map((uu,j)=>j===i?{...uu,permisos:{...(uu.permisos||{}),[p.key]:e.target.checked}}:uu))} style={{margin:0}}/>
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{borderTop:"1px solid #e5e7eb",paddingTop:18,marginTop:8}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:12,fontFamily:"system-ui"}}>Agregar usuario</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    {[["Nombre","nombre"],["Correo","email"]].map(([l,k])=><div key={k}><label style={S.lbl}>{l}</label><input value={newUser[k]||""} onChange={e=>setNewUser({...newUser,[k]:e.target.value})} style={S.inp}/></div>)}
                  </div>
                  <div style={{marginBottom:12}}><label style={S.lbl}>Contraseña</label><div style={{position:"relative"}}><input type={showUP?"text":"password"} value={newUser.password||""} onChange={e=>setNewUser({...newUser,password:e.target.value})} style={{...S.inp,paddingRight:72}}/><button onClick={()=>setShowUP(!showUP)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:12,fontFamily:"system-ui"}}>{showUP?"Ocultar":"Mostrar"}</button></div></div>
                  <div style={{marginBottom:14}}>
                    <label style={S.lbl}>Permisos</label>
                    <div style={{display:"flex",gap:8,marginBottom:8}}>
                      <button onClick={()=>setNewUser({...newUser,permisos:{...VIEWER_P}})} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>Solo lectura</button>
                      <button onClick={()=>setNewUser({...newUser,permisos:{...ADMIN_P}})} style={S.btn("#fef2f2",RED,{padding:"5px 12px",fontSize:12})}>Administrador</button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ALL_PERMISOS.map(p=>(
                        <label key={p.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,cursor:"pointer",background:newUser.permisos&&newUser.permisos[p.key]?"#fef2f2":"#f3f4f6",padding:"3px 10px",borderRadius:4,border:"1px solid "+(newUser.permisos&&newUser.permisos[p.key]?"#fca5a5":"#e5e7eb"),color:newUser.permisos&&newUser.permisos[p.key]?"#1a1a1a":"#9ca3af",fontFamily:"system-ui"}}>
                          <input type="checkbox" checked={!!(newUser.permisos&&newUser.permisos[p.key])} onChange={e=>setNewUser({...newUser,permisos:{...(newUser.permisos||{}),[p.key]:e.target.checked}})} style={{margin:0}}/>{p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button onClick={()=>{if(!newUser.nombre||!newUser.email||!newUser.password){notify("Completa todos los campos","error");return;}saveUsers([...(users||[]),{...newUser}]);setNewUser({nombre:"",email:"",password:"",permisos:{...VIEWER_P}});notify("Usuario agregado");}} style={S.btn(RED,"#fff")}>Agregar usuario</button>
                </div>
              </div>
            )}
            {can(session,"configurarNotif")&&(<>
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>CONFIGURACIÓN DE NOTIFICACIONES Y CRM</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Credenciales para envío de correos e importación de estudiantes.</p>
                {[["API Key","apiKey"],["Account ID","locationId"]].map(([l,k])=>(
                  <div key={k} style={{marginBottom:14}}><label style={S.lbl}>{l}</label><div style={{position:"relative"}}><input type={k==="apiKey"&&!showApiKey?"password":"text"} value={notifCfg[k]||""} onChange={e=>setNotifCfg({...notifCfg,[k]:e.target.value})} placeholder={k==="apiKey"?"••••••••":"ID de cuenta"} style={{...S.inp,paddingRight:k==="apiKey"?80:12}}/>{k==="apiKey"&&<button onClick={()=>setShowAK(!showApiKey)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:12,fontFamily:"system-ui"}}>{showApiKey?"Ocultar":"Mostrar"}</button>}</div></div>
                ))}
                <button onClick={()=>{localStorage.setItem(NK,JSON.stringify(notifCfg));notify("Configuración guardada");}} style={S.btn(RED,"#fff")}>Guardar</button>
              </div>
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>CAMPOS PERSONALIZADOS A IMPORTAR</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Pega la Clave Única del campo en GHL y asígnale una etiqueta.</p>
                {(fieldMap||[]).map((f,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,padding:"10px 14px",background:"#f9f9f9",borderRadius:6,fontFamily:"system-ui"}}>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{f.label}</div><div style={{fontSize:12,color:"#9ca3af",fontFamily:"monospace"}}>{f.id}</div></div>
                    <button onClick={()=>saveFM((fieldMap||[]).filter((_,j)=>j!==i))} style={S.btn("#fef2f2","#dc2626",{padding:"5px 10px",fontSize:12})}>Eliminar</button>
                  </div>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,marginTop:12,alignItems:"flex-end"}}>
                  <div><label style={S.lbl}>Clave única (merge tag)</label><input placeholder="contact.programa_de_intersz" value={newFM.id} onChange={e=>setNewFM({...newFM,id:e.target.value.replace(/\{|\}/g,"").trim()})} style={{...S.inp,fontFamily:"monospace",fontSize:12}}/></div>
                  <div><label style={S.lbl}>Etiqueta a mostrar</label><input placeholder="Programa de interés" value={newFM.label} onChange={e=>setNewFM({...newFM,label:e.target.value})} style={S.inp}/></div>
                  <button onClick={()=>{if(!newFM.id||!newFM.label){notify("Completa clave y etiqueta","error");return;}saveFM([...(fieldMap||[]),{...newFM}]);setNewFM({id:"",label:""});notify("Campo agregado");}} style={S.btn(RED,"#fff",{whiteSpace:"nowrap"})}>Agregar</button>
                </div>
              </div>
              <div style={{...S.card,padding:24}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>RESPONSABLES</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Reciben copia al confirmar un docente.</p>
                {(responsables||[]).map((r,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,padding:"10px 14px",background:"#f9f9f9",borderRadius:6,fontFamily:"system-ui"}}>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14}}>{r.nombre}</div><div style={{fontSize:13,color:"#6b7280"}}>{r.email}</div></div>
                    <button onClick={()=>setCS({titulo:"Eliminar responsable",mensaje:`¿Estás seguro de que deseas eliminar a "${r.nombre}" de los responsables? Dejará de recibir notificaciones.`,onConfirm:()=>saveResp((responsables||[]).filter((_,j)=>j!==i))})} style={S.btn("#fef2f2","#dc2626",{padding:"5px 12px",fontSize:12})}>Eliminar</button>
                  </div>
                ))}
                <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
                  <input placeholder="Nombre" value={newResp.nombre} onChange={e=>setNewResp({...newResp,nombre:e.target.value})} style={{...S.inp,flex:1,minWidth:120}}/>
                  <input placeholder="Correo" value={newResp.email} onChange={e=>setNewResp({...newResp,email:e.target.value})} style={{...S.inp,flex:2,minWidth:160}}/>
                  <button onClick={()=>{if(newResp.nombre&&newResp.email){saveResp([...(responsables||[]),newResp]);setNewResp({nombre:"",email:""});notify("Responsable agregado");}}} style={S.btn(RED,"#fff",{whiteSpace:"nowrap"})}>Agregar</button>
                </div>
              </div>
            </>)}
          </div>
        )}
      </div>

      {/* MODALES */}
      {confirmSimple&&<ConfirmSimple titulo={confirmSimple.titulo} mensaje={confirmSimple.mensaje} onConfirm={confirmSimple.onConfirm} onClose={()=>setCS(null)}/>}
      {confirmEscrita&&<ConfirmEscrita titulo={confirmEscrita.titulo} subtitulo={confirmEscrita.subtitulo} mensaje={confirmEscrita.mensaje} onConfirm={confirmEscrita.onConfirm} onClose={()=>setCE(null)}/>}
      {pagoModal&&<PagoModal est={pagoModal.est} prog={pagoModal.prog} onSave={pago=>savePago(pagoModal.prog.id,pagoModal.est.id,pago)} onClose={()=>setPagoModal(null)}/>}
      {showImport&&prog&&<ImportModal prog={prog} notifConfig={notifCfg} fieldMap={fieldMap} onImport={est=>updateEst(prog.id,est)} onClose={()=>setShowImp(false)}/>}

      {showModM&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:540,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{editMod?"Editar módulo":"Nuevo módulo"}</span>
              <button onClick={()=>setShowModM(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
            </div>
            <div style={{padding:"20px 24px"}}>
              {/* Número de módulo — selector romano */}
              <div style={{marginBottom:13}}>
                <label style={S.lbl}>Número del módulo</label>
                <div style={{overflowX:"auto",paddingBottom:4}}>
                  <div style={{display:"flex",gap:6,width:"max-content"}}>
                    {NUMEROS_MOD.map(n=>(
                      <button key={n} onClick={()=>setModForm({...modForm,numero:n})} style={{width:42,height:42,border:"2px solid "+(modForm.numero===n?RED:"#e5e7eb"),borderRadius:8,cursor:"pointer",fontWeight:800,fontSize:13,fontFamily:"Georgia,serif",background:modForm.numero===n?"#fef2f2":"#fff",color:modForm.numero===n?RED:"#374151",flexShrink:0}}>{n}</button>
                    ))}
                  </div>
                </div>
              </div>
              {[["Nombre del módulo","nombre","text",""],["Correo del docente","emailDocente","email",""]].map(([l,k,t,ph])=>(
                <div key={k} style={{marginBottom:13}}><label style={S.lbl}>{l}</label><input type={t} placeholder={ph} value={modForm[k]||""} onChange={e=>setModForm({...modForm,[k]:e.target.value})} style={S.inp}/></div>
              ))}
              <div style={{marginBottom:13}}>
                <label style={S.lbl}>Docente</label>
                <select value={modForm.docenteId||"__manual__"} onChange={e=>{if(e.target.value==="__manual__"){setModForm({...modForm,docenteId:"",docente:""});}else{const d=(docentes||[]).find(d=>d.id===e.target.value);if(d)setModForm({...modForm,docenteId:d.id,docente:d.nombre,emailDocente:d.email||modForm.emailDocente});}}} style={S.inp}>
                  <option value="__manual__">Escribir manualmente...</option>
                  {(docentes||[]).map(d=><option key={d.id} value={d.id}>{d.nombre+" ("+d.grado+")"}</option>)}
                </select>
                {!modForm.docenteId&&<input placeholder="Nombre del docente" value={modForm.docente||""} onChange={e=>setModForm({...modForm,docente:e.target.value})} style={{...S.inp,marginTop:8}}/>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:13}}>
                {[["Clases","clases","1"],["Horas por clase","horasPorClase","0.5"]].map(([l,k,step])=>(
                  <div key={k}><label style={S.lbl}>{l}</label><input type="number" min="0.5" step={step} value={modForm[k]} onChange={e=>setModForm({...modForm,[k]:parseFloat(e.target.value)||0})} style={S.inp}/></div>
                ))}
                <div><label style={S.lbl}>Total horas</label><div style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"9px 12px",fontSize:15,background:"#fef2f2",color:RED,fontWeight:800,fontFamily:"system-ui",textAlign:"center"}}>{((modForm.clases||0)*(modForm.horasPorClase||0)).toFixed(1)+"h"}</div></div>
              </div>
              {/* Selector de horario */}
              <div style={{marginBottom:13}}>
                <label style={S.lbl}>Horario</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                  {HORARIOS_PRE.map(h=>(
                    <button key={h} onClick={()=>setModForm({...modForm,horario:h==="Otro"?"":h})} style={{border:"2px solid "+(modForm.horario===h?RED:"#e5e7eb"),borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"system-ui",background:modForm.horario===h?"#fef2f2":"#fff",color:modForm.horario===h?RED:"#6b7280"}}>{h}</button>
                  ))}
                </div>
                <input placeholder="Escribe un horario personalizado..." value={modForm.horario||""} onChange={e=>setModForm({...modForm,horario:e.target.value})} style={S.inp}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:13}}>
                {[["Fecha inicio","fechaInicio"],["Fecha fin","fechaFin"]].map(([l,k])=>(
                  <div key={k}><label style={S.lbl}>{l}</label><input type="date" value={modForm[k]||""} onChange={e=>setModForm({...modForm,[k]:e.target.value,fechasClase:[]})} style={S.inp}/></div>
                ))}
              </div>
              <div style={{marginBottom:13}}>
                <label style={S.lbl}>Días de clase</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {DIAS.map(d=><button key={d} onClick={()=>{
                    const cur=modForm.dias||[];
                    const nuevo=cur.includes(d)?cur.filter(x=>x!==d):[...cur,d];
                    const tieneSab=nuevo.includes("Sáb");
                    const tieneEntresemana=nuevo.some(x=>["Lun","Mar","Mié","Jue","Vie"].includes(x));
                    let horario=modForm.horario;
                    if(tieneSab&&!tieneEntresemana)horario="09:00 – 13:00";
                    else if(tieneEntresemana&&!tieneSab)horario="18:00 – 22:00";
                    else if(nuevo.length===0)horario="";
                    setModForm({...modForm,dias:nuevo,horario,fechasClase:[]});
                  }} style={{border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"system-ui",background:(modForm.dias||[]).includes(d)?RED:"#f3f4f6",color:(modForm.dias||[]).includes(d)?"#fff":"#6b7280"}}>{d}</button>)}
                </div>
              </div>

              {/* FECHAS DE CLASE AUTOMÁTICAS */}
              {modForm.fechaInicio&&modForm.fechaFin&&(modForm.dias||[]).length>0&&(()=>{
                const propuesta=generarFechasClase(modForm.fechaInicio,modForm.fechaFin,modForm.dias,modForm.clases);
                const fechas=modForm.fechasClase&&modForm.fechasClase.length?modForm.fechasClase:propuesta;
                const isPropuesta=!modForm.fechasClase||modForm.fechasClase.length===0;
                return(
                  <div style={{marginBottom:13,background:"#f9f9f9",borderRadius:8,padding:"14px 16px",border:"1px solid #e5e7eb"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <label style={{...S.lbl,margin:0}}>Fechas de clase ({fechas.length})</label>
                      <div style={{display:"flex",gap:6}}>
                        {!isPropuesta&&<button onClick={()=>setModForm({...modForm,fechasClase:propuesta})} style={S.btn("#f3f4f6","#374151",{padding:"3px 10px",fontSize:11})}>Recalcular</button>}
                        {isPropuesta&&<button onClick={()=>setModForm({...modForm,fechasClase:propuesta})} style={S.btn("#fffbeb","#d97706",{padding:"3px 10px",fontSize:11,border:"1px solid #fde68a"})}>Confirmar fechas</button>}
                      </div>
                    </div>
                    {isPropuesta&&<div style={{fontSize:12,color:"#d97706",marginBottom:8,fontFamily:"system-ui"}}>Propuesta automática — excluye festivos. Confirma o ajusta.</div>}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {fechas.map((f,i)=>{
                        const fest=isFestivo(f);
                        return(
                          <div key={f} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                            <div style={{position:"relative"}}>
                              <div style={{width:44,height:44,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:fest?"#fffbeb":"#fff",border:fest?"2px solid #fde68a":"1px solid #e5e7eb",padding:2,cursor:"default"}}>
                                <span style={{fontSize:11,fontWeight:700,color:fest?"#d97706":"#374151",fontFamily:"system-ui"}}>{i+1}</span>
                                <span style={{fontSize:9,color:fest?"#d97706":"#9ca3af",fontFamily:"system-ui",textAlign:"center"}}>{f.slice(5).replace("-","/")}</span>
                              </div>
                              <button onClick={()=>setModForm({...modForm,fechasClase:fechas.filter((_,j)=>j!==i)})} style={{position:"absolute",top:-6,right:-6,width:16,height:16,borderRadius:"50%",background:"#dc2626",border:"none",color:"#fff",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>×</button>
                            </div>
                            {fest&&<span style={{fontSize:8,color:"#d97706",fontFamily:"system-ui",fontWeight:700}}>festivo</span>}
                          </div>
                        );
                      })}
                    </div>
                    {/* Agregar fecha manual — input visible */}
                    <div style={{marginTop:10,display:"flex",gap:8,alignItems:"center"}}>
                      <input type="date" id="fecha_manual_input" min={modForm.fechaInicio||undefined} max={modForm.fechaFin||undefined} style={{...S.inp,flex:1,fontSize:13}}/>
                      <button onClick={()=>{
                        const inp=document.getElementById("fecha_manual_input");
                        const v=inp?inp.value:"";
                        if(v&&!fechas.includes(v)){const nuevo=[...fechas,v].sort();setModForm({...modForm,fechasClase:nuevo});}
                        if(inp)inp.value="";
                      }} style={S.btn(RED,"#fff",{whiteSpace:"nowrap",padding:"8px 14px",fontSize:12})}>Agregar fecha</button>
                    </div>
                  </div>
                );
              })()}
              <div style={{marginBottom:22}}>
                <label style={S.lbl}>Estatus del docente</label>
                <div style={{display:"flex",gap:8}}>
                  {[["propuesta","Propuesta","#fffbeb","#d97706"],["confirmado","Confirmado","#f0fdf4","#16a34a"]].map(([s,l,bg,color])=>(
                    <button key={s} onClick={()=>setModForm({...modForm,estatus:s})} style={{border:"2px solid "+(modForm.estatus===s?color:"#e5e7eb"),borderRadius:6,padding:"8px 18px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",background:modForm.estatus===s?bg:"#fff",color:modForm.estatus===s?color:"#9ca3af"}}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowModM(false)} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={saveMod} style={S.btn(RED,"#fff")}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProgM&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Nuevo programa</span>
              <button onClick={()=>setShowProgM(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
            </div>
            <div style={{padding:"20px 24px"}}>
              <div style={{marginBottom:14}}><label style={S.lbl}>Nombre del programa</label><input value={progForm.nombre||""} onChange={e=>setProgForm({...progForm,nombre:e.target.value})} style={S.inp}/></div>
              <div style={{marginBottom:14}}>
                <label style={S.lbl}>Tipo de programa</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:progForm.tipo==="Otro"?8:0}}>
                  {TIPOS_PROG.map(t=>(
                    <button key={t.valor} onClick={()=>setProgForm({...progForm,tipo:t.valor,tipoCustom:""})} style={{border:"2px solid "+(progForm.tipo===t.valor?RED:"#e5e7eb"),borderRadius:8,padding:"10px 12px",cursor:"pointer",fontFamily:"system-ui",background:progForm.tipo===t.valor?"#fef2f2":"#fff",textAlign:"left"}}>
                      <div style={{fontWeight:700,fontSize:13,color:progForm.tipo===t.valor?RED:"#1a1a1a"}}>{t.valor}</div>
                      <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{t.desc}</div>
                    </button>
                  ))}
                </div>
                {progForm.tipo==="Otro"&&<input placeholder="Especifica el tipo..." value={progForm.tipoCustom||""} onChange={e=>setProgForm({...progForm,tipoCustom:e.target.value})} style={{...S.inp,marginTop:4}}/>}
              </div>
              <div style={{marginBottom:14}}>
                <label style={S.lbl}>Modalidad</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {MODALIDADES.map(m=>(
                    <button key={m.valor} onClick={()=>setProgForm({...progForm,modalidad:m.valor})} style={{border:"2px solid "+(progForm.modalidad===m.valor?RED:"#e5e7eb"),borderRadius:8,padding:"10px 12px",cursor:"pointer",fontFamily:"system-ui",background:progForm.modalidad===m.valor?"#fef2f2":"#fff",textAlign:"left"}}>
                      <span style={{fontWeight:700,fontSize:13,color:progForm.modalidad===m.valor?RED:"#1a1a1a"}}>{m.valor}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={S.lbl}>Generación</label>
                <div style={{overflowX:"auto",paddingBottom:4}}>
                  <div style={{display:"flex",gap:8,width:"max-content"}}>
                    {GENERACIONES.map((g,i)=>(
                      <button key={g} onClick={()=>setProgForm({...progForm,generacion:g})} style={{border:"2px solid "+(progForm.generacion===g?RED:"#e5e7eb"),borderRadius:8,padding:"8px 14px",cursor:"pointer",fontFamily:"system-ui",background:progForm.generacion===g?"#fef2f2":"#fff",whiteSpace:"nowrap",flexShrink:0}}>
                        <div style={{fontWeight:700,fontSize:13,color:progForm.generacion===g?RED:"#1a1a1a"}}>{g}</div>
                        <div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>{i+1}ª gen.</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{marginBottom:22}}>
                <label style={S.lbl}>Color identificador</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {COLORES.map(c=><button key={c} onClick={()=>setProgForm({...progForm,color:c})} style={{width:30,height:30,borderRadius:"50%",background:c,border:progForm.color===c?"3px solid #1a1a1a":"3px solid transparent",cursor:"pointer"}}/>)}
                </div>
              </div>

              {/* SECCIÓN FINANCIERA */}
              <div style={{borderTop:"1px solid #e5e7eb",paddingTop:18,marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:11,color:RED,letterSpacing:"1px",fontFamily:"system-ui",marginBottom:14}}>INFORMACIÓN FINANCIERA</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  <div>
                    <label style={S.lbl}>Precio lista (MXN)</label>
                    <input type="number" min="0" value={progForm.precioLista||""} onChange={e=>setProgForm({...progForm,precioLista:parseFloat(e.target.value)||0})} placeholder="0" style={S.inp}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Parcialidades default</label>
                    <input type="number" min="1" max="24" value={progForm.parcialidadesDefault||5} onChange={e=>setProgForm({...progForm,parcialidadesDefault:parseInt(e.target.value)||5})} style={S.inp}/>
                  </div>
                </div>
                <div>
                  <label style={S.lbl}>Promociones / descuentos disponibles</label>
                  <div style={{display:"grid",gap:6,marginBottom:10}}>
                    {(progForm.promociones||[]).map((pr,i)=>(
                      <div key={pr.id||i} style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:pr.editable?"#fffbeb":"#f9f9f9",borderRadius:6,border:"1px solid "+(pr.editable?"#fde68a":"#e5e7eb")}}>
                        {/* Nombre — solo editable si es beca especial o personalizada */}
                        <input value={pr.nombre}
                          onChange={e=>{const p=[...(progForm.promociones||[])];p[i]={...p[i],nombre:e.target.value};setProgForm({...progForm,promociones:p});}}
                          readOnly={!pr.editable&&pr.id&&pr.id.startsWith("promo_")&&pr.nombre!==""}
                          style={{...S.inp,flex:2,background:(!pr.editable&&pr.id?.startsWith("promo_"))?"#f3f4f6":"#fff",color:"#1a1a1a"}}/>
                        {/* Descuento */}
                        <div style={{display:"flex",alignItems:"center",gap:4,width:80}}>
                          <input type="number" min="0" max="100" value={pr.descuento}
                            onChange={e=>{const p=[...(progForm.promociones||[])];p[i]={...p[i],descuento:parseFloat(e.target.value)||0};setProgForm({...progForm,promociones:p});}}
                            style={{...S.inp,textAlign:"center",padding:"8px 4px"}}/>
                          <span style={{fontFamily:"system-ui",fontSize:13,color:"#6b7280",flexShrink:0}}>%</span>
                        </div>
                        {pr.editable&&<span style={{fontSize:10,color:"#d97706",fontFamily:"system-ui",fontWeight:700,flexShrink:0}}>EDITABLE</span>}
                        <button onClick={()=>setProgForm({...progForm,promociones:(progForm.promociones||[]).filter((_,j)=>j!==i)})}
                          style={{background:"none",border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",color:"#dc2626",fontWeight:700,flexShrink:0,fontSize:16}}>×</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setProgForm({...progForm,promociones:[...(progForm.promociones||[]),{id:newId(),nombre:"",descuento:0,editable:true}]})}
                    style={{...S.btn("#f3f4f6","#374151",{fontSize:12})}}>+ Agregar promoción especial</button>
                </div>
              </div>

              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowProgM(false)} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={saveProg} style={S.btn(RED,"#fff")}>Crear programa</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
