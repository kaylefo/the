(function(){
"use strict";
var status=document.getElementById("status");
var files=[];
for(var i=0;i<9;i++)files.push("./expansion-"+String(i).padStart(2,"0")+".b64?v=literal-2000-1");
function setStatus(text,kind){if(!status)return;status.textContent=text;status.className="status "+(kind||"");}
function fail(error){
  console.error("NO ALIBI literal deck loader failed",error);
  setStatus("ERROR · "+(error&&error.message?error.message:String(error)),"bad");
  var prompt=document.getElementById("prompt");
  if(prompt)prompt.textContent="The 2,000-card expansion did not initialize. Tap here to retry.";
  var card=document.getElementById("card");
  if(card){card.style.cursor="pointer";card.onclick=function(){location.reload();};}
}
function loadScript(url){return new Promise(function(resolve,reject){var s=document.createElement("script");s.src=url;s.onload=resolve;s.onerror=function(){reject(new Error("Could not load the game engine"));};document.body.appendChild(s);});}
async function boot(){
  if(typeof DecompressionStream!=="function")throw new Error("This browser cannot open the offline card pack. Use current Safari or Chrome.");
  setStatus("LOADING 2,000 NEW LITERAL CARDS…","loading");
  var parts=[];
  for(var i=0;i<files.length;i++){
    setStatus("LOADING 2,000 NEW LITERAL CARDS · "+(i+1)+"/"+files.length,"loading");
    var response=await fetch(files[i],{cache:"force-cache"});
    if(!response.ok)throw new Error("Card pack part "+(i+1)+" returned HTTP "+response.status);
    var text=(await response.text()).replace(/\s+/g,"");
    if(!/^[A-Za-z0-9+/=]+$/.test(text)||text.length<100)throw new Error("Card pack part "+(i+1)+" is invalid");
    parts.push(text);
  }
  var encoded=parts.join("");
  var binary=atob(encoded);
  var bytes=new Uint8Array(binary.length);
  for(var j=0;j<binary.length;j++)bytes[j]=binary.charCodeAt(j);
  var stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  var json=await new Response(stream).text();
  var cards=JSON.parse(json);
  if(!Array.isArray(cards)||cards.length!==2000)throw new Error("Expansion count "+(cards&&cards.length||0)+"/2000");
  var ids=Object.create(null),texts=Object.create(null),dist=Object.create(null);
  for(var k=0;k<cards.length;k++){
    var c=cards[k],normalized=String(c.text||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if(!c.id||ids[c.id])throw new Error("Duplicate or missing card id at "+k);
    if(!normalized||texts[normalized])throw new Error("Duplicate or missing card text at "+k);
    if((c.type!=="truth"&&c.type!=="dare")||c.intensity<1||c.intensity>5)throw new Error("Malformed card at "+k);
    ids[c.id]=1;texts[normalized]=1;
    var key=c.type+"-"+c.intensity;dist[key]=(dist[key]||0)+1;
  }
  for(var level=1;level<=5;level++){
    if(dist["truth-"+level]!==200||dist["dare-"+level]!==200)throw new Error("Distribution error at level "+level);
  }
  window.NO_ALIBI_EXPANSION=cards;
  setStatus("2,000 NEW CARDS VERIFIED · LOADING ORIGINAL 1,000…","ok");
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js?v=literal-2000-1",{updateViaCache:"none"}).catch(function(){});
  await loadScript("./app.js?v=literal-2000-1");
}
boot().catch(fail);
}());
