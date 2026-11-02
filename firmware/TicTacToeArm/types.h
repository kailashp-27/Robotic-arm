#pragma once
// Kept in a header so the Arduino IDE's auto-generated prototypes can see it.
#include <stdint.h>

enum { S_BASE, S_SHOULDER, S_ELBOW, S_WROT, S_WPITCH, S_GRIP, NS };
#define NA 5                     // arm joints saved in each position (all except the gripper)
enum { W_HOME, W_PICK_UP, W_PICK, W_PLACE_UP, W_PLACE, NW };

// Saved in EEPROM. Poses are raw servo pulses: no sizes or kinematics needed.
struct Cfg {
  uint16_t magic;
  int16_t mn[NS], mx[NS];        // per servo pulse limits
  int16_t wp[NW][NA];            // per position: base turn count (ms, 360 servo), then shoulder, elbow, wrist rotate, wrist pitch pulses
  uint8_t wpOk[NW];
  int16_t gOpen, gClose;         // gripper pulses
  uint8_t gOk;                   // bit0 = open saved, bit1 = closed saved
  float speed;                   // deg/s for travel moves
  float slowPct;                 // speed % for the last move down to pick / place
  uint16_t gripMs, pauseMs;      // wait after gripper moves, wait at end of each cycle
  uint8_t sensorOn;              // 1 = wait for the IR sensor before each cycle
  uint16_t cycles;               // cycles per start (0 = forever)
  uint8_t autoRun;               // 1 = start by itself at power on
  // 360 (continuous) base servo: pulse sets speed, not angle. Moved by time.
  int16_t bStop;                 // pulse where the base stands still (trim)
  int16_t bOff;                  // pulse offset from bStop used for turning (sets the speed)
  int16_t bRatio;                // % time when turning left, to match right (servos are not equal)
  uint8_t homeSw;                // 1 = home switch on D7 re-zeros the base every cycle
};

// One step of the pick and place cycle.
enum { ST_MOVE, ST_GRIP, ST_WAIT, ST_SENSOR };
struct Step { uint8_t type; uint8_t arg; uint8_t slow; };
