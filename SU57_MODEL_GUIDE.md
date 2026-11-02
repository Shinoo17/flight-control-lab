# Su-57 — คู่มือโมเดลและการควบคุม Nozzle

เอกสารประกอบ `su57.glb` สำหรับใช้ใน Three.js

| ไฟล์ | คืออะไร |
|---|---|
| `source/su57.blend` | ไฟล์ต้นทาง (`su57.blend1` = auto-backup ของเวอร์ชันก่อนหน้า) |
| `su57.glb` | export แล้ว 40.7 MB texture ฝังในไฟล์ |
| `su57-nozzle.js` | helper คุม thrust vectoring + iris |
| `su57-flame.js` | helper เปลวไฟ afterburner ผูกกับ nozzle rig |
| `textures/` | PNG ต้นฉบับ 6 ไฟล์ รวม 33 MB |

---

## 1. ระบบพิกัดและสเกล

**ใน Blender** — หัวชี้ **−Y**, ขึ้น **+Z**, ซ้าย(port) **+X**, ขวา(starboard) **−X**

ยืนยันจากลักษณะที่ไม่สมมาตรของ Su-57 จริง 2 จุด:

- `Probe_on` (ท่อเติมน้ำมันกลางอากาศ ของจริงอยู่ฝั่งซ้าย) อยู่ที่ x = **+1.73**
- `MG` (ปืนใหญ่ 30 มม. GSh-30-1 ของจริงอยู่โคนปีกขวา) อยู่ที่ x = **−2.10**

**หลัง export เป็น glTF** (Y-up conversion: `(x, y, z)` → `(x, z, −y)`) กลายเป็น:

| ทิศ | Three.js |
|---|---|
| หัวเครื่อง | **+Z** |
| ขึ้น | **+Y** |
| ซ้าย (port) | **+X** |
| ขวา (starboard) | **−X** |

**สเกล** — 1 unit ≈ **0.42 m** (ลำยาว 47.58 units ≈ 20 m, กางปีก 34.42 units ≈ 14.5 m)

ถ้าอยากได้หน่วยเมตรจริงใน Three.js:

```js
gltf.scene.scale.setScalar(0.4224);
```

> ⚠️ ชื่อ `_l` / `_r` ในโมเดลอ้างอิงมุมมองนักบิน `_l` = port = **+X** ตรงข้ามกับที่เห็นตอนมองจากด้านหลัง

---

## 2. ชิ้นส่วนทั้งหมด

### โครงสร้างหลัก

| object | verts | คือ | ตำแหน่ง (x, y, z) |
|---|---|---|---|
| `Body` | 23697 | ลำตัว + ปีก + แพนหาง ทุกอย่างที่ไม่ขยับ | (0, −2.67, 6.25) |
| `Prototype_su57_antenna_ng` | 397 | เสาอากาศ/บูมหัวเครื่อง | (0, −22.37, 7.31) |

### พื้นผิวบังคับ (control surfaces)

| object | verts | คือ | ตำแหน่ง |
|---|---|---|---|
| `Aileron_l` / `_r` | 157 | ปีกเล็ก ขอบท้ายปีกด้านนอก | (±13.82, 10.77, 5.71) |
| `Flap_l` / `_r` | 68 | แฟลป ขอบท้ายปีกด้านใน | (±9.94, 11.06, 5.61) |
| `Elevator_l` / `_r` | 204 | แพนหางระดับ (ทั้งแผ่นขยับ) | (±8.63, 14.80, 5.95) |
| `Rudder_l` / `_r` | 198 / 91 | แพนหางดิ่ง (ทั้งแผ่นขยับ) | (±7.12, 11.94, 8.88) |

> Su-57 จริงมี **LEVCON** (แผ่นปรับกระแสวนที่โคนปีกด้านหน้า) ด้วย โมเดลนี้**ไม่มี**แยกเป็นชิ้น รวมอยู่ใน `Body`

### ช่องเก็บอาวุธ / ฝา

