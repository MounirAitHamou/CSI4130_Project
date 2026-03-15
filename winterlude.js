import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import WebGL from "three/addons/capabilities/WebGL.js";
import { GUI } from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";


let camera = 0;
let renderer = 0;
let scene = null;
let controls;
let canal = null;

// Terrain configuration
const TERRAIN_BASE_HEIGHT = 0;
const TERRAIN_MAX_AMPLITUDE = 650; // how steep the inclines are 
const TERRAIN_NOISE_SCALE1 = 1 / 6000;
const TERRAIN_NOISE_SCALE2 = 1 / 3000;
const TERRAIN_NOISE_SCALE3 = 1 / 12000;
const PLAYER_HEIGHT_OFFSET = 200;

// Ice strip configuration 
const ICE_CENTER_X = 0;
const ICE_INNER_HALF_WIDTH = 500; // used to keep the ice strip flat 
const ICE_OUTER_HALF_WIDTH = 2200; // used to get a wider blend for a gentler slope at canal edge

const BUILDING_FLATTEN_REGIONS = [
    // snowman area
    { x: 0, z: 1000, innerRadius: 400, outerRadius: 1000 },
    // lamppost area
    { x: 300, z: 1000, innerRadius: 300, outerRadius: 800 },
    // Chateau Laurier
    { x: 4000, z: -3000, innerRadius: 1200, outerRadius: 2200 },
    // Parliament tower
    { x: -4000, z: -3000, innerRadius: 1200, outerRadius: 2200 },
    // Parliament base
    { x: -4000, z: -3500, innerRadius: 1200, outerRadius: 2200 },
    // Cabin 1 
    { x: -800, z: 1000, innerRadius: 600, outerRadius: 2200 },
    // Cabin 2 (just cabin 1 mirrored)
    { x: 800, z: 1000, innerRadius: 600, outerRadius: 2200 }
];

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

// Self-contained improved Perlin noise (2D), deterministic with a seed
function mulberry32(seed) {
    let t = seed >>> 0;
    return function() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function buildPermutation(seed) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = p[i];
        p[i] = p[j];
        p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
}

const PERLIN_PERM = buildPermutation(1337);

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad2(hash, x, z) {
    // 8 gradient directions (including diagonals)
    switch (hash & 7) {
        case 0: return  x + z;
        case 1: return -x + z;
        case 2: return  x - z;
        case 3: return -x - z;
        case 4: return  x;
        case 5: return -x;
        case 6: return  z;
        default: return -z;
    }
}

function perlin2D(x, z) {
    const X = Math.floor(x) & 255;
    const Z = Math.floor(z) & 255;

    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);

    const u = fade(xf);
    const v = fade(zf);

    const aa = PERLIN_PERM[X + PERLIN_PERM[Z]];
    const ab = PERLIN_PERM[X + PERLIN_PERM[Z + 1]];
    const ba = PERLIN_PERM[X + 1 + PERLIN_PERM[Z]];
    const bb = PERLIN_PERM[X + 1 + PERLIN_PERM[Z + 1]];

    const x1 = lerp(grad2(aa, xf, zf), grad2(ba, xf - 1, zf), u);
    const x2 = lerp(grad2(ab, xf, zf - 1), grad2(bb, xf - 1, zf - 1), u);

    // Output is approximately in [-1, 1]
    return lerp(x1, x2, v);
}

function fbm2D(x, z) {
    let value = 0;
    let amplitude = 0.55;
    let frequency = 1;
    let norm = 0;

    for (let i = 0; i < 4; i++) {
        value += amplitude * perlin2D(x * frequency, z * frequency);
        norm += amplitude;
        frequency *= 2.05;
        amplitude *= 0.5;
    }

    // Normalize to roughly [-1, 1]
    return value / (norm || 1);
}

