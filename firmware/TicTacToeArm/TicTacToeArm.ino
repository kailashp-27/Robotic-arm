/*
  Tic-Tac-Toe Playing Robotic Arm : Six-actuator controller (Arduino Uno)
  6 servo arm, servos straight on Uno pins. No PCA9685, no WiFi.
  Original pick-and-place controller: Aura Project Labs
  XO integration: protocol, explicit arming, watchdog, strict parser and RAM cell poses.

  Pins   : D9 base (360 continuous servo), D10 shoulder, D11 elbow, D5 wrist rotate, D3 wrist up/down, D6 gripper
           D2 optional IR obstacle sensor OUT (LOW = object present)
           D4 optional Stop push button to GND
           D7 optional base home switch to GND (pressed when the base is at Home)

  Base is a 360 servo: its pulse sets speed, not angle. The base is moved by TIME and its
  position is a running count of turn time in ms (+ = right). This drifts a little each move;
  the home switch (or the "Base is at Home" button) puts the count back.
  Power  : servos from an external 5 V supply sized for their load. Its GND tied to Uno GND.
  Control: complete_project dashboard (Chrome/Edge, Web Serial) at 115200, newline. Type "help".

  Teach and repeat: move the arm to each position and save it.
  Start runs: open, above pick, pick, close, lift, above place, place, open, lift, home.
*/
#include <Servo.h>
#include <EEPROM.h>
#include "types.h"

#define PIN_BASE      9
#define PIN_SHOULDER  10
#define PIN_ELBOW     11
#define PIN_WROT      5
#define PIN_WPITCH    3
#define PIN_GRIP      6
#define PIN_SENSOR    2
#define PIN_BUTTON    4
#define PIN_HOMESW    7
#define SEEK_MS       1500      // home switch search time each way

#define TICK_MS       20
#define US_MIN_HARD   500
#define US_MAX_HARD   2500
#define US_PER_DEG    11.1      // real servo: about 2000 us per 180 deg
#define CFG_MAGIC     0x5057    // changed for the 360 base layout

const uint8_t PIN[NS] = {PIN_BASE, PIN_SHOULDER, PIN_ELBOW, PIN_WROT, PIN_WPITCH, PIN_GRIP};

bool armed = false, baseReferenced = false;
uint32_t lastContact = 0;
const uint16_t LINK_TIMEOUT_MS = 1800;
Cfg C;
Servo sv[NS];

// ---------------- settings ----------------
void defaults() {
  memset(&C, 0, sizeof(C));
  C.magic = CFG_MAGIC;
  for (int s = 0; s < NS; s++) { C.mn[s] = US_MIN_HARD; C.mx[s] = US_MAX_HARD; }
  for (int w = 0; w < NW; w++) { for (int s = 0; s < NA; s++) C.wp[w][s] = 1500; C.wp[w][S_BASE] = 0; }
  C.bStop = 1500; C.bOff = 80; C.bRatio = 100; C.homeSw = 0;
  C.gOpen = 1500; C.gClose = 1500;
  C.speed = 60; C.slowPct = 40; C.gripMs = 400; C.pauseMs = 500; C.sensorOn = 0; C.cycles = 1; C.autoRun = 0;
}
void sanitize() {
  for (int s = 0; s < NS; s++) {
    C.mn[s] = constrain(C.mn[s], US_MIN_HARD, US_MAX_HARD);
    C.mx[s] = constrain(C.mx[s], US_MIN_HARD, US_MAX_HARD);
    if (C.mn[s] > C.mx[s]) { int16_t t = C.mn[s]; C.mn[s] = C.mx[s]; C.mx[s] = t; }
  }
  C.speed = constrain(C.speed, 5, 300);
  C.slowPct = constrain(C.slowPct, 5, 100);
  C.gripMs = constrain(C.gripMs, 0, 10000);
  C.pauseMs = constrain(C.pauseMs, 0, 60000);
  C.bStop = constrain(C.bStop, 1200, 1800);
  C.bOff = constrain(C.bOff, 10, 500);
  C.bRatio = constrain(C.bRatio, 50, 200);
}
void saveCfg() { sanitize(); EEPROM.put(0, C); }
bool loadCfg() { EEPROM.get(0, C); if (C.magic != CFG_MAGIC) return false; sanitize(); return true; }
bool allTaught() {
  for (int w = 0; w < NW; w++) if (!C.wpOk[w]) return false;
  return C.gOk == 3;
}