| object | verts | คือ | ตำแหน่ง |
|---|---|---|---|
| `Bay_l` / `_r` | 155 | ช่องอาวุธหลักใต้ลำตัว | (±6.76, −1.63, 5.40) |
| `Hatch_l` / `_r` | 236 | ฝาปิดแนวยาวตามท้อง (ยาว 24.7 units) | (±0.71, 3.84, 4.79) |
| `Door` | 7050 | ฝาครอบห้องนักบิน | (0, −14.92, 8.30) |

### คู่สลับสถานะ — ซ่อน/แสดง ไม่ใช่ animate

| object | verts | คือ |
|---|---|---|
| `Gear_down` | 6216 | ล้อกาง (รายละเอียดเต็ม) |
| `Gear_up` | 229 | ฝาปิดล้อเก็บ (แบบเรียบ) |
| `Probe_on` | 240 | ท่อเติมน้ำมันกางออก |
| `Probe_off` | 14 | ฝาปิดตอนเก็บ |

### อื่นๆ

| object | verts | คือ |
|---|---|---|
| `Pylons` | 40 | เสาแขวนอาวุธนอกลำตัว (กว้าง 19.7 units) |
| `MG` | 66 | ปากกระบอกปืน โคนปีกขวา |
| `Stick` | 166 | คันบังคับในห้องนักบิน |
| `Nozzle_L` / `_R` | 1184 | ท่อไอพ่น — **มี rig** ดูหัวข้อ 4 |
| `Nozzles_ORIG_backup` | 2368 | ต้นฉบับก่อนแยก ซ่อนไว้ **ไม่ถูก export** |

### Materials

`Body` · `Cockpit` · `Glass` · `Gauges` · `Mirror` · `Dots Stroke`

---

## 3. ⚠️ ข้อจำกัดที่ต้องรู้ก่อนทำ animation

**พื้นผิวบังคับทุกชิ้นยังไม่ได้ rig** — origin อยู่ที่ world (0, 0, 0) หมด ยกเว้น `Elevator_l` ที่ origin อยู่ (6.56, 14.45, 5.60)

แปลว่าถ้าสั่ง `aileron.rotation.x = 0.3` ตรงๆ ปีกเล็กจะ**เหวี่ยงรอบจุดกลางลำ** ไม่ใช่หมุนรอบบานพับตัวเอง

วิธีแก้ — ใช้เทคนิคเดียวกับ nozzle: สร้าง Empty ที่แนวบานพับ แล้ว parent ชิ้นส่วนเข้าไป หรือทำฝั่ง Three.js:

```js
// ยกจุดหมุนออกมาไว้ที่บานพับ โดยไม่ต้องแก้ไฟล์ Blender
function hinge(scene, name, pivot) {           // pivot = THREE.Vector3 ในพิกัด Three.js
  const part = scene.getObjectByName(name);
  const pivotNode = new THREE.Group();
  pivotNode.position.copy(pivot);
  part.parent.add(pivotNode);                  // ชิ้นส่วนทุกตัวอยู่ระดับ root → parent คือ gltf.scene
  pivotNode.attach(part);                      // attach รักษาตำแหน่งเดิมไว้
  return pivotNode;
}
```

> ⚠️ **ตัวเลขในตารางหัวข้อ 2 เป็นพิกัด Blender** ก่อนใส่ใน `hinge()` ต้องแปลงเป็นพิกัด Three.js ก่อน: `(x, y, z)` → `(x, z, −y)`
>
> ```js
> const fromBlender = (x, y, z) => new THREE.Vector3(x, z, -y);
> const aileronL = hinge(gltf.scene, 'Aileron_l', fromBlender(13.82, 10.77, 5.71));
> // → THREE.Vector3(13.82, 5.71, -10.77)
> ```
>
> ค่านี้เป็นจุด**กึ่งกลาง bbox** ไม่ใช่แนวบานพับจริง ต้องขยับไปที่ขอบหน้าของพื้นผิวเอง

ปัญหาอื่นที่พบ:

- `Rudder_l` มี 198 verts แต่ `Rudder_r` มี 91 — สองข้างไม่สมมาตร ถ้าจะขยับสองข้างเท่ากันควรตรวจก่อน
- `Body` มี 4 primitives, `Door` มี 4, `Gear_down` มี 2 — วัสดุหลายตัวต่อ object

