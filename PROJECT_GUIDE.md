# Tic-Tac-Toe Playing Robotic Arm

Complete local project source for the **six-servo 3D-printed arm**, Arduino Uno and a browser dashboard. The computer plays O using exhaustive Minimax. O's selected square becomes a calibrated pick-and-place destination. The app has four pages: Play dashboard, Inside minimax, Arm & calibration and Arduino code. The code page displays the actual sketch and header with line numbers, syntax colours, copy and download controls.

The six actuators are **base, shoulder, elbow, wrist rotation, wrist pitch and gripper**. This is five pose axes plus a gripper actuator, rather than an arbitrary six-axis Cartesian pose robot. The supplied controller uses a **continuous-rotation base**. Its pulse controls speed, while a signed millisecond count estimates position. It must not receive ordinary base angle commands.

## Start here

1. Double-click **Start Project.cmd**. Keep its local server window open. In Chrome or Edge, open `http://127.0.0.1:8766/` if the browser did not open automatically. Only Python 3 is needed; there are no Python packages to install.
2. For a presentation without hardware, open **XO Dashboard.html** directly. It is self-contained and works offline. Place X; O chooses its optimal reply and the reference arm animates. No serial port is opened unless you explicitly press Connect Arduino.
3. The project starts in simulation each time. Geometry is labelled **assumed** and physical mappings are blank. Local browser storage keeps project settings; **Save project JSON** provides a portable copy. Calibration import never moves a motor.

This repository contains the current six-servo project. Earlier four-servo prototypes, reports and temporary working files are excluded.

## Arduino upload and wiring

Open `firmware/TicTacToeArm/TicTacToeArm.ino` in Arduino IDE. Keep `types.h` alongside it; there is no missing Config.h dependency. Select Arduino Uno and the correct COM port. Install the official **Servo** library if necessary. EEPROM is part of the AVR core. Upload with servo power switched off, then close Serial Monitor before connecting from the browser.

| Actuator | Uno signal | Output meaning |
|---|---|---|
| Base | D9 | Continuous servo; signed timed rotation |
| Shoulder | D10 | Positional pulse, microseconds |
| Elbow | D11 | Positional pulse, microseconds |
| Wrist rotation | D5 | Positional pulse, microseconds |
| Wrist pitch (up/down) | D3 | Positional pulse, microseconds |
| Gripper | D6 | Positional pulse, microseconds |

External **5 V servo supply positive → servo red wires**. Supply negative → all servo brown/black wires **and Arduino GND**. Power the Uno from USB. Keep servo supply positive separate from the Uno 5 V pin. Use distribution wiring appropriate to the actual servo current; the software cannot measure supply quality. D2 optional IR sensor (active low), D4 optional stop button to GND, and D7 optional home switch to GND retain the supplied wiring. Sensor and home-switch operation are disabled unless explicitly configured. D4 now only stops; it cannot start movement.

Firmware startup, USB connection and `arm confirm` do **not** attach or home servos. An explicit positional start command can jump to the entered pulse because these servos provide no joint feedback to the Uno. Support the arm. **Stop / hold** halts interpolation and base rotation, leaving positional holding pulses. **Detach all** removes holding torque and can let the arm fall. Switch off servo power when finished. A link timeout stops motion and invalidates the base reference; reopening USB never resumes a placement automatically.

## Recover and use existing calibration

The original owner-supplied files were `pickplace.html`, `RoboArm2_PickPlace_Uno.ino`, `types.h` and README, from Aura Project Labs. This adaptation retains the original `Cfg` field order, types, EEPROM location 0 and magic `0x5057`. Existing five taught stations, gripper pulses, limits, base trim, direction ratio and speed can therefore be read from an Uno running that exact layout. This is layout compatibility, not proof that the arm is physically at a stored pose.

