# Mouse Flight Control — Spec

ระบบควบคุมเครื่องบินด้วยเมาส์แบบ **Mouse Aim + Aircraft Follow** สำหรับ Flight Playground
เอกสารนี้รวมแผนตั้งต้นกับการตัดสินใจที่ตกลงกันแล้ว ใช้เป็นแหล่งอ้างอิงเดียวระหว่าง implement

## 1. เป้าหมาย

- ผู้เล่นใหม่เข้าใจได้ทันที: เมาส์ชี้ทิศ เครื่องบินหันตามเอง
- แม่นพอสำหรับบินลอดสะพานและช่องแคบ ไวพอสำหรับหักหลบภูเขา
- Barrel roll, inverted flight และการ roll ต่อเนื่องทำได้อิสระ ระบบช่วยต้องไม่แย่งการควบคุม
- ใช้ `FlightModel` เดิม ไม่สร้าง physics ใหม่ ระบบเมาส์แค่สร้างค่า `pitch / roll / yaw` (-1..1) ป้อนผ่าน `ControlState` เหมือน keyboard
- Keyboard Only ต้องทำงานเหมือนเดิมทุกประการ
- เผื่อขยายไปสู่ High AoA / PSM และระบบอาวุธในอนาคต

## 2. แนวคิดหลัก: สามทิศทาง

| ชื่อ | ความหมาย | HUD |
|---|---|---|
| Aim Direction | ทิศที่ผู้เล่นต้องการให้ **จมูก** หันไป | Aim reticle (วงกลมใหม่) |
| Forward (Boresight) | ทิศที่จมูกชี้จริง | สัญลักษณ์ `-W-` เดิม |
| Velocity (Flight Path) | ทิศที่เครื่องเคลื่อนที่จริง | FPM เดิม |

ทั้งสามแยกจากกัน Mouse Aim ควบคุม orientation ผ่าน body rate เท่านั้น ไม่แตะ velocity โดยตรง

## 3. Aim เป็น world direction

- Aim เก็บเป็น **unit vector ในโลก** ไม่เก็บเป็นตำแหน่งบนจอ และไม่เก็บเป็นมุม yaw/pitch (กัน gimbal lock)
- คำว่า "relative" หมายถึงอ่าน mouse delta (`movementX/Y`) ผ่าน Pointer Lock เท่านั้น
- **กฎเดียวทุกโหมดกล้อง:** mouse delta หมุน aim รอบแกน right / up **ของกล้องในเฟรมนั้น**
  - Aircraft Lock: เมาส์ขึ้น = pitch up ตามแกนตัวเครื่อง (แม้กลับหัว)
  - Horizon Lock: เมาส์ขึ้น = ขึ้นฟ้า
  - Aim Lock: เมาส์ขึ้น = ขึ้นตามมุมมองของ aim
- ความไวเป็นองศาต่อ pixel และ scale ตาม FOV ปัจจุบัน
- **Aim limit มี 2 โหมด** สลับด้วย **G** หรือปุ่มบน toolbar (ผู้ใช้เรียกว่า G-limit enabled / disabled แต่ G-limit ของ physics ทำงานตามปกติทั้งสองโหมด)
  - **Limited** (ค่าเริ่มต้น): aim ห่างจมูกได้ไม่เกิน `MOUSE.coneDeg` (65°) ถ้าเครื่องตามไม่ทัน aim จะชนขอบ cone แล้วค้าง
  - **Free**: aim ไปได้ทุกทิศ รวมถึงด้านหลังเครื่อง เครื่องจะ roll ให้ lift vector ชี้หา aim แล้ว pull อ้อมกลับมา ความเร็วในการหันจำกัดด้วย rate, authority และ G-limit เดิม (วัดได้: หันกลับ 180° ใช้ ~3.1 วินาทีที่ 230 m/s และ ~4.4 วินาทีที่ 470 m/s ที่ 9.4 G)
  - ใน Free mode ถ้า aim อยู่ด้านหลัง กล้อง Aim Lock จะหันไปมองด้านหลังด้วย กล้อง Aircraft / Horizon Lock จะแสดง reticle เป็นลูกศรที่ขอบจอ
  - สลับจาก Free กลับเป็น Limited: step ถัดไป aim จะถูกดึงเข้า cone
- เมื่อเครื่องหันถึง aim แล้ว error เป็น 0 ระบบหยุดหมุนเอง (ไม่ใช่ virtual joystick)

## 4. Aim Controller (autopilot)