---

## 4. Nozzle rig

### โครงสร้าง

```
NozzleMount_L        ← Empty เก็บมุมเอียงพื้นฐาน  ***ห้ามแตะ***
└─ Gimbal_L          ← Empty สำหรับหมุน  (rotation ทั้งหมดใส่ที่นี่)
   └─ Nozzle_L       ← Mesh + morph targets: Iris_Close, Iris_Open
NozzleMount_R
└─ Gimbal_R
   └─ Nozzle_R
```

`NozzleMount_*` เก็บมุมเอียงจริงของเครื่อง — กางออกนอก **2.99°** เชิดขึ้น **1.50°** ต่อข้าง ถ้าไปแก้ ท่อจะหลุดแนวลำตัว

`Gimbal_*` มี rotation เป็น identity ตอน export แกน local จึงตรงกับใน Blender เป๊ะ ใส่ `rotation.order = 'YXZ'` แล้วสั่ง `.x` / `.y` ได้เลย

### ทิศทางที่วัดได้จริง (ที่ 10°)

| สั่ง | ปากท่อขยับ | แรงปฏิกิริยาที่หาง | ผลกับเครื่อง |
|---|---|---|---|
| `gimbal.rotation.x` > 0 | **ลง** (dZ −0.475) | ดันขึ้น | **หัวทิ่มลง** |
| `gimbal.rotation.x` < 0 | ขึ้น | ดันลง | หัวเชิดขึ้น |
| `gimbal.rotation.y` > 0 | **ขวา** (dX −0.476) | ดันซ้าย | **หัวหันขวา** |
| `gimbal.rotation.y` < 0 | ซ้าย | ดันขวา | หัวหันซ้าย |

> Pitch **กลับทิศ** เหมือน elevator — พ่นไอเสียลง = ดันหางขึ้น = หัวลง
> `su57-nozzle.js` กลับสัญญาณให้แล้ว API ข้างนอกใช้ตรรกะปกติ: **pitch บวก = หัวเชิดขึ้น**

### ลิมิตการเบน

**±18°** — กวาดทดสอบชนกับ `Body` แล้ว ถึง 20° ยังไม่มีทะลุใหม่ พอ 25° เริ่มพัง (ของจริง Su-57 ±16°)

clamp เป็น**กรวย** ไม่ใช่แยกแกน — สั่ง pitch 18 + yaw 18 พร้อมกันจะถูกหด ไม่ใช่ปล่อยให้เบนรวม 25°

### Iris — ปากท่อกว้าง/แคบ

morph target 2 ตัวบนเมชแต่ละข้าง กลีบ 64 ชิ้น/ข้างหมุนรอบบานพับตัวเอง ปลอกนอก + คอคอด 33 ชิ้นอยู่นิ่ง

| morph | รัศมีปาก | พื้นที่ |
|---|---|---|
| `Iris_Close` = 1 | 0.837 | **0.73×** |
| ทั้งคู่ = 0 (rest) | 0.982 | 1.00× |
| `Iris_Open` = 1 | 1.099 | **1.25×** |

ช่วงรวม ⌀ 1.31 เท่า / พื้นที่ 1.71 เท่า อยู่ปลายบนของ CD nozzle จริง (ของจริงคอคอดแกว่งราว 2:1, ⌀ ปากที่ตาเห็นราว 20–30%)

**iris ไม่กระทบการชน Body เลย** — กลีบที่ขยับอยู่ท้ายระนาบขอบลำตัวทั้งหมด (z ≥ 1.0 เทียบกับขอบที่ z = 0.200) ทดสอบ overlap 8 มุม × iris 0/1 ได้ตัวเลขเท่ากันทุกช่อง จึงสั่ง iris กับ vectoring อิสระต่อกันได้

### ตารางคันเร่ง — เป็นรูป V ไม่ใช่เส้นตรง