1. In **Arm & calibration**, press **Connect Arduino** and select the Uno. The protocol handshake rejects the old CSV/four-servo firmware. Read the displayed saved station status. Press **Back up Arduino calibration** to save both controller values and the browser project. No EEPROM or motor changes occur during backup.
2. Check the supported setup checkbox, then **Arm controller**. Position the base at its known reference and press **Base is physically at HOME**. This only sets the timed counter; it does not seek home.
3. Enable the five positional servos individually at verified absolute start pulses. If a stored HOME and gripper-open pulse exist, they fill the start fields. Empty fields remain empty. There are no invented universal starting positions. Slider values are microseconds; drag and **release** to send. The ±20 buttons nudge an already-enabled servo.
4. Confirm or re-teach HOME, ABOVE PICK and PICK. Capture gripper OPEN and CLOSED separately. These captures use explicit save commands and update EEPROM. A capture never wakes an unenabled servo. Limits can be narrowed at the current command with Min here / Max here.
5. For the easiest hardware integration choose **Taught poses per square**, then capture ABOVE and PLACE for all nine squares. The browser stores these 18 destinations in the project JSON. They do not replace the common supply/home stations. Capturing a pose records commands; visually confirm that the token and jaws clear the lines and the transfer route.
6. Use **Test once →** under a square to run one explicit supply→square→home test after its two poses are captured. This checks that cell and the common stations; it does not require the other eight cells yet. Test all paths at reduced speed and remove each test token. Confirm that new tokens are at the supply station, check the path-review checkbox, and press **Check hardware readiness**. The game requires all nine destinations. Only after this passes can you select **Use hardware for O placements**. A simulation game never sends game movement commands to USB, even when calibration controls are connected.
7. Start with a cleared physical board. Click X after making the corresponding human move. The computer chooses O, sends that cell's approach and placement poses, and starts exactly one supply→square→home cycle. The board waits for `done=1` with no motion remaining. It does not unlock after an arbitrary five seconds.

The status confirms controller execution, **not successful grasping, actual landing position or a camera observation**. Visually confirm each token. A failed or interrupted placement does not commit O and locks the game. Inspect/clear the physical board, clear the game fault, re-arm and re-reference the base, and check readiness again. Do not restore an interrupted game by guessing where a token landed.

## Measured inverse-kinematics mode

The default mathematical example uses h₀=95 mm, L₁=130 mm, L₂=120 mm, tool=65 mm, A1=(130,−50,20) mm, cell pitch=40 mm, clearance=80 mm, home=(140,0,140) mm and supply=(145,−85,20) mm. **These are assumptions, not measurements from the photographs.** They are suitable for simulation and for explaining the mathematics in the report.

To use IK on hardware, edit the project JSON in the dashboard:

- Replace every geometric length, origin, home/supply coordinate, board rotation, approach clearance, tool pitch and elbow branch with the intended measured model. Set `geometry.source` to `measured` only after measuring.
- For shoulder, elbow, wrist roll and wrist pitch, provide measured `zeroUs`, `zeroDeg`, signed `usPerDeg`, `minUs`, `maxUs`. Servo geometric zero is not automatically its electronic 90° command. Gripper endpoints are taught separately.
- Measure the base's signed `degreesPerMs`, reference angle/count, stop pulse, turn offset and left-turn ratio under the actual supply/load. Fill the base mapping and set `mapping.measured=true`. Changes in base speed/trim invalidate that mapping and the home reference.
- Align the EEPROM HOME, ABOVE PICK and PICK poses with those same coordinates/maps. Preflight compares them to prevent mixing assumed Cartesian stations with unrelated taught supply poses. The tolerance is two pulse/count units for rounding, not a physical accuracy specification.
- Choose **Measured inverse kinematics**. Readiness validates all nine destinations, both approach and place pulses, sampled joint limits and the common stations before any placement command is sent. It rejects missing values and unreachable targets. These checks do not detect obstacles or structural collisions.

