(function () {
  "use strict";
  var LEVELS = {1:"WARM-UP",2:"NOSY",3:"MESSY",4:"BRUTAL",5:"NUCLEAR"};
  var WEIGHTS = {full:[20,25,25,20,10],light:[42,30,17,8,3],savage:[5,10,20,30,35]};
  var STORAGE = "no-alibi-3000-v1";
  var cards = Array.isArray(window.NO_ALIBI_CARDS) ? window.NO_ALIBI_CARDS.slice() : [];
  var imported = [];
  var seen = {};
  var history = [];
  var state = {mode:"mixed",mix:"full",maxPenalty:5,unit:"SIP",vibrate:true,round:0,done:0,passed:0,current:null,busy:false};
  function byId(id){return document.getElementById(id);}
  function all(selector){return document.querySelectorAll(selector);}
  function random(){return Math.random();}
  function load(){
    try{
      var saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if(saved){
        if(saved.settings){state.mode=saved.settings.mode||state.mode;state.mix=saved.settings.mix||state.mix;state.maxPenalty=Number(saved.settings.maxPenalty)||5;state.unit=safeUnit(saved.settings.unit);state.vibrate=saved.settings.vibrate!==false;}
        if(Array.isArray(saved.imported)) imported=saved.imported;
      }
    }catch(e){}
  }
  function persist(){
    try{localStorage.setItem(STORAGE,JSON.stringify({settings:{mode:state.mode,mix:state.mix,maxPenalty:state.maxPenalty,unit:state.unit,vibrate:state.vibrate},imported:imported}));}catch(e){}
  }
  function safeUnit(value){value=String(value||"SIP").replace(/[^a-z0-9 -]/gi,"").trim().slice(0,12).toUpperCase();return value||"SIP";}
  function pluralUnit(n){var u=safeUnit(state.unit);if(n===1)return u;return /S$/.test(u)?u:u+"S";}
  function rollLevel(){var w=WEIGHTS[state.mix]||WEIGHTS.full,total=0,i,r;for(i=0;i<w.length;i++)total+=w[i];r=random()*total;for(i=0;i<w.length;i++){r-=w[i];if(r<0)return i+1;}return 3;}
  function availableCards(type,level){
    var source=cards.concat(imported),pool=[],fresh=[],i,c;
    for(i=0;i<source.length;i++){c=source[i];if(c.type===type&&Number(c.intensity)===level)pool.push(c);}
    for(i=0;i<pool.length;i++)if(!seen[pool[i].id])fresh.push(pool[i]);
    if(!fresh.length){for(i=0;i<pool.length;i++)delete seen[pool[i].id];fresh=pool.slice();}
    return fresh;
  }
  function selectCard(){
    var type=state.mode==="mixed"?(random()<0.5?"truth":"dare"):state.mode;
    var level=rollLevel(),pool=availableCards(type,level);
    if(!pool.length){level=3;pool=availableCards(type,level);}
    if(!pool.length)throw new Error("No cards available for "+type+".");
    var card=pool[Math.floor(random()*pool.length)];seen[card.id]=true;return card;
  }
  function render(card){
    state.current=card;state.round++;
    var panel=byId("card"),prompt=byId("prompt"),dots=byId("dots").children,i;
    panel.className="card "+card.type;
    byId("kind").textContent=card.type.toUpperCase();byId("tag").textContent=String(card.tag||card.category||"CHAOS").toUpperCase();byId("round").textContent="ROUND "+("0"+state.round).slice(-2);
    prompt.textContent=card.text;prompt.className=card.text.length>145?"prompt small":"prompt";
    byId("levelName").textContent=LEVELS[card.intensity]||"CHAOS";
    for(i=0;i<dots.length;i++)dots[i].className=i<card.intensity?"on":"";
    var penalty=Math.max(1,Math.min(state.maxPenalty,Number(card.penalty)||Number(card.intensity)||1));
    byId("penalty").textContent=penalty+" "+pluralUnit(penalty);
    byId("status").className="status";byId("status").textContent="3,000 BUILT-IN CARDS READY · "+imported.length+" IMPORTED";
    if(state.vibrate&&navigator.vibrate)navigator.vibrate(card.intensity===5?[18,25,22]:8+card.intensity*2);
  }
  function draw(animated){
    if(state.busy)return;state.busy=true;var panel=byId("card");
    function finish(){try{render(selectCard());}catch(e){showError(e.message||String(e));}panel.classList.remove("out");state.busy=false;}
    if(animated){panel.classList.add("out");setTimeout(finish,145);}else finish();
  }
  function record(result){
    if(!state.current||state.busy)return;
    history.unshift({result:result,type:state.current.type,intensity:state.current.intensity,text:state.current.text});if(history.length>60)history.length=60;
    if(result==="done")state.done++;else state.passed++;
    byId("played").textContent=String(state.done+state.passed);byId("completed").textContent=String(state.done);byId("passed").textContent=String(state.passed);draw(true);
  }
  function showError(message){byId("status").className="status bad";byId("status").textContent="ERROR · "+message;}
  function toast(message){var t=byId("toast");t.textContent=message;t.className="toast on";clearTimeout(t._timer);t._timer=setTimeout(function(){t.className="toast";},1900);}
  function openOverlay(id){byId(id).classList.add("on");}
  function closeOverlay(id){byId(id).classList.remove("on");}
  function syncModes(){var buttons=all("[data-mode]"),i;for(i=0;i<buttons.length;i++)buttons[i].classList.toggle("on",buttons[i].getAttribute("data-mode")===state.mode);}
  function syncSettings(){byId("mix").value=state.mix;byId("maxPenalty").value=String(state.maxPenalty);byId("unit").value=state.unit;byId("vibrate").value=state.vibrate?"yes":"no";}
  function saveSettings(){state.mix=byId("mix").value;state.maxPenalty=parseInt(byId("maxPenalty").value,10)||5;state.unit=safeUnit(byId("unit").value);state.vibrate=byId("vibrate").value==="yes";persist();closeOverlay("settingsOverlay");if(state.current)render(state.current);toast("SETTINGS SAVED");}
  function renderHistory(){var list=byId("historyList"),i,li,b,p;list.innerHTML="";byId("historySummary").textContent=history.length?history.length+" recorded rounds · "+state.done+" completed · "+state.passed+" passed":"No rounds yet.";for(i=0;i<history.length;i++){li=document.createElement("li");b=document.createElement("b");p=document.createElement("p");b.textContent=(history[i].result==="done"?"DONE":"PASSED")+" · "+history[i].type.toUpperCase()+" · "+history[i].intensity+"/5";p.textContent=history[i].text;li.appendChild(b);li.appendChild(p);list.appendChild(li);}}
  function normalizeImported(raw,index){
    if(!raw||typeof raw!=="object")return null;var type=String(raw.type||"").toLowerCase(),text=String(raw.text||raw.prompt||"").trim(),level=parseInt(raw.intensity,10);if((type!=="truth"&&type!=="dare")||text.length<8||level<1||level>5)return null;
    return{id:String(raw.id||("custom-"+Date.now()+"-"+index)),type:type,intensity:level,penalty:Math.max(1,Math.min(5,parseInt(raw.penalty,10)||level)),tag:String(raw.tag||"CUSTOM").slice(0,24).toUpperCase(),category:String(raw.category||"custom"),pack:"imported",text:text.slice(0,600)};
  }
  function importFile(file){var reader=new FileReader();reader.onload=function(){try{var data=JSON.parse(reader.result),source=Array.isArray(data)?data:data.cards,added=[],i,c;if(!Array.isArray(source))throw new Error("No cards array");for(i=0;i<source.length;i++){c=normalizeImported(source[i],i);if(c)added.push(c);}if(!added.length)throw new Error("No valid cards");imported=imported.concat(added);persist();toast("ADDED "+added.length+" CARDS");byId("status").textContent="3,000 BUILT-IN CARDS READY · "+imported.length+" IMPORTED";}catch(e){toast("INVALID CARD PACK");}};reader.readAsText(file);}
  function bind(){
    var modeButtons=all("[data-mode]"),i;
    for(i=0;i<modeButtons.length;i++)modeButtons[i].addEventListener("click",function(){state.mode=this.getAttribute("data-mode");syncModes();persist();draw(true);});
    byId("doneButton").addEventListener("click",function(){record("done");});byId("passButton").addEventListener("click",function(){record("passed");});byId("nextButton").addEventListener("click",function(){draw(true);});
    byId("settingsButton").addEventListener("click",function(){syncSettings();openOverlay("settingsOverlay");});byId("saveSettingsButton").addEventListener("click",saveSettings);
    byId("settingsOverlay").addEventListener("click",function(e){if(e.target===this)closeOverlay("settingsOverlay");});
    byId("historyButton").addEventListener("click",function(){renderHistory();openOverlay("historyOverlay");});byId("closeHistoryButton").addEventListener("click",function(){closeOverlay("historyOverlay");});
    byId("historyOverlay").addEventListener("click",function(e){if(e.target===this)closeOverlay("historyOverlay");});
    byId("clearHistoryButton").addEventListener("click",function(){history=[];state.done=0;state.passed=0;byId("played").textContent="0";byId("completed").textContent="0";byId("passed").textContent="0";renderHistory();toast("SESSION CLEARED");});
    byId("reshuffleButton").addEventListener("click",function(){seen={};draw(true);toast("DECK RESHUFFLED");});
    byId("clearImportedButton").addEventListener("click",function(){imported=[];persist();toast("IMPORTED CARDS REMOVED");byId("status").textContent="3,000 BUILT-IN CARDS READY · 0 IMPORTED";});
    byId("fileInput").addEventListener("change",function(e){var file=e.target.files&&e.target.files[0];if(file)importFile(file);e.target.value="";});
  }
  function selfTest(){
    var ids={},texts={},distribution={},i,c,key,buttons=["doneButton","passButton","nextButton","settingsButton","historyButton"],buttonState={};
    for(i=0;i<cards.length;i++){c=cards[i];ids[c.id]=(ids[c.id]||0)+1;texts[c.text]=(texts[c.text]||0)+1;key=c.type+"-"+c.intensity;distribution[key]=(distribution[key]||0)+1;}
    for(i=0;i<buttons.length;i++)buttonState[buttons[i]]=!!byId(buttons[i]);
    return{ok:cards.length===3000&&Object.keys(ids).length===3000&&Object.keys(texts).length===3000,total:cards.length,uniqueIds:Object.keys(ids).length,uniqueTexts:Object.keys(texts).length,distribution:distribution,buttons:buttonState,current:state.current?state.current.id:null};
  }
  window.NO_ALIBI_SELF_TEST=selfTest;
  window.addEventListener("error",function(e){showError(e.message||"JavaScript failed");});
  try{
    if(cards.length!==3000)throw new Error("Deck initialized with "+cards.length+" of 3,000 cards");
    load();bind();syncModes();syncSettings();draw(false);
    var result=selfTest();if(!result.ok)throw new Error("Deck validation failed");
  }catch(e){showError(e.message||String(e));}
}());