| คันเร่ง | ปาก | ทำไม |
|---|---|---|
| **0.0** idle | **เปิด 0.6** | pressure ratio ต่ำ ต้องการคอคอดใหญ่คุมจุดทำงานกังหัน |
| **0.6** mil | **หุบสุด** | รีดความเร็วสูงสุดจากไอเสียเย็น |
| **1.0** AB | **เปิดสุด** | สันดาปท้ายทำให้ปริมาตรพอง คอคอดแคบจะดันกลับจนคอมเพรสเซอร์ surge |

เหตุผลที่เครื่องบินรบจอดติดเครื่องเฉยๆ แล้วปากท่ออ้ากว้าง

---

## 5. ตัวอย่าง Three.js

### โหลดและคุมพื้นฐาน

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNozzleRig } from './su57-nozzle.js';

const loader = new GLTFLoader();
const gltf = await loader.loadAsync('./su57.glb');
scene.add(gltf.scene);

const rig = createNozzleRig(gltf.scene);   // reset() ถูกเรียกให้แล้ว

rig.setThrottle(0);        // จอด idle — ปากอ้า
rig.setThrottle(0.6);      // mil — หุบสุด
rig.setThrottle(1);        // afterburner — อ้าสุด

rig.setVector(15, 0);      // เชิดหัวเต็มที่
rig.setVector(0, -10);     // หันหัวซ้าย
rig.setVectorWithRoll(0, 0, 12);   // ม้วนขวาด้วย differential
rig.setThrottleSide('L', 0);       // ดับเครื่องซ้าย
rig.reset();
```

### ผูกกับ input จริง

```js
const input = { pitch: 0, yaw: 0, roll: 0, throttle: 0.5 };

addEventListener('keydown', (e) => {
  const k = { ArrowUp: 'pitch', ArrowDown: 'pitch', ArrowLeft: 'roll', ArrowRight: 'roll' }[e.key];
  if (k) input[k] = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1;
  if (e.key === 'w') input.throttle = Math.min(1, input.throttle + 0.05);
  if (e.key === 's') input.throttle = Math.max(0, input.throttle - 0.05);
});
addEventListener('keyup', () => { input.pitch = input.roll = 0; });

// nozzle ของจริงขยับไม่ทันใจ — actuator ใช้เวลาราว 1 วินาทีจากสุดถึงสุด
const smooth = { pitch: 0, yaw: 0, roll: 0, throttle: 0.5 };
const RATE = 4;   // หน่วยต่อวินาที

function update(dt) {
  for (const k of ['pitch', 'yaw', 'roll', 'throttle']) {
    smooth[k] += (input[k] - smooth[k]) * Math.min(1, RATE * dt);
  }
  rig.setVectorWithRoll(smooth.pitch * 18, smooth.yaw * 18, smooth.roll * 18);
  rig.setThrottle(smooth.throttle);
}
```

### เปลวไฟ afterburner ที่ปากท่อ

ใช้ `su57-flame.js` — `Gimbal_*` เบนไปไหน เปลวตามไปเอง เพราะ parent เดียวกัน ไม่ใช้ billboard เพราะการหันหน้าหากล้องจะสู้กับการเบนที่ rig นี้มีไว้โชว์พอดี

```js
import { createNozzleRig } from './su57-nozzle.js';
import { createFlameRig } from './su57-flame.js';

const rig = createNozzleRig(gltf.scene);
const flames = createFlameRig(rig, { light: true });

function frame(dt) {
  rig.setVectorWithRoll(p * 18, y * 18, r * 18);
  rig.setThrottle(throttle);
  flames.update(dt, throttle);   // ต้องเรียกหลัง rig เพราะอ่าน iris morph กลับมา
}

