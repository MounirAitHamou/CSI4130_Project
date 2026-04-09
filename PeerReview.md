The original repository was forked to https://github.com/MounirAitHamou/CSI4130_Project, where the following improvements are demonstrated in `winterlude.js`.

### Small Remark
I had to add three as a node module to run the project, and change: (Line 416)
```js
WebGL.isWebGLAvailable()
```
to
```js
WebGL.isWebGL2Available()
```

And (Line 417)
```js
WebGL.getWebGLErrorMessage()
```
to
```js
WebGL.getWebGL2ErrorMessage()
```

I had to do this because my browser only supports WebGL2, and the original code was checking for WebGL1 support.


### Code location
The best feature and all three suggested improvements are located in `winterlude.js`, which contains all of the code.

### Best Feature

The best feature of this project is the **procedural terrain system**, implemented in `getTerrainHeight`.

This system combines multiple layers of Perlin fBM noise to generate realistic terrain variation, and then applies region-based constraints to adapt the terrain to the scene. For example, the canal is kept flat while surrounding terrain is smoothly blended using interpolation (`lerp`) and `smoothstep`, and areas around buildings are flattened with gradual transitions.

This results in terrain that is both visually natural and well-integrated with the environment, while remaining efficient for real-time rendering. Overall, it is very nice to look at and adds a lot of depth to the scene.

### Minor Improvement
I added antialiasing to the renderer by enabling `antialias: true` in the WebGL context. This significantly improves visual quality by smoothing jagged edges, especially on diagonal lines and curves in the terrain and objects. The change is simple but has a noticeable impact on the overall aesthetics of the scene, making it look more polished and professional. (Not counting this as one of the three improvements because it takes no implementation effort and is a standard practice for better visuals.)

### First Suggested Improvement

A key improvement for this project is optimizing terrain height queries by replacing repeated procedural evaluations with **heightfield sampling**.

Currently, `getTerrainHeight(x, z)` is called at runtime (e.g., every frame for player movement and during object placement), which involves expensive Perlin fBM computations. Since the terrain is static after initialization, these repeated calculations introduce unnecessary CPU overhead.

This can be improved by caching the terrain heights after mesh generation and introducing a `sampleTerrainHeight` function that performs fast **bilinear interpolation** over the precomputed heightfield.

After the terrain mesh is generated, this can be added: (Line 541)

```js

const TERRAIN_RES = 256;
const terrainHeights = new Float32Array((TERRAIN_RES + 1) * (TERRAIN_RES + 1));

for (let i = 0; i < groundPositions.count; i++) {
terrainHeights[i] = groundPositions.getY(i);
}

function sampleTerrainHeight(x, z) {
const size = 20000;
const half = size / 2;

const u = (x + half) / size;
const v = (z + half) / size;

const gridX = u * TERRAIN_RES;
const gridZ = v * TERRAIN_RES;

const x0 = Math.floor(gridX);
const x1 = Math.min(x0 + 1, TERRAIN_RES);
const z0 = Math.floor(gridZ);
const z1 = Math.min(z0 + 1, TERRAIN_RES);

const tx = gridX - x0;
const tz = gridZ - z0;

function idx(x, z) {
    return z * (TERRAIN_RES + 1) + x;
}

const h00 = terrainHeights[idx(x0, z0)];
const h10 = terrainHeights[idx(x1, z0)];
const h01 = terrainHeights[idx(x0, z1)];
const h11 = terrainHeights[idx(x1, z1)];

const hx0 = h00 * (1 - tx) + h10 * tx;
const hx1 = h01 * (1 - tx) + h11 * tx;

return hx0 * (1 - tz) + hx1 * tz;
}
```
This allows all runtime height queries to be replaced with fast interpolation over the cached heightfield:

- **Player movement (per-frame update):** (Line 821)
```js
const terrainY = sampleTerrainHeight(player.position.x, player.position.z);
player.position.y = terrainY + PLAYER_HEIGHT_OFFSET;
```

- **Object placement (e.g., snowmen):** (Line 1270)
```js
const y = sampleTerrainHeight(x, z);
snowmanClone.position.set(x, y, z);
```