คำนวณ error ใน **body frame** ของเครื่องบิน แล้วสั่งเป็น body rate ที่ต้องการ แปลงเป็นค่า stick โดยหารด้วย rate สูงสุดที่ใช้ได้ตอนนั้น (`FlightModel` เป็นแหล่งเดียวของสูตร G-limit / authority) gain จึงปรับตามความเร็วเองโดยอัตโนมัติ

### เลือกวิธีเลี้ยวตามขนาด error (blend ต่อเนื่อง ไม่มีขั้นบันได)

- **Error เล็ก (< ~6°)** — Direct: pitch + yaw ตรง ไม่ roll ใช้ปรับละเอียด ลอดช่อง เล็งไกล
  - roll ถูก damp ให้หยุดหมุนและค้างมุมปัจจุบัน **ไม่ auto level**
  - push (negative g) ได้เต็มที่
- **Error กลาง** — ผสมสองวิธีด้วย smoothstep
- **Error ใหญ่ (> ~25°)** — Bank-and-Yank: roll ให้ lift vector (แกน up ของเครื่อง) ชี้หา aim แล้ว pull
  - **ไม่รอ roll เสร็จก่อน pull:** คำสั่ง pitch มาจาก error ที่ตกบนแกน up ของเครื่อง จึง pull ตามสัดส่วนที่ lift ชี้ไปทางเป้าแล้ว
  - push ถูกจำกัด (ไม่ push แรงระหว่าง roll)
  - yaw ลดบทบาทลง เพื่อให้เลี้ยวแบบ coordinated
- **เป้าอยู่ใต้จมูกพอดี (roll error ~180°):** ใช้ hysteresis ยึดทิศ roll ที่เลือกไว้ กันส่ายซ้ายขวา
- **error ใกล้ 0:** แกน roll ไม่มีเป้า ระบบส่งต่อไปใช้ Direct เอง
- **error pitch / yaw:** ถ้า error เล็กใช้มุมในแต่ละระนาบ (`atan2`) ถ้า error ใหญ่ใช้ error รวมแยกตามแกน lift / right เพราะแบบหลังต่อเนื่องแม้ aim อยู่ด้านหลังเครื่อง

### Roll-out (ส่วนของ Auto Bank Assist) — รอผู้ใช้ยืนยัน

ถ้าไม่มี roll-out หลังเลี้ยวด้วย bank-and-yank เครื่องจะค้างที่ bank ~110° ระบบจึงคืนเฉพาะ **roll ที่ controller ทำเอง** กลับ

- ระบบนับ roll ที่เกิดขณะ controller ถือแกน roll ทุกครั้งที่ผู้เล่นกด A/D ตัวนับจะเริ่มใหม่จาก 0 ผลคือ knife-edge หรือ inverted ที่ผู้เล่นตั้งด้วยมือจะคงอยู่
- loop ที่ใช้ pitch ล้วนไม่มี roll ระบบจึงไม่นับอะไร หยุดเมาส์ตอนกลับหัวที่ยอด loop เครื่องจะไม่พลิกกลับเอง (มี test ยืนยัน) ตรงตามแผนข้อ 7 — ไม่ใช่ auto level
- ทำงานเฉพาะเมื่อ error อยู่ในช่วง direct **และ** เมาส์นิ่งเกิน `rollOut.idleTime` จึงไม่รบกวนการลากเมาส์เลี้ยวต่อเนื่อง
- ปิดได้ด้วย `MOUSE.rollOut.enabled`

### ข้อมูลที่ controller ส่งออกให้ HUD

- error (องศา)
- `saturated`: สั่งเต็ม stick แล้วยังตามไม่ทัน
- `gLimited`: pitch ถูกจำกัดด้วย G-limit (ความเร็วสูง)

## 5. Manual override และ input arbitration

แต่ละแกน (pitch / roll / yaw) มี override ของตัวเอง:

- แกนที่ผู้เล่นกดปุ่ม (หรือค่า progressive ยังไม่ decay หมด) = manual ควบคุม 100%
- ปล่อยแล้ว autopilot ค่อย ๆ รับแกนนั้นคืน (handback fade สั้น ๆ) ไม่มีการกระชาก
- ห้ามสองระบบส่งคำสั่งในแกนเดียวกันพร้อมกันเต็มกำลัง

### กฎ sync aim หลัง override (แยกตามแกน)

- **Roll override (A/D, ←/→):** เก็บ aim เดิมไว้ — barrel roll เสร็จแล้วเครื่องยังมุ่งไปทางเดิม
  - ผลพลอยได้: ระหว่าง roll ด้วยมือ controller pull เฉพาะตอน lift ชี้ไปทาง aim จึงเกิด barrel roll รอบทิศ aim เองตามธรรมชาติ