flames.update(dt, 1, 0);   // asymmetric — AB ข้างซ้าย เครื่องขวาดับ
```

| option | ค่าเริ่มต้น | คือ |
|---|---|---|
| `light` | `false` | `PointLight` ที่ปากท่อแต่ละข้าง ความสว่างตาม AB — ให้เปลวส่องท้องลำตัว |
| `lightIntensity` | `60` | ตัวคูณความสว่างของไฟดวงนั้น |
| `radialSeg` / `heightSeg` | `20` / `1` | ความละเอียดกรวย |
| `colors` / `coreColors` | ฟ้า-ม่วง / ขาว-ฟ้า | `{ hot, mid, tip }` ไล่จากปากท่อไปปลายเปลว |

### ทำไมไม่เขียน cone ธรรมดาเอง

โค้ดง่ายๆ แบบ `ConeGeometry` + `MeshBasicMaterial` พังสี่จุด ที่ในโมดูลแก้ไว้แล้ว:

| ปัญหา | อาการที่เห็น | ทางแก้ในโมดูล |
|---|---|---|
| ฐานกรวยอยู่ที่ `−h/2` แล้วชดเชยด้วย `position.z` | พอ `scale` ตามยาวไม่เท่า 1 ฐานลอยห่างปากท่อ | ย้าย geometry ให้ฐานอยู่ที่ local origin แล้ว `position.z = 2.76` ตายตัว scale ยาวไปท้ายอย่างเดียว |
| รัศมีฐาน hardcode | AB เต็ม = iris อ้าสุด (⌀ 1.099) เห็นวงท่อโล่งรอบเปลวตอนที่สว่างที่สุดพอดี | อ่าน `morphTargetInfluences` กลับมาทุกเฟรม ไม่ว่าใครสั่ง iris ก็ตรงกันเสมอ |
| `DoubleSide` + additive | ผนังสองชั้นบวกกัน ขอบสว่างกว่าแกน อ่านเป็นท่อกลวง | `FrontSide` + ไล่ความสว่างตามมุมมอง หน้าตรง = แกนร้อน ขอบเฉียง = จางหาย |
| ไม่มี depth fade | ตอน takeoff / landing / taxi กรวยตัดรันเวย์เป็นเส้นคม | soft-particle fade (เปิดเอง ดูข้างล่าง) |

### Soft-particle fade

ไม่บังคับ แต่เกมที่มีพื้นควรเปิด ต้องมี depth texture ป้อนให้:

```js
const rt = new THREE.WebGLRenderTarget(w, h);
rt.depthTexture = new THREE.DepthTexture(w, h);
flames.setDepthTexture(rt.depthTexture, camera.near, camera.far, w, h);
```

เรียกซ้ำทุกครั้งที่ resize พารามิเตอร์ตัวสุดท้าย `softness` (ค่าเริ่มต้น `1.4` model units ≈ 0.6 m) คือระยะที่เปลวเริ่มจางก่อนชนพื้นผิว

### พฤติกรรมตามคันเร่ง

| คันเร่ง | เปลว |
|---|---|
| < 0.02 | ซ่อนทั้งหมด ไม่มี draw call |
| 0.05 → mil (0.6) | ไอเสียแห้ง จางๆ สั้น ยาวสุด ~3.2 units |
| > mil | สันดาปท้ายติด แกนในโผล่ shock diamond ขึ้น ยาวถึง 13 units ที่ AB เต็ม |

ทุกอย่างอิง `rig.MIL_THROTTLE` ตัวเดียวกับตารางคันเร่งในหัวข้อ 4 แก้ที่เดียวขยับตามกันหมด

### ที่เหลือฝั่ง render

- **Bloom** — เปลวตั้ง `toneMapped: false` ยิงค่าเกิน 1 ออกมาเพื่อให้ bloom จับ ที่ 60fps ใช้ half-res + mip น้อย และให้เปลวเป็นสิ่งเดียวที่เกิน threshold ไม่งั้นทั้งฉากเยิ้ม คุมไม่อยู่ใช้ selective bloom
- **Heat haze** — ยังไม่มี ทำเป็น screen-space distortion pass ต่างหาก ไม่กระทบโมดูลนี้

### สลับสถานะล้อ / ท่อเติมน้ำมัน

```js
function setState(scene, on, off, isOn) {
  scene.getObjectByName(on).visible = isOn;
  scene.getObjectByName(off).visible = !isOn;
}

