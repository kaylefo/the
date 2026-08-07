(function(){
"use strict";

var EXPANSION=Array.isArray(window.NO_ALIBI_EXPANSION)?window.NO_ALIBI_EXPANSION:[];
var BASE_URL="../no-alibi-rebuilt/index.html?deck-source=bb6df28";
var BASE_CACHE_KEY="no-alibi-original-1000-bb6df28";
var STORE_KEY="no-alibi-3000-literal-state-v1";
var LEVELS={1:"WARM-UP",2:"NOSY",3:"MESSY",4:"BRUTAL",5:"NUCLEAR"};
var WEIGHTS={full:[20,25,25,20,10],light:[40,30,18,9,3],savage:[5,10,20,30,35]};
var byId=function(id){return document.getElementById(id);};
var all=function(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));};

var baseDeck=[];
var imported=[];
var deck=[];
var seen={};
var history=[];
var state={mode:"mixed",mix:"full",maxPenalty:5,unit:"PENALTY",vibrate:true,current:null,round:0,done:0,passed:0,busy:false};
var toastTimer=0;
var baseLoading=false;

function normalizeText(text){return String(text||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function safeUnit(value){return String(value||"PENALTY").replace(/[^a-z0-9 -]/gi,"").trim().slice(0,14).toUpperCase()||"PENALTY";}
function pluralUnit(n){
  var u=safeUnit(state.unit);
  if(n===1)return u;
  if(/[^aeiou]Y$/.test(u))return u.slice(0,-1)+"IES";
  if(/S$/.test(u))return u;
  return u+"S";
}
function random(){
  if(window.crypto&&window.crypto.getRandomValues){
    var a=new Uint32Array(1);window.crypto.getRandomValues(a);return a[0]/4294967296;
  }
  return Math.random();
}
function validateSet(source,expected,label,perBucket){
  if(!Array.isArray(source)||source.length!==expected)throw new Error(label+" count "+(source&&source.length||0)+"/"+expected);
  var ids={},texts={},dist={},i,c,key;
  for(i=0;i<source.length;i++){
    c=source[i];
    if(!c||!c.id||(c.type!=="truth"&&c.type!=="dare")||c.intensity<1||c.intensity>5||!c.text)throw new Error(label+" malformed card at "+i);
    if(ids[c.id])throw new Error(label+" duplicate id "+c.id);
    key=normalizeText(c.text);
    if(texts[key])throw new Error(label+" duplicate wording "+c.id);
    ids[c.id]=1;texts[key]=1;
    key=c.type+"-"+c.intensity;dist[key]=(dist[key]||0)+1;
  }
  if(perBucket){
    for(i=1;i<=5;i++){
      if(dist["truth-"+i]!==perBucket||dist["dare-"+i]!==perBucket)throw new Error(label+" distribution error at level "+i);
    }
  }
  return {ids:ids,texts:texts,dist:dist};
}
function normalizeBaseCard(raw,index){
  return {
    id:String(raw.id||("base-"+index)),
    type:raw.type==="dare"?"dare":"truth",
    intensity:Math.max(1,Math.min(5,parseInt(raw.intensity,10)||3)),
    penalty:Math.max(1,Math.min(5,parseInt(raw.penalty,10)||parseInt(raw.intensity,10)||3)),
    tag:String(raw.tag||"ORIGINAL").slice(0,28).toUpperCase(),
    text:String(raw.text||raw.prompt||"").trim()
  };
}
function validateBase(source){
  validateSet(source,1000,"Original deck",100);
  return source;
}
function extractBaseFromHtml(html){
  var token="var BUILT_IN=";
  var start=html.indexOf(token);
  if(start<0)throw new Error("Original deck marker not found");
  start+=token.length;
  var rest=html.slice(start);
  var match=rest.match(/\];\s*var LEVELS=/);
  if(!match)throw new Error("Original deck ending not found");
  var jsonText=rest.slice(0,match.index+1);
  var parsed=JSON.parse(jsonText);
  return validateBase(parsed.map(normalizeBaseCard));
}
function readCachedBase(){
  try{
    var raw=localStorage.getItem(BASE_CACHE_KEY);
    if(!raw)return [];
    return validateBase(JSON.parse(raw).map(normalizeBaseCard));
  }catch(e){
    try{localStorage.removeItem(BASE_CACHE_KEY);}catch(ignore){}
    return [];
  }
}
function writeCachedBase(source){
  try{localStorage.setItem(BASE_CACHE_KEY,JSON.stringify(source));}catch(e){}
}
function setStatus(text,kind){
  var el=byId("status");
  el.textContent=text;
  el.className="status "+(kind||"");
}
function updateDeckMeta(){
  var meta=byId("deckMeta");
  if(meta)meta.textContent=deck.length.toLocaleString()+" CARDS ACTIVE · "+baseDeck.length.toLocaleString()+" ORIGINAL · "+EXPANSION.length.toLocaleString()+" NEW · "+imported.length.toLocaleString()+" IMPORTED";
}
function rebuildDeck(){
  deck=EXPANSION.concat(baseDeck,imported);
  updateDeckMeta();
}
function loadOriginal(force){
  if(baseLoading)return;
  if(baseDeck.length===1000&&!force){setStatus("3,000 LITERAL CARDS READY","ok");return;}
  baseLoading=true;
  setStatus(EXPANSION.length.toLocaleString()+" NEW CARDS READY · LOADING ORIGINAL 1,000…","loading");
  fetch(BASE_URL+(force?"&reload="+Date.now():""),{cache:force?"reload":"force-cache"})
    .then(function(response){if(!response.ok)throw new Error("HTTP "+response.status);return response.text();})
    .then(function(html){
      var parsed=extractBaseFromHtml(html);
      baseDeck=parsed;
      writeCachedBase(baseDeck);
      rebuildDeck();
      setStatus("3,000 LITERAL CARDS READY · NO TEMPLATE ENGINE","ok");
      toast("ORIGINAL 1,000 ADDED");
    })
    .catch(function(error){
      setStatus(EXPANSION.length.toLocaleString()+" NEW CARDS READY · ORIGINAL 1,000 COULD NOT LOAD","bad");
      console.error("Original deck load failed",error);
    })
    .then(function(){baseLoading=false;});
}
function readStore(){
  try{return JSON.parse(localStorage.getItem(STORE_KEY)||"{}")||{};}catch(e){return {};}
}
function persist(){
  try{
    localStorage.setItem(STORE_KEY,JSON.stringify({
      mode:state.mode,mix:state.mix,maxPenalty:state.maxPenalty,unit:state.unit,vibrate:state.vibrate,
      seen:seen,imported:imported
    }));
  }catch(e){}
}
function loadState(){
  var saved=readStore();
  state.mode=saved.mode||state.mode;
  state.mix=saved.mix||state.mix;
  state.maxPenalty=parseInt(saved.maxPenalty,10)||state.maxPenalty;
  state.unit=safeUnit(saved.unit||state.unit);
  state.vibrate=saved.vibrate!==false;
  seen=saved.seen&&typeof saved.seen==="object"?saved.seen:{};
  imported=Array.isArray(saved.imported)?saved.imported.map(normalizeImported).filter(Boolean):[];
}
function normalizeImported(raw,index){
  if(!raw||typeof raw!=="object")return null;
  var type=String(raw.type||"").toLowerCase();
  var text=String(raw.text||raw.prompt||"").trim();
  var level=parseInt(raw.intensity,10);
  if((type!=="truth"&&type!=="dare")||text.length<8||level<1||level>5)return null;
  return {
    id:String(raw.id||("custom-"+Date.now()+"-"+(index||0))),
    type:type,intensity:level,
    penalty:Math.max(1,Math.min(5,parseInt(raw.penalty,10)||level)),
    tag:String(raw.tag||"CUSTOM").slice(0,28).toUpperCase(),
    text:text.slice(0,700)
  };
}
function rollLevel(){
  var weights=WEIGHTS[state.mix]||WEIGHTS.full;
  var total=weights.reduce(function(a,b){return a+b;},0);
  var r=random()*total,i;
  for(i=0;i<weights.length;i++){r-=weights[i];if(r<0)return i+1;}
  return 3;
}
function poolFor(type,level){
  var pool=deck.filter(function(c){return c.type===type&&c.intensity===level;});
  if(!pool.length)pool=deck.filter(function(c){return c.type===type;});
  return pool;
}
function chooseCard(type,level){
  var pool=poolFor(type,level);
  var available=pool.filter(function(c){return !seen[c.id];});
  if(!available.length){
    pool.forEach(function(c){delete seen[c.id];});
    available=pool;
  }
  return available[Math.floor(random()*available.length)]||deck[0];
}
function render(card){
  state.current=card;
  state.round+=1;
  var cardEl=byId("card");
  cardEl.className="card "+card.type;
  byId("kind").textContent=card.type.toUpperCase();
  byId("tag").textContent=card.tag||"CHAOS";
  byId("round").textContent="ROUND "+String(state.round).padStart(2,"0");
  var prompt=byId("prompt");
  prompt.textContent=card.text;
  prompt.className="prompt"+(card.text.length>135?" small":"");
  byId("levelName").textContent=LEVELS[card.intensity]||"CHAOS";
  var dots=byId("dots").children,i;
  for(i=0;i<dots.length;i++)dots[i].className=i<card.intensity?"on":"";
  var penalty=Math.max(1,Math.min(state.maxPenalty,parseInt(card.penalty,10)||card.intensity));
  byId("penalty").textContent=penalty+" "+pluralUnit(penalty);
  if(state.vibrate&&navigator.vibrate)navigator.vibrate(card.intensity===5?[16,25,20]:8+card.intensity*3);
}
function draw(animated){
  if(state.busy||!deck.length)return;
  state.busy=true;
  var type=state.mode==="mixed"?(random()<.5?"truth":"dare"):state.mode;
  var level=rollLevel();
  var card=chooseCard(type,level);
  seen[card.id]=1;
  var cardEl=byId("card");
  function reveal(){
    render(card);persist();cardEl.classList.remove("out");state.busy=false;
  }
  if(animated){
    cardEl.classList.add("out");
    window.setTimeout(reveal,150);
  }else reveal();
}
function record(result){
  if(!state.current||state.busy)return;
  history.unshift({result:result,type:state.current.type,intensity:state.current.intensity,text:state.current.text});
  history=history.slice(0,100);
  if(result==="done")state.done+=1;else state.passed+=1;
  byId("played").textContent=String(state.done+state.passed);
  byId("completed").textContent=String(state.done);
  byId("passed").textContent=String(state.passed);
  draw(true);
}
function syncModes(){
  all("[data-mode]").forEach(function(button){button.classList.toggle("on",button.getAttribute("data-mode")===state.mode);});
}
function setMode(mode){
  state.mode=mode;syncModes();persist();draw(true);
}
function openOverlay(id){byId(id).classList.add("on");}
function closeOverlay(id){byId(id).classList.remove("on");}
function toast(text){
  var el=byId("toast");window.clearTimeout(toastTimer);
  el.textContent=text;el.className="toast on";
  toastTimer=window.setTimeout(function(){el.className="toast";},2100);
}
function syncSettings(){
  byId("mix").value=state.mix;
  byId("maxPenalty").value=String(state.maxPenalty);
  byId("unit").value=state.unit;
  byId("vibrate").value=state.vibrate?"yes":"no";
  updateDeckMeta();
}
function saveSettings(){
  state.mix=byId("mix").value;
  state.maxPenalty=parseInt(byId("maxPenalty").value,10)||5;
  state.unit=safeUnit(byId("unit").value);
  state.vibrate=byId("vibrate").value==="yes";
  persist();closeOverlay("settingsOverlay");
  if(state.current){
    var penalty=Math.max(1,Math.min(state.maxPenalty,parseInt(state.current.penalty,10)||state.current.intensity));
    byId("penalty").textContent=penalty+" "+pluralUnit(penalty);
  }
  toast("SETTINGS SAVED");
}
function renderHistory(){
  var list=byId("historyList"),i,li,b,p;
  list.innerHTML="";
  byId("historySummary").textContent=history.length?history.length+" recorded rounds · "+state.done+" completed · "+state.passed+" penalties":"No rounds yet.";
  for(i=0;i<history.length;i++){
    li=document.createElement("li");b=document.createElement("b");p=document.createElement("p");
    b.textContent=(history[i].result==="done"?"DONE":"PENALTY")+" · "+history[i].type.toUpperCase()+" · "+history[i].intensity+"/5";
    p.textContent=history[i].text;li.appendChild(b);li.appendChild(p);list.appendChild(li);
  }
}
function importFile(file){
  var reader=new FileReader();
  reader.onload=function(){
    try{
      var data=JSON.parse(reader.result);
      var source=Array.isArray(data)?data:data.cards;
      if(!Array.isArray(source))throw new Error("No cards array");
      var existing={};deck.forEach(function(c){existing[c.id]=1;});
      var added=[];
      source.forEach(function(raw,index){
        var c=normalizeImported(raw,index);
        if(c&&!existing[c.id]){existing[c.id]=1;added.push(c);}
      });
      if(!added.length)throw new Error("No valid new cards");
      imported=imported.concat(added);rebuildDeck();persist();
      toast("ADDED "+added.length+" CARDS");
    }catch(e){toast("INVALID CARD PACK");}
  };
  reader.readAsText(file);
}
function bind(){
  all("[data-mode]").forEach(function(button){button.addEventListener("click",function(){setMode(button.getAttribute("data-mode"));});});
  byId("doneButton").addEventListener("click",function(){record("done");});
  byId("passButton").addEventListener("click",function(){record("passed");});
  byId("nextButton").addEventListener("click",function(){draw(true);});
  byId("settingsButton").addEventListener("click",function(){syncSettings();openOverlay("settingsOverlay");});
  byId("historyButton").addEventListener("click",function(){renderHistory();openOverlay("historyOverlay");});
  byId("saveSettingsButton").addEventListener("click",saveSettings);
  byId("closeHistoryButton").addEventListener("click",function(){closeOverlay("historyOverlay");});
  byId("settingsOverlay").addEventListener("click",function(e){if(e.target===this)closeOverlay("settingsOverlay");});
  byId("historyOverlay").addEventListener("click",function(e){if(e.target===this)closeOverlay("historyOverlay");});
  byId("clearHistoryButton").addEventListener("click",function(){
    history=[];state.done=0;state.passed=0;
    byId("played").textContent="0";byId("completed").textContent="0";byId("passed").textContent="0";
    renderHistory();toast("SESSION CLEARED");
  });
  byId("reshuffleButton").addEventListener("click",function(){seen={};persist();draw(true);toast("DECK RESHUFFLED");});
  byId("clearImportedButton").addEventListener("click",function(){imported=[];rebuildDeck();persist();toast("IMPORTED CARDS REMOVED");});
  byId("retryBaseButton").addEventListener("click",function(){loadOriginal(true);});
  byId("fileInput").addEventListener("change",function(e){
    var file=e.target.files&&e.target.files[0];if(file)importFile(file);e.target.value="";
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="ArrowRight"){draw(true);}
    if(e.key.toLowerCase()==="t")setMode("truth");
    if(e.key.toLowerCase()==="d")setMode("dare");
    if(e.key.toLowerCase()==="m")setMode("mixed");
  });
}
function selfTest(){
  var buttons=["doneButton","passButton","nextButton","settingsButton","historyButton","saveSettingsButton","retryBaseButton"];
  var buttonState={};buttons.forEach(function(id){buttonState[id]=!!byId(id);});
  var expansionValidation=validateSet(EXPANSION,2000,"Expansion",200);
  return {
    ok:EXPANSION.length===2000&&buttonState.doneButton&&buttonState.passButton&&buttonState.nextButton,
    expansion:EXPANSION.length,base:baseDeck.length,total:deck.length,
    uniqueExpansionTexts:Object.keys(expansionValidation.texts).length,
    buttons:buttonState,current:state.current?state.current.id:null
  };
}
window.NO_ALIBI_SELF_TEST=selfTest;
window.NO_ALIBI_LOAD_ORIGINAL=loadOriginal;
window.addEventListener("error",function(e){setStatus("ERROR · "+(e.message||"JAVASCRIPT FAILED"),"bad");});

try{
  validateSet(EXPANSION,2000,"Expansion",200);
  baseDeck=readCachedBase();
  loadState();
  rebuildDeck();
  bind();
  syncModes();
  syncSettings();
  draw(false);
  if(baseDeck.length===1000){
    setStatus("3,000 LITERAL CARDS READY · NO TEMPLATE ENGINE","ok");
  }else{
    loadOriginal(false);
  }
  window.NO_ALIBI_READY=true;
}catch(error){
  console.error(error);
  setStatus("ERROR · "+(error.message||String(error)),"bad");
}
}());