// ---------------- servo output ----------------
float cur[NS], goal[NS];
bool live[NS];

float clampUs(int s, float us) { return constrain(us, C.mn[s], C.mx[s]); }
void writeUs(int s, float us) {
  us = constrain(us, US_MIN_HARD, US_MAX_HARD);
  cur[s] = us;
  int v = (int)(us + 0.5);
  if (!live[s]) { sv[s].writeMicroseconds(v); sv[s].attach(PIN[s], US_MIN_HARD, US_MAX_HARD); live[s] = true; }
  sv[s].writeMicroseconds(v);
}
void relaxAll() { for (int s = 0; s < NS; s++) { sv[s].detach(); live[s] = false; } }

// ---------------- 360 base (moved by time) ----------------
float baseCount = 0;            // estimated base position: ms of turning (+ = right)
bool baseRun = false;
int8_t baseDir = 1;
uint32_t baseT0 = 0, baseDur = 0;
float baseFrom = 0, baseTo = 0;
bool homeSeek = false;
uint8_t seekPhase = 0;
uint32_t seekT0 = 0;
int8_t seekDir = 1;

void baseOut(int8_t dir) { writeUs(S_BASE, C.bStop + dir * C.bOff); }
void baseStart(float target) {
  float d = target - baseCount;
  if (fabs(d) < 1) { baseOut(0); baseRun = false; return; }
  baseDir = d > 0 ? 1 : -1;
  baseFrom = baseCount; baseTo = target;
  baseDur = (uint32_t)(fabs(d) * (baseDir < 0 ? C.bRatio / 100.0 : 1.0));
  baseT0 = millis();
  baseRun = true;
  baseOut(baseDir);
}
void baseTick() {                // called every loop pass for ms timing
  if (!baseRun) return;
  uint32_t el = millis() - baseT0;
  if (el >= baseDur) { baseOut(0); baseCount = baseTo; baseRun = false; }
  else baseCount = baseFrom + (baseTo - baseFrom) * (float)el / baseDur;
}
void baseHalt() { if (baseRun) { baseTick(); baseOut(0); baseRun = false; } homeSeek = false; if (live[S_BASE]) baseOut(0); }
bool homeSwitch() { return digitalRead(PIN_HOMESW) == LOW; }

// Home switch search: turn slowly the same way for SEEK_MS, then the other way for 2 x SEEK_MS.
void seekStart(int8_t dir) {
  homeSeek = true; seekPhase = 1; seekDir = dir; seekT0 = millis();
  writeUs(S_BASE, C.bStop + seekDir * C.bOff / 2);
}

// Smooth move: all moving servos arrive together. to[s] = NAN: leave that servo alone.
// The base (360 servo) is started here too, but it runs by time in baseTick().
bool moving = false;
float mFrom[NS], mTo[NS], mT, mStep;
bool mUse[NS];
void startMove(const float to[NS], float degS) {
  float maxUs = 0;
  for (int s = 0; s < NS; s++) {
    mUse[s] = !isnan(to[s]);
    if (s == S_BASE) { if (mUse[s]) baseStart(to[s]); mUse[s] = false; continue; }
    if (!mUse[s]) continue;
    mTo[s] = clampUs(s, to[s]);
    mFrom[s] = live[s] ? cur[s] : mTo[s];          // relaxed servo jumps once
    goal[s] = mTo[s];
    maxUs = max(maxUs, fabs(mTo[s] - mFrom[s]));
  }
  float ms = maxUs / US_PER_DEG / degS * 1000.0;
  mStep = ms <= TICK_MS ? 1.0 : TICK_MS / ms;
  mT = 0;
  moving = true;
}
void moveOne(int s, float us, float degS) { float to[NS]; for (int k = 0; k < NS; k++) to[k] = NAN; to[s] = us; startMove(to, degS); }
void moveToWp(int w, float degS) {           // all arm joints together, gripper stays
  float to[NS];
  for (int k = 0; k < NA; k++) to[k] = C.wp[w][k];
  to[S_GRIP] = NAN;
  startMove(to, degS);
}