Board mapping uses p=p₀+Rz(ψ)[column·d,row·d,0]. The solver removes the tool offset at pitch α, solves base yaw plus a two-link shoulder/elbow geometry, and sets wrist pitch to α−shoulder−elbow. Wrist roll is held at 0° in the O-token plan and remains adjustable manually. Forward kinematics reconstructs the ideal end-effector position.

Joint-space interpolation is quintic (zero endpoint speed and acceleration). The browser reference cycle is 9.2 s; it is **not a measured hardware completion time**. Live firmware also uses quintic interpolation for positional pulse moves, but computes duration using maximum pulse distance, nominal 11.1 µs/degree and the speed setting. The continuous base uses a separate constant-speed timed move. Each sequence stage waits for all active movement before advancing. No exact Cartesian straight-line path, constant tool orientation throughout every live transfer, collision avoidance or closed-loop placement accuracy is claimed. The separate mathematics/path page and architecture diagram have been removed from the app.

## Source and protocol

| File | Responsibility |
|---|---|
| `web/engine.mjs` | Complete game rules, exhaustive Minimax, explanation and search metrics |
| `web/model.mjs` | Six-actuator model, board coordinates, FK/IK, trajectory generation, calibration and readiness checks |
| `web/hardware.mjs` | Single-owner Web Serial link, acknowledgement queue and one-cycle placement transaction |
| `web/app.mjs` | Game state, simulation, calibration UI, import/export and fault handling |
| `web/view.mjs` | Arm and board illustration |
| `firmware/TicTacToeArm/` | Uno source, preserved EEPROM structure, non-blocking six-servo sequence |
| `build.mjs` | Synchronize downloadable firmware sources and rebuild standalone HTML |
| `serve.py` | Local static server only; never opens a serial port |
| `tests/` | Pure software, mock-controller and firmware verification |

USB is 115200 baud, newline-delimited ASCII. `hello` returns `XOARM 2 6 CONTINUOUS`. `?` returns JSON with protocol, arming, base reference, commands, limits, taught stations, phase and completion count. Idle status polling every 400 ms maintains the 1800 ms firmware watchdog. Only one application may own the port. Do not run the earlier Python slider or Serial Monitor simultaneously.

Main commands: `arm confirm`, `bhome`, `raw servo pulse`, `nudge servo delta_us`, `bjog signed_ms`, `savewp 0..4`, `gowp 0..4`, `gsave open|close`, `grip open|close`, `cellup base_count shoulder_us elbow_us roll_us pitch_us`, `celldown ...`, `start 1`, `stop`, `relax`. There is no automatic home, no autorun and no endless-cycle command. Overlong lines and malformed or out-of-range arguments are rejected rather than truncated into a movement. Game destinations update RAM and are not repeatedly written to EEPROM.

`examples/project-unmeasured.json` is an honest blank physical calibration with usable simulation geometry. Do not mark it measured just to bypass readiness. There is no supplied export of the owner's actual six-servo starting pulses; those may only be in the controller EEPROM. The calibration backup is a readable archival snapshot, not an automatic EEPROM restore tool: deliberate teaching avoids an import silently changing physical limits/starts.

## Verification and rebuild

With Node.js installed, run `node --test tests/core.test.mjs` from this folder. `node build.mjs` rebuilds the self-contained dashboard and the Arduino source embedded in it. `tests/verify_uno.py` provides an offline AVR compilation using an installed official core and Servo library; pass their paths with `--tools`, `--core`, `--servo` and `--output`. It creates an ELF, HEX and memory-usage summary and never uploads. The sketch also opens normally in Arduino IDE for verification. Browser verification notes are in `VERIFICATION.md`.

Hardware operations have not been executed by this software build. Existing pick-and-place demonstration evidence does not establish nine-square XO placement accuracy or repeated trial counts. Report simulation data remain simulation data and are not included as invented controller measurements.

API references: [Chrome Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial), [official Arduino Servo API](https://github.com/arduino-libraries/Servo/blob/master/docs/api.md). The original controller attribution is retained in the sketch. The project runs locally with no hosting, account or cloud API.
