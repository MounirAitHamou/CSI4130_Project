import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import WebGL from "three/addons/capabilities/WebGL.js";
import { GUI } from "https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm";

let camera = 0;
let renderer = 0;
let scene = null;
let controls;

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

    //Add light so that the model can be seen properly
    const light = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(light);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(300, 500, 200);
    directionalLight.castShadow = true;

    directionalLight.shadow.camera.left = -5000;
    directionalLight.shadow.camera.right = 5000;
    directionalLight.shadow.camera.top = 5000;
    directionalLight.shadow.camera.bottom = -5000;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;

    scene.add(directionalLight);

    //Loaders
    const matLoader = new MTLLoader();  
    const textLoader = new THREE.TextureLoader();








    //Ground of the scene
    const groundGeometry = new THREE.PlaneGeometry(20000, 20000);
    const groundMaterial = new THREE.MeshStandardMaterial({color: 0xffffff, map: textLoader.load("textures/snow.jpg"), roughness: 0.5}); //Ground material with snow texture
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);


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
    scene.add(snowman);



    //Lamppost
    const lampGroup = new THREE.Group();
    lampGroup.position.set(300,0,1000);
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
    lampLight.castShadow = true;
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



    //Rideau Canal
    const canalMat = new THREE.MeshStandardMaterial({color: 0x446688, roughness: 0.9, transparent: true, opacity: 0.9});
    const canalGeometry = new THREE.PlaneGeometry(1000,20000);
    const canal = new THREE.Mesh(canalGeometry, canalMat);
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
    cabin.position.set(-800,0,1000);
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

    
    function render(){
        requestAnimationFrame(render);
        animateSnow();

        chateauLOD.update(camera);

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


/*

    const lampLight = new THREE.PointLight(0xffcc88, 5000000, 5000);
    lampLight.castShadow = true;
    lampLight.shadow.mapSize.width = 1000;
    lampLight.shadow.mapSize.height = 1000;
    lampLight.shadow.radius = 50;
    lampLight.position.set(-100,200,1000);
    scene.add(lampLight);

*/