// ---------------- pick and place sequence ----------------
const Step SEQ[] = {
  {ST_SENSOR, 0, 0},              // wait for an object (only if the sensor is on)
  {ST_GRIP, 1, 0},                // open
  {ST_MOVE, W_PICK_UP, 0},
  {ST_MOVE, W_PICK, 1},           // slow down to the object
  {ST_GRIP, 0, 0},                // close
  {ST_WAIT, 0, 0},                // let the grip settle
  {ST_MOVE, W_PICK_UP, 1},        // lift slowly
  {ST_MOVE, W_PLACE_UP, 0},
  {ST_MOVE, W_PLACE, 1},          // slow down to place
  {ST_GRIP, 1, 0},                // open
  {ST_WAIT, 0, 0},
  {ST_MOVE, W_PLACE_UP, 1},
  {ST_MOVE, W_HOME, 0},
  {ST_WAIT, 1, 0},                // pause at the end of the cycle
};
const int NSTEP = sizeof(SEQ) / sizeof(SEQ[0]);

bool running = false, waiting = false, seekAfter = false;
int stepIdx = 0, cyclesWanted = 1, cyclesDone = 0;
uint32_t waitUntil = 0, sensorSince = 0;
char errMsg[48] = "";
uint8_t errId = 0;

void setErr(const __FlashStringHelper* m) { strncpy_P(errMsg, (const char*)m, sizeof(errMsg) - 1); errId++; }
void stopAll() { running = false; moving = false; waiting = false; seekAfter = false; baseHalt(); for (int s = 0; s < NS; s++) goal[s] = cur[s]; }
void seekTick() {
  if (!homeSeek) return;
  if (homeSwitch()) { baseOut(0); homeSeek = false; baseCount = C.wp[W_HOME][S_BASE]; return; }
  uint32_t el = millis() - seekT0;
  if (seekPhase == 1 && el > SEEK_MS) { seekPhase = 2; seekDir = -seekDir; seekT0 = millis(); writeUs(S_BASE, C.bStop + seekDir * C.bOff / 2); }
  else if (seekPhase == 2 && el > 2 * SEEK_MS) { setErr(F("home switch not found, base stopped")); stopAll(); }
}
bool objectPresent() { return digitalRead(PIN_SENSOR) == LOW; }

// Starts step stepIdx. Returns true when the step needs no waiting.
bool startStep() {
  const Step& st = SEQ[stepIdx];
  float slow = C.speed * C.slowPct / 100.0;
  switch (st.type) {
    case ST_MOVE:
      moveToWp(st.arg, st.slow ? slow : C.speed);
      if (st.arg == W_HOME && C.homeSw) seekAfter = true;   // re-zero the base at the switch
      return false;
    case ST_GRIP: moveOne(S_GRIP, st.arg ? C.gOpen : C.gClose, C.speed); return false;
    case ST_WAIT: waitUntil = millis() + (st.arg ? C.pauseMs : C.gripMs); waiting = true; return false;
    case ST_SENSOR:
      if (!C.sensorOn) return true;
      sensorSince = 0; waiting = true; return false;
  }
  return true;
}