- **Pitch / Yaw override (↑↓, Q/E):** ระหว่างกดอยู่ aim ถูก sync มาที่จมูกทุก step และ **sync ต่อจนกว่า body rate ของแกนนั้นจะต่ำกว่า threshold** กันจมูกเลยไปแล้วถูกดึงกลับ (spring-back)

## 6. กล้อง

สามโหมด วนด้วย **V** และปุ่มบน toolbar

- **Aircraft Lock** (เดิม): กล้องตามท่าทางเครื่องทั้งหมด เหมาะกับการบินผาดโผน
- **Horizon Lock** (เดิม): ขอบฟ้านิ่ง เหมาะกับบินผ่านภูมิประเทศ ห้ามหมุนตาม aim เร็ว
- **Aim Lock** (ใหม่): กล้องมองตาม **aim ผสม velocity** (ไม่ใช่ aim ล้วน) แกน up อิงขอบฟ้าแล้วตาม bank ของเครื่องบางส่วน
  - กล้องโคจรรอบเครื่อง เครื่องจึงอยู่ครึ่งล่างของจอเสมอ
  - ใกล้แนวดิ่ง ส่งต่อไปใช้แกน up ของเครื่อง (เหมือน Horizon Lock) และจำกัดความเร็วหมุนของกล้อง

ค่าเริ่มต้น: Mouse + Keyboard → Aim Lock, Keyboard Only → Horizon Lock (เปลี่ยนเฉพาะตอนสลับ input mode ผู้เล่นเลือกเองได้)

## 7. Free Look (C ค้าง)

- เมาส์หมุนกล้องรอบเครื่องแทน aim
- aim ค้างเป็น world direction เครื่องบินตาม aim เดิมต่อ keyboard ใช้ได้ปกติ
- ปล่อย C กล้องค่อย ๆ กลับ ไม่มีการกระโดดของ aim
- ใช้ได้เฉพาะโหมด Mouse + Keyboard (โหมด Keyboard Only ไม่มี pointer lock จึงปิดไว้)

## 8. Pointer Lock และ Pause

- ขอ pointer lock แบบ synchronous ในคลิกปุ่ม Fly (ก่อน `await` โหลดโมเดล) และเมื่อคลิกที่ viewport
- ระหว่างล็อกอยู่ browser ใช้ Esc ปลดล็อกเอง จึง pause จากเหตุการณ์ `pointerlockchange`
- **Esc = pause อย่างเดียว (ไม่ toggle แล้ว)** กัน race ที่ `pointerlockchange` pause แล้ว Esc keydown มา unpause ทับ
- **P = toggle pause** ตามเดิม ตอน resume ด้วย P หรือคลิก ระบบขอ pointer lock ใหม่ (Chrome มี cooldown ~1 วินาทีหลัง Esc ถ้าไม่ได้ HUD จะบอกให้คลิก)
- Pause และเมนูปลด pointer lock ให้ใช้เมาส์กับ UI ได้
- ทิ้ง mouse delta ที่สะสมทุกครั้งที่ไม่ได้บินอยู่ กัน aim กระโดดตอน resume
- กัน `contextmenu` บน viewport (คลิกขวาสำรองไว้ยิง missile)
- ตัด delta ที่ใหญ่ผิดปกติทิ้ง (บาง platform ส่ง `movementX` กระโดด)

## 9. Input mode

- **Mouse + Keyboard** (ค่าเริ่มต้น) และ **Keyboard Only** สลับด้วย **M** หรือปุ่มบน toolbar
- ตอนสลับ: reset การ handback, sync aim มาที่จมูก, ปลด/ขอ pointer lock ตามโหมด ไม่มีคำสั่งค้าง
- Keyboard Only: output = `FlightControls` เดิมตรง ๆ (มี test ยืนยัน)

## 10. HUD

- **Aim reticle:** วงกลมพร้อม tick สี่ทิศ แยกจาก FPM และ boresight ชัดเจน
- เส้นจาง ๆ จาก boresight ไป reticle เมื่อ error ใหญ่
- reticle อยู่นอกจอ → วาดที่ขอบจอพร้อมลูกศรชี้ทิศ
- reticle เปลี่ยนเป็นสีเตือนเมื่อ controller `saturated` และแสดง `G-LIM` เมื่อเกิดจาก G-limit
- แถบสถานะ: `INPUT MOUSE / KEYBOARD`, `CAM AIM LOCK`, และ `CLICK TO CAPTURE MOUSE` เมื่อบินในโหมดเมาส์แต่ยังไม่ได้ล็อก

