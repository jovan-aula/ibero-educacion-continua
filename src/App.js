import { useState, useEffect, useRef } from "react";

// ─── SUPABASE ─────────────────────────────────────────
const SUPA_URL = process.env.REACT_APP_SUPA_URL;
const SUPA_KEY = process.env.REACT_APP_SUPA_KEY;

const supa = {
  _token: null,
  get headers() {
    const auth = this._token ? `Bearer ${this._token}` : `Bearer ${SUPA_KEY}`;
    return { "apikey": SUPA_KEY, "Authorization": auth, "Content-Type": "application/json", "Prefer": "return=minimal" };
  },
  setToken(token) { this._token = token; },

  async get(table, params="") {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}${params}`, { headers: { ...this.headers, "Prefer": "return=representation" } });
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { console.error("Supabase GET error:", e); return null; }
  },

  async upsert(table, data) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...this.headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(Array.isArray(data) ? data : [data]),
      });
      if (!r.ok) {
        const err = await r.json().catch(()=>({}));
        console.error(`Supabase UPSERT error [${table}]:`, r.status, err);
      }
      return r.ok;
    } catch(e) { console.error("Supabase UPSERT error:", e); return false; }
  },

  async del(table, id) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: this.headers });
      return r.ok;
    } catch(e) { console.error("Supabase DELETE error:", e); return false; }
  },

  async signIn(email, password) {
    try {
      const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) return { error: d.error_description || d.msg || "Credenciales incorrectas" };
      if (d.access_token) this.setToken(d.access_token);
      return { user: d.user, token: d.access_token, refresh_token: d.refresh_token };
    } catch(e) { return { error: "Error de conexión. Verifica tu internet." }; }
  },

  async refreshToken(refresh_token) {
    try {
      const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token }),
      });
      const d = await r.json();
      if (!r.ok) return null;
      if (d.access_token) this.setToken(d.access_token);
      return { token: d.access_token, refresh_token: d.refresh_token };
    } catch(e) { return null; }
  },
};

// ─── HELPERS CRM SYNC ────────────────────────────────
const ghlGetCF = (customFields, id, fieldKey) => {
  const cf = (customFields||[]).find(f=>f.id===id||f.fieldKey===fieldKey||f.fieldKey==="contact."+fieldKey);
  const val = cf ? cf.value||cf.fieldValue||cf.fieldValueString||"" : "";
  if(!val) return "";
  return String(val).trim();
};
const ghlParseFechaNac = dob => {
  if(!dob) return "";
  if(dob._seconds){ const d=new Date(dob._seconds*1000); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  if(typeof dob==="string") return dob.slice(0,10);
  return "";
};
const ghlBuildPago = (monto, parcDefault, formaPago, precioLista=0, fechaBase="") => {
  const n = parcDefault||5;
  const base = fechaBase ? new Date(fechaBase+"T12:00:00") : new Date();
  const fechas = Array.from({length:n},(_,i)=>{ const d=new Date(base.getFullYear(),base.getMonth()+i,1); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-15"; });
  const esUnico = formaPago&&(formaPago.toLowerCase().includes("único")||formaPago.toLowerCase().includes("unico")||formaPago.toLowerCase().includes("contado"));
  const totalAcordado = (!esUnico&&monto>0) ? monto*n : monto;
  let montoBase = precioLista>0 ? precioLista : totalAcordado;
  let descAuto = 0;
  if(precioLista>0&&totalAcordado>0&&totalAcordado<=precioLista) descAuto=Math.round((1-totalAcordado/precioLista)*100);
  else if(precioLista>0&&totalAcordado>precioLista) montoBase=totalAcordado;
  const uid = ()=>Math.random().toString(36).slice(2,10);
  const todayStr = ()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
  if(esUnico) return { tipo:"unico", monto_acordado:montoBase, descuento_pct:descAuto, promocion_id:"", parcialidades:[{id:uid(),numero:1,pagado:true,fecha_pago:todayStr(),fecha_vencimiento:""}], notas:formaPago||"" };
  return { tipo:"parcialidades", monto_acordado:montoBase, descuento_pct:descAuto, promocion_id:"", parcialidades:Array.from({length:n},(_,i)=>({id:uid(),numero:i+1,pagado:i===0,fecha_pago:i===0?todayStr():"",fecha_vencimiento:fechas[i]})), notas:formaPago||"" };
};
const ghlFetchContacts = async (apiKey, locationId, pipelineId, stageId) => {
  try {
    let allOpps=[]; let startAfter=""; let startAfterId=""; let page=0;
    while(page<10){
      let url=`https://services.leadconnectorhq.com/opportunities/search?location_id=${locationId}&pipeline_id=${pipelineId}&status=open&limit=100`;
      if(stageId) url+=`&pipeline_stage_id=${stageId}`;
      if(startAfter) url+=`&startAfter=${startAfter}&startAfterId=${startAfterId}`;
      const r=await fetch(url,{headers:{"Authorization":"Bearer "+apiKey,"Version":"2021-04-15"}});
      if(!r.ok){ console.error("[Sync] API error:",r.status, await r.text().catch(()=>"")); break; }
      const d=await r.json();
      const opps=d.opportunities||[];
      allOpps=[...allOpps,...opps];
      if(!d.meta?.nextPageUrl||opps.length<100) break;
      startAfter=d.meta.startAfter||""; startAfterId=d.meta.startAfterId||""; page++;
    }
    const enriched = await Promise.all(allOpps.map(async op=>{
      try {
        const cr=await fetch(`https://services.leadconnectorhq.com/contacts/${op.contactId}`,{headers:{"Authorization":"Bearer "+apiKey,"Version":"2021-04-15"}});
        const cd=await cr.json();
        const mergedCF=[...(cd.contact?.customFields||[]),...(op.customFields||[])].filter((f,i,arr)=>arr.findIndex(x=>x.id===f.id)===i);
        return {...cd.contact, monetaryValue:op.monetaryValue||cd.contact?.monetaryValue||0, customFields:mergedCF};
      } catch(e){ return null; }
    }));
    return enriched.filter(Boolean);
  } catch(e){ return []; }
};

// Sincronizar programas completos a Supabase
const syncToSupabase = async (programas) => {
  // Programas
  const progs = programas.map(p=>({
    id: p.id, nombre: p.nombre, tipo: p.tipo||"", modalidad: p.modalidad||"",
    generacion: p.generacion||"", color: p.color||"", descripcion: p.descripcion||"",
    parcialidades_default: p.parcialidadesDefault||5, estatus: p.estatus||"activo",
    colaboracion: p.colaboracion||false, socio: p.socio||"", pct_socio: p.pct_socio||0,
    precio_lista: p.precioLista||0, tipo_custom: p.tipoCustom||"",
    notas_internas: p.notas_internas||"",
    ghl_pipeline_id: p.ghl_pipeline_id||"",
    ghl_stage_id: p.ghl_stage_id||"",
  }));
  const okProgs = await supa.upsert("programas", progs);
  if(!okProgs) throw new Error("Error al guardar programas");

  // Módulos
  const modulos = programas.flatMap(p=>(p.modulos||[]).map(m=>({
    id: m.id, programa_id: p.id, numero: m.numero||"", nombre: m.nombre||"",
    docente_id: m.docenteId||null, docente: m.docente||"", email_docente: m.emailDocente||"",
    clases: m.clases||4, horas_por_clase: m.horasPorClase||4, horario: m.horario||"",
    fecha_inicio: m.fechaInicio||"", fecha_fin: m.fechaFin||"",
    dias: m.dias||[], fechas_clase: m.fechasClase||[], estatus: m.estatus||"propuesta",
    factura_solicitada: m.factura_solicitada||false, pago_emitido: m.pago_emitido||false,
  })));
  if(modulos.length){ const ok = await supa.upsert("modulos", modulos); if(!ok) throw new Error("Error al guardar módulos"); }

  // Estudiantes — un registro por (id, programa_id) para soportar estudiantes en múltiples programas
  const estudiantes = programas.flatMap(p=>(p.estudiantes||[]).map(e=>({
    id: e.id, programa_id: p.id, nombre: capNombre(e.nombre||""), email: e.email||"",
    telefono: e.telefono||"", empresa: e.empresa||"", puesto: e.puesto||"",
    carrera: e.carrera||"", grado: e.grado||"", egresado_ibero: e.egresado_ibero||"",
    requiere_factura: e.requiere_factura||"", csf_url: e.csf_url||"",
    fuente: e.fuente||"", programa_interes: e.programa_interes||"",
    forma_pago_crm: e.forma_pago_crm||"", monto_ghl: e.monto_ghl||0, forma_cobro: e.forma_cobro||"",
    razon_social: e.razon_social||"", rfc: e.rfc||"", regimen_fiscal: e.regimen_fiscal||"",
    codigo_postal: e.codigo_postal||"", calle: e.calle||"", num_exterior: e.num_exterior||"",
    num_interior: e.num_interior||"", colonia: e.colonia||"", ciudad: e.ciudad||"",
    estado: e.estado||"", uso_cfdi: e.uso_cfdi||"",
    estatus: e.estatus||"activo", asistencia: e.asistencia||{}, campos_extra: e.campos_extra||{},
    fiscal_token: e.fiscal_token||null,
    fiscal_completado: e.fiscal_completado||false,
    cobranza_estado: e.cobranza_estado||null,
    cobranza_ultimo_contacto: e.cobranza_ultimo_contacto||null,
    cobranza_comprometio: e.cobranza_comprometio||null,
    cobranza_nota: e.cobranza_nota||"",
    factura_enviada: e.factura_enviada||false,
    fecha_nacimiento: e.fecha_nacimiento||null,
  })));
  if(estudiantes.length){ const ok = await supa.upsert("estudiantes", estudiantes); if(!ok) throw new Error("Error al guardar estudiantes"); }

  // Pagos — id incluye programa_id para soportar el mismo estudiante en múltiples programas
  const pagos = programas.flatMap(p=>(p.estudiantes||[]).filter(e=>e.pago).map(e=>({
    id: e.id+"_"+p.id+"_pago", estudiante_id: e.id, programa_id: p.id,
    tipo: e.pago.tipo||"parcialidades", monto_acordado: e.pago.monto_acordado||0,
    descuento_pct: e.pago.descuento_pct||0, promocion_id: e.pago.promocion_id||"",
    parcialidades: e.pago.parcialidades||[], notas: e.pago.notas||"",
  })));
  if(pagos.length){ const ok = await supa.upsert("pagos", pagos); if(!ok) throw new Error("Error al guardar pagos"); }

  return true;
};

const syncDocentesToSupabase = async (docentes) => {
  try {
    if(!docentes||!docentes.length) return;
    const rows = docentes.map(d=>({
      id: d.id, nombre: d.nombre||"", email: d.email||"",
      telefono: d.telefono||"", especialidad: d.especialidad||"",
      honorarios_por_hora: d.honorariosPorHora||d.honorarios_por_hora||0,
      banco: d.banco||"", clabe: d.clabe||"", rfc: d.rfc||"",
      iva: d.iva||16,
      grado: d.grados&&d.grados.length>0?d.grados[d.grados.length-1]:(d.grado||"Licenciatura"),
      grados: d.grados||[], programas_egreso: d.programas_egreso||{},
      categoria: d.categoria||"A", semblanza: d.semblanza||"",
      perfil_incompleto: d.perfil_incompleto||false,
    }));
    await supa.upsert("docentes", rows);
  } catch(e) { console.error("Sync docentes error:", e); }
};

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
  {valor:"Otro",                 },
];

const GENERACIONES = ["Primera","Segunda","Tercera","Cuarta","Quinta","Sexta","Séptima","Octava","Novena","Décima"];
const NUMEROS_MOD  = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];
const HORARIOS_PRE = ["18:00 – 22:00","09:00 – 13:00","08:00 – 14:00","07:00 – 13:00","16:00 – 20:00","Otro"];
// Promociones fijas — no configurables por programa, se auto-seleccionan según % calculado del CRM
const PROMOS_FIJAS = [
  {id:"promo_pronto",     nombre:"Pronto pago",      descuento:20},
  {id:"promo_contado",    nombre:"Pago de contado",  descuento:25},
  {id:"promo_grupal",     nombre:"Beca grupal",      descuento:30},
  {id:"promo_colaborador",nombre:"Colaborador IBERO",descuento:90},
  {id:"promo_beca",       nombre:"Beca especial",    descuento:null}, // cualquier % alto o personalizado
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
  {key:"verPagos",            label:"Ver control de pagos"},
  {key:"verFacturacion",      label:"Ver facturación"},
  {key:"verAsistencia",       label:"Ver asistencia"},
  {key:"verEvaluaciones",     label:"Ver evaluaciones"},
  {key:"verReportes",         label:"Ver reportes / estadísticas"},
  {key:"importarEstudiantes", label:"Importar / sincronizar estudiantes"},
  {key:"confirmarDocentes",   label:"Confirmar docentes"},
  {key:"gestionarDocentes",   label:"Gestionar catálogo de docentes"},
  {key:"gestionarUsuarios",   label:"Gestionar usuarios"},
  {key:"configurarNotif",     label:"Configurar notificaciones"},
];
const ADMIN_P    = Object.fromEntries(ALL_PERMISOS.map(p=>[p.key,true]));
const VIEWER_P   = {verProgramas:true,verPagos:false,verFacturacion:false,verAsistencia:false,verEvaluaciones:false,verReportes:false,importarEstudiantes:false,confirmarDocentes:false,gestionarDocentes:false,editarProgramas:false,editarModulos:false,gestionarUsuarios:false,configurarNotif:false};
const FINANZAS_P = {verProgramas:false,verPagos:true,verFacturacion:true,verAsistencia:false,verEvaluaciones:false,verReportes:false,importarEstudiantes:false,confirmarDocentes:false,gestionarDocentes:false,editarProgramas:false,editarModulos:false,gestionarUsuarios:false,configurarNotif:false};
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
const can    = (s,p) => !!(s && (s.rol==="admin" || (s.permisos && s.permisos[p])));
const today  = () => { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const capNombre = n => (n||"").toLowerCase().replace(/(^|\s|-)(\S)/g,(_,sep,c)=>sep+c.toUpperCase());
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
  // Usar fechas reales si existen, si no usar clases como fallback
  const total = modulos.reduce((a,m)=>{
    const fechas = getFechasMod(m).length || (m.clases||0);
    return a + fechas;
  }, 0);
  if (!total) return null;
  const asist = modulos.reduce((a,m)=>{
    const v = est.asistencia && est.asistencia["mod_"+m.id];
    return a + (Array.isArray(v) ? v.length : (v||0));
  }, 0);
  return Math.min(100, Math.round(asist/total*100)); // cap a 100% por seguridad
};

const RECARGO_PCT = 6.5;

// Helper central — siempre usar fechasClase confirmadas, generar como fallback
const getFechasMod = mod => {
  if (mod.fechasClase && mod.fechasClase.length > 0) return mod.fechasClase;
  if (!mod.fechaInicio || !mod.fechaFin) return [];
  return generarFechasClase(mod.fechaInicio, mod.fechaFin, mod.dias, mod.clases);
};

// Calcula honorarios de un módulo según categoría del docente
const calcHonorarios = (mod, docentes) => {
  if (!mod.docente&&!mod.docenteId) return 0;
  const doc = docentes.find(d=>d.id===mod.docenteId||d.nombre===mod.docente);
  const cat = CATEGORIA_DOCENTE[doc?.categoria||"A"];
  const horas = (mod.clases||0)*(mod.horasPorClase||0);
  const subtotal = horas * cat.tarifa;
  const iva = doc?.iva||16;
  return Math.round(subtotal * (1 + iva/100));
};

// Proyección mensual: por cada parcialidad pendiente o pagada, asigna al mes de vencimiento
const proyeccionMensual = (programas, docentes) => {
  // esperado → por fecha_vencimiento (cuándo vence cada pago)
  // cobrado  → por fecha_pago       (cuándo se marcó como recibido)
  const byMes = {};
  const ini = key => { if(!byMes[key])byMes[key]={esperado:0,cobrado:0,honorarios:0}; };

  (programas||[]).forEach(prog=>{
    ests(prog).forEach(est=>{
      const p=est.pago;
      if(!p||!p.monto_acordado) return;
      const mf=p.monto_acordado*(1-(p.descuento_pct||0)/100);
      const total=p.parcialidades?.length||1;

      if(p.tipo==="unico"){
        // Esperado: mes de inicio del programa
        const mesEsp=(mods(prog).map(m=>m.fechaInicio).filter(Boolean).sort()[0]||"").substring(0,7);
        if(mesEsp){ ini(mesEsp); byMes[mesEsp].esperado+=mf; }
        // Cobrado: mes en que se registró el pago
        const parc=(p.parcialidades||[])[0];
        if(parc?.pagado&&parc?.fecha_pago){
          const mesCob=parc.fecha_pago.substring(0,7);
          ini(mesCob); byMes[mesCob].cobrado+=mf;
        }
      } else {
        (p.parcialidades||[]).forEach(parc=>{
          const montoParc=getMontoParc(parc,mf,total);
          // Esperado: por fecha_vencimiento
          const mesEsp=(parc.fecha_vencimiento||"").substring(0,7);
          if(mesEsp){ ini(mesEsp); byMes[mesEsp].esperado+=montoParc; }
          // Cobrado: por fecha_pago real
          if(parc.pagado&&parc.fecha_pago){
            const mesCob=parc.fecha_pago.substring(0,7);
            ini(mesCob); byMes[mesCob].cobrado+=montoParc;
          }
        });
      }
    });

    // Honorarios: por mes de inicio del módulo
    mods(prog).forEach(mod=>{
      if(!mod.fechaInicio)return;
      const mesKey=mod.fechaInicio.substring(0,7);
      ini(mesKey); byMes[mesKey].honorarios+=calcHonorarios(mod,docentes);
    });
  });

  return byMes;
};

// Calcula el estado de pagos de un estudiante
// Helper central — siempre usar monto_custom si existe, si no calcular base
const getMontoParc = (parc, mf, total) => (parc?.monto_custom > 0) ? parc.monto_custom : (total ? mf / total : 0);
const getMontoCobrado = (pago) => {
  const mf = (pago.monto_acordado||0) * (1 - (pago.descuento_pct||0) / 100);
  const total = (pago.parcialidades||[]).length;
  if (pago.tipo === "unico") return (pago.parcialidades||[]).some(p=>p.pagado) ? mf : 0;
  return (pago.parcialidades||[]).reduce((a, p) => a + (p.pagado ? getMontoParc(p, mf, total) : 0), 0);
};
const getMontoPendiente = (pago) => {
  const mf = (pago.monto_acordado||0) * (1 - (pago.descuento_pct||0) / 100);
  const total = (pago.parcialidades||[]).length;
  return (pago.parcialidades||[]).reduce((a, p) => a + (!p.pagado ? getMontoParc(p, mf, total) : 0), 0);
};

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
  const hoy = today();
  (programas||[]).forEach(prog => {
    mods(prog).forEach(mod => {
      if (!mod.fechaInicio) return;
      const diff = Math.round((new Date(mod.fechaInicio+"T12:00:00") - new Date(hoy+"T12:00:00"))/(86400000));
      if (diff < 0 || diff > 14) return;
      if (!mod.docente) {
        // Sin docente asignado
        alerts.push({tipo:"sin_docente",prog,mod,dias:diff});
      } else if (mod.estatus==="propuesta") {
        // Docente asignado pero no confirmado
        alerts.push({tipo:"sin_confirmar",prog,mod,dias:diff});
      }
    });
    if (progStatus(prog)!=="activo") return;
    ests(prog).forEach(est => {
      if (est.estatus==="baja"||est.estatus==="inactivo") return;

      // Asistencia: más de 3 faltas en cualquier módulo con clases ya transcurridas
      let maxFaltas=0, modFaltas=null;
      mods(prog).forEach(mod=>{
        const pasadas=getFechasMod(mod).filter(f=>f<=hoy);
        if(!pasadas.length)return;
        const v=est.asistencia&&est.asistencia["mod_"+mod.id];
        const presentes=Array.isArray(v)?v.length:(v||0);
        const faltas=pasadas.length-presentes;
        if(faltas>maxFaltas){maxFaltas=faltas;modFaltas=mod;}
      });
      if(maxFaltas>3&&modFaltas) alerts.push({tipo:"asistencia",prog,est,faltas:maxFaltas,mod:modFaltas});

      // Pagos vencidos desde día 16
      const ep = calcEstadoPagos(est);
      if (!ep) return;
      const mf = (est.pago.monto_acordado||0)*(1-(est.pago.descuento_pct||0)/100);
      const montoParcialidad = ep.total ? mf/ep.total : 0;
      const recargo = montoParcialidad * (RECARGO_PCT/100);
      if (ep.conRecargo.length >= 2) {
        alerts.push({tipo:"pago_critico",prog,est,vencidas:ep.conRecargo.length,montoParcialidad,recargo:recargo*ep.conRecargo.length});
      } else if (ep.conRecargo.length === 1) {
        alerts.push({tipo:"pago_recargo",prog,est,vencidas:ep.conRecargo,montoParcialidad,recargo});
      }
    });
    // Recordatorio docente: módulo confirmado que inicia en ≤3 días
    mods(prog).forEach(mod=>{
      if(!mod.docente||mod.estatus!=="confirmado"||!mod.fechaInicio)return;
      const diff=Math.round((new Date(mod.fechaInicio+"T12:00:00")-new Date(hoy+"T12:00:00"))/(86400000));
      if(diff>=0&&diff<=3) alerts.push({tipo:"recordatorio_docente",prog,mod,dias:diff});
    });
    // Factura docente pendiente: módulo que termina este mes, sin factura solicitada
    const mesHoy=hoy.substring(0,7);
    const diaHoy=parseInt(hoy.substring(8,10));
    mods(prog).forEach(mod=>{
      if(!mod.docente||!mod.fechaFin)return;
      if(mod.fechaFin.substring(0,7)===mesHoy&&!mod.factura_solicitada&&diaHoy>=8)
        alerts.push({tipo:"factura_docente",prog,mod});
    });
  });
  // Ordenar: crítico > recargo > factura_docente > recordatorio_docente > asistencia > sin_confirmar > sin_docente
  const prioridad = {pago_critico:0,pago_recargo:1,factura_docente:2,recordatorio_docente:3,asistencia:4,sin_confirmar:5,sin_docente:6};
  return alerts.sort((a,b)=>(prioridad[a.tipo]??9)-(prioridad[b.tipo]??9));
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
function ConfirmSimple({titulo,mensaje,onConfirm,onClose,btnLabel,btnColor}) {
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",overflow:"hidden"}}>
        <div style={{padding:"20px 24px",borderBottom:"1px solid #e5e7eb"}}>
          <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif",marginBottom:4}}>{titulo}</div>
          <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",lineHeight:1.6}}>{mensaje}</div>
        </div>
        <div style={{padding:"16px 24px",background:"#fafafa",display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{background:"#f3f4f6",color:"#374151",border:"none",borderRadius:6,padding:"9px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>Cancelar</button>
          <button onClick={()=>{onConfirm();onClose();}} style={{background:btnColor||"#dc2626",color:"#fff",border:"none",borderRadius:6,padding:"9px 20px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>{btnLabel||"Sí, eliminar"}</button>
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

const FONT_TITLE = "'Montserrat', sans-serif";
const FONT_BODY  = "'Inter', system-ui, sans-serif";
const S = { // estilos reutilizables
  inp: {width:"100%",border:"1.5px solid #E5E7EB",borderRadius:10,padding:"10px 14px",fontSize:14,boxSizing:"border-box",fontFamily:FONT_BODY,outline:"none",background:"#FAFAFA",transition:"border-color .15s",color:"#111"},
  lbl: {fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.07em",fontFamily:FONT_BODY},
  card:{background:"#fff",border:"1px solid #F0F0F0",borderRadius:16,boxShadow:"0 1px 4px rgba(0,0,0,0.05),0 4px 20px rgba(0,0,0,0.04)"},
  btn: (bg,color,extra={}) => ({border:"none",borderRadius:10,padding:"8px 16px",cursor:"pointer",fontWeight:600,fontSize:13,fontFamily:FONT_BODY,background:bg,color,letterSpacing:"0.01em",...extra}),
};

// ─── LOGIN ────────────────────────────────────────────
function LoginScreen({onLogin}) {
  const [email,setEmail] = useState("");
  const [pw,setPw]       = useState("");
  const [err,setErr]     = useState("");
  const [busy,setBusy]   = useState(false);

  const go = async () => {
    if(!email||!pw){setErr("Ingresa tu correo y contraseña.");return;}
    setBusy(true); setErr("");
    // 1. Autenticar con Supabase Auth (contraseñas encriptadas)
    const auth = await supa.signIn(email.toLowerCase(), pw);
    if(auth.error){ setErr(auth.error); setBusy(false); return; }
    // 2. Obtener permisos y rol del usuario desde la tabla usuarios
    const res = await supa.get("usuarios", `?email=eq.${encodeURIComponent(email.toLowerCase())}&activo=eq.true&select=*`);
    const u = res&&res.length>0 ? res[0] : null;
    // Parsear permisos — Supabase a veces devuelve JSON como string
    let permisos = u?.permisos || {};
    if (typeof permisos === "string") { try { permisos = JSON.parse(permisos); } catch(e) { permisos = {}; } }
    const sesion = {
      id: auth.user.id,
      nombre: u?.nombre || auth.user.email,
      email: auth.user.email,
      rol: u?.rol || "auxiliar",
      permisos,
      token: auth.token,
      refresh_token: auth.refresh_token,
    };
    localStorage.setItem(SK2, JSON.stringify(sesion));
    if(auth.token) supa.setToken(auth.token);
    onLogin(sesion);
    setBusy(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#F5F5F7",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:420}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <IberoLogo h={52}/>
          <div style={{marginTop:12,fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:"0.12em",fontFamily:FONT_BODY,textTransform:"uppercase"}}>Educación Continua</div>
        </div>
        {/* Card */}
        <div style={{background:"#fff",borderRadius:16,boxShadow:"0 4px 40px rgba(0,0,0,0.08)",padding:"40px 40px 36px",border:"1px solid #EBEBEB"}}>
          <div style={{fontFamily:FONT_TITLE,fontWeight:700,fontSize:22,color:"#111",marginBottom:6,letterSpacing:"-0.5px"}}>Bienvenido</div>
          <div style={{fontSize:13,color:"#9CA3AF",marginBottom:28,fontFamily:FONT_BODY}}>Ingresa tus credenciales para continuar</div>
          {[["Correo electrónico","email",email,setEmail],["Contraseña","password",pw,setPw]].map(([l,t,v,sv])=>(
            <div key={t} style={{marginBottom:18}}>
              <label style={S.lbl}>{l}</label>
              <input type={t} value={v} onChange={e=>sv(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}
                style={{...S.inp,fontSize:15,padding:"12px 14px"}}/>
            </div>
          ))}
          {err&&<div style={{background:"#FEF2F2",color:"#DC2626",borderRadius:8,padding:"10px 14px",fontSize:13,marginBottom:18,fontFamily:FONT_BODY}}>{err}</div>}
          <button onClick={go} disabled={busy}
            style={{...S.btn(RED,"#fff"),width:"100%",padding:"13px",fontSize:15,fontWeight:700,borderRadius:10,marginTop:4,letterSpacing:"0.01em",opacity:busy?0.7:1}}>
            {busy?"Verificando...":"Iniciar sesión"}
          </button>
        </div>
        <div style={{marginTop:24,textAlign:"center",fontSize:11,color:"#C0C0C0",fontFamily:FONT_BODY,letterSpacing:"0.03em"}}>© 2026 IBERO Tijuana · Sistema interno</div>
      </div>
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
  const fechasClase = getFechasMod(mod);
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

// ─── EVALUACIÓN PÚBLICA DE MÓDULO ────────────────────
function EvaluacionDocente({programas}) {
  const token = new URLSearchParams(window.location.search).get("eval");
  let progId, modId;
  try { const d=JSON.parse(atob(token)); progId=d.progId; modId=d.modId; } catch(e) { return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:RED}}>Enlace inválido.</div>; }

  const prog = (programas||[]).find(p=>p.id===progId);
  const mod  = prog && mods(prog).find(m=>m.id===modId);
  if (!prog||!mod) return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:RED}}>Módulo no encontrado.</div>;

  const [resp,setResp]     = useState({q1:null,q2:null,q3:null,q4:null,q5:null,comentarios:""});
  const [enviado,setEnviado] = useState(false);
  const [error,setError]   = useState("");

  const completo = [resp.q1,resp.q2,resp.q3,resp.q4,resp.q5].every(v=>v!==null);
  const promedio = completo ? Math.round([resp.q1,resp.q2,resp.q3,resp.q4,resp.q5].reduce((a,b)=>a+b,0)/5*10)/10 : null;
  const colorProm = promedio ? (promedio>=4?"#16a34a":promedio>=3?"#d97706":"#dc2626") : "#9ca3af";

  const guardar = async () => {
    if (!completo) { setError("Por favor responde todas las preguntas."); return; }
    try {
      const id = Math.random().toString(36).slice(2,9);
      const fecha = new Date().toISOString().split("T")[0];
      // Guardar en Supabase
      const ok = await supa.upsert("evaluaciones_nps", [{
        id, programa_id: progId, modulo_id: modId,
        docente_id: mod.docenteId||null,
        docente_nombre: mod.docente||"",
        q1: resp.q1, q2: resp.q2, q3: resp.q3, q4: resp.q4, q5: resp.q5,
        promedio, comentarios: resp.comentarios||"", fecha,
      }]);
      if(!ok) throw new Error("No se pudo guardar");
      setEnviado(true);
    } catch(e) { setError("Error al guardar. Intenta de nuevo."); }
  };

  const preguntas = [
    {key:"q1",texto:"¿El módulo cumplió mis expectativas?"},
    {key:"q2",texto:"¿Los contenidos fueron relevantes para mis objetivos profesionales?"},
    {key:"q3",texto:"¿Puedo aplicar al menos una herramienta o idea del módulo de manera inmediata?"},
    {key:"q4",texto:"¿La didáctica del docente (claridad, ritmo, actividades y retroalimentación) facilitó mi aprendizaje?"},
    {key:"q5",texto:"¿El docente demostró dominio actualizado del tema y resolvió dudas con paciencia?"},
  ];

  if (enviado) return (
    <div style={{minHeight:"100vh",background:"#f2f2f2",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui",padding:16}}>
      <div style={{background:"#fff",borderRadius:12,maxWidth:480,width:"100%",padding:40,textAlign:"center",boxShadow:"0 4px 32px rgba(0,0,0,0.08)"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:"#f0fdf4",border:"3px solid #16a34a",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:28}}>✓</div>
        <div style={{fontWeight:700,fontSize:20,fontFamily:"Georgia,serif",marginBottom:8}}>¡Gracias por tu evaluación!</div>
        <div style={{fontSize:14,color:"#6b7280",marginBottom:20,lineHeight:1.6}}>Tu opinión es muy valiosa para mejorar la calidad de nuestros programas de Educación Continua.</div>
        {promedio!==null&&<div style={{background:"#f9f9f9",borderRadius:8,padding:"14px 20px",display:"inline-block"}}><div style={{fontSize:11,color:"#9ca3af",fontWeight:700,marginBottom:4}}>TU CALIFICACIÓN</div><div style={{fontSize:32,fontWeight:800,color:colorProm}}>{promedio}<span style={{fontSize:16,color:"#9ca3af"}}>/5</span></div></div>}
        <div style={{marginTop:24,fontSize:13,color:"#9ca3af"}}>IBERO Tijuana · Coordinación de Educación Continua</div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f2f2f2",fontFamily:"system-ui"}}>
      {/* Header */}
      <div style={{background:RED,padding:"16px 24px",display:"flex",alignItems:"center",gap:16}}>
        <svg height={40} viewBox="0 0 220 80" xmlns="http://www.w3.org/2000/svg"><rect width="220" height="80" fill="#C8102E"/><text x="12" y="58" fontFamily="Georgia,serif" fontSize="56" fontWeight="900" fill="white" letterSpacing="2">IBERO</text><text x="14" y="74" fontFamily="Arial,sans-serif" fontSize="16" fill="white" letterSpacing="6">TIJUANA</text></svg>
        <div style={{color:"rgba(255,255,255,0.85)",fontSize:13}}>Evaluación de módulo · Educación Continua</div>
      </div>

      <div style={{maxWidth:620,margin:"0 auto",padding:"24px 16px"}}>
        {/* Info del módulo */}
        <div style={{background:"#fff",borderRadius:8,border:"1px solid #e5e7eb",padding:"20px 24px",marginBottom:20,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div style={{fontSize:11,fontWeight:700,color:RED,letterSpacing:"1px",marginBottom:4}}>EVALUACIÓN DE MÓDULO</div>
          <div style={{fontWeight:700,fontSize:18,fontFamily:"Georgia,serif",marginBottom:4}}>{mod.nombre}</div>
          <div style={{fontSize:13,color:"#6b7280",marginBottom:8}}>{prog.nombre}{prog.generacion?" · "+prog.generacion+" generación":""}</div>
          {mod.docente&&<div style={{fontSize:13,color:"#374151"}}><span style={{color:"#9ca3af"}}>Docente: </span><strong>{mod.docente}</strong></div>}
        </div>

        {/* Instrucción */}
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"12px 16px",marginBottom:20,fontSize:13,color:"#92400e",lineHeight:1.6}}>
          Tu evaluación es <strong>anónima</strong>. Responde con honestidad — tu opinión nos ayuda a mejorar.<br/>
          <strong>1</strong> = Totalmente en desacuerdo &nbsp;·&nbsp; <strong>5</strong> = Totalmente de acuerdo
        </div>

        {/* Preguntas */}
        <div style={{display:"grid",gap:14,marginBottom:20}}>
          {preguntas.map(({key,texto},i)=>(
            <div key={key} style={{background:"#fff",borderRadius:8,border:"1px solid "+(resp[key]!==null?"#bfdbfe":"#e5e7eb"),padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
              <div style={{fontSize:14,fontWeight:600,color:"#1a1a1a",marginBottom:12,lineHeight:1.5}}>{i+1}. {texto}</div>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:"#9ca3af",minWidth:60}}>En desacuerdo</span>
                <div style={{display:"flex",gap:8}}>
                  {[1,2,3,4,5].map(v=>(
                    <button key={v} onClick={()=>setResp({...resp,[key]:v})}
                      style={{width:44,height:44,borderRadius:8,border:"2px solid "+(resp[key]===v?RED:"#e5e7eb"),
                        background:resp[key]===v?RED:"#fff",color:resp[key]===v?"#fff":"#374151",
                        fontWeight:800,fontSize:16,cursor:"pointer",transition:"all 0.1s",
                        boxShadow:resp[key]===v?"0 2px 8px rgba(200,16,46,0.3)":"none"}}>
                      {v}
                    </button>
                  ))}
                </div>
                <span style={{fontSize:11,color:"#9ca3af",minWidth:48}}>De acuerdo</span>
              </div>
            </div>
          ))}
        </div>

        {/* Comentarios */}
        <div style={{background:"#fff",borderRadius:8,border:"1px solid #e5e7eb",padding:"16px 20px",marginBottom:20,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div style={{fontSize:14,fontWeight:600,color:"#1a1a1a",marginBottom:10}}>Comentarios adicionales <span style={{fontSize:12,color:"#9ca3af",fontWeight:400}}>(opcional)</span></div>
          <textarea value={resp.comentarios} onChange={e=>setResp({...resp,comentarios:e.target.value})}
            placeholder="¿Algo que quieras compartir sobre el módulo, el docente o la experiencia en general?"
            rows={4} style={{width:"100%",border:"1px solid #e5e7eb",borderRadius:6,padding:"10px 12px",fontSize:14,boxSizing:"border-box",fontFamily:"system-ui",outline:"none",resize:"vertical",lineHeight:1.6}}/>
        </div>

        {/* Promedio en tiempo real */}
        {promedio!==null&&(
          <div style={{background:"#f9f9f9",border:"1px solid #e5e7eb",borderRadius:8,padding:"12px 20px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,color:"#374151",fontWeight:600}}>Calificación general</span>
            <span style={{fontSize:26,fontWeight:800,color:colorProm,fontFamily:"Georgia,serif"}}>{promedio}<span style={{fontSize:14,color:"#9ca3af"}}>/5</span></span>
          </div>
        )}

        {error&&<div style={{background:"#fef2f2",color:"#dc2626",borderRadius:6,padding:"10px 14px",fontSize:13,marginBottom:14}}>{error}</div>}

        <button onClick={guardar} disabled={!completo}
          style={{width:"100%",border:"none",borderRadius:8,padding:"14px",cursor:completo?"pointer":"default",
            fontWeight:700,fontSize:15,fontFamily:"system-ui",
            background:completo?RED:"#e5e7eb",color:completo?"#fff":"#9ca3af",
            boxShadow:completo?"0 4px 12px rgba(200,16,46,0.3)":"none"}}>
          {completo?"Enviar evaluación":"Responde todas las preguntas para continuar"}
        </button>

        <div style={{textAlign:"center",marginTop:20,fontSize:12,color:"#9ca3af"}}>
          © 2026 IBERO Tijuana · Coordinación de Educación Continua
        </div>
      </div>
    </div>
  );
}

// ─── IMPORT MODAL ─────────────────────────────────────
// ─── MODAL DE PAGO POR ESTUDIANTE ─────────────────────
const NPS_PREGUNTAS = [
  {key:"q1",texto:"¿El módulo cumplió mis expectativas?"},
  {key:"q2",texto:"¿Los contenidos fueron relevantes para mis objetivos?"},
  {key:"q3",texto:"¿Puedo aplicar al menos una herramienta/idea de manera inmediata?"},
  {key:"q4",texto:"¿La didáctica del docente (claridad, ritmo, actividades) facilitó mi aprendizaje?"},
  {key:"q5",texto:"¿El docente demostró dominio actualizado del tema y resolvió dudas con paciencia?"},
];

function NPSModal({prog, mod, onSave, onClose}) {
  const [resp,setResp] = useState({q1:null,q2:null,q3:null,q4:null,q5:null,comentarios:""});
  const completo = [resp.q1,resp.q2,resp.q3,resp.q4,resp.q5].every(v=>v!==null);
  const promedio = completo ? Math.round([resp.q1,resp.q2,resp.q3,resp.q4,resp.q5].reduce((a,b)=>a+b,0)/5*10)/10 : null;
  const colorProm = promedio ? (promedio>=4?"#16a34a":promedio>=3?"#d97706":"#dc2626") : "#9ca3af";
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{background:RED,padding:"16px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:"#fff",fontFamily:"Georgia,serif"}}>Evaluación del módulo</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",fontFamily:"system-ui",marginTop:2}}>{mod.nombre} · {mod.docente||"Sin docente"}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"rgba(255,255,255,0.8)"}}>×</button>
        </div>
        <div style={{padding:"20px 24px"}}>
          <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginBottom:18,background:"#f9f9f9",borderRadius:6,padding:"10px 14px"}}>
            <strong>1</strong> = Totalmente en desacuerdo &nbsp;·&nbsp; <strong>5</strong> = Totalmente de acuerdo
          </div>
          {NPS_PREGUNTAS.map(({key,texto},i)=>(
            <div key={key} style={{marginBottom:16,paddingBottom:16,borderBottom:i<4?"1px solid #f3f4f6":"none"}}>
              <div style={{fontFamily:"system-ui",fontSize:13,fontWeight:600,color:"#1a1a1a",marginBottom:8}}>{i+1}. {texto}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui",minWidth:70}}>En desacuerdo</span>
                {[1,2,3,4,5].map(v=>(
                  <button key={v} onClick={()=>setResp({...resp,[key]:v})}
                    style={{width:36,height:36,borderRadius:6,border:"2px solid "+(resp[key]===v?RED:"#e5e7eb"),background:resp[key]===v?RED:"#fff",color:resp[key]===v?"#fff":"#374151",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"system-ui"}}>
                    {v}
                  </button>
                ))}
                <span style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui",minWidth:56}}>De acuerdo</span>
              </div>
            </div>
          ))}
          <div style={{marginBottom:16}}>
            <label style={S.lbl}>Comentarios (opcional)</label>
            <textarea value={resp.comentarios} onChange={e=>setResp({...resp,comentarios:e.target.value})} placeholder="Observaciones sobre el módulo o el docente..." rows={3} style={{...S.inp,resize:"vertical",lineHeight:1.6}}/>
          </div>
          {promedio!==null&&(
            <div style={{background:"#f9f9f9",border:"1px solid #e5e7eb",borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontFamily:"system-ui",fontSize:13,color:"#374151",fontWeight:600}}>Promedio del módulo</span>
              <span style={{fontFamily:"system-ui",fontSize:24,fontWeight:800,color:colorProm}}>{promedio}/5</span>
            </div>
          )}
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
            <button onClick={()=>{if(completo){onSave(resp);onClose();}}} disabled={!completo}
              style={S.btn(completo?RED:"#e5e7eb",completo?"#fff":"#9ca3af")}>
              {completo?"Guardar evaluación":"Responde todas las preguntas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditEstModal({est,prog,onSave,onClose}) {
  const [form,setForm] = useState({...est});
  const guardar = () => { onSave(form); onClose(); };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Editar estudiante</span>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
        </div>
        <div style={{padding:"20px 24px"}}>
          {[["Nombre","nombre"],["Correo","email"],["Teléfono","telefono"],["Empresa","empresa"],["Puesto","puesto"],["Carrera","carrera"]].map(([l,k])=>(<div key={k} style={{marginBottom:13}}><label style={S.lbl}>{l}</label><input value={form[k]||""} onChange={e=>setForm({...form,[k]:e.target.value})} style={S.inp}/></div>))}
          <div style={{marginBottom:13}}>
            <label style={S.lbl}>Requiere factura</label>
            <div style={{display:"flex",gap:8}}>{["Sí","No"].map(v=>(<button key={v} onClick={()=>setForm({...form,requiere_factura:v})} style={{border:"2px solid "+(form.requiere_factura===v?RED:"#e5e7eb"),borderRadius:6,padding:"7px 18px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",background:form.requiere_factura===v?"#fef2f2":"#fff",color:form.requiere_factura===v?RED:"#9ca3af"}}>{v}</button>))}</div>
          </div>
          <div style={{marginBottom:20}}>
            <label style={S.lbl}>URL del CSF</label>
            <input value={form.csf_url||""} onChange={e=>setForm({...form,csf_url:e.target.value})} placeholder="https://..." style={S.inp}/>
          </div>
          {/* Datos de facturación */}
          <div style={{borderTop:"1px solid #e5e7eb",paddingTop:16,marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:13,fontFamily:"Georgia,serif",marginBottom:12,color:"#374151"}}>Datos de facturación</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Razón social</label><input value={form.razon_social||""} onChange={e=>setForm({...form,razon_social:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>RFC</label><input value={form.rfc||""} onChange={e=>setForm({...form,rfc:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>Régimen fiscal</label><input value={form.regimen_fiscal||""} onChange={e=>setForm({...form,regimen_fiscal:e.target.value})} style={S.inp}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Uso del CFDI</label><input value={form.uso_cfdi||""} onChange={e=>setForm({...form,uso_cfdi:e.target.value})} style={S.inp}/></div>
              <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Calle</label><input value={form.calle||""} onChange={e=>setForm({...form,calle:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>No. Exterior</label><input value={form.num_exterior||""} onChange={e=>setForm({...form,num_exterior:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>No. Interior</label><input value={form.num_interior||""} onChange={e=>setForm({...form,num_interior:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>Colonia</label><input value={form.colonia||""} onChange={e=>setForm({...form,colonia:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>Código postal</label><input value={form.codigo_postal||""} onChange={e=>setForm({...form,codigo_postal:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>Ciudad</label><input value={form.ciudad||""} onChange={e=>setForm({...form,ciudad:e.target.value})} style={S.inp}/></div>
              <div><label style={S.lbl}>Estado</label><input value={form.estado||""} onChange={e=>setForm({...form,estado:e.target.value})} style={S.inp}/></div>
            </div>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}><button onClick={onClose} style={S.btn("#f3f4f6","#374151")}>Cancelar</button><button onClick={guardar} style={S.btn(RED,"#fff")}>Guardar</button></div>
        </div>
      </div>
    </div>
  );
}

function FiscalModal({est,onSave,onClose}) {
  const [form,setForm] = useState({
    requiere_factura: est.requiere_factura||"",
    rfc: est.rfc||"", razon_social: est.razon_social||"",
    regimen_fiscal: est.regimen_fiscal||"", uso_cfdi: est.uso_cfdi||"",
    calle: est.calle||"", num_exterior: est.num_exterior||"",
    num_interior: est.num_interior||"", colonia: est.colonia||"",
    ciudad: est.ciudad||"", estado: est.estado||"",
    codigo_postal: est.codigo_postal||"", csf_url: est.csf_url||"",
  });
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Datos fiscales</div>
            <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>{est.nombre}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
        </div>
        <div style={{padding:"20px 24px",display:"grid",gap:12}}>
          <div>
            <label style={S.lbl}>¿Requiere factura?</label>
            <div style={{display:"flex",gap:8}}>
              {["Sí","No"].map(v=>(
                <button key={v} onClick={()=>setForm({...form,requiere_factura:v})} style={{border:"2px solid "+(form.requiere_factura===v?RED:"#e5e7eb"),borderRadius:6,padding:"7px 18px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",background:form.requiere_factura===v?"#fef2f2":"#fff",color:form.requiere_factura===v?RED:"#9ca3af"}}>{v}</button>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Razón social</label><input value={form.razon_social} onChange={e=>setForm({...form,razon_social:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>RFC</label><input value={form.rfc} onChange={e=>setForm({...form,rfc:e.target.value.toUpperCase()})} style={S.inp}/></div>
            <div><label style={S.lbl}>Régimen fiscal</label><input value={form.regimen_fiscal} onChange={e=>setForm({...form,regimen_fiscal:e.target.value})} style={S.inp}/></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Uso del CFDI</label><input value={form.uso_cfdi} onChange={e=>setForm({...form,uso_cfdi:e.target.value})} style={S.inp}/></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Calle</label><input value={form.calle} onChange={e=>setForm({...form,calle:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>No. Ext.</label><input value={form.num_exterior} onChange={e=>setForm({...form,num_exterior:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>No. Int.</label><input value={form.num_interior} onChange={e=>setForm({...form,num_interior:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>Colonia</label><input value={form.colonia} onChange={e=>setForm({...form,colonia:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>Ciudad</label><input value={form.ciudad} onChange={e=>setForm({...form,ciudad:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>Estado</label><input value={form.estado} onChange={e=>setForm({...form,estado:e.target.value})} style={S.inp}/></div>
            <div><label style={S.lbl}>Código postal</label><input value={form.codigo_postal} onChange={e=>setForm({...form,codigo_postal:e.target.value})} style={S.inp}/></div>
            <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>URL del CSF</label><input value={form.csf_url} onChange={e=>setForm({...form,csf_url:e.target.value})} placeholder="https://..." style={S.inp}/></div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <button onClick={onClose} style={S.btn("#f3f4f6","#374151",{padding:"9px 20px"})}>Cancelar</button>
            <button onClick={()=>onSave(form)} style={S.btn(RED,"#fff",{padding:"9px 20px",fontWeight:700})}>Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PagoModal({est,prog,onSave,onClose}) {
  const precioL = prog.precioLista||0;
  const montoGHL = est.monto_ghl||0;
  // Si el pago aún no tiene descuento configurado y tenemos datos del CRM, calcular automáticamente
  const pago0 = (()=>{
    const base = est.pago||{tipo:"unico",monto_acordado:montoGHL,descuento_pct:0,promocion_id:"",parcialidades:[],notas:""};
    // Auto-calcular descuento desde CRM si aún no se ha configurado
    if(base.descuento_pct===0 && precioL>0 && montoGHL>0){
      const numParcs = (base.parcialidades||[]).length || (prog.parcialidadesDefault||5);
      const totalAcordado = base.tipo==="parcialidades" ? montoGHL*numParcs : montoGHL;
      if(totalAcordado>0 && totalAcordado<=precioL){
        const descAuto=Math.round((1-totalAcordado/precioL)*100);
        const matchPromo=PROMOS_FIJAS.find(pr=>pr.descuento===descAuto)||(descAuto>=90?PROMOS_FIJAS.find(pr=>pr.id==="promo_beca"):null);
        return {...base, monto_acordado:precioL, descuento_pct:descAuto, promocion_id:matchPromo?matchPromo.id:base.promocion_id||""};
      }
    }
    // Si ya tiene descuento pero sin promo seleccionada, mapear automáticamente
    if(base.descuento_pct>0 && !base.promocion_id){
      const matchPromo=PROMOS_FIJAS.find(pr=>pr.descuento===base.descuento_pct)||(base.descuento_pct>=90?PROMOS_FIJAS.find(pr=>pr.id==="promo_beca"):null);
      if(matchPromo) return {...base, promocion_id:matchPromo.id};
    }
    return base;
  })();
  const [pago,setPago] = useState(pago0);

  const precioLista = prog.precioLista||0;
  const parcDefault = prog.parcialidadesDefault||5;

  const montoFinal = pago.monto_acordado * (1 - (pago.descuento_pct||0)/100);
  const montoParcialidad = pago.tipo==="parcialidades" && pago.parcialidades.length>0
    ? montoFinal / pago.parcialidades.length : 0;

  const aplicarPromocion = id => {
    const pr = PROMOS_FIJAS.find(p=>p.id===id);
    // Beca especial (descuento:null) deja el % como está para que el usuario lo edite
    if(pr&&pr.descuento!==null) setPago({...pago,promocion_id:id,descuento_pct:pr.descuento});
    else setPago({...pago,promocion_id:id});
  };

  // Calcula fecha de vencimiento mensual a partir del mes siguiente al inicio del programa
  const calcFechasVencimiento = (n, fechaInicioProg) => {
    const base = fechaInicioProg ? new Date(fechaInicioProg+"T12:00:00") : new Date();
    // Parcialidad 1 = mes de inicio del programa, luego mes a mes consecutivo
    return Array.from({length:n},(_,i)=>{
      const d = new Date(base.getFullYear(), base.getMonth()+i, 1);
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

          {/* Monto de referencia al importar */}
          {montoGHL>0&&(
            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",marginBottom:8,fontFamily:"system-ui",fontSize:13}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:6}}>
                <span style={{color:"#92400e"}}>
                  {pago.tipo==="parcialidades"
                    ? <>1ª parcialidad CRM: <strong>{fmtMXN(montoGHL)}</strong> · Total: <strong>{fmtMXN(montoGHL*(pago.parcialidades||[]).length||montoGHL*(prog.parcialidadesDefault||5))}</strong></>
                    : <>Monto CRM: <strong>{fmtMXN(montoGHL)}</strong></>
                  }
                </span>
                {precioL>0&&(()=>{
                  const n=(pago.parcialidades||[]).length||(prog.parcialidadesDefault||5);
                  const total=pago.tipo==="parcialidades"?montoGHL*n:montoGHL;
                  if(total<=0||total>precioL)return null;
                  const desc=Math.round((1-total/precioL)*100);
                  return <span style={{color:"#92400e",fontWeight:700}}>{desc===0?"Sin descuento":desc+"% de descuento sobre precio lista ("+fmtMXN(precioL)+")"}</span>;
                })()}
              </div>
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
              <button onClick={()=>setPago({...pago,promocion_id:"",descuento_pct:0})} style={{border:"2px solid "+(pago.promocion_id===""?RED:"#e5e7eb"),borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:pago.promocion_id===""?"#fef2f2":"#fff",color:pago.promocion_id===""?RED:"#6b7280",fontWeight:600}}>Sin descuento</button>
              {PROMOS_FIJAS.map(pr=>(
                <button key={pr.id} onClick={()=>aplicarPromocion(pr.id)} style={{border:"2px solid "+(pago.promocion_id===pr.id?RED:"#e5e7eb"),borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:pago.promocion_id===pr.id?"#fef2f2":"#fff",color:pago.promocion_id===pr.id?RED:"#6b7280",fontWeight:600}}>
                  {pr.nombre}{pr.descuento!==null?" "+pr.descuento+"%":""}
                </button>
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
                  if(v===pago.tipo) return; // ya está seleccionado
                  if(v==="parcialidades"){
                    // Al cambiar a parcialidades siempre regenerar
                    generarParcialidades(parcDefault);
                  } else {
                    // Al cambiar a único: 1 parcialidad ya pagada
                    setPago({...pago, tipo:"unico", parcialidades:[{id:newId(),numero:1,pagado:true,fecha_pago:today(),fecha_vencimiento:""}]});
                  }
                }} style={{flex:1,border:"2px solid "+(pago.tipo===v?RED:"#e5e7eb"),borderRadius:8,padding:"10px",cursor:"pointer",fontFamily:"system-ui",fontWeight:700,fontSize:13,background:pago.tipo===v?"#fef2f2":"#fff",color:pago.tipo===v?RED:"#6b7280"}}>{l}</button>
              ))}
            </div>
          </div>

          {/* Pago único — fecha */}
          {pago.tipo==="unico"&&(
            <div style={{marginBottom:14}}>
              <label style={S.lbl}>Fecha de pago</label>
              <input type="date" value={(pago.parcialidades||[])[0]?.fecha_pago||""} onChange={e=>{
                const parcs=[...(pago.parcialidades||[])];
                if(parcs.length===0) parcs.push({id:Math.random().toString(36).slice(2),numero:1,pagado:true,fecha_vencimiento:""});
                parcs[0]={...parcs[0],fecha_pago:e.target.value};
                setPago({...pago,parcialidades:parcs});
              }} style={{...S.inp,maxWidth:200}}/>
            </div>
          )}

          {/* Parcialidades */}
          {pago.tipo==="parcialidades"&&(
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <label style={S.lbl}>Parcialidades ({pagosPagados}/{totalParcialidades} pagadas)</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  {[3,5,6,10,12].map(n=>(
                    <button key={n} onClick={()=>generarParcialidades(n)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:totalParcialidades===n?"#fef2f2":"#fff",color:totalParcialidades===n?RED:"#6b7280",fontWeight:totalParcialidades===n?700:400}}>{n}</button>
                  ))}
                  {totalParcialidades>0&&(
                    <button onClick={()=>{
                      const nuevasFechas=calcFechasVencimiento(totalParcialidades,fechaInicioProg);
                      setPago({...pago,parcialidades:(pago.parcialidades||[]).map((p,i)=>({
                        ...p,
                        fecha_vencimiento:p.pagado?p.fecha_vencimiento:(nuevasFechas[i]||p.fecha_vencimiento),
                      }))});
                    }} style={{border:"1px solid #bfdbfe",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:12,fontFamily:"system-ui",background:"#eff6ff",color:"#2563eb",fontWeight:500,marginLeft:4}}>
                      Recalcular fechas
                    </button>
                  )}
                </div>
              </div>
              {totalParcialidades>0&&(()=>{
                const tieneCustom=(pago.parcialidades||[]).some(p=>p.monto_custom>0);
                const montoEfectivo=(pago.parcialidades||[]).reduce((a,p)=>a+getMontoParc(p,montoFinal,totalParcialidades),0);
                const descuadrado=tieneCustom&&Math.abs(montoEfectivo-montoFinal)>1;
                return(
                  <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginBottom:8,display:"flex",gap:16,flexWrap:"wrap"}}>
                    <span>{fmtMXN(montoFinal/totalParcialidades)} por parcialidad</span>
                    {tieneCustom&&<span style={{color:descuadrado?"#d97706":"#16a34a",fontWeight:600}}>{descuadrado?`⚠ Total personalizado ${fmtMXN(montoEfectivo)} no coincide con monto acordado`:"✓ Montos personalizados cuadran"}</span>}
                    <span style={{color:"#16a34a"}}>Las siguientes vencen el día 15 de cada mes</span>
                  </div>
                );
              })()}
              <div style={{display:"grid",gap:6}}>
                {(pago.parcialidades||[]).map((p,i)=>{
                  const montoParcBase=totalParcialidades?montoFinal/totalParcialidades:0;
                  const montoMostrar=p.monto_custom>0?p.monto_custom:montoParcBase;
                  const vencido = !p.pagado && p.fecha_vencimiento && p.fecha_vencimiento < today();
                  const hoy15 = today().substring(0,8)+"15";
                  const proxima = !p.pagado && p.fecha_vencimiento && p.fecha_vencimiento >= today() && p.fecha_vencimiento <= hoy15;
                  return(
                    <div key={p.id} style={{padding:"10px 12px",background:p.pagado?"#f0fdf4":vencido?"#fef2f2":"#f9f9f9",borderRadius:6,border:"1px solid "+(p.pagado?"#bbf7d0":vencido?"#fca5a5":"#e5e7eb")}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <button onClick={()=>toggleParcialidad(p.id)} style={{width:24,height:24,borderRadius:"50%",border:"2px solid "+(p.pagado?"#16a34a":vencido?"#dc2626":"#d1d5db"),background:p.pagado?"#16a34a":"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:12,color:"#fff",fontWeight:700}}>{p.pagado?"✓":""}</button>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:"system-ui",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            Parcialidad {p.numero}
                            <input
                              type="number" min="0"
                              value={p.monto_custom>0?p.monto_custom:""}
                              placeholder={String(Math.round(montoParcBase))}
                              onChange={e=>{const parcs=[...(pago.parcialidades||[])];parcs[i]={...parcs[i],monto_custom:parseFloat(e.target.value)||0};setPago({...pago,parcialidades:parcs});}}
                              style={{width:90,border:"1px solid #e5e7eb",borderRadius:4,padding:"2px 6px",fontSize:12,fontFamily:"system-ui",fontWeight:700,color:"#111"}}
                              title="Monto de esta parcialidad"
                            />
                            {p.monto_custom>0&&p.monto_custom!==montoParcBase&&<span style={{fontSize:10,color:"#d97706",fontWeight:700}}>personalizado</span>}
                            {p.numero===1&&<span style={{fontSize:11,color:"#16a34a",fontWeight:400}}>(primer pago)</span>}
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
  const [filters,setFilters]     = useState({pipelineId:prog.ghl_pipeline_id||"",stageId:prog.ghl_stage_id||"",status:"open"});
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
      ? fetch("https://services.leadconnectorhq.com/opportunities/pipelines?locationId="+notifConfig.locationId,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}}).then(r=>r.json()).then(d=>{
          setPipelines(d.pipelines||[]);
          // Si ya hay pipeline seleccionado, cargar sus stages
          if(prog.ghl_pipeline_id){
            const pl=(d.pipelines||[]).find(p=>p.id===prog.ghl_pipeline_id);
            if(pl) setStages(pl.stages||[]);
          }
        }).catch(()=>setPipelines(MOCK_PL))
      : setPipelines(MOCK_PL);
  },[]);

  useEffect(()=>{
    if (!filters.pipelineId) return;
    hasApi ? setStages((pipelines.find(p=>p.id===filters.pipelineId)||{}).stages||[]) : setStages(MOCK_ST[filters.pipelineId]||[]);
    // Solo limpiar stage si el usuario cambió el pipeline (no en el init)
    if(filters.pipelineId!==prog.ghl_pipeline_id) setFilters(f=>({...f,stageId:""}));
  },[filters.pipelineId]);

  const search = async () => {
    if (!filters.pipelineId){setErr("Selecciona un pipeline.");return;}
    setBusy(true); setErr("");
    try {
      if (hasApi) {
        let baseUrl="https://services.leadconnectorhq.com/opportunities/search?location_id="+notifConfig.locationId+"&pipeline_id="+filters.pipelineId+"&status="+filters.status+"&limit=100";
        if (filters.stageId) baseUrl+="&pipeline_stage_id="+filters.stageId;
        // Paginar hasta traer todos los resultados
        let allOpps=[]; let startAfter=""; let startAfterId="";
        while(true){
          let url=baseUrl;
          if(startAfter) url+="&startAfter="+startAfter+"&startAfterId="+startAfterId;
          const r=await fetch(url,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}});
          const d=await r.json();
          const page=d.opportunities||[];
          allOpps=[...allOpps,...page];
          const meta=d.meta||{};
          if(page.length<100||!meta.startAfter)break;
          startAfter=meta.startAfter; startAfterId=meta.startAfterId||"";
        }
        const enriched=await Promise.all(allOpps.map(async op=>{
          try{
            const cr=await fetch("https://services.leadconnectorhq.com/contacts/"+op.contactId,{headers:{"Authorization":"Bearer "+notifConfig.apiKey,"Version":"2021-04-15"}});
            const cd=await cr.json();
            // Pasamos monetaryValue y customFields de la oportunidad al contacto
            // Los campos de la oportunidad tienen prioridad sobre los del contacto
            const mergedCustomFields = [
              ...(cd.contact?.customFields||[]),
              ...(op.customFields||[]),
            ].filter((f,i,arr)=>arr.findIndex(x=>x.id===f.id)===i); // deduplicar por id, oportunidad gana
            const contact={...cd.contact,opportunityStatus:op.status,monetaryValue:op.monetaryValue||cd.contact?.monetaryValue||0,customFields:mergedCustomFields};
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
      const val = cf ? cf.value||cf.fieldValue||cf.fieldValueString||"" : "";
      if (val === null || val === undefined || val === "") return "";
      return String(val).trim();
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

    // Genera fechas de vencimiento mensuales desde el mes de inicio, consecutivas
    const calcVencimientosImport = (n, fechaBase) => {
      const base = fechaBase ? new Date(fechaBase+"T12:00:00") : new Date();
      return Array.from({length:n},(_,i)=>{
        const d = new Date(base.getFullYear(), base.getMonth()+i, 1);
        return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-15";
      });
    };

    // Detecta tipo de pago según monto y genera parcialidades
    // buildPago calcula descuento automático en base al precioLista del programa
    const buildPago = (monto, parcDefault, formaPago, precioLista=0) => {
      const n = parcDefault||5;
      const fechas = calcVencimientosImport(n, fechaInicioPrograma);

      // Detectar si es pago único o parcialidades
      const esUnico = formaPago && (formaPago.toLowerCase().includes("único")||formaPago.toLowerCase().includes("unico")||formaPago.toLowerCase().includes("contado"));

      // Calcular el total real:
      // - Pago único:       monto_ghl = total acordado
      // - Parcialidades:    monto_ghl = UNA parcialidad → total = monto × n
      const totalAcordado = (!esUnico && monto > 0) ? monto * n : monto;

      // Calcular descuento automático contra precio lista
      let montoBase = precioLista > 0 ? precioLista : totalAcordado;
      let descAuto  = 0;
      if (precioLista > 0 && totalAcordado > 0 && totalAcordado <= precioLista) {
        descAuto = Math.round((1 - totalAcordado / precioLista) * 100);
      } else if (precioLista > 0 && totalAcordado > precioLista) {
        // Monto mayor al precio lista — sin descuento, usar monto real
        montoBase = totalAcordado;
      }

      const mkParcialidades = (montoAcordado, descuento=0, notas="") => ({
        tipo:"parcialidades",
        monto_acordado:montoAcordado,
        descuento_pct:descuento,
        promocion_id:"",
        parcialidades:Array.from({length:n},(_,i)=>({
          id:newId(), numero:i+1,
          pagado:i===0, fecha_pago:i===0?today():"",
          fecha_vencimiento:fechas[i],
        })),
        notas,
      });
      const mkUnico = (montoAcordado, descuento=0, notas="") => ({
        tipo:"unico",
        monto_acordado:montoAcordado,
        descuento_pct:descuento,
        promocion_id:"",
        parcialidades:[{id:newId(),numero:1,pagado:true,fecha_pago:today(),fecha_vencimiento:""}],
        notas,
      });

      if (esUnico) return mkUnico(montoBase, descAuto, formaPago);
      return mkParcialidades(montoBase, descAuto, formaPago||"");
    };

    // Actualizar campos de perfil en estudiantes ya existentes (sin tocar pagos ni asistencia)
    const parseFechaNac = dob => {
      if(!dob) return "";
      if(dob._seconds){ const d=new Date(dob._seconds*1000); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
      if(typeof dob==="string") return dob.slice(0,10);
      return "";
    };
    const existingActualizados = existing.map(e=>{
      const c = contacts.find(c=>c.id===e.id);
      if(!c) return e;
      const cf = c.customFields||[];
      return {
        ...e,
        nombre:           capNombre(c.name||((c.firstName||"")+" "+(c.lastName||"")).trim())||e.nombre,
        email:            c.email||e.email,
        telefono:         c.phone||e.telefono,
        empresa:          c._empresaNombre||c.company||c.company_name||e.empresa,
        puesto:           getCF(cf,"Bh2QzKI7oWxAlK61XJLA","contact.puesto_que_desempeas")||e.puesto,
        fecha_nacimiento: parseFechaNac(c.dateOfBirth)||e.fecha_nacimiento||"",
        csf_url:          getCSFUrl(cf)||e.csf_url,
        requiere_factura: getCF(cf,"HoscJ6RVoX90tYqlkcUb","contact.requiere_factura")||e.requiere_factura,
      };
    });

    const toAdd = contacts.filter(c=>selected.includes(c.id)&&!existIds.has(c.id)).map(c=>{
      const cf = c.customFields||[];
      const monto = c.monetaryValue||c.opportunityValue||0;
      const formaPago = getCF(cf,"XXeCwvn51VnMm3KvsAhP","contact.forma_de_pago");
      return {
        id:               c.id,
        nombre:           capNombre(c.name||((c.firstName||"")+" "+(c.lastName||"")).trim()),
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
        forma_pago_crm:   formaPago,
        csf_url:          getCSFUrl(cf),
        // Datos de facturación
        razon_social:     getCF(cf,"B6l0MNkKieWhjPDz2gMh",""),
        rfc:              getCF(cf,"hEKbt51uzqPB8ez9ki2A",""),
        regimen_fiscal:   getCF(cf,"oAiywzoDXOWIxMxEds9U",""),
        codigo_postal:    getCF(cf,"e701ZWcGAglx6e3a6SxM",""),
        calle:            getCF(cf,"o423Wvz3JjA75uoRsaVP",""),
        num_exterior:     getCF(cf,"WZYcsv0nXVzSCnLW3Gnm",""),
        num_interior:     getCF(cf,"Wkyep2V8nyZgSBOVHleN",""),
        colonia:          getCF(cf,"iiZZIDhmphq0yi2coay8",""),
        ciudad:           getCF(cf,"LfGaSXNIdKDaUeOMQYeT",""),
        estado:           getCF(cf,"Pno7iCF7nVNCVnIxqO3z",""),
        uso_cfdi:         getCF(cf,"eocaFnqmQ4qHD60KYjry",""),
        fecha_nacimiento: parseFechaNac(c.dateOfBirth),
        estatus:          "activo",
        asistencia:       {},
        campos_extra:     {},
        monto_ghl:        monto,
        pago:             buildPago(monto, prog.parcialidadesDefault, formaPago, prog.precioLista||0),
      };
    });
    onImport([...existingActualizados,...toAdd]);
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
          {!hasApi&&<div style={{marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",fontSize:13,color:"#92400e",fontFamily:"system-ui"}}>Modo demostración — configura las credenciales en ⚙️ Configuración para conectar tu cuenta real.</div>}
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
                <strong>Pago asignado automáticamente:</strong> la forma de pago (único o parcialidades) y el monto se toman directamente del CRM al importar.
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
        if (!mod.fechaInicio&&!(mod.fechasClase&&mod.fechasClase.length)) return;
        // Usar fechasClase confirmadas si existen, si no recalcular desde el rango
        const fechas = getFechasMod(mod);
        fechas.forEach(f=>{
          const [ay,am,ad] = f.split("-").map(Number);
          const da = DIAS_S[(new Date(f+"T12:00:00").getDay()+6)%7];
          if((fa==null||ay===fa)&&(fm==null||am-1===fm)&&(fd==null||ad===fd))
            evs.push({dia:ad,mes:am-1,anio:ay,prog,mod});
        });
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
          <span>{e.prog.nombre}</span>{e.prog.generacion&&<span style={{background:"#f3f4f6",borderRadius:4,padding:"1px 6px",fontSize:11,fontWeight:600,color:"#374151"}}>{e.prog.generacion}</span>}{e.mod.horario&&<span>{e.mod.horario}</span>}{e.mod.docente&&<span>{e.mod.docente}</span>}
          <span style={{background:e.mod.estatus==="confirmado"?"#f0fdf4":"#fffbeb",color:e.mod.estatus==="confirmado"?"#16a34a":"#d97706",border:"1px solid "+(e.mod.estatus==="confirmado"?"#bbf7d0":"#fde68a"),borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:700}}>{e.mod.estatus==="confirmado"?"Confirmado":"Propuesta"}</span>
        </div>
      </div>
    </div>
  );

  const RenderDia = () => {
    const evs=getEvts(mes,anio,dia), isT=dia===TD&&mes===TM&&anio===TY;
    const iso=anio+"-"+String(mes+1).padStart(2,"0")+"-"+String(dia).padStart(2,"0");
    const fest=isFestivo(iso);
    return(
      <div style={{...S.card,padding:24}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <div style={{width:48,height:48,borderRadius:12,background:fest?"#fef3c7":isT?RED:"#f3f4f6",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <span style={{fontSize:20,fontWeight:800,color:fest?"#92400e":isT?"#fff":"#1a1a1a",fontFamily:"system-ui",lineHeight:1}}>{dia}</span>
            <span style={{fontSize:9,color:fest?"#b45309":isT?"rgba(255,255,255,0.8)":"#9ca3af",fontFamily:"system-ui"}}>{DIAS_S[(new Date(anio,mes,dia).getDay()+6)%7]}</span>
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{dia+" de "+MESES_L[mes]+" de "+anio}</div>
            {fest&&<div style={{fontSize:12,fontWeight:600,color:"#d97706",fontFamily:"system-ui",marginBottom:2}}>🇲🇽 {fest} — Día inhábil</div>}
            <div style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>{evs.length} clases</div>
          </div>
        </div>
        {evs.length===0?<div style={{textAlign:"center",color:"#9ca3af",padding:"32px 0",fontFamily:"system-ui"}}>{fest?"Día festivo — no hay clases.":"Sin clases este día."}</div>:evs.map((e,i)=><EvCard key={i} e={e}/>)}
      </div>
    );
  };

  const RenderSemana = () => {
    const ini=iniSem(), dSem=Array.from({length:7}).map((_,i)=>{const d=new Date(ini);d.setDate(ini.getDate()+i);return d;});
    return(
      <div style={{...S.card,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid #e5e7eb"}}>
          {dSem.map((d,i)=>{
            const isT=d.getDate()===TD&&d.getMonth()===TM&&d.getFullYear()===TY;
            const iso=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
            const fest=isFestivo(iso);
            return(
            <div key={i} style={{padding:"10px 8px",textAlign:"center",background:fest?"#fef3c7":isT?"#fef2f2":"#fff",borderRight:i<6?"1px solid #f3f4f6":"none"}}>
              <div style={{fontSize:11,fontWeight:700,color:fest?"#b45309":"#6b7280",fontFamily:"system-ui",marginBottom:4}}>{DIAS_S[i]}</div>
              <div style={{width:28,height:28,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}>
                <span style={{fontSize:14,fontWeight:isT?700:400,color:isT?"#fff":fest?"#92400e":"#1a1a1a",fontFamily:"system-ui"}}>{d.getDate()}</span>
              </div>
              {fest&&<div style={{fontSize:9,color:"#d97706",fontFamily:"system-ui",marginTop:3,lineHeight:1.2,fontWeight:600}}>{fest}</div>}
            </div>
          );})}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
          {dSem.map((d,i)=>{
            const evs=getEvts(d.getMonth(),d.getFullYear(),d.getDate());
            const iso=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
            const fest=isFestivo(iso);
            return(
            <div key={i} style={{minHeight:120,padding:"8px 6px",borderRight:i<6?"1px solid #f3f4f6":"none",background:fest?"#fffbeb":"#fff"}}>
              {fest&&<div style={{fontSize:9,color:"#d97706",fontFamily:"system-ui",fontWeight:700,marginBottom:4,padding:"2px 4px",background:"#fef3c7",borderRadius:3}}>🇲🇽 Festivo</div>}
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
              const iso=valid?anio+"-"+String(mes+1).padStart(2,"0")+"-"+String(d).padStart(2,"0"):null;
              const fest=iso?isFestivo(iso):null;
              return(
                <div key={i} onClick={()=>valid&&setSelDia(isSel?null:d)} style={{minHeight:88,padding:"6px 8px",borderRight:(i+1)%7!==0?"1px solid #f3f4f6":"none",borderBottom:i<tot-7?"1px solid #f3f4f6":"none",background:isSel?"#fef2f2":fest?"#fef3c7":isT?"#fffbeb":"#fff",cursor:valid?"pointer":"default"}}>
                  {valid&&<>
                    <div style={{width:24,height:24,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:2}}>
                      <span style={{fontSize:12,fontWeight:isT?800:400,color:isT?"#fff":fest?"#92400e":"#374151",fontFamily:"system-ui"}}>{d}</span>
                    </div>
                    {fest&&<div style={{fontSize:9,color:"#d97706",fontFamily:"system-ui",fontWeight:700,marginBottom:3,lineHeight:1.2}}>🇲🇽 {fest}</div>}
                    {ev.slice(0,2).map((e,j)=><div key={j} style={{background:e.prog.color,color:"#fff",borderRadius:3,padding:"2px 5px",fontSize:10,fontFamily:"system-ui",fontWeight:600,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.mod.numero+" · "+e.mod.nombre.split(" ").slice(0,2).join(" ")}</div>)}
                    {ev.length>2&&<div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui"}}>+{ev.length-2} más</div>}
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
                    const iso=valid?anio+"-"+String(m+1).padStart(2,"0")+"-"+String(d).padStart(2,"0"):null;
                    const fest=iso?isFestivo(iso):null;
                    return(
                      <div key={i} style={{height:18,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {valid&&<div style={{width:16,height:16,borderRadius:"50%",background:isT?RED:fest?"#fde68a":"transparent",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                          <span style={{fontSize:9,color:isT?"#fff":fest?"#92400e":"#374151",fontFamily:"system-ui"}}>{d}</span>
                          {hEv&&!isT&&!fest&&<div style={{position:"absolute",bottom:-2,left:"50%",transform:"translateX(-50%)",display:"flex",gap:1}}>{cols.slice(0,3).map((c,ci)=><div key={ci} style={{width:3,height:3,borderRadius:"50%",background:c}}/>)}</div>}
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
      {/* Leyenda festivos del mes visible */}
      {(()=>{
        const mesV=modo==="anio"?null:mes, anioV=anio;
        const festMes=[];
        if(mesV!==null){
          const uD=new Date(anioV,mesV+1,0);
          for(let d=1;d<=uD.getDate();d++){
            const iso=anioV+"-"+String(mesV+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
            const f=isFestivo(iso);
            if(f)festMes.push({d,nombre:f,iso});
          }
        }
        if(!festMes.length)return null;
        return(
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
            {festMes.map(f=>(
              <div key={f.iso} style={{display:"flex",alignItems:"center",gap:6,background:"#fef3c7",border:"1px solid #fde68a",borderRadius:6,padding:"4px 10px",fontSize:12,fontFamily:"system-ui"}}>
                <span>🇲🇽</span>
                <span style={{fontWeight:700,color:"#92400e"}}>{f.d} {MESES_C[mesV]}</span>
                <span style={{color:"#b45309"}}>{f.nombre}</span>
              </div>
            ))}
          </div>
        );
      })()}
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
function DocentesView({docentes,saveDocentes,programas,npsData,setCS}) {
  const [showM,setShowM]   = useState(false);
  const gradosOrden=["Licenciatura","Maestría","Doctorado"];
  const gradoMax=grados=>{for(const g of["Doctorado","Maestría","Licenciatura"])if((grados||[]).includes(g))return g;return"Licenciatura";};
  const [form,setForm]     = useState({id:"",nombre:"",telefono:"",email:"",grados:[],programas_egreso:{},categoria:"A",programasIds:[],semblanza:"",iva:16});
  const [editId,setEditId] = useState(null);
  const [busq,setBusq]     = useState("");

  const openNew = () => { setForm({id:newId(),nombre:"",telefono:"",email:"",grados:[],programas_egreso:{},categoria:"A",programasIds:[],semblanza:"",iva:16}); setEditId(null); setShowM(true); };
  const openEdit= d => { setForm({...d,programasIds:d.programasIds||[]}); setEditId(d.id); setShowM(true); };
  const saveDoc = () => {
    if(!form.nombre)return;
    // Si ya tiene campos clave, limpiar la bandera de incompleto
    const completo=!!(form.banco&&form.clabe&&form.rfc&&(form.honorariosPorHora||form.honorarios_por_hora));
    const formFinal={...form,perfil_incompleto:completo?false:(form.perfil_incompleto||false)};
    editId?saveDocentes((docentes||[]).map(d=>d.id===editId?formFinal:d)):saveDocentes([...(docentes||[]),formFinal]);
    setShowM(false);
  };
  const delDoc  = id => {
    saveDocentes((docentes||[]).filter(d=>d.id!==id));
    supa.del("docentes",id).catch(e=>console.error("Del doc:",e));
  };

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
        <div><h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Docentes</h1><p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>Catálogo de docentes de educación continua</p></div>
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
          const docGrados=doc.grados&&doc.grados.length>0?doc.grados:(doc.grado?[doc.grado]:[]);
          const gc=GRADO_C[gradoMax(docGrados)]||GRADO_C.Licenciatura;
          const cat=CATEGORIA_DOCENTE[doc.categoria||"A"];
          return(
            <div key={doc.id} style={{...S.card,borderLeft:"4px solid "+RED,padding:"18px 22px"}}>
              <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                    <span style={{fontWeight:700,fontSize:16}}>{doc.nombre}</span>
                    {docGrados.map(g=>{const c=GRADO_C[g]||GRADO_C.Licenciatura;return<span key={g} style={{background:c.bg,color:c.color,borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"system-ui",fontWeight:700}}>{g}</span>;})}
                    <span style={{background:cat.bg,color:cat.color,borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"system-ui",fontWeight:700}}>{cat.label} · {fmtMXN(cat.tarifa)}/hr</span>
                    {(doc.perfil_incompleto||!doc.banco||!doc.clabe||!doc.rfc||!(doc.honorariosPorHora||doc.honorarios_por_hora))&&(
                      <span style={{background:"#fffbeb",color:"#d97706",borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"system-ui",fontWeight:700,border:"1px solid #fde68a"}}>Perfil incompleto</span>
                    )}
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
                  {doc.semblanza&&(
                    <div style={{marginTop:10,padding:"10px 14px",background:"#f9f9f9",borderRadius:6,border:"1px solid #e5e7eb"}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:4}}>SEMBLANZA</div>
                      <p style={{fontSize:13,color:"#374151",fontFamily:"system-ui",lineHeight:1.6,margin:0}}>{doc.semblanza}</p>
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
                  {/* EVALUACIONES NPS — resumen en tarjeta, detalle en sección Evaluaciones */}
                  {(()=>{
                    const evals=(npsData||[]).filter(e=>e.docenteId===doc.id||e.docenteNombre===doc.nombre);
                    if(!evals.length)return null;
                    const prom=evals.length?Math.round(evals.reduce((a,e)=>a+(e.promedio||0),0)/evals.length*10)/10:0;
                    const cp=prom>=4?"#16a34a":prom>=3?"#d97706":"#dc2626";
                    const dimLabels=["Expect.","Relevancia","Aplicación","Didáctica","Dominio"];
                    return(
                      <div style={{marginTop:12,padding:"10px 14px",background:"#f9f9f9",borderRadius:6,border:"1px solid #e5e7eb",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#9ca3af",fontFamily:"system-ui",fontWeight:700,marginBottom:2}}>EVALUACIONES</div>
                            <div style={{fontSize:22,fontWeight:800,color:cp,fontFamily:"system-ui",lineHeight:1}}>{prom}<span style={{fontSize:11,color:"#9ca3af"}}>/5</span></div>
                            <div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui"}}>{evals.length} módulo{evals.length!==1?"s":""}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:10,flexWrap:"wrap",flex:1}}>
                          {dimLabels.map((l,i)=>{
                            const key="q"+(i+1);
                            const dim=evals.length?Math.round(evals.reduce((a,e)=>a+(e[key]||0),0)/evals.length*10)/10:0;
                            const cd=dim>=4?"#16a34a":dim>=3?"#d97706":"#dc2626";
                            return(
                              <div key={key} style={{textAlign:"center"}}>
                                <div style={{fontSize:9,color:"#9ca3af",fontFamily:"system-ui",marginBottom:1}}>{l.toUpperCase()}</div>
                                <div style={{fontSize:14,fontWeight:800,color:cd,fontFamily:"system-ui"}}>{dim}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
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
                <label style={S.lbl}>Grado académico <span style={{color:"#9ca3af",fontWeight:400}}>(selecciona uno o más)</span></label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                  {gradosOrden.map(g=>{const gc=GRADO_C[g];const sel=(form.grados||[]).includes(g);return(
                    <button key={g} onClick={()=>{const ya=(form.grados||[]).includes(g);const nuevos=ya?(form.grados||[]).filter(x=>x!==g):[...(form.grados||[]),g];const pe={...form.programas_egreso};if(ya)delete pe[g];setForm({...form,grados:nuevos,programas_egreso:pe});}}
                      style={{border:"2px solid "+(sel?gc.color:"#e5e7eb"),borderRadius:6,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",background:sel?gc.bg:"#fff",color:sel?gc.color:"#9ca3af"}}>{g}</button>
                  );})}
                </div>
                {gradosOrden.filter(g=>(form.grados||[]).includes(g)).map(g=>(
                  <div key={g} style={{marginBottom:8}}>
                    <input value={(form.programas_egreso||{})[g]||""} onChange={e=>setForm({...form,programas_egreso:{...form.programas_egreso,[g]:e.target.value}})}
                      placeholder={"Programa de "+g.toLowerCase()+" — ej: Ingeniería en Sistemas"}
                      style={S.inp}/>
                  </div>
                ))}
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
                <label style={S.lbl}>IVA que aplica</label>
                <div style={{display:"flex",gap:8}}>
                  {[{v:16,l:"16% — General"},{v:8,l:"8% — Frontera"}].map(({v,l})=>(
                    <button key={v} onClick={()=>setForm({...form,iva:v})}
                      style={{flex:1,border:"2px solid "+((form.iva||16)===v?"#2563eb":"#e5e7eb"),borderRadius:8,padding:"10px 14px",cursor:"pointer",fontFamily:"system-ui",background:(form.iva||16)===v?"#eff6ff":"#fff",textAlign:"left"}}>
                      <div style={{fontWeight:700,fontSize:13,color:(form.iva||16)===v?"#2563eb":"#1a1a1a"}}>{l}</div>
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
function AsistenciaGlobal({programas, generarLink, linkCopiado, onToggleAsist, onRegEval, onEnviarEval}) {
  const [selProgId, setSelProgId] = useState(null);
  const [selModId,  setSelModId]  = useState(null);
  const [busqAsist, setBusqAsist] = useState("");
  const hoy = today();

  const prog = selProgId ? (programas||[]).find(p=>p.id===selProgId) : null;

  // ── Lista de programas / búsqueda global ───────────────
  if (!selProgId) return (
    <div>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Asistencia</h1>
        <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>
          {busqAsist?"Resultados de búsqueda":"Selecciona un programa o busca un estudiante directamente"}
        </p>
      </div>

      {/* Buscador global */}
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        <input
          value={busqAsist}
          onChange={e=>setBusqAsist(e.target.value)}
          placeholder="Buscar estudiante por nombre, correo o teléfono..."
          style={{...S.inp,flex:1,fontSize:14}}
          autoComplete="off"
          autoFocus
        />
        {busqAsist&&<button onClick={()=>setBusqAsist("")} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
      </div>

      {/* MODO BÚSQUEDA — resultados globales */}
      {busqAsist.length>=2&&(()=>{
        const ql=busqAsist.toLowerCase().trim();
        const resultados=[];
        (programas||[]).forEach(prog=>{
          ests(prog).filter(e=>e.estatus!=="baja").forEach(est=>{
            if(
              est.nombre?.toLowerCase().includes(ql)||
              est.email?.toLowerCase().includes(ql)||
              est.telefono?.includes(ql)||
              est.empresa?.toLowerCase().includes(ql)
            ){
              // Módulo activo hoy o el más reciente con fechas
              const modHoyE = mods(prog).find(m=>getFechasMod(m).includes(hoy));
              const modReciente = mods(prog).filter(m=>getFechasMod(m).length>0).sort((a,b)=>{
                const ua=getFechasMod(a).slice(-1)[0]||"";
                const ub=getFechasMod(b).slice(-1)[0]||"";
                return ub.localeCompare(ua);
              })[0];
              const modRef = modHoyE || modReciente;
              resultados.push({est,prog,modRef,tieneClaseHoy:!!modHoyE});
            }
          });
        });
        if(!resultados.length) return(
          <div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>
            Sin resultados para "<strong>{busqAsist}</strong>"
          </div>
        );
        return(
          <div>
            <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",marginBottom:12}}>
              {resultados.length} estudiante{resultados.length!==1?"s":""} encontrado{resultados.length!==1?"s":""}
            </div>
            <div style={{display:"grid",gap:8}}>
              {resultados.map(({est,prog,modRef,tieneClaseHoy},idx)=>{
                const pctGlobal = calcPct(est, mods(prog));
                const presenteAhora = modRef && getFechasMod(modRef).includes(hoy)
                  ? (Array.isArray(est.asistencia?.["mod_"+modRef.id])
                      ? est.asistencia["mod_"+modRef.id].includes(hoy)
                      : false)
                  : null;
                return(
                  <div key={idx} style={{...S.card,padding:"14px 18px",borderLeft:"4px solid "+prog.color,
                    border:"1px solid "+(tieneClaseHoy?"#bbf7d0":"#e5e7eb"),
                    borderLeft:"4px solid "+prog.color}}>
                    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:180}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,fontSize:14}}>{est.nombre}</span>
                          {tieneClaseHoy&&<span style={{fontSize:10,background:"#f0fdf4",color:"#16a34a",borderRadius:4,padding:"2px 7px",fontWeight:700,fontFamily:"system-ui"}}>Clase hoy</span>}
                        </div>
                        <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",display:"flex",gap:8,flexWrap:"wrap"}}>
                          <span style={{color:prog.color,fontWeight:600}}>{prog.nombre}</span>
                          {est.empresa&&<span>· {est.empresa}</span>}
                          {est.email&&<span>· {est.email}</span>}
                        </div>
                        {modRef&&(
                          <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui",marginTop:4}}>
                            Módulo {modRef.numero}: {modRef.nombre}
                            {modRef.horario&&<span style={{marginLeft:6}}>· {modRef.horario}</span>}
                          </div>
                        )}
                      </div>
                      {/* % asistencia global */}
                      {pctGlobal!==null&&(
                        <div style={{textAlign:"center",flexShrink:0}}>
                          <div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui",marginBottom:2}}>ASISTENCIA</div>
                          <div style={{fontSize:22,fontWeight:800,color:pctGlobal>=80?"#16a34a":"#dc2626",fontFamily:"system-ui"}}>{pctGlobal}%</div>
                        </div>
                      )}
                      {/* Toggle asistencia HOY si hay clase */}
                      {tieneClaseHoy&&modRef&&(
                        <button
                          onClick={()=>onToggleAsist(prog.id,modRef.id,est.id,hoy)}
                          style={{...S.btn(presenteAhora?"#16a34a":"#f3f4f6",presenteAhora?"#fff":"#374151",{
                            padding:"10px 18px",fontSize:13,flexShrink:0,
                            border:"2px solid "+(presenteAhora?"#16a34a":"#e5e7eb"),
                            minWidth:110
                          })}}>
                          {presenteAhora?"✓ Presente":"Marcar presente"}
                        </button>
                      )}
                      {/* Botón ir al módulo */}
                      <button
                        onClick={()=>{setSelProgId(prog.id);setSelModId(modRef?.id||null);setBusqAsist("");}}
                        style={S.btn("#f3f4f6","#374151",{padding:"8px 14px",fontSize:12,flexShrink:0})}>
                        Ver módulo →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* MODO NORMAL — lista de programas */}
      {busqAsist.length<2&&(
        <div style={{display:"grid",gap:10}}>
          {busqAsist.length===1&&<div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",marginBottom:4}}>Escribe al menos 2 caracteres para buscar</div>}
          {(programas||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:60,fontFamily:"system-ui"}}>Sin programas registrados.</div>}
          {(programas||[]).map(p=>{
            const totalEst=ests(p).length;
            const modHoy=mods(p).find(m=>getFechasMod(m).includes(hoy));
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
      )}
    </div>
  );

  // ── Detalle del programa: todos los módulos y sesiones ──
  const modulos = mods(prog);
  const estudiantes = ests(prog);

  const getFechas = getFechasMod;

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
    return Math.min(100, Math.round(asist/total*100));
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
              <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>{modulos.length} módulos · {estudiantes.length} estudiantes</p>
            </div>
          </div>
          <div style={{display:"grid",gap:10}}>
            {modulos.map(mod=>{
              const fechas = getFechas(mod);
              const sesionHoy = fechas.includes(hoy);
              const numHoy = fechas.indexOf(hoy)+1;
              const presHoy = sesionHoy ? estudiantes.filter(e=>presenteEnFecha(e,mod.id,hoy)).length : null;
              const progGrupal = fechas.length>0
                ? Math.min(100, Math.round(estudiantes.reduce((a,e)=>{const v=e.asistencia&&e.asistencia["mod_"+mod.id];return a+(Array.isArray(v)?v.length:(v||0));},0)/(fechas.length*estudiantes.length||1)*100))
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
        const ql = busqAsist.toLowerCase().trim();
        const activosFiltrados = (ql
          ? activos.filter(e=>
              e.nombre?.toLowerCase().includes(ql)||
              e.email?.toLowerCase().includes(ql)||
              e.telefono?.includes(ql)||
              e.empresa?.toLowerCase().includes(ql)
            )
          : activos).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||"","es"));
        return(
          <div>
            <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
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
              <button onClick={()=>onEnviarEval&&onEnviarEval(prog.id,modActivo.id)}
                style={S.btn("#f5f3ff","#7c3aed",{fontSize:12,padding:"6px 14px",border:"1px solid #ddd6fe"})}>
                ✉ Enviar evaluación
              </button>
              <button onClick={()=>onRegEval&&onRegEval({prog,mod:modActivo})}
                style={S.btn("#eff6ff","#2563eb",{fontSize:12,padding:"6px 14px",border:"1px solid #bfdbfe"})}>
                Registrar respuestas
              </button>
            </div>

            {/* Buscador de estudiante */}
            <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center"}}>
              <input
                value={busqAsist}
                onChange={e=>setBusqAsist(e.target.value)}
                placeholder="Buscar estudiante por nombre, correo, teléfono o empresa..."
                style={{...S.inp,flex:1,fontSize:13}}
                autoComplete="off"
              />
              {busqAsist&&(
                <button onClick={()=>setBusqAsist("")} style={S.btn("#f3f4f6","#374151",{padding:"8px 12px",fontSize:12})}>
                  Limpiar
                </button>
              )}
              {busqAsist&&(
                <span style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",whiteSpace:"nowrap"}}>
                  {activosFiltrados.length} de {activos.length}
                </span>
              )}
            </div>

            {fechas.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin sesiones programadas. Configura las fechas de clase en el módulo.</div>}

            {fechas.length>0&&activosFiltrados.length===0&&busqAsist&&(
              <div style={{...S.card,padding:32,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>
                Sin resultados para "<strong>{busqAsist}</strong>"
              </div>
            )}

            {fechas.length>0&&(activosFiltrados.length>0||!busqAsist)&&(
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
                      {activosFiltrados.map((e,ri)=>{
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
                                    onClick={()=>onToggleAsist(prog.id,modActivo.id,e.id,f)}
                                    style={{width:32,height:32,borderRadius:6,border:"none",cursor:"pointer",
                                      background:pres?"#16a34a":esFutura?"#f9f9f9":fest?"#fef9c3":"#fee2e2",
                                      color:pres?"#fff":esFutura?"#d1d5db":fest?"#92400e":"#fca5a5",
                                      fontWeight:700,fontSize:14,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>
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

// ─── HONORARIOS DOCENTES ──────────────────────────────
const IBERO_LOGO="https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/698a46bb863b271f12cbe5cf.png";
const PERSONAS_DEFAULT=[
  "Nohelya Melina Martínez Escalante",
  "José Roberto Martínez Reyes",
  "Jován Misael Naranjo Vega",
];

function HonorariosView({programas,docentes,onToggle,session,setCS}) {
  const MESES_N=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const getMesOff=off=>{const d=new Date(today().substring(0,7)+"-01");d.setMonth(d.getMonth()+off);return d.toISOString().substring(0,7);};
  const mesOpts=[-2,-1,0,1,2,3,4,5].map(i=>getMesOff(i));
  const [mesSel,setMesSel]=useState(today().substring(0,7));
  const [busq,setBusq]=useState("");
  const [ordenModal,setOrdenModal]=useState(null);
  const [generando,setGenerando]=useState(null);
  const [solicitudCfg,setSolicitudCfg]=useState(null);
  const [honTab,setHonTab]=useState("honorarios"); // "honorarios" | "ordenes"
  const [listaOrdenes,setListaOrdenes]=useState([]);
  const [cargandoOrd,setCargandoOrd]=useState(false);
  const [seleccion,setSeleccion]=useState(new Set()); // modIds seleccionados

  useEffect(()=>{
    if(honTab!=="ordenes")return;
    setCargandoOrd(true);
    supa.get("ordenes_pago","?order=created_at.desc&limit=50")
      .then(data=>setListaOrdenes(data||[]))
      .catch(()=>setListaOrdenes([]))
      .finally(()=>setCargandoOrd(false));
  },[honTab]);

  const eliminarOrden=id=>{
    setCS({titulo:"Eliminar orden de pago",mensaje:"¿Estás seguro de que deseas eliminar esta orden? Si ya fue firmada se perderá el registro. Esta acción es irreversible.",onConfirm:async()=>{
      try{await supa.del("ordenes_pago",id);setListaOrdenes(prev=>prev.filter(o=>o.id!==id));}catch(e){alert("Error al eliminar la orden.");}
    }});
  };

  const abrirSolicitud=()=>setSolicitudCfg({
    solicitante:session?.nombre||PERSONAS_DEFAULT[0],
    jefe_inmediato:PERSONAS_DEFAULT[2],
    responsable:PERSONAS_DEFAULT[1],
    entidad:"0705 Educación Continua",
    programa:"0001 Gastos de Operación",
    partida:"E012 Honorarios para docentes",
  });

  const generarSolicitudMensual=async()=>{
    if(!solicitudCfg||!filtrados.length)return;
    setGenerando("mensual");
    try{
      const id=newId()+newId();
      const datos={
        tipo:"mensual",
        mes:mesSel,
        ...solicitudCfg,
        filas:filtrados.map((r,i)=>({n:i+1,docente:r.docente,programa:r.programa,generacion:r.generacion,modulo:r.modulo,categoria:r.categoria,fechaInicio:r.fechaInicio,fechaFin:r.fechaFin,horas:r.horas,subtotal:r.subtotal,ivaMonto:r.ivaMonto,total:r.total})),
        totalSubtotal,totalIVA,totalGeneral,
      };
      await supa.upsert("ordenes_pago",[{id,datos,estatus:"pendiente",created_at:new Date().toISOString()}]);
      const url=window.location.href.split("?")[0]+"?orden="+id;
      setSolicitudCfg(null);
      setOrdenModal({url,row:{docente:"Solicitud mensual",modulo:MESES_N[parseInt(mesSel.split("-")[1])-1]+" "+mesSel.split("-")[0],total:totalGeneral}});
    }catch(e){alert("Error al generar. Intenta de nuevo.");}
    setGenerando(null);
  };

  const generarOrden=async row=>{
    setGenerando(row.modId);
    try{
      const id=newId()+newId();
      await supa.upsert("ordenes_pago",[{
        id,modulo_id:row.modId,programa_id:row.progId,
        datos:row,estatus:"pendiente",created_at:new Date().toISOString(),
      }]);
      const url=window.location.href.split("?")[0]+"?orden="+id;
      setOrdenModal({url,row});
    }catch(e){alert("Error al generar la orden. Intenta de nuevo.");}
    setGenerando(null);
  };

  const generarOrdenSeleccion=async()=>{
    const filasSel=filtrados.filter(r=>seleccion.has(r.modId));
    if(!filasSel.length)return;
    setGenerando("seleccion");
    try{
      const id=newId()+newId();
      const subTotal=filasSel.reduce((a,r)=>a+r.subtotal,0);
      const ivaTotal=filasSel.reduce((a,r)=>a+r.ivaMonto,0);
      const genTotal=filasSel.reduce((a,r)=>a+r.total,0);
      const datos={
        tipo:"seleccion",
        mes:mesSel,
        solicitante:session?.nombre||PERSONAS_DEFAULT[0],
        responsable:PERSONAS_DEFAULT[1],
        jefe_inmediato:PERSONAS_DEFAULT[2],
        entidad:"0705 Educación Continua",
        programa:"0001 Gastos de Operación",
        partida:"E012 Honorarios para docentes",
        filas:filasSel.map((r,i)=>({n:i+1,docente:r.docente,programa:r.programa,generacion:r.generacion,modulo:r.modulo,categoria:r.categoria,fechaInicio:r.fechaInicio,fechaFin:r.fechaFin,horas:r.horas,subtotal:r.subtotal,ivaMonto:r.ivaMonto,total:r.total})),
        totalSubtotal:subTotal,totalIVA:ivaTotal,totalGeneral:genTotal,
      };
      await supa.upsert("ordenes_pago",[{id,datos,estatus:"pendiente",created_at:new Date().toISOString()}]);
      const url=window.location.href.split("?")[0]+"?orden="+id;
      setSeleccion(new Set());
      setOrdenModal({url,row:{docente:`${filasSel.length} docente${filasSel.length!==1?"s":""}`,modulo:fmtMes(mesSel),total:genTotal}});
    }catch(e){alert("Error al generar la orden. Intenta de nuevo.");}
    setGenerando(null);
  };
  const fmtMes=m=>{const[y,mo]=m.split("-");return MESES_N[parseInt(mo)-1]+" "+y;};

  const rows=(programas||[]).flatMap(prog=>
    mods(prog).filter(mod=>mod.docente&&mod.fechaFin&&mod.fechaFin.startsWith(mesSel)).map(mod=>{
      const doc=(docentes||[]).find(d=>d.id===mod.docenteId||d.nombre===mod.docente);
      const cat=CATEGORIA_DOCENTE[doc?.categoria||"A"];
      const horas=(mod.clases||0)*(mod.horasPorClase||0);
      const subtotal=horas*cat.tarifa;
      const ivaPct=doc?.iva||16;
      const ivaMonto=Math.round(subtotal*ivaPct/100);
      return{modId:mod.id,progId:prog.id,mod,
        docente:mod.docente,programa:prog.nombre,generacion:prog.generacion||"",
        modulo:`${mod.numero} — ${mod.nombre}`,horas,
        categoria:doc?.categoria||"A",ivaPct,
        fechaInicio:mod.fechaInicio,fechaFin:mod.fechaFin,
        subtotal,ivaMonto,total:subtotal+ivaMonto,
        factura_solicitada:mod.factura_solicitada||false,
        pago_emitido:mod.pago_emitido||false,
      };
    })
  );
  const filtrados=rows.filter(r=>!busq||r.docente.toLowerCase().includes(busq.toLowerCase())||r.programa.toLowerCase().includes(busq.toLowerCase()));
  const totalGeneral=filtrados.reduce((a,r)=>a+r.total,0);
  const totalSubtotal=filtrados.reduce((a,r)=>a+r.subtotal,0);
  const totalIVA=filtrados.reduce((a,r)=>a+r.ivaMonto,0);

  const exportCSV=()=>{
    if(!filtrados.length)return;
    const hdrs=["Docente","Programa","Generación","Módulo","Horas","Categoría","IVA %","Fecha Inicio","Fecha Fin","Subtotal","IVA $","Total"];
    const data=filtrados.map(r=>[r.docente,r.programa,r.generacion,r.modulo,r.horas,"Cat. "+r.categoria,r.ivaPct+"%",r.fechaInicio||"",r.fechaFin||"",r.subtotal,r.ivaMonto,r.total]);
    const csv=[hdrs,...data].map(row=>row.map(v=>'"'+(String(v||"")).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
    a.download=`honorarios_${mesSel}.csv`;a.click();
  };

  const enviarEmail=()=>{
    if(!filtrados.length)return;
    const mesLabel=fmtMes(mesSel);
    const lineas=filtrados.map(r=>`  • ${r.docente} | ${r.modulo} | ${r.horas}h | Cat. ${r.categoria} | IVA ${r.ivaPct}% | ${r.fechaInicio||""} – ${r.fechaFin||""} | Subtotal: $${r.subtotal.toLocaleString("es-MX")} | IVA: $${r.ivaMonto.toLocaleString("es-MX")} | Total: $${r.total.toLocaleString("es-MX")}`).join("\n");
    const body=`Reporte de Honorarios Docentes — ${mesLabel}\n\n${lineas}\n\n──────────────────────\nSubtotal: $${totalSubtotal.toLocaleString("es-MX")}\nIVA:      $${totalIVA.toLocaleString("es-MX")}\nTOTAL:    $${totalGeneral.toLocaleString("es-MX")}\n\nGenerado por el sistema IBERO Tijuana — Educación Continua`;
    const subject=`Honorarios Docentes ${mesLabel}`;
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,"_blank");
  };

  const thStyle={padding:"10px 14px",fontSize:11,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:FONT_BODY,textAlign:"left",borderBottom:"1px solid #F0F0F0",whiteSpace:"nowrap"};
  const tdStyle={padding:"12px 14px",fontSize:13,fontFamily:FONT_BODY,borderBottom:"1px solid #F9F9F9",verticalAlign:"middle"};
  const Check=({on,onClick,label})=>(
    <button onClick={onClick} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:FONT_BODY}}>
      <div style={{width:18,height:18,borderRadius:4,border:"2px solid "+(on?"#16a34a":"#D1D5DB"),background:on?"#16a34a":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        {on&&<span style={{color:"#fff",fontSize:11,fontWeight:700,lineHeight:1}}>✓</span>}
      </div>
      <span style={{fontSize:12,color:on?"#16a34a":"#9CA3AF",fontWeight:on?600:400}}>{label}</span>
    </button>
  );

  return(
    <div>
      {/* Modal configuración solicitud mensual */}
      {solicitudCfg&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto"}}>
          <div style={{background:"#fff",borderRadius:16,padding:28,maxWidth:500,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.18)"}}>
            <div style={{fontWeight:800,fontSize:17,fontFamily:FONT_TITLE,marginBottom:4}}>Configurar solicitud mensual</div>
            <div style={{fontSize:13,color:"#6B7280",fontFamily:FONT_BODY,marginBottom:20}}>{MESES_N[parseInt(mesSel.split("-")[1])-1]} {mesSel.split("-")[0]} · {filtrados.length} docente{filtrados.length!==1?"s":""}</div>
            {[
              {k:"solicitante",l:"Solicitud realizada por",opts:PERSONAS_DEFAULT},
              {k:"jefe_inmediato",l:"Autorización jefe inmediato",opts:PERSONAS_DEFAULT},
              {k:"responsable",l:"Responsable que autoriza",opts:PERSONAS_DEFAULT},
            ].map(({k,l,opts})=>(
              <div key={k} style={{marginBottom:14}}>
                <label style={S.lbl}>{l}</label>
                <select value={opts.includes(solicitudCfg[k])?solicitudCfg[k]:"__otro"} onChange={e=>setSolicitudCfg({...solicitudCfg,[k]:e.target.value==="__otro"?"":e.target.value})}
                  style={{...S.inp,marginBottom:4}}>
                  {opts.map(o=><option key={o} value={o}>{o}</option>)}
                  <option value="__otro">Otro…</option>
                </select>
                {(!opts.includes(solicitudCfg[k])||solicitudCfg[k]==="")&&(
                  <input value={solicitudCfg[k]} onChange={e=>setSolicitudCfg({...solicitudCfg,[k]:e.target.value})} placeholder="Nombre completo" style={S.inp}/>
                )}
              </div>
            ))}
            <div style={{height:1,background:"#F0F0F0",margin:"16px 0"}}/>
            <div style={{fontSize:11,fontWeight:700,color:"#9CA3AF",letterSpacing:"0.5px",marginBottom:10}}>PARTIDA PRESUPUESTAL</div>
            {[{k:"entidad",l:"Entidad"},{k:"programa",l:"Programa"},{k:"partida",l:"Partida"}].map(({k,l})=>(
              <div key={k} style={{marginBottom:10}}>
                <label style={S.lbl}>{l}</label>
                <input value={solicitudCfg[k]} onChange={e=>setSolicitudCfg({...solicitudCfg,[k]:e.target.value})} style={S.inp}/>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:20}}>
              <button onClick={()=>setSolicitudCfg(null)} style={{...S.btn("#F3F4F6","#374151",{flex:1})}}>Cancelar</button>
              <button onClick={generarSolicitudMensual} disabled={generando==="mensual"} style={{...S.btn(RED,"#fff",{flex:2,opacity:generando==="mensual"?0.6:1})}}>
                {generando==="mensual"?"Generando…":"Generar y compartir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal orden generada */}
      {ordenModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:16,padding:28,maxWidth:460,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.18)"}}>
            <div style={{fontWeight:800,fontSize:17,fontFamily:FONT_TITLE,marginBottom:4}}>Orden de pago generada</div>
            <div style={{fontSize:13,color:"#6B7280",fontFamily:FONT_BODY,marginBottom:16}}>{ordenModal.row.docente} · {ordenModal.row.modulo}</div>
            <div style={{background:"#F5F5F7",borderRadius:8,padding:"10px 14px",fontFamily:"monospace",fontSize:12,color:"#374151",wordBreak:"break-all",marginBottom:16}}>{ordenModal.url}</div>
            <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
              <button onClick={()=>{navigator.clipboard.writeText(ordenModal.url);}} style={{...S.btn("#F3F4F6","#374151",{fontSize:13,flex:1})}}>Copiar enlace</button>
              <button onClick={()=>window.open("https://wa.me/?text="+encodeURIComponent("Hola, te comparto la orden de pago para que la firmes:\n"+ordenModal.url),"_blank")}
                style={{...S.btn("#F0FDF4","#16a34a",{border:"1px solid #BBF7D0",fontSize:13,flex:1})}}>WhatsApp</button>
              <button onClick={()=>window.open("mailto:?subject="+encodeURIComponent("Orden de pago — "+ordenModal.row.docente)+"&body="+encodeURIComponent("Hola,\n\nTe comparto el enlace para firmar la orden de pago correspondiente a:\n\nDocente: "+ordenModal.row.docente+"\nMódulo: "+ordenModal.row.modulo+"\nTotal: $"+ordenModal.row.total.toLocaleString("es-MX")+"\n\nEnlace:\n"+ordenModal.url+"\n\nAtentamente,\nCoordinación de Educación Continua\nIBERO Tijuana"),"_blank")}
                style={{...S.btn("#F5F3FF","#7C3AED",{border:"1px solid #DDD6FE",fontSize:13,flex:1})}}>✉ Email</button>
            </div>
            <button onClick={()=>setOrdenModal(null)} style={{width:"100%",padding:"10px 0",border:"none",borderRadius:8,background:"#F3F4F6",color:"#374151",fontFamily:FONT_BODY,fontSize:14,fontWeight:600,cursor:"pointer"}}>Cerrar</button>
          </div>
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Honorarios Docentes</h1>
          <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>Facturación y pagos a docentes · recordatorio antes del día 20</p>
        </div>
        {honTab==="honorarios"&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {seleccion.size>0?(
              <>
                <button onClick={generarOrdenSeleccion} disabled={generando==="seleccion"}
                  style={S.btn(RED,"#fff",{opacity:generando==="seleccion"?0.6:1})}>
                  {generando==="seleccion"?"Generando…":`Generar orden (${seleccion.size} seleccionado${seleccion.size!==1?"s":""})`}
                </button>
                <button onClick={()=>setSeleccion(new Set())} style={S.btn("#F3F4F6","#374151")}>Cancelar selección</button>
              </>
            ):(
              <>
                <button onClick={abrirSolicitud} disabled={!filtrados.length} style={S.btn(RED,"#fff",{opacity:filtrados.length?1:0.5})}>Generar solicitud mensual</button>
                <button onClick={enviarEmail} style={S.btn("#F5F3FF","#7c3aed",{border:"1px solid #DDD6FE"})}>✉ Correo</button>
                <button onClick={exportCSV} style={S.btn("#F0FDF4","#16a34a",{border:"1px solid #86EFAC"})}>Exportar CSV</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Pestañas */}
      <div style={{display:"flex",...S.card,overflow:"hidden",marginBottom:20}}>
        {[["honorarios","Honorarios"],["ordenes","Órdenes de pago"]].map(([t,l])=>(
          <button key={t} onClick={()=>setHonTab(t)} style={{flex:1,padding:"12px 16px",border:"none",borderBottom:honTab===t?"3px solid "+RED:"3px solid transparent",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:FONT_BODY,background:"#fff",color:honTab===t?RED:"#6b7280"}}>
            {l}
          </button>
        ))}
      </div>

      {honTab==="honorarios"&&(<>
      {/* Selector de mes */}
      <div style={{display:"flex",gap:6,marginBottom:20,overflowX:"auto",paddingBottom:4}}>
        {mesOpts.map(m=>{
          const esActual=m===today().substring(0,7);
          const sel=m===mesSel;
          return(
            <button key={m} onClick={()=>setMesSel(m)} style={{flexShrink:0,border:"none",borderRadius:8,padding:"7px 14px",cursor:"pointer",fontSize:13,fontFamily:FONT_BODY,fontWeight:sel?700:400,background:sel?RED:"#fff",color:sel?"#fff":esActual?"#374151":"#9CA3AF",outline:esActual&&!sel?"2px solid "+RED:"none",outlineOffset:"-2px"}}>
              {fmtMes(m)}{esActual?" (actual)":""}
            </button>
          );
        })}
      </div>

      {/* Buscador + resumen */}
      <div style={{display:"flex",gap:12,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <input placeholder="Buscar docente o programa..." value={busq} onChange={e=>setBusq(e.target.value)} style={{...S.inp,maxWidth:300}}/>
        <div style={{display:"flex",gap:10,marginLeft:"auto",flexWrap:"wrap"}}>
          {[["Módulos",filtrados.length,"#374151"],["Subtotal",fmtMXN(totalSubtotal),"#374151"],["IVA",fmtMXN(totalIVA),"#6B7280"],["Total",fmtMXN(totalGeneral),RED]].map(([l,v,c])=>(
            <div key={l} style={{...S.card,padding:"10px 16px",textAlign:"right"}}>
              <div style={{fontSize:11,color:"#9CA3AF",fontFamily:FONT_BODY,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
              <div style={{fontWeight:800,fontSize:16,color:c,fontFamily:FONT_TITLE,marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabla */}
      {filtrados.length===0?(
        <div style={{...S.card,padding:48,textAlign:"center",color:"#9CA3AF",fontFamily:FONT_BODY}}>Sin docentes programados para {fmtMes(mesSel)}.</div>
      ):(
        <div style={{...S.card,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
              <thead>
                <tr style={{background:"#FAFAFA"}}>
                  <th style={{...thStyle,width:36,textAlign:"center"}}>
                    <input type="checkbox"
                      checked={filtrados.length>0&&filtrados.every(r=>seleccion.has(r.modId))}
                      onChange={e=>{
                        if(e.target.checked) setSeleccion(new Set(filtrados.map(r=>r.modId)));
                        else setSeleccion(new Set());
                      }}
                      style={{cursor:"pointer",width:14,height:14}}/>
                  </th>
                  {["Docente","Programa","Módulo","Horas","Cat.","IVA","Inicio","Fin","Subtotal","IVA $","Total","Factura solicitada","Pago emitido","Orden de pago"].map(h=>(
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r,i)=>(
                  <tr key={r.modId} style={{background:seleccion.has(r.modId)?"#FFF5F5":i%2===0?"#fff":"#FAFAFA"}}>
                    <td style={{...tdStyle,textAlign:"center"}}>
                      <input type="checkbox" checked={seleccion.has(r.modId)}
                        onChange={e=>{const s=new Set(seleccion);e.target.checked?s.add(r.modId):s.delete(r.modId);setSeleccion(s);}}
                        style={{cursor:"pointer",width:14,height:14}}/>
                    </td>
                    <td style={tdStyle}><div style={{fontWeight:600,color:"#111"}}>{r.docente}</div></td>
                    <td style={tdStyle}><div style={{fontSize:12,color:"#374151"}}>{r.programa}</div>{r.generacion&&<div style={{fontSize:11,color:"#9CA3AF"}}>{r.generacion}</div>}</td>
                    <td style={tdStyle}><div style={{fontSize:12,color:"#374151"}}>{r.modulo}</div></td>
                    <td style={{...tdStyle,textAlign:"center"}}><span style={{fontWeight:700,color:"#374151"}}>{r.horas}h</span></td>
                    <td style={{...tdStyle,textAlign:"center"}}>
                      <span style={{background:CATEGORIA_DOCENTE[r.categoria]?.bg,color:CATEGORIA_DOCENTE[r.categoria]?.color,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,fontFamily:FONT_BODY}}>Cat. {r.categoria}</span>
                    </td>
                    <td style={{...tdStyle,textAlign:"center"}}><span style={{fontSize:12,color:"#6B7280"}}>{r.ivaPct}%</span></td>
                    <td style={{...tdStyle,fontSize:12,color:"#6B7280"}}>{fmtFecha(r.fechaInicio)}</td>
                    <td style={{...tdStyle,fontSize:12,color:"#6B7280"}}>{fmtFecha(r.fechaFin)}</td>
                    <td style={{...tdStyle,textAlign:"right"}}><span style={{fontSize:13,color:"#374151"}}>{fmtMXN(r.subtotal)}</span></td>
                    <td style={{...tdStyle,textAlign:"right"}}><span style={{fontSize:12,color:"#9CA3AF"}}>{fmtMXN(r.ivaMonto)}</span></td>
                    <td style={{...tdStyle,textAlign:"right"}}><span style={{fontWeight:700,color:RED,fontSize:14}}>{fmtMXN(r.total)}</span></td>
                    <td style={{...tdStyle,textAlign:"center"}}><Check on={r.factura_solicitada} onClick={()=>onToggle(r.progId,r.modId,"factura_solicitada")} label={r.factura_solicitada?"Sí":"—"}/></td>
                    <td style={{...tdStyle,textAlign:"center"}}><Check on={r.pago_emitido} onClick={()=>onToggle(r.progId,r.modId,"pago_emitido")} label={r.pago_emitido?"Sí":"—"}/></td>
                    <td style={{...tdStyle,textAlign:"center"}}>
                      <button onClick={()=>generarOrden(r)} disabled={generando===r.modId}
                        style={{fontSize:11,padding:"5px 10px",border:"1px solid #BFDBFE",borderRadius:6,background:"#EFF6FF",color:"#2563EB",cursor:"pointer",fontFamily:FONT_BODY,fontWeight:600,whiteSpace:"nowrap",opacity:generando===r.modId?0.6:1}}>
                        {generando===r.modId?"Generando…":"Generar orden"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:"#F7F7F8",borderTop:"2px solid #EBEBEB"}}>
                  <td colSpan={8} style={{...tdStyle,fontWeight:700,color:"#374151"}}>Total {fmtMes(mesSel)}</td>
                  <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{fmtMXN(totalSubtotal)}</td>
                  <td style={{...tdStyle,textAlign:"right",fontWeight:700,color:"#6B7280"}}>{fmtMXN(totalIVA)}</td>
                  <td style={{...tdStyle,textAlign:"right",fontWeight:800,color:RED,fontSize:15}}>{fmtMXN(totalGeneral)}</td>
                  <td colSpan={3} style={tdStyle}/>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      </>)}

      {honTab==="ordenes"&&(
        <div>
          {cargandoOrd?(
            <div style={{...S.card,padding:48,textAlign:"center",color:"#9CA3AF",fontFamily:FONT_BODY}}>Cargando órdenes…</div>
          ):listaOrdenes.length===0?(
            <div style={{...S.card,padding:48,textAlign:"center",color:"#9CA3AF",fontFamily:FONT_BODY}}>
              <div style={{fontSize:32,marginBottom:12}}>📋</div>
              <div style={{fontWeight:600,marginBottom:6}}>Sin órdenes generadas</div>
              <div style={{fontSize:13}}>Genera una orden desde la pestaña de Honorarios.</div>
            </div>
          ):(
            <div style={{...S.card,overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:700}}>
                  <thead>
                    <tr style={{background:"#FAFAFA"}}>
                      {["Tipo / Mes","Docente o Solicitud","Total","Estado","Fecha","Acciones",""].map(h=>(
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listaOrdenes.map((o,i)=>{
                      const d=o.datos||{};
                      const esMens=d.tipo==="mensual"||d.tipo==="seleccion";
                      const firmas=(o.firma_solicitante?1:0)+(o.firma_responsable?1:0);
                      const estLabel=o.estatus==="firmada"?"Firmada":firmas===1?"1 de 2 firmas":"Pendiente";
                      const estColor=o.estatus==="firmada"?"#16a34a":firmas===1?"#d97706":"#9CA3AF";
                      const estBg=o.estatus==="firmada"?"#F0FDF4":firmas===1?"#FFFBEB":"#F9FAFB";
                      const url=window.location.href.split("?")[0]+"?orden="+o.id;
                      const fechaStr=o.created_at?new Date(o.created_at).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"—";
                      return(
                        <tr key={o.id} style={{background:i%2===0?"#fff":"#FAFAFA"}}>
                          <td style={tdStyle}>
                            <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:4,background:esMens?"#FFF5F5":"#EFF6FF",color:esMens?RED:"#2563EB"}}>
                              {d.tipo==="seleccion"?"Selección manual":d.tipo==="mensual"?"Solicitud mensual":"Orden individual"}
                            </span>
                            {esMens&&d.mes&&<div style={{fontSize:11,color:"#9CA3AF",marginTop:4}}>{["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][parseInt(d.mes.split("-")[1])-1]} {d.mes.split("-")[0]}</div>}
                          </td>
                          <td style={tdStyle}>
                            <div style={{fontWeight:600,color:"#111",fontSize:13}}>{esMens?(d.solicitante||"Solicitud mensual"):d.docente}</div>
                            {!esMens&&<div style={{fontSize:11,color:"#6B7280",marginTop:2}}>{d.modulo}</div>}
                            {esMens&&<div style={{fontSize:11,color:"#6B7280",marginTop:2}}>{(d.filas||[]).length} docente{(d.filas||[]).length!==1?"s":""}</div>}
                          </td>
                          <td style={{...tdStyle,textAlign:"right"}}>
                            <span style={{fontWeight:700,color:RED,fontSize:14}}>{fmtMXN(esMens?d.totalGeneral:d.total)}</span>
                            {esMens&&d.totalIVA>0&&<div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>IVA {fmtMXN(d.totalIVA)}</div>}
                          </td>
                          <td style={{...tdStyle,textAlign:"center"}}>
                            <span style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,background:estBg,color:estColor}}>{estLabel}</span>
                          </td>
                          <td style={{...tdStyle,fontSize:12,color:"#6B7280",whiteSpace:"nowrap"}}>{fechaStr}</td>
                          <td style={{...tdStyle,textAlign:"center"}}>
                            <button onClick={()=>window.open(url,"_blank")}
                              style={{fontSize:11,padding:"5px 12px",border:"1px solid #BFDBFE",borderRadius:6,background:"#EFF6FF",color:"#2563EB",cursor:"pointer",fontFamily:FONT_BODY,fontWeight:600,whiteSpace:"nowrap"}}>
                              {o.estatus==="firmada"?"Descargar PDF":"Abrir orden"}
                            </button>
                          </td>
                          <td style={{...tdStyle,textAlign:"center"}}>
                            <button onClick={()=>eliminarOrden(o.id)}
                              style={{fontSize:11,padding:"5px 10px",border:"1px solid #FECACA",borderRadius:6,background:"#FFF5F5",color:"#DC2626",cursor:"pointer",fontFamily:FONT_BODY,fontWeight:600,whiteSpace:"nowrap"}}>
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ORDEN DE PAGO (vista pública) ───────────────────
function FiscalFormPage() {
  const token = new URLSearchParams(window.location.search).get("fiscal");
  const [est,setEst]         = useState(null);
  const [cargando,setCargando] = useState(true);
  const [enviado,setEnviado]   = useState(false);
  const [err,setErr]           = useState("");
  const [form,setForm]         = useState({
    rfc:"",razon_social:"",regimen_fiscal:"",uso_cfdi:"",
    calle:"",num_exterior:"",num_interior:"",colonia:"",
    ciudad:"",estado:"",codigo_postal:"",csf_url:""
  });

  useEffect(()=>{
    if(!token){setErr("Enlace inválido.");setCargando(false);return;}
    supa.get("estudiantes","?fiscal_token=eq."+token).then(data=>{
      if(data&&data.length>0){
        const e=data[0];
        setEst(e);
        setForm({
          rfc:e.rfc||"",razon_social:e.razon_social||"",
          regimen_fiscal:e.regimen_fiscal||"",uso_cfdi:e.uso_cfdi||"",
          calle:e.calle||"",num_exterior:e.num_exterior||"",
          num_interior:e.num_interior||"",colonia:e.colonia||"",
          ciudad:e.ciudad||"",estado:e.estado||"",
          codigo_postal:e.codigo_postal||"",csf_url:e.csf_url||""
        });
      } else { setErr("Enlace no encontrado o ya utilizado."); }
      setCargando(false);
    }).catch(()=>{setErr("Error al cargar. Intenta de nuevo.");setCargando(false);});
  },[]);

  const guardar=async()=>{
    if(!form.rfc||!form.razon_social){alert("RFC y Razón social son obligatorios.");return;}
    const ok=await supa.upsert("estudiantes",[{...est,...form,fiscal_completado:true}]);
    if(ok) setEnviado(true);
    else alert("Error al guardar. Intenta de nuevo.");
  };

  const inp={width:"100%",boxSizing:"border-box",border:"1px solid #e5e7eb",borderRadius:8,padding:"10px 14px",fontSize:14,fontFamily:"system-ui",outline:"none",marginTop:4};
  const lbl={fontSize:11,fontWeight:700,color:"#6b7280",fontFamily:"system-ui",letterSpacing:"0.5px",textTransform:"uppercase"};

  if(cargando) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"system-ui",color:"#9ca3af"}}>Cargando…</div>;
  if(err)      return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:"system-ui",color:"#dc2626",fontSize:16,textAlign:"center",padding:24}}>{err}</div>;

  if(enviado) return(
    <div style={{minHeight:"100vh",background:"#F5F5F7",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:16,padding:"40px 32px",maxWidth:440,width:"100%",textAlign:"center",boxShadow:"0 4px 32px rgba(0,0,0,0.10)"}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:"#f0fdf4",border:"3px solid #16a34a",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:28}}>✓</div>
        <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:22,marginBottom:8}}>¡Datos recibidos!</div>
        <p style={{fontFamily:"system-ui",fontSize:14,color:"#6b7280",lineHeight:1.6}}>Tus datos fiscales han sido guardados correctamente. El equipo de Educación Continua IBERO Tijuana los procesará a la brevedad.</p>
        <img src={IBERO_LOGO} alt="IBERO Tijuana" style={{height:40,marginTop:24,opacity:0.6}} onError={e=>e.target.style.display="none"}/>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:"#F5F5F7",padding:"32px 16px",fontFamily:"system-ui"}}>
      <div style={{maxWidth:560,margin:"0 auto"}}>
        {/* Header */}
        <div style={{background:"#fff",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 32px rgba(0,0,0,0.10)",marginBottom:16}}>
          <div style={{background:"#eb1d33",padding:"20px 28px",display:"flex",alignItems:"center",gap:16}}>
            <img src={IBERO_LOGO} alt="IBERO" style={{height:44,width:"auto"}} onError={e=>e.target.style.display="none"}/>
            <div>
              <div style={{color:"#fff",fontFamily:"Georgia,serif",fontWeight:700,fontSize:18}}>Datos Fiscales</div>
              <div style={{color:"rgba(255,255,255,0.8)",fontSize:12}}>Educación Continua · IBERO Tijuana</div>
            </div>
          </div>
          <div style={{padding:"20px 28px",borderBottom:"1px solid #f3f4f6"}}>
            <p style={{margin:0,fontSize:14,color:"#374151",lineHeight:1.6}}>
              Hola <strong>{est?.nombre}</strong>, por favor completa tus datos fiscales para emitir tu factura correctamente.
            </p>
          </div>
        </div>

        {/* Formulario */}
        <div style={{background:"#fff",borderRadius:16,padding:"24px 28px",boxShadow:"0 4px 32px rgba(0,0,0,0.10)"}}>
          <div style={{display:"grid",gap:14}}>
            {/* RFC y Razón social */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={lbl}>RFC *</label>
                <input value={form.rfc} onChange={e=>setForm({...form,rfc:e.target.value.toUpperCase()})} placeholder="XXXX000000XX0" style={inp}/>
              </div>
              <div>
                <label style={lbl}>Régimen fiscal</label>
                <input value={form.regimen_fiscal} onChange={e=>setForm({...form,regimen_fiscal:e.target.value})} placeholder="Ej. 612 - Personas físicas" style={inp}/>
              </div>
            </div>
            <div>
              <label style={lbl}>Razón social *</label>
              <input value={form.razon_social} onChange={e=>setForm({...form,razon_social:e.target.value})} placeholder="Nombre o razón social completa" style={inp}/>
            </div>
            <div>
              <label style={lbl}>Uso del CFDI</label>
              <input value={form.uso_cfdi} onChange={e=>setForm({...form,uso_cfdi:e.target.value})} placeholder="Ej. D10 - Pagos por servicios educativos" style={inp}/>
            </div>

            <div style={{borderTop:"1px solid #f3f4f6",paddingTop:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",marginBottom:12,letterSpacing:"0.5px"}}>DOMICILIO FISCAL</div>
              <div style={{display:"grid",gap:12}}>
                <div>
                  <label style={lbl}>Calle</label>
                  <input value={form.calle} onChange={e=>setForm({...form,calle:e.target.value})} placeholder="Calle" style={inp}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  <div><label style={lbl}>No. Ext.</label><input value={form.num_exterior} onChange={e=>setForm({...form,num_exterior:e.target.value})} placeholder="Ej. 123" style={inp}/></div>
                  <div><label style={lbl}>No. Int.</label><input value={form.num_interior} onChange={e=>setForm({...form,num_interior:e.target.value})} placeholder="Ej. 4A" style={inp}/></div>
                  <div><label style={lbl}>C.P.</label><input value={form.codigo_postal} onChange={e=>setForm({...form,codigo_postal:e.target.value})} placeholder="Ej. 22000" style={inp}/></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div><label style={lbl}>Colonia</label><input value={form.colonia} onChange={e=>setForm({...form,colonia:e.target.value})} placeholder="Ej. Zona Centro" style={inp}/></div>
                  <div><label style={lbl}>Ciudad</label><input value={form.ciudad} onChange={e=>setForm({...form,ciudad:e.target.value})} placeholder="Ej. Tijuana" style={inp}/></div>
                </div>
                <div>
                  <label style={lbl}>Estado</label>
                  <input value={form.estado} onChange={e=>setForm({...form,estado:e.target.value})} placeholder="Ej. Baja California" style={inp}/>
                </div>
              </div>
            </div>

            <div style={{borderTop:"1px solid #f3f4f6",paddingTop:14}}>
              <label style={lbl}>URL de tu Constancia de Situación Fiscal (CSF)</label>
              <input value={form.csf_url} onChange={e=>setForm({...form,csf_url:e.target.value})} placeholder="https://..." style={inp}/>
              <p style={{margin:"6px 0 0",fontSize:11,color:"#9ca3af"}}>Puedes subir tu CSF a Google Drive o Dropbox y pegar el enlace aquí.</p>
            </div>

            <button onClick={guardar} style={{marginTop:8,width:"100%",background:"#eb1d33",color:"#fff",border:"none",borderRadius:10,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"Georgia,serif",letterSpacing:"-0.3px"}}>
              Guardar datos fiscales
            </button>
            <p style={{textAlign:"center",fontSize:11,color:"#9ca3af",margin:0}}>Tus datos están protegidos y solo serán utilizados para emisión de facturas.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrdenPago() {
  const ordenId = new URLSearchParams(window.location.search).get("orden");
  const [orden,setOrden]       = useState(null);
  const [cargando,setCargando] = useState(true);
  const [err,setErr]           = useState("");
  const canvasSol  = useRef(null);
  const canvasResp = useRef(null);
  const drawSol    = useRef(false);
  const drawResp   = useRef(false);

  useEffect(()=>{
    if(!ordenId){setErr("Enlace inválido.");setCargando(false);return;}
    supa.get("ordenes_pago","?id=eq."+ordenId).then(data=>{
      if(data&&data.length>0) setOrden(data[0]);
      else setErr("Orden no encontrada.");
      setCargando(false);
    }).catch(()=>{setErr("Error al cargar.");setCargando(false);});
  },[]);

  useEffect(()=>{
    const s=document.createElement("style");s.id="orden-print-css";
    s.textContent=`@media print{.no-print{display:none!important;}.orden-wrap{box-shadow:none!important;border-radius:0!important;} .orden-tabla{width:100%!important;min-width:unset!important;font-size:9px!important;} .orden-tabla th,.orden-tabla td{padding:5px 5px!important;font-size:9px!important;} .orden-tabla-wrap{overflow:visible!important;} @page{size:A4 landscape;margin:12mm;}}`;
    document.head.appendChild(s);
    return()=>document.getElementById("orden-print-css")?.remove();
  },[]);

  const initCanvas=(ref,drawRef)=>{
    const c=ref.current;if(!c)return;
    const ctx=c.getContext("2d");
    ctx.strokeStyle="#1a1a2e";ctx.lineWidth=2.2;ctx.lineCap="round";ctx.lineJoin="round";
    const pos=e=>{const r=c.getBoundingClientRect();const sx=c.width/r.width;const sy=c.height/r.height;const cx=e.touches?e.touches[0].clientX:e.clientX;const cy=e.touches?e.touches[0].clientY:e.clientY;return{x:(cx-r.left)*sx,y:(cy-r.top)*sy};};
    const dn=e=>{e.preventDefault();drawRef.current=true;const p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);};
    const mv=e=>{e.preventDefault();if(!drawRef.current)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();};
    const up=()=>{drawRef.current=false;};
    c.addEventListener("mousedown",dn);c.addEventListener("mousemove",mv);c.addEventListener("mouseup",up);c.addEventListener("mouseleave",up);
    c.addEventListener("touchstart",dn,{passive:false});c.addEventListener("touchmove",mv,{passive:false});c.addEventListener("touchend",up);
    return()=>{c.removeEventListener("mousedown",dn);c.removeEventListener("mousemove",mv);c.removeEventListener("mouseup",up);c.removeEventListener("mouseleave",up);c.removeEventListener("touchstart",dn);c.removeEventListener("touchmove",mv);c.removeEventListener("touchend",up);};
  };

  useEffect(()=>{if(orden&&!orden.firma_solicitante)return initCanvas(canvasSol,drawSol);},[orden?.id,orden?.firma_solicitante]);
  useEffect(()=>{if(orden&&!orden.firma_responsable)return initCanvas(canvasResp,drawResp);},[orden?.id,orden?.firma_responsable]);

  const limpiar=ref=>{const c=ref.current;if(!c)return;c.getContext("2d").clearRect(0,0,c.width,c.height);};

  const firmar=async tipo=>{
    const ref=tipo==="sol"?canvasSol:canvasResp;
    const c=ref.current;if(!c)return;
    const ctx=c.getContext("2d");
    const isEmpty=!ctx.getImageData(0,0,c.width,c.height).data.some(v=>v!==0);
    if(isEmpty){alert("Por favor dibuja tu firma antes de confirmar.");return;}
    const img=c.toDataURL("image/png");
    const ahora=new Date().toISOString();
    const upd=tipo==="sol"?{firma_solicitante:img,fecha_firma_sol:ahora}:{firma_responsable:img,fecha_firma_resp:ahora};
    const yaOtra=tipo==="sol"?orden.firma_responsable:orden.firma_solicitante;
    if(yaOtra)upd.estatus="firmada";
    const nuevo={...orden,...upd};
    await supa.upsert("ordenes_pago",[nuevo]);
    setOrden(nuevo);
  };

  const MESES_N=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const fF=f=>{if(!f)return"—";const[y,m,d]=f.split("-");return`${parseInt(d)} ${MESES_N[parseInt(m)-1]} ${y}`;};
  const fM=n=>n!=null?"$"+Number(n).toLocaleString("es-MX",{minimumFractionDigits:0}):"—";
  const fTs=ts=>{if(!ts)return"";const dt=new Date(ts);return dt.toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"})+" · "+dt.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});};

  if(cargando)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:FONT_BODY,color:"#9CA3AF",fontSize:15}}>Cargando orden…</div>;
  if(err)     return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontFamily:FONT_BODY,color:RED,fontSize:18}}>{err}</div>;

  const d=orden.datos||{};
  const ambosFirmaron=!!(orden.firma_solicitante&&orden.firma_responsable);
  const esMensual=d.tipo==="mensual"||d.tipo==="seleccion";
  const solNombre=esMensual?d.solicitante:"Nohelya Melina Martínez Escalante";
  const respNombre=esMensual?d.responsable:"José Roberto Martínez Reyes";

  // ── Bloque firma (canvasRef en lugar de ref para evitar conflicto con React) ──
  const BloqueFirema=({tipo,nombre,cargo,fk,fts,canvasRef})=>(
    <div style={{border:"1px solid "+(orden[fk]?"#BBF7D0":"#E5E7EB"),borderRadius:12,padding:"16px 18px",background:orden[fk]?"#F0FDF4":"#FAFAFA"}}>
      <div style={{fontWeight:700,fontSize:13,color:"#374151",marginBottom:1}}>{nombre}</div>
      <div style={{fontSize:11,color:"#9CA3AF",marginBottom:12}}>{cargo}</div>
      {orden[fk]?(
        <>
          <img src={orden[fk]} alt="firma" style={{width:"100%",height:100,objectFit:"contain",background:"#fff",borderRadius:6,border:"1px solid #E5E7EB"}}/>
          <div style={{fontSize:11,color:"#16a34a",fontWeight:600,marginTop:8,display:"flex",gap:4,alignItems:"center"}}>
            <span>✓ Firmado</span><span style={{color:"#9CA3AF",fontWeight:400,fontSize:10}}>· {fTs(orden[fts])}</span>
          </div>
        </>
      ):(
        <>
          <div style={{border:"1px dashed #D1D5DB",borderRadius:6,background:"#fff",marginBottom:8,touchAction:"none",cursor:"crosshair",overflow:"hidden"}}>
            <canvas ref={canvasRef} width={300} height={110} style={{width:"100%",height:110,display:"block"}}/>
          </div>
          <div style={{display:"flex",gap:6}} className="no-print">
            <button onClick={()=>limpiar(canvasRef)} style={{flex:1,padding:"7px 0",fontSize:12,fontFamily:FONT_BODY,border:"1px solid #E5E7EB",borderRadius:6,background:"#fff",cursor:"pointer",color:"#6B7280"}}>Limpiar</button>
            <button onClick={()=>firmar(tipo)} style={{flex:2,padding:"7px 0",fontSize:12,fontFamily:FONT_BODY,border:"none",borderRadius:6,background:RED,color:"#fff",cursor:"pointer",fontWeight:700}}>Firmar</button>
          </div>
        </>
      )}
    </div>
  );

  return(
    <div style={{background:"#F5F5F7",minHeight:"100vh",padding:"32px 16px",fontFamily:FONT_BODY}}>
      <div className="orden-wrap" style={{maxWidth:760,margin:"0 auto",background:"#fff",borderRadius:16,boxShadow:"0 4px 32px rgba(0,0,0,0.10)",overflow:"hidden"}}>

        {/* ── Cabecera ── */}
        <div style={{display:"flex",alignItems:"stretch",borderBottom:"3px solid "+RED}}>
          <div style={{padding:"16px 20px",background:"#fff",display:"flex",alignItems:"center",borderRight:"1px solid #F0F0F0"}}>
            <img src={IBERO_LOGO} alt="IBERO Tijuana" style={{height:56,width:"auto"}} onError={e=>{e.target.style.display="none";}}/>
          </div>
          <div style={{flex:1,background:RED,padding:"18px 28px",color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontFamily:FONT_TITLE,fontWeight:800,fontSize:18,letterSpacing:"-0.3px"}}>{d.tipo==="seleccion"?"Orden de Pago — Selección":d.tipo==="mensual"?"Solicitud de Honorarios Docentes":"Orden de Pago"}</div>
              <div style={{fontSize:12,opacity:0.85,marginTop:2}}>Educación Continua · #{(orden.id||"").slice(0,8).toUpperCase()}</div>
            </div>
            <div style={{fontSize:12,opacity:0.85}}>{fF(new Date().toISOString().split("T")[0])}</div>
          </div>
        </div>

        {/* ── Info solicitud (solo mensual) ── */}
        {esMensual&&(
          <div style={{padding:"20px 28px",borderBottom:"1px solid #F0F0F0",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 32px"}}>
            {[["Solicitud realizada por",d.solicitante],["Autorización jefe inmediato",d.jefe_inmediato]].map(([l,v])=>(
              <div key={l}><div style={{fontSize:10,color:"#9CA3AF",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>{l}</div><div style={{fontSize:13,fontWeight:600,color:"#111"}}>{v||"—"}</div></div>
            ))}
            <div style={{gridColumn:"1/-1",background:"#FFF5F5",borderRadius:8,padding:"10px 14px",borderLeft:"3px solid "+RED}}>
              <div style={{fontSize:10,color:"#9CA3AF",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>Partida a afectar</div>
              <div style={{fontSize:12,color:RED,fontWeight:600,lineHeight:1.8}}>Entidad: {d.entidad} &nbsp;·&nbsp; Programa: {d.programa} &nbsp;·&nbsp; Partida: {d.partida}</div>
            </div>
          </div>
        )}

        {/* ── Tabla docentes (solo mensual) ── */}
        {esMensual&&(
          <div style={{padding:"20px 28px",borderBottom:"1px solid #F0F0F0"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#9CA3AF",letterSpacing:"1px",textTransform:"uppercase",marginBottom:12}}>Honorarios del mes · {["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][parseInt((d.mes||"").split("-")[1])-1]} {(d.mes||"").split("-")[0]}</div>
            <div className="orden-tabla-wrap" style={{overflowX:"auto"}}>
              <table className="orden-tabla" style={{width:"100%",borderCollapse:"collapse",minWidth:620}}>
                <thead>
                  <tr style={{background:"#FAFAFA"}}>
                    {["#","Nombre del profesor","Diplomado","Módulo","Cat.","Inicio","Fin","Horas","Importe bruto","IVA $","Total + IVA"].map((h,i)=>(
                      <th key={h} style={{padding:"8px 10px",fontSize:10,fontWeight:700,color:"#6B7280",textAlign:i>=7?"right":i===0||i===4?"center":"left",borderBottom:"2px solid #E5E7EB",fontFamily:FONT_BODY,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.filas||[]).map((r,i)=>(
                    <tr key={i} style={{background:i%2===0?"#fff":"#FAFAFA"}}>
                      <td style={{padding:"9px 10px",fontSize:12,color:"#9CA3AF",textAlign:"center",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{r.n}</td>
                      <td style={{padding:"9px 10px",fontSize:13,fontWeight:600,color:"#111",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{r.docente}</td>
                      <td style={{padding:"9px 10px",fontSize:11,color:"#6B7280",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{r.programa}{r.generacion?" — "+r.generacion+" gen.":""}</td>
                      <td style={{padding:"9px 10px",fontSize:12,color:"#374151",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{r.modulo}</td>
                      <td style={{padding:"9px 10px",fontSize:11,fontWeight:700,textAlign:"center",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY,color:r.categoria==="A"?"#2563eb":"#7c3aed"}}>Cat. {r.categoria}</td>
                      <td style={{padding:"9px 10px",fontSize:11,color:"#6B7280",textAlign:"right",whiteSpace:"nowrap",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{fF(r.fechaInicio)}</td>
                      <td style={{padding:"9px 10px",fontSize:11,color:"#6B7280",textAlign:"right",whiteSpace:"nowrap",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{fF(r.fechaFin)}</td>
                      <td style={{padding:"9px 10px",fontSize:12,fontWeight:700,textAlign:"right",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{r.horas}h</td>
                      <td style={{padding:"9px 10px",fontSize:12,textAlign:"right",color:"#374151",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{fM(r.subtotal)}</td>
                      <td style={{padding:"9px 10px",fontSize:12,textAlign:"right",color:"#6B7280",borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{fM(r.ivaMonto)}</td>
                      <td style={{padding:"9px 10px",fontSize:13,fontWeight:700,textAlign:"right",color:RED,borderBottom:"1px solid #F3F4F6",fontFamily:FONT_BODY}}>{fM(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:"#F7F7F8",borderTop:"2px solid #E5E7EB"}}>
                    <td colSpan={8} style={{padding:"10px",fontWeight:700,fontSize:12,fontFamily:FONT_BODY,color:"#374151"}}>Total</td>
                    <td style={{padding:"10px",textAlign:"right",fontWeight:700,fontSize:13,fontFamily:FONT_BODY}}>{fM(d.totalSubtotal)}</td>
                    <td style={{padding:"10px",textAlign:"right",fontWeight:700,fontSize:13,color:"#6B7280",fontFamily:FONT_BODY}}>{fM(d.totalIVA)}</td>
                    <td style={{padding:"10px",textAlign:"right",fontWeight:800,fontSize:15,color:RED,fontFamily:FONT_BODY}}>{fM(d.totalGeneral)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── Datos módulo individual ── */}
        {!esMensual&&(
          <div style={{padding:"24px 28px",borderBottom:"1px solid #F0F0F0"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#9CA3AF",letterSpacing:"1px",textTransform:"uppercase",marginBottom:14}}>Datos del pago</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px 32px",marginBottom:18}}>
              {[["Docente",d.docente],["Programa",d.programa+(d.generacion?" — "+d.generacion+" gen.":"")],["Módulo",d.modulo],["Período",fF(d.fechaInicio)+" – "+fF(d.fechaFin)],["Horas impartidas",(d.horas||0)+"h"],["Categoría","Cat. "+d.categoria]].map(([l,v])=>(
                <div key={l}><div style={{fontSize:10,color:"#9CA3AF",fontWeight:700,textTransform:"uppercase",marginBottom:2,letterSpacing:"0.5px"}}>{l}</div><div style={{fontSize:14,fontWeight:600,color:"#111"}}>{v||"—"}</div></div>
              ))}
            </div>
            <div style={{background:"#FAFAFA",borderRadius:10,padding:"14px 18px"}}>
              {[["Subtotal",fM(d.subtotal),"#374151"],["IVA ("+d.ivaPct+"%)",fM(d.ivaMonto),"#6B7280"],["Total a pagar",fM(d.total),RED]].map(([l,v,c],i)=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",paddingTop:i?8:0,marginTop:i?8:0,borderTop:i===2?"1.5px solid #E5E7EB":"none"}}>
                  <span style={{fontSize:i===2?14:13,fontWeight:i===2?700:400,color:"#374151"}}>{l}</span>
                  <span style={{fontSize:i===2?19:14,fontWeight:i===2?800:600,color:c}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Firmas ── */}
        <div style={{padding:"24px 28px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#9CA3AF",letterSpacing:"1px",textTransform:"uppercase",marginBottom:16}}>Firmas de autorización</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
            <BloqueFirema tipo="sol"  nombre={solNombre}  cargo="Solicitante"             fk="firma_solicitante" fts="fecha_firma_sol"  canvasRef={canvasSol}/>
            <BloqueFirema tipo="resp" nombre={respNombre} cargo="Responsable que autoriza" fk="firma_responsable" fts="fecha_firma_resp" canvasRef={canvasResp}/>
          </div>
        </div>

        {/* ── Pie ── */}
        <div style={{padding:"16px 28px",borderTop:"1px solid #F0F0F0",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12,background:"#FAFAFA"}} className="no-print">
          <div style={{fontSize:12,color:ambosFirmaron?"#16a34a":"#9CA3AF",fontWeight:ambosFirmaron?700:400}}>
            {ambosFirmaron?"✓ Solicitud completamente firmada":`Pendiente de firma${orden.firma_solicitante||orden.firma_responsable?" — 1 de 2":""}`}
          </div>
          {ambosFirmaron&&(
            <button onClick={()=>window.print()} style={{background:RED,color:"#fff",border:"none",borderRadius:8,padding:"10px 24px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:FONT_BODY}}>
              Descargar PDF
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── REPORTE PÚBLICO DOCENTE ───────────────────────────
function ReporteDocentePublico() {
  const token = new URLSearchParams(window.location.search).get("reporte");
  let data;
  try { data = JSON.parse(decodeURIComponent(escape(atob(token)))); } catch(e) { return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:"#C8102E"}}>Enlace inválido.</div>; }

  const { docente, prom, dims, comentarios, notaCoord, totalResp, fecha } = data;
  const pageUrl = window.location.href;

  const colorVal = _v => "#C8102E";
  const label    = v => v>=4.5?"Excelente":v>=4?"Muy bueno":v>=3?"Bueno":"Por mejorar";
  const starPct  = Math.round((prom/5)*100);

  // Compartir redes
  const shareText = `Obtuve ${prom}/5 en mi evaluación docente en IBERO Tijuana Educación Continua. ¡Gracias a mis estudiantes por su retroalimentación!`;
  const shareLinkedIn = () => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`,"_blank");
  const shareFacebook = () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`,"_blank");
  const shareTwitter  = () => window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(shareText)}`,"_blank");
  const shareWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText+"\n\n"+pageUrl)}`,"_blank");

  const imprimir = () => {
    const promColor = "#C8102E";
    const dimBarras = dims.map(d=>{
      const pct = Math.round(d.val/5*100);
      const dc = "#C8102E";
      return `<div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="color:#374151;font-size:13px;font-weight:600;">${d.label}</span>
          <span style="font-weight:800;color:${dc};font-size:14px;">${d.val}<span style="color:#9ca3af;font-weight:400;font-size:11px;">/5</span></span>
        </div>
        <div style="background:#f3f4f6;border-radius:99px;height:9px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${dc};border-radius:99px;"></div>
        </div>
      </div>`;}).join("");
    const comsHtml = comentarios?.length ? comentarios.map(c=>
      `<div style="border-left:3px solid #C8102E;padding:10px 16px;margin-bottom:10px;font-size:12px;color:#374151;font-style:italic;line-height:1.7;background:#fafafa;border-radius:0 6px 6px 0;">"${c}"</div>`).join("") : "";
    const notaHtml = notaCoord ? `
      <div style="background:#eff6ff;border-radius:8px;padding:16px 20px;margin-top:24px;border:1px solid #bfdbfe;">
        <div style="font-size:10px;font-weight:700;color:#2563eb;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Nota de la coordinación</div>
        <div style="font-size:13px;color:#1e40af;line-height:1.6;">${notaCoord.replace(/\n/g,"<br/>")}</div>
      </div>` : "";
    const html=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
    <title>Evaluación Docente — ${docente}</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'Inter',sans-serif;background:#fff;color:#1a1a1a;}
      @page{margin:0;}
      @media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}
    </style>
    </head><body>
    <!-- ENCABEZADO ROJO -->
    <div style="background:#C8102E;padding:28px 40px;display:flex;align-items:center;justify-content:space-between;">
      <div style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:900;color:#fff;letter-spacing:1px;">IBERO Tijuana</div>
      <div style="text-align:right;">
        <div style="font-family:'Montserrat',sans-serif;font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">Evaluación Docente</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:3px;">${fecha}</div>
      </div>
    </div>
    <!-- CUERPO -->
    <div style="padding:40px 48px;">
      <!-- Nombre y score -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:32px;margin-bottom:36px;padding-bottom:28px;border-bottom:2px solid #f3f4f6;">
        <div>
          <div style="font-size:11px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Resultados de evaluación</div>
          <div style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:800;color:#1a1a1a;line-height:1.2;margin-bottom:8px;">${docente}</div>
          <div style="font-size:13px;color:#6b7280;">${totalResp} evaluación${totalResp!==1?"es":""} registrada${totalResp!==1?"s":""}</div>
        </div>
        <div style="text-align:center;flex-shrink:0;background:#f9fafb;border-radius:16px;padding:20px 28px;border:2px solid #f3f4f6;">
          <div style="font-size:10px;color:#9ca3af;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Promedio</div>
          <div style="font-family:'Montserrat',sans-serif;font-size:60px;font-weight:900;color:${promColor};line-height:1;">${prom}</div>
          <div style="font-size:13px;color:#9ca3af;margin-top:2px;">/5</div>
          <div style="margin-top:8px;background:${promColor}22;border-radius:99px;padding:3px 14px;font-size:12px;font-weight:700;color:${promColor};display:inline-block;">${label(prom)}</div>
        </div>
      </div>
      <!-- Dimensiones -->
      <div style="margin-bottom:28px;">
        <div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-bottom:16px;">Resultados por dimensión</div>
        ${dimBarras}
      </div>
      <!-- Comentarios -->
      ${comentarios?.length?`<div style="margin-bottom:24px;"><div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Comentarios de participantes</div>${comsHtml}</div>`:""}
      ${notaHtml}
      <!-- Cierre -->
      <div style="margin-top:40px;padding-top:24px;border-top:2px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:14px;font-weight:600;color:#374151;">Gracias por su valiosa contribución y dedicación.</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px;">Su trabajo es fundamental para la formación continua de nuestros participantes.</div>
        </div>
        <div style="text-align:right;font-size:11px;color:#9ca3af;">
          Coordinación de Educación Continua<br/>IBERO Tijuana
        </div>
      </div>
    </div>
    </body></html>`;
    const w=window.open("","_blank"); w.document.write(html); w.document.close(); setTimeout(()=>w.print(),800);
  };

  return(
    <div style={{minHeight:"100vh",background:"#0f172a",fontFamily:"system-ui",color:"#fff"}}>
      {/* Barra superior */}
      <div style={{background:"#C8102E",padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontFamily:"Montserrat,Georgia,serif",fontSize:24,fontWeight:900,color:"#fff",letterSpacing:1}}>IBERO Tijuana</span>
        <button onClick={imprimir} style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,color:"#fff",padding:"7px 18px",cursor:"pointer",fontSize:12,fontWeight:700}}>
          Descargar PDF
        </button>
      </div>

      {/* Hero — tarjeta principal */}
      <div style={{maxWidth:660,margin:"40px auto 0",padding:"0 20px"}}>

        {/* Tarjeta score */}
        <div style={{background:"linear-gradient(135deg,#1e1b4b 0%,#1a1a2e 50%,#16213e 100%)",borderRadius:24,padding:"40px 36px",marginBottom:20,border:"1px solid rgba(255,255,255,0.1)",textAlign:"center",position:"relative",overflow:"hidden"}}>
          {/* Círculo decorativo */}
          <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,rgba(200,16,46,0.3),transparent)",pointerEvents:"none"}}/>
          <div style={{position:"absolute",bottom:-40,left:-40,width:160,height:160,borderRadius:"50%",background:"radial-gradient(circle,rgba(245,158,11,0.2),transparent)",pointerEvents:"none"}}/>

          <div style={{position:"relative"}}>
            <div style={{display:"inline-block",background:"rgba(200,16,46,0.2)",border:"1px solid rgba(200,16,46,0.4)",borderRadius:99,padding:"4px 16px",fontSize:10,fontWeight:700,letterSpacing:2,color:"#f87171",textTransform:"uppercase",marginBottom:24}}>
              Evaluación Docente
            </div>
            {/* Número promedio */}
            <div style={{fontFamily:"Georgia,serif",fontSize:100,fontWeight:900,lineHeight:1,background:"linear-gradient(135deg,#fbbf24,#f59e0b,#C8102E)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:4}}>
              {prom}
            </div>
            <div style={{fontSize:18,color:"rgba(255,255,255,0.35)",marginBottom:20}}>/5 puntos</div>
            {/* Badge nivel */}
            <div style={{display:"inline-block",background:colorVal(prom),borderRadius:99,padding:"6px 20px",fontSize:14,fontWeight:800,color:"#fff",marginBottom:24,letterSpacing:0.5}}>
              {label(prom)}
            </div>
            {/* Barra circular simple */}
            <div style={{width:"100%",background:"rgba(255,255,255,0.08)",borderRadius:99,height:6,marginBottom:28,overflow:"hidden"}}>
              <div style={{width:starPct+"%",height:"100%",background:"linear-gradient(90deg,#f59e0b,#C8102E)",borderRadius:99,transition:"width 1s"}}/>
            </div>
            <div style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:700,color:"#fff",marginBottom:6}}>{docente}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.4)"}}>{totalResp} evaluación{totalResp!==1?"es":""} · {fecha}</div>
          </div>
        </div>

        {/* Resultados por dimensión */}
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"24px 28px",marginBottom:20}}>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.4)",letterSpacing:2,textTransform:"uppercase",marginBottom:20}}>Resultados por dimensión</div>
          {dims.map((d,i)=>(
            <div key={i} style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:7}}>
                <span style={{color:"#e2e8f0",fontWeight:500}}>{d.label}</span>
                <span style={{fontWeight:800,color:colorVal(d.val)}}>{d.val}<span style={{color:"rgba(255,255,255,0.3)",fontWeight:400}}>/5</span></span>
              </div>
              <div style={{background:"rgba(255,255,255,0.08)",borderRadius:99,height:7,overflow:"hidden"}}>
                <div style={{width:(d.val/5*100)+"%",height:"100%",background:`linear-gradient(90deg,${colorVal(d.val)}99,${colorVal(d.val)})`,borderRadius:99,transition:"width .8s"}}/>
              </div>
            </div>
          ))}
        </div>

        {/* Comentarios */}
        {comentarios?.length>0&&(
          <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"24px 28px",marginBottom:20}}>
            <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.4)",letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Comentarios de participantes</div>
            <div style={{display:"grid",gap:10}}>
              {comentarios.map((c,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.06)",borderLeft:"3px solid rgba(200,16,46,0.6)",padding:"12px 16px",borderRadius:"0 10px 10px 0",fontSize:13,color:"#cbd5e1",fontStyle:"italic",lineHeight:1.7}}>
                  "{c}"
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nota coordinación */}
        {notaCoord&&(
          <div style={{background:"rgba(37,99,235,0.1)",border:"1px solid rgba(37,99,235,0.3)",borderRadius:16,padding:"20px 28px",marginBottom:20}}>
            <div style={{fontSize:10,fontWeight:700,color:"#93c5fd",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Nota de la coordinación</div>
            <div style={{fontSize:13,color:"#bfdbfe",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{notaCoord}</div>
          </div>
        )}

        {/* Agradecimiento */}
        <div style={{textAlign:"center",padding:"28px 0 8px"}}>
          <div style={{fontSize:15,fontWeight:600,color:"rgba(255,255,255,0.7)",marginBottom:6}}>Gracias por su valiosa contribución y dedicación.</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.35)",lineHeight:1.6}}>Su trabajo es fundamental para la formación continua de nuestros participantes.</div>
        </div>

        {/* ── BOTONES COMPARTIR ── */}
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"24px 28px",margin:"20px 0 40px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.4)",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Compartir mis resultados</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",marginBottom:18}}>¡Comparte tu logro con tu red profesional!</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {/* LinkedIn */}
            <button onClick={shareLinkedIn} style={{display:"flex",alignItems:"center",gap:10,background:"#0a66c2",border:"none",borderRadius:10,padding:"12px 16px",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:13}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              LinkedIn
            </button>
            {/* Facebook */}
            <button onClick={shareFacebook} style={{display:"flex",alignItems:"center",gap:10,background:"#1877f2",border:"none",borderRadius:10,padding:"12px 16px",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:13}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Facebook
            </button>
            {/* Twitter/X */}
            <button onClick={shareTwitter} style={{display:"flex",alignItems:"center",gap:10,background:"#000",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"12px 16px",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:13}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              X (Twitter)
            </button>
            {/* WhatsApp */}
            <button onClick={shareWhatsApp} style={{display:"flex",alignItems:"center",gap:10,background:"#25D366",border:"none",borderRadius:10,padding:"12px 16px",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:13}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
              WhatsApp
            </button>
          </div>
        </div>

        <div style={{textAlign:"center",paddingBottom:40,fontSize:11,color:"rgba(255,255,255,0.2)"}}>
          Coordinación de Educación Continua · IBERO Tijuana
        </div>
      </div>
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
  const [ordenes,setOrdenes]     = useState([]);
  const [showApiKey,setShowAK]   = useState(false);
  const [view,setView]           = useState("dashboard");
  const [selProg,setSelProg]     = useState(null);
  const [progTab,setProgTab]     = useState("modulos");
  const [showModM,setShowModM]   = useState(false);
  const [editMod,setEditMod]     = useState(null);
  const [showProgM,setShowProgM] = useState(false);
  const [editProgId,setEditProgId] = useState(null);
  const [showImport,setShowImp]  = useState(false);
  const [showAlertas,setShowAl]  = useState(false);
  const [presencia,setPresencia] = useState([]);
  const [alertasDesc,setAlertasDesc] = useState([]);
  const [pagoModal,setPagoModal] = useState(null); // {est, prog}
  const [folioModal,setFolioModal] = useState(null); // {onConfirm, onSkip}
  const [notif,setNotif]         = useState(null);
  const [confirmSimple,setCS]    = useState(null); // {titulo,mensaje,onConfirm}
  const [confirmEscrita,setCE]   = useState(null); // {titulo,subtitulo,mensaje,onConfirm}
  const [sending,setSending]     = useState(null);
  const [newResp,setNewResp]     = useState({nombre:"",email:""});
  const [users,setUsers]         = useState([]);
  const [newUser,setNewUser]     = useState({nombre:"",email:"",password:"",permisos:{...ADMIN_P}});
  const [editUserIdx,setEditUserIdx] = useState(null);
  const [editUserForm,setEditUserForm] = useState({});
  const [showUP,setShowUP]       = useState(false);
  const [newFM,setNewFM]         = useState({id:"",label:""});
  const [repExp,setRepExp]           = useState(null);
  const [linkCopiado,setLinkCop]     = useState("");
  const [repVistaFin,setRepVistaFin] = useState("global");
  const [repMesFin,setRepMesFin]     = useState(today().substring(0,7));
  const [busqGlobal,setBusqGlobal]     = useState("");
  const [busqPagos,setBusqPagos]       = useState("");
  const [progPagos,setProgPagos]       = useState("");
  const [filtroPagos,setFiltroPagos]   = useState("");
  const [filtroTipoPago,setFiltroTipoPago] = useState(""); // ""=todos, "unico", "parcialidades"
  const [filtroFactProg,setFiltroFactProg] = useState("");
  const [busqFacturacion,setBusqFacturacion] = useState("");
  const [filtroFactTipo,setFiltroFactTipo] = useState(""); // ""=todos, "pagaron"=pagaron este mes, "pendiente"=factura pendiente, "enviada"=enviada
  const [filtroFactMes,setFiltroFactMes] = useState(today().substring(0,7)); // YYYY-MM
  const [busqHoy,setBusqHoy] = useState("");
  const [cobranzaFiltroEst,setCobranzaFiltroEst] = useState(""); // "crítico","vencido","proximo","al_dia",""
  const [cobranzaFiltroProg,setCobranzaFiltroProg] = useState("");
  const [cobranzaBusq,setCobranzaBusq] = useState("");
  const [cobranzaNotaModal,setCobranzaNotaModal] = useState(null); // {est, prog}
  const [cobranzaNotaText,setCobranzaNotaText] = useState("");
  const [fiscalModal,setFiscalModal] = useState(null); // {progId, est}
  const [fiscalSolicitudModal,setFiscalSolicitudModal] = useState(null); // {progId, est, url}
  const [expandido,setExpandido]       = useState(null); // programa abierto
  const [expandidoEst,setExpandidoEst] = useState(null); // estudiante abierto
  const [evalTab,setEvalTab]           = useState("modulos");
  const [filtroDocEval,setFiltroDocEval]   = useState("");
  const [filtroProgEval,setFiltroProgEval] = useState("");
  const [filtroModEval,setFiltroModEval]   = useState("");
  const [evalReporteModal,setEvalReporteModal] = useState(null); // {docente, evals}
  const [editEstModal,setEditEstModal] = useState(null);
  const [inactivoModal,setInactivoModal] = useState(null); // {est, prog}
  const [inactivoRazon,setInactivoRazon] = useState("");
  const [bajaModal,setBajaModal]         = useState(null); // {est, prog}
  const [bajaRazon,setBajaRazon]         = useState("");
  const [npsModal,setNpsModal]         = useState(null);
  const [npsData,setNpsData] = useState([]);
  const [busqProg,setBusqProg]   = useState("");
  const [filtroProg,setFiltroPr] = useState("");
  const [filtroSt,setFiltroSt]   = useState("");
  const [busqEst,setBusqEst]     = useState("");
  const [filtroEst,setFiltroEst] = useState("");
  const alertRef = useRef(null);
  const programasRef = useRef(programas);
  const notifCfgRef = useRef(null);
  const syncFnRef = useRef(null);
  useEffect(()=>{ programasRef.current = programas; }, [programas]);
  useEffect(()=>{ notifCfgRef.current = notifCfg; }, [notifCfg]);

  const eMod  = {id:"",numero:"I",nombre:"",docenteId:"",docente:"",emailDocente:"",clases:4,horasPorClase:4,horario:"",fechaInicio:"",fechaFin:"",dias:["Lun"],estatus:"propuesta",fechasClase:[]};
  const eProg = {id:"",nombre:"",tipo:"Diplomado",tipoCustom:"",color:RED,modulos:[],estudiantes:[],modalidad:"Presencial Playas",generacion:"Primera",precioLista:0,parcialidadesDefault:5,colaboracion:false,socio:"",pct_socio:0,notas_internas:"",ghl_pipeline_id:"",ghl_stage_id:""};
  const [modForm,setModForm]   = useState(eMod);
  const [progForm,setProgForm] = useState(eProg);

  useEffect(()=>{
    const init = async () => {
    const s=localStorage.getItem(SK2);
    if(s){
      const ses=JSON.parse(s);
      // Intentar refrescar el token (expira en ~1 hora)
      if(ses.refresh_token){
        const renovado = await supa.refreshToken(ses.refresh_token);
        if(renovado){
          const sesActualizada = {...ses, token: renovado.token, refresh_token: renovado.refresh_token};
          localStorage.setItem(SK2, JSON.stringify(sesActualizada));
          setSession(sesActualizada);
        } else {
          // Refresh token inválido → forzar re-login
          localStorage.removeItem(SK2);
          return;
        }
      } else {
        // Sesión sin refresh_token (antigua) → forzar re-login una sola vez
        localStorage.removeItem(SK2);
        return;
      }
    }
    // Cargar responsables desde Supabase
    try {
      const respSupa = await supa.get("responsables","?order=nombre");
      if(respSupa&&respSupa.length>0) setResp(respSupa.map(r=>({id:r.id,nombre:r.nombre,email:r.email||"",telefono:r.telefono||""})));
    } catch(e) {}

    // Cargar usuarios desde Supabase
    try {
      const usuariosSupa = await supa.get("usuarios","?activo=eq.true&order=nombre");
      if(usuariosSupa&&usuariosSupa.length>0){
        setUsers(usuariosSupa.map(u=>({
          id:u.id, nombre:u.nombre, email:u.email,
          password:u.password_hash||"", rol:u.rol||"auxiliar",
          permisos:u.permisos||{}, activo:u.activo!==false,
          avatar_url:u.avatar_url||"",
        })));
      } else {
        setUsers(DEFAULT_USERS);
      }
    } catch(e){ setUsers(DEFAULT_USERS); }

    // Cargar configuracion (fieldMap y notif) desde Supabase
    try {
      const cfgs = await supa.get("configuracion","?select=*");
      if(cfgs&&cfgs.length>0){
        const fm = cfgs.find(c=>c.clave==="fieldmap");
        const nf = cfgs.find(c=>c.clave==="notif");
        const ad = cfgs.find(c=>c.clave==="alertas_desc");
        if(fm?.valor) setFieldMap(fm.valor);
        if(nf?.valor) setNotifCfg(nf.valor);
        if(ad?.alertas_descartadas) setAlertasDesc(ad.alertas_descartadas);
      }
    } catch(e){}
    // Cargar evaluaciones NPS desde Supabase
    try {
      const npsSupabase = await supa.get("evaluaciones_nps","?order=created_at");
      if(npsSupabase&&npsSupabase.length>0){
        const npsMap = npsSupabase.map(e=>({
          id:e.id, fecha:e.fecha||"",
          progId:e.programa_id, modId:e.modulo_id,
          docenteId:e.docente_id||"", docenteNombre:e.docente_nombre||"",
          prog:"", mod:"",
          q1:e.q1, q2:e.q2, q3:e.q3, q4:e.q4, q5:e.q5,
          promedio:e.promedio, comentarios:e.comentarios||"",
        }));
        setNpsData(npsMap);
      }
    } catch(e) { console.warn("No se pudo cargar NPS:", e); }

    // Cargar docentes — intentar Supabase primero
    try {
    const docentesSupabase = await supa.get("docentes","?order=nombre");
    if(docentesSupabase&&docentesSupabase.length>0){
      setDocentes(docentesSupabase.map(d=>({
        id:d.id, nombre:d.nombre, email:d.email||"", telefono:d.telefono||"",
        especialidad:d.especialidad||"", honorariosPorHora:d.honorarios_por_hora||0,
        banco:d.banco||"", clabe:d.clabe||"", rfc:d.rfc||"",
        iva:d.iva||16,
        grado:d.grado||"Licenciatura",
        grados:Array.isArray(d.grados)?d.grados:(d.grado?[d.grado]:[]),
        programas_egreso:d.programas_egreso||{},
        categoria:d.categoria||"A", semblanza:d.semblanza||"",
        perfil_incompleto:d.perfil_incompleto||false,
      })));
    } else {
      setDocentes([]);
    }
    } catch(e) { setDocentes([]); }

    // Cargar órdenes de pago firmadas (para alertas)
    try {
      const ords = await supa.get("ordenes_pago","?estatus=eq.firmada&order=created_at.desc");
      if(ords) setOrdenes(ords);
    } catch(e) { console.warn("No se pudo cargar ordenes:", e); }

    // Cargar programas: intentar Supabase primero, caer a localStorage
    const cargarProgramas = async () => {
      let programasRaw = null;

      try {
        // Supabase es la fuente de verdad
        const [progs, supaModulos, supaEsts, supaPagos, supaAsist] = await Promise.all([
          supa.get("programas",   "?order=created_at"),
          supa.get("modulos",     "?order=created_at"),
          supa.get("estudiantes", "?order=created_at"),
          supa.get("pagos",       "?order=id"),
          supa.get("asistencia",  "?order=fecha"),
        ]);

        if (progs && progs.length > 0) {
          programasRaw = progs.map(p => ({
            id: p.id, nombre: p.nombre, tipo: p.tipo||"", modalidad: p.modalidad||"",
            generacion: p.generacion||"", color: p.color||"#C8102E",
            descripcion: p.descripcion||"",
            parcialidadesDefault: p.parcialidades_default||5,
            estatus: p.estatus||"activo",
            colaboracion: p.colaboracion||false, socio: p.socio||"", pct_socio: p.pct_socio||0,
            precioLista: p.precio_lista||0, tipoCustom: p.tipo_custom||"",
            notas_internas: p.notas_internas||"",
            ghl_pipeline_id: p.ghl_pipeline_id||"",
            ghl_stage_id: p.ghl_stage_id||"",
            promociones: p.promociones||[],
            modulos: (supaModulos||[]).filter(m=>m.programa_id===p.id).map(m=>({
              id: m.id, numero: m.numero||"", nombre: m.nombre||"",
              docenteId: m.docente_id||"", docente: m.docente||"",
              emailDocente: m.email_docente||"", clases: m.clases||4,
              horasPorClase: m.horas_por_clase||4, horario: m.horario||"",
              fechaInicio: m.fecha_inicio||"", fechaFin: m.fecha_fin||"",
              dias: m.dias||[], fechasClase: m.fechas_clase||[], estatus: m.estatus||"propuesta",
              factura_solicitada: m.factura_solicitada||false, pago_emitido: m.pago_emitido||false,
            })),
            estudiantes: (supaEsts||[]).filter(e=>e.programa_id===p.id).map(e=>{
              const pago = (supaPagos||[]).find(pg=>pg.estudiante_id===e.id&&pg.programa_id===p.id)
                        || (supaPagos||[]).find(pg=>pg.estudiante_id===e.id);
              // Reconstruir asistencia desde tabla asistencia
              const asistRows = (supaAsist||[]).filter(a=>a.estudiante_id===e.id);
              const asistencia = {};
              asistRows.forEach(a=>{
                const k="mod_"+a.modulo_id;
                if(!asistencia[k]) asistencia[k]=[];
                asistencia[k].push(a.fecha);
              });
              return {
                id: e.id, nombre: e.nombre, email: e.email||"", telefono: e.telefono||"",
                empresa: e.empresa||"", puesto: e.puesto||"", carrera: e.carrera||"",
                grado: e.grado||"", egresado_ibero: e.egresado_ibero||"",
                requiere_factura: e.requiere_factura||"", csf_url: e.csf_url||"",
                fuente: e.fuente||"", programa_interes: e.programa_interes||"",
                forma_pago_crm: e.forma_pago_crm||"", monto_ghl: e.monto_ghl||0, forma_cobro: e.forma_cobro||"",
                razon_social: e.razon_social||"", rfc: e.rfc||"", regimen_fiscal: e.regimen_fiscal||"",
                codigo_postal: e.codigo_postal||"", calle: e.calle||"", num_exterior: e.num_exterior||"",
                num_interior: e.num_interior||"", colonia: e.colonia||"", ciudad: e.ciudad||"",
                estado: e.estado||"", uso_cfdi: e.uso_cfdi||"",
                estatus: e.estatus||"activo",
                fecha_nacimiento: e.fecha_nacimiento||"",
                fiscal_token: e.fiscal_token||null,
                fiscal_completado: e.fiscal_completado||false,
                cobranza_estado: e.cobranza_estado||null,
                cobranza_ultimo_contacto: e.cobranza_ultimo_contacto||null,
                cobranza_comprometio: e.cobranza_comprometio||null,
                cobranza_nota: e.cobranza_nota||"",
                factura_enviada: e.factura_enviada||false,
                asistencia: Object.keys(asistencia).length>0 ? asistencia : (e.asistencia||{}),
                campos_extra: e.campos_extra||{},
                pago: pago ? {
                  tipo: pago.tipo||"parcialidades",
                  monto_acordado: Number(pago.monto_acordado)||0,
                  descuento_pct: Number(pago.descuento_pct)||0,
                  promocion_id: pago.promocion_id||"",
                  parcialidades: Array.isArray(pago.parcialidades) ? pago.parcialidades : (typeof pago.parcialidades==="string" ? JSON.parse(pago.parcialidades||"[]") : []),
                  notas: pago.notas||"",
                } : { tipo:"parcialidades", monto_acordado:0, descuento_pct:0, promocion_id:"", parcialidades:[], notas:"" },
              };
            }),
          }));
        }
      } catch(e) {
        console.warn("Error al cargar datos de Supabase:", e);
      }

      if (!programasRaw) programasRaw = [];

      // Migrar módulos sin fechasClase
      const programasMigrados = programasRaw.map(prog=>({
        ...prog,
        modulos: (prog.modulos||[]).map(mod=>{
          if(mod.fechasClase&&mod.fechasClase.length>0) return mod;
          if(!mod.fechaInicio||!mod.fechaFin) return mod;
          const fechasClase = generarFechasClase(mod.fechaInicio, mod.fechaFin, mod.dias, mod.clases);
          if(!fechasClase.length) return mod;
          return { ...mod, fechasClase, fechaInicio: fechasClase[0], fechaFin: fechasClase[fechasClase.length-1] };
        })
      }));
      setProgramas(programasMigrados);
      setReady(true);
    };

    cargarProgramas();
    }; // fin init
    init();
  },[]);

  useEffect(()=>{
    const h=e=>{if(alertRef.current&&!alertRef.current.contains(e.target))setShowAl(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  // Presencia — stickers por usuario (Supabase primero, fallback hardcodeado)
  const STICKERS_DEFAULT = {
    "roberto.martinez@tijuana.ibero.mx":  "https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/69d86e07a4e6aa34cb69ccc0.png",
    "nohelya.martinez@tijuana.ibero.mx":  "https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/69d86e07a4e6aa34cb69ccc6.png",
    "jovan.naranjo@tijuana.ibero.mx":     "https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/69d86e07a4e6aa34cb69ccd0.png",
    "wendy.sanchez@tijuana.ibero.mx":     "https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/69d86e07d7871cddf7ef91e8.png",
    "andrea.betancourt@tijuana.ibero.mx": "https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/69d86e07019dc508d3e38494.png",
  };
  const getAvatar = email => {
    const u = (users||[]).find(u=>u.email===email);
    return u?.avatar_url || STICKERS_DEFAULT[email] || "";
  };

  useEffect(()=>{
    if(!session?.email||!session?.token) return;
    if(!supa._token) supa.setToken(session.token);
    const registrar = async () => {
      await supa.upsert("presencia",[{
        email: session.email,
        nombre: session.nombre||session.email,
        last_seen: new Date().toISOString(),
      }]);
    };
    const cargarPresencia = async () => {
      const hace2min = new Date(Date.now()-2*60*1000).toISOString();
      const data = await supa.get("presencia",`?last_seen=gte.${hace2min}&order=nombre`);
      if(data) setPresencia(data.filter(u=>u.email!==session.email));
    };
    registrar();
    cargarPresencia();
    const intervalo = setInterval(()=>{ registrar(); cargarPresencia(); }, 30000);

    // Auto-refresh del JWT cada 50 minutos para que nunca expire mientras la app está abierta
    const tokenRefresh = setInterval(async ()=>{
      const s = localStorage.getItem(SK2);
      if(!s) return;
      const ses = JSON.parse(s);
      if(!ses.refresh_token) return;
      const renovado = await supa.refreshToken(ses.refresh_token);
      if(renovado){
        const sesActualizada = {...ses, token: renovado.token, refresh_token: renovado.refresh_token};
        localStorage.setItem(SK2, JSON.stringify(sesActualizada));
        setSession(sesActualizada);
      }
    }, 50*60*1000);

    return ()=>{ clearInterval(intervalo); clearInterval(tokenRefresh); };
  },[session?.email, session?.token]);

  // Cargar pipelines del CRM cuando hay API key o cuando se abre el form de programa

  // Background sync CRM — importa estudiantes nuevos cada 5 min
  useEffect(()=>{
    if(!notifCfg?.apiKey||!notifCfg?.locationId) return;
    const syncGHL = async (manual=false) => {
      const cfg = notifCfgRef.current;
      if(!cfg?.apiKey||!cfg?.locationId) { if(manual) notify("Configura la API Key primero","error"); return; }
      const programasActual = programasRef.current || [];
      const progsConSync=programasActual.filter(p=>p.ghl_pipeline_id&&p.ghl_stage_id);
      if(!progsConSync.length){
        if(manual) notify("Ningún programa tiene embudo y etapa configurados","warning");
        return;
      }
      if(manual) notify(`Sincronizando ${progsConSync.length} programa${progsConSync.length!==1?"s":""}...`,"warning");
      let totalNuevos=0;
      let programasActualizados=[...programasActual];
      for(const prog of progsConSync){
        const contacts = await ghlFetchContacts(cfg.apiKey, cfg.locationId, prog.ghl_pipeline_id, prog.ghl_stage_id);
        if(!contacts.length) continue;
        const existIds=new Set((prog.estudiantes||[]).map(e=>e.id));
        const nuevos=contacts.filter(c=>!existIds.has(c.id));
        if(!nuevos.length) continue;
        // Actualizar perfil de existentes
        const existingAct=(prog.estudiantes||[]).map(e=>{
          const c=contacts.find(x=>x.id===e.id); if(!c) return e;
          return {...e, nombre:capNombre(c.name||"")||e.nombre, email:c.email||e.email, telefono:c.phone||e.telefono, fecha_nacimiento:ghlParseFechaNac(c.dateOfBirth)||e.fecha_nacimiento||""};
        });
        const fechaInicioPrograma=(prog.modulos||[]).map(m=>m.fechaInicio).filter(Boolean).sort()[0]||"";
        const toAdd=nuevos.map(c=>{
          const cf=c.customFields||[];
          const monto=c.monetaryValue||0;
          const formaPago=ghlGetCF(cf,"XXeCwvn51VnMm3KvsAhP","contact.forma_de_pago");
          return {
            id:c.id, nombre:capNombre(c.name||""), email:c.email||"", telefono:c.phone||"",
            empresa:c.company||"", puesto:ghlGetCF(cf,"Bh2QzKI7oWxAlK61XJLA","contact.puesto_que_desempeas"),
            carrera:ghlGetCF(cf,"jvN3GJ9rxhrXdfcpI1zS","contact.cul_es_tu_carrera_profesional"),
            grado:ghlGetCF(cf,"e7xQs2aAb5UpEwemgShB","contact.ltimo_grado_de_estudios"),
            egresado_ibero:ghlGetCF(cf,"6yYRPsode1sse8Vir7tK","contact.eres_egresada_o_egresado_ibero"),
            programa_interes:ghlGetCF(cf,"rWoFzI5aT07JEzAuUhTe","contact.programa_de_intersz"),
            fuente:c.source||"", requiere_factura:ghlGetCF(cf,"HoscJ6RVoX90tYqlkcUb","contact.requiere_factura"),
            forma_pago_crm:formaPago, monto_ghl:monto, forma_cobro:"",
            razon_social:"", rfc:"", regimen_fiscal:"", codigo_postal:"", calle:"", num_exterior:"",
            num_interior:"", colonia:"", ciudad:"", estado:"", uso_cfdi:"",
            fecha_nacimiento:ghlParseFechaNac(c.dateOfBirth),
            estatus:"activo", asistencia:{}, campos_extra:{},
            pago:ghlBuildPago(monto, prog.parcialidadesDefault, formaPago, prog.precioLista||0, fechaInicioPrograma),
          };
        });
        programasActualizados=programasActualizados.map(p=>p.id!==prog.id?p:{...p,estudiantes:[...existingAct,...toAdd]});
        totalNuevos+=toAdd.length;
      }
      if(totalNuevos>0){
        setProgramas(programasActualizados);
        syncToSupabase(programasActualizados).catch(()=>{});
        notify(`${totalNuevos} estudiante${totalNuevos!==1?"s":""} importado${totalNuevos!==1?"s":""} automáticamente`,"success");
      } else if(manual){
        notify("Sin estudiantes nuevos en este momento","success");
      }
    };
    syncFnRef.current = syncGHL;
    syncGHL();
    const intervaloSync=setInterval(syncGHL, 5*60*1000);
    return ()=>clearInterval(intervaloSync);
  },[notifCfg?.apiKey]);

  const save = async d => {
    setProgramas(d); // actualizar UI inmediatamente
    try {
      await syncToSupabase(d);
    } catch(e) {
      console.error("Sync error:", e);
      notify("Error de conexión — los cambios no se guardaron. Vuelve a intentarlo.", "error");
    }
  };
  const saveResp = async d => {
    setResp(d);
    if (d && d.length) {
      const ok = await supa.upsert("responsables", d.map(r=>({
        id:r.id||newId(), nombre:r.nombre||"", email:r.email||"", telefono:r.telefono||"",
      }))).catch(e=>{ console.error("Sync responsables:",e); return false; });
      if (ok === false) notify("Error al guardar responsables.", "error");
    }
  };
  const crearUsuarioAuth = async (email, password) => {
    try {
      const r = await fetch(`${SUPA_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { "apikey": SUPA_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) return { error: d.error_description || d.msg || d.message || "Error al crear usuario ("+r.status+")" };
      // Supabase devuelve 200 con identities:[] si el usuario ya existe sin contraseña seteada
      if (d.identities && d.identities.length === 0) {
        return { error: "El correo ya existe en el sistema. Ve a Supabase → Authentication → Users → busca el usuario → Update user para setear su contraseña manualmente." };
      }
      return { ok: true };
    } catch(e) { return { error: "Error de conexión: "+e.message }; }
  };

  const saveUsers = async d => {
    setUsers(d);
    if (d && d.length) {
      const ok = await supa.upsert("usuarios", d.map(u=>({
        id: u.id||u.email.replace(/[^a-z0-9]/gi,"_"),
        nombre: u.nombre||"", email: u.email||"",
        rol: u.rol||"auxiliar",
        permisos: u.permisos||{},
        activo: u.activo!==false,
        avatar_url: u.avatar_url||"",
      }))).catch(e=>{ console.error("Sync usuarios:",e); return false; });
      if (ok === false) notify("Error al guardar usuarios.", "error");
    }
  };
  const saveFM = async d => {
    setFieldMap(d);
    const ok = await supa.upsert("configuracion",[{id:"fieldmap",clave:"fieldmap",valor:d}])
      .catch(e=>{ console.error("Sync fieldmap:",e); return false; });
    if (ok === false) notify("Error al guardar configuración.", "error");
  };
  const saveDoc = async d => {
    setDocentes(d);
    const ok = await syncDocentesToSupabase(d).catch(e=>{ console.error("Sync docentes:",e); return false; });
    if (ok === false) notify("Error al guardar docentes.", "error");
  };
  const saveNotif = async n => {
    setNotifCfg(n);
    const ok = await supa.upsert("configuracion",[{id:"notif",clave:"notif",valor:n}])
      .catch(e=>{ console.error("Sync notif:",e); return false; });
    if (ok === false) notify("Error al guardar notificaciones.", "error");
  };
  const notify    = (msg,type="success")=>{setNotif({msg,type});setTimeout(()=>setNotif(null),type==="error"?8000:4500);};
  const getProg   = ()=>(programas||[]).find(p=>p.id===selProg);
  const logout    = ()=>{localStorage.removeItem(SK2);setSession(null);setView("lista");};

  const abrirWhatsApp = (tipo, est, prog) => {
    const mf  = ((est.pago?.monto_acordado||0)*(1-(est.pago?.descuento_pct||0)/100));
    const n   = (est.pago?.parcialidades||[]).length;
    const mp  = n ? mf/n : 0;
    const pendientes = (est.pago?.parcialidades||[]).filter(x=>!x.pagado);
    const proxima    = pendientes.filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento>=today()).sort((a,b)=>a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0];
    const vencidas   = pendientes.filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento<today());
    const gen        = prog.generacion ? ` (${prog.generacion} generación)` : "";
    let msg = "";
    if(tipo==="proximo"){
      msg = [`Hola ${est.nombre},`,``,`Te recordamos que tienes una parcialidad próxima a vencer en *${prog.nombre}${gen}*:`,``,`• Monto: $${mp.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`• Fecha límite: ${proxima?fmtFecha(proxima.fecha_vencimiento):"próximamente"}`,``,`Realiza tu pago antes de la fecha límite para evitar el recargo del 6.5%.`,``,`Si ya realizaste tu pago, puedes ignorar este mensaje o avisarnos para confirmarlo.`].join("\n");
    } else if(tipo==="mensualidad"){
      const totalPend = mp*vencidas.length;
      const recargo = totalPend*(RECARGO_PCT/100);
      msg = [`Hola ${est.nombre},`,``,`Te informamos que tienes una mensualidad vencida en *${prog.nombre}${gen}*:`,``,`• Monto pendiente: $${totalPend.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`• Recargo por mora (6.5%): $${recargo.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`• Total a liquidar: $${(totalPend+recargo).toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,``,`Te pedimos realizar tu pago a la brevedad. Si ya lo realizaste, avísanos para registrarlo. Cualquier duda con gusto te atendemos.`].join("\n");
    } else if(tipo==="vencido"){
      const recargo = mp*(RECARGO_PCT/100)*vencidas.length;
      const totalPend = mp*vencidas.length;
      msg = [`Hola ${est.nombre},`,``,`Te contactamos porque tienes *${vencidas.length} pago${vencidas.length!==1?"s":""} vencido${vencidas.length!==1?"s":""}* en *${prog.nombre}${gen}*:`,``,`• Monto vencido: $${totalPend.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`• Recargo por mora (6.5%): $${recargo.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`• Total a regularizar: $${(totalPend+recargo).toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,``,`Te pedimos regularizar tu situación a la brevedad para continuar sin contratiempos. Si tienes alguna situacion especial, con gusto nos coordinamos.`].join("\n");
    }
    const tel = (est.telefono||"").replace(/\D/g,"");
    const num = tel.startsWith("52") ? tel : "52"+tel;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`,"_blank");
  };

  const abrirWAAsistencia = (est, prog, faltas) => {
    const msg = [
      `Hola ${est.nombre},`,``,
      `Desde la Coordinación de Educación Continua de IBERO Tijuana queremos estar en contacto contigo.`,``,
      `Hemos notado que tienes ${faltas} inasistencia${faltas!==1?"s":""} en *${prog.nombre}*. Sabemos que a veces la vida se complica y queremos saber cómo estás.`,``,
      `¿Hay algo en lo que te podamos apoyar para que puedas continuar con tu programa sin contratiempos?`,``,
      `Quedamos al pendiente. Con gusto nos coordinamos.`
    ].join("\n");
    const tel=(est.telefono||"").replace(/\D/g,"");
    const num=tel.startsWith("52")?tel:"52"+tel;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`,"_blank");
  };

  const abrirCorreo = (tipo, est, prog) => {
    const mf  = ((est.pago?.monto_acordado||0)*(1-(est.pago?.descuento_pct||0)/100));
    const n   = (est.pago?.parcialidades||[]).length;
    const mp  = n ? mf/n : 0;
    const pendientes = (est.pago?.parcialidades||[]).filter(x=>!x.pagado);
    const proxima    = pendientes.filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento>=today()).sort((a,b)=>a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0];
    const vencidas   = pendientes.filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento<today());
    const gen        = prog.generacion ? ` (${prog.generacion} generación)` : "";
    let subject="", body="";
    if(tipo==="proximo"){
      subject = `Recordatorio de pago — ${prog.nombre}`;
      body = [`Estimado/a ${est.nombre},`,``,`Esperamos que estés aprovechando al máximo el ${prog.nombre}${gen}.`,``,`Te recordamos que tienes una parcialidad próxima a vencer:`,``,`  • Monto: $${mp.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`  • Fecha límite: ${proxima?fmtFecha(proxima.fecha_vencimiento):"próximamente"}`,``,`Realiza tu pago antes de la fecha límite para evitar el recargo del 6.5%.`,``,`Si ya realizaste tu pago, ignora este mensaje o escríbenos para confirmarlo.`].join("\n");
    } else if(tipo==="mensualidad"){
      const totalPend = mp*vencidas.length;
      const recargo = totalPend*(RECARGO_PCT/100);
      subject = `Aviso de mensualidad vencida — ${prog.nombre}`;
      body = [`Estimado/a ${est.nombre},`,``,`Te informamos que tienes una mensualidad vencida en el programa ${prog.nombre}${gen}.`,``,`  • Monto pendiente: $${totalPend.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`  • Recargo por mora (6.5%): $${recargo.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`  • Total a liquidar: $${(totalPend+recargo).toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,``,`Te pedimos realizar tu pago a la brevedad. Si ya lo realizaste, puedes ignorar este mensaje o escríbenos para confirmarlo. Cualquier duda, con gusto te atendemos.`].join("\n");
    } else if(tipo==="vencido"){
      const recargo = mp*(RECARGO_PCT/100)*vencidas.length;
      const totalPend = mp*vencidas.length;
      subject = `Aviso de pago vencido — ${prog.nombre}`;
      body = [`Estimado/a ${est.nombre},`,``,`Nos comunicamos contigo porque tienes ${vencidas.length} pago${vencidas.length!==1?"s":""} vencido${vencidas.length!==1?"s":""} en el programa ${prog.nombre}${gen}.`,``,`  • Monto vencido: $${totalPend.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`  • Recargo por mora (6.5%): $${recargo.toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,`  • Total a regularizar: $${(totalPend+recargo).toLocaleString("es-MX",{maximumFractionDigits:0})} MXN`,``,`Te pedimos regularizar tu situación a la brevedad para continuar sin contratiempos.`,``,`Si tienes alguna situación especial, con gusto podemos coordinarnos.`].join("\n");
    }
    window.open(`mailto:${est.email||""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,"_blank");
  };

  const abrirEvaluacion = (tipo, est, prog, mod) => {
    const url = tipo==="modulo"
      ? "https://www.educon.iberotijuana.edu.mx/evaluaciones_parciales"
      : "https://www.educon.iberotijuana.edu.mx/evaluaciones";
    const gen = prog.generacion ? ` (${prog.generacion} generación)` : "";
    const subject = tipo==="modulo"
      ? `Tu evaluación del módulo: ${mod?.nombre||""}`
      : `Evaluación final — ${prog.nombre}`;
    const body = [`Estimado/a ${est.nombre},`,``,tipo==="modulo"?`Hemos concluido el módulo "${mod?.nombre||""}" del programa ${prog.nombre}${gen}. Nos interesa conocer tu experiencia.`:`Hemos concluido el programa ${prog.nombre}${gen}. Tu opinión es fundamental para nosotros.`,``,`Por favor dedica unos minutos a completar la evaluación (5 preguntas):`,``,url,``,`¡Muchas gracias por tu participación!`,``,`Atentamente,`,`[Tu nombre]`,`Coordinación de Educación Continua — IBERO Tijuana`].join("\n");
    window.open(`mailto:${est.email||""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,"_blank");
  };

  const saveNPS = async (progId, modId, docenteId, docenteNombre, respuestas) => {
    const progObj = (programas||[]).find(p=>p.id===progId);
    const modObj  = mods(progObj||{}).find(m=>m.id===modId);
    const vals = [respuestas.q1,respuestas.q2,respuestas.q3,respuestas.q4,respuestas.q5].filter(Boolean);
    const nueva = {
      id:newId(), fecha:today(),
      progId, modId, docenteId, docenteNombre,
      prog:progObj?.nombre||"", mod:modObj?.nombre||"",
      ...respuestas,
      promedio: vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10 : 0,
    };
    // Guardar en Supabase
    await supa.upsert("evaluaciones_nps", [{
      id: nueva.id,
      programa_id: progId,
      modulo_id: modId,
      docente_id: docenteId||null,
      docente_nombre: docenteNombre||"",
      q1: nueva.q1||null, q2: nueva.q2||null, q3: nueva.q3||null,
      q4: nueva.q4||null, q5: nueva.q5||null,
      promedio: nueva.promedio,
      comentarios: respuestas.comentarios||"",
      fecha: nueva.fecha,
    }]);
    // También actualizar estado local
    const d = [...npsData, nueva];
    localStorage.setItem("ibero_nps", JSON.stringify(d));
    setNpsData(d);
    notify("Evaluación guardada.");
  };

  const generarLink = (progId,modId) => {
    const token=btoa(JSON.stringify({progId,modId}));
    const url=window.location.href.split("?")[0]+"?lista="+token;
    navigator.clipboard.writeText(url).then(()=>{setLinkCop(progId+"_"+modId);setTimeout(()=>setLinkCop(""),3000);});
  };

  const generarEnlaceEval = (progId, modId) => {
    const token = btoa(JSON.stringify({progId,modId}));
    const url   = window.location.href.split("?")[0]+"?eval="+token;
    navigator.clipboard.writeText(url).then(()=>{
      setLinkCop("eval_"+progId+"_"+modId);
      setTimeout(()=>setLinkCop(""),4000);
    });
    return url;
  };

  const enviarEvalPorCorreo = (progId, modId) => {
    const prog = (programas||[]).find(p=>p.id===progId);
    const mod  = mods(prog||{}).find(m=>m.id===modId);
    if (!prog||!mod) return;
    const token = btoa(JSON.stringify({progId,modId}));
    const url   = window.location.href.split("?")[0]+"?eval="+token;
    // Copiar enlace al clipboard también
    navigator.clipboard.writeText(url);
    setLinkCop("eval_"+progId+"_"+modId);
    setTimeout(()=>setLinkCop(""),4000);
    // Estudiantes del módulo (activos, con email)
    const estudiantesConEmail = ests(prog).filter(e=>e.estatus!=="baja"&&e.estatus!=="inactivo"&&e.email);
    const cco = estudiantesConEmail.map(e=>e.email).join(",");
    const gen = prog.generacion ? ` — ${prog.generacion} generación` : "";
    const subject = `Evaluación del módulo: ${mod.nombre}`;
    const body = [
      `Estimados participantes,`,``,
      `Hemos concluido el módulo "${mod.nombre}" del programa ${prog.nombre}${gen}.`,``,
      `Nos interesa mucho conocer tu experiencia para seguir mejorando. Por favor dedica 3 minutos a responder esta evaluación anónima:`,``,
      url,``,
      `Tu opinión es completamente anónima y muy valiosa para nosotros.`,``,
      `¡Muchas gracias!`,``,
      `Coordinación de Educación Continua`,
      `IBERO Tijuana`,
      `Tel: 664 630 1577 Ext. 2576`,
    ].join("\n");
    // mailto con CCO (bcc)
    const mailto = `mailto:?bcc=${encodeURIComponent(cco)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto,"_blank");
  };

  const saveAsistDocente = (progId,modId,updated) => {
    save((programas||[]).map(p=>{
      if(p.id!==progId) return p;
      return{...p,estudiantes:ests(p).map(e=>{const u=updated.find(eu=>eu.id===e.id);return u?{...e,asistencia:{...(e.asistencia||{}),...(u.asistencia||{})}}:e;})};
    }));
    const k = "mod_"+modId;
    const hoy = today();
    const presentes = [];
    const ausentes  = [];
    updated.forEach(e=>{
      const fechas = e.asistencia&&e.asistencia[k];
      const estaHoy = Array.isArray(fechas) && fechas.includes(hoy);
      if(estaHoy){
        presentes.push({ id: e.id+"_"+modId+"_"+hoy, estudiante_id: e.id, modulo_id: modId, fecha: hoy });
      } else {
        ausentes.push(e.id+"_"+modId+"_"+hoy);
      }
    });
    // Insertar presentes
    if(presentes.length) supa.upsert("asistencia", presentes).catch(e=>console.error("Sync asist docente:",e));
    // Borrar ausentes (por si estaban marcados antes)
    ausentes.forEach(id => supa.del("asistencia", id).catch(e=>console.error("Del asist:",e)));
  };

  const isPublic   = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("lista");
  const isEval     = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("eval");
  const isOrden    = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("orden");
  const isFiscal   = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("fiscal");
  const isReporte  = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("reporte");
  if (!ready) return null;
  if (isOrden)   return <OrdenPago/>;
  if (isFiscal)  return <FiscalFormPage/>;
  if (isEval)    return <EvaluacionDocente programas={programas}/>;
  if (isPublic)  return <ListaDocente programas={programas} onSave={saveAsistDocente}/>;
  if (isReporte) return <ReporteDocentePublico/>;
  if (!session) return <LoginScreen onLogin={u=>setSession(u)}/>;

  const prog    = getProg();
  const alertaKey = a => {
    if(a.tipo==="sin_docente")         return `sin_docente_${a.mod.id}`;
    if(a.tipo==="sin_confirmar")       return `sin_confirmar_${a.mod.id}`;
    if(a.tipo==="recordatorio_docente") return `recordatorio_docente_${a.mod.id}`;
    if(a.tipo==="factura_docente")      return `factura_docente_${a.mod.id}`;
    if(a.tipo==="asistencia")          return `asistencia_${a.est.id}_${a.prog.id}`;
    if(a.tipo==="pago_recargo")        return `pago_recargo_${a.est.id}`;
    if(a.tipo==="pago_critico")        return `pago_critico_${a.est.id}`;
    if(a.tipo==="orden_firmada")       return `orden_firmada_${a.orden.id}`;
    return `alerta_${Math.random()}`;
  };

  const _buildCalMsg = (mod, prog, tipo) => {
    const fechas = getFechasMod(mod);
    const totalH = (mod.clases||0)*(mod.horasPorClase||0);
    const gen = prog.generacion ? ` (${prog.generacion} generación)` : "";
    if(tipo==="wa"){
      return [
        `Hola ${mod.docente},`,``,
        `Te compartimos el calendario de tu módulo en *${prog.nombre}${gen}*:`,``,
        `Módulo ${mod.numero}: ${mod.nombre}`,
        `Período: ${fmtFecha(mod.fechaInicio)} — ${fmtFecha(mod.fechaFin)}`,
        mod.horario?`Horario: ${mod.horario}`:"",
        mod.dias&&mod.dias.length?`Días: ${mod.dias.join(", ")}`:"",``,
        fechas.length?`Fechas de clase:\n${fechas.map((f,i)=>`  ${i+1}. ${fmtFecha(f)}`).join("\n")}`:"",``,
        `Total: ${mod.clases} sesion${mod.clases!==1?"es":""} de ${mod.horasPorClase}h — ${totalH}h en total.`,``,
        `Quedamos al pendiente para cualquier duda. Gracias.`
      ].filter(l=>l!==undefined).join("\n");
    } else {
      const subject = `Calendario de módulo — ${mod.nombre} · ${prog.nombre}`;
      const body = [
        `Estimado/a ${mod.docente},`,``,
        `Confirmamos tu participación como docente en el siguiente módulo:`,``,
        `  Programa: ${prog.nombre}${gen}`,
        `  Módulo ${mod.numero}: ${mod.nombre}`,
        `  Período: ${fmtFecha(mod.fechaInicio)} — ${fmtFecha(mod.fechaFin)}`,
        mod.horario?`  Horario: ${mod.horario}`:"",
        mod.dias&&mod.dias.length?`  Días: ${mod.dias.join(", ")}`:"",``,
        fechas.length?`Fechas de clase:\n${fechas.map((f,i)=>`  ${i+1}. ${fmtFecha(f)}`).join("\n")}`:"",``,
        `  Total: ${mod.clases} sesion${mod.clases!==1?"es":""} de ${mod.horasPorClase}h — ${totalH}h en total.`,``,
        `Quedamos al pendiente para cualquier duda.`,``,
        `Atentamente,`,`Coordinación de Educación Continua — IBERO Tijuana`
      ].filter(l=>l!==undefined).join("\n");
      return {subject, body};
    }
  };

  const toggleHonorario = (progId, modId, field) => {
    save((programas||[]).map(p=>p.id!==progId?p:{...p,modulos:mods(p).map(m=>m.id!==modId?m:{...m,[field]:!m[field]})}));
  };

  const enviarCalendarioWA = (mod, prog) => {
    const doc = (docentes||[]).find(d=>d.id===mod.docenteId||d.nombre===mod.docente);
    const tel = (doc?.telefono||"").replace(/\D/g,"");
    if(!tel){notify("El docente no tiene teléfono registrado en el catálogo.","error");return;}
    const num = tel.startsWith("52")?tel:"52"+tel;
    const msg = _buildCalMsg(mod,prog,"wa");
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`,"_blank");
  };

  const enviarCalendarioEmail = (mod, prog) => {
    const doc = (docentes||[]).find(d=>d.id===mod.docenteId||d.nombre===mod.docente);
    const email = mod.emailDocente || doc?.email || "";
    if(!email){notify("El docente no tiene correo registrado.","error");return;}
    const {subject,body} = _buildCalMsg(mod,prog,"email");
    window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,"_blank");
  };
  const guardarAlertasDesc = async (nuevas) => {
    setAlertasDesc(nuevas);
    await supa.upsert("configuracion",[{id:"alertas_desc",clave:"alertas_desc",alertas_descartadas:nuevas}]);
  };
  const descartarAlerta = key => guardarAlertasDesc([...alertasDesc, key]);
  const descartarTodas = () => {
    const keys = alertasVisible.map(alertaKey);
    guardarAlertasDesc([...new Set([...alertasDesc, ...keys])]);
    setShowAl(false);
  };
  const alertasTodas  = [
    ...getAlertas(programas),
    ...(ordenes||[]).filter(o=>o.estatus==="firmada").map(o=>({tipo:"orden_firmada",orden:o})),
  ];
  const alertasVisible = alertasTodas.filter(a=>!alertasDesc.includes(alertaKey(a)));
  const alertas = alertasVisible;

  const progsF = (programas||[]).filter(p=>{
    const q=busqProg.toLowerCase();
    return (!busqProg||p.nombre.toLowerCase().includes(q))&&(!filtroProg||p.tipo===filtroProg)&&(!filtroSt||progStatus(p)===filtroSt);
  });

  const egresados = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus==="egresado").map(e=>({...e,programa:p.nombre})));
  const activos   = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus!=="egresado"&&e.estatus!=="baja"&&e.estatus!=="inactivo"&&progStatus(p)==="activo"));
  const bajas     = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus==="baja"));
  const inactivos = (programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus==="inactivo").map(e=>({...e,programa:p.nombre})));
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

  const saveEstudiante = (progId,estId,datos)=>{
    save((programas||[]).map(p=>p.id!==progId?p:{...p,estudiantes:ests(p).map(e=>e.id!==estId?e:{...e,...datos})}));
    notify("Datos actualizados.");
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
        const presente = fechas.includes(fecha);
        if(presente) fechas=fechas.filter(f=>f!==fecha);
        else fechas=[...fechas,fecha];
        // Sincronizar a Supabase tabla asistencia
        if(!presente){
          // Marcar presente — insertar
          supa.upsert("asistencia",[{
            id: estId+"_"+modId+"_"+fecha,
            estudiante_id: estId,
            modulo_id: modId,
            fecha: fecha,
          }]).catch(e=>console.error("Sync asistencia:",e));
        } else {
          // Desmarcar — eliminar
          supa.del("asistencia", estId+"_"+modId+"_"+fecha)
            .catch(e=>console.error("Del asistencia:",e));
        }
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
    const rows=ests(prog).filter(e=>e.estatus!=="baja").map(e=>({
      "Nombre":            e.nombre||"",
      "Correo":            e.email||"",
      "Teléfono":          e.telefono||"",
      "Empresa":           e.empresa||"",
      "Puesto":            e.puesto||"",
      "Carrera":           e.carrera||"",
      "Último grado":      e.grado||"",
      "Egresado IBERO":    e.egresado_ibero||"",
      "Requiere factura":  e.requiere_factura||"",
    }));
    if(!rows.length)return;
    const hdr=Object.keys(rows[0]);
    const csv=[hdr.join(","),...rows.map(r=>hdr.map(h=>'"'+(r[h]||"").toString().replace(/"/g,'""')+'"').join(","))].join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
    a.download="Lista_"+prog.nombre.replace(/\s+/g,"_")+".csv";
    a.click();
    notify("Lista exportada con campos completos.");
  };

  const exportPDF = prog => {
    const ms = mods(prog);
    const DIAS_S = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

    // Recopilar todas las fechas de clase por módulo
    const todasFechas = [];
    ms.forEach(mod => {
      const fechas = getFechasMod(mod);
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
      .header{background:#C8102E;padding:20px 36px;margin-bottom:32px;display:flex;align-items:center;gap:24px;}
      .header img{height:52px;width:auto;object-fit:contain;filter:brightness(0) invert(1);}
      .header-text{}
      .header h1{color:#fff;font-size:22px;font-weight:900;margin:0;letter-spacing:2px;font-family:Arial,sans-serif;}
      .header p{color:rgba(255,255,255,0.8);margin:3px 0 0;font-size:10px;letter-spacing:3px;font-family:Arial,sans-serif;}
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
    <div class="header"><img src="${IBERO_LOGO}" alt="IBERO"/><div class="header-text"><h1>IBERO TIJUANA</h1><p>COORDINACIÓN DE EDUCACIÓN CONTINUA</p></div></div>
    <div class="prog-title">${prog.nombre}</div>
    <div class="prog-meta">${prog.tipo}${prog.modalidad?" · "+prog.modalidad:""}${prog.generacion?" · "+prog.generacion+" generación":""}</div>`;

    // Tabla de módulos
    html += `<div class="section-title">Módulos del programa</div>
    <table class="modulos"><thead><tr>
      <th>Módulo</th><th>Nombre</th><th>Docente</th><th>Fechas</th><th>Días</th><th>Horas</th>
    </tr></thead><tbody>`;
    ms.forEach(m=>{
      const totalH=(m.clases||0)*(m.horasPorClase||0);
      const fechas=getFechasMod(m);
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
    // Auto-generar fechasClase si no se confirmaron manualmente
    let modFinal = {...modForm};
    if(!modFinal.fechasClase||modFinal.fechasClase.length===0){
      if(modFinal.fechaInicio&&modFinal.fechaFin&&modFinal.dias&&modFinal.dias.length){
        modFinal.fechasClase = generarFechasClase(modFinal.fechaInicio,modFinal.fechaFin,modFinal.dias,modFinal.clases);
      }
    }
    // Sincronizar fechaInicio y fechaFin con la primera y última fecha real
    if(modFinal.fechasClase&&modFinal.fechasClase.length>0){
      modFinal.fechaInicio = modFinal.fechasClase[0];
      modFinal.fechaFin    = modFinal.fechasClase[modFinal.fechasClase.length-1];
    }
    // Si el docente fue escrito manualmente y no existe en el catálogo, crearlo automáticamente
    // No asignamos docenteId al módulo todavía para evitar FK issues — la vinculación es por nombre
    if(!modFinal.docenteId && modFinal.docente){
      const yaExiste=(docentes||[]).find(d=>d.nombre.trim().toLowerCase()===modFinal.docente.trim().toLowerCase());
      if(!yaExiste){
        const nuevoDoc={id:newId(),nombre:modFinal.docente,email:modFinal.emailDocente||"",telefono:"",grados:[],programas_egreso:{},categoria:"A",semblanza:"",iva:16,honorariosPorHora:0,banco:"",clabe:"",rfc:"",perfil_incompleto:true};
        setDocentes([...(docentes||[]),nuevoDoc]);
        supa.upsert("docentes",[{id:nuevoDoc.id,nombre:nuevoDoc.nombre,email:nuevoDoc.email,telefono:"",grado:"Licenciatura",grados:[],programas_egreso:{},categoria:"A",semblanza:"",iva:16,honorarios_por_hora:0,banco:"",clabe:"",rfc:""}]).catch(e=>console.error("Auto-create docente:",e));
        notify("Docente creado — completa su perfil en la sección Docentes","warning");
      }
    }
    save((programas||[]).map(p=>p.id===selProg?{...p,modulos:editMod?mods(p).map(m=>m.id===editMod?modFinal:m):[...mods(p),modFinal]}:p));
    setShowModM(false);
    notify((editMod?"Módulo actualizado":"Módulo agregado")+(modFinal.fechasClase?.length?" · "+modFinal.fechasClase.length+" fechas confirmadas":""));
  };
  const delMod  = id=>{
    save((programas||[]).map(p=>p.id===selProg?{...p,modulos:mods(p).filter(m=>m.id!==id)}:p));
    supa.del("modulos",id).catch(e=>console.error("Del mod:",e));
    notify("Módulo eliminado","warning");
  };
  const openNewProg=()=>{setProgForm({...eProg,id:newId()});setEditProgId(null);setShowProgM(true);};
  const openEditProg=p=>{
    const modalFija=MODALIDADES.map(m=>m.valor).includes(p.modalidad);
    setProgForm({...p,modalidad:modalFija?p.modalidad:"Otro",modalidadCustom:modalFija?"":p.modalidad});
    setEditProgId(p.id);setShowProgM(true);
  };
  const saveProg=()=>{
    if(!progForm.nombre){notify("Ingresa el nombre","error");return;}
    const tipo=progForm.tipo==="Otro"?(progForm.tipoCustom||"Otro"):progForm.tipo;
    const modalidad=progForm.modalidad==="Otro"?(progForm.modalidadCustom||"Otro"):progForm.modalidad;
    if(editProgId){
      save((programas||[]).map(p=>p.id===editProgId?{...progForm,tipo,modalidad}:p));
      setShowProgM(false);notify("Programa actualizado");
    } else {
      save([...(programas||[]),{...progForm,tipo,modalidad}]);setShowProgM(false);notify("Programa agregado");
    }
  };
  const delProg = id=>{
    save((programas||[]).filter(p=>p.id!==id));
    // Eliminar de Supabase — CASCADE borra módulos, estudiantes, pagos y asistencia
    supa.del("programas",id).catch(e=>console.error("Del prog:",e));
    notify("Programa eliminado","warning");
  };

  return(
    <div style={{fontFamily:FONT_BODY,minHeight:"100vh",background:"#F7F7F8",color:"#111",display:"flex"}}>
      {notif&&(
        <div style={{position:"fixed",top:20,right:20,zIndex:9999,display:"flex",alignItems:"center",gap:10,background:"#fff",border:"1px solid "+(notif.type==="error"?"#FCA5A5":notif.type==="warning"?"#FCD34D":"#86EFAC"),borderRadius:12,padding:"12px 18px",fontSize:13,maxWidth:360,boxShadow:"0 8px 30px rgba(0,0,0,0.1)",fontFamily:FONT_BODY,fontWeight:500,color:notif.type==="error"?"#DC2626":notif.type==="warning"?"#D97706":"#16A34A"}}>
          <span style={{fontSize:15,fontWeight:700}}>{notif.type==="error"?"✕":notif.type==="warning"?"⚠":"✓"}</span>
          <span>{notif.msg}</span>
        </div>
      )}

      {/* ── SIDEBAR ───────────────────────────────────────── */}
      <div style={{position:"fixed",left:0,top:0,bottom:0,width:240,background:"#fff",borderRight:"1px solid #EBEBEB",display:"flex",flexDirection:"column",zIndex:100}}>
        {/* Logo */}
        <div style={{background:"#eb1d33",padding:"20px 20px 16px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:8}} onClick={()=>setView("dashboard")}>
          <img src="https://assets.cdn.filesafe.space/musPifv2JmLrY1uT63Kw/media/698a46bb863b271f12cbe5cf.png" alt="IBERO Tijuana" style={{height:52,width:"auto"}} onError={e=>{e.target.style.display="none";}}/>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.75)",letterSpacing:"0.16em",textTransform:"uppercase",fontFamily:FONT_BODY}}>Educación Continua</div>
        </div>
        {/* Nav groups */}
        <div style={{flex:1,padding:"8px 10px",overflowY:"auto"}}>
          {([
            {group:"Coordinación",items:[
              {v:"dashboard",l:"Dashboard",  perm:"verProgramas"},
              {v:"lista",   l:"Programas",  perm:"verProgramas"},
              {v:"hoy",     l:"Hoy",        perm:"verProgramas"},
              {v:"calendario",l:"Calendario",perm:"verProgramas"},
            ]},
            {group:"Académico",items:[
              {v:"asistencia",  l:"Asistencia",  perm:"verAsistencia"},
              {v:"evaluaciones",l:"Evaluaciones", perm:"verEvaluaciones"},
            ]},
            {group:"Finanzas",items:[
              {v:"pagos_global",l:"Pagos",       perm:"verPagos"},
              {v:"cobranza",    l:"Cobranza",    perm:"verPagos"},
              {v:"facturacion", l:"Facturación", perm:"verFacturacion"},
              {v:"honorarios",  l:"Honorarios",  perm:"verFacturacion"},
            ]},
            {group:"Administración",items:[
              {v:"docentes", l:"Docentes", perm:"gestionarDocentes"},
              {v:"reportes", l:"Reportes", perm:"verReportes"},
            ]},
          ]).map(({group,items})=>{
            const vis=items.filter(({perm})=>can(session,perm));
            if(!vis.length)return null;
            return(
              <div key={group} style={{marginBottom:6}}>
                <div style={{fontSize:10,fontWeight:700,color:"#B8BCC8",letterSpacing:"0.1em",textTransform:"uppercase",padding:"14px 10px 5px",fontFamily:FONT_BODY}}>{group}</div>
                {vis.map(({v,l})=>{
                  const active=view===v||(v==="lista"&&view==="programa");
                  return(
                    <button key={v} onClick={()=>setView(v)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:active?"#FFF1F2":"transparent",color:active?RED:"#4B5563",border:"none",borderRadius:8,padding:"9px 12px",cursor:"pointer",fontSize:13,fontFamily:FONT_BODY,fontWeight:active?600:400,marginBottom:1,transition:"all .1s"}}>
                      <span style={{width:7,height:7,borderRadius:"50%",background:active?RED:"#D1D5DB",flexShrink:0}}/>
                      {l}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div style={{marginBottom:6}}>
            <div style={{fontSize:10,fontWeight:700,color:"#B8BCC8",letterSpacing:"0.1em",textTransform:"uppercase",padding:"14px 10px 5px",fontFamily:FONT_BODY}}>Sistema</div>
            <button onClick={()=>setView("busqueda")} style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:view==="busqueda"?"#FFF1F2":"transparent",color:view==="busqueda"?RED:"#4B5563",border:"none",borderRadius:8,padding:"9px 12px",cursor:"pointer",fontSize:13,fontFamily:FONT_BODY,fontWeight:view==="busqueda"?600:400,marginBottom:1}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:view==="busqueda"?RED:"#D1D5DB",flexShrink:0}}/>
              Búsqueda
            </button>
            {(can(session,"gestionarUsuarios")||can(session,"configurarNotif"))&&(
              <button onClick={()=>setView("config")} style={{display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:view==="config"?"#FFF1F2":"transparent",color:view==="config"?RED:"#4B5563",border:"none",borderRadius:8,padding:"9px 12px",cursor:"pointer",fontSize:13,fontFamily:FONT_BODY,fontWeight:view==="config"?600:400,marginBottom:1}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:view==="config"?RED:"#D1D5DB",flexShrink:0}}/>
                Configuración
              </button>
            )}
          </div>
        </div>
        {/* User footer */}
        <div style={{padding:"14px 16px",borderTop:"1px solid #F3F4F6"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:RED,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,fontFamily:FONT_TITLE,flexShrink:0}}>
              {(session.nombre||"U").charAt(0).toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,fontFamily:FONT_BODY,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#111"}}>{session.nombre}</div>
              <div style={{fontSize:11,color:"#9CA3AF",fontFamily:FONT_BODY,textTransform:"capitalize"}}>{session.rol}</div>
            </div>
            <button onClick={logout} title="Cerrar sesión" style={{background:"none",border:"1px solid #E5E7EB",borderRadius:6,padding:"4px 9px",cursor:"pointer",fontSize:11,color:"#9CA3AF",fontFamily:FONT_BODY,flexShrink:0,fontWeight:500}}>Salir</button>
          </div>
        </div>
      </div>

      {/* ── MAIN AREA ─────────────────────────────────────── */}
      <div style={{marginLeft:240,flex:1,display:"flex",flexDirection:"column",minHeight:"100vh",minWidth:0}}>
        {/* TOP BAR */}
        <div style={{height:54,background:"#fff",borderBottom:"1px solid #EBEBEB",padding:"0 32px",display:"flex",alignItems:"center",gap:14,position:"sticky",top:0,zIndex:90,flexShrink:0}}>
          <div style={{flex:1,fontWeight:700,fontSize:15,fontFamily:FONT_TITLE,letterSpacing:"-0.3px",color:"#111"}}>
            {view==="dashboard"?"Dashboard":view==="lista"||view==="programa"?"Programas":view==="hoy"?"Hoy":view==="calendario"?"Calendario":view==="asistencia"?"Asistencia":view==="pagos_global"?"Control de Pagos":view==="cobranza"?"Cobranza":view==="facturacion"?"Facturación":view==="honorarios"?"Honorarios Docentes":view==="docentes"?"Docentes":view==="evaluaciones"?"Evaluaciones":view==="reportes"?"Reportes":view==="busqueda"?"Búsqueda":view==="config"?"Configuración":""}
          </div>
          {/* Presencia — quién está conectado (incluye usuario actual) */}
          {(()=>{
            const yo = session ? { email: session.email, nombre: session.nombre||session.email, esYo: true } : null;
            const todos = [...(yo?[yo]:[]), ...presencia];
            if(!todos.length) return null;
            return (
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {todos.map(u=>{
                  const iniciales=(u.nombre||u.email).split(" ").filter(Boolean).slice(0,2).map(p=>p[0].toUpperCase()).join("");
                  return(
                    <div key={u.email} title={u.esYo?"Tú":u.nombre} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <div style={{position:"relative",width:32,height:32,flexShrink:0}}>
                        <div style={{width:32,height:32,borderRadius:"50%",overflow:"hidden",border:u.esYo?"2px solid #22c55e":"2px solid #fff",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}}>
                          {getAvatar(u.email)
                            ? <img src={getAvatar(u.email)} alt={u.nombre} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            : <div style={{width:"100%",height:"100%",background:RED,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",fontFamily:FONT_BODY}}>{iniciales}</div>
                          }
                        </div>
                        {u.esYo&&<div style={{position:"absolute",bottom:0,right:0,width:9,height:9,borderRadius:"50%",background:"#22c55e",border:"1.5px solid #fff"}}/>}
                      </div>
                      <span style={{fontSize:9,fontWeight:700,color:u.esYo?"#22c55e":"#6b7280",fontFamily:FONT_BODY,letterSpacing:"0.3px"}}>{u.esYo?"Tú":iniciales}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {/* Alertas */}
          <div ref={alertRef} style={{position:"relative"}}>
            <button onClick={()=>setShowAl(!showAlertas)} style={{background:alertas.length>0?"#FFF1F2":"#F7F7F8",border:"1px solid "+(alertas.length>0?"#FCA5A5":"#E5E7EB"),borderRadius:8,padding:"6px 14px",cursor:"pointer",color:alertas.length>0?RED:"#6B7280",fontFamily:FONT_BODY,fontSize:12,fontWeight:alertas.length>0?700:500,display:"flex",alignItems:"center",gap:7}}>
              {alertas.length>0&&<div style={{width:7,height:7,borderRadius:"50%",background:RED,flexShrink:0}}/>}
              {alertas.length>0?"Alertas ("+alertas.length+")":"Sin alertas"}
            </button>
            {showAlertas&&(
              <div style={{position:"absolute",right:0,top:"calc(100% + 8px)",background:"#fff",border:"1px solid #EBEBEB",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.12)",width:360,zIndex:999,overflow:"hidden"}}>
                <div style={{padding:"14px 18px",borderBottom:"1px solid #F3F4F6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:700,fontSize:14,fontFamily:FONT_BODY}}>{alertas.length>0?"Alertas activas":"Sin alertas pendientes"}</span>
                  {alertas.length>0&&<button onClick={descartarTodas} style={{fontSize:11,color:"#9CA3AF",background:"none",border:"1px solid #E5E7EB",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontFamily:FONT_BODY,fontWeight:500}}>Borrar todas</button>}
                </div>
                {alertas.length===0&&<div style={{padding:28,textAlign:"center",color:"#9ca3af",fontFamily:FONT_BODY,fontSize:13}}>Todo en orden ✓</div>}
                <div style={{maxHeight:400,overflowY:"auto"}}>
                  {alertas.map((a,i)=>{
                    const dot = a.tipo==="pago_critico"?"#dc2626":a.tipo==="pago_recargo"?"#d97706":a.tipo==="factura_docente"?"#7c3aed":a.tipo==="asistencia"?"#ea580c":a.tipo==="recordatorio_docente"?"#2563eb":a.tipo==="sin_confirmar"?"#f59e0b":a.tipo==="orden_firmada"?"#16a34a":"#6b7280";
                    const irA = () => {
                      if(a.tipo==="pago_critico"||a.tipo==="pago_recargo"){setView("pagos_global");setProgPagos(a.prog.id);setShowAl(false);}
                      else if(a.tipo==="asistencia"){setView("asistencia");setShowAl(false);}
                      else if(a.tipo==="sin_docente"||a.tipo==="sin_confirmar"){setSelProg(a.prog.id);setProgTab("modulos");setView("programa");setShowAl(false);}
                      else if(a.tipo==="factura_docente"||a.tipo==="recordatorio_docente"){setView("honorarios");setShowAl(false);}
                      else if(a.tipo==="orden_firmada"){window.open(window.location.href.split("?")[0]+"?orden="+a.orden.id,"_blank");setShowAl(false);}
                    };
                    return(
                      <div key={i} style={{padding:"12px 18px",borderBottom:"1px solid #F9F9F9",display:"flex",gap:12,alignItems:"flex-start"}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:dot,marginTop:5,flexShrink:0}}/>
                        <div style={{flex:1,fontFamily:FONT_BODY,minWidth:0}}>
                          {a.tipo==="sin_docente"&&<>
                            <div style={{fontWeight:600,fontSize:13,color:"#374151"}}>Sin docente asignado</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.mod.nombre} · {a.prog.nombre}<br/>Inicia en {a.dias} día{a.dias!==1?"s":""}</div>
                          </>}
                          {a.tipo==="sin_confirmar"&&<>
                            <div style={{fontWeight:600,fontSize:13,color:"#92400e"}}>Docente sin confirmar</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.mod.nombre} · {a.prog.nombre}<br/>Inicia en {a.dias} día{a.dias!==1?"s":""} — estatus: propuesta</div>
                          </>}
                          {a.tipo==="recordatorio_docente"&&<>
                            <div style={{fontWeight:600,fontSize:13,color:"#2563eb"}}>Recordar calendario al docente</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.mod.docente} · {a.mod.nombre}<br/>{a.prog.nombre} — inicia en {a.dias} día{a.dias!==1?"s":""}</div>
                          </>}
                          {a.tipo==="factura_docente"&&<>
                            <div style={{fontWeight:700,fontSize:13,color:"#7c3aed"}}>Factura pendiente — vence día 20</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.mod.docente} · {a.mod.nombre}<br/>{a.prog.nombre} · Termina {fmtFecha(a.mod.fechaFin)}</div>
                          </>}
                          {a.tipo==="asistencia"&&<>
                            <div style={{fontWeight:600,fontSize:13,color:"#ea580c"}}>{a.est.nombre} — {a.faltas} falta{a.faltas!==1?"s":""}</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.prog.nombre} · {a.mod?.nombre||""}</div>
                          </>}
                          {a.tipo==="pago_recargo"&&<>
                            <div style={{fontWeight:600,fontSize:13,color:"#d97706"}}>{a.est.nombre} — 1 pago vencido</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.prog.nombre}<br/>Recargo: {fmtMXN(a.recargo)}</div>
                          </>}
                          {a.tipo==="pago_critico"&&<>
                            <div style={{fontWeight:700,fontSize:13,color:"#dc2626"}}>{a.est.nombre} — {a.vencidas} pagos vencidos</div>
                            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.prog.nombre}<br/>Recargo acumulado: {fmtMXN(a.recargo)}</div>
                          </>}
                          {a.tipo==="orden_firmada"&&(()=>{
                            const MESES_N=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
                            const mes=a.orden.datos?.mes||"";
                            const mesLabel=mes?MESES_N[parseInt(mes.split("-")[1])-1]+" "+mes.split("-")[0]:"";
                            return<>
                              <div style={{fontWeight:700,fontSize:13,color:"#16a34a"}}>✓ Solicitud firmada — lista para descargar</div>
                              <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{mesLabel&&<>{mesLabel} · </>}Ambas firmas completadas</div>
                            </>;
                          })()}
                          <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                            <button onClick={irA} style={{fontSize:11,fontWeight:600,fontFamily:FONT_BODY,background:"#F7F7F8",border:"1px solid #E5E7EB",borderRadius:6,padding:"3px 10px",cursor:"pointer",color:"#374151"}}>Ver</button>
                            {(a.tipo==="pago_recargo"||a.tipo==="pago_critico")&&(
                              <button onClick={()=>abrirWhatsApp("vencido",a.est,a.prog)} style={{fontSize:11,fontWeight:600,fontFamily:FONT_BODY,background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:6,padding:"3px 10px",cursor:"pointer",color:"#16a34a"}}>WhatsApp recordatorio</button>
                            )}
                            {a.tipo==="asistencia"&&(
                              <button onClick={()=>abrirWAAsistencia(a.est,a.prog,a.faltas)} style={{fontSize:11,fontWeight:600,fontFamily:FONT_BODY,background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:6,padding:"3px 10px",cursor:"pointer",color:"#16a34a"}}>WhatsApp seguimiento</button>
                            )}
                            {a.tipo==="recordatorio_docente"&&<>
                              <button onClick={()=>enviarCalendarioWA(a.mod,a.prog)} style={{fontSize:11,fontWeight:600,fontFamily:FONT_BODY,background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:6,padding:"3px 10px",cursor:"pointer",color:"#16a34a"}}>Enviar WA</button>
                              <button onClick={()=>enviarCalendarioEmail(a.mod,a.prog)} style={{fontSize:11,fontWeight:600,fontFamily:FONT_BODY,background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:6,padding:"3px 10px",cursor:"pointer",color:"#2563eb"}}>Enviar Email</button>
                            </>}
                            {a.tipo==="orden_firmada"&&(
                              <button onClick={()=>{window.open(window.location.href.split("?")[0]+"?orden="+a.orden.id,"_blank");descartarAlerta(alertaKey(a));setShowAl(false);}} style={{fontSize:11,fontWeight:700,fontFamily:FONT_BODY,background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:6,padding:"3px 10px",cursor:"pointer",color:"#16a34a"}}>Abrir y descargar PDF</button>
                            )}
                          </div>
                        </div>
                        <button onClick={()=>descartarAlerta(alertaKey(a))} title="Descartar" style={{background:"none",border:"none",cursor:"pointer",color:"#D1D5DB",fontSize:18,padding:"0 2px",flexShrink:0,lineHeight:1,fontWeight:400}}>×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CONTENT */}
        <div style={{padding:"28px 32px",flex:1}}>

        {view==="calendario"&&<CalendarioView programas={programas}/>}

        {/* DASHBOARD */}
        {view==="dashboard"&&(()=>{
          const hoy=today();
          const mesActual=hoy.substring(0,7);
          const MESES=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

          // ── Datos globales ──
          const todosEsts=(programas||[]).flatMap(p=>ests(p).filter(e=>e.estatus!=="baja"&&e.estatus!=="inactivo").map(e=>({e,prog:p})));
          const activos=todosEsts.filter(({prog})=>progStatus(prog)==="activo");
          const porIniciar=todosEsts.filter(({prog})=>progStatus(prog)==="proximo");

          // KPIs de pagos
          const proyMensDash=proyeccionMensual(programas,docentes);
          const cobradoMes=proyMensDash[mesActual]?.cobrado||0; // por fecha_pago
          let esperadoTotal=0,cobradoTotal=0,pendienteTotal=0;
          let cntVencidos=0,cntCriticos=0,montoVencido=0;
          todosEsts.forEach(({e,prog})=>{
            const p=e.pago||{};
            const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
            const cobrado=getMontoCobrado(p);
            const pendiente=getMontoPendiente(p);
            esperadoTotal+=mf; cobradoTotal+=cobrado; pendienteTotal+=pendiente;
            // Vencidos
            const ep=calcEstadoPagos(e);
            if(ep?.conRecargo?.length>=2){cntCriticos++;montoVencido+=ep.conRecargo.reduce((a,parc)=>a+getMontoParc(parc,mf,(p.parcialidades||[]).length),0);}
            else if(ep?.conRecargo?.length>=1){cntVencidos++;montoVencido+=getMontoParc(ep.conRecargo[0],mf,(p.parcialidades||[]).length);}
          });

          // Facturas pendientes — misma lógica que facturación: pagaron en mesFactRef + no enviada
          const diaHoyDash=new Date().getDate();
          const mesFactRefDash=(()=>{
            if(diaHoyDash<=5){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return d.toISOString().substring(0,7);}
            return mesActual;
          })();
          const factPendientes=todosEsts.filter(({e})=>{
            if(e.requiere_factura!=="Sí"||e.factura_enviada)return false;
            return (e.pago?.parcialidades||[]).some(x=>x.pagado&&x.fecha_pago&&x.fecha_pago.startsWith(mesFactRefDash));
          }).length;

          // Programas activos
          const progsActivos=(programas||[]).filter(p=>progStatus(p)==="activo");
          const progsProximos=(programas||[]).filter(p=>progStatus(p)==="proximo");

          // Edad promedio
          const calcEdad = fn => {
            if(!fn) return null;
            const hoyD=new Date(); const nac=new Date(fn+"T12:00:00");
            if(isNaN(nac)) return null;
            let age=hoyD.getFullYear()-nac.getFullYear();
            if(hoyD.getMonth()<nac.getMonth()||(hoyD.getMonth()===nac.getMonth()&&hoyD.getDate()<nac.getDate())) age--;
            return age>0&&age<120?age:null;
          };
          const edadesGeneral=todosEsts.map(({e})=>calcEdad(e.fecha_nacimiento)).filter(x=>x!==null);
          const edadPromGeneral=edadesGeneral.length?Math.round(edadesGeneral.reduce((a,b)=>a+b,0)/edadesGeneral.length):null;

          // Módulos esta semana
          const enUnaSemana=new Date(hoy+"T12:00:00"); enUnaSemana.setDate(enUnaSemana.getDate()+7);
          const semanaStr=enUnaSemana.toISOString().split("T")[0];
          const modsSemana=(programas||[]).flatMap(prog=>mods(prog).filter(m=>m.fechaInicio&&m.fechaInicio>=hoy&&m.fechaInicio<=semanaStr).map(m=>({m,prog})));

          // Sin docente confirmado
          const sinConfirmar=(programas||[]).flatMap(prog=>mods(prog).filter(m=>m.estatus!=="confirmado"&&m.docente&&progStatus(prog)!=="finalizado").map(m=>({m,prog})));

          // Gráfica últimos 6 meses — cobrado por fecha_pago, esperado por fecha_vencimiento
          const meses6=Array.from({length:6},(_,i)=>{
            const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-5+i);
            return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
          });
          const datosMeses=meses6.map(mes=>({
            mes,
            cobrado:proyMensDash[mes]?.cobrado||0,
            esperado:proyMensDash[mes]?.esperado||0,
          }));
          const maxBar=Math.max(...datosMeses.map(d=>d.mes===mesActual?Math.max(d.cobrado,d.esperado):d.cobrado),1);

          const KPICard=({label,value,sub,color,onClick,activo})=>(
            <div onClick={onClick} style={{...S.card,padding:"18px 20px",cursor:onClick?"pointer":"default",borderLeft:"4px solid "+(color||"#e5e7eb"),transition:"box-shadow .15s",boxShadow:activo?"0 0 0 3px "+(color||RED)+"33":"none"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>{label.toUpperCase()}</div>
              <div style={{fontSize:22,fontWeight:800,color:color||"#111",fontFamily:"system-ui"}}>{value}</div>
              {sub&&<div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui",marginTop:4}}>{sub}</div>}
            </div>
          );

          return(
            <div>
              <div style={{marginBottom:24}}>
                <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Dashboard</h1>
                <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>{new Date().toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>
              </div>

              {/* KPIs fila 1 */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:12}}>
                <KPICard label="Cobrado este mes" value={fmtMXN(cobradoMes)} color="#16a34a"/>
                <KPICard label="Pendiente total" value={fmtMXN(pendienteTotal)} color="#d97706" onClick={()=>setView("pagos_global")}/>
                <KPICard label="Vencidos" value={cntVencidos+cntCriticos} sub={cntCriticos>0?cntCriticos+" críticos":""} color="#dc2626" onClick={()=>{setView("pagos_global");setFiltroPagos("vencido");}}/>
                <KPICard label="Estudiantes activos" value={activos.length} color={RED}/>
                <KPICard label="Por iniciar" value={porIniciar.length} sub={progsProximos.length+" programa"+(progsProximos.length!==1?"s":"")} color="#0891b2" onClick={()=>setView("lista")}/>
                <KPICard label="Programas activos" value={progsActivos.length} sub={progsProximos.length>0?progsProximos.length+" próximos":""} color="#2563eb" onClick={()=>setView("lista")}/>
                <KPICard label="Facturas pendientes" value={factPendientes} color="#7c3aed" onClick={()=>{setView("facturacion");setFiltroFactTipo("pendiente");}}/>
                {edadPromGeneral&&<KPICard label="Edad promedio general" value={edadPromGeneral+" años"} sub={edadesGeneral.length+" estudiantes con datos"} color="#0d9488"/>}
              </div>

              {/* Gráfica + Pendientes */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>

                {/* Gráfica cobros */}
                <div style={{...S.card,padding:"20px 22px"}}>
                  <div style={{fontWeight:700,fontSize:14,fontFamily:FONT_TITLE,marginBottom:16}}>Cobros últimos 6 meses</div>
                  <div style={{display:"flex",alignItems:"flex-end",gap:8,height:140}}>
                    {datosMeses.map(({mes,cobrado,esperado})=>{
                      const esMesAct=mes===mesActual;
                      const pendienteMes=esMesAct?Math.max(0,esperado-cobrado):0;
                      const totalBar=esMesAct?Math.max(cobrado+pendienteMes,cobrado,1):cobrado;
                      const pctCob=Math.round((totalBar/maxBar)*100);
                      const altoCob=Math.max(pctCob/100*110,cobrado>0?4:0);
                      const altoPend=esMesAct&&pendienteMes>0?Math.round((pendienteMes/(cobrado+pendienteMes))*altoCob):0;
                      const altoRojo=altoCob-altoPend;
                      return(
                        <div key={mes} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                          {esMesAct?(
                            <div style={{fontSize:9,fontWeight:700,color:RED,fontFamily:"system-ui",textAlign:"center",lineHeight:1.4}}>
                              <div>{fmtMXN(cobrado)}</div>
                              {pendienteMes>0&&<div style={{color:"#9ca3af",fontWeight:400}}>−{fmtMXN(pendienteMes)}</div>}
                            </div>
                          ):(
                            <div style={{fontSize:9,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui"}}>{cobrado>0?fmtMXN(cobrado):""}</div>
                          )}
                          <div style={{width:"100%",display:"flex",flexDirection:"column",borderRadius:"4px 4px 0 0",overflow:"hidden"}}>
                            {esMesAct&&altoPend>0&&<div style={{width:"100%",background:"#fecaca",height:altoPend,transition:"height .3s"}}/>}
                            <div style={{width:"100%",background:esMesAct?RED:"#e5e7eb",height:Math.max(altoRojo,cobrado>0?4:2),transition:"height .3s"}}/>
                          </div>
                          <div style={{fontSize:9,color:esMesAct?RED:"#9ca3af",fontWeight:esMesAct?700:400,fontFamily:"system-ui"}}>{MESES[parseInt(mes.split("-")[1])-1]}</div>
                        </div>
                      );
                    })}
                  </div>
                  {(()=>{
                    const dMes=datosMeses.find(d=>d.mes===mesActual)||{cobrado:0,esperado:0};
                    const pendMes=Math.max(0,dMes.esperado-dMes.cobrado);
                    return(
                      <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid #f3f4f6",fontFamily:"system-ui",fontSize:11,color:"#6b7280"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:pendMes>0?6:0}}>
                          <span>Total cobrado: <strong style={{color:"#16a34a"}}>{fmtMXN(cobradoTotal)}</strong></span>
                          <span>Esperado total: <strong>{fmtMXN(esperadoTotal)}</strong></span>
                        </div>
                        {pendMes>0&&(
                          <div style={{display:"flex",alignItems:"center",gap:6,background:"#fff5f5",borderRadius:6,padding:"6px 10px",border:"1px solid #fecaca"}}>
                            <div style={{width:8,height:8,borderRadius:2,background:"#fecaca",flexShrink:0}}/>
                            <span style={{color:"#dc2626",fontWeight:600}}>Falta cobrar este mes: {fmtMXN(pendMes)}</span>
                            <span style={{color:"#9ca3af",marginLeft:"auto"}}>de {fmtMXN(dMes.esperado)} esperado</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Pendientes del día */}
                <div style={{...S.card,padding:"20px 22px"}}>
                  <div style={{fontWeight:700,fontSize:14,fontFamily:FONT_TITLE,marginBottom:14}}>Pendientes</div>
                  <div style={{display:"grid",gap:8}}>
                    {modsSemana.length>0&&(
                      <div onClick={()=>setView("calendario")} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",background:"#eff6ff",borderRadius:8,cursor:"pointer",border:"1px solid #bfdbfe"}}>
                        <span style={{fontSize:18}}>📅</span>
                        <div>
                          <div style={{fontWeight:700,fontSize:13,color:"#2563eb",fontFamily:"system-ui"}}>{modsSemana.length} módulo{modsSemana.length!==1?"s":""} esta semana</div>
                          <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>{modsSemana.slice(0,2).map(({m})=>m.docente||"Sin docente").join(", ")}{modsSemana.length>2?" +más":""}</div>
                        </div>
                      </div>
                    )}
                    {sinConfirmar.length>0&&(
                      <div onClick={()=>setView("lista")} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",background:"#fffbeb",borderRadius:8,cursor:"pointer",border:"1px solid #fde68a"}}>
                        <span style={{fontSize:18}}>⚠️</span>
                        <div>
                          <div style={{fontWeight:700,fontSize:13,color:"#d97706",fontFamily:"system-ui"}}>{sinConfirmar.length} docente{sinConfirmar.length!==1?"s":""} sin confirmar</div>
                          <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>{sinConfirmar.slice(0,2).map(({m})=>m.docente).join(", ")}{sinConfirmar.length>2?" +más":""}</div>
                        </div>
                      </div>
                    )}
                    {cntVencidos+cntCriticos>0&&(
                      <div onClick={()=>{setView("pagos_global");setFiltroPagos("vencido");}} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",background:"#fef2f2",borderRadius:8,cursor:"pointer",border:"1px solid #fca5a5"}}>
                        <span style={{fontSize:18}}>🔴</span>
                        <div>
                          <div style={{fontWeight:700,fontSize:13,color:"#dc2626",fontFamily:"system-ui"}}>{cntVencidos+cntCriticos} pago{cntVencidos+cntCriticos!==1?"s":""} vencido{cntVencidos+cntCriticos!==1?"s":""}</div>
                          <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>{fmtMXN(montoVencido)} vencido · {fmtMXN(pendienteTotal)} pendiente total</div>
                        </div>
                      </div>
                    )}
                    {factPendientes>0&&(
                      <div onClick={()=>{setView("facturacion");setFiltroFactTipo("pendiente");}} style={{display:"flex",gap:12,alignItems:"center",padding:"10px 12px",background:"#f5f3ff",borderRadius:8,cursor:"pointer",border:"1px solid #ddd6fe"}}>
                        <span style={{fontSize:18}}>🧾</span>
                        <div>
                          <div style={{fontWeight:700,fontSize:13,color:"#7c3aed",fontFamily:"system-ui"}}>{factPendientes} factura{factPendientes!==1?"s":""} por enviar</div>
                          <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>Ir a Facturación →</div>
                        </div>
                      </div>
                    )}
                    {modsSemana.length===0&&sinConfirmar.length===0&&cntVencidos+cntCriticos===0&&factPendientes===0&&(
                      <div style={{textAlign:"center",padding:20,color:"#9ca3af",fontFamily:"system-ui",fontSize:13}}>Todo al corriente ✓</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Programas por iniciar */}
              {progsProximos.length>0&&(
                <div style={{...S.card,padding:"20px 22px",marginBottom:12,borderLeft:"4px solid #0891b2"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                    <div style={{fontWeight:700,fontSize:14,fontFamily:FONT_TITLE}}>Próximos a iniciar</div>
                    <span style={{background:"#e0f2fe",color:"#0369a1",borderRadius:99,padding:"2px 10px",fontSize:11,fontWeight:700,fontFamily:"system-ui"}}>{porIniciar.length} estudiante{porIniciar.length!==1?"s":""} inscritos</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                    {progsProximos.map(prog=>{
                      const estsP=ests(prog).filter(e=>e.estatus!=="baja"&&e.estatus!=="inactivo");
                      const primerMod=mods(prog).filter(m=>m.fechaInicio).sort((a,b)=>a.fechaInicio.localeCompare(b.fechaInicio))[0];
                      const diasParaInicio=primerMod?.fechaInicio?Math.ceil((new Date(primerMod.fechaInicio)-new Date(hoy))/(1000*60*60*24)):null;
                      const edadesP=estsP.map(e=>calcEdad(e.fecha_nacimiento)).filter(x=>x!==null);
                      const edadPromP=edadesP.length?Math.round(edadesP.reduce((a,b)=>a+b,0)/edadesP.length):null;
                      return(
                        <div key={prog.id} onClick={()=>{setSelProg(prog.id);setView("programa");}} style={{padding:"14px 16px",borderRadius:10,border:"1px solid #bae6fd",cursor:"pointer",background:"#f0f9ff",transition:"box-shadow .15s"}}
                          onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 12px rgba(0,0,0,0.08)"}
                          onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                            <div style={{width:10,height:10,borderRadius:"50%",background:prog.color||"#0891b2",flexShrink:0}}/>
                            <div style={{fontWeight:700,fontSize:13,fontFamily:"system-ui",flex:1,lineHeight:1.3}}>{prog.nombre}</div>
                          </div>
                          <div style={{fontSize:11,color:"#0369a1",fontFamily:"system-ui",marginBottom:6,fontWeight:600,display:"flex",gap:8,alignItems:"center"}}>
                            <span>{estsP.length} estudiante{estsP.length!==1?"s":""} inscritos{prog.generacion?" · "+prog.generacion:""}</span>
                            {edadPromP&&<span style={{background:"#e0f2fe",color:"#0369a1",borderRadius:99,padding:"1px 7px",fontWeight:700,fontSize:10}}>x̄ {edadPromP} años</span>}
                          </div>
                          {primerMod?.fechaInicio&&(
                            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,fontFamily:"system-ui",color:"#6b7280"}}>
                              <span>Inicia: {primerMod.fechaInicio}</span>
                              {diasParaInicio!==null&&<span style={{background:diasParaInicio<=7?"#fef2f2":diasParaInicio<=30?"#fffbeb":"#f0fdf4",color:diasParaInicio<=7?"#dc2626":diasParaInicio<=30?"#d97706":"#16a34a",borderRadius:99,padding:"1px 7px",fontWeight:700}}>en {diasParaInicio}d</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Programas activos */}
              {progsActivos.length>0&&(
                <div style={{...S.card,padding:"20px 22px"}}>
                  <div style={{fontWeight:700,fontSize:14,fontFamily:FONT_TITLE,marginBottom:14}}>Programas activos</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                    {progsActivos.map(prog=>{
                      const estsP=ests(prog).filter(e=>e.estatus!=="baja"&&e.estatus!=="inactivo");
                      const mf_total=estsP.reduce((a,e)=>{const p=e.pago||{};return a+(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);},0);
                      const cobrado=estsP.reduce((a,e)=>{const p=e.pago||{};const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);const pag=(p.parcialidades||[]).filter(x=>x.pagado).length;const tot=(p.parcialidades||[]).length;return a+(p.tipo==="unico"?(pag>0?mf:0):(tot?mf/tot*pag:0));},0);
                      const pct=mf_total>0?Math.round(cobrado/mf_total*100):0;
                      // % ideal a la fecha: parcialidades con fecha_vencimiento <= hoy
                      const idealCobrado=estsP.reduce((a,e)=>{const p=e.pago||{};const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);const tot=(p.parcialidades||[]).length;if(p.tipo==="unico")return a+mf;const vencidas=(p.parcialidades||[]).filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento<=hoy).length;return a+(tot?mf/tot*vencidas:0);},0);
                      const pctIdeal=mf_total>0?Math.min(100,Math.round(idealCobrado/mf_total*100)):0;
                      const adelante=pct>=pctIdeal;
                      const proxMod=mods(prog).filter(m=>m.fechaInicio&&m.fechaInicio>=hoy).sort((a,b)=>a.fechaInicio.localeCompare(b.fechaInicio))[0];
                      const edadesP=estsP.map(e=>calcEdad(e.fecha_nacimiento)).filter(x=>x!==null);
                      const edadPromP=edadesP.length?Math.round(edadesP.reduce((a,b)=>a+b,0)/edadesP.length):null;
                      return(
                        <div key={prog.id} onClick={()=>{setSelProg(prog.id);setView("programa");}} style={{padding:"14px 16px",borderRadius:10,border:"1px solid #e5e7eb",cursor:"pointer",background:"#fafafa",transition:"box-shadow .15s"}}
                          onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 12px rgba(0,0,0,0.08)"}
                          onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                            <div style={{width:10,height:10,borderRadius:"50%",background:prog.color||RED,flexShrink:0}}/>
                            <div style={{fontWeight:700,fontSize:13,fontFamily:"system-ui",flex:1,lineHeight:1.3}}>{prog.nombre}</div>
                          </div>
                          <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui",marginBottom:8,display:"flex",gap:8,alignItems:"center"}}>
                            <span>{estsP.length} estudiantes{prog.generacion?" · "+prog.generacion:""}</span>
                            {edadPromP&&<span style={{background:"#f0fdfa",color:"#0d9488",borderRadius:99,padding:"1px 7px",fontWeight:700,fontSize:10}}>x̄ {edadPromP} años</span>}
                          </div>
                          {/* Barra real */}
                          <div style={{background:"#f3f4f6",borderRadius:4,height:6,marginBottom:4,position:"relative"}}>
                            <div style={{height:6,borderRadius:4,background:pct>=80?"#16a34a":pct>=50?"#d97706":RED,width:pct+"%",transition:"width .4s"}}/>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,fontFamily:"system-ui",color:"#9ca3af",marginBottom:6}}>
                            <span style={{color:adelante?"#16a34a":"#dc2626",fontWeight:600}}>{pct}% cobrado</span>
                            {proxMod&&<span>Próx: {proxMod.docente||"Sin docente"}</span>}
                          </div>
                          {/* Barra ideal */}
                          {pctIdeal>0&&(
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <div style={{flex:1,background:"#f3f4f6",borderRadius:4,height:4,position:"relative"}}>
                                <div style={{height:4,borderRadius:4,background:"#e2e8f0",width:pctIdeal+"%"}}/>
                              </div>
                              <span style={{fontSize:9,fontFamily:"system-ui",color:adelante?"#16a34a":"#dc2626",fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>
                                {adelante?"↑":"↓"} ideal {pctIdeal}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        {view==="docentes"&&<DocentesView docentes={docentes} saveDocentes={saveDoc} programas={programas} npsData={npsData} setCS={setCS}/>}
        {view==="asistencia"&&<AsistenciaGlobal programas={programas} generarLink={generarLink} linkCopiado={linkCopiado} onToggleAsist={toggleAsistFecha} onRegEval={({prog,mod})=>setNpsModal({prog,mod})} onEnviarEval={enviarEvalPorCorreo}/>}

        {/* VISTA HOY */}
        {view==="hoy"&&(()=>{
          const hoy = today();
          const fmtHoyLargo = () => { const d=new Date(); return d.getDate()+" de "+MESES_L[d.getMonth()]+" de "+d.getFullYear(); };

          // Módulos con clase hoy
          const modulosHoy = [];
          (programas||[]).forEach(prog=>{
            mods(prog).forEach(mod=>{
              const fechas = getFechasMod(mod);
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
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:12}}>
                <div>
                  <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Lista de hoy</h1>
                  <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>{fmtHoyLargo()} · {modulosHoy.length} {modulosHoy.length===1?"módulo":"módulos"} con clase</p>
                </div>
                <input
                  value={busqHoy} onChange={e=>setBusqHoy(e.target.value)}
                  placeholder="Buscar alumno..."
                  style={{...S.inp,width:240,padding:"9px 14px",fontSize:14}}
                  autoFocus
                />
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
                  const todosEsts=ests(prog);
                  const presentes=todosEsts.filter(e=>presenteHoy(e,mod.id)).length;
                  const estudiantesFiltrados=busqHoy
                    ? todosEsts.filter(e=>e.nombre.toLowerCase().includes(busqHoy.toLowerCase()))
                    : todosEsts;
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
                          <div style={{fontWeight:800,fontSize:18,color:RED}}>{presentes}/{todosEsts.length}</div>
                          <div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>Clase {numClase} de {maxClases}</div>
                          {busqHoy&&<div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui"}}>{estudiantesFiltrados.length} resultado{estudiantesFiltrados.length!==1?"s":""}</div>}
                        </div>
                      </div>

                      {/* Lista de estudiantes */}
                      {todosEsts.length===0&&(
                        <div style={{padding:"24px",textAlign:"center",color:"#9ca3af",fontFamily:"system-ui",fontSize:13}}>Sin estudiantes importados.</div>
                      )}
                      {busqHoy&&estudiantesFiltrados.length===0&&(
                        <div style={{padding:"18px 20px",textAlign:"center",color:"#9ca3af",fontFamily:"system-ui",fontSize:13}}>Sin resultados para "{busqHoy}"</div>
                      )}
                      <div style={{display:"grid",gap:0}}>
                        {estudiantesFiltrados.map((e,i)=>{
                          const presente=presenteHoy(e,mod.id);
                          const tot=Array.isArray(e.asistencia&&e.asistencia["mod_"+mod.id])?(e.asistencia["mod_"+mod.id]).length:((e.asistencia&&e.asistencia["mod_"+mod.id])||0);
                          const pct=maxClases?Math.round(tot/maxClases*100):0;
                          return(
                            <div key={e.id} onClick={()=>toggleHoy(prog.id,mod.id,e.id)}
                              style={{padding:"12px 20px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",borderBottom:i<estudiantesFiltrados.length-1?"1px solid #f3f4f6":"none",background:presente?"#f0fdf4":"#fff",transition:"background 0.1s"}}>
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
            {/* RESUMEN URGENTES */}
            {(()=>{
              const hoy=today();
              let vencidos=0,vencenProto=0;
              (programas||[]).filter(p=>progStatus(p)==="activo").forEach(p=>{
                ests(p).forEach(e=>{
                  if(e.estatus==="baja"||e.estatus==="inactivo")return;
                  const pago=e.pago||{};
                  if(!pago.monto_acordado)return;
                  (pago.parcialidades||[]).forEach(parc=>{
                    if(parc.pagado)return;
                    if(parc.fecha_vencimiento&&parc.fecha_vencimiento<hoy)vencidos++;
                    else if(parc.fecha_vencimiento){
                      const diff=Math.round((new Date(parc.fecha_vencimiento+"T12:00:00")-new Date(hoy+"T12:00:00"))/(86400000));
                      if(diff>=0&&diff<=2)vencenProto++;
                    }
                  });
                });
              });
              const items=[
                {v:vencidos,   label:"pago"+(vencidos!==1?"s":"")+" vencido"+(vencidos!==1?"s":""),  bg:"#fef2f2",color:"#dc2626",filtro:"vencido"},
                {v:vencenProto,label:"vence"+(vencenProto!==1?"n":"")+" pronto",                      bg:"#fffbeb",color:"#d97706",filtro:"vence_pronto"},
              ].filter(x=>x.v>0);
              if(!items.length)return null;
              return(
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
                  {items.map(it=>(
                    <button key={it.filtro} onClick={()=>{setView("pagos_global");setFiltroPagos(it.filtro);}} style={{display:"flex",alignItems:"center",gap:7,background:it.bg,border:"1px solid "+it.color+"33",borderRadius:8,padding:"8px 14px",cursor:"pointer",fontFamily:"system-ui"}}>
                      <span style={{fontWeight:800,fontSize:18,color:it.color,lineHeight:1}}>{it.v}</span>
                      <span style={{fontSize:12,color:it.color,fontWeight:500}}>{it.label}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
              <div><h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Programas</h1><p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>Gestión de diplomados y cursos de educación continua</p></div>
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
                        {p.colaboracion&&<span style={{background:"#f5f3ff",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#7c3aed",fontFamily:"system-ui",fontWeight:700}}>Colaboración · {p.socio}</span>}
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
                      {can(session,"importarEstudiantes")&&p.ghl_pipeline_id&&p.ghl_stage_id&&<button onClick={()=>{setSelProg(p.id);setShowImp(true);}} style={S.btn("#eff6ff","#2563eb",{padding:"8px 12px",border:"1px solid #bfdbfe"})}>Importar</button>}
                      {can(session,"editarProgramas")&&<button onClick={()=>openEditProg(p)} style={S.btn("#f3f4f6","#374151",{padding:"8px 12px"})}>Editar</button>}
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
                              {m.docente&&<button onClick={()=>enviarCalendarioWA(m,prog)} style={S.btn("#F0FDF4","#16a34a",{border:"1px solid #86EFAC",padding:"5px 11px",fontSize:12})}>Cal. WA</button>}
                              {m.docente&&<button onClick={()=>enviarCalendarioEmail(m,prog)} style={S.btn("#EFF6FF","#2563eb",{border:"1px solid #BFDBFE",padding:"5px 11px",fontSize:12})}>Cal. Email</button>}
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
                    {ests(prog).length>0&&<><button onClick={()=>exportCSV(prog)} style={S.btn("#f3f4f6","#374151")}>Exportar CSV</button><button onClick={()=>exportDocente(prog)} style={S.btn("#f3f4f6","#374151")}>Exportar lista completa</button></>}
                  </div>
                </div>
                {ests(prog).length>0&&(
                  <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                    <input placeholder="Buscar por nombre, empresa o correo..." value={busqEst} onChange={e=>setBusqEst(e.target.value)} style={{...S.inp,flex:1,minWidth:180}}/>
                    <select value={filtroEst} onChange={e=>setFiltroEst(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                      <option value="">Todos los estatus</option>
                      <option value="activo">Activo</option>
                      <option value="egresado">Egresado EC</option>
                      <option value="baja">Baja</option>
                    </select>
                    {(busqEst||filtroEst)&&<button onClick={()=>{setBusqEst("");setFiltroEst("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
                  </div>
                )}
                <div style={{display:"grid",gap:10}}>
                  {ests(prog).filter(e=>{const q=busqEst.toLowerCase();return(!busqEst||(e.nombre&&e.nombre.toLowerCase().includes(q))||(e.empresa&&e.empresa.toLowerCase().includes(q))||(e.email&&e.email.toLowerCase().includes(q)))&&(!filtroEst||(e.estatus||"activo")===filtroEst);}).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||"","es")).map(e=>{
                    const pct=calcPct(e,mods(prog)), riesgo=pct!==null&&pct<80;
                    return(
                      <div key={e.id} style={{...S.card,border:"1px solid "+(riesgo?"#fca5a5":"#e5e7eb"),padding:"14px 18px"}}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                          <div style={{flex:1,minWidth:200}}>
                            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                              <span style={{fontWeight:700,fontSize:15}}>{e.nombre}</span>
                              <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,fontFamily:"system-ui",fontWeight:700,background:e.estatus==="egresado"?"#f0fdf4":e.estatus==="baja"?"#fef2f2":"#eff6ff",color:e.estatus==="egresado"?"#16a34a":e.estatus==="baja"?"#dc2626":"#2563eb",border:"1px solid "+(e.estatus==="egresado"?"#bbf7d0":e.estatus==="baja"?"#fca5a5":"#bfdbfe")}}>{e.estatus==="egresado"?"Egresado EC":e.estatus==="baja"?"Baja":"Activo"}</span>
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
                                {e.csf_url
                                  ? <a href={e.csf_url} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600,textDecoration:"none",border:"1px solid #bbf7d0"}}>Ver CSF</a>
                                  : <button onClick={ev=>{ev.stopPropagation();const url=prompt("Pega la URL del CSF:");if(url&&url.trim())save((programas||[]).map(p=>p.id===prog.id?{...p,estudiantes:ests(p).map(es=>es.id===e.id?{...es,csf_url:url.trim()}:es)}:p));}} style={{fontSize:11,background:"#fffbeb",borderRadius:4,padding:"2px 8px",color:"#d97706",fontFamily:"system-ui",fontWeight:600,border:"1px solid #fde68a",cursor:"pointer"}}>+ Agregar CSF</button>
                                }
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
                            <select value={e.estatus||"activo"} onChange={ev=>{
                                const nuevo=ev.target.value;
                                if(nuevo==="inactivo"){setInactivoRazon("");setInactivoModal({est:e,prog});}
                                else if(nuevo==="baja"){setCS({titulo:"Dar de baja",mensaje:`¿Dar de baja a "${e.nombre}"? Se excluirá de todos los reportes y pagos. Esta acción se puede revertir cambiando su estatus manualmente.`,onConfirm:()=>save((programas||[]).map(p=>p.id===prog.id?{...p,estudiantes:ests(p).map(es=>es.id===e.id?{...es,estatus:"baja"}:es)}:p))});}
                                else save((programas||[]).map(p=>p.id===prog.id?{...p,estudiantes:ests(p).map(es=>es.id===e.id?{...es,estatus:nuevo}:es)}:p));
                              }}
                              style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"5px 8px",fontSize:12,fontFamily:"system-ui",outline:"none",cursor:"pointer"}}>
                              <option value="activo">Activo</option><option value="inactivo">Inactivo</option><option value="egresado">Egresado EC</option><option value="baja">Baja</option>
                            </select>
                            <button onClick={()=>setCS({titulo:"Quitar estudiante",mensaje:`¿Estás seguro de que deseas quitar a "${e.nombre}" de este programa? Se perderá su registro de asistencia.`,onConfirm:()=>{save((programas||[]).map(p=>p.id===prog.id?{...p,estudiantes:ests(p).filter(es=>es.id!==e.id)}:p));supa.del("estudiantes",e.id).catch(err=>console.error("Del estudiante:",err));supa.del("pagos",e.id+"_pago").catch(err=>console.error("Del pago:",err));}})} style={S.btn("#fef2f2","#dc2626",{padding:"5px 10px",fontSize:12})}>Quitar</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {ests(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Sin estudiantes. Usa el botón Importar / Sincronizar para agregarlos.</div>}
                </div>
              </div>
            )}

            {/* ASISTENCIA */}
            {progTab==="asistencia"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>Mínimo requerido: 80% · Datos sincronizados con la vista de Asistencia</div>
                  <button onClick={()=>{setView("asistencia");}} style={S.btn("#f3f4f6","#374151",{fontSize:12})}>Ir a Asistencia detallada →</button>
                </div>
                {mods(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Agrega módulos primero.</div>}
                {mods(prog).length>0&&ests(prog).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Importa estudiantes primero.</div>}
                {mods(prog).length>0&&ests(prog).length>0&&(
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8}}>
                      <thead>
                        <tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>
                          <th style={{textAlign:"left",padding:"12px 16px",fontWeight:700,color:"#374151",fontSize:12,position:"sticky",left:0,background:"#f9f9f9"}}>Estudiante</th>
                          {mods(prog).map(m=>{
                            const fechas=getFechasMod(m);
                            return(<th key={m.id} style={{padding:"10px 12px",fontWeight:700,color:"#374151",fontSize:11,textAlign:"center",whiteSpace:"nowrap",minWidth:90}}>
                              {m.numero}<br/>
                              <span style={{fontWeight:400,color:"#9ca3af",fontSize:10}}>{fechas.length} sesiones</span>
                            </th>);
                          })}
                          <th style={{padding:"10px 12px",fontWeight:700,color:"#374151",fontSize:11,textAlign:"center"}}>Global</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ests(prog).filter(e=>e.estatus!=="baja").map(e=>{
                          const pct=calcPct(e,mods(prog)), riesgo=pct!==null&&pct<80;
                          return(
                            <tr key={e.id} style={{borderBottom:"1px solid #f3f4f6",background:riesgo?"#fef9f9":"#fff"}}>
                              <td style={{padding:"12px 16px",fontWeight:600,position:"sticky",left:0,background:riesgo?"#fef9f9":"#fff"}}>
                                <div>{e.nombre}</div>
                                {e.empresa&&<div style={{fontSize:11,color:"#9ca3af",fontWeight:400}}>{e.empresa}</div>}
                                {e.estatus==="inactivo"&&<span style={{fontSize:10,background:"#f3f4f6",color:"#6b7280",borderRadius:4,padding:"1px 6px"}}>Inactivo</span>}
                              </td>
                              {mods(prog).map(m=>{
                                const k="mod_"+m.id;
                                const v=e.asistencia&&e.asistencia[k];
                                // Leer como array de fechas (sistema nuevo) o número (sistema viejo)
                                const asist=Array.isArray(v)?v.length:(v||0);
                                const fechas=getFechasMod(m);
                                const max=fechas.length||m.clases||0;
                                const pm=max?Math.round(asist/max*100):0;
                                return(
                                  <td key={m.id} style={{padding:"10px 12px",textAlign:"center"}}>
                                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                      <span style={{fontWeight:700,fontSize:13,color:pm>=80?"#16a34a":asist>0?"#d97706":"#9ca3af"}}>{asist}/{max}</span>
                                      <div style={{width:48,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                                        <div style={{width:pm+"%",height:"100%",background:pm>=80?"#16a34a":"#dc2626",borderRadius:4}}/>
                                      </div>
                                      <span style={{fontSize:10,color:pm>=80?"#16a34a":"#dc2626"}}>{pm}%</span>
                                    </div>
                                  </td>
                                );
                              })}
                              <td style={{padding:"10px 12px",textAlign:"center"}}>
                                <span style={{fontSize:14,fontWeight:800,color:riesgo?"#dc2626":"#16a34a"}}>{pct!==null?pct+"%":"—"}</span>
                                {riesgo&&<div style={{fontSize:10,color:"#dc2626",marginTop:2}}>En riesgo</div>}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Fila de promedios del grupo */}
                        <tr style={{borderTop:"2px solid #e5e7eb",background:"#f9f9f9",fontWeight:700}}>
                          <td style={{padding:"10px 16px",fontSize:12,color:"#6b7280",position:"sticky",left:0,background:"#f9f9f9"}}>PROMEDIO GRUPO</td>
                          {mods(prog).map(m=>{
                            const activos=ests(prog).filter(e=>e.estatus!=="baja");
                            const fechas=getFechasMod(m);
                            const max=fechas.length||m.clases||0;
                            const promG=activos.length&&max?Math.min(100,Math.round(activos.reduce((a,e)=>{const v=e.asistencia&&e.asistencia["mod_"+m.id];return a+(Array.isArray(v)?v.length:(v||0));},0)/activos.length/max*100)):0;
                            return(<td key={m.id} style={{padding:"10px 12px",textAlign:"center"}}>
                              <span style={{fontSize:12,fontWeight:700,color:promG>=80?"#16a34a":"#dc2626"}}>{promG}%</span>
                            </td>);
                          })}
                          <td style={{padding:"10px 12px",textAlign:"center"}}>
                            <span style={{fontSize:13,fontWeight:800,color:"#374151"}}>
                              {(()=>{const activos=ests(prog).filter(e=>e.estatus!=="baja");const total=mods(prog).reduce((a,m)=>a+(m.clases||0),0);if(!activos.length||!total)return"—";const prom=Math.round(activos.reduce((a,e)=>a+(calcPct(e,mods(prog))||0),0)/activos.length);return prom+"%";})()}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* PAGOS */}
            {progTab==="pagos"&&(()=>{
              const estudiantes=ests(prog).filter(e=>e.estatus!=="baja");
              const activos=estudiantes.filter(e=>e.estatus!=="inactivo");
              const inactivos=estudiantes.filter(e=>e.estatus==="inactivo");
              const totalEsperado=activos.reduce((a,e)=>{const p=e.pago;if(!p||!p.monto_acordado)return a;return a+p.monto_acordado*(1-(p.descuento_pct||0)/100);},0);
              const totalCobrado=activos.reduce((a,e)=>{const p=e.pago;if(!p)return a;if(p.tipo==="unico"){const pag=(p.parcialidades||[]).filter(x=>x.pagado).length;return a+(pag>0?p.monto_acordado*(1-(p.descuento_pct||0)/100):0);}const mf=p.monto_acordado*(1-(p.descuento_pct||0)/100);const tot=(p.parcialidades||[]).length;const pag=(p.parcialidades||[]).filter(x=>x.pagado).length;return a+(tot?mf/tot*pag:0);},0);
              const totalDescuentos=activos.reduce((a,e)=>{const p=e.pago;if(!p||!p.monto_acordado||!p.descuento_pct)return a;return a+p.monto_acordado*(p.descuento_pct/100);},0);
              const honorarios=mods(prog).reduce((a,m)=>a+calcHonorarios(m,docentes),0);
              const pendiente=totalEsperado-totalCobrado;
              const pct=totalEsperado>0?Math.round(totalCobrado/totalEsperado*100):0;
              const sinConfig=activos.filter(e=>!e.pago?.monto_acordado).length;
              const vencidos=activos.filter(e=>{const ep=calcEstadoPagos(e);return ep&&ep.conRecargo.length>0;}).length;
              return(
                <div>
                  {/* Tarjetas resumen */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:20}}>
                    {[["Esperado",totalEsperado,"#1a1a1a"],["Cobrado",totalCobrado,"#16a34a"],["Pendiente",pendiente,"#d97706"],["Descuentos",totalDescuentos,RED],["Honorarios",honorarios,"#7c3aed"]].map(([l,v,c])=>(
                      <div key={l} style={{...S.card,padding:"14px 16px"}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:3}}>{l.toUpperCase()}</div>
                        <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"system-ui"}}>{fmtMXN(v)}</div>
                      </div>
                    ))}
                  </div>
                  {/* Barra de cobranza */}
                  {totalEsperado>0&&(
                    <div style={{...S.card,padding:"14px 18px",marginBottom:16}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"system-ui",marginBottom:8}}>
                        <span style={{color:"#6b7280"}}>Progreso de cobranza</span>
                        <span style={{fontWeight:700,color:pct>=80?"#16a34a":"#d97706"}}>{pct}%</span>
                      </div>
                      <div style={{height:8,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                        <div style={{width:pct+"%",height:"100%",background:pct>=80?"#16a34a":"#d97706",borderRadius:4,transition:"width 0.3s"}}/>
                      </div>
                      <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,fontFamily:"system-ui",color:"#6b7280"}}>{activos.length} estudiante{activos.length!==1?"s":""} activos</span>
                        {sinConfig>0&&<span style={{fontSize:12,fontFamily:"system-ui",color:"#d97706"}}>{sinConfig} sin configurar</span>}
                        {vencidos>0&&<span style={{fontSize:12,fontFamily:"system-ui",color:"#dc2626"}}>{vencidos} con pagos vencidos</span>}
                        {inactivos.length>0&&<span style={{fontSize:12,fontFamily:"system-ui",color:"#9ca3af"}}>{inactivos.length} inactivo{inactivos.length!==1?"s":""}</span>}
                      </div>
                    </div>
                  )}
                  {/* Margen neto */}
                  {(()=>{
                    const utilidad=totalEsperado-honorarios;
                    const esColab=prog.colaboracion&&prog.pct_socio>0;
                    const parteSocio=esColab?Math.round(utilidad*prog.pct_socio/100):0;
                    const parteIbero=utilidad-parteSocio;
                    return(
                      <div style={{...S.card,padding:"16px 18px",marginBottom:16,borderLeft:esColab?"4px solid #7c3aed":"none"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:esColab?12:0}}>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:2}}>MARGEN NETO ESTIMADO</div>
                            <div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>Ingresos esperados menos honorarios de docentes{esColab?" · Programa en colaboración":""}</div>
                          </div>
                          <div style={{fontSize:28,fontWeight:800,color:utilidad>=0?"#7c3aed":"#dc2626",fontFamily:"Georgia,serif"}}>{fmtMXN(utilidad)}</div>
                        </div>
                        {esColab&&(
                          <div style={{borderTop:"1px solid #e5e7eb",paddingTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                            <div style={{background:"#f0fdf4",borderRadius:8,padding:"10px 14px"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"#16a34a",fontFamily:"system-ui",marginBottom:3}}>IBERO — {100-prog.pct_socio}%</div>
                              <div style={{fontSize:18,fontWeight:800,color:"#16a34a",fontFamily:"system-ui"}}>{fmtMXN(parteIbero)}</div>
                            </div>
                            <div style={{background:"#f5f3ff",borderRadius:8,padding:"10px 14px"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"#7c3aed",fontFamily:"system-ui",marginBottom:3}}>{prog.socio||"Socio"} — {prog.pct_socio}%</div>
                              <div style={{fontSize:18,fontWeight:800,color:"#7c3aed",fontFamily:"system-ui"}}>{fmtMXN(parteSocio)}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Link a Control de Pagos */}
                  <div style={{...S.card,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f9f9f9"}}>
                    <span style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>Para ver parcialidades, enviar correos y gestionar pagos individuales:</span>
                    <button onClick={()=>{setProgPagos(prog.id);setView("pagos_global");}} style={S.btn(RED,"#fff",{fontSize:12})}>Ir a Control de Pagos →</button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* BÚSQUEDA GLOBAL */}
        {view==="busqueda"&&(()=>{
          const [q,setQ] = [busqGlobal,setBusqGlobal];
          const resultados=[];
          if(q.length>=2){
            const ql=q.toLowerCase();
            (programas||[]).forEach(prog=>{
              ests(prog).forEach(est=>{
                if(est.nombre?.toLowerCase().includes(ql)||est.email?.toLowerCase().includes(ql)||est.empresa?.toLowerCase().includes(ql)||est.telefono?.includes(q)){
                  resultados.push({est,prog});
                }
              });
            });
          }
          return(
            <div>
              <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 16px",letterSpacing:"-0.5px"}}>Búsqueda global</h1>
              <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar por nombre, correo, empresa, teléfono..." style={{...S.inp,fontSize:15,marginBottom:20}}/>
              {q.length>0&&q.length<2&&<p style={{color:"#9ca3af",fontFamily:"system-ui",fontSize:13}}>Escribe al menos 2 caracteres.</p>}
              {q.length>=2&&resultados.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin resultados para "{q}".</div>}
              <div style={{display:"grid",gap:10}}>
                {resultados.map(({est,prog},i)=>{
                  const p=est.pago||{};
                  const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
                  const pagadas=(p.parcialidades||[]).filter(x=>x.pagado).length;
                  const total=(p.parcialidades||[]).length;
                  return(
                    <div key={i} style={{...S.card,padding:"16px 20px",display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,fontSize:15,textTransform:"uppercase"}}>{est.nombre}</span>
                          <span style={{fontSize:11,background:est.estatus==="baja"?"#fef2f2":est.estatus==="egresado"?"#f0fdf4":"#eff6ff",color:est.estatus==="baja"?"#dc2626":est.estatus==="egresado"?"#16a34a":"#2563eb",borderRadius:4,padding:"2px 8px",fontFamily:"system-ui",fontWeight:700}}>{est.estatus==="baja"?"Baja":est.estatus==="egresado"?"Egresado EC":"Activo"}</span>
                        </div>
                        <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",display:"flex",gap:12,flexWrap:"wrap"}}>
                          {est.email&&<span>{est.email}</span>}
                          {est.telefono&&<span>{est.telefono}</span>}
                          {est.empresa&&<span>{est.empresa}</span>}
                        </div>
                        <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                          <span style={{fontSize:11,background:"#fef2f2",borderRadius:4,padding:"2px 8px",color:RED,fontFamily:"system-ui",fontWeight:600,border:"1px solid #fca5a5"}}>{prog.nombre}</span>
                          {mf>0&&<span style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600}}>{fmtMXN(mf)}{p.tipo==="parcialidades"?` · ${pagadas}/${total} pagadas`:""}</span>}
                          {est.requiere_factura==="Sí"&&<span style={{fontSize:11,background:"#fef2f2",borderRadius:4,padding:"2px 8px",color:RED,fontFamily:"system-ui",fontWeight:600}}>Factura</span>}
                          {est.csf_url
                            ?<a href={est.csf_url} target="_blank" rel="noreferrer" style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600,textDecoration:"none",border:"1px solid #bbf7d0"}}>Ver CSF</a>
                            :<span style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>Sin CSF</span>}
                        </div>
                      </div>
                      <button onClick={()=>setPagoModal({est,prog})} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px",fontSize:12,flexShrink:0})}>Ver pago</button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* PAGOS GLOBAL */}
        {view==="pagos_global"&&(()=>{
          const busqP=busqPagos, setBusqP=setBusqPagos;
          const progSelP=progPagos, setProgSelP=setProgPagos;
          const filtroEstado=filtroPagos, setFiltroEstado=setFiltroPagos;
          const tipoPago=filtroTipoPago, setTipoPago=setFiltroTipoPago;

          const estadoStyle={
            ok:       {bg:"#f0fdf4",color:"#16a34a",label:"Al corriente"},
            pendiente:{bg:"#eff6ff",color:"#2563eb",label:"Pendiente"},
            vencido:  {bg:"#fffbeb",color:"#d97706",label:"Vencido"},
            critico:  {bg:"#fef2f2",color:"#dc2626",label:"Crítico"},
            sinconfig:{bg:"#f3f4f6",color:"#9ca3af",label:"Sin configurar"},
          };

          const calcEtiquetas=(est,p,mf,estado)=>{
            const etiquetas=[];
            const hoy=today();
            // Verde: al corriente
            if(estado==="ok"&&mf>0) etiquetas.push({label:"Al corriente",bg:"#f0fdf4",color:"#16a34a"});
            // Amarillo: vence en 1-2 días
            const venceProto=(p.parcialidades||[]).some(parc=>!parc.pagado&&parc.fecha_vencimiento&&(()=>{
              const diff=Math.round((new Date(parc.fecha_vencimiento+"T12:00:00")-new Date(hoy+"T12:00:00"))/(86400000));
              return diff>=0&&diff<=2;
            })());
            if(venceProto&&estado!=="vencido"&&estado!=="critico") etiquetas.push({label:"Vence pronto",bg:"#fffbeb",color:"#d97706"});
            // Rojo: vencida
            if(estado==="vencido"||estado==="critico") etiquetas.push({label:estado==="critico"?"Crítico":"Vencida",bg:"#fef2f2",color:"#dc2626"});
            // Azul: requiere factura
            if(est.requiere_factura==="Sí") etiquetas.push({label:"Factura",bg:"#eff6ff",color:"#2563eb"});
            // Morado: transferencia o depósito
            if(est.forma_cobro==="Transferencia"||est.forma_cobro==="Depósito") etiquetas.push({label:est.forma_cobro,bg:"#f5f3ff",color:"#7c3aed"});
            // Naranja: descuento 90%+
            if((p.descuento_pct||0)>=90) etiquetas.push({label:"Descuento especial",bg:"#fff7ed",color:"#c2410c"});
            return etiquetas;
          };

          const calcInfoEst=(est,prog)=>{
            const ep=calcEstadoPagos(est);
            const p=est.pago||{};
            const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
            const pagadas=(p.parcialidades||[]).filter(x=>x.pagado).length;
            const total=(p.parcialidades||[]).length;
            const cobrado=getMontoCobrado(p);
            const pendiente=getMontoPendiente(p);
            let estado="ok";
            if(ep&&ep.conRecargo.length>=2)estado="critico";
            else if(ep&&ep.conRecargo.length>=1)estado="vencido";
            else if(pendiente>0)estado="pendiente";
            else if(mf===0)estado="sinconfig";
            const pctAsist=calcPct(est,mods(prog));
            return{ep,p,mf,pagadas,total,cobrado,pendiente,estado,pctAsist};
          };

          // Programas que pasan el filtro de programa
          const progsFiltrados=(programas||[]).filter(prog=>{
            if(progSelP==="activos") return progStatus(prog)==="activo";
            if(progSelP&&progSelP!=="activos"&&prog.id!==progSelP)return false;
            // Si hay búsqueda de texto, solo mostrar programas que tengan algún estudiante que coincida
            if(busqP){
              const ql=busqP.toLowerCase();
              return ests(prog).some(e=>
                (e.estatus!=="baja")&&(
                  e.nombre?.toLowerCase().includes(ql)||
                  e.empresa?.toLowerCase().includes(ql)||
                  e.email?.toLowerCase().includes(ql)
                )
              );
            }
            return true;
          });

          // Si hay filtro de estado de pago, filtrar programas que tengan al menos un est con ese estado
          const estPasaFiltro=(e,prog)=>{
            if(e.estatus==="baja")return false;
            if(filtroEstado==="inactivo")return e.estatus==="inactivo";
            if(e.estatus==="inactivo")return false;
            if(filtroEstado==="factura")return e.requiere_factura==="Sí";
            if(filtroEstado==="transferencia")return e.forma_cobro==="Transferencia";
            if(filtroEstado==="deposito")return e.forma_cobro==="Depósito";
            if(filtroEstado==="descuento_especial")return (e.pago?.descuento_pct||0)>=90;
            if(filtroEstado==="vence_pronto"){
              const p=e.pago||{};const hoy=today();
              return (p.parcialidades||[]).some(parc=>!parc.pagado&&parc.fecha_vencimiento&&(()=>{const diff=Math.round((new Date(parc.fecha_vencimiento+"T12:00:00")-new Date(hoy+"T12:00:00"))/(86400000));return diff>=0&&diff<=2;})());
            }
            const {estado}=calcInfoEst(e,prog);
            return estado===filtroEstado;
          };

          const progsVisibles=filtroEstado
            ? progsFiltrados.filter(prog=>ests(prog).some(e=>estPasaFiltro(e,prog)))
            : progsFiltrados;

          // Totales sobre todos los estudiantes visibles (aplicando todos los filtros)
          let totalEsperado=0,totalCobrado=0,totalPendiente=0,cntVencidos=0,cntCriticos=0,cntInactivos=0;
          progsVisibles.forEach(prog=>{
            ests(prog).forEach(est=>{
              if(est.estatus==="baja")return;
              if(est.estatus==="inactivo"){cntInactivos++;return;}
              const ql=(busqP||"").toLowerCase();
              if(busqP&&!(est.nombre?.toLowerCase().includes(ql)||est.empresa?.toLowerCase().includes(ql)||est.email?.toLowerCase().includes(ql)))return;
              const {mf,cobrado,pendiente,estado}=calcInfoEst(est,prog);
              totalEsperado+=mf; totalCobrado+=cobrado; totalPendiente+=pendiente;
              if(estado==="vencido")cntVencidos++;
              if(estado==="critico")cntCriticos++;
            });
          });

          const marcarInactivo=(progId,estId,nuevoEstatus)=>{
            save((programas||[]).map(p=>p.id!==progId?p:{...p,estudiantes:ests(p).map(e=>e.id!==estId?e:{...e,estatus:nuevoEstatus})}));
            notify(nuevoEstatus==="inactivo"?"Estudiante marcado como inactivo.":"Estudiante reactivado.");
          };

          const esHoy15 = new Date().getDate()===15;
          const descargarRespaldo=()=>{
            const hoy=today();
            const esc=v=>{if(v===null||v===undefined)return "";const s=String(v);if(s.includes(",")||s.includes('"')||s.includes("\n"))return '"'+s.replace(/"/g,'""')+'"';return s;};
            const rows=[["Programa","Generación","Estudiante","Email","Teléfono","Empresa","Estatus","Tipo de pago","Monto acordado","Descuento %","Monto final","Cobrado","Pendiente","Estado pago","Forma de cobro","Requiere factura","Parcialidad #","Monto parcialidad","Fecha vencimiento","Pagado","Fecha pago","Folio"].map(esc).join(",")];
            (programas||[]).forEach(prog=>{
              ests(prog).filter(e=>e.estatus!=="baja").forEach(est=>{
                const p=est.pago||{};
                const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
                const cobrado=getMontoCobrado(p);
                const pendiente=getMontoPendiente(p);
                const ep=calcEstadoPagos(est);
                let estadoPago="Al corriente";
                if(ep&&ep.conRecargo.length>=2)estadoPago="Crítico";
                else if(ep&&ep.conRecargo.length>=1)estadoPago="Vencido";
                else if(pendiente>0)estadoPago="Pendiente";
                else if(mf===0)estadoPago="Sin configurar";
                const base=[prog.nombre,prog.generacion||"",est.nombre||"",est.email||"",est.telefono||"",est.empresa||"",est.estatus||"activo",p.tipo==="unico"?"Pago único":"Parcialidades",p.monto_acordado||0,p.descuento_pct||0,mf.toFixed(2),cobrado.toFixed(2),pendiente.toFixed(2),estadoPago,est.forma_cobro||"",est.requiere_factura||"No"];
                const parcs=p.parcialidades||[];
                if(p.tipo==="unico"){const parc=parcs[0];rows.push([...base,1,mf.toFixed(2),"",parc?.pagado?"Sí":"No",parc?.fecha_pago||"",parc?.folio||""].map(esc).join(","));}
                else if(parcs.length===0){rows.push([...base,"","","","","",""].map(esc).join(","));}
                else{parcs.forEach(parc=>{const montoParc=getMontoParc(parc,mf,parcs.length);rows.push([...base,parc.numero||"",montoParc.toFixed(2),parc.fecha_vencimiento||"",parc.pagado?"Sí":"No",parc.fecha_pago||"",parc.folio||""].map(esc).join(","));});}
              });
            });
            const csv="\uFEFF"+rows.join("\n");
            const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
            const url=URL.createObjectURL(blob);
            const a=document.createElement("a");a.href=url;a.download="respaldo_pagos_"+hoy+".csv";a.click();URL.revokeObjectURL(url);
          };

          return(
            <div>
              <div style={{marginBottom:20,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                <div>
                  <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Control de Pagos</h1>
                  <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>
                    {busqP||progSelP||filtroEstado?"Resultados filtrados":"Todos los programas con estudiantes registrados"}
                  </p>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                  {esHoy15&&<span style={{fontSize:11,fontWeight:700,color:"#7c3aed",background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:99,padding:"3px 10px",fontFamily:"system-ui"}}>💾 Día de respaldo</span>}
                  <button onClick={descargarRespaldo} style={{...S.btn("#fff","#374151",{padding:"8px 14px",border:"1px solid #e5e7eb",fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6})}}>
                    <span style={{fontSize:15}}>⬇</span> Descargar respaldo
                  </button>
                </div>
              </div>

              {/* Resumen — clickeable para filtrar */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:16}}>
                {[
                  {l:"Esperado",  v:totalEsperado,  c:"#1a1a1a", esNum:false, filtro:null},
                  {l:"Cobrado",   v:totalCobrado,   c:"#16a34a", esNum:false, filtro:null},
                  {l:"Pendiente", v:totalPendiente, c:"#d97706", esNum:false, filtro:"pendiente"},
                  {l:"Vencidos",  v:cntVencidos,    c:"#d97706", esNum:true,  filtro:"vencido"},
                  {l:"Críticos",  v:cntCriticos,    c:"#dc2626", esNum:true,  filtro:"critico"},
                  {l:"Inactivos", v:cntInactivos,   c:"#9ca3af", esNum:true,  filtro:"inactivo"},
                ].map(({l,v,c,esNum,filtro})=>{
                  const activo=filtroEstado===filtro&&filtro!==null;
                  const clickable=filtro!==null;
                  return(
                    <div key={l}
                      onClick={clickable?(()=>setFiltroEstado(activo?null:filtro)):undefined}
                      style={{...S.card,padding:"12px 14px",textAlign:"center",cursor:clickable?"pointer":"default",border:activo?"2px solid "+c:"1px solid #e5e7eb",transition:"box-shadow .15s",boxShadow:activo?"0 0 0 3px "+c+"22":"none"}}
                    >
                      <div style={{fontSize:10,fontWeight:700,color:activo?c:"#9ca3af",fontFamily:"system-ui",marginBottom:3}}>{l.toUpperCase()}</div>
                      <div style={{fontSize:esNum?22:18,fontWeight:800,color:c,fontFamily:"system-ui"}}>{esNum?v:fmtMXN(v)}</div>
                      {clickable&&<div style={{fontSize:9,color:activo?c:"#d1d5db",fontFamily:"system-ui",marginTop:2}}>{activo?"▲ activo":"clic para filtrar"}</div>}
                    </div>
                  );
                })}
              </div>

              {/* Filtros */}
              <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                <input value={busqP} onChange={e=>setBusqP(e.target.value)} placeholder="Buscar estudiante, empresa o correo..." style={{...S.inp,flex:1,minWidth:180}}/>
                <select value={progSelP} onChange={e=>setProgSelP(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff"}}>
                  <option value="">Todos los programas</option>
                  <option value="activos">Solo programas activos</option>
                  <option disabled>──────────</option>
                  {(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff"}}>
                  <option value="">Todos los estados</option>
                  <option value="ok">Al corriente</option>
                  <option value="vence_pronto">Vence pronto</option>
                  <option value="vencido">Vencida</option>
                  <option value="critico">Crítico</option>
                  <option value="factura">Requiere factura</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="deposito">Depósito</option>
                  <option value="descuento_especial">Descuento especial</option>
                  <option value="sinconfig">Sin configurar</option>
                  <option value="inactivo">Inactivos</option>
                </select>
                <select value={tipoPago} onChange={e=>setTipoPago(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff"}}>
                  <option value="">Tipo de pago</option>
                  <option value="unico">Pago único</option>
                  <option value="parcialidades">Parcialidades</option>
                </select>
                {(busqP||progSelP||filtroEstado||tipoPago)&&<button onClick={()=>{setBusqP("");setProgSelP("");setFiltroEstado("");setTipoPago("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
              </div>

              {/* LISTA POR PROGRAMA */}
              <div style={{display:"grid",gap:12}}>
                {progsVisibles.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin resultados. Prueba ajustando los filtros.</div>}

                {progsVisibles.map(prog=>{
                  const progAbierto=expandido===prog.id;
                  // Filtrar estudiantes de este programa
                  const estsFiltrados=ests(prog).filter(est=>{
                    if(est.estatus==="baja")return false;
                    const ql=(busqP||"").toLowerCase();
                    if(busqP&&!(est.nombre?.toLowerCase().includes(ql)||est.empresa?.toLowerCase().includes(ql)||est.email?.toLowerCase().includes(ql)))return false;
                    if(filtroEstado==="inactivo")return est.estatus==="inactivo";
                    if(est.estatus==="inactivo"&&filtroEstado!=="inactivo")return false;
                    if(filtroEstado==="factura")return est.requiere_factura==="Sí";
                    if(filtroEstado==="transferencia")return est.forma_cobro==="Transferencia";
                    if(filtroEstado==="deposito")return est.forma_cobro==="Depósito";
                    if(filtroEstado==="descuento_especial")return (est.pago?.descuento_pct||0)>=90;
                    if(filtroEstado==="vence_pronto"){
                      const p=est.pago||{};const hoy=today();
                      return (p.parcialidades||[]).some(parc=>!parc.pagado&&parc.fecha_vencimiento&&(()=>{const diff=Math.round((new Date(parc.fecha_vencimiento+"T12:00:00")-new Date(hoy+"T12:00:00"))/(86400000));return diff>=0&&diff<=2;})());
                    }
                    if(filtroEstado){const {estado}=calcInfoEst(est,prog);return estado===filtroEstado;}
                    if(tipoPago&&(est.pago?.tipo||"unico")!==tipoPago)return false;
                    return true;
                  }).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||"","es"));
                  if(estsFiltrados.length===0)return null;
                  const totalProgEsp=estsFiltrados.reduce((a,e)=>{const {mf}=calcInfoEst(e,prog);return a+mf;},0);
                  const totalProgCob=estsFiltrados.reduce((a,e)=>{const {cobrado}=calcInfoEst(e,prog);return a+cobrado;},0);
                  const pct=totalProgEsp>0?Math.round(totalProgCob/totalProgEsp*100):0;

                  return(
                    <div key={prog.id} style={{...S.card,overflow:"hidden",borderLeft:"4px solid "+prog.color}}>
                      {/* CABECERA DEL PROGRAMA */}
                      <div onClick={()=>{setExpandido(progAbierto?null:prog.id);setExpandidoEst(null);}} style={{padding:"14px 20px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",background:"#fff"}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                            <span style={{fontWeight:700,fontSize:15}}>{prog.nombre}</span>
                            <span style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#6b7280",fontFamily:"system-ui"}}>{prog.tipo}</span>
                            {prog.generacion&&<span style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600}}>{prog.generacion} generación</span>}
                            {prog.modalidad&&<span style={{fontSize:11,background:"#eff6ff",borderRadius:4,padding:"2px 8px",color:"#2563eb",fontFamily:"system-ui"}}>{prog.modalidad}</span>}
                            <StatusBadge p={prog}/>
                          </div>
                          <div style={{display:"flex",gap:12,fontSize:12,color:"#9ca3af",fontFamily:"system-ui",flexWrap:"wrap",alignItems:"center"}}>
                            <span>{estsFiltrados.length} estudiante{estsFiltrados.length!==1?"s":""}</span>
                            <span style={{color:"#1a1a1a",fontWeight:600}}>{fmtMXN(totalProgEsp)}</span>
                            <span style={{color:"#16a34a"}}>Cobrado: {fmtMXN(totalProgCob)}</span>
                            {/* Barra de progreso */}
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <div style={{width:64,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:pct>=80?"#16a34a":"#d97706",borderRadius:4}}/></div>
                              <span style={{fontWeight:700,color:pct>=80?"#16a34a":"#d97706"}}>{pct}%</span>
                            </div>
                          </div>
                        </div>
                        <span style={{color:"#9ca3af",fontSize:18,flexShrink:0}}>{progAbierto?"▲":"▼"}</span>
                      </div>

                      {/* LISTA DE ESTUDIANTES DEL PROGRAMA */}
                      {progAbierto&&(
                        <div style={{borderTop:"1px solid #e5e7eb"}}>
                          {estsFiltrados.map((est,estIdx)=>{
                            const {ep,p,mf,pagadas,total,cobrado,pendiente,estado,pctAsist}=calcInfoEst(est,prog);
                            const st=estadoStyle[estado]||estadoStyle.sinconfig;
                            const recargo=ep&&ep.conRecargo.length>0?(mf/(total||1))*ep.conRecargo.length*(RECARGO_PCT/100):0;
                            const estKey=prog.id+"_"+est.id;
                            const estAbierto=expandidoEst===estKey;
                            const esInactivo=est.estatus==="inactivo";

                            // Asistencia por módulo
                            const asistPorMod=mods(prog).map(mod=>{
                              const k="mod_"+mod.id;
                              const v=est.asistencia&&est.asistencia[k];
                              const asist=Array.isArray(v)?v.length:(v||0);
                              const fechas=getFechasMod(mod);
                              const totalSes=fechas.length||mod.clases||0;
                              return{mod,asist,totalSes};
                            }).filter(x=>x.totalSes>0);
                            const totalSesiones=asistPorMod.reduce((a,x)=>a+x.totalSes,0);
                            const totalAsistidas=asistPorMod.reduce((a,x)=>a+x.asist,0);

                            return(
                              <div key={est.id} style={{borderBottom:estIdx<estsFiltrados.length-1?"1px solid #f3f4f6":"none",background:esInactivo?"#fafafa":"#fff"}}>
                                {/* FILA DEL ESTUDIANTE */}
                                <div onClick={()=>setExpandidoEst(estAbierto?null:estKey)} style={{padding:"12px 20px 12px 28px",display:"flex",gap:10,alignItems:"center",cursor:"pointer",opacity:esInactivo?0.65:1}}>
                                  <div style={{flex:1,minWidth:160}}>
                                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
                                      <span style={{fontWeight:600,fontSize:13,textTransform:"uppercase"}}>{est.nombre}</span>
                                      {esInactivo
                                        ?<span style={{fontSize:10,background:"#f3f4f6",color:"#6b7280",borderRadius:4,padding:"2px 7px",fontFamily:"system-ui",fontWeight:700}}>Inactivo</span>
                                        :calcEtiquetas(est,p,mf,estado).map((et,i)=>(
                                          <span key={i} style={{fontSize:10,background:et.bg,color:et.color,borderRadius:4,padding:"2px 7px",fontFamily:"system-ui",fontWeight:700}}>{et.label}</span>
                                        ))
                                      }
                                      {pctAsist!==null&&pctAsist<80&&!esInactivo&&<span style={{fontSize:10,background:"#fef2f2",color:"#dc2626",borderRadius:4,padding:"2px 7px",fontFamily:"system-ui",fontWeight:700}}>Asist. {pctAsist}%</span>}
                                    </div>
                                    <div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                                      {est.empresa&&<span>{est.empresa}</span>}
                                      {est.email&&<span>{est.email}</span>}
                                      {p.tipo&&mf>0&&<span style={{fontSize:10,background:p.tipo==="unico"?"#f0fdf4":"#eff6ff",color:p.tipo==="unico"?"#16a34a":"#2563eb",borderRadius:3,padding:"1px 6px",fontWeight:600,border:"1px solid "+(p.tipo==="unico"?"#bbf7d0":"#bfdbfe"),flexShrink:0}}>{p.tipo==="unico"?"Pago único":"Parcialidades"}</span>}
                                    </div>
                                  </div>
                                  {/* Asistencia rápida */}
                                  {totalSesiones>0&&(
                                    <div style={{textAlign:"center",flexShrink:0}}>
                                      <div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui"}}>SESIONES</div>
                                      <div style={{fontWeight:700,fontSize:13,fontFamily:"system-ui",color:pctAsist>=80?"#16a34a":"#dc2626"}}>{totalAsistidas}/{totalSesiones}</div>
                                    </div>
                                  )}
                                  {/* Pago rápido */}
                                  {mf>0&&!esInactivo&&<>
                                    <div style={{textAlign:"center",flexShrink:0}}><div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui"}}>ACORDADO</div><div style={{fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>{fmtMXN(mf)}</div></div>
                                    <div style={{textAlign:"center",flexShrink:0}}><div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui"}}>COBRADO</div><div style={{fontWeight:700,fontSize:13,color:"#16a34a",fontFamily:"system-ui"}}>{fmtMXN(cobrado)}</div></div>
                                    <div style={{textAlign:"center",flexShrink:0}}><div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui"}}>PENDIENTE</div><div style={{fontWeight:700,fontSize:13,color:pendiente>0?"#d97706":"#16a34a",fontFamily:"system-ui"}}>{fmtMXN(pendiente)}</div></div>
                                    {p.tipo==="parcialidades"&&<div style={{textAlign:"center",flexShrink:0}}><div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui"}}>PARC.</div><div style={{fontWeight:700,fontSize:13,fontFamily:"system-ui"}}>{pagadas}/{total}</div></div>}
                                  </>}
                                  <span style={{color:"#d1d5db",fontSize:16,flexShrink:0}}>{estAbierto?"▲":"▼"}</span>
                                </div>

                                {/* PANEL DETALLE DEL ESTUDIANTE */}
                                {estAbierto&&(
                                  <div style={{background:"#f9f9f9",borderTop:"1px solid #f3f4f6"}}>
                                    {/* Acciones */}
                                    <div style={{padding:"10px 28px",display:"flex",gap:8,flexWrap:"wrap",borderBottom:"1px solid #f3f4f6",alignItems:"center"}}>
                                      <button onClick={e=>{e.stopPropagation();setEditEstModal({est,prog});}} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>Editar datos</button>
                                      {!esInactivo&&<button onClick={e=>{e.stopPropagation();setPagoModal({est,prog});}} style={S.btn(estado==="critico"||estado==="vencido"?RED:"#f3f4f6",estado==="critico"||estado==="vencido"?"#fff":"#374151",{padding:"5px 12px",fontSize:12})}>{mf===0?"Configurar pago":"Editar pago"}</button>}
                                      <select value={est.forma_cobro||""} onChange={ev=>{ev.stopPropagation();saveEstudiante(prog.id,est.id,{forma_cobro:ev.target.value});}}
                                        style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"5px 10px",fontSize:12,fontFamily:"system-ui",background:"#fff",color:"#374151",cursor:"pointer"}}>
                                        <option value="">Forma de pago...</option>
                                        <option value="Transferencia">Transferencia</option>
                                        <option value="Depósito">Depósito</option>
                                        <option value="Tarjeta">Tarjeta</option>
                                      </select>
                                      {/* Recordatorio pago próximo */}
                                      {!esInactivo&&(estado==="pendiente"||estado==="ok")&&(p.parcialidades||[]).some(x=>!x.pagado&&x.fecha_vencimiento>=today())&&(<>
                                        {est.email&&<button onClick={e=>{e.stopPropagation();abrirCorreo("proximo",est,prog);}} style={S.btn("#eff6ff","#2563eb",{padding:"5px 12px",fontSize:12,border:"1px solid #bfdbfe"})}>✉ Recordatorio</button>}
                                        {est.telefono&&<button onClick={e=>{e.stopPropagation();abrirWhatsApp("proximo",est,prog);}} style={S.btn("#f0fdf4","#16a34a",{padding:"5px 12px",fontSize:12,border:"1px solid #bbf7d0"})}>💬 WA Recordatorio</button>}
                                      </>)}
                                      {/* Mensualidad vencida (1 pago overdue) */}
                                      {!esInactivo&&estado==="vencido"&&(<>
                                        {est.email&&<button onClick={e=>{e.stopPropagation();abrirCorreo("mensualidad",est,prog);}} style={S.btn("#fffbeb","#d97706",{padding:"5px 12px",fontSize:12,border:"1px solid #fcd34d"})}>✉ Mensualidad vencida</button>}
                                        {est.telefono&&<button onClick={e=>{e.stopPropagation();abrirWhatsApp("mensualidad",est,prog);}} style={S.btn("#fffbeb","#d97706",{padding:"5px 12px",fontSize:12,border:"1px solid #fcd34d"})}>💬 WA Mensualidad</button>}
                                      </>)}
                                      {/* Múltiples pagos vencidos (critico) */}
                                      {!esInactivo&&estado==="critico"&&(<>
                                        {est.email&&<button onClick={e=>{e.stopPropagation();abrirCorreo("vencido",est,prog);}} style={S.btn("#fef2f2",RED,{padding:"5px 12px",fontSize:12,border:"1px solid #fca5a5"})}>✉ Aviso vencido</button>}
                                        {est.telefono&&<button onClick={e=>{e.stopPropagation();abrirWhatsApp("vencido",est,prog);}} style={S.btn("#fef2f2",RED,{padding:"5px 12px",fontSize:12,border:"1px solid #fca5a5"})}>💬 WA Vencido</button>}
                                      </>)}
                                      {/* Evaluación de diplomado */}
                                      {est.email&&(
                                        <button onClick={e=>{e.stopPropagation();abrirEvaluacion("diplomado",est,prog,null);}} style={S.btn("#f5f3ff","#7c3aed",{padding:"5px 12px",fontSize:12,border:"1px solid #ddd6fe"})}>✉ Eval. diplomado</button>
                                      )}
                                      {/* Botón Activo / Inactivo / Baja */}
                                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                                      {esInactivo
                                        ?<button onClick={ev=>{ev.stopPropagation();setCS({titulo:"Reactivar estudiante",mensaje:`¿Reactivar a "${est.nombre}"? Volverá a aparecer en reportes y control de pagos.`,onConfirm:()=>marcarInactivo(prog.id,est.id,"activo"),btnLabel:"Sí, reactivar",btnColor:"#16a34a"});}} style={S.btn("#f0fdf4","#16a34a",{padding:"5px 12px",fontSize:12,border:"1px solid #bbf7d0"})}>Reactivar</button>
                                        :<button onClick={ev=>{ev.stopPropagation();setCS({titulo:"Marcar como inactivo",mensaje:`¿Marcar a "${est.nombre}" como inactivo? Saldrá de los reportes activos y contará en la tasa de deserción.`,onConfirm:()=>marcarInactivo(prog.id,est.id,"inactivo"),btnLabel:"Sí, confirmar",btnColor:"#d97706"});}} style={S.btn("#fffbeb","#d97706",{padding:"5px 12px",fontSize:12,border:"1px solid #fde68a"})}>Marcar inactivo</button>
                                      }
                                      <button onClick={ev=>{ev.stopPropagation();setBajaRazon("");setBajaModal({est,prog});}} style={S.btn("#fef2f2","#dc2626",{padding:"5px 12px",fontSize:12,border:"1px solid #fca5a5"})}>Dar de baja</button>
                                      </div>
                                      {esInactivo&&<span style={{fontSize:11,color:"#d97706",fontFamily:"system-ui",fontStyle:"italic"}}>Cuenta en tasa de deserción en Reportes</span>}
                                      {estado==="critico"&&!esInactivo&&<span style={{fontSize:11,color:"#dc2626",fontFamily:"system-ui",fontStyle:"italic"}}>2+ pagos vencidos — considera marcar inactivo</span>}
                                    </div>

                                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
                                      {/* COL IZQ: Datos personales + Asistencia */}
                                      <div style={{padding:"14px 20px 14px 28px",borderRight:"1px solid #f3f4f6"}}>
                                        <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:8}}>DATOS</div>
                                        <div style={{display:"grid",gap:5,fontFamily:"system-ui",fontSize:12,marginBottom:10}}>
                                          {est.telefono&&<div><span style={{color:"#9ca3af"}}>Tel: </span>{est.telefono}</div>}
                                          {est.puesto&&<div><span style={{color:"#9ca3af"}}>Puesto: </span>{est.puesto}</div>}
                                          {est.carrera&&<div><span style={{color:"#9ca3af"}}>Carrera: </span>{est.carrera}</div>}
                                          {est.grado&&<div><span style={{color:"#9ca3af"}}>Grado: </span>{est.grado}</div>}
                                          {est.egresado_ibero&&<div><span style={{color:"#9ca3af"}}>Eg. IBERO: </span><span style={{color:"#2563eb",fontWeight:600}}>{est.egresado_ibero}</span></div>}
                                        </div>
                                        {/* Factura / CSF */}
                                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                                          <span style={{fontSize:11,background:est.requiere_factura==="Sí"?"#fef2f2":"#f3f4f6",borderRadius:4,padding:"2px 9px",color:est.requiere_factura==="Sí"?RED:"#6b7280",fontFamily:"system-ui",fontWeight:700,border:"1px solid "+(est.requiere_factura==="Sí"?"#fca5a5":"#e5e7eb")}}>
                                            {est.requiere_factura==="Sí"?"Requiere factura":"Sin factura"}
                                          </span>
                                          {est.csf_url
                                            ?<a href={est.csf_url} target="_blank" rel="noreferrer" style={{fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 9px",color:"#16a34a",fontFamily:"system-ui",fontWeight:600,textDecoration:"none",border:"1px solid #bbf7d0"}}>Ver CSF</a>
                                            :<span style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>Sin CSF</span>
                                          }
                                        </div>
                                        {/* Asistencia por módulo + global */}
                                        {asistPorMod.length>0&&(
                                          <div>
                                            <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>ASISTENCIA</div>
                                            {/* Global */}
                                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                                              <div style={{flex:1,height:5,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:(pctAsist||0)+"%",height:"100%",background:pctAsist>=80?"#16a34a":"#dc2626",borderRadius:4}}/></div>
                                              <span style={{fontWeight:800,fontSize:14,color:pctAsist>=80?"#16a34a":"#dc2626",fontFamily:"system-ui",minWidth:36}}>{pctAsist??0}%</span>
                                              <span style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>{totalAsistidas}/{totalSesiones} sesiones</span>
                                            </div>
                                            {/* Por módulo */}
                                            {asistPorMod.map(({mod,asist,totalSes})=>{
                                              const pm=totalSes?Math.round(asist/totalSes*100):0;
                                              return(
                                                <div key={mod.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                                                  <span style={{fontSize:10,background:prog.color,color:"#fff",borderRadius:3,padding:"1px 5px",fontWeight:700,fontFamily:"system-ui",flexShrink:0}}>{mod.numero}</span>
                                                  <div style={{flex:1,height:3,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:pm+"%",height:"100%",background:pm>=80?"#16a34a":"#dc2626",borderRadius:4}}/></div>
                                                  <span style={{fontSize:11,fontFamily:"system-ui",color:pm>=80?"#16a34a":"#dc2626",fontWeight:600,minWidth:32}}>{asist}/{totalSes}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>

                                      {/* COL DER: Parcialidades izq→der */}
                                      <div style={{padding:"14px 20px"}}>
                                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                                          <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px"}}>
                                            {p.tipo==="unico"?"PAGO ÚNICO":"PARCIALIDADES"}
                                            {mf>0&&<span style={{marginLeft:6,color:"#374151",fontWeight:400}}>· {fmtMXN(mf)}{p.descuento_pct>0?` (−${p.descuento_pct}%)`:""}</span>}
                                          </div>
                                          {mf>0&&!esInactivo&&<span style={{fontSize:9,color:"#9ca3af",fontFamily:"system-ui",fontStyle:"italic"}}>clic para marcar</span>}
                                        </div>
                                        {!mf&&<div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>Sin configurar — usa "Configurar pago"</div>}
                                        {p.tipo==="unico"&&mf>0&&(()=>{
                                          const pagadoUnico=(p.parcialidades||[]).some(x=>x.pagado);
                                          const toggleUnico=e=>{
                                            e.stopPropagation();
                                            if(esInactivo)return;
                                            const marcando=!pagadoUnico;
                                            const aplicar=(folio="",fecha=today())=>{
                                              const newParcs=(p.parcialidades||[]).length>0
                                                ?(p.parcialidades||[]).map(x=>({...x,pagado:marcando,fecha_pago:marcando?fecha:null,folio:marcando?folio:null}))
                                                :[{id:est.id+"_p1",numero:1,pagado:marcando,fecha_pago:marcando?fecha:null,folio:marcando?folio:null}];
                                              savePago(prog.id,est.id,{...p,parcialidades:newParcs});
                                            };
                                            if(marcando){
                                              setFolioModal({onConfirm:aplicar,onSkip:()=>aplicar("",today())});
                                            } else { setCS({titulo:"¿Desmarcar pago?",mensaje:"Se eliminará el registro de pago de este estudiante. ¿Confirmas?",onConfirm:()=>aplicar("")}); }
                                          };
                                          const parcUnico=(p.parcialidades||[])[0];
                                          return(
                                            <div style={{display:"flex",flexDirection:"column",gap:6}}>
                                              <div onClick={toggleUnico} style={{display:"flex",gap:10,alignItems:"center",padding:"10px 12px",borderRadius:8,cursor:esInactivo?"default":"pointer",background:pagadoUnico?"#f0fdf4":"#fffbeb",border:"1px solid "+(pagadoUnico?"#bbf7d0":"#fde68a"),transition:"all .15s"}}>
                                                <div style={{width:22,height:22,borderRadius:"50%",background:pagadoUnico?"#16a34a":"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background .15s"}}>
                                                  <span style={{color:"#fff",fontSize:11,fontWeight:700}}>{pagadoUnico?"✓":""}</span>
                                                </div>
                                                <div style={{flex:1}}>
                                                  <div style={{fontFamily:"system-ui",fontSize:13,fontWeight:700,color:pagadoUnico?"#16a34a":"#d97706"}}>{pagadoUnico?"Cubierto":"Pendiente"} — {fmtMXN(mf)}</div>
                                                  {pagadoUnico&&parcUnico?.fecha_pago&&<div style={{fontSize:10,color:"#6b7280",fontFamily:"system-ui",marginTop:1}}>Pagado el {fmtFecha(parcUnico.fecha_pago)}</div>}
                                                </div>
                                              </div>
                                              {pagadoUnico&&(
                                                <div style={{display:"flex",gap:6}}>
                                                  <input
                                                    defaultValue={parcUnico?.folio||""}
                                                    placeholder="Folio"
                                                    onClick={ev=>ev.stopPropagation()}
                                                    onBlur={ev=>{ev.stopPropagation();const val=ev.target.value.trim();if(val!==(parcUnico?.folio||"")){const newParcs=(p.parcialidades||[]).map((x,i)=>i===0?{...x,folio:val}:x);savePago(prog.id,est.id,{...p,parcialidades:newParcs});}}}
                                                    style={{flex:1,border:"1px solid "+(parcUnico?.folio?"#bfdbfe":"#fde68a"),borderRadius:4,padding:"3px 6px",fontSize:10,fontFamily:"system-ui",color:parcUnico?.folio?"#2563eb":"#d97706",outline:"none",background:parcUnico?.folio?"#eff6ff":"#fffbeb"}}
                                                  />
                                                  <input
                                                    type="date"
                                                    defaultValue={parcUnico?.fecha_pago||""}
                                                    onClick={ev=>ev.stopPropagation()}
                                                    onBlur={ev=>{ev.stopPropagation();const val=ev.target.value;if(val!==(parcUnico?.fecha_pago||"")){const newParcs=(p.parcialidades||[]).map((x,i)=>i===0?{...x,fecha_pago:val}:x);savePago(prog.id,est.id,{...p,parcialidades:newParcs});}}}
                                                    style={{border:"1px solid #bbf7d0",borderRadius:4,padding:"3px 6px",fontSize:10,fontFamily:"system-ui",color:"#16a34a",outline:"none",background:"#f0fdf4"}}
                                                  />
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {p.tipo==="parcialidades"&&(
                                          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                                            {(p.parcialidades||[]).map((parc,j)=>{
                                              const vencido=!parc.pagado&&parc.fecha_vencimiento&&parc.fecha_vencimiento<today();
                                              const toggleParc=e=>{
                                                e.stopPropagation();
                                                if(esInactivo)return;
                                                const marcando=!parc.pagado;
                                                const aplicar=(folio="",fecha=today())=>{
                                                  const newParcs=(p.parcialidades||[]).map((x,idx)=>idx===j?{...x,pagado:marcando,fecha_pago:marcando?fecha:null,folio:marcando?folio:null}:x);
                                                  savePago(prog.id,est.id,{...p,parcialidades:newParcs});
                                                };
                                                if(marcando){
                                                  setFolioModal({onConfirm:aplicar,onSkip:()=>aplicar("",today())});
                                                } else { setCS({titulo:"¿Desmarcar parcialidad?",mensaje:`¿Confirmas que deseas desmarcar la parcialidad ${parc.numero} como no pagada?`,onConfirm:()=>aplicar("")}); }
                                              };
                                              return(
                                                <div key={parc.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,minWidth:64}}>
                                                  {/* Chip clickeable */}
                                                  <div onClick={toggleParc} style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"8px 10px",borderRadius:8,cursor:esInactivo?"default":"pointer",background:parc.pagado?"#f0fdf4":vencido?"#fef2f2":"#fafafa",border:"1px solid "+(parc.pagado?"#bbf7d0":vencido?"#fca5a5":"#e5e7eb"),transition:"all .15s",width:"100%"}}>
                                                    <div style={{width:22,height:22,borderRadius:"50%",background:parc.pagado?"#16a34a":vencido?"#dc2626":"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:3,transition:"background .15s"}}>
                                                      <span style={{color:"#fff",fontSize:10,fontWeight:700}}>{parc.pagado?"✓":parc.numero}</span>
                                                    </div>
                                                    <div style={{fontSize:10,fontWeight:700,fontFamily:"system-ui",color:parc.pagado?"#16a34a":vencido?"#dc2626":"#374151"}}>{fmtMXN(getMontoParc(parc,mf,total))}</div>
                                                    <div style={{fontSize:9,color:"#9ca3af",fontFamily:"system-ui",textAlign:"center"}}>{parc.pagado&&parc.fecha_pago?fmtFecha(parc.fecha_pago):parc.fecha_vencimiento?fmtFecha(parc.fecha_vencimiento):""}</div>
                                                  </div>
                                                  {/* Folio inline */}
                                                  <input
                                                    defaultValue={parc.folio||""}
                                                    placeholder="Folio"
                                                    onClick={ev=>ev.stopPropagation()}
                                                    onBlur={ev=>{
                                                      ev.stopPropagation();
                                                      const val=ev.target.value.trim();
                                                      if(val!==(parc.folio||"")){
                                                        const newParcs=(p.parcialidades||[]).map((x,idx)=>idx===j?{...x,folio:val}:x);
                                                        savePago(prog.id,est.id,{...p,parcialidades:newParcs});
                                                      }
                                                    }}
                                                    style={{width:"100%",border:"1px solid "+(parc.folio?"#bfdbfe":"#fde68a"),borderRadius:4,padding:"2px 4px",fontSize:9,fontFamily:"system-ui",color:parc.folio?"#2563eb":"#d97706",outline:"none",background:parc.folio?"#eff6ff":"#fffbeb",textAlign:"center"}}
                                                  />
                                                  {/* Fecha inline — solo si está pagada */}
                                                  {parc.pagado&&(
                                                    <input
                                                      type="date"
                                                      defaultValue={parc.fecha_pago||""}
                                                      onClick={ev=>ev.stopPropagation()}
                                                      onBlur={ev=>{
                                                        ev.stopPropagation();
                                                        const val=ev.target.value;
                                                        if(val!==(parc.fecha_pago||"")){
                                                          const newParcs=(p.parcialidades||[]).map((x,idx)=>idx===j?{...x,fecha_pago:val}:x);
                                                          savePago(prog.id,est.id,{...p,parcialidades:newParcs});
                                                        }
                                                      }}
                                                      style={{width:"100%",border:"1px solid #bbf7d0",borderRadius:4,padding:"2px 4px",fontSize:9,fontFamily:"system-ui",color:"#16a34a",outline:"none",background:"#f0fdf4",textAlign:"center"}}
                                                    />
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {recargo>0&&(
                                          <div style={{marginTop:8,padding:"6px 10px",background:"#fef2f2",borderRadius:6,fontFamily:"system-ui",fontSize:11,color:"#dc2626",display:"flex",justifyContent:"space-between"}}>
                                            <span>Recargo acumulado (6.5%)</span>
                                            <strong>{fmtMXN(recargo)}</strong>
                                          </div>
                                        )}
                                        {/* Notas rápidas */}
                                        <div style={{marginTop:10}}>
                                          <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:4}}>NOTAS</div>
                                          <textarea
                                            defaultValue={p.notas||""}
                                            onBlur={e=>{
                                              const val=e.target.value.trim();
                                              if(val!==(p.notas||"").trim()){
                                                savePago(prog.id,est.id,{...p,notas:val});
                                              }
                                            }}
                                            onClick={ev=>ev.stopPropagation()}
                                            placeholder="Escribe y haz clic fuera para guardar..."
                                            rows={2}
                                            style={{width:"100%",boxSizing:"border-box",border:"1px solid #e5e7eb",borderRadius:6,padding:"7px 10px",fontSize:11,fontFamily:"system-ui",color:"#374151",resize:"vertical",outline:"none",background:"#fff",lineHeight:1.5}}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* FACTURACIÓN */}
        {view==="facturacion"&&(()=>{
          const todos = (programas||[]).flatMap(prog=>
            ests(prog).filter(e=>e.estatus!=="baja"&&e.estatus!=="inactivo").map(e=>({e,prog}))
          );
          // Helper: pagó algo en el mes seleccionado (por fecha_pago)
          const pagoEnMes=(e,mes)=>{
            const p=e.pago||{};
            return (p.parcialidades||[]).some(x=>x.pagado&&x.fecha_pago&&x.fecha_pago.startsWith(mes));
          };
          // Mes de referencia para "Factura pendiente":
          // días 1-5 del mes → mostramos facturas del mes anterior (gracia)
          // resto del mes → mes actual
          const diaHoy=new Date().getDate();
          const mesFactRef=(()=>{
            if(diaHoy<=5){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return d.toISOString().substring(0,7);}
            return today().substring(0,7);
          })();
          const esPendienteFact=(e)=>e.requiere_factura==="Sí"&&pagoEnMes(e,mesFactRef)&&!e.factura_enviada;
          const lista = todos.filter(({e,prog})=>{
            if(filtroFactProg&&prog.id!==filtroFactProg)return false;
            if(filtroFactTipo==="pagaron"&&!pagoEnMes(e,filtroFactMes))return false;
            if(filtroFactTipo==="pendiente"&&!esPendienteFact(e))return false;
            if(filtroFactTipo==="enviada"&&!e.factura_enviada)return false;
            if(busqFacturacion){
              const q=busqFacturacion.toLowerCase();
              const tieneFolio=(e.pago?.parcialidades||[]).some(parc=>parc.folio?.toLowerCase().includes(q));
              return e.nombre?.toLowerCase().includes(q)||e.email?.toLowerCase().includes(q)||e.telefono?.toLowerCase().includes(q)||tieneFolio;
            }
            return true;
          }).sort((a,b)=>(a.e.nombre||"").localeCompare(b.e.nombre||"","es"));
          // Contadores para badges
          const cPagaron=todos.filter(({e})=>pagoEnMes(e,filtroFactMes)).length;
          const cPendiente=todos.filter(({e})=>esPendienteFact(e)).length;
          const cEnviada=todos.filter(({e})=>e.factura_enviada).length;

          const toggleEnviada=(progId,estId)=>{
            const ahora=today();
            save((programas||[]).map(p=>p.id!==progId?p:{...p,
              estudiantes:ests(p).map(e=>e.id!==estId?e:{...e,
                factura_enviada:!e.factura_enviada,
                fecha_factura_enviada:!e.factura_enviada?ahora:"",
              })
            }));
          };

          const exportCSV = () => {
            const cols = ["Nombre","Teléfono","Correo","Empresa","Programa","RFC","Razón social","Régimen fiscal","CP","Calle","No. Ext","No. Int","Colonia","Ciudad","Estado","Uso CFDI","CSF","Tipo pago","Monto","Parcialidades pagadas","Total parcialidades"];
            const rows = lista.map(({e,prog})=>{
              const p=e.pago||{}; const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
              const pagadas=(p.parcialidades||[]).filter(x=>x.pagado).length;
              const total=(p.parcialidades||[]).length;
              return [e.nombre,e.telefono||"",e.email||"",e.empresa||"",prog.nombre,e.rfc||"",e.razon_social||"",e.regimen_fiscal||"",e.codigo_postal||"",e.calle||"",e.num_exterior||"",e.num_interior||"",e.colonia||"",e.ciudad||"",e.estado||"",e.uso_cfdi||"",e.csf_url||"",p.tipo||"",mf,pagadas,total].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",");
            });
            const csv=[cols.map(c=>'"'+c+'"').join(","),...rows].join("\n");
            const a=document.createElement("a"); a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv); a.download="facturacion_ibero_"+today()+".csv"; a.click();
          };

          return(
            <div>
              {/* Encabezado */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16,flexWrap:"wrap",gap:10}}>
                <div>
                  <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Facturación</h1>
                  <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>{lista.length} estudiante{lista.length!==1?"s":""} mostrados</p>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <input value={busqFacturacion} onChange={e=>setBusqFacturacion(e.target.value)} placeholder="Buscar nombre, folio..." style={{...S.inp,minWidth:180,fontSize:13}}/>
                  <select value={filtroFactProg} onChange={e=>setFiltroFactProg(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff"}}>
                    <option value="">Todos los programas</option>
                    {(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  {(filtroFactProg||busqFacturacion||filtroFactTipo)&&<button onClick={()=>{setFiltroFactProg("");setBusqFacturacion("");setFiltroFactTipo("");}} style={S.btn("#f3f4f6","#374151",{padding:"8px 12px",fontSize:13})}>Limpiar</button>}
                  <button onClick={exportCSV} style={S.btn("#f0fdf4","#16a34a",{border:"1px solid #bbf7d0",fontSize:13,padding:"8px 16px"})}>Exportar CSV</button>
                </div>
              </div>

              {/* Selector de mes + filtros tipo */}
              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,padding:"6px 12px"}}>
                  <span style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",fontWeight:600}}>Mes:</span>
                  <input type="month" value={filtroFactMes} onChange={e=>setFiltroFactMes(e.target.value)} style={{border:"none",outline:"none",fontSize:13,fontFamily:"system-ui",color:"#111",background:"transparent",cursor:"pointer"}}/>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[
                    {v:"",label:"Todos",count:todos.length,bg:"#f3f4f6",color:"#374151",activeBg:"#374151",activeColor:"#fff"},
                    {v:"pagaron",label:"Pagaron este mes",count:cPagaron,bg:"#eff6ff",color:"#2563eb",activeBg:"#2563eb",activeColor:"#fff"},
                    {v:"pendiente",label:"Factura pendiente",count:cPendiente,bg:"#fffbeb",color:"#d97706",activeBg:"#d97706",activeColor:"#fff"},
                    {v:"enviada",label:"Factura enviada",count:cEnviada,bg:"#f0fdf4",color:"#16a34a",activeBg:"#16a34a",activeColor:"#fff"},
                  ].map(({v,label,count,bg,color,activeBg,activeColor})=>{
                    const activo=filtroFactTipo===v;
                    return(
                      <button key={v} onClick={()=>setFiltroFactTipo(v)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"system-ui",fontSize:12,fontWeight:700,background:activo?activeBg:bg,color:activo?activeColor:color,transition:"all .15s"}}>
                        {label}
                        <span style={{background:activo?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.08)",borderRadius:10,padding:"1px 7px",fontSize:11}}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {lista.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin resultados con los filtros actuales.</div>}

              <div style={{display:"grid",gap:10}}>
                {lista.map(({e,prog})=>{
                  const p=e.pago||{}; const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
                  const pagadas=(p.parcialidades||[]).filter(x=>x.pagado).length;
                  const total=(p.parcialidades||[]).length;
                  return(
                    <div key={e.id} style={{...S.card,overflow:"hidden",borderLeft:"4px solid "+prog.color,padding:0}}>
                      <div style={{display:"grid",gridTemplateColumns:"220px 1fr 1fr auto",gap:0,alignItems:"stretch"}}>

                        {/* 1. Contacto */}
                        <div style={{padding:"14px 16px",borderRight:"1px solid #f3f4f6"}}>
                          <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{e.nombre}</div>
                          {e.empresa&&<div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui",marginBottom:4}}>{e.empresa}</div>}
                          <div style={{fontSize:11,background:prog.color,color:"#fff",borderRadius:4,padding:"1px 7px",display:"inline-block",fontFamily:"system-ui",fontWeight:600,marginBottom:6}}>{prog.nombre}{prog.generacion?` · ${prog.generacion}`:""}</div>
                          <div style={{display:"grid",gap:2,fontFamily:"system-ui",fontSize:11,color:"#6b7280"}}>
                            {e.telefono&&<div>📞 {e.telefono}</div>}
                            {e.email&&<div>✉ {e.email}</div>}
                          </div>
                        </div>

                        {/* 2. Datos fiscales */}
                        <div style={{padding:"14px 16px",borderRight:"1px solid #f3f4f6"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px"}}>DATOS FISCALES</div>
                            <div style={{display:"flex",gap:4}}>
                              {!e.rfc&&<button onClick={async()=>{
                                const token=e.fiscal_token||newId();
                                if(!e.fiscal_token){
                                  save((programas||[]).map(p=>p.id!==prog.id?p:{...p,estudiantes:ests(p).map(x=>x.id!==e.id?x:{...x,fiscal_token:token})}));
                                  await supa.upsert("estudiantes",[{id:e.id,fiscal_token:token}]).catch(()=>{});
                                }
                                const url=window.location.href.split("?")[0]+"?fiscal="+token;
                                setFiscalSolicitudModal({progId:prog.id,est:{...e,fiscal_token:token},url});
                              }} style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:4,padding:"1px 7px",cursor:"pointer",fontSize:10,fontFamily:"system-ui",color:"#d97706",fontWeight:600}}>Solicitar</button>}
                              <button onClick={()=>setFiscalModal({progId:prog.id,est:e})} style={{background:"none",border:"1px solid #e5e7eb",borderRadius:4,padding:"1px 7px",cursor:"pointer",fontSize:10,fontFamily:"system-ui",color:"#6b7280",fontWeight:600}}>Editar</button>
                            </div>
                          </div>
                          <div style={{display:"grid",gap:3,fontFamily:"system-ui",fontSize:11}}>
                            {e.rfc&&<div><span style={{color:"#9ca3af"}}>RFC: </span><span style={{fontWeight:700,letterSpacing:"0.5px"}}>{e.rfc}</span></div>}
                            {e.razon_social&&<div><span style={{color:"#9ca3af"}}>Razón social: </span><span style={{fontWeight:600}}>{e.razon_social}</span></div>}
                            {e.regimen_fiscal&&<div><span style={{color:"#9ca3af"}}>Régimen: </span><span style={{fontWeight:500}}>{e.regimen_fiscal}</span></div>}
                            {e.uso_cfdi&&<div><span style={{color:"#9ca3af"}}>Uso CFDI: </span><span style={{fontWeight:500}}>{e.uso_cfdi}</span></div>}
                          </div>
                          {(e.calle||e.colonia||e.ciudad)&&(
                            <div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui",marginTop:6,padding:"5px 8px",background:"#f9f9f9",borderRadius:5,lineHeight:1.5}}>
                              {[e.calle,e.num_exterior&&"#"+e.num_exterior,e.num_interior&&"Int."+e.num_interior].filter(Boolean).join(" ")}{(e.colonia||e.ciudad||e.estado)&&<br/>}
                              {[e.colonia,e.ciudad,e.estado,e.codigo_postal&&"C.P."+e.codigo_postal].filter(Boolean).join(", ")}
                            </div>
                          )}
                          {e.csf_url
                            ?<a href={e.csf_url} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:6,fontSize:11,background:"#f0fdf4",borderRadius:4,padding:"2px 8px",color:"#16a34a",fontWeight:600,textDecoration:"none",border:"1px solid #bbf7d0"}}>Ver CSF</a>
                            :<span style={{fontSize:10,color:"#d1d5db",fontFamily:"system-ui",marginTop:6,display:"block"}}>Sin CSF</span>
                          }
                        </div>

                        {/* 3. Parcialidades */}
                        <div style={{padding:"14px 16px",borderRight:"1px solid #f3f4f6"}}>
                          <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>{p.tipo==="unico"?"PAGO ÚNICO":"PARCIALIDADES"}{mf>0&&<span style={{marginLeft:6,color:"#374151",fontWeight:400}}>· {fmtMXN(mf)}</span>}</div>
                          {!mf&&<div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>Sin configurar</div>}
                          {p.tipo==="unico"&&mf>0&&(
                            <div style={{display:"flex",gap:7,alignItems:"center",padding:"6px 8px",borderRadius:6,background:pagadas>0?"#f0fdf4":"#fffbeb",border:"1px solid "+(pagadas>0?"#bbf7d0":"#fde68a")}}>
                              <div style={{width:14,height:14,borderRadius:"50%",background:pagadas>0?"#16a34a":"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:7,fontWeight:700}}>{pagadas>0?"✓":""}</span></div>
                              <div style={{flex:1}}>
                                <span style={{fontFamily:"system-ui",fontSize:11,fontWeight:600,color:pagadas>0?"#16a34a":"#d97706"}}>{pagadas>0?"Cubierto":"Pendiente"}</span>
                                {(p.parcialidades||[]).map((parc,j)=>parc.folio?(
                                  <div key={j} style={{fontSize:9,fontWeight:700,color:"#2563eb",fontFamily:"system-ui"}}>{parc.folio}</div>
                                ):pagadas>0?<div key={j} style={{fontSize:9,color:"#d97706",fontFamily:"system-ui"}}>Folio pendiente</div>:null)}
                              </div>
                            </div>
                          )}
                          {p.tipo==="parcialidades"&&(
                            <div style={{display:"grid",gap:2}}>
                              {(p.parcialidades||[]).map(parc=>{
                                const venc=!parc.pagado&&parc.fecha_vencimiento&&parc.fecha_vencimiento<today();
                                return(
                                  <div key={parc.id} style={{display:"flex",gap:6,alignItems:"center",padding:"4px 7px",borderRadius:5,background:parc.pagado?"#f0fdf4":venc?"#fef2f2":"#fafafa",border:"1px solid "+(parc.pagado?"#bbf7d0":venc?"#fca5a5":"#f3f4f6")}}>
                                    <div style={{width:12,height:12,borderRadius:"50%",background:parc.pagado?"#16a34a":venc?"#dc2626":"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:6,fontWeight:700}}>{parc.pagado?"✓":""}</span></div>
                                    <span style={{fontFamily:"system-ui",fontSize:10,flex:1,fontWeight:600,color:parc.pagado?"#16a34a":venc?"#dc2626":"#374151"}}>#{parc.numero} · {fmtMXN(getMontoParc(parc,mf,total))}</span>
                                    <div style={{textAlign:"right"}}>
                                      <span style={{fontSize:9,color:"#9ca3af",fontFamily:"system-ui",display:"block"}}>{parc.pagado&&parc.fecha_pago?fmtFecha(parc.fecha_pago):parc.fecha_vencimiento?fmtFecha(parc.fecha_vencimiento):""}</span>
                                      {parc.pagado&&<span style={{fontSize:9,fontWeight:700,fontFamily:"system-ui",color:parc.folio?"#2563eb":"#d97706"}}>{parc.folio||"Folio pendiente"}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* 4. Estado + Factura enviada */}
                        <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",justifyContent:"space-between",gap:8,minWidth:110}}>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                            <div style={{fontWeight:800,fontSize:15,fontFamily:"system-ui"}}>{fmtMXN(mf)}</div>
                            <div style={{fontSize:10,fontFamily:"system-ui",fontWeight:700,color:p.tipo==="unico"?"#16a34a":"#2563eb",background:p.tipo==="unico"?"#f0fdf4":"#eff6ff",borderRadius:4,padding:"2px 7px"}}>{p.tipo==="unico"?"Único":"Parcialidades"}</div>
                            {p.tipo==="parcialidades"&&total>0&&<div style={{fontSize:11,fontFamily:"system-ui",fontWeight:700,color:pagadas===total?"#16a34a":"#d97706"}}>{pagadas}/{total} pagadas</div>}
                            {e.requiere_factura==="Sí"&&<span style={{fontSize:9,background:"#eff6ff",color:"#2563eb",borderRadius:4,padding:"1px 6px",fontFamily:"system-ui",fontWeight:700}}>Requiere factura</span>}
                          </div>
                          {/* Factura enviada */}
                          <div
                            onClick={()=>setCS({
                              titulo: e.factura_enviada?"Desmarcar factura enviada":"Marcar factura como enviada",
                              mensaje: e.factura_enviada
                                ?`¿Quieres desmarcar la factura de ${e.nombre}?`
                                :`¿Confirmas que ya se envió la factura a ${e.nombre}?`,
                              onConfirm:()=>toggleEnviada(prog.id,e.id),
                              btnLabel:"Sí, confirmar",
                              btnColor:"#16a34a",
                            })}
                            style={{cursor:"pointer",borderRadius:8,padding:"7px 10px",background:e.factura_enviada?"#f0fdf4":"#fafafa",border:"1px solid "+(e.factura_enviada?"#86efac":"#e5e7eb"),display:"flex",flexDirection:"column",alignItems:"center",gap:2,userSelect:"none"}}>
                            <div style={{display:"flex",alignItems:"center",gap:5}}>
                              <div style={{width:16,height:16,borderRadius:4,border:"2px solid "+(e.factura_enviada?"#16a34a":"#d1d5db"),background:e.factura_enviada?"#16a34a":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                {e.factura_enviada&&<span style={{color:"#fff",fontSize:9,fontWeight:700}}>✓</span>}
                              </div>
                              <span style={{fontSize:11,fontWeight:700,fontFamily:"system-ui",color:e.factura_enviada?"#16a34a":"#9ca3af"}}>Factura enviada</span>
                            </div>
                            {e.factura_enviada&&e.fecha_factura_enviada&&(
                              <span style={{fontSize:9,color:"#16a34a",fontFamily:"system-ui"}}>{fmtFecha(e.fecha_factura_enviada)}</span>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* HONORARIOS DOCENTES */}
        {view==="honorarios"&&<HonorariosView programas={programas} docentes={docentes} onToggle={toggleHonorario} session={session} setCS={setCS}/>}

        {/* COBRANZA */}
        {view==="cobranza"&&(()=>{
          const hoy=today();

          // ─ Helpers ─
          const diasDesde = fecha => {
            if(!fecha) return null;
            const diff = Math.round((new Date(hoy+"T12:00:00")-new Date(fecha+"T12:00:00"))/86400000);
            return diff;
          };

          // ─ Construir lista de estudiantes con balance pendiente ─
          const lista=[];
          (programas||[]).forEach(prog=>{
            (prog.estudiantes||[]).filter(e=>e.estatus!=="baja"&&e.estatus!=="inactivo").forEach(est=>{
              const p=est.pago||{};
              const mf=(p.monto_acordado||0)*(1-(p.descuento_pct||0)/100);
              if(!mf) return;
              const parcialidades=p.parcialidades||[];
              const pagadas=parcialidades.filter(x=>x.pagado);
              let pendienteMonto=0, vencidas=[], proximas=[];
              if(p.tipo==="unico"){
                if(pagadas.length) return; // único ya pagó
                pendienteMonto=mf;
                // fecha vencimiento: primera parcialidad si existe
                const fv=parcialidades[0]?.fecha_vencimiento;
                if(fv&&fv<hoy) vencidas=[parcialidades[0]];
                else if(fv) proximas=[parcialidades[0]];
              } else {
                // parcialidades
                const noPag=parcialidades.filter(x=>!x.pagado);
                if(!noPag.length) return; // todas pagadas
                pendienteMonto=(mf/parcialidades.length||1)*noPag.length;
                vencidas=noPag.filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento<hoy);
                proximas=noPag.filter(x=>x.fecha_vencimiento&&x.fecha_vencimiento>=hoy);
              }
              // Urgencia
              let urgencia, urgLabel, urgColor, urgBg;
              if(vencidas.length>=2){urgencia=0;urgLabel="Crítico";urgColor="#dc2626";urgBg="#fef2f2";}
              else if(vencidas.length===1){urgencia=1;urgLabel="Vencido";urgColor="#d97706";urgBg="#fffbeb";}
              else if(proximas.length&&proximas[0].fecha_vencimiento){
                const dias=Math.round((new Date(proximas[0].fecha_vencimiento+"T12:00:00")-new Date(hoy+"T12:00:00"))/86400000);
                if(dias<=7){urgencia=2;urgLabel="Vence pronto";urgColor="#2563eb";urgBg="#eff6ff";}
                else{urgencia=3;urgLabel="Al día";urgColor="#16a34a";urgBg="#f0fdf4";}
              } else {urgencia=3;urgLabel="Al día";urgColor="#16a34a";urgBg="#f0fdf4";}
              const diasUltimoContacto=diasDesde(est.cobranza_ultimo_contacto);
              lista.push({est,prog,pendienteMonto,vencidas,proximas,urgencia,urgLabel,urgColor,urgBg,diasUltimoContacto});
            });
          });

          // Ordenar: más urgente primero
          lista.sort((a,b)=>a.urgencia-b.urgencia||(b.pendienteMonto-a.pendienteMonto));

          // ─ Filtros ─
          const filtrada=lista.filter(({est,prog,urgencia,urgLabel,diasUltimoContacto})=>{
            if(cobranzaFiltroEst==="critico"&&urgencia!==0) return false;
            if(cobranzaFiltroEst==="vencido"&&urgencia!==1) return false;
            if(cobranzaFiltroEst==="proximo"&&urgencia!==2) return false;
            if(cobranzaFiltroEst==="al_dia"&&urgencia!==3) return false;
            if(cobranzaFiltroProg&&prog.id!==cobranzaFiltroProg) return false;
            if(cobranzaBusq){const q=cobranzaBusq.toLowerCase();if(!est.nombre.toLowerCase().includes(q)&&!prog.nombre.toLowerCase().includes(q))return false;}
            return true;
          });

          // ─ KPIs ─
          const cCritico=lista.filter(x=>x.urgencia===0).length;
          const cVencido=lista.filter(x=>x.urgencia===1).length;
          const cProximo=lista.filter(x=>x.urgencia===2).length;
          const totalPendiente=lista.reduce((a,x)=>a+x.pendienteMonto,0);

          const actualizarEstCobranza=(est,prog,campos)=>{
            const nuevo={...est,...campos};
            const nuevosProgs=(programas||[]).map(pr=>{
              if(pr.id!==prog.id)return pr;
              return {...pr,estudiantes:(pr.estudiantes||[]).map(e=>e.id===est.id?nuevo:e)};
            });
            setProgramas(nuevosProgs);
            syncToSupabase(nuevosProgs).catch(err=>console.error(err));
          };

          const contactadoHoy=(est,prog)=>{
            actualizarEstCobranza(est,prog,{
              cobranza_ultimo_contacto:hoy,
              cobranza_estado:est.cobranza_estado||"contactado",
            });
          };

          const setEstadoCobranza=(est,prog,estado)=>{
            actualizarEstCobranza(est,prog,{cobranza_estado:estado});
          };

          const guardarNota=()=>{
            if(!cobranzaNotaModal)return;
            const{est,prog}=cobranzaNotaModal;
            actualizarEstCobranza(est,prog,{cobranza_nota:cobranzaNotaText});
            setCobranzaNotaModal(null);
            setCobranzaNotaText("");
          };

          const ESTADO_OPTS=[
            {v:"pendiente",   l:"Pendiente",        color:"#6b7280",bg:"#f3f4f6"},
            {v:"contactado",  l:"Contactado",        color:"#2563eb",bg:"#eff6ff"},
            {v:"comprometio", l:"Comprometió pago",  color:"#d97706",bg:"#fffbeb"},
            {v:"pagó",        l:"Pagó",              color:"#16a34a",bg:"#f0fdf4"},
          ];
          const estadoOpt=v=>ESTADO_OPTS.find(o=>o.v===v)||ESTADO_OPTS[0];

          const progOpts=[...new Map((programas||[]).map(p=>[p.id,p])).values()];

          return(
            <div>
              {/* KPIs */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:22}}>
                {[
                  {label:"Críticos",val:cCritico,color:"#dc2626",filtro:"critico"},
                  {label:"Vencidos",val:cVencido,color:"#d97706",filtro:"vencido"},
                  {label:"Vencen pronto",val:cProximo,color:"#2563eb",filtro:"proximo"},
                  {label:"Total pendiente",val:fmtMXN(totalPendiente),color:"#111",filtro:""},
                ].map(k=>(
                  <div key={k.label} onClick={()=>setCobranzaFiltroEst(cobranzaFiltroEst===k.filtro?"":k.filtro||"")} style={{...S.card,padding:"16px 18px",cursor:"pointer",borderLeft:"4px solid "+k.color,boxShadow:cobranzaFiltroEst===k.filtro?"0 0 0 3px "+k.color+"33":"none"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",letterSpacing:"0.5px",marginBottom:5,fontFamily:"system-ui"}}>{k.label.toUpperCase()}</div>
                    <div style={{fontSize:22,fontWeight:800,color:k.color,fontFamily:"system-ui"}}>{k.val}</div>
                  </div>
                ))}
              </div>

              {/* Filtros */}
              <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                <input value={cobranzaBusq} onChange={e=>setCobranzaBusq(e.target.value)} placeholder="Buscar alumno o programa..." style={{...S.inp,width:220,padding:"7px 12px",fontSize:13}}/>
                <select value={cobranzaFiltroProg} onChange={e=>setCobranzaFiltroProg(e.target.value)} style={{...S.inp,padding:"7px 10px",fontSize:13,width:"auto"}}>
                  <option value="">Todos los programas</option>
                  {progOpts.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <div style={{display:"flex",gap:6}}>
                  {[{v:"",l:"Todos"},{v:"critico",l:"Críticos"},{v:"vencido",l:"Vencidos"},{v:"proximo",l:"Pronto"}].map(f=>(
                    <button key={f.v} onClick={()=>setCobranzaFiltroEst(f.v)} style={{padding:"6px 14px",fontSize:12,fontWeight:600,fontFamily:"system-ui",borderRadius:7,border:"1px solid "+(cobranzaFiltroEst===f.v?"#c8102e":"#e5e7eb"),background:cobranzaFiltroEst===f.v?"#fef2f2":"#fff",color:cobranzaFiltroEst===f.v?RED:"#374151",cursor:"pointer"}}>{f.l}</button>
                  ))}
                </div>
                <div style={{marginLeft:"auto",fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>{filtrada.length} alumno{filtrada.length!==1?"s":""}</div>
              </div>

              {/* Lista */}
              {filtrada.length===0&&(
                <div style={{textAlign:"center",padding:"60px 0",color:"#9ca3af",fontFamily:"system-ui",fontSize:14}}>
                  No hay alumnos con pagos pendientes en este filtro
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {filtrada.map(({est,prog,pendienteMonto,vencidas,proximas,urgencia,urgLabel,urgColor,urgBg,diasUltimoContacto})=>{
                  const ep=estadoOpt(est.cobranza_estado);
                  const proxVenc=proximas.length?proximas[0].fecha_vencimiento:null;
                  const noContactado=est.cobranza_ultimo_contacto===null&&urgencia<=2;
                  const sinContacto7=diasUltimoContacto!==null&&diasUltimoContacto>=7;
                  return(
                    <div key={est.id} style={{...S.card,padding:"16px 20px",borderLeft:"4px solid "+urgColor}}>
                      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
                        {/* Info principal */}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:4}}>
                            <span style={{fontWeight:700,fontSize:14,fontFamily:"system-ui",color:"#111"}}>{est.nombre.toUpperCase()}</span>
                            <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:99,background:urgBg,color:urgColor,fontFamily:"system-ui"}}>{urgLabel}</span>
                            {(noContactado||sinContacto7)&&<span style={{fontSize:11,padding:"2px 8px",borderRadius:99,background:"#f3f4f6",color:"#6b7280",fontFamily:"system-ui"}}>Sin contacto {sinContacto7?`+${diasUltimoContacto}d`:""}</span>}
                          </div>
                          <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginBottom:6}}>{prog.nombre}{prog.generacion?` · ${prog.generacion} gen.`:""}</div>
                          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                            <span style={{fontSize:13,fontWeight:700,color:urgColor,fontFamily:"system-ui"}}>{fmtMXN(pendienteMonto)} pendiente</span>
                            {vencidas.length>0&&<span style={{fontSize:12,color:"#dc2626",fontFamily:"system-ui"}}>{vencidas.length} pago{vencidas.length!==1?"s":""} vencido{vencidas.length!==1?"s":""}</span>}
                            {proxVenc&&urgencia>=2&&<span style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui"}}>Próx. vence: {fmtFecha(proxVenc)}</span>}
                            {est.cobranza_ultimo_contacto&&<span style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>Contactado: {fmtFecha(est.cobranza_ultimo_contacto)}</span>}
                          </div>
                          {est.cobranza_nota&&<div style={{marginTop:8,fontSize:12,color:"#374151",fontFamily:"system-ui",background:"#f9fafb",borderRadius:6,padding:"6px 10px",borderLeft:"3px solid #e5e7eb"}}>{est.cobranza_nota}</div>}
                        </div>

                        {/* Acciones derecha */}
                        <div style={{display:"flex",flexDirection:"column",gap:7,flexShrink:0,alignItems:"flex-end"}}>
                          {/* Estado selector */}
                          <select value={est.cobranza_estado||"pendiente"} onChange={e=>setEstadoCobranza(est,prog,e.target.value)}
                            style={{fontSize:11,fontWeight:600,padding:"4px 8px",borderRadius:7,border:"1px solid #e5e7eb",background:ep.bg,color:ep.color,fontFamily:"system-ui",cursor:"pointer",outline:"none"}}>
                            {ESTADO_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                          {/* Botones acción */}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                            {est.telefono&&(
                              <button onClick={()=>abrirWhatsApp(vencidas.length?"vencido":proxVenc?"proximo":"proximo",est,prog)}
                                style={{fontSize:11,fontWeight:600,padding:"5px 10px",borderRadius:7,border:"1px solid #86efac",background:"#f0fdf4",color:"#16a34a",fontFamily:"system-ui",cursor:"pointer"}}>
                                WA
                              </button>
                            )}
                            <button onClick={()=>contactadoHoy(est,prog)}
                              style={{fontSize:11,fontWeight:600,padding:"5px 10px",borderRadius:7,border:"1px solid #bfdbfe",background:"#eff6ff",color:"#2563eb",fontFamily:"system-ui",cursor:"pointer"}}>
                              Contactado hoy
                            </button>
                            <button onClick={()=>{setCobranzaNotaModal({est,prog});setCobranzaNotaText(est.cobranza_nota||"");}}
                              style={{fontSize:11,fontWeight:600,padding:"5px 10px",borderRadius:7,border:"1px solid #e5e7eb",background:"#f9fafb",color:"#374151",fontFamily:"system-ui",cursor:"pointer"}}>
                              {est.cobranza_nota?"Editar nota":"+ Nota"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Modal nota */}
              {cobranzaNotaModal&&(
                <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999}}>
                  <div style={{background:"#fff",borderRadius:16,padding:28,width:420,boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
                    <div style={{fontWeight:700,fontSize:15,fontFamily:"system-ui",marginBottom:6}}>Nota de seguimiento</div>
                    <div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginBottom:14}}>{cobranzaNotaModal.est.nombre}</div>
                    <textarea value={cobranzaNotaText} onChange={e=>setCobranzaNotaText(e.target.value)} rows={4}
                      placeholder="Escribe una nota interna sobre este alumno..."
                      style={{...S.inp,width:"100%",resize:"vertical",marginBottom:16}}/>
                    <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                      <button onClick={()=>setCobranzaNotaModal(null)} style={S.btn("#f3f4f6","#374151",{padding:"8px 18px"})}>Cancelar</button>
                      <button onClick={guardarNota} style={S.btn(RED,"#fff",{padding:"8px 18px"})}>Guardar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* EVALUACIONES */}
        {view==="evaluaciones"&&(()=>{
          // estados al nivel del App: evalTab, filtroDocEval, filtroProgEval

          const DIM_LABELS = ["Expectativas","Relevancia","Aplicación","Didáctica","Dominio"];
          const DIM_KEYS   = ["q1","q2","q3","q4","q5"];

          const dimProm = (evals, key) => evals.length
            ? Math.round(evals.reduce((a,e)=>a+(e[key]||0),0)/evals.length*10)/10
            : null;

          const colorVal = v => v>=4?"#16a34a":v>=3?"#d97706":"#dc2626";
          const bgVal    = v => v>=4?"#f0fdf4":v>=3?"#fffbeb":"#fef2f2";

          // Todos los módulos de todos los programas
          const todosModulos = [];
          (programas||[]).forEach(prog=>{
            mods(prog).forEach(mod=>{
              const evalsDelMod = (npsData||[]).filter(e=>e.modId===mod.id);
              const promMod = evalsDelMod.length
                ? Math.round(evalsDelMod.reduce((a,e)=>a+(e.promedio||0),0)/evalsDelMod.length*10)/10
                : null;
              todosModulos.push({prog,mod,evals:evalsDelMod,prom:promMod});
            });
          });

          // Docentes con evaluaciones
          const docentesConEvals = [];
          const docentesVistos = new Set();
          (npsData||[]).forEach(e=>{
            const key = e.docenteId||e.docenteNombre;
            if(!key||docentesVistos.has(key))return;
            docentesVistos.add(key);
            const evalsDoc = (npsData||[]).filter(ev=>ev.docenteId===e.docenteId||ev.docenteNombre===e.docenteNombre);
            const prom = evalsDoc.length?Math.round(evalsDoc.reduce((a,ev)=>a+(ev.promedio||0),0)/evalsDoc.length*10)/10:0;
            docentesConEvals.push({nombre:e.docenteNombre,id:e.docenteId,evals:evalsDoc,prom});
          });
          docentesConEvals.sort((a,b)=>b.prom-a.prom);

          // Evaluaciones filtradas para pestaña Resultados
          const evalsFiltradas = (npsData||[]).filter(e=>{
            const matchDoc = !filtroDocEval || e.docenteNombre===filtroDocEval || e.docenteId===filtroDocEval;
            const matchProg = !filtroProgEval || e.progId===filtroProgEval;
            return matchDoc&&matchProg;
          }).slice().reverse();

          return(
            <div>
              <div style={{marginBottom:20}}>
                <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px",fontFamily:FONT_TITLE}}>Evaluaciones</h1>
                <p style={{margin:0,color:"#6B7280",fontSize:13,fontFamily:FONT_BODY}}>
                  {(npsData||[]).length} respuesta{(npsData||[]).length!==1?"s":""} registradas · {docentesConEvals.length} docente{docentesConEvals.length!==1?"s":""} evaluados
                </p>
              </div>

              {/* Pestañas */}
              <div style={{display:"flex",...S.card,overflow:"hidden",marginBottom:20}}>
                {[["modulos","Módulos"],["resultados","Resultados"],["docentes_eval","Docentes"]].map(([t,l])=>(
                  <button key={t} onClick={()=>setEvalTab(t)}
                    style={{flex:1,padding:"12px 16px",border:"none",borderBottom:evalTab===t?"3px solid "+RED:"3px solid transparent",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui",background:"#fff",color:evalTab===t?RED:"#6b7280"}}>
                    {l}
                  </button>
                ))}
              </div>

              {/* ── PESTAÑA MÓDULOS ── */}
              {evalTab==="modulos"&&(()=>{
                const hoy = today();

                // Clasificar módulos por estado
                const pendientes  = []; // terminaron, 0 respuestas
                const enCurso     = []; // activos o próximos (clase hoy o en los últimos/próximos 14 días)
                const completadas = []; // tienen al menos 1 respuesta

                todosModulos.forEach(item=>{
                  const {mod, evals:evMod} = item;
                  const fechas = getFechasMod(mod);
                  const ultimaFecha = fechas.length ? fechas[fechas.length-1] : mod.fechaFin||"";
                  const primeraFecha = fechas.length ? fechas[0] : mod.fechaInicio||"";
                  const termino = ultimaFecha && ultimaFecha < hoy;
                  const activo  = primeraFecha <= hoy && (!ultimaFecha || ultimaFecha >= hoy);
                  const proximo = primeraFecha > hoy;

                  if(evMod.length > 0) completadas.push({...item, ultimaFecha, termino});
                  else if(termino)     pendientes.push({...item, ultimaFecha});
                  else                 enCurso.push({...item, ultimaFecha, activo, proximo});
                });

                // Filtro por programa
                const filtrarProg = lista => filtroProgEval
                  ? lista.filter(({prog})=>prog.id===filtroProgEval)
                  : lista;

                const tarjeta = ({prog, mod, evals:evMod, prom, ultimaFecha, estado}) => (
                  <div key={mod.id} style={{...S.card,padding:"16px 20px",
                    borderLeft:"4px solid "+(estado==="pendiente"?"#dc2626":estado==="completada"?"#16a34a":prog.color)}}>
                    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3,flexWrap:"wrap"}}>
                          <span style={{background:prog.color,color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:800,fontFamily:"system-ui"}}>{mod.numero}</span>
                          <span style={{fontWeight:700,fontSize:14}}>{mod.nombre}</span>
                          {estado==="pendiente"&&<span style={{fontSize:10,background:"#fef2f2",color:"#dc2626",borderRadius:4,padding:"2px 7px",fontWeight:700,fontFamily:"system-ui"}}>Sin evaluar</span>}
                          {estado==="completada"&&<span style={{fontSize:10,background:"#f0fdf4",color:"#16a34a",borderRadius:4,padding:"2px 7px",fontWeight:700,fontFamily:"system-ui"}}>✓ {evMod.length} respuesta{evMod.length!==1?"s":""}</span>}
                        </div>
                        <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",display:"flex",gap:10,flexWrap:"wrap"}}>
                          <span>{prog.nombre}{prog.generacion?" · "+prog.generacion+" gen.":""}</span>
                          {mod.docente&&<span>· {mod.docente}</span>}
                          {ultimaFecha&&<span>· Terminó {fmtFecha(ultimaFecha)}</span>}
                        </div>
                      </div>
                      {prom!==null&&(
                        <div style={{textAlign:"center",flexShrink:0}}>
                          <div style={{fontSize:10,color:"#9ca3af",fontWeight:700,fontFamily:"system-ui"}}>PROMEDIO</div>
                          <div style={{fontSize:22,fontWeight:800,color:colorVal(prom),fontFamily:"system-ui"}}>{prom}<span style={{fontSize:12,color:"#9ca3af"}}>/5</span></div>
                        </div>
                      )}
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button onClick={()=>generarEnlaceEval(prog.id,mod.id)}
                          style={S.btn(linkCopiado==="eval_"+prog.id+"_"+mod.id?"#f0fdf4":"#f3f4f6",linkCopiado==="eval_"+prog.id+"_"+mod.id?"#16a34a":"#374151",{padding:"5px 11px",fontSize:12,border:"1px solid "+(linkCopiado==="eval_"+prog.id+"_"+mod.id?"#bbf7d0":"#e5e7eb")})}>
                          {linkCopiado==="eval_"+prog.id+"_"+mod.id?"Copiado":"Copiar enlace"}
                        </button>
                        <button onClick={()=>enviarEvalPorCorreo(prog.id,mod.id)}
                          style={S.btn("#f5f3ff","#7c3aed",{padding:"5px 11px",fontSize:12,border:"1px solid #ddd6fe"})}>
                          ✉ Enviar
                        </button>
                        <button onClick={()=>setNpsModal({prog,mod})}
                          style={S.btn("#eff6ff","#2563eb",{padding:"5px 11px",fontSize:12,border:"1px solid #bfdbfe"})}>
                          + Registrar
                        </button>
                      </div>
                    </div>
                    {evMod.length>0&&(
                      <div style={{marginTop:12,display:"flex",gap:16,flexWrap:"wrap"}}>
                        {DIM_KEYS.map((key,i)=>{
                          const d=dimProm(evMod,key);
                          return(
                            <div key={key} style={{flex:1,minWidth:80}}>
                              <div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui",marginBottom:3}}>{DIM_LABELS[i]}</div>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <div style={{flex:1,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                                  <div style={{width:(d/5*100)+"%",height:"100%",background:colorVal(d),borderRadius:4}}/>
                                </div>
                                <span style={{fontSize:11,fontWeight:700,color:colorVal(d),fontFamily:"system-ui",minWidth:20}}>{d}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );

                const pendFilt  = filtrarProg(pendientes);
                const cursoFilt = filtrarProg(enCurso);
                const compFilt  = filtrarProg(completadas);

                return(
                  <div>
                    {/* Filtro por programa */}
                    <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center"}}>
                      <select value={filtroProgEval} onChange={e=>setFiltroProgEval(e.target.value)}
                        style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 14px",fontSize:13,fontFamily:"system-ui",background:"#fff",flex:1}}>
                        <option value="">Todos los programas</option>
                        {(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}{p.generacion?" — "+p.generacion+" gen.":""}</option>)}
                      </select>
                      {filtroProgEval&&<button onClick={()=>setFiltroProgEval("")} style={S.btn("#f3f4f6","#374151")}>Ver todos</button>}
                    </div>

                    {/* Pendientes de evaluar */}
                    {pendFilt.length>0&&(
                      <div style={{marginBottom:24}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:"#dc2626",flexShrink:0}}/>
                          <span style={{fontWeight:700,fontSize:14,fontFamily:"system-ui",color:"#dc2626"}}>Pendientes de evaluación ({pendFilt.length})</span>
                          <span style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>— Módulos terminados sin respuestas</span>
                        </div>
                        <div style={{display:"grid",gap:10}}>
                          {pendFilt.map(item=>tarjeta({...item,estado:"pendiente"}))}
                        </div>
                      </div>
                    )}

                    {/* En curso */}
                    {cursoFilt.length>0&&(
                      <div style={{marginBottom:24}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:"#d97706",flexShrink:0}}/>
                          <span style={{fontWeight:700,fontSize:14,fontFamily:"system-ui",color:"#d97706"}}>En curso ({cursoFilt.length})</span>
                          <span style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>— Módulos activos o próximos</span>
                        </div>
                        <div style={{display:"grid",gap:10}}>
                          {cursoFilt.map(item=>tarjeta({...item,estado:"en_curso"}))}
                        </div>
                      </div>
                    )}

                    {/* Completadas */}
                    {compFilt.length>0&&(
                      <div style={{marginBottom:24}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:"#16a34a",flexShrink:0}}/>
                          <span style={{fontWeight:700,fontSize:14,fontFamily:"system-ui",color:"#16a34a"}}>Evaluadas ({compFilt.length})</span>
                          <span style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>— Con respuestas registradas</span>
                        </div>
                        <div style={{display:"grid",gap:10}}>
                          {compFilt.map(item=>tarjeta({...item,estado:"completada"}))}
                        </div>
                      </div>
                    )}

                    {pendFilt.length===0&&cursoFilt.length===0&&compFilt.length===0&&(
                      <div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>
                        Sin módulos registrados{filtroProgEval?" en este programa":""}. 
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── PESTAÑA RESULTADOS ── */}
              {evalTab==="resultados"&&(()=>{
                // Resolver nombres desde programas (el campo e.mod llega vacío desde Supabase)
                const resolve = e => {
                  const progObj=(programas||[]).find(p=>p.id===e.progId);
                  const modObj=progObj?mods(progObj).find(m=>m.id===e.modId):null;
                  return {...e,progNombre:progObj?.nombre||e.prog||"—",modNombre:modObj?.nombre||e.mod||"—"};
                };

                // Módulos disponibles para filtro (filtrados por programa si hay)
                const modsParaFiltro=[];
                (programas||[]).forEach(prog=>{
                  if(filtroProgEval&&prog.id!==filtroProgEval)return;
                  mods(prog).forEach(mod=>{
                    if((npsData||[]).some(e=>e.modId===mod.id))
                      modsParaFiltro.push({id:mod.id,nombre:mod.nombre,prog:prog.nombre});
                  });
                });

                const resueltas = (npsData||[]).map(resolve).filter(e=>{
                  if(filtroProgEval&&e.progId!==filtroProgEval)return false;
                  if(filtroDocEval&&e.docenteNombre!==filtroDocEval&&e.docenteId!==filtroDocEval)return false;
                  if(filtroModEval&&e.modId!==filtroModEval)return false;
                  return true;
                }).slice().reverse();

                const exportCSVRes = () => {
                  const cols=["Fecha","Módulo","Programa","Docente","Expectativas","Relevancia","Aplicación","Didáctica","Dominio","Promedio","Comentarios"];
                  const rows=resueltas.map(e=>[e.fecha,e.modNombre,e.progNombre,e.docenteNombre,e.q1,e.q2,e.q3,e.q4,e.q5,e.promedio,e.comentarios||""].map(v=>'"'+String(v||"").replace(/"/g,'""')+'"').join(","));
                  const csv=[cols.map(c=>'"'+c+'"').join(","),...rows].join("\n");
                  const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,\uFEFF"+encodeURIComponent(csv);a.download="evaluaciones_ibero_"+today()+".csv";a.click();
                };

                const compartirWA = () => {
                  // Resumen global o por docente/módulo
                  const prom=resueltas.length?Math.round(resueltas.reduce((a,e)=>a+(e.promedio||0),0)/resueltas.length*10)/10:0;
                  const dimLines=DIM_KEYS.map((k,i)=>{
                    const dp=Math.round(resueltas.reduce((a,e)=>a+(e[k]||0),0)/resueltas.length*10)/10;
                    return `• ${DIM_LABELS[i]}: ${dp}/5`;
                  }).join("\n");
                  const comentarios=resueltas.filter(e=>e.comentarios).slice(-5).map(e=>`"${e.comentarios}"`).join("\n");
                  const titulo=filtroDocEval?`Evaluación docente — ${filtroDocEval}`:filtroModEval?(modsParaFiltro.find(m=>m.id===filtroModEval)?.nombre||"Módulo"):"Resumen de evaluaciones";
                  const msg=`📊 *${titulo}*\n${resueltas.length} respuesta${resueltas.length!==1?"s":""} · Promedio general: *${prom}/5*\n\n${dimLines}${comentarios?"\n\n💬 *Comentarios destacados:*\n"+comentarios:""}\n\n_IBERO Tijuana — Educación Continua_`;
                  window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank");
                };

                const compartirEmail = () => {
                  const prom=resueltas.length?Math.round(resueltas.reduce((a,e)=>a+(e.promedio||0),0)/resueltas.length*10)/10:0;
                  const dimLines=DIM_KEYS.map((k,i)=>{
                    const dp=Math.round(resueltas.reduce((a,e)=>a+(e[k]||0),0)/resueltas.length*10)/10;
                    return `  • ${DIM_LABELS[i]}: ${dp}/5`;
                  }).join("\n");
                  const comentarios=resueltas.filter(e=>e.comentarios).slice(-5).map(e=>`  • "${e.comentarios}"`).join("\n");
                  const titulo=filtroDocEval?`Evaluación docente — ${filtroDocEval}`:filtroModEval?(modsParaFiltro.find(m=>m.id===filtroModEval)?.nombre||"Módulo"):"Resumen de evaluaciones";
                  const subject=encodeURIComponent(`Resultados de evaluación — ${titulo}`);
                  const body=encodeURIComponent(`Estimado/a,\n\nAdjuntamos los resultados de evaluación correspondientes a: ${titulo}\n\nTotal de respuestas: ${resueltas.length}\nPromedio general: ${prom}/5\n\nResultados por dimensión:\n${dimLines}${comentarios?"\n\nComentarios destacados:\n"+comentarios:""}\n\nAtentamente,\nCoordinación de Educación Continua\nIBERO Tijuana`);
                  window.open(`mailto:?subject=${subject}&body=${body}`,"_blank");
                };

                return(
                  <div>
                    {/* Filtros + acciones */}
                    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                      <select value={filtroProgEval} onChange={e=>{setFiltroProgEval(e.target.value);setFiltroModEval("");}}
                        style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff",flex:1}}>
                        <option value="">Todos los programas</option>
                        {(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <select value={filtroModEval} onChange={e=>setFiltroModEval(e.target.value)}
                        style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff",flex:1}}>
                        <option value="">Todos los módulos</option>
                        {modsParaFiltro.map(m=><option key={m.id} value={m.id}>{m.nombre}{!filtroProgEval?` — ${m.prog}`:""}</option>)}
                      </select>
                      <select value={filtroDocEval} onChange={e=>setFiltroDocEval(e.target.value)}
                        style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",background:"#fff",flex:1}}>
                        <option value="">Todos los docentes</option>
                        {docentesConEvals.map(d=><option key={d.id||d.nombre} value={d.nombre}>{d.nombre}</option>)}
                      </select>
                      {(filtroProgEval||filtroDocEval||filtroModEval)&&<button onClick={()=>{setFiltroProgEval("");setFiltroDocEval("");setFiltroModEval("");}} style={S.btn("#f3f4f6","#374151",{fontSize:13})}>Limpiar</button>}
                    </div>

                    {resueltas.length>0&&(
                      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                        <button onClick={exportCSVRes} style={S.btn("#f0fdf4","#16a34a",{border:"1px solid #bbf7d0",fontSize:13,padding:"8px 16px"})}>Exportar CSV</button>
                        <button onClick={compartirWA} style={S.btn("#f0fdf4","#16a34a",{border:"1px solid #bbf7d0",fontSize:13,padding:"8px 16px"})}>WhatsApp</button>
                        <button onClick={compartirEmail} style={S.btn("#f5f3ff","#7c3aed",{border:"1px solid #ddd6fe",fontSize:13,padding:"8px 16px"})}>✉ Email</button>
                        <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",display:"flex",alignItems:"center"}}>{resueltas.length} respuesta{resueltas.length!==1?"s":""} · Prom. {Math.round(resueltas.reduce((a,e)=>a+(e.promedio||0),0)/resueltas.length*10)/10}/5</div>
                      </div>
                    )}

                    {resueltas.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin evaluaciones registradas{(filtroProgEval||filtroDocEval||filtroModEval)?" con estos filtros":""}.</div>}

                    {resueltas.length>0&&(
                      <div style={{...S.card,overflow:"hidden"}}>
                        <div style={{padding:"10px 18px",background:"#f9f9f9",borderBottom:"2px solid #e5e7eb",display:"flex",gap:8,alignItems:"center",fontFamily:"system-ui",fontSize:11,fontWeight:700,color:"#6b7280"}}>
                          <div style={{flex:1}}>MÓDULO / PROGRAMA / DOCENTE</div>
                          {DIM_LABELS.map(l=><div key={l} style={{textAlign:"center",minWidth:52}}>{l.slice(0,5).toUpperCase()}</div>)}
                          <div style={{textAlign:"center",minWidth:48}}>PROM.</div>
                          <div style={{minWidth:72}}>FECHA</div>
                        </div>
                        {resueltas.map((e,i)=>(
                          <div key={e.id||i} style={{padding:"12px 18px",borderBottom:i<resueltas.length-1?"1px solid #f3f4f6":"none",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",background:i%2===0?"#fff":"#fafafa"}}>
                            <div style={{flex:1,minWidth:160}}>
                              <div style={{fontWeight:600,fontSize:13,fontFamily:"system-ui"}}>{e.modNombre}</div>
                              <div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui",display:"flex",gap:6,flexWrap:"wrap"}}>
                                <span>{e.progNombre}</span>
                                {e.docenteNombre&&<span>· {e.docenteNombre}</span>}
                              </div>
                              {e.comentarios&&<div style={{marginTop:4,fontSize:11,color:"#6b7280",fontFamily:"system-ui",fontStyle:"italic",background:"#f0f4ff",borderRadius:4,padding:"4px 8px"}}>"{e.comentarios}"</div>}
                            </div>
                            {DIM_KEYS.map(key=>(
                              <div key={key} style={{textAlign:"center",minWidth:52,flexShrink:0}}>
                                <div style={{width:32,height:32,borderRadius:6,background:bgVal(e[key]),border:"1px solid "+colorVal(e[key])+"33",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",fontSize:14,fontWeight:800,color:colorVal(e[key]),fontFamily:"system-ui"}}>
                                  {e[key]||"—"}
                                </div>
                              </div>
                            ))}
                            <div style={{textAlign:"center",minWidth:48,flexShrink:0}}>
                              <div style={{width:40,height:32,borderRadius:6,background:colorVal(e.promedio),display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",fontSize:14,fontWeight:800,color:"#fff",fontFamily:"system-ui"}}>
                                {e.promedio}
                              </div>
                            </div>
                            <div style={{minWidth:72,fontSize:11,color:"#9ca3af",fontFamily:"system-ui",flexShrink:0}}>
                              {e.fecha?fmtFecha(e.fecha):"—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── PESTAÑA DOCENTES ── */}
              {evalTab==="docentes_eval"&&(
                <div>
                  {docentesConEvals.length===0&&<div style={{...S.card,padding:40,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui"}}>Sin evaluaciones registradas aún.</div>}
                  <div style={{display:"grid",gap:12}}>
                    {docentesConEvals.map((d,rank)=>{
                      const enviarResumenWA = () => {
                        const dimLines=DIM_KEYS.map((k,i)=>`• ${DIM_LABELS[i]}: ${dimProm(d.evals,k)||"—"}/5`).join("\n");
                        const comentarios=d.evals.filter(e=>e.comentarios).slice(-3).map(e=>`"${e.comentarios}"`).join("\n");
                        const modulosUnicos=[...new Set(d.evals.map(e=>e.mod||e.modId))].filter(Boolean).join(", ");
                        const doc=(docentes||[]).find(dc=>dc.id===d.id||dc.nombre===d.nombre);
                        const msg=`📊 *Resultados de evaluación — ${d.nombre}*\n${d.evals.length} respuesta${d.evals.length!==1?"s":""} · Promedio general: *${d.prom}/5*${modulosUnicos?"\nMódulos: "+modulosUnicos:""}\n\n${dimLines}${comentarios?"\n\n💬 *Comentarios:*\n"+comentarios:""}\n\n_IBERO Tijuana — Educación Continua_`;
                        const tel=(doc?.telefono||"").replace(/\D/g,"");
                        window.open(tel?"https://wa.me/52"+tel+"?text="+encodeURIComponent(msg):"https://wa.me/?text="+encodeURIComponent(msg),"_blank");
                      };
                      const enviarResumenEmail = () => {
                        const dimLines=DIM_KEYS.map((k,i)=>`  • ${DIM_LABELS[i]}: ${dimProm(d.evals,k)||"—"}/5`).join("\n");
                        const comentarios=d.evals.filter(e=>e.comentarios).slice(-3).map(e=>`  • "${e.comentarios}"`).join("\n");
                        const doc=(docentes||[]).find(dc=>dc.id===d.id||dc.nombre===d.nombre);
                        const subject=encodeURIComponent(`Resultados de evaluación — ${d.nombre}`);
                        const body=encodeURIComponent(`Estimado/a ${d.nombre},\n\nA continuación compartimos los resultados de evaluación correspondientes a su(s) módulo(s) en IBERO Tijuana Educación Continua.\n\nTotal de respuestas: ${d.evals.length}\nPromedio general: ${d.prom}/5\n\nResultados por dimensión:\n${dimLines}${comentarios?"\n\nComentarios de participantes:\n"+comentarios:""}\n\nGracias por su valiosa colaboración.\n\nAtentamente,\nCoordinación de Educación Continua\nIBERO Tijuana`);
                        const to=encodeURIComponent(doc?.email||"");
                        window.open(`mailto:${to}?subject=${subject}&body=${body}`,"_blank");
                      };
                      return(
                        <div key={d.id||d.nombre} style={{...S.card,padding:"18px 22px",borderLeft:"4px solid "+(d.prom>=4?"#16a34a":d.prom>=3?"#d97706":"#dc2626")}}>
                          <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                            {/* Ranking */}
                            <div style={{width:36,height:36,borderRadius:"50%",background:rank===0?"#fef9c3":rank===1?"#f3f4f6":rank===2?"#fef2f2":"#f9f9f9",border:"2px solid "+(rank===0?"#d97706":rank===1?"#9ca3af":rank===2?"#dc2626":"#e5e7eb"),display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontWeight:800,fontSize:16,fontFamily:"system-ui",color:rank===0?"#d97706":rank===1?"#6b7280":rank===2?"#dc2626":"#374151"}}>
                              {rank+1}
                            </div>
                            <div style={{flex:1,minWidth:180}}>
                              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4,flexWrap:"wrap"}}>
                                <div style={{fontWeight:700,fontSize:16}}>{d.nombre}</div>
                                <div style={{display:"flex",gap:6}}>
                                  <button onClick={enviarResumenWA} style={S.btn("#f0fdf4","#16a34a",{padding:"3px 10px",fontSize:11,border:"1px solid #bbf7d0"})}>WA</button>
                                  <button onClick={enviarResumenEmail} style={S.btn("#f5f3ff","#7c3aed",{padding:"3px 10px",fontSize:11,border:"1px solid #ddd6fe"})}>✉ Email</button>
                                  <button onClick={()=>setEvalReporteModal({docente:d,evals:d.evals})} style={S.btn("#C8102E","#fff",{padding:"3px 10px",fontSize:11})}>📄 Reporte PDF</button>
                                </div>
                              </div>
                              <div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui",marginBottom:12}}>{d.evals.length} evaluación{d.evals.length!==1?"es":""} · {[...new Set(d.evals.map(e=>e.modId))].length} módulo{[...new Set(d.evals.map(e=>e.modId))].length!==1?"s":""}</div>
                              {/* Barras por dimensión */}
                              <div style={{display:"grid",gap:6}}>
                                {DIM_KEYS.map((key,i)=>{
                                  const val=dimProm(d.evals,key);
                                  return(
                                    <div key={key} style={{display:"flex",alignItems:"center",gap:10}}>
                                      <span style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui",minWidth:90}}>{DIM_LABELS[i]}</span>
                                      <div style={{flex:1,height:6,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
                                        <div style={{width:(val/5*100)+"%",height:"100%",background:colorVal(val),borderRadius:4,transition:"width 0.3s"}}/>
                                      </div>
                                      <span style={{fontSize:12,fontWeight:700,color:colorVal(val),fontFamily:"system-ui",minWidth:24}}>{val}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              {/* Comentarios recientes */}
                              {d.evals.filter(e=>e.comentarios).length>0&&(
                                <div style={{marginTop:12}}>
                                  <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>COMENTARIOS RECIENTES</div>
                                  {d.evals.filter(e=>e.comentarios).slice(-3).map((ev,i)=>{
                                    const progObj=(programas||[]).find(p=>p.id===ev.progId);
                                    const modObj=progObj?mods(progObj).find(m=>m.id===ev.modId):null;
                                    return(
                                      <div key={i} style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",fontStyle:"italic",background:"#f9f9f9",borderRadius:4,padding:"6px 10px",marginBottom:4}}>
                                        "{ev.comentarios}" <span style={{color:"#9ca3af",fontStyle:"normal"}}>— {modObj?.nombre||ev.mod||"Módulo"}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {/* Promedio grande */}
                            <div style={{textAlign:"center",flexShrink:0}}>
                              <div style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui",marginBottom:4}}>PROMEDIO GENERAL</div>
                              <div style={{fontSize:44,fontWeight:800,color:colorVal(d.prom),fontFamily:"Georgia,serif",lineHeight:1}}>{d.prom}</div>
                              <div style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>/5</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* REPORTES */}
        {view==="reportes"&&can(session,"verReportes")&&(
          <div>
            <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 24px",letterSpacing:"-0.5px"}}>Reportes y estadísticas</h1>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:14,marginBottom:28}}>
              {[["Programas",(programas||[]).length],["Est. activos",activos.length],["Egresados EC",egresados.length],["Bajas",bajas.length],["Inactivos",inactivos.length],["Docentes",(docentes||[]).length],["Por confirmar",porConf],["Alumni IBERO cursando",egresadosIberoActivos.length],["Alumni IBERO egresados de EC",egresadosIberoConcluyeron.length]].map(([l,v])=>(
                <div key={l} style={{...S.card,padding:"20px 22px"}}>
                  <div style={{fontSize:28,fontWeight:800,color:RED,fontFamily:"system-ui"}}>{v}</div>
                  <div style={{fontSize:13,color:"#6b7280",marginTop:4,fontFamily:"system-ui"}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{...S.card,marginBottom:16}}>
              <button onClick={()=>setRepExp(repExp==="egresados"?null:"egresados")} style={{width:"100%",padding:"16px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"system-ui"}}>
                <span style={{fontWeight:700,fontSize:14}}>{"Egresados de EC ("+egresados.length+")"}</span>
                <span style={{color:"#9ca3af"}}>{repExp==="egresados"?"▲":"▼"}</span>
              </button>
              {repExp==="egresados"&&<div style={{borderTop:"1px solid #e5e7eb",padding:"0 20px 16px"}}>
                {egresados.length===0?<div style={{color:"#9ca3af",padding:"20px 0",fontFamily:"system-ui",textAlign:"center"}}>Sin egresados de EC registrados.</div>:egresados.map((e,i)=>(
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
                  <span style={{fontWeight:700,fontSize:14}}>Alumni IBERO</span>
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
                      <div style={{fontWeight:700,fontSize:11,color:"#2563eb",letterSpacing:"1px",fontFamily:"system-ui",marginBottom:8}}>CURSANDO PROGRAMA DE EC ({egresadosIberoActivos.length})</div>
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
                      <div style={{fontWeight:700,fontSize:11,color:"#16a34a",letterSpacing:"1px",fontFamily:"system-ui",marginBottom:8}}>EGRESADOS DE EC ({egresadosIberoConcluyeron.length})</div>
                      {egresadosIberoConcluyeron.map((e,i)=>(
                        <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f3f4f6",display:"flex",gap:12,fontFamily:"system-ui",fontSize:13,alignItems:"center"}}>
                          <div style={{flex:1}}>
                            <span style={{fontWeight:600}}>{e.nombre}</span>
                            {e.puesto&&<span style={{color:"#6b7280",marginLeft:8,fontSize:12}}>{e.puesto}</span>}
                            {e.empresa&&<span style={{color:"#9ca3af",marginLeft:8,fontSize:12}}>{e.empresa}</span>}
                          </div>
                          <div style={{color:"#6b7280",fontSize:12}}>{e.programa}</div>
                          <span style={{background:"#f0fdf4",color:"#16a34a",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Egresado EC</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* TASA DE DESERCIÓN */}
            {inactivos.length>0&&(
              <div style={{...S.card,marginBottom:16,border:"1px solid #fde68a"}}>
                <button onClick={()=>setRepExp(repExp==="desercion"?null:"desercion")} style={{width:"100%",padding:"16px 20px",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"system-ui"}}>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <span style={{fontWeight:700,fontSize:14}}>Tasa de deserción</span>
                    <span style={{background:"#fffbeb",color:"#d97706",borderRadius:4,padding:"2px 10px",fontSize:12,fontWeight:700}}>
                      {inactivos.length} inactivo{inactivos.length!==1?"s":""}
                    </span>
                    {(()=>{
                      const totalEst=(programas||[]).reduce((a,p)=>a+ests(p).filter(e=>e.estatus!=="baja").length,0);
                      const pctDeserc=totalEst>0?Math.round(inactivos.length/totalEst*100):0;
                      return<span style={{background:pctDeserc>=20?"#fef2f2":"#fffbeb",color:pctDeserc>=20?"#dc2626":"#d97706",borderRadius:4,padding:"2px 10px",fontSize:12,fontWeight:700}}>{pctDeserc}% de deserción</span>;
                    })()}
                  </div>
                  <span style={{color:"#9ca3af"}}>{repExp==="desercion"?"▲":"▼"}</span>
                </button>
                {repExp==="desercion"&&(
                  <div style={{borderTop:"1px solid #fde68a",padding:"0 20px 16px"}}>
                    <div style={{fontSize:12,color:"#92400e",fontFamily:"system-ui",padding:"10px 0 8px",fontStyle:"italic"}}>Estudiantes marcados como inactivos por falta de pago. Se recomienda seguimiento antes de dar de baja definitiva.</div>
                    {inactivos.map((e,i)=>(
                      <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #fef3c7",display:"flex",gap:12,fontFamily:"system-ui",fontSize:13,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:140}}>
                          <span style={{fontWeight:600}}>{e.nombre}</span>
                          {e.empresa&&<span style={{color:"#9ca3af",marginLeft:8,fontSize:12}}>{e.empresa}</span>}
                        </div>
                        <div style={{color:"#6b7280",fontSize:12}}>{e.programa}</div>
                        <span style={{background:"#fffbeb",color:"#d97706",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>Inactivo</span>
                        {/* Acciones */}
                        <div style={{display:"flex",gap:6}}>
                          {(()=>{
                            const progObj=(programas||[]).find(p=>p.nombre===e.programa||(p.estudiantes||[]).some(x=>x.id===e.id));
                            const estObj=progObj&&ests(progObj).find(x=>x.id===e.id);
                            const tel=(estObj?.telefono||"").replace(/\D/g,"");
                            const msg=`Hola ${e.nombre}, te contactamos de IBERO Tijuana Educación Continua para hacerte saber que tienes un adeudo pendiente. Por favor comunícate con nosotros para regularizar tu situación.`;
                            const waUrl=tel?"https://wa.me/52"+tel+"?text="+encodeURIComponent(msg):"https://wa.me/?text="+encodeURIComponent(msg);
                            return(<>
                              <button onClick={()=>window.open(waUrl,"_blank")} style={{fontSize:11,background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:4,padding:"3px 10px",fontWeight:700,cursor:"pointer"}}>WA</button>
                              {progObj&&estObj&&<button onClick={()=>setCS({titulo:"Reactivar estudiante",mensaje:`¿Reactivar a "${e.nombre}"? Volverá a aparecer en asistencia y reportes.`,onConfirm:()=>save((programas||[]).map(p=>p.id!==progObj.id?p:{...p,estudiantes:ests(p).map(es=>es.id!==estObj.id?es:{...es,estatus:"activo"})}))})} style={{fontSize:11,background:"#eff6ff",color:"#2563eb",border:"1px solid #bfdbfe",borderRadius:4,padding:"3px 10px",fontWeight:700,cursor:"pointer"}}>Reactivar</button>}
                              {progObj&&estObj&&<button onClick={()=>setCS({titulo:"Baja definitiva",mensaje:`¿Dar de baja definitiva a "${e.nombre}"? Se excluirá de todos los reportes. Se puede revertir desde su ficha.`,onConfirm:()=>save((programas||[]).map(p=>p.id!==progObj.id?p:{...p,estudiantes:ests(p).map(es=>es.id!==estObj.id?es:{...es,estatus:"baja"})}))})} style={{fontSize:11,background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:4,padding:"3px 10px",fontWeight:700,cursor:"pointer"}}>Dar de baja</button>}
                            </>);
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                const utilidad=esperado-honorarios;
                const esColab=p.colaboracion&&p.pct_socio>0;
                const parteSocio=esColab?Math.round(utilidad*p.pct_socio/100):0;
                const parteIbero=utilidad-parteSocio;
                return{esperado,cobrado,pendiente:esperado-cobrado,descuentos,honorarios,margen:utilidad,parteSocio,parteIbero,esColab,socio:p.socio||"",pct_socio:p.pct_socio||0};
              };

              const proyMens = proyeccionMensual(programas,docentes);
              const mesesDisp = Object.keys(proyMens).sort();
              const aniosDisp  = [...new Set(mesesDisp.map(m=>m.substring(0,4)))].sort();

              const totalEsperado=(programas||[]).reduce((a,p)=>a+calcFinProg(p).esperado,0);
              const totalCobrado=(programas||[]).reduce((a,p)=>a+calcFinProg(p).cobrado,0);
              const totalHonorarios=(programas||[]).reduce((a,p)=>a+calcFinProg(p).honorarios,0);
              const totalMargen=totalEsperado-totalHonorarios;
              const totalParteSocio=(programas||[]).reduce((a,p)=>a+calcFinProg(p).parteSocio,0);
              const totalParteIbero=(programas||[]).reduce((a,p)=>a+calcFinProg(p).parteIbero,0);

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
                        {[["Ingresos esperados",totalEsperado,"#1a1a1a"],["Cobrado",totalCobrado,"#16a34a"],["Pendiente",totalEsperado-totalCobrado,"#d97706"],["Honorarios docentes",totalHonorarios,RED],["Margen neto",totalMargen,"#7c3aed"],["IBERO (neto real)",totalParteIbero,"#059669"],totalParteSocio>0&&["Socios colaboración",totalParteSocio,"#9333ea"]].filter(Boolean).map(([l,v,c])=>(
                          <div key={l} style={{textAlign:"center",padding:"8px 0"}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",marginBottom:4}}>{l.toUpperCase()}</div>
                            <div style={{fontSize:18,fontWeight:800,color:c,fontFamily:"system-ui"}}>{fmtMXN(v)}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13}}>
                          <thead><tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>{["Programa","Estudiantes","Esperado","Cobrado","Honorarios","Margen neto","IBERO","Avance"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                          <tbody>
                            {(programas||[]).map(p=>{
                              const {esperado,cobrado,honorarios,margen,parteSocio,parteIbero,esColab,socio,pct_socio}=calcFinProg(p);
                              const pct=esperado?Math.round(cobrado/esperado*100):0;
                              return(<tr key={p.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                                <td style={{padding:"10px 12px",fontWeight:600}}>
                                  {p.nombre}
                                  {esColab&&<div style={{fontSize:10,color:"#7c3aed",fontWeight:700,marginTop:2}}>Colaboración · {socio}</div>}
                                </td>
                                <td style={{padding:"10px 12px",color:"#6b7280"}}>{ests(p).length}</td>
                                <td style={{padding:"10px 12px",fontWeight:600}}>{fmtMXN(esperado)}</td>
                                <td style={{padding:"10px 12px",color:"#16a34a",fontWeight:600}}>{fmtMXN(cobrado)}</td>
                                <td style={{padding:"10px 12px",color:RED}}>{fmtMXN(honorarios)}</td>
                                <td style={{padding:"10px 12px",color:margen>=0?"#7c3aed":"#dc2626",fontWeight:700}}>
                                  {fmtMXN(margen)}
                                  {esColab&&<div style={{fontSize:10,color:"#9ca3af",fontWeight:400,marginTop:2}}>{socio}: {fmtMXN(parteSocio)} ({pct_socio}%)</div>}
                                </td>
                                <td style={{padding:"10px 12px",color:parteIbero>=0?"#16a34a":"#dc2626",fontWeight:700}}>
                                  {fmtMXN(parteIbero)}
                                  {esColab&&<div style={{fontSize:10,color:"#9ca3af",fontWeight:400,marginTop:2}}>{100-pct_socio}% para IBERO</div>}
                                </td>
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
                    // Programas activos ese mes — módulo ese mes O cobro registrado ese mes
                    const progsDelMes=(programas||[]).filter(p=>
                      mods(p).some(m=>m.fechaInicio&&m.fechaInicio.substring(0,7)===repMes)||
                      ests(p).some(e=>(e.pago?.parcialidades||[]).some(pa=>pa.pagado&&pa.fecha_pago?.substring(0,7)===repMes))
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
                                const pg=e.pago;if(!pg||!pg.monto_acordado)return a;
                                const mf=pg.monto_acordado*(1-(pg.descuento_pct||0)/100);
                                const total=(pg.parcialidades||[]).length||1;
                                return a+(pg.parcialidades||[]).filter(pa=>pa.pagado&&pa.fecha_pago?.substring(0,7)===repMes)
                                  .reduce((s,pa)=>s+getMontoParc(pa,mf,total),0);
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
                            <thead><tr style={{borderBottom:"2px solid #e5e7eb",background:"#fef2f2"}}>{["Estudiante","Programa","Pagos vencidos","Monto/parcialidad","Recargo (6.5%)","Total a cobrar","Acción"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#dc2626",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                            <tbody>
                              {morosos.map(({est,prog,ep,montoParcialidad,recargo,critico},i)=>(
                                <tr key={i} style={{borderBottom:"1px solid #f3f4f6",background:critico?"#fff5f5":"#fff"}}>
                                  <td style={{padding:"10px 12px"}}><div style={{fontWeight:600}}>{est.nombre}</div>{est.empresa&&<div style={{fontSize:11,color:"#9ca3af"}}>{est.empresa}</div>}</td>
                                  <td style={{padding:"10px 12px",color:"#6b7280"}}>{prog.nombre}</td>
                                  <td style={{padding:"10px 12px",textAlign:"center"}}><span style={{background:critico?"#fef2f2":"#fffbeb",color:critico?"#dc2626":"#d97706",border:"1px solid "+(critico?"#fca5a5":"#fde68a"),borderRadius:4,padding:"2px 8px",fontWeight:700}}>{ep.conRecargo.length}</span></td>
                                  <td style={{padding:"10px 12px",fontWeight:600}}>{fmtMXN(montoParcialidad)}</td>
                                  <td style={{padding:"10px 12px",color:"#dc2626",fontWeight:700}}>{fmtMXN(recargo)}</td>
                                  <td style={{padding:"10px 12px",fontWeight:700}}>{fmtMXN(montoParcialidad*ep.conRecargo.length+recargo)}</td>
                                  <td style={{padding:"10px 12px"}}>
                                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                      {/* Contactar WA */}
                                      {(()=>{
                                        const tel=(est.telefono||"").replace(/\D/g,"");
                                        const monto=fmtMXN(montoParcialidad*ep.conRecargo.length+recargo);
                                        const msg=`Hola ${est.nombre}, te contactamos de IBERO Tijuana Educación Continua.\n\nTenemos registrado un adeudo pendiente de *${monto}* correspondiente a ${ep.conRecargo.length} pago${ep.conRecargo.length!==1?"s":""} vencido${ep.conRecargo.length!==1?"s":""}.\n\nPor favor comunícate con nosotros para regularizar tu situación.\n\nQuedamos a tus órdenes.`;
                                        const waUrl=tel?"https://wa.me/52"+tel+"?text="+encodeURIComponent(msg):"https://wa.me/?text="+encodeURIComponent(msg);
                                        return<button onClick={()=>window.open(waUrl,"_blank")} style={{fontSize:11,background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:4,padding:"4px 10px",fontWeight:700,cursor:"pointer"}}>WA</button>;
                                      })()}
                                      {/* Marcar inactivo */}
                                      {est.estatus!=="inactivo"&&est.estatus!=="baja"&&(
                                        <button onClick={()=>setCS({titulo:"Marcar como inactivo",mensaje:`¿Marcar a "${est.nombre}" como inactivo? Se excluirá de asistencia y quedará pendiente de seguimiento.`,onConfirm:()=>save((programas||[]).map(p=>p.id!==prog.id?p:{...p,estudiantes:ests(p).map(es=>es.id!==est.id?es:{...es,estatus:"inactivo"})}))})}
                                          style={{fontSize:11,background:"#fffbeb",color:"#d97706",border:"1px solid #fde68a",borderRadius:4,padding:"4px 10px",fontWeight:700,cursor:"pointer"}}>
                                          Inactivar
                                        </button>
                                      )}
                                      {/* Dar de baja definitiva */}
                                      <button onClick={()=>setCS({titulo:"Dar de baja definitiva",mensaje:`¿Dar de baja definitiva a "${est.nombre}"? Se excluirá de todos los reportes y pagos. Se puede revertir manualmente desde su ficha.`,onConfirm:()=>save((programas||[]).map(p=>p.id!==prog.id?p:{...p,estudiantes:ests(p).map(es=>es.id!==est.id?es:{...es,estatus:"baja"})}))})}
                                        style={{fontSize:11,background:"#fef2f2",color:"#dc2626",border:"1px solid #fca5a5",borderRadius:4,padding:"4px 10px",fontWeight:700,cursor:"pointer"}}>
                                        Dar de baja
                                      </button>
                                    </div>
                                  </td>
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

            {/* DATOS Y SINCRONIZACIÓN */}
            {can(session,"gestionarUsuarios")&&(
              <div style={{...S.card,padding:24,marginBottom:20,borderLeft:"4px solid #7c3aed"}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:"#7c3aed",fontFamily:"system-ui",letterSpacing:"1px"}}>DATOS Y SINCRONIZACIÓN</div>
                <p style={{fontSize:13,color:"#6b7280",margin:"0 0 16px",fontFamily:"system-ui"}}>
                  Los datos se guardan en Supabase y se cachean localmente. Si notas inconsistencias entre dispositivos, usa el botón de abajo para limpiar el caché local y recargar todo desde Supabase.
                </p>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  <button onClick={async ()=>{
                    setCS({
                      titulo:"Limpiar caché local",
                      mensaje:"Esto borrará todos los datos guardados en este navegador y los recargará desde Supabase. Los datos en Supabase no se borran. ¿Continuar?",
                      onConfirm:()=>{
                        // Limpiar todo el localStorage excepto sesión
                        const session = localStorage.getItem(SK2);
                        localStorage.clear();
                        if(session) localStorage.setItem(SK2, session);
                        notify("Caché limpiado. Recargando...");
                        setTimeout(()=>window.location.reload(), 1000);
                      }
                    });
                  }} style={S.btn("#f5f3ff","#7c3aed",{padding:"8px 16px",fontSize:13,border:"1px solid #ddd6fe"})}>
                    🗑 Limpiar caché local
                  </button>
                  <button onClick={async ()=>{
                    notify("Sincronizando con Supabase...");
                    await syncToSupabase(programas);
                    notify("Sincronización completada.");
                  }} style={S.btn("#f0fdf4","#16a34a",{padding:"8px 16px",fontSize:13,border:"1px solid #bbf7d0"})}>
                    ↑ Forzar sync a Supabase
                  </button>
                </div>
              </div>
            )}

            {can(session,"gestionarUsuarios")&&(
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>USUARIOS CON ACCESO</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Gestiona accesos y permisos por usuario.</p>
                {(users||[]).map((u,i)=>(
                  <div key={i} style={{marginBottom:12,padding:"14px 16px",background:"#f9f9f9",borderRadius:6}}>
                    {editUserIdx===i ? (
                      // ── Modo edición ──
                      <div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                          <div><label style={S.lbl}>Nombre</label><input value={editUserForm.nombre||""} onChange={e=>setEditUserForm({...editUserForm,nombre:e.target.value})} style={S.inp}/></div>
                          <div><label style={S.lbl}>Correo</label><input value={editUserForm.email||""} onChange={e=>setEditUserForm({...editUserForm,email:e.target.value})} style={S.inp}/></div>
                        </div>
                        <div style={{marginBottom:10}}><label style={S.lbl}>Nueva contraseña <span style={{color:"#9ca3af",fontWeight:400}}>(dejar vacío para no cambiar)</span></label><input type="password" value={editUserForm.newPassword||""} onChange={e=>setEditUserForm({...editUserForm,newPassword:e.target.value})} placeholder="••••••" style={S.inp}/></div>
                        <div style={{marginBottom:10,display:"flex",gap:10,alignItems:"flex-end"}}>
                          <div style={{flex:1}}>
                            <label style={S.lbl}>Avatar / Sticker <span style={{color:"#9ca3af",fontWeight:400}}>(URL de imagen)</span></label>
                            <input value={editUserForm.avatar_url||""} onChange={e=>setEditUserForm({...editUserForm,avatar_url:e.target.value})} placeholder="https://..." style={S.inp}/>
                          </div>
                          {editUserForm.avatar_url&&(
                            <div style={{width:40,height:40,borderRadius:"50%",overflow:"hidden",border:"2px solid #e5e7eb",flexShrink:0}}>
                              <img src={editUserForm.avatar_url} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                            </div>
                          )}
                        </div>
                        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
                          <button onClick={()=>{setEditUserIdx(null);setEditUserForm({});}} style={S.btn("#f3f4f6","#374151",{padding:"6px 14px",fontSize:12})}>Cancelar</button>
                          <button onClick={async()=>{
                            if(!editUserForm.nombre||!editUserForm.email){notify("Nombre y correo son obligatorios","error");return;}
                            if(editUserForm.newPassword&&editUserForm.newPassword.length<6){notify("La contraseña debe tener mínimo 6 caracteres","error");return;}
                            const updated={...u,nombre:editUserForm.nombre,email:editUserForm.email.toLowerCase(),avatar_url:editUserForm.avatar_url||""};
                            await saveUsers((users||[]).map((uu,j)=>j===i?updated:uu));
                            setEditUserIdx(null);setEditUserForm({});
                            notify("Usuario actualizado.");
                          }} style={S.btn(RED,"#fff",{padding:"6px 14px",fontSize:12})}>Guardar</button>
                        </div>
                      </div>
                    ) : (
                      // ── Modo lectura ──
                      <>
                        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                          <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,fontFamily:"system-ui"}}>{u.nombre}</div><div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{u.email}</div></div>
                          <button onClick={()=>{setEditUserIdx(i);setEditUserForm({nombre:u.nombre,email:u.email,avatar_url:u.avatar_url||"",newPassword:""});}} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>Editar</button>
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
                      </>
                    )}
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
                      <button onClick={()=>setNewUser({...newUser,permisos:{...ADMIN_P}})} style={S.btn("#fef2f2",RED,{padding:"5px 12px",fontSize:12})}>Administrador</button>
                      <button onClick={()=>setNewUser({...newUser,permisos:{...FINANZAS_P}})} style={S.btn("#eff6ff","#2563eb",{padding:"5px 12px",fontSize:12,border:"1px solid #bfdbfe"})}>Finanzas</button>
                      <button onClick={()=>setNewUser({...newUser,permisos:{...VIEWER_P}})} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>Solo lectura</button>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ALL_PERMISOS.map(p=>(
                        <label key={p.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,cursor:"pointer",background:newUser.permisos&&newUser.permisos[p.key]?"#fef2f2":"#f3f4f6",padding:"3px 10px",borderRadius:4,border:"1px solid "+(newUser.permisos&&newUser.permisos[p.key]?"#fca5a5":"#e5e7eb"),color:newUser.permisos&&newUser.permisos[p.key]?"#1a1a1a":"#9ca3af",fontFamily:"system-ui"}}>
                          <input type="checkbox" checked={!!(newUser.permisos&&newUser.permisos[p.key])} onChange={e=>setNewUser({...newUser,permisos:{...(newUser.permisos||{}),[p.key]:e.target.checked}})} style={{margin:0}}/>{p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button onClick={async()=>{
                    if(!newUser.nombre||!newUser.email||!newUser.password){notify("Completa nombre, correo y contraseña","error");return;}
                    if(newUser.password.length<6){notify("La contraseña debe tener mínimo 6 caracteres","error");return;}
                    notify("Creando usuario...");
                    const auth = await crearUsuarioAuth(newUser.email.toLowerCase(), newUser.password);
                    if(auth.error){notify("Error: "+auth.error,"error");return;}
                    await saveUsers([...(users||[]),{...newUser,email:newUser.email.toLowerCase()}]);
                    setNewUser({nombre:"",email:"",password:"",permisos:{...VIEWER_P}});
                    notify("Usuario creado. Ya puede iniciar sesión.");
                  }} style={S.btn(RED,"#fff")}>Agregar usuario</button>
                </div>
              </div>
            )}
            {can(session,"configurarNotif")&&(<>
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>CONFIGURACIÓN DE NOTIFICACIONES E INTEGRACIÓN</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Credenciales para envío de correos e importación de estudiantes.</p>
                {[["API Key","apiKey"],["Account ID","locationId"]].map(([l,k])=>(
                  <div key={k} style={{marginBottom:14}}><label style={S.lbl}>{l}</label><div style={{position:"relative"}}><input type={k==="apiKey"&&!showApiKey?"password":"text"} value={notifCfg[k]||""} onChange={e=>setNotifCfg({...notifCfg,[k]:e.target.value})} placeholder={k==="apiKey"?"••••••••":"ID de cuenta"} style={{...S.inp,paddingRight:k==="apiKey"?80:12}}/>{k==="apiKey"&&<button onClick={()=>setShowAK(!showApiKey)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:12,fontFamily:"system-ui"}}>{showApiKey?"Ocultar":"Mostrar"}</button>}</div></div>
                ))}
                <button onClick={()=>saveNotif(notifCfg)} style={S.btn(RED,"#fff")}>Guardar</button>
              </div>
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>CAMPOS PERSONALIZADOS A IMPORTAR</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Pega la Clave Única del campo del CRM y asígnale una etiqueta.</p>
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
      {inactivoModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setInactivoModal(null)}>
          <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"28px 28px 24px",width:"100%",maxWidth:400,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",fontFamily:FONT_BODY}}>
            <div style={{fontWeight:700,fontSize:17,fontFamily:FONT_TITLE,letterSpacing:"-0.3px",marginBottom:4,color:"#111"}}>Marcar como Inactivo</div>
            <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>{inactivoModal.est.nombre} · {inactivoModal.prog.nombre}</div>
            <label style={S.lbl}>Motivo</label>
            <textarea
              autoFocus
              value={inactivoRazon}
              onChange={ev=>setInactivoRazon(ev.target.value)}
              placeholder="Ej. Solicitud del estudiante, situación económica, cambio de horario, viaje..."
              rows={3}
              style={{...S.inp,resize:"vertical",lineHeight:1.6,marginBottom:20}}
            />
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setInactivoModal(null)} style={S.btn("#F3F4F6","#374151")}>Cancelar</button>
              <button onClick={()=>{
                const {est:estI,prog:progI}=inactivoModal;
                save((programas||[]).map(p=>p.id!==progI.id?p:{...p,estudiantes:ests(p).map(es=>es.id!==estI.id?es:{...es,estatus:"inactivo",campos_extra:{...(es.campos_extra||{}),motivo_inactivo:inactivoRazon||"Sin especificar",fecha_inactivo:today()}})}));
                notify("Estudiante marcado como inactivo.");
                setInactivoModal(null);
                setInactivoRazon("");
              }} style={S.btn(RED,"#fff",{fontWeight:700})}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      {bajaModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setBajaModal(null)}>
          <div onClick={ev=>ev.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"28px 28px 24px",width:"100%",maxWidth:400,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",fontFamily:FONT_BODY}}>
            <div style={{fontWeight:700,fontSize:17,fontFamily:FONT_TITLE,letterSpacing:"-0.3px",marginBottom:4,color:"#dc2626"}}>Dar de baja</div>
            <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>{bajaModal.est.nombre} · {bajaModal.prog.nombre}</div>
            <label style={S.lbl}>Motivo de baja</label>
            <textarea
              autoFocus
              value={bajaRazon}
              onChange={ev=>setBajaRazon(ev.target.value)}
              placeholder="Ej. Solicitud del estudiante, incumplimiento de pagos, cambio de situación..."
              rows={3}
              style={{...S.inp,resize:"vertical",lineHeight:1.6,marginBottom:8}}
            />
            <div style={{fontSize:11,color:"#9ca3af",marginBottom:20}}>Esta acción excluye al estudiante de reportes y pagos. Se puede revertir manualmente desde su ficha.</div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setBajaModal(null)} style={S.btn("#F3F4F6","#374151")}>Cancelar</button>
              <button onClick={()=>{
                const {est:estB,prog:progB}=bajaModal;
                save((programas||[]).map(p=>p.id!==progB.id?p:{...p,estudiantes:ests(p).map(es=>es.id!==estB.id?es:{...es,estatus:"baja",campos_extra:{...(es.campos_extra||{}),motivo_baja:bajaRazon||"Sin especificar",fecha_baja:today()}})}));
                notify("Estudiante dado de baja.","warning");
                setBajaModal(null);setBajaRazon("");
              }} style={S.btn("#dc2626","#fff",{fontWeight:700})}>Confirmar baja</button>
            </div>
          </div>
        </div>
      )}
      {confirmSimple&&<ConfirmSimple titulo={confirmSimple.titulo} mensaje={confirmSimple.mensaje} onConfirm={confirmSimple.onConfirm} onClose={()=>setCS(null)} btnLabel={confirmSimple.btnLabel} btnColor={confirmSimple.btnColor}/>}
      {confirmEscrita&&<ConfirmEscrita titulo={confirmEscrita.titulo} subtitulo={confirmEscrita.subtitulo} mensaje={confirmEscrita.mensaje} onConfirm={confirmEscrita.onConfirm} onClose={()=>setCE(null)}/>}
      {editEstModal&&<EditEstModal est={editEstModal.est} prog={editEstModal.prog} onSave={datos=>saveEstudiante(editEstModal.prog.id,editEstModal.est.id,datos)} onClose={()=>setEditEstModal(null)}/>}
      {pagoModal&&<PagoModal est={pagoModal.est} prog={pagoModal.prog} onSave={pago=>savePago(pagoModal.prog.id,pagoModal.est.id,pago)} onClose={()=>setPagoModal(null)}/>}
      {/* ── MODAL REPORTE PDF EVALUACIÓN DOCENTE ── */}
      {evalReporteModal&&(()=>{
        const {docente:d} = evalReporteModal;
        const DIM_LABELS_R = ["Expectativas","Relevancia","Aplicación","Didáctica","Dominio"];
        const DIM_KEYS_R   = ["q1","q2","q3","q4","q5"];
        const colorValR = v => v>=4?"#16a34a":v>=3?"#d97706":"#dc2626";
        const evalsConComentario = d.evals.filter(e=>e.comentarios&&e.comentarios.trim());
        const dimPromR = (key) => d.evals.length ? Math.round(d.evals.reduce((a,e)=>a+(e[key]||0),0)/d.evals.length*10)/10 : 0;

        const generarLink = () => {
          const comentariosVisibles = evalsConComentario.filter(e=>!evalReporteModal.ocultos?.includes(e.id||e.fecha+e.comentarios)).map(e=>e.comentarios);
          const payload = {
            docente: d.nombre,
            prom: d.prom,
            dims: DIM_KEYS_R.map((k,i)=>({label:DIM_LABELS_R[i],val:dimPromR(k)})),
            comentarios: comentariosVisibles,
            notaCoord: evalReporteModal.notaCoord||"",
            totalResp: d.evals.length,
            fecha: new Date().toLocaleDateString("es-MX",{day:"numeric",month:"long",year:"numeric"}),
          };
          const token = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
          const url = window.location.href.split("?")[0]+"?reporte="+token;
          setEvalReporteModal(prev=>({...prev,linkGenerado:url}));
        };

        return(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setEvalReporteModal(null)}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:640,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.25)",fontFamily:"system-ui"}}>
              {/* Header */}
              <div style={{background:"#C8102E",padding:"18px 24px",borderRadius:"14px 14px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:16,color:"#fff"}}>Reporte PDF</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",marginTop:2}}>{d.nombre}</div>
                </div>
                <button onClick={()=>setEvalReporteModal(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:6,color:"#fff",width:28,height:28,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
              </div>
              <div style={{padding:"20px 24px"}}>
                {/* Resumen calificaciones */}
                <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20,background:"#f9fafb",borderRadius:10,padding:"14px 18px"}}>
                  <div style={{flex:1}}>
                    {DIM_KEYS_R.map((k,i)=>{
                      const val=dimPromR(k);
                      return(
                        <div key={k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                          <span style={{fontSize:11,color:"#6b7280",minWidth:90}}>{DIM_LABELS_R[i]}</span>
                          <div style={{flex:1,height:6,background:"#e5e7eb",borderRadius:4,overflow:"hidden"}}>
                            <div style={{width:(val/5*100)+"%",height:"100%",background:colorValR(val),borderRadius:4}}/>
                          </div>
                          <span style={{fontSize:12,fontWeight:700,color:colorValR(val),minWidth:24}}>{val}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{textAlign:"center",flexShrink:0}}>
                    <div style={{fontSize:9,color:"#9ca3af",fontWeight:700,letterSpacing:"0.5px",marginBottom:4}}>PROMEDIO</div>
                    <div style={{fontSize:40,fontWeight:800,color:colorValR(d.prom),fontFamily:"Georgia,serif",lineHeight:1}}>{d.prom}</div>
                    <div style={{fontSize:11,color:"#9ca3af"}}>/5</div>
                  </div>
                </div>

                {/* Comentarios estudiantes */}
                {evalsConComentario.length>0&&(
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:"0.5px",textTransform:"uppercase",marginBottom:10}}>Comentarios de estudiantes</div>
                    <div style={{fontSize:11,color:"#6b7280",marginBottom:10}}>Desactiva los que no quieras incluir en el PDF:</div>
                    <div style={{display:"grid",gap:6}}>
                      {evalsConComentario.map((e,i)=>{
                        const uid=e.id||e.fecha+e.comentarios;
                        const oculto=(evalReporteModal.ocultos||[]).includes(uid);
                        return(
                          <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 12px",borderRadius:8,background:oculto?"#f3f4f6":"#f0f9ff",border:"1px solid "+(oculto?"#e5e7eb":"#bae6fd"),opacity:oculto?0.5:1,transition:"all .15s"}}>
                            <div style={{flex:1,fontSize:12,color:"#374151",fontStyle:oculto?"normal":"italic"}}>
                              {oculto?<span style={{color:"#9ca3af"}}>Comentario oculto</span>:`"${e.comentarios}"`}
                            </div>
                            <button onClick={()=>setEvalReporteModal(prev=>({...prev,ocultos:oculto?(prev.ocultos||[]).filter(x=>x!==uid):[...(prev.ocultos||[]),uid]}))}
                              title={oculto?"Incluir en PDF":"Ocultar del PDF"}
                              style={{background:oculto?"#f0fdf4":"#fef2f2",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,color:oculto?"#16a34a":"#dc2626",fontWeight:700,flexShrink:0}}>
                              {oculto?"+ Incluir":"🚫 Ocultar"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Nota del coordinador */}
                <div style={{marginBottom:20}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#9ca3af",letterSpacing:"0.5px",textTransform:"uppercase",marginBottom:8}}>Nota de la coordinación (opcional)</div>
                  <textarea
                    placeholder="Ej: Agradecemos su excelente desempeño durante el módulo. Los resultados reflejan el impacto positivo en los participantes..."
                    value={evalReporteModal.notaCoord||""}
                    onChange={e=>setEvalReporteModal(prev=>({...prev,notaCoord:e.target.value}))}
                    style={{width:"100%",minHeight:90,border:"1px solid #e5e7eb",borderRadius:8,padding:"10px 12px",fontSize:12,fontFamily:"system-ui",resize:"vertical",outline:"none",lineHeight:1.6}}
                  />
                </div>

                {/* Link generado */}
                {evalReporteModal.linkGenerado&&(
                  <div style={{marginBottom:16,background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"14px 16px"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#16a34a",letterSpacing:"0.5px",textTransform:"uppercase",marginBottom:8}}>Enlace generado</div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <input readOnly value={evalReporteModal.linkGenerado} style={{flex:1,border:"1px solid #e5e7eb",borderRadius:6,padding:"7px 10px",fontSize:11,fontFamily:"monospace",background:"#fff",minWidth:0}}/>
                      <button onClick={()=>{navigator.clipboard.writeText(evalReporteModal.linkGenerado);setEvalReporteModal(prev=>({...prev,copiado:true}));setTimeout(()=>setEvalReporteModal(prev=>({...prev,copiado:false})),2000);}}
                        style={S.btn(evalReporteModal.copiado?"#f0fdf4":"#f3f4f6",evalReporteModal.copiado?"#16a34a":"#374151",{padding:"7px 14px",fontSize:12,border:"1px solid "+(evalReporteModal.copiado?"#bbf7d0":"#e5e7eb")})}>
                        {evalReporteModal.copiado?"Copiado ✓":"Copiar"}
                      </button>
                      <button onClick={()=>window.open(evalReporteModal.linkGenerado,"_blank")} style={S.btn("#eff6ff","#2563eb",{padding:"7px 14px",fontSize:12,border:"1px solid #bfdbfe"})}>Ver</button>
                    </div>
                    {/* WhatsApp */}
                    {(()=>{
                      const doc=(docentes||[]).find(dc=>dc.id===d.id||dc.nombre===d.nombre);
                      const tel=(doc?.telefono||"").replace(/\D/g,"");
                      const msg=`Hola ${d.nombre}, le compartimos los resultados de su evaluación docente en IBERO Tijuana Educación Continua.\n\nPuede consultar su reporte completo aquí:\n${evalReporteModal.linkGenerado}\n\nGracias por su valiosa contribución.\n\nCoordinación de Educación Continua · IBERO Tijuana`;
                      const waUrl=tel?"https://wa.me/52"+tel+"?text="+encodeURIComponent(msg):"https://wa.me/?text="+encodeURIComponent(msg);
                      return(
                        <button onClick={()=>window.open(waUrl,"_blank")} style={{...S.btn("#25D366","#fff",{padding:"9px 18px",fontWeight:700,fontSize:13}),marginTop:10,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                          Enviar por WhatsApp a {d.nombre}
                        </button>
                      );
                    })()}
                  </div>
                )}

                {/* Botones */}
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setEvalReporteModal(null)} style={S.btn("#f3f4f6","#6b7280",{padding:"9px 18px"})}>Cancelar</button>
                  <button onClick={generarLink} style={S.btn("#C8102E","#fff",{padding:"9px 22px",fontWeight:700})}>🔗 Generar enlace</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {folioModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{folioModal.onSkip();setFolioModal(null);}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,padding:28,width:380,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",fontFamily:"system-ui"}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Confirmar pago</div>
            <p style={{fontSize:13,color:"#6b7280",margin:"0 0 16px"}}>Ingresa la fecha real del pago y el folio si aplica.</p>
            <label style={{fontSize:11,fontWeight:700,color:"#374151",letterSpacing:"0.5px",display:"block",marginBottom:4}}>FECHA DE PAGO</label>
            <input id="fecha-pago-input" type="date" defaultValue={today()} style={{...S.inp,marginBottom:14}}/>
            <label style={{fontSize:11,fontWeight:700,color:"#374151",letterSpacing:"0.5px",display:"block",marginBottom:4}}>FOLIO <span style={{fontWeight:400,color:"#9ca3af"}}>(opcional)</span></label>
            <input id="folio-input" autoFocus placeholder="Ej. F-001, A-2024-15..." style={{...S.inp,marginBottom:20,fontSize:14}} defaultValue=""/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>{folioModal.onSkip();setFolioModal(null);}} style={S.btn("#f3f4f6","#6b7280",{padding:"8px 16px"})}>Cancelar</button>
              <button onClick={()=>{const folio=document.getElementById("folio-input").value.trim();const fecha=document.getElementById("fecha-pago-input").value||today();folioModal.onConfirm(folio,fecha);setFolioModal(null);}} style={S.btn(RED,"#fff",{padding:"8px 20px",fontWeight:700})}>Confirmar pago</button>
            </div>
          </div>
        </div>
      )}
      {fiscalModal&&<FiscalModal est={fiscalModal.est} onSave={datos=>{save((programas||[]).map(p=>p.id!==fiscalModal.progId?p:{...p,estudiantes:ests(p).map(e=>e.id!==fiscalModal.est.id?e:{...e,...datos})}));setFiscalModal(null);}} onClose={()=>setFiscalModal(null)}/>}
      {fiscalSolicitudModal&&(()=>{
        const {est,url}=fiscalSolicitudModal;
        const nombre=est.nombre||"";
        const msgWA=encodeURIComponent(`Hola ${nombre}, te escribimos del equipo de Educación Continua IBERO Tijuana.\n\nPara emitir tu factura necesitamos tus datos fiscales. Por favor completa el siguiente formulario, solo toma un momento:\n\n${url}\n\nCualquier duda estamos para apoyarte. ¡Gracias!`);
        const msgEmail=`Hola ${nombre},\n\nTe escribimos del equipo de Educación Continua IBERO Tijuana.\n\nPara emitir tu factura correctamente, necesitamos que nos proporciones tus datos fiscales a través del siguiente enlace:\n\n${url}\n\nSolo toma un momento y tus datos estarán protegidos.\n\nQuedamos a tus órdenes.\n\nAtentamente,\nCoordinación de Educación Continua\nIBERO Tijuana`;
        const tel=(est.telefono||"").replace(/\D/g,"");
        return(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:16}}>
            <div style={{background:"#fff",borderRadius:12,width:"100%",maxWidth:480,boxShadow:"0 20px 60px rgba(0,0,0,0.2)",overflow:"hidden"}}>
              <div style={{background:"#eb1d33",padding:"18px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{color:"#fff",fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Solicitar datos fiscales</div>
                <button onClick={()=>setFiscalSolicitudModal(null)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.8)",fontSize:22,cursor:"pointer"}}>×</button>
              </div>
              <div style={{padding:"20px 24px"}}>
                <div style={{fontFamily:"system-ui",fontSize:13,color:"#374151",marginBottom:16}}>
                  <strong>{nombre}</strong> — se enviará un enlace personalizado para que llene sus datos fiscales directamente.
                </div>
                <div style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,padding:"10px 14px",marginBottom:16,fontFamily:"system-ui",fontSize:11,color:"#6b7280",wordBreak:"break-all"}}>
                  {url}
                  <button onClick={()=>{navigator.clipboard.writeText(url);}} style={{marginLeft:8,background:"none",border:"1px solid #e5e7eb",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10,color:"#374151"}}>Copiar</button>
                </div>
                <div style={{display:"grid",gap:10}}>
                  {tel&&<a href={`https://wa.me/${tel}?text=${msgWA}`} target="_blank" rel="noreferrer"
                    style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,textDecoration:"none",cursor:"pointer"}}>
                    <span style={{fontSize:24}}>💬</span>
                    <div><div style={{fontWeight:700,fontSize:14,color:"#16a34a",fontFamily:"system-ui"}}>Enviar por WhatsApp</div><div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>{est.telefono}</div></div>
                  </a>}
                  {est.email&&<a href={`mailto:${est.email}?subject=${encodeURIComponent("Solicitud de datos fiscales — IBERO Tijuana")}&body=${encodeURIComponent(msgEmail)}`}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"14px 18px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,textDecoration:"none",cursor:"pointer"}}>
                    <span style={{fontSize:24}}>✉️</span>
                    <div><div style={{fontWeight:700,fontSize:14,color:"#2563eb",fontFamily:"system-ui"}}>Enviar por correo</div><div style={{fontSize:11,color:"#6b7280",fontFamily:"system-ui"}}>{est.email}</div></div>
                  </a>}
                  {!tel&&!est.email&&<div style={{padding:16,textAlign:"center",color:"#9ca3af",fontFamily:"system-ui",fontSize:13}}>Este estudiante no tiene teléfono ni correo registrado.</div>}
                </div>
                <button onClick={()=>setFiscalSolicitudModal(null)} style={{marginTop:16,width:"100%",padding:"10px",background:"#f3f4f6",border:"none",borderRadius:8,cursor:"pointer",fontFamily:"system-ui",fontSize:13,color:"#374151",fontWeight:600}}>Cerrar</button>
              </div>
            </div>
          </div>
        );
      })()}
      {npsModal&&<NPSModal prog={npsModal.prog} mod={npsModal.mod} onSave={resp=>saveNPS(npsModal.prog.id,npsModal.mod.id,npsModal.mod.docenteId||"",npsModal.mod.docente||"",resp)} onClose={()=>setNpsModal(null)}/>}
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
                  {(docentes||[]).map(d=>{const gs=d.grados&&d.grados.length>0?d.grados.join(", "):(d.grado||"");return<option key={d.id} value={d.id}>{d.nombre+(gs?" ("+gs+")":"")}</option>;})}
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
                <div>
                  <label style={S.lbl}>Fecha inicio</label>
                  <input type="date" value={modForm.fechaInicio||""} onChange={e=>{
                    const val=e.target.value;
                    if(!val){setModForm({...modForm,fechaInicio:"",fechasClase:[]});return;}
                    // Auto-detectar día de la semana
                    const d=new Date(val+"T12:00:00");
                    const diaSemana=DIAS_S[(d.getDay()+6)%7]; // 0=Lun...6=Dom
                    // Auto-horario según día
                    const esSabado=diaSemana==="Sáb";
                    const horarioSugerido=esSabado?"09:00 – 13:00":"18:00 – 22:00";
                    setModForm({
                      ...modForm,
                      fechaInicio:val,
                      dias:[diaSemana],
                      horario:modForm.horario||horarioSugerido,
                      fechasClase:[]
                    });
                  }} style={S.inp}/>
                  {modForm.fechaInicio&&(()=>{
                    const d=new Date(modForm.fechaInicio+"T12:00:00");
                    const nombre=["lunes","martes","miércoles","jueves","viernes","sábado","domingo"][(d.getDay()+6)%7];
                    return<div style={{fontSize:11,color:"#16a34a",fontFamily:"system-ui",marginTop:4}}>Día detectado: <strong>{nombre}</strong> — puedes cambiar abajo</div>;
                  })()}
                </div>
                <div>
                  <label style={S.lbl}>Fecha fin</label>
                  <input type="date" value={modForm.fechaFin||""} onChange={e=>setModForm({...modForm,fechaFin:e.target.value,fechasClase:[]})} style={S.inp}/>
                </div>
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
              <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{editProgId?"Editar programa":"Nuevo programa"}</span>
              <button onClick={()=>setShowProgM(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
            </div>
            <div style={{padding:"20px 24px"}}>
              <div style={{marginBottom:14}}><label style={S.lbl}>Nombre del programa</label><input value={progForm.nombre||""} onChange={e=>setProgForm({...progForm,nombre:e.target.value})} style={S.inp}/></div>
              <div style={{marginBottom:14}}><label style={S.lbl}>Notas internas</label><textarea value={progForm.notas_internas||""} onChange={e=>setProgForm({...progForm,notas_internas:e.target.value})} placeholder="Apuntes internos del coordinador — no visible para estudiantes ni docentes..." rows={3} style={{...S.inp,resize:"vertical",lineHeight:1.5,fontFamily:"system-ui"}}/></div>
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
                    <button key={m.valor} onClick={()=>setProgForm({...progForm,modalidad:m.valor,modalidadCustom:m.valor!=="Otro"?"":progForm.modalidadCustom||""})} style={{border:"2px solid "+(progForm.modalidad===m.valor?RED:"#e5e7eb"),borderRadius:8,padding:"10px 12px",cursor:"pointer",fontFamily:"system-ui",background:progForm.modalidad===m.valor?"#fef2f2":"#fff",textAlign:"left"}}>
                      <span style={{fontWeight:700,fontSize:13,color:progForm.modalidad===m.valor?RED:"#1a1a1a"}}>{m.valor}</span>
                    </button>
                  ))}
                </div>
                {progForm.modalidad==="Otro"&&(
                  <input
                    placeholder="Ej. Hotel Lucerna, Campus Ensenada..."
                    value={progForm.modalidadCustom||""}
                    onChange={e=>setProgForm({...progForm,modalidadCustom:e.target.value})}
                    style={{...S.inp,marginTop:8}}
                  />
                )}
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
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                  {COLORES.map(c=><button key={c} onClick={()=>setProgForm({...progForm,color:c})} style={{width:30,height:30,borderRadius:"50%",background:c,border:progForm.color===c?"3px solid #1a1a1a":"3px solid transparent",cursor:"pointer"}}/>)}
                  {/* Color personalizado */}
                  <label title="Elegir color personalizado" style={{width:30,height:30,borderRadius:"50%",background:progForm.color||"#e5e7eb",border:!COLORES.includes(progForm.color)&&progForm.color?"3px solid #1a1a1a":"3px solid #e5e7eb",cursor:"pointer",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <input type="color" value={progForm.color||"#e5e7eb"} onChange={e=>setProgForm({...progForm,color:e.target.value})} style={{opacity:0,position:"absolute",width:0,height:0}}/>
                    <span style={{fontSize:14,pointerEvents:"none"}}>+</span>
                  </label>
                  {/* Input hex manual */}
                  <input
                    value={progForm.color||""}
                    onChange={e=>{const v=e.target.value;if(/^#[0-9a-fA-F]{0,6}$/.test(v))setProgForm({...progForm,color:v});}}
                    placeholder="#000000"
                    maxLength={7}
                    style={{width:80,border:"1px solid #e5e7eb",borderRadius:6,padding:"5px 8px",fontSize:12,fontFamily:"monospace",outline:"none"}}
                  />
                </div>
              </div>

              {/* SECCIÓN FINANCIERA */}
              <div style={{borderTop:"1px solid #e5e7eb",paddingTop:18,marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:11,color:RED,letterSpacing:"1px",fontFamily:"system-ui",marginBottom:14}}>INFORMACIÓN FINANCIERA</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  <div>
                    <label style={S.lbl}>Precio lista (MXN)</label>
                    <input type="number" min="0" step="1" value={progForm.precioLista||""} onChange={e=>setProgForm({...progForm,precioLista:Math.round(parseFloat(e.target.value)||0)})} placeholder="0" style={S.inp}/>
                  </div>
                  <div>
                    <label style={S.lbl}>Parcialidades default</label>
                    <input type="number" min="1" max="24" value={progForm.parcialidadesDefault||5} onChange={e=>setProgForm({...progForm,parcialidadesDefault:parseInt(e.target.value)||5})} style={S.inp}/>
                  </div>
                </div>
              </div>

              {/* COLABORACIÓN */}
              <div style={{borderTop:"1px solid #e5e7eb",paddingTop:18,marginBottom:18}}>
                <div style={{fontWeight:700,fontSize:11,color:"#7c3aed",letterSpacing:"1px",fontFamily:"system-ui",marginBottom:14}}>COLABORACIÓN INSTITUCIONAL</div>
                <button onClick={()=>setProgForm({...progForm,colaboracion:!progForm.colaboracion,socio:!progForm.colaboracion?progForm.socio:"",pct_socio:!progForm.colaboracion?progForm.pct_socio:0})}
                  style={{width:"100%",padding:"12px 16px",border:"2px solid "+(progForm.colaboracion?"#7c3aed":"#e5e7eb"),borderRadius:10,cursor:"pointer",background:progForm.colaboracion?"#f5f3ff":"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:progForm.colaboracion?12:0}}>
                  <div style={{textAlign:"left"}}>
                    <div style={{fontWeight:700,fontSize:13,color:progForm.colaboracion?"#7c3aed":"#374151"}}>Programa en colaboración</div>
                    <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>Las utilidades se dividen con una institución socia</div>
                  </div>
                  <div style={{width:40,height:22,borderRadius:11,background:progForm.colaboracion?"#7c3aed":"#d1d5db",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                    <div style={{position:"absolute",top:2,left:progForm.colaboracion?20:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                  </div>
                </button>
                {progForm.colaboracion&&(
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"end"}}>
                    <div>
                      <label style={S.lbl}>Nombre del socio / institución</label>
                      <input value={progForm.socio||""} onChange={e=>setProgForm({...progForm,socio:e.target.value})} placeholder="Nombre del asociado" style={S.inp}/>
                    </div>
                    <div style={{width:110}}>
                      <label style={S.lbl}>% que le corresponde</label>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <input type="number" min="1" max="99" value={progForm.pct_socio||""} onChange={e=>setProgForm({...progForm,pct_socio:Math.min(99,Math.max(1,parseInt(e.target.value)||0))})} placeholder="0" style={{...S.inp,textAlign:"center"}}/>
                        <span style={{fontFamily:"system-ui",fontSize:14,color:"#6b7280",flexShrink:0}}>%</span>
                      </div>
                    </div>
                    {progForm.pct_socio>0&&(
                      <div style={{gridColumn:"1/-1",background:"#f5f3ff",borderRadius:8,padding:"10px 14px",fontSize:12,fontFamily:"system-ui",color:"#7c3aed",fontWeight:600}}>
                        IBERO: {100-progForm.pct_socio}% de las utilidades · {progForm.socio||"Socio"}: {progForm.pct_socio}%
                      </div>
                    )}
                  </div>
                )}
              </div>


              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowProgM(false)} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={saveProg} style={S.btn(RED,"#fff")}>{editProgId?"Guardar cambios":"Crear programa"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>{/* /main area */}
    </div>
  );
}
