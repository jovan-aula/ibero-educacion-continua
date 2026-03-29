import { useState, useEffect, useRef } from "react";

// ─── MODO: detecta si está en producción o simulación ─
const IS_PROD = typeof window !== "undefined" && !window.location.hostname.includes("claude") && !window.location.hostname.includes("codesandbox") && window.location.hostname !== "localhost";

// ─── SUPABASE ─────────────────────────────────────────
const SB_URL = "https://hwaxdtlngjalhqnmcgnk.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3YXhkdGxuZ2phbGhxbm1jZ25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NDY2NjMsImV4cCI6MjA5MDMyMjY2M30.isHtrB4g2qK1CYtlievJxr5kZo4IxOtrpMg1Fir11nI";
const SB_HDR = {"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY,"Prefer":"return=representation"};

const sb = {
  get: async (table, params="") => {
    if (!IS_PROD) return lsGet(table);
    const r = await fetch(SB_URL+"/rest/v1/"+table+"?"+params, {headers:SB_HDR});
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  post: async (table, body) => {
    if (!IS_PROD) { lsPost(table, body); return [body]; }
    const r = await fetch(SB_URL+"/rest/v1/"+table, {method:"POST",headers:SB_HDR,body:JSON.stringify(body)});
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  patch: async (table, match, body) => {
    if (!IS_PROD) { lsPatch(table, match, body); return; }
    const r = await fetch(SB_URL+"/rest/v1/"+table+"?"+match, {method:"PATCH",headers:{...SB_HDR,"Prefer":"return=minimal"},body:JSON.stringify(body)});
    if (!r.ok) throw new Error(await r.text());
  },
  delete: async (table, match) => {
    if (!IS_PROD) { lsDelete(table, match); return; }
    const r = await fetch(SB_URL+"/rest/v1/"+table+"?"+match, {method:"DELETE",headers:SB_HDR});
    if (!r.ok) throw new Error(await r.text());
  },
  upsert: async (table, body) => {
    if (!IS_PROD) { lsUpsert(table, body); return; }
    const r = await fetch(SB_URL+"/rest/v1/"+table, {method:"POST",headers:{...SB_HDR,"Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(body)});
    if (!r.ok) throw new Error(await r.text());
  },
};

// ─── LOCALSTORAGE FALLBACK ────────────────────────────
const LS_KEYS = {programas:"ibero_programas",modulos:"ibero_modulos",estudiantes:"ibero_estudiantes",docentes:"ibero_docentes",usuarios:"ibero_usuarios",responsables:"ibero_responsables",configuracion:"ibero_config"};
const lsAll  = t => JSON.parse(localStorage.getItem(LS_KEYS[t]||t)||"[]");
const lsSave = (t,d) => localStorage.setItem(LS_KEYS[t]||t, JSON.stringify(d));

const DEFAULT_USERS_LS = [{id:"admin-default",nombre:"Administrador",email:"admin@ibero.mx",password:"ibero2026",permisos:Object.fromEntries([
  "verProgramas","editarProgramas","editarModulos","confirmarDocentes","gestionarUsuarios","configurarNotif","verReportes","importarEstudiantes","gestionarDocentes"
].map(k=>[k,true]))}];

const INIT_PROGS = [{id:"prog1",nombre:"Diplomado en Alta Dirección",tipo:"Diplomado",color:"#C8102E",created_at:new Date().toISOString()}];
const INIT_MODS  = [
  {id:"m1",programa_id:"prog1",numero:"I",  nombre:"Liderazgo y Dirección con Sentido Humano",              docente:"Gonzalo González",docente_id:"",email_docente:"",clases:4,horas_por_clase:4,horario:"",fecha_inicio:"2025-04-14",fecha_fin:"2025-05-05",dias:["Lun"],estatus:"confirmado"},
  {id:"m2",programa_id:"prog1",numero:"II", nombre:"Pensamiento Estratégico y Toma de Decisiones Complejas",docente:"Jorge Loera",    docente_id:"",email_docente:"",clases:4,horas_por_clase:4,horario:"",fecha_inicio:"2025-05-12",fecha_fin:"2025-06-02",dias:["Lun"],estatus:"confirmado"},
  {id:"m3",programa_id:"prog1",numero:"III",nombre:"Gestión del Potencial Humano y Equipos de Alto Desempeño",docente:"",            docente_id:"",email_docente:"",clases:4,horas_por_clase:4,horario:"",fecha_inicio:"2025-06-09",fecha_fin:"2025-06-30",dias:["Lun"],estatus:"propuesta"},
  {id:"m4",programa_id:"prog1",numero:"IV", nombre:"Gestión Financiera Estratégica",                         docente:"Rogelio Herrera",docente_id:"",email_docente:"",clases:4,horas_por_clase:4,horario:"",fecha_inicio:"2025-07-07",fecha_fin:"2025-08-11",dias:["Lun"],estatus:"confirmado"},
  {id:"m5",programa_id:"prog1",numero:"V",  nombre:"Gobierno Corporativo, Sustentabilidad y Responsabilidad Social",docente:"Claudia Flores",docente_id:"",email_docente:"",clases:4,horas_por_clase:4,horario:"",fecha_inicio:"2025-08-18",fecha_fin:"2025-09-08",dias:["Lun"],estatus:"confirmado"},
];

const lsGet = t => {
  if (t==="usuarios") { const d=lsAll("usuarios"); return d.length?d:DEFAULT_USERS_LS; }
  if (t==="programas") { const d=lsAll("programas"); return d.length?d:INIT_PROGS; }
  if (t==="modulos")   { const d=lsAll("modulos");   return d.length?d:INIT_MODS; }
  if (t==="configuracion") { const d=lsAll("configuracion"); return d.length?d:[{id:"main",notif_api_key:"",notif_location_id:"",field_map:[]}]; }
  return lsAll(t);
};
const lsPost   = (t,b) => { const d=lsGet(t); lsSave(t,[...d,b]); };
const lsUpsert = (t,b) => { const d=lsGet(t); const idx=d.findIndex(x=>x.id===b.id); if(idx>=0)d[idx]={...d[idx],...b};else d.push(b); lsSave(t,d); };
const lsPatch  = (t,match,b) => {
  const key=match.split("=eq.")[0].replace("id","id"),val=match.split("=eq.")[1];
  const d=lsGet(t).map(x=>x.id===val?{...x,...b}:x); lsSave(t,d);
};
const lsDelete = (t,match) => {
  const val=match.split("=eq.")[1];
  lsSave(t,lsGet(t).filter(x=>x.id!==val));
};

// ─── CONSTANTES ───────────────────────────────────────
const RED = "#C8102E";
const DIAS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const COLORES = ["#C8102E","#1a1a1a","#7c3aed","#1d4ed8","#0f766e","#b45309","#6b2d2d","#374151"];
const MESES_L = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MESES_C = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DIAS_S  = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
const TIPOS_PROG = [
  {valor:"Diplomado",desc:"80+ hrs"},{valor:"Curso",desc:"20–79 hrs"},
  {valor:"Seminario",desc:"8–20 hrs"},{valor:"Taller",desc:"4–16 hrs"},{valor:"Otro",desc:"Personalizable"},
];
const ALL_PERMISOS = [
  {key:"verProgramas",label:"Ver programas y módulos"},
  {key:"editarProgramas",label:"Agregar / editar programas"},
  {key:"editarModulos",label:"Agregar / editar módulos"},
  {key:"confirmarDocentes",label:"Confirmar docentes"},
  {key:"gestionarUsuarios",label:"Gestionar usuarios"},
  {key:"configurarNotif",label:"Configurar notificaciones"},
  {key:"verReportes",label:"Ver reportes / estadísticas"},
  {key:"importarEstudiantes",label:"Importar estudiantes desde CRM"},
  {key:"gestionarDocentes",label:"Gestionar catálogo de docentes"},
];
const ADMIN_P  = Object.fromEntries(ALL_PERMISOS.map(p=>[p.key,true]));
const VIEWER_P = {verProgramas:true,...Object.fromEntries(ALL_PERMISOS.slice(1).map(p=>[p.key,false]))};
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
const S = {
  inp: {width:"100%",border:"1px solid #e5e7eb",borderRadius:6,padding:"9px 12px",fontSize:14,boxSizing:"border-box",fontFamily:"system-ui",outline:"none"},
  lbl: {fontSize:11,fontWeight:700,color:"#6b7280",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em",fontFamily:"system-ui"},
  card:{background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
  btn: (bg,color,extra={})=>({border:"none",borderRadius:6,padding:"8px 16px",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui",background:bg,color,...extra}),
};

// ─── HELPERS ──────────────────────────────────────────
const fmtFecha = d => { if(!d)return""; const[y,m,day]=d.split("-"); return parseInt(day)+" "+MESES_C[parseInt(m)-1]+" "+y; };
const newId    = () => Math.random().toString(36).slice(2,9);
const can      = (s,p) => !!(s&&s.permisos&&s.permisos[p]);
const today    = () => new Date().toISOString().split("T")[0];

const progStatus = p => {
  const ms = (p.modulos||[]);
  const starts = ms.map(m=>m.fecha_inicio).filter(Boolean).sort();
  const ends   = ms.map(m=>m.fecha_fin).filter(Boolean).sort().reverse();
  if (!starts.length) return "sin_fechas";
  const t = today();
  if (t < starts[0]) return "proximo";
  if (t > ends[0])   return "finalizado";
  return "activo";
};

const calcPct = (est, modulos) => {
  if (!est||!modulos||!modulos.length) return null;
  const total = modulos.reduce((a,m)=>a+(m.clases||0),0);
  if (!total) return null;
  const asist = modulos.reduce((a,m)=>{ const v=(est.asistencia||{})["mod_"+m.id]; return a+(v||0); },0);
  return Math.round(asist/total*100);
};

const getAlertas = (programas) => {
  const alerts = [];
  (programas||[]).forEach(prog=>{
    (prog.modulos||[]).forEach(mod=>{
      if (!mod.docente&&mod.fecha_inicio) {
        const diff = Math.round((new Date(mod.fecha_inicio)-new Date(today()))/86400000);
        if (diff>=0&&diff<=14) alerts.push({tipo:"sin_docente",prog,mod,dias:diff});
      }
    });
    (prog.estudiantes||[]).forEach(est=>{
      const pct = calcPct(est,prog.modulos||[]);
      if (pct!==null&&pct<80&&progStatus(prog)==="activo") alerts.push({tipo:"asistencia",prog,est,pct});
    });
  });
  return alerts;
};

// ─── LOGO ─────────────────────────────────────────────
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

// ─── LOGIN ────────────────────────────────────────────
function LoginScreen({onLogin}) {
  const [email,setEmail]=useState(""); const [pw,setPw]=useState(""); const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const rows = IS_PROD
        ? await sb.get("usuarios","select=*")
        : lsGet("usuarios");
      const u = rows.find(u=>u.email.toLowerCase()===email.toLowerCase()&&u.password===pw);
      if (u) { localStorage.setItem("ibero_session",JSON.stringify(u)); onLogin(u); }
      else setErr("Correo o contraseña incorrectos.");
    } catch(e) { setErr("Error de conexión. Intenta de nuevo."); }
    setBusy(false);
  };
  return (
    <div style={{minHeight:"100vh",background:"#f2f2f2",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#fff",borderRadius:10,boxShadow:"0 4px 32px rgba(0,0,0,0.10)",width:"100%",maxWidth:400,overflow:"hidden"}}>
        <div style={{background:RED,padding:"24px 36px",display:"flex",justifyContent:"center"}}><IberoLogo h={60}/></div>
        <div style={{padding:"32px 36px"}}>
          <div style={{fontWeight:700,fontSize:17,marginBottom:4,fontFamily:"Georgia,serif"}}>Acceso al sistema</div>
          <div style={{fontSize:13,color:"#9ca3af",marginBottom:24,fontFamily:"system-ui"}}>Dirección de Educación Continua</div>
          <div style={{marginBottom:16}}><label style={S.lbl}>Correo electrónico</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={S.inp}/></div>
          <div style={{marginBottom:20}}><label style={S.lbl}>Contraseña</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} style={S.inp}/></div>
          {err&&<div style={{background:"#fef2f2",color:"#dc2626",borderRadius:6,padding:"10px 14px",fontSize:13,marginBottom:16,fontFamily:"system-ui"}}>{err}</div>}
          <button onClick={go} disabled={busy} style={{...S.btn(RED,"#fff"),width:"100%",padding:"12px"}}>{busy?"Verificando...":"Iniciar sesión"}</button>
        </div>
      </div>
      <div style={{marginTop:20,fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>© 2026 IBERO Tijuana · Sistema interno</div>
    </div>
  );
}

// ─── LISTA PÚBLICA DOCENTE ────────────────────────────
function ListaDocente({token}) {
  const [prog,setProg]=useState(null); const [mod,setMod]=useState(null); const [local,setLocal]=useState([]); const [saved,setSaved]=useState(false); const [loading,setLoading]=useState(true);
  let progId,modId;
  try{const d=JSON.parse(atob(token));progId=d.progId;modId=d.modId;}catch(e){return<div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:RED}}>Enlace inválido.</div>;}

  useEffect(()=>{
    (async()=>{
      try{
        const [progs,mods,ests]= await Promise.all([
          sb.get("programas","id=eq."+progId),
          sb.get("modulos","programa_id=eq."+progId+"&select=*"),
          sb.get("estudiantes","programa_id=eq."+progId+"&select=*"),
        ]);
        const p={...progs[0],modulos:mods,estudiantes:ests};
        setProg(p); setMod(mods.find(m=>m.id===modId)); setLocal(ests.map(e=>({...e,asistencia:{...(e.asistencia||{})}})));
      }catch(e){}
      setLoading(false);
    })();
  },[]);

  const toggle = id => { setLocal(prev=>prev.map(e=>{if(e.id!==id)return e;const k="mod_"+modId,cur=(e.asistencia||{})[k]||0,max=mod?mod.clases||0:0;return{...e,asistencia:{...(e.asistencia||{}),[k]:cur>=max?0:cur+1}};}));setSaved(false); };

  const guardar = async () => {
    for(const e of local){await sb.patch("estudiantes","id=eq."+e.id,{asistencia:e.asistencia||{}});}
    setSaved(true);
  };

  if(loading) return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:"#9ca3af"}}>Cargando...</div>;
  if(!prog||!mod) return <div style={{padding:40,textAlign:"center",fontFamily:"system-ui",color:RED}}>Módulo no encontrado.</div>;

  return(
    <div style={{minHeight:"100vh",background:"#f2f2f2",fontFamily:"system-ui"}}>
      <div style={{background:RED,padding:"16px 24px",display:"flex",alignItems:"center",gap:16}}><IberoLogo h={40}/><div style={{color:"rgba(255,255,255,0.85)",fontSize:13}}>Lista de Asistencia</div></div>
      <div style={{maxWidth:640,margin:"0 auto",padding:"28px 16px"}}>
        <div style={{...S.card,padding:24,marginBottom:20}}>
          <div style={{fontWeight:700,fontSize:18,fontFamily:"Georgia,serif",marginBottom:4}}>{mod.nombre}</div>
          <div style={{fontSize:13,color:"#6b7280",display:"flex",gap:16,flexWrap:"wrap"}}><span>{prog.nombre}</span><span>Módulo {mod.numero}</span>{mod.horario&&<span>{mod.horario}</span>}<span>{mod.clases} clases</span></div>
        </div>
        <div style={{marginBottom:12,fontSize:13,color:"#6b7280"}}>Toca el contador para registrar asistencia por clase.</div>
        <div style={{display:"grid",gap:10,marginBottom:20}}>
          {local.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:40}}>Sin estudiantes en este módulo.</div>}
          {local.map(e=>{const k="mod_"+modId,asist=(e.asistencia||{})[k]||0,max=mod.clases||0,pct=max?Math.round(asist/max*100):0;return(
            <div key={e.id} style={{...S.card,padding:"14px 18px",display:"flex",alignItems:"center",gap:14}}>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:15}}>{e.nombre}</div>{e.empresa&&<div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>{e.empresa}</div>}<div style={{marginTop:6,width:120,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:pct>=80?"#16a34a":"#dc2626",borderRadius:4}}/></div></div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                <button onClick={()=>toggle(e.id)} style={{width:64,height:40,border:"2px solid "+(asist>0?"#16a34a":"#e5e7eb"),borderRadius:8,background:asist>0?"#f0fdf4":"#f9f9f9",cursor:"pointer",fontWeight:800,fontSize:16,color:asist>0?"#16a34a":"#9ca3af",fontFamily:"system-ui"}}>{asist}/{max}</button>
                <span style={{fontSize:10,color:pct>=80?"#16a34a":"#dc2626",fontWeight:700}}>{pct}%</span>
              </div>
            </div>
          );})}
        </div>
        <button onClick={guardar} style={{...S.btn(RED,"#fff"),width:"100%",padding:14,fontSize:15}}>{saved?"Asistencia guardada":"Guardar asistencia"}</button>
        {saved&&<div style={{textAlign:"center",fontSize:13,color:"#16a34a",marginTop:12,fontWeight:600}}>Guardado y sincronizado correctamente.</div>}
      </div>
    </div>
  );
}

// ─── IMPORT MODAL ─────────────────────────────────────
function ImportModal({prog,notifCfg,fieldMap,onImport,onClose}) {
  const [pipelines,setPipelines]=useState([]); const [stages,setStages]=useState([]); const [contacts,setContacts]=useState([]); const [selected,setSelected]=useState([]); const [filters,setFilters]=useState({pipelineId:"",stageId:"",status:"open"}); const [step,setStep]=useState("filter"); const [busy,setBusy]=useState(false); const [err,setErr]=useState("");
  const hasApi=!!(notifCfg&&notifCfg.notif_api_key&&notifCfg.notif_location_id);
  const MOCK_PL=[{id:"pipe1",name:"Diplomados 2025"},{id:"pipe2",name:"Cursos Ejecutivos"}];
  const MOCK_ST={pipe1:[{id:"s1",name:"Inscrito"},{id:"s2",name:"Pagado"}],pipe2:[{id:"s3",name:"Confirmado"}]};
  const MOCK_CT=[
    {id:"c1",name:"José Alberto Gómez",email:"alberto@hotmail.com",phone:"+52311111",company:"Grupo Industrial Norte",source:"Sitio Web",customFields:[{fieldKey:"contact.programa_de_intersz",fieldName:"Programa de interés",fieldValue:"Diplomado en Alta Dirección"},{fieldKey:"contact.puesto_que_desempeas",fieldName:"Puesto",fieldValue:"Director General"}]},
    {id:"c2",name:"María Fernanda López",email:"mflopez@empresa.com",phone:"+52664111",company:"Corporativo TJ",source:"Referido",customFields:[{fieldKey:"contact.programa_de_intersz",fieldName:"Programa de interés",fieldValue:"Diplomado en Alta Dirección"},{fieldKey:"contact.puesto_que_desempeas",fieldName:"Puesto",fieldValue:"Gerente Financiero"}]},
    {id:"c3",name:"Roberto Sánchez",email:"rsanchez@mx.com",phone:"+52664222",company:"Negocios Frontera",source:"LinkedIn",customFields:[{fieldKey:"contact.programa_de_intersz",fieldName:"Programa de interés",fieldValue:"Diplomado en Alta Dirección"},{fieldKey:"contact.puesto_que_desempeas",fieldName:"Puesto",fieldValue:"CEO"}]},
  ];
  useEffect(()=>{hasApi?fetch("https://services.leadconnectorhq.com/opportunities/pipelines?locationId="+notifCfg.notif_location_id,{headers:{"Authorization":"Bearer "+notifCfg.notif_api_key,"Version":"2021-04-15"}}).then(r=>r.json()).then(d=>setPipelines(d.pipelines||[])).catch(()=>setPipelines(MOCK_PL)):setPipelines(MOCK_PL);},[]);
  useEffect(()=>{if(!filters.pipelineId)return;hasApi?setStages((pipelines.find(p=>p.id===filters.pipelineId)||{}).stages||[]):setStages(MOCK_ST[filters.pipelineId]||[]);setFilters(f=>({...f,stageId:""}));},[filters.pipelineId]);

  const search=async()=>{if(!filters.pipelineId){setErr("Selecciona un pipeline.");return;}setBusy(true);setErr("");try{if(hasApi){let url="https://services.leadconnectorhq.com/opportunities/search?location_id="+notifCfg.notif_location_id+"&pipeline_id="+filters.pipelineId+"&status="+filters.status;if(filters.stageId)url+="&pipeline_stage_id="+filters.stageId;const r=await fetch(url,{headers:{"Authorization":"Bearer "+notifCfg.notif_api_key,"Version":"2021-04-15"}});const d=await r.json();const enriched=await Promise.all((d.opportunities||[]).map(async op=>{try{const cr=await fetch("https://services.leadconnectorhq.com/contacts/"+op.contactId,{headers:{"Authorization":"Bearer "+notifCfg.notif_api_key,"Version":"2021-04-15"}});const cd=await cr.json();return{...cd.contact,opportunityStatus:op.status};}catch(e){return{id:op.contactId,name:op.name};}}));setContacts(enriched);}else setContacts(MOCK_CT);setStep("preview");}catch(e){setErr("Error al conectar.");}setBusy(false);};

  const doImport=async()=>{
    const existIds=new Set((prog.estudiantes||[]).map(e=>e.id));
    const toAdd=contacts.filter(c=>selected.includes(c.id)&&!existIds.has(c.id)).map(c=>{
      const campos_extra={};
      (fieldMap||[]).forEach(fm=>{const cf=(c.customFields||[]).find(f=>f.fieldKey===fm.id||f.fieldKey==="contact."+fm.id);if(cf)campos_extra[fm.label]=cf.fieldValue;});
      return{id:c.id,programa_id:prog.id,nombre:c.name||((c.firstName||"")+" "+(c.lastName||"")).trim(),email:c.email||"",telefono:c.phone||"",empresa:c.company||"",fuente:c.source||"",estatus:"activo",asistencia:{},campos_extra};
    });
    for(const e of toAdd){await sb.upsert("estudiantes",e);}
    onImport();onClose();
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>Importar / Sincronizar estudiantes</div><div style={{fontSize:12,color:"#9ca3af",fontFamily:"system-ui"}}>{prog.nombre}</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
        </div>
        <div style={{padding:"20px 24px"}}>
          {!hasApi&&<div style={{marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"10px 14px",fontSize:13,color:"#92400e",fontFamily:"system-ui"}}>Modo simulación — configura credenciales en ⚙️ para usar tu CRM real.</div>}
          {step==="filter"&&(<div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div><label style={S.lbl}>Pipeline</label><select value={filters.pipelineId} onChange={e=>setFilters(f=>({...f,pipelineId:e.target.value}))} style={S.inp}><option value="">Seleccionar...</option>{pipelines.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label style={S.lbl}>Etapa</label><select value={filters.stageId} onChange={e=>setFilters(f=>({...f,stageId:e.target.value}))} style={S.inp} disabled={!filters.pipelineId}><option value="">Todas</option>{stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            </div>
            <div style={{marginBottom:20}}><label style={S.lbl}>Estatus</label><div style={{display:"flex",gap:8}}>{[["open","Abierta"],["won","Ganada"],["lost","Perdida"]].map(([v,l])=><button key={v} onClick={()=>setFilters(f=>({...f,status:v}))} style={{border:"2px solid "+(filters.status===v?RED:"#e5e7eb"),borderRadius:6,padding:"7px 16px",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"system-ui",background:filters.status===v?"#fef2f2":"#fff",color:filters.status===v?RED:"#9ca3af"}}>{l}</button>)}</div></div>
            {err&&<div style={{background:"#fef2f2",color:"#dc2626",borderRadius:6,padding:"10px 14px",fontSize:13,marginBottom:14,fontFamily:"system-ui"}}>{err}</div>}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}><button onClick={onClose} style={S.btn("#f3f4f6","#374151")}>Cancelar</button><button onClick={search} disabled={busy} style={S.btn(RED,"#fff")}>{busy?"Buscando...":"Buscar contactos"}</button></div>
          </div>)}
          {step==="preview"&&(<div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{contacts.length} contactos · {selected.length} seleccionados</div><button onClick={()=>setSelected(selected.length===contacts.length?[]:contacts.map(c=>c.id))} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>{selected.length===contacts.length?"Deseleccionar todos":"Seleccionar todos"}</button></div>
            <div style={{display:"grid",gap:8,marginBottom:20}}>
              {contacts.map(c=>{const sel=selected.includes(c.id),already=(prog.estudiantes||[]).some(e=>e.id===c.id);return(
                <div key={c.id} onClick={()=>!already&&setSelected(s=>sel?s.filter(x=>x!==c.id):[...s,c.id])} style={{border:"1px solid "+(sel?"#fca5a5":"#e5e7eb"),borderRadius:8,padding:"12px 16px",cursor:already?"default":"pointer",background:already?"#f9f9f9":sel?"#fef2f2":"#fff",display:"flex",gap:12}}>
                  <div style={{width:18,height:18,border:"2px solid "+(sel?RED:"#d1d5db"),borderRadius:4,background:sel?RED:"#fff",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center"}}>{sel&&<span style={{color:"#fff",fontSize:11,fontWeight:700}}>✓</span>}</div>
                  <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,display:"flex",gap:8,alignItems:"center"}}>{c.name}{already&&<span style={{fontSize:11,background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",borderRadius:4,padding:"1px 8px",fontWeight:600,fontFamily:"system-ui"}}>Ya importado</span>}</div><div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>{c.email&&<span>{c.email}</span>}{c.phone&&<span>{c.phone}</span>}{c.company&&<span>{c.company}</span>}</div></div>
                </div>
              );})}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"space-between"}}><button onClick={()=>{setStep("filter");setContacts([]);setSelected([]);}} style={S.btn("#f3f4f6","#374151")}>← Volver</button><button onClick={doImport} disabled={!selected.length} style={S.btn(selected.length?RED:"#e5e7eb",selected.length?"#fff":"#9ca3af")}>Importar {selected.length?"("+selected.length+")":""}</button></div>
          </div>)}
        </div>
      </div>
    </div>
  );
}

// ─── CALENDARIO ───────────────────────────────────────
function CalendarioView({programas}) {
  const hoy=new Date(); const [modo,setModo]=useState("mes"); const [dia,setDia]=useState(hoy.getDate()); const [mes,setMes]=useState(hoy.getMonth()); const [anio,setAnio]=useState(hoy.getFullYear()); const [selDia,setSelDia]=useState(null); const [filtro,setFiltro]=useState("");
  const TD=hoy.getDate(),TM=hoy.getMonth(),TY=hoy.getFullYear();
  const progs=filtro?(programas||[]).filter(p=>p.id===filtro):(programas||[]);

  const getEvts=(fm,fa,fd)=>{const evs=[];progs.forEach(prog=>{(prog.modulos||[]).forEach(mod=>{if(!mod.fecha_inicio||!mod.fecha_fin)return;const ini=new Date(mod.fecha_inicio+"T12:00:00"),fin=new Date(mod.fecha_fin+"T12:00:00"),cur=new Date(ini);while(cur<=fin){const dm=cur.getMonth(),dy=cur.getFullYear(),dd=cur.getDate(),da=DIAS_S[(cur.getDay()+6)%7];if(mod.dias&&mod.dias.includes(da)&&(fa==null||dy===fa)&&(fm==null||dm===fm)&&(fd==null||dd===fd))evs.push({dia:dd,mes:dm,anio:dy,prog,mod});cur.setDate(cur.getDate()+1);}});});return evs;};
  const iniSem=()=>{const d=new Date(anio,mes,dia);d.setDate(d.getDate()-((d.getDay()+6)%7));return d;};
  const nav=dir=>{if(modo==="dia"){const d=new Date(anio,mes,dia+dir);setDia(d.getDate());setMes(d.getMonth());setAnio(d.getFullYear());}else if(modo==="semana"){const d=new Date(anio,mes,dia+dir*7);setDia(d.getDate());setMes(d.getMonth());setAnio(d.getFullYear());}else if(modo==="mes"){const nm=mes+dir;if(nm<0){setMes(11);setAnio(a=>a-1);}else if(nm>11){setMes(0);setAnio(a=>a+1);}else setMes(nm);}else setAnio(a=>a+dir);setSelDia(null);};
  const titulo=()=>{if(modo==="dia")return dia+" de "+MESES_L[mes]+" de "+anio;if(modo==="semana"){const i=iniSem();return"Semana del "+i.getDate()+" de "+MESES_L[i.getMonth()];}if(modo==="mes")return MESES_L[mes]+" "+anio;return""+anio;};

  const EvCard=({e})=>(<div style={{display:"flex",gap:10,padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}><div style={{width:4,minHeight:36,borderRadius:4,background:e.prog.color,flexShrink:0}}/><div><div style={{fontWeight:700,fontSize:14}}>{e.mod.nombre}</div><div style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui",marginTop:2,display:"flex",gap:10,flexWrap:"wrap"}}><span>{e.prog.nombre}</span>{e.mod.horario&&<span>{e.mod.horario}</span>}{e.mod.docente&&<span>{e.mod.docente}</span>}</div></div></div>);

  const RenderDia=()=>{const evs=getEvts(mes,anio,dia),isT=dia===TD&&mes===TM&&anio===TY;return(<div style={{...S.card,padding:24}}><div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}><div style={{width:48,height:48,borderRadius:12,background:isT?RED:"#f3f4f6",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:20,fontWeight:800,color:isT?"#fff":"#1a1a1a",fontFamily:"system-ui",lineHeight:1}}>{dia}</span><span style={{fontSize:9,color:isT?"rgba(255,255,255,0.8)":"#9ca3af",fontFamily:"system-ui"}}>{DIAS_S[(new Date(anio,mes,dia).getDay()+6)%7]}</span></div><div><div style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{dia+" de "+MESES_L[mes]+" de "+anio}</div><div style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>{evs.length} clases</div></div></div>{evs.length===0?<div style={{textAlign:"center",color:"#9ca3af",padding:"32px 0",fontFamily:"system-ui"}}>Sin clases este día.</div>:evs.map((e,i)=><EvCard key={i} e={e}/>)}</div>);};

  const RenderSemana=()=>{const ini=iniSem(),dSem=Array.from({length:7}).map((_,i)=>{const d=new Date(ini);d.setDate(ini.getDate()+i);return d;});return(<div style={{...S.card,overflow:"hidden"}}><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid #e5e7eb"}}>{dSem.map((d,i)=>{const isT=d.getDate()===TD&&d.getMonth()===TM&&d.getFullYear()===TY;return(<div key={i} style={{padding:"10px 8px",textAlign:"center",background:isT?"#fef2f2":"#fff",borderRight:i<6?"1px solid #f3f4f6":"none"}}><div style={{fontSize:11,fontWeight:700,color:"#6b7280",fontFamily:"system-ui",marginBottom:4}}>{DIAS_S[i]}</div><div style={{width:28,height:28,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto"}}><span style={{fontSize:14,fontWeight:isT?700:400,color:isT?"#fff":"#1a1a1a",fontFamily:"system-ui"}}>{d.getDate()}</span></div></div>);})}</div><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>{dSem.map((d,i)=>{const evs=getEvts(d.getMonth(),d.getFullYear(),d.getDate());return(<div key={i} style={{minHeight:120,padding:"8px 6px",borderRight:i<6?"1px solid #f3f4f6":"none"}}>{evs.map((e,j)=><div key={j} style={{background:e.prog.color,color:"#fff",borderRadius:4,padding:"3px 6px",fontSize:10,fontFamily:"system-ui",fontWeight:600,marginBottom:3,lineHeight:1.3}}><div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.mod.numero}</div><div style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",opacity:0.9}}>{e.mod.nombre.split(" ").slice(0,2).join(" ")}</div>{e.mod.horario&&<div style={{opacity:0.8,fontSize:9}}>{e.mod.horario}</div>}</div>)}</div>);})}</div></div>);};

  const RenderMes=()=>{const pD=new Date(anio,mes,1),uD=new Date(anio,mes+1,0),off=(pD.getDay()+6)%7,tot=Math.ceil((off+uD.getDate())/7)*7,evsMes=getEvts(mes,anio,null),byD={};evsMes.forEach(e=>{if(!byD[e.dia])byD[e.dia]=[];byD[e.dia].push(e);});return(<div><div style={{...S.card,overflow:"hidden"}}><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",borderBottom:"1px solid #e5e7eb"}}>{DIAS_S.map(d=><div key={d} style={{padding:"10px 0",textAlign:"center",fontSize:11,fontWeight:700,color:"#6b7280",fontFamily:"system-ui"}}>{d}</div>)}</div><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>{Array.from({length:tot}).map((_,i)=>{const d=i-off+1,valid=d>=1&&d<=uD.getDate(),isT=valid&&d===TD&&mes===TM&&anio===TY,ev=valid?(byD[d]||[]):[],isSel=selDia===d;return(<div key={i} onClick={()=>valid&&setSelDia(isSel?null:d)} style={{minHeight:88,padding:"6px 8px",borderRight:(i+1)%7!==0?"1px solid #f3f4f6":"none",borderBottom:i<tot-7?"1px solid #f3f4f6":"none",background:isSel?"#fef2f2":isT?"#fffbeb":"#fff",cursor:valid?"pointer":"default"}}>{valid&&<><div style={{width:24,height:24,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:4}}><span style={{fontSize:12,fontWeight:isT?800:400,color:isT?"#fff":"#374151",fontFamily:"system-ui"}}>{d}</span></div>{ev.slice(0,3).map((e,j)=><div key={j} style={{background:e.prog.color,color:"#fff",borderRadius:3,padding:"2px 5px",fontSize:10,fontFamily:"system-ui",fontWeight:600,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.mod.numero+" · "+e.mod.nombre.split(" ").slice(0,2).join(" ")}</div>)}{ev.length>3&&<div style={{fontSize:10,color:"#9ca3af",fontFamily:"system-ui"}}>+{ev.length-3} más</div>}</>}</div>);})}</div></div>{selDia&&byD[selDia]&&<div style={{...S.card,marginTop:16,padding:20}}><div style={{fontWeight:700,fontSize:15,marginBottom:12,fontFamily:"Georgia,serif"}}>{selDia+" de "+MESES_L[mes]+" de "+anio}</div>{byD[selDia].map((e,i)=><EvCard key={i} e={e}/>)}</div>}</div>);};

  const RenderAnio=()=>{const evs=getEvts(null,anio,null),byM={};evs.forEach(e=>{if(!byM[e.mes])byM[e.mes]=[];byM[e.mes].push(e);});return(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>{Array.from({length:12}).map((_,m)=>{const mEvs=byM[m]||[],pD=new Date(anio,m,1),uD=new Date(anio,m+1,0),off=(pD.getDay()+6)%7,tot=Math.ceil((off+uD.getDate())/7)*7,byD={};mEvs.forEach(e=>{if(!byD[e.dia])byD[e.dia]=[];byD[e.dia].push(e);});const isCur=m===TM&&anio===TY;return(<div key={m} onClick={()=>{setMes(m);setModo("mes");setSelDia(null);}} style={{...S.card,overflow:"hidden",cursor:"pointer",border:"1px solid "+(isCur?"#fca5a5":"#e5e7eb")}}><div style={{background:isCur?RED:"#f9f9f9",padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontWeight:700,fontSize:13,fontFamily:"system-ui",color:isCur?"#fff":"#1a1a1a"}}>{MESES_L[m]}</span>{mEvs.length>0&&<span style={{fontSize:11,background:isCur?"rgba(255,255,255,0.2)":"#f3f4f6",color:isCur?"#fff":"#6b7280",borderRadius:20,padding:"2px 8px",fontFamily:"system-ui",fontWeight:600}}>{mEvs.length} clases</span>}</div><div style={{padding:"8px 10px"}}><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:2}}>{DIAS_S.map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"#9ca3af",fontFamily:"system-ui",fontWeight:700}}>{d[0]}</div>)}</div><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>{Array.from({length:tot}).map((_,i)=>{const d=i-off+1,valid=d>=1&&d<=uD.getDate(),isT=valid&&d===TD&&m===TM&&anio===TY,hEv=valid&&(byD[d]||[]).length>0,cols=[...new Set((byD[d]||[]).map(e=>e.prog.color))];return(<div key={i} style={{height:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{valid&&<div style={{width:16,height:16,borderRadius:"50%",background:isT?RED:"transparent",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}><span style={{fontSize:9,color:isT?"#fff":"#374151",fontFamily:"system-ui"}}>{d}</span>{hEv&&!isT&&<div style={{position:"absolute",bottom:-2,left:"50%",transform:"translateX(-50%)",display:"flex",gap:1}}>{cols.slice(0,3).map((c,ci)=><div key={ci} style={{width:3,height:3,borderRadius:"50%",background:c}}/>)}</div>}</div>}</div>);})}</div></div></div>);})}</div>);};

  return(<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}><h1 style={{fontSize:24,fontWeight:700,margin:0,letterSpacing:"-0.5px"}}>Calendario</h1><div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><select value={filtro} onChange={e=>setFiltro(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"6px 10px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}><option value="">Todos los programas</option>{(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select><div style={{display:"flex",background:"#f3f4f6",borderRadius:8,padding:3,gap:2}}>{[["dia","Día"],["semana","Semana"],["mes","Mes"],["anio","Año"]].map(([v,l])=><button key={v} onClick={()=>{setModo(v);setSelDia(null);}} style={{background:modo===v?"#fff":"transparent",color:modo===v?"#1a1a1a":"#6b7280",border:"none",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:600,fontSize:12,fontFamily:"system-ui"}}>{l}</button>)}</div><button onClick={()=>{setDia(TD);setMes(TM);setAnio(TY);setSelDia(null);}} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px"})}>Hoy</button><div style={{display:"flex",gap:4}}><button onClick={()=>nav(-1)} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px"})}>←</button><button onClick={()=>nav(1)} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px"})}>→</button></div><span style={{fontWeight:700,fontSize:14,fontFamily:"system-ui"}}>{titulo()}</span></div></div><div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>{progs.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:6,fontFamily:"system-ui",fontSize:12}}><div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/><span style={{color:"#374151"}}>{p.nombre}</span></div>)}</div>{modo==="dia"&&<RenderDia/>}{modo==="semana"&&<RenderSemana/>}{modo==="mes"&&<RenderMes/>}{modo==="anio"&&<RenderAnio/>}</div>);
}

// ─── MAIN APP ─────────────────────────────────────────
export default function App() {
  const [session,setSession]     = useState(null);
  const [ready,setReady]         = useState(false);
  const [programas,setProgramas] = useState([]);
  const [docentes,setDocentes]   = useState([]);
  const [notifCfg,setNotifCfg]   = useState({notif_api_key:"",notif_location_id:""});
  const [fieldMap,setFieldMap]   = useState([]);
  const [responsables,setResp]   = useState([]);
  const [users,setUsers]         = useState([]);
  const [view,setView]           = useState("lista");
  const [selProg,setSelProg]     = useState(null);
  const [progTab,setProgTab]     = useState("modulos");
  const [showModM,setShowModM]   = useState(false);
  const [editMod,setEditMod]     = useState(null);
  const [showProgM,setShowProgM] = useState(false);
  const [showImport,setShowImp]  = useState(false);
  const [showAlertas,setShowAl]  = useState(false);
  const [notif,setNotif]         = useState(null);
  const [sending,setSending]     = useState(null);
  const [newResp,setNewResp]     = useState({nombre:"",email:""});
  const [newUser,setNewUser]     = useState({nombre:"",email:"",password:"",permisos:{...VIEWER_P}});
  const [showUP,setShowUP]       = useState(false);
  const [showAK,setShowAK]       = useState(false);
  const [newFM,setNewFM]         = useState({id:"",label:""});
  const [repExp,setRepExp]       = useState(null);
  const [linkCop,setLinkCop]     = useState("");
  const [busqProg,setBusqP]      = useState("");
  const [filtroProg,setFiltroP]  = useState("");
  const [filtroSt,setFiltroSt]   = useState("");
  const [busqEst,setBusqE]       = useState("");
  const [filtroEst,setFiltroE]   = useState("");
  const [busqDoc,setBusqD]       = useState("");
  const [busqAsis,setBusqAs]     = useState("");
  const [filtroAsis,setFiltroAs] = useState("");
  const [showDoc,setShowDoc]     = useState(false);
  const [docForm,setDocForm]     = useState({id:"",nombre:"",email:"",telefono:"",grado:"Licenciatura",programas_ids:[]});
  const [editDocId,setEditDocId] = useState(null);
  const alertRef = useRef(null);

  const eMod  = {id:"",numero:"",nombre:"",docente_id:"",docente:"",email_docente:"",clases:4,horas_por_clase:4,horario:"",fecha_inicio:"",fecha_fin:"",dias:["Lun"],estatus:"propuesta"};
  const eProg = {id:"",nombre:"",tipo:"Diplomado",tipoCustom:"",color:RED};
  const [modForm,setModForm]   = useState(eMod);
  const [progForm,setProgForm] = useState(eProg);

  // ─── CARGA INICIAL ──────────────────────────────────
  const loadAll = async () => {
    try {
      const [progs,mods,ests,docs,cfg,resps,usrs] = await Promise.all([
        sb.get("programas","select=*&order=created_at.asc"),
        sb.get("modulos","select=*&order=created_at.asc"),
        sb.get("estudiantes","select=*"),
        sb.get("docentes","select=*&order=nombre.asc"),
        sb.get("configuracion","id=eq.main&select=*"),
        sb.get("responsables","select=*&order=created_at.asc"),
        sb.get("usuarios","select=*&order=created_at.asc"),
      ]);
      const progsConDatos = progs.map(p=>({...p,modulos:mods.filter(m=>m.programa_id===p.id),estudiantes:ests.filter(e=>e.programa_id===p.id)}));
      setProgramas(progsConDatos);
      setDocentes(docs);
      if(cfg[0]){setNotifCfg(cfg[0]);setFieldMap(cfg[0].field_map||[]);}
      setResp(resps);
      setUsers(usrs);
    } catch(e){ notify("Error al cargar datos","error"); }
  };

  useEffect(()=>{
    const s=localStorage.getItem("ibero_session"); if(s) setSession(JSON.parse(s));
    loadAll().then(()=>setReady(true));
    const h=e=>{if(alertRef.current&&!alertRef.current.contains(e.target))setShowAl(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);

  const notify = (msg,type="success")=>{setNotif({msg,type});setTimeout(()=>setNotif(null),4500);};
  const getProg = ()=>(programas||[]).find(p=>p.id===selProg);
  const logout  = ()=>{localStorage.removeItem("ibero_session");setSession(null);setView("lista");};

  const generarLink = (progId,modId)=>{
    const token=btoa(JSON.stringify({progId,modId}));
    const url=window.location.href.split("?")[0]+"?lista="+token;
    navigator.clipboard.writeText(url).then(()=>{setLinkCop(progId+"_"+modId);setTimeout(()=>setLinkCop(""),3000);});
  };

  // ─── PROGRAMAS ──────────────────────────────────────
  const saveProg = async () => {
    if(!progForm.nombre){notify("Ingresa el nombre","error");return;}
    const tipo = progForm.tipo==="Otro"?(progForm.tipoCustom||"Otro"):progForm.tipo;
    const id = newId();
    await sb.upsert("programas",{id,nombre:progForm.nombre,tipo,color:progForm.color});
    await loadAll(); setShowProgM(false); notify("Programa agregado");
  };
  const delProg = async id=>{await sb.delete("programas","id=eq."+id);await loadAll();notify("Programa eliminado","warning");};

  // ─── MÓDULOS ────────────────────────────────────────
  const saveMod = async () => {
    if(!modForm.nombre||!modForm.fecha_inicio||!modForm.fecha_fin){notify("Completa nombre y fechas","error");return;}
    const payload={...modForm,programa_id:selProg,id:modForm.id||newId()};
    await sb.upsert("modulos",payload);
    await loadAll(); setShowModM(false); notify(editMod?"Módulo actualizado":"Módulo agregado");
  };
  const delMod = async id=>{await sb.delete("modulos","id=eq."+id);await loadAll();notify("Módulo eliminado","warning");};
  const openNewMod=()=>{setModForm({...eMod,id:newId()});setEditMod(null);setShowModM(true);};
  const openEditMod=m=>{setModForm({...m,fecha_inicio:m.fecha_inicio||"",fecha_fin:m.fecha_fin||""});setEditMod(m.id);setShowModM(true);};

  // ─── DOCENTES ───────────────────────────────────────
  const saveDoc = async () => {
    if(!docForm.nombre)return;
    await sb.upsert("docentes",{...docForm,id:docForm.id||newId()});
    await loadAll(); setShowDoc(false); notify(editDocId?"Docente actualizado":"Docente agregado");
  };
  const delDoc = async id=>{await sb.delete("docentes","id=eq."+id);await loadAll();notify("Docente eliminado","warning");};
  const openNewDoc=()=>{setDocForm({id:newId(),nombre:"",email:"",telefono:"",grado:"Licenciatura",programas_ids:[]});setEditDocId(null);setShowDoc(true);};
  const openEditDoc=d=>{setDocForm({...d,programas_ids:d.programas_ids||[]});setEditDocId(d.id);setShowDoc(true);};

  // ─── ESTUDIANTES ────────────────────────────────────
  const toggleAsist = async (progId,modId,estId)=>{
    const prog=(programas||[]).find(p=>p.id===progId);
    const est=(prog.estudiantes||[]).find(e=>e.id===estId);
    const mod=(prog.modulos||[]).find(m=>m.id===modId);
    if(!est||!mod)return;
    const k="mod_"+modId,cur=(est.asistencia||{})[k]||0,max=mod.clases||0;
    const newAsist={...(est.asistencia||{}),[k]:cur>=max?0:cur+1};
    await sb.patch("estudiantes","id=eq."+estId,{asistencia:newAsist});
    await loadAll();
  };

  const exportCSV = prog=>{
    const rows=(prog.estudiantes||[]).map(e=>{
      const base={Nombre:e.nombre||"",Correo:e.email||"",Teléfono:e.telefono||"",Empresa:e.empresa||"",Estatus:e.estatus||"activo"};
      (fieldMap||[]).forEach(fm=>{base[fm.label]=(e.campos_extra||{})[fm.label]||"";});
      (prog.modulos||[]).forEach(m=>{base["Asist."+m.numero]=((e.asistencia||{})["mod_"+m.id]||0)+"/"+m.clases;});
      return base;
    });
    if(!rows.length)return;
    const hdr=Object.keys(rows[0]),csv=[hdr.join(","),...rows.map(r=>hdr.map(h=>'"'+(r[h]||"").toString().replace(/"/g,'""')+'"').join(","))].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));a.download=prog.nombre.replace(/\s+/g,"_")+"_estudiantes.csv";a.click();notify("Exportado.");
  };

  const exportDocente = prog=>{
    const rows=(prog.estudiantes||[]).map(e=>({Nombre:e.nombre||"",Empresa:e.empresa||"",Puesto:(e.campos_extra||{})["Puesto"]||""}));
    if(!rows.length)return;
    const hdr=["Nombre","Empresa","Puesto"],csv=[hdr.join(","),...rows.map(r=>hdr.map(h=>'"'+(r[h]||"").replace(/"/g,'""')+'"').join(","))].join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));a.download="Lista_"+prog.nombre.replace(/\s+/g,"_")+".csv";a.click();notify("Lista para docente exportada.");
  };

  // ─── CONFIRMAR DOCENTE ──────────────────────────────
  const confirmar = async (progId,modId)=>{
    const p=(programas||[]).find(x=>x.id===progId),m=(p.modulos||[]).find(x=>x.id===modId);
    await sb.patch("modulos","id=eq."+modId,{estatus:"confirmado"});
    await loadAll();
    const dests=[];
    if(m.email_docente)dests.push({email:m.email_docente,nombre:m.docente});
    (responsables||[]).forEach(r=>{if(r.email)dests.push({email:r.email,nombre:r.nombre});});
    if(!notifCfg.notif_api_key||!notifCfg.notif_location_id){notify("Confirmado. Configura notificaciones en ⚙️.","warning");return;}
    if(!dests.length){notify("Confirmado. Agrega correos en ⚙️.","warning");return;}
    setSending(modId);
    try{
      const ai=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:400,messages:[{role:"user",content:"Correo formal confirmando al docente "+m.docente+" en el módulo '"+m.nombre+"' del "+p.nombre+", IBERO Tijuana. Fechas: "+fmtFecha(m.fecha_inicio)+" al "+fmtFecha(m.fecha_fin)+". Solo cuerpo, sin asunto ni firma."}]})});
      const ad=await ai.json();
      const body=(ad.content&&ad.content.find(c=>c.type==="text")&&ad.content.find(c=>c.type==="text").text)||"Confirmamos su participación.";
      const totalH=(m.clases||0)*(m.horas_por_clase||0);
      const html="<div style='font-family:Georgia,serif;max-width:620px;margin:0 auto'><div style='background:#C8102E;padding:24px 36px'><div style='color:#fff;font-size:32px;font-weight:900;letter-spacing:3px'>IBERO</div><div style='color:rgba(255,255,255,0.75);font-size:9px;letter-spacing:4px;font-family:system-ui'>TIJUANA</div></div><div style='padding:32px 36px;border:1px solid #e5e7eb;border-top:none'><h2 style='font-size:20px;color:#1a1a1a;margin:0 0 20px'>"+m.nombre+"</h2><table style='width:100%;border-collapse:collapse;font-size:14px;font-family:system-ui'><tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280;width:130px'>Programa</td><td style='font-weight:600'>"+p.nombre+"</td></tr><tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Docente</td><td style='font-weight:600'>"+m.docente+"</td></tr><tr style='border-bottom:1px solid #f3f4f6'><td style='padding:10px 0;color:#6b7280'>Período</td><td>"+fmtFecha(m.fecha_inicio)+" — "+fmtFecha(m.fecha_fin)+"</td></tr><tr><td style='padding:10px 0;color:#6b7280'>Horas</td><td>"+m.clases+" clases · "+m.horas_por_clase+"h c/u · <strong>"+totalH+"h total</strong></td></tr></table><div style='color:#374151;font-size:14px;line-height:1.8;border-top:2px solid #C8102E;padding-top:20px;font-family:system-ui'>"+body.replace(/\n/g,"<br/>")+"</div></div><div style='background:#f9f9f9;padding:20px 36px;border:1px solid #e5e7eb;border-top:none;font-family:system-ui;font-size:12px;color:#6b7280'><strong style='color:#1a1a1a'>Dirección de Educación Continua · IBERO Tijuana</strong><br/>Av. Centro Universitario #2501, Playas de Tijuana, C.P. 22500<br/>Tel: 664 630 1577 · WhatsApp: 664 764 1119</div></div>";
      let ok=0;
      for(const dest of dests){try{const res=await fetch("https://services.leadconnectorhq.com/conversations/messages/outbound",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+notifCfg.notif_api_key,"Version":"2021-04-15"},body:JSON.stringify({type:"Email",locationId:notifCfg.notif_location_id,toEmail:dest.email,subject:"Confirmación — "+m.nombre,html})});if(res.ok)ok++;}catch(e){}}
      notify(ok+"/"+dests.length+" notificaciones enviadas.");
    }catch(e){notify("Confirmado. Error al enviar.","warning");}
    setSending(null);
  };

  // ─── CONFIG ─────────────────────────────────────────
  const saveNotifCfg = async ()=>{await sb.upsert("configuracion",{id:"main",notif_api_key:notifCfg.notif_api_key,notif_location_id:notifCfg.notif_location_id,field_map:fieldMap});notify("Configuración guardada");};
  const saveFieldMap = async (fm)=>{setFieldMap(fm);await sb.upsert("configuracion",{id:"main",notif_api_key:notifCfg.notif_api_key,notif_location_id:notifCfg.notif_location_id,field_map:fm});};
  const addResp = async ()=>{if(!newResp.nombre||!newResp.email)return;await sb.post("responsables",{nombre:newResp.nombre,email:newResp.email});await loadAll();setNewResp({nombre:"",email:""});notify("Responsable agregado");};
  const delResp = async id=>{await sb.delete("responsables","id=eq."+id);await loadAll();};
  const addUser = async ()=>{if(!newUser.nombre||!newUser.email||!newUser.password){notify("Completa todos los campos","error");return;}await sb.post("usuarios",{...newUser,id:newId()});await loadAll();setNewUser({nombre:"",email:"",password:"",permisos:{...VIEWER_P}});notify("Usuario agregado");};
  const delUser = async id=>{await sb.delete("usuarios","id=eq."+id);await loadAll();};
  const updateUserPermisos = async (id,permisos)=>{await sb.patch("usuarios","id=eq."+id,{permisos});await loadAll();};

  // ─── RENDER ─────────────────────────────────────────
  const isPublic = typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("lista");
  if (!ready) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui",color:"#9ca3af",background:"#f2f2f2"}}><div style={{textAlign:"center"}}><IberoLogo h={60}/><div style={{marginTop:20,fontSize:14}}>Cargando sistema...</div></div></div>;
  if (isPublic) return <ListaDocente token={isPublic}/>;
  if (!session) return <LoginScreen onLogin={u=>setSession(u)}/>;

  const prog     = getProg();
  const alertas  = getAlertas(programas);
  const progsF   = (programas||[]).filter(p=>{const q=busqProg.toLowerCase();return(!busqProg||p.nombre.toLowerCase().includes(q))&&(!filtroProg||p.tipo===filtroProg)&&(!filtroSt||progStatus(p)===filtroSt);});
  const egresados= (programas||[]).flatMap(p=>(p.estudiantes||[]).filter(e=>e.estatus==="egresado").map(e=>({...e,programa:p.nombre})));
  const activos  = (programas||[]).flatMap(p=>(p.estudiantes||[]).filter(e=>e.estatus!=="egresado"&&e.estatus!=="baja"&&progStatus(p)==="activo"));
  const bajas    = (programas||[]).flatMap(p=>(p.estudiantes||[]).filter(e=>e.estatus==="baja"));
  const porConf  = (programas||[]).reduce((a,p)=>a+(p.modulos||[]).filter(m=>m.estatus==="propuesta"&&m.docente).length,0);

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
          {[["lista","Programas"],["calendario","Calendario"],["asistencia","Asistencia"],["docentes","Docentes"]].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?"rgba(255,255,255,0.2)":"transparent",color:"#fff",border:view===v?"1px solid rgba(255,255,255,0.35)":"1px solid transparent",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:500}}>{l}</button>
          ))}
          {can(session,"verReportes")&&<button onClick={()=>setView("reportes")} style={{background:view==="reportes"?"rgba(255,255,255,0.2)":"transparent",color:"#fff",border:view==="reportes"?"1px solid rgba(255,255,255,0.35)":"1px solid transparent",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:500}}>Reportes</button>}
          {(can(session,"gestionarUsuarios")||can(session,"configurarNotif"))&&<button onClick={()=>setView("config")} style={{background:view==="config"?"rgba(255,255,255,0.2)":"transparent",color:"#fff",border:view==="config"?"1px solid rgba(255,255,255,0.35)":"1px solid transparent",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:13,fontFamily:"system-ui",fontWeight:500}}>Configuración</button>}
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
                    <div key={i} style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6",display:"flex",gap:10}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:a.tipo==="sin_docente"?"#f59e0b":"#dc2626",marginTop:5,flexShrink:0}}/>
                      <div style={{fontFamily:"system-ui"}}>
                        {a.tipo==="sin_docente"&&<><div style={{fontWeight:600,fontSize:13}}>Módulo sin docente</div><div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.mod.nombre}<br/>{a.prog.nombre} · Inicia en {a.dias} días</div></>}
                        {a.tipo==="asistencia"&&<><div style={{fontWeight:600,fontSize:13,color:"#dc2626"}}>Asistencia baja: {a.pct}%</div><div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{a.est.nombre}<br/>{a.prog.nombre}</div></>}
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

        {/* DOCENTES */}
        {view==="docentes"&&(
          <div>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
              <div><h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Docentes</h1><p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>Catálogo de docentes de educación continua</p></div>
              <button onClick={openNewDoc} style={S.btn(RED,"#fff")}>Agregar docente</button>
            </div>
            {docentes.length>0&&<div style={{display:"flex",gap:10,marginBottom:20}}><input placeholder="Buscar por nombre, correo o teléfono..." value={busqDoc} onChange={e=>setBusqD(e.target.value)} style={{...S.inp,flex:1}}/>{busqDoc&&<button onClick={()=>setBusqD("")} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}</div>}
            {docentes.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:80,fontFamily:"system-ui"}}>Sin docentes registrados.</div>}
            <div style={{display:"grid",gap:14}}>
              {docentes.filter(d=>{const q=busqDoc.toLowerCase();return!busqDoc||(d.nombre&&d.nombre.toLowerCase().includes(q))||(d.email&&d.email.toLowerCase().includes(q))||(d.telefono&&d.telefono.includes(q));}).map(doc=>{
                const gc=GRADO_C[doc.grado]||GRADO_C.Licenciatura;
                const progAsig=(doc.programas_ids||[]).map(pid=>(programas||[]).find(p=>p.id===pid)).filter(Boolean);
                const histMods=[];(programas||[]).forEach(prog=>(prog.modulos||[]).forEach(m=>{if(m.docente_id===doc.id||m.docente===doc.nombre)histMods.push({prog,mod:m});}));
                const horas=histMods.reduce((a,{mod})=>a+(mod.clases||0)*(mod.horas_por_clase||0),0);
                return(
                  <div key={doc.id} style={{...S.card,borderLeft:"4px solid "+RED,padding:"18px 22px"}}>
                    <div style={{display:"flex",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                          <span style={{fontWeight:700,fontSize:16}}>{doc.nombre}</span>
                          <span style={{background:gc.bg,color:gc.color,borderRadius:4,padding:"2px 9px",fontSize:11,fontFamily:"system-ui",fontWeight:700}}>{doc.grado}</span>
                        </div>
                        <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{doc.email&&<span>{doc.email}</span>}{doc.telefono&&<span>{doc.telefono}</span>}</div>
                        {progAsig.length>0&&<div style={{marginTop:10}}><div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>PROGRAMAS ASIGNADOS</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{progAsig.map(pr=><span key={pr.id} style={{fontSize:11,background:"#fef2f2",borderRadius:4,padding:"2px 8px",color:RED,fontFamily:"system-ui",border:"1px solid #fca5a5",fontWeight:600}}>{pr.nombre}</span>)}</div></div>}
                        {histMods.length>0&&<div style={{marginTop:10}}><div style={{fontSize:11,fontWeight:700,color:"#9ca3af",fontFamily:"system-ui",letterSpacing:"0.5px",marginBottom:6}}>HISTORIAL · {horas}H IMPARTIDAS</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{histMods.map(({prog,mod},i)=><span key={i} style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>{prog.nombre+" · "+mod.numero}</span>)}</div></div>}
                      </div>
                      <div style={{display:"flex",gap:6}}><button onClick={()=>openEditDoc(doc)} style={S.btn("#f3f4f6","#374151",{padding:"6px 12px",fontSize:12})}>Editar</button><button onClick={()=>delDoc(doc.id)} style={S.btn("#fef2f2","#dc2626",{padding:"6px 12px",fontSize:12})}>Eliminar</button></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ASISTENCIA GLOBAL */}
        {view==="asistencia"&&(
          <div>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
              <div><h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Listas de Asistencia</h1><p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>Todos los módulos · genera enlace para que el docente tome lista</p></div>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
              <input placeholder="Buscar módulo, docente o programa..." value={busqAsis} onChange={e=>setBusqAs(e.target.value)} style={{...S.inp,flex:1,minWidth:220}}/>
              <select value={filtroAsis} onChange={e=>setFiltroAs(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                <option value="">Todos los programas</option>
                {(programas||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              {(busqAsis||filtroAsis)&&<button onClick={()=>{setBusqAs("");setFiltroAs("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
            </div>
            <div style={{display:"grid",gap:12}}>
              {(programas||[]).flatMap(prog=>(prog.modulos||[]).map(mod=>({prog,mod}))).filter(({prog,mod})=>{const q=busqAsis.toLowerCase();return(!busqAsis||prog.nombre.toLowerCase().includes(q)||mod.nombre.toLowerCase().includes(q)||(mod.docente&&mod.docente.toLowerCase().includes(q)))&&(!filtroAsis||prog.id===filtroAsis);}).map(({prog,mod})=>{
                const est=prog.estudiantes||[],kl=prog.id+"_"+mod.id;
                const total=est.reduce((a,e)=>a+((e.asistencia||{})["mod_"+mod.id]||0),0);
                const maxT=(mod.clases||0)*est.length,pctG=maxT?Math.round(total/maxT*100):null;
                const enR=est.filter(e=>{const a=(e.asistencia||{})["mod_"+mod.id]||0;return mod.clases&&Math.round(a/mod.clases*100)<80;}).length;
                return(
                  <div key={kl} style={{...S.card,borderLeft:"3px solid "+(mod.estatus==="confirmado"?"#16a34a":"#d97706"),padding:"16px 20px"}}>
                    <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                          <span style={{background:prog.color,color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:800,fontFamily:"system-ui"}}>{mod.numero}</span>
                          <span style={{fontWeight:700,fontSize:15}}>{mod.nombre}</span>
                        </div>
                        <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui",display:"flex",gap:12,flexWrap:"wrap"}}>
                          <span>{prog.nombre}</span>{mod.docente&&<span>{mod.docente}</span>}{mod.horario&&<span>{mod.horario}</span>}
                          <span>{est.length} estudiantes</span>
                          {pctG!==null&&<span style={{fontWeight:700,color:pctG>=80?"#16a34a":"#dc2626"}}>{pctG}% grupal</span>}
                          {enR>0&&<span style={{fontWeight:700,color:"#dc2626"}}>{enR} en riesgo</span>}
                        </div>
                      </div>
                      <button onClick={()=>generarLink(prog.id,mod.id)} style={{...S.btn(linkCop===kl?"#f0fdf4":"#f3f4f6",linkCop===kl?"#16a34a":"#374151",{border:"1px solid "+(linkCop===kl?"#bbf7d0":"#e5e7eb"),padding:"7px 14px",fontSize:12,flexShrink:0,whiteSpace:"nowrap"})}}>
                        {linkCop===kl?"Enlace copiado":"Copiar enlace para docente"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* LISTA DE PROGRAMAS */}
        {view==="lista"&&(
          <div>
            <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:20}}>
              <div><h1 style={{fontSize:24,fontWeight:700,margin:"0 0 4px",letterSpacing:"-0.5px"}}>Programas</h1><p style={{margin:0,color:"#6b7280",fontSize:13,fontFamily:"system-ui"}}>Gestión de diplomados y cursos de educación continua</p></div>
              {can(session,"editarProgramas")&&<button onClick={()=>{setProgForm({...eProg,id:newId()});setShowProgM(true);}} style={S.btn(RED,"#fff")}>Nuevo programa</button>}
            </div>
            <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
              <input placeholder="Buscar programa..." value={busqProg} onChange={e=>setBusqP(e.target.value)} style={{...S.inp,flex:1,minWidth:200}}/>
              <select value={filtroProg} onChange={e=>setFiltroP(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                <option value="">Todos los tipos</option>
                {TIPOS_PROG.filter(t=>t.valor!=="Otro").map(t=><option key={t.valor} value={t.valor}>{t.valor} · {t.desc}</option>)}
              </select>
              <select value={filtroSt} onChange={e=>setFiltroSt(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                <option value="">Todos los estatus</option>
                <option value="activo">Activo</option><option value="proximo">Próximo</option><option value="finalizado">Finalizado</option>
              </select>
              {(busqProg||filtroProg||filtroSt)&&<button onClick={()=>{setBusqP("");setFiltroP("");setFiltroSt("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
            </div>
            <div style={{display:"grid",gap:14}}>
              {progsF.map(p=>{
                const ms=p.modulos||[],es=p.estudiantes||[];
                const conf=ms.filter(m=>m.estatus==="confirmado").length,tot=ms.length;
                const inicio=ms.map(m=>m.fecha_inicio).filter(Boolean).sort()[0],fin=ms.map(m=>m.fecha_fin).filter(Boolean).sort().reverse()[0];
                const horas=ms.reduce((a,m)=>a+(m.clases||0)*(m.horas_por_clase||0),0),pct=tot?Math.round(conf/tot*100):0;
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
                        <span>{tot} módulos</span><span>{es.length} estudiantes</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:160,height:4,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:conf===tot&&tot>0?"#16a34a":RED,borderRadius:4}}/></div>
                        <span style={{fontSize:12,color:"#6b7280",fontFamily:"system-ui"}}>{conf}/{tot} docentes confirmados</span>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={()=>{setSelProg(p.id);setProgTab("modulos");setView("programa");}} style={S.btn(RED,"#fff")}>Ver</button>
                      {can(session,"editarProgramas")&&<button onClick={()=>delProg(p.id)} style={S.btn("#fef2f2","#dc2626",{padding:"8px 12px"})}>Eliminar</button>}
                    </div>
                  </div>
                );
              })}
              {progsF.length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:60,fontFamily:"system-ui"}}>{busqProg||filtroProg||filtroSt?"Sin resultados.":"Sin programas registrados."}</div>}
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
            <button onClick={()=>setView("lista")} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:13,marginBottom:20,padding:0,fontWeight:700,fontFamily:"system-ui"}}>← Volver</button>
            <div style={{...S.card,padding:"22px 26px",marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6,flexWrap:"wrap"}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:prog.color}}/>
                <h1 style={{fontSize:20,fontWeight:700,margin:0}}>{prog.nombre}</h1>
                <span style={{background:"#f3f4f6",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#6b7280",fontFamily:"system-ui",fontWeight:600}}>{prog.tipo.toUpperCase()}</span>
                <StatusBadge p={prog}/>
              </div>
              <div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>
                <span>{(prog.modulos||[]).length} módulos</span>
                <span>{(prog.modulos||[]).filter(m=>m.estatus==="confirmado").length} confirmados</span>
                <span>{(prog.modulos||[]).reduce((a,m)=>a+(m.clases||0)*(m.horas_por_clase||0),0)}h totales</span>
                <span>{(prog.estudiantes||[]).length} estudiantes</span>
              </div>
            </div>
            <div style={{display:"flex",marginBottom:20,...S.card,overflow:"hidden"}}>
              {[["modulos","Módulos",(prog.modulos||[]).length],["estudiantes","Estudiantes",(prog.estudiantes||[]).length],["asistencia","Asistencia",(prog.estudiantes||[]).length]].map(([t,l,cnt])=>(
                <button key={t} onClick={()=>setProgTab(t)} style={{flex:1,padding:"12px 16px",border:"none",borderBottom:progTab===t?"3px solid "+RED:"3px solid transparent",cursor:"pointer",fontWeight:700,fontSize:13,fontFamily:"system-ui",background:"#fff",color:progTab===t?RED:"#6b7280"}}>{l+" ("+cnt+")"}</button>
              ))}
            </div>

            {/* MÓDULOS */}
            {progTab==="modulos"&&(
              <div>
                {can(session,"editarModulos")&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}><button onClick={openNewMod} style={S.btn(RED,"#fff")}>Agregar módulo</button></div>}
                <div style={{display:"grid",gap:12}}>
                  {(prog.modulos||[]).map((m,i)=>{
                    const totalH=(m.clases||0)*(m.horas_por_clase||0),conf=m.estatus==="confirmado";
                    return(
                      <div key={m.id} style={{...S.card,borderLeft:"3px solid "+(conf?"#16a34a":"#d97706"),padding:"18px 22px"}}>
                        <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                          <div style={{background:prog.color,color:"#fff",borderRadius:5,padding:"3px 10px",fontSize:11,fontWeight:800,flexShrink:0,marginTop:2,fontFamily:"system-ui"}}>{m.numero||"M"+(i+1)}</div>
                          <div style={{flex:1,minWidth:200}}>
                            <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>{m.nombre}</div>
                            <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>
                              <span>{m.docente||"Sin asignar"}</span>
                              <span>{fmtFecha(m.fecha_inicio)} — {fmtFecha(m.fecha_fin)}</span>
                              {m.dias&&m.dias.length>0&&<span>{m.dias.join(", ")}</span>}
                              {m.horario&&<span>{m.horario}</span>}
                              <span>{m.clases+" clases · "+m.horas_por_clase+"h c/u · "}<strong style={{color:"#1a1a1a"}}>{totalH+"h"}</strong></span>
                            </div>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",flexShrink:0}}>
                            <span style={{fontSize:11,padding:"3px 10px",borderRadius:4,background:conf?"#f0fdf4":"#fffbeb",color:conf?"#16a34a":"#d97706",fontWeight:700,fontFamily:"system-ui",border:"1px solid "+(conf?"#bbf7d0":"#fde68a")}}>{conf?"Confirmado":"Propuesta"}</span>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                              {can(session,"confirmarDocentes")&&!conf&&m.docente&&<button onClick={()=>confirmar(prog.id,m.id)} disabled={sending===m.id} style={S.btn("#f0fdf4","#16a34a",{border:"1px solid #bbf7d0",padding:"5px 11px",fontSize:12})}>{sending===m.id?"Enviando...":"Confirmar"}</button>}
                              {can(session,"editarModulos")&&<button onClick={()=>openEditMod(m)} style={S.btn("#f3f4f6","#374151",{padding:"5px 11px",fontSize:12})}>Editar</button>}
                              {can(session,"editarModulos")&&<button onClick={()=>delMod(m.id)} style={S.btn("#fef2f2","#dc2626",{padding:"5px 11px",fontSize:12})}>Eliminar</button>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(prog.modulos||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Sin módulos registrados.</div>}
                </div>
              </div>
            )}

            {/* ESTUDIANTES */}
            {progTab==="estudiantes"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
                  <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{(prog.estudiantes||[]).length} estudiantes</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {can(session,"importarEstudiantes")&&<button onClick={()=>setShowImp(true)} style={S.btn(RED,"#fff")}>Importar / Sincronizar</button>}
                    {(prog.estudiantes||[]).length>0&&<><button onClick={()=>exportCSV(prog)} style={S.btn("#f3f4f6","#374151")}>Exportar CSV</button><button onClick={()=>exportDocente(prog)} style={S.btn("#f3f4f6","#374151")}>Lista para docente</button></>}
                  </div>
                </div>
                {(prog.estudiantes||[]).length>0&&(
                  <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                    <input placeholder="Buscar por nombre, empresa o correo..." value={busqEst} onChange={e=>setBusqE(e.target.value)} style={{...S.inp,flex:1,minWidth:180}}/>
                    <select value={filtroEst} onChange={e=>setFiltroE(e.target.value)} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:"system-ui",outline:"none",background:"#fff"}}>
                      <option value="">Todos</option><option value="activo">Activo</option><option value="egresado">Egresado</option><option value="baja">Baja</option>
                    </select>
                    {(busqEst||filtroEst)&&<button onClick={()=>{setBusqE("");setFiltroE("");}} style={S.btn("#f3f4f6","#374151")}>Limpiar</button>}
                  </div>
                )}
                <div style={{display:"grid",gap:10}}>
                  {(prog.estudiantes||[]).filter(e=>{const q=busqEst.toLowerCase();return(!busqEst||(e.nombre&&e.nombre.toLowerCase().includes(q))||(e.empresa&&e.empresa.toLowerCase().includes(q))||(e.email&&e.email.toLowerCase().includes(q)))&&(!filtroEst||(e.estatus||"activo")===filtroEst);}).map(e=>{
                    const pct=calcPct(e,prog.modulos||[]),riesgo=pct!==null&&pct<80;
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
                            {Object.keys(e.campos_extra||{}).length>0&&<div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>{Object.entries(e.campos_extra||{}).map(([k,v])=><span key={k} style={{fontSize:11,background:"#f3f4f6",borderRadius:4,padding:"2px 8px",color:"#374151",fontFamily:"system-ui"}}>{k+": "+v}</span>)}</div>}
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                            <select value={e.estatus||"activo"} onChange={async ev=>{await sb.patch("estudiantes","id=eq."+e.id,{estatus:ev.target.value});await loadAll();}} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"5px 8px",fontSize:12,fontFamily:"system-ui",outline:"none",cursor:"pointer"}}>
                              <option value="activo">Activo</option><option value="egresado">Egresado</option><option value="baja">Baja</option>
                            </select>
                            <button onClick={async()=>{await sb.delete("estudiantes","id=eq."+e.id);await loadAll();}} style={S.btn("#fef2f2","#dc2626",{padding:"5px 10px",fontSize:12})}>Quitar</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(prog.estudiantes||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Sin estudiantes. Importa desde tu CRM.</div>}
                </div>
              </div>
            )}

            {/* ASISTENCIA */}
            {progTab==="asistencia"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
                  <div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>Mínimo requerido: 80% de asistencia</div>
                  {(prog.estudiantes||[]).length>0&&<button onClick={()=>exportDocente(prog)} style={S.btn("#f3f4f6","#374151")}>Exportar lista para docente</button>}
                </div>
                {(prog.modulos||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Agrega módulos primero.</div>}
                {(prog.modulos||[]).length>0&&(prog.estudiantes||[]).length===0&&<div style={{textAlign:"center",color:"#9ca3af",padding:48,fontFamily:"system-ui"}}>Importa estudiantes primero.</div>}
                {(prog.modulos||[]).length>0&&(prog.estudiantes||[]).length>0&&(
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8}}>
                      <thead>
                        <tr style={{borderBottom:"2px solid #e5e7eb",background:"#f9f9f9"}}>
                          <th style={{textAlign:"left",padding:"12px 16px",fontWeight:700,color:"#374151",fontSize:12}}>Estudiante</th>
                          {(prog.modulos||[]).map(m=><th key={m.id} style={{padding:"10px 12px",fontWeight:700,color:"#374151",fontSize:11,textAlign:"center",whiteSpace:"nowrap",minWidth:90}}>{m.numero}<br/><span style={{fontWeight:400,color:"#9ca3af",fontSize:10}}>{m.clases+" cl."}</span></th>)}
                          <th style={{padding:"10px 12px",fontWeight:700,color:"#374151",fontSize:11,textAlign:"center"}}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(prog.estudiantes||[]).map(e=>{
                          const pct=calcPct(e,prog.modulos||[]),riesgo=pct!==null&&pct<80;
                          return(
                            <tr key={e.id} style={{borderBottom:"1px solid #f3f4f6",background:riesgo?"#fef9f9":"#fff"}}>
                              <td style={{padding:"12px 16px",fontWeight:600}}>
                                <div>{e.nombre}</div>
                                {e.empresa&&<div style={{fontSize:11,color:"#9ca3af",fontWeight:400}}>{e.empresa}</div>}
                              </td>
                              {(prog.modulos||[]).map(m=>{
                                const k="mod_"+m.id,asist=(e.asistencia||{})[k]||0,max=m.clases||0,pm=max?Math.round(asist/max*100):0;
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
          </div>
        )}

        {/* REPORTES */}
        {view==="reportes"&&can(session,"verReportes")&&(
          <div>
            <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 24px",letterSpacing:"-0.5px"}}>Reportes y estadísticas</h1>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:14,marginBottom:28}}>
              {[["Programas",(programas||[]).length],["Est. activos",activos.length],["Egresados",egresados.length],["Bajas",bajas.length],["Docentes",(docentes||[]).length],["Por confirmar",porConf]].map(([l,v])=>(
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
                {egresados.length===0?<div style={{color:"#9ca3af",padding:"20px 0",fontFamily:"system-ui",textAlign:"center"}}>Sin egresados.</div>:egresados.map((e,i)=><div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f3f4f6",display:"flex",gap:12,fontFamily:"system-ui",fontSize:13}}><div style={{flex:1}}><span style={{fontWeight:600}}>{e.nombre}</span>{e.empresa&&<span style={{color:"#9ca3af",marginLeft:8}}>{e.empresa}</span>}</div><div style={{color:"#6b7280"}}>{e.programa}</div></div>)}
              </div>}
            </div>
            <div style={{...S.card,padding:24}}>
              <div style={{fontWeight:700,fontSize:12,marginBottom:16,color:RED,fontFamily:"system-ui",letterSpacing:"0.5px"}}>DETALLE POR PROGRAMA</div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"system-ui",fontSize:13}}>
                  <thead><tr style={{borderBottom:"2px solid #e5e7eb"}}>{["Programa","Tipo","Estatus","Módulos","Confirmados","Estudiantes","Horas"].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                  <tbody>{(programas||[]).map(p=>{const ms=p.modulos||[],c=ms.filter(m=>m.estatus==="confirmado").length,t=ms.length,h=ms.reduce((a,m)=>a+(m.clases||0)*(m.horas_por_clase||0),0),ss=ST_STYLE[progStatus(p)];return(<tr key={p.id} style={{borderBottom:"1px solid #f3f4f6"}}><td style={{padding:"10px 12px",fontWeight:600}}>{p.nombre}</td><td style={{padding:"10px 12px",color:"#6b7280"}}>{p.tipo}</td><td style={{padding:"10px 12px"}}><span style={{background:ss.bg,color:ss.color,border:"1px solid "+ss.border,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700}}>{ss.label}</span></td><td style={{padding:"10px 12px"}}>{t}</td><td style={{padding:"10px 12px",color:"#16a34a",fontWeight:600}}>{c}</td><td style={{padding:"10px 12px",fontWeight:600}}>{(p.estudiantes||[]).length}</td><td style={{padding:"10px 12px",fontWeight:600}}>{h}h</td></tr>);})}</tbody>
                </table>
              </div>
            </div>
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
                {(users||[]).map((u)=>(
                  <div key={u.id} style={{marginBottom:12,padding:"14px 16px",background:"#f9f9f9",borderRadius:6}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                      <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,fontFamily:"system-ui"}}>{u.nombre}</div><div style={{fontSize:13,color:"#6b7280",fontFamily:"system-ui"}}>{u.email}</div></div>
                      {u.email!==session.email&&<button onClick={()=>delUser(u.id)} style={S.btn("#fef2f2","#dc2626",{padding:"5px 12px",fontSize:12})}>Eliminar</button>}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ALL_PERMISOS.map(p=>(
                        <label key={p.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,cursor:u.email===session.email?"default":"pointer",background:u.permisos&&u.permisos[p.key]?"#fef2f2":"#f3f4f6",padding:"3px 10px",borderRadius:4,border:"1px solid "+(u.permisos&&u.permisos[p.key]?"#fca5a5":"#e5e7eb"),color:u.permisos&&u.permisos[p.key]?"#1a1a1a":"#9ca3af",fontFamily:"system-ui"}}>
                          <input type="checkbox" checked={!!(u.permisos&&u.permisos[p.key])} disabled={u.email===session.email} onChange={async e=>{const np={...(u.permisos||{}),[p.key]:e.target.checked};await updateUserPermisos(u.id,np);}} style={{margin:0}}/>{p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{borderTop:"1px solid #e5e7eb",paddingTop:18,marginTop:8}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:12,fontFamily:"system-ui"}}>Agregar usuario</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>{[["Nombre","nombre"],["Correo","email"]].map(([l,k])=><div key={k}><label style={S.lbl}>{l}</label><input value={newUser[k]||""} onChange={e=>setNewUser({...newUser,[k]:e.target.value})} style={S.inp}/></div>)}</div>
                  <div style={{marginBottom:12}}><label style={S.lbl}>Contraseña</label><div style={{position:"relative"}}><input type={showUP?"text":"password"} value={newUser.password||""} onChange={e=>setNewUser({...newUser,password:e.target.value})} style={{...S.inp,paddingRight:72}}/><button onClick={()=>setShowUP(!showUP)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:12,fontFamily:"system-ui"}}>{showUP?"Ocultar":"Mostrar"}</button></div></div>
                  <div style={{marginBottom:14}}>
                    <label style={S.lbl}>Permisos</label>
                    <div style={{display:"flex",gap:8,marginBottom:8}}><button onClick={()=>setNewUser({...newUser,permisos:{...VIEWER_P}})} style={S.btn("#f3f4f6","#374151",{padding:"5px 12px",fontSize:12})}>Solo lectura</button><button onClick={()=>setNewUser({...newUser,permisos:{...ADMIN_P}})} style={S.btn("#fef2f2",RED,{padding:"5px 12px",fontSize:12})}>Administrador</button></div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{ALL_PERMISOS.map(p=><label key={p.key} style={{display:"flex",alignItems:"center",gap:5,fontSize:12,cursor:"pointer",background:newUser.permisos&&newUser.permisos[p.key]?"#fef2f2":"#f3f4f6",padding:"3px 10px",borderRadius:4,border:"1px solid "+(newUser.permisos&&newUser.permisos[p.key]?"#fca5a5":"#e5e7eb"),color:newUser.permisos&&newUser.permisos[p.key]?"#1a1a1a":"#9ca3af",fontFamily:"system-ui"}}><input type="checkbox" checked={!!(newUser.permisos&&newUser.permisos[p.key])} onChange={e=>setNewUser({...newUser,permisos:{...(newUser.permisos||{}),[p.key]:e.target.checked}})} style={{margin:0}}/>{p.label}</label>)}</div>
                  </div>
                  <button onClick={addUser} style={S.btn(RED,"#fff")}>Agregar usuario</button>
                </div>
              </div>
            )}
            {can(session,"configurarNotif")&&(<>
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>CONFIGURACIÓN DE NOTIFICACIONES Y CRM</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Credenciales para envío de correos e importación de estudiantes.</p>
                {[["API Key","notif_api_key"],["Account ID","notif_location_id"]].map(([l,k])=>(
                  <div key={k} style={{marginBottom:14}}><label style={S.lbl}>{l}</label><div style={{position:"relative"}}><input type={k==="notif_api_key"&&!showAK?"password":"text"} value={notifCfg[k]||""} onChange={e=>setNotifCfg({...notifCfg,[k]:e.target.value})} placeholder={k==="notif_api_key"?"••••••••":"ID de cuenta"} style={{...S.inp,paddingRight:k==="notif_api_key"?80:12}}/>{k==="notif_api_key"&&<button onClick={()=>setShowAK(!showAK)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:12,fontFamily:"system-ui"}}>{showAK?"Ocultar":"Mostrar"}</button>}</div></div>
                ))}
                <button onClick={saveNotifCfg} style={S.btn(RED,"#fff")}>Guardar</button>
              </div>
              <div style={{...S.card,padding:24,marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>CAMPOS PERSONALIZADOS A IMPORTAR</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Pega la Clave Única del campo en GHL y asígnale una etiqueta.</p>
                {(fieldMap||[]).map((f,i)=><div key={i} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,padding:"10px 14px",background:"#f9f9f9",borderRadius:6,fontFamily:"system-ui"}}><div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{f.label}</div><div style={{fontSize:12,color:"#9ca3af",fontFamily:"monospace"}}>{f.id}</div></div><button onClick={()=>saveFieldMap((fieldMap||[]).filter((_,j)=>j!==i))} style={S.btn("#fef2f2","#dc2626",{padding:"5px 10px",fontSize:12})}>Eliminar</button></div>)}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,marginTop:12,alignItems:"flex-end"}}>
                  <div><label style={S.lbl}>Clave única (merge tag)</label><input placeholder="contact.programa_de_intersz" value={newFM.id} onChange={e=>setNewFM({...newFM,id:e.target.value.replace(/\{|\}/g,"").trim()})} style={{...S.inp,fontFamily:"monospace",fontSize:12}}/></div>
                  <div><label style={S.lbl}>Etiqueta a mostrar</label><input placeholder="Programa de interés" value={newFM.label} onChange={e=>setNewFM({...newFM,label:e.target.value})} style={S.inp}/></div>
                  <button onClick={async()=>{if(!newFM.id||!newFM.label){notify("Completa clave y etiqueta","error");return;}const nfm=[...(fieldMap||[]),{...newFM}];await saveFieldMap(nfm);setNewFM({id:"",label:""});notify("Campo agregado");}} style={S.btn(RED,"#fff",{whiteSpace:"nowrap"})}>Agregar</button>
                </div>
              </div>
              <div style={{...S.card,padding:24}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:4,color:RED,fontFamily:"system-ui",letterSpacing:"1px"}}>RESPONSABLES</div>
                <p style={{fontSize:13,color:"#9ca3af",margin:"0 0 18px",fontFamily:"system-ui"}}>Reciben copia al confirmar un docente.</p>
                {(responsables||[]).map(r=><div key={r.id} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,padding:"10px 14px",background:"#f9f9f9",borderRadius:6,fontFamily:"system-ui"}}><div style={{flex:1}}><div style={{fontWeight:600,fontSize:14}}>{r.nombre}</div><div style={{fontSize:13,color:"#6b7280"}}>{r.email}</div></div><button onClick={()=>delResp(r.id)} style={S.btn("#fef2f2","#dc2626",{padding:"5px 12px",fontSize:12})}>Eliminar</button></div>)}
                <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
                  <input placeholder="Nombre" value={newResp.nombre} onChange={e=>setNewResp({...newResp,nombre:e.target.value})} style={{...S.inp,flex:1,minWidth:120}}/>
                  <input placeholder="Correo" value={newResp.email} onChange={e=>setNewResp({...newResp,email:e.target.value})} style={{...S.inp,flex:2,minWidth:160}}/>
                  <button onClick={addResp} style={S.btn(RED,"#fff",{whiteSpace:"nowrap"})}>Agregar</button>
                </div>
              </div>
            </>)}
          </div>
        )}
      </div>

      {/* MODAL IMPORTAR */}
      {showImport&&prog&&<ImportModal prog={prog} notifCfg={notifCfg} fieldMap={fieldMap} onImport={loadAll} onClose={()=>setShowImp(false)}/>}

      {/* MODAL MÓDULO */}
      {showModM&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:540,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{editMod?"Editar módulo":"Nuevo módulo"}</span>
              <button onClick={()=>setShowModM(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
            </div>
            <div style={{padding:"20px 24px"}}>
              {[["Número del módulo","numero","text","I, II, III..."],["Nombre del módulo","nombre","text",""],["Correo del docente","email_docente","email",""]].map(([l,k,t,ph])=>(
                <div key={k} style={{marginBottom:13}}><label style={S.lbl}>{l}</label><input type={t} placeholder={ph} value={modForm[k]||""} onChange={e=>setModForm({...modForm,[k]:e.target.value})} style={S.inp}/></div>
              ))}
              <div style={{marginBottom:13}}>
                <label style={S.lbl}>Docente</label>
                <select value={modForm.docente_id||"__manual__"} onChange={e=>{if(e.target.value==="__manual__"){setModForm({...modForm,docente_id:"",docente:""});}else{const d=(docentes||[]).find(d=>d.id===e.target.value);if(d)setModForm({...modForm,docente_id:d.id,docente:d.nombre,email_docente:d.email||modForm.email_docente});}}} style={S.inp}>
                  <option value="__manual__">Escribir manualmente...</option>
                  {(docentes||[]).map(d=><option key={d.id} value={d.id}>{d.nombre+" ("+d.grado+")"}</option>)}
                </select>
                {!modForm.docente_id&&<input placeholder="Nombre del docente" value={modForm.docente||""} onChange={e=>setModForm({...modForm,docente:e.target.value})} style={{...S.inp,marginTop:8}}/>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:13}}>
                {[["Clases","clases","1"],["Horas por clase","horas_por_clase","0.5"]].map(([l,k,step])=>(
                  <div key={k}><label style={S.lbl}>{l}</label><input type="number" min="0.5" step={step} value={modForm[k]||0} onChange={e=>setModForm({...modForm,[k]:parseFloat(e.target.value)||0})} style={S.inp}/></div>
                ))}
                <div><label style={S.lbl}>Total horas</label><div style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"9px 12px",fontSize:15,background:"#fef2f2",color:RED,fontWeight:800,fontFamily:"system-ui",textAlign:"center"}}>{((modForm.clases||0)*(modForm.horas_por_clase||0)).toFixed(1)+"h"}</div></div>
              </div>
              <div style={{marginBottom:13}}><label style={S.lbl}>Horario</label><input placeholder="09:00 – 12:00" value={modForm.horario||""} onChange={e=>setModForm({...modForm,horario:e.target.value})} style={S.inp}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:13}}>
                {[["Fecha inicio","fecha_inicio"],["Fecha fin","fecha_fin"]].map(([l,k])=>(
                  <div key={k}><label style={S.lbl}>{l}</label><input type="date" value={modForm[k]||""} onChange={e=>setModForm({...modForm,[k]:e.target.value})} style={S.inp}/></div>
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
                    if(tieneSab&&!tieneEntresemana) horario="09:00 – 13:00";
                    else if(tieneEntresemana&&!tieneSab) horario="18:00 – 22:00";
                    else if(nuevo.length===0) horario="";
                    setModForm({...modForm,dias:nuevo,horario});
                  }} style={{border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"system-ui",background:(modForm.dias||[]).includes(d)?RED:"#f3f4f6",color:(modForm.dias||[]).includes(d)?"#fff":"#6b7280"}}>{d}</button>)}
                </div>
              </div>
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

      {/* MODAL PROGRAMA */}
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
                  {TIPOS_PROG.map(t=><button key={t.valor} onClick={()=>setProgForm({...progForm,tipo:t.valor,tipoCustom:""})} style={{border:"2px solid "+(progForm.tipo===t.valor?RED:"#e5e7eb"),borderRadius:8,padding:"10px 12px",cursor:"pointer",fontFamily:"system-ui",background:progForm.tipo===t.valor?"#fef2f2":"#fff",textAlign:"left"}}><div style={{fontWeight:700,fontSize:13,color:progForm.tipo===t.valor?RED:"#1a1a1a"}}>{t.valor}</div><div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{t.desc}</div></button>)}
                </div>
                {progForm.tipo==="Otro"&&<input placeholder="Especifica el tipo..." value={progForm.tipoCustom||""} onChange={e=>setProgForm({...progForm,tipoCustom:e.target.value})} style={{...S.inp,marginTop:4}}/>}
              </div>
              <div style={{marginBottom:22}}>
                <label style={S.lbl}>Color identificador</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{COLORES.map(c=><button key={c} onClick={()=>setProgForm({...progForm,color:c})} style={{width:30,height:30,borderRadius:"50%",background:c,border:progForm.color===c?"3px solid #1a1a1a":"3px solid transparent",cursor:"pointer"}}/>)}</div>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowProgM(false)} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={saveProg} style={S.btn(RED,"#fff")}>Crear programa</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DOCENTE */}
      {showDoc&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{padding:"18px 24px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,fontSize:16,fontFamily:"Georgia,serif"}}>{editDocId?"Editar docente":"Nuevo docente"}</span>
              <button onClick={()=>setShowDoc(false)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#9ca3af"}}>×</button>
            </div>
            <div style={{padding:"20px 24px"}}>
              {[["Nombre completo","nombre","text"],["Correo electrónico","email","email"],["Teléfono","telefono","tel"]].map(([l,k,t])=>(
                <div key={k} style={{marginBottom:13}}><label style={S.lbl}>{l}</label><input type={t} value={docForm[k]||""} onChange={e=>setDocForm({...docForm,[k]:e.target.value})} style={S.inp}/></div>
              ))}
              <div style={{marginBottom:16}}>
                <label style={S.lbl}>Grado académico</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Licenciatura","Maestría","Doctorado"].map(g=>{const gc=GRADO_C[g];return(<button key={g} onClick={()=>setDocForm({...docForm,grado:g})} style={{border:"2px solid "+(docForm.grado===g?gc.color:"#e5e7eb"),borderRadius:6,padding:"7px 14px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"system-ui",background:docForm.grado===g?gc.bg:"#fff",color:docForm.grado===g?gc.color:"#9ca3af"}}>{g}</button>);})}
                </div>
              </div>
              <div style={{marginBottom:20}}>
                <label style={S.lbl}>Programas en los que participa</label>
                <div style={{display:"flex",flexDirection:"column",gap:6,background:"#f9f9f9",borderRadius:8,padding:12}}>
                  {(programas||[]).length===0&&<span style={{fontSize:13,color:"#9ca3af",fontFamily:"system-ui"}}>No hay programas registrados.</span>}
                  {(programas||[]).map(p=>{const sel=(docForm.programas_ids||[]).includes(p.id);return(
                    <label key={p.id} onClick={()=>setDocForm({...docForm,programas_ids:sel?(docForm.programas_ids||[]).filter(x=>x!==p.id):[...(docForm.programas_ids||[]),p.id]})} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"8px 10px",borderRadius:6,background:sel?"#fef2f2":"#fff",border:"1px solid "+(sel?"#fca5a5":"#e5e7eb")}}>
                      <div style={{width:16,height:16,border:"2px solid "+(sel?RED:"#d1d5db"),borderRadius:4,background:sel?RED:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{sel&&<span style={{color:"#fff",fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}</div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}><div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/><span style={{fontSize:13,fontFamily:"system-ui",fontWeight:sel?600:400,color:sel?"#1a1a1a":"#374151"}}>{p.nombre}</span><span style={{fontSize:11,color:"#9ca3af",fontFamily:"system-ui"}}>{p.tipo}</span></div>
                    </label>
                  );})}
                </div>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowDoc(false)} style={S.btn("#f3f4f6","#374151")}>Cancelar</button>
                <button onClick={saveDoc} style={S.btn(RED,"#fff")}>Guardar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