// Main terrain height function
function getTerrainHeight(x, z) {
    // calculations for the terrain height
    const n1 = fbm2D(x * TERRAIN_NOISE_SCALE1, z * TERRAIN_NOISE_SCALE1);
    const n2 = fbm2D(x * TERRAIN_NOISE_SCALE2 + 100, z * TERRAIN_NOISE_SCALE2 - 200);
    const n3 = fbm2D(x * TERRAIN_NOISE_SCALE3 - 400, z * TERRAIN_NOISE_SCALE3 + 300);

    let height = TERRAIN_BASE_HEIGHT;
    // Perlin fBM is centered around 0 already (roughly [-1, 1])
    height += (n1 * 0.6 + n2 * 0.3 + n3 * 0.1) * TERRAIN_MAX_AMPLITUDE;

    // keep height within bounds
    height = THREE.MathUtils.clamp(height, TERRAIN_BASE_HEIGHT - TERRAIN_MAX_AMPLITUDE, TERRAIN_BASE_HEIGHT + TERRAIN_MAX_AMPLITUDE);

    // Ice strip mask to keep the ice strip flat
    const distToIceCenter = Math.abs(x - ICE_CENTER_X);
    if (distToIceCenter <= ICE_INNER_HALF_WIDTH) {
        height = TERRAIN_BASE_HEIGHT;
    } else if (distToIceCenter < ICE_OUTER_HALF_WIDTH) {
        const t = (distToIceCenter - ICE_INNER_HALF_WIDTH) / (ICE_OUTER_HALF_WIDTH - ICE_INNER_HALF_WIDTH);
        const fade = 1 - smoothstep(0, 1, t);
        height = lerp(TERRAIN_BASE_HEIGHT, height, 1 - fade);
    }

    // flatten the terrain near buildings
    for (const region of BUILDING_FLATTEN_REGIONS) {
        const dx = x - region.x;
        const dz = z - region.z;
        const d = Math.sqrt(dx * dx + dz * dz);

        if (d <= region.innerRadius) {
            height = TERRAIN_BASE_HEIGHT;
            break;
        } else if (d < region.outerRadius) {
            const t = (d - region.innerRadius) / (region.outerRadius - region.innerRadius);
            const strength = 1 - smoothstep(0, 1, t);
            height = lerp(height, TERRAIN_BASE_HEIGHT, strength);
        }
    }

    return height;
}