void seqTick() {
  if (!running || moving || baseRun || homeSeek) return;
  if (seekAfter) { seekAfter = false; if (!homeSwitch()) { seekStart(baseDir); return; } baseCount = C.wp[W_HOME][S_BASE]; }
  if (waiting) {
    const Step& st = SEQ[stepIdx];
    if (st.type == ST_SENSOR) {
      if (!objectPresent()) { sensorSince = 0; return; }
      if (!sensorSince) sensorSince = millis();
      if (millis() - sensorSince < 300) return;        // object must stay for 0.3 s
    } else if ((int32_t)(millis() - waitUntil) < 0) return;
    waiting = false;
  }
  // the current step is finished: start the next one
  while (true) {
    stepIdx++;
    if (stepIdx >= NSTEP) {
      cyclesDone++;
      if (cyclesWanted && cyclesDone >= cyclesWanted) { running = false; return; }
      stepIdx = 0;
    }
    if (!startStep()) return;
  }
}

bool startCycle(int n) {
  if (!armed || !baseReferenced) { setErr(F("arm and reference base first")); return false; }
  for (int s=1; s<NS; s++) if (!live[s]) { setErr(F("enable all five positional servos first")); return false; }
  if (!allTaught()) { setErr(F("teach all 5 positions and both gripper positions first")); return false; }
  stopAll();
  cyclesWanted = n; cyclesDone = 0;
  running = true;
  stepIdx = -1;               // seqTick moves to step 0
  errMsg[0] = 0;
  return true;
}

void motionTick() {
  if (moving) {
    mT = min(1.0, mT + mStep);
    float e = mT*mT*mT*(10 + mT*(-15 + 6*mT));                 // smooth start and stop
    for (int s = 0; s < NS; s++) if (mUse[s]) writeUs(s, mFrom[s] + (mTo[s] - mFrom[s]) * e);
    if (mT >= 1) moving = false;
  }
  seqTick();
}

// Stop push button on D4 (to GND).
void buttonTick() {
  static uint8_t last = HIGH;
  static uint32_t t = 0;
  uint8_t b = digitalRead(PIN_BUTTON);
  if (b != last && millis() - t > 50) {
    t = millis();
    last = b;
    if (b == LOW) { stopAll(); armed = false; baseReferenced=false; } // Never starts.
  }
}

// ---------------- serial commands ----------------
char line[96];
bool lineOverflow = false;
uint8_t lineLen = 0;

void ok() { Serial.println(F("ok")); }
void errF(const __FlashStringHelper* m) { Serial.print(F("err ")); Serial.println(m); }

void printStatus() {
  Serial.print(F("{\"st\":1,\"protocol\":2,\"actuators\":6,\"baseMode\":\"continuous\",\"armed\":")); Serial.print(armed);
  Serial.print(F(",\"referenced\":")); Serial.print(baseReferenced);
  Serial.print(F(",\"running\":")); Serial.print(running);
  Serial.print(F(",\"moving\":")); Serial.print(moving);
  Serial.print(F(",\"si\":")); Serial.print(running ? stepIdx : -1);
  Serial.print(F(",\"done\":")); Serial.print(cyclesDone);
  Serial.print(F(",\"want\":")); Serial.print(cyclesWanted);
  Serial.print(F(",\"sensor\":")); Serial.print(objectPresent());
  Serial.print(F(",\"taught\":")); Serial.print(allTaught());
  Serial.print(F(",\"errId\":")); Serial.print(errId);
  Serial.print(F(",\"err\":\"")); Serial.print(errMsg);
  Serial.print(F("\",\"us\":[")); for (int s = 0; s < NS; s++) { if (s) Serial.print(','); Serial.print((int)(goal[s] + 0.5)); }
  Serial.print(F("],\"live\":[")); for (int s = 0; s < NS; s++) { if (s) Serial.print(','); Serial.print(live[s]); }
  Serial.print(F("],\"mn\":[")); for (int s = 0; s < NS; s++) { if (s) Serial.print(','); Serial.print(C.mn[s]); }
  Serial.print(F("],\"mx\":[")); for (int s = 0; s < NS; s++) { if (s) Serial.print(','); Serial.print(C.mx[s]); }
  Serial.print(F("],\"wp\":["));
  for (int w = 0; w < NW; w++) {
    if (w) Serial.print(',');
    Serial.print('['); Serial.print(C.wpOk[w]);
    for (int k = 0; k < NA; k++) { Serial.print(','); Serial.print(C.wp[w][k]); }
    Serial.print(']');
  }
  Serial.print(F("],\"gOpen\":")); Serial.print(C.gOpen);
  Serial.print(F(",\"gClose\":")); Serial.print(C.gClose);
  Serial.print(F(",\"gOk\":")); Serial.print(C.gOk);
  Serial.print(F(",\"set\":{\"speed\":")); Serial.print(C.speed, 0);
  Serial.print(F(",\"slowPct\":")); Serial.print(C.slowPct, 0);
  Serial.print(F(",\"gripMs\":")); Serial.print(C.gripMs);
  Serial.print(F(",\"pauseMs\":")); Serial.print(C.pauseMs);
  Serial.print(F(",\"sensorOn\":")); Serial.print(C.sensorOn);
  Serial.print(F(",\"cycles\":")); Serial.print(C.cycles);
  Serial.print(F(",\"autoRun\":")); Serial.print(C.autoRun);
  Serial.print(F("},\"bc\":")); Serial.print(baseCount, 0);
  Serial.print(F(",\"brun\":")); Serial.print(baseRun || homeSeek);
  Serial.print(F(",\"bs\":")); Serial.print(C.bStop);
  Serial.print(F(",\"bo\":")); Serial.print(C.bOff);
  Serial.print(F(",\"br\":")); Serial.print(C.bRatio);
  Serial.print(F(",\"hs\":")); Serial.print(C.homeSw);
  Serial.print(F(",\"sw\":")); Serial.print(homeSwitch());
  Serial.println('}');
}


