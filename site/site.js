// Shared by every page of blastproof.dev: the version badge, the Ads
// conversions on clicks through to the repository, and the copy buttons.
(function(){
  function $(id){return document.getElementById(id)}
  // Latest published version from npm; keeps the hard-coded text if the request fails.
  try{
    fetch("https://registry.npmjs.org/blastproof/latest").then(function(r){return r.ok?r.json():null}).then(function(d){
      if(d&&/^\d+\.\d+\.\d+/.test(d.version))$("ver").textContent="v"+d.version;
    }).catch(function(){});
  }catch(e){}

  // Google Ads conversions, from each conversion action's click event snippet.
  // Sent as a beacon so the link navigates normally even if the tag is blocked;
  // an entry left null sends only the plain event.
  var CONVERSIONS={
    github:{send_to:"AW-18378674471/c5_YCIHG2fccEKei0btE",value:1.0,currency:"BRL"}, // Clique github
    install:null // "Copiar comando de instalação", when created
  };
  function track(name,key){
    if(typeof gtag!=="function")return;
    gtag("event",name,{transport_type:"beacon"});
    var c=CONVERSIONS[key];
    if(c)gtag("event","conversion",{send_to:c.send_to,value:c.value,currency:c.currency,transport_type:"beacon"});
  }
  document.querySelectorAll('a[href^="https://github.com/hamc/blastproof"]').forEach(function(a){
    a.addEventListener("click",function(){track("github_click","github")});
  });
  document.querySelectorAll("[data-copy]").forEach(function(b){
    b.addEventListener("click",function(){track("install_copy","install")});
  });

  document.querySelectorAll("[data-copy]").forEach(function(b){
    b.addEventListener("click",function(){
      var done=function(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1600)};
      try{navigator.clipboard.writeText(b.getAttribute("data-copy")).then(done,function(){b.textContent="Select it"})}catch(e){b.textContent="Select it"}
    });
  });
})();
