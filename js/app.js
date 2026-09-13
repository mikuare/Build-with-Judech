/* ============================================================================
   EnviroSortPro — browser simulation of the physical prototype.

   This is not an approximation of the sketch: loop(), detectionMaintenance(),
   handleWasteDetection(), moveServos() and resetServosAndLCD() are transcribed
   from EnviroSortPro.ino and run as generators, so the same branches run in the
   same order with the same delays. The world (servo travel, waste falling, bin
   fill) is simulated separately, exactly as the hardware would behave.
   ========================================================================= */
(function(){
"use strict";

var $ = function(id){ return document.getElementById(id); };
var LOW = 0, HIGH = 1;

/* ---------- platform geometry ----------
   The three bins sit corner to corner: their centres are on a circle of radius
   PLAT.rx = 2·binRadius/√3, which is exactly the radius at which three equal
   circles touch. TRI is the triangular plywood plate they are bolted to — its
   three corners line up with the three bins, and TRI.R = PLAT.rx + 2·binRadius
   is the smallest triangle that still holds all three inside its edges.
   TRI.k is the vertical foreshortening; TRI.h is the retaining rail height.   */
var BIN_R = 58;
var PLAT = {x:700, y:620, rx:67, ry:33.5};
var TRI  = {x:700, y:620, R:183, k:0.50, h:30, edge:13};
/* the fixed base plate, hardcoded in the SVG: a rectangle running from the mast
   across to the sensor post, its top face 26 px lower on screen than the
   rotating plate — the castor height                                         */
var BASE = {x0:494, x1:845.5, yFar:562, yNear:688};
/* The whole hopper head is drawn at 0.72 scale about the tap (SVG transform
   translate(196,96.6) scale(0.72)), so these screen positions are the scaled
   ones: global = 96.6 + 0.72 × local.                                        */
var THROAT = {x:700, y:328};      /* where the closed tap holds the waste */
var PROX   = {x:700, y:282};      /* the line between the two proximity heads */
var MOUTH  = {x:700, y:152};

/* The two detection stages are at different heights, so where the waste is
   decides which sensors can even see it. Stage 1 is the pair of proximity
   heads facing each other; stage 2 is the IR looking across the tap face.   */
var ZONE = {prox:{a:268, b:303}, ir:{a:313, b:346}};
/* Both stages only see what is actually inside the bore. The operator carries
   the waste in over the top of the machine, and that arc crosses the same
   screen heights as the sensors — but it is still out in the room, in a hand.
   Without this the IR fires on a can that has not gone in yet, and the sketch
   sorts it as bio before stage 1 has ever had it on the line.               */
var BORE_R = 26;

/* servo = value written to tap_servo; A = where that bin sits on the platform.
   A 270° servo moves value × 1.5 physical degrees, so A = servo × 1.5.        */
var BINS = [
  {key:"bio",     lcd:"Bio Waste",     servo:0,   A:0,     col:"#2E9E4B", waste:"#5E6B33",
   led:"ledBio", mled:"mLedBio", pin:"A3"},
  {key:"plastic", lcd:"Plastic Waste", servo:165, A:247.5, col:"#E0B41E", waste:"#C9D2D8",
   led:"ledPla", mled:"mLedPla", pin:"D2"},
  {key:"metal",   lcd:"Metal Waste",   servo:80,  A:120,   col:"#CF3A2E", waste:"#99A2A6",
   led:"ledMet", mled:"mLedMet", pin:"D13"}
];
var IDX = {bio:0, plastic:1, metal:2};
var SERVO_HOME = 90, GATE_CLOSED = 180, GATE_OPEN = 0;

/* The HC-SR04 looks straight down into whichever bin is parked under the hole.
   The sketch calls a bin full at `distance <= 20`, so an empty bin has to read
   well clear of that: 50 cm empty, 7 cm closed per drop, and the fifth drop
   lands at 15 cm — under the trip, with the fourth still at 22 cm. With no bin
   parked the beam carries past the plate to the floor.                      */
var US_TRIP_CM = 20;                    /* `distance <= 20` in the sketch */
var US_EMPTY_CM = 50, US_FULL_CM = 15, US_NO_BIN_CM = 55;
function binDistance(level){
  return US_EMPTY_CM - level/100 * (US_EMPTY_CM - US_FULL_CM);
}

/* The waste catalogue.
     cls   - which bin it belongs in ("none" = nothing can identify it)
     trips - pins this material CAN pull LOW: [D4 inductive, D3 capacitive, D7 IR]
     reach - how far it stands up from where it rests, in px. A bottle is tall
             enough to reach back up into stage 1 while sitting on the tap; a
             can is not. That is what decides the misreads.
   The IR is a reflective sensor, so it sees anything solid on the tap - it is
   really "something is there", and bio only by convention. Clear glass is the
   exception: it lets the beam through instead of bouncing it back, which is
   why nothing at all can identify it.                                       */
var KIND = {
  /* --- bio: soft, opaque, no metal, short enough to stay clear of stage 1 --- */
  banana: {cls:"bio",     trips:[0,0,1], reach:26, sit:457, label:"Banana peel"},
  apple:  {cls:"bio",     trips:[0,0,1], reach:26, sit:452, label:"Apple core"},
  paper:  {cls:"bio",     trips:[0,0,1], reach:28, sit:454, label:"Crumpled paper"},
  orange: {cls:"bio",     trips:[0,0,1], reach:24, sit:461, label:"Orange peel"},
  corn:   {cls:"bio",     trips:[0,0,1], reach:30, sit:459, label:"Corn cob"},
  leaf:   {cls:"bio",     trips:[0,0,1], reach:22, sit:456, label:"Dried leaf"},
  board:  {cls:"bio",     trips:[0,0,1], reach:26, sit:458, label:"Cardboard scrap"},

  /* --- plastic: the capacitive head sees the bulk, more so with liquid in it --- */
  bottle: {cls:"plastic", trips:[0,1,1], reach:76, sit:451, label:"Water bottle"},
  soda:   {cls:"plastic", trips:[0,1,1], reach:72, sit:451, label:"Soda bottle"},
  deterg: {cls:"plastic", trips:[0,1,1], reach:66, sit:452, label:"Detergent bottle"},
  cup:    {cls:"plastic", trips:[0,1,1], reach:40, sit:452, label:"Plastic cup"},
  tub:    {cls:"plastic", trips:[0,1,1], reach:30, sit:456, label:"Food container"},

  /* --- metal: inductive first, so these win over everything --- */
  can:    {cls:"metal",   trips:[1,1,1], reach:32, sit:451, label:"Soda can"},
  tin:    {cls:"metal",   trips:[1,1,1], reach:26, sit:456, label:"Sardine tin"},
  foil:   {cls:"metal",   trips:[1,0,1], reach:30, sit:458, label:"Foil food wrap"},
  cap:    {cls:"metal",   trips:[1,1,1], reach:16, sit:462, label:"Bottle crown cap"},
  spoon:  {cls:"metal",   trips:[1,1,1], reach:22, sit:454, label:"Stainless spoon"},
  bolt:   {cls:"metal",   trips:[1,1,1], reach:18, sit:460, label:"Steel bolt"},

  /* --- and the one nothing can read --- */
  glass:  {cls:"none",    trips:[0,0,0], reach:24, sit:454, label:"Glass shard"}
};

/* The infeed conveyor holds far more than fits on screen, so the belt shows a
   window of nine and jogs along. Taking an item advances the queue by one,
   exactly like a real infeed feeding the hopper.                             */
var BELT = {x0:40, x1:360, out:348};
var QUEUE = ["banana","bottle","can","apple","soda","tin","paper","cup","foil",
             "orange","deterg","spoon","corn","tub","cap","leaf","board","bolt","glass"];
var SLOT_X = [72, 104, 136, 168, 200, 232, 264, 296, 328];
var qOffset = 0, takenIdx = -1;
var beltPhase = 0, beltBoost = 0, stuckNow = false, takenSig = "";

/* ---------- sketch globals ---------- */
var G = {
  obstacleDetected:false, operationsEnabled:true,
  metalDetected:false, plasticDetected:false, bioDetected:false
};

/* ---------- simulated world ---------- */
var W = {
  rotVal:SERVO_HOME, gateVal:GATE_CLOSED,   /* last value written to each servo */
  R:SERVO_HOME*1.5,                          /* actual platform angle, degrees  */
  gate:0,                                    /* actual flap angle, 0..78        */
  level:[0,0,0],
  itemKind:null,                             /* waste resting on the closed gate */
  buttonDown:false,
  buzzer:false, leds:[false,false,false],
  Rv:0, gv:0,                                /* servo speeds, deg/s          */
  mains:true,
  lcd1:"Automatic Waste", lcd2:"Segregation",
  lcdInits:0, distance:US_EMPTY_CM
};

var speed = 1, soundOn = true, item = null, hits = {}, lastDist = null;

/* ---------- power: three ways to feed the Uno ----------
   ac      wall 220 V -> 5 V 2 A adapter -> the Uno's USB port.
   battery PACK A + B (4S 18650, 14.8 V nominal) -> LM2596 buck set to 5.0 V ->
           the Uno's 5 V pin.
   solar   18 V 20 W panel -> 4S charge controller + BMS -> the pack -> the same
           5 V buck -> the board. The panel never feeds the Uno directly: it
           charges the pack, and the pack runs the machine.
   Whatever the source, the board sees 5 V and never more: the 14.8 V pack and
   the 18 V panel both stop at the converter. Nothing goes to the barrel jack.
   The pack drains and charges about 120x faster than a real one, so you can
   watch it happen. A sagging pack slows the servos first; at the BMS cut-off
   the Uno browns out and stays down until the pack recovers or you switch.   */
var POWER = {
  build:"all", src:"ac", plugged:true, soc:0.82, sun:0.7, cut:false,
  v:14.8, chg:0,                             /* chg: net charge rate, for the LEDs */
  IDLE:0.0011, SERVO:0.0055, SUN:0.0078, CHARGER:0.0032,
  CUT:0.03, RECOVER:0.12
};
var POWER_SRC = ["ac", "battery", "solar"];
var POWER_NAME = {ac:"AC adapter", battery:"Battery pack", solar:"Solar panel"};

/* Which power design the project actually is. The scene follows: a build with
   no panel has no panel standing in the room, a build with no pack has nothing
   behind the compartment door, and a build with one source has no selector on
   the module. "all" is the switchable rig — every source on one machine.    */
var BUILDS = {
  ac:      {name:"AC only",              short:"AC only",
            has:{ac:true,  pack:false, solar:false}, src:"ac",
            note:"No pack and no panel on this build: pull the adapter and the machine stops dead. Say that before the panel asks what happens in a brownout."},
  battery: {name:"Battery only",         short:"Battery",
            has:{ac:false, pack:true,  solar:false}, src:"battery",
            note:"Nothing charges the pack while it is on the machine — you take it off and charge it, which is what the Charge the pack button stands for. Know your runtime."},
  solar:   {name:"Solar + battery",      short:"Solar",
            has:{ac:false, pack:true,  solar:true},  src:"solar",
            note:"No wall socket in this design. The panel charges the pack and the pack runs the machine — at night it is simply a battery build, so the pack has to carry the night on its own."},
  all:     {name:"All three, switchable", short:"Switchable",
            has:{ac:true,  pack:true,  solar:true},  src:"ac",
            note:"The selector on the module picks one source at a time; the other two stay connected as backup. This is the rig, not a minimal build — say so if the panel asks what you would actually deploy."}
};
var BUILD_ORDER = ["ac", "battery", "solar", "all"];
function has(k){ return BUILDS[POWER.build].has[k]; }
function setBuild(key){
  if(!BUILDS[key]) return;
  POWER.build = key;
  var b = BUILDS[key];
  if(POWER_SRC.indexOf(POWER.src) < 0 || !b.has[POWER.src === "solar" ? "solar" : POWER.src]) POWER.src = b.src;
  if(key !== "all") POWER.src = b.src;
  POWER.plugged = true;
  POWER.cut = false;
  if(!b.has.pack) POWER.soc = 0.82;
  applyBuildScene();
  buildPowerFlow();
  syncChangeover();
  applyBuildAnswers();
  stepPower(0);
  paintPower();
}
/* the room only contains the hardware this build has */
function applyBuildScene(){
  var b = BUILDS[POWER.build];
  function show(id, on){ var e = $(id); if(e) e.style.display = on ? "" : "none"; }
  show("mains", b.has.ac);
  show("solarG", b.has.solar);
  show("solarCable", b.has.solar);
  show("supportBatt", b.has.pack);
  show("packCable", b.has.pack);
  show("powerMod", b.has.pack);            /* the buck only exists if a pack does */
  show("pwrSel", POWER.build === "all");
  show("pwrFixed", b.has.pack && POWER.build !== "all");
  show("pwrChgBlk", b.has.pack && (b.has.solar || b.has.ac));
  if(b.has.pack && POWER.build !== "all"){
    $("pwrFixedT").textContent = b.has.solar ? "SOLAR" : "BATTERY";
    $("pwrFixedS").textContent = b.has.solar ? "panel → pack" : "no other source";
  }
  /* with no module on the mast, the adapter cord runs straight to the box */
  $("acCord").setAttribute("d", b.has.pack
    ? "M125 306 C 132 344 210 392 300 416 C 356 430 392 434 396 410 C 398 380 396 320 400 268 C 402 252 420 244 440 244"
    : "M125 306 C 132 344 210 392 300 416 C 356 430 384 436 404 442");
}
/* 4S Li-ion: 12.4 V flat, 14.8 V nominal, 16.8 V full */
function packVolts(soc){
  return 12.4 + 3.6 * soc + (soc > 0.9 ? (soc - 0.9) * 8 : 0);
}
/* is the Uno getting anything at all right now */
function unoPowered(){
  if(POWER.src === "ac") return POWER.plugged;
  return !POWER.cut;
}
/* what is putting charge into the pack on this build, if anything */
function chargeSource(){
  if(!has("pack")) return "";
  if(POWER.src === "solar") return "panel";
  if(POWER.src === "ac" && POWER.plugged && has("ac")) return "adapter";
  return "";
}
/* the servos slow down as the pack sags, long before the Uno browns out */
function servoFactor(){
  if(POWER.src === "ac") return 1;
  var f = (POWER.v - 12.4) / 2.4;
  return 0.45 + 0.55 * Math.max(0, Math.min(1, f));
}
function setPower(src){
  if(POWER_SRC.indexOf(src) < 0) return;
  if(relayRig()){
    /* on the relay rig there is no hand on the source. Asking for the
       adapter plugs it in; asking for anything else pulls it out and lets
       the contact fall back onto the pack, which is the only way a source
       ever changes on that build.                                       */
    POWER.plugged = (src === "ac");
    POWER.src = relayPick();
  } else {
    POWER.src = src;
    if(src === "ac") POWER.plugged = true;
  }
  stepPower(0);                                /* settle W.mains before the next pass */
  paintPower();
}
function stepPower(dt){
  if(relayRig()) POWER.src = relayPick();      /* the coil, not the operator */
  var moving = Math.abs(W.rotVal * 1.5 - W.R) > 0.5 || Math.abs(((W.gateVal < 90) ? 78 : 0) - W.gate) > 0.5;
  var draw = 0, gain = 0, cs = chargeSource();
  if(POWER.src !== "ac" && !POWER.cut) draw = POWER.IDLE + (moving ? POWER.SERVO : 0);
  if(cs === "panel") gain = POWER.SUN * POWER.sun;
  else if(cs === "adapter") gain = POWER.CHARGER;
  if(POWER.soc >= 1 || !has("pack")) gain = 0;
  POWER.chg = gain - draw;
  POWER.soc = Math.max(0, Math.min(1, POWER.soc + POWER.chg * dt));
  POWER.v = packVolts(POWER.soc);
  if(!POWER.cut && POWER.soc <= POWER.CUT) POWER.cut = true;
  if(POWER.cut && POWER.soc >= POWER.RECOVER) POWER.cut = false;
  var was = W.mains;
  W.mains = unoPowered();
  if(was && !W.mains){ buzzerOn(false); W.leds = [false, false, false]; }
}
var osc = null, oscGain = null, audio = null;

/* ============================ audio ============================ */
function ac(){
  if(!audio){
    try{ audio = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return null; }
  }
  if(audio.state === "suspended") audio.resume();
  return audio;
}
/* digitalWrite(buzzer, HIGH/LOW). The pin state lives in W.buzzer and is the
   sketch's business; whether you can hear it is the room's, so muting must
   not pretend the pin went low — the scene still has to show D12 high.     */
function buzzerOn(on){ W.buzzer = on; syncBuzzer(); }
function syncBuzzer(){
  if(!W.buzzer || !soundOn || !W.mains){
    if(osc){ try{ osc.stop(); }catch(e){} osc = null; oscGain = null; }
    return;
  }
  if(osc) return;
  var a = ac(); if(!a) return;
  osc = a.createOscillator(); oscGain = a.createGain();
  osc.type = "square"; osc.frequency.value = 2100;
  oscGain.gain.value = 0.05;
  osc.connect(oscGain); oscGain.connect(a.destination);
  osc.start();
}
/* the mechanical tick of the D10 push button, so a press the presentation
   makes for you is heard as well as seen */
function clickTick(){
  if(!soundOn) return;
  var a = ac(); if(!a) return;
  var o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = "square";
  o.frequency.setValueAtTime(1900, t);
  o.frequency.exponentialRampToValueAtTime(340, t + 0.045);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + 0.1);
}

/* ============================ serial ============================ */
function serialPrint(line){
  var box = $("serialEl"), last = box.lastElementChild;
  if(last && last.getAttribute("data-msg") === line){
    var n = (parseInt(last.getAttribute("data-n"), 10) || 1) + 1;
    last.setAttribute("data-n", n);
    last.innerHTML = "";
    last.appendChild(document.createTextNode(line));
    var s = document.createElement("span");
    s.className = "rep"; s.textContent = "  ×" + n;
    last.appendChild(s);
  } else {
    var d = document.createElement("div");
    d.setAttribute("data-msg", line); d.setAttribute("data-n", "1");
    d.textContent = line;
    box.appendChild(d);
    while(box.childNodes.length > 200) box.removeChild(box.firstChild);
  }
  box.scrollTop = box.scrollHeight;
}

/* ============================ trace ============================ */
function T(k){ hits[k] = Date.now(); }
var flagSig = "";
function paintTrace(){
  var now = Date.now();
  document.querySelectorAll(".trace .ln[data-k]").forEach(function(n){
    var t = hits[n.getAttribute("data-k")] || 0, age = now - t;
    n.className = "ln" + (age < 260 ? " hot" : (age < 900 ? " call" : " skip"));
  });
  var fsig = [G.obstacleDetected, G.operationsEnabled, G.metalDetected,
              G.plasticDetected, G.bioDetected, W.lcdInits].join("|");
  if(fsig === flagSig) return;
  flagSig = fsig;
  $("flagsEl").innerHTML =
    flag("obstacleDetected", G.obstacleDetected, true) +
    flag("operationsEnabled", G.operationsEnabled, false) +
    flag("metalDetected", G.metalDetected, false) +
    flag("plasticDetected", G.plasticDetected, false) +
    flag("bioDetected", G.bioDetected, false) +
    '<span class="flag">lcd.init() ×' + W.lcdInits + '</span>';
}
function flag(name, val, alarm){
  var c = val ? (alarm ? "flag t alarm" : "flag t") : "flag";
  return '<span class="' + c + '">' + name + ' <b>' + (val ? "true" : "false") + '</b></span>';
}

/* ============================ hardware shims ============================ */
/* vertical extent of the waste right now */
function itemSpan(){
  if(!item) return null;
  var r = KIND[item.kind].reach;
  return {a: item.y - r*0.7, b: item.y + r*0.3};
}
function inBore(){                               /* down the hole, not in a hand */
  return !!item && Math.abs(item.x - THROAT.x) <= BORE_R;
}
function inZone(z){
  var s = itemSpan();
  return !!s && inBore() && s.b >= z.a && s.a <= z.b;
}
function digitalReadPin(i){                      /* 0 metal D4, 1 plastic D3, 2 IR D7 */
  if(!item || item.falling || item.onBelt || item.retrieving) return HIGH;
  if(!KIND[item.kind].trips[i]) return HIGH;     /* wrong material for this head */
  return inZone(i === 2 ? ZONE.ir : ZONE.prox) ? LOW : HIGH;
}
function frontBin(){
  var best = -1, bd = -2;
  BINS.forEach(function(b, i){
    var c = Math.cos((b.A - W.R) * Math.PI/180);
    if(c > bd){ bd = c; best = i; }
  });
  return bd > 0.80 ? best : -1;
}
function triggerUltrasonic(){                    /* returns µs, like pulseIn */
  var i = frontBin();
  var cm = (i < 0 || binAway(i)) ? US_NO_BIN_CM : binDistance(W.level[i]);
  W.distance = cm;
  return Math.round(cm * 2 / 0.0343);
}
function setLed(key, on){ W.leds[IDX[key]] = on; }
function lcdSet(a, b){
  if(a !== W.lcd1){
    if(/ Waste$/.test(a)) panelReact("detect");
    else if(a === "Bin Full") panelReact("full");
  }
  W.lcd1 = a; W.lcd2 = b;
}

/* ============================ the sketch ============================ */
function* wait(ms){
  var end = Date.now() + ms/speed;
  while(Date.now() < end) yield;
}

function resetServosAndLCD(){
  W.rotVal = SERVO_HOME;
  W.gateVal = GATE_CLOSED;
  W.lcdInits++;                                  /* lcd.init() runs every time */
  lcdSet("Automatic Waste", "Segregation");
  setLed("plastic", false); setLed("metal", false); setLed("bio", false);
}
function changeLCD(a, b){ lcdSet(a, b); }
function displayFullBin(){ lcdSet("Bin Full", "Detected"); }
function soundAlarm(){
  buzzerOn(true);
  setLed("plastic", true); setLed("metal", true); setLed("bio", true);
}
function stopAlarm(){ buzzerOn(false); }         /* note: leaves the LEDs on */

function* debugDistance(d){
  serialPrint("Distance: " + d + " cm");
  yield* wait(17);                               /* 16 chars @ 9600 baud ≈ 17 ms */
}

function* detectionMaintenance(){
  T("dm-head");
  var duration = triggerUltrasonic();
  var distance = Math.round(duration * 0.0343 / 2);
  T("dm-us"); $("trUs").textContent = distance + " cm";
  yield* debugDistance(distance);

  T("dm-full");
  if(distance <= US_TRIP_CM && !G.obstacleDetected){
    G.obstacleDetected = true;
    soundAlarm(); displayFullBin();
    G.operationsEnabled = false;
    disposal.phase = "idle"; disposal.binIdx = frontBin(); disposal.carry = null;
    T("dm-ret");
    return true;
  } else if(distance > US_TRIP_CM && G.obstacleDetected){
    T("dm-clear");
    G.obstacleDetected = false;
    stopAlarm();
  }

  T("dm-btn");
  if(!G.operationsEnabled && W.buttonDown){
    G.operationsEnabled = true;
    resetServosAndLCD();
  }
  T("dm-ret");
  return !G.operationsEnabled;
}

function* moveServos(pos1, pos2){
  T("ms-head"); T("ms-1");
  W.rotVal = pos1;                               /* tap_servo.write(pos1)  */
  T("ms-d1");
  yield* wait(1000);
  T("ms-2");
  W.gateVal = pos2;                              /* tap_servo1.write(pos2) */
  T("ms-d2");
  yield* wait(200);
}

function* handleWasteDetection(){
  T("hw"); T("hw-read");
  var val_metal   = digitalReadPin(0);
  var val_plastic = digitalReadPin(1);
  var val_bio     = digitalReadPin(2);

  T("hw-metal");
  if(val_metal === LOW){
    changeLCD("Metal Waste", "Detected");
    yield* moveServos(80, 0);
    G.metalDetected = true; setLed("metal", true);
  } else { G.metalDetected = false; setLed("metal", false); }

  T("hw-plastic");
  if(val_plastic === LOW && !G.metalDetected){
    changeLCD("Plastic Waste", "Detected");
    yield* moveServos(165, 0);
    G.plasticDetected = true; setLed("plastic", true);
  } else { G.plasticDetected = false; setLed("plastic", false); }

  T("hw-bio");
  if(val_bio === LOW){
    changeLCD("Bio Waste", "Detected");
    yield* moveServos(0, 0);
    G.bioDetected = true; setLed("bio", true);
  } else { G.bioDetected = false; setLed("bio", false); }

  T("hw-reset");
  if(!G.metalDetected && !G.plasticDetected && !G.bioDetected) resetServosAndLCD();
}

function* arduinoLoop(){
  while(true){
    T("loop"); T("dm");
    var early = yield* detectionMaintenance();
    if(early) continue;                          /* return; — skips delay(500) */
    T("hw");
    yield* handleWasteDetection();
    T("d500");
    yield* wait(500);
  }
}
var proc = arduinoLoop();

/* ============================ world physics ============================ */
var lastFrame = Date.now();
/* one axis of a servo, with acceleration: cruise at vmax, brake at acc so it
   arrives at rest instead of hitting the stop at full speed. Returns the new
   angle and the new speed.                                                */
function servoTrack(p, v, target, vmax, acc, dt){
  var d = target - p, dist = Math.abs(d), dir = d < 0 ? -1 : 1;
  if(dist < 0.02 && Math.abs(v) < 1.5) return [target, 0];
  var moving = Math.abs(v) > 0.01 && Math.sign(v) === dir;
  var brake = moving ? (v * v) / (2 * acc) : 0;
  v += (moving && dist <= brake ? -dir : dir) * acc * dt;
  if(Math.abs(v) > vmax) v = (v < 0 ? -1 : 1) * vmax;
  var np = p + v * dt;
  if((np - target) * dir >= 0) return [target, 0];        /* arrived; no overshoot */
  return [np, v];
}
function stepWorld(){
  var now = Date.now(), dt = Math.min(80, now - lastFrame) * speed / 1000;
  lastFrame = now;

  stepPower(dt);
  var sf = servoFactor();
  /* tap_servo, the platform. A digital servo does not start and stop dead:
     it ramps up, cruises and brakes into the stop, and the stopping is what
     you actually see on a plate carrying three bins. The peak is raised to
     pay for the ramps, so the worst move on the machine — home to plastic,
     247.5° — still lands inside the sketch's own delay(1000) and the gate
     never opens on a plate that has not arrived.                        */
  var r = servoTrack(W.R, W.Rv, W.rotVal * 1.5, 428 * sf, 1400 * sf * sf, dt);
  W.R = r[0]; W.Rv = r[1];
  /* tap_servo1, the gate: a short throw, so it is all ramp and no cruise */
  var g = servoTrack(W.gate, W.gv, (W.gateVal < 90) ? 78 : 0, 520 * sf, 3400 * sf * sf, dt);
  W.gate = g[0]; W.gv = g[1];

  /* holding the waste at stage 1, or letting it go once the tap opens */
  if(item && !item.falling && !item.cur && !item.q.length){
    if(item.held){
      var open = W.gate > 40;
      var giveUp = (Date.now() - item.heldAt) > 3400/speed;
      if(open || giveUp){
        item.held = false;
        item.carried = false;
        if(open) beginFall();                       /* tap is already open: straight through */
        else item.q.push({to:THROAT, ctrl:null, dur:300, next:null});
      }
    } else if(Math.abs(item.y - THROAT.y) < 10 && W.gate > 40){
      beginFall();                                  /* sitting on the tap when it opens */
    }
  }
  stepItem();
}

function beginFall(){
  item.falling = true;
  item.q.push({to:{x:PLAT.x, y:PLAT.y + PLAT.ry - 95}, ctrl:null, dur:440, next:function(){
    var b = frontBin();
    if(b >= 0) W.level[b] = Math.min(100, W.level[b] + 20);
    $("itemG").setAttribute("opacity", "0");
    item = null; W.itemKind = null;
    takenIdx = -1;
    qOffset = (qOffset + 1) % QUEUE.length;    /* belt feeds the next one along */
    beltBoost = Date.now() + 500;
  }});
}

function easeInOut(t){ return t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
function stepItem(){
  if(!item) return;
  if(!item.cur){
    if(!item.q || !item.q.length) return;
    item.cur = item.q.shift(); item.at = Date.now(); item.from = {x:item.x, y:item.y};
  }
  var t = Math.min(1, (Date.now() - item.at) / (item.cur.dur / speed));
  var e = easeInOut(t), c = item.cur.ctrl, f = item.from, to = item.cur.to;
  if(c){
    var m = 1 - e;
    item.x = m*m*f.x + 2*m*e*c.x + e*e*to.x;
    item.y = m*m*f.y + 2*m*e*c.y + e*e*to.y;
  } else { item.x = f.x + (to.x-f.x)*e; item.y = f.y + (to.y-f.y)*e; }
  $("itemG").setAttribute("transform", "translate(" + item.x.toFixed(1) + "," + item.y.toFixed(1) + ")");
  if(t >= 1){ var cb = item.cur.next; item.cur = null; if(cb) cb(); }
}

/* ============================ drawing ============================ */
var BIN_PATH = "M -58 -120 Q -54 -54 -41 -3 A 41 12 0 0 0 41 -3 Q 54 -54 58 -120 Z";

function shapeOf(kind){
  switch(kind){

  case "banana":   /* peel: split skin, browning at the tips */
    return '<path d="M-14 8 C-18 -3 -10 -13 3 -15 C12 -16 17 -11 18 -6 C14 -10 6 -11 -1 -7 C-8 -3 -10 3 -9 10 Z" fill="#E3C13F" stroke="#B79724" stroke-width="1.2"/>' +
           '<path d="M-9 10 C-14 2 -13 -7 -4 -12" fill="none" stroke="#C9A62B" stroke-width="2.4"/>' +
           '<path d="M-3 -12 C4 -15 11 -14 15 -9" fill="none" stroke="#F0DC7E" stroke-width="2"/>' +
           '<path d="M16 -8 q6 -2 8 -7" fill="none" stroke="#7A5C1C" stroke-width="3.4" stroke-linecap="round"/>' +
           '<path d="M-14 8 q-4 3 -7 3" fill="none" stroke="#7A5C1C" stroke-width="3" stroke-linecap="round"/>';

  case "apple":    /* core: bitten down, stem and leaf */
    return '<path d="M-7 -9 C-12 -6 -12 3 -9 9 C-7 13 -3 14 0 12 C3 14 7 13 9 9 C12 3 12 -6 7 -9 C4 -5 -4 -5 -7 -9 Z" fill="#F2E6CC" stroke="#D6C39F" stroke-width="1.2"/>' +
           '<path d="M-7 -9 C-4 -6 4 -6 7 -9 L7 -12 C4 -10 -4 -10 -7 -12 Z" fill="#B8402C"/>' +
           '<path d="M-9 9 C-7 12 7 12 9 9 L9 12 C6 15 -6 15 -9 12 Z" fill="#B8402C"/>' +
           '<rect x="-1.5" y="-19" width="3" height="8" rx="1.4" fill="#6B4A22"/>' +
           '<path d="M2 -17 C9 -20 12 -17 12 -13 C7 -12 3 -14 2 -17 Z" fill="#4E8C3A"/>' +
           '<circle cx="-2.5" cy="3" r="1.2" fill="#3A2A16"/><circle cx="3" cy="5" r="1.2" fill="#3A2A16"/>';

  case "paper":    /* crumpled sheet: creases make it read as scrunched */
    return '<path d="M-14 3 L-10 -10 L0 -14 L11 -9 L15 2 L8 12 L-6 13 Z" fill="#EFEDE4" stroke="#BFBBAC" stroke-width="1.2"/>' +
           '<path d="M-10 -10 L-2 -1 L-14 3 M0 -14 L-2 -1 L11 -9 M-2 -1 L8 12 M-2 -1 L-6 13" fill="none" stroke="#CFCBBC" stroke-width="1.2"/>' +
           '<path d="M-6 -6 L2 -8" fill="none" stroke="#D8D4C6" stroke-width="1"/>';

  case "bottle":   /* clear PET water bottle - tall enough to reach stage 1 */
    return '<rect x="-5" y="-25" width="10" height="7" rx="2" fill="#2E7FC4"/>' +
           '<rect x="-3.5" y="-18" width="7" height="5" fill="#CFE7EE" stroke="#9FC2CC" stroke-width="1"/>' +
           '<path d="M-3.5 -13 L3.5 -13 L6 -8 L6 13 A3 3 0 0 1 3 16 L-3 16 A3 3 0 0 1 -6 13 L-6 -8 Z" fill="#D9EDF3" opacity=".9" stroke="#9FC2CC" stroke-width="1.2"/>' +
           '<rect x="-6" y="-3" width="12" height="10" fill="#3FA3C7" opacity=".85"/>' +
           '<path d="M-6 -3 H6 M-6 7 H6" stroke="#2A7E9C" stroke-width="1"/>' +
           '<path d="M-6 9 H6 M-6 12 H6" fill="none" stroke="#9FC2CC" stroke-width="1"/>' +
           '<rect x="-4" y="-7" width="2.2" height="20" fill="#fff" opacity=".6"/>';

  case "soda":     /* dark soft-drink bottle, red label */
    return '<rect x="-5" y="-23" width="10" height="7" rx="2" fill="#C42B22"/>' +
           '<rect x="-3.5" y="-16" width="7" height="4" fill="#8A5A2E"/>' +
           '<path d="M-3.5 -12 L3.5 -12 L6 -7 L6 11 Q6 16 0 16 Q-6 16 -6 11 L-6 -7 Z" fill="#6B4118" opacity=".92" stroke="#3E2609" stroke-width="1.2"/>' +
           '<rect x="-6" y="-2" width="12" height="11" fill="#C42B22"/>' +
           '<rect x="-6" y="-2" width="12" height="2" fill="#fff" opacity=".35"/>' +
           '<path d="M-5 3.5 q5 -2.5 10 0" fill="none" stroke="#fff" stroke-width="1.4" opacity=".85"/>' +
           '<rect x="-4" y="-6" width="2.2" height="18" fill="#fff" opacity=".35"/>';

  case "can":      /* aluminium soft-drink can with tab */
    return '<path d="M-9 -13 L9 -13 L9 11 Q9 15 5 16 L-5 16 Q-9 15 -9 11 Z" fill="url(#steelG)" stroke="#7E888B" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="-13" rx="9" ry="3.6" fill="#D8DEE0" stroke="#8A9496" stroke-width="1"/>' +
           '<ellipse cx="0" cy="-13" rx="5.4" ry="2" fill="#B4BCBE"/>' +
           '<path d="M-2 -14 q2 -1.6 4 0" fill="none" stroke="#8A9496" stroke-width="1.2"/>' +
           '<rect x="-9" y="-4" width="18" height="11" fill="#C42B22"/>' +
           '<rect x="-9" y="-4" width="18" height="2" fill="#fff" opacity=".3"/>' +
           '<path d="M-6 2 q6 -3 12 0" fill="none" stroke="#fff" stroke-width="1.3" opacity=".9"/>' +
           '<rect x="-5.5" y="-10" width="2.4" height="24" fill="#fff" opacity=".5"/>';

  case "tin":      /* short sardine tin with a ring pull */
    return '<path d="M-15 -5 L-15 6 Q-15 11 0 11 Q15 11 15 6 L15 -5 Z" fill="url(#steelG)" stroke="#7E888B" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="-5" rx="15" ry="5.6" fill="#C7CFD1" stroke="#8A9496" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="-5" rx="10.5" ry="3.6" fill="none" stroke="#9AA5A8" stroke-width="1.2"/>' +
           '<circle cx="5" cy="-6" r="3.6" fill="none" stroke="#8A9496" stroke-width="1.8"/>' +
           '<rect x="-15" y="1" width="30" height="4.5" fill="#2E6FA8" opacity=".75"/>' +
           '<rect x="-11" y="-1" width="2" height="10" fill="#fff" opacity=".4"/>';

  case "foil":     /* food scrap in crumpled foil */
    return '<path d="M-14 7 L-9 -8 L2 -13 L13 -5 L10 9 Z" fill="#C9D2D6" stroke="#8A9496" stroke-width="1.2"/>' +
           '<path d="M-9 -8 L-1 0 L-14 7 M2 -13 L-1 0 L13 -5 M-1 0 L10 9" fill="none" stroke="#A8B2B5" stroke-width="1"/>' +
           '<path d="M-5 6 Q0 -2 7 1" fill="none" stroke="#8A6B22" stroke-width="3.6" stroke-linecap="round"/>' +
           '<circle cx="-1" cy="4" r="2.6" fill="#7C6A22"/>' +
           '<path d="M-6 -4 L0 -7" fill="none" stroke="#EDF3F4" stroke-width="1.6" opacity=".8"/>';

  case "orange":   /* half orange rind, cut side up */
    return '<path d="M-14 0 A14 14 0 0 1 14 0 Z" fill="#EE8B2B" stroke="#A85510" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="0" rx="14" ry="5" fill="#F7E9D2" stroke="#A85510" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="0" rx="10.5" ry="3.4" fill="#F4A63E"/>' +
           '<path d="M-10 0 L10 0 M-7 -2 L7 2 M-7 2 L7 -2" fill="none" stroke="#F7E9D2" stroke-width="1"/>' +
           '<path d="M-13 -3 q4 -4 9 -4" fill="none" stroke="#FBB05C" stroke-width="1.6" opacity=".8"/>';

  case "corn":     /* gnawed cob with kernels left on it */
    return '<rect x="-16" y="-8" width="32" height="16" rx="8" fill="#E8D9A0" stroke="#B79724" stroke-width="1.2"/>' +
           '<g fill="#E3C13F" stroke="#B79724" stroke-width=".7">' +
           '<ellipse cx="-11" cy="-3" rx="3.2" ry="2.6"/><ellipse cx="-4" cy="-4" rx="3.2" ry="2.6"/>' +
           '<ellipse cx="3" cy="-4" rx="3.2" ry="2.6"/><ellipse cx="10" cy="-3" rx="3.2" ry="2.6"/>' +
           '<ellipse cx="-8" cy="2" rx="3.2" ry="2.6"/><ellipse cx="-1" cy="3" rx="3.2" ry="2.6"/>' +
           '<ellipse cx="6" cy="2" rx="3.2" ry="2.6"/></g>' +
           '<path d="M16 0 q6 -1 8 -4" fill="none" stroke="#8A6B22" stroke-width="3" stroke-linecap="round"/>';

  case "leaf":     /* dried leaf, brown and curled */
    return '<path d="M-14 7 C-11 -6 -1 -14 12 -12 C13 1 5 10 -6 11 Z" fill="#A67C3A" stroke="#6B4A18" stroke-width="1.2"/>' +
           '<path d="M-13 8 C-6 3 4 -5 12 -12" fill="none" stroke="#6B4A18" stroke-width="1.5"/>' +
           '<g fill="none" stroke="#7E5A22" stroke-width=".9">' +
           '<path d="M-6 4 L-3 -2"/><path d="M-1 -1 L2 -7"/><path d="M4 -5 L7 -10"/></g>' +
           '<path d="M-14 7 q-4 1 -6 4" fill="none" stroke="#6B4A18" stroke-width="2" stroke-linecap="round"/>';

  case "board":    /* corrugated cardboard offcut, fluting showing on the edge */
    return '<path d="M-15 -7 L13 -10 L15 5 L-13 9 Z" fill="#C4A067" stroke="#8E6C36" stroke-width="1.2"/>' +
           '<path d="M-15 -2 L15 -5" fill="none" stroke="#8E6C36" stroke-width="1"/>' +
           '<path d="M-15 -7 q2 2.5 0 5 M-11 -7.4 q2 2.5 0 5 M-7 -7.8 q2 2.5 0 5 M-3 -8.2 q2 2.5 0 5 M1 -8.6 q2 2.5 0 5 M5 -9 q2 2.5 0 5 M9 -9.4 q2 2.5 0 5" fill="none" stroke="#A8834A" stroke-width="1.1"/>' +
           '<path d="M-13 4 L13 1" fill="none" stroke="#B08F55" stroke-width="1"/>';

  case "cup":      /* disposable plastic cup, tapered */
    return '<path d="M-10 -18 L10 -18 L6 12 A6 3 0 0 1 -6 12 Z" fill="#DCEDF2" opacity=".9" stroke="#9FC2CC" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="-18" rx="10" ry="3.6" fill="none" stroke="#8FB6C4" stroke-width="2"/>' +
           '<path d="M-9 -9 L9 -9" fill="none" stroke="#9FC2CC" stroke-width="1"/>' +
           '<path d="M-7.5 -2 L7.5 -2" fill="none" stroke="#9FC2CC" stroke-width="1"/>' +
           '<rect x="-7" y="-14" width="2.4" height="24" fill="#fff" opacity=".6"/>';

  case "tub":      /* lidded food container, lying flat */
    return '<path d="M-16 -4 L16 -4 L13 8 A5 2.5 0 0 1 -13 8 Z" fill="#E8EEF0" opacity=".92" stroke="#A8B8BC" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="-4" rx="16" ry="4.6" fill="#F4F8F9" stroke="#A8B8BC" stroke-width="1.2"/>' +
           '<ellipse cx="0" cy="-4" rx="11" ry="3" fill="none" stroke="#C0CDD0" stroke-width="1"/>' +
           '<path d="M-16 -4 q0 -3 4 -4 M16 -4 q0 -3 -4 -4" fill="none" stroke="#A8B8BC" stroke-width="1.4"/>' +
           '<rect x="-11" y="0" width="22" height="4" fill="#7FB2C4" opacity=".55"/>';

  case "deterg":   /* detergent bottle with a moulded handle */
    return '<rect x="-4" y="-24" width="8" height="6" rx="1.5" fill="#2E5FA8"/>' +
           '<path d="M-8 -18 L8 -18 L10 -10 L10 12 A3 3 0 0 1 7 15 L-7 15 A3 3 0 0 1 -10 12 L-10 -10 Z" fill="#3FA3C7" stroke="#2A7E9C" stroke-width="1.2"/>' +
           '<path d="M10 -5 q7 3 7 9 q0 6 -7 8" fill="none" stroke="#3FA3C7" stroke-width="3.4"/>' +
           '<rect x="-8" y="-3" width="16" height="11" rx="1" fill="#F2F6F7" opacity=".92"/>' +
           '<path d="M-5 1 H5 M-5 4 H3" fill="none" stroke="#7FA6B4" stroke-width="1.1"/>' +
           '<rect x="-6.5" y="-14" width="2.2" height="26" fill="#fff" opacity=".45"/>';

  case "cap":      /* crown cap: painted steel with a crimped skirt */
    return '<ellipse cx="0" cy="2" rx="11" ry="4.4" fill="#8A9496"/>' +
           '<ellipse cx="0" cy="-1" rx="11" ry="4.6" fill="#D94237" stroke="#7E1A14" stroke-width="1.2"/>' +
           '<g stroke="#9B2118" stroke-width="1">' +
           '<path d="M-9 0 V3"/><path d="M-5 1.6 V4.6"/><path d="M0 2 V5"/><path d="M5 1.6 V4.6"/><path d="M9 0 V3"/></g>' +
           '<ellipse cx="0" cy="-1.5" rx="6.5" ry="2.6" fill="#EE6055" opacity=".7"/>' +
           '<ellipse cx="-3" cy="-2.4" rx="3" ry="1.1" fill="#fff" opacity=".55"/>';

  case "spoon":    /* stainless teaspoon */
    return '<ellipse cx="-9" cy="-6" rx="6.4" ry="8.6" fill="url(#steelG)" stroke="#7E888B" stroke-width="1.2" transform="rotate(-28 -9 -6)"/>' +
           '<ellipse cx="-9" cy="-6" rx="3.6" ry="5.4" fill="#EDF3F4" opacity=".55" transform="rotate(-28 -9 -6)"/>' +
           '<path d="M-4 1 L13 12" fill="none" stroke="#9AA5A8" stroke-width="5" stroke-linecap="round"/>' +
           '<path d="M-4 1 L13 12" fill="none" stroke="#E2E8E9" stroke-width="1.8" stroke-linecap="round"/>';

  case "bolt":     /* hex bolt with a nut run down the thread */
    return '<polygon points="-12,-5 -6,-10 1,-8 3,0 -3,5 -10,3" fill="url(#steelG)" stroke="#6E787B" stroke-width="1.2"/>' +
           '<path d="M1 -3 L15 7" fill="none" stroke="#A8B2B5" stroke-width="5.5" stroke-linecap="round"/>' +
           '<g stroke="#7E888B" stroke-width="1">' +
           '<path d="M5 -1 L3 2"/><path d="M8 1 L6 4"/><path d="M11 3 L9 6"/><path d="M14 5 L12 8"/></g>' +
           '<polygon points="4,1 8,-1 11,2 9,6 5,6 3,3" fill="#C7CFD1" stroke="#6E787B" stroke-width="1"/>' +
           '<path d="M-9 -6 L-2 -3" fill="none" stroke="#EDF3F4" stroke-width="1.4" opacity=".8"/>';

  default:         /* clear glass shard - transparent, which is the whole point */
    return '<polygon points="-12,10 -3,-14 8,-7 13,8 2,13" fill="#CFE4E8" opacity=".55" stroke="#9FC2CC" stroke-width="1.4"/>' +
           '<polygon points="-6,7 -1,-8 4,-3" fill="#FFFFFF" opacity=".6"/>' +
           '<path d="M-3 -14 L2 13" fill="none" stroke="#B4D2D8" stroke-width="1"/>' +
           '<path d="M6 -4 L11 6" fill="none" stroke="#FFFFFF" stroke-width="1.4" opacity=".7"/>';
  }
}

function buildSamples(){
  $("samples").innerHTML = SLOT_X.map(function(x, j){
    var idx = (qOffset + j) % QUEUE.length;
    if(idx === takenIdx) return "";              /* that one is in the machine */
    var w = QUEUE[idx], k = KIND[w];
    return '<g class="pick" data-w="' + w + '" data-idx="' + idx + '" tabindex="0" role="button" ' +
           'aria-label="' + k.label + '" transform="translate(' + x + ',' + k.sit + ')">' +
           '<title>' + k.label + ' — ' + k.cls + '</title>' +
           '<circle class="pickhalo" cx="0" cy="0" r="20" fill="#5FE3CF" opacity="0"/>' +
           '<ellipse cx="1" cy="' + (467 - k.sit).toFixed(0) + '" rx="13" ry="3.5" fill="#000" opacity=".3"/>' +
           shapeOf(w) + '</g>';
  }).join("");
}

function buildMeters(){
  $("metersEl").innerHTML = BINS.map(function(b, i){
    return '<div class="meter"><div class="top">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + b.col + '"></span>' +
      '<b>' + b.lcd + '</b><span class="chip" id="binChip' + i + '">OK</span>' +
      '<span class="cm" style="margin-left:auto" id="binCm' + i + '">20 cm</span></div>' +
      '<div class="bar"><i id="binBar' + i + '" style="width:0%;background:' + b.col + '"></i></div>' +
      '<div class="foot"><button class="mini" data-empty="' + i + '">Empty this bin</button>' +
      '<span class="cm" style="margin-left:auto" id="binPct' + i + '">0% full</span></div></div>';
  }).join("");
}

/* the three plate corners, one behind each bin, in the current rotation */
function corners(){
  return BINS.map(function(b, i){
    var th = (b.A - W.R) * Math.PI/180, d = Math.cos(th);
    return {
      i: i, d: d,
      x: TRI.x + TRI.R * Math.sin(th),
      y: TRI.y + TRI.R * TRI.k * d,
      h: TRI.h * (0.70 + 0.30 * (d + 1) / 2)     /* rail is shorter further off */
    };
  });
}

function railSeam(P, Q, f){
  return '<path d="M ' + P.x.toFixed(1) + ' ' + (P.y - P.h*f).toFixed(1) +
         ' L ' + Q.x.toFixed(1) + ' ' + (Q.y - Q.h*f).toFixed(1) +
         '" stroke="#8E6C36" stroke-width="1.5" opacity=".5" fill="none"/>';
}

/* One rail panel per edge of the triangle. Every edge is drawn behind the bins;
   the edges facing the viewer are drawn a second time in front of them, so a
   near bin really does sit inside the rail instead of on top of it.          */
function rail(C, nearOnly){
  var out = "", k;
  for(k = 0; k < 3; k++){
    var P = C[k], Q = C[(k+1) % 3];
    var near = ((P.d + Q.d) / 2) > 0;
    if(nearOnly && !near) continue;
    out += '<path d="M ' + P.x.toFixed(1) + ' ' + P.y.toFixed(1) +
           ' L ' + Q.x.toFixed(1) + ' ' + Q.y.toFixed(1) +
           ' L ' + Q.x.toFixed(1) + ' ' + (Q.y - Q.h).toFixed(1) +
           ' L ' + P.x.toFixed(1) + ' ' + (P.y - P.h).toFixed(1) +
           ' Z" fill="' + (near ? "#C9A063" : "#A87F4C") + '" stroke="#6E4E24" stroke-width="2"/>' +
           railSeam(P, Q, 0.34) + railSeam(P, Q, 0.68) +
           '<path d="M ' + P.x.toFixed(1) + ' ' + (P.y - P.h).toFixed(1) +
           ' L ' + Q.x.toFixed(1) + ' ' + (Q.y - Q.h).toFixed(1) +
           '" stroke="' + (near ? "#E4C48E" : "#CBA163") + '" stroke-width="3" fill="none"/>';
  }
  C.forEach(function(c){
    if(nearOnly && c.d <= 0) return;
    out += '<rect x="' + (c.x-4).toFixed(1) + '" y="' + (c.y-c.h).toFixed(1) +
           '" width="8" height="' + c.h.toFixed(1) + '" fill="#8E6C36" stroke="#6E4E24" stroke-width="1"/>';
  });
  return out;
}

/* The plate, the rail and the three bins were handed to the browser as fresh
   SVG on every frame, whether or not anything had moved — six kilobytes of
   markup to parse, sixty times a second, for a machine standing still. It is
   the same trick the side views already use: work out what the drawing would
   say, and write nothing if it says what it said last time.               */
var sceneSig = "";
function drawScene(){
  var sig = W.R.toFixed(2) + "|" + W.level.join(",") + "|" + DISP_MODE + "|" +
            BINS.map(function(b, i){ return (binAway(i) ? "a" : "") + (linerGone(i) ? "l" : "") + "."; }).join("");
  if(sig === sceneSig) return;
  sceneSig = sig;
  var C = corners();

  $("railBack").innerHTML  = rail(C, false);
  $("railFront").innerHTML = rail(C, true);

  /* triangular plywood plate, with its cut edge showing below the near side */
  var top = C.map(function(c){ return c.x.toFixed(1) + "," + c.y.toFixed(1); }).join(" ");
  var low = C.map(function(c){ return c.x.toFixed(1) + "," + (c.y + TRI.edge).toFixed(1); }).join(" ");
  var bolts = "", k;
  for(k = 0; k < 3; k++){
    var a = (BINS[k].A + 60 - W.R) * Math.PI/180;
    bolts += '<circle cx="' + (TRI.x + TRI.R*0.42*Math.sin(a)).toFixed(1) +
             '" cy="' + (TRI.y + TRI.R*TRI.k*0.42*Math.cos(a)).toFixed(1) +
             '" r="4" fill="#5E1E36" opacity=".8"/>';
  }
  $("plate").innerHTML =
    '<polygon points="' + low + '" fill="#6E2340"/>' +
    '<polygon points="' + top + '" fill="url(#platG)" stroke="#5E1E36" stroke-width="3"/>' +
    '<ellipse cx="' + (TRI.x - 52) + '" cy="' + (TRI.y - 6) + '" rx="58" ry="17" fill="url(#spec)" opacity=".3"/>' +
    bolts +
    '<circle cx="' + TRI.x + '" cy="' + TRI.y + '" r="11" fill="#5E1E36"/>';

  /* bins, back to front */
  var order = BINS.map(function(b, i){
    var th = b.A - W.R, c = Math.cos(th*Math.PI/180);
    return {b:b, i:i, th:th, d:c, p:pos(th, 1)};
  }).sort(function(x, z){ return x.d - z.d; });

  $("binsG").innerHTML = order.map(function(o){
    var s = 0.70 + 0.30 * (o.d + 1) / 2;
    var lv = W.level[o.i];
    var yTop = -3 - lv/100 * 106;
    var rx = 41 + 17 * ((-yTop - 3) / 117);
    var isFront = (o.d > 0.80);
    var head = '<g transform="translate(' + o.p.x.toFixed(1) + ',' + o.p.y.toFixed(1) + ') scale(' + s.toFixed(3) + ')" ' +
                 'opacity="' + (0.74 + 0.26*(o.d+1)/2).toFixed(2) + '">' +
      '<ellipse cx="0" cy="5" rx="48" ry="10" fill="#000" opacity=".32" filter="url(#blurXS)"/>';
    /* the bin itself is off the platform, in somebody's hands */
    if(binAway(o.i)) return head + '<ellipse cx="0" cy="-2" rx="44" ry="11" fill="#000" opacity=".18"/></g>';
    var lined = (DISP_MODE === "liner") && !linerGone(o.i);
    return head +
      '<path d="' + BIN_PATH + '" fill="url(#binG)"/>' +
      '<g clip-path="url(#binClip)">' +
        '<rect x="-64" y="-120" width="128" height="16" fill="#14181A"/>' +
        '<rect x="-64" y="-104" width="128" height="32" fill="' + o.b.col + '"/>' +
        '<rect x="-64" y="-104" width="128" height="4" fill="#000" opacity=".22"/>' +
        '<rect x="-64" y="-76" width="128" height="4" fill="#000" opacity=".22"/>' +
        '<ellipse cx="-30" cy="-50" rx="12" ry="50" fill="url(#spec)" opacity=".35"/>' +
      '</g>' +
      '<ellipse cx="0" cy="-120" rx="58" ry="16" fill="#080B0C"/>' +
      (lv > 0 ? '<ellipse cx="0" cy="' + yTop.toFixed(1) + '" rx="' + rx.toFixed(1) + '" ry="' +
                (rx*0.28).toFixed(1) + '" fill="' + o.b.waste + '"/>' +
                '<ellipse cx="0" cy="' + yTop.toFixed(1) + '" rx="' + rx.toFixed(1) + '" ry="' +
                (rx*0.28).toFixed(1) + '" fill="none" stroke="#000" stroke-width="2" opacity=".25"/>' : '') +
      '<ellipse cx="0" cy="-120" rx="58" ry="16" fill="none" stroke="#14181A" stroke-width="6"/>' +
      '<ellipse cx="0" cy="-123" rx="58" ry="16" fill="none" stroke="#39413F" stroke-width="2"/>' +
      /* the liner, folded over the rim */
      (lined ? '<ellipse cx="0" cy="-124" rx="61" ry="17" fill="none" stroke="#DCE8EA" stroke-width="5.5" opacity=".5"/>' +
               '<path d="M-60 -126 q9 9 19 3 q10 9 20 1 q10 8 21 -3" fill="none" stroke="#F2F7F6" ' +
               'stroke-width="2.6" opacity=".55" stroke-linecap="round"/>' : '') +
      (isFront ? '<ellipse cx="0" cy="-120" rx="65" ry="19" fill="none" stroke="#5FE3CF" stroke-width="3" opacity=".8"/>' : '') +
      '<g class="lbl">' +
        '<rect x="-50" y="-98" width="100" height="20" rx="6" fill="#0D1416" opacity=".8"/>' +
        '<text x="0" y="-84" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" ' +
          'letter-spacing=".3" fill="#EDF3F2">' +
          o.b.lcd.split(" ")[0].toUpperCase() + ' ' + lv + '%</text>' +
      '</g>' +
    '</g>';
  }).join("");
}
function pos(deg, k){
  var r = deg * Math.PI/180;
  return { x: PLAT.x + PLAT.rx*k*Math.sin(r), y: PLAT.y + PLAT.ry*k*Math.cos(r) };
}

function nbsp(s){ return (s||"").slice(0,16).replace(/ /g," "); }

function paintUi(){
  var now = Date.now();

  /* LCD — dark when the adapter is out */
  $("lcdA").textContent = W.mains ? nbsp(W.lcd1) : nbsp("");
  $("lcdB").textContent = W.mains ? nbsp(W.lcd2) : nbsp("");
  $("lcdA").setAttribute("opacity", W.mains ? "1" : "0");
  $("lcdB").setAttribute("opacity", W.mains ? "1" : "0");
  var acLive = POWER.src === "ac" && POWER.plugged;
  $("acLed").setAttribute("fill", POWER.plugged ? (acLive ? "#4BC969" : "#E8A33D") : "#3A4448");
  $("acCord").setAttribute("opacity", POWER.plugged ? (acLive ? "1" : ".6") : ".45");
  $("plugG").setAttribute("transform", POWER.plugged ? "translate(0,0)" : "translate(-26,34) rotate(-12 125 290)");

  /* servo readouts */
  $("tapG").setAttribute("transform", "rotate(" + W.gate.toFixed(1) + " 636 342)");
  $("rotDeg").textContent = "write(" + W.rotVal + ") → " + Math.round(W.R) + "° phys";
  $("gateDeg").textContent = "write(" + W.gateVal + ") → " + (W.gate > 40 ? "open" : "closed");
  chip("chipS1", String(W.rotVal));
  chip("chipS2", String(W.gateVal));

  /* sensors */
  var m = digitalReadPin(0), p = digitalReadPin(1), b = digitalReadPin(2);
  chip("chipInd", m === LOW ? "LOW" : "HIGH", m === LOW ? "hot" : "");
  chip("chipCap", p === LOW ? "LOW" : "HIGH", p === LOW ? "hot" : "");
  chip("chipIr",  b === LOW ? "LOW" : "HIGH", b === LOW ? "hot" : "");
  chip("chipBtn", W.buttonDown ? "LOW" : "HIGH", W.buttonDown ? "hot" : "");
  $("sIndTip").setAttribute("fill", m === LOW ? "#F2685E" : "#3A4244");
  $("sCapTip").setAttribute("fill", p === LOW ? "#EDB43D" : "#3A4244");
  $("sIrTip").setAttribute("fill",  b === LOW ? "#4BC969" : "#3A4244");
  $("proxBeam").setAttribute("opacity", inZone(ZONE.prox) ? ((m === LOW || p === LOW) ? "0.95" : "0.35") : "0");
  $("proxBeam").setAttribute("stroke", m === LOW ? "#F2685E" : (p === LOW ? "#EDB43D" : "#5FE3CF"));
  $("irBeam").setAttribute("opacity", inZone(ZONE.ir) ? (b === LOW ? "0.95" : "0.35") : "0");
  $("irBeam").setAttribute("stroke", b === LOW ? "#4BC969" : "#5FE3CF");

  /* ultrasonic */
  var fb = frontBin();
  chip("chipUs", Math.round(W.distance) + " cm", W.distance <= US_TRIP_CM ? "warn" : "");
  $("usTxt").textContent = Math.round(W.distance) + " cm";
  var surf = (PLAT.y + PLAT.ry) - 3 - (fb >= 0 ? W.level[fb] : 0)/100 * 106;
  $("usBeam").setAttribute("y2", surf.toFixed(1));

  /* LEDs */
  BINS.forEach(function(bb, i){
    var on = W.leds[i] && W.mains;
    $(bb.led).classList.toggle("on", on);
    var e = $(bb.mled);
    e.setAttribute("fill", on ? bb.col : "#2C3234");
    e.setAttribute("stroke", on ? bb.col : "#4A5254");
    e.setAttribute("filter", on ? "url(#glow)" : "none");
  });
  /* the buzzer: while D12 is high the can shakes and pings rings out of
     itself, so the alarm is visible even with the sound muted — and a bar
     across it says the tone has been silenced rather than stopped */
  var buzzLive = W.buzzer && W.mains;
  $("buzzUi").classList.toggle("on", buzzLive);
  $("mBuzz").setAttribute("stroke", buzzLive ? "#5FE3CF" : "#4A5254");
  $("mBuzz").setAttribute("fill", buzzLive ? "#16383A" : "#101416");
  $("buzzMute").setAttribute("opacity", buzzLive && !soundOn ? "1" : "0");
  $("buzzWaves").setAttribute("opacity", buzzLive ? "1" : "0");
  if(buzzLive){
    [["buzzW1", 0], ["buzzW2", 300]].forEach(function(wv){
      var ph = ((now + wv[1]) % 600) / 600;
      $(wv[0]).setAttribute("r", (12 + 13 * ph).toFixed(1));
      $(wv[0]).setAttribute("opacity", (0.85 * (1 - ph)).toFixed(2));
    });
    $("buzzUnit").setAttribute("transform",
      "translate(" + (Math.sin(now / 24) * 0.9).toFixed(2) + ",0)");
  } else $("buzzUnit").setAttribute("transform", "translate(0,0)");

  /* the D10 button: the cap really travels, the barrel shadow deepens under
     it and a ring snaps off the press, so a press the presentation makes on
     your behalf looks like somebody's thumb and not a state change */
  $("btnCap").setAttribute("cy", W.buttonDown ? 733 : 729);
  $("btnCap").setAttribute("fill", W.buttonDown ? "#C2A20F" : "#E8C433");
  $("btnShade").setAttribute("opacity", W.buttonDown ? "0.55" : "0.18");
  var pressAge = now - btnFlash;
  if(pressAge < 460){
    var bp = pressAge / 460;
    $("btnRing").setAttribute("opacity", (0.85 * (1 - bp)).toFixed(2));
    $("btnRing").setAttribute("r", (13 + 17 * bp).toFixed(1));
  } else $("btnRing").setAttribute("opacity", "0");

  /* meters */
  BINS.forEach(function(bb, i){
    var cm = Math.round(binDistance(W.level[i]));
    $("binBar"+i).style.width = W.level[i] + "%";
    $("binCm"+i).textContent = cm + " cm";
    $("binPct"+i).textContent = W.level[i] + "% full";
    chip("binChip"+i, W.level[i] >= 100 ? "FULL" : "OK", W.level[i] >= 100 ? "warn" : "");
  });

  /* pulse around the waste wherever it currently sits */
  var sr = $("scanRing");
  if(stuckNow){ /* the stuck warning owns the ring */ }
  else if(item && !item.falling && !item.onBelt){
    var ph = (now % 900) / 900;
    sr.setAttribute("cy", item.y.toFixed(1));
    sr.setAttribute("opacity", (0.75*(1-ph)).toFixed(2));
    sr.setAttribute("rx", (34 + 30*ph).toFixed(1));
    sr.setAttribute("ry", (11 + 9*ph).toFixed(1));
  } else sr.setAttribute("opacity", "0");

  /* status strip */
  $("stateTag").textContent = G.operationsEnabled ? "loop()" : "LOCKED OUT";
  $("fTurn").textContent = (fb >= 0 ? BINS[fb].lcd + " under the hole" : "turning…") +
                           " — write(" + W.rotVal + ")";
  $("fTap").textContent = W.gate > 40 ? "open — releasing" : "closed — holding";
  $("fItem").textContent = item
    ? KIND[item.kind].label +
      (item.onBelt ? " — on the conveyor" :
       item.retrieving ? " — being taken back out" :
       item.held ? " — held at stage 1" :
       (inZone(ZONE.ir) ? " — resting on the tap" : " — in the throat"))
    : "empty";

  /* alert */
  $("alertFull").classList.toggle("show", !G.operationsEnabled);
  if(!G.operationsEnabled)
    $("alertTxt").textContent = "operationsEnabled = false — everything is blocked until D10 is pressed.";

  /* manual disposal overlay + the disposal-station glow */
  var dispOn = !G.operationsEnabled, i = disposal.binIdx;
  $("dispOverlay").setAttribute("opacity", dispOn ? "1" : "0");
  $("dispOverlay").setAttribute("pointer-events", dispOn ? "auto" : "none");
  if(dispOn && i >= 0){
    var db = BINS[i];
    $("dispSub").textContent = db.lcd + " bin is full — carry it out and empty it before the machine can restart.";
    $("dispSub2").setAttribute("opacity", (disposal.phase === "idle" || disposal.phase === "done") ? "1" : "0");
    $("dispSub2").textContent = disposal.phase === "done"
      ? "Emptied into the " + db.lcd.toLowerCase() + " disposal bin. Press the D10 button to resume."
      : DISP_MODE === "liner"
        ? "Lift the liner out by the neck and drop the whole bag in the matching " + db.lcd.toLowerCase() + " bin, on the right."
        : "Take the bin off the plate and tip it into the matching " + db.lcd.toLowerCase() + " disposal bin, on the right.";
  }
  var showBtn1 = dispOn && disposal.phase === "idle";
  $("dispBtn2").setAttribute("opacity", showBtn1 ? "1" : "0");
  $("dispBtn2").setAttribute("pointer-events", showBtn1 ? "auto" : "none");
  $("linerHtmlBtn").style.display = showBtn1 ? "" : "none";
  var pointToButton = dispOn && disposal.phase === "done";
  var busy = dispOn && !!DISP_BUSY[disposal.phase];
  $("dispBtn1").setAttribute("opacity", showBtn1 ? "1" : "0");
  $("dispBtn1").setAttribute("pointer-events", showBtn1 ? "auto" : "none");
  $("dispStatus").setAttribute("opacity", busy ? "1" : "0");
  $("dispStatus").textContent = disposal.phase === "lifting"
    ? (DISP_MODE === "liner" ? "Lifting the liner out\u2026" : "Taking the bin off the plate\u2026")
    : disposal.phase === "returning" ? "Putting the empty bin back\u2026" : "Carrying it over\u2026";
  $("disposeHtmlBtn").style.display = showBtn1 ? "" : "none";
  if(pointToButton){
    var bph = (now % 1100) / 1100;
    $("btnBoardHalo").setAttribute("opacity", (0.9 * (1 - bph)).toFixed(2));
    $("btnBoardHalo").setAttribute("r", (24 + 14*bph).toFixed(1));
  } else $("btnBoardHalo").setAttribute("opacity", "0");
  DISP_HINGE.forEach(function(_, k){
    var el = $("dispHalo" + k), glowOn = dispOn && i === k;
    if(glowOn){
      var ph = (now % 1100) / 1100;
      el.setAttribute("opacity", (0.85 * (1 - ph)).toFixed(2));
      el.setAttribute("rx", (40 + 14*ph).toFixed(1));
      el.setAttribute("ry", (52 + 14*ph).toFixed(1));
    } else el.setAttribute("opacity", "0");
  });

  /* step rail from the trace */
  var map = {dm:"dm-us", full:"dm-full", read:"hw-read", rot:"ms-1", wait:"ms-d1", gate:"ms-2", home:"hw-reset"};
  document.querySelectorAll(".step").forEach(function(st){
    var k = map[st.getAttribute("data-s")], age = now - (hits[k] || 0);
    st.classList.toggle("active", age < 320);
    st.classList.toggle("done", age >= 320 && age < 1800);
  });

  var idle = (W.itemKind === null && !item);
  document.querySelectorAll(".pick[data-w]").forEach(function(n){
    n.classList.toggle("off", !idle);
    n.setAttribute("aria-disabled", String(!idle));
  });
}
function chip(id, txt, cls){ var e = $(id); e.textContent = txt; e.className = "chip" + (cls ? " " + cls : ""); }

/* ====================== the defense panel =========================
   Three people who watch, blink, murmur to each other, think it over and
   write on their score sheets. They also react to what the machine does.  */
var PANS = [
  {pivot:[165,143], eyeX:[157,173], eyeY:123, shoulder:[180,190], inkLen:34},
  {pivot:[281,143], eyeX:[275,288], eyeY:124, shoulder:[296,190], inkLen:34},
  {pivot:[397,143], eyeX:[391,404], eyeY:122, shoulder:[412,190], inkLen:36}
];
var pan = PANS.map(function(_, i){
  return {mode:"watch", until:0, blinkUntil:0, nextBlink:Date.now() + i*900 + 1200,
          tilt:(i === 1 ? 1 : -1), ink:0};
});

function pickMode(p){
  var now = Date.now();
  if(p.mode !== "watch"){                       /* always settle back to watching */
    p.mode = "watch"; p.until = now + 1400 + Math.random()*3200; return;
  }
  var r = Math.random();
  p.mode = r < 0.38 ? "write" : (r < 0.68 ? "talk" : "think");
  p.until = now + 1700 + Math.random()*2300;
  p.tilt = Math.random() < 0.5 ? -1 : 1;
}

/* nudge one of them when the machine does something worth noting */
function panelReact(evt){
  var p = pan[Math.floor(Math.random() * pan.length)], now = Date.now();
  if(evt === "detect"){ p.mode = "write"; p.until = now + 2200; }
  else if(evt === "full"){ p.mode = "talk";  p.until = now + 2600; }
  else if(evt === "stuck"){ p.mode = "think"; p.until = now + 3000; }
}

/* ---------------------- applause ----------------------------------
   When the defense is over the three of them put the pen down and clap.
   Each pair of hands swings about its own shoulders, at its own speed,
   and re-rolls that speed every clap — three people clapping never stay
   in step for long, and a metronome is the one thing that reads as fake.
   The crack you hear is fired from the animation, on the frame the palms
   actually meet, so what you see and what you hear are the same event. */
var applause = {on:false, start:0, until:0, level:0, dt:0, t:0, hands:[]};
var panelWarm = 0;              /* they stay pleased for a while afterwards */

function startApplause(ms){
  var now = Date.now();
  applause.on = true;
  applause.start = now;
  applause.until = now + (ms || 8000);
  applause.level = 0;
  /* the chair leads, the other two come in half a beat behind */
  applause.hands = PANS.map(function(_, i){
    return {ph:Math.random() * 0.3, rate:3.8 + Math.random() * 1.4,
            at:now + [260, 0, 420][i] + Math.random() * 180, hit:0};
  });
  PANS.forEach(function(_, i){
    $("pan" + i + "Clap").setAttribute("opacity", "1");
    $("pan" + i + "Arm").setAttribute("opacity", "0");
  });
}
function stopApplause(){
  if(!applause.on) return;
  applause.on = false; applause.level = 0;
  PANS.forEach(function(_, i){
    var id = "pan" + i;
    $(id + "Clap").setAttribute("opacity", "0");
    $(id + "Fx").setAttribute("opacity", "0");
    $(id + "Smile").setAttribute("opacity", "0");
    $(id + "Mouth").setAttribute("opacity", "1");
    $(id + "ClapL").removeAttribute("transform");
    $(id + "ClapR").removeAttribute("transform");
    $(id + "Arm").setAttribute("opacity", "1");
  });
}
/* ramps in over half a second, holds, and dies away at the end */
function stepApplause(now){
  applause.dt = Math.min(0.05, (now - (applause.t || now)) / 1000);
  applause.t = now;
  if(!applause.on){ applause.level = 0; return; }
  applause.level = Math.max(0, Math.min(1,
    Math.min((now - applause.start) / 520, (applause.until - now) / 1700)));
}
/* one pair of hands, this frame */
function stepClap(p, i, now, t){
  var h = applause.hands[i], id = "pan" + i;
  if(!h) return;
  if(now < h.at){                       /* not in yet — hands still at rest */
    $(id + "ClapL").removeAttribute("transform");
    $(id + "ClapR").removeAttribute("transform");
    return;
  }
  var lvl = applause.level;
  h.ph += applause.dt * h.rate * (0.6 + 0.4 * lvl);
  if(h.ph >= 1){                        /* palms meet: crack, flash, new tempo */
    h.ph -= 1;
    h.rate = 3.6 + Math.random() * 1.8;
    h.hit = now;
    clapSound(i, lvl);
  }
  /* 0 at contact, widest half way through — the arc, not a sideways slide */
  var swing = Math.pow(Math.sin(Math.PI * h.ph), 0.62) * 21 * (0.45 + 0.55 * lvl);
  var cx = PANS[i].pivot[0], sy = 190;
  $(id + "ClapL").setAttribute("transform",
    "rotate(" + (-swing).toFixed(2) + " " + (cx - 17) + " " + sy + ")");
  $(id + "ClapR").setAttribute("transform",
    "rotate(" + swing.toFixed(2) + " " + (cx + 17) + " " + sy + ")");
  var flash = h.hit ? Math.max(0, 1 - (now - h.hit) / 150) : 0;
  $(id + "Fx").setAttribute("opacity", (flash * 0.8 * lvl).toFixed(2));
}

/* the sound of two palms: a short crack of filtered noise, with a duller
   tail under it for the room. Every clap is detuned a little, so no two
   of them land on the same timbre.                                      */
var noiseBuf = null;
function noiseBuffer(a){
  if(noiseBuf && noiseBuf.sampleRate === a.sampleRate) return noiseBuf;
  var n = Math.floor(a.sampleRate * 0.4), b = a.createBuffer(1, n, a.sampleRate),
      d = b.getChannelData(0);
  for(var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}
function clapSound(i, lvl){
  if(!soundOn) return;
  var a = ac(); if(!a) return;
  var t = a.currentTime, vol = (0.055 + Math.random() * 0.03) * Math.max(0.2, lvl);
  var src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.playbackRate.value = 0.85 + Math.random() * 0.4;

  var bp = a.createBiquadFilter();                 /* the crack */
  bp.type = "bandpass";
  bp.frequency.value = 950 + i * 230 + Math.random() * 600;
  bp.Q.value = 0.75;
  var g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11 + Math.random() * 0.06);

  var lp = a.createBiquadFilter();                 /* the room under it */
  lp.type = "lowpass"; lp.frequency.value = 1400;
  var g2 = a.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(vol * 0.55, t + 0.012);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);

  src.connect(bp); bp.connect(g); g.connect(a.destination);
  src.connect(lp); lp.connect(g2); g2.connect(a.destination);
  src.start(t); src.stop(t + 0.35);
}

var LEAN = [7, 0, -7];                  /* which way each of them turns to confer */
function updatePanel(){
  var now = Date.now(), t = now / 1000;
  stepApplause(now);
  pan.forEach(function(p, i){
    var P = PANS[i], id = "pan" + i;
    /* during an interview the panel is not idle chatter any more: whoever holds
       the question is talking, the other two sit back and take notes           */
    if(applause.on){
      /* nobody is scoring anything now — the pen is down and both hands are up */
      p.mode = "clap";
      $(id).setAttribute("opacity", "1");
      stepClap(p, i, now, t);
    } else if(iv && iv.on && iv.phase === "confer"){
      p.mode = "confer";
      $(id).setAttribute("opacity", "1");
      $(id + "Arm").setAttribute("opacity", "1");
    } else if(pres.on || (iv && iv.on && iv.phase === "intro")){
      /* the group is on its feet introducing itself: all three watch, nobody
         is scoring anything yet, and the chair answers at the end            */
      $(id).setAttribute("opacity", "1");
      $(id + "Arm").setAttribute("opacity", "1");
      if(iv.side === "panel" && i === iv.speaker && (!!iv.utter || iv.reveal < 1)){
        p.mode = "talk"; p.until = now + 400;
      } else if(now > p.until){
        p.mode = "watch"; p.until = now + 1800 + Math.random() * 2400;
      }
    } else if(iv && iv.on && ASK_PHASE[iv.phase]){
      if(i === iv.speaker && SPEAK_PHASE[iv.phase] && !iv.paused){
        p.mode = "talk"; p.until = now + 400;
      } else if(now > p.until){
        p.mode = (i === iv.speaker) ? "watch" : (Math.random() < 0.4 ? "write" : "watch");
        p.until = now + 1900 + Math.random()*2600;
      }
      var lit = (iv.speaker < 0 || i === iv.speaker || !!CLOSING[iv.phase]);
      $(id).setAttribute("opacity", lit ? "1" : "0.5");
      $(id + "Arm").setAttribute("opacity", lit ? "1" : "0.5");
    } else {
      if(iv && iv.on){ $(id).setAttribute("opacity", "1"); $(id + "Arm").setAttribute("opacity", "1"); }
      if(now > p.until) pickMode(p);
    }
    if(now > p.nextBlink){                       /* a blink, then the next one */
      p.blinkUntil = now + 105;
      p.nextBlink = now + 2400 + Math.random()*4200;
    }
    var blink = now < p.blinkUntil;

    /* head: nodding while talking, tilted while thinking, down while writing */
    var tilt = 0, bob = 0;
    if(p.mode === "talk")       { tilt = Math.sin(t*3.1 + i) * 2.2; bob = Math.sin(t*6.2 + i) * 0.7; }
    else if(p.mode === "think") { tilt = p.tilt * 7; }
    else if(p.mode === "write") { tilt = 9; bob = 1.6; }
    else if(p.mode === "clap")  { tilt = Math.sin(t*3.4 + i*1.3) * 2.0;
                                  bob  = -1.5 + Math.sin(t*6.4 + i) * 0.8; }
    else if(p.mode === "confer"){ tilt = LEAN[i] + Math.sin(t*2.3 + i) * 1.5; bob = 0.9; }
    else                        { tilt = Math.sin(t*0.7 + i*2) * 1.2; }
    $(id + "Head").setAttribute("transform",
      "rotate(" + tilt.toFixed(2) + " " + P.pivot[0] + " " + P.pivot[1] + ") translate(0," + bob.toFixed(2) + ")");

    /* eyes: squeeze shut on a blink, look up when thinking, down when writing */
    var glad = (p.mode === "clap") || (now < panelWarm && p.mode !== "talk");
    var dy = p.mode === "think" ? -1.3 : (p.mode === "write" ? 1.5 :
             (p.mode === "clap" ? -0.9 : (p.mode === "confer" ? 0.4 : 0)));
    var dx = p.mode === "think" ? p.tilt * 1.4 :
             (p.mode === "confer" ? (i === 1 ? Math.sin(t*0.9) * 1.5 : (i === 0 ? 1.6 : -1.6)) : 0);
    ["EyeL", "EyeR"].forEach(function(e, k){
      var n = $(id + e);
      n.setAttribute("ry", blink ? "0.25" : (glad ? "1.15" : "2.2"));
      n.setAttribute("cy", (P.eyeY + dy).toFixed(2));
      n.setAttribute("cx", (P.eyeX[k] + dx).toFixed(2));
    });

    /* mouth: opens and closes while talking, and turns up while they clap */
    var m = $(id + "Mouth");
    var saying = (p.mode === "clap" || p.mode === "confer") &&
                 (i === iv.speaker) && !!iv.text && (!!iv.utter || iv.reveal < 1);
    var smiling = glad && !saying;
    $(id + "Smile").setAttribute("opacity", smiling ? "1" : "0");
    m.setAttribute("opacity", smiling ? "0" : "1");
    if(p.mode === "talk" || saying || (p.mode === "confer" && Math.sin(t*1.7 + i*2) > -0.2)){
      m.setAttribute("ry", (0.8 + 2.1 * Math.abs(Math.sin(t*8.5 + i*1.7))).toFixed(2));
      m.setAttribute("rx", "3.6");
    } else {
      m.setAttribute("ry", p.mode === "think" ? "1.1" : "0.6");
      m.setAttribute("rx", p.mode === "think" ? "2.4" : "3.4");
    }

    /* writing arm rocks about the shoulder, and the ink fills in */
    var writing = (p.mode === "write");
    var a = writing ? Math.sin(t*7.5 + i) * 3.2 : 0;
    $(id + "Arm").setAttribute("transform",
      "rotate(" + a.toFixed(2) + " " + P.shoulder[0] + " " + P.shoulder[1] + ")");
    if(writing) p.ink = Math.min(1, p.ink + 0.006);
    $(id + "Ink").setAttribute("stroke-dashoffset", (P.inkLen * (1 - p.ink)).toFixed(1));

    /* thought bubble, dots rippling */
    var think = (p.mode === "think");
    $(id + "Bub").setAttribute("opacity", think ? "1" : "0");
    if(think) for(var d = 0; d < 3; d++)
      $(id + "D" + d).setAttribute("r", (1.3 + 0.8 * Math.abs(Math.sin(t*4 - d*0.7))).toFixed(2));
  });
}

/* ---------------------- the group, animated ------------------------
   They stand, they shift their weight, they blink, and whoever is speaking
   moves their mouth and nods. When the panel applauds at the end they smile
   and take one small bow — which is the whole reason they are drawn.      */
var stu = null;                    /* built on the first frame: STU is declared below */
var bowAt = 0;
function updateStudents(){
  if(!stu) stu = STU.map(function(_, i){
    return {mode:"stand", until:0, blinkUntil:0, nextBlink:Date.now() + i * 640 + 900,
            lean:(i % 2 ? 1 : -1)};
  });
  var now = Date.now(), t = now / 1000;
  var intro = (iv.on && iv.phase === "intro") || pres.on;
  var glad  = applause.on || now < panelWarm;
  var bow   = bowAt ? Math.max(0, 1 - Math.abs((now - bowAt) / 700 - 1)) : 0;
  if(bowAt && now > bowAt + 1400) bowAt = 0;

  stu.forEach(function(p, i){
    var id = "stu" + i;
    var answering = answeringNow() && i === iv.answerBy;
    var speaking = ((iv.on || pres.on) && iv.side === "students" && i === iv.speaker &&
                    !!iv.text && (!!iv.utter || iv.reveal < 1)) ||
                   (answering && !!iv.reading);
    if(speaking){ p.mode = "talk"; p.until = now + 300; }
    else if(glad){ p.mode = "glad"; }
    else if(now > p.until){
      p.mode = intro ? "listen" : (Math.random() < 0.22 ? "shift" : "stand");
      p.until = now + 2400 + Math.random() * 3400;
      p.lean = Math.random() < 0.5 ? -1 : 1;
    }
    if(now > p.nextBlink){
      p.blinkUntil = now + 105;
      p.nextBlink = now + 2600 + Math.random() * 4600;
    }
    var blink = now < p.blinkUntil;

    /* the whole figure: a slow weight shift, and the bow at the end */
    var sway = Math.sin(t * 0.55 + i * 1.9) * (p.mode === "shift" ? 1.1 : 0.45);
    $(id).setAttribute("transform",
      "translate(" + (sway * 1.6).toFixed(2) + "," + (bow * 7).toFixed(2) + ") " +
      "rotate(" + (sway * 0.5).toFixed(2) + " 0 0)");

    /* the head: nodding while speaking, dipped through the bow */
    var tilt = bow * 15;
    if(p.mode === "talk")        tilt += Math.sin(t * 3.2 + i) * 2.1;
    else if(p.mode === "listen") tilt += Math.sin(t * 0.8 + i) * 1.3 + p.lean * 1.2;
    else if(p.mode === "glad")   tilt += Math.sin(t * 2.4 + i) * 1.6;
    else                         tilt += Math.sin(t * 0.6 + i * 2) * 1.0;
    $(id + "Head").setAttribute("transform", "rotate(" + tilt.toFixed(2) + " 0 -150)");

    var happy = (p.mode === "glad") && !speaking;
    ["EyeL", "EyeR"].forEach(function(e){
      $(id + e).setAttribute("ry", blink ? "0.25" : (happy ? "1.15" : "2.2"));
    });
    var m = $(id + "Mouth");
    $(id + "Smile").setAttribute("opacity", happy ? "1" : "0");
    m.setAttribute("opacity", happy ? "0" : "1");
    if(p.mode === "talk"){
      m.setAttribute("ry", (0.7 + 2.0 * Math.abs(Math.sin(t * 8.5 + i * 1.7))).toFixed(2));
      m.setAttribute("rx", "3.4");
    } else {
      m.setAttribute("ry", "0.6"); m.setAttribute("rx", "3.2");
    }

    /* whoever holds the floor is lit, the rest of the group stands back */
    var lit = answeringNow() ? answering
            : (!intro || iv.side !== "students" || iv.speaker < 0 || i === iv.speaker);
    $(id + "Pos").setAttribute("opacity", lit ? "1" : "0.55");
  });
}

/* ====================== the panel interview ==========================
   A practice defense. One panelist at a time asks a question: a speech
   bubble opens above them with a tail pointing down at their head, the
   question is spoken aloud, and then a clock runs while you answer out
   loud. Default is one minute per answer; the slider changes it, live.
   Nothing here touches the sketch simulation — it only reads it.       */

/* ---------------- the group defending, and the time of day -------------
   Five of them stand at the infeed. The greeting everybody uses is read off
   the clock when the interview starts, so nobody says "good morning" to a
   defense that is running at four in the afternoon. The wall clock in the
   scene is set from the same reading.                                     */
var STU = [
  {feet:[150,748], s:0.90, role:"Testing"},
  {feet:[298,744], s:0.90, role:"Documentation"},
  {feet:[76,806],  s:1.08, role:"Hardware"},
  {feet:[222,810], s:1.10, role:"Leader"},
  {feet:[368,802], s:1.07, role:"Programmer"}
];
var STU_HEAD = [{x:150,y:573}, {x:298,y:569}, {x:76,y:597}, {x:222,y:597}, {x:368,y:594}];
var LEADER = 3, SECOND = 2;          /* who greets, and who gives the highlight */
/* Which member takes which kind of question. It is the same split the
   presentation uses: the leader opens, closes and handles anything thrown at
   the group, the hardware member owns the build, the programmer owns the
   sketch, the testing member owns the numbers, and the documentation member
   owns the limitations. Anything unmapped falls to the leader.            */
var ANSWERER = {Opening:LEADER, Concept:LEADER, Impact:LEADER, Strength:LEADER,
                Curveball:LEADER, Closing:LEADER,
                Design:2, Code:4, Testing:0, Limitations:1};
function answererFor(cat){
  var i = ANSWERER[cat];
  return i === undefined ? LEADER : i;
}
/* `sex` is read straight off the drawing, and it is what picks the voice: the
   figure in the skirt with the ponytail must not be given Microsoft David.
   stu0 skirt + ponytail + clip, stu3 skirt + long hair; the other three are in
   trousers with short hair.                                                 */
var STUDENTS = [
  {name:"Group", role:"Testing",       col:"#2B4C7E", pitch:1.24, rate:1.00, vi:3, sex:"f"},
  {name:"Group", role:"Documentation", col:"#2B4C7E", pitch:0.92, rate:0.98, vi:4, sex:"m"},
  {name:"Group", role:"Hardware",      col:"#2B4C7E", pitch:0.97, rate:1.01, vi:5, sex:"m"},
  {name:"Group", role:"Leader",        col:"#2B4C7E", pitch:1.30, rate:1.02, vi:6, sex:"f"},
  {name:"Group", role:"Programmer",    col:"#2B4C7E", pitch:0.86, rate:0.97, vi:7, sex:"m"}
];
function roster(side){ return side === "students" ? STUDENTS : PANELISTS; }
function headOf(side, i){ return (side === "students" ? STU_HEAD : HEAD_TOP)[i]; }

/* 5am-noon morning, noon-6pm afternoon, otherwise evening */
function greeting(){
  var h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning"
       : h < 18 ? "Good afternoon" : "Good evening";
}
/* the bank is written with "Good morning" in it; this pulls every greeting in
   it — including one already swapped — onto the greeting that is true now    */
function withGreeting(t){
  return t.replace(/\bGood (?:morning|afternoon|evening)\b/g, greeting());
}
var greetNow = "";
function applyGreeting(){
  if(greetNow === greeting()) return false;
  greetNow = greeting();
  QBANK.forEach(function(q){
    q.q = withGreeting(q.q);
    q.a = q.a.map(withGreeting);
    if(q.s) q.s = q.s.map(function(v){ return [v[0], withGreeting(v[1])]; });
    if(q.f) q.f = q.f.map(function(v){ return [withGreeting(v[0]), withGreeting(v[1])]; });
  });
  Object.keys(PROBES).forEach(function(c){
    PROBES[c] = PROBES[c].map(function(v){ return [withGreeting(v[0]), withGreeting(v[1])]; });
  });
  return true;
}
function groupName(){
  var v = ($("ivGroup").value || "").trim();
  return v || "Group 3";
}
/* the wall clock reads the real time, so the room agrees with the greeting */
var clockAt = 0;
function setWallClock(){
  var d = new Date(), m = d.getMinutes();
  $("clockH").setAttribute("transform", "rotate(" + ((d.getHours() % 12) * 30 + m * 0.5).toFixed(1) + " 822 92)");
  $("clockM").setAttribute("transform", "rotate(" + (m * 6) + " 822 92)");
  clockAt = Date.now();
}

/* pan0 glasses and short hair, pan1 long hair, pan2 the beard */
var PANELISTS = [
  {name:"Panelist 1", role:"Technical",  col:"#4A5568", pitch:0.85, rate:1.00, vi:0, sex:"m"},
  {name:"Panelist 2", role:"Research",   col:"#6B4E3D", pitch:1.20, rate:1.03, vi:1, sex:"f"},
  {name:"Panelist 3", role:"Impact",     col:"#3D5A66", pitch:0.70, rate:0.93, vi:2, sex:"m"}
];
/* where each bubble's tail lands: the top of that panelist's head */
var HEAD_TOP = [{x:165, y:102}, {x:281, y:99}, {x:397, y:102}];

var QBANK = [
/* ---------- panelist 1 · the code and the hardware ---------- */
{p:0, cat:"Code", q:"Walk us through one pass of your loop(). What runs first, and why that order?",
 s:[["The full answer",
      "loop calls detectionMaintenance first. That function fires the ultrasonic sensor, converts the echo to centimetres, prints it to serial, and then decides whether the machine is allowed to run at all. If it returns true the pass ends immediately, because either a bin is full, or operationsEnabled is false and we are waiting for the D10 button. Only if it returns false does handleWasteDetection run, reading the three sensor pins and acting on them. Then delay five hundred. So the safety check happens before the sorting, every pass, and the machine looks at the world about twice a second."],
     ["Shorter",
      "detectionMaintenance first: read the ultrasonic sensor and decide whether the machine may run at all. If a bin is full, or we are locked out, the pass ends there. Otherwise handleWasteDetection reads the three sensor pins and acts on them. Then delay five hundred. Safety before sorting, every pass."]], a:[
  "<code>loop()</code> calls <code>detectionMaintenance()</code> first. It fires the HC-SR04, converts the echo to centimetres and prints it, then decides whether the machine is allowed to run at all.",
  "If that returns true the pass ends right there &mdash; either a bin is full, or <code>operationsEnabled</code> is false and we are waiting on the D10 button.",
  "Only when it returns false does <code>handleWasteDetection()</code> read the three sensor pins and act on them.",
  "Then <code>delay(500)</code>. So the machine looks at the world about twice a second. Safety check first, sorting second &mdash; that order is deliberate."]},

{p:0, cat:"Design", q:"Why two detection stages? Why not one sensor that does everything?",
 s:[["The full answer",
      "Because the two kinds of sensor answer different questions. The inductive and capacitive heads at the throat can name a material, but only while the item is held in the gap between them, so they need the item presented. The infrared module at the gate cannot name anything at all. It only reports that an object is in front of it. So stage one identifies metal and plastic, and stage two catches whatever reached the gate without being identified, and we classify that as biodegradable. That is exactly why our procedure says to present plastic and metal, and simply drop biodegradable waste."],
     ["Shorter",
      "Because the proximity heads can name a material but only while the item is held in their gap, and the infrared sensor can see anything but name nothing. Stage one identifies metal and plastic. Stage two catches whatever is left, and we call that biodegradable."]], a:[
  "Stage 1 is the inductive head on D4 and the capacitive head on D3, facing each other across the throat. They read reliably only when the item is held at their gap, but they can name the material.",
  "Stage 2 is the IR obstacle module on D7, looking across the face of the closed gate. It cannot name anything &mdash; it only says <i>something is here</i>.",
  "So stage 1 identifies metal and plastic; anything that reaches the gate without having been named is treated as bio.",
  "That is exactly why plastic and metal are <b>presented</b> to the mouth and bio is simply <b>dropped</b>."]},

{p:0, cat:"Code", q:"Both heads go LOW when I feed a tin can in. How does your code decide it is metal and not plastic?",
 s:[["The full answer",
      "By order, and by one guard. The metal branch is tested first and unconditionally. If val metal is LOW we set metalDetected true. The plastic branch is guarded with and not metalDetected, so even though the can also trips the capacitive head, the plastic branch is blocked. That is deliberate, because a can is both inductive positive and capacitive positive, while a bottle is only capacitive positive, so the inductive sensor is the one that discriminates. I should add that the biodegradable branch has no equivalent guard, and that is the first item in our own list of findings."],
     ["Shorter",
      "The metal branch is tested first and unconditionally, and the plastic branch is guarded with and not metalDetected. So a can, which trips both, is claimed by metal, and a bottle, which trips only the capacitive head, is claimed by plastic."]], a:[
  "Order, plus one guard. The metal branch is tested first and unconditionally: <code>if (val_metal == LOW)</code> sets <code>metalDetected = true</code>.",
  "The plastic branch is guarded: <code>if (val_plastic == LOW &amp;&amp; !metalDetected)</code>. A can trips both heads, but the guard blocks the plastic branch.",
  "So the inductive sensor wins on purpose &mdash; a can is inductive-positive and capacitive-positive, a bottle is only capacitive-positive.",
  "The honest part: the bio branch has no such guard. That is finding #1 in our own analysis and we can show it happening."]},

{p:0, cat:"Design", q:"Your servos are 270-degree units, but the sketch writes values from 0 to 180. Explain that.",
 s:[["The full answer",
      "Because the Servo library does not take physical degrees. It maps zero to one hundred eighty across the servo's entire mechanical sweep, so on a 270 degree unit every library degree is one and a half physical degrees. Home is write ninety, which is one hundred thirty five degrees. Metal is write eighty, one hundred twenty degrees. Plastic is write one hundred sixty five, which is two hundred forty seven and a half degrees. The gate goes from write one hundred eighty closed, to write zero open, a full two hundred seventy degree swing. It matters because moveServos waits one second, and home to plastic is the longest travel we ask for."],
     ["Shorter",
      "The Servo library maps zero to one hundred eighty across the whole sweep, so on a 270 degree servo every library degree is one and a half physical degrees. Write ninety is one hundred thirty five degrees, write one hundred sixty five is two hundred forty seven. That is why the one second delay matters, because home to plastic is our longest travel."]], a:[
  "The Servo library maps 0&ndash;180 across the servo's whole mechanical sweep, so on a 270&deg; unit one library degree is 1.5 physical degrees.",
  "<code>tap_servo</code>: home <code>write(90)</code> is 135&deg;, metal <code>write(80)</code> is 120&deg;, plastic <code>write(165)</code> is 247.5&deg;, bio <code>write(0)</code> is 0&deg;.",
  "The gate, <code>tap_servo1</code>, goes from <code>write(180)</code> closed to <code>write(0)</code> open &mdash; a full 270&deg; swing.",
  "It matters for timing: <code>moveServos()</code> waits 1000 ms and home&rarr;plastic is the longest travel. If the gate opens before the plate arrives, the waste lands in the wrong bin."]},

{p:1, cat:"Limitations", q:"When it stops for a full bin, what state does it leave the machine in? Is the gate open or closed?",
 s:[["The full answer",
      "Open, and we would rather tell you that than have you find it. Trace the code with us. The full bin branch in detectionMaintenance sets the obstacle flag, calls soundAlarm, calls displayFullBin, clears operationsEnabled and returns true. Loop sees that true and returns immediately, so handleWasteDetection never runs on that pass, and nothing on that path writes to tap servo one. Now think about when the alarm actually fires. It fires on the pass straight after a drop, because that is when the bin has just got fuller, and at that moment the gate is still at write zero, which is open, because moveServos opened it and only resetServosAndLCD ever closes it again. So the machine locks out with the floor of the throat hanging open. The sorting stops, but the hole does not. If somebody drops waste in while the buzzer is going, it falls straight through into the bin we have just declared full. The gate servo also holds at zero under load for the whole alarm, which is current we do not need to spend. It is finding ten in our analysis and the fix is one line, tap servo one dot write one hundred eighty, before the return true."],
     ["Shorter",
      "Open. The full bin branch returns true before anything writes to the gate servo, and the alarm fires on the pass right after a drop, when the gate is still at write zero. So the sorting stops but the hole does not, and waste dropped in during the alarm goes straight into the full bin. It is finding ten in our own analysis and the fix is one line, writing the gate back to one hundred eighty before the return."]], a:[
  "<b>Open.</b> The full-bin branch calls <code>soundAlarm()</code>, <code>displayFullBin()</code>, clears <code>operationsEnabled</code> and <code>return</code>s <code>true</code> &mdash; it never writes to <code>tap_servo1</code>.",
  "<code>loop()</code> returns on that <code>true</code>, so <code>handleWasteDetection()</code> is skipped and <code>resetServosAndLCD()</code> &mdash; the only thing that closes the gate &mdash; does not run until D10 is pressed.",
  "The trip fires on the pass straight <i>after</i> a drop, so the gate is still at <code>write(0)</code>. The machine stops with the floor of the throat open: sorting stops, the hole does not.",
  "Consequence to state plainly: waste dropped in during the alarm falls into the bin just declared full, and the gate servo holds at 0 under load for the whole alarm.",
  "One-line fix: <code>tap_servo1.write(180);</code> immediately before the <code>return true;</code>. Offer to demonstrate it &mdash; fill a bin, then feed another item while the buzzer is going."]},

{p:0, cat:"Code", q:"What actually stops the buzzer &mdash; emptying the bin, or pressing the button?",
 s:[["The full answer",
      "Emptying it. The button never touches the buzzer. stopAlarm is called from exactly one place in the whole sketch, the else if branch where distance is greater than twenty and obstacleDetected is true. So the tone is a function of the sensor reading and nothing else. While the machine is locked out, loop is still calling detectionMaintenance on every pass, so the ultrasonic is still firing. The moment the bin measures clear, that branch runs, obstacleDetected goes false and the buzzer goes low, and nobody has pressed anything. The button does something different. It sets operationsEnabled true and calls resetServosAndLCD, which puts the display back to standby, turns the three lights off and closes the gate. So the honest order is: emptying stops the noise, the button clears the display and the lights and lets it run again. Which also means there is a trap. If you press the button while the bin is still full, obstacleDetected is still true, so neither branch of that test runs, the alarm never re-fires and stopAlarm never runs. You get a clean display, no lights, a machine that sorts into a full bin, and a tone that will not stop. We can show you that."],
     ["Shorter",
      "Emptying it. stopAlarm is called from exactly one place, the branch where the distance reads back above twenty, so the tone follows the sensor and not the button. The button clears the display and the lights and unlocks the machine. And if you press the button before emptying, obstacleDetected is still true, so the tone keeps going while the machine runs."]], a:[
  "<b>Emptying it.</b> <code>stopAlarm()</code> is called from exactly one place in the sketch &mdash; the <code>else if (distance &gt; 20 &amp;&amp; obstacleDetected)</code> branch. The tone follows the sensor, never the button.",
  "The loop keeps calling <code>detectionMaintenance()</code> during the lockout, so the ultrasonic is still firing &mdash; the moment the bin measures clear the tone drops by itself.",
  "<b>The button does the other half:</b> <code>operationsEnabled = true</code> and <code>resetServosAndLCD()</code> &mdash; display back to standby, three LEDs off, gate closed.",
  "<b>The trap:</b> press D10 <i>before</i> emptying and <code>obstacleDetected</code> is still true, so neither branch of that test runs &mdash; clean display, no lights, a machine sorting into a full bin, and a tone that never stops.",
  "<b>And lifting it out and putting it back still full does not help.</b> While the bin is off the plate the beam misses it, so the tone stops and <code>obstacleDetected</code> clears &mdash; then putting it back re-arms <code>distance &le; 20 &amp;&amp; !obstacleDetected</code> and the alarm fires again from the top. It has to actually be emptied."]},

{p:0, cat:"Design", q:"Why a 270-degree metal gear servo? An SG90 is a fraction of the price.",
 s:[["The full answer",
      "Because of two things: travel on the platform, and torque on the gate. On the platform, three bins have to take turns under one hole, so their parked positions are spread around the plate. Biodegradable is at zero, metal at one hundred twenty degrees, plastic at two hundred forty seven and a half. An SG ninety stops at one hundred eighty, so it would reach two of the three bins and stall against its own end stop trying to reach the third. If you ask why we do not simply space the bins ninety degrees apart so that one hundred eighty is enough, the answer is that they will not fit. The bins ride sixty seven millimetres out from the centre and each is about one hundred twenty millimetres across. At one hundred twenty degrees apart their centres are one hundred sixteen millimetres apart and they only just clear each other. At ninety degrees the centres would be ninety five millimetres apart and the bins would touch. So three bins of that size need the whole circle, and the whole circle needs at least two hundred forty degrees of servo sweep. On the gate, travel is not the issue at all, since a flap only needs about ninety degrees. Torque is the issue, and torque is the weight times the arm length. An SG ninety is rated about one point eight kilogram centimetres with nylon gears, so on a six centimetre flap that is roughly three hundred grams of hold at the tip with nothing spare, and every item dropped from the mouth lands on that flap as a shock load. We use the same two hundred seventy degree metal gear digital servo on both, for the holding torque, for a gearbox that survives the impact, and so that the machine carries one spare part instead of two."],
     ["Shorter",
      "Two reasons. On the platform it is travel. The three bins sit at zero, one hundred twenty and two hundred forty seven and a half degrees, and an SG ninety stops at one hundred eighty, so it cannot reach the third bin. We cannot pack the bins closer either, because at ninety degrees apart they physically touch. On the gate it is torque, not travel. Torque is weight times arm length, and an SG ninety at about one point eight kilogram centimetres holds roughly three hundred grams at the tip of a six centimetre flap, on nylon gears that take the impact of every drop. So we use the same metal gear digital servo on both."]], a:[
  "<b>Platform (D5) &mdash; travel.</b> The three bins park at 0&deg;, 120&deg; and 247.5&deg;. An SG90 stops at 180&deg;, so it reaches two bins and stalls on its end stop trying to reach the third.",
  "<b>And you cannot pack them closer.</b> Bins ride 67 mm off the axis and are ~120 mm across: at 120&deg; apart their centres are 116 mm apart and only just clear; at 90&deg; apart they would be 95 mm apart and touching. Three bins need the full circle &rarr; &ge;240&deg; of sweep.",
  "<b>Gate (D6) &mdash; torque, not travel.</b> A flap only needs ~90&deg;, so an SG90 has the sweep. What it lacks is hold: <span class='kbd'>torque = weight &times; arm length</span>, so 1.8&nbsp;kg&middot;cm on a 6&nbsp;cm flap is ~300&nbsp;g at the tip with nothing spare &mdash; and every drop lands on it as a shock load, on nylon gears.",
  "<b>So both are the same part.</b> Metal gears for the impact and the stopping, digital for holding the bin square under the hole, and one spare instead of two.",
  "The honest cost: on a 270&deg; unit the sketch's <code>write(180)</code> closed &rarr; <code>write(0)</code> open is a full 270&deg; swing on the gate &mdash; far more than it needs, and time lost on every drop. Trimming it to a 90&deg; swing is on our improvements list."]},

{p:0, cat:"Design", q:"How does the machine know a bin is full? What is the 20 in your code measuring?",
 s:[["The full answer",
      "There is one ultrasonic sensor above the hole, looking straight down into whichever bin is parked underneath. We convert the echo with duration times zero point zero three four three, divided by two, which is the speed of sound halved for the round trip. An empty bin measures about fifty centimetres, and each item closes the gap by roughly seven. The fourth item still reads twenty two centimetres. The fifth reads fifteen. Twenty centimetres or less sets the obstacle flag, sounds the buzzer, prints Bin Full, and clears operationsEnabled. Nothing moves again until D10 is pressed, and D10 only clears the flag, so a person still has to empty the bin."],
     ["Shorter",
      "One ultrasonic sensor above the hole, looking into whichever bin is parked there. Empty reads about fifty centimetres and each item closes it by seven, so the fifth item brings it to fifteen. Twenty or less sounds the buzzer, prints Bin Full, and locks the machine until D10 is pressed."]], a:[
  "A single HC-SR04 on D8 and D9 looks straight down into whichever bin is parked under the hole. <code>calculateDistance()</code> is <code>duration &times; 0.0343 / 2</code> &mdash; the speed of sound, halved for the round trip.",
  "An empty bin reads about 50 cm, and every item closes the gap by roughly 7 cm. The fourth drop still reads 22 cm; the fifth reads 15 cm.",
  "<code>distance &lt;= 20</code> sets <code>obstacleDetected</code>, sounds the buzzer on D12, prints <code>Bin Full</code> and clears <code>operationsEnabled</code>.",
  "Nothing moves again until D10 is pressed &mdash; and D10 only clears the flag, so a person still has to actually empty the bin."]},

{p:0, cat:"Code", q:"What happens if the ultrasonic never gets an echo back?",
 s:[["The full answer",
      "Two things go wrong. First, pulseIn has no timeout in our sketch, so it blocks for a full second and then returns zero. Second, a duration of zero gives a distance of zero, and zero is less than or equal to twenty, so the machine declares a full bin that is not full. Those are findings four and five in our analysis. The fix is two lines. Give pulseIn a twenty five thousand microsecond timeout, and change the test to distance greater than zero and less than or equal to twenty. We would also take the median of three readings before acting on one."],
     ["If you would rather lead with the fix",
      "It reports a full bin that is not full, and we know exactly why. pulseIn returns zero after blocking for a second, and zero passes the less than or equal to twenty test. Two lines fix it: a twenty five thousand microsecond timeout on pulseIn, and a distance greater than zero guard on the comparison. Those are findings four and five in our own analysis."]], a:[
  "<code>pulseIn(echoPin, HIGH)</code> has no timeout in our sketch, so it blocks for a full second and then returns 0.",
  "A duration of 0 gives a distance of 0, and <code>0 &lt;= 20</code> is true &mdash; so the machine declares a full bin that is not full. Those are findings #4 and #5.",
  "The fix is two lines: <code>pulseIn(echoPin, HIGH, 25000)</code>, and <code>if (distance &gt; 0 &amp;&amp; distance &lt;= 20)</code>.",
  "We would also take the median of three readings before trusting any one of them."]},

{p:0, cat:"Code", q:"Why did you use delay() instead of millis()? Is a blocking loop acceptable here?",
 s:[["The full answer",
      "It is blocking and we know it. moveServos alone holds the processor for twelve hundred milliseconds, and loop adds another five hundred. We chose it because for a first prototype it keeps the control flow readable. The order in the code is the order on the bench, which matters when you are debugging hardware and software at the same time. The cost is real, though. For about one point seven seconds per cycle the D10 button is not being read, so a short press can be missed, and an item thrown in falls past stage one without ever being sampled. We have already written the non blocking millis version as the next revision."],
     ["Shorter",
      "Readability for a first prototype. The order in the code is the order on the bench. The cost is that the machine is deaf for about one point seven seconds per cycle, so a short button press can be missed and a thrown item is never sampled. The non blocking millis rewrite is already written as the next revision."]], a:[
  "It is blocking and we know it. <code>moveServos()</code> alone holds the CPU for 1200 ms, and <code>loop()</code> adds <code>delay(500)</code>.",
  "For a prototype it keeps the control flow readable &mdash; the order in the code is the order on the bench, which is worth a lot when you are debugging hardware.",
  "The cost is real: for about 1.7 s per cycle the D10 button is not being read, so a short press can be missed entirely.",
  "We wrote the non-blocking <code>millis()</code> state machine as the next revision. It is in the repository as <code>_alternative_state_machine.txt</code>."]},

{p:0, cat:"Code", q:"Why is pinMode on your sensor pins INPUT and not INPUT_PULLUP?",
 s:[["The full answer",
      "Because the modules drive their outputs actively while they are powered, so it worked on the bench and we did not catch it. It is still wrong. An NPN open collector output releases the line when it is not conducting, and a floating input can read LOW at random, which would produce a placement with no waste present. That is finding three. The correct call is INPUT PULLUP on pins three, four and seven, or external ten kilohm pull up resistors. We already do it correctly on the button. buttonPin is INPUT PULLUP, which is exactly why the code tests for LOW there."],
     ["Shorter",
      "It should be INPUT PULLUP, and that is finding three in our analysis. It works on the bench because the modules drive their outputs actively, but an open collector output releases the line and a floating pin can read LOW at random. We already do it correctly on the button."]], a:[
  "Because the modules drive their outputs actively while powered, so it works on the bench and we did not catch it.",
  "But an NPN open-collector head releases the line when it is not conducting, and a floating pin can read LOW at random. That is finding #3.",
  "The correct call is <code>pinMode(pin, INPUT_PULLUP)</code> on 3, 4 and 7, or fit external 10 k&Omega; pull-ups.",
  "We already do it properly on the button &mdash; <code>buttonPin</code> is <code>INPUT_PULLUP</code>, which is why the code tests for LOW there."]},

{p:0, cat:"Code", q:"Why does the LCD flicker when the machine is sitting idle?",
 s:[["The full answer",
      "Because resetServosAndLCD calls lcd init and lcd backlight every time it runs, and handleWasteDetection falls through to that function whenever none of the three sensors reads LOW. So on an idle machine the display is being re initialised about twice a second, and the flicker is that re initialisation. It is finding six, cosmetic but sloppy. The fix is to move lcd init and lcd backlight into setup, where they belong, and leave only lcd clear and the two prints in the reset routine."],
     ["Shorter",
      "Because resetServosAndLCD calls lcd init every time it runs, and it runs on every idle pass, about twice a second. The fix is to move lcd init and lcd backlight into setup. It is finding six, cosmetic but sloppy."]], a:[
  "When nothing reads LOW, <code>handleWasteDetection()</code> falls through to <code>resetServosAndLCD()</code>, and that calls <code>lcd.init()</code> and <code>lcd.backlight()</code> again &mdash; twice a second.",
  "You are watching the I&sup2;C display be re-initialised over and over. It is finding #6, cosmetic but sloppy.",
  "The fix is to move <code>lcd.init()</code> and <code>lcd.backlight()</code> into <code>setup()</code> and leave only <code>lcd.clear()</code> and the two prints in the reset routine."]},

{p:0, cat:"Design", q:"Why a rotating platform? Three fixed chutes or three flaps would have no moving plate at all.",
 s:[["The full answer",
      "Because it lets one of everything serve three bins. One servo, one gate and one ultrasonic sensor instead of three of each, which is far fewer parts to fail and much less wiring on an Uno that is already nearly full. The three bins sit corner to corner on a triangular plywood plate with a retaining rail on all three edges, so nothing tips while it spins. Their centres lie on a circle of radius two times the bin radius over root three, which is where three equal circles touch, and the plate is the smallest triangle that still contains all three. The cost is time. The plate has to arrive before the gate can open, and that is the one second delay in moveServos."],
     ["A different angle, on the Uno's limits",
      "Partly geometry and partly pins. Three fixed chutes would need three gates and three sensors, and the Uno is already nearly full: three sensor inputs, an ultrasonic pair, a buzzer, a button, three LEDs, two servos and the I2C display. Rotating the bins to the waste means one servo, one gate and one ultrasonic sensor do the work of nine components, and that is what kept the design inside one board and inside our budget."]], a:[
  "One servo instead of three, one gate instead of three, and one ultrasonic instead of three &mdash; fewer parts to fail and far less wiring on an Uno that is already nearly full.",
  "The three bins sit corner to corner on a triangular plywood plate with a retaining rail along all three edges, so nothing tips or slides while it spins.",
  "Their centres lie on a circle of radius 2&middot;binR/&radic;3 &mdash; the radius at which three equal circles touch &mdash; so the plate is the smallest triangle that still holds all three.",
  "The trade-off is time: the plate has to travel before the gate can open. That is the <code>delay(1000)</code> inside <code>moveServos()</code>."]},

{p:0, cat:"Curveball", q:"Watch this. I throw the can in quickly and it lands in the bio bin. Explain what your machine just did.",
 s:[["The full answer",
      "That is our documented weakness, and it is a sampling problem, not a wiring fault. The loop looks at the sensors about twice a second. A can thrown in falls past the stage one heads in roughly a tenth of a second, so no pass ever sees it there. It lands on the closed gate, the infrared sensor reports an obstacle, and with no material name attached the sketch classifies it as biodegradable. There are two fixes. Procedurally, present metal and plastic instead of throwing them, which is already in our operating instructions. In code, latch the stage one result on an interrupt instead of sampling it once per pass."],
     ["Shorter, if you want to concede fast and move on",
      "That is our weakness W2 and we predicted it. The loop samples twice a second and a thrown can passes the stage one heads in about a tenth of a second, so it is never seen there. It lands on the gate, the infrared sensor reports an obstacle, and with no material name the sketch defaults to biodegradable. Present it instead of throwing it, and in code, latch stage one on an interrupt."]], a:[
  "Own it immediately &mdash; that is our documented weakness W2, and it is a sampling problem, not a wiring fault.",
  "The loop looks at the sensors about twice a second. A can thrown in falls past the stage-1 heads in roughly a tenth of a second, so no pass ever sees it there.",
  "It lands on the closed gate, the IR sees an obstacle, and with no material name attached the sketch calls it bio.",
  "Two fixes: procedurally, present metal and plastic instead of throwing them; in code, latch the stage-1 result with an interrupt or a much faster poll instead of reading it once per pass."]},

{p:0, cat:"Curveball", q:"You say the alarm protects all three bins, but at rest your sensor is pointed at only one of them. Why should we trust it?",
 s:[["The full answer",
      "You are right, and it is the second item in our own findings. Home is write ninety and metal is write eighty, which is almost the same angle, so at rest the ultrasonic sensor is looking into the metal bin. The biodegradable and plastic bins are only measured in the single pass immediately after they receive waste, and then the plate returns home. So one of those two can sit full and unreported until the next item of that type arrives. The fix is either a sweep, parking at each of the three angles in turn between items and taking a reading, or one sensor per bin. Until then we empty all three before a session rather than relying on the alarm."],
     ["Shorter",
      "You are right, and it is finding two. Home is write ninety and metal is write eighty, so at rest the sensor looks into the metal bin. The other two are only measured in the pass right after they receive waste. The fix is a sweep between items, or one sensor per bin. Until then we empty all three before a session."]], a:[
  "You are right, and it is finding #2. Home is <code>write(90)</code> and metal is <code>write(80)</code> &mdash; almost the same angle &mdash; so at rest the HC-SR04 looks into the metal bin.",
  "Bio and plastic are only measured in the single pass right after they receive waste, then the plate returns home.",
  "So a bio or plastic bin can sit full and unreported until the next item of that type arrives.",
  "The fix is a sweep: park at each of the three angles in turn between items and take a reading, or fit one cheap sensor per bin. We start every demo with all three bins emptied rather than trusting the alarm."]},

/* ---------- panelist 2 · the study behind it ---------- */
{p:1, cat:"Concept", q:"In one sentence: what problem does EnviroSortPro solve, and for whom?",
 s:[["The full answer",
      "EnviroSortPro separates mixed household and campus waste into biodegradable, plastic and metal at the moment it is thrown away, so that correct segregation no longer depends on the person throwing it. The people it serves first are the ones who handle the waste afterwards, our own waste room and the material recovery facility that receives it. What fails today is that the bins are labelled but the sorting still depends on compliance, so batches arrive already contaminated, and one wet biodegradable item is enough to downgrade the recyclables it was mixed with."],
     ["A different angle, from the waste handler's side",
      "The problem is not really at the bin, it is downstream. Whoever collects our waste receives it already mixed, and once wet food waste has touched a plastic bottle, that bottle is no longer worth recovering. EnviroSortPro solves it at the only point where it is still cheap to solve, the moment of disposal, by taking the decision away from the person and giving it to the bin."]], a:[
  "Lead with the sentence, then support it. Something like: it automatically separates mixed household and campus waste into biodegradable, plastic and metal at the point of disposal, so the sorting no longer depends on the person throwing it.",
  "Name the beneficiary concretely &mdash; your school's waste room, a barangay MRF, a canteen.",
  "Say what fails today: mixed bins arrive at the material recovery facility already contaminated, and recyclables that touched wet bio waste lose most of their value.",
  "Keep it to one sentence out loud. Everything else is the follow-up."]},

{p:1, cat:"Concept", q:"Why is automatic segregation significant? People can already read the label on a bin.",
 s:[["The full answer",
      "Because a label depends on the person reading it, knowing what the material is, and caring at that moment. A machine depends on none of the three. Segregation at source is already required by Republic Act 9003, so the gap is not the law and it is not awareness. It is enforcement at the bin itself. The cost of that gap is contamination, and one wet biodegradable item in a recyclables bin lowers the value of the whole batch. It connects directly to Sustainable Development Goals 11 and 12, sustainable cities and responsible consumption."],
     ["Shorter",
      "Because a label depends on the person reading it, knowing the material, and caring at that moment, and a machine depends on none of the three. The law and the labels are already there. What is missing is enforcement at the bin, and that is what we are automating."]], a:[
  "Labels depend on compliance and knowledge; a machine depends on neither. That is the whole argument &mdash; make it in that form.",
  "Segregation at source is already required by RA 9003, the Ecological Solid Waste Management Act. The gap is not the law, it is enforcement at the bin.",
  "Contamination is the cost: one wet bio item in a recyclables bin downgrades the whole batch.",
  "Tie it to SDG 11 (sustainable cities) and SDG 12 (responsible consumption and production), briefly &mdash; one line, not a paragraph."]},

{p:1, cat:"Testing", q:"What was your research design, and how many trials did you actually run?",
 s:[["The full answer",
      "It is developmental research with a quantitative evaluation of the prototype. We built the machine, then evaluated it against known inputs. A trial was defined as one item fed in and one placement out, recorded as correct or incorrect against the material we already knew it was. We ran [number] items per material, repeated [number] times, across [number] sessions, and two of us ran each session so that the person feeding was never the person recording. Our total is [number] trials, which we know is modest for a statistical claim, and we report it as it is."],
     ["If your trial count is small",
      "Developmental research with a quantitative evaluation. A trial is one item in and one placement out, scored against the material we already knew it was. We ran [number] trials in total, which we know is modest, and we present it as a characterisation of the prototype rather than a statistical claim. We would rather state that limit ourselves than have a larger claim read into it."]], a:[
  "Name the design out loud: developmental / experimental research with a quantitative evaluation of the prototype.",
  "Give real numbers: how many items per material, how many repetitions, over how many sessions, and who fed them.",
  "Say how a trial was defined &mdash; one item in, one bin out, recorded as correct or incorrect against the material you knew it was.",
  "If your trial count is small, say the number and call it a limitation before the panel does. Never round it up."]},

{p:1, cat:"Testing", q:"How did you compute accuracy, and what did you get for each material?",
 s:[["The full answer",
      "Accuracy is correct placements divided by total trials, times one hundred, and we report it per material as well as overall, because the three are not equal. Metal was [number] percent and plastic [number] percent when presented properly. Biodegradable was [number] percent, and it is the lowest because biodegradable is the default. Everything the first stage failed to identify lands there, so it inherits every miss from the other two. Our misses were almost all the same case, metal thrown rather than presented, and we kept those trials in the count rather than discarding them."],
     ["Shorter",
      "Correct placements over total trials, reported per material and overall. Metal [number] percent, plastic [number] percent, biodegradable [number] percent. Biodegradable is lowest because it is the default category, so it inherits every miss from stage one. We kept the failed trials in the count."]], a:[
  "Accuracy = correct placements &divide; total trials &times; 100, reported per material and then overall, not just overall.",
  "Report the three separately. They will not be equal &mdash; presented metal and plastic do well; bio is whatever falls through, so it inherits every miss.",
  "Show the confusion: what the misses actually were, e.g. metal landing in bio when it was thrown rather than presented.",
  "If you have percentages on a slide, be able to say the raw counts behind them."]},

{p:1, cat:"Testing", q:"State your independent and dependent variables.",
 s:[["The full answer",
      "The independent variables are the type of waste fed in, biodegradable, plastic or metal, and the feeding technique, presented to the stage one heads or dropped straight through. The dependent variables are whether the item was placed in the correct bin, and the time from insertion to placement. We controlled the room lighting, the trim pot setting on the infrared module, the battery voltage, and we fed one item at a time. The lighting and the trim pot are controlled for a specific reason. The infrared module responds to ambient infrared, so if we let those vary the results would not be comparable."],
     ["Shorter",
      "Independent: the material fed in, and the feeding technique, presented or dropped. Dependent: whether it landed in the correct bin, and the time from insertion to placement. Controlled: room lighting, the infrared trim pot, battery voltage, and one item at a time."]], a:[
  "Independent: the type of waste fed in (biodegradable, plastic, metal), and the feeding technique (presented to the stage-1 heads versus dropped through).",
  "Dependent: whether the item was placed in the correct bin, and the time taken from insertion to placement.",
  "Controlled: lighting in the room, the trim-pot setting on the IR module, battery voltage, and one item at a time.",
  "Naming the controlled variables unprompted is what makes this answer land."]},

{p:1, cat:"Limitations", q:"State your scope and delimitations.",
 s:[["The full answer",
      "The scope is three categories, biodegradable, plastic and metal, on dry, single, hand sized items, fed one at a time, indoors. The delimitations are these. No glass, and no distinction between paper and plastic. No networking and no data logging. The bins are emptied by hand. And it was tested only under our own room lighting. It is a functional prototype for proof of concept, not a production unit. There is also a physical limit. An item has to fit the throat, and each bin holds about five items before the full bin alarm."],
     ["Shorter",
      "Three categories, dry single hand sized items, one at a time, indoors. No glass, no paper against plastic, no networking, no data logging, bins emptied by hand, and tested only under our own room lighting. It is a proof of concept prototype, not a production unit."]], a:[
  "Scope: three categories only &mdash; biodegradable, plastic, metal &mdash; on dry, single, hand-sized items, one at a time, indoors.",
  "Delimitations: no glass and no paper-versus-plastic distinction; no networking or data logging; bins are emptied by hand; tested only in our own room lighting.",
  "Say plainly what it is: a functional prototype for proof of concept, not a production unit.",
  "State the physical limit too &mdash; an item has to fit the throat, and the bins hold about five items each before the alarm."]},

{p:1, cat:"Concept", q:"How is this different from the smart bins already on the market?",
 s:[["The full answer",
      "Honestly, the commercial units are more capable than ours. They use cameras and trained models, they handle more categories, and they cost far more than we spent. What we did differently is remove the dataset and the training from the problem entirely. Ours uses three inexpensive discrete sensors and a deterministic decision, so it can be built, understood and repaired by a student with a soldering iron. That is our contribution, a locally reproducible design with its failure behaviour documented, not a new algorithm. We would rather claim reproducibility, which we can defend, than novelty, which we cannot."],
     ["A different angle, on who can actually own one",
      "The difference is who can own one. A camera based bin needs a dataset, a trained model, and somebody who can retrain it when it drifts. Ours needs three sensors, a soldering iron and this documentation. A school can build it, repair it, and understand why it made every decision. We are not competing on capability. We are competing on who can keep one running."]], a:[
  "Be honest: commercial units use cameras and trained models, and they cost far more than ours.",
  "Ours uses three cheap discrete sensors and a deterministic if-chain, so it can be built and repaired by a student with a soldering iron and no dataset.",
  "That is the contribution &mdash; a locally reproducible, low-cost design with a documented failure map, not a novel algorithm.",
  "Claiming novelty you do not have is the fastest way to lose a panel. Claim reproducibility instead, and you can defend it."]},

{p:1, cat:"Testing", q:"How do you know your results are reliable and not just a lucky run?",
 s:[["The full answer",
      "Three things. We repeated the same items under the same conditions rather than testing each item once, and more than one of us operated the machine, so the technique is not one person's trick. We logged every trial as it happened and we left the serial monitor open, so the distance readings are on record and not reconstructed. And we deliberately included the failure cases in the count instead of discarding them, so the accuracy figure we are reporting already contains the thrown can misses. Our evaluation sheet was reviewed by [adviser] before we started."],
     ["A different angle, on what would break the number",
      "The honest test of reliability is whether somebody else could get our number. They would need the same items, the same technique, the same lighting and our written procedure, and all four are in the documentation. What would break the number is a different room, because the infrared threshold is tuned to the light there. We say that rather than presenting the figure as universal."]], a:[
  "Repetition with the same items in the same conditions, and by more than one operator, so the technique is not one person's trick.",
  "Every trial logged as it happened, not reconstructed afterwards &mdash; and the serial monitor left open so the <code>Distance:</code> line is on record.",
  "Deliberately included the known failure cases in the count instead of discarding them. Our accuracy figure includes the thrown-can misses.",
  "If you ran a validation of your evaluation instrument with your adviser or an ICT teacher, name them and what they checked."]},

{p:1, cat:"Curveball", q:"Your bio branch has no guard at all. Is that a bug, or a design decision?",
 s:[["The full answer",
      "It is a bug, and it is the first item on our own list. The metal branch is unguarded, plastic checks not metalDetected, and biodegradable checks nothing, so an item that trips the infrared sensor overrides a decision that was already made. Concretely, a can wrapped in foil runs moveServos eighty, zero, and then moveServos zero, zero. The plate swings to metal and then on to biodegradable, and the can lands in the wrong bin. The fix is one line, adding and not metalDetected and not plasticDetected to the biodegradable condition. We can demonstrate it before and after if the panel wants to see it."],
     ["Shorter",
      "It is a bug, and it is the first item on our own list. Metal is unguarded, plastic checks not metalDetected, and biodegradable checks nothing, so anything the infrared sensor sees overrides a decision already made. One line fixes it, adding and not metalDetected and not plasticDetected. We can show it before and after."]], a:[
  "It is a bug, and it is the first item in our own analysis &mdash; do not defend it as a feature.",
  "Metal is unguarded, plastic checks <code>!metalDetected</code>, bio checks nothing. So an item that trips the IR sensor overrides a decision that was already made.",
  "Concretely: a can wrapped in foil runs <code>moveServos(80, 0)</code> and then <code>moveServos(0, 0)</code> &mdash; the plate swings to metal, then to bio, and the can lands in bio.",
  "The fix is one line: <code>if (val_bio == LOW &amp;&amp; !metalDetected &amp;&amp; !plasticDetected)</code>. We can demonstrate it before and after."]},

{p:1, cat:"Curveball", q:"Your sensors are off-the-shelf modules and your sketch is under two hundred lines. What exactly is your contribution?",
 s:[["The full answer",
      "The contribution is the integration and the evidence, not the parts. On integration, one servo, one gate and one ultrasonic sensor serving three bins on a rotating triangular plate, with the geometry derived rather than guessed. On evidence, a documented failure map. We can tell you that a thrown item reads as biodegradable, that room infrared can trip the biodegradable branch on an empty machine, and that only one bin is really watched at rest, and for each one we can point at the line of code responsible and state the fix. We think a working prototype whose failure modes are known is worth more than a novel one whose failures are not."],
     ["A different angle, on what research at this level is for",
      "I would turn the question around. At this level the point is not to invent a sensor. It is to show that we can specify a problem, build something that addresses it, test it honestly, and know exactly where it fails. We can do all four, and the failure map is what we would put forward as the real output. A novel component we could not characterise would be worth less than a plain one we can."]], a:[
  "The contribution is the integration and the evidence, not the parts. Say that first and without apology.",
  "The mechanism: one servo, one gate and one ultrasonic serving three bins on a rotating triangular plate, with the geometry worked out rather than guessed.",
  "The characterisation: a documented failure map &mdash; thrown items reading as bio, room IR tripping the bio branch, one bin actually being watched at rest &mdash; each with the line of code responsible and a stated fix.",
  "A panel will forgive modest hardware. It will not forgive a team that cannot say where its own design breaks."]},

/* ---------- panelist 3 · building it, running it, keeping it ---------- */
{p:2, cat:"Impact", q:"How much did it cost to build, and could an ordinary public school afford one?",
 s:[["The full answer",
      "Our total was [amount], and that includes the enclosure and the frame but not our own labour. The largest items were the two servos and the sensor modules. The Uno, the buzzer and the LCD were minor. Compared with a commercial sorting bin that is a small fraction of the cost, and compared with what it prevents, one contaminated recyclables batch, it pays back quickly in a place that actually sells its recyclables. If a school could not afford this version, the parts we would drop first are the LCD and the enclosure, because those are for the operator, not for the sorting."],
     ["If cost is your weak point",
      "Our total was [amount]. I will be honest that this is a prototype price and not a unit price. We bought single quantities at retail, and we spent money on a proper enclosure because it has to survive being carried around. A second unit would cost less, and the parts we would drop first are the LCD and the enclosure, which serve the operator rather than the sorting."]], a:[
  "Have the bill of materials memorised by group: Uno, the three sensor modules, HC-SR04, two servos, I&sup2;C LCD, buzzer, the battery pack, and the plywood and acrylic.",
  "Give one total figure and say whether it includes the enclosure and the labour.",
  "Compare it to what it replaces &mdash; the cost of one contaminated recyclables batch, or a commercial smart bin.",
  "If a school could not afford it, say so, and say what the cheaper version drops."]},

{p:2, cat:"Design", q:"How is it powered, and how long will it run on one charge?",
 s:[["The full answer",
      "Two battery holders of four 3.7 volt lithium ion cells each, so about 14.8 volts, in the compartment under the machine, through a step-down converter set to five point zero volts, which is what feeds the board — the Arduino never sees more than five volts from any source. For a long demonstration we run from a five volt adapter instead, and the packs can be kept up by an eighteen volt panel through a charge controller — the panel charges the pack, the pack runs the machine, never the panel into the board. The Uno draws very little. What empties the pack is the two servos, and only while they are actually moving. On a full charge we measured about [your figure] of continuous use. As the pack sags the servos get slow and weak before the Uno browns out, so a slow platform is our low battery warning. We charge it fully before a session and we bring the adapter as a backup."],
     ["Shorter",
      "Two holders of four 3.7 volt lithium ion cells, about 14.8 volts, through a step-down set to five volts, which is all the board ever takes, with a mains adapter for long demonstrations and a solar panel that charges the pack. The Uno draws very little. The servos are what empty the pack, and only while they are moving. A slow platform is our low battery warning."]], a:[
  "Two battery holders of four 3.7 V Li-ion cells each, about 14.8 V, through an LM2596 buck set to <b>5.0 V</b> into the board; a 5 V adapter over USB for a long demo; an 18 V panel through a 4S charge controller to keep the packs up.",
  "The line to hold: <b>the Arduino never sees more than 5 V.</b> The 14.8 V and the 18 V both stop at the converter.",
  "Know the rule: the panel charges the pack and the pack runs the machine. Never the panel straight into the board &mdash; 22 V open-circuit is past the Uno's maximum.",
  "Be able to state the standby draw and the peak draw &mdash; the servos are what actually empty the pack, not the Uno.",
  "Say what happens as the pack sags: servos get slow and weak before the Uno browns out, so a slow plate is your low-battery warning.",
  "Bring it charged and know your runtime. \"About\" is fine; \"I do not know\" is not."]},

{p:2, cat:"Impact", q:"A bin fills up at ten in the evening and nobody is there. What happens then?",
 s:[["The full answer",
      "The buzzer sounds, the LCD reads Bin Full, all three LEDs light, and operationsEnabled goes false, so the machine stops accepting waste rather than overflowing. And it stays stopped. Pressing D10 only clears the flag. It does not empty anything, so a person still has to take the bin out and tip it before pressing it. The honest gap is that the buzzer keeps sounding until somebody arrives, and nobody is notified remotely. Our next revision adds a network module to send the alert, and a timeout that silences the buzzer after a few minutes while keeping the machine locked."],
     ["Shorter",
      "It locks itself. The buzzer sounds, the LCD reads Bin Full, and operationsEnabled goes false, so it stops accepting waste instead of overflowing. D10 only clears the flag, so a person still has to empty the bin. Nobody is notified remotely, and that is the gap our next revision closes."]], a:[
  "The buzzer sounds, the LCD reads <code>Bin Full</code>, all three LEDs light and <code>operationsEnabled</code> goes false. The machine stops accepting waste rather than overflowing.",
  "It stays stopped. D10 only clears the flag &mdash; it does not empty anything &mdash; so a person has to come, take the bin out and tip it into the disposal bin before pressing it.",
  "The honest gap: the buzzer runs until someone arrives, and nobody is notified remotely.",
  "The next revision adds an ESP8266 or a GSM module to send the alert, and a timeout that silences the buzzer after a few minutes while keeping the machine locked."]},

{p:2, cat:"Curveball", q:"I drop a bottle and a can in together. What does your machine do?",
 s:[["The full answer",
      "Two materials, one answer. The inductive head sees the can, metalDetected goes true, the plastic branch is blocked by its guard, and both items go to the metal bin together. That is a hard limit of the design, not a bug we can patch, because the sketch produces exactly one decision per cycle. Our design assumption is one item per cycle and our operating instruction says so. Feed one, wait for the platform to come home, feed the next. A real fix is mechanical rather than software. Either a throat that only admits one item at a time, or a weight sensor that refuses a double load."],
     ["Shorter",
      "Both go to the metal bin. The inductive head sees the can, metalDetected goes true, and the plastic branch is blocked by its guard. It is a hard limit, not a bug, because the sketch makes one decision per cycle. Our instruction is one item at a time, and a real fix would be mechanical, a throat that admits only one item."]], a:[
  "Two materials, one answer &mdash; that is weakness W1 and it is a hard limit of the design, not a bug we can patch.",
  "The inductive head sees the can, <code>metalDetected</code> goes true, the plastic branch is blocked by its guard, and both items go to the metal bin together.",
  "The design assumption is one item per cycle, and the operating instruction says so: feed one, wait for the plate to come home, feed the next.",
  "A real fix is mechanical, not software &mdash; a throat that only admits one item, or a weight sensor that refuses a double load."]},

{p:2, cat:"Impact", q:"Is this safe? There is a plate that swings, a mains adapter, and people throw broken glass into bins.",
 s:[["The full answer",
      "The electronics are in a covered acrylic fronted box, every lead enters through a grommet, and the leads are zip tied under the throat so nothing hangs into the mechanism. The moving parts are under the deck and behind the retaining rail, so nothing a user can reach moves while it is sorting. Everything past the adapter is low voltage, and the battery pack is clipped down rather than loose. As for glass, it trips no sensor at all, so it sits on the gate and the machine stops. That is safer than guessing, but it also means glass is outside our scope and must not be put in."],
     ["Shorter",
      "The electronics are enclosed, every lead enters through a grommet, and the moving parts are under the deck and behind the retaining rail, so nothing a user can reach moves while it sorts. Everything past the adapter is low voltage. Glass trips no sensor, so the machine simply stops, which is safer than guessing, but it does mean glass is out of scope."]], a:[
  "Enclosure first: the Uno and the LCD sit in a covered acrylic-front box, every lead enters through a grommet, and the leads are zip-tied under the throat so nothing hangs into the mechanism.",
  "The moving parts are under the deck and behind the rail. Nothing a user can reach moves while the machine is sorting.",
  "Low voltage everywhere past the adapter, and the battery pack is clipped down rather than loose.",
  "Glass: it trips no sensor at all, so it sits on the gate and the machine simply stops. Say that out loud &mdash; it is safer than guessing, but it also means glass is out of scope and must not go in."]},

{p:2, cat:"Impact", q:"How would you scale this: a larger unit, or more categories?",
 s:[["The full answer",
      "Those are two different problems. More volume is mostly mechanical. Bigger bins, a stronger servo or a stepper with a gearbox, and a longer settle time before the gate opens. More categories is a sensing problem and it is much harder. Paper against plastic, or glass, cannot be done with an inductive and a capacitive head. It needs a camera and a trained model, and that changes the cost class entirely. The rotating plate itself scales badly beyond four or five positions, because the travel time grows. Past that the right mechanism is a linear conveyor with gates. If we had to pick one we would do volume first, because that is what our design is actually good at."],
     ["Shorter",
      "Volume is mechanical and we could do it: bigger bins, a stronger servo, a longer settle time. More categories is a sensing problem we could not do with these sensors, because paper against plastic needs a camera and a model. If we had to pick one we would scale volume, because that is what this design is good at."]], a:[
  "Separate the two questions. More volume is mostly mechanical: bigger bins, a stronger servo or a stepper with a gearbox, a longer settle time.",
  "More categories is a sensing problem. Paper versus plastic, or glass, cannot be done with an inductive and a capacitive head &mdash; it needs a camera and a model, and that changes the cost class entirely.",
  "The rotating plate itself scales badly past four or five positions; beyond that a linear conveyor with gates is the right mechanism.",
  "Say which one you would actually build next and why."]},

{p:2, cat:"Impact", q:"Who maintains this? Those sensor faces are going to get dirty.",
 s:[["The full answer",
      "Whoever runs the room, and that is deliberate, because every part is off the shelf and replaceable. The routine is weekly. Wipe the three sensor faces and the throat, check that the plate turns freely, recharge the pack, and re check the infrared trim pot in that room's own light. The infrared head is the one that matters, because a film of dust on the emitter or the receiver shifts the threshold and the biodegradable branch starts misfiring. None of that needs a technician. We wrote a one page maintenance sheet and we can hand it over with the machine."],
     ["Shorter",
      "Whoever runs the room, weekly. Wipe the three sensor faces and the throat, check the plate turns freely, recharge the pack, and re check the infrared trim pot in that room's light. The infrared head is the one that matters, because dust on it shifts the threshold. We wrote a one page maintenance sheet to hand over with it."]], a:[
  "They will, and the IR head is the one that matters &mdash; a film of dust on the emitter or receiver shifts the threshold and the bio branch starts misfiring.",
  "The routine: wipe the three sensor faces and the throat weekly, check the plate turns freely, recharge the pack, and re-check the IR trim pot in the room's own light.",
  "None of it needs a technician. That is deliberate &mdash; every part is off the shelf and replaceable by whoever runs the room.",
  "Have a written maintenance sheet to hand over. Panels like seeing one."]},

{p:2, cat:"Impact", q:"Give you two more months and a budget. What do you change first, and why that first?",
 s:[["The full answer",
      "Correctness before features. First the four code fixes. Guard the biodegradable branch, use INPUT PULLUP on the sensor pins, give pulseIn a timeout, and reject a zero distance. Those change behaviour and cost nothing. Second, the non blocking rewrite, so the button is always live and stage one can be sampled fast enough to catch a thrown item. Third, hardware. One ultrasonic sensor per bin so all three are watched at rest, and a hood over the throat so room light cannot reach the infrared head. Only after that the additions, remote alerts and a counter. The order is deliberate. Nothing gets added until what is already there is correct."],
     ["Shorter",
      "Correctness first: the four code fixes, which cost nothing and change behaviour. Then the non blocking rewrite, so the button is always live. Then one ultrasonic sensor per bin, and a hood over the throat. Additions like remote alerts come last, because nothing gets added until what is already there is correct."]], a:[
  "Correctness before features. First the four code fixes: guard the bio branch, use <code>INPUT_PULLUP</code>, add the <code>pulseIn</code> timeout, and reject a zero distance.",
  "Second, the non-blocking rewrite, so the button is always live and stage 1 can be sampled fast enough to catch a thrown item.",
  "Third, hardware: one ultrasonic per bin so all three are watched at rest, and a hood over the throat so room light cannot reach the IR head.",
  "Only after that, the nice-to-haves &mdash; remote alerts, a counter, a fourth category. Say the order and the reason for the order; that is what is actually being asked."]},

{p:2, cat:"Curveball", q:"I am told sunlight alone can set off your bio bin with nothing in the machine. Defend that.",
 s:[["The full answer",
      "That is true, and we found it ourselves. The biodegradable head is an infrared obstacle module, an emitter, a receiver and an LM393 comparator with a trim pot. It cannot distinguish its own emitter's light from the room's. Direct sun, a halogen lamp or a camera flash into the throat pushes the receiver past the threshold, pin seven reads LOW, and the sketch calls it biodegradable on an empty gate. Ordinary LED and fluorescent ceiling lighting emits very little infrared and is fine. Sunlight and hot filament lamps are what break it. Our mitigation is to hood the feed hole, keep it away from windows and spotlights, and tune the pot in the room we are presenting in. The permanent fix is a shrouded head, or a modulated thirty eight kilohertz emitter and receiver pair that ignores steady light."],
     ["Shorter",
      "True, and we documented it ourselves as W3. The infrared head is an emitter, a receiver and a comparator, and it cannot tell its own light from the room's, so sun or a halogen lamp into the throat can fire the biodegradable branch on an empty gate. Ordinary ceiling light is fine. We hood the throat, keep it away from windows, and tune the pot in the room we present in."]], a:[
  "True, and we found it ourselves &mdash; it is weakness W3. The bio head is an IR obstacle module: an emitter, a receiver and an LM393 comparator with a trim pot.",
  "It cannot tell its own emitter's light from the room's. Direct sun, a halogen lamp or a camera flash into the throat pushes the receiver past the threshold, D7 reads LOW, and the sketch calls it bio on an empty gate.",
  "Ordinary LED and fluorescent ceiling light emits little IR and is fine. Sunlight and hot-filament lamps are what break it.",
  "Mitigation is procedural and mechanical: hood the feed hole, keep it away from windows and spotlights, and tune the pot in the room you are presenting in. The permanent fix is a shrouded head or a modulated 38 kHz emitter and receiver pair that ignores steady light."]},

/* ---------- the opening: why this exists at all ---------- */
{p:1, cat:"Opening", q:"Good morning. Before anything else: why did you decide to come up with this study?",
 s:[["The full answer",
      "We started from something we saw, not something we read. In our building the bins are already labelled, but at the end of the day everything goes into one sack, and the recyclables that were sitting next to wet food waste are no longer worth anything. So information was never the problem. The labels were there, and Republic Act 9003 already requires segregation. What was missing was the moment of disposal itself. So we decided to move the sorting from the person to the bin, using sensors cheap enough that a school could actually build one. And we built it instead of proposing it, because we needed to know whether three inexpensive sensors can really carry that decision."],
     ["In your own words, if you saw it at school",
      "Because of what we see in our own school every day. The waste is everywhere, and even where there are bins, the plastic, the metal and the food waste all end up mixed in the same one. We wanted to improve that. So we built something that segregates it for you the moment you throw it in, which also gives students and staff a reason to use the bin properly instead of walking past it. We used the tools and the ideas available to us, an Arduino, three sensors and two servos, and we put them together to help with a real problem in our own building, and with the environment beyond it."]], a:[
  "Answer with an observation, not a definition. Something you actually saw &mdash; the labelled bins in your building being emptied into one sack, or a recyclables batch turned away because it was wet.",
  "Then the gap. The bins were already labelled and RA 9003 already requires segregation, so what is missing is not information. It is the moment of disposal itself.",
  "Then the decision: move the sorting from the person to the bin, using sensors cheap enough that a school could actually build one.",
  "Close on why it had to be built rather than written about &mdash; you needed to know whether three cheap sensors can really carry that decision. Keep it under a minute. Every other question today grows out of this one."],
 f:[["You said you observed it. Where, and when?",
     "In our own building, during cleaning duty. The segregated bins on our floor were being emptied into one sack at the end of the day. We asked the maintenance staff and they told us it was faster that way, and that is when we realised the problem was not knowledge."],
    ["So is this your idea, or your adviser's?",
     "The observation and the design are ours. Our adviser's only steer was to narrow it from five categories to three, because five was not achievable with the sensors we could afford. Everything else we decided ourselves."],
    ["Why has nobody in your school solved this already?",
     "Because the usual response is more signage and more reminders, which treats it as an awareness problem. Nobody had tried moving the decision off the person. It is also the first year our strand has had the electronics available to attempt it."],
    ["If segregation is already required by law, is your problem really a technology problem?",
     "It is a compliance problem, and we are proposing a technical way to remove the need for compliance. We are not claiming technology replaces the law. We are claiming that a bin which sorts correctly regardless of who uses it makes the law enforceable at the point where it currently fails."]]},

{p:1, cat:"Opening", q:"Where did the idea actually come from? Was it assigned to you, or did you observe it yourselves?",
 s:[["The full answer",
      "It started as our own observation, not an assignment. We were on cleaning duty and we watched the segregated bins get combined into one sack, and when we asked, we were told it was faster that way. Our adviser's only steer was to narrow it from five categories to three, because five was not achievable with the sensors we could afford. Everything after that is ours: the two stage sensing, the rotating triangular platform, and the failure map we wrote for our own machine. We kept this topic because it was something we could test, not because it sounded good on a title page."],
     ["Shorter, if they only want the source",
      "We observed it ourselves during cleaning duty. Our adviser only suggested we narrow it from five categories to three. The design, the two stage sensing and the rotating platform are ours, and we chose this topic because it was the one we could actually test."]], a:[
  "Say plainly which it was. A panel can tell when a team is dressing up an assigned topic, and being caught at it costs more than admitting it.",
  "If you observed it, name the place, the time and who you asked about it afterwards.",
  "If it began as a suggestion, say what you did to make it yours &mdash; the rotating platform, the two-stage sensing, the failure map you wrote yourselves.",
  "Either way, land on the same point: you kept this one because you could test it, not because it sounded good on a title page."],
 f:[["What was your second choice, and why did you drop it?",
     "Our second choice was [your other topic]. We dropped it because we could not test it within the term with the equipment we had. We chose this one specifically because every claim in it could be measured on a bench."],
    ["What would have made you abandon this one?",
     "If the inductive and capacitive heads could not separate a can from a bottle reliably at a fixed gap. We tested that first, before building anything, because the whole design rests on it. If that had failed we would have moved to a camera and a different project."]]},

{p:1, cat:"Opening", q:"Introduce your machine to us in thirty seconds, as though we had never seen it.",
 s:[["The full answer",
      "This is a waste bin that sorts what you put into it, into biodegradable, plastic and metal. It decides in two stages. At the throat there is an inductive head and a capacitive head facing each other. The inductive one names metal, the capacitive one names plastic. Below them an infrared sensor watches the closed gate and catches anything the first two could not name, and we treat that as biodegradable. Once it has decided, one servo turns a triangular platform so the correct bin sits under the hole, a second servo opens the gate, and the waste drops. An ultrasonic sensor looks into whichever bin is parked there and locks the machine when that bin is full."],
     ["Shorter, about fifteen seconds",
      "It is a bin that sorts what you throw into it. Two sensors at the throat identify metal and plastic, an infrared sensor at the gate catches everything else as biodegradable, and a rotating platform brings the right bin under the hole before the gate opens."]], a:[
  "One sentence on what it is, one on how it decides, one on what happens after it decides. Practise until it is thirty seconds, not ninety.",
  "What it is: a bin that sorts what you put into it &mdash; biodegradable, plastic, metal.",
  "How it decides: two sensing stages. An inductive and a capacitive head across the throat name the material; an IR sensor at the gate catches whatever they could not name.",
  "What happens next: a servo turns a triangular platform so the right bin sits under the hole, a second servo opens the gate, and an ultrasonic sensor locks the machine when a bin is full."],
 f:[["Now do it in one sentence.",
     "It is a bin that sorts what you put into it into biodegradable, plastic and metal, using two sensing stages and a rotating platform."],
    ["You said two stages. Which one is doing the harder job?",
     "Stage one, the inductive and capacitive heads, because that is the only stage that actually identifies anything. Stage two only reports that something is present. If stage one misses, stage two cannot recover it, and that is exactly our main weakness."]]},

{p:1, cat:"Opening", q:"Why this title? What is the word Pro claiming, and can you defend the claim?",
 s:[["The full answer",
      "EnviroSortPro has three parts. Enviro is the purpose, solid waste at the point of disposal. Sort is what the machine actually does, a three way separation. Pro is the part we should defend, and we mean it narrowly. It runs unattended on its own battery, the electronics are in a closed enclosure, and it stops itself when a bin is full instead of overflowing. We are not claiming it is a commercial product. If the panel reads Pro as a claim of production readiness, we would rather rename it than defend a word we cannot support."],
     ["Shorter",
      "Enviro is the purpose, Sort is what it does, and Pro means it runs unattended on its own battery, with an enclosure and a full bin lockout. We are not claiming it is a commercial product, and if the panel thinks the word overclaims, we would drop it."]], a:[
  "EnviroSortPro: the environment, the sorting, and a prototype meant to be used rather than demonstrated. Say what each part of the name is doing.",
  "Do not over-claim. Here Pro means it runs unattended on its own battery, in an enclosure, with a full-bin lockout &mdash; not that it is a commercial product.",
  "If you cannot defend a word in your own title, drop the word. That is a fair thing for a panel to test, and conceding it costs you nothing."],
 f:[["So would you rename it? To what?",
     "If the panel finds that Pro overclaims, we would drop it and call it EnviroSort. The word is not doing any work the machine is not already doing, and we would rather lose it than defend it."]]},

{p:2, cat:"Opening", q:"Who is in your group, and what did each of you actually build?",
 s:[["The full answer",
      "There are four of us. [Name] wrote and debugged the sketch, so the code questions should go to them. [Name] did the wiring, the enclosure and the sensor mounting, including the grommets and the strain relief. [Name] built the frame, the rotating platform and the triangular plate with the retaining rail. [Name] ran the testing and kept the log, and wrote the documentation and the maintenance sheet. We were all present at every test session, because the person feeding the waste cannot also be the person recording the result."],
     ["If your split was uneven, say so",
      "There are four of us, and the split was not even. [Name] wrote most of the sketch and [Name] did most of the build, so those two carried the heaviest parts. [Name] ran the testing and kept the log, and [Name] handled the documentation and the presentation. We would rather tell you that honestly than describe a split that did not happen."]], a:[
  "Name each member and one concrete thing they own. A vague answer here reads as one person having done everything.",
  "Split it the way the work really split: the sketch, the wiring and enclosure, the frame and rotating platform, the testing log and documentation.",
  "Whoever wrote the code should be the one taking the code questions. Say so now, so the panel directs them to the right person.",
  "If the split was uneven, do not invent an even one. Say who carried what."],
 f:[["Who wrote the code? Let them answer the next one.",
     "[Name] wrote it. They are here and they will take the code questions."],
    ["What did the person who did the least contribute?",
     "[Name] carried the testing and the documentation, which is the least visible part, but it is where all nine of our findings came from. Nobody in the group did nothing, and I would not want the log keeping treated as the smallest job."]]},

/* ---------- strengths ---------- */
{p:2, cat:"Strength", q:"What is the single greatest strength of this project?",
 s:[["The full answer",
      "That it works end to end on parts a student can buy and repair, and that it decides deterministically. There is no dataset, no training and no network. Every placement can be traced back to a specific line in the sketch, which means we can predict what the machine will do before it does it, including the cases where it will be wrong. Almost nothing built on a trained model can be defended that way in a twenty minute session. That is why we could produce a list of our own failures instead of waiting for someone else to find them."],
     ["A different angle, for a non technical panelist",
      "That it removes the need for anyone to make the right choice. Every other approach to this problem, signage, seminars, colour coded bins, still depends on a person deciding correctly while holding something they want to get rid of. Ours takes that decision out of the moment entirely. That is the strength, and everything technical in the design exists to serve it."]], a:[
  "Pick one and commit to it. Hedging across five strengths reads as having none.",
  "The strongest honest answer: it works end to end on parts a student can buy and repair &mdash; no dataset, no training, no cloud &mdash; and it decides deterministically, so every placement can be traced to a line of code.",
  "Back it with what that buys you: you can predict what the machine will do before it does it, including the failures. Almost nothing built on a trained model can be defended that way in a twenty-minute session.",
  "Then stop talking. Let them ask for the second one."],
 f:[["Compared to what, though?",
     "Compared to a camera based sorter at the same stage of development. Ours has lower capability but complete traceability. We can say why any placement happened. A model of the size we could train would not give us that."],
    ["Is that a strength of your design, or of the modules you bought?",
     "The modules are commodity. The strength is what we did with them. Two stages, so that one sensor's blind spot is covered by the other, and a decision order that resolves the case where both fire. That ordering is a design decision, not a purchase."],
    ["What does that strength cost you somewhere else?",
     "Capability. A deterministic three sensor design will never handle glass or paper, and it cannot express uncertainty. We traded ceiling for explainability, and for a first prototype we think that is the right trade."]]},

{p:0, cat:"Strength", q:"Give us three strengths of the design, and rank them.",
 s:[["The full answer",
      "First, mechanical economy. One servo, one gate and one ultrasonic sensor serve three bins, because the bins rotate to the waste instead of the waste being routed to the bins. Second, a legible decision. A deterministic if chain over three digital pins means every placement has a traceable cause. Third, reproducibility. Off the shelf modules, an Uno, plywood and acrylic, so another school could rebuild this from our documentation without our help. I put economy first because it is what makes the other two affordable, and reproducibility last because it only matters once the first two are true."],
     ["Shorter",
      "One, economy: one servo, one gate and one sensor serve three bins. Two, traceability: every placement comes from a specific line of code. Three, reproducibility: any school could rebuild it from our documentation. Economy first, because it is what makes the other two affordable."]], a:[
  "One, mechanical economy: a single servo, a single gate and a single ultrasonic serve three bins, because the bins rotate to the waste instead of the waste being routed to the bins.",
  "Two, a legible decision: a deterministic if-chain over three digital pins means every placement has a traceable cause. That is worth more on a defense day than a few points of accuracy.",
  "Three, reproducibility: off-the-shelf modules, an Uno, plywood and acrylic. Another school could rebuild this from your documentation without your help.",
  "Then rank them out loud and say why that order. The ranking is the part actually being asked for."],
 f:[["Why is that one first and not the third?",
     "Because mechanical economy is what makes the other two possible. If we had needed three servos, three gates and three sensors, the cost and the wiring would have put reproducibility out of reach for the school we designed it for."],
    ["Which of the three would survive if the budget were halved?",
     "All three, because the rotating platform is what makes it cheap in the first place. What we would lose is the LCD and the enclosure, and those are for the operator, not for the sorting."]]},

{p:1, cat:"Strength", q:"What can your machine do that a person standing beside three labelled bins cannot?",
 s:[["The full answer",
      "It does not get tired, distracted or hurried, and it does not need to know the rules, which is exactly where human segregation fails. It applies the same criteria at seven in the morning and at eleven at night, and it stops itself when a bin is full rather than piling waste on top. But I want to be fair about the comparison. A person can sort glass, paper, and wet from dry, and ours cannot. So the claim is consistency, not superiority. A person is more capable. The machine is more consistent, and consistency is the property that was actually missing."],
     ["Shorter",
      "It is consistent where a person is not. It never gets tired, hurried or distracted, and it does not need to know the rules. A person is more capable and can sort things we cannot, but the failure we actually observed was a consistency failure, not a capability one."]], a:[
  "It does not get tired, distracted or hurried, and it does not need to know the rules &mdash; which is exactly where human segregation fails.",
  "It applies the same criteria at seven in the morning and at eleven at night, and it stops itself when a bin is full instead of piling waste on top.",
  "Be fair in the same breath: a person can sort glass, paper, and wet from dry, and this cannot.",
  "The claim is consistency, not superiority. That version of the claim is defensible; the other is not."],
 f:[["So a person is still better. Why build it?",
     "A person is more capable and less consistent, and the failure we observed is a consistency failure, not a capability failure. The bins were labelled and people still combined them. We are addressing the part that actually broke."],
    ["How would you measure consistency, as a number?",
     "The same item, fed the same way, a fixed number of times, and the proportion of identical placements. Ours is effectively one hundred percent for a given input and technique, because the decision is deterministic. What varies is whether the technique was followed."]]},

{p:0, cat:"Strength", q:"What part of this are you most proud of, technically?",
 s:[["The full answer",
      "The geometry of the platform. We wanted three bins on one rotating plate with nothing wasted, so we put their centres on a circle of radius two times the bin radius over root three, which is exactly the radius at which three equal circles touch. Then the plate is the smallest triangle that still contains all three, with each bin tangent to two sides, and a retaining rail on every edge so nothing tips while it spins. We got it wrong twice before that. Our first plate was a circle, heavier than it needed to be, and our second was a triangle sized by eye, and a bin overhung the edge."],
     ["If you would rather name the method than the mechanism",
      "That we broke our own machine on purpose. All nine findings in our analysis came from trying to make it fail, not from demonstrating it, and each one is written down with the line of code responsible and the fix beside it. We are more proud of knowing where it breaks than of any single part of the build."]], a:[
  "Pick something specific and small enough to explain in a minute. Not &ldquo;everything worked&rdquo;.",
  "A good candidate is the platform geometry: the three bins touch, their centres lie on a circle of radius 2&middot;binR/&radic;3, and the plate is the smallest triangle that still holds all three, with a rail so nothing tips as it spins.",
  "Another is having read your own sketch honestly enough to find nine faults in it and write them down before anyone else did.",
  "Say why it was hard, not just that it is good. The difficulty is the answer."],
 f:[["Where did that geometry come from?",
     "From the condition that three equal circles touch, which puts their centres on a circle of radius two r over root three. We derived it because we wanted the smallest possible plate, and then checked it against the physical bins."],
    ["What did you get wrong before you got that right?",
     "Two things. Our first plate was a circle, which was heavier than it needed to be. Our second was a triangle sized by eye, and one bin overhung the edge, so it tipped when the plate accelerated."]]},

/* ---------- more on the limits ---------- */
{p:2, cat:"Limitations", q:"What is the single greatest weakness of this project?",
 s:[["The full answer",
      "That the machine cannot recover from an item it failed to identify at stage one. Anything the two proximity heads miss is called biodegradable by default, so a can thrown in quickly lands in the biodegradable bin, and nothing anywhere tells the user that it was a guess. I call it the greatest weakness because it is silent. A visible failure gets corrected by whoever is standing there. An invisible one quietly contaminates the bin, which is the exact problem we set out to solve. The fix is to latch stage one on an interrupt and add a not recognised state, and we would accept a slower cycle to get it."],
     ["A different angle, if you would rather name the room light",
      "The one that worries us most in practice is the infrared head, because it can fire with nothing in the machine. It is an obstacle module with a comparator and a trim pot, and it cannot tell its own emitter from a window or a halogen lamp. That means our machine's correctness depends on where you put it, which is a real weakness for something meant to be installed and left alone. The permanent fix is a shrouded or modulated head."]], a:[
  "Name it before they do, and name the real one rather than a safe one. Ours: the machine cannot recover from an item it failed to identify at stage 1.",
  "Anything the two proximity heads miss is called bio by default, so a thrown can lands in the bio bin &mdash; and nothing anywhere tells the user that it was a guess.",
  "Say why that is the biggest: it is silent. A visible failure gets corrected by whoever is standing there; an invisible one quietly contaminates the bin.",
  "Then the fix and its price: latch stage 1 on an interrupt, add a <i>not recognised</i> state, and accept a slower cycle for it."],
 f:[["Why did you not fix it before today?",
     "Because the fix is not the one line kind. Catching a thrown item means moving stage one off the polling loop and onto an interrupt, and that is the non blocking rewrite. We chose to characterise the failure fully and present it honestly rather than half fix it the week before the defense."],
    ["How long would that fix take you?",
     "The interrupt on stage one and a not recognised state, about two weeks including re testing. The alternative state machine is already written. What is not done is the re test, and we would not claim the fix without it."],
    ["Does that make your accuracy figure meaningless?",
     "No, it makes it conditional. Our figure is accuracy under our stated technique, and we report the thrown item failures inside it rather than excluding them. What it is not is accuracy for an untrained user, and we do not claim that."]]},

{p:0, cat:"Limitations", q:"Name three weaknesses without us having to ask twice, and tell us which you would fix first.",
 s:[["The full answer",
      "One, the biodegradable branch has no guard, so anything the infrared sensor sees overrides a decision already made. Two, at rest the ultrasonic sensor looks into the metal bin, because home is write ninety and metal is write eighty, so the biodegradable and plastic bins can sit full and unreported. Three, the loop blocks for about one point seven seconds per cycle, so a thrown item is never sampled at stage one and a short press of D10 can be missed. I would fix the guard first. It is one line, it changes real placements, and it has no side effects. The third is the largest change and I would do it last."],
     ["Shorter",
      "The biodegradable branch has no guard, so it can override a decision already made. At rest the ultrasonic sensor watches only the metal bin. And the loop blocks for about one point seven seconds, so thrown items and short button presses are missed. I would fix the guard first: one line, real effect, no side effects."]], a:[
  "One: the bio branch has no guard, so anything the IR sees overrides a decision already made. That is finding #1 and it costs one line to fix.",
  "Two: at rest the ultrasonic looks into the metal bin, because home is <code>write(90)</code> and metal is <code>write(80)</code>. Bio and plastic can sit full and unreported.",
  "Three: the loop blocks for roughly 1.7 s per cycle, so a thrown item is never seen at stage 1 and a short press of D10 can be missed entirely.",
  "Fix the bio guard first &mdash; one line, real change in placement, no side effects. Give the reason for the ranking, not just the ranking."],
 f:[["Show us the line you would change.",
     "In handleWasteDetection, the third condition. If val bio is LOW becomes if val bio is LOW and not metalDetected and not plasticDetected. That is the whole change."],
    ["Why is the third one last if it affects every cycle?",
     "Because it is the only one that requires restructuring the sketch rather than editing it. The first two are safe, local changes I would ship immediately. The third needs a full re test before I would trust it, and I would not rush that."]]},

{p:1, cat:"Limitations", q:"What can this machine simply not do?",
 s:[["The full answer",
      "Glass and paper. Glass trips no sensor at all, so it sits on the gate and the machine simply stops, and paper reads as biodegradable whether or not it is recyclable. It cannot handle more than one item at a time, because two materials arrive and only one answer comes out. Wet biodegradable waste held up at the heads can read as plastic, because the capacitive sensor responds to water. And it cannot tell you that it was unsure. There is no confidence value anywhere, only a branch that was taken."],
     ["Shorter",
      "Glass, paper, more than one item at a time, and wet biodegradable waste held up at the heads. And it cannot tell you that it was unsure, because there is no confidence value anywhere, only a branch that was taken."]], a:[
  "Glass and paper. Glass trips no sensor at all and just sits on the gate; paper reads as bio whether or not it is recyclable.",
  "More than one item at a time &mdash; two materials arrive and only one answer comes out.",
  "Wet bio held up at the heads can read as plastic, because the capacitive sensor responds to water.",
  "And it cannot tell you it was unsure. There is no confidence value, only a branch that was taken. Saying that plainly is far stronger than an excuse."],
 f:[["Then how do you know the bins are actually clean?",
     "We do not, beyond our own trials, and I would not claim it. What we can say is what fraction of controlled trials placed correctly and which failure modes produce contamination. Verifying a bin in real use would need a separate audit, and that is outside our scope."],
    ["Is a three-way sort even useful if glass is excluded?",
     "Yes, because glass is a small share of what goes into a campus bin and it is usually recognised by the person throwing it. The categories that get confused day to day are exactly the three we handle. It does mean the machine has to be sited where glass is not expected."]]},

{p:2, cat:"Limitations", q:"Suppose it fails in front of us in the next five minutes. What will most likely have caused it?",
 s:[["The full answer",
      "Most likely room light. The infrared head cannot distinguish its own emitter from a window or a halogen lamp, so if the throat is lit the biodegradable branch can fire with nothing in the machine. Second most likely, an item thrown rather than presented, so stage one never sees it and it goes to biodegradable. Third, a sagging battery making the platform slow, so the gate opens before the plate has arrived and the waste lands in the bin that is passing. We tuned the trim pot in this room before we started and we are on the adapter, so the first and third should be covered."],
     ["Shorter",
      "Room light on the infrared head first, an item thrown rather than presented second, and a weak battery making the platform slow third. We tuned the trim pot in this room and we are on the adapter, so the first and third should be covered."]], a:[
  "Room light. The IR head cannot distinguish its own emitter from a window or a halogen lamp, so a lit throat can fire the bio branch on an empty gate.",
  "Second most likely: an item thrown rather than presented, so stage 1 never sees it and it goes to bio.",
  "Third: a sagging battery pack making the platform slow, so the gate opens before the plate has arrived.",
  "Having that ranked in advance <i>is</i> the answer. It tells the panel you tested until you knew the order."],
 f:[["So which one do you expect today?",
     "None of them, because we tuned the trim pot in this room and we are on the adapter rather than the battery. If one does happen I expect the infrared, and if it does I will show you the module's own output LED, so you can see it is the sensor and not the code."],
    ["What have you done in this room to prevent the first one?",
     "We powered up with the throat empty and checked that the green LED and the module LED were both off, then backed the trim pot off until they were, and confirmed that a sheet of paper on the gate still trips it. We also kept the machine away from the window."]]},

/* ---------- closing ---------- */
{p:0, cat:"Closing", q:"What was the hardest problem you hit while building this, and how did you solve it?",
 s:[["The full answer",
      "Getting the gate and the platform to agree. Early on the gate was opening before the plate had arrived, so waste fell into whichever bin happened to be passing, and it looked random. We first assumed the servo was faulty and replaced it, which changed nothing. Then we timed the travel and found that the worst case, home to plastic, is two hundred forty seven degrees of real rotation on a 270 degree servo, and the delay we had was not covering it. We set moveServos to hold the gate for a full second, which covers the worst case, and the randomness disappeared. What it changed in the design is that we now time against the longest move, not the typical one."],
     ["If you would rather name a non technical one",
      "Testing honestly. It is very tempting to run the demonstration that works and record that as your result. We had to agree as a group that a trial counted whether or not it went well, including the thrown can misses, and that pushed our accuracy figure down. It was the hardest decision we made, and it is the reason we can defend the number."]], a:[
  "Pick a real one with a before and an after. &ldquo;Time management&rdquo; is not an engineering answer.",
  "A good one: the platform arriving after the gate had already opened, so waste fell into whichever bin happened to be passing. Solved by timing the worst case &mdash; home to plastic, 247&deg; of travel &mdash; and holding the gate shut for the full second.",
  "Say what you tried that did not work. A panel trusts a team that can describe a dead end.",
  "End with what it changed in the design, not just that it got fixed."],
 f:[["What did you try first?",
     "We replaced the servo, because we assumed it was faulty. It changed nothing, and that is what told us the problem was timing rather than hardware."],
    ["How do you know one second is enough and not 1.2?",
     "We timed the worst case, home to plastic, which is two hundred forty seven degrees, and it completes inside a second with margin at full battery. What we have not done is re time it on a depleted pack, and that is a fair gap."]]},

{p:1, cat:"Closing", q:"What did you learn from building this that you could not have learned from reading about it?",
 s:[["The full answer",
      "Three things. Physically, that a datasheet range is not the range you get inside a plywood throat, and that a sensor threshold is not a number in a document, it is a trim pot somebody has to turn in the actual room. In code, that delay is free until the moment a button press lands inside it. And about method, that you find the real failures by trying to break your own machine, not by demonstrating it. Every one of the nine findings in our analysis came from trying to make it fail, not from a successful run."],
     ["Shorter",
      "That a datasheet number is not what you get inside a plywood throat, that a sensor threshold is a trim pot somebody has to turn in the actual room, and that you only find the real failures by trying to break your own machine rather than by demonstrating it."]], a:[
  "Something physical: that a datasheet range is not the range you get inside a plywood throat, and that a sensor threshold is a trim pot somebody has to turn in the actual room.",
  "Something about code: that <code>delay()</code> is free until the moment a button press lands inside it.",
  "Something about method: that you find real failures by trying to break your own machine, not by demonstrating it.",
  "One of each is enough. Three concrete sentences beat a paragraph of reflection."],
 f:[["Which of those surprised you most?",
     "The infrared one. We expected a sensor to report objects, not light, and finding that a lamp could trigger a placement on an empty machine changed how we tested everything else."]]},

{p:2, cat:"Closing", q:"If we approve this today, what is the very next thing you do?",
 s:[["The full answer",
      "The four code fixes, this week. Guard the biodegradable branch, INPUT PULLUP on the sensor pins, a timeout on pulseIn, and reject a zero distance. [Name] does those, because they wrote the sketch. Then we re run the full test set and compare accuracy per material before and after, so the improvement is evidenced rather than claimed. Then the hood over the throat, because that removes the failure most likely to embarrass us in a room we have not tuned for. We would expect all three inside two weeks."],
     ["Shorter",
      "The four code fixes this week, the re test the week after, then the hood over the throat. We would not claim any improvement until the re test is done."]], a:[
  "Have one answer, not a wish list. The four code fixes first, because they change behaviour and cost nothing.",
  "Then re-run the full test set and compare accuracy per material, before and after, so the fix is evidenced rather than claimed.",
  "Then the hood over the throat, because it removes the failure most likely to embarrass you in a room you have not tuned for.",
  "Say the order and the reason for the order. That is what is being asked."],
 f:[["By when?",
     "The four code fixes this week, the re test the following week, and the hood within the same two weeks, since it is a physical part we can cut ourselves."],
    ["Who in your group does it?",
     "[Name] does the code fixes, because they wrote the sketch. [Name] and [Name] run the re test, because testing has been theirs throughout. The hood is [Name]'s, with the enclosure."]]},

{p:1, cat:"Closing", q:"Is there anything you would like the panel to know that we have not asked you?",
 s:[["The full answer",
      "Yes. Every weakness we described today, we found ourselves, before this defense, by trying to break our own machine, and each one is written down with the line of code responsible and the fix beside it. We would rather be judged on that than on the accuracy figure, because the figure will change with the next revision and the method will not. Thank you."],
     ["A different angle, closing on the method",
      "Only this. We came in expecting to defend a machine, and what we would most like on the record is the method. We tried to break our own work before anyone else could, and everything we found is written down with its fix beside it. Thank you for the questions, particularly the hard ones, because those are the ones we will act on."]], a:[
  "Yes &mdash; always yes. Have one sentence ready, and do not spend it on thanks.",
  "Use it for whatever you most want on the record and were not asked: the failure map, the fact that you found the nine faults yourselves, or the maintenance sheet you wrote for whoever inherits the machine.",
  "One sentence, then stop. Ending early and cleanly reads as confidence; filling the silence reads as the opposite."],
 f:[["Why did you not lead with that?",
     "Because it would have sounded like an excuse before you had seen the machine work. It is worth more now that you have."]]}
];

/* The bank is written grouped by panelist, but a defense does not run that way.
   It opens with why you are here, works through the study, asks what is good and
   what is broken, then gets hard and closes. Bucket the questions into that arc,
   keeping source order inside each block, so an unshuffled run reads like a real
   session and question one is always "why did you come up with this study?".   */
var CATS = ["Opening", "Concept", "Design", "Code", "Testing",
            "Strength", "Limitations", "Impact", "Curveball", "Closing"];
QBANK = (function(){
  var bucket = {}, out = [];
  CATS.forEach(function(c){ bucket[c] = []; });
  QBANK.forEach(function(q){ (bucket[q.cat] || (bucket[q.cat] = [])).push(q); });
  CATS.forEach(function(c){ out = out.concat(bucket[c]); });
  return out;
})();

/* Each question carries one or more answer versions as [label, script] pairs.
   Accept a bare string too, so a question can be added without the wrapper.   */
QBANK.forEach(function(q){
  if(typeof q.s === "string") q.s = [["The full answer", q.s]];
  else if(!q.s) q.s = [];
});

/* What a panel says when your answer did not finish the matter. Each question
   may carry its own probes in `f`; these are the fallbacks for its category.  */
var PROBES = {
  Opening:     [["Say that again in one sentence.",
     "Give the one sentence version you already prepared, and do not add to it. If you have not prepared one, say the subject, the action and the outcome: what it is, what it does, what comes out."],
                ["Who else did you talk to before you settled on this?",
     "Name real people and what each told you: the maintenance staff, your adviser, anyone at the MRF. If you talked to nobody, say so and say what you read instead."],
                ["What would have made you abandon the idea?",
     "Name the single assumption the whole project rests on, and say that failing it would have ended the project. Ours is that the two proximity heads can separate a can from a bottle at a fixed gap."]],
  Concept:     [["Give us one concrete example.",
     "One specific item, one specific place, one specific outcome. Not a category. A panel asks this when your last answer was abstract, so answer with a thing you can point at."],
                ["Who benefits first, and how would you know that they had?",
     "Name the group, then name the measurement that would show it: less contamination in a batch, fewer rejected pickups, less time spent re sorting. If you cannot name the measurement, say so."],
                ["What changes if you turn out to be wrong about that?",
     "Say which part of the project survives and which part does not. Being able to separate the two is the answer. Defending the whole thing is not."]],
  Design:      [["Why not the simpler version?",
     "Name the simpler version explicitly, then give the one property it lacks. Do not argue that it would not work, say what it would cost you."],
                ["What did you try before this, and why did it not work?",
     "Describe one real earlier version and the specific failure that ended it. A dead end you can describe is evidence that you iterated."],
                ["What breaks first if you double the size of it?",
     "Think mass and travel, not electronics. Ours is the servo torque and the settle time before the gate opens. The sensing does not change."]],
  Code:        [["Show us the line.",
     "Open the sketch on the screen, find the line, and read it out before you explain it. Do not paraphrase from memory. This question is testing whether you can find your own code."],
                ["What happens if that condition is never true?",
     "Trace it out loud: which branch runs instead, what the LCD shows, and where the waste ends up. If the answer is that nothing happens and the item sits there, say that."],
                ["How would you test that, specifically?",
     "Name the input, the expected output, and how you would observe it, usually the serial monitor or an LED. A test you cannot observe is not a test."]],
  Testing:     [["How many times?",
     "Give the number. If it is small, give it anyway and say it is small. Any hedge here reads as not having counted."],
                ["Who else could repeat that and get the same number?",
     "Say what someone would need: the same items, the same technique, the same lighting, and your written procedure. If the procedure is not written down, say that it is not."],
                ["What did you leave out of the data, and why?",
     "If you discarded nothing, say so plainly. That is the strongest answer. If you did discard something, name what and why, and say what the figure looks like with it included."]],
  Strength:    [["Compared to what?",
     "Name the alternative you are better than, at the same stage and the same cost. A strength with no comparison is a claim, not a strength."],
                ["What does that strength cost you elsewhere?",
     "Every design choice trades something away. Name the thing you gave up. Refusing to name one reads as not having thought about it."],
                ["Would it still be a strength on the tenth unit?",
     "Separate what scales from what does not. Cheap parts and simple wiring scale. Anything that depends on your own tuning does not."]],
  Limitations: [["Why did you not fix it?",
     "Give the real reason: time, cost, or that the fix needs a re test you could not complete. Do not say you did not notice, if you did."],
                ["How long would the fix take?",
     "Give a number in days or weeks and say what is included. If re testing is the long part, say so."],
                ["Does that make the results unusable, or only narrower?",
     "Say which, and defend it. Narrower means your figure holds under stated conditions, so say what those conditions are."]],
  Impact:      [["Give us a number.",
     "Any number you have actually measured, with its unit and where it came from. If you do not have it, say you do not have it and say how you would get it."],
                ["Who pays for it?",
     "Name who buys it and who maintains it, and say whether those are the same people. If nobody has budget for it, that is a finding, not a failure."],
                ["What does year two look like?",
     "Wear, maintenance, and whether anyone is still using it. Sensor faces, servo wear and the battery pack are what age in ours."]],
  Curveball:   [["So is the project a failure?",
     "No, and answer that in one word first. Then say what the failure bounds: which claims still hold, and which you are withdrawing. Never accept the framing whole and never reject it whole."],
                ["Did you know that before today?",
     "If you did, say so and point at where you documented it. If you did not, say so plainly. Being caught adjusting the answer is far worse than not having known."],
                ["Why should we accept that answer?",
     "Point at the evidence, not at the reasoning: the log, the serial output, the line of code, or the machine in front of them. Offer to demonstrate it."]],
  Closing:     [["Is that the honest answer, or the prepared one?",
     "Both, if that is true. Say what you prepared, then add the part you did not prepare. Silence here reads worse than either."],
                ["What would you tell the next batch who take this up?",
     "One piece of practical advice from something that cost you time: the trim pot, the servo travel, the pull ups. Specific beats inspirational."]]
};

/* the phases where someone is actually putting a question to you, and the
   subset of those where a mouth is moving on the panel                    */
var ASK_PHASE   = {asking:1, answering:1, timeup:1, wrapup:1, verdict:1};
var SPEAK_PHASE = {asking:1, wrapup:1, verdict:1};
var CLOSING     = {wrapup:1, confer:1, verdict:1, applause:1};

var iv = {
  on:false, phase:"idle", qi:-1, order:[], pos:-1,
  speaker:-1, endsAt:0, remain:0, answerMs:60000, clockMs:60000, askStart:0, askEst:0,
  reveal:0, paused:false, text:"", cats:{}, utter:null, spokeDone:false,
  follow:null, followScript:"", followScripted:false, followUsed:[], alt:0,
  reading:null, readAt:0, answerBy:-1,
  cues:[], badge:"", sayThen:null, sayFallbackAt:0, passed:false, side:"panel"
};
CATS.forEach(function(c){ iv.cats[c] = true; });

/* ---------- camera: walk the room, or let it follow the speaker ----------
   The whole scene is one 1200x820 drawing, so moving the camera is moving the
   viewBox: drag it about, push in on any corner of the room, or hand it back
   to the defense and it frames whoever is speaking. Every box keeps the
   scene's own proportions, so nothing is ever stretched or letterboxed.    */
var SCENE_W = 1200, SCENE_H = 820, CAM_ASPECT = SCENE_W / SCENE_H;
var CAM_MIN = 190;                       /* how close the camera is allowed */
function fitBox(x, y, w){
  w = Math.max(CAM_MIN, Math.min(SCENE_W, w));
  var h = w / CAM_ASPECT;
  return {x:Math.max(0, Math.min(SCENE_W - w, x)),
          y:Math.max(0, Math.min(SCENE_H - h, y)), w:w, h:h};
}
/* scale a box about a point given as a fraction of the box itself */
function zoomBox(b, k, fx, fy){
  var w = Math.max(CAM_MIN, Math.min(SCENE_W, b.w * k)), h = w / CAM_ASPECT;
  return fitBox(b.x + (b.w - w) * fx, b.y + (b.h - h) * fy, w);
}
var FULL = fitBox(0, 0, SCENE_W), FOCUS = fitBox(20, 0, 540);
/* the group, framed with room above their heads for the bubble */
var FOCUS_STU = fitBox(0, 455, 520);
var VIEWS = {
  room:    FULL,
  group:   FOCUS_STU,
  panel:   FOCUS,
  machine: fitBox(430, 80, 560),
  bins:    fitBox(495, 470, 470),
  /* not on the bar — the presentation walks the camera through these */
  mouth:   fitBox(556, 84, 330),
  bore:    fitBox(556, 8, 570),
  throat:  fitBox(490, 160, 470),
  gate:    fitBox(540, 210, 450),
  brain:   fitBox(360, 130, 430),
  us:      fitBox(560, 320, 520),
  lower:   fitBox(430, 280, 620),
  pedestal:fitBox(455, 470, 560),      /* the plate and the D5 label under it */
  all:     fitBox(340, 96, 900),
  clear:   fitBox(430, 440, 770),
  belt:    fitBox(0, 360, 520)
};
var cam = {from:FULL, to:FULL, at:0, dur:760, cur:FULL, done:true, free:false};
function sameBox(a, b){
  return !!a && !!b && Math.abs(a.x - b.x) < 0.5 &&
         Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5;
}
function applyView(){
  var c = cam.cur;
  $("scene").setAttribute("viewBox",
    c.x.toFixed(1) + " " + c.y.toFixed(1) + " " + c.w.toFixed(1) + " " + c.h.toFixed(1));
  $("sceneCard").classList.toggle("zoomed", c.w < SCENE_W - 10);
}
function camTo(box, dur){                /* glide there */
  if(sameBox(cam.to, box)) return;
  cam.from = cam.cur; cam.to = box; cam.at = Date.now();
  cam.dur = dur || 760; cam.done = false;
}
function setBox(b){                      /* go there now — for dragging */
  cam.cur = fitBox(b.x, b.y, b.w);
  cam.from = cam.to = cam.cur; cam.done = true;
  applyView();
}
function stepCam(){
  if(cam.done) return;
  var t = Math.min(1, (Date.now() - cam.at) / cam.dur);
  var e = easeInOut(t), f = cam.from, g = cam.to;
  cam.cur = t >= 1 ? g : {x:f.x + (g.x - f.x)*e, y:f.y + (g.y - f.y)*e,
                          w:f.w + (g.w - f.w)*e, h:f.h + (g.h - f.h)*e};
  applyView();
  if(t >= 1) cam.done = true;
}
/* which box the camera should be on right now, when it is following */
function camFocus(){
  if(cam.free) return;                   /* it is yours until you hand it back */
  if(!iv.on || !$("ivFocus").checked){ camTo(FULL); return; }
  /* the panel asks, and then the room turns to whoever in the group is taking
     it — the bubble that opens over them is the point of the move            */
  var atGroup = (iv.phase === "intro" && iv.side === "students") || answeringNow();
  camTo(atGroup ? FOCUS_STU : FOCUS);
}
function answeringNow(){
  return iv.on && iv.answerBy >= 0 &&
         (iv.phase === "answering" || iv.phase === "timeup");
}
var viewKey = "";
/* `walk` is declared with the model, far below this, so it is hoisted but not
   yet assigned while the page is still booting */
function walking(){ return !!(walk && walk.on); }
function paintView(key){
  if(key !== undefined) viewKey = key;
  var bar = $("viewbar");
  Array.prototype.forEach.call(bar.querySelectorAll("[data-view]"), function(b){
    b.setAttribute("aria-pressed", String(walking()
      ? b.getAttribute("data-view") === viewKey
      : cam.free && b.getAttribute("data-view") === viewKey));
  });
  $("vbFollow").setAttribute("aria-pressed", String(walking() ? walk.face : !cam.free));
  $("vbFollow").textContent = walking() ? "Face the speaker" : "Follow the speaker";
}
function takeCamera(){ if(!cam.free){ cam.free = true; paintView(""); } }
function giveCamera(){ cam.free = false; paintView(""); camFocus(); }
function viewTo(key){
  takeCamera();
  camTo(VIEWS[key] || FULL, 900);
  paintView(key);
}

/* ---------- walking it: drag, pinch, wheel, double-click ---------- */
(function(){
  var svg = $("scene"), pts = {}, drag = null, pinch = null, swallow = false;
  function ids(){ return Object.keys(pts); }
  svg.addEventListener("pointerdown", function(e){
    swallow = false;
    pts[e.pointerId] = {x:e.clientX, y:e.clientY};
    var k = ids();
    if(k.length === 1) drag = {x:e.clientX, y:e.clientY, box:cam.cur, moved:false};
    else if(k.length === 2){
      var a = pts[k[0]], b = pts[k[1]];
      pinch = {d:Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), box:cam.cur,
               cx:(a.x + b.x) / 2, cy:(a.y + b.y) / 2};
      drag = null;
    }
  });
  window.addEventListener("pointermove", function(e){
    if(!(e.pointerId in pts)) return;
    pts[e.pointerId] = {x:e.clientX, y:e.clientY};
    var r = svg.getBoundingClientRect(), k = ids();
    if(pinch && k.length >= 2){
      var a = pts[k[0]], b = pts[k[1]], d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      takeCamera();
      setBox(zoomBox(pinch.box, pinch.d / d,
                     (pinch.cx - r.left) / r.width, (pinch.cy - r.top) / r.height));
      return;
    }
    if(!drag) return;
    /* a few pixels of slop, so a click on a piece of waste is still a click */
    if(!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return;
    drag.moved = true;
    takeCamera();
    setBox({x:drag.box.x - (e.clientX - drag.x) * (drag.box.w / r.width),
            y:drag.box.y - (e.clientY - drag.y) * (drag.box.h / r.height),
            w:drag.box.w});
  });
  function letGo(e){
    delete pts[e.pointerId];
    if(drag && drag.moved) swallow = true;
    if(ids().length < 2) pinch = null;
    if(!ids().length) drag = null;
  }
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", letGo);
  /* a drag that ended on a sensor must not also press it */
  svg.addEventListener("click", function(e){
    if(swallow){ e.stopPropagation(); e.preventDefault(); swallow = false; }
  }, true);
  svg.addEventListener("dblclick", function(e){
    if(e.target.closest && e.target.closest(".pick")) return;   /* that was a pick */
    var r = svg.getBoundingClientRect();
    takeCamera();
    camTo(zoomBox(cam.cur, e.shiftKey ? 1.7 : 0.6,
                  (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height), 420);
    paintView("");
  });
  svg.addEventListener("wheel", function(e){
    /* the wheel only takes the page over once you are already inside the room,
       or with Ctrl held — at the default view it scrolls the page as normal  */
    if(!e.ctrlKey && cam.cur.w > SCENE_W - 10) return;
    e.preventDefault();
    var r = svg.getBoundingClientRect();
    takeCamera();
    setBox(zoomBox(cam.cur, Math.exp(e.deltaY * 0.0015),
                   (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
  }, {passive:false});
})();

/* ---------- the label layer ----------
   Every callout box, every dashed leader line, the pin lists, the fill
   percentages and the state chip carry class="lbl", so one class on the scene
   takes the whole annotation layer off and leaves the room itself. The two
   alerts stay: you still have to be able to work the machine.            */
var labelsOn = true;
function setLabels(on){
  labelsOn = on;
  $("scene").classList.toggle("nolabels", !on);
  var b = $("vbLabels");
  b.setAttribute("aria-pressed", String(on));
  b.textContent = "Labels: " + (on ? "on" : "off");
  var w = $("wkLabels");
  if(w){ w.setAttribute("aria-pressed", String(on));
         w.textContent = "Labels: " + (on ? "on" : "off"); }
  if(walk && walk.on) walkSig = "";        /* setLabels runs at load, before walk exists */
}

/* one bar, two cameras: the same five places, the same in/out, the same follow
   — they just mean walking somewhere once you are inside the room */
$("viewbar").addEventListener("click", function(e){
  var b = e.target.closest("button"); if(!b) return;
  var v = b.getAttribute("data-view");
  if(v){
    if(walking()){ markFreeWalk(); walkTo(WALK_VIEW[v] || "start"); paintView(v); }
    else viewTo(v);
  }
  else if(b.id === "vbIn"){
    if(walking()){ markFreeWalk(); walk.glide = null; walkGo(420, 0); }
    else { takeCamera(); camTo(zoomBox(cam.cur, 0.66, 0.5, 0.5), 380); paintView(""); }
  }
  else if(b.id === "vbOut"){
    if(walking()){ markFreeWalk(); walk.glide = null; walkGo(-420, 0); }
    else { takeCamera(); camTo(zoomBox(cam.cur, 1.5, 0.5, 0.5), 380); paintView(""); }
  }
  else if(b.id === "vbFollow"){
    if(walking()){ walk.face = !walk.face; paintView(viewKey); }
    else giveCamera();
  }
  else if(b.id === "vbLabels") setLabels(!labelsOn);
});
$("viewbar").addEventListener("keydown", function(e){
  var step = cam.cur.w * 0.12, d =
    e.key === "ArrowLeft"  ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] :
    e.key === "ArrowUp"    ? [0, -step] : e.key === "ArrowDown"  ? [0, step] : null;
  if(!d) return;
  e.preventDefault();
  takeCamera();
  setBox({x:cam.cur.x + d[0], y:cam.cur.y + d[1], w:cam.cur.w});
});

/* ---------- voices ---------- */
var synth = window.speechSynthesis || null;
var voices = [], voiceForced = "", voicesM = [], voicesF = [], voicesX = [];
/* A speech engine will not tell you whether a voice is a man or a woman, so it
   has to be read off the name. These are the en-* voices that actually ship on
   Windows, macOS, iOS, Android and Chrome; anything unrecognised is left unsexed
   and can be handed to either. Note that \bmale\b does not match "Female",
   which is why the male test is safe to run first.                          */
var VOICE_M = /\b(male|man|boy|david|mark|guy|george|ryan|eric|roger|steffan|christopher|brian|alex|daniel|fred|tom|thomas|oliver|aaron|nathan|james|william|liam|matthew|justin|joey|kevin|arthur|gordon|rishi|prabhat|paul|albert|junior|ralph|reed|rocko|grandpa)\b/i;
var VOICE_F = /\b(female|woman|girl|zira|aria|jenny|michelle|ana|eva|hazel|susan|linda|heather|catherine|samantha|karen|moira|tessa|fiona|victoria|allison|ava|nicky|serena|kate|sonia|libby|natasha|clara|amber|emily|joanna|salli|kimberly|kendra|ivy|ruth|danielle|nora|mia|olivia|sophia|zoe|lisa|amy|emma|grace|shelley|flo|sandy|princess|grandma)\b/i;
function voiceSex(v){
  var n = (v && v.name) || "";
  if(VOICE_M.test(n)) return "m";
  if(VOICE_F.test(n)) return "f";
  /* Chrome ships one unlabelled "Google US English" and it is the woman; the
     UK pair says so in its own name and is caught above. */
  if(/^google (us|india|australian) english$/i.test(n.trim())) return "f";
  return "";
}
function loadVoices(){
  if(!synth) return;
  voices = synth.getVoices().filter(function(v){ return /^en/i.test(v.lang); });
  if(!voices.length) voices = synth.getVoices();
  var sel = $("ivVoice");
  while(sel.options.length > 1) sel.remove(1);
  voices.forEach(function(v, i){
    var o = document.createElement("option");
    o.value = String(i);
    var sx = voiceSex(v);
    o.textContent = v.name + " — " + v.lang + (sx ? (sx === "f" ? " · woman" : " · man") : "");
    sel.appendChild(o);
  });
  voicesM = []; voicesF = []; voicesX = [];
  voices.forEach(function(v){
    var sx = voiceSex(v);
    (sx === "m" ? voicesM : sx === "f" ? voicesF : voicesX).push(v);
  });
  assignVoices();
}
/* Give everybody in the room a voice of their own sex, and as far as the
   machine's voice list allows, a different one from the person beside them.
   If the browser has no voice of that sex at all, an unsexed one is pushed
   with pitch instead, so the picture and the sound still agree.            */
function assignVoices(){
  var used = {m:0, f:0};
  [STUDENTS, PANELISTS].forEach(function(list){
    list.forEach(function(P){
      var sx = P.sex || "m";
      var pool = sx === "f" ? voicesF : voicesM;
      var alt  = sx === "f" ? voicesM : voicesF;
      var k = used[sx]++;
      if(pool.length){        P.voice = pool[k % pool.length];    P.shift = 1; }
      else if(voicesX.length){ P.voice = voicesX[k % voicesX.length]; P.shift = sx === "f" ? 1.35 : 0.72; }
      else if(alt.length){     P.voice = alt[k % alt.length];     P.shift = sx === "f" ? 1.5 : 0.6; }
      else {                   P.voice = null;                    P.shift = 1; }
    });
  });
}
function voiceFor(side, i){
  if(!voices.length) return null;
  if(voiceForced !== "") return voices[parseInt(voiceForced, 10)] || null;
  var P = roster(side)[i];
  return P.voice || voices[P.vi % voices.length];
}
/* the character's own pitch, plus whatever push is needed when the browser
   could not give them a voice of the right sex */
function pitchFor(side, i){
  var P = roster(side)[i];
  var p = P.pitch * (voiceForced !== "" ? 1 : (P.shift || 1));
  return Math.max(0.1, Math.min(2, p));
}
/* Nobody in this room speaks in a voice that does not match the figure on
   screen. The answer read-back is spoken by a real member of the group, so it
   goes through voiceFor/pitchFor like every other line; if no member has the
   floor yet the leader takes it, rather than falling back to some unsexed
   voice off the end of the browser's list.                                */
function readerIdx(){ return iv.answerBy >= 0 ? iv.answerBy : LEADER; }

/* what is on the teleprompter right now, and whether it is a script or advice */
function versions(){
  var q = (!iv.follow && iv.qi >= 0) ? QBANK[iv.qi] : null;
  return (q && q.s) ? q.s : [];
}
function scriptNow(){
  if(iv.follow) return iv.followScript || "";
  var v = versions();
  return v.length ? v[iv.alt % v.length][1] : "";
}
function scriptLabel(){
  var v = versions();
  return v.length ? v[iv.alt % v.length][0] : "";
}
function scriptIsAdvice(){ return !!iv.follow && !iv.followScripted; }
function readStop(){
  if(iv.reading){ iv.reading = null; if(synth){ try{ synth.cancel(); }catch(e){} } }
  iv.readAt = 0;
}
function readScript(){
  var t = scriptNow();
  if(!synth || !t){ return; }
  readStop();
  /* read it in the voice of the member whose question it is, so the group does
     not answer everything in one voice — and so the girl in the skirt is not
     read back by Microsoft David */
  var by = readerIdx();
  var u = new SpeechSynthesisUtterance(t);
  var v = voiceFor("students", by);
  if(v) try{ u.voice = v; }catch(e){}
  u.rate = (parseFloat($("ivRate").value) || 0.95) * STUDENTS[by].rate;
  u.pitch = pitchFor("students", by);
  u.volume = 1;
  u.onend = function(){ if(iv.reading === u){ iv.reading = null; paintIv(); } };
  u.onerror = u.onend;
  iv.reading = u;
  try{ synth.speak(u); }catch(e){ iv.reading = null; }
  paintIv();
}
if(synth){
  loadVoices();
  if(typeof synth.onvoiceschanged !== "undefined") synth.onvoiceschanged = loadVoices;
}

/* a short two-note chime when the answer clock runs out */
function chime(){
  if(!soundOn) return;
  var a = ac(); if(!a) return;
  [[880, 0], [1320, 0.16]].forEach(function(n){
    var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + n[1];
    o.type = "sine"; o.frequency.value = n[0];
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + 0.34);
  });
}

/* ---------- the speech bubble over whoever is asking ---------- */
var BUB = {w:268, lh:11.5, fs:9.4, top:6, pad:11, cpl:50};
/* where a bubble is allowed to sit for each side of the room: the panel's sit
   at the top of the scene, the group's over the conveyor above their heads  */
var STAGE = {panel:{top:6, x0:30, x1:550}, students:{top:470, x0:14, x1:512}};
function esc(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function wrap(txt, cpl){
  var words = txt.split(/\s+/), lines = [], cur = "";
  for(var i = 0; i < words.length; i++){
    var t = cur ? cur + " " + words[i] : words[i];
    if(t.length > cpl && cur){ lines.push(cur); cur = words[i]; }
    else cur = t;
  }
  if(cur) lines.push(cur);
  return lines;
}
/* ---------- the group's bubble ----------
   It points at whoever is taking the question and it is deliberately EMPTY.
   The answer is already printed on the card under the scene at a size you can
   read standing up, and that is where it is being read from — putting the same
   words up here would only be a second place to look. So the bubble carries
   the member's role, the clock, and three dots that move while the words are
   being spoken. Nothing to read.                                          */
function answerBubble(dots){
  var i = iv.answerBy, P = STUDENTS[i], head = STU_HEAD[i], st = STAGE.students;
  var w = 178, h = 41;
  var x = Math.min(st.x1 - w, Math.max(st.x0, head.x - w / 2));
  var y = st.top, bot = y + h;
  var tx = Math.min(x + w - 20, Math.max(x + 20, head.x));
  var o = '<g>';
  o += '<path d="M' + (tx - 8) + ' ' + (bot - 2) + ' L' + head.x + ' ' + (head.y - 2) +
       ' L' + (tx + 8) + ' ' + (bot - 2) + ' Z" fill="#FBFAF3" stroke="' + P.col + '" stroke-width="1.6"/>';
  o += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
       '" rx="9" fill="#FBFAF3" stroke="' + P.col + '" stroke-width="1.8"/>';
  o += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="17" rx="9" fill="' + P.col + '"/>';
  o += '<rect x="' + x + '" y="' + (y + 9) + '" width="' + w + '" height="8" fill="' + P.col + '"/>';
  o += '<text x="' + (x + 9) + '" y="' + (y + 12.4) + '" font-family="IBM Plex Mono, monospace" ' +
       'font-size="8.4" letter-spacing="1.1" fill="#F4F7F6">' +
       esc(P.role.toUpperCase()) + '</text>';
  o += '<text x="' + (x + w - 9) + '" y="' + (y + 12.4) + '" text-anchor="end" ' +
       'font-family="IBM Plex Mono, monospace" font-size="8.4" letter-spacing="1.1" fill="#F4F7F6">' +
       esc(fmt(iv.remain)) + '</text>';
  for(var d = 0; d < 3; d++)
    o += '<circle cx="' + (x + w / 2 - 13 + d * 13) + '" cy="' + (y + 30) + '" r="' +
         (d < dots ? 3.6 : 2.3) + '" fill="' + P.col + '" opacity="' +
         (d < dots ? "0.95" : "0.3") + '"/>';
  return o + '</g>';
}
var bubSig = "";
function drawBubble(){
  var g = $("qBubbles");
  var showQ = iv.speaker >= 0 && !!iv.text;
  var showA = answeringNow();
  if(!showQ && !showA){ if(bubSig){ g.innerHTML = ""; bubSig = ""; } return; }
  /* the dots only move while the answer is actually being spoken */
  var dots = (showA && iv.reading) ? Math.floor(Date.now() / 300) % 4 : 0;
  if(!showQ){
    var aSig = "a" + iv.answerBy + "|" + fmt(iv.remain) + "|" + dots + "|" + iv.phase;
    if(aSig !== bubSig){ bubSig = aSig; g.innerHTML = answerBubble(dots); }
    return;
  }
  var i = iv.speaker, side = iv.side || "panel";
  var P = roster(side)[i], head = headOf(side, i), st = STAGE[side];
  var cut = Math.max(1, Math.round(iv.reveal * iv.text.length));
  var sig = side + i + "|" + cut + "|" + iv.phase + "|" + fmt(iv.remain) + "|" +
            iv.text.length + "|" + (iv.follow ? "f" : "q") + "|" + iv.badge +
            "|" + (showA ? iv.answerBy + ":" + dots : "-");
  if(sig === bubSig) return;
  bubSig = sig;
  var shown = iv.text.slice(0, cut);
  /* keep the box the size of the whole question so it never jumps as it types */
  var full = wrap(iv.text, BUB.cpl), lines = wrap(shown, BUB.cpl);
  var n = full.length;
  var h = 25 + n * BUB.lh + BUB.pad;
  var x = Math.min(st.x1 - BUB.w, Math.max(st.x0, head.x - BUB.w / 2));
  var y = st.top, bot = y + h;
  var tx = Math.min(x + BUB.w - 22, Math.max(x + 22, head.x));

  var o = '<g opacity="' + (iv.phase === "idle" ? 0 : 1) + '">';
  o += '<path d="M' + (tx - 9) + ' ' + (bot - 2) + ' L' + head.x + ' ' + (head.y - 2) +
       ' L' + (tx + 9) + ' ' + (bot - 2) + ' Z" fill="#FBFAF3" stroke="' + P.col + '" stroke-width="1.6"/>';
  o += '<rect x="' + x + '" y="' + y + '" width="' + BUB.w + '" height="' + h.toFixed(1) +
       '" rx="9" fill="#FBFAF3" stroke="' + P.col + '" stroke-width="1.8"/>';
  o += '<rect x="' + x + '" y="' + y + '" width="' + BUB.w + '" height="17" rx="9" fill="' + P.col + '"/>';
  o += '<rect x="' + x + '" y="' + (y + 9) + '" width="' + BUB.w + '" height="8" fill="' + P.col + '"/>';
  o += '<text x="' + (x + 9) + '" y="' + (y + 12.4) + '" font-family="IBM Plex Mono, monospace" font-size="8.4" ' +
       'letter-spacing="1.1" fill="#F4F7F6">' +
       esc(P.name.toUpperCase() + "  ·  " +
           (iv.badge || (iv.follow ? "FOLLOW-UP" : P.role.toUpperCase()))) + '</text>';
  if(iv.phase === "answering")
    o += '<text x="' + (x + BUB.w - 9) + '" y="' + (y + 12.4) + '" text-anchor="end" ' +
         'font-family="IBM Plex Mono, monospace" font-size="8.4" letter-spacing="1.1" fill="#F4F7F6">' +
         esc(fmt(iv.remain)) + '</text>';
  o += '<text x="' + (x + 10) + '" y="' + (y + 31) + '" font-family="Barlow, sans-serif" font-size="' +
       BUB.fs + '" fill="#1B2321">';
  lines.forEach(function(ln, k){
    o += '<tspan x="' + (x + 10) + '" dy="' + (k ? BUB.lh : 0) + '">' + esc(ln) + '</tspan>';
  });
  o += '</text></g>';
  /* the question stays up while they answer, and the group's own bubble opens
     underneath it — one says what was asked, the other says who is taking it */
  if(showA) o += answerBubble(dots);
  g.innerHTML = o;
}

/* ---------- asking, answering, advancing ---------- */
function activeOrder(){
  var out = [];
  QBANK.forEach(function(q, i){ if(iv.cats[q.cat]) out.push(i); });
  if($("ivShuffle").checked)
    for(var j = out.length - 1; j > 0; j--){
      var k = Math.floor(Math.random() * (j + 1)), t = out[j]; out[j] = out[k]; out[k] = t;
    }
  return out;
}
function fmt(ms){
  var s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
}
function speakStop(){
  if(synth){ try{ synth.cancel(); }catch(e){} }
  iv.utter = null;
}
/* one panelist takes the floor: speak `text`, then hand over `clockMs` to answer */
function takeFloor(pi, text, clockMs){
  readStop(); speakStop();
  stopApplause(); clearCues(); iv.badge = ""; iv.sayThen = null;
  iv.speaker = pi; iv.side = "panel"; iv.text = text; iv.clockMs = clockMs;
  iv.phase = "asking"; iv.paused = false; iv.answerBy = -1; camFocus();
  iv.reveal = 0; iv.askStart = Date.now(); iv.spokeDone = false;
  iv.remain = clockMs;

  var words = text.split(/\s+/).length;
  var rate = parseFloat($("ivRate").value) || 0.95;
  iv.askEst = Math.max(1600, (words / (2.7 * rate)) * 1000);

  if($("ivSpeak").checked && synth){
    var u = new SpeechSynthesisUtterance(text);
    var v = voiceFor("panel", pi);
    if(v) try{ u.voice = v; }catch(e){}
    u.rate = rate * PANELISTS[pi].rate;
    u.pitch = pitchFor("panel", pi);
    u.volume = 1;
    /* same guard as say(): an utterance that never really ran hands the
       question back to the reveal clock rather than skipping it */
    u.onend = u.onerror = function(){
      if(iv.utter !== u) return;
      iv.utter = null;
      if(Date.now() - iv.askStart >= iv.askEst * 0.5) beginAnswer();
    };
    iv.utter = u;
    try{ synth.speak(u); }catch(e){ iv.utter = null; }
  }
  paintIv();
}
function askQ(qi){
  var q = QBANK[qi];
  if(!q) return;
  iv.qi = qi; iv.follow = null; iv.followScript = ""; iv.followUsed = []; iv.alt = 0;
  q.asked = true;
  takeFloor(q.p, q.q, iv.answerMs);
}
/* the same panelist presses you on the answer you just gave */
function followMs(){ return Math.max(20000, Math.round(iv.answerMs * 0.6)); }
function askFollow(){
  var q = iv.qi >= 0 ? QBANK[iv.qi] : null;
  if(!q) return false;
  var own = q.f || [];
  var pool = own.concat(PROBES[q.cat] || []).filter(function(pr){
    return iv.followUsed.indexOf(pr[0]) < 0;
  });
  if(!pool.length) return false;
  var pr = pool[Math.floor(Math.random() * pool.length)];
  iv.followUsed.push(pr[0]);
  iv.follow = pr[0]; iv.followScript = pr[1];
  /* a probe of the question's own carries a scripted answer; a generic one
     out of PROBES carries handling advice, because no script could fit it   */
  iv.followScripted = own.indexOf(pr) >= 0;
  takeFloor(q.p, pr[0], followMs());
  return true;
}
function beginAnswer(){
  if(iv.phase !== "asking") return;
  iv.utter = null; iv.spokeDone = true; iv.reveal = 1;
  iv.phase = "answering";
  iv.remain = iv.clockMs;
  iv.endsAt = Date.now() + iv.clockMs;
  /* the floor passes to the group: a bubble opens over whoever owns this kind
     of question and stays empty on purpose — the words are on the card below,
     which is where they are being read from                                */
  iv.answerBy = answererFor(iv.qi >= 0 && QBANK[iv.qi] ? QBANK[iv.qi].cat : "");
  camFocus();
  /* queued rather than spoken here: this runs inside the question's onend */
  iv.readAt = $("ivReadBack").checked ? Date.now() + 450 : 0;
  paintIv();
}
function nextQ(){
  if(CLOSING[iv.phase]) return;           /* the panel is already closing */
  if(!iv.order.length) iv.order = activeOrder();
  if(!iv.order.length){ endIv(); return; }
  iv.pos++;
  if(iv.pos >= iv.order.length){ beginClosing(); return; }
  askQ(iv.order[iv.pos]);
}

/* ==================== the end of the defense =========================
   Every question that was switched on has been put and answered, so the
   panel does what a panel does: the chair closes the questioning, the
   three of them confer for a moment, the chair gives the verdict, and
   they clap. Nothing here is scored — it is the ending, not a mark.   */
var CHAIR = 1;                             /* the middle seat runs the room */

function clearCues(){ iv.cues = []; }
function cue(ms, fn){ iv.cues.push({at:Date.now() + ms, fn:fn}); }
function runCues(now){
  for(var i = 0; i < iv.cues.length; i++){
    if(now >= iv.cues[i].at){
      var f = iv.cues[i].fn;
      iv.cues.splice(i, 1); i--;
      f();
    }
  }
}

/* one line from anybody in the room that is not a question: a bubble, a
   voice, and no clock. `then` runs when the speaking actually finishes.   */
function panelSay(pi, text, then){ say("panel", pi, text, then); }
function studentSay(pi, text, then){ say("students", pi, text, then); }
function speechWanted(){
  return pres.on ? $("pzSpeak").checked : $("ivSpeak").checked;
}
function rateNow(){
  return parseFloat((pres.on ? $("pzRate") : $("ivRate")).value) || 0.95;
}
function say(side, pi, text, then){
  speakStop();
  iv.speaker = pi; iv.side = side; iv.text = text; iv.follow = null;
  iv.reveal = 0; iv.askStart = Date.now();
  var words = text.split(/\s+/).length;
  var rate = rateNow();
  iv.askEst = Math.max(1500, (words / (2.7 * rate)) * 1000);
  iv.sayThen = then || null;
  iv.sayFallbackAt = Date.now() + iv.askEst + 500;
  if(speechWanted() && synth){
    var u = new SpeechSynthesisUtterance(text);
    var v = voiceFor(side, pi); if(v) try{ u.voice = v; }catch(e){}
    u.rate = rate * roster(side)[pi].rate;
    u.pitch = pitchFor(side, pi);
    u.volume = 1;
    u.onend = u.onerror = function(ev){
      if(iv.utter !== u) return;
      iv.utter = null;
      /* Chrome drops an utterance the instant it is queued more often than it
         admits: no voice loaded yet, no gesture, another tab holding the
         engine. That is not the section having been read, and treating it as
         one is what used to race the demonstrations past before the waste was
         ever on the belt. Hand it back to the written pace instead. */
      if(Date.now() - iv.askStart < iv.askEst * 0.5){
        iv.sayFallbackAt = iv.askStart + iv.askEst + 500;
        return;
      }
      sayDone();
    };
    iv.utter = u;
    try{ synth.speak(u); }catch(e){ iv.utter = null; }
  }
  paintIv();
}
function sayDone(){
  var f = iv.sayThen;
  iv.sayThen = null; iv.sayFallbackAt = 0;
  if(f) f();
}

/* ==================== the introduction ===============================
   Before the first question the group does what a group does: it greets the
   panel with the greeting that is true for the hour, says who it is, gives
   the one-paragraph highlight of the project, and asks to begin. The camera
   is on them while they do it. Skip it from Next, or switch it off.      */
function beginIntro(){
  readStop(); speakStop(); clearCues();
  iv.phase = "intro"; iv.badge = ""; iv.qi = -1; iv.follow = null; iv.answerBy = -1;
  var g = greeting(), name = groupName();
  STUDENTS.forEach(function(S){ S.name = name; });
  iv.side = "students"; camFocus();
  bowAt = Date.now() + 600;               /* the little bow that goes with it */
  studentSay(LEADER, g + ", honorable members of the panel. We are " + name + ".", function(){
    if(iv.phase !== "intro") return;
    studentSay(SECOND,
      "Our project is EnviroSortPro, an automatic waste segregation machine. It sorts " +
      "biodegradable, plastic and metal waste on its own, so the segregation happens at " +
      "the moment the waste is thrown, and not afterwards.", function(){
      if(iv.phase !== "intro") return;
      studentSay(LEADER, "With your permission, we will now begin our defense.", function(){
        if(iv.phase !== "intro") return;
        iv.side = "panel"; camFocus();
        panelSay(CHAIR, g + ", " + name + ". Thank you. You may take your places — let us begin.",
          endIntro);
      });
    });
  });
  paintIv();
}
function endIntro(){
  if(iv.phase !== "intro") return;
  clearCues(); speakStop();
  iv.side = "panel"; iv.speaker = -1; iv.text = ""; iv.sayThen = null;
  camFocus();
  nextQ();                                  /* straight into question one */
}
function skipIntro(){
  if(iv.phase !== "intro") return;
  speakStop(); clearCues();
  iv.sayThen = null;
  endIntro();
}

function beginClosing(){
  readStop(); speakStop(); clearCues();
  iv.qi = -1; iv.follow = null; iv.followScript = ""; iv.alt = 0; iv.answerBy = -1;
  iv.phase = "wrapup"; iv.badge = "CHAIR";
  panelSay(CHAIR,
    "Thank you. That is the last of our questions. Give us a moment, please.",
    function(){
      iv.phase = "confer"; iv.badge = ""; iv.speaker = -1; iv.text = "";
      cue(3400, giveVerdict);
      paintIv();
    });
  paintIv();
}

var VERDICT_LINE = "We have heard enough. On behalf of the panel — congratulations. " +
                   "You have successfully defended your project.";
function giveVerdict(){
  iv.phase = "verdict"; iv.badge = "THE VERDICT";
  $("ivVerdictLine").textContent = "\u201C" + VERDICT_LINE + "\u201D";
  panelSay(CHAIR, VERDICT_LINE,
    function(){ if(iv.phase === "verdict") beginOvation(); });
  /* the clapping starts on the word, not politely after it — that is how a
     room actually does it, so it is cued off the length of the line          */
  cue(Math.round(iv.askEst * 0.72), function(){
    if(iv.phase === "verdict") beginOvation();
  });
  paintIv();
}

function beginOvation(){
  if(iv.phase === "applause") return;      /* whichever cue got here first */
  iv.phase = "applause"; iv.badge = "";
  var runFor = 9500;
  startApplause(runFor);
  bowAt = Date.now() + 1400;              /* the group bows back at the panel */
  /* two shorter lines over the clapping, the way the other two chime in */
  cue(2500, function(){
    if(iv.phase !== "applause") return;
    iv.badge = "";
    panelSay(0, "Well done. Congratulations to all of you.", clearSaid);
  });
  cue(5600, function(){
    if(iv.phase !== "applause") return;
    panelSay(2, "Congratulations. Take care of that machine.", clearSaid);
  });
  cue(runFor, finishClosing);
  paintIv();
}
function clearSaid(){
  if(iv.phase === "applause"){ iv.speaker = -1; iv.text = ""; }
}

function finishClosing(){
  clearCues(); stopApplause(); speakStop();
  panelWarm = Date.now() + 10000;          /* still pleased for a while after */
  iv.phase = "done"; iv.speaker = -1; iv.text = ""; iv.qi = -1;
  iv.badge = ""; iv.sayThen = null; iv.passed = true;
  paintIv();
}

/* the closing runs on its own cues; all this does is type the bubble out and
   cover the case where the browser's speech never reports that it finished */
function stepClosing(now){
  if(!iv.text) return;
  iv.reveal = Math.min(1, (now - iv.askStart) / iv.askEst);
  if(!iv.utter){
    if(iv.sayThen && now > iv.sayFallbackAt) sayDone();
  } else if(now > iv.askStart + iv.askEst * 2.6 + 5000){
    speakStop(); sayDone();
  }
}
function startIv(noIntro){
  ac();                                   /* unlock audio on this user gesture */
  if(pres.on) setPresent(false);
  stopApplause(); clearCues();
  iv.badge = ""; iv.sayThen = null; iv.passed = false; iv.answerBy = -1; panelWarm = 0;
  giveCamera();                           /* the defense gets the camera back */
  if(applyGreeting()) buildBank();        /* say what the clock actually says */
  setWallClock();
  QBANK.forEach(function(q){ q.asked = false; });
  iv.order = activeOrder(); iv.pos = -1;
  iv.on = true;
  iv.side = "panel";
  if(!iv.order.length){ endIv(); return; }
  if($("ivIntro").checked && !noIntro) beginIntro();
  else nextQ();
}
function endIv(){
  readStop(); speakStop();
  stopApplause(); clearCues();
  iv.phase = "idle"; iv.speaker = -1; iv.text = ""; iv.qi = -1;
  iv.pos = -1; iv.paused = false;
  iv.badge = ""; iv.sayThen = null; iv.passed = false; iv.side = "panel"; iv.answerBy = -1;
  bowAt = 0;
  paintIv();
}
function pauseIv(){
  if(iv.phase === "idle" || iv.phase === "done") return;
  iv.paused = !iv.paused;
  if(iv.paused){
    if(synth && iv.phase === "asking"){ try{ synth.pause(); }catch(e){} }
    else readStop();
  } else {
    if(synth && iv.phase === "asking"){ try{ synth.resume(); }catch(e){} }
    if(iv.phase === "answering"){
      iv.endsAt = Date.now() + iv.remain;
      /* pausing stopped the read-back mid-sentence; picking it up again is what
         you want back when you press play, not silence */
      if($("ivReadBack").checked && !iv.reading) iv.readAt = Date.now() + 300;
    }
  }
  paintIv();
}

function stepInterview(){
  stepCam();
  if(!iv.on && !pres.on){
    if($("qBubbles").innerHTML) $("qBubbles").innerHTML = "";
    if($("marks").innerHTML){ $("marks").innerHTML = ""; marksSig = ""; }
    return;
  }
  var now = Date.now();
  if(pres.on){
    if(pres.paused){ presFreeze(now); drawBubble(); drawMarks(); return; }
    pres.tick = now;
    runCues(now);
    stepPresentation(now);
    drawBubble();
    drawMarks();
    if(now - (iv.lastPaint || 0) > 140){ iv.lastPaint = now; paintPres(); }
    return;
  }
  runCues(now);
  if(CLOSING[iv.phase] || iv.phase === "intro"){
    stepClosing(now);
    drawBubble();
    if(now - (iv.lastPaint || 0) > 110){ iv.lastPaint = now; paintIv(); }
    return;
  }
  if(iv.phase === "asking"){
    if(!iv.paused){
      iv.reveal = Math.min(1, (now - iv.askStart) / iv.askEst);
      /* no voice, or the browser has no speech at all: advance on the estimate.
         onend is unreliable on some engines, so time out rather than strand it. */
      if(iv.reveal >= 1 && !iv.utter) beginAnswer();
      else if(now - iv.askStart > iv.askEst * 2.5 + 5000){ speakStop(); beginAnswer(); }
    } else iv.askStart = now - iv.reveal * iv.askEst;
  } else if(iv.phase === "answering"){
    if(iv.paused) iv.endsAt = now + iv.remain;
    else iv.remain = iv.endsAt - now;
    if(iv.remain <= 0){
      iv.remain = 0;
      chime();
      /* a real panel does not always move on — sometimes it presses you */
      var press = $("ivFollow").checked && !iv.follow && Math.random() < 0.45;
      if(!(press && askFollow())){
        if($("ivAuto").checked) nextQ();
        else iv.phase = "timeup";
      }
    }
  }
  if(iv.readAt && now > iv.readAt && iv.phase === "answering" && !iv.paused){
    iv.readAt = 0; readScript();
  }
  drawBubble();
  if(now - (iv.lastPaint || 0) > 110){ iv.lastPaint = now; paintIv(); }
}

/* ---------- the card ---------- */
var PHASE_LABEL = {idle:"idle", intro:"the group is introducing itself",
                   asking:"listen", answering:"your answer",
                   timeup:"time is up", wrapup:"the chair is closing",
                   confer:"they are conferring", verdict:"the verdict",
                   applause:"applause", done:"you defended it"};
var CLOSE_LINE = {confer:"They have stopped asking. The three of them are talking it over between themselves — stand still and let them finish."};
var hintSig = "\u0000";
function paintIv(){
  var q = iv.qi >= 0 ? QBANK[iv.qi] : null;
  var side = iv.side || "panel";
  var P = iv.speaker >= 0 ? roster(side)[iv.speaker] : null;
  var isChair = side === "panel" && iv.speaker === CHAIR &&
                (!!CLOSING[iv.phase] || iv.phase === "intro");

  $("ivAsker").textContent = P ? (P.name + " · " + (isChair ? "chair" : P.role)) :
    (iv.phase === "confer" ? "The panel is conferring" :
     iv.phase === "done"   ? "The panel has finished · you defended it" :
                             "The panel is waiting");
  $("ivCat").textContent = iv.follow ? "follow-up"
    : q ? q.cat
    : iv.phase === "intro" ? "introduction"
    : (CLOSING[iv.phase] || iv.phase === "done") ? "closing" : "";
  $("ivDot").style.background = P ? P.col : "";
  $("ivDot").style.color = P ? P.col : "";
  $("ivDot").classList.toggle("live", !iv.paused &&
    (!!SPEAK_PHASE[iv.phase] || (iv.phase === "intro" && (!!iv.utter || iv.reveal < 1))));

  if(iv.follow) $("ivQ").textContent = iv.follow;
  else if(q) $("ivQ").textContent = q.q;
  else if(iv.phase === "intro")
    $("ivQ").textContent = iv.text || "";
  else if(CLOSING[iv.phase])
    $("ivQ").textContent = iv.text || CLOSE_LINE[iv.phase] || "";
  else if(iv.phase === "done")
    $("ivQ").textContent = "That was the whole bank, and the panel had nothing left to ask. Shuffle the order, switch categories on or off, or start again.";
  else
    $("ivQ").textContent = "Press Start. Your group greets the panel first — with the greeting that matches the time on your own clock — says who you are and what the project is, and then the panel opens by asking why you came up with this study, works through the design, the code, your evidence, what is strong, what is broken, and closes. One panelist at a time speaks aloud, a bubble opens above whoever is speaking, and the clock runs while you answer. They may press you with a follow-up before moving on.";

  var closing = !!CLOSING[iv.phase], intro = iv.phase === "intro";
  var passed = closing || iv.phase === "done";
  var frac = (iv.phase === "asking" || passed) ? 1 :
             (iv.phase === "answering" || iv.phase === "timeup")
               ? Math.min(1, Math.max(0, iv.remain) / (iv.clockMs || iv.answerMs)) : 0;
  $("ivBar").style.width = (frac * 100).toFixed(1) + "%";
  var bar = $("ivBarWrap");
  bar.classList.toggle("low", frac > 0 && frac < 0.25 && iv.phase !== "asking" && !passed);
  bar.classList.toggle("out", iv.phase === "timeup");
  bar.classList.toggle("pass", passed);
  $("ivTime").textContent = (iv.phase === "asking" || closing || intro) ? "—" :
    fmt(iv.phase === "idle" || iv.phase === "done" ? iv.answerMs : iv.remain);
  $("ivFollowBtn").disabled = !(iv.on && iv.qi >= 0 &&
    (iv.phase === "answering" || iv.phase === "timeup"));
  $("ivPhase").textContent = iv.paused ? "paused" : (PHASE_LABEL[iv.phase] || "idle");

  var running = iv.on && iv.phase !== "idle" && iv.phase !== "done" && !closing && !intro;
  $("ivStart").textContent = (running || closing || intro) ? "Restart" :
    (iv.phase === "done" ? "Start again" : "Start interview");
  ["ivPause", "ivRepeat", "ivPlus"].forEach(function(id){ $(id).disabled = !running; });
  $("ivNext").disabled = !(running || intro);
  $("ivNext").textContent = intro ? "Skip the introduction" : "Next question";
  $("ivStop").disabled = !(running || closing || intro);
  $("ivPause").textContent = iv.paused ? "Resume" : "Pause";
  $("ivPlus").disabled = !running || (iv.phase !== "answering" && iv.phase !== "timeup");

  var total = iv.order.length || activeOrder().length;
  $("ivProgress").textContent = intro ? "the group is introducing itself"
    : closing ? "all " + total + " answered · closing"
    : running && iv.pos >= 0
      ? "question " + (iv.pos + 1) + " of " + total + (iv.follow ? " · follow-up" : "")
      : (iv.phase === "done" ? "defended · all " + total + " answered" : "not started");

  /* the verdict card: up from the moment the chair gives it, and it stays */
  var vb = $("ivVerdict"), showV = (iv.phase === "verdict" || iv.phase === "applause" ||
                                    iv.phase === "done");
  vb.hidden = !showV;
  vb.classList.toggle("clapping", iv.phase === "applause");
  if(showV) $("ivVerdictTag").textContent =
    iv.phase === "verdict"  ? "the chair is giving the verdict" :
    iv.phase === "applause" ? "the panel is applauding" :
                              "the panel has finished · you defended it";

  paintScript(q);

  var hint = $("ivHint"), hsig = (q && $("ivHints").checked)
    ? iv.qi + (iv.follow ? ":f" : "") : "";
  if(hsig !== hintSig){
    hintSig = hsig;
    if(hsig){
      hint.hidden = false;
      hint.innerHTML = "<h5>How to answer " + (iv.follow ? "the question behind this one" : "this") +
        "</h5><ul><li>" + q.a.join("</li><li>") + "</li></ul>";
    } else hint.hidden = true;
  }

  var rows = $("ivBank").children;
  for(var i = 0; i < rows.length; i++){
    rows[i].classList.toggle("now", i === iv.qi);
    rows[i].classList.toggle("asked", !!QBANK[i].asked);
  }
}

var scriptSig = "\u0000";
function paintScript(q){
  var box = $("ivScriptBox"), txt = scriptNow(), advice = scriptIsAdvice();
  var on = $("ivScriptOn").checked;
  /* while the panel is closing there is nothing to read back — this is theirs */
  box.hidden = !on || !!CLOSING[iv.phase] || iv.phase === "done" || iv.phase === "intro";
  var sig = on + "|" + iv.qi + "|" + (iv.follow || "") + "|" + $("ivRate").value +
            "|" + iv.answerMs + "|" + (iv.reading ? "r" : "-") + "|" + iv.phase +
            "|" + iv.alt + "|" + iv.answerBy;
  if(sig === scriptSig) return;
  scriptSig = sig;

  box.classList.toggle("guide", advice);
  var vs = versions(), n = vs.length;
  var by = iv.answerBy >= 0 ? STUDENTS[iv.answerBy] : null;
  $("ivScriptLbl").textContent = advice ? "How to handle this one"
    : (by ? by.role + " takes this one — read this aloud"
          : "One way to answer — read this aloud") +
      (n > 1 ? "  ·  " + (iv.alt % n + 1) + " of " + n + ", " + scriptLabel().toLowerCase() : "");
  $("ivAltBtn").disabled = n < 2;
  if(txt) $("ivScript").textContent = txt;

  /* how long it takes to say, at the speed the panel is running at, against
     the clock you will actually have — an answer that does not fit is a fault */
  var meta = $("ivScriptMeta");
  if(txt && !advice){
    var words = txt.split(/\s+/).length;
    var rate = parseFloat($("ivRate").value) || 0.95;
    var secs = Math.round(words / (2.6 * rate));
    var slot = Math.round((iv.clockMs || iv.answerMs) / 1000);
    meta.textContent = words + " words · about " + fmt(secs * 1000) + " to say" +
      (secs > slot ? " · longer than your " + fmt(slot * 1000) : "");
    meta.classList.toggle("over", secs > slot);
  } else {
    meta.textContent = ""; meta.classList.remove("over");
  }
  $("ivReadBtn").textContent = iv.reading ? "Stop reading" : "Read it to me";
  $("ivReadBtn").classList.toggle("reading", !!iv.reading);
  $("ivReadBtn").disabled = !(txt && synth &&
    (iv.phase === "answering" || iv.phase === "timeup"));
}

function buildBank(){
  var o = "";
  QBANK.forEach(function(q, i){
    var P = PANELISTS[q.p];
    o += '<li data-cat="' + q.cat + '"><button type="button" data-q="' + i + '">' +
         '<span class="pnum" style="background:' + P.col + '">P' + (q.p + 1) + '</span>' +
         '<span><span class="qcat">' + q.cat + " · " + esc(P.role) + '</span>' + esc(q.q) + '</span>' +
         '</button></li>';
  });
  $("ivBank").innerHTML = o;
  var f = "";
  CATS.forEach(function(c){
    f += '<button type="button" class="iv-f" data-cat="' + c + '" aria-pressed="true">' + c + '</button>';
  });
  $("ivFilters").innerHTML = f;
  applyCats();
}
function applyCats(){
  var n = 0;
  Array.prototype.forEach.call($("ivBank").children, function(li){
    var on = iv.cats[li.getAttribute("data-cat")];
    li.classList.toggle("off", !on);
    if(on) n++;
  });
  $("ivCount").textContent = String(n);
  if(!iv.on) $("ivProgress").textContent = "not started";
}

/* ---------- wiring ---------- */
function setInterview(on){
  if(on && pres.on) setPresent(false);    /* one of them has the room at a time */
  iv.on = on;
  $("interviewBtn").setAttribute("aria-pressed", String(on));
  $("interviewBtn").textContent = "Panel interview: " + (on ? "on" : "off");
  $("interviewCard").style.display = on ? "" : "none";
  camFocus();
  if(!on){
    endIv();
    $("qBubbles").innerHTML = "";
    [0, 1, 2].forEach(function(i){
      $("pan" + i).removeAttribute("opacity");
      $("pan" + i + "Arm").removeAttribute("opacity");
    });
  } else {
    paintIv();
    $("interviewCard").scrollIntoView({behavior:"smooth", block:"nearest"});
  }
}
$("interviewBtn").addEventListener("click", function(){ setInterview(!iv.on); });

$("ivStart").addEventListener("click", function(){ if(!iv.on) setInterview(true); startIv(); });
$("ivStop").addEventListener("click", endIv);
$("ivPause").addEventListener("click", pauseIv);
$("ivNext").addEventListener("click", function(){
  if(iv.phase === "intro") skipIntro(); else nextQ();
});
$("ivRepeat").addEventListener("click", function(){
  if(iv.speaker >= 0 && iv.text) takeFloor(iv.speaker, iv.text, iv.clockMs);
});
$("ivFollowBtn").addEventListener("click", function(){ askFollow(); });
$("ivPlus").addEventListener("click", function(){
  if(iv.phase === "timeup") iv.phase = "answering";
  if(iv.phase !== "answering") return;
  iv.remain += 30000; iv.endsAt = Date.now() + iv.remain;
  paintIv();
});
$("ivSec").addEventListener("input", function(){
  var was = iv.clockMs || iv.answerMs;
  iv.answerMs = parseInt(this.value, 10) * 1000;
  $("ivSecLbl").textContent = fmt(iv.answerMs);
  if(iv.phase === "answering" || iv.phase === "timeup"){
    /* keep the time already spent, just move the finish line */
    var spent = Math.max(0, was - iv.remain), fresh = iv.follow ? followMs() : iv.answerMs;
    iv.clockMs = fresh;
    iv.remain = Math.max(0, fresh - spent);
    iv.endsAt = Date.now() + iv.remain;
    if(iv.remain > 0 && iv.phase === "timeup") iv.phase = "answering";
  } else if(!iv.follow) iv.clockMs = iv.answerMs;
  paintIv();
});
$("ivRate").addEventListener("input", function(){
  $("ivRateLbl").textContent = (parseFloat(this.value)).toFixed(2).replace(/0$/, "") + "×";
  paintIv();
});
$("ivVoice").addEventListener("change", function(){ voiceForced = this.value; });
$("ivFocus").addEventListener("change", camFocus);
$("ivSpeak").addEventListener("change", function(){
  if(!this.checked){ speakStop(); if(iv.phase === "asking") beginAnswer(); }
});
$("ivHints").addEventListener("change", paintIv);
$("ivScriptOn").addEventListener("change", function(){ scriptSig = "\u0000"; paintIv(); });
$("ivAltBtn").addEventListener("click", function(){
  var n = versions().length;
  if(n < 2) return;
  iv.alt = (iv.alt + 1) % n;
  readStop();
  paintIv();
});
$("ivReadBtn").addEventListener("click", function(){
  if(iv.reading) readStop(); else readScript();
  scriptSig = "\u0000"; paintIv();
});
$("ivReadBack").addEventListener("change", function(){
  if(!this.checked){ readStop(); iv.readAt = 0; }
  else if(iv.phase === "answering" && !iv.reading) readScript();
  scriptSig = "\u0000"; paintIv();
});
$("ivShuffle").addEventListener("change", function(){
  if(iv.on && iv.phase !== "idle"){ iv.order = activeOrder(); iv.pos = iv.order.indexOf(iv.qi); }
});
$("ivFilters").addEventListener("click", function(e){
  var b = e.target.closest(".iv-f"); if(!b) return;
  var c = b.getAttribute("data-cat");
  iv.cats[c] = !iv.cats[c];
  b.setAttribute("aria-pressed", String(iv.cats[c]));
  applyCats();
  if(iv.on && iv.phase !== "idle"){ iv.order = activeOrder(); iv.pos = iv.order.indexOf(iv.qi); }
  paintIv();
});
$("ivBank").addEventListener("click", function(e){
  var b = e.target.closest("[data-q]"); if(!b) return;
  ac();
  if(!iv.on) setInterview(true);
  var qi = parseInt(b.getAttribute("data-q"), 10);
  if(iv.phase === "intro"){ speakStop(); clearCues(); iv.sayThen = null; iv.phase = "asking"; camFocus(); }
  if(!iv.order.length) iv.order = activeOrder();
  var at = iv.order.indexOf(qi);
  if(at >= 0) iv.pos = at;
  askQ(qi);
});

applyView();
paintView("");
setLabels(true);
applyGreeting();                      /* before the bank is rendered anywhere */
setWallClock();
buildBank();
$("ivSecLbl").textContent = fmt(iv.answerMs);

/* ============================ main frame ============================ */
function refreshSamples(){
  var sig = qOffset + ":" + takenIdx;
  if(sig !== takenSig){ takenSig = sig; buildSamples(); }
}

/* The tread used to be twenty-two rectangles rebuilt from scratch every frame.
   It is the same twenty-two rectangles every frame — so they are built once
   and the whole strip is slid by a transform, with a clip holding it between
   the pulleys.                                                            */
var beltBuilt = false;
function drawBelt(){
  if(!beltBuilt){
    var out = "";
    for(var i = 0; i < 23; i++)
      out += '<rect x="' + (BELT.x0 - 16 + i * 16) + '" y="469" width="4" height="9" fill="#20262B"/>';
    $("beltTread").innerHTML = out;
    beltBuilt = true;
  }
  $("beltTread").setAttribute("transform", "translate(" + (beltPhase % 16).toFixed(1) + ",0)");
}

/* waste sitting in the hole that no sensor can see */
function checkStuck(){
  var show = false;
  if(item && !item.falling && !item.onBelt && !item.carried && !item.retrieving &&
     !item.cur && !item.q.length && inZone(ZONE.ir)){
    if(digitalReadPin(0) === HIGH && digitalReadPin(1) === HIGH && digitalReadPin(2) === HIGH){
      if(!item.stuckAt) item.stuckAt = Date.now();
      show = (Date.now() - item.stuckAt) > 1100 / speed;
      if(show && !item.reacted){ item.reacted = true; panelReact("stuck"); }
    } else item.stuckAt = 0;
  }
  $("itemG").setAttribute("pointer-events", canRetrieve() ? "auto" : "none");
  $("clickHint").setAttribute("opacity", show ? "1" : "0");
  if(show) $("clickHint").setAttribute("transform",
    "translate(" + item.x.toFixed(1) + "," + item.y.toFixed(1) + ")");
  $("stuckMsg").setAttribute("opacity", show ? "1" : "0");
  $("alertStuck").classList.toggle("show", show);
  if(show){
    $("stuckLead").setAttribute("d", "M846 496 L" + (item.x + 22).toFixed(1) + " " + (item.y - 8).toFixed(1));
    var ph = (Date.now() % 800) / 800;
    $("scanRing").setAttribute("cy", item.y.toFixed(1));
    $("scanRing").setAttribute("stroke", "#F2685E");
    $("scanRing").setAttribute("opacity", (0.9 * (1 - ph)).toFixed(2));
    $("scanRing").setAttribute("rx", (26 + 26 * ph).toFixed(1));
    $("scanRing").setAttribute("ry", (9 + 8 * ph).toFixed(1));
  } else $("scanRing").setAttribute("stroke", "#5FE3CF");
  return show;
}

function frame(){
  /* no power into the jack, no sketch — whichever lane it was meant to come by */
  if(W.mains) proc.next();
  else if(W.buzzer) buzzerOn(false);
  stepWorld();
  stepDisposal();
  updateHand();
  updatePanel();
  updateStudents();
  stepInterview();
  if(Date.now() - clockAt > 20000) setWallClock();
  if(Date.now() - pwAt > 260){ pwAt = Date.now(); paintPower(); paintProto(); }
  var fast = (item && item.onBelt) || Date.now() < beltBoost;
  beltPhase = (beltPhase + (fast ? 3.4 : 0.5) * speed) % (BELT.x1 - BELT.x0);
  drawBelt();
  refreshSamples();
  stuckNow = checkStuck();
  drawScene();
  drawSides();
  if(walk){ stepWalk(); drawWalk(); }
  paintUi();
  paintTrace();
  requestAnimationFrame(frame);
}


/* ====================== the presentation ============================
   The demo itself, rehearsed: the part of the defense that happens before
   anybody asks you anything. One member at a time takes a section, the
   camera walks to whatever they are talking about, their voice reads the
   section, and the same words are printed under the scene in a size you can
   read from a standing position. Three of the sections run the machine for
   real, so the demonstration you practise is the demonstration you give.

   Every word here is one way of saying it, written from what is actually in
   EnviroSortPro.ino. It is not a script anybody has to use.              */
var TALK = [
{who:3, title:"Greeting", view:"group",
 say:"{G}, honorable members of the panel. We are {GROUP}, and our project is EnviroSortPro — an automatic waste segregation machine. What is in front of you is the working prototype, and with your permission we will show you what it does.",
 note:"Bow with the greeting. Stand beside the machine, not in front of it, and keep your hands off it until the demonstration."},

{who:0, title:"Why we built it", view:"group",
 say:"We started from something we saw, not something we read. The bins in our building are already labelled, but at the end of the day everything goes into one sack, and the recyclables that were sitting beside wet food waste are no longer worth anything. Republic Act 9003 already requires segregation and the labels are already there. What is missing is the moment of disposal itself.",
 note:"Say where you saw it and when. If you quote a figure, quote only one your group measured."},

{who:3, title:"What the machine is for", view:"room",
 mark:[{box:[428,88,472,628], at:0.22, tag:"the prototype"}],
 say:"So we moved the sorting from the person to the bin. EnviroSortPro decides what a piece of waste is at the moment it is thrown, and puts it into one of three bins by itself — biodegradable, plastic, or metal. It runs on an Arduino Uno and three inexpensive sensors, because it had to be something a school could actually build.",
 note:"This is your one-sentence answer if the panel interrupts and asks what the project is."},

{who:2, title:"The machine, part by part", view:"all",
 mark:[{el:"hopper", at:0.02, until:0.22, tag:"the mouth"},
       {el:"throat", at:0.18, until:0.40, tag:"the throat"},
       {el:"tapG",   at:0.36, until:0.58, tag:"the gate"},
       {el:"binsG",  at:0.54, until:0.76, tag:"the platform"},
       {el:"usG",    at:0.72, until:0.90, tag:"the sensor post"},
       {el:"ctrl",   at:0.86,             tag:"the controller"}],
 say:"Waste goes in at the mouth at the top. Just below it is the throat, where the two proximity sensors face each other. Under that is the gate, which stays closed and holds the waste while the machine decides. Below the gate is the rotating platform carrying the three bins, and on the right is the fixed post holding the ultrasonic sensor. The controller is in the covered box on the mast.",
 note:"Point at each part as you name it. Face the machine for this one, not the panel."},

{who:2, title:"Inside the input hole", view:"mouth",
 acts:[{at:0.07, show:true, view:"bore"}, {at:0.985, show:false}],
 mark:[{el:"hopper",   at:0.02, until:0.12, tag:"the mouth"},
       {el:"boreView", at:0.08, until:0.42, tag:"the same hole, from above"},
       {el:"boreCap",  at:0.42, until:0.56, tag:"CAPACITIVE · D3, through the left wall"},
       {el:"boreInd",  at:0.50, until:0.64, tag:"INDUCTIVE · D4, facing it"},
       {el:"boreGap",  at:0.58, until:0.74, tag:"128 mm of clear air between the faces"},
       {el:"boreGate", at:0.72, until:0.84, tag:"the floor of it is the closed gate"},
       {el:"boreIr",   at:0.82,             tag:"IR · D7 looks across that floor"}],
 say:"Let us take the camera up to the mouth, and then look straight down the hole. Here is the same opening seen from above — the whole circle, and the sensors inside it. Nothing hangs in the middle: the waste path is clear from the mouth all the way down. The heads are mounted through the wall of the throat and face each other across the bore, so an item passes between them. On the left, the capacitive head on D3, its sensing face pointing inward. On the right, the inductive head on D4, at the same height, facing it. Between the two faces there is a hundred and twenty-eight millimetres of clear air, and that gap is the whole of stage one. The floor you can see is the closed gate holding the item on that line, and the infrared on D7 sits at the wall looking across the face of the gate, so anything resting there is already in its beam.",
 note:"This is the section to run if a panelist asks where the sensors physically are. Two things matter: nothing is in the waste path, and the two heads are at the same height, aimed at each other. If one is higher than the other, or turned off the line, the pair stops agreeing."},

{who:2, title:"Stage one — the proximity pair", view:"throat",
 mark:[{el:"sInd",   at:0.08, until:0.40, tag:"INDUCTIVE · D4"},
       {el:"sCap",   at:0.28, until:0.62, tag:"CAPACITIVE · D3"},
       {el:"throat", at:0.56,             tag:"128 mm · same height"}],
 say:"Stage one is these two heads. The inductive sensor on pin D4 sees metal only. The capacitive sensor on pin D3 sees plastic, and metal as well if it is close. They sit at the same height, a hundred and twenty-eight millimetres apart, facing each other across the throat, and each one reads LOW when it sees its material. This is why plastic and metal are presented to the mouth and held for a moment, instead of being dropped straight through.",
 note:"If the panel asks why not one sensor: these two can name a material but only while the item is held at their gap."},

{who:2, title:"Stage two — the infrared", view:"gate",
 mark:[{el:"sIr",  at:0.05, until:0.52, tag:"IR · D7"},
       {el:"tapG", at:0.46,             tag:"the closed gate"}],
 say:"Stage two is the infrared module on pin D7, looking across the face of the closed gate. It cannot name a material at all — it only reports that something is in front of it. So anything that reaches the gate without having been identified by stage one is treated as biodegradable. That is the whole logic in one sentence: name it if you can, and if you cannot, it is bio.",
 note:"That last sentence is also the honest weakness. Section fourteen is where you own it."},

{who:4, title:"The controller", view:"brain",
 mark:[{el:"ctrl", at:0.04, tag:"UNO + I2C LCD"}],
 say:"Inside the box is the Arduino Uno and the I2C display. Every pass of loop begins with detectionMaintenance, which fires the ultrasonic sensor and decides whether the machine is allowed to run at all. Only if it is does handleWasteDetection read the three sensor pins. Then the sketch waits five hundred milliseconds, so the machine looks at the world about twice a second. Safety first, sorting second, every single pass.",
 note:"The execution trace under the scene highlights the line that is running. Give the panel a moment to watch it move."},

{who:4, title:"How it decides", view:"machine",
 mark:[{el:"sInd", at:0.08, until:0.28, tag:"1 · metal, no condition"},
       {el:"sCap", at:0.23, until:0.84, tag:"2 · plastic, blocked by metal"},
       {el:"sIr",  at:0.82,             tag:"3 · bio, the IR alone"}],
 say:"The order of the tests matters. Metal is tested first, and without any condition. Plastic is tested second, guarded so that it cannot fire if metal already has — a can trips both heads, and the inductive sensor is the one that can tell them apart. Biodegradable is tested last, from the infrared alone.",
 note:"Say this one slowly. More than one of the panel's questions comes straight out of it."},

{who:2, title:"The platform and the gate", view:"lower",
 mark:[{el:"binsG", at:0.04, until:0.50, tag:"SERVO D5 · turns the plate"},
       {el:"tapG",  at:0.46,             tag:"SERVO D6 · the gate"}],
 say:"Once the class is decided, servo D5 turns the top plate so that the correct bin is under the hole. The sketch waits one second for it to settle, then servo D6 opens the gate and the waste falls in. Both servos return home, the display goes back to standby, and the machine is ready for the next piece. Two servos, and both of them are two hundred and seventy degree metal gear digital servos. That was a decision, not what came in the kit, and the next two sections are why.",
 note:"Say the sequence first and keep it short — the two sections after this one carry the detail. If the panel is running late, this is the section to keep and the next two are the ones to compress."},

{who:2, title:"Why the plate needs a 270° servo", view:"bins",
 acts:[{at:0.42, view:"pedestal"}],
 mark:[{el:"binsG",      at:0.03, until:0.24, tag:"three bins · one hole"},
       {el:"binsG",      at:0.26, until:0.40, tag:"bio 0° · metal 120° · plastic 247.5°"},
       {el:"pedestalLbl",at:0.46, until:0.66, tag:"D5 · the angle it is at, live"},
       {el:"plate",      at:0.64,             tag:"67 mm out · bins 120 mm across"}],
 say:"The plate is turned by one servo on pin D five, and it is a two hundred and seventy degree metal gear digital servo, not the small blue SG ninety. There are two reasons, and the first is travel. Three bins take turns under one hole, so their parked positions are spread right round the plate: biodegradable at zero, metal at a hundred and twenty degrees, and plastic at two hundred and forty seven and a half. An SG ninety stops at a hundred and eighty. It would park two of the bins and then stall against its own end stop trying to reach the third. And we cannot simply pack the bins closer together. They ride sixty seven millimetres out from the centre and each one is about a hundred and twenty millimetres across, so at a hundred and twenty degrees apart their centres are a hundred and sixteen millimetres apart and they only just clear each other. Bring them to ninety degrees and the centres are ninety five apart — they touch. Three bins that size need the whole circle, and the whole circle needs at least two hundred and forty degrees of sweep. Two hundred and seventy is the standard size above that.",
 note:"Two numbers to have ready: 247.5° is the furthest bin, 180° is where an SG90 stops. The second reason — the load — is the next section, so do not run the two together."},

{who:2, title:"Why the gate is a servo too", view:"gate",
 acts:[{at:0.46, view:"lower"}],
 mark:[{el:"tapG",      at:0.03, until:0.24, tag:"the gate · the floor of the hole"},
       {el:"sIr",       at:0.22, until:0.36, tag:"D7 reads what is resting on it"},
       {el:"servoGate", at:0.34, until:0.46, tag:"SERVO D6 · tap_servo1"},
       {el:"tapG",      at:0.52, until:0.74, tag:"torque = weight × arm length"},
       {el:"binsG",     at:0.72,             tag:"and the same part turns this"}],
 say:"The gate is the other servo, on pin D six, and what it does is easy to miss. It is the floor of the hole. Everything you drop lands on it and stays there — held on the sensor line while stage one reads it, held while the plate turns underneath — and it opens only once the correct bin has arrived. Here the argument is not travel. A flap only has to swing clear, ninety degrees or so, and an SG ninety has that. It is torque, and torque is the weight times how far out the weight sits. On the tip of a six centimetre flap an SG ninety, rated about one point eight kilogram centimetres, holds roughly three hundred grams with nothing spare. It sags, it buzzes, and it answers late — which is exactly what people mean when they say a servo is not responsive under load. So both servos are the same part. Metal gears, because the gate is landed on by every item and the plate has three loaded bins twisting the shaft back at every stop. Digital, because it holds its position under that load instead of settling a few degrees off. And one spare part instead of two.",
 note:"The line to remember is torque = weight × arm length: double the flap and you double what the servo has to hold, which is why the flap is no longer than the bore. If a panelist asks whether an SG90 would do on the gate, be honest — it would open it; it would not reliably hold it shut under a heavy item."},

{who:0, title:"The full-bin check", view:"us",
 mark:[{el:"usG",   at:0.04, until:0.52, tag:"HC-SR04 · D8 / D9"},
       {el:"binsG", at:0.46,             tag:"20 cm and it stops"}],
 say:"The ultrasonic sensor on pins D8 and D9 looks straight down into whichever bin is parked under the hole. An empty bin reads about fifty centimetres. When the distance falls to twenty centimetres or less the machine stops: the buzzer sounds, the display says the bin is full, and nothing runs again until that bin is emptied and the button on D10 is pressed.",
 note:"Leave the serial monitor open if you can. The running distance line is easy proof the sensor is alive."},

{who:2, title:"How it is powered", dyn:"power", view:"room", say:"", note:""},

{who:3, title:"Demonstration — plastic", view:"all", feed:"bottle",
 mark:[{el:"sCap",  at:0.19, until:0.46, tag:"D3 goes LOW · D4 stays HIGH"},
       {box:[416,372,140,62], at:0.43, until:0.56, tag:"LCD prints: Plastic Waste / Detected"},
       {box:[402,430,86,28], at:0.50, until:0.78, tag:"D2 lights · one light, not three"},
       {el:"binsG", at:0.79,             tag:"and the plate turns to the plastic bin"}],
 say:"We will start with plastic, and watch three things at once: the throat, the display and the lights. The capacitive head on D3 goes LOW and the inductive on D4 stays HIGH, so the sketch calls it plastic. The display prints Plastic Waste, Detected. The plastic light on D2 comes on by itself — one light, and no buzzer, because that is what a normal sort looks like. Then the platform turns to the plastic bin, the gate opens, and it goes in.",
 note:"Present the bottle at the mouth and hold it on the sensor line for a moment. Do not drop plastic straight through — stage one cannot read it on the way past. Read the display out loud as it changes; from where the panel is sitting they may not be able to. And watch for this: as the bottle falls through, the display flickers to Bio Waste for an instant, because the infrared sees it drop past the gate. Say so before somebody asks — it is the unguarded bio branch, and the limitations section owns it."},

{who:3, title:"Demonstration — metal", view:"all", feed:"can",
 mark:[{el:"sInd",  at:0.03, until:0.48, tag:"both heads trip · D4 wins"},
       {box:[416,372,140,62], at:0.44, until:0.60, tag:"LCD prints: Metal Waste / Detected"},
       {box:[402,430,86,28], at:0.55, until:0.84, tag:"this time it is D13"},
       {el:"binsG", at:0.81,             tag:"the plate turns the other way"}],
 say:"Now metal. A can trips both heads at once, but the metal branch is tested first and the plastic branch is blocked behind it, so it is called metal. The display prints Metal Waste, Detected, and this time it is the D13 light that comes on. Still one light, still no buzzer. The platform turns the other way, to the metal bin.",
 note:"Same technique: present it, do not drop it. If a panelist asks how you know the guard works, this is the demonstration — both heads see the can, and only the metal branch fires."},

{who:3, title:"Demonstration — biodegradable", view:"all", feed:"banana",
 mark:[{el:"sIr",   at:0.15, until:0.40, tag:"only D7 sees it"},
       {box:[416,372,140,62], at:0.37, until:0.50, tag:"LCD prints: Bio Waste / Detected"},
       {box:[402,430,86,28], at:0.45, until:0.58, tag:"A3 lights"},
       {el:"binsG", at:0.49, until:0.68,  tag:"the green bin"},
       {el:"mBuzz", at:0.71,              tag:"D12 · silent through all three"}],
 say:"And biodegradable. This one we simply drop. It goes past stage one without being named, the infrared at the gate sees it arrive, and because nothing identified it the sketch calls it biodegradable. Bio Waste, Detected on the display, the A3 light on, and into the green bin. Three different inputs, three different lines on that display, three different lights — and the buzzer silent through all of them, because the buzzer means one thing only, and you will hear it shortly.",
 note:"Drop this one. Presenting bio to the proximity pair proves nothing, because neither head can see it. That last sentence sets up the full-bin demonstration — do not throw it away."},

{who:0, title:"Demonstration — a bin fills up", view:"all", feed:"can", feedAt:0.30, waitFor:"locked",
 acts:[{at:0, fill:[2, 80], sound:true}],
 mark:[{el:"binsG", at:0.03, until:0.26, tag:"metal bin · four drops in it"},
       {el:"binsG", at:0.30, until:0.46, tag:"and here is the fifth"},
       {el:"usG",   at:0.44, until:0.62, tag:"50 cm empty · under 20 now"},
       {el:"mBuzz", at:0.60, until:0.80, tag:"buzzer · D12 · one steady tone"},
       {el:"ctrl",  at:0.78,             tag:"BIN FULL · locked out"}],
 say:"Now the part that decides whether this is a machine or a demonstration. The metal bin already has four drops in it. Keep your eye on the distance reading, and watch the plate. I am feeding it a fifth. There it goes — the platform turns the metal bin under the hole, the gate opens, and the can drops in. And now the ultrasonic, which looks straight down into whichever bin is parked there, comes back under twenty centimetres. That is soundAlarm. The buzzer on D twelve goes high and stays high, so what you are hearing is one steady tone and not a pattern. The display prints Bin Full, Detected. The machine has locked itself out, and it will not sort another piece until somebody empties that bin.",
 note:"The can goes in when you say \u201cI am feeding it a fifth\u201d, not before, so the panel is watching the plate when it turns. The buzzer is switched on for you at the start of the section so they hear it. Point at the distance falling from 50 to 15 as the plate parks. Do not say the machine cannot overflow — the next section is why."},

{who:0, title:"Demonstration — emptying it", dyn:"disposal", view:"clear", say:"", note:""},

{who:4, title:"Why it stops with the gate open", view:"gate",
 mark:[{el:"tapG",  at:0.03, until:0.28, tag:"still at write(0) · open"},
       {el:"ctrl",  at:0.26, until:0.52, tag:"loop() returned before the sorting"},
       {el:"tapG",  at:0.50, until:0.74, tag:"nothing on that path closes it"},
       {el:"binsG", at:0.72,             tag:"straight into the bin we just called full"}],
 say:"The bin is empty and the room is quiet, but the machine is still locked out — and look at the gate. It is still open, and it will stay open until we press the button. Here is why. When the ultrasonic reads a full bin, detectionMaintenance sounds the alarm, prints, clears operationsEnabled and returns true — and loop returns on that true, so handleWasteDetection never runs. resetServosAndLCD, the only line in the sketch that closes the gate, is inside handleWasteDetection. The alarm also always fires on the pass straight after a drop, when the gate is still at write zero. So the machine stops with the floor of the throat hanging open. The sorting stops. The hole does not. Anything dropped in now goes straight through into the bin. That is finding ten in our own analysis, and the fix is one line before that return.",
 note:"This is the strongest thirty seconds you have with a panel — a fault you found yourself, traced in the code, with the fix. Offer to demonstrate it: hand them something and let them drop it in. If they ask why you did not just fix it, the honest answer is that you found it while writing the documentation and chose to characterise it rather than change the sketch the week of the defense."},

{who:4, title:"What the display and the lights say", view:"brain",
 mark:[{box:[416,372,140,62], at:0.04, until:0.30, tag:"LCD · still Bin Full / Detected"},
       {box:[402,430,86,28],  at:0.28, until:0.56, tag:"D2 plastic · D13 metal · A3 bio"},
       {el:"mBuzz",           at:0.54, until:0.80, tag:"D12 · already low · stopAlarm did that"},
       {el:"btnBoard",        at:0.78,             tag:"D10 clears the display and the lights"}],
 say:"Now read the three indicators, because they are not all saying the same thing. The display is still printing Bin Full, Detected — that is displayFullBin, and it stays there until the button is pressed. All three lights are still on: D2 for plastic, D13 for metal, A3 for biodegradable. In normal running only one lights, whichever class was just detected, so three at once means the alarm and not a sort. But the buzzer is already silent, and nobody has pressed anything. That was stopAlarm, and stopAlarm runs off the sensor reading — the moment the bin measured clear, the tone stopped. So emptying it stops the noise, and the button clears the display and the lights. Which tells you the trap, and it is worth saying out loud: press the button before you empty the bin and you get a clean display, no lights, a machine that runs, and a tone that will not stop, because nothing has told the sketch the bin is empty.",
 note:"Point at each one as you name it, and let the quiet do the work — the panel heard the tone stop a minute ago without anyone touching the machine. If a panelist asks for a beep pattern, be straight: soundAlarm is a single digitalWrite HIGH. A pattern would need tone() or a timer, and we did not write one."},

{who:0, title:"Demonstration — back to normal", view:"all", feed:"bottle", feedAt:0.42,
 acts:[{at:0.10, act:"d10"}],
 mark:[{el:"btnBoard", at:0.03, until:0.22, tag:"D10 · the only thing left to press"},
       {el:"ctrl",     at:0.20, until:0.44, tag:"standby · lights out"},
       {el:"tapG",     at:0.34, until:0.50, tag:"and the gate finally closes"},
       {el:"throat",   at:0.52, until:0.68, tag:"it is watching the hole again"},
       {el:"binsG",    at:0.66,             tag:"and it sorts"}],
 say:"So the last thing is the button. Watch three things go at once when I press D10. Bin Full leaves the display, the three lights go out, and the gate finally swings shut — all of that is resetServosAndLCD, one function, called from the button branch. And here is the proof that it really is back. Nothing was reset by hand and the sketch was never touched. One more piece of plastic. It sees it, it names it, it turns the plate, and it drops it in, exactly as it did before the alarm. That is the whole cycle: detect, sort, fill, warn, stop, empty, resume.",
 note:"End on this. A machine that recovers on its own is the difference between a prototype and a demonstration — let them watch it complete one full cycle after the alarm. The button is pressed for you early in the section; the gate closing on that press is the visual worth pointing at, because it is the same line that clears the display."},

{who:1, title:"What we know is not perfect", view:"machine",
 mark:[{el:"sIr",  at:0.12, until:0.52, tag:"the branch with no guard"},
       {el:"sInd", at:0.62,             tag:"foil trips this one"}],
 say:"We will save the panel the trouble of finding these. The biodegradable branch has no guard on it, so anything reaching the gate unidentified is called biodegradable — including a can thrown straight down instead of presented. Clear glass trips none of the three sensors. Food wrapped in foil trips the inductive head and is sorted as metal. And the fourth one you have already seen: when a bin fills, the machine stops sorting but the gate is left open, so the hole is still a hole. We can demonstrate all four if the panel would like to see them.",
 note:"Offer the failures before the panel finds them. This is the part that earns you the benefit of the doubt on everything else. All four are demonstrable in under a minute each — glass, foil, a thrown can, and dropping something in while the buzzer is going."},

{who:3, title:"Closing", view:"group",
 say:"That is EnviroSortPro. Thank you for your time, and we are ready for your questions.",
 note:"Then stop. Do not fill the silence — let the panel open the questioning."}
];

/* the power section is written four times over, one per build, because a
   build with no panel must not have somebody standing there talking about a
   panel. Sections can act on the machine as they are spoken: pull the plug,
   drop the pack, put the sun out.                                          */
var POWER_TALK = {
ac: {who:2, view:"room",
 acts:[{at:0.60, plug:false}, {at:0.88, plug:true}],
 mark:[{el:"mains", at:0.03, until:0.34, tag:"5 V 2 A adapter"},
       {el:"ctrl",  at:0.28, until:0.58, tag:"5 V into the USB port"},
       {el:"mains", at:0.56,             tag:"pull this and it stops"}],
 say:"This build runs from the wall. A five volt, two amp adapter goes into the Arduino's USB port — five volts, which is all the board ever wants. There is no battery and no panel on this machine, and that is deliberate: it is meant to stand where there is a socket. The servos have their own five volt supply, three amps, because two of them stalling would drag the board down if they shared its five volt pin. Nothing on this machine is above five volts anywhere. The honest cost is this: if I pull the plug, it stops mid-cycle. The waste simply sits on the closed gate until the power comes back, which is safe, but it is a stop.",
 note:"You really do pull the plug on that line, and put it back on the last one. If the panel asks why no battery, say it is a corridor machine, not a field machine — and that adding a pack means adding a step-down and a charger, which is the next build."},

battery: {who:2, view:"room",
 acts:[{at:0.76, soc:0.12}],
 mark:[{el:"supportBox", at:0.05, until:0.36, tag:"PACK A + B · 14.8 V"},
       {el:"powerMod",   at:0.30, until:0.62, tag:"5 A fuse · BMS · buck set to 5.0 V"},
       {el:"powerMod",   at:0.58, until:0.76, tag:"second buck · 5 V servo rail"},
       {el:"binsG",      at:0.74,             tag:"watch the plate slow down"}],
 say:"This build carries its own power. Two holders of four lithium ion cells each, about fourteen point eight volts, behind that door. But the Arduino never sees fourteen point eight. The pack goes through a five amp fuse and its own protection board, then into a step-down converter that we set to exactly five point zero volts with a meter before it is ever connected, and that five volts is what feeds the board. The servos take a second step-down, also five volts, three amps, so a stalling servo can never pull the board down. The high voltage stops at the converters — nothing past them is above five. Nothing charges the pack while it is on the machine: we take it off and charge it. And watch the platform now, because I am dropping the pack to about a tenth — the servos slow down long before the board browns out. A slow plate is our low-battery warning.",
 note:"The pack really does drop on that line. Bring a charged one and know your runtime: \u201cabout forty minutes\u201d is an answer, \u201cI don't know\u201d is not."},

solar: {who:2, view:"room",
 acts:[{at:0.84, sun:0.02}, {at:0.985, sun:0.7}],
 mark:[{el:"solarG",     at:0.06, until:0.40, tag:"18 V · 20 W panel"},
       {el:"powerMod",   at:0.34, until:0.60, tag:"4S charge controller"},
       {el:"supportBox", at:0.56, until:0.80, tag:"the pack it charges"},
       {el:"ctrl",       at:0.74, until:0.88, tag:"5 V, and never more"},
       {el:"solarG",     at:0.86,             tag:"and at night, nothing"}],
 say:"This build has no wall socket at all. The panel is eighteen volts, twenty watts, and it goes nowhere near the Arduino. Twenty-two volts open circuit would destroy the board, and the current collapses the moment a servo moves anyway. It goes into a four-cell charge controller, and the controller charges the pack. The pack is what runs the machine, through a step-down set to five point zero volts — because five volts is the most the Arduino ever takes, from any of these sources. Sun charges the battery, the battery runs the machine, and the converter is what makes it safe to connect. And at night the panel gives nothing, so this is simply a battery build until morning, and the pack has to be big enough to carry the night.",
 note:"The sun really does go out on that last line, and comes back at the end. That night sentence is what the panel will push on: have the pack's run time against what the panel actually harvests in a day."},

all: {who:2, view:"room",
 acts:[{at:0.30, src:"battery"}, {at:0.62, src:"solar"}],
 mark:[{el:"mains",      at:0.02, until:0.30, tag:"5 V 2 A adapter"},
       {el:"powerMod",   at:0.22, until:0.50, tag:"selector · buck · charger"},
       {el:"supportBox", at:0.36, until:0.62, tag:"PACK A + B · 14.8 V"},
       {el:"solarG",     at:0.60, until:0.86, tag:"18 V · 20 W panel"},
       {el:"powerMod",   at:0.84,             tag:"one 5 V lead to the board"}],
 say:"It can be fed three ways, and the Arduino cannot tell the difference, because whichever way it is fed the board sees the same five volts. For a long demonstration like this one, a five volt adapter in the wall. To run on its own, the two battery packs — four lithium ion cells each, fourteen point eight volts — through a step-down converter set to five point zero, which is what we are switching to now: the adapter is out, and the machine has not noticed. And to keep the packs up without a wall, an eighteen volt panel through a charge controller into the same packs. The panel never feeds the board. It charges the pack, and the pack runs the machine. Fourteen point eight from the pack, eighteen from the panel, and five at the board — the converter is the line between them.",
 note:"The adapter really comes out of the wall on that line, and the panel really takes over. Have the meter on the Power card in view. If the plate is slow on the day, say why before they ask."}
};
/* the emptying section is written both ways, because lifting a bag out of a
   bin and lifting the bin off the platform are different machines to defend */
var DISP_TALK = {
liner: {who:0, view:"clear", waitFor:"emptied",
 acts:[{at:0.03, act:"dispose"}],
 mark:[{el:"binsG",       at:0.02, until:0.30, tag:"the bin never moves"},
       {el:"dispStation", at:0.28, until:0.60, tag:"metal into metal"},
       {el:"mBuzz",       at:0.58,             tag:"D12 · low again, and nobody pressed anything"}],
 say:"And the first thing we do is take that noise out of the room, because the panel should not have to listen to it while we explain. Every bin is lined with a plastic garbage bag, so we lift the bag out by the neck, tie it, and drop the whole bag into the matching big bin on the right — metal into metal, so nothing we have just sorted gets mixed again on the way out. The bin itself never leaves the platform, and a fresh bag goes in. If you do not line them, the alternative is to carry the whole bin across and tip it, which works, but then you are carrying open waste through the room. Now listen to what just happened. The tone stopped by itself the moment the waste was out, and we have not touched the button. That is stopAlarm, and it runs off the sensor reading, not off anything a person presses.",
 note:"Do this first and do it fast — a steady tone running for two minutes while you talk is the quickest way to lose a panel's attention, and emptying it is what the machine is asking for anyway. The button is NOT pressed here: the display still says Bin Full and the three lights are still on, which is the whole point of the next two sections. Switch Bins in the header to rehearse the other way — the section rewrites itself and the animation changes with it."},
bin: {who:0, view:"clear", waitFor:"emptied",
 acts:[{at:0.03, act:"dispose"}],
 mark:[{el:"binsG",       at:0.02, until:0.30, tag:"the whole bin comes off"},
       {el:"dispStation", at:0.28, until:0.60, tag:"metal into metal"},
       {el:"mBuzz",       at:0.58,             tag:"D12 · low again, and nobody pressed anything"}],
 say:"And the first thing we do is take that noise out of the room, because the panel should not have to listen to it while we explain. We take the whole bin off the plate, carry it across, and tip it into the matching big bin on the right — metal into metal, so nothing we have just sorted gets mixed again on the way out. Then the empty bin goes back on the platform. The way we would recommend is to line every bin with a bag instead, so the bin never has to leave the machine at all. Now listen to what just happened. The tone stopped by itself the moment the waste was out, and we have not touched the button. That is stopAlarm, and it runs off the sensor reading, not off anything a person presses.",
 note:"Do this first and do it fast — a steady tone running for two minutes while you talk is the quickest way to lose a panel's attention. The button is NOT pressed here: the display still says Bin Full and the three lights are still on, which is the whole point of the next two sections. Carrying an open bin of waste across a room is also the part a panel asks about for safety."}
};
/* the power and emptying sections resolve to whatever is selected */
function stepAt(i){
  var t = TALK[i];
  if(!t) return t;
  if(t.dyn === "power" || t.dyn === "disposal"){
    var d = t.dyn === "power" ? (POWER_TALK[POWER.build] || POWER_TALK.all)
                              : (DISP_TALK[DISP_MODE] || DISP_TALK.liner);
    return {who:(d.who !== undefined ? d.who : t.who), title:t.title,
            view:d.view || t.view, say:d.say, note:d.note, mark:d.mark,
            acts:d.acts, waitFor:d.waitFor, feed:d.feed};
  }
  return t;
}

var pres = {on:false, i:-1, playing:false, paused:false, wait:0, waitFrom:0, tick:0,
            fed:false, fedAt:0, fedStart:false};

function presText(t){
  return String(t).replace(/\{G\}/g, greeting()).replace(/\{GROUP\}/g, groupName());
}
function presRead(txt){                  /* how long it takes to say, at this speed */
  return Math.round(txt.split(/\s+/).length / (2.6 * rateNow()) * 1000);
}
function setPresent(on){
  pres.on = on;
  $("presentBtn").setAttribute("aria-pressed", String(on));
  $("presentBtn").textContent = "Presentation: " + (on ? "on" : "off");
  $("presentCard").style.display = on ? "" : "none";
  if(on){
    if(iv.on) setInterview(false);
    STUDENTS.forEach(function(S){ S.name = groupName(); });
    paintPres();
    $("presentCard").scrollIntoView({behavior:"smooth", block:"nearest"});
  } else {
    endPres(false); pres.i = -1;
    $("qBubbles").innerHTML = "";
    paintPres();
  }
}
function startPres(){
  ac();                                  /* unlock audio on this user gesture */
  applyGreeting();
  setWallClock();
  clearCues(); speakStop(); readStop();
  pres.playing = true; pres.paused = false; pres.wait = 0;
  goStep(0);
}
function goStep(i){
  if(i < 0) return;
  if(pres.i >= 0 && pres.i < TALK.length && pres.i !== i) flushActs(pres.i);
  if(i >= TALK.length){ endPres(true); return; }
  clearCues(); speakStop();
  if(!TALK[i] || TALK[i].title.indexOf("input hole") < 0) $("boreView").setAttribute("opacity", "0");
  pres.i = i; pres.wait = 0; pres.d10 = false; pres.playing = true; pres.paused = false;
  pres.fed = false; pres.fedAt = 0; pres.fedStart = false; pres.waitFrom = Date.now();
  var st = stepAt(i);
  iv.badge = "PRESENTING";
  if($("pzCam").checked){
    cam.free = false; camTo(VIEWS[st.view] || FULL, 900); paintView("");
    walkSection(st.view);            /* and walk there, if you are inside the room */
  }
  /* The demonstration sections put the waste on the belt themselves. A section
     with `feedAt` waits for that point in its own narration instead — the whole
     drop-and-sort takes about five seconds, so on a long section feeding at the
     start means the machine has finished before the speaker has said what to
     watch, and the panel spends the rest of it looking at a machine doing
     nothing. */
  if(st.feed && st.feedAt === undefined){ pres.fedStart = true; presFeed(i, st.feed, 1100); }
  (st.acts || []).forEach(function(a){ a.done = false; });
  say("students", st.who, presText(st.say), function(){ spoken(i); });
  paintPres();
}
/* Put the section's waste on the belt, and keep trying until it is really on.
   feed() refuses while the machine still has the last piece in it, and a demo
   that silently fed nothing is the whole reason a section used to look stuck. */
function presFeed(i, kind, delay){
  cue(delay, function(){
    if(!pres.on || pres.i !== i) return;
    if(feed(kind)){ pres.fed = true; pres.fedAt = Date.now(); }
    else presFeed(i, kind, 400);
  });
}
/* what a section is waiting for before it moves on */
function stepDone(st, now){
  if(!st) return true;
  /* a demonstration is not over before it has started */
  if(st.feed && !pres.fed) return false;
  if(st.waitFor === "locked") return !G.operationsEnabled;
  /* the waste is out and the tone has stopped by itself — the button is a
     separate demonstration, two sections later, so it is not pressed here */
  if(st.waitFor === "emptied") return disposal.phase === "done" && !G.obstacleDetected;
  if(st.waitFor === "resume"){
    /* the student presses D10 once the waste is actually out, not before */
    if(disposal.phase === "done" && !pres.d10){ pres.d10 = true; cue(900, pressButton); }
    return G.operationsEnabled && disposal.phase === "idle";
  }
  return machineIdle() && now > Math.max(pres.waitFrom, pres.fedAt) + 2600;
}
function spoken(i){
  if(!pres.on || pres.i !== i) return;
  flushActs(i);                          /* a fast voice must not skip the demo */
  var st = stepAt(i);
  /* nor the feed: a browser that drops the utterance early would otherwise end
     the section having never put the waste in */
  if(st.feed && !pres.fedStart){ pres.fedStart = true; presFeed(i, st.feed, 0); }
  if((st.feed || st.waitFor) && !stepDone(st, Date.now())){
    pres.wait = Date.now() + (st.waitFor === "resume" ? 60000 : 45000);
    pres.waitFrom = Date.now();          /* d10 is armed in goStep — leave it */
    paintPres();
    return;
  }
  advanceSoon();
}
/* a section can act on the machine as it is spoken: switch the source, pull
   the plug, drop the pack, put the sun out                                */
function applyAct(a){
  if(a.show !== undefined) $("boreView").setAttribute("opacity", a.show ? "1" : "0");
  if(a.view && $("pzCam").checked){       /* pace the camera on, mid-sentence */
    cam.free = false;
    camTo(VIEWS[a.view] || FULL, 1100);
    paintView("");
    walkSection(a.view);
  }
  if(a.sound) setSound(true);             /* the panel has to hear this one */
  if(a.fill) W.level[a.fill[0]] = a.fill[1];
  if(a.act === "dispose") startDisposal();
  if(a.act === "d10") pressButton();
  if(a.src) setPower(a.src);
  if(a.plug !== undefined){ POWER.plugged = a.plug; stepPower(0); paintPower(); }
  if(a.sun !== undefined){ POWER.sun = a.sun; $("pwSun").value = Math.round(a.sun * 100); paintPower(); }
  if(a.soc !== undefined){ POWER.soc = a.soc; POWER.cut = false; stepPower(0); paintPower(); }
}
/* leaving a section runs anything it had not got to yet, so a skipped or
   fast-read section still puts the plug back and the sun back up          */
function flushActs(i){
  var st = stepAt(i);
  (st && st.acts || []).forEach(function(a){ if(!a.done){ a.done = true; applyAct(a); } });
}
function advanceSoon(){
  if(!$("pzAuto").checked){ pres.playing = false; paintPres(); return; }
  cue(900, function(){ if(pres.on && pres.playing && !pres.paused) goStep(pres.i + 1); });
}
function pausePres(){
  if(!pres.on || pres.i < 0 || pres.i >= TALK.length) return;
  pres.paused = !pres.paused;
  if(synth){ try{ pres.paused ? synth.pause() : synth.resume(); }catch(e){} }
  pres.tick = Date.now();
  paintPres();
}
/* while paused, everything with a clock on it is pushed forward instead of
   running down: the reveal, the fallback, the machine wait and every cue   */
function presFreeze(now){
  var d = now - (pres.tick || now);
  pres.tick = now;
  if(d <= 0) return;
  iv.askStart += d;
  if(iv.sayFallbackAt) iv.sayFallbackAt += d;
  if(pres.wait){ pres.wait += d; pres.waitFrom += d; }
  iv.cues.forEach(function(c){ c.at += d; });
}
function stepPresentation(now){
  if(iv.text){
    iv.reveal = Math.min(1, (now - iv.askStart) / iv.askEst);
    /* the power section pulls the plug and lets the panel take over, on cue */
    var st = stepAt(pres.i);
    (st && st.acts || []).forEach(function(a){
      if(!a.done && iv.reveal >= a.at){ a.done = true; applyAct(a); }
    });
    /* the waste goes in on the sentence that announces it, not before */
    if(st && st.feed && st.feedAt !== undefined && !pres.fedStart && iv.reveal >= st.feedAt){
      pres.fedStart = true; presFeed(pres.i, st.feed, 0);
    }
    /* "Only when we press D10 does the display go back to standby" — press it
       on that sentence. Waiting for the narration to end left the machine
       sitting locked out with nothing moving for the best part of a minute
       after the bag had already landed. */
    if(st && st.waitFor === "resume" && !pres.d10 &&
       disposal.phase === "done" && iv.reveal >= 0.88){
      pres.d10 = true; cue(900, pressButton);
    }
    if(!iv.utter){
      if(iv.sayThen && now > iv.sayFallbackAt) sayDone();
    } else if(now > iv.askStart + iv.askEst * 2.6 + 8000){ speakStop(); sayDone(); }
  }
  if(pres.wait){
    if(stepDone(stepAt(pres.i), now)){ pres.wait = 0; advanceSoon(); }
    else if(now > pres.wait){ pres.wait = 0; advanceSoon(); }   /* it never finished */
  }
}
function endPres(finished){
  if(pres.i >= 0 && pres.i < TALK.length) flushActs(pres.i);
  $("boreView").setAttribute("opacity", "0");
  clearCues(); speakStop(); readStop();
  $("marks").innerHTML = ""; marksSig = "";
  pres.playing = false; pres.paused = false; pres.wait = 0;
  iv.speaker = -1; iv.text = ""; iv.sayThen = null; iv.badge = "";
  pres.i = finished ? TALK.length : pres.i;
  paintPres();
}


/* ---------------- pointing at what is being said ----------------------
   A section names a part, and a box goes round that part with an arrow and
   a chip naming it. The box is not typed in by hand: it is measured off the
   drawing itself with getBBox, put back into scene coordinates, so it stays
   correct if the art ever moves. Marks come and go with the narration --
   iv.reveal is how far through the sentence the voice is -- and everything
   is scaled by how far in the camera is, so a highlight is the same size on
   screen whether you are looking at the whole room or standing on top of
   one sensor.                                                            */
function boxOf(m){
  if(m.el){
    var el = $(m.el), root = $("scene");
    try{
      var b = el.getBBox();
      if(!b || !b.width) return m.box ? {x:m.box[0], y:m.box[1], w:m.box[2], h:m.box[3]} : null;
      var mx = root.getScreenCTM().inverse().multiply(el.getScreenCTM());
      var xs = [], ys = [];
      [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .forEach(function(pt){
          xs.push(mx.a * pt[0] + mx.c * pt[1] + mx.e);
          ys.push(mx.b * pt[0] + mx.d * pt[1] + mx.f);
        });
      return {x:Math.min.apply(null, xs), y:Math.min.apply(null, ys),
              w:Math.max.apply(null, xs) - Math.min.apply(null, xs),
              h:Math.max.apply(null, ys) - Math.min.apply(null, ys)};
    }catch(e){ /* not rendered yet */ }
  }
  return m.box ? {x:m.box[0], y:m.box[1], w:m.box[2], h:m.box[3]} : null;
}
var marksSig = "";
function drawMarks(){
  var g = $("marks");
  var live = pres.on && pres.i >= 0 && pres.i < TALK.length && $("pzMark").checked;
  var list = live ? (stepAt(pres.i).mark || []) : [];
  var r = pres.paused ? iv.reveal : (iv.reveal || 0);
  var on = list.filter(function(m){
    return r >= (m.at || 0) && r <= (m.until === undefined ? 1.01 : m.until);
  });
  var k = cam.cur.w / SCENE_W;                       /* keep it the same on screen */
  var sig = pres.i + "|" + on.map(function(m){ return m.tag; }).join("~") + "|" + k.toFixed(2);
  if(sig === marksSig) return;
  marksSig = sig;
  if(!on.length){ g.innerHTML = ""; return; }

  var out = "";
  on.forEach(function(m){
    var b = boxOf(m);
    if(!b) return;
    var pad = 9 * k, sw = 2.6 * k, fs = 11 * k, ch = 19 * k;
    var x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
    var tag = m.tag || "", tw = tag.length * fs * 0.62 + 14 * k;
    var c = cam.cur, gap = 26 * k, need = tw + 22 * k;
    var dir = (x - need > c.x + 4 * k) ? "left"
            : (x + w + need < c.x + c.w - 4 * k) ? "right"
            : (y - (ch + gap + 8 * k) > c.y + 4 * k) ? "top" : "bottom";
    var mx = x + w / 2, my = y + h / 2, tipX, tipY, tailX, tailY, head, cx0, cy0, anchor;
    if(dir === "left"){
      tipX = x - 3 * k; tipY = my; tailX = tipX - gap; tailY = my;
      head = (tipX) + "," + tipY + " " + (tipX - 7*k) + "," + (tipY - 4.6*k) + " " + (tipX - 7*k) + "," + (tipY + 4.6*k);
      cx0 = tailX - 5 * k; cy0 = my; anchor = "end";
    } else if(dir === "right"){
      tipX = x + w + 3 * k; tipY = my; tailX = tipX + gap; tailY = my;
      head = (tipX) + "," + tipY + " " + (tipX + 7*k) + "," + (tipY - 4.6*k) + " " + (tipX + 7*k) + "," + (tipY + 4.6*k);
      cx0 = tailX + 5 * k; cy0 = my; anchor = "start";
    } else if(dir === "top"){
      tipX = mx; tipY = y - 3 * k; tailX = mx; tailY = tipY - gap;
      head = tipX + "," + tipY + " " + (tipX - 4.6*k) + "," + (tipY - 7*k) + " " + (tipX + 4.6*k) + "," + (tipY - 7*k);
      cx0 = mx; cy0 = tailY - 5 * k; anchor = "middle";
    } else {
      tipX = mx; tipY = y + h + 3 * k; tailX = mx; tailY = tipY + gap;
      head = tipX + "," + tipY + " " + (tipX - 4.6*k) + "," + (tipY + 7*k) + " " + (tipX + 4.6*k) + "," + (tipY + 7*k);
      cx0 = mx; cy0 = tailY + ch - 5 * k; anchor = "middle";
    }
    out += '<g class="mk">' +
      '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) +
        '" height="' + h.toFixed(1) + '" rx="' + (7 * k).toFixed(1) + '" fill="none" ' +
        'stroke="#5FE3CF" stroke-width="' + sw.toFixed(2) + '"/>' +
      '<line x1="' + tailX.toFixed(1) + '" y1="' + tailY.toFixed(1) + '" x2="' + tipX.toFixed(1) +
        '" y2="' + tipY.toFixed(1) + '" stroke="#5FE3CF" stroke-width="' + sw.toFixed(2) +
        '" stroke-linecap="round"/>' +
      '<polygon points="' + head + '" fill="#5FE3CF"/>';
    if(tag){
      var bx = anchor === "end" ? cx0 - tw : anchor === "start" ? cx0 : cx0 - tw / 2;
      out += '<rect x="' + bx.toFixed(1) + '" y="' + (cy0 - ch / 2).toFixed(1) + '" width="' + tw.toFixed(1) +
             '" height="' + ch.toFixed(1) + '" rx="' + (5 * k).toFixed(1) +
             '" fill="#06282A" stroke="#5FE3CF" stroke-width="' + (1.2 * k).toFixed(2) + '"/>' +
             '<text x="' + cx0.toFixed(1) + '" y="' + (cy0 + fs * 0.36).toFixed(1) + '" text-anchor="' + anchor +
             '" font-family="IBM Plex Mono, monospace" font-size="' + fs.toFixed(1) +
             '" fill="#BFF6EE">' + esc(tag) + '</text>';
    }
    out += '</g>';
  });
  g.innerHTML = out;
}

/* ---------- the card ---------- */
function buildPresList(){
  $("pzList").innerHTML = TALK.map(function(t, i){
    var S = STUDENTS[t.who];
    return '<li><button type="button" data-s="' + i + '">' +
           '<span class="pnum" style="background:#2B4C7E">' + (i + 1) + '</span>' +
           '<span><span class="qcat">' + esc(S.role) +
           (t.feed ? " &middot; runs the machine" : "") + '</span>' + esc(t.title) + '</span>' +
           '</button></li>';
  }).join("");
  $("pzCount").textContent = String(TALK.length);
}
function paintPres(){
  var n = TALK.length, at = pres.i, live = pres.on && at >= 0 && at < n;
  var st = live ? stepAt(at) : null;
  var S = st ? STUDENTS[st.who] : null;
  var finished = pres.on && at >= n;

  $("pzWho").textContent = S ? (S.name + " · " + S.role)
    : finished ? "That is the whole presentation" : "The group is not presenting yet";
  $("pzTitle").textContent = st ? st.title : (finished ? "finished" : "");
  $("pzDot").style.background = S ? "#2B4C7E" : "";
  $("pzDot").style.color = S ? "#2B4C7E" : "";
  $("pzDot").classList.toggle("live", !!live && !pres.paused && (!!iv.utter || iv.reveal < 1));

  var say = st ? presText(st.say) : "";
  $("pzSay").textContent = st ? say
    : finished ? "Every section has been read. Hand over to the panel when they are ready, or start again from the top."
    : "Press Start the presentation. One member at a time takes a section, the camera walks to whatever they are talking about, and the words below are what they say — read them out loud yourself, or let the voice read them while you follow.";
  $("pzNote").textContent = st ? st.note
    : finished ? "Nothing here is the official script. Keep what is true for your group and change the rest."
    : "";
  $("pzNote").hidden = !st && !finished;

  var frac = finished ? 1 : (live ? (at + (iv.reveal || 0)) / n : 0);
  $("pzBar").style.width = (frac * 100).toFixed(1) + "%";
  $("pzBarWrap").classList.toggle("pass", finished);
  $("pzTime").textContent = st ? fmt(presRead(say)) : "—";
  $("pzPhase").textContent = pres.paused ? "paused"
    : pres.wait ? (st && st.waitFor === "locked" ? "waiting for the sensor"
                  : st && st.waitFor === "resume" ? "emptying the bin" : "watching the machine")
    : finished ? "finished"
    : live ? (pres.playing ? "presenting" : "waiting for you")
    : "idle";
  $("pzProgress").textContent = finished ? "finished · " + n + " sections"
    : live ? "section " + (at + 1) + " of " + n : "not started";

  $("pzStart").textContent = (live || finished) ? "Start again" : "Start the presentation";
  $("pzPause").disabled = !live;
  $("pzPause").textContent = pres.paused ? "Resume" : "Pause";
  $("pzBack").disabled = !(live && at > 0);
  $("pzNext").disabled = !live;
  $("pzStop").disabled = !(live || finished);
  $("pzHand").hidden = !finished;

  var rows = $("pzList").children;
  for(var i = 0; i < rows.length; i++){
    rows[i].classList.toggle("now", i === at);
    rows[i].classList.toggle("asked", i < at);
  }
}

/* ---------- wiring ---------- */
$("presentBtn").addEventListener("click", function(){ setPresent(!pres.on); });
$("pzStart").addEventListener("click", function(){ if(!pres.on) setPresent(true); startPres(); });
$("pzPause").addEventListener("click", pausePres);
$("pzBack").addEventListener("click", function(){ if(pres.i > 0) goStep(pres.i - 1); });
$("pzNext").addEventListener("click", function(){ goStep(pres.i + 1); });
$("pzStop").addEventListener("click", function(){ endPres(false); pres.i = -1; $("qBubbles").innerHTML = ""; paintPres(); });
$("pzHand").addEventListener("click", function(){
  setPresent(false);
  setInterview(true);
  startIv(true);                        /* they have just introduced themselves */
});
$("pzRate").addEventListener("input", function(){
  $("pzRateLbl").textContent = parseFloat(this.value).toFixed(2).replace(/0$/, "") + "×";
  paintPres();
});
$("pzSpeak").addEventListener("change", function(){
  if(!this.checked) speakStop();
});
$("pzMark").addEventListener("change", function(){ marksSig = ""; drawMarks(); });
$("pzList").addEventListener("click", function(e){
  var b = e.target.closest("[data-s]"); if(!b) return;
  ac();
  if(!pres.on) setPresent(true);
  goStep(parseInt(b.getAttribute("data-s"), 10));
});
buildPresList();
$("pzRateLbl").textContent = parseFloat($("pzRate").value).toFixed(2).replace(/0$/, "") + "×";
paintPres();


/* ====================== the power card and the flow ===================
   Everything the module on the mast knows, laid out: which lane is live,
   what the pack is doing, and the wiring flow itself as a block diagram
   with the running lane lit and its wires moving.                       */
var powerOpen = false, pwAt = 0;
function setPowerCard(on){
  powerOpen = on;
  $("powerCard").style.display = on ? "" : "none";
  $("powerBtn").setAttribute("aria-pressed", String(on));
  if(on){ paintPower(); $("powerCard").scrollIntoView({behavior:"smooth", block:"nearest"}); }
}
function sunWord(v){
  return v <= 0 ? "night" : v < 0.25 ? "dusk" : v < 0.5 ? "overcast" : v < 0.8 ? "bright" : "full sun";
}
/* minutes at the simulator's pace, from the net rate */
function packEta(){
  var r = POWER.chg;
  if(Math.abs(r) < 1e-6) return "";
  var left = r > 0 ? (1 - POWER.soc) / r : (POWER.soc - POWER.CUT) / -r;
  if(left < 0) left = 0;
  var m = Math.round(left / speed / 60), sec = Math.round(left / speed);
  var t = m >= 1 ? m + " min" : sec + " s";
  return r > 0 ? "full in ~" + t : "cut-off in ~" + t;
}
var pwSig = "";
function paintPower(){
  var b = BUILDS[POWER.build], src = POWER.src, on = W.mains, pct = Math.round(POWER.soc * 100);
  var sf = servoFactor(), cs = chargeSource();
  $("powerBtn").textContent = "Power: " + (POWER.build === "all" ? POWER_NAME[src] : b.name);
  $("pwTag").textContent = b.name + (on ? "" : " · Uno down");
  Array.prototype.forEach.call(document.querySelectorAll("#pwBuilds [data-build]"), function(n){
    n.setAttribute("aria-pressed", String(n.getAttribute("data-build") === POWER.build));
  });
  Array.prototype.forEach.call(document.querySelectorAll("#pwSrcRow [data-src]"), function(n){
    n.setAttribute("aria-pressed", String(n.getAttribute("data-src") === src));
  });
  $("pwSrcRow").hidden = POWER.build !== "all";
  $("pwPackTile").hidden = !b.has.pack;
  $("pwPlug").hidden = !b.has.ac;
  $("pwDrain").hidden = !b.has.pack;
  $("pwFill").hidden = !b.has.pack;
  $("pwFill").textContent = cs ? "Charge the pack to full" : "Swap in a charged pack";
  $("pwBuildNote").textContent = b.note;

  var uno = $("pwUno");
  uno.textContent = on ? "running" : (src === "ac" ? "no power" : "browned out");
  uno.className = "v " + (on ? "ok" : "bad");
  $("pwUnoSub").textContent = src === "ac"
    ? (POWER.plugged ? (b.has.pack ? "on the adapter through the module" : "on the adapter · 5 V 2 A into the USB port")
                     : "the adapter is out of the wall")
    : (POWER.cut ? "BMS cut the pack at " + POWER.v.toFixed(1) + " V · recovers at 12.8 V"
                 : "on the pack through the 5 V buck");
  var v = $("pwPackV");
  v.textContent = POWER.v.toFixed(1) + " V";
  v.className = "v " + (POWER.cut || POWER.soc < 0.12 ? "bad" : POWER.soc < 0.35 ? "warn" : "");
  $("pwPackBarI").style.width = pct + "%";
  $("pwPackBar").className = "pw-bar " + (POWER.soc < 0.12 ? "bad" : POWER.soc < 0.35 ? "warn" : "");
  var doing = POWER.chg > 1e-6 ? (cs === "panel" ? "charging from the panel" : "charging from the adapter")
            : POWER.chg < -1e-6 ? "discharging"
            : (POWER.soc >= 1 ? "full" : cs ? "resting" : "nothing charges it on this build");
  $("pwPackNote").textContent = pct + "% · " + doing + (packEta() ? " · " + packEta() : "");
  $("pwOut").textContent = !on ? "0 V · 0 V" : "5 V · 5 V";
  var sv = $("pwServo");
  sv.textContent = src === "ac" ? "full speed" : Math.round(sf * 100) + "% speed";
  sv.className = "v " + (sf < 0.6 ? "bad" : sf < 0.85 ? "warn" : "");
  $("pwServoSub").textContent = src === "ac" ? "the adapter never sags"
    : sf < 0.85 ? "the plate is slowing — your low-battery warning" : "the first thing a sagging pack shows";
  $("pwSunRow").hidden = !(b.has.solar && src === "solar");
  $("pwSunLbl").textContent = Math.round(POWER.sun * 100) + "% · " + sunWord(POWER.sun);
  $("pwPlug").textContent = POWER.plugged ? "Pull the adapter out" : "Plug the adapter back in";

  /* the scene: the switch, the LEDs, the glint, the tag, the strip */
  var ang = src === "ac" ? -40 : src === "battery" ? 0 : 40;
  $("pwrKnob").setAttribute("transform", "rotate(" + ang + " 458 232)");
  $("pwrLedAc").setAttribute("fill",    src === "ac"      ? "#4BC969" : "#3A4448");
  $("pwrLedBatt").setAttribute("fill",  src === "battery" ? "#4BC969" : "#3A4448");
  $("pwrLedSolar").setAttribute("fill", src === "solar"   ? "#4BC969" : "#3A4448");
  $("pwrOutLed").setAttribute("fill", on ? "#4BC969" : "#3A4448");
  $("pwrChg").setAttribute("fill", POWER.chg > 1e-6 ? "#E8A33D" : "#3A4448");
  $("pwrFull").setAttribute("fill", POWER.soc >= 1 ? "#4BC969" : "#3A4448");
  $("pwrOut").setAttribute("opacity", on ? "1" : ".35");
  $("solarGlint").setAttribute("opacity", (0.04 + 0.3 * POWER.sun).toFixed(2));
  $("solarCable").setAttribute("opacity", src === "solar" ? "1" : ".55");
  $("packCable").setAttribute("opacity", src !== "ac" ? "1" : ".55");
  $("pwrTagSrc").textContent = (POWER.build === "all" ? POWER_NAME[src] : b.name).toUpperCase();
  $("pwrTagV").textContent = b.has.pack
    ? "pack " + POWER.v.toFixed(1) + " V · " + pct + "% · " + doing + (on ? "" : " · UNO DOWN")
    : (POWER.plugged ? "5 V 2 A adapter · no pack on this build" : "adapter out · UNO DOWN");
  $("fPower").textContent = b.name + " — " +
    (src === "ac" ? (POWER.plugged ? "5 V 2 A" : "unplugged") : POWER.v.toFixed(1) + " V · " + pct + "%") +
    (on ? "" : " · Uno down");

  /* the flow diagram: lit lane, and red if that lane is the one that failed */
  var sig = POWER.build + "|" + src + "|" + on + "|" + POWER.plugged;
  if(sig !== pwSig){
    pwSig = sig;
    ["ac", "battery", "solar"].forEach(function(k){
      var lane = $("pwLane_" + k); if(!lane) return;
      var live = (k === src) || (src === "solar" && k === "battery");
      lane.setAttribute("class", "lane" + (live ? " on" : "") + (live && !on ? " down" : ""));
    });
    var rail = $("pwLane_rail"); if(rail) rail.setAttribute("class", "lane" + (on ? " on" : ""));
  }
}

/* ---------- the flow, redrawn whenever the build changes ---------- */
function buildPowerFlow(){
  var b = BUILDS[POWER.build], lanes = [];
  if(b.has.ac) lanes.push("ac");
  if(b.has.pack) lanes.push("battery");
  if(b.has.solar) lanes.push("solar");
  var n = lanes.length, railY = 30 + n * 100 + 10, H = railY + 92;
  var o = '<svg viewBox="0 0 1000 ' + H + '" role="img" aria-label="Power wiring flow for the ' +
          b.name + ' build" font-family="IBM Plex Mono, monospace">';
  function block(x, y, w, t1, t2, col, h){
    h = h || 46;
    var ty = y + (h > 60 ? 23 : h / 2 - 4);
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" fill="' + (col || "#152022") +
           '" stroke="#39413F" stroke-width="1.4"/>' +
           '<text x="' + (x + w/2) + '" y="' + ty + '" text-anchor="middle" font-size="11.5" fill="#EDF3F2">' + t1 + '</text>' +
           '<text x="' + (x + w/2) + '" y="' + (ty + 16) + '" text-anchor="middle" font-size="10" fill="#9FB6B2">' + t2 + '</text>';
  }
  function wire(x1, y1, x2, y2, lbl, col){
    var c = col || "#7FE3D4";
    return '<line class="wire" x1="' + x1 + '" y1="' + y1 + '" x2="' + (x2 - 6) + '" y2="' + y2 +
           '" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round"/>' +
           '<polygon points="' + x2 + ',' + y2 + ' ' + (x2 - 9) + ',' + (y2 - 5) + ' ' + (x2 - 9) + ',' + (y2 + 5) + '" fill="' + c + '"/>' +
           (lbl ? '<text x="' + ((x1 + x2) / 2) + '" y="' + (y1 - 6) + '" text-anchor="middle" font-size="9.5" fill="#9FB6B2">' + lbl + '</text>' : "");
  }
  function tag(y, t){
    return '<text x="14" y="' + (y + 28) + '" font-size="10.5" letter-spacing="1.5" fill="#7FE3D4">' + t + '</text>';
  }
  var yOf = {};
  lanes.forEach(function(k, i){ yOf[k] = 30 + i * 100; });
  var sel = POWER.build === "all";

  if(b.has.ac){
    var y = yOf.ac;
    o += '<g id="pwLane_ac" class="lane">' + tag(y, "AC") +
         block(70, y, 120, "WALL", "220 V AC") + wire(190, y + 23, 236, y + 23, "mains") +
         block(236, y, 160, "ADAPTER", "5 V · 2 A · barrel plug");
    o += b.has.pack
      ? wire(396, y + 23, 560, y + 23, "5 V") + block(560, y, 150, "MODULE", sel ? "selector 1 · AC" : "pass-through") +
        wire(710, y + 23, 800, y + 23, "5 V")
      : wire(396, y + 23, 800, y + 23, "5 V straight to the USB port");
    o += '</g>';
  }
  if(b.has.pack){
    var y2 = yOf.battery;
    o += '<g id="pwLane_battery" class="lane">' + tag(y2, "BATT") +
         block(70, y2, 140, "PACK A + B", "2 × 4S 18650 · 14.8 V") + wire(210, y2 + 23, 266, y2 + 23, "5 A fuse", "#F2685E") +
         block(266, y2, 120, "BMS", "4S · 3.0 V/cell cut") + wire(386, y2 + 23, 432, y2 + 23, "14.8 V") +
         block(432, y2, 118, "LM2596", "buck · set 5.0 V") + wire(550, y2 + 23, 560, y2 + 23) +
         block(560, y2, 150, "MODULE", sel ? "selector 2 · pack" : "buck out") +
         wire(710, y2 + 23, 800, y2 + 23, "5 V to the 5 V pin") +
         '</g>';
  }
  if(b.has.solar){
    var y3 = yOf.solar, top = yOf.battery + 46;
    o += '<g id="pwLane_solar" class="lane">' + tag(y3, "SOLAR") +
         block(70, y3, 140, "PANEL", "18 V · 20 W · Voc 22 V") + wire(210, y3 + 23, 266, y3 + 23, "0–22 V") +
         block(266, y3, 170, "4S CHARGE CTRL", "CC/CV to 16.8 V · into the pack") +
         '<path class="wire" d="M351 ' + y3 + ' V' + (top + 10) + ' C351 ' + (top + 2) + ' 358 ' + top + ' 366 ' + top +
           '" fill="none" stroke="#7FE3D4" stroke-width="2.4"/>' +
         '<polygon points="374,' + top + ' 365,' + (top - 5) + ' 365,' + (top + 5) + '" fill="#7FE3D4"/>' +
         '<text x="380" y="' + (y3 - 25) + '" font-size="9.5" fill="#9FB6B2">charges the pack —</text>' +
         '<text x="380" y="' + (y3 - 12) + '" font-size="9.5" fill="#9FB6B2">then the BATT lane runs the machine</text>';
    if(sel) o += block(560, y3, 150, "MODULE", "selector 3 · pack + charger") +
                 '<path class="wire" d="M635 ' + y3 + ' V' + (y3 - 24) + ' C635 ' + (y3 - 34) + ' 640 ' + (y3 - 40) +
                   ' 650 ' + (y3 - 44) + '" fill="none" stroke="#7FE3D4" stroke-width="2.4"/>' +
                 '<text x="655" y="' + (y3 - 15) + '" font-size="9.5" fill="#9FB6B2">same buck, same jack</text>';
    o += '</g>';
  }
  var unoH = Math.max(46, n * 100 - 54);
  var servo = b.has.pack ? ["BUCK #2", "5 V · 3 A off the pack"] : ["PSU #2", "5 V · 3 A second adapter"];
  o += '<g id="pwLane_rail" class="lane on">' +
       block(800, 30, 180, "ARDUINO UNO", "5 V in · nothing more", "#1B4C86", unoH) +
       (unoH > 90 ?
         '<text x="890" y="' + (30 + unoH/2 + 4) + '" text-anchor="middle" font-size="9.5" fill="#BFD9E2">USB port from the adapter,</text>' +
         '<text x="890" y="' + (30 + unoH/2 + 17) + '" text-anchor="middle" font-size="9.5" fill="#BFD9E2">5 V pin from the buck.</text>' +
         '<text x="890" y="' + (30 + unoH/2 + 30) + '" text-anchor="middle" font-size="9.5" fill="#BFD9E2">Never the barrel jack.</text>' : "") +
       block(70, railY, 170, servo[0], servo[1]) + wire(240, railY + 23, 286, railY + 23, "5 V") +
       block(286, railY, 150, "SERVO D5 + D6", "signal only → pins") +
       block(466, railY, 200, "SENSOR HEADS", "14.8 V from the packs, as wired") +
       block(696, railY, 284, "COMMON GROUND", "supply − · bucks − · heads blue · Uno GND") +
       '<line x1="70" y1="' + (railY + 70) + '" x2="980" y2="' + (railY + 70) + '" stroke="#39413F" stroke-width="3"/>' +
       '<text x="525" y="' + (railY + 66) + '" text-anchor="middle" font-size="9.5" fill="#5E7B77">every − lands on this rail — the Uno measures everything against it</text>' +
       '</g>';
  o += '</svg>';
  $("pwFlow").innerHTML = o;
  pwSig = "";
}

/* the panel's power question is answered for the build that is selected */
var PWR_Q = null, PWR_ANS = {};
function applyBuildAnswers(){
  if(!PWR_Q){
    for(var i = 0; i < QBANK.length; i++)
      if(/^How is it powered/.test(QBANK[i].q)){ PWR_Q = QBANK[i]; break; }
    if(!PWR_Q) return;
    PWR_ANS.all = {s:PWR_Q.s, a:PWR_Q.a};
    PWR_ANS.ac = {s:[["The full answer",
      "From a five volt, two amp adapter in the wall, into the USB port — five volts, which is all the board ever takes. There is no battery and no panel on this build. That is a deliberate scope decision, not an omission: it is meant to stand in a corridor where there is a socket. The servos have their own six volt, three amp supply, because two servos stalling would pull the board down through a shared five volt pin. Everything past the adapter is low voltage. The cost of the decision is that a brownout stops it mid cycle, and the waste sits on the closed gate until the power returns, which is safe but it is a stop. Adding a pack means adding a step down converter and a charger, and we would rather defend the machine we built than the one we sketched."],
     ["Shorter",
      "A five volt two amp adapter into the USB port, with a separate five volt three amp supply for the servos. No battery and no panel on this build, because it is a corridor machine with a socket. A brownout stops it mid cycle with the waste held on the closed gate."]],
      a:["A 5 V 2 A adapter into the USB port. No pack, no panel &mdash; say that it is a scope decision and name the trade.",
         "The servos are on their own 5 V 3 A supply. Sharing the Uno's 5 V pin is how a board resets mid-turn.",
         "Name the failure honestly: mains goes, the machine stops mid-cycle, the waste is held on the closed gate.",
         "If they push for a battery, the answer is the next build up: pack &rarr; fuse &rarr; BMS &rarr; buck set to 5.0 V &rarr; the board."]};
    PWR_ANS.battery = {s:[["The full answer",
      "From two battery holders of four 3.7 volt lithium ion cells each, so about fourteen point eight volts, in the compartment under the machine. The pack goes through a five amp fuse and its own protection board, then an LM2596 step down that we set to five point zero volts with a meter before connecting anything, and that five volts is what feeds the board. The servos run from a second step down, also five volts, three amps, so a stalling servo cannot pull the board down. Nothing charges the pack while it is on the machine: we take it off and charge it, and we bring a second one charged. On a full pack we measured about [your figure] of continuous use. As the pack sags the servos slow before the board browns out, so a slow platform is our low battery warning, and at three volts a cell the protection board cuts everything rather than damaging the pack."],
     ["Shorter",
      "Two holders of four 3.7 volt lithium ion cells, about fourteen point eight volts, through a fuse and a protection board into a step down set to five volts, which is what the board takes. The servos have their own five volt step down. Nothing charges it on the machine, so we swap in a charged pack. About [your figure] on a full pack, and a slow plate is the low battery warning."]],
      a:["Pack &rarr; 5 A fuse &rarr; BMS &rarr; LM2596 set to 5.0 V &rarr; the board. Never 14.8 V into VIN, and never 5 V into the barrel jack either.",
         "Servos on a second buck at 5 V 3 A &mdash; the reason the board does not reset mid-turn.",
         "Nothing charges it on the machine. Say that you swap packs, and know your runtime.",
         "A slow plate is the low-battery warning; the BMS cut at 3.0 V/cell is what stops the pack being damaged."]};
    PWR_ANS.solar = {s:[["The full answer",
      "From the sun, through the pack. An eighteen volt, twenty watt panel feeds a four cell charge controller, the controller charges the fourteen point eight volt pack, and the pack runs the machine through a step down set to five point zero volts. The panel never touches the Arduino. Its open circuit voltage is twenty two volts, which is past the board's absolute maximum, and its current collapses the moment a servo moves, so the pack is what smooths it and the controller is what protects the cells. There is no wall socket in this design. At night the panel gives nothing and it is simply a battery build until morning, so the number we had to size is the pack's run time against what the panel actually harvests in a day, and ours is [your figure]."],
     ["Shorter",
      "Panel to charge controller to pack, and the pack runs the machine through a step down at five volts. The panel never touches the board: twenty two volts open circuit is past its maximum and the current collapses when a servo moves. At night it is a battery build, so the pack has to carry the night."]],
      a:["Say the rule first: the panel charges the pack, the pack runs the machine. Never panel &rarr; board.",
         "Two numbers make it safe: Voc 22 V against the Uno's 20 V maximum, and the current collapse under servo load.",
         "Panel &rarr; 4S CC/CV controller &rarr; pack &rarr; buck at 5.0 V &rarr; the board. The controller is also the cell protection.",
         "Own the night: after dark it is a battery build. Have the pack runtime against the panel's daily harvest."]};
  }
  var v = PWR_ANS[POWER.build] || PWR_ANS.all;
  PWR_Q.s = v.s; PWR_Q.a = v.a;
  scriptSig = "\u0000"; hintSig = "\u0000";
}

/* ================== the prototype wiring sheet =========================
   Every element of the machine on one drawing: where it sits on the
   plywood, the cable it leaves on, the pin it lands on, and the two ways
   the whole thing can be fed — the adapter on the wall, or the packs
   through a changeover. It is drawn off whichever build the Power card is
   on, and every state on it — the pins, the lights, the gate, the plate,
   the reading, the display — is the running sketch's own, so the sheet
   and the machine can never drift apart.

   The changeover is the part worth arguing about in a defense. A hand
   switch is what is on the mast: you turn it, and the machine runs on
   what you turned it to. A relay does the same job by itself — its coil
   sits on the adapter, so while the adapter is in, the adapter has the
   machine; pull it out, the coil drops, and the contact falls back onto
   the pack. One is a decision you make, the other is a decision the
   machine makes, and they are wired differently: the relay brings both
   sources to 5 V first and picks between them, so the adapter no longer
   feeds the USB port at all.                                          */

var PT = {
  paper:"#F6F2E7", ink:"#16211F", ink2:"#4C5A56", ink3:"#8A948F", rule:"#C2BAA6",
  ply:"#E4C79B", plyD:"#C69C60", plyE:"#8C6A3C",
  steel:"#C7CED0", steelD:"#8A9295", dark:"#2B3134",
  red:"#E02020", blk:"#1A1A1A", brn:"#8B5A2B", blu:"#2E56C8", orn:"#E08A1E",
  sig:"#0D8B7F", uno:"#1B6CA8", unoD:"#0F4670",
  good:"#1C6E33", warn:"#B4820E", bad:"#B3282D", white:"#FFFFFF", off:"#D3D6D0"
};
var PT_W = 1400, PT_H = 1160;
var protoOpen = false, ptSig = "", ptBuiltFor = "";
var CHANGEOVER = "switch";                 /* "switch" — a knob; "relay" — a coil */

/* the relay is only a rig if there are two sources for it to pick between */
function relayRig(){ return CHANGEOVER === "relay" && has("ac") && has("pack"); }
function relayPick(){ return POWER.plugged ? "ac" : (has("solar") ? "solar" : "battery"); }

/* ---------- small drawing helpers ---------- */
function ptT(x, y, s, o){
  o = o || {};
  return '<text x="' + x + '" y="' + y + '"' + (o.id ? ' id="' + o.id + '"' : '') +
    ' font-family="' + (o.chak ? "Chakra Petch, sans-serif" : "IBM Plex Mono, monospace") + '"' +
    ' font-size="' + (o.s || 10.5) + '"' + (o.w ? ' font-weight="' + o.w + '"' : '') +
    (o.a ? ' text-anchor="' + o.a + '"' : '') + (o.ls ? ' letter-spacing="' + o.ls + '"' : '') +
    ' fill="' + (o.c || PT.ink2) + '">' + s + '</text>';
}
function ptR(x, y, w, h, f, st, o){
  o = o || {};
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' +
    (o.rx ? ' rx="' + o.rx + '"' : '') + ' fill="' + (f || "none") + '"' +
    (st ? ' stroke="' + st + '" stroke-width="' + (o.sw || 1.4) + '"' : '') +
    (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
    (o.id ? ' id="' + o.id + '"' : '') + (o.op ? ' opacity="' + o.op + '"' : '') + '/>';
}
function ptP(d, st, sw, o){
  o = o || {};
  return '<path d="' + d + '" fill="' + (o.fill || "none") + '"' +
    (st ? ' stroke="' + st + '" stroke-width="' + sw + '"' : '') +
    ' stroke-linecap="round" stroke-linejoin="round"' +
    (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') +
    (o.cls ? ' class="' + o.cls + '"' : '') +
    (o.id ? ' id="' + o.id + '"' : '') + (o.op ? ' opacity="' + o.op + '"' : '') + '/>';
}
function ptC(x, y, r, f, st, o){
  o = o || {};
  return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + (f || "none") + '"' +
    (st ? ' stroke="' + st + '" stroke-width="' + (o.sw || 1.4) + '"' : '') +
    (o.id ? ' id="' + o.id + '"' : '') + (o.op ? ' opacity="' + o.op + '"' : '') + '/>';
}
/* the balloon that ties a part of the drawing to a line of the schedule */
function ptBall(x, y, n){
  return ptC(x, y, 9.5, PT.paper, PT.sig, {sw:1.6}) +
         ptT(x, y + 3.6, n, {s:10.5, w:700, a:"middle", c:PT.sig});
}
/* a labelled block, the unit every power lane is built from */
function ptBlock(x, y, w, h, t1, t2, o){
  o = o || {};
  var s = ptR(x, y, w, h, o.fill || PT.white, o.stroke || PT.steelD, {rx:6, sw:o.sw || 1.6});
  s += ptT(x + w/2, y + (t2 ? h/2 - 1 : h/2 + 4), t1, {s:o.s || 11, w:700, a:"middle", c:o.tc || PT.ink});
  if(t2) s += ptT(x + w/2, y + h/2 + 12.5, t2, {s:9, a:"middle", c:PT.ink2, id:o.id2});
  return s;
}
/* plywood: an edge you can see the plies in */
function ptPly(x, y, w, h, o){
  o = o || {};
  var s = ptR(x, y, w, h, PT.ply, PT.plyE, {sw:1.3, rx:o.rx || 0});
  for(var i = 1; i * 4 < h; i++) s += ptP("M" + x + " " + (y + i*4) + " H" + (x + w), PT.plyD, 0.7, {op:".65"});
  return s;
}
/* an arrow head on a wire, so a drawing reads as a direction and not a web */
function ptArrow(x, y, dir, c){
  var d = dir === "left"  ? "M" + x + " " + y + " l7 -4.5 v9 z"
        : dir === "right" ? "M" + x + " " + y + " l-7 -4.5 v9 z"
        : dir === "up"    ? "M" + x + " " + y + " l-4.5 7 h9 z"
        :                   "M" + x + " " + y + " l-4.5 -7 h9 z";
  return ptP(d, "none", 0, {fill:c});
}

/* ---------- A · the machine, as built ----------
   A front elevation of the real thing, so every balloon on the schedule
   has somewhere on the plywood to point at. The bore, the two heads
   facing each other through the wall of the throat, the gate that is the
   floor of it, the plate under it and the post beside it are all where
   the walk-through and the side views put them.                       */
function ptMachine(){
  var pack = has("pack"), s = "";

  /* the room it stands in */
  s += ptP("M40 900 H470", PT.rule, 2);
  s += ptT(44, 914, "FLOOR", {s:8.5, c:PT.ink3, ls:"1"});
  s += ptT(96, 914, "the middle bin is the one parked under the hole", {s:8, c:PT.ink3});

  /* the mast, the module on it, and the box below that */
  s += ptR(396, 250, 18, 650, PT.steel, PT.steelD, {sw:1.2});
  if(pack){
    s += ptR(380, 322, 52, 50, "#E8EDEE", PT.steelD, {rx:4, sw:1.5});
    s += ptT(406, 342, "POWER", {s:8, w:700, a:"middle", c:PT.ink});
    s += ptT(406, 353, "MODULE", {s:8, w:700, a:"middle", c:PT.ink});
    s += ptT(380, 386, CHANGEOVER === "relay" ? "relay &middot; buck" : "selector &middot; buck",
             {s:8, c:PT.ink3});
    s += ptBall(368, 322, "13");
  }
  s += ptR(372, 470, 66, 140, "#FBFDFD", PT.steelD, {rx:5, sw:1.8});
  s += ptR(376, 486, 58, 118, "#DCEAF0", "#9FB6C2", {rx:3, sw:1, op:".8"});
  s += ptT(405, 464, "CONTROL BOX", {s:8.5, w:700, a:"middle", c:PT.ink});
  s += ptT(444, 540, "opened", {s:8, c:PT.sig});
  s += ptT(444, 551, "out as B", {s:8, c:PT.sig});
  s += ptBall(452, 476, "14");

  /* the hopper: the mouth, and the plywood cone under it */
  s += ptP("M138 160 L200 248 H272 L334 160 Z", PT.plyE, 1.3, {fill:PT.ply});
  s += ptP("M150 172 L206 240 M322 172 L266 240", PT.plyD, 0.8, {op:".7"});
  s += '<ellipse cx="236" cy="160" rx="98" ry="21" fill="' + PT.ply + '" stroke="' + PT.plyE + '" stroke-width="1.4"/>';
  s += '<ellipse cx="236" cy="160" rx="86" ry="15" fill="#2A312F"/>';
  s += '<ellipse cx="236" cy="158" rx="86" ry="15" fill="#3A4442"/>';
  s += ptP("M330 150 L352 144", PT.ink3, 0.9);
  s += ptT(356, 142, "INPUT HOLE", {s:9.5, w:700, c:PT.ink});
  s += ptT(356, 153, "&#216;184 mouth", {s:8.5, c:PT.ink3});
  s += ptT(356, 164, "a bucket, clamped", {s:8.5, c:PT.ink3});
  s += ptBall(346, 176, "1");

  /* the throat: two walls, and clear air between them */
  s += ptPly(200, 248, 12, 156);
  s += ptPly(260, 248, 12, 156);
  s += ptR(212, 248, 48, 156, "#EFEDE6", "none");
  s += ptP("M212 248 V404 M260 248 V404", PT.plyE, 1);

  /* stage 1 — the two heads, through the wall, facing each other */
  s += ptR(154, 296, 58, 24, PT.steel, PT.steelD, {rx:3, sw:1.4});
  s += ptR(204, 297, 8, 22, "#F2EFE2", "#B9B49C", {sw:1});
  s += ptT(148, 300, "CAPACITIVE", {s:9.5, w:700, a:"end", c:PT.ink});
  s += ptT(148, 311, "D3 &middot; NPN NO", {s:8.5, a:"end", c:PT.ink3});
  s += ptBall(140, 282, "2");
  s += ptR(260, 296, 58, 24, PT.steel, PT.steelD, {rx:3, sw:1.4});
  s += ptR(260, 297, 8, 22, "#D9A441", "#A87418", {sw:1});
  s += ptT(324, 300, "INDUCTIVE", {s:9.5, w:700, c:PT.ink});
  s += ptT(324, 311, "D4 &middot; metal only", {s:8.5, c:PT.ink3});
  s += ptBall(332, 282, "3");
  s += ptP("M214 308 H258", PT.ink3, 0.9);
  s += ptArrow(214, 308, "left", PT.ink3) + ptArrow(258, 308, "right", PT.ink3);
  s += ptT(236, 290, "128 mm", {s:8, a:"middle", c:PT.ink3});
  s += ptT(236, 334, "clear air", {s:8, a:"middle", c:PT.ink3});

  /* stage 2 — the infrared, looking across the face of the gate */
  s += ptR(164, 356, 48, 20, "#2B3134", "#11161A", {rx:3, sw:1.2});
  s += ptC(206, 366, 4, "#5B7BB4", "none");
  s += ptT(158, 352, "IR", {s:9.5, w:700, a:"end", c:PT.ink});
  s += ptT(158, 363, "D7", {s:8.5, a:"end", c:PT.ink3});
  s += ptBall(150, 336, "4");
  s += ptP("M214 366 H256", "#C7443A", 1.1, {dash:"4 4"});

  /* the gate — the floor of the hole — and the servo that swings it */
  s += '<g id="pt_gate" transform="rotate(0 212 404)">' +
       ptR(212, 400, 50, 8, PT.ply, PT.plyE, {rx:2, sw:1.2}) + '</g>';
  s += ptC(212, 404, 3.4, PT.steelD, "none");
  s += ptR(274, 384, 42, 38, PT.steel, PT.steelD, {rx:3, sw:1.5});
  s += ptR(280, 390, 30, 20, "#5E6668", "none", {rx:2});
  s += ptT(320, 394, "GATE", {s:9.5, w:700, c:PT.ink});
  s += ptT(320, 405, "SERVO D6", {s:8.5, c:PT.ink3});
  s += ptT(320, 416, "270&deg; &middot; the floor", {s:8, c:PT.ink3});
  s += ptBall(330, 376, "5");

  /* the chute down to whichever bin is parked */
  s += ptP("M212 404 L216 452 M260 404 L256 452", PT.plyE, 1.2, {dash:"5 4"});

  /* the post, the arm over the chute, and the one ultrasonic on it */
  s += ptR(76, 388, 16, 512, PT.steel, PT.steelD, {sw:1.2});
  s += ptR(84, 376, 116, 12, PT.steel, PT.steelD, {sw:1.2});
  s += ptR(196, 376, 38, 26, "#20272B", "#0E1416", {rx:3, sw:1.2});
  s += ptC(206, 390, 6.5, "#B9C0C2", "#6E787B", {sw:1}) + ptC(224, 390, 6.5, "#B9C0C2", "#6E787B", {sw:1});
  s += ptBall(44, 404, "7");
  s += ptT(70, 424, "HC-SR04", {s:9.5, w:700, a:"end", c:PT.ink});
  s += ptT(70, 435, "D8 &middot; D9", {s:8.5, a:"end", c:PT.ink3});
  s += ptP("M54 410 C92 418 150 410 194 398", PT.ink3, 0.9);

  /* the three bins, in the order the plate is holding them */
  [0, 1, 2].forEach(function(k){
    var x = 110 + k * 86;
    s += ptT(x + 40, 456, "&#8212;", {s:8.5, w:700, a:"middle", c:PT.ink2, id:"pt_binlbl" + k});
    s += ptP("M" + (x + 4) + " 462 H" + (x + 76) + " L" + (x + 69) + " 604 H" + (x + 11) + " Z",
             PT.steelD, 1.4, {fill:"#EDEFEA"});
    s += ptR(x + 12, 540, 56, 64, "#B9C0BA", "none", {id:"pt_fill" + k, op:"0"});
    s += ptR(x + 2, 458, 80, 8, "#CFD4CE", PT.steelD, {rx:2, sw:1.1, id:"pt_rim" + k});
  });
  s += ptBall(196, 442, "8");
  s += ptP("M215 404 V540", PT.sig, 1.4, {dash:"5 5", id:"pt_beam"});
  s += ptT(224, 434, "&#8212; cm", {s:9, w:700, c:PT.sig, id:"pt_dist"});

  /* the triangular plate, its rail, the castors and the fixed base */
  s += ptPly(104, 604, 264, 16);
  s += ptPly(104, 584, 12, 22, {rx:2});
  s += ptPly(356, 584, 12, 22, {rx:2});
  s += ptT(98, 598, "PLATE + RAIL", {s:8.5, w:700, a:"end", c:PT.ink});
  s += ptBall(90, 612, "9");
  s += ptC(150, 628, 7, PT.steel, PT.steelD, {sw:1.1});
  s += ptC(236, 628, 7, PT.steel, PT.steelD, {sw:1.1});
  s += ptC(322, 628, 7, PT.steel, PT.steelD, {sw:1.1});
  s += ptPly(100, 634, 268, 16);
  s += ptT(420, 622, "BASE PLATE", {s:8.5, w:700, c:PT.ink});
  s += ptT(420, 633, "+ 3 castors", {s:8, c:PT.ink3});
  s += ptBall(410, 654, "10");

  /* the servo that turns the plate, hung under the base plate */
  s += ptR(214, 654, 44, 46, PT.steel, PT.steelD, {rx:3, sw:1.5});
  s += ptR(220, 660, 32, 22, "#5E6668", "none", {rx:2});
  s += ptP("M236 650 V654", PT.steelD, 3);
  s += ptT(266, 666, "PLATE", {s:9.5, w:700, c:PT.ink});
  s += ptT(266, 677, "SERVO D5", {s:8.5, c:PT.ink3});
  s += ptT(266, 688, "0 &middot; 80 &middot; 165", {s:8, c:PT.ink3});
  s += ptBall(204, 646, "6");

  /* the support box under it: the door, the packs, and the one button */
  s += ptPly(118, 700, 244, 200, {rx:2});
  s += ptR(130, 716, 220, 172, "#EFE4CE", PT.plyE, {rx:2, sw:1.2, op:".55"});
  s += ptP("M340 802 h-8", PT.plyE, 3);
  s += ptT(112, 712, "SUPPORT BOX", {s:8.5, w:700, a:"end", c:PT.ink});
  s += ptBall(104, 726, "11");
  if(pack){
    s += ptR(142, 760, 96, 44, "#1A1F22", "#000", {rx:3, sw:1.2});
    s += ptR(248, 760, 96, 44, "#1A1F22", "#000", {rx:3, sw:1.2});
    [0, 1].forEach(function(b){
      for(var i = 0; i < 4; i++)
        s += ptR(148 + b*106, 766 + i*9, 84, 7, "#2E7BC4", "#123048", {rx:3, sw:0.8});
    });
    s += ptT(190, 818, "PACK A", {s:8.5, w:700, a:"middle", c:PT.ink});
    s += ptT(296, 818, "PACK B", {s:8.5, w:700, a:"middle", c:PT.ink});
    s += ptT(243, 836, "4S 18650 each &middot; 14.8 V", {s:8.5, a:"middle", c:PT.ink3});
    s += ptT(243, 850, "&#8212; V &middot; &#8212;%", {s:9.5, w:700, a:"middle", c:PT.ink, id:"pt_packV"});
  } else {
    s += ptT(243, 800, "no pack on this build", {s:9, a:"middle", c:PT.ink3});
  }
  s += ptC(330, 736, 11, "#C7CDC8", PT.steelD, {sw:1.4});
  s += ptC(330, 736, 7.5, "#E04B3E", "#9C2A20", {sw:1, id:"pt_btn"});
  s += ptT(346, 733, "D10", {s:9.5, w:700, c:PT.ink});
  s += ptT(346, 744, "INPUT_PULLUP", {s:7.5, c:PT.ink3});
  s += ptBall(310, 722, "12");

  /* ---- the loom: every core off the machine, zip-tied under the deck ---- */
  var loom = "M84 664 C84 652 90 646 100 646 H352 C366 646 378 640 380 626 V612";
  s += ptP(loom, "#AEB4B6", 13, {op:".9"});
  s += ptP(loom, "#8A9295", 1, {op:".7"});
  [140, 220, 300].forEach(function(t){ s += ptR(t, 640, 5, 13, "#5E6668", "none", {rx:1.5}); });
  s += ptT(104, 672, "LOOM &middot; ZIP-TIED", {s:8.5, w:700, c:PT.ink});
  s += ptT(104, 683, "every core, under the deck", {s:8, c:PT.ink3});
  s += ptBall(94, 656, "15");

  /* the cable off each element, into the loom */
  var stub = [
    ["M154 308 C132 308 126 330 126 400 C126 520 122 600 122 640", PT.blk],   /* D3 */
    ["M164 366 C146 366 142 400 142 470 C142 560 140 610 140 640", PT.blk],   /* D7 */
    ["M318 308 C340 308 348 340 348 430 C348 530 346 600 346 638", PT.blk],   /* D4 */
    ["M316 402 C338 402 358 420 360 470 C362 540 360 600 360 638", PT.orn],   /* D6 */
    ["M258 676 C286 676 316 668 330 656 C340 648 352 646 362 646", PT.orn],   /* D5 */
    ["M196 388 C150 388 112 388 104 396 C98 402 96 410 96 422 V636", PT.blk], /* D8/D9 */
    ["M330 725 C348 720 364 706 370 690 C374 676 374 662 376 650", PT.blk]    /* D10 */
  ];
  stub.forEach(function(w){ s += ptP(w[0], w[1], 2.2, {op:".9"}); });

  /* the pack leads, up the mast to the module */
  if(pack){
    s += ptP("M344 770 C368 770 380 752 384 726 V376", PT.red, 2.6);
    s += ptP("M344 782 C374 782 390 754 392 726 V376", PT.blk, 2.6);
    s += ptT(418, 420, "14.8 V", {s:8, c:PT.ink3});
  }

  /* the detail link: this box, opened out as B */
  s += ptR(368, 466, 74, 148, "none", PT.sig, {rx:6, sw:1.3, dash:"6 5"});
  s += ptP("M442 470 L512 140", PT.sig, 1, {dash:"6 5", op:".7"});
  s += ptP("M442 610 L512 792", PT.sig, 1, {dash:"6 5", op:".7"});
  return s;
}
/* ---------- B · inside the control box ----------
   The box on the mast, opened out. The loom arrives through the grommet
   on the left, the eight signal cores fan onto the header, and the four
   things that are actually in the box — the board, the display, the
   three lights and the buzzer — hang off it. Power comes up from the
   rails at the bottom of the sheet, which is where it comes from on the
   machine too.                                                        */
var PT_DPIN = {};                          /* where each digital pin sits on the header */
(function(){ for(var n = 0; n <= 13; n++) PT_DPIN["D" + n] = 598 + (13 - n) * 21; })();
var PT_APIN = {A0:762, A1:783, A2:804, A3:825, A4:846, A5:867};

function ptPin(x, y, lbl, below){
  return ptR(x - 6, y, 12, 18, "#20272B", "#0B1012", {rx:2, sw:0.8}) +
         ptC(x, y + 9, 3.4, "#CBD1D3", "none") +
         ptT(x, below ? y + 30 : y - 8, lbl, {s:8.5, w:700, a:"middle", c:"#DCE7EA"});
}
/* a wire that crosses another one hops over it, the way a drawing says so */
function ptHop(d, col, sw){
  return ptP(d, PT.paper, sw + 3.4) + ptP(d, col, sw);
}
function ptBox(){
  var s = "";

  /* the box itself, acrylic front */
  s += ptR(524, 130, 404, 730, "#FBFDFD", PT.steelD, {rx:10, sw:2});
  s += ptR(526, 132, 400, 15, "#DCEAF0", "#9FB6C2", {sw:0.8, op:".9"});
  s += ptT(536, 143, "ACRYLIC FRONT &middot; SHOWN WITH THE COVER OFF", {s:8.5, w:700, c:"#5D7C88"});

  /* the grommet the whole loom comes in through, and the split behind it */
  s += ptP("M498 336 H524", "#AEB4B6", 13, {op:".9"});
  s += ptR(516, 325, 16, 22, "#3A4448", "#11161A", {rx:4, sw:1});
  s += ptT(566, 296, "GROMMET", {s:8.5, w:700, c:PT.ink}) + ptT(566, 307, "15 cores", {s:8, c:PT.ink3});
  s += ptP("M524 336 H636 C644 336 648 330 648 322 V187", "#AEB4B6", 9, {op:".85"});
  s += ptP("M540 344 V852", "#AEB4B6", 9, {op:".85"});
  s += ptT(550, 848, "power cores &#8594; the rails below", {s:8, c:PT.ink3});

  /* the board */
  s += ptR(580, 340, 320, 240, PT.uno, PT.unoD, {rx:8, sw:1.6});
  s += ptR(588, 340, 304, 18, "#12303F", "#0A1D26", {rx:2, sw:0.8});
  s += ptR(588, 562, 304, 18, "#12303F", "#0A1D26", {rx:2, sw:0.8});
  s += ptT(740, 462, "ARDUINO UNO R3", {s:14, w:700, a:"middle", c:"#CFE4EE", chak:true});
  s += ptT(740, 480, "ATmega328P &middot; 5 V logic &middot; 20 V absolute maximum", {s:8.5, a:"middle", c:"#8FB3C4"});
  s += ptT(740, 502, "&#8212;", {s:11, w:700, a:"middle", c:"#8FE8D8", id:"pt_uno"});

  /* the two ways in, one of which is never used */
  s += ptR(562, 366, 22, 34, "#B4BEC1", "#6E787B", {rx:2, sw:1});
  s += ptT(596, 400, "USB", {s:9, w:700, c:"#CFE4EE"});
  s += ptT(596, 411, "&#8212;", {s:8, c:"#8FB3C4", id:"pt_usb"});
  s += ptR(562, 516, 22, 28, "#20272B", "#0B1012", {rx:3, sw:1});
  s += ptT(596, 524, "BARREL JACK", {s:9, w:700, c:"#FF9A90"});
  s += ptT(596, 535, "never used, on any build", {s:8, c:"#FF9A90"});
  s += ptP("M560 512 L588 548 M588 512 L560 548", PT.bad, 2.2);

  /* the eight signal cores, each on its own lane so none of them cross */
  var fan = [
    ["D10", 322, PT.blk, "button 12"],
    ["D9",  303, PT.blk, "echo 7"],
    ["D8",  284, PT.blk, "trig 7"],
    ["D7",  265, PT.blk, "IR 4"],
    ["D6",  246, PT.orn, "gate servo 5"],
    ["D5",  227, PT.orn, "plate servo 6"],
    ["D4",  208, PT.blk, "inductive 3"],
    ["D3",  189, PT.blk, "capacitive 2"]
  ];
  fan.forEach(function(f){
    var x = PT_DPIN[f[0]];
    s += ptP("M648 " + f[1] + " H" + x + " V340", f[2], 2);
    s += ptT(634, f[1] - 4, f[3], {s:7.5, a:"end", c:PT.ink2});
    s += ptPin(x, 340, f[0], true);
  });
  s += ptPin(PT_DPIN.D13, 340, "D13", true) + ptPin(PT_DPIN.D12, 340, "D12", true) +
       ptPin(PT_DPIN.D2, 340, "D2", true);
  s += ptPin(606, 562, "5V") + ptPin(627, 562, "GND");
  s += ptPin(PT_APIN.A3, 562, "A3") + ptPin(PT_APIN.A4, 562, "A4") + ptPin(PT_APIN.A5, 562, "A5");
  s += ptT(722, 554, "VIN &mdash; not used either", {s:8, a:"middle", c:"#8FB3C4"});

  /* the three lights and the buzzer — the rest of what is in the box */
  var leds = [{x:612, k:2, pin:"D13", n:"METAL"},
              {x:692, k:1, pin:"D2",  n:"PLASTIC"},
              {x:772, k:0, pin:"A3",  n:"BIO"}];
  leds.forEach(function(L){
    s += ptC(L.x, 640, 19, "none", PT.off, {sw:2.4, op:"0", id:"pt_ledg" + L.k});
    s += ptC(L.x, 640, 12, PT.off, PT.steelD, {sw:1.3, id:"pt_led" + L.k});
    s += ptR(L.x - 7, 658, 14, 16, "#D8CDB4", "#8C7B54", {rx:2, sw:1});
    s += ptP("M" + L.x + " 674 V700", PT.blk, 1.8);
    s += ptT(L.x + 12, 672, "220&#8486;", {s:7.5, c:PT.ink3});
    s += ptT(L.x, 620, L.pin + " &middot; " + L.n, {s:8.5, w:700, a:"middle", c:PT.ink});
  });
  s += ptC(856, 644, 26, "none", PT.bad, {sw:2.4, op:"0", id:"pt_buzzg"});
  s += ptC(856, 644, 18, "#20272B", "#0B1012", {sw:1.2, id:"pt_buzz"});
  s += ptC(856, 644, 6, "#4A5458", "none");
  s += ptT(856, 616, "D12 &middot; BUZZER", {s:8.5, w:700, a:"middle", c:PT.ink});
  s += ptP("M856 662 V700", PT.blk, 1.8);

  /* their pin wires: up the gutters, hopping the loom where they must */
  s += ptP("M612 628 V604 H530 V150 H" + PT_DPIN.D13 + " V340", PT.red, 1.8);
  s += ptHop("M856 626 V590 H908 V164 H" + PT_DPIN.D12 + " V340", PT.red, 1.8);
  s += ptP("M692 628 V596 H898 V176 H" + PT_DPIN.D2 + " V340", PT.red, 1.8);
  s += ptP("M772 628 V612 H" + PT_APIN.A3 + " V580", PT.red, 1.8);

  /* the 0 V bus every negative in the box lands on */
  s += ptP("M556 700 H904", PT.blk, 3.4);
  s += ptT(872, 694, "0 V BUS", {s:8, w:700, c:PT.ink});
  s += ptP("M627 700 V580", PT.blk, 1.8);

  /* the display on the front of the box */
  s += ptR(560, 720, 344, 92, "#2A3A34", "#16211F", {rx:5, sw:1.4});
  s += ptR(572, 730, 298, 62, "#1B4C3A", "#0C2A20", {rx:3, sw:1});
  s += ptT(582, 756, "&#8212;", {s:15, w:600, c:"#9CE8A8", id:"pt_lcd1", chak:true});
  s += ptT(582, 780, "&#8212;", {s:15, w:600, c:"#9CE8A8", id:"pt_lcd2", chak:true});
  s += ptR(884, 732, 16, 52, "#20272B", "#0B1012", {rx:2, sw:1});
  s += ptT(620, 716, "LCD 16&times;2 &middot; I&sup2;C AT 0x27", {s:8.5, w:700, c:PT.ink});
  s += ptP("M876 720 V700", PT.blk, 1.8);
  s += ptP("M856 720 V706 H566", PT.red, 1.8);
  s += ptP("M900 758 H918 V606 H" + PT_APIN.A4 + " V580", "#2E9E4B", 1.8);
  s += ptP("M900 770 H922 V602 H" + PT_APIN.A5 + " V580", "#C9900F", 1.8);
  s += ptT(928, 660, "SDA &#8594; A4", {s:8, c:"#2E9E4B"});
  s += ptT(928, 672, "SCL &#8594; A5", {s:8, c:"#C9900F"});

  /* power up from the rails, which is where it comes from on the machine too */
  s += ptP("M566 944 V608 H606 V580", PT.red, 2.4);
  s += ptP("M596 944 V700", PT.blk, 2.4);
  s += ptArrow(566, 946, "down", PT.red) + ptArrow(596, 946, "down", PT.blk);
  s += ptT(534, 900, "+5 V", {s:8, w:700, c:PT.red});
  s += ptT(604, 900, "0 V &mdash; both down to the rails", {s:8, w:700, c:PT.blk});
  return s;
}

/* ---------- C · how it is fed ----------
   The lanes the Power card already knows about, drawn as parts rather
   than blocks, and then the one decision this sheet is really about:
   what stands between the two sources and the board. A knob you turn,
   or a coil that turns it for you.                                    */
function ptFeed(){
  var b = BUILDS[POWER.build], s = "", rly = relayRig();
  /* where each source has to arrive, which is the only thing the two
     changeovers really disagree about                                  */
  var acTo   = rly ? "M1330 186 V404 H1080 V560 H1145" : "M1330 186 V404 H1006 V476 H1107";
  var packTo = rly ? "M1272 396 V440 H1120 V470 H1145" : "M1272 396 V440 H1090 V512 H1099";

  /* the wall, and the adapter on the end of it */
  if(b.has.ac){
    s += '<g id="pt_lane_ac" class="lane">';
    s += ptBlock(964, 140, 140, 46, "WALL SOCKET", "220 V AC");
    s += ptR(1116, 152, 34, 22, "#2B3134", "#0B1012", {rx:3, sw:1, id:"pt_plugbody"});
    s += ptP("M1104 158 H1116 M1104 168 H1116", "#C9CFD1", 2.4);
    s += ptP("M1150 163 H1180", PT.red, 2.4, {cls:"flow"});
    s += ptT(1133, 196, "&#8212;", {s:8, w:700, a:"middle", c:PT.ink3, id:"pt_plug"});
    s += ptBlock(1180, 140, 184, 46, "ADAPTER", "5 V &middot; 2 A regulated");
    s += ptHop(acTo, PT.red, 2.2).replace('stroke-width="2.2"', 'stroke-width="2.2" class="flow"');
    s += '</g>';
  }
  /* the panel, which charges the pack and touches nothing else */
  if(b.has.solar){
    s += '<g id="pt_lane_solar" class="lane">';
    s += ptBlock(964, 206, 140, 46, "PANEL", "18 V &middot; 20 W &middot; Voc 22 V");
    s += ptP("M1104 229 H1180", PT.red, 2.4, {cls:"flow"});
    s += ptBlock(1180, 206, 184, 46, "4S CHARGE CTRL", "CC/CV to 16.8 V");
    s += ptP("M1240 252 V270", PT.red, 2.4, {cls:"flow"}) + ptArrow(1240, 272, "down", PT.red);
    s += ptT(1250, 268, "charges the pack", {s:8, c:PT.ink3});
    s += '</g>';
  }
  /* the packs, the fuse, the protection board and the converter */
  if(b.has.pack){
    s += '<g id="pt_lane_battery" class="lane">';
    s += ptBlock(964, 276, 140, 56, "PACK A + B", "2 &times; 4S 18650");
    s += ptT(1034, 326, "&#8212;", {s:9, w:700, a:"middle", c:PT.ink, id:"pt_packV2"});
    s += ptP("M1104 304 H1128", PT.red, 2.4, {cls:"flow"});
    s += ptBlock(1128, 284, 68, 40, "5 A", "fuse", {s:10});
    s += ptP("M1196 304 H1224", PT.red, 2.4, {cls:"flow"});
    s += ptBlock(1224, 284, 140, 40, "BMS 4S", "3.0 V/cell cut", {s:10});
    s += ptP("M1294 324 V352", PT.red, 2.4, {cls:"flow"});
    s += ptT(1302, 344, "14.8 V", {s:8, c:PT.ink3});
    s += ptBlock(1180, 352, 184, 44, "LM2596 BUCK", "set to 5.00 V with a meter");
    s += ptP(packTo, PT.red, 2.2, {cls:"flow"});
    s += '</g>';
  }

  /* ---- the changeover: a knob, or a coil that turns it for you ---- */
  s += ptR(964, 414, 400, 196, "#FFFDF6", PT.sig, {rx:8, sw:1.6});
  s += ptT(976, 434, rly ? "CHANGEOVER &middot; SPDT RELAY" : "CHANGEOVER &middot; HAND SWITCH",
           {s:11, w:700, c:PT.sig, ls:"0.6"});
  s += ptT(976, 447, rly ? "the coil sits on the adapter, so the adapter wins while it is in"
                         : "one source at a time &mdash; you turn it, the machine does not",
           {s:8.5, c:PT.ink3});

  if(rly){
    /* the coil, its diode, the two contacts and the armature between them */
    s += ptR(990, 500, 66, 38, "#EDE7D6", PT.steelD, {rx:3, sw:1.4});
    for(var i = 0; i < 5; i++) s += ptP("M" + (996 + i*13) + " 500 V538", PT.steelD, 1.2);
    s += ptT(1023, 556, "COIL 5 V", {s:8.5, w:700, a:"middle", c:PT.ink});
    s += ptC(1023, 490, 5, PT.off, PT.steelD, {sw:1.2, id:"pt_coil"});
    s += ptP("M1080 510 H1056", PT.red, 2, {cls:"flow"});
    s += ptP("M990 519 H972 M964 512 V526 M967 516 V522", PT.blk, 1.8);
    s += ptP("M1068 500 V538", PT.ink2, 1.4);
    s += ptP("M1062 519 L1074 519 M1068 511 L1062 525 L1074 525 Z", PT.ink2, 1.4, {fill:PT.ink2});
    s += ptT(1090, 500, "1N4007", {s:8, c:PT.ink3});
    s += ptT(1090, 511, "flyback", {s:8, c:PT.ink3});
    s += ptC(1150, 470, 4.5, PT.white, PT.ink, {sw:1.6});
    s += ptC(1150, 560, 4.5, PT.white, PT.ink, {sw:1.6});
    s += ptC(1232, 515, 5, PT.ink, PT.ink, {sw:1.6});
    s += ptT(1160, 466, "NC &middot; PACK", {s:8.5, w:700, c:PT.ink});
    s += ptT(1160, 578, "NO &middot; ADAPTER", {s:8.5, w:700, c:PT.ink});
    s += ptT(1244, 505, "COM", {s:8.5, w:700, c:PT.ink});
    s += ptP("M1232 515 L1150 560", PT.ink, 2.8, {id:"pt_arm"});
    s += ptT(976, 574, "break before make &mdash; about 8 ms of nothing", {s:8, c:PT.ink3});
    /* the reservoir that carries the machine across the gap */
    s += ptP("M1232 515 H1300", PT.red, 2.6, {cls:"flow"});
    s += ptP("M1310 500 V530 M1320 500 V530", PT.red, 2.2);
    s += ptP("M1300 515 H1310 M1320 515 H1336 V560 H1290 V610", PT.red, 2.2, {cls:"flow"});
    s += ptT(1298, 490, "1000 &micro;F", {s:8, w:700, c:PT.ink});
    s += ptP("M1315 534 V552 M1308 552 H1322 M1311 556 H1319", PT.blk, 1.6);
  } else {
    /* the selector on the mast: three ways in, one way out */
    s += ptC(1160, 512, 40, "#EDE7D6", PT.steelD, {sw:1.8});
    s += ptC(1160, 512, 5, PT.ink, "none");
    s += ptC(1112, 476, 4.5, PT.white, PT.ink, {sw:1.6});
    s += ptC(1104, 512, 4.5, PT.white, PT.ink, {sw:1.6});
    s += ptC(1112, 548, 4.5, PT.white, PT.ink, {sw:1.6});
    s += ptT(1122, 466, b.has.ac ? "AC" : "&mdash;", {s:8.5, w:700, c:PT.ink});
    s += ptT(1096, 502, b.has.pack ? "PACK" : "&mdash;", {s:8.5, w:700, a:"end", c:PT.ink});
    s += ptT(1122, 566, b.has.solar ? "SOLAR" : "&mdash;", {s:8.5, w:700, c:PT.ink});
    s += ptP("M1160 512 L1112 476", PT.ink, 3, {id:"pt_arm"});
    s += ptT(1230, 578, "the others stay connected", {s:8, a:"middle", c:PT.ink3});
    s += ptP("M1200 512 H1290 V610", PT.red, 2.6, {cls:"flow"});
  }
  s += ptT(976, 596, "&#8212;", {s:9, w:700, c:PT.ink, id:"pt_relayState"});

  /* the two supplies that never touch the board */
  var sv = b.has.pack ? ["BUCK #2", "5 V &middot; 3 A off the pack"] : ["PSU #2", "5 V &middot; 3 A second adapter"];
  s += ptBlock(964, 626, 192, 46, sv[0], sv[1], {s:10});
  s += ptBlock(1172, 626, 192, 46, b.has.pack ? "HEAD SUPPLY" : "HEAD SUPPLY &mdash; MISSING",
               b.has.pack ? "14.8 V straight off the pack" : "nothing here gives 6&ndash;36 V",
               {s:10, stroke:b.has.pack ? PT.steelD : PT.bad, tc:b.has.pack ? PT.ink : PT.bad});
  s += ptBall(958, 612, "16");

  /* down the gutter between the box and this column, into the rails */
  s += ptP("M1290 610 V620 H932 V1000 H920", PT.red, 2.4, {cls:"flow"});
  s += ptT(928, 706, "board", {s:8, w:700, a:"end", c:PT.red});
  s += ptP("M964 649 H938 V1032 H920", PT.red, 2.2);
  s += ptT(934, 760, "servos", {s:8, w:700, a:"end", c:PT.red});
  if(b.has.pack){
    s += ptP("M1268 672 V678 H944 V1072 H920", PT.brn, 2.2);
    s += ptT(940, 812, "heads", {s:8, w:700, a:"end", c:PT.brn});
  }
  s += ptP("M1060 672 V686 H950 V1116 H920", PT.blk, 2.2, {op:".85"});
  s += ptT(946, 864, "0 V", {s:8, w:700, a:"end", c:PT.blk});

  /* what to check on your own machine, which is not the same as ours */
  var note = [];
  if(!b.has.pack) note.push(["The heads have no supply on this build.",
    "3-wire proximity heads of this class want 6&ndash;36 V and nothing here gives it. Either add a 12 V adapter beside the 5 V one, or use heads that run on 5 V."]);
  if(rly) note.push(["The relay changes where 5 V goes in.",
    "Both sources are brought to 5 V first and the relay picks one into the 5 V pin, so the adapter no longer feeds the USB port at all."]);
  if(rly) note.push(["Break before make, so keep the reservoir.",
    "The contact is open for a few milliseconds on the way over. Without the 1000 &micro;F the board resets on every handover."]);
  if(!rly && b.has.ac && b.has.pack) note.push(["The knob is a person, not a machine.",
    "Nothing hands over on its own here. Pull the adapter with the knob on AC and the machine stops &mdash; that is the case for the relay."]);
  note.push(["Set the buck before it is ever connected.",
    "Meter on the output, nothing else attached, turn the pot to 5.00 V. The 5 V pin bypasses the regulator and the protection diode both."]);
  note.push(["One ground, and a head's brown never goes near a pin.",
    "Only the black signal core off each head lands on the board. 14.8 V into an input destroys the port."]);
  s += ptR(964, 692, 300, 244, "#FFFDF6", PT.rule, {rx:8, sw:1.4});
  s += ptT(976, 712, "CHECK THESE ON YOUR OWN MACHINE", {s:9.5, w:700, c:PT.warn, ls:"1"});
  var y = 734;
  note.slice(0, 5).forEach(function(n){
    s += ptT(976, y, "&#9679; " + n[0], {s:8.5, w:700, c:PT.ink});
    var words = n[1].split(" "), line = "", lines = [];
    words.forEach(function(w){
      if((line + " " + w).length > 48){ lines.push(line); line = w; } else line = line ? line + " " + w : w;
    });
    lines.push(line);
    lines.forEach(function(L, i){ s += ptT(986, y + 11 + i*10, L, {s:8, c:PT.ink2}); });
    y += 22 + lines.length * 10;
  });
  return s;
}
/* ---------- D · the rails, and the legend beside them ----------
   Every consumer on the machine hangs off one of four rails, and the
   fourth one is the reason any of the others mean anything.           */
function ptRails(){
  var b = BUILDS[POWER.build], s = "";
  var rails = [
    {y:1000, c:PT.red, sw:3.4, n:"+5 V &middot; BOARD",
     t:["Uno 5 V pin", "HC-SR04 VCC", "LCD VCC"].concat(relayRig() ? ["relay coil"] : [])},
    {y:1032, c:PT.red, sw:3.4, n:"+5 V &middot; SERVOS &middot; 3 A",
     t:["D5 servo red", "D6 servo red"]},
    {y:1072, c:PT.brn, sw:3.4, n:"+14.8 V &middot; HEADS",
     t:b.has.pack ? ["D3 brown", "D4 brown", "D7 brown"] : ["nothing feeds this on this build"]},
    {y:1116, c:PT.blk, sw:5, n:"0 V &middot; COMMON GROUND",
     t:["pack &minus;", "buck 1 &minus;", "buck 2 &minus;", "heads blue", "servos brown",
        "LCD GND", "LEDs via 220&#8486;", "buzzer &minus;", "D10 button", "Uno GND"]}
  ];
  rails.forEach(function(r){
    s += ptP("M310 " + r.y + " H920", r.c, r.sw);
    s += ptT(304, r.y + 3.5, r.n, {s:9.5, w:700, a:"end", c:PT.ink});
    var step = 610 / r.t.length;
    r.t.forEach(function(t, i){
      var x = 310 + step * (i + 0.5);
      s += ptP("M" + x + " " + r.y + " V" + (r.y + 8), r.c, 1.6);
      s += ptT(x, r.y + 19, t, {s:8, a:"middle", c:PT.ink2});
    });
  });
  s += ptT(310, 972, "D &middot; THE RAILS &mdash; what every element on the machine actually hangs off",
           {s:10.5, w:700, c:PT.ink, ls:"0.4"});

  /* the colours, which are the whole of the convention */
  s += ptR(24, 958, 168, 194, "#FFFDF6", PT.rule, {rx:8, sw:1.4});
  s += ptT(36, 976, "WIRE COLOURS", {s:9.5, w:700, c:PT.sig, ls:"1"});
  var leg = [[PT.red, "+5 V"], [PT.blk, "0 V &middot; signal core"], [PT.brn, "+14.8 V to a head"],
             [PT.blu, "0 V at a head"], [PT.orn, "servo signal"], ["#2E9E4B", "SDA"], ["#C9900F", "SCL"]];
  leg.forEach(function(L, i){
    s += ptR(36, 990 + i*20, 26, 4, L[0], "none", {rx:2});
    s += ptT(70, 995 + i*20, L[1], {s:8.5, c:PT.ink2});
  });
  s += ptT(36, 1140, "a hop = one wire over another", {s:8, c:PT.ink3});
  return s;
}

/* ---------- the title block, the way a drawing carries its own state ---------- */
function ptTitleBlock(){
  var s = ptR(1012, 958, 364, 194, "#FFFDF6", PT.ink, {rx:8, sw:1.8});
  s += ptP("M1012 996 H1376 M1012 1030 H1376 M1012 1064 H1376 M1012 1098 H1376", PT.rule, 1.1);
  s += ptT(1024, 982, "ENVIROSORTPRO &mdash; PROTOTYPE WIRING", {s:11.5, w:700, c:PT.ink, ls:"0.6"});
  var row = function(y, k, v, id){
    return ptT(1024, y, k, {s:8.5, w:700, c:PT.ink3, ls:"1"}) +
           ptT(1112, y, v, {s:9.5, w:700, c:PT.ink, id:id});
  };
  s += row(1018, "BUILD", "&#8212;", "pt_tbBuild");
  s += row(1052, "FED BY", "&#8212;", "pt_tbSrc");
  s += row(1086, "CHANGEOVER", "&#8212;", "pt_tbChg");
  s += ptT(1024, 1116, "DRAWN OFF", {s:8.5, w:700, c:PT.ink3, ls:"1"});
  s += ptT(1112, 1116, "EnviroSortPro.ino &mdash; states are live", {s:9, c:PT.ink});
  s += ptT(1024, 1140, "Not an approved drawing &mdash; check every value against your own parts.",
           {s:8, c:PT.bad});
  return s;
}

/* ---------- the sheet ---------- */
function buildProto(){
  if(!$("ptSheet")) return;
  var b = BUILDS[POWER.build];
  var o = '<svg viewBox="0 0 ' + PT_W + ' ' + PT_H + '" role="img" aria-label="Prototype wiring sheet: ' +
          'every element of the machine, the pin it lands on, and how it is fed on the ' + b.name +
          ' build" font-family="IBM Plex Mono, monospace">';
  o += ptR(0, 0, PT_W, PT_H, PT.paper, "none");
  o += ptR(10, 10, PT_W - 20, PT_H - 20, "none", PT.rule, {sw:2});
  o += ptR(18, 18, PT_W - 36, PT_H - 36, "none", PT.rule, {sw:0.8});

  o += ptT(32, 52, "PROTOTYPE WIRING &mdash; EVERY ELEMENT", {s:19, w:700, c:PT.ink, chak:true});
  o += ptT(32, 68, "where each part sits on the plywood &middot; the core it leaves on &middot; the pin it lands on &middot; and what is feeding all of it",
           {s:9.5, c:PT.ink2});
  o += ptT(1368, 52, "&#8212;", {s:12, w:700, a:"end", c:PT.sig, id:"pt_hdr"});
  o += ptT(1368, 68, "the lit lane is the one running", {s:9, a:"end", c:PT.ink3});
  o += ptP("M18 78 H1382", PT.rule, 1);

  o += ptR(24, 96, 476, 852, "none", PT.rule, {rx:8, sw:1.2});
  o += ptR(512, 96, 428, 852, "none", PT.rule, {rx:8, sw:1.2});
  o += ptR(952, 96, 424, 852, "none", PT.rule, {rx:8, sw:1.2});
  o += ptT(36, 112, "A &middot; THE MACHINE, AS BUILT", {s:11, w:700, c:PT.sig, ls:"0.8"});
  o += ptT(524, 112, "B &middot; INSIDE THE CONTROL BOX", {s:11, w:700, c:PT.sig, ls:"0.8"});
  o += ptT(964, 112, "C &middot; HOW IT IS FED", {s:11, w:700, c:PT.sig, ls:"0.8"});

  o += ptMachine() + ptBox() + ptFeed();
  o += '<g id="pt_lane_rail" class="lane on">' + ptRails() + '</g>';
  o += ptTitleBlock();
  o += '</svg>';
  $("ptSheet").innerHTML = o;
  ptSig = "";
  ptBuiltFor = POWER.build + "|" + CHANGEOVER;
  buildProtoRows();
  paintProto();
}

/* ---------- the schedule under the drawing ---------- */
var PT_ROWS = [
  [1,  "Input hole", "top of the hopper, clamped to the mast", "&mdash;", null,
   "The mouth is a paint bucket &#216;184&nbsp;mm across, narrowing into the throat. Nothing hangs in the middle of it &mdash; every head comes through the wall, and the two stage-1 faces are 128&nbsp;mm apart across the bore."],
  [2,  "Capacitive head", "through the left wall of the throat", "D3", "blk",
   "3-wire NPN, normally open. Reads LOW on plastic, and on metal too if it is close. Brown +14.8&nbsp;V, blue 0&nbsp;V, black to the pin.", "d3"],
  [3,  "Inductive head", "right wall, facing it across 128 mm", "D4", "blk",
   "Metal only, and tested first in the sketch, so it wins over the capacitive head. Same three cores.", "d4"],
  [4,  "IR obstacle module", "throat wall, looking across the gate", "D7", "blk",
   "Says <i>something is there</i> and nothing more. Anything it sees that stage 1 did not name is called bio.", "d7"],
  [5,  "Gate servo &middot; tap_servo1", "under the throat &mdash; the flap is the floor of it", "D6", "orn",
   "270&deg; metal-gear digital. 180 shut, 0 open. Signal to D6 only; its red goes to the servo rail.", "gate"],
  [6,  "Plate servo &middot; tap_servo", "under the base plate, on the axis", "D5", "orn",
   "Same servo. 90 home, 80 metal, 165 plastic, 0 bio &mdash; and 165 &times; 1.5 is 247.5&deg;, which is why it cannot be an SG90.", "plate"],
  [7,  "HC-SR04", "on the post, arm over the chute", "D8 trig / D9 echo", "blk",
   "5 V part, so it sits on the board rail, not the head rail. 50 cm empty, 7 cm a drop, &le;20 cm is full."],
  [8,  "The three bins", "on the plate, corner to corner", "&mdash;", null,
   "Only the one parked under the hole is ever measured. That is finding 2, and it is a wiring-free problem."],
  [9,  "Triangular plate + rail", "on the castors, over the base plate", "&mdash;", null,
   "12 mm plywood. The rail runs all three edges so nothing tips off while it spins."],
  [10, "Base plate + 3 castors", "fixed, between the frame and the plate", "&mdash;", null,
   "The castors carry the weight so the servo only has to turn it, not hold it up."],
  [11, "Support box + packs", "under the deck, behind the door", "&mdash;", null,
   "Two 4S 18650 holders, about 14.8 V, clipped down rather than loose. Only on a build that has a pack."],
  [12, "Push button", "on the front of the support box", "D10", "blk",
   "INPUT_PULLUP, so it is wired to 0 V and nothing else. No resistor. Reads LOW when it is pushed.", "btn"],
  [13, "Power module", "on the mast, above the box", "&mdash;", null,
   "Fuse, BMS, converter and the changeover. Everything above 5 V stops here."],
  [14, "Control box", "strapped to the mast", "&mdash;", null,
   "Acrylic front, every lead in through a grommet, leads zip-tied under the throat. Detail B."],
  [15, "LCD 16&times;2", "on the front of the box", "A4 SDA / A5 SCL", "grn",
   "I&sup2;C backpack at 0x27, so two wires instead of six. <code>resetServosAndLCD()</code> calls <code>lcd.init()</code> every time it runs &mdash; which is every idle pass of <code>loop()</code>, twice a second."],
  [16, "LED &middot; plastic", "on the box", "D2", "red",
   "Through 220 &#8486; to 0 V. Lit alone on a plastic sort, and with the other two during the alarm.", "led1"],
  [17, "LED &middot; metal", "on the box", "D13", "red",
   "D13 also drives the Uno's own on-board LED &mdash; the two are the same pin, and a panel may notice.", "led2"],
  [18, "LED &middot; bio", "on the box", "A3", "red",
   "An analog pin used as a plain digital output, which is legal and deliberate: the digital ones were full.", "led0"],
  [19, "Buzzer", "on the box", "D12", "red",
   "Steady tone, not a pattern &mdash; the sketch has no tone() and no timer. Three lights and a tone is the alarm.", "buzz"],
  [20, "The loom", "down the mast, zip-tied under the deck", "&mdash;", null,
   "15 cores: 8 signals (D3 D4 D5 D6 D7 D8 D9 D10), the heads&rsquo; 14.8&nbsp;V pair, the servos&rsquo; 5&nbsp;V pair, the HC-SR04&rsquo;s own 5&nbsp;V pair, and the button&rsquo;s return to 0&nbsp;V."],
  [21, "Power into the board", "the 5 V pin, or the USB port", "5V / GND", "red",
   "Never the barrel jack. 5 V through the jack leaves the board at about 4 V, and 14.8 V through it cooks the regulator."]
];
function buildProtoRows(){
  var sw = {red:PT.red, blk:PT.blk, brn:PT.brn, orn:PT.orn, grn:"#2E9E4B"};
  var h = "";
  PT_ROWS.forEach(function(r){
    h += '<tr id="ptRow' + r[0] + '">' +
         '<td class="n">' + r[0] + '</td>' +
         '<td class="el">' + r[1] + '</td>' +
         '<td>' + r[2] + '</td>' +
         '<td class="pin">' + r[3] + '</td>' +
         '<td class="w">' + (r[4] ? '<span class="sw" style="background:' + sw[r[4]] + '"></span>' : "") +
           (r[4] ? (r[4] === "orn" ? "signal" : r[4] === "grn" ? "I&sup2;C" : r[4] === "brn" ? "brown" : r[4] === "red" ? "+5 V" : "black") : "&mdash;") + '</td>' +
         '<td>' + r[5] + '</td></tr>';
  });
  $("ptRows").innerHTML = h;
}

/* ---------- the states on the sheet are the running sketch's own ---------- */
function ptSet(id, t){ var e = $(id); if(e && e.innerHTML !== t) e.innerHTML = t; }
function ptA(id, k, v){ var e = $(id); if(e) e.setAttribute(k, String(v)); }
function paintProto(){
  if(!protoOpen || !$("ptSheet")) return;
  if(ptBuiltFor !== POWER.build + "|" + CHANGEOVER){ buildProto(); return; }
  var b = BUILDS[POWER.build], src = POWER.src, on = W.mains, rly = relayRig();
  var fb = frontBin(), d3 = digitalReadPin(1), d4 = digitalReadPin(0), d7 = digitalReadPin(2);
  var moving = Math.abs(W.rotVal * 1.5 - W.R) > 0.5;
  var sig = [W.leds.join(""), W.buzzer, W.lcd1, W.lcd2, W.rotVal, W.gateVal, Math.round(W.R),
             Math.round(W.gate), Math.round(W.distance), fb, W.level.map(Math.round).join(","),
             W.buttonDown, on, src, POWER.plugged, Math.round(POWER.soc * 100),
             d3, d4, d7, moving, CHANGEOVER, DISP_MODE, disposal.phase].join("|");
  if(sig === ptSig) return;
  ptSig = sig;

  /* the board, and the two ways in */
  ptSet("pt_uno", on ? "RUNNING" : "NO 5 V AT THE PIN");
  ptA("pt_uno", "fill", on ? "#8FE8D8" : "#FF9A90");
  ptSet("pt_usb", rly ? "not used &#8212; the relay feeds the pin"
       : (src === "ac" && !b.has.pack) ? "5 V &middot; 2 A in"
       : (src === "ac") ? "not used &#8212; module to the pin" : "not used on this build");

  /* the lights, the buzzer, the display */
  [0, 1, 2].forEach(function(k){
    ptA("pt_led" + k, "fill", W.leds[k] ? BINS[k].col : PT.off);
    ptA("pt_ledg" + k, "stroke", BINS[k].col);
    ptA("pt_ledg" + k, "opacity", W.leds[k] ? "0.55" : "0");
  });
  ptA("pt_buzz", "fill", W.buzzer ? "#5A2320" : "#20272B");
  ptA("pt_buzzg", "opacity", W.buzzer ? "0.7" : "0");
  ptSet("pt_lcd1", on ? nbsp(W.lcd1) : "");
  ptSet("pt_lcd2", on ? nbsp(W.lcd2) : "");

  /* the gate, the plate, the beam and what it is reading */
  ptA("pt_gate", "transform", "rotate(" + W.gate.toFixed(1) + " 212 404)");
  var lvl = fb >= 0 && !binAway(fb) ? W.level[fb] : 0;
  var top = fb < 0 || binAway(fb) ? 646 : 604 - lvl / 100 * 136;
  ptA("pt_beam", "d", "M215 404 V" + top.toFixed(0));
  ptSet("pt_dist", Math.round(W.distance) + " cm");
  ptA("pt_dist", "fill", W.distance <= US_TRIP_CM ? PT.bad : PT.sig);

  /* the three bins, in the order the plate is holding them */
  var order = BINS.map(function(B, i){
    var d = ((B.A - W.R) % 360 + 540) % 360 - 180;
    return {i:i, d:d};
  }).sort(function(a, c){ return a.d - c.d; });
  order.forEach(function(o, k){
    var B = BINS[o.i], away = binAway(o.i), h = away ? 0 : W.level[o.i] / 100 * 136;
    ptA("pt_rim" + k, "fill", away ? "#E4E7E2" : B.col);
    ptA("pt_fill" + k, "y", 604 - h);
    ptA("pt_fill" + k, "height", h);
    ptA("pt_fill" + k, "opacity", h > 0 ? "1" : "0");
    ptA("pt_fill" + k, "fill", B.waste);
    ptSet("pt_binlbl" + k, away ? B.key.toUpperCase() + " &#183; OFF" : B.key.toUpperCase());
  });

  /* the button, and the pack behind the door */
  ptA("pt_btn", "fill", W.buttonDown ? "#8E2018" : "#E04B3E");
  ptA("pt_btn", "r", W.buttonDown ? 6 : 7.5);
  var pct = Math.round(POWER.soc * 100);
  if(b.has.pack){
    ptSet("pt_packV", POWER.v.toFixed(1) + " V &middot; " + pct + "%");
    ptA("pt_packV", "fill", POWER.cut ? PT.bad : POWER.soc < 0.35 ? PT.warn : PT.ink);
    ptSet("pt_packV2", POWER.v.toFixed(1) + " V &middot; " + pct + "%" + (POWER.cut ? " &middot; CUT" : ""));
  }

  /* the changeover, doing what it does */
  ptSet("pt_plug", POWER.plugged ? "in the wall" : "PULLED OUT");
  ptA("pt_plug", "fill", POWER.plugged ? PT.ink3 : PT.bad);
  ptA("pt_plugbody", "x", POWER.plugged ? 1116 : 1096);
  if(rly){
    ptA("pt_coil", "fill", POWER.plugged ? "#4BC969" : PT.off);
    ptA("pt_arm", "d", POWER.plugged ? "M1232 515 L1150 560" : "M1232 515 L1150 470");
    ptSet("pt_relayState", POWER.plugged
      ? "COIL ENERGISED &mdash; the adapter has the machine, the pack waits on NC"
      : "COIL DROPPED OUT &mdash; the pack took it over, and the sketch never noticed");
    ptA("pt_relayState", "fill", POWER.plugged ? PT.good : PT.warn);
  } else {
    var pad = src === "ac" ? "L1112 476" : src === "solar" ? "L1112 548" : "L1104 512";
    ptA("pt_arm", "d", "M1160 512 " + pad);
    ptSet("pt_relayState", "SET TO " + POWER_NAME[src].toUpperCase() +
      (POWER.build === "all" ? " &mdash; by hand, and it will not change itself" : ""));
    ptA("pt_relayState", "fill", PT.ink);
  }

  /* which lane is actually carrying it */
  ["ac", "battery", "solar"].forEach(function(k){
    var lane = $("pt_lane_" + k); if(!lane) return;
    var live = (k === src) || (src === "solar" && k === "battery");
    lane.setAttribute("class", "lane" + (live ? " on" : "") + (live && !on ? " down" : ""));
  });
  var rail = $("pt_lane_rail"); if(rail) rail.setAttribute("class", "lane" + (on ? " on" : ""));

  /* the title block carries the state, the way a drawing should */
  ptSet("pt_hdr", (POWER.build === "all" ? "SWITCHABLE RIG" : b.name.toUpperCase()) +
        " &middot; " + (on ? POWER_NAME[src].toUpperCase() : "DOWN"));
  ptSet("pt_tbBuild", b.name);
  ptSet("pt_tbSrc", src === "ac" ? (POWER.plugged ? "the adapter, 5 V 2 A" : "nothing &mdash; the adapter is out")
        : POWER.v.toFixed(1) + " V pack &middot; " + pct + "%" + (POWER.cut ? " &middot; BMS cut" : ""));
  ptSet("pt_tbChg", rly ? "SPDT relay &mdash; automatic" :
        (b.has.ac && b.has.pack) ? "hand switch &mdash; you turn it" : "single source &mdash; nothing to change over");

  /* and the schedule says which lines are doing something right now */
  var lit = {d3:d3 === LOW, d4:d4 === LOW, d7:d7 === LOW, gate:W.gate > 1, plate:moving,
             btn:W.buttonDown, buzz:W.buzzer, led0:W.leds[0], led1:W.leds[1], led2:W.leds[2]};
  PT_ROWS.forEach(function(r){
    if(!r[6]) return;
    var tr = $("ptRow" + r[0]);
    if(tr) tr.className = lit[r[6]] ? "live" : "";
  });
  $("ptTag").textContent = b.name + " · " + (rly ? "battery relay" : "hand switch");
}

/* ---------- opening it, and the one control on it ---------- */
function setProtoCard(on){
  protoOpen = on;
  $("protoCard").style.display = on ? "" : "none";
  $("protoBtn").setAttribute("aria-pressed", String(on));
  $("protoBtn").textContent = "Prototype wiring: " + (on ? "on" : "off");
  if(on){
    if(ptBuiltFor !== POWER.build + "|" + CHANGEOVER) buildProto(); else paintProto();
    $("protoCard").scrollIntoView({behavior:"smooth", block:"nearest"});
  }
}
function setChangeover(m){
  if(m !== "relay" && m !== "switch") return;
  CHANGEOVER = m;
  if(relayRig()) POWER.src = relayPick();
  syncChangeover();
  stepPower(0);
  paintPower();
}
/* the buttons, the note under them and the sheet, brought back into line
   with whatever the build and the changeover now are                    */
function syncChangeover(){
  if(!$("ptChg")) return;
  Array.prototype.forEach.call(document.querySelectorAll("#ptChg [data-chg]"), function(n){
    n.setAttribute("aria-pressed", String(n.getAttribute("data-chg") === CHANGEOVER));
    n.disabled = false;
  });
  $("ptChgNote").innerHTML = relayRig()
    ? "The coil is across the adapter, so while the adapter is in, the adapter has the machine. Pull it out and the contact falls back onto the pack on its own &mdash; try it with <b>Pull the adapter out</b> on the Power card and watch the plate keep turning. Both sources are brought to 5&nbsp;V first and the relay picks one into the 5&nbsp;V pin, so the USB port is no longer feeding anything."
    : (has("ac") && has("pack"))
      ? "The selector on the mast, turned by hand. One source at a time, the others still connected as backup &mdash; and nothing hands over on its own, so pulling the adapter with the knob on AC stops the machine mid-cycle. That is the argument for the relay."
      : "This build has only one source, so there is nothing to change over &mdash; the changeover on the sheet is drawn for the record and does nothing. Pick <b>All three, switchable</b> on the Power card to see it wired both ways.";
  buildProto();
}

/* ---------- wiring ---------- */
document.querySelectorAll("#pwBuilds [data-build]").forEach(function(b){
  b.addEventListener("click", function(){ setBuild(this.getAttribute("data-build")); });
});
$("powerBtn").addEventListener("click", function(){ setPowerCard(!powerOpen); });
document.querySelectorAll(".pw-src [data-src]").forEach(function(b){
  b.addEventListener("click", function(){ setPower(this.getAttribute("data-src")); });
});
$("pwSun").addEventListener("input", function(){
  POWER.sun = parseInt(this.value, 10) / 100;
  paintPower();
});
$("pwPlug").addEventListener("click", function(){ POWER.plugged = !POWER.plugged; stepPower(0); paintPower(); });
$("pwDrain").addEventListener("click", function(){ POWER.soc = 0.10; POWER.cut = false; stepPower(0); paintPower(); });
$("pwFill").addEventListener("click", function(){ POWER.soc = 1; POWER.cut = false; stepPower(0); paintPower(); });
$("protoBtn").addEventListener("click", function(){ setProtoCard(!protoOpen); });
document.querySelectorAll("#ptChg [data-chg]").forEach(function(b){
  b.addEventListener("click", function(){ setChangeover(this.getAttribute("data-chg")); });
});
setBuild(POWER.build);                 /* draws the flow, the sheet, the scene and the answers */

/* ============================ interaction ============================ */
/* "present" holds the waste on the stage-1 line until the tap opens; "drop"
   lets it fall straight past stage 1 onto the tap, where only the IR sees it. */
var MODES = ["auto", "present", "drop"];
var MODE_LABEL = {
  auto:    "How it goes in: correct technique",
  present: "How it goes in: present to sensors",
  drop:    "How it goes in: drop straight in"
};
var insertMode = "auto";
function methodFor(kind){
  if(insertMode !== "auto") return insertMode;
  var c = KIND[kind].cls;
  return (c === "plastic" || c === "metal") ? "present" : "drop";
}

function drop(kind, from, idx){
  if(item) return;
  var method = methodFor(kind);
  item = {kind:kind, x:from.x, y:from.y, q:[], cur:null, falling:false, held:false,
          heldAt:0, carried:false, onBelt:true, retrieving:false,
          idx:idx, homeX:from.x, homeY:from.y, stuckAt:0};
  W.itemKind = kind;
  takenIdx = idx;
  beltBoost = Date.now() + 500;
  $("itemG").innerHTML = '<circle r="30" fill="transparent"/>' +
                          '<g transform="scale(1.15)">' + shapeOf(kind) + '</g>';
  $("itemG").setAttribute("opacity", "1");
  $("itemG").setAttribute("transform", "translate(" + from.x + "," + from.y + ")");
  /* the belt carries it to the head end */
  item.q.push({to:{x:BELT.out, y:from.y}, ctrl:null,
               dur:Math.max(320, (BELT.out - from.x) * 3.4),
               next:function(){ if(item){ item.onBelt = false; item.carried = true; } }});
  /* then the operator lifts it over into the hole */
  item.q.push({to:MOUTH, ctrl:{x:(BELT.out + MOUTH.x)/2, y:110}, dur:620,
               next: method === "present" ? null : function(){ if(item) item.carried = false; }});
  if(method === "present")
    item.q.push({to:PROX, ctrl:null, dur:520, next:function(){
      item.held = true; item.heldAt = Date.now();
    }});
  else
    item.q.push({to:THROAT, ctrl:null, dur:380, next:null});
}

/* the presenter's hand follows whatever is being carried, then withdraws */
var hand = {state:"off", sx:0, sy:0, t:0};
function updateHand(){
  var hg = $("handG");
  if(item && item.carried){
    hand.state = "carry"; hand.sx = item.x; hand.sy = item.y;
    hg.setAttribute("opacity", "1");
    hg.setAttribute("transform", "translate(" + (item.x - 3).toFixed(1) + "," + (item.y - 5).toFixed(1) + ")");
    return;
  }
  if(hand.state === "carry"){ hand.state = "retract"; hand.t = Date.now(); }
  if(hand.state === "retract"){
    var t = (Date.now() - hand.t) / (560 / speed);
    if(t >= 1){ hand.state = "off"; hg.setAttribute("opacity", "0"); return; }
    var e = easeInOut(t);
    hg.setAttribute("opacity", (1 - t).toFixed(2));
    hg.setAttribute("transform", "translate(" + (hand.sx - 3 - 380*e).toFixed(1) + "," + (hand.sy - 5 + 150*e).toFixed(1) + ")");
    return;
  }
  hg.setAttribute("opacity", "0");
}
function canRetrieve(){
  return !!item && !item.falling && !item.onBelt && !item.carried &&
         !item.retrieving && !item.cur && !item.q.length;
}

/* the operator reaches back in and lifts the unreadable waste out again */
function retrieveItem(){
  if(!item || item.falling || item.onBelt || item.carried || item.retrieving) return;
  item.retrieving = true; item.carried = true; item.held = false;
  item.cur = null;
  item.q = [
    {to:{x:MOUTH.x, y:MOUTH.y - 24}, ctrl:null, dur:400, next:null},
    {to:{x:item.homeX, y:item.homeY}, ctrl:{x:(MOUTH.x + item.homeX)/2, y:120}, dur:720, next:function(){
      takenIdx = -1;                            /* back in the queue, nothing consumed */
      $("itemG").setAttribute("opacity", "0");
      item = null; W.itemKind = null;
    }}
  ];
}

var btnFlash = 0;                       /* when the cap was last pushed down */
function pressButton(){
  W.buttonDown = true;
  btnFlash = Date.now();
  clickTick();
  setTimeout(function(){ W.buttonDown = false; }, 320);
  if(!G.operationsEnabled && disposal.phase === "done") finishDisposal();
}
function emptyBin(i){ W.level[i] = 0; }

/* ====================== manual disposal ======================
   The sketch's own D10 handler only clears operationsEnabled — it never
   empties the bin (see Finding #2). So a full bin has to be taken out by
   hand and tipped into the matching disposal bin standing beside the
   machine, and only then is it correct to bring the machine back up.
   This is that hand-carry, played out as an animation the visitor drives
   themselves: click "Carry to disposal bin", watch it land, click RESTART. */
var DISP_TARGET = [ {x:1048, y:706}, {x:1108, y:706}, {x:1168, y:706} ]; /* bio, plastic, metal */
var DISP_HINGE  = [ {x:1048, y:669}, {x:1108, y:669}, {x:1168, y:669} ];
var disposal = {phase:"idle", binIdx:-1, carry:null, dropAt:0};
/* Two ways to empty a full bin, and they are different machines to defend.
   "liner": every bin is lined with a plastic garbage bag. The bag is lifted
            out by the neck, tied, and dropped into the matching disposal bin
            whole; the bin itself never leaves the platform.
   "bin":   the bin comes off the platform, is tipped into the matching
            disposal bin, and goes back.
   The waste leaves the bin at the moment it physically leaves — with the bag
   on the lift, with the tip on the carry — so the ultrasonic reads the bin
   empty from then on, and the machine still stays locked until D10.        */
var DISP_MODE = "liner";
var DISP_BUSY = {lifting:1, carrying:1, dropping:1, returning:1};
var DISP_OUT  = {lifting:1, carrying:1, dropping:1, returning:1, done:1};
/* is that bin off the platform right now (bin method only) */
function binAway(i){
  return DISP_MODE === "bin" && disposal.binIdx === i && !!DISP_BUSY[disposal.phase];
}
/* has the liner already been lifted out of that bin */
function linerGone(i){
  return DISP_MODE === "liner" && disposal.binIdx === i && !!DISP_OUT[disposal.phase];
}
function setDispMode(m){
  if(m !== "bin" && m !== "liner") return;
  if(DISP_BUSY[disposal.phase]) return;           /* not mid-carry */
  DISP_MODE = m;
  paintDispMode();
}
function paintDispMode(){
  var liner = DISP_MODE === "liner";
  $("linerBtn").setAttribute("aria-pressed", String(liner));
  $("linerBtn").textContent = "Bins: " + (liner ? "liner bags" : "no liner");
  var act = liner ? "Lift the liner out" : "Carry the bin out";
  var alt = liner ? "carry the bin instead" : "use liner bags instead";
  $("dispBtn1T").textContent = act;
  $("dispBtn2T").textContent = alt;
  $("disposeHtmlBtn").textContent = act;
  $("linerHtmlBtn").textContent = alt.charAt(0).toUpperCase() + alt.slice(1);
}

function startDisposal(){
  if(disposal.phase !== "idle" || disposal.binIdx < 0 || G.operationsEnabled) return;
  var i = disposal.binIdx;
  var from = pos(BINS[i].A - W.R, 1);
  disposal.home = {x: from.x, y: from.y - 96};
  disposal.phase = "lifting";
  disposal.carry = {x:from.x, y:from.y - 26, from:{x:from.x, y:from.y - 26},
                    to:disposal.home, at:Date.now(), dur:460, flat:true};
  $("carryBag").setAttribute("fill", BINS[i].col);
  $("sackBody").setAttribute("fill", BINS[i].waste);
}
/* whichever object is in the student's hands on this method */
function carryNode(){ return DISP_MODE === "liner" ? "sackG" : "carryG"; }
function showCarry(on, x, y){
  ["sackG", "carryG"].forEach(function(id){
    var live = on && id === carryNode();
    $(id).setAttribute("opacity", live ? "1" : "0");
    if(live) $(id).setAttribute("transform", "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ")");
  });
}
function finishDisposal(){
  if(disposal.phase !== "done") return;
  var i = disposal.binIdx;
  if(i >= 0) W.level[i] = 0;
  G.obstacleDetected = false; G.operationsEnabled = true;
  G.metalDetected = G.plasticDetected = G.bioDetected = false;
  stopAlarm();
  resetServosAndLCD();
  /* the sketch's loop() may be mid-step holding a distance reading it took
     before the bin was emptied — drop it so that stale reading can't relock
     the machine the instant it resumes (same trick the Reset button uses) */
  proc = arduinoLoop();
  disposal.phase = "idle"; disposal.binIdx = -1; disposal.carry = null;
}
function cancelDisposal(){
  disposal.phase = "idle"; disposal.binIdx = -1; disposal.carry = null;
  $("carryG").setAttribute("opacity", "0");
  $("sackG").setAttribute("opacity", "0");
  DISP_HINGE.forEach(function(h, i){
    $("dispLid" + i).setAttribute("transform", "rotate(0 " + h.x + " " + h.y + ")");
  });
}
function stepDisposal(){
  var c = disposal.carry, ph = disposal.phase, i = disposal.binIdx;
  if((ph === "lifting" || ph === "carrying" || ph === "returning") && c){
    var t = Math.min(1, (Date.now() - c.at) / (c.dur / speed));
    var e = easeInOut(t), m = 1 - e;
    if(c.flat){                                   /* straight up out of the bin */
      c.x = c.from.x + (c.to.x - c.from.x) * e;
      c.y = c.from.y + (c.to.y - c.from.y) * e;
    } else {                                      /* an arc across the room */
      var mx = (c.from.x + c.to.x) / 2, my = Math.min(c.from.y, c.to.y) - 90;
      c.x = m*m*c.from.x + 2*m*e*mx + e*e*c.to.x;
      c.y = m*m*c.from.y + 2*m*e*my + e*e*c.to.y;
    }
    showCarry(true, c.x, c.y);
    if(t >= 1){
      if(ph === "lifting"){
        /* the liner leaves with the waste in it — the bin is empty from here */
        if(DISP_MODE === "liner" && i >= 0) W.level[i] = 0;
        disposal.phase = "carrying";
        disposal.carry = {x:c.x, y:c.y, from:{x:c.x, y:c.y}, to:DISP_TARGET[i],
                          at:Date.now(), dur:1000};
      } else if(ph === "carrying"){
        disposal.phase = "dropping"; disposal.dropAt = Date.now();
        var h = DISP_HINGE[i];
        $("dispLid" + i).setAttribute("transform", "rotate(-56 " + h.x + " " + h.y + ")");
      } else {                                    /* the empty bin is back home */
        showCarry(false, 0, 0);
        disposal.phase = "done"; disposal.carry = null;
      }
    }
  } else if(ph === "dropping"){
    if(Date.now() - disposal.dropAt > 420 / speed){
      var h2 = DISP_HINGE[i];
      $("dispLid" + i).setAttribute("transform", "rotate(0 " + h2.x + " " + h2.y + ")");
      if(DISP_MODE === "liner"){
        showCarry(false, 0, 0);                   /* the bag goes in and stays in */
        disposal.phase = "done"; disposal.carry = null;
      } else {
        if(i >= 0) W.level[i] = 0;                /* tipped out — the bin is empty */
        disposal.phase = "returning";             /* and it goes back on the plate */
        disposal.carry = {x:DISP_TARGET[i].x, y:DISP_TARGET[i].y,
                          from:{x:DISP_TARGET[i].x, y:DISP_TARGET[i].y},
                          to:disposal.home || DISP_TARGET[i], at:Date.now(), dur:900};
      }
    }
  }
  /* if the lockout cleared some other way (raw D10 press, Reset button)
     don't leave the overlay or the bag frozen mid-flight */
  if(G.operationsEnabled && disposal.phase !== "idle") cancelDisposal();
}

/* Put a named piece of waste on the belt as though somebody had clicked it.
   Jogs the queue first if that item is not in the nine on screen.          */
function feed(kind){
  if(item || W.itemKind !== null) return false;
  var idx = QUEUE.indexOf(kind);
  if(idx < 0 || !KIND[kind]) return false;
  var slot = (idx - qOffset + QUEUE.length) % QUEUE.length;
  if(slot > 8){ qOffset = idx; slot = 0; buildSamples(); }
  drop(kind, {x:SLOT_X[slot], y:KIND[kind].sit}, idx);
  return true;
}
/* nothing in the machine and nothing on its way in */
function machineIdle(){
  return !item && W.itemKind === null;
}

function onPick(e){
  var g = e.target.closest(".pick[data-w]");
  if(!g || W.itemKind || item) return;
  var m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(g.getAttribute("transform"));
  drop(g.getAttribute("data-w"), {x:parseFloat(m[1]), y:parseFloat(m[2])},
       parseInt(g.getAttribute("data-idx"), 10));
}
$("samples").addEventListener("click", onPick);
$("samples").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); onPick(e); }
});
/* waste that no sensor recognises just sits there — click it to take it back out */
$("itemG").addEventListener("click", retrieveItem);

function jog(dir){
  if(item) return;                              /* don't move the belt mid-feed */
  qOffset = (qOffset + dir + QUEUE.length) % QUEUE.length;
  beltBoost = Date.now() + 420;
}
$("jogPrev").addEventListener("click", function(){ jog(-1); });
$("jogNext").addEventListener("click", function(){ jog(1); });
[["jogPrev",-1],["jogNext",1]].forEach(function(b){
  $(b[0]).addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); jog(b[1]); }
  });
});

$("btnBoard").addEventListener("click", pressButton);
$("btnBoard").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); pressButton(); }
});
$("btnD10").addEventListener("click", pressButton);

/* manual disposal: carry the full bin's waste out, then restart */
["dispBtn2", "linerHtmlBtn"].forEach(function(id){
  $(id).addEventListener("click", function(e){
    e.preventDefault();
    setDispMode(DISP_MODE === "liner" ? "bin" : "liner");
  });
});
$("dispBtn2").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); this.click(); }
});
$("linerBtn").addEventListener("click", function(){
  setDispMode(DISP_MODE === "liner" ? "bin" : "liner");
});
["dispBtn1", "disposeHtmlBtn"].forEach(function(id){
  $(id).addEventListener("click", function(e){ e.preventDefault(); startDisposal(); });
});
$("dispBtn1").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); startDisposal(); }
});
$("metersEl").addEventListener("click", function(e){
  var b = e.target.closest("[data-empty]");
  if(b) emptyBin(parseInt(b.getAttribute("data-empty"), 10));
});
/* muting is a room decision, not a pin one: D12 stays exactly as the sketch
   left it and the scene keeps showing it high, only the tone stops */
function setSound(on){
  soundOn = on;
  $("soundBtn").setAttribute("aria-pressed", String(on));
  $("soundBtn").textContent = "Buzzer: " + (on ? "on" : "off");
  $("buzzUnit").setAttribute("aria-pressed", String(!on));
  $("buzzUnit").setAttribute("aria-label", on ? "Mute the buzzer" : "Unmute the buzzer");
  syncBuzzer();
}
$("soundBtn").addEventListener("click", function(){ setSound(!soundOn); });
/* and the buzzer itself is the other way to reach it — click the can */
$("buzzUnit").addEventListener("click", function(){ ac(); setSound(!soundOn); });
$("buzzUnit").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); ac(); setSound(!soundOn); }
});
var coverOff = false;
function toggleCover(){
  coverOff = !coverOff;
  $("coverBtn").setAttribute("aria-pressed", String(coverOff));
  $("coverBtn").textContent = "Cover: " + (coverOff ? "off" : "on");
  $("coverG").setAttribute("opacity", coverOff ? "0" : "1");
  $("coverG").setAttribute("aria-pressed", String(coverOff));
  $("coverG").setAttribute("aria-label", coverOff ? "Close the acrylic cover" : "Open the acrylic cover");
  $("guts").setAttribute("opacity", coverOff ? "1" : "0");
  $("wiringCard").style.display = coverOff ? "" : "none";
  if(coverOff) $("wiringCard").scrollIntoView({behavior:"smooth", block:"nearest"});
}
$("coverBtn").addEventListener("click", toggleCover);
$("coverG").addEventListener("click", toggleCover);
$("coverG").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggleCover(); }
});

/* battery compartment door on the support box — click/tap to swing it open
   and reveal the 2 pcs battery holder (4 pcs 3.7 V Li-ion each) and wiring */
var supportOpen = false;
function toggleSupportDoor(){
  supportOpen = !supportOpen;
  $("supportDoor").setAttribute("opacity", supportOpen ? "0" : "1");
  $("supportDoor").setAttribute("aria-pressed", String(supportOpen));
  $("supportDoor").setAttribute("aria-label",
    supportOpen ? "Close the battery compartment door" : "Open the battery compartment door");
  /* the SERVO D5 tag labels the driver panel mounted on the door itself,
     so it should only show while that panel is actually visible */
  $("tagServoD5").setAttribute("opacity", supportOpen ? "0" : "1");
}
$("supportDoor").addEventListener("click", toggleSupportDoor);
$("supportDoor").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggleSupportDoor(); }
});

/* pull the adapter out of the socket, or push it back in */
$("mains").addEventListener("click", function(){
  POWER.plugged = !POWER.plugged;
  stepPower(0);
  paintPower();
});
$("pwrSwitch").addEventListener("click", function(){
  if(POWER.build !== "all") return;
  setPower(POWER_SRC[(POWER_SRC.indexOf(POWER.src) + 1) % POWER_SRC.length]);
});
$("pwrSwitch").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); this.click(); }
});
$("mains").setAttribute("style", "cursor:pointer");

$("insertBtn").addEventListener("click", function(){
  insertMode = MODES[(MODES.indexOf(insertMode) + 1) % MODES.length];
  this.textContent = MODE_LABEL[insertMode];
});
$("speedBtn").addEventListener("click", function(){
  speed = speed === 1 ? 2 : (speed === 2 ? 0.5 : 1);
  this.textContent = "Speed " + speed + "×";
});
$("resetBtn").addEventListener("click", function(){
  G.obstacleDetected = false; G.operationsEnabled = true;
  G.metalDetected = G.plasticDetected = G.bioDetected = false;
  W.level = [0,0,0]; W.itemKind = null; W.buttonDown = false; W.lcdInits = 0;
  item = null; hits = {}; hand.state = "off";
  takenIdx = -1; qOffset = 0;
  POWER.plugged = true; POWER.soc = 0.82; POWER.cut = false; POWER.sun = 0.7;
  setBuild(POWER.build);
  cancelDisposal();
  pan.forEach(function(p){ p.mode = "watch"; p.until = 0; p.ink = 0; });
  $("stuckMsg").setAttribute("opacity", "0");
  $("clickHint").setAttribute("opacity", "0");
  buzzerOn(false);
  $("itemG").setAttribute("opacity", "0");
  $("serialEl").innerHTML = "";
  resetServosAndLCD();
  W.R = SERVO_HOME * 1.5; W.gate = 0;
  proc = arduinoLoop();
});


/* ======================= the model ==================================
   The scene at the top is one fixed three-quarter view of the room, and it is
   the view you cannot answer "what is behind the mast", "how far does the gate
   drop" or "what does this look like from where the panel is sitting" from.
   So the machine and the room are built once more as a set of solids in
   millimetres, and drawn through a camera.

   There are two cameras. The side panels use an orthographic one, standing at
   a bearing: it is the scene's own projection reused, a point at radius r and
   bearing b sitting at x = r·sin(b), y = k·r·cos(b), so turning the model is
   only subtracting the viewing bearing before the sine. The room view uses a
   perspective one you can walk: a position on the floor, a heading, an eye
   height and a tilt, with everything depth-sorted and clipped at a near plane.

   Nothing here holds state of its own. The plate angle, the gate angle, the
   fill of every bin, the LEDs, the buzzer, the falling waste and who in the
   group is speaking are all read off the running simulation every frame, so
   both views are live under the presentation, under the panel interview and
   under manual feeding alike, with nothing to keep in sync.

   Bearings and headings: 0° faces the front of the machine (and the chute,
   which stands 67 mm forward of the rotation axis), 90° is its right-hand
   side, 270° its left. +Z is away from you in the scene above.           */
var MDL = {
  hole:67,                               /* the chute stands 67 mm forward of the axis */
  binR:58,   binH:120,  orbit:67,
  plateR:183, plateT:8,  plateH:306,
  castR:112, castH:26,   castW:13,
  baseR:176, baseT:14,   baseH:266,
  boxW:110,  boxD:63,    boxH:266,       /* support box: half width, half depth */
  mastR:230, mastB:270,  mastH:700, mastW:15,
  ctrlH:430, ctrlW:96,   ctrlD:34, ctrlT:200,
  postR:150, postB:90,   postH:560, postW:11,
  usR:96,    usB:34,     usH:520,
  gateH:600, gateL:94,   throatR:42, throatH:62,
  mouthR:92, hopH:186
};
var MDL_COL = {
  ply:"#C9A063", plyDark:"#9B7A44", plyEdge:"#7E5B2C",
  steel:"#8E999C", steelDark:"#5D686B", dark:"#2A3033",
  bin:"#7E8A8E", plate:"#7A2E4C", plateDark:"#571F36",
  ink:"#8FA0A4", hi:"#5FE3CF", floor:"#1A2325", grid:"#263436"
};
/* ---------------- the camera both views project through ---------------- */
var VIEW = {mode:"ortho", az:90, cx:150, cy:384, s:0.40, k:0.52,
            x:250, z:-2500, yaw:0, eye:1600, pitch:0, cp:1, sp:0, f:560, near:400};
function setPitch(deg){
  VIEW.pitch = deg;
  var r = deg * Math.PI / 180;
  VIEW.cp = Math.cos(r); VIEW.sp = Math.sin(r);
}
function proj(X, Z, h){
  if(VIEW.mode === "plan"){                /* looking straight down on it */
    var pa = VIEW.az * Math.PI / 180, pc = Math.cos(pa), ps = Math.sin(pa);
    return {ok:true, d:h, sc:VIEW.s, fs:1,
            x:VIEW.cx + (X * pc - Z * ps) * VIEW.s,
            y:VIEW.cy - (Z * pc + X * ps) * VIEW.s};
  }
  if(VIEW.mode === "ortho"){
    var a = VIEW.az * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    var u = X * c - Z * sn, d = Z * c + X * sn;
    return {ok:true, d:d, sc:VIEW.s, fs:VIEW.k,
            x:VIEW.cx + u * VIEW.s, y:VIEW.cy - h * VIEW.s + d * VIEW.k * VIEW.s};
  }
  /* A real pitch. It used to be a screen shift, which slides the picture but
     never actually tilts the camera — so looking down never revealed the floor
     at your feet, and "do not let it flip over" had no meaning. Now the view
     axis is rotated: depth and height are taken in camera space, which is what
     makes looking up at the ceiling and down into the hole work.           */
  var yw = VIEW.yaw * Math.PI / 180, dx = X - VIEW.x, dz = Z - VIEW.z;
  var hor = dx * Math.sin(yw) + dz * Math.cos(yw);
  var rgt = dx * Math.cos(yw) - dz * Math.sin(yw);
  var up  = h - VIEW.eye;
  var f2  =  hor * VIEW.cp + up * VIEW.sp;
  var u2  = -hor * VIEW.sp + up * VIEW.cp;
  if(f2 < VIEW.near) return {ok:false, d:-f2};
  var sc = VIEW.f / f2;
  return {ok:true, d:-f2, sc:sc, fs:u2 / f2,
          x:VIEW.cx + rgt * sc, y:VIEW.cy - u2 * sc};
}
function bear(r, b, h){
  var t = b * Math.PI / 180;
  return proj(r * Math.sin(t), r * Math.cos(t), h);
}
function xy(p){ return p.x.toFixed(1) + "," + p.y.toFixed(1); }
/* the side panels are 300 px across and the room view is 1200, so the same
   hairline reads as a hairline in one and as nothing at all in the other */
function edgeW(mul){ return ((VIEW.mode === "persp" ? 1.5 : 0.85) * (mul || 1)).toFixed(2); }
function ringPts(r, b0, n){
  var out = [];
  for(var i = 0; i < n; i++){
    var t = (b0 + i * 360 / n) * Math.PI / 180;
    out.push({X:r * Math.sin(t), Z:r * Math.cos(t)});
  }
  return out;
}
/* a rectangle laid on the floor pointing along (fx,fz) — a chair seat, a
   thigh, anything that has to face the way its owner does */
function quadAt(cx, cz, fx, fz, back, fwd, halfw){
  var rx = fz, rz = -fx;
  return [{X:cx + rx*halfw - fx*back, Z:cz + rz*halfw - fz*back},
          {X:cx + rx*halfw + fx*fwd,  Z:cz + rz*halfw + fz*fwd},
          {X:cx - rx*halfw + fx*fwd,  Z:cz - rz*halfw + fz*fwd},
          {X:cx - rx*halfw - fx*back, Z:cz - rz*halfw - fz*back}];
}
function boxPts(cx, cz, hw, hd){
  return [{X:cx-hw,Z:cz+hd},{X:cx+hw,Z:cz+hd},{X:cx+hw,Z:cz-hd},{X:cx-hw,Z:cz-hd}];
}
/* ---------------------------- light ----------------------------------
   Every face being one flat colour is what made the machine read as a
   silhouette rather than a solid: a box drawn in one tone has no corners.
   The light is fixed to the camera — brighter to screen-left, darker to
   screen-right, brightest on top — so no face ever goes black whichever way
   you walk round it, and every corner announces itself.                  */
function shade(hex, f){
  if(!hex || hex.charAt(0) !== "#" || hex.length !== 7) return hex;   /* "none", gradients */
  var n = parseInt(hex.slice(1), 16);
  var r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  var g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  var b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return "#" + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function faceShade(nx, nz){
  var a = (VIEW.mode === "persp" ? VIEW.yaw : VIEW.az) * Math.PI / 180;
  var d = nx * Math.cos(a) + nz * -Math.sin(a);     /* -1 screen-left, +1 right */
  return 0.80 - 0.24 * d;
}
/* a flat-topped solid: every side wall back to front, lit by its own facing,
   then the lid. `ply` draws the laminations down the cut edge. */
function solid(pts, h0, h1, top, side, stroke, ply){
  var n = pts.length, faces = [], lid = [], anyBad = false, cX = 0, cZ = 0, i;
  for(i = 0; i < n; i++){ cX += pts[i].X; cZ += pts[i].Z; }
  cX /= n; cZ /= n;
  for(i = 0; i < n; i++){
    var a = pts[i], b = pts[(i + 1) % n];
    var p1 = proj(a.X,a.Z,h1), p2 = proj(b.X,b.Z,h1),
        p3 = proj(b.X,b.Z,h0), p4 = proj(a.X,a.Z,h0);
    if(!(p1.ok && p2.ok && p3.ok && p4.ok)){ anyBad = true; continue; }
    var nx = (a.X + b.X) / 2 - cX, nz = (a.Z + b.Z) / 2 - cZ;
    var L = Math.sqrt(nx*nx + nz*nz) || 1;
    var f = faceShade(nx / L, nz / L);
    var g = '<polygon points="' + xy(p1)+" "+xy(p2)+" "+xy(p3)+" "+xy(p4) +
            '" fill="' + shade(side, f) + '" stroke="' + stroke + '" stroke-width="' + edgeW(0.8) + '"/>';
    if(ply) for(var k = 1; k <= 2; k++){          /* the plies, down the cut edge */
      var t = k / 3;
      g += '<line x1="' + (p1.x + (p4.x-p1.x)*t).toFixed(1) + '" y1="' + (p1.y + (p4.y-p1.y)*t).toFixed(1) +
           '" x2="' + (p2.x + (p3.x-p2.x)*t).toFixed(1) + '" y2="' + (p2.y + (p3.y-p2.y)*t).toFixed(1) +
           '" stroke="' + shade(side, f * 0.78) + '" stroke-width="' + edgeW(0.55) + '"/>';
    }
    faces.push({d:(p1.d + p2.d) / 2, s:g});
  }
  faces.sort(function(a, b){ return a.d - b.d; });
  var out = faces.map(function(f){ return f.s; }).join("");
  if(!anyBad){
    for(var j = 0; j < n; j++) lid.push(xy(proj(pts[j].X, pts[j].Z, h1)));
    out += '<polygon points="' + lid.join(" ") + '" fill="' + shade(top, 1.07) +
           '" stroke="' + stroke + '" stroke-width="' + edgeW() + '"/>';
  }
  return out;
}
/* a cylinder looks the same from every bearing, so it is drawn, not projected */
/* how deep a horizontal circle of radius r at height h looks from here. With
   the camera tilted it is no longer r·sc·fs, so it is measured off the near and
   far points of the circle instead of assumed. */
function capRy(X, Z, h, r){
  if(VIEW.mode !== "persp") return Math.abs(r * VIEW.s * (VIEW.mode === "plan" ? 1 : VIEW.k));
  var yw = VIEW.yaw * Math.PI / 180, fx = Math.sin(yw), fz = Math.cos(yw);
  var a = proj(X - fx*r, Z - fz*r, h), b2 = proj(X + fx*r, Z + fz*r, h);
  if(!a.ok || !b2.ok) return Math.abs(r * (proj(X,Z,h).sc || 0) * 0.4);
  return Math.abs(b2.y - a.y) / 2;
}
function cylinder(X, Z, h0, h1, r, body, cap, stroke){
  var b = proj(X,Z,h0), t = proj(X,Z,h1);
  if(!b.ok || !t.ok) return "";
  var Rb = r * b.sc, Rt = r * t.sc, ry = capRy(X, Z, h1, r);
  /* the round half in shadow, so a barrel is not a flat sticker */
  var half = '<path d="M' + t.x.toFixed(1) + " " + t.y.toFixed(1) +
             ' L' + b.x.toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (b.x+Rb).toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (t.x+Rt).toFixed(1) + " " + t.y.toFixed(1) +
             ' Z" fill="#000" opacity=".16"/>' +
             '<path d="M' + t.x.toFixed(1) + " " + t.y.toFixed(1) +
             ' L' + b.x.toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (b.x-Rb).toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (t.x-Rt).toFixed(1) + " " + t.y.toFixed(1) +
             ' Z" fill="#fff" opacity=".08"/>';
  return '<path d="M' + (t.x-Rt).toFixed(1) + " " + t.y.toFixed(1) +
         ' L' + (b.x-Rb).toFixed(1) + " " + b.y.toFixed(1) +
         ' A ' + Rb.toFixed(1) + " " + capRy(X, Z, h0, r).toFixed(1) + ' 0 0 0 ' +
         (b.x+Rb).toFixed(1) + " " + b.y.toFixed(1) +
         ' L' + (t.x+Rt).toFixed(1) + " " + t.y.toFixed(1) + ' Z" fill="' + body +
         '" stroke="' + stroke + '" stroke-width="' + edgeW(0.8) + '"/>' + half +
         '<ellipse cx="' + t.x.toFixed(1) + '" cy="' + t.y.toFixed(1) + '" rx="' + Rt.toFixed(1) +
         '" ry="' + ry.toFixed(1) + '" fill="' + shade(cap, 1.07) + '" stroke="' + stroke + '" stroke-width="' + edgeW() + '"/>';
}
/* Is a face with this outward bearing turned toward the camera? Step along the
   outward normal: if that brings you nearer the viewer, you are looking at it.
   Works in all three projections because `d` means nearness in all three. The
   tolerance keeps an edge-on panel drawn rather than flickering out.
   Measured across all 13 viewpoints, bearing 180 — the face turned back toward
   the room, which is where the operator stands — is the one you can read from
   most of them, so that is where the machine's interface lives. */
var FACE_OUT = 180;
/* Cutaway. The chute is the one part of this machine whose whole point is what
   is INSIDE it, and from outside it is an opaque bucket on an opaque tube. With
   this on, the bucket and the throat go to glass and the bore is drawn: the two
   proximity faces, the 128 mm of clear air between them, the infrared across
   the gate, and the gate itself as the floor holding the waste. */
var cutOn = false;
function cutNow(){ return cutOn && VIEW.mode !== "ortho"; }
function facesUs(cx, cz, h, bearingDeg){
  var n = bearingDeg * Math.PI / 180;
  var a = proj(cx, cz, h), b = proj(cx + 40*Math.sin(n), cz + 40*Math.cos(n), h);
  return a.ok && b.ok && (b.d - a.d) > -4;
}
function outward(cz, dist){ return cz + dist * Math.cos(FACE_OUT * Math.PI / 180); }
/* A rectangle that lies ON a face, not in front of it.
   Anything painted on the controller box used to be a screen-space <rect> at
   one projected point: the box sheared with the camera while the display,
   the cover and the boards stayed bolt upright, which reads exactly like a
   panel floating free of the box. These four corners are projected in model
   space instead, so the shape leans, narrows and shears with the surface it
   is painted on — and `deg` is the screen angle of the face's own horizontal,
   for the text that has to lie flat on it. */
function facePanel(cx, cz, h, halfW, halfH){
  var a = proj(cx - halfW, cz, h + halfH), b = proj(cx + halfW, cz, h + halfH),
      c = proj(cx + halfW, cz, h - halfH), d = proj(cx - halfW, cz, h - halfH);
  if(!(a.ok && b.ok && c.ok && d.ok)) return null;
  return {
    pts: [a, b, c, d].map(function(q){ return q.x.toFixed(1) + "," + q.y.toFixed(1); }).join(" "),
    a:a, b:b, c:c, d:d,
    deg: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
  };
}
/* text that sits on that face, rotated to follow it */
function faceText(cx, cz, h, deg, size, fill, body, anchor){
  var p = proj(cx, cz, h);
  if(!p.ok) return "";
  return '<text x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" transform="rotate(' +
         deg.toFixed(2) + ' ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')"' +
         (anchor ? ' text-anchor="' + anchor + '"' : '') +
         ' font-family="IBM Plex Mono, monospace" font-size="' + size.toFixed(1) +
         '" fill="' + fill + '">' + body + '</text>';
}
function txtSize(p){
  return VIEW.mode === "persp" ? Math.max(5, Math.min(14, 62 * p.sc)) : 7.6;
}
/* a bin is wider at the rim than at the base, and that reads from across a
   room, so it gets a truncated cone rather than a tube */
function cone(X, Z, h0, h1, r0, r1, body, cap, stroke){
  var b = proj(X,Z,h0), t = proj(X,Z,h1);
  if(!b.ok || !t.ok) return "";
  var Rb = r0 * b.sc, Rt = r1 * t.sc;
  /* the round half in shadow, so a barrel is not a flat sticker */
  var half = '<path d="M' + t.x.toFixed(1) + " " + t.y.toFixed(1) +
             ' L' + b.x.toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (b.x+Rb).toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (t.x+Rt).toFixed(1) + " " + t.y.toFixed(1) +
             ' Z" fill="#000" opacity=".16"/>' +
             '<path d="M' + t.x.toFixed(1) + " " + t.y.toFixed(1) +
             ' L' + b.x.toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (b.x-Rb).toFixed(1) + " " + b.y.toFixed(1) +
             ' L' + (t.x-Rt).toFixed(1) + " " + t.y.toFixed(1) +
             ' Z" fill="#fff" opacity=".08"/>';
  return '<path d="M' + (t.x-Rt).toFixed(1) + " " + t.y.toFixed(1) +
         ' L' + (b.x-Rb).toFixed(1) + " " + b.y.toFixed(1) +
         ' A ' + Rb.toFixed(1) + " " + capRy(X, Z, h0, r0).toFixed(1) + ' 0 0 0 ' +
         (b.x+Rb).toFixed(1) + " " + b.y.toFixed(1) +
         ' L' + (t.x+Rt).toFixed(1) + " " + t.y.toFixed(1) + ' Z" fill="' + body +
         '" stroke="' + stroke + '" stroke-width="' + edgeW(0.8) + '"/>' + half +
         '<ellipse cx="' + t.x.toFixed(1) + '" cy="' + t.y.toFixed(1) + '" rx="' + Rt.toFixed(1) +
         '" ry="' + capRy(X, Z, h1, r1).toFixed(1) + '" fill="' + shade(cap, 1.07) +
         '" stroke="' + stroke + '" stroke-width="' + edgeW() + '"/>';
}
function tag(p, txt, col, anchor, dy, size){
  if(!p.ok) return "";
  if(size === undefined) size = txtSize(p);
  return '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + (dy||0)).toFixed(1) +
         '" text-anchor="' + (anchor||"middle") + '" font-family="IBM Plex Mono, monospace" ' +
         'font-size="' + size.toFixed(1) + '" fill="' + (col || MDL_COL.ink) + '">' + esc(txt) + '</text>';
}

/* A part of the machine, named on a chip with a leader line back to it —
   the same callouts the scene at the top carries, and they come and go with
   the camera bar's own Labels button. Without them the prototype is a stack
   of wooden discs; with them it is a machine you can read off. */
function callout(X, Z, h, dx, dy, txt){
  var p = proj(X, Z, h);
  if(!p.ok || p.sc < 0.055) return "";
  var k = Math.max(0.5, Math.min(1.5, p.sc * 5.5));
  var fs = Math.max(6, 11 * k), w = txt.length * fs * 0.61 + 12 * k, hh = fs * 1.7;
  var ax = p.x + dx * k, ay = p.y + dy * k;
  return '<g><line x1="'+p.x.toFixed(1)+'" y1="'+p.y.toFixed(1)+'" x2="'+ax.toFixed(1)+'" y2="'+ay.toFixed(1)+
    '" stroke="#5FE3CF" stroke-width="'+(1.1*k).toFixed(2)+'" opacity=".7"/>'+
    '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(2.3*k).toFixed(2)+'" fill="#5FE3CF"/>'+
    '<rect x="'+(ax-w/2).toFixed(1)+'" y="'+(ay-hh/2).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+hh.toFixed(1)+
    '" rx="'+(3.5*k).toFixed(1)+'" fill="#0D1416" opacity=".9" stroke="#39413F" stroke-width="'+(0.9*k).toFixed(2)+'"/>'+
    '<text x="'+ax.toFixed(1)+'" y="'+(ay+fs*0.36).toFixed(1)+'" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="'+
    fs.toFixed(1)+'" letter-spacing="'+(0.55*k).toFixed(2)+'" fill="#EDF3F2">'+esc(txt)+'</text></g>';
}
function machineLabels(){
  var hZ = MDL.hole, o = "";
  o += callout(0, hZ, MDL.gateH + MDL.throatH + MDL.hopH, -150, -46, "INPUT HOLE");
  o += callout(-98, hZ, MDL.gateH + 40, -190, -28, "D3 · CAPACITIVE · PLASTIC");
  o += callout(98, hZ, MDL.gateH + 40, 190, -28, "D4 · INDUCTIVE · METAL");
  o += callout(74, hZ - 4, MDL.gateH + 10, 190, 34, "D7 · INFRARED · OBJECT");
  o += callout(0, hZ, MDL.gateH,        168,  -30, "GATE · SERVO D6");
  o += callout(MDL.usR * Math.sin(MDL.usB*Math.PI/180), MDL.usR * Math.cos(MDL.usB*Math.PI/180),
               MDL.usH, 186, -66, "HC-SR04 · D8 / D9");
  o += callout(MDL.mastR * Math.sin(MDL.mastB*Math.PI/180), MDL.mastR * Math.cos(MDL.mastB*Math.PI/180),
               MDL.ctrlH + MDL.ctrlT, -196, -52, "UNO + I²C LCD");
  o += callout(0, 0, MDL.plateH + MDL.plateT, 196, -18, "PLATE · SERVO D5");
  o += callout(MDL.castR * Math.sin(Math.PI/3), MDL.castR * Math.cos(Math.PI/3),
               MDL.baseH + MDL.baseT + 12, 174, 30, "CASTORS ×3");
  o += callout(-MDL.baseR + 20, 0, MDL.baseH + MDL.baseT, -180, 34, "FIXED BASE PLATE");
  o += callout(0, MDL.boxD, 150, 150, 74, "SUPPORT BOX · D10");
  return o;
}
/* ------------------------- the machine itself ------------------------- */
function machineInto(put){
  var C = MDL_COL;

  /* 1 · the plywood support box, and the D10 button on the face of it */
  put(-MDL.boxD - 2, solid(boxPts(0,0,MDL.boxW,MDL.boxD), 0, MDL.boxH, C.ply, C.plyDark, C.plyEdge, true));
  /* the battery compartment: the door on the front of the box, and the two
     packs behind it when it is open — the same state the scene's own door has */
  var doorH0 = 40, doorH1 = 210;
  if(supportOpen){
    put(-MDL.boxD + 1, wallPanel(-92, outward(0, MDL.boxD - 2), 92, outward(0, MDL.boxD - 2), doorH0, doorH1, "#141A1C", "#0A0E10", 1));
    [-46, 46].forEach(function(bx){
      put(-MDL.boxD + 2, solid(boxPts(bx, outward(0, MDL.boxD - 26), 36, 16), doorH0 + 24, doorH1 - 24,
                               "#1A1F22", "#12171A", "#0E1416"));
      var bp = proj(bx, outward(0, MDL.boxD - 10), (doorH0 + doorH1) / 2);
      if(bp.ok && bp.sc > 0.06) put(-MDL.boxD + 3,
        '<rect x="'+(bp.x-26*bp.sc).toFixed(1)+'" y="'+(bp.y-30*bp.sc).toFixed(1)+
        '" width="'+(52*bp.sc).toFixed(1)+'" height="'+(60*bp.sc).toFixed(1)+
        '" rx="2" fill="#3F6FA8" stroke="#1E3A5C" stroke-width="0.8"/>');
    });
  } else {
    put(-MDL.boxD + 1, wallPanel(-92, outward(0, MDL.boxD + 1), 92, outward(0, MDL.boxD + 1), doorH0, doorH1, "#B78F58", "#7E5B2C", 1.1));
  }
  var btn = proj(0, outward(0, MDL.boxD), 150);
  if(btn.ok && facesUs(0, 0, 150, FACE_OUT))
    put(btn.d, '<circle cx="' + btn.x.toFixed(1) + '" cy="' + btn.y.toFixed(1) +
      '" r="' + (11 * btn.sc).toFixed(1) + '" fill="#E8C433" stroke="#A8890F" stroke-width="1.2"/>' +
      (W.buttonDown ? '<circle cx="' + btn.x.toFixed(1) + '" cy="' + btn.y.toFixed(1) +
       '" r="' + (18 * btn.sc).toFixed(1) + '" fill="none" stroke="#F4E58C" stroke-width="1.6"/>' : "") +
      tag(btn, "D10", C.ink, "middle", 40 * btn.sc));

  /* 2 · the fixed base plate — it does not turn, so its corners stay put */
  put(-MDL.baseR + 1, solid(ringPts(MDL.baseR, 0, 3), MDL.baseH, MDL.baseH + MDL.baseT,
                            C.ply, C.plyDark, C.plyEdge, true));

  /* 3 · the three castors that carry the weight, on the fixed plate */
  [180, 60, 300].forEach(function(b){
    var t = b * Math.PI / 180, X = MDL.castR * Math.sin(t), Z = MDL.castR * Math.cos(t);
    var p = proj(X, Z, 0);
    if(p.ok) put(p.d, cylinder(X, Z, MDL.baseH + MDL.baseT, MDL.plateH, MDL.castW,
                               C.steelDark, C.steel, "#20272A"));
  });

  /* 4 · the rotating plate, at the angle the servo is actually holding */
  put(-MDL.plateR + 2, solid(ringPts(MDL.plateR, -W.R, 3), MDL.plateH, MDL.plateH + MDL.plateT,
                             C.plate, C.plateDark, "#3E1526"));

  /* 4b · the retaining rail round the rim. Each edge is put in separately so
     the near one draws over the bins and the far one behind them. */
  var rimP = ringPts(MDL.plateR, -W.R, 3), rimTop = MDL.plateH + MDL.plateT;
  for(var e = 0; e < 3; e++){
    var a1 = rimP[e], b1 = rimP[(e + 1) % 3];
    var mid = proj((a1.X + b1.X) / 2, (a1.Z + b1.Z) / 2, rimTop);
    if(mid.ok) put(mid.d, wallPanel(a1.X, a1.Z, b1.X, b1.Z, rimTop, rimTop + TRI.h,
                                    C.plate, "#3E1526", 0.9));
  }

  /* 5 · the three bins, with what is in them */
  BINS.forEach(function(b, i){
    if(binAway(i)) return;                       /* it is in somebody's hands */
    var t = (b.A - W.R) * Math.PI / 180,
        X = MDL.orbit * Math.sin(t), Z = MDL.orbit * Math.cos(t);
    var p = proj(X, Z, 0);
    if(!p.ok) return;
    var y0 = MDL.plateH + MDL.plateT, y1 = y0 + MDL.binH, lv = W.level[i];
    /* 116 mm across the rim, 82 at the foot — the shape that is drawn above */
    var s = cone(X, Z, y0, y1, 41, MDL.binR, C.bin, "#141A1C", "#1B2224");
    var band = proj(X, Z, y1 - 30);
    if(band.ok){
      var R = MDL.binR * band.sc * 0.97;
      s += '<rect x="' + (band.x - R).toFixed(1) + '" y="' + band.y.toFixed(1) +
           '" width="' + (2*R).toFixed(1) + '" height="' + Math.max(2, 32*band.sc).toFixed(1) +
           '" fill="' + b.col + '"/>';
    }
    /* the liner bag, hooked over the rim, on the build that uses them */
    if(DISP_MODE === "liner"){
      var rim = proj(X, Z, y1);
      if(rim.ok) s += '<ellipse cx="' + rim.x.toFixed(1) + '" cy="' + rim.y.toFixed(1) +
        '" rx="' + (MDL.binR*1.06*rim.sc).toFixed(1) + '" ry="' +
        Math.abs(MDL.binR*1.06*rim.sc*rim.fs).toFixed(1) +
        '" fill="none" stroke="#DDE4E6" stroke-width="' + Math.max(0.6, 5*rim.sc).toFixed(1) + '" opacity=".8"/>';
    }
    if(lv > 0){
      var lt = proj(X, Z, y0 + (MDL.binH - 22) * lv / 100);
      if(lt.ok){
        var Rl = MDL.binR * 0.86 * lt.sc;
        s += '<ellipse cx="' + lt.x.toFixed(1) + '" cy="' + lt.y.toFixed(1) + '" rx="' + Rl.toFixed(1) +
             '" ry="' + Math.abs(Rl * lt.fs).toFixed(1) + '" fill="' + b.waste + '" opacity=".9"/>' +
             tag(lt, lv + "%", lv >= 100 ? "#F2685E" : C.ink, "middle", -14 * lt.sc);
      }
    }
    put(p.d, s);
  });

  /* 6 · the mast on the left, and the controller box bolted to it */
  var mt = MDL.mastB * Math.PI / 180,
      mX = MDL.mastR * Math.sin(mt), mZ = MDL.mastR * Math.cos(mt);
  var mp = proj(mX, mZ, 0);
  if(mp.ok){
    var ms = cylinder(mX, mZ, 0, MDL.mastH, MDL.mastW, C.steelDark, C.steel, "#20272A");
    /* the foot pad and tie beam that bolt the mast to the base plate */
    ms += solid(boxPts(mX, mZ, 42, 42), 0, 26, "#8E6C36", "#6E4E24", "#4E3616");
    /* The top arm. Without it the bucket is hanging in mid-air, which is the
       single thing that made the prototype look unbuilt: this is what holds it. */
    var ah = MDL.mastH - 60, dxh = 0 - mX, dzh = MDL.hole - mZ;
    var dl = Math.sqrt(dxh*dxh + dzh*dzh) || 1, afx = dxh/dl, afz = dzh/dl;
    ms += solid(quadAt(mX, mZ, afx, afz, 0, dl * 0.80, 26), ah, ah + 44,
                "#B8C0C2", "#7E888A", "#4A5254");
    ms += cylinder(mX + afx*dl*0.78, mZ + afz*dl*0.78, MDL.gateH + MDL.throatH + 96, ah, 17,
                   "#171C1E", "#2A3033", "#0D1112");
    /* the clamp band gripping the bucket, hung off that bracket */
    ms += cylinder(0, MDL.hole, MDL.gateH + MDL.throatH + 84, MDL.gateH + MDL.throatH + 118, 76,
                   "#B8C0C2", "#D2D8D9", "#6E7678");
    /* the power module strapped to the mast above the control box */
    var pmH = MDL.ctrlH + MDL.ctrlT + 60;
    ms += solid(boxPts(mX, mZ, 45, 26), pmH, pmH + 140, "#2A3033", "#1C2124", "#0F1416");
    var pmz = outward(mZ, 26), pmf = proj(mX, pmz, pmH + 108);
    if(pmf.ok && facesUs(mX, mZ, pmH + 108, FACE_OUT) && pmf.sc > 0.05){
      ms += '<rect x="'+(pmf.x-28*pmf.sc).toFixed(1)+'" y="'+(pmf.y-9*pmf.sc).toFixed(1)+
            '" width="'+(56*pmf.sc).toFixed(1)+'" height="'+(18*pmf.sc).toFixed(1)+
            '" rx="1.5" fill="#0D1416" stroke="#39413F" stroke-width="0.7"/>';
      if(pmf.sc > 0.09) ms += tag(pmf, "POWER", "#7FE3D4", "middle", 6*pmf.sc);
      var kn = proj(mX - 20, pmz, pmH + 62);
      if(kn.ok) ms += '<circle cx="'+kn.x.toFixed(1)+'" cy="'+kn.y.toFixed(1)+'" r="'+
        Math.max(1.4, 15*kn.sc).toFixed(1)+'" fill="#2A3033" stroke="#4A5254" stroke-width="0.8"/>';
      var bk = proj(mX + 22, pmz, pmH + 62);
      if(bk.ok) ms += '<rect x="'+(bk.x-14*bk.sc).toFixed(1)+'" y="'+(bk.y-11*bk.sc).toFixed(1)+
        '" width="'+(28*bk.sc).toFixed(1)+'" height="'+(22*bk.sc).toFixed(1)+
        '" rx="1.5" fill="#1B4C8C" stroke="#0E2E5A" stroke-width="0.7"/>';
    }
    ms += solid(boxPts(mX, mZ, MDL.ctrlW/2, MDL.ctrlD), MDL.ctrlH, MDL.ctrlH + MDL.ctrlT,
                "#39414A", C.dark, "#161B1E");
    /* the display, the three LEDs and the buzzer, on the face turned to us */
    /* The front panel, and it is the real one: the 16x2 display reads whatever
       the sketch last printed, the three LEDs are D2, D13 and A3 in that order
       and the buzzer is D12. It is only drawn when that face is turned to you,
       because a display you are standing behind should not be readable. */
    var cfz = outward(mZ, MDL.ctrlD);
    var fc = proj(mX, cfz, MDL.ctrlH + 150);
    if(fc.ok && facesUs(mX, mZ, MDL.ctrlH + 150, FACE_OUT) && fc.sc > 0.055){
      var k = fc.sc, full = (W.lcd1 === "Bin Full");
      /* bezel and glass, bolted to the face: 76 x 46 mm centred 157 mm up the
         box, projected corner by corner so they lean with it */
      var LH = MDL.ctrlH + 157;
      var bez = facePanel(mX, cfz, LH, 38, 23);
      var scr = facePanel(mX, cfz, LH, 34, 19);
      var deg = bez ? bez.deg : 0;
      if(bez) ms += '<polygon points="' + bez.pts + '" fill="#14672F" stroke="#0C3D22" stroke-width="' +
                    edgeW(0.7) + '" stroke-linejoin="round"/>';
      if(scr) ms += '<polygon points="' + scr.pts + '" fill="' + (full ? "#2E7A4A" : "#1F7A4E") + '"/>';
      var fs = Math.max(3.2, 11 * k);
      if(fs > 4.2 && scr){
        ms += faceText(mX - 31, cfz, LH + 5,  deg, fs, "#CFF4FF", esc(W.lcd1));
        ms += faceText(mX - 31, cfz, LH - 11, deg, fs, "#CFF4FF", esc(W.lcd2));
      }
      [0,1,2].forEach(function(n){
        var lp = proj(mX + (n-1)*20, cfz, MDL.ctrlH + 112);
        if(lp.ok) ms += '<circle cx="' + lp.x.toFixed(1) + '" cy="' + lp.y.toFixed(1) +
          '" r="' + Math.max(1.2, 8*lp.sc).toFixed(1) + '" fill="' +
          (W.leds[n] ? BINS[n].col : "#2C3234") + '" stroke="#4A5254" stroke-width="0.8"/>';
      });
      var lbl = proj(mX, cfz, MDL.ctrlH + 92);
      if(lbl.ok && fs > 4.6) ms += tag(lbl, "D2·D13·A3", "#93A0A2", "middle", 0);
      var bz = proj(mX + 42, cfz, MDL.ctrlH + 112);
      if(bz.ok){
        ms += '<circle cx="' + bz.x.toFixed(1) + '" cy="' + bz.y.toFixed(1) + '" r="' +
              Math.max(1.6, 11*bz.sc).toFixed(1) + '" fill="' + (W.buzzer ? "#F2685E" : "#101416") +
              '" stroke="#4A5254" stroke-width="0.9"/>';
        if(W.buzzer) ms += '<circle cx="' + bz.x.toFixed(1) + '" cy="' + bz.y.toFixed(1) +
              '" r="' + (22*bz.sc).toFixed(1) + '" fill="none" stroke="#F2685E" stroke-width="1.2" opacity=".55"/>';
        if(fs > 4.6) ms += tag(bz, "D12", "#93A0A2", "middle", 20 * bz.sc);
      }
      /* Under the display: what the acrylic cover is covering. Cover off and
         you get the Uno and the mini breadboard the jumpers run into — the
         same two things the scene reveals, on the same switch. */
      var gz = proj(mX - 18, cfz, MDL.ctrlH + 52);
      if(gz.ok && coverOff){
        var uno = facePanel(mX - 18, cfz, MDL.ctrlH + 52, 26, 17);
        if(uno) ms += '<polygon points="' + uno.pts + '" fill="#1B7B8C" stroke="#0E4E5A" ' +
                      'stroke-width="' + edgeW(0.8) + '" stroke-linejoin="round"/>';
        if(fs > 4.6) ms += tag(gz, "UNO R3", "#CFF4FF", "middle", 3*k);
        var brd = facePanel(mX + 28, cfz, MDL.ctrlH + 52, 15, 17);
        if(brd){
          ms += '<polygon points="' + brd.pts + '" fill="#E4E7E2" stroke="#A8B2B5" ' +
                'stroke-width="' + edgeW(0.7) + '" stroke-linejoin="round"/>';
          /* the strips run across the board, on the board */
          for(var rw = -1; rw <= 1; rw++){
            var s0 = proj(mX + 15, cfz, MDL.ctrlH + 52 + rw * 8.5),
                s1 = proj(mX + 41, cfz, MDL.ctrlH + 52 + rw * 8.5);
            if(s0.ok && s1.ok)
              ms += '<line x1="'+s0.x.toFixed(1)+'" y1="'+s0.y.toFixed(1)+
                    '" x2="'+s1.x.toFixed(1)+'" y2="'+s1.y.toFixed(1)+
                    '" stroke="#B8BEB8" stroke-width="'+edgeW(0.5)+'"/>';
          }
        }
      }
      /* and the cover itself, when it is on: acrylic, with a corner highlight */
      if(!coverOff && !cutNow()){
        /* the acrylic is a sheet on the front of the box, so it is the face's
           own quad — not a screen rectangle drawn across two of its corners,
           which stayed square while the box turned underneath it */
        var cov = facePanel(mX, cfz, MDL.ctrlH + MDL.ctrlT/2, MDL.ctrlW/2, MDL.ctrlT/2 - 8);
        if(cov){
          ms += '<polygon points="'+cov.pts+'" fill="#BFD9E2" opacity=".13" stroke="#8A9496" ' +
                'stroke-width="'+edgeW(1.1)+'" stroke-linejoin="round"/>';
          /* the sheen, struck across the top-left corner of the sheet itself */
          var g0 = proj(mX - MDL.ctrlW/2 + 6, cfz, MDL.ctrlH + MDL.ctrlT - 16),
              g1 = proj(mX - 4,               cfz, MDL.ctrlH + MDL.ctrlT - 16),
              g2 = proj(mX - MDL.ctrlW/2 + 6, cfz, MDL.ctrlH + MDL.ctrlT - 78);
          if(g0.ok && g1.ok && g2.ok)
            ms += '<path d="M'+g0.x.toFixed(1)+' '+g0.y.toFixed(1)+
                  ' L'+g1.x.toFixed(1)+' '+g1.y.toFixed(1)+
                  ' L'+g2.x.toFixed(1)+' '+g2.y.toFixed(1)+' Z" fill="#fff" opacity=".10"/>';
          /* four fixing screws, each at its own place on the sheet */
          [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(function(q2){
            var sp = proj(mX + q2[0] * (MDL.ctrlW/2 - 7), cfz,
                          MDL.ctrlH + MDL.ctrlT/2 + q2[1] * (MDL.ctrlT/2 - 15));
            if(sp.ok) ms += '<circle cx="'+sp.x.toFixed(1)+'" cy="'+sp.y.toFixed(1)+
                  '" r="'+Math.max(0.7, 2.2*sp.sc).toFixed(1)+'" fill="#8A9496"/>';
          });
        }
      }
    }
    put(mp.d, ms);
  }

  /* 7 · the sensor post, and the beam down into whatever is under the hole */
  var pt2 = MDL.postB * Math.PI / 180,
      pX = MDL.postR * Math.sin(pt2), pZ = MDL.postR * Math.cos(pt2);
  var ut = MDL.usB * Math.PI / 180,
      uX = MDL.usR * Math.sin(ut), uZ = MDL.usR * Math.cos(ut);
  var pp = proj(pX, pZ, 0), arm0 = proj(pX, pZ, MDL.postH - 20), arm1 = proj(uX, uZ, MDL.usH);
  if(pp.ok && arm0.ok && arm1.ok){
    var ps = cylinder(pX, pZ, MDL.baseH, MDL.postH, MDL.postW, C.steelDark, C.steel, "#20272A");
    ps += '<line x1="' + arm0.x.toFixed(1) + '" y1="' + arm0.y.toFixed(1) + '" x2="' + arm1.x.toFixed(1) +
          '" y2="' + arm1.y.toFixed(1) + '" stroke="' + C.steel + '" stroke-width="' +
          Math.max(1, 8*arm1.sc).toFixed(1) + '" stroke-linecap="round"/>';
    ps += '<rect x="' + (arm1.x - 18*arm1.sc).toFixed(1) + '" y="' + (arm1.y - 10*arm1.sc).toFixed(1) +
          '" width="' + (36*arm1.sc).toFixed(1) + '" height="' + (20*arm1.sc).toFixed(1) +
          '" rx="1.5" fill="#1B3550" stroke="#7FB2E3" stroke-width="0.8"/>';
    /* frontBin() is -1 for the whole of every swing between two bins, and the
       bin can also be off the plate in your hands — either way the beam
       carries past the plate, which is what the sketch then measures */
    var fb = frontBin(), parked = fb >= 0 && !binAway(fb);
    var bt = proj(uX, uZ, parked ? MDL.plateH + MDL.plateT + MDL.binH * (W.level[fb]||0) / 100
                                 : MDL.plateH);
    if(bt.ok)
      ps += '<line x1="' + arm1.x.toFixed(1) + '" y1="' + (arm1.y + 10*arm1.sc).toFixed(1) +
            '" x2="' + bt.x.toFixed(1) + '" y2="' + bt.y.toFixed(1) +
            '" stroke="#5FE3CF" stroke-width="1.4" stroke-dasharray="3 3" opacity=".8"/>';
    ps += tag(arm1, Math.round(W.distance) + " cm", C.hi, "middle", -24 * arm1.sc);
    put(pp.d, ps);
  }

  /* 8 · the chute: mouth, throat, and the gate that is the floor of it. The
     flap hinges about a line running front-to-back through the hole, so from
     the front you watch it swing and from either side you watch it drop. */
  var hZ = MDL.hole, gp = proj(0, hZ, 0);
  if(gp.ok){
    var cs = "";
    var glass = cutNow() ? ' opacity=".2"' : '';
    var lipO = proj(0, hZ, MDL.gateH + MDL.throatH + MDL.hopH), mid = proj(0, hZ, MDL.gateH + MDL.throatH);
    if(lipO.ok && mid.ok){
      var Rm = MDL.mouthR * lipO.sc, Rt = MDL.throatR * mid.sc;
      cs += '<path d="M' + (lipO.x-Rm).toFixed(1) + " " + lipO.y.toFixed(1) +
            ' L' + (mid.x-Rt).toFixed(1) + " " + mid.y.toFixed(1) +
            ' L' + (mid.x+Rt).toFixed(1) + " " + mid.y.toFixed(1) +
            ' L' + (lipO.x+Rm).toFixed(1) + " " + lipO.y.toFixed(1) +
            ' Z" fill="#8E4A17" stroke="#5A2606" stroke-width="0.9"' + glass + '/>';
      /* The opening. A flat dark ellipse reads as a lid; what makes it read as
         a hole is seeing the far inside wall of the bucket catching light
         through it, with the throat's own darkness below that. */
      var Ry = Math.abs(Rm * lipO.fs);
      cs += '<ellipse cx="' + lipO.x.toFixed(1) + '" cy="' + lipO.y.toFixed(1) + '" rx="' + Rm.toFixed(1) +
            '" ry="' + Ry.toFixed(1) + '" fill="#150A04"' + glass + '/>';
      if(Ry > 2.5) cs += '<path d="M' + (lipO.x-Rm*0.98).toFixed(1) + ' ' + lipO.y.toFixed(1) +
            ' A ' + (Rm*0.98).toFixed(1) + ' ' + Ry.toFixed(1) + ' 0 0 1 ' + (lipO.x+Rm*0.98).toFixed(1) +
            ' ' + lipO.y.toFixed(1) + ' A ' + (Rm*0.98).toFixed(1) + ' ' + (Ry*0.42).toFixed(1) +
            ' 0 0 0 ' + (lipO.x-Rm*0.98).toFixed(1) + ' ' + lipO.y.toFixed(1) +
            ' Z" fill="#5A2C12"' + glass + '/>';
      cs += '<ellipse cx="' + lipO.x.toFixed(1) + '" cy="' + lipO.y.toFixed(1) + '" rx="' + Rm.toFixed(1) +
            '" ry="' + Ry.toFixed(1) + '" fill="none" stroke="#F09A4E" stroke-width="' + edgeW(2.6) + '"' + glass + '/>';
    }
    cs += (cutNow() ? '<g opacity=".2">' : '') +
          cylinder(0, hZ, MDL.gateH, MDL.gateH + MDL.throatH, MDL.throatR, "#242A2C", "#12171A", "#0D1112") +
          (cutNow() ? '</g>' : '');
    /* stage 1: the two proximity heads on their wooden blocks, facing each
       other across the bore, and stage 2's infrared just under them */
    [{X:-98, f:1, name:"D3 · CAPACITIVE", body:"#247B84", cap:"#5FD0D8", edge:"#123F46"},
     {X:98, f:-1, name:"D4 · INDUCTIVE", body:"#C9922F", cap:"#F0C758", edge:"#8E6C36"}].forEach(function(q){
      var bp = proj(q.X, hZ, MDL.gateH + 34);
      if(!bp.ok) return;
      cs += solid(boxPts(q.X, hZ, 30, 28), MDL.gateH + 8, MDL.gateH + 60, "#C9A063", "#9B7A44", "#7E5B2C");
      cs += cylinder(q.X + q.f * 30, hZ, MDL.gateH + 24, MDL.gateH + 44, 13, q.body, q.cap, q.edge);
      var tip = proj(q.X + q.f * 52, hZ, MDL.gateH + 34);
      if(tip.ok) cs += '<circle cx="' + tip.x.toFixed(1) + '" cy="' + tip.y.toFixed(1) + '" r="' +
        Math.max(1, 11*tip.sc).toFixed(1) + '" fill="' + q.cap + '" stroke="' + q.edge + '" stroke-width="0.9"/>' +
        tag(tip, q.name, MDL_COL.ink, "middle", -18 * tip.sc);
    });
    cs += solid(boxPts(74, hZ - 4, 22, 14), MDL.gateH + 2, MDL.gateH + 16, "#B33D48", "#76232C", "#42141A");
    /* with the chute sectioned, draw what it is actually for */
    if(cutNow()){
      var t1 = proj(-52, hZ, MDL.gateH + 34), t2 = proj(52, hZ, MDL.gateH + 34);
      if(t1.ok && t2.ok){
        cs += '<line x1="'+t1.x.toFixed(1)+'" y1="'+t1.y.toFixed(1)+'" x2="'+t2.x.toFixed(1)+'" y2="'+t2.y.toFixed(1)+
              '" stroke="#5FE3CF" stroke-width="'+Math.max(1, 5*t1.sc).toFixed(1)+'" stroke-dasharray="6 5"/>';
        cs += tag(proj(0, hZ, MDL.gateH + 34), "128 mm of clear air", "#5FE3CF", "middle", -20*t1.sc);
      }
      var i1 = proj(60, hZ - 4, MDL.gateH + 10), i2 = proj(-20, hZ + 6, MDL.gateH + 10);
      if(i1.ok && i2.ok) cs += '<line x1="'+i1.x.toFixed(1)+'" y1="'+i1.y.toFixed(1)+'" x2="'+i2.x.toFixed(1)+
        '" y2="'+i2.y.toFixed(1)+'" stroke="#5FE3CF" stroke-width="'+Math.max(0.8, 4*i1.sc).toFixed(1)+
        '" stroke-dasharray="4 4" opacity=".8"/>';
    }
    var g = W.gate * Math.PI / 180, hX = -MDL.throatR;
    var tipX = hX + MDL.gateL * Math.cos(g), tipH = MDL.gateH - MDL.gateL * Math.sin(g);
    var g1 = proj(hX, hZ - MDL.throatR, MDL.gateH), g2 = proj(hX, hZ + MDL.throatR, MDL.gateH),
        g3 = proj(tipX, hZ + MDL.throatR, tipH), g4 = proj(tipX, hZ - MDL.throatR, tipH);
    if(g1.ok && g2.ok && g3.ok && g4.ok){
      cs += '<polygon points="' + xy(g1)+" "+xy(g2)+" "+xy(g3)+" "+xy(g4) +
            '" fill="' + (W.gate > 40 ? "#6E7A7E" : "#B3BEC1") + '" stroke="#454E51" stroke-width="0.9"/>';
      cs += '<circle cx="' + ((g1.x+g2.x)/2).toFixed(1) + '" cy="' + ((g1.y+g2.y)/2).toFixed(1) +
            '" r="' + Math.max(1.2, 7*g1.sc).toFixed(1) + '" fill="#5B6467" stroke="#20272A" stroke-width="0.9"/>';
      cs += tag(proj(hX, hZ, MDL.gateH), W.gate > 40 ? "GATE OPEN" : "GATE SHUT",
                W.gate > 40 ? "#F2685E" : C.ink, "middle", 40 * g1.sc);
    }
    put(gp.d, cs);
  }

  /* 9 · the waste, wherever the simulation currently has it */
  if(item && W.itemKind){
    var frac = Math.max(0, Math.min(1, (item.y - MOUTH.y) / (PLAT.y - MOUTH.y)));
    var ip = proj(0, hZ, MDL.gateH + MDL.throatH + MDL.hopH - frac * (MDL.hopH + MDL.throatH + 180));
    if(ip.ok) put(ip.d + 1, '<circle cx="' + ip.x.toFixed(1) + '" cy="' + ip.y.toFixed(1) +
      '" r="' + Math.max(1.5, 14 * ip.sc).toFixed(1) + '" fill="' +
      (KIND[W.itemKind] && IDX[KIND[W.itemKind].cls] !== undefined
        ? BINS[IDX[KIND[W.itemKind].cls]].waste : "#C9D2D8") +
      '" stroke="#12181A" stroke-width="1"/>');
  }
}

/* --------------------- everybody else in the room ---------------------
   The same eight people who are drawn in the scene at the top, built as
   solids you can walk round. The head is the exception: it is a billboard,
   because a face made of projected polygons at four metres is a smudge and
   what you want from across a room is to recognise who is talking.

   A billboard that always shows a full face makes everybody stare at you,
   which is wrong and, in a defense, misleading — the group face their panel.
   So the head is drawn TURNED: `toward` is how squarely they face the camera
   and `side` is which way their nose points across the screen, and the
   features slide and foreshorten with both. Past about a right angle you get
   the back of their head. Nobody smiles either, until the panel actually
   claps, which is exactly when the drawing above starts smiling too.

   Every look is read off that drawing, so the girl with the ponytail here is
   the girl with the ponytail there.                                      */
var STU_LOOK = [
  {skin:"#E9B98F", line:"#B77F52", hair:"#2A2320", style:"pony",  top:"#F4F5F0", skirt:"#2B3550", clip:"#C94F7C", lip:"#8A4A38"},
  {skin:"#8C5A3C", line:"#5E3A22", hair:"#241A12", style:"short", top:"#F1F3EE", legs:"#241E1A", lip:"#6E3628"},
  {skin:"#C98E62", line:"#96633C", hair:"#3A2A16", style:"short", top:"#F4F5F0", legs:"#2F3947", tag:"#2B4C7E", lip:"#8A4A38"},
  {skin:"#D9A377", line:"#A87246", hair:"#1E1A18", style:"long",  top:"#FBFCF7", skirt:"#2F3947", tag:"#2B4C7E", lip:"#8A4A38"},
  {skin:"#A8703F", line:"#77492A", hair:"#241A12", style:"curly", top:"#F1F3EE", legs:"#46414F", lip:"#6E3628"}
];
var PAN_LOOK = [
  {skin:"#E9B98F", line:"#B77F52", hair:"#2A2320", style:"glasses", top:"#4A5568", legs:"#2F3947", lip:"#8A4A38"},
  {skin:"#C98E62", line:"#96633C", hair:"#3A2A16", style:"long",    top:"#6B4E3D", legs:"#46414F", lip:"#8A4A38"},
  {skin:"#8C5A3C", line:"#5E3A22", hair:"#241A12", style:"beard",   top:"#3D5A66", legs:"#2B3F49", lip:"#6E3628"}
];
/* a head at (cx,cy) with skull radius R, turned by `toward` and `side` */
function head(cx, cy, R, L, toward, side, talking, glad){
  var o = "", n = function(v){ return v.toFixed(2); };
  var faceUs = toward > -0.08;
  var sx = Math.max(0.16, Math.min(1, Math.abs(toward)));  /* how square-on we see it */
  var fx = side * 0.34 * R;                                /* the features slide with the nose */
  var hx = -side * 0.13 * R;                               /* and the hair slides the other way */
  var sw = Math.max(0.35, 0.075 * R);

  /* whatever hangs behind the skull goes down first */
  if(L.style === "long")
    o += '<ellipse cx="'+n(cx+hx*1.5)+'" cy="'+n(cy+0.20*R)+'" rx="'+n(1.22*R)+'" ry="'+n(1.40*R)+'" fill="'+L.hair+'"/>';
  if(L.style === "pony")
    o += '<ellipse cx="'+n(cx-side*0.98*R-0.10*R)+'" cy="'+n(cy+0.34*R)+'" rx="'+n(0.38*R)+'" ry="'+n(0.84*R)+'" fill="'+L.hair+'"/>';

  o += '<circle cx="'+n(cx)+'" cy="'+n(cy)+'" r="'+n(R)+'" fill="'+L.skin+'" stroke="'+L.line+'" stroke-width="'+n(sw)+'"/>';

  if(!faceUs){                                             /* the back of the head */
    o += '<path d="M'+n(cx-R)+' '+n(cy+0.14*R)+' A '+n(R)+' '+n(R)+' 0 0 1 '+n(cx+R)+' '+n(cy+0.14*R)+' Z" fill="'+L.hair+'"/>';
    o += '<ellipse cx="'+n(cx)+'" cy="'+n(cy-0.06*R)+'" rx="'+n(0.96*R)+'" ry="'+n(0.80*R)+'" fill="'+L.hair+'"/>';
    if(L.style === "curly") for(var q = 0; q < 4; q++)
      o += '<circle cx="'+n(cx-0.60*R+q*0.40*R)+'" cy="'+n(cy-0.84*R)+'" r="'+n(0.30*R)+'" fill="'+L.hair+'"/>';
    if(L.style === "pony") o += '<circle cx="'+n(cx)+'" cy="'+n(cy+0.30*R)+'" r="'+n(0.22*R)+'" fill="'+L.hair+'"/>';
    return o;
  }
  /* the hairline, by style, shifted round the skull with the turn */
  if(L.style === "curly"){
    for(var k = 0; k < 5; k++)
      o += '<circle cx="'+n(cx+hx-0.76*R+k*0.38*R)+'" cy="'+n(cy-0.80*R-(k%2)*0.10*R)+'" r="'+n(0.34*R)+'" fill="'+L.hair+'"/>';
  } else {
    o += '<path d="M'+n(cx+hx-R)+' '+n(cy-0.10*R)+' A '+n(R)+' '+n(R)+' 0 0 1 '+n(cx+hx+R)+' '+n(cy-0.10*R)+
         ' L'+n(cx+hx+R)+' '+n(cy-0.46*R)+' Q '+n(cx+hx)+' '+n(cy-1.20*R)+' '+n(cx+hx-R)+' '+n(cy-0.46*R)+' Z" fill="'+L.hair+'"/>';
  }
  if(L.style === "long"){                                  /* it falls past the jaw, both sides */
    [-1, 1].forEach(function(d){
      var w = 0.62 + (d * side < 0 ? 0.22 : 0);            /* wider on the side turned away */
      o += '<path d="M'+n(cx+hx+d*0.98*R)+' '+n(cy-0.14*R)+' Q '+n(cx+hx+d*1.24*R)+' '+n(cy+1.02*R)+' '+
           n(cx+hx+d*0.84*R)+' '+n(cy+1.50*R)+' L'+n(cx+hx+d*(0.84-w*0.46)*R)+' '+n(cy+1.42*R)+' Q '+
           n(cx+hx+d*(w+0.10)*R)+' '+n(cy+0.60*R)+' '+n(cx+hx+d*w*R)+' '+n(cy-0.08*R)+' Z" fill="'+L.hair+'"/>';
    });
  }
  if(L.clip) o += '<circle cx="'+n(cx+hx+side*0.50*R)+'" cy="'+n(cy-0.60*R)+'" r="'+n(0.14*R)+'" fill="'+L.clip+'"/>';

  /* the face itself, sliding and foreshortening with the turn */
  var f = '';
  f += '<path d="M'+n(-0.56*R)+' '+n(-0.30*R)+' q '+n(0.24*R)+' '+n(-0.12*R)+' '+n(0.44*R)+' 0'+
       ' M'+n(0.12*R)+' '+n(-0.30*R)+' q '+n(0.24*R)+' '+n(-0.12*R)+' '+n(0.44*R)+' 0" fill="none" stroke="'+
       L.hair+'" stroke-width="'+n(sw)+'" stroke-linecap="round"/>';
  f += '<ellipse cx="'+n(-0.34*R)+'" cy="'+n(-0.06*R)+'" rx="'+n(0.105*R)+'" ry="'+n(0.14*R)+'" fill="#201812"/>';
  f += '<ellipse cx="'+n(0.34*R)+'" cy="'+n(-0.06*R)+'" rx="'+n(0.105*R)+'" ry="'+n(0.14*R)+'" fill="#201812"/>';
  if(L.style === "glasses"){
    f += '<rect x="'+n(-0.60*R)+'" y="'+n(-0.26*R)+'" width="'+n(0.44*R)+'" height="'+n(0.36*R)+
         '" rx="'+n(0.12*R)+'" fill="none" stroke="'+L.hair+'" stroke-width="'+n(sw*0.9)+'"/>' +
         '<rect x="'+n(0.16*R)+'" y="'+n(-0.26*R)+'" width="'+n(0.44*R)+'" height="'+n(0.36*R)+
         '" rx="'+n(0.12*R)+'" fill="none" stroke="'+L.hair+'" stroke-width="'+n(sw*0.9)+'"/>' +
         '<path d="M'+n(-0.16*R)+' '+n(-0.08*R)+' L'+n(0.16*R)+' '+n(-0.08*R)+'" stroke="'+L.hair+
         '" stroke-width="'+n(sw*0.9)+'"/>';
  }
  /* the beard hugs the jaw — it is not a crescent under the nose, which is
     what made him look as though he was grinning at you */
  if(L.style === "beard")
    f += '<path d="M'+n(-0.79*R)+' '+n(0.32*R)+' Q '+n(-0.68*R)+' '+n(1.16*R)+' 0 '+n(1.26*R)+
         ' Q '+n(0.68*R)+' '+n(1.16*R)+' '+n(0.79*R)+' '+n(0.32*R)+
         ' Q '+n(0.58*R)+' '+n(0.95*R)+' 0 '+n(1.00*R)+
         ' Q '+n(-0.58*R)+' '+n(0.95*R)+' '+n(-0.79*R)+' '+n(0.32*R)+' Z" fill="'+L.hair+'"/>';
  /* the mouth is a line, not a smile. It opens while they speak, and it only
     curves up when the panel is actually applauding. */
  if(glad && !talking)
    f += '<path d="M'+n(-0.40*R)+' '+n(0.44*R)+' Q 0 '+n(0.86*R)+' '+n(0.40*R)+' '+n(0.44*R)+
         '" fill="none" stroke="'+L.lip+'" stroke-width="'+n(sw*1.15)+'" stroke-linecap="round"/>';
  else
    f += '<ellipse cx="0" cy="'+n(0.52*R)+'" rx="'+n(0.19*R)+'" ry="'+n(talking ? 0.19*R : 0.045*R)+'" fill="'+L.lip+'"/>';
  o += '<g transform="translate('+n(cx+fx)+' '+n(cy)+') scale('+n(sx)+' 1)">' + f + '</g>';

  /* well turned: put a nose on the silhouette, so a profile reads as a profile */
  if(sx < 0.78){
    var d2 = side >= 0 ? 1 : -1;
    o += '<path d="M'+n(cx+d2*0.80*R)+' '+n(cy-0.12*R)+' Q '+n(cx+d2*1.16*R)+' '+n(cy+0.06*R)+' '+
         n(cx+d2*0.76*R)+' '+n(cy+0.26*R)+' Z" fill="'+L.skin+'" stroke="'+L.line+'" stroke-width="'+n(sw*0.8)+'"/>';
  }
  return o;
}
/* ---------------------------- arms and hands --------------------------
   Everybody in this room had legs, a body and a head and nothing in
   between the shoulders. That is fine at the back of a wide shot and
   wrong the moment you walk up to them, because in a defence the arms
   are half of what a person is doing: the one presenting points at the
   part they are naming, the panel writes while they listen, and at the
   end they clap.

   The limbs are drawn in screen space between two points in the room
   rather than as standing cylinders, because an arm lies at any angle.
   Hands get fingers, and the fingers are dropped when they would come
   out under about a pixel and a half — at that size they are noise. */
/* Both ends of a limb, with the near plane taken into account. Walk up to
   somebody and their hand comes closer than the camera's near plane; dropping
   the whole segment then makes the arm vanish off a person who is standing
   right in front of you, which is the one moment you were looking at it. The
   end that is too close is walked back along the limb until it projects, so
   the arm is cut off at the plane instead of thrown away.                  */
function projSeg(a, b){
  var pa = proj(a.X, a.Z, a.h), pb = proj(b.X, b.Z, b.h);
  if(pa.ok && pb.ok) return [pa, pb];
  if(!pa.ok && !pb.ok) return null;
  var A = pa.ok ? a : b, B = pa.ok ? b : a, lo = 0, hi = 1, m, p, best = null;
  for(var i = 0; i < 7; i++){
    m = (lo + hi) / 2;
    p = proj(A.X + (B.X - A.X) * m, A.Z + (B.Z - A.Z) * m, A.h + (B.h - A.h) * m);
    if(p.ok){ lo = m; best = p; } else hi = m;
  }
  if(!best) return null;
  return pa.ok ? [pa, best] : [best, pb];
}
function limb(a, b, w, col, edge){
  var seg = projSeg(a, b);
  if(!seg) return "";
  var pa = seg[0], pb = seg[1];
  var t = Math.max(0.7, w * (pa.sc + pb.sc) / 2);
  var d = 'M' + pa.x.toFixed(1) + ' ' + pa.y.toFixed(1) + ' L' + pb.x.toFixed(1) + ' ' + pb.y.toFixed(1);
  /* the edge first, a little wider: without it a white sleeve on a white
     shirt is an arm you cannot see, which is worse than no arm at all */
  return (edge && t > 2 ? '<path d="' + d + '" stroke="' + edge + '" stroke-width="' + (t + 1.6).toFixed(1) +
          '" stroke-linecap="round" fill="none"/>' : "") +
         '<path d="' + d + '" stroke="' + col + '" stroke-width="' + t.toFixed(1) +
         '" stroke-linecap="round" fill="none"/>';
}
/* The hand on the end of a forearm. A palm with a wrist and a knuckle line,
   four fingers of four different lengths that bend at the knuckle, and a
   thumb on the correct side of it. They curl when the hand is at rest, open
   out when somebody is talking with their hands, and go to one straight
   finger with the rest folded when they point at something.

   It is drawn in screen space along the forearm, so it works from any angle,
   and the fingers are dropped only when they would come out under about a
   pixel and a half — which is far enough away that they would be noise. */
function handAt(wrist, elbow, L, o){
  o = o || {};
  var seg = projSeg(elbow, wrist);
  if(!seg) return "";
  var pe = seg[0], pw = seg[1];
  var dx = pw.x - pe.x, dy = pw.y - pe.y, m = Math.sqrt(dx*dx + dy*dy) || 1;
  dx /= m; dy /= m;
  var px = -dy, py = dx;                                  /* across the hand */
  var k = pw.sc, W = Math.max(0.8, 44 * k), PL = Math.max(1, 58 * k);
  function rot(ang, len){
    var c = Math.cos(ang), sn = Math.sin(ang);
    return {x:(dx*c - dy*sn) * len, y:(dx*sn + dy*c) * len};
  }
  /* the palm: wrist end narrow, knuckle end wide, and a little rounded */
  var kx = pw.x + dx * PL, ky = pw.y + dy * PL;
  var s = '<path d="M' + (pw.x - px*W*0.62).toFixed(1) + ' ' + (pw.y - py*W*0.62).toFixed(1) +
          ' L' + (kx - px*W*0.9).toFixed(1) + ' ' + (ky - py*W*0.9).toFixed(1) +
          ' Q' + (kx + dx*W*0.35).toFixed(1) + ' ' + (ky + dy*W*0.35).toFixed(1) +
          ' ' + (kx + px*W*0.9).toFixed(1) + ' ' + (ky + py*W*0.9).toFixed(1) +
          ' L' + (pw.x + px*W*0.62).toFixed(1) + ' ' + (pw.y + py*W*0.62).toFixed(1) +
          ' Z" fill="' + L.skin + '"' + (W > 2 ? ' stroke="' + L.line + '" stroke-width="' +
          Math.max(0.4, W*0.11).toFixed(1) + '" stroke-linejoin="round"' : "") + '/>';
  var base = (o.index ? 96 : o.open ? 86 : 74) * k;       /* full finger length */
  if(base < 1.5) return s;                                /* too far to be anything but noise */
  var fw = Math.max(0.6, 15 * k);
  /* index, middle, ring, little — different lengths, spread across the knuckles */
  var LEN = [0.95, 1, 0.93, 0.78], POS = [-0.86, -0.29, 0.29, 0.84];
  for(var i = 0; i < 4; i++){
    var curl = o.index ? (i === 0 ? 0.06 : 1.5)           /* pointing: one out, three folded */
             : o.open  ? 0.10
             :           0.62;                            /* at rest the fingers curl in */
    var len = base * LEN[i] * (o.index && i > 0 ? 0.5 : 1);
    var spread = (o.open ? 0.17 : 0.07) * POS[i] * (o.index && i > 0 ? 0 : 1);
    var bx = kx + px * POS[i] * W * 0.82, by = ky + py * POS[i] * W * 0.82;
    var mid = rot(spread + curl * 0.35, len * 0.55), tip = rot(spread + curl, len);
    s += '<path d="M' + bx.toFixed(1) + ' ' + by.toFixed(1) +
         ' Q' + (bx + mid.x).toFixed(1) + ' ' + (by + mid.y).toFixed(1) +
         ' ' + (bx + tip.x).toFixed(1) + ' ' + (by + tip.y).toFixed(1) +
         '" fill="none" stroke="' + L.skin + '" stroke-width="' + (fw * (i === 3 ? 0.82 : 1)).toFixed(1) +
         '" stroke-linecap="round"/>';
  }
  /* the thumb: shorter, thicker, off the side of the palm rather than the end */
  var ta = (o.open ? 1.0 : 0.72) * (o.side || 1) * (o.index ? 1.25 : 1);
  var tb = {x:pw.x + dx*PL*0.42 + px*W*0.88*(o.side || 1), y:pw.y + dy*PL*0.42 + py*W*0.88*(o.side || 1)};
  var tmid = rot(ta * 0.5, base * 0.34), ttip = rot(ta, base * 0.6);
  s += '<path d="M' + tb.x.toFixed(1) + ' ' + tb.y.toFixed(1) +
       ' Q' + (tb.x + tmid.x).toFixed(1) + ' ' + (tb.y + tmid.y).toFixed(1) +
       ' ' + (tb.x + ttip.x).toFixed(1) + ' ' + (tb.y + ttip.y).toFixed(1) +
       '" fill="none" stroke="' + L.skin + '" stroke-width="' + (fw * 1.25).toFixed(1) +
       '" stroke-linecap="round"/>';
  if(o.pen && base > 2.2)                                 /* the panel holds a pen, not a mime */
    s += '<path d="M' + (kx - dx*base*0.3 - px*base*0.26).toFixed(1) + ' ' +
         (ky - dy*base*0.3 - py*base*0.26).toFixed(1) +
         ' L' + (kx + dx*base*0.66 + px*base*0.3).toFixed(1) + ' ' +
         (ky + dy*base*0.66 + py*base*0.3).toFixed(1) +
         '" stroke="#1B3A6B" stroke-width="' + Math.max(0.6, fw*0.75).toFixed(1) +
         '" stroke-linecap="round"/>';
  return s;
}

function person(X, Z, facing, h, L, label, lit, talking, seated, gait, act){
  var f = proj(X, Z, 0);
  if(!f.ok) return null;
  var s = "", legT = h * 0.47, torsoT = h * 0.86, headR = h * 0.078, seatTorso = "";
  var G = gait || null, lift = G ? G.alt || 0 : 0;
  /* his legs swing fore and aft as he walks, and his body bobs with the stride */
  var swing = (G && G.moving && !G.fly) ? Math.sin(G.ph) * 165 : 0;
  var bob   = (G && G.moving && !G.fly) ? Math.abs(Math.sin(G.ph)) * 26 : 0;
  var gfx = Math.sin(facing*Math.PI/180), gfz = Math.cos(facing*Math.PI/180);
  if(seated){
    /* Sitting is not standing with the legs hidden: the shins go down in front
       of the seat, the thighs run forward under the table, and the chair is
       behind them. Seat 450 mm, so the eye lands about 1250 — which is what
       the "where the panel sits" viewpoint is set to. */
    var fx0 = Math.sin(facing*Math.PI/180), fz0 = Math.cos(facing*Math.PI/180);
    var rx0 = fz0, rz0 = -fx0, seat = 450;
    torsoT = seat + h * 0.36; headR = h * 0.078;
    /* the chair: four legs, a seat and a back */
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(c){
      var lx = X + rx0*c[0]*170 - fx0*(c[1] > 0 ? -140 : 190),
          lz = Z + rz0*c[0]*170 - fz0*(c[1] > 0 ? -140 : 190);
      s += cylinder(lx, lz, 0, seat - 30, 18, "#3A3028", "#3A3028", "#241E18");
    });
    s += solid(quadAt(X, Z, fx0, fz0, 210, 160, 200), seat - 30, seat, "#5E4636", "#4A362A", "#2E2018");
    s += solid(quadAt(X, Z, fx0, fz0, 250, -190, 190), seat, seat + 520, "#5E4636", "#4A362A", "#2E2018");
    /* shins, thighs, then the body */
    [-1, 1].forEach(function(c){
      s += cylinder(X + rx0*c*55 + fx0*230, Z + rz0*c*55 + fz0*230, 0, seat - 40, 44,
                    L.legs || L.skirt, L.legs || L.skirt, "#161C22");
    });
    s += solid(quadAt(X, Z, fx0, fz0, 60, 250, 150), seat - 40, seat + 60, L.legs || L.skirt,
               L.legs || L.skirt, "#161C22");
    seatTorso = cone(X, Z, seat + 40, torsoT, 128, 118, L.top, L.top, "#8E968E");
  } else if(L.skirt){
    s += cylinder(X - 46, Z, lift, lift + legT * 0.62, 34, L.skin, L.skin, L.line);
    s += cylinder(X + 46, Z, lift, lift + legT * 0.62, 34, L.skin, L.skin, L.line);
    s += cone(X, Z, lift + legT * 0.56, lift + legT, 150, 96, L.skirt, L.skirt, "#161C22");
  } else {
    var lrx = gfz, lrz = -gfx;                         /* his right, on the floor */
    s += cylinder(X + lrx*-55 + gfx*swing, Z + lrz*-55 + gfz*swing,
                  lift + (G && G.fly ? 60 : 0), lift + legT, 44, L.legs, L.legs, "#161C22");
    s += cylinder(X + lrx*55 - gfx*swing, Z + lrz*55 - gfz*swing,
                  lift + (G && G.fly ? 60 : 0), lift + legT, 44, L.legs, L.legs, "#161C22");
  }
  /* ---- the arms, posed by what this person is doing ---- */
  var A = act || {}, mode = A.mode || (G && G.moving ? "walk" : seated ? "knees" : "rest");
  var now = (A.t !== undefined ? A.t : Date.now() / 1000);
  /* an idle sway that only moves six times a second, so a room where nobody
     is doing anything still writes nothing to the page most frames */
  var slow = Math.round(now * 6) / 6;
  var shH = (seated ? torsoT : torsoT + bob) - 62, arm = h * 0.185, fore = h * 0.16;
  var bfx = Math.sin(facing*Math.PI/180), bfz = Math.cos(facing*Math.PI/180);
  var brx = bfz, brz = -bfx;                              /* their right, on the floor */
  function at(fwd, right, up){
    return {X:X + bfx*fwd + brx*right, Z:Z + bfz*fwd + brz*right, h:lift + shH + up};
  }
  /* which arm is on the camera's side, so the near one draws over the body */
  var cvx, cvz;
  if(VIEW.mode === "persp"){ cvx = VIEW.x - X; cvz = VIEW.z - Z; }
  else { var av = VIEW.az * Math.PI/180; cvx = Math.sin(av)*1e6; cvz = Math.cos(av)*1e6; }
  var nearSide = (brx*cvx + brz*cvz) >= 0 ? 1 : -1;
  var armFar = "", armNear = "";
  [1, -1].forEach(function(side){
    var sh = at(0, side * h * 0.087, 0), el, wr, o = {side:side};
    /* the arm is drawn from a socket inside the body, not from the joint: a
       shoulder on the outside of the silhouette leaves a gap you can see the
       moment you walk up to somebody */
    var sock = at(6, side * h * 0.070, -12);
    var gest = (side === 1);                              /* the right hand does the talking */
    if(mode === "walk"){
      var sw = -Math.sin((G && G.ph) || 0) * side;
      el = at(sw*120, side*162, -arm + Math.abs(sw)*18);
      wr = at(sw*235, side*176, -arm - fore + Math.abs(sw)*34);
    } else if(mode === "point" && gest && A.aim){
      var dx = A.aim.X - sh.X, dz = A.aim.Z - sh.Z, dh = (A.aim.h || 800) - sh.h;
      var m = Math.sqrt(dx*dx + dz*dz + dh*dh) || 1, reach = (arm + fore) * 0.96;
      el = {X:sh.X + dx/m*reach*0.5, Z:sh.Z + dz/m*reach*0.5, h:sh.h + dh/m*reach*0.5 - 40};
      wr = {X:sh.X + dx/m*reach, Z:sh.Z + dz/m*reach, h:sh.h + dh/m*reach};
      o.index = true;
    } else if(mode === "talk" && gest){
      el = at(85, side*176, -arm*0.95);
      wr = at(315 + Math.sin(now*2.6)*70, side*(126 + Math.sin(now*1.9)*54),
              -arm*0.55 + Math.sin(now*3.3)*80);
      o.open = true;
    } else if(mode === "clap"){
      var gap = 60 + Math.abs(Math.sin(now * (A.tempo || 7))) * 190;
      el = at(95, side*170, -arm*0.92);
      wr = at(285, side*gap*0.34, -arm*0.5);
      o.open = true;
    } else if(mode === "write"){
      var deskH = A.deskH || 760;
      var wig = (gest && !A.still) ? Math.sin(now*6.5)*26 : 0;
      el = at(110, side*166, -arm*0.86);
      wr = {X:X + bfx*(285 + wig) + brx*side*(gest ? 55 : 120),
            Z:Z + bfz*(285 + wig) + brz*side*(gest ? 55 : 120),
            h:lift + deskH + 34};
      o.pen = gest;
    } else if(mode === "knees"){
      el = at(60, side*168, -arm*0.9);
      wr = at(250, side*150, -arm*0.9 - fore*0.55);
    } else if(mode === "clasp"){
      el = at(30, side*158, -arm + Math.sin(slow*1.1 + side)*6);
      wr = at(215, side*38, -arm - fore*0.72);
    } else {                                              /* at rest, and breathing */
      el = at(18, side*164, -arm + Math.sin(slow*1.1 + side)*6);
      wr = at(46, side*178, -arm - fore + Math.sin(slow*1.1 + side)*8);
    }
    var piece = limb(sock, el, 54, L.top, "#8E968E") + limb(el, wr, 44, L.skin, L.line) +
                handAt(wr, el, L, o);
    if(side === nearSide) armNear += piece; else armFar += piece;
  });

  if(!seated){
    s += armFar;
    s += cone(X, Z, lift + legT + bob, lift + torsoT + bob, 128, 118, L.top, L.top, "#8E968E");
    s += armNear;
  } else { s += armFar + seatTorso + armNear; }
  legT += bob; torsoT += bob;
  if(L.tag){
    var lp = proj(X, Z, torsoT - 130);
    if(lp.ok) s += '<rect x="'+(lp.x - 13*lp.sc).toFixed(1)+'" y="'+(lp.y - 16*lp.sc).toFixed(1)+
      '" width="'+(26*lp.sc).toFixed(1)+'" height="'+(34*lp.sc).toFixed(1)+
      '" rx="1.5" fill="'+L.tag+'" stroke="#17304F" stroke-width="0.6"/>';
  }
  s += cylinder(X, Z, lift + torsoT, lift + torsoT + headR * 0.55, 40, L.skin, L.skin, L.line);
  var hd = proj(X, Z, lift + torsoT + headR * 1.7);
  if(hd.ok){
    var R = Math.max(2.2, headR * hd.sc);
    /* which way are they turned, relative to where we are standing? */
    var a = (VIEW.mode === "persp" ? VIEW.yaw : VIEW.az) * Math.PI / 180;
    var rx = Math.cos(a), rz = -Math.sin(a);                /* screen-right, in the room */
    var fxv = Math.sin(facing*Math.PI/180), fzv = Math.cos(facing*Math.PI/180);
    var cx2, cz2;
    if(VIEW.mode === "persp"){ cx2 = VIEW.x - X; cz2 = VIEW.z - Z; }
    else { cx2 = Math.sin(a) * 1e6; cz2 = Math.cos(a) * 1e6; }
    var m = Math.sqrt(cx2*cx2 + cz2*cz2) || 1;
    var toward = (fxv*cx2 + fzv*cz2) / m;                   /* 1 = looking at us */
    var side = fxv*rx + fzv*rz;                             /* +1 = nose to screen right */
    var glad = applause.on || Date.now() < panelWarm;
    s += head(hd.x, hd.y, R, L, toward, side, talking, glad);
    if(talking){
      s += '<circle cx="'+hd.x.toFixed(1)+'" cy="'+hd.y.toFixed(1)+'" r="'+(R*2.05).toFixed(1)+
           '" fill="none" stroke="#5FE3CF" stroke-width="'+Math.max(1, R*0.13).toFixed(1)+'" opacity=".9"/>';
      s += tag(hd, "▸ speaking", "#5FE3CF", "middle", -R * 2.9);
    }
    if(label) s += tag(hd, label, lit ? "#DEE9E5" : MDL_COL.ink, "middle", -R * (talking ? 4.4 : 2.7));
  }
  return {d:f.d, s:s};
}

function fwdOf(X, Z, h){
  var yw = VIEW.yaw * Math.PI / 180;
  var hor = (X - VIEW.x) * Math.sin(yw) + (Z - VIEW.z) * Math.cos(yw);
  return hor * VIEW.cp + ((h || 0) - VIEW.eye) * VIEW.sp;
}
/* A grid line almost always runs from behind you to in front of you, so
   dropping the ones with an endpoint past the near plane throws the whole
   floor away. They are cut at the near plane instead. */
function floorLine(x0, z0, x1, z1, col){
  if(VIEW.mode === "persp"){
    var f0 = fwdOf(x0,z0,0), f1 = fwdOf(x1,z1,0), n = VIEW.near + 0.75, t;
    if(f0 < n && f1 < n) return "";
    if(f0 < n){ t = (n-f0)/(f1-f0); x0 += (x1-x0)*t; z0 += (z1-z0)*t; }
    else if(f1 < n){ t = (n-f1)/(f0-f1); x1 += (x0-x1)*t; z1 += (z0-z1)*t; }
  }
  var A = proj(x0,z0,0), B = proj(x1,z1,0);
  if(!A.ok || !B.ok) return "";
  return '<line x1="'+A.x.toFixed(1)+'" y1="'+A.y.toFixed(1)+'" x2="'+B.x.toFixed(1)+
         '" y2="'+B.y.toFixed(1)+'" stroke="'+col+'" stroke-width="0.8"/>';
}
/* ---------------------------- the laboratory ----------------------------
   The room in the scene at the top is a college laboratory, and this is the
   same laboratory in three dimensions: the pale walls with their chair rail
   and wainscot, the teal tiled floor, the fluorescents, the chalkboard with
   the project title on it, the clock, the notice board, the filing cabinet,
   the two computer desks, the socket the adapter lives in, the panel's table
   with the score sheets on it, the infeed conveyor, the solar stand and the
   three wheelie bins. Every colour is the drawing's own. Positions are laid
   out from the drawing's composition — panel far left, machine centre, bins
   right, conveyor and group near — at real distances in millimetres.      */
var ROOM = {
  x0:-4600, x1:3600, z0:-3600, z1:4500, ceil:3600,   /* a lab with room to fly in */
  stu:[{X:-3300,Z:-1100},{X:-2650,Z:-700},{X:-3100,Z:-100},{X:-2450,Z:300},{X:-1900,Z:700}],
  pan:[{X:-3200,Z:3900},{X:-2500,Z:3960},{X:-1800,Z:3900}],
  table:{X:-2500, Z:3400, w:2300, d:600, h:760},
  disp:[{X:2090,Z:-500},{X:2450,Z:-500},{X:2810,Z:-500}],
  belt:{X:-2600, Z:-1500, w:1900, d:420, h:800},
  solar:{X:-1350, Z:-750},
  board:{X:1970, w:1960, h0:1250, h1:2350},
  clock:{X:730, h:2350},
  notice:{X:-3900, w:520, h0:1500, h1:2100},
  cabinet:{X:-3950, Z:4250, w:480, d:450, h:1400},
  socket:{X:-3450, h:420},
  tarp:{X:-2500, w:2400, h0:1450, h1:2700},
  pc1:{X:-900, Z:4150, w:650, d:500, h:760},
  pc2:{X:2100, Z:4150, w:1750, d:500, h:760},
  half:4500
};
var LAB = {
  wall:"#DDE5DA", wallHi:"#EAEFE6", wainscot:"#C6D0C4", rail:"#A2AFA0", skirt:"#8C9A8A",
  floor:"#BACBC6", floorFar:"#9FB5B4", tile:"rgba(147,168,164,.34)", ceil:"#E6EBE3",
  lamp:"#E4EAE2", tube:"#FFFDEC", wood:"#8E6C36", woodDk:"#6E4E24", desk:"#C6A472", deskDk:"#9E7C4A",
  board:"#2A4835", boardDk:"#223B2C", chalk:"#E8F0E8", cork:"#C9B896", paper:"#F2F2EE",
  steel:"#9AA6A4", steelDk:"#6E7C7A", mon:"#3A4448", screen:"#2E6FA8", screen2:"#1E3A5C",
  binBody:"#2E3538", binEdge:"#171C1E", wheel:"#14181A"
};

/* a polygon in the room, cut at the near plane before it is projected, so a
   wall you are standing against does not fold over the picture */
function clipPoly(pts){
  if(VIEW.mode !== "persp") return pts.map(function(p){ return proj(p.X,p.Z,p.h); });
  var n = VIEW.near + 0.75, out = [], N = pts.length;
  for(var i = 0; i < N; i++){
    var a = pts[i], b = pts[(i+1)%N], fa = fwdOf(a.X,a.Z,a.h), fb = fwdOf(b.X,b.Z,b.h);
    if(fa >= n) out.push(a);
    if((fa >= n) !== (fb >= n)){
      var t = (n - fa) / (fb - fa);
      out.push({X:a.X+(b.X-a.X)*t, Z:a.Z+(b.Z-a.Z)*t, h:a.h+(b.h-a.h)*t});
    }
  }
  if(out.length < 3) return null;
  var q = out.map(function(p){ return proj(p.X,p.Z,p.h); });
  for(var j = 0; j < q.length; j++) if(!q[j].ok) return null;
  return q;
}
function poly(pts, fill, stroke, sw){
  var q = clipPoly(pts); if(!q) return "";
  return '<polygon points="' + q.map(xy).join(" ") + '" fill="' + fill + '"' +
         (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw||0.8) + '"' : '') + '/>';
}
/* a vertical panel on a wall: (X0,Z0)->(X1,Z1) between two heights */
function wallPanel(X0,Z0,X1,Z1,h0,h1,fill,stroke,sw){
  return poly([{X:X0,Z:Z0,h:h0},{X:X1,Z:Z1,h:h0},{X:X1,Z:Z1,h:h1},{X:X0,Z:Z0,h:h1}], fill, stroke, sw);
}
function floorQuad(x0,z0,x1,z1,h,fill,stroke){
  return poly([{X:x0,Z:z0,h:h},{X:x1,Z:z0,h:h},{X:x1,Z:z1,h:h},{X:x0,Z:z1,h:h}], fill, stroke);
}
/* Map a flat rectangle hanging on a wall onto the screen, so that anything
   drawn inside it in its own flat coordinates lands ON the wall and leans with
   it, instead of floating square-on in front of it. Three projected corners
   give the affine matrix; a wall panel is small enough that the difference
   between that and a true perspective map is not worth the arithmetic. */
function onWall(X0, Z0, X1, Z1, h0, h1, W, H, inner){
  var p00 = proj(X0, Z0, h1), p10 = proj(X1, Z1, h1), p01 = proj(X0, Z0, h0);
  if(!p00.ok || !p10.ok || !p01.ok) return "";
  var m = [(p10.x-p00.x)/W, (p10.y-p00.y)/W, (p01.x-p00.x)/H, (p01.y-p00.y)/H, p00.x, p00.y];
  if(Math.abs(m[0]) + Math.abs(m[1]) < 0.004) return "";      /* edge-on: nothing to see */
  return '<g transform="matrix(' + m.map(function(v){ return v.toFixed(5); }).join(" ") + ')">' +
         inner + '</g>';
}
/* a small picture stuck flat to a wall — the clock, a sheet, a socket — sized
   by distance like everything else */
function billboard(X, Z, h, w, ht, inner){
  var p = proj(X, Z, h); if(!p.ok || p.sc < 0.02) return "";
  var W2 = w * p.sc, H2 = ht * p.sc;
  return inner(p, W2, H2);
}

/* Where a speaker points. The presentation already knows which part each
   section is about — it walks the camera there — so the arm goes to the same
   place, and a section that is about the group or the panel gets no point at
   all, because pointing at nothing is worse than not pointing.           */
var AIM = null;
function aims(){
  if(AIM) return AIM;
  var mt = MDL.mastB * Math.PI / 180;
  AIM = {
    all:      {X:0, Z:MDL.hole, h:MDL.gateH},
    machine:  {X:0, Z:MDL.hole, h:MDL.gateH},
    mouth:    {X:0, Z:MDL.hole, h:MDL.gateH + MDL.throatH + MDL.hopH * 0.6},
    bore:     {X:0, Z:MDL.hole, h:MDL.gateH + MDL.throatH},
    throat:   {X:0, Z:MDL.hole, h:MDL.gateH + MDL.throatH * 0.5},
    gate:     {X:0, Z:MDL.hole, h:MDL.gateH},
    lower:    {X:0, Z:0, h:MDL.plateH + 40},
    pedestal: {X:0, Z:0, h:MDL.plateH},
    bins:     {X:0, Z:0, h:MDL.plateH + MDL.binH},
    clear:    {X:0, Z:0, h:MDL.plateH + MDL.binH},
    us:       {X:MDL.postR * Math.sin(MDL.postB*Math.PI/180),
               Z:MDL.postR * Math.cos(MDL.postB*Math.PI/180), h:MDL.usH},
    brain:    {X:MDL.mastR * Math.sin(mt), Z:MDL.mastR * Math.cos(mt), h:MDL.ctrlH + 120}
  };
  return AIM;
}
function speakerAim(){
  if(!pres.on || pres.i < 0) return null;
  var st = stepAt(pres.i);
  return (st && aims()[st.view]) || null;
}
function roomInto(put){
  var C = LAB, talkStu = -1;
  if(pres.on && iv.side === "students" && iv.speaker >= 0) talkStu = iv.speaker;
  else if(iv.on && iv.phase === "intro" && iv.side === "students" && iv.speaker >= 0) talkStu = iv.speaker;
  else if(iv.on && answeringNow()) talkStu = iv.answerBy;
  var talkPan = (iv.on && iv.side === "panel" && iv.speaker >= 0) ? iv.speaker : -1;
  var R = ROOM, x0 = R.x0, x1 = R.x1, z0 = R.z0, z1 = R.z1, H = R.ceil;

  /* --- the shell: ceiling, then the four walls far to near, then the floor --- */
  var shell = "";
  /* the ceiling goes too, once you have flown above it */
  if(VIEW.mode !== "persp" || VIEW.eye < H - 10)
    shell += poly([{X:x0,Z:z0,h:H},{X:x1,Z:z0,h:H},{X:x1,Z:z1,h:H},{X:x0,Z:z1,h:H}], C.ceil);
  /* backface culling: a wall you are standing outside of is not drawn, so
     backing the camera through one shows you the room rather than the wall */
  var per = (VIEW.mode === "persp");
  var seeBack = !per || VIEW.z < z1 - 10;
  var walls = [
    {a:[x0,z1], b:[x1,z1], on:seeBack},                          /* back  */
    {a:[x1,z1], b:[x1,z0], on:!per || VIEW.x < x1 - 10},         /* right */
    {a:[x0,z0], b:[x0,z1], on:!per || VIEW.x > x0 + 10},         /* left  */
    {a:[x1,z0], b:[x0,z0], on:!per || VIEW.z > z0 + 10}          /* near  */
  ];
  walls.forEach(function(w){
    if(!w.on) return;
    shell += wallPanel(w.a[0],w.a[1],w.b[0],w.b[1], 0, H, C.wall);
    shell += wallPanel(w.a[0],w.a[1],w.b[0],w.b[1], 0, 900, C.wainscot);
    shell += wallPanel(w.a[0],w.a[1],w.b[0],w.b[1], 880, 950, C.rail);
    shell += wallPanel(w.a[0],w.a[1],w.b[0],w.b[1], 0, 80, C.skirt);
  });
  shell += floorQuad(x0, z0, x1, z1, 0, C.floor);
  /* the far half of the floor is a shade darker, the way the drawing has it */
  shell += floorQuad(x0, 1800, x1, z1, 0, C.floorFar);
  for(var v = x0; v <= x1; v += 600) shell += floorLine(v, z0, v, z1, C.tile);
  for(var u = z0; u <= z1; u += 600) shell += floorLine(x0, u, x1, u, C.tile);
  /* two surface-mounted fluorescents */
  [-1700, 1500].forEach(function(lx){
    shell += floorQuad(lx-700, 600, lx+700, 900, H-30, C.lamp, "#AFBCAD");
    shell += floorQuad(lx-650, 640, lx+650, 860, H-32, C.tube);
  });
  put(-1e8, shell);

  /* --- on the back wall, far to near (and gone with it if you are behind) --- */
  var back = "";
  if(seeBack){
  /* the chalkboard, and what is written on it */
  var B = R.board;
  back += wallPanel(B.X-B.w/2, z1-8, B.X+B.w/2, z1-8, B.h0-60, B.h1+60, C.wood, C.woodDk, 1.2);
  back += wallPanel(B.X-B.w/2+60, z1-16, B.X+B.w/2-60, z1-16, B.h0, B.h1, C.board);
  back += wallPanel(B.X-B.w/2, z1-24, B.X+B.w/2, z1-24, B.h0-70, B.h0-10, "#A8834A", C.woodDk, 1);
  var bt = proj(B.X-B.w/2+120, z1-20, B.h1-120);
  if(bt.ok && bt.sc > 0.05){
    back += '<text x="'+bt.x.toFixed(1)+'" y="'+bt.y.toFixed(1)+'" font-family="IBM Plex Mono, monospace" font-size="'+
            Math.max(4, 90*bt.sc).toFixed(1)+'" letter-spacing="'+(6*bt.sc).toFixed(1)+'" fill="'+C.chalk+'" opacity=".7">WASTE SEGREGATION</text>';
    [[-1,0.72,0.86],[-1,0.60,0.40],[-1,0.52,0.55],[-1,0.44,0.62]].forEach(function(ln){
      var a = proj(B.X-B.w/2+120, z1-20, B.h0+(B.h1-B.h0)*ln[1]),
          b = proj(B.X-B.w/2+120+(B.w-240)*ln[2], z1-20, B.h0+(B.h1-B.h0)*ln[1]);
      if(a.ok && b.ok) back += '<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+
        '" y2="'+b.y.toFixed(1)+'" stroke="'+C.chalk+'" stroke-width="'+Math.max(0.6,8*a.sc).toFixed(1)+'" opacity=".5"/>';
    });
    /* the three little boxes and the circle it always has on it */
    [0,1,2].forEach(function(k){
      back += wallPanel(B.X-B.w/2+120+k*300, z1-20, B.X-B.w/2+330+k*300, z1-20, B.h0+250, B.h0+420, "none", C.chalk, Math.max(0.6, 7*bt.sc));
    });
  }
  /* the clock beside it */
  back += billboard(R.clock.X, z1-30, R.clock.h, 460, 460, function(p, w, h){
    return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(w/2).toFixed(1)+'" fill="#F4F6F2" stroke="#5B6467" stroke-width="'+Math.max(0.8,w*0.06).toFixed(1)+'"/>' +
           '<path d="M'+p.x.toFixed(1)+' '+p.y.toFixed(1)+' V'+(p.y-h*0.28).toFixed(1)+' M'+p.x.toFixed(1)+' '+p.y.toFixed(1)+' L'+(p.x+w*0.34).toFixed(1)+' '+(p.y-h*0.1).toFixed(1)+
           '" stroke="#20272A" stroke-width="'+Math.max(0.7,w*0.05).toFixed(1)+'" stroke-linecap="round"/>';
  });
  /* the notice board and the filing cabinet, far left */
  var N = R.notice;
  back += wallPanel(N.X-N.w/2, z1-8, N.X+N.w/2, z1-8, N.h0, N.h1, C.wood, C.woodDk, 1);
  back += wallPanel(N.X-N.w/2+40, z1-14, N.X+N.w/2-40, z1-14, N.h0+40, N.h1-40, C.cork);
  [[-0.32,0.62],[0.28,0.60],[-0.28,0.20],[0.30,0.14]].forEach(function(s){
    back += wallPanel(N.X+s[0]*N.w-80, z1-20, N.X+s[0]*N.w+80, z1-20, N.h0+40+s[1]*(N.h1-N.h0-80)-60, N.h0+40+s[1]*(N.h1-N.h0-80)+60, C.paper);
  });
  /* the socket the adapter lives in */
  back += wallPanel(R.socket.X-130, z1-10, R.socket.X+130, z1-10, R.socket.h-110, R.socket.h+110, "#EDEFE8", "#A8B2AC", 0.8);
  put(-9e7, back);

  /* The defense tarpaulin, hanging on the wall behind the panel: the group's
     own banner, drawn in the scene's own coordinates and leaned onto the wall
     so it hangs there rather than floating in front of it. */
  var TP = R.tarp;
  put(-8.9e7, onWall(TP.X - TP.w/2, z1 - 26, TP.X + TP.w/2, z1 - 26, TP.h0, TP.h1, 390, 202,
    '<rect x="0" y="0" width="390" height="202" rx="3" fill="#1E3050" stroke="#0A1220" stroke-width="2"/>' +
    '<rect x="0" y="0" width="390" height="70" fill="#12203A"/>' +
    '<rect x="0" y="132" width="390" height="70" fill="#2A4166"/>' +
    '<rect x="8" y="8" width="374" height="186" rx="2" fill="none" stroke="#4E6E9E" stroke-width="1.2" opacity=".6"/>' +
    '<rect x="14" y="12" width="82" height="82" rx="4" fill="#05070C" stroke="#31465F" stroke-width="1.2"/>' +
    '<image href="img/jd-logo.png" x="16" y="14" width="78" height="78" preserveAspectRatio="xMidYMid meet"/>' +
    '<text x="112" y="36" font-family="Chakra Petch, sans-serif" font-size="23" font-weight="700" letter-spacing="1" fill="#7FE3D4">EnviroSortPro</text>' +
    '<text x="112" y="58" font-family="IBM Plex Mono, monospace" font-size="12.5" letter-spacing="1" fill="#CFE0EE">Automatic Waste Segregation</text>' +
    '<text x="112" y="78" font-family="IBM Plex Mono, monospace" font-size="11" letter-spacing="1.4" fill="#8FAEC4">JUDECH &#183; PROJECT DEFENSE</text>' +
    '<path d="M112 86 H374" stroke="#4E6E9E" stroke-width="1" opacity=".55"/>' +
    '<g fill="#8A9496"><circle cx="10" cy="10" r="3.2"/><circle cx="380" cy="10" r="3.2"/>' +
    '<circle cx="10" cy="192" r="3.2"/><circle cx="380" cy="192" r="3.2"/></g>'));
  }

  /* --- furniture, each with its own depth --- */
  var cab = R.cabinet, cp = proj(cab.X, cab.Z, 0);
  if(cp.ok) put(cp.d, solid(boxPts(cab.X, cab.Z, cab.w/2, cab.d/2), 0, cab.h, C.steel, C.steel, C.steelDk) +
                       solid(boxPts(cab.X, cab.Z, 190, 150), cab.h, cab.h+120, "#B8452E", "#8E2F1F", "#6E2418"));
  [R.pc1, R.pc2].forEach(function(d, i){
    var dp = proj(d.X, d.Z, 0); if(!dp.ok) return;
    var s = solid(boxPts(d.X, d.Z, d.w/2, d.d/2), d.h-50, d.h, C.desk, C.deskDk, C.woodDk);
    s += cylinder(d.X-d.w/2+60, d.Z, 0, d.h-50, 30, C.wood, C.wood, C.woodDk);
    s += cylinder(d.X+d.w/2-60, d.Z, 0, d.h-50, 30, C.wood, C.wood, C.woodDk);
    var mons = i === 0 ? [d.X] : [d.X-520, d.X+520];
    mons.forEach(function(mx){
      s += solid(boxPts(mx, d.Z+80, 190, 25), d.h+60, d.h+330, C.mon, C.mon, "#20272A");
      s += wallPanel(mx-165, d.Z+52, mx+165, d.Z+52, d.h+90, d.h+300, i===0 ? C.screen : C.screen2);
      s += solid(boxPts(mx, d.Z+80, 40, 20), d.h, d.h+60, C.mon, C.mon, "#20272A");
    });
    s += solid(boxPts(d.X, d.Z-120, 150, 45), d.h, d.h+18, "#C6CDCB", "#AEB6B4", "#8E9694");
    put(dp.d, s);
  });

  /* the panel's table, the score sheets, and the three of them behind it */
  var T = R.table, tp = proj(T.X, T.Z, 0);
  if(tp.ok){
    var ts = solid(boxPts(T.X, T.Z, T.w/2, T.d/2), T.h-60, T.h, C.wood, C.woodDk, "#3E2B12");
    [-1,1].forEach(function(k){ ts += cylinder(T.X+k*(T.w/2-90), T.Z, 0, T.h-60, 34, C.wood, C.wood, C.woodDk); });
    R.pan.forEach(function(q){ ts += floorQuad(q.X-160, T.Z-200, q.X+160, T.Z+20, T.h+3, C.paper, "#C6C6BC"); });
    put(tp.d, ts);
  }
  R.pan.forEach(function(q, i){
    var face = Math.atan2(R.stu[2].X - q.X, R.stu[2].Z - q.Z) * 180 / Math.PI;
    var act = applause.on ? {mode:"clap", tempo:6.6 + i * 0.7}
            : talkPan === i ? {mode:"talk"}
            : {mode:"write", deskH:R.table.h,
               still:!(iv.on && iv.phase !== "confer" && iv.phase !== "idle")};
    var pr = person(q.X, q.Z, face, 1620, PAN_LOOK[i], PANELISTS[i].role.toUpperCase(),
                    talkPan === i, talkPan === i, true, null, act);
    if(pr) put(pr.d, pr.s);
  });

  /* the infeed conveyor the waste queues on, and what is queued */
  var bl = R.belt, bp = proj(bl.X, bl.Z, 0);
  if(bp.ok){
    var bs = "";
    [-1,1].forEach(function(k){ bs += cylinder(bl.X+k*(bl.w/2-120), bl.Z, 0, bl.h-60, 36, "#5B6467", "#8E999C", "#3A4244"); });
    bs += solid(boxPts(bl.X, bl.Z, bl.w/2, bl.d/2), bl.h-60, bl.h, "#3A4448", "#2A3033", "#20272A");
    bs += floorQuad(bl.X-bl.w/2+40, bl.Z-bl.d/2+40, bl.X+bl.w/2-40, bl.Z+bl.d/2-40, bl.h+2, "#20262B");
    for(var q = 0; q < 8; q++){
      var kx = bl.X - bl.w/2 + 200 + q*210, kind = KIND[QUEUE[(q + qOffset) % QUEUE.length]];
      if(!kind) continue;
      var col = kind.cls === "none" ? "#C9D2D8" : BINS[IDX[kind.cls]].waste;
      bs += cylinder(kx, bl.Z, bl.h+2, bl.h+70, 40, col, col, "#12181A");
    }
    put(bp.d, bs + tag(proj(bl.X, bl.Z, bl.h+220), "INFEED · pick the waste from here", MDL_COL.ink, "middle", 0));
  }

  /* the solar stand, tilted toward the lights */
  var so = R.solar, sp = proj(so.X, so.Z, 0);
  if(sp.ok){
    var ss = "";
    [-1,1].forEach(function(k){ ss += cylinder(so.X+k*260, so.Z+60, 0, 720, 18, "#5B6467", "#8E999C", "#3A4244"); });
    ss += poly([{X:so.X-380,Z:so.Z+220,h:560},{X:so.X+380,Z:so.Z+220,h:560},{X:so.X+380,Z:so.Z-140,h:1100},{X:so.X-380,Z:so.Z-140,h:1100}], "#0B1A33", C.steel, 1.4);
    for(var r = 1; r < 3; r++){
      var la = proj(so.X-360, so.Z+220-360*r/3, 560+540*r/3), lb = proj(so.X+360, so.Z+220-360*r/3, 560+540*r/3);
      if(la.ok && lb.ok) ss += '<line x1="'+la.x.toFixed(1)+'" y1="'+la.y.toFixed(1)+'" x2="'+lb.x.toFixed(1)+'" y2="'+lb.y.toFixed(1)+'" stroke="#1E3A5C" stroke-width="0.9"/>';
    }
    for(var c = 1; c < 4; c++){
      var ca = proj(so.X-380+760*c/4, so.Z+220, 560), cb = proj(so.X-380+760*c/4, so.Z-140, 1100);
      if(ca.ok && cb.ok) ss += '<line x1="'+ca.x.toFixed(1)+'" y1="'+ca.y.toFixed(1)+'" x2="'+cb.x.toFixed(1)+'" y2="'+cb.y.toFixed(1)+'" stroke="#1E3A5C" stroke-width="0.9"/>';
    }
    put(sp.d, ss + tag(proj(so.X, so.Z, 1200), "18 V · 20 W PANEL", MDL_COL.ink, "middle", 0));
  }

  /* the three wheelie bins of the manual disposal station */
  R.disp.forEach(function(d, i){
    var p = proj(d.X, d.Z, 0); if(!p.ok) return;
    var lid = [["#2E9E4B","#1C6E33"],["#E0B41E","#A8890F"],["#CF3A2E","#8E1F16"]][i];
    var s = "";
    [-1,1].forEach(function(k){ s += cylinder(d.X+k*150, d.Z-230, 0, 120, 60, C.wheel, "#2A3033", "#0A0D0F"); });
    s += solid(boxPts(d.X, d.Z, 240, 240), 100, 900, C.binBody, "#252C2F", C.binEdge);
    s += solid(boxPts(d.X, d.Z, 265, 265), 900, 980, lid[0], lid[1], lid[1]);
    s += solid(boxPts(d.X, d.Z-40, 70, 60), 980, 1030, lid[1], lid[1], lid[1]);
    var np = proj(d.X, d.Z-245, 600);
    if(np.ok && np.sc > 0.05) s += '<rect x="'+(np.x-200*np.sc).toFixed(1)+'" y="'+(np.y-70*np.sc).toFixed(1)+'" width="'+(400*np.sc).toFixed(1)+'" height="'+(140*np.sc).toFixed(1)+'" rx="3" fill="#0D1416" opacity=".9"/>' +
      tag(np, BINS[i].key.toUpperCase(), ["#5FD37E","#EDC63D","#F2685E"][i], "middle", 40*np.sc);
    put(p.d, s);
  });
  var mp2 = proj(R.disp[1].X, R.disp[1].Z, 1400);
  if(mp2.ok) put(proj(R.disp[1].X, R.disp[1].Z, 0).d, tag(mp2, "MANUAL DISPOSAL", "#F2DFB8", "middle", 0));

  /* the group, beside their machine, facing it — except whoever has the floor */
  /* You. Drawn on the floor with the rest of them, depth-sorted with the rest
     of them, and with a shadow that shrinks as he climbs — which is the only
     thing that tells you how high you are when you are flying. */
  if(walk.on && walk.third){
    var yp = proj(walk.x, walk.z, 0);
    if(yp.ok){
      var sh = 1 / (1 + walk.alt / 900);
      put(yp.d - 1, '<ellipse cx="'+yp.x.toFixed(1)+'" cy="'+yp.y.toFixed(1)+'" rx="'+
        (260*sh*yp.sc).toFixed(1)+'" ry="'+Math.abs(260*sh*yp.sc*yp.fs).toFixed(1)+
        '" fill="#000" opacity="'+(0.30*sh).toFixed(2)+'"/>');
      var you = person(walk.x, walk.z, walk.yaw, 1700, YOU_LOOK,
                       walk.sit ? "SEATED" : walk.fly ? "FLYING" : "YOU",
                       true, false, walk.seatE > 0.5,
                       {ph:walk.gait, moving:walk.moving, fly:walk.fly, alt:walk.alt});
      if(you) put(you.d, you.s);
    }
  }

  /* the group stand facing the panel, the way a group being examined does,
     and whoever has the floor squares up to them */
  R.stu.forEach(function(q, i){
    var t = R.pan[talkStu === i ? 1 : Math.min(2, Math.max(0, i - 1))];
    var face = Math.atan2(t.X - q.X, t.Z - q.Z) * 180 / Math.PI;
    var aim = talkStu === i ? speakerAim() : null;
    var act = applause.on ? {mode:"clap", tempo:6.2 + i * 0.55}
            : talkStu === i ? (aim ? {mode:"point", aim:aim} : {mode:"talk"})
            : {mode:"clasp"};
    var pr = person(q.X, q.Z, face, 1700, STU_LOOK[i], STUDENTS[i].role.toUpperCase(),
                    talkStu === i, talkStu === i, false, null, act);
    if(pr) put(pr.d, pr.s);
  });
}

/* ---------------------------- the two views ---------------------------- */
function collect(withRoom){
  var L = [];
  function put(d, s){ if(s) L.push({d:d, s:s}); }
  if(withRoom){
    /* the backdrop: wall above the horizon, floor below it. Nothing should ever
       fall through to the card behind, and if a polygon is ever dropped this is
       what shows instead of a black hole in the room. */
    var hz = Math.max(0, Math.min(WALK_H, VIEW.cy + VIEW.f * Math.tan(VIEW.pitch * Math.PI / 180)));
    put(-1e9, '<rect x="0" y="0" width="'+WALK_W+'" height="'+hz.toFixed(1)+'" fill="'+LAB.wall+'"/>' +
              '<rect x="0" y="'+hz.toFixed(1)+'" width="'+WALK_W+'" height="'+(WALK_H-hz).toFixed(1)+
              '" fill="'+LAB.floorFar+'"/>');
    roomInto(put);
    if(labelsOn) put(1e9, machineLabels());
  }
  else {
    var f = proj(0,0,0);
    if(f.ok) put(-9999, '<ellipse cx="' + f.x.toFixed(1) + '" cy="' + f.y.toFixed(1) +
      '" rx="' + (200*f.sc).toFixed(1) + '" ry="' + (200*f.sc*VIEW.k).toFixed(1) +
      '" fill="#000" opacity=".16"/>');
  }
  machineInto(put);
  L.sort(function(a, b){ return a.d - b.d; });
  return L.map(function(e){ return e.s; }).join("");
}
function drawModel(az){
  VIEW.mode = "ortho"; VIEW.az = az; setPitch(0);
  /* the mast arm and the power module made the machine taller, so the
     elevations pull back a little to keep it inside the pane */
  VIEW.cx = 150; VIEW.cy = 373; VIEW.s = 0.37; VIEW.k = 0.52;
  return collect(false);
}
function drawPlan(az){
  VIEW.mode = "plan"; VIEW.az = az; setPitch(0);
  VIEW.cx = 310; VIEW.cy = 218; VIEW.s = 0.75; VIEW.k = 1;   /* it gets the wide slot */
  /* the chute stands 67 mm forward of the axis, and a plan is the one view
     that shows it, so it is worth marking */
  var body = collect(false);
  var c = proj(0, 0, 0), hl = proj(0, MDL.hole, 0);
  body += '<line x1="'+c.x.toFixed(1)+'" y1="'+c.y.toFixed(1)+'" x2="'+hl.x.toFixed(1)+'" y2="'+hl.y.toFixed(1)+
          '" stroke="#5FE3CF" stroke-width="1" stroke-dasharray="3 3"/>' +
          '<circle cx="'+c.x.toFixed(1)+'" cy="'+c.y.toFixed(1)+'" r="2.4" fill="#5FE3CF"/>' +
          tag(hl, "67 mm forward of the axis", "#5FE3CF", "middle", 14);
  return body;
}

/* ------------------------ walking around it ---------------------------
   The same room, from inside it. This is a camera, not another panel: it takes
   over the picture at the top of the page, at the same size and in the same
   place, and the camera bar under it drives whichever of the two is showing.

   Movement is a velocity, not a step. Holding a key or a pad accelerates you
   and letting go coasts you to a stop, and the five places you can stand are
   eased into over about a second rather than cut to — a defence is not helped
   by a camera that teleports.                                              */
/* You are a person in this room, not a floating eye. `walk` is now his
   position, his heading and his altitude; the camera is worked out from him.
   He walks the floor, he is stopped by the furniture, and Fly lifts him off it
   so he can go over the machine and look down into it.                    */
var walk = {x:250, z:-2500, yaw:348, alt:0, pitch:-5, on:false,
            vf:0, vs:0, vy:0, va:0, vg:0,      /* forward, sideways, turn, climb, fall */
            fly:false, third:false, ground:true, bob:0, run:false,
            gait:0, moving:false, locked:false, spot:null, panel:null, hints:true,
            sit:false, seatE:0, sitAfter:false,
            hold:{}, glide:null, face:true, focus:"overview", last:0};
var GRAVITY = 9800, JUMP_V = 3050, SPRINT = 1.8;      /* mm/s², mm/s, × */
var WALK_W = 1200, WALK_H = 820;
var WALK_SPEED = 1900, WALK_TURN = 95, WALK_CLIMB = 1300;  /* mm/s, °/s, mm/s */
var CAM_BACK = 3600, CAM_UP = 2150, EYE_H = 1620, YOU_R = 230;
/* Sitting. A seat is 450 mm, so his eye lands at about 1250 — the same figure
   the panel's own seated viewpoint uses. He sits to look at the machine rather
   than to rest: standing over a 900 mm prototype means looking down on it, and
   the parts a defence is about are all below chest height.                  */
var SIT_EYE = 1250, SIT_UP = 1560, SIT_BACK = 2200;
var SEAT = {x:110, z:-1180};
/* the visitor: a boy in a blue shirt, so he is nobody in the group */
var YOU_LOOK = {skin:"#D9A377", line:"#A87246", hair:"#241A12", style:"short",
                top:"#2E6FA8", legs:"#2F3947", lip:"#8A4A38"};
var CAMS = {
  start:  {x:200,   z:-3100, yaw:335, eye:1620, pitch:-2},
  group:  {x:-1900, z:-2600, yaw:330, eye:1620, pitch:-2},
  panel:  {x:-2500, z:3500,  yaw:150, eye:1250, pitch:-3},
  hole:   {x:60,    z:-820,  yaw:0,   eye:1620, pitch:-16},
  right:  {x:1350,  z:60,    yaw:270, eye:1620, pitch:-12},
  behind: {x:-60,   z:1400,  yaw:180, eye:1620, pitch:-12},
  left:   {x:-1000, z:60,    yaw:90,  eye:1620, pitch:-12},
  front:  {x:120,   z:-1700, yaw:0,   eye:1620, pitch:-9},
  showcase:{x:140,  z:-1250, yaw:0,   eye:1420, pitch:-22},
  sensor: {x:430,   z:-660,  yaw:327, eye:1320, pitch:-24},
  sorter: {x:1050,  z:-40,   yaw:270, eye:1320, pitch:-22},
  seat:   {x:SEAT.x, z:SEAT.z, yaw:0,  eye:1620, pitch:-16},
  bird:   {x:-600,  z:-3200, yaw:12,  eye:3300, pitch:-30}
};
/* the camera bar's five places mean something in here too */
var WALK_VIEW = {room:"start", group:"group", panel:"panel", machine:"front", bins:"right"};
/* and so do the presentation's own section views, so a section that says "look
   at the gate" walks you to the gate instead of leaving you across the room */
var WALK_SECTION = {
  room:"start", group:"group", panel:"panel", belt:"group",
  all:"front", machine:"front",
  lower:"right", pedestal:"right", bins:"right", us:"right", clear:"right",
  gate:"hole", throat:"hole", mouth:"hole", bore:"hole", brain:"left"
};
function walkSection(v){
  if(!walking() || !walk.face) return;
  walkTo(WALK_SECTION[v] || "start");
}

/* what he cannot walk through. Built once — none of it moves. */
var WALK_OBS = null;
function walkObs(){
  if(WALK_OBS) return WALK_OBS;
  var R = ROOM, o = [{x:0, z:0, r:320}];                       /* the machine */
  R.disp.forEach(function(d){ o.push({x:d.X, z:d.Z, r:300}); });
  R.stu.forEach(function(q){ o.push({x:q.X, z:q.Z, r:250}); });
  R.pan.forEach(function(q){ o.push({x:q.X, z:q.Z, r:250}); });
  o.push({x:R.solar.X, z:R.solar.Z, r:420});
  [[R.table, 150], [R.belt, 120], [R.pc1, 120], [R.pc2, 120]].forEach(function(q){
    o.push({box:1, x:q[0].X, z:q[0].Z, hw:q[0].w/2 + q[1], hd:q[0].d/2 + q[1]});
  });
  o.push({box:1, x:R.cabinet.X, z:R.cabinet.Z, hw:R.cabinet.w/2 + 120, hd:R.cabinet.d/2 + 120});
  WALK_OBS = o;
  return o;
}
function walkClamp(){
  walk.x = Math.max(ROOM.x0 + 300, Math.min(ROOM.x1 - 300, walk.x));
  walk.z = Math.max(ROOM.z0 + 300, Math.min(ROOM.z1 - 300, walk.z));
  walk.alt = Math.max(0, Math.min(ROOM.ceil - 1750, walk.alt));
  walk.pitch = Math.max(-78, Math.min(78, walk.pitch));   /* it cannot flip over */
  walk.yaw = ((walk.yaw % 360) + 360) % 360;
  /* once he is above head height he is flying over the furniture, not into it */
  if(walk.alt > 1000) return;
  walkObs().forEach(function(o){
    if(o.box){
      var dx = walk.x - o.x, dz = walk.z - o.z;
      if(Math.abs(dx) < o.hw && Math.abs(dz) < o.hd){
        if(o.hw - Math.abs(dx) < o.hd - Math.abs(dz)) walk.x = o.x + (dx < 0 ? -o.hw : o.hw);
        else                                          walk.z = o.z + (dz < 0 ? -o.hd : o.hd);
      }
    } else {
      var ex = walk.x - o.x, ez = walk.z - o.z, d = Math.sqrt(ex*ex + ez*ez), m = o.r + YOU_R;
      if(d < m){
        if(d < 1){ walk.x = o.x + m; }
        else { walk.x = o.x + ex / d * m; walk.z = o.z + ez / d * m; }
      }
    }
  });
}
/* where the camera stands, given where he is */
function camFromWalk(){
  var eye = EYE_H + (SIT_EYE - EYE_H) * walk.seatE;
  var boom = CAM_UP + (SIT_UP - CAM_UP) * walk.seatE;
  var back = CAM_BACK + (SIT_BACK - CAM_BACK) * walk.seatE;
  if(walk.third){
    /* The boom used to be clamped into the room, so standing near a wall
       crushed it to nothing and he vanished inside the near plane. Instead the
       camera keeps its full length and is allowed OUT through the wall — and
       the wall it is behind simply is not drawn (see roomInto). That is what a
       third-person camera does, and it never collapses. */
    var yw = walk.yaw * Math.PI / 180;
    VIEW.x = walk.x - Math.sin(yw) * back;
    VIEW.z = walk.z - Math.cos(yw) * back;
    VIEW.eye = walk.alt + boom;
  } else {
    VIEW.x = walk.x; VIEW.z = walk.z; VIEW.eye = walk.alt + eye + walk.bob;
  }
}
/* Sit down where he is, and turn him to the machine — or, if he is across the
   room, walk him to the seat in front of it first and sit when he arrives.
   Getting up again is anything that asks him to move.                       */
function sitDown(){
  if(walk.sit) return;
  walk.bore = false; walk.fly = false;
  walk.vf = walk.vs = walk.vy = walk.va = walk.vg = 0;
  /* sitting is for looking at the machine, so if he is not near enough for any
     of it to be worth reading, he takes the seat in front of it first */
  var dx = walk.x - 0, dz = walk.z - MDL.hole;
  if(Math.sqrt(dx*dx + dz*dz) > 1700){
    walk.sitAfter = true;
    walkTo("seat");
    return;
  }
  walk.sit = true;
  /* his eye settles on the mouth of it, from wherever he happens to be sitting */
  var hz = MDL.hole, ex = 0 - walk.x, ez = hz - walk.z;
  var d = Math.max(500, Math.sqrt(ex*ex + ez*ez));
  var yaw = Math.atan2(ex, ez) * 180 / Math.PI;
  var pitch = Math.atan2((MDL.gateH + MDL.throatH + MDL.hopH * 0.5) - SIT_EYE, d) * 180 / Math.PI;
  var dy = ((yaw - walk.yaw + 540) % 360) - 180;
  walk.glide = {t:0, dur:700,
                from:{x:walk.x, z:walk.z, yaw:walk.yaw, alt:walk.alt, pitch:walk.pitch},
                to:{x:walk.x, z:walk.z, yaw:walk.yaw + dy, alt:0,
                    pitch:Math.max(-42, Math.min(12, pitch))}};
}
function standUp(){ walk.sit = false; walk.sitAfter = false; }
function toggleSit(){ if(walk.sit) standUp(); else sitDown(); }

function walkTo(name){
  var c = CAMS[name]; if(!c) return;
  walk.bore = false;
  if(name !== "seat"){ walk.sit = false; walk.sitAfter = false; }
  /* glide, and take the short way round the compass */
  var dy = ((c.yaw - walk.yaw + 540) % 360) - 180;
  var alt = Math.max(0, (c.eye || EYE_H) - EYE_H);      /* a high viewpoint means he flies */
  if(alt > 0) walk.fly = true;
  /* how long it takes depends on how far it is. A flat 900 ms made a step
     across the mat feel sluggish and a walk across the room feel like a
     teleport; this is about 2.2 m a second, floored and capped so neither
     end of it is silly.                                                  */
  var far = Math.sqrt(Math.pow(c.x - walk.x, 2) + Math.pow(c.z - walk.z, 2));
  var dur = Math.max(420, Math.min(1500, 380 + far / 2.6 + Math.abs(dy) * 3));
  walk.glide = {t:0, dur:dur, from:{x:walk.x, z:walk.z, yaw:walk.yaw, alt:walk.alt, pitch:walk.pitch},
                to:{x:c.x, z:c.z, yaw:walk.yaw + dy, alt:alt, pitch:c.pitch}};
  walk.vf = walk.vs = walk.vy = walk.va = 0;
}
function paintWalkBar(){
  var c = $("wkCut"), b = $("wkBore"), f = $("wkFly"), t = $("wkThird");
  var st = $("wkSit"), lb = $("wkLabels");
  if(st){ st.setAttribute("aria-pressed", String(!!walk.sit));
          st.textContent = walk.sit ? "Stand up" : "Sit down"; }
  if(lb){ lb.setAttribute("aria-pressed", String(labelsOn));
          lb.textContent = "Labels: " + (labelsOn ? "on" : "off"); }
  if(c) c.setAttribute("aria-pressed", String(cutOn));
  if(b) b.setAttribute("aria-pressed", String(!!walk.bore));
  if(f) f.setAttribute("aria-pressed", String(!!walk.fly));
  if(t){ t.setAttribute("aria-pressed", String(!walk.third));
         t.textContent = walk.third ? "See through his eyes" : "Back behind him"; }
  $("walkbar").classList.toggle("bore", !!walk.bore);
}
function walkGo(fwd, side){                        /* one nudge, for a click */
  if(walk.bore) return;                            /* you are down the hole */
  var yw = walk.yaw * Math.PI / 180;
  walk.x += fwd * Math.sin(yw) + side * Math.cos(yw);
  walk.z += fwd * Math.cos(yw) - side * Math.sin(yw);
  walkClamp();
}
/* The wheel used to jump him 260 mm and stop dead, which reads as a cut
   rather than a step. It pushes him instead, and the same friction that
   stops the keys stops this.                                            */
function walkShove(fwd){
  if(walk.bore) return;
  if(walk.sit) standUp();
  walk.vf = Math.max(-WALK_SPEED, Math.min(WALK_SPEED, walk.vf + fwd));
  walk.glide = null;
}
/* who has the floor, so "Follow the speaker" can turn your head for you */
function walkSpeaker(){
  if(pres.on && iv.side === "students" && iv.speaker >= 0) return ROOM.stu[iv.speaker];
  if(iv.on && iv.side === "students" && iv.speaker >= 0)   return ROOM.stu[iv.speaker];
  if(iv.on && answeringNow())                              return ROOM.stu[iv.answerBy];
  if(iv.on && iv.side === "panel" && iv.speaker >= 0)      return ROOM.pan[iv.speaker];
  return null;
}
function ease(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; }
function stepWalk(){
  if(!walk.on) return;
  var now = Date.now(), dt = Math.min(0.08, (now - (walk.last || now)) / 1000);
  walk.last = now;
  if(!dt) return;

  /* sitting down and getting up are eased, so the eye settles rather than cuts */
  var wantSeat = walk.sit ? 1 : 0;
  walk.seatE += (wantSeat - walk.seatE) * Math.min(1, 6 * dt);
  if(Math.abs(walk.seatE - wantSeat) < 0.003) walk.seatE = wantSeat;

  if(walk.glide){
    var g = walk.glide;
    g.t = Math.min(1, g.t + dt * 1000 / g.dur);
    var e = ease(g.t);
    ["x","z","yaw","alt","pitch"].forEach(function(k){ walk[k] = g.from[k] + (g.to[k] - g.from[k]) * e; });
    if(g.t >= 1){
      walk.glide = null;
      if(walk.sitAfter){ walk.sitAfter = false; sitDown(); }   /* he has arrived: sit */
    }
    walkClamp();
    pickSpot();
    return;
  }
  /* held keys and pads ask for a speed; friction takes it away again */
  var h = walk.hold;
  /* anything that asks him to move gets him out of the chair first */
  if(walk.sit && (h.fwd || h.back || h.sleft || h.sright || h.up || h.down || h.jump)) standUp();
  var wantF = (h.fwd ? 1 : 0) - (h.back ? 1 : 0);
  var wantS = (h.sright ? 1 : 0) - (h.sleft ? 1 : 0);
  var wantY = (h.right ? 1 : 0) - (h.left ? 1 : 0);
  var wantE = (h.up ? 1 : 0) - (h.down ? 1 : 0);
  if(walk.sit){ wantF = wantS = wantE = 0; }       /* seated, he stays put */
  if(wantE > 0 && !walk.fly) walk.fly = true;      /* asking to go up is asking to fly */
  function toward(v, want, top, accel){
    var t = want * top;
    return v + (t - v) * Math.min(1, accel * dt);
  }
  var run = walk.hold.run ? SPRINT : 1;
  walk.vf = toward(walk.vf, wantF, WALK_SPEED * run, wantF ? 9 : 7);
  walk.vs = toward(walk.vs, wantS, WALK_SPEED * 0.72 * run, wantS ? 9 : 7);
  walk.vy = toward(walk.vy, wantY, WALK_TURN, wantY ? 11 : 8);
  walk.va = toward(walk.va, walk.fly ? wantE : 0, WALK_CLIMB, wantE ? 9 : 7);
  if(Math.abs(walk.vf) < 15) walk.vf = 0;
  if(Math.abs(walk.vs) < 15) walk.vs = 0;
  if(Math.abs(walk.vy) < 0.8) walk.vy = 0;
  if(Math.abs(walk.va) < 15) walk.va = 0;

  walk.yaw += walk.vy * dt;
  /* Vertical. Flying is free movement; otherwise it is gravity, a jump and a
     floor, so he arcs and lands instead of gliding down, and he can never fall
     through the ground because the ground is the bottom of the integration. */
  if(walk.fly){
    walk.alt += walk.va * dt; walk.vg = 0; walk.ground = false;
  } else {
    if(walk.hold.jump && walk.ground){ walk.vg = JUMP_V; walk.ground = false; }
    walk.vg -= GRAVITY * dt;
    walk.alt += walk.vg * dt;
    if(walk.alt <= 0){ walk.alt = 0; walk.vg = 0; walk.ground = true; }
    else walk.ground = false;
  }
  if(walk.vf || walk.vs) walkGo(walk.vf * dt, walk.vs * dt);

  /* the walk cycle: about one stride every 700 mm, so his legs keep up with him */
  var sp = Math.sqrt(walk.vf*walk.vf + walk.vs*walk.vs);
  walk.moving = sp > 60;
  if(walk.moving) walk.gait += 2 * Math.PI * (sp / 760) * dt;
  else walk.gait += (walk.gait % (2*Math.PI) > 0.05 ? 6 * dt : 0);      /* settle to a stand */
  /* head bob: enough to feel like walking, not enough to make anybody seasick */
  var wantBob = (walk.moving && walk.ground) ? Math.sin(walk.gait * 2) * 21 : 0;
  walk.bob += (wantBob - walk.bob) * Math.min(1, 9 * dt);
  pickSpot();

  /* with Follow the speaker on, the room turns to whoever is talking */
  if(walk.face && !wantY){
    var sp = walkSpeaker();
    if(sp){
      var want = Math.atan2(sp.X - walk.x, sp.Z - walk.z) * 180 / Math.PI;
      var d = ((want - walk.yaw + 540) % 360) - 180;
      if(Math.abs(d) > 1.2) walk.yaw += d * Math.min(1, 2.2 * dt);
    }
  }
  walkClamp();
}
/* ------------------------- things to inspect --------------------------
   Walk up to any of these, look at it, and it offers itself. Everything in the
   text comes from the same sketch and the same findings the rest of the page
   is built on, so the walkthrough tells the panel the same story the cards do. */
var SPOTS = null;
function spots(){
  if(SPOTS) return SPOTS;
  var hZ = MDL.hole;
  SPOTS = [
   {x:0, z:hZ, h:MDL.gateH + MDL.throatH + MDL.hopH * 0.6, r:1700, key:"The input hole",
    lines:["The mouth of the machine — a paint bucket clamped to the mast, 184 mm across.",
           "Waste goes in here and nothing hangs in the middle: the path is clear from the",
           "mouth all the way down to the gate.",
           "",
           "Plastic and metal are PRESENTED at the mouth and held for a moment, so stage 1",
           "can read them. Biodegradable is simply DROPPED."]},
   {x:-98, z:hZ, h:MDL.gateH + 40, r:1500, key:"Stage 1 · D3 and D4",
    lines:["Two proximity heads on wooden blocks, facing each other across the bore with",
           "128 mm of clear air between their faces.",
           "",
           "D4 · inductive — sees metal only. Tested first, and unconditionally.",
           "D3 · capacitive — sees plastic, and metal too if it is close.",
           "",
           "That difference is the whole trick: capacitive alone means plastic; the inductive",
           "joining in means metal. Both read LOW when they see their material."]},
   {x:74, z:hZ - 4, h:MDL.gateH + 12, r:1400, key:"Stage 2 · D7 infrared",
    lines:["An IR obstacle module looking across the face of the closed gate.",
           "",
           "It cannot name a material — it only reports that something is in front of it. So",
           "anything reaching the gate unidentified is called biodegradable.",
           "",
           "That is the honest weakness: the bio branch has no guard, and clear glass trips",
           "nothing at all."]},
   {x:0, z:hZ, h:MDL.gateH, r:1400, key:"The gate · servo D6",
    lines:["The floor of the hole. Everything dropped in lands here and stays here — held on",
           "the sensor line while the sketch reads it, held while the plate turns underneath —",
           "and it opens only once the right bin has arrived.",
           "",
           "270° metal-gear digital servo. Travel is not the constraint here; torque is.",
           "torque = weight × arm length, so a longer flap needs proportionally more.",
           "",
           "FINDING 10: the full-bin branch returns before anything writes to this servo, so",
           "the machine locks out with the gate still OPEN."]},
   {x:0, z:0, h:MDL.plateH + 260, r:1800, key:"The platform · servo D5",
    lines:["Three bins on a rotating triangular plate, riding on three castors so the servo",
           "shaft never carries their weight — it only turns them.",
           "",
           "270° metal-gear digital servo, because the three bins park at 0°, 120° and 247.5°",
           "and an SG90 stops at 180°. Nor can the bins be packed closer: they ride 67 mm off",
           "the axis and are 120 mm across, so at 90° apart they would touch.",
           "",
           "write(90) home · write(0) bio · write(80) metal · write(165) plastic."]},
   {x:MDL.postR * Math.sin(MDL.postB*Math.PI/180), z:MDL.postR * Math.cos(MDL.postB*Math.PI/180),
    h:MDL.usH, r:1500, key:"The full-bin check · D8 / D9",
    lines:["One HC-SR04 on its own post off the FIXED base plate, looking straight down into",
           "whichever bin is parked under the hole.",
           "",
           "distance = duration × 0.0343 / 2. Empty reads about 50 cm; each item closes it by",
           "roughly 7. At 20 cm or less the buzzer sounds, the display says Bin Full and the",
           "machine locks itself out.",
           "",
           "FINDING 2: at rest the plate sits near the metal bin, so only that one is watched",
           "between drops."]},
   {x:MDL.mastR * Math.sin(MDL.mastB*Math.PI/180), z:MDL.mastR * Math.cos(MDL.mastB*Math.PI/180),
    h:MDL.ctrlH + 120, r:1600, key:"The controller · Uno + I²C LCD",
    lines:["An Arduino Uno R3 and a 16×2 I²C display at 0x27, on a plywood board behind an",
           "acrylic cover. Take the cover off from the header and you get the Uno and the mini",
           "breadboard the jumpers run into.",
           "",
           "D2 plastic · D13 metal · A3 bio — in normal running only one lights, so three at",
           "once means the alarm and not a sort. D12 is the buzzer: a steady tone, not a",
           "pattern, because soundAlarm() is a single digitalWrite HIGH."]},
   {x:0, z:outward(0, MDL.boxD), h:150, r:1300, key:"The support box · D10",
    lines:["Plywood, on the floor, carrying the fixed base plate and hiding the battery packs",
           "behind its door.",
           "",
           "D10 is INPUT_PULLUP, so the sketch tests for LOW. Pressing it sets",
           "operationsEnabled and calls resetServosAndLCD() — display back to standby, the",
           "three LEDs out, and the gate finally closed.",
           "",
           "It does NOT stop the buzzer. Emptying the bin does that."]},
   {x:ROOM_DISP(1).X, z:ROOM_DISP(1).Z, h:900, r:1900, key:"Manual disposal",
    lines:["Three wheelie bins, bio / plastic / metal, that a full load is carried to by hand.",
           "",
           "Every bin on the machine is lined with a plastic bag: lift the bag out by the neck,",
           "tie it, and drop it whole into the matching big bin — metal into metal, so nothing",
           "just sorted gets mixed again on the way out.",
           "",
           "The moment the waste is out the tone stops by itself. Only then press D10."]},
   {x:ROOM_BELT().X, z:ROOM_BELT().Z, h:ROOM_BELT().h, r:1700, key:"The infeed conveyor",
    lines:["Where the waste queues, one item at a time. Pick a piece and it goes to the mouth.",
           "",
           "The catalogue is real: a bottle and a soda bottle trip the capacitive head only; a",
           "can, a tin, a spoon and a bolt trip both; foil trips the inductive head alone; a",
           "banana peel, an apple core and paper trip nothing but the infrared.",
           "",
           "And a glass shard trips nothing at all, which is the machine's blind spot."]},
   {x:ROOM_SOLAR().X, z:ROOM_SOLAR().Z, h:900, r:1800, key:"The solar panel",
    lines:["18 V, 20 W, and it goes nowhere near the Arduino: 22 V open-circuit is over the",
           "Uno's 20 V absolute maximum, and the current collapses the moment a servo moves.",
           "",
           "It charges the 4S pack through a controller; the pack runs the machine through a",
           "buck set to exactly 5.0 V. Sun charges the battery, the battery runs the machine,",
           "and the converter is what makes it safe to connect."]}
  ];
  return SPOTS;
}
function ROOM_DISP(i){ return ROOM.disp[i]; }
function ROOM_BELT(){ return ROOM.belt; }
function ROOM_SOLAR(){ return ROOM.solar; }
/* the one you are closest to and actually looking at */
function pickSpot(){
  if(!walk.on || walk.panel || walk.bore){ walk.spot = null; return; }
  var best = null, bestScore = 1e9;
  var yw = walk.yaw * Math.PI / 180, fx = Math.sin(yw), fz = Math.cos(yw);
  /* Every part of this machine stands over the same square metre of floor, so
     distance and heading alone cannot separate the mouth from the box under
     it. Height does: where his eye is aimed decides which part he is asking
     about, which is why looking down at the base gives you the base.      */
  var eye = walk.alt + EYE_H + (SIT_EYE - EYE_H) * walk.seatE;
  spots().forEach(function(sp){
    var dx = sp.x - walk.x, dz = sp.z - walk.z;
    var d = Math.sqrt(dx*dx + dz*dz);
    if(d > sp.r || d < 1) return;
    var dot = (dx*fx + dz*fz) / d;
    if(dot < 0.55) return;                    /* it has to be roughly in front */
    var up = Math.atan2((sp.h || 0) - eye, d) * 180 / Math.PI;
    var off = Math.abs(up - walk.pitch);
    if(off > 46) return;                      /* he is not looking at it at all */
    var score = d * (2 - dot) * (1 + off / 26);
    if(score < bestScore){ bestScore = score; best = sp; }
  });
  walk.spot = best;
}
/* What he is standing in front of, once he is close enough and looking at it.
   On his feet it is a chip with the name of the part and how to settle down to
   it; seated, it is the whole briefing — the same sketch and the same findings
   the cards under the picture are built on. Standing over a 900 mm prototype
   means looking down on it, which is why this is the seated view: everything a
   defence is actually about is below chest height.                          */
function walkStudy(){
  var sp = walk.spot;
  if(!sp || walk.bore) return "";
  var dx = sp.x - walk.x, dz = sp.z - walk.z, d = Math.sqrt(dx*dx + dz*dz);
  if(walk.seatE < 0.5){
    var t = "\u25B8  " + sp.key + "   \u00b7   sit down (C) and read it";
    var w = 30 + t.length * 6.9, x = (WALK_W - w) / 2, y = WALK_H - 104;
    return '<g opacity="' + (0.95 - walk.seatE).toFixed(2) + '">' +
      '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) +
      '" height="30" rx="8" fill="#0A1214" opacity=".92" stroke="#2C3A3C" stroke-width="1.2"/>' +
      '<text x="' + (x + 15).toFixed(1) + '" y="' + (y + 20) +
      '" font-family="IBM Plex Mono, monospace" font-size="12" fill="#9FB6B2">' + esc(t) + '</text></g>';
  }
  /* re-wrapped narrower than the source lines, so the card can sit clear of
     the machine instead of on top of the thing he is looking at */
  var lines = [];
  sp.lines.forEach(function(L){
    if(!L){ lines.push(""); return; }
    wrap(L, 62).forEach(function(t, i){ lines.push(i ? "  " + t : t); });
  });
  lines = lines.slice(0, 17);
  var w = 476, x = WALK_W - w - 22;
  var h = 80 + Math.max(0, lines.length - 1) * 17 + 14, y = WALK_H - h - 22;
  var o = '<g opacity="' + walk.seatE.toFixed(2) + '">' +
    '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
    '" rx="10" fill="#0A1214" opacity=".95" stroke="#2C3A3C" stroke-width="1.4"/>' +
    '<rect x="' + x + '" y="' + y + '" width="4" height="' + h + '" rx="2" fill="#5FE3CF"/>' +
    '<text x="' + (x + 18) + '" y="' + (y + 24) + '" font-family="IBM Plex Mono, monospace" ' +
    'font-size="11" letter-spacing="1.4" fill="#5FE3CF">SEATED AT IT</text>' +
    '<text x="' + (x + w - 16) + '" y="' + (y + 24) + '" text-anchor="end" ' +
    'font-family="IBM Plex Mono, monospace" font-size="10" fill="#5A6B6E">' +
    Math.round(d) + ' mm away &#183; C to stand up</text>' +
    '<text x="' + (x + 18) + '" y="' + (y + 46) + '" font-family="Chakra Petch, sans-serif" ' +
    'font-size="16" font-weight="600" fill="#DCEAE7">' + esc(sp.key) + '</text>';
  lines.forEach(function(L, i){
    o += '<text x="' + (x + 18) + '" y="' + (y + 68 + i * 17) + '" font-family="IBM Plex Mono, monospace" ' +
         'font-size="11" fill="' + (/^FINDING/.test(L) ? "#F2685E" : "#9FB6B2") + '">' + esc(L) + '</text>';
  });
  return o + '</g>';
}
/* the plan in the corner: where you are, and which way you are facing */
function walkPlan(){
  if(walk.seatE > 0.6) return "";        /* seated: the briefing has that corner */
  var S = 0.026, px = WALK_W - 150, py = WALK_H - 150;
  function pp(X, Z){ return {x:px + (X + 500) * S, y:py - (Z - 450) * S}; }
  var o = '<g opacity=".93"><rect x="' + (px-128) + '" y="' + (py-128) +
          '" width="256" height="256" rx="10" fill="#0A1214" stroke="#2C3A3C" stroke-width="1.4"/>';
  var r0 = pp(ROOM.x0, ROOM.z1), r1 = pp(ROOM.x1, ROOM.z0);
  o += '<rect x="'+r0.x.toFixed(1)+'" y="'+r0.y.toFixed(1)+'" width="'+(r1.x-r0.x).toFixed(1)+'" height="'+(r1.y-r0.y).toFixed(1)+
       '" fill="#101B1D" stroke="#3A4A4C" stroke-width="1"/>';
  var tb = pp(ROOM.table.X - ROOM.table.w/2, ROOM.table.Z + ROOM.table.d/2);
  o += '<rect x="'+tb.x.toFixed(1)+'" y="'+tb.y.toFixed(1)+'" width="'+(ROOM.table.w*S).toFixed(1)+'" height="'+(ROOM.table.d*S).toFixed(1)+'" fill="#6E4E24"/>';
  var bd = pp(ROOM.board.X - ROOM.board.w/2, ROOM.z1);
  o += '<rect x="'+bd.x.toFixed(1)+'" y="'+(bd.y-3).toFixed(1)+'" width="'+(ROOM.board.w*S).toFixed(1)+'" height="3" fill="#33553F"/>';
  var mc = pp(0, 0);
  o += '<circle cx="' + mc.x.toFixed(1) + '" cy="' + mc.y.toFixed(1) + '" r="9" fill="none" stroke="#7A2E4C" stroke-width="2.6"/>';
  ROOM.stu.forEach(function(q){ var p = pp(q.X,q.Z);
    o += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="4" fill="#2B4C7E"/>'; });
  ROOM.pan.forEach(function(q){ var p = pp(q.X,q.Z);
    o += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="4" fill="#8C6B4A"/>'; });
  ROOM.disp.forEach(function(q,i){ var p = pp(q.X,q.Z);
    o += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="4" fill="'+BINS[i].col+'"/>'; });
  var me = pp(walk.x, walk.z), yw = walk.yaw * Math.PI / 180;
  o += '<path d="M' + (me.x + 26*Math.sin(yw)).toFixed(1) + " " + (me.y - 26*Math.cos(yw)).toFixed(1) +
       ' L' + (me.x + 11*Math.sin(yw+2.5)).toFixed(1) + " " + (me.y - 11*Math.cos(yw+2.5)).toFixed(1) +
       ' L' + (me.x + 11*Math.sin(yw-2.5)).toFixed(1) + " " + (me.y - 11*Math.cos(yw-2.5)).toFixed(1) +
       ' Z" fill="#5FE3CF"/>';
  o += '<text x="' + (px-119) + '" y="' + (py-110) + '" font-family="IBM Plex Mono, monospace" ' +
       'font-size="11" fill="#5A6B6E">PLAN &middot; you are here</text></g>';
  return o;
}
/* The close inspection card keeps the sensor names and jobs readable while
   the model shows their physical placement. It is deliberately short: this
   view should explain the path at a glance, not become another report page. */
function walkSensorCard(){
  if(walk.focus !== "hole" && walk.focus !== "sensors") return "";
  var x = 22, y = 548, w = 430, h = 246;
  var d3 = digitalReadPin(1), d4 = digitalReadPin(0), d7 = digitalReadPin(2);
  var rows = [
    {pin:"D3", name:"CAPACITIVE", job:"plastic / material presence", val:d3, col:"#5FD0D8"},
    {pin:"D4", name:"INDUCTIVE",  job:"metal only · checked first", val:d4, col:"#F0C758"},
    {pin:"D7", name:"INFRARED",   job:"object resting on gate", val:d7, col:"#F26872"}
  ];
  var o = '<g><rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+
          '" rx="11" fill="#081113" opacity=".96" stroke="#355052" stroke-width="1.4"/>' +
          '<rect x="'+x+'" y="'+y+'" width="4" height="'+h+'" rx="2" fill="#5FE3CF"/>' +
          '<text x="'+(x+18)+'" y="'+(y+24)+'" font-family="IBM Plex Mono, monospace" font-size="10" '+
          'letter-spacing="1.5" fill="#5FE3CF">CLEAR INPUT PATH · Ø184 MM MOUTH</text>' +
          '<text x="'+(x+18)+'" y="'+(y+48)+'" font-family="Chakra Petch, sans-serif" font-size="16" '+
          'font-weight="600" fill="#EDF6F4">Sensors stay in the wall — not in the hole</text>' +
          '<text x="'+(x+18)+'" y="'+(y+67)+'" font-family="IBM Plex Mono, monospace" font-size="10.5" '+
          'fill="#8FA6A2">128 mm clear between stage-1 faces · gate is the floor</text>';
  rows.forEach(function(r, i){
    var yy = y + 91 + i * 43, live = r.val === LOW;
    o += '<circle cx="'+(x+27)+'" cy="'+(yy+8)+'" r="7" fill="'+(live?r.col:"#263033")+
         '" stroke="'+r.col+'" stroke-width="1.5"/>' +
         '<text x="'+(x+44)+'" y="'+(yy+5)+'" font-family="IBM Plex Mono, monospace" font-size="11" '+
         'font-weight="600" fill="'+r.col+'">'+r.pin+' · '+r.name+'</text>' +
         '<text x="'+(x+44)+'" y="'+(yy+20)+'" font-family="IBM Plex Mono, monospace" font-size="10" '+
         'fill="#93A7A3">'+r.job+'</text>' +
         '<rect x="'+(x+w-67)+'" y="'+(yy-5)+'" width="48" height="24" rx="7" fill="'+
         (live?r.col:"#172124")+'" stroke="'+r.col+'" stroke-width="1"/>' +
         '<text x="'+(x+w-43)+'" y="'+(yy+11)+'" text-anchor="middle" font-family="IBM Plex Mono, monospace" '+
         'font-size="10" font-weight="700" fill="'+(live?"#071012":"#80918E")+'">'+(live?"LOW":"HIGH")+'</text>';
  });
  o += '<text x="'+(x+18)+'" y="'+(y+h-15)+'" font-family="IBM Plex Mono, monospace" font-size="10" '+
       'fill="#6F8581">stage 1: name material  →  stage 2: confirm object  →  D6 gate</text></g>';
  return o;
}
function prototypeBackdrop(){
  var o = '<defs><radialGradient id="prototypeGlow" cx="62%" cy="42%" r="68%">' +
          '<stop offset="0" stop-color="#203337"/><stop offset=".58" stop-color="#111D20"/>' +
          '<stop offset="1" stop-color="#081012"/></radialGradient></defs>' +
          '<rect x="0" y="0" width="1200" height="820" fill="url(#prototypeGlow)"/>' +
          '<path d="M420 708 H1140 M462 648 H1090 M502 598 H1048" stroke="#294044" stroke-width="1" opacity=".65"/>';
  for(var x = 430; x <= 1130; x += 70)
    o += '<path d="M'+x+' 708 L'+(740+(x-780)*.43)+' 470" stroke="#22363A" stroke-width="1" opacity=".45"/>';
  o += '<text x="1174" y="38" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" '+
       'letter-spacing="1.6" fill="#55706F">LIVE ARDUINO STATE · 3D ASSEMBLY</text>';
  return o;
}
function prototypeLabels(){
  var hZ = MDL.hole, o = "";
  if(walk.focus === "sensors"){
    o += callout(0, hZ, MDL.gateH + MDL.throatH + MDL.hopH, -124, -50, "Ø184 MM INPUT");
    o += callout(-98, hZ, MDL.gateH + 40, -150, -42, "D3 · CAPACITIVE");
    o += callout(98, hZ, MDL.gateH + 40, 152, -42, "D4 · INDUCTIVE");
    o += callout(74, hZ - 4, MDL.gateH + 10, 158, 34, "D7 · INFRARED");
    o += callout(0, hZ, MDL.gateH, -146, 42, "D6 · GATE");
  } else if(walk.focus === "sorter"){
    o += callout(0, hZ, MDL.gateH, -154, -48, "D6 · RELEASE GATE");
    o += callout(MDL.usR * Math.sin(MDL.usB*Math.PI/180), MDL.usR * Math.cos(MDL.usB*Math.PI/180),
                 MDL.usH, 165, -54, "HC-SR04 · FILL LEVEL");
    o += callout(0, 0, MDL.plateH + MDL.plateT, 170, 24, "D5 · ROTATING PLATE");
    o += callout(0, 0, MDL.plateH + MDL.binH * .55, -176, 48, "3 SORTING BINS");
  } else {
    o += callout(0, hZ, MDL.gateH + MDL.throatH + MDL.hopH, -150, -48, "INPUT OPENING");
    o += callout(0, hZ, MDL.gateH, 152, -24, "D6 · GATE");
    o += callout(MDL.usR * Math.sin(MDL.usB*Math.PI/180), MDL.usR * Math.cos(MDL.usB*Math.PI/180),
                 MDL.usH, 170, -65, "HC-SR04");
    o += callout(MDL.mastR * Math.sin(MDL.mastB*Math.PI/180), MDL.mastR * Math.cos(MDL.mastB*Math.PI/180),
                 MDL.ctrlH + MDL.ctrlT, -170, -42, "UNO + LCD");
    o += callout(0, 0, MDL.plateH + MDL.plateT, 176, 32, "D5 · ROTATING BINS");
  }
  return o;
}
function drawBoreInspection(){
  var cx = 790, cy = 395, outer = 266, bore = 205, gateOpen = W.gate > 40;
  var d3 = digitalReadPin(1) === LOW, d4 = digitalReadPin(0) === LOW,
      d7 = digitalReadPin(2) === LOW;
  var o = '<defs>' +
    '<radialGradient id="boreStage" cx="66%" cy="46%" r="70%"><stop offset="0" stop-color="#203236"/>'+ 
    '<stop offset=".58" stop-color="#101B1E"/><stop offset="1" stop-color="#071012"/></radialGradient>' +
    '<radialGradient id="boreWall" cx="46%" cy="36%" r="70%"><stop offset="0" stop-color="#6A381C"/>'+ 
    '<stop offset=".58" stop-color="#32190E"/><stop offset="1" stop-color="#0A0807"/></radialGradient>' +
    '<linearGradient id="gateSteel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D7E0E2"/>'+ 
    '<stop offset=".48" stop-color="#8D9A9E"/><stop offset="1" stop-color="#4C585B"/></linearGradient></defs>' +
    '<rect x="0" y="0" width="1200" height="820" fill="url(#boreStage)"/>' +
    '<text x="1170" y="35" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" '+
    'letter-spacing="1.6" fill="#55706F">FIXED SECTION · LOOKING STRAIGHT DOWN</text>' +
    '<ellipse cx="'+cx+'" cy="'+(cy+20)+'" rx="'+(outer+20)+'" ry="'+(outer*.82)+'" fill="#000" opacity=".28"/>' +
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+outer+'" fill="#A8521C" stroke="#F09A4E" stroke-width="6"/>' +
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+(outer-20)+'" fill="url(#boreWall)" stroke="#6F3518" stroke-width="5"/>' +
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+bore+'" fill="#080D0F" stroke="#29373A" stroke-width="4"/>' +
    '<path d="M'+(cx-bore+8)+' '+(cy-42)+' A '+(bore-8)+' '+(bore-8)+' 0 0 1 '+(cx+bore-8)+' '+(cy-42)+'" '+
    'fill="none" stroke="#B86836" stroke-width="18" opacity=".34"/>';

  /* Gate: the floor of the throat. Open is deliberately a black void with the
     flap parked on its hinge, so nobody can mistake it for a closed plate. */
  if(gateOpen){
    o += '<circle cx="'+cx+'" cy="'+cy+'" r="154" fill="#030708" stroke="#1A2527" stroke-width="3"/>' +
         '<rect x="'+(cx-172)+'" y="'+(cy-145)+'" width="20" height="290" rx="8" fill="url(#gateSteel)" '+
         'stroke="#B7C3C6" stroke-width="2"/>' +
         '<text x="'+cx+'" y="'+(cy+7)+'" text-anchor="middle" font-family="IBM Plex Mono, monospace" '+
         'font-size="17" font-weight="700" letter-spacing="2" fill="#F2685E">OPEN PATH TO BIN</text>';
  } else {
    o += '<circle cx="'+cx+'" cy="'+cy+'" r="154" fill="url(#gateSteel)" stroke="#D5DEE0" stroke-width="3"/>' +
         '<path d="M'+(cx-132)+' '+(cy-36)+' H'+(cx+132)+'" stroke="#F7FBFC" stroke-width="4" opacity=".32"/>' +
         '<text x="'+cx+'" y="'+(cy+94)+'" text-anchor="middle" font-family="IBM Plex Mono, monospace" '+
         'font-size="16" font-weight="700" letter-spacing="2" fill="#273235">D6 GATE · CLOSED</text>' +
         '<text x="'+cx+'" y="'+(cy+116)+'" text-anchor="middle" font-family="IBM Plex Mono, monospace" '+
         'font-size="10" fill="#46575A">holds waste on the sensor line</text>';
  }

  /* Stage 1 heads are mounted through opposite walls. Their sensing faces end
     at the bore; every pixel between the two dashed ticks is clear air. */
  o += '<g>' +
    '<rect x="485" y="355" width="130" height="80" rx="14" fill="#247B84" stroke="#73DFE5" stroke-width="3"/>' +
    '<rect x="585" y="368" width="82" height="54" rx="12" fill="#45BAC3" stroke="#A4F4F7" stroke-width="2"/>' +
    '<circle cx="664" cy="395" r="31" fill="'+(d3?'#7EFAFF':'#6ACFD5')+'" stroke="#D1FCFF" stroke-width="3"/>' +
    (d3?'<circle cx="664" cy="395" r="42" fill="none" stroke="#7EFAFF" stroke-width="3" opacity=".55"/>':'') +
    '<rect x="913" y="355" width="182" height="80" rx="14" fill="#A97516" stroke="#F0C758" stroke-width="3"/>' +
    '<rect x="902" y="368" width="94" height="54" rx="12" fill="#D69D27" stroke="#FFE28A" stroke-width="2"/>' +
    '<circle cx="916" cy="395" r="31" fill="'+(d4?'#FFF19A':'#E6BC4D')+'" stroke="#FFF1AE" stroke-width="3"/>' +
    (d4?'<circle cx="916" cy="395" r="42" fill="none" stroke="#F0C758" stroke-width="3" opacity=".55"/>':'') +
    '<path d="M695 395 H885" stroke="#5FE3CF" stroke-width="3" stroke-dasharray="9 9"/>' +
    '<path d="M695 376 V414 M885 376 V414" stroke="#5FE3CF" stroke-width="3"/>' +
    '<text x="790" y="365" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" '+
    'font-weight="700" letter-spacing="1" fill="#78F0DF">128 MM CLEAR AIR</text>' +
    '<text x="550" y="335" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" '+
    'font-weight="700" fill="#7EFAFF">D3 · CAPACITIVE</text>' +
    '<text x="1010" y="335" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" '+
    'font-weight="700" fill="#F0C758">D4 · INDUCTIVE</text></g>';

  /* Stage 2 sits lower and looks across the gate rather than blocking it. */
  o += '<g transform="rotate(-28 1012 570)">' +
    '<rect x="936" y="535" width="152" height="70" rx="12" fill="#922F3B" stroke="#F26872" stroke-width="3"/>' +
    '<circle cx="962" cy="570" r="15" fill="#401018" stroke="#FF99A2" stroke-width="2"/>' +
    '<circle cx="1000" cy="570" r="15" fill="'+(d7?'#FF7D86':'#6E1E27')+'" stroke="#FF99A2" stroke-width="2"/>' +
    '</g><path d="M945 545 L682 465" stroke="#F26872" stroke-width="3" stroke-dasharray="8 8" opacity=".9"/>' +
    '<text x="1050" y="635" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" '+
    'font-weight="700" fill="#FF8D96">D7 · INFRARED · STAGE 2</text>' +
    '<text x="1050" y="652" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" '+
    'fill="#B89295">beam crosses the gate face</text>';
  o += '<path d="M790 105 V184" stroke="#5FE3CF" stroke-width="4" stroke-dasharray="10 9"/>' +
       '<path d="M778 174 L790 194 L802 174" fill="#5FE3CF"/>' +
       '<text x="790" y="82" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-size="20" '+
       'font-weight="700" fill="#EDF6F4">WASTE ENTERS HERE</text>' +
       '<text x="790" y="104" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" '+
       'fill="#77908C">full Ø184 mm opening · nothing crosses the center</text>';
  return o;
}
var walkSig = "";
function drawWalk(){
  if(!walk.on) return;
  walk.pitch = Math.max(-78, Math.min(78, walk.pitch));
  var body;
  if(walk.bore){
    /* A dedicated live section is clearer than projecting the whole assembly
       from above: the plate and controller cannot cover the bore or its heads. */
    cutOn = true;
    VIEW.mode = "plan"; VIEW.az = 0;
    body = drawBoreInspection();
  } else {
    var staged = walk.focus !== "walk";
    VIEW.mode = "persp"; VIEW.cx = staged ? 760 : WALK_W / 2; VIEW.cy = staged ? 230 : 250;
    VIEW.yaw = walk.yaw; setPitch(walk.pitch); VIEW.f = 660;
    VIEW.near = walk.third ? 700 : 400;      /* do not clip through his own back */
    camFromWalk();
    body = staged
      ? prototypeBackdrop() + collect(false) + (labelsOn ? prototypeLabels() : "")
      : collect(true) + walkPlan() + walkStudy();
  }
  body += walkSensorCard();
  if(body !== walkSig){ walkSig = body; $("walkView").innerHTML = body; }
  var t = walk.bore ? "looking straight down the input hole &middot; the bore, sectioned"
        : "x " + Math.round(walk.x) + " mm &middot; z " + Math.round(walk.z) +
          " mm &middot; facing " + Math.round(walk.yaw) + "\u00b0 &middot; " +
          (walk.sit ? "seated" : walk.fly ? "flying at " + Math.round(walk.alt) + " mm" : "on the floor");
  if($("walkPos").innerHTML !== t) $("walkPos").innerHTML = t;
}
function setWalk(on){
  walk.on = on;
  walk.last = 0; walk.hold = {}; walk.vf = walk.vs = walk.vy = walk.va = walk.vg = 0;
  $("vbWalk").setAttribute("aria-pressed", String(on));
  $("vbWalk").textContent = on ? "Return to 2D scene" : "Open 3D walkthrough";
  $("scene").style.display = on ? "none" : "";
  $("walkView").style.display = on ? "" : "none";
  $("walkbar").style.display = on ? "" : "none";
  if(!on){ walk.bore = false; cutOn = false; walk.sit = false; walk.sitAfter = false; walk.seatE = 0; }
  paintWalkBar();
  $("vbHint").innerHTML = on
    ? "W A S D walks &middot; Q E turns &middot; R F flies &middot; Shift runs &middot; Space jumps &middot; C sits &middot; drag to look"
    : "drag to pan &middot; double-click to move in &middot; wheel zooms once you are inside";
  paintView(viewKey);
  syncProtoNav();
  if(on){ walkSig = ""; drawWalk(); }
}
var PROTO_FOCUS = {
  overview:{title:"Fixed 3D overview", copy:"The complete live prototype from a clear presentation angle: input, controller, gate and rotating bins."},
  hole:{title:"View down the input hole", copy:"A fixed section view shows the full opening, the 128 mm clear sensor gap, infrared beam and closed gate."},
  sensors:{title:"3D sensor cutaway", copy:"The chute turns transparent so D3 capacitive, D4 inductive and D7 infrared can be seen in their real positions."},
  sorter:{title:"Gate and rotating bins", copy:"Watch servo D6 release the item only after servo D5 parks the selected bin below the opening."},
  walk:{title:"Free 3D walkthrough", copy:"Walk around the prototype, drag to look, or use the movement controls and keyboard shortcuts below."}
};
function syncProtoNav(){
  var f = walk.on ? (walk.focus || "overview") : "";
  document.querySelectorAll("[data-proto-focus]").forEach(function(b){
    b.setAttribute("aria-pressed", String(b.getAttribute("data-proto-focus") === f));
  });
  /* 2D is where the page opens now, so this is a starting point, not a retreat */
  var v = walk.on ? PROTO_FOCUS[f] : {title:"2D working scene",
    copy:"Drop waste into the hopper and watch the sensors, the plate and the gate decide. Pick a view above to walk the 3D prototype."};
  $("protoViewTitle").textContent = v.title;
  $("protoViewCopy").textContent = v.copy;
}
function placeWalk(name){
  var c = CAMS[name]; if(!c) return;
  walk.x = c.x; walk.z = c.z; walk.yaw = c.yaw;
  walk.alt = Math.max(0, (c.eye || EYE_H) - EYE_H); walk.pitch = c.pitch;
  walk.glide = null; walk.fly = walk.alt > 0;
}
function setProtoFocus(name, instant){
  if(!PROTO_FOCUS[name]) return;
  if(!walk.on) setWalk(true);
  walk.focus = name;
  walk.bore = false; cutOn = false; walk.sit = false; walk.sitAfter = false;
  if(name === "hole"){
    walk.bore = true; cutOn = true;
  } else if(name === "overview"){
    if(instant) placeWalk("showcase"); else walkTo("showcase");
  } else if(name === "sensors"){
    cutOn = true;
    if(instant) placeWalk("sensor"); else walkTo("sensor");
  } else if(name === "sorter"){
    if(instant) placeWalk("sorter"); else walkTo("sorter");
  }
  paintWalkBar(); syncProtoNav(); walkSig = ""; drawWalk();
  if(name === "walk") $("walkView").focus({preventScroll:true});
  if(!instant && history.replaceState) history.replaceState(null, "", "#" + name);
}
function markFreeWalk(){
  if(walk.focus === "walk") return;
  walk.focus = "walk"; syncProtoNav();
}
document.querySelectorAll("[data-proto-focus]").forEach(function(b){
  b.addEventListener("click", function(){ setProtoFocus(this.getAttribute("data-proto-focus"), false); });
});
/* hold a pad to keep moving, let go to coast */
(function(){
  var bar = $("walkbar");
  function set(k, v){ if(k) walk.hold[k] = v; }
  function keyOf(e){
    var b = e.target.closest ? e.target.closest("[data-go]") : null;
    return b && b.getAttribute("data-go");
  }
  bar.addEventListener("pointerdown", function(e){
    var k = keyOf(e); if(!k) return;
    markFreeWalk();
    set(k, true); walk.glide = null;
    if(e.target.setPointerCapture && e.pointerId !== undefined)
      try{ e.target.setPointerCapture(e.pointerId); }catch(err){}
  });
  ["pointerup","pointercancel","pointerleave"].forEach(function(t){
    bar.addEventListener(t, function(e){ var k = keyOf(e); if(k) set(k, false); });
  });
  bar.addEventListener("click", function(e){
    var b = e.target.closest("[data-cam],[data-tog]");
    if(!b) return;
    var tg = b.getAttribute("data-tog");
    if(tg === "cut"){
      cutOn = !cutOn; walk.focus = cutOn ? "sensors" : "walk";
    }
    else if(tg === "fly"){ walk.fly = !walk.fly; if(!walk.fly) walk.va = 0; }
    else if(tg === "third") walk.third = !walk.third;
    else if(tg === "bore"){
      walk.bore = !walk.bore; if(!walk.bore) cutOn = false;
      walk.focus = walk.bore ? "hole" : "walk";
    }
    else if(tg === "sit") toggleSit();
    else if(tg === "labels") setLabels(!labelsOn);
    else { walk.focus = "walk"; walkTo(b.getAttribute("data-cam")); }
    paintWalkBar(); syncProtoNav(); walkSig = ""; drawWalk();
  });
})();
/* drag the picture to look around */
(function(){
  var drag = null, v = $("walkView");
  function down(e){
    if(!walk.on) return;
    markFreeWalk();
    var t = e.touches ? e.touches[0] : e;
    drag = {x:t.clientX, y:t.clientY, yaw:walk.yaw, pitch:walk.pitch};
    walk.glide = null;
    v.setAttribute("data-drag", "1");
  }
  function move(e){
    if(!drag) return;
    var t = e.touches ? e.touches[0] : e;
    walk.yaw  = drag.yaw  + (t.clientX - drag.x) * 0.30;
    walk.pitch = drag.pitch - (t.clientY - drag.y) * 0.16;
    walkClamp();
    if(e.cancelable) e.preventDefault();
  }
  function up(){ drag = null; v.removeAttribute("data-drag"); }
  v.addEventListener("mousedown", down);
  v.addEventListener("touchstart", down, {passive:true});
  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, {passive:false});
  window.addEventListener("mouseup", up);
  window.addEventListener("touchend", up);
  /* and the wheel walks you in and out, the way it zooms the scene */
  v.addEventListener("wheel", function(e){
    if(!walk.on) return;
    e.preventDefault();
    markFreeWalk();
    walkShove(e.deltaY < 0 ? 900 : -900);
  }, {passive:false});
})();
/* the keys. The letters work whenever you are inside; the arrow keys only once
   you have clicked the picture, because taking them off the scroll bar the rest
   of the time would be rude. */
(function(){
  var HOLD = {w:"fwd", s:"back", a:"sleft", d:"sright", q:"left", e:"right",
              r:"up", f:"down", shift:"run", " ":"jump"};
  var ARROW = {arrowup:"fwd", arrowdown:"back", arrowleft:"left", arrowright:"right"};
  function which(e){
    var el = document.activeElement;
    if(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return null;
    var k = e.key.toLowerCase();
    /* Space is the jump, but Space is also how a keyboard presses the button
       it is sitting on. The button wins: taking it away from a focused
       control would break the bar for anybody not using a mouse.        */
    if(k === " " && el && (el.tagName === "BUTTON" || el.getAttribute("role") === "button")) return null;
    if(HOLD[k]) return HOLD[k];
    if(ARROW[k] && el && ($("walkView") === el || $("walkbar").contains(el))) return ARROW[k];
    return null;
  }
  window.addEventListener("keydown", function(e){
    if(!walk.on) return;
    var el = document.activeElement;
    if(!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) &&
       e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault(); toggleSit(); paintWalkBar(); walkSig = ""; return;
    }
    var k = which(e); if(!k) return;
    e.preventDefault(); markFreeWalk(); walk.hold[k] = true; walk.glide = null;
  });
  window.addEventListener("keyup", function(e){
    var k = which(e); if(k) walk.hold[k] = false;
  });
  window.addEventListener("blur", function(){ walk.hold = {}; });
})();
$("vbWalk").addEventListener("click", function(){ setWalk(!walk.on); });

/* the two orthographic side panels, and the bearing each is standing at.
   Building the markup is cheap; handing the browser fresh SVG trees to parse
   sixty times a second is not, so a frame that draws the same machine as the
   last one writes nothing at all — which is most of them.               */
/* the orthographic set: a plan and the four elevations, all off the same solids */
var SIDE_PANES = [{id:"Top", az:0, plan:true}, {id:"Front", az:0}, {id:"Right", az:90},
                  {id:"Back", az:180}, {id:"Left", az:270}];
var sideOn = false, sideSpin = 0, sideSig = {}, sideSigT = "";
function drawSides(){
  if(!sideOn) return;
  var brg = function(a){ return ((Math.round(a) % 360) + 360) % 360; };
  SIDE_PANES.forEach(function(v){
    var az = v.az + sideSpin;
    var m = v.plan ? drawPlan(az) : drawModel(az);
    if(m !== sideSig[v.id]){ sideSig[v.id] = m; $("side" + v.id).innerHTML = m; }
    var lb = $("side" + v.id + "Bear");
    var txt = v.plan ? "plan · front at " + brg(-az) + "°" : brg(az) + "°";
    if(lb.textContent !== txt) lb.textContent = txt;
  });
  var fb = frontBin();
  var txt = "plate " + Math.round(W.R) + "° (write " + W.rotVal + ")  ·  gate " +
    (W.gateVal < 90 ? "open" : "shut") + " (write " + W.gateVal + ")  ·  " +
    Math.round(W.distance) + " cm " +
    (fb < 0 ? "past the plate — no bin under the hole"
            : binAway(fb) ? "past the plate — the " + BINS[fb].key + " bin is off it"
                          : "into the " + BINS[fb].key + " bin");
  if(txt !== sideSigT){ sideSigT = txt; $("sideState").textContent = txt; }
}
function setSideCard(on){
  sideOn = on;
  $("sideBtn").setAttribute("aria-pressed", String(on));
  $("sideBtn").textContent = "Side views: " + (on ? "on" : "off");
  $("sideCard").style.display = on ? "" : "none";
  if(on){ sideSig = {}; sideSigT = ""; drawSides(); }
}
$("sideBtn").addEventListener("click", function(){ setSideCard(!sideOn); });
$("sideSpin").addEventListener("input", function(){
  sideSpin = parseFloat(this.value) || 0;
  $("sideSpinLbl").textContent = (sideSpin > 0 ? "+" : "") + Math.round(sideSpin) + "°";
  drawSides();
});
$("sideSpinReset").addEventListener("click", function(){
  sideSpin = 0; $("sideSpin").value = "0"; $("sideSpinLbl").textContent = "0°";
  drawSides();
});

buildSamples(); buildMeters();
paintDispMode();                       /* DISP_MODE is declared below the card */
document.getElementById("cpShared").setAttribute("d", BIN_PATH);
resetServosAndLCD(); W.lcdInits = 1;
/* Open on the 2D scene. It is the one you can actually test: drop a piece of
   waste in and watch the sensors, the plate and the gate decide what to do with
   it. The 3D walkthrough is one button away, and a #hash still opens straight
   into a named 3D view for anyone linking to one. */
var initial3D = location.hash ? location.hash.slice(1) : "";
if(PROTO_FOCUS[initial3D]) setProtoFocus(initial3D, true);
else setWalk(false);
requestAnimationFrame(frame);
})();
