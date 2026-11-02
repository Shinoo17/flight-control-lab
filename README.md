# Flight Playground — Arcade Jet Prototype

Prototype เกมขับเครื่องบินรบแบบ Arcade (React + TypeScript + Three.js) สำหรับทดสอบระบบการบิน การควบคุมด้วย Keyboard กล้อง Chase และ HUD บนสนามทดสอบ

## เริ่มใช้งาน

```bash
npm install        # postinstall จะคัดลอก Basis transcoder ไปที่ public/basis (F-22 ใช้ texture KTX2)
npm run dev        # http://localhost:5180
npm test           # unit test ของ flight model / input (vitest)
npm run build      # typecheck + production build
```

## การควบคุม

| ปุ่ม | การทำงาน |
|---|---|
| ↑ / ↓ | Pitch up / down |
| A / D หรือ ← / → | Roll left / right |
| Q / E | Yaw left / right |
| W / S | เร่ง / ลดความเร็ว (ปล่อยแล้วคงความเร็วปัจจุบันไว้) |
| Shift (ค้าง) | Afterburner |
| X (ค้าง) | Airbrake |
| C | สลับกล้อง Aircraft Lock / Horizon Lock (สลับจากปุ่มบน UI ได้ด้วย) |
| R | Reset เครื่องบิน |
| P / Esc | Pause |
| H | แสดง / ซ่อนแผงช่วยเหลือ |

ปุ่มอ่านจาก `KeyboardEvent.code` จึงใช้ได้กับ keyboard ภาษาไทย

## ทำไมใช้ Three.js ตรง ๆ แทน React Three Fiber

เกมนี้ต้องการ game loop ที่คุมเองทั้งหมด: fixed-timestep physics 120 Hz, interpolation ตอน render, ลำดับ input → physics → camera → render → HUD ที่แน่นอน และ HUD ที่วาดใหม่ทุกเฟรม การใช้ Three.js ตรงในคลาส `Game` ทำให้ลำดับนี้ชัดเจนและไม่มี reconciliation ของ React ในเส้นทางที่ทำงานทุกเฟรม React จึงทำแค่ UI ที่เปลี่ยนไม่บ่อย (เมนูเลือกเครื่องบิน ปุ่มสลับกล้อง หน้าจอ pause) ผ่าน snapshot ที่ส่งออกมาเฉพาะตอนสถานะเปลี่ยน

## โครงสร้าง

```
src/
  game/
    config.ts               ค่าที่ปรับแต่งได้ทั้งหมด (การบิน, input, กล้อง, HUD, โลก)
    Game.ts                 renderer + game loop + state (menu / flying / crashed / paused)
    input/KeyboardInput.ts  สถานะปุ่มดิบ (KeyboardEvent.code)
    input/ControlAxes.ts    Progressive input: ค่าแกนค่อย ๆ เพิ่มตามเวลาที่กดค้าง, ค่อย ๆ ลดเมื่อปล่อย, response curve
    flight/FlightModel.ts   Arcade physics (ไม่พึ่ง render, test ได้แบบ headless)
    aircraft/               โหลด GLB, normalize แกน/สเกล, rig พื้นบังคับ/nozzle/เปลวไฟของแต่ละลำ
    camera/ChaseCamera.ts   กล้อง Aircraft Lock / Horizon Lock
    hud/Hud.ts              HUD บน canvas 2D
    world/                  พื้น grid, ท้องฟ้า, terrain, โซนทดสอบ, collider
    effects/                speed lines, explosion
  vendor/                   su57-nozzle.js / su57-flame.js (คัดลอกจาก workspace ใช้ตามเดิม)
  ui/                       React overlay
tests/flight.test.ts        ตรวจทิศ pitch/roll/yaw, progressive input, พลังงานจากการไต่/ดิ่ง/เลี้ยว
```

## Flight model โดยย่อ