// Strict whole-token integers: malformed or overflowing messages never become motion.
bool integer(const char* p, long lo, long hi, long &v) {
  if (!p || !*p) return false;
  char* end; v = strtol(p, &end, 10);
  return !*end && v >= lo && v <= hi;
}
void handleLine(char* str) {
  char* args[8]; uint8_t n=0;
  for (char* p=strtok(str," \t"); p; p=strtok(nullptr," \t")) {
    if (n>=8) return errF(F("too many arguments"));
    args[n++]=p;
  }
  if (!n) return;
  const char* cmd=args[0]; long a=0,b=0;
  lastContact=millis();
  if (!strcmp(cmd,"?") && n==1) { printStatus(); return; }
  if (!strcmp(cmd,"hello") && n==1) { Serial.println(F("XOARM 2 6 CONTINUOUS")); return; }
  if (!strcmp(cmd,"ping") && n==1) { ok(); return; }
  if (!strcmp(cmd,"help") && n==1) {
    Serial.println(F("XOARM2: hello | ? | ping | arm confirm | stop | relax"));
    Serial.println(F("raw s us | nudge s delta_us | bjog signed_ms | bhome"));
    Serial.println(F("savewp 0..4 | gowp 0..4 | gsave open|close | grip open|close"));
    Serial.println(F("cellup bc s e roll pitch | celldown bc s e roll pitch | start 1"));
    Serial.println(F("lim s min|max | bset stop|speed|ratio|homesw v | set speed|slow|gripms|pausems|sensor v"));
    return;
  }
  if (!strcmp(cmd,"stop") && n==1) { stopAll(); armed=false; baseReferenced=false; ok(); return; }
  if (!strcmp(cmd,"relax") && n==1) { stopAll(); armed=false; baseReferenced=false; relaxAll(); ok(); return; }
  if (!strcmp(cmd,"arm") && n==2 && !strcmp(args[1],"confirm")) {
    if (running || moving || baseRun || homeSeek) return errF(F("busy"));
    armed=true; errMsg[0]=0; ok(); return; // No servo attach here.
  }
  if (!armed) return errF(F("disarmed: send arm confirm"));
  if (running || moving || baseRun || homeSeek) return errF(F("busy: send stop first"));
  if (!strcmp(cmd,"cellup") || !strcmp(cmd,"celldown")) {
    if (n!=6) return errF(F("five pose values required"));
    int16_t pose[NA];
    for (int k=0;k<NA;k++) {
      if (!integer(args[k+1],k ? C.mn[k] : -30000,k ? C.mx[k] : 30000,a)) return errF(F("pose outside limits"));
      pose[k]=(int16_t)a;
    }
    int w=!strcmp(cmd,"cellup") ? W_PLACE_UP : W_PLACE;
    memcpy(C.wp[w],pose,sizeof(pose)); C.wpOk[w]=1;
  } else if (!strcmp(cmd,"raw") || !strcmp(cmd,"nudge")) {
    if (n!=3 || !integer(args[1],1,5,a)) return errF(F("positional servo 1..5 required"));
    if (!integer(args[2],!strcmp(cmd,"nudge") ? -50 : C.mn[a],!strcmp(cmd,"nudge") ? 50 : C.mx[a],b)) return errF(F("pulse outside limits"));
    if (!strcmp(cmd,"nudge")) {
      if (!live[a]) return errF(F("servo start not enabled"));
      b += (long)lround(goal[a]);
      if (b<C.mn[a] || b>C.mx[a]) return errF(F("nudge outside limits"));
    }
    moveOne(a,b,C.speed);
  } else if (!strcmp(cmd,"bjog")) {
    if (n!=2 || !integer(args[1],-500,500,a) || !a) return errF(F("jog is nonzero -500..500 ms"));
    if (!baseReferenced || baseCount+a < -30000 || baseCount+a > 30000) return errF(F("reference base or count outside range"));
    baseStart(baseCount+a);
  } else if (!strcmp(cmd,"bhome") && n==1) {
    baseCount=C.wpOk[W_HOME] ? C.wp[W_HOME][0] : 0;
    baseReferenced=true; // Operator has physically aligned home; no movement.
  } else if (!strcmp(cmd,"savewp")) {
    if (n!=2 || !integer(args[1],0,4,a) || !baseReferenced) return errF(F("position 0..4 and referenced base required"));
    for(int k=1;k<NA;k++) if(!live[k]) return errF(F("enable four arm servos before teaching"));
    C.wp[a][0]=(int16_t)lround(baseCount);
    for(int k=1;k<NA;k++) C.wp[a][k]=(int16_t)lround(goal[k]);
    C.wpOk[a]=1; saveCfg();
  } else if (!strcmp(cmd,"gowp")) {
    if (n!=2 || !integer(args[1],0,4,a) || !C.wpOk[a] || !baseReferenced) return errF(F("saved position and reference required"));
    for(int k=1;k<NA;k++) if(!live[k]) return errF(F("enable arm servos first"));
    moveToWp(a,C.speed);
  } else if (!strcmp(cmd,"gsave") || !strcmp(cmd,"grip")) {
    if (n!=2 || (strcmp(args[1],"open") && strcmp(args[1],"close"))) return errF(F("open or close required"));
    bool open=!strcmp(args[1],"open");
    if(!live[S_GRIP]) return errF(F("enable gripper first"));
    if (!strcmp(cmd,"gsave")) {
      if(open) C.gOpen=lround(goal[S_GRIP]); else C.gClose=lround(goal[S_GRIP]);
      C.gOk |= open ? 1 : 2; saveCfg();
    } else {
      if(!(C.gOk & (open?1:2))) return errF(F("teach gripper first"));
      moveOne(S_GRIP,open ? C.gOpen : C.gClose,C.speed);
    }
  } else if (!strcmp(cmd,"lim")) {
    if(n!=3 || !integer(args[1],1,5,a) || !live[a] || (strcmp(args[2],"min") && strcmp(args[2],"max"))) return errF(F("lim servo min|max at current command"));
    b=lround(goal[a]);
    if((!strcmp(args[2],"min") && b>C.mx[a]) || (!strcmp(args[2],"max") && b<C.mn[a])) return errF(F("min exceeds max"));
    if(!strcmp(args[2],"min")) C.mn[a]=b; else C.mx[a]=b;
    saveCfg();
  } else if (!strcmp(cmd,"bset")) {
    if(n!=3) return errF(F("bset key value"));
    long lo=0,hi=0;
    if(!strcmp(args[1],"stop")){lo=1200;hi=1800;}
    else if(!strcmp(args[1],"speed")){lo=10;hi=500;}
    else if(!strcmp(args[1],"ratio")){lo=50;hi=200;}
    else if(strcmp(args[1],"homesw")) return errF(F("unknown base setting")); else hi=1;
    if(!integer(args[2],lo,hi,a)) return errF(F("base setting out of range"));
    if(!strcmp(args[1],"stop")) C.bStop=a;
    else if(!strcmp(args[1],"speed")) C.bOff=a;
    else if(!strcmp(args[1],"ratio")) C.bRatio=a; else C.homeSw=a;
    baseReferenced=false; saveCfg(); if(live[0]) baseOut(0);
  } else if (!strcmp(cmd,"set")) {
    if(n!=3) return errF(F("set key integer"));
    long lo=0,hi=0;
    if(!strcmp(args[1],"speed")){lo=5;hi=120;}
    else if(!strcmp(args[1],"slow")){lo=5;hi=100;}
    else if(!strcmp(args[1],"gripms")) hi=10000;
    else if(!strcmp(args[1],"pausems")) hi=60000;
    else if(!strcmp(args[1],"sensor")) hi=1;
    else return errF(F("unknown setting; autorun unavailable"));
    if(!integer(args[2],lo,hi,a)) return errF(F("setting outside range"));
    if(!strcmp(args[1],"speed")) C.speed=a;
    else if(!strcmp(args[1],"slow")) C.slowPct=a;
    else if(!strcmp(args[1],"gripms")) C.gripMs=a;
    else if(!strcmp(args[1],"pausems")) C.pauseMs=a; else C.sensorOn=a;
    C.autoRun=0; saveCfg();
  } else if (!strcmp(cmd,"start") && n==2 && !strcmp(args[1],"1")) {
    // Each XO request is exactly one acknowledged cycle. No endless mode.
    for(int w=0;w<NW;w++) for(int k=1;k<NA;k++) if(C.wp[w][k]<C.mn[k] || C.wp[w][k]>C.mx[k]) return errF(F("taught pose outside limits"));
    if(C.gOpen<C.mn[5] || C.gOpen>C.mx[5] || C.gClose<C.mn[5] || C.gClose>C.mx[5]) return errF(F("gripper outside limits"));
    if(!startCycle(1)) return errF(F("enable joints and teach common stations first"));
  } else return errF(F("unknown command or argument count"));
  ok();
}
void readSerial() {
  while(Serial.available()) {
    char ch=Serial.read();
    if(ch=='\n' || ch=='\r') {
      if(lineOverflow) errF(F("line too long; discarded"));
      else if(lineLen) { line[lineLen]=0; handleLine(line); }
      lineLen=0; lineOverflow=false;
    } else if(lineLen<sizeof(line)-1 && !lineOverflow) line[lineLen++]=ch;
    else lineOverflow=true;
  }
}
// ---------------- setup / loop ----------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_SENSOR, INPUT_PULLUP);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_HOMESW, INPUT_PULLUP);
  if (!loadCfg()) { defaults(); saveCfg(); }
  for (int s = 0; s < NS; s++) { cur[s] = goal[s] = 1500; live[s] = false; }

  // Loading EEPROM never attaches servos or assumes a physical home.
  baseCount=0; baseReferenced=false; armed=false; lastContact=millis();
  Serial.println(F("XOARM 2 6 CONTINUOUS"));
}

void loop() {
  readSerial();
  if(armed && (uint32_t)(millis()-lastContact)>LINK_TIMEOUT_MS) {
    stopAll(); armed=false; baseReferenced=false; setErr(F("link timeout: stopped; re-reference base"));
  }
  buttonTick();
  baseTick();
  seekTick();
  static uint32_t last = 0;
  if (millis() - last >= TICK_MS) { last = millis(); motionTick(); }
}