This change removes expensive noise computations from the runtime loop, improving performance while preserving identical terrain behavior. It also improves scalability as terrain resolution or scene complexity increases.

### Second Suggested Improvement

A meaningful improvement to the collision system is replacing the current **binary point-in-box collision check** in the `render()` loop with a **per-axis collision resolution approach**, allowing the player to slide along walls instead of being fully blocked when any collision occurs.

Currently, movement is computed first and then entirely rejected if the predicted position enters any `Box3` collider using `containsPoint()`. This leads to rigid and unnatural movement, especially near corners or when moving diagonally, since any collision cancels both X and Z movement.

This can be improved by resolving collisions separately per axis. The idea is to test X and Z movement independently, reverting only the axis that causes a collision while preserving the other, which allows smoother sliding along surfaces.

The following section in the `render()` loop: (Line 1231)

```js
let colliding = false;
for (const collider of colliders) {
  if (collider.containsPoint(testPos)) {
    colliding = true;
    break;
  }
}

if (!colliding) {
  player.position.x = newX;
  player.position.z = newZ;
}
```

Could be updated to:

```js
const oldPos = player.position.clone();

// try move X first
player.position.x += velocity.x;

let collidedX = false;
for (const collider of colliders) {
if (collider.containsPoint(player.position)) {
    collidedX = true;
    break;
}
}

// undo X if collision
if (collidedX) {
player.position.x = oldPos.x;
velocity.x = 0;
}

// try move Z
player.position.z += velocity.z;

let collidedZ = false;
for (const collider of colliders) {
if (collider.containsPoint(player.position)) {
    collidedZ = true;
    break;
}
}

// undo Z if collision
if (collidedZ) {
player.position.z = oldPos.z;
velocity.z = 0;
}
```


### Third Suggested Improvement

A meaningful improvement to the snow system is enhancing the particle simulation by extending it from a **single-axis (Y-only) fall model** into a **fully 3D motion system with per-particle variation in speed and wind response**.

Previously, snowflakes were updated using only their Y-position, resulting in uniform vertical motion. This made the snowfall appear overly linear and repetitive, as all particles shared identical behavior apart from random initial placement.

One possible improvement could be introducing two new per-particle attributes: `speeds` and `windFactors`. These allow each snowflake to have independent falling velocity and horizontal drift strength, creating more natural variation in motion across the entire system.

Wind factors were added: (Line 42)
```js
const WIND_X = 0.15;
const WIND_Z = 0.05;
```

You can then initialize these attributes with random values for each particle during setup. For example: (Line 1095)

```js
const speeds = [];
const windFactors = [];

for (let i = 0; i < 5000; i++) {
  const x = Math.random() * 20000 - 10000;
  const y = Math.random() * 1000 + 1000;
  const z = Math.random() * 20000 - 10000;

  locations.push(x, y, z);

  speeds.push(0.5 + Math.random() * 10);
  windFactors.push(0.5 + Math.random() * 20);
}
```

The animation loop can then be updated to apply these attributes, allowing for more dynamic and varied snowfall. For example, the original Y-only update: (Line 1115)

```js
locations[i]--;
if (locations[i] <= 0) {
  locations[i] = Math.random() * 1000 + 1000;
}
```

To a full 3D update:
```js
const wx = WIND_X * windFactors[idx];
const wz = WIND_Z * windFactors[idx];

locations[i] += wx;
locations[i + 2] += wz;

locations[i + 1] -= speeds[idx];

if (locations[i + 1] <= 0) {
  locations[i + 1] = Math.random() * 1000 + 1000;
  locations[i] = Math.random() * 20000 - 10000;
  locations[i + 2] = Math.random() * 20000 - 10000;
}
```

This change improves the system by:

- Adding horizontal wind drift, making snowfall feel less linear
- Introducing per-particle falling speed variation, increasing realism
- Preventing uniform motion patterns across all particles
- Creating a more dynamic and immersive snowfall effect with minimal performance cost

Overall, this transforms the snow system from a deterministic system into something a bit more realistic and chaotic.