## 11. Key bindings (Mouse + Keyboard)

| Input | Action |
|---|---|
| Mouse move | ขยับ aim |
| คลิกซ้าย | สำรอง: ปืน (อนาคต) |
| คลิกขวา | สำรอง: missile (อนาคต) |
| W / S | เร่ง / ลดความเร็ว (ปล่อยแล้วคงความเร็วปัจจุบัน — ไม่มี target speed) |
| Shift (ค้าง) | Afterburner |
| X (ค้าง) | Airbrake |
| A / D, ← / → | Roll override |
| ↑ / ↓ | Pitch override |
| Q / E | Yaw override |
| C (ค้าง) | Free Look (เดิม C = สลับกล้อง) |
| V | วนโหมดกล้อง Aircraft → Horizon → Aim |
| M | สลับ Mouse + Keyboard / Keyboard Only |
| G | สลับ Aim Limited / Free |
| Space | สำรอง: เปิด PSM (อนาคต) |
| P | Pause / Resume |
| Esc | Pause (และปลด pointer lock) |
| R | Reset |
| H | แผงช่วยเหลือ |

## 12. อนาคต (ยังไม่ implement)

- **PSM / High AoA:** aim เป็นเป้าของจมูก ไม่ใช่ของ velocity อยู่แล้ว PSM จะเป็นแค่โหมดที่ปลด AoA limit (`maxAlphaDeg`) ระหว่างกด Space โดยใช้ controller ตัวเดิม ห้ามใช้ Ctrl เป็นปุ่ม (Ctrl+W ปิดแท็บ)
- **อาวุธ:** ปืนเล็งด้วย boresight, missile seeker ใช้ cone รอบ aim reticle
- **ไม่ทำ:** assist levels, ground avoidance, Direct mode บนคลิกขวา

## 13. โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `input/MouseInput.ts` | Pointer lock, สะสม mouse delta, กัน contextmenu |
| `input/MouseAim.ts` | Aim direction: หมุนตามแกนกล้อง, cone limit, sync |
| `flight/AimController.ts` | Autopilot: aim → pitch/roll/yaw (headless, test ได้) |
| `input/ControlMixer.ts` | Arbitration manual / auto รายแกน + handback, implement `ControlState` |
| `flight/FlightModel.ts` | เพิ่ม helper rate limit ที่ใช้ร่วมกับ `step()` |
| `camera/ChaseCamera.ts` | เพิ่ม Aim Lock และ Free Look |
| `hud/Hud.ts` | Aim reticle, G-LIM, สถานะ input |
| `config.ts` | ค่าใหม่ทั้งหมดอยู่ใน `MOUSE` และ `CAMERA` |

ทุกที่ที่อ่านค่าควบคุม (rig ของเครื่องบิน, HUD, `debug()`) ต้องอ่านจาก `ControlState` ที่ใช้บินจริง (mixer) ไม่ใช่สถานะ keyboard

## 14. ลำดับ implement

1. Mouse input + pointer lock + aim (world direction) + HUD reticle
2. Aim Controller: bank-and-yank + blend ตาม error พร้อม headless test
3. Override รายแกน + กฎ sync
4. กล้อง Aim Lock
5. Free Look, V วนกล้อง, M สลับ input mode
6. HUD เตือน G-limit และจูนค่าใน `config.ts`

## 15. การตรวจสอบ

อัตโนมัติ: `npm run typecheck`, `npm test`, `npm run build`

Headless test ที่ต้องมี:
- Aim ทางขวา → roll เป็นบวกและ heading เพิ่ม
- Aim ตรงขึ้น → จมูกเงย roll ใกล้ 0
- บินกลับหัว error เล็กไปทาง body-down → push ไม่พลิกตัว
- Roll override ขณะ aim อยู่ข้างหน้า → จมูกยังอยู่ใกล้ aim
- Error 30° → หันถึงภายในเวลาที่กำหนด overshoot ต่ำ
- Keyboard Only → output ของ mixer เท่ากับ `FlightControls` ทุกค่า
- Mouse delta ขณะกล้องเอียง 90° → aim ขยับตามแกนกล้อง ไม่ใช่แกนโลก

ทดสอบด้วยมือ (automation ขับ pointer lock ไม่ได้): สถานการณ์ 13 ข้อในแผนตั้งต้น — บินตรงปรับละเอียด, เลี้ยวเร็ว, หลบหลายจุด, ช่องแคบ, ลอดสะพาน, Mountain Zone, barrel roll, inverted, manual roll + mouse, สลับกล้อง, Free Look, Keyboard Only, FPS ต่าง ๆ