- **ทิศจมูก (orientation)** หมุนตาม body rate ที่ผู้เล่นสั่ง โดย rate จริงไล่ตาม rate ที่สั่งแบบมีความเฉื่อย และ authority ลดลงเมื่อช้ามากหรือเร็วมาก
- **ทิศการเคลื่อนที่ (velocity)** เป็นอีกเวกเตอร์หนึ่ง ถูก "lift" ดึงเข้าหาจมูกด้วยอัตราจำกัด และ gravity ดึงลง ช่องว่างระหว่างสองทิศนี้คือ AoA / sideslip ที่เห็นเป็น Flight Path Marker แยกจาก Boresight บน HUD
- **ความเร็ว** ไม่มีความเร็วเป้าหมาย: ปล่อย W/S แล้วคงความเร็วเดิม, W เร่ง (dry สูงสุดประมาณ Mach 1.4), Shift เปิด afterburner (สูงสุดประมาณ Mach 1.9), S ลด. Gravity ตามมุมไต่ (ไต่แล้วช้าลง ดิ่งแล้วเร็วขึ้น), load factor (เลี้ยวแรงเสียความเร็ว) และ airbrake หักพลังงานออก และไม่กลับคืนเอง ผู้เล่นต้องเร่งเอง. เหนือ dry max โดยไม่มี AB ความเร็วจะค่อย ๆ ลดกลับมาที่ dry max
- **G-limit** จำกัด pitch rate ไม่ให้เกินประมาณ 9.5 g ทำให้ยิ่งเร็วยิ่งเลี้ยวกว้าง
- มี preset ความเร็ว 2 แบบ คือ `arcade` (ใช้อยู่) และ `realistic` ดูรายละเอียดและวิธีสลับใน [docs/FLIGHT_SPEED_GUIDE.md](docs/FLIGHT_SPEED_GUIDE.md)
- เมื่อเอียงเครื่อง ทิศทางจะค่อย ๆ เลี้ยวเข้าหาปีกด้านต่ำ (bank-to-turn)
- จุดต่อขยายสำหรับ Stall / High AoA / Post-Stall: `FlightModel.effectiveness()` และการ clamp `maxAlphaDeg`

## โมเดลเครื่องบิน

| | F-22 (`F22_compact.glb`) | Su-57 (`SU57_compact.glb`) |
|---|---|---|
| แกนเดิม | หัว +X, ปีกขวา +Z | หัว +Z, ปีกขวา −X |
| Texture | KTX2 (Basis) + meshopt | WebP + meshopt |
| พื้นบังคับ | หมุนรอบแกน local ของ bone ตาม guide | ไม่มี rig ในไฟล์ → สร้าง pivot จาก bounding box |
| Nozzle / เปลวไฟ | flap ของ nozzle ตาม guide + plume จาก su57-flame.js | rig nozzle + iris + plume จาก su57-nozzle.js / su57-flame.js |
| Airbrake | aileron ขึ้น + flaperon ลง + แพนหางแยกออก | aileron/flap + แพนหางดิ่งแยกออก |

ตอนโหลด ระบบจะหมุนให้ทุกลำหัวชี้ +Z, ย่อขยายเป็นเมตรจริง, ซ่อนชิ้นที่ไม่ควรเห็น (เช่น `Nozzles_ORIG_backup` ของ Su-57, ล้อ, ชิ้นภายใน F-22) และ log ผลตรวจทิศใน console

## แผนที่ทดสอบ (north = −Z)

- **กลาง**: Runway 3 km + หอบังคับการ + เสาวัดความสูง 8 ต้น (แถบทุก 50 m ตัวเลขทุก 100 m) — Free Flight Zone
- **เหนือ**: Obstacle Course — วงแหวน 16 วง (เปลี่ยนเป็นสีเขียวเมื่อบินผ่าน), กำแพงมีช่อง, เสา slalom
- **ตะวันออก**: Mountain Zone — ภูเขา low-poly พร้อม canyon คดเคี้ยวให้บินลอด
- **ตะวันตก**: Bridge / Tunnel Zone — แม่น้ำ, สะพาน 5 แห่ง (บอกความสูงช่องลอด), อุโมงค์ 120 × 70 m และซุ้มประตู
- **ใต้**: Speed Test — เสาทุก 200 m และประตูทุก 1 km
- พื้นทั้งหมดมี grid ทุก 100 m / 1 km และพิกัดทุก 2 km, ขอบสนามเป็นแถบแดง

ชนพื้นหรือสิ่งกีดขวาง → ระเบิดและ reset อัตโนมัติ, ออกนอกสนาม → นับถอยหลัง 5 วินาทีแล้ว reset

## Debug

`window.__game.debug()` คืนค่าความเร็ว ความสูง ท่าทาง input และสถานะ crash ปัจจุบัน