async function init() {
    if (WebGL.isWebGLAvailable() === false) {
        document.body.appendChild(WebGL.getWebGLErrorMessage());
    }
    // add our rendering surface and initialize the renderer
    var container = document.createElement("div");
    document.body.appendChild(container);

    var info = document.createElement("div");
    info.style.position = "absolute";
    info.style.top = "5px";
    info.style.left = "5px";
    info.style.width = "100%";
    info.style.textAlign = "left";
    info.style.color = "lightblue";
    container.appendChild(info);

    renderer = new THREE.WebGLRenderer();
    renderer.setClearColor(new THREE.Color(0x333333));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // All drawing will be organized in a scene graph
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xC8E4FA); //winter sky
    var axes = new THREE.AxesHelper(10);
    scene.add(axes);

    // A camera with fovy = 90deg means the z distance is y/2
    var szScreen = 120;

    // calcaulate aspectRatio
    var aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(90, aspectRatio, 1, 10000);
    camera.position.set(0, 300, 2000);

    //Controls to allow the user to navigate
    controls = new PointerLockControls(camera, renderer.domElement);
    controls.getObject().position.set(0,200,0);
    scene.add(controls.getObject());

    document.addEventListener('click', function () {
        controls.lock();
    });

    const onKeyDown = function(event){
        switch(event.code){
            case 'ArrowUp': //forward
                controls.moveForward(50);
                break;
            case 'ArrowLeft': //left
                controls.moveRight(-50);
                break;
            case 'ArrowDown': //back
                controls.moveForward(-50);
                break;
            case 'ArrowRight': //right
                controls.moveRight(50);
                break;
        }
    }
    document.addEventListener('keydown', onKeyDown);

    //Frustum culling variables
    const frustum = new THREE.Frustum();
    const cameraMatrix = new THREE.Matrix4();
    const toCull = [];

    //Timing the day/night cycle
    const sunClock = new THREE.Clock();
    const dayLength = 120;

    //Add light so that the model can be seen properly
    const light = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(light);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(300, 500, 200);
    directionalLight.target.position.set(0,0,0);
    directionalLight.castShadow = true;

    directionalLight.shadow.camera.left = -10000;
    directionalLight.shadow.camera.right = 10000;
    directionalLight.shadow.camera.top = 10000;
    directionalLight.shadow.camera.bottom = -10000;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 20000;

    scene.add(directionalLight);

    //Loaders
    const matLoader = new MTLLoader();  
    const textLoader = new THREE.TextureLoader();

    //Ground of the scene (procedural rolling terrain)
    const groundGeometry = new THREE.PlaneGeometry(20000, 20000, 256, 256);
    // rotate geometry so it lies in the XZ plane (y = up)
    groundGeometry.rotateX(-Math.PI / 2);

    // Deform terrain mesh using handmade Perlin fBM heightfield
    const groundPositions = groundGeometry.attributes.position;
    for (let i = 0; i < groundPositions.count; i++) {
        const vx = groundPositions.getX(i);
        const vz = groundPositions.getZ(i);
        const vy = getTerrainHeight(vx, vz);
        groundPositions.setY(i, vy);
    }
    groundPositions.needsUpdate = true;
    groundGeometry.computeVertexNormals();

    // Base color texture: snow.jpg (image texture requirement)
    const snowTexture = textLoader.load("textures/snow.jpg");
    // Use mirrored repeat to hide hard seams at texture borders
    snowTexture.wrapS = THREE.MirroredRepeatWrapping;
    snowTexture.wrapT = THREE.MirroredRepeatWrapping;
    // Fewer, larger tiles so any residual pattern is pushed farther out
    snowTexture.repeat.set(4, 4);

    // Perlin noise texture: sample the same handmade Perlin/fBM to build a grayscale DataTexture
    const noiseSize = 256;
    const noiseData = new Uint8Array(noiseSize * noiseSize * 4);
    let ptr = 0;
    for (let j = 0; j < noiseSize; j++) {
        for (let i = 0; i < noiseSize; i++) {
            const u = i / noiseSize;
            const v = j / noiseSize;
            // Lower frequency sampling for broader, softer detail
            const n = fbm2D(u * 3.0, v * 3.0); // ~[-1,1]
            // Bias toward lighter values so the texture is not too dark/grainy
            const nd = THREE.MathUtils.clamp(n * 0.35 + 0.65, 0, 1);
            const g = Math.floor(nd * 255); // map to [0,255]
            noiseData[ptr++] = g;
            noiseData[ptr++] = g;
            noiseData[ptr++] = g;
            noiseData[ptr++] = 255;
        }
    }
    const perlinTexture = new THREE.DataTexture(noiseData, noiseSize, noiseSize, THREE.RGBAFormat);
    perlinTexture.wrapS = THREE.RepeatWrapping;
    perlinTexture.wrapT = THREE.RepeatWrapping;
    // Repeat enough to add variation but not expose a tight grid
    perlinTexture.repeat.set(24, 24);
    perlinTexture.needsUpdate = true;

    // Ground material:
    //  - snow.jpg as the primary color map
    //  - handmade Perlin noise texture used as bump/roughness map (Perlin texture requirement)
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: snowTexture,
        bumpMap: perlinTexture,
        bumpScale: 4,
        // Keep a fairly high, uniform roughness so lighting is soft
        roughness: 0.7
    });

    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Camera-following sky dome with seamless procedural 3D clouds
    const cloudMaterial = new THREE.ShaderMaterial({
        uniforms: { // values for the shader
            uTime: { value: 0.0 },
            uNoiseScale: { value: 2.35 },
            uWind: { value: new THREE.Vector2(0.02, 0.0045) },
            uCoverage: { value: 0.5 },
            uSoftness: { value: 0.1 },
            uOpacity: { value: 0.82 },
            uCloudColor: { value: new THREE.Color(0xd2d6db) },
            uSkyHorizonColor: { value: new THREE.Color(0xc8e4fa) },
            uSkyZenithColor: { value: new THREE.Color(0x8fb5d7) },
            uSunDirection: { value: new THREE.Vector3(0,1,0) }
        },
        // vertex shader for the cloud dome, embedded in the shader so we don't have to load an external file
        vertexShader: `
            varying vec3 vWorldPos;

            void main() {
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vWorldPos = worldPos.xyz;
                gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        // fragment shader for the cloud dome, embedded in the shader so we don't have to load an external file
        fragmentShader: `
            uniform float uTime;
            uniform float uNoiseScale;
            uniform vec2 uWind;
            uniform float uCoverage;
            uniform float uSoftness;
            uniform float uOpacity;
            uniform vec3 uCloudColor;
            uniform vec3 uSkyHorizonColor;
            uniform vec3 uSkyZenithColor;
            varying vec3 vWorldPos;
            uniform vec3 uSunDirection;

            // hash function to generate a random number from a 3D vector
            float hash31(vec3 p) {
                p = fract(p * 0.1031);
                p += dot(p, p.yzx + 33.33);
                return fract((p.x + p.y) * p.z);
            }

            // 3D noise function (not using Perlin noise because we are in 3D and Perlin noise is better for 2D)
            float noise3(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);
                vec3 u = f * f * (3.0 - 2.0 * f);

                float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
                float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
                float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
                float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
                float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
                float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
                float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
                float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

                float nx00 = mix(n000, n100, u.x);
                float nx10 = mix(n010, n110, u.x);
                float nx01 = mix(n001, n101, u.x);
                float nx11 = mix(n011, n111, u.x);
                float nxy0 = mix(nx00, nx10, u.y);
                float nxy1 = mix(nx01, nx11, u.y);

                return mix(nxy0, nxy1, u.z);
            }

            float fbm(vec3 p) {
                float value = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < 5; i++) {
                    value += amplitude * noise3(p);
                    p = p * 2.02 + vec3(7.13, 3.17, 5.97);
                    amplitude *= 0.5;
                }
                return value;
            }

            void main() {
                vec3 dir = normalize(vWorldPos - cameraPosition);
                float skyT = smoothstep(-0.15, 0.85, dir.y);
                vec3 skyColor = mix(uSkyHorizonColor, uSkyZenithColor, skyT);

                //SUN
                float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
                float sunDisk = smoothstep(0.999, 1.0, sunDot);
                vec3 sunColor = vec3(1.0, 0.95, 0.50);
                float sunset = smoothstep(0.0, 0.25, 1.0 - abs(uSunDirection.y));
                //Make sky orange when sun sets
                vec3 sunsetColor = vec3(1.0, 0.55, 0.2); 
                skyColor = mix(skyColor, sunsetColor, sunset * (1.0 - skyT) * 0.5) + sunDisk*sunColor*4.0;

                //MOON
                vec3 moonDirection = -normalize(uSunDirection);
                float moonDot = max(dot(dir, moonDirection), 0.0);
                float moonDisk = smoothstep(0.9988, 1.0, moonDot);
                vec3 moonColor = vec3(0.72, 0.72, 0.75);
                float moonVisibility = smoothstep(0.0, -0.15, uSunDirection.y); //hides moon when sun is out
                skyColor = mix(skyColor, moonColor, moonDisk*moonVisibility*1.4);

                vec3 wind = vec3(uWind.x, 0.0, uWind.y) * uTime;
                vec3 basePos = dir * uNoiseScale + wind;
                float base = fbm(basePos);
                float detail = fbm(basePos * 2.35 + vec3(13.2, 7.1, 19.8) - wind * 0.35);
                float cloudField = base * 0.68 + detail * 0.32;

                float mask = smoothstep(uCoverage - uSoftness, uCoverage + uSoftness, cloudField);
                float horizonFade = smoothstep(-0.12, 0.2, dir.y);
                float alpha = mask * uOpacity * horizonFade;

                vec3 finalColor = mix(skyColor, uCloudColor, alpha);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        depthWrite: false, // don't write to the depth buffer, don't block other objects from being rendered
        depthTest: true, // test the depth buffer, "is it in front or behind what's already on the screen?"
        side: THREE.BackSide // render the back side (the side that is actually facing the camera) of the sphere to make it look like a dome
    });

    const cloudDome = new THREE.Mesh(new THREE.SphereGeometry(9000, 192, 128), cloudMaterial);
    cloudDome.position.copy(camera.position);
    cloudDome.frustumCulled = false;
    cloudDome.renderOrder = -10;
    scene.add(cloudDome);

    const cloudClock = new THREE.Clock();

    //Snowman
    const snowmanMat = await matLoader.loadAsync('/models/snowman_01.mtl');
    snowmanMat.preload();
    const snowmanLoader = new OBJLoader();
    snowmanLoader.setMaterials(snowmanMat);
    const snowman = await snowmanLoader.loadAsync('/models/snowman_01.obj');
    snowman.position.set(0, 0, 1000);
    snowman.rotation.x = -Math.PI/2;
    snowman.rotation.z = Math.PI;
    snowman.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
    });

    //distribute snowmen around the scene
    for(let i = 0; i < 12; i++){ //12 snowmen
        let x;
        let z;
        let check = false;

        while(!check){
            x = Math.random()*20000 - 10000;
            z = Math.random()*18000 - 10000;
            check = true;

            //prevent snowmen from spawning on canal
            if(Math.abs(x-ICE_CENTER_X) < ICE_OUTER_HALF_WIDTH){
                check = false;
                continue;
            }

            //prevent snowman from spawning inside other models (buildings, cabins, etc.)
            for(const area of BUILDING_FLATTEN_REGIONS){
                //calculate the distance from snowman to other models
                const dx = x - area.x;
                const dz = z - area.z;
                const distance = Math.sqrt(dx*dx + dz*dz);
                if(distance < area.outerRadius){ //snowman is inside other model
                    check = false;
                    break;
                }
            }
        }

        //add new snowmen (s) aligned with the ground (y) and facing a random direction
        const s = snowman.clone(true);
        const y = getTerrainHeight(x, z);
        s.position.set(x, y, z);
        s.rotation.z = Math.random();
        scene.add(s);
        toCull.push(s);
    }



    //Lamppost
    const lampGroup = new THREE.Group();
    lampGroup.position.set(600,0,1000);
    scene.add(lampGroup);

    const lampMat = await matLoader.loadAsync('/models/lamppost.mtl');
    lampMat.preload();
    const lampLoader = new OBJLoader();
    lampLoader.setMaterials(lampMat);
    const lamp = await lampLoader.loadAsync('/models/lamppost.obj');
    lamp.scale.set(35, 35, 35);
    lamp.traverse(obj => { //adds shadows
        if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
    });
    lampGroup.add(lamp);

    const lampLight = new THREE.PointLight(0xffcc88, 500000, 5000);
    lampLight.castShadow = false;
    lampLight.shadow.mapSize.width = 1000;
    lampLight.shadow.mapSize.height = 1000;
    lampLight.shadow.radius = 50;
    lampLight.position.set(0,700,0);
    lampGroup.add(lampLight);

    const bulbMat = new THREE.MeshStandardMaterial({color: 0xffcc88, emissive: 0xffcc88});
    const bulbGeometry = new THREE.SphereGeometry(19,19,19);
    const lightbulb = new THREE.Mesh(bulbGeometry, bulbMat);
    lightbulb.scale.set(2,2,2);
    lightbulb.position.set(0,600,0);
    lampGroup.add(lightbulb);

    const lamp2 = lampGroup.clone(true);
    lamp2.position.set(-600,0,1000);
    scene.add(lamp2);
    const lamp3 = lampGroup.clone(true);
    lamp3.position.set(600,0,0);
    scene.add(lamp3);
    const lamp4 = lampGroup.clone(true);
    lamp4.position.set(-600,0,0);
    scene.add(lamp4);
    const lamp5 = lampGroup.clone(true);
    lamp5.position.set(600,0,-1000);
    scene.add(lamp5);
    const lamp6 = lampGroup.clone(true);
    lamp6.position.set(-600,0,-1000);
    scene.add(lamp6);
    const lamp7 = lampGroup.clone(true);
    lamp7.position.set(600,0,2000);
    scene.add(lamp7);
    const lamp8 = lampGroup.clone(true);
    lamp8.position.set(-600,0,2000);
    scene.add(lamp8);



    //Rideau Canal (reflective ice surface)
    // Add segments along the length so we can gently vary the edges
    const canalGeometry = new THREE.PlaneGeometry(1000, 20000, 1, 128);
    const reflectorOptions = {
        clipBias: 0.003, // offset to avoid depth fighting (flickering issues when the camera is close to the reflector)
        // use a lower resolution so reflections appear softer and less mirror-sharp
        textureWidth: window.innerWidth * window.devicePixelRatio * 0.4, 
        textureHeight: window.innerHeight * window.devicePixelRatio * 0.4,
        // darker, more neutral blue-gray to visually dull the reflections
        color: 0x7f95a5
    };
    canal = new Reflector(canalGeometry, reflectorOptions);
    canal.rotation.x = -Math.PI/2;
    canal.position.set(0,0.5,100);
    canal.receiveShadow = true;
    scene.add(canal);

    //Chateau Laurier
    const chateauMat = await matLoader.loadAsync('/models/Palace/SM_Palace.mtl');
    chateauMat.preload();
    const chateauLoader = new OBJLoader();
    chateauLoader.setMaterials(chateauMat);
    const chateau = await chateauLoader.loadAsync('/models/Palace/SM_Palace.obj');
    chateau.scale.set(70,70,70);

    const chateauLOD = new THREE.LOD();
    
    //High detail
    const chateauHigh = chateau.clone(true);
    chateauHigh.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
    });
    chateauLOD.addLevel(chateauHigh,0)
    //Med detail
    const chateauMed = chateau.clone(true);
    chateauMed.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = false;
            obj.receiveShadow = false;
        }
    });
    chateauLOD.addLevel(chateauMed,6000)
    //Low detail
    const chateauLow = chateau.clone(true);
    chateauLow.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = false;
            obj.receiveShadow = false;
            obj.material = new THREE.MeshStandardMaterial({ color: 0x8B5E3C });
        }
    });
    chateauLOD.addLevel(chateauLow,9000)

    chateauLOD.position.set(4000, -100, -3000);
    scene.add(chateauLOD);

    //Parliement
    const parliamentMat = await matLoader.loadAsync('/models/BigBen/BigBen.mtl');
    parliamentMat.preload();
    const parliamentLoader = new OBJLoader();
    parliamentLoader.setMaterials(parliamentMat);
    const parliament = await parliamentLoader.loadAsync('/models/BigBen/BigBen.obj');
    parliament.position.set(-4000, -100, -3000);
    parliament.scale.set(8,8,8);

    const parliamentLOD = new THREE.LOD();

    //High detail
    const parliamentHigh = parliament.clone(true);
    parliamentHigh.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
    });
    parliamentLOD.addLevel(parliamentHigh, 0);
    //Med detail
    const parliamentMed = parliament.clone(true);
    parliamentMed.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = false;
            obj.receiveShadow = false;
        }
    });
    parliamentLOD.addLevel(parliamentMed, 6000);
    scene.add(parliamentLOD);
    //Parliement base (reuse chateau asset)
    const pBaseLOD = chateauLOD.clone(true);
    pBaseLOD.position.set(-4000, -100, -3500);
    pBaseLOD.scale.x = 2;
    scene.add(pBaseLOD);

    //Cabin
    const cabinMat = await matLoader.loadAsync('/models/Log Cabin/materials.mtl');
    cabinMat.preload();
    const cabinLoader = new OBJLoader();
    cabinLoader.setMaterials(cabinMat);
    const cabin = await cabinLoader.loadAsync('/models/Log Cabin/model.obj');
    cabin.position.set(-800, 0,500);
    cabin.scale.set(500,500,500);
    cabin.rotation.y = -Math.PI / 4;
    cabin.traverse(obj => { //Adds shadow functionality
        if(obj.isMesh){
            obj.castShadow = true;
            obj.receiveShadow = true;
        }
    });
    const box = new THREE.Box3().setFromObject(cabin);
    cabin.position.y -= box.min.y;
    scene.add(cabin);
    //Second cabin
    const cabin2 = cabin.clone();
    cabin2.position.x = -cabin.position.x;
    cabin2.position.y = cabin.position.y;
    cabin2.position.z = cabin.position.z;
    cabin2.rotation.y = 5 * Math.PI / 4;
    scene.add(cabin2);
  
    //Falling snow
    const snowGeometry = new THREE.BufferGeometry();
    const snowMaterial = new THREE.PointsMaterial({color: 0xffffff, size: 5});
    const locations = [];
    for(let i = 0; i < 5000; i++){
        const x = Math.random()*20000-10000;
        const y = Math.random()*1000+1000;
        const z = Math.random()*20000-10000;
        locations.push(x,y,z);
    }
    snowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(locations,3));
    const snowflakes = new THREE.Points(snowGeometry, snowMaterial);
    scene.add(snowflakes);

    
    function animateSnow(){
        const location = snowflakes.geometry.attributes.position.array;
        for(let i=1; i<location.length; i+= 3){
            location[i]--;
            if(location[i] < 0){ //Hits the ground
                location[i] = Math.random()*1000+1000; //resets to top
            }
        }
        snowflakes.geometry.attributes.position.needsUpdate = true;
    }

    //Add list of objects to cull (frustum)
    toCull.push(chateauLOD);
    toCull.push(parliamentLOD);
    toCull.push(pBaseLOD);
    toCull.push(cabin);
    toCull.push(cabin2);
    toCull.push(lampGroup);
    toCull.push(snowman);

    //Loop adds bounding sphere for frustum culling to any mesh without one
    for(let obj of toCull){
        obj.traverse((child) => {
            if(child.isMesh && !child.geometry.boundingSphere){
                child.geometry.computeBoundingSphere();
            }
        });
    }

    //Frustum Culling
    function frustumCull(){
        camera.updateMatrixWorld();
        cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); //matrix for the frustum view
        frustum.setFromProjectionMatrix(cameraMatrix);
        
        for(let obj of toCull){
            let visible = false;
            obj.traverse((child) => { //traverse all meshes of an object
                if(child.isMesh && child.geometry.boundingSphere){
                    if(frustum.intersectsObject(child)){ //the mesh is in the frustum (so it's visible)
                        visible = true;
                    }
                }
            });
            obj.visible = visible;
        }
    }

    //Control the day/night cycle
    function updateSun(){
        const radius = 10000; //sun's rotation radius
        const time = (sunClock.getElapsedTime() % dayLength)/dayLength; //gets number of seconds elapsed
        
        const x = Math.cos(time*2*Math.PI)*radius;
        const y = Math.sin(time*2*Math.PI)*radius/2;
        directionalLight.position.set(x,y,0); //moves the light across the sky
        const sunlight = Math.max(y/radius, 0);
        directionalLight.intensity = 3 * sunlight;
        light.intensity = 0.25 * (sunlight+0.05); //changes ambient light

        //Move where the sun is (by sending the light position to the skybox shader)
        const sunDirection = directionalLight.position.clone().normalize();
        cloudMaterial.uniforms.uSunDirection.value.copy(sunDirection);

        cloudMaterial.uniforms.uSkyZenithColor.value.setRGB( //updates sky color based on time of day
            0.1*(1 - sunlight) + 0.5*sunlight,
            0.1*(1 - sunlight) + 0.7*sunlight,
            0.2*(1 - sunlight) + 0.8*sunlight
        );
    }

    function render(){
        requestAnimationFrame(render);
        animateSnow();
        const elapsed = cloudClock.getElapsedTime();
        cloudMaterial.uniforms.uTime.value = elapsed;
        cloudDome.position.copy(camera.position);

        const player = controls.getObject();
        const terrainY = getTerrainHeight(player.position.x, player.position.z);
        player.position.y = terrainY + PLAYER_HEIGHT_OFFSET;

        chateauLOD.update(camera);
        frustumCull();
        updateSun();

        renderer.render(scene, camera);
    }
    render()
}

function onResize() {
    console.log("Resizing");

    var aspect = window.innerWidth / window.innerHeight;
    if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = aspect;
    } else {
        camera.top = szScreen / 2;
        camera.bottom = szScreen / -2;
        camera.left = (szScreen * aspect) / -2;
        camera.right = (szScreen * aspect) / 2;
    }
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.onload = init;
window.addEventListener("resize", onResize, true);