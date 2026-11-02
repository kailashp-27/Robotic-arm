# Build verification — 27 October 2026

## Software

`node --test tests/core.test.mjs`: **13 passed, 0 failed**.

- Exhaustive legal human continuations against the deterministic Minimax O policy: **521 completed sequences, 368 O wins, 153 draws, 0 X wins**. This is a software game-tree test, not a robot trial count.
- Winning and blocking moves, turn validation and illegal moves.
- Nine board coordinates, rotated board mapping and both elbow branches of the ideal FK/IK model.
- Three example trajectories (A1, B2, C3), 461 samples each, home endpoints, token-release point, gripper stages and quintic boundaries.
- Invalid four-servo project import, non-finite inputs, malformed/out-of-range poses and missing measured IK settings.
- All-nine-cell readiness, common-station teaching, output enable, base reference and protocol checks.
- Calibrated pose/count conversion and rejection when the base speed/trim differs from its measured mapping.
- Mock-controller placement completion, stop/cancellation and controller-error handling.
- Acknowledgement errors and a Web Serial mock port with split response lines, firmware handshake, one complete placement and connection cleanup. Connecting issues only `hello` and `?`, with no arming or movement.
- A single-cell bench test before all nine destinations are taught; complete games still require all nine.

## Arduino Uno compilation

The actual sketch was compiled and linked offline with the installed official Arduino AVR core **1.8.8**, official Servo library, AVR GCC **7.3.0**, target **ATmega328P / 16 MHz / Arduino Uno**. Arduino CLI initialization could not use this machine's installed package path, so `tests/verify_uno.py` compiled the same core/library/sketch directly, including Arduino-style generated function declarations.

Final linked build: **17,686 bytes flash / 32,256 available**; **948 bytes static RAM / 2,048 available**. Remaining RAM also needs to cover runtime stack usage. `verification/uno-compile.json` contains the generated build summary. No firmware upload was performed.

## Browser checks

The local modular dashboard and self-contained inline dashboard were opened in the desktop browser:

- Nine empty clickable squares and all six actuator labels.
- X at A1 chooses O at B2, reserves the square, disables further board input, completes its 9.2 s reference animation and commits O.
- Stop during a placement does not commit O; the board locks for inspection and can be reset through the displayed recovery control.
- Navigation to Minimax, calibration and Arduino code pages. The mathematics/path page and architecture diagram were removed in the 28 October interface update.
- Blank physical start fields, disconnected/disabled hardware movement controls, nine pairs of teaching controls and separate base timed jogging.
- The current Arduino page focuses on the sketch and header, with line numbers, syntax colours, file selection and download controls.
- The self-contained dashboard's Arduino ZIP download contains the real sketch and header; its contents match the source files.

## Physical verification limit

No serial port was selected and no servo movement was requested during this build. The supplied files define the controller layout and teaching format, but do not contain an exported set of measured six-servo starts and nine board destinations. Hardware operation requires reading the existing EEPROM calibration, verifying starts and teaching the board, or measuring the geometry and pulse/time mappings for IK. Controller completion is not a measurement of grasp success, landing accuracy or repeatability.