setState(gltf.scene, 'Gear_down', 'Gear_up', false);   // เก็บล้อ
setState(gltf.scene, 'Probe_on', 'Probe_off', false);  // เก็บท่อ
```

---

## 6. ทดสอบใน Blender

### Iris

Outliner → กาง `NozzleMount_L` → `Gimbal_L` → คลิก **`Nozzle_L`** (ตัวเมช) → Properties ขวา → ไอคอนสามเหลี่ยมเขียวคว่ำ (Object Data) → กล่อง **Shape Keys** → คลิก `Iris_Close` หรือ `Iris_Open` → ลากช่อง **Value**

ต้องอยู่ Object Mode และ **อย่าดัน 1 ทั้งคู่** เพราะ delta หักล้างกัน

### Gimbal

Outliner → `Gimbal_L` → กด `N` → แท็บ Item → **Rotation X** / **Rotation Y** (Z ปล่อย 0) — `Alt`+`R` รีเซ็ต

หรือกดในวิวพอร์ต: `R` `X` `X` `15` `Enter` (กดแกนสองครั้ง = local axis ถ้ากดครั้งเดียวจะหมุนแกน global ผิดทาง)

### สั่งทีเดียวทั้งสองข้าง

แปะใน Scripting tab กด `Alt`+`P`:

```python
import bpy, math

THROTTLE = 1.0    # 0 = idle, 0.6 = mil (หุบสุด), 1 = AB
PITCH    = 15.0   # + = หัวเชิดขึ้น
YAW      = 0.0    # + = หัวหันขวา

MIL, IDLE_OPEN = 0.6, 0.6
t = max(0.0, min(1.0, THROTTLE))
a = (IDLE_OPEN + (-1 - IDLE_OPEN) * (t / MIL)) if t <= MIL \
    else (-1 + 2 * ((t - MIL) / (1 - MIL)))

for s in ('R', 'L'):
    kb = bpy.data.objects['Nozzle_' + s].data.shape_keys.key_blocks
    kb['Iris_Close'].value = max(0.0, -a)
    kb['Iris_Open'].value = max(0.0, a)
    bpy.data.objects['Gimbal_' + s].rotation_euler = (
        math.radians(-PITCH), math.radians(YAW), 0)   # ลบ = พ่นขึ้น = หัวเชิด
```

ตรรกะเดียวกับ `su57-nozzle.js` เป๊ะ เห็นใน Blender ยังไง ใน Three.js ได้เหมือนกัน

---

## 7. ลดขนาดไฟล์

40.7 MB ส่วนใหญ่เป็น texture 33 MB เรียงตามความคุ้ม:

1. **ย่อ texture** — `su57_Body_BaseColor.png` 11 MB ย่อเป็น 2048² + แปลงเป็น KTX2/Basis
2. **`export_morph_normal=False`** — normal ของกลีบคำนวณกลับจากการหมุนได้ ประหยัดครึ่งหนึ่งของ morph payload
3. **Draco** — ลด mesh แต่ระวัง morph target บาง pipeline รองรับไม่ครบ
4. **ตัดของไม่ใช้** — `Stick` (อยู่ในห้องนักบิน) `Gauges`/`Cockpit` texture 7.7 MB ถ้าไม่ทำมุมมองในห้องนักบิน

---

## 8. งานที่ยังไม่ได้ทำ

- **rig พื้นผิวบังคับ** — ailerons / flaps / elevators / rudders ยังไม่มีจุดหมุน (ดูหัวข้อ 3)
- **ท่อบังตา** — ถ้าเบนเต็ม 18° แล้วเห็นทะลุเข้าไปในลำตัว ใส่ทรงกระบอกทึบ R ≈ 1.28 ยาว 0.5 สีดำด้าน parent เข้ากับ `Body` (~50 tris) ตอนนี้มีท่อในของโมเดลบังอยู่แล้วระดับหนึ่ง
- **heat haze** — เปลวไฟมีแล้ว (`su57-flame.js`) แต่ยังไม่มีการบิดภาพจากความร้อน ต้องทำเป็น post-process pass
- **LEVCON** ไม่มีในโมเดล ถ้าต้องการต้องแยกออกจาก `Body` เอง
