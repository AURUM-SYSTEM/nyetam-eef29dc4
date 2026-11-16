const SERVICE_ICONS={"Payer une facture":"🧾","Faire la queue":"⏳","Démarche administrative":"🏛️","Courses":"🛍️","Retrait de colis":"📦","Autre":"✨"};
const state={services:[],neighborhoods:[],results:[],loading:false};
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=value=>Number(value||0).toLocaleString("fr-FR")+" FCFA";
function initials(name){return String(name||"DO").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()}
function setStatus(text,ok=false){const el=$("backendStatus");el.textContent=text;el.classList.toggle("connected",ok)}
function renderFilters(){
  $("serviceSelect").innerHTML='<option value="">Tous les services</option>'+state.services.map(s=>'<option value="'+esc(s.name)+'">'+esc(s.name)+'</option>').join("");
  $("districtSelect").innerHTML='<option value="">Tous les quartiers</option>'+state.neighborhoods.map(n=>'<option value="'+esc(n.name)+'">'+esc(n.name)+'</option>').join("");
}
function renderResults(rows){
  const root=$("results");
  if(!rows.length){root.innerHTML='<div class="empty"><div class="empty-icon">🔎</div><h3>Aucun prestataire disponible pour ces critères</h3><p>Essaie un autre service ou un autre quartier. Les profils apparaissent ici après vérification par DO Fast.</p></div>';return}
  const unique=new Map();
  rows.forEach(row=>{const item=unique.get(row.provider_id)||{...row,services:[],districts:[]};if(!item.services.some(s=>s.service_name===row.service_name))item.services.push({service_name:row.service_name,price_xaf:row.price_xaf});if(!item.districts.includes(row.neighborhood_name))item.districts.push(row.neighborhood_name);unique.set(row.provider_id,item)});
  const providers=[...unique.values()].sort((a,b)=>Number(b.rating||0)-Number(a.rating||0));
  $("resultCount").textContent=providers.length+" prestataire"+(providers.length>1?"s":"")+" trouvé"+(providers.length>1?"s":"");
  root.innerHTML=providers.map(p=>'<article class="directory-card"><div class="directory-top"><div class="directory-avatar">'+esc(initials(p.full_name))+'</div><div class="directory-info"><h3>'+esc(p.full_name||"Prestataire DO Fast")+'</h3><span class="badge">✓ Identité vérifiée</span></div><div class="directory-rating">⭐ '+Number(p.rating||0).toFixed(1)+'</div></div><p class="directory-bio">'+esc(p.bio||"Prestataire disponible sur DO Fast.")+'</p><div class="directory-meta"><span>📍 '+esc(p.districts.join(", "))+'</span><span>✓ '+Number(p.completed_missions||0)+' mission(s) terminée(s)</span></div><div class="directory-services">'+p.services.map(s=>'<span class="service-price">'+esc(s.service_name)+' · <b>'+(Number(s.price_xaf)>0?money(s.price_xaf):"Tarif à discuter")+'</b></span>').join("")+'</div><button class="btn secondary full" onclick="showProfile(\''+esc(p.provider_id)+'\')">Consulter le profil</button></article>').join("");
  window.directoryProviders=providers;
}
function showProfile(id){
 const p=(window.directoryProviders||[]).find(x=>x.provider_id===id);if(!p)return;
 $("profileModalContent").innerHTML='<div class="eyebrow">Prestataire vérifié</div><h2>'+esc(p.full_name)+'</h2><p class="sub">⭐ '+Number(p.rating||0).toFixed(1)+' · '+Number(p.completed_missions||0)+' mission(s) terminée(s)</p><p>'+esc(p.bio||"Aucune présentation renseignée.")+'</p><h3>Services proposés</h3>'+p.services.map(s=>'<div class="summary-line"><span>'+esc(s.service_name)+'</span><strong>'+money(s.price_xaf)+'</strong></div>').join("")+'<h3>Quartiers couverts</h3><p class="sub">'+esc(p.districts.join(", "))+'</p><button class="btn full" onclick="closeProfile()">Fermer</button>';
 $("profileModal").classList.add("show");
}
function closeProfile(){$("profileModal").classList.remove("show")}
async function searchProviders(){
 const client=window.doFastSupabase;if(!client){setStatus("Base indisponible");return}
 const root=$("results");root.innerHTML='<div class="loading">Recherche des prestataires…</div>';$("resultCount").textContent="";
 let query=client.from("public_provider_directory").select("provider_id,full_name,avatar_path,bio,rating,completed_missions,service_id,service_name,price_xaf,neighborhood_id,neighborhood_name");
 const service=$("serviceSelect").value,district=$("districtSelect").value,term=$("nameSearch").value.trim();
 if(service)query=query.eq("service_name",service);
 if(district)query=query.eq("neighborhood_name",district);
 query=query.order("rating",{ascending:false}).limit(150);
 const {data,error}=await query;
 if(error){console.error(error);root.innerHTML='<div class="notice">Impossible de charger les prestataires pour le moment. Réessaie dans quelques instants.</div>';return}
 let rows=data||[];
 if(term)rows=rows.filter(x=>(x.full_name||"").toLocaleLowerCase("fr").includes(term.toLocaleLowerCase("fr")));
 state.results=rows;renderResults(rows);
}
async function init(){
 const client=window.doFastSupabase;
 if(!client){setStatus("Base indisponible");$("results").innerHTML='<div class="notice">La connexion au répertoire n’est pas disponible.</div>';return}
 try{
  const [services,areas]=await Promise.all([
   client.from("service_categories").select("id,name,sort_order").eq("active",true).order("sort_order"),
   client.from("neighborhoods").select("id,name,sort_order").eq("active",true).order("sort_order")
  ]);
  if(services.error)throw services.error;if(areas.error)throw areas.error;
  state.services=services.data||[];state.neighborhoods=areas.data||[];
  renderFilters();setStatus("Répertoire connecté",true);await searchProviders();
 }catch(error){console.error(error);setStatus("Erreur de connexion");$("results").innerHTML='<div class="notice">Le répertoire DO Fast ne peut pas être chargé actuellement.</div>'}
}
$("searchButton").addEventListener("click",searchProviders);
$("serviceSelect").addEventListener("change",searchProviders);
$("districtSelect").addEventListener("change",searchProviders);
$("nameSearch").addEventListener("input",()=>{clearTimeout(window.searchTimer);window.searchTimer=setTimeout(searchProviders,250)});
$("profileModal").addEventListener("click",e=>{if(e.target===$("profileModal"))closeProfile()});
init();
