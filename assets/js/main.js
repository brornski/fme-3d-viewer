import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

        const container = document.getElementById('canvas-container');
        const sections = document.querySelectorAll('.scroll-section');
        const panels = document.querySelectorAll('[data-animate]');
        const scrollIndicator = document.getElementById('scrollIndicator');

        // Detect device type — used for renderer quality and keyframe selection
        const isMobile = window.innerWidth <= 768;
        const isTablet = window.innerWidth > 768 && window.innerWidth <= 1199;

        // Accessibility: respect reduced motion preference
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Scene setup
        const scene = new THREE.Scene();

        // Camera
        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 0.3, 3.5);

        // Renderer — lean settings, no shadows (none configured), capped pixel ratio
        const maxDPR = isMobile ? 1.5 : Math.min(window.devicePixelRatio, 2);
        const renderer = new THREE.WebGLRenderer({
            antialias: !isMobile, // skip AA on mobile for perf
            alpha: true,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true
        });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(maxDPR);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.4;
        container.appendChild(renderer.domElement);

        // Handle WebGL context loss gracefully (prevents crash→reload loop)
        renderer.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('WebGL context lost');
            stopRenderLoop();
        });
        renderer.domElement.addEventListener('webglcontextrestored', () => {
            console.log('WebGL context restored');
            requestRender();
        });

        // Environment lighting — reduced quality on mobile
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();

        // Create custom environment
        const envScene = new THREE.Scene();
        const envSegments = isMobile ? 16 : 32;
        const envGeo = new THREE.SphereGeometry(50, envSegments, envSegments);
        const envMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {
                uTime: { value: 0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition).y;
                    vec3 topColor = vec3(0.1, 0.1, 0.15);
                    vec3 midColor = vec3(0.18, 0.16, 0.14);
                    vec3 bottomColor = vec3(0.05, 0.05, 0.07);
                    vec3 color = mix(bottomColor, midColor, smoothstep(-1.0, 0.0, h));
                    color = mix(color, topColor, smoothstep(0.0, 1.0, h));

                    // Light spots
                    float spot1 = smoothstep(0.9, 1.0, dot(normalize(vWorldPosition), normalize(vec3(1.0, 1.0, 1.0))));
                    float spot2 = smoothstep(0.85, 1.0, dot(normalize(vWorldPosition), normalize(vec3(-1.0, 0.5, 0.5))));
                    float spot3 = smoothstep(0.88, 1.0, dot(normalize(vWorldPosition), normalize(vec3(0.0, -1.0, 0.5))));

                    color += vec3(1.0, 0.95, 0.85) * spot1 * 2.0;
                    color += vec3(0.7, 0.8, 0.9) * spot2 * 1.0;
                    color += vec3(0.9, 0.85, 0.8) * spot3 * 0.8;

                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });
        const envMesh = new THREE.Mesh(envGeo, envMat);
        envScene.add(envMesh);

        const cubeRenderSize = isMobile ? 128 : 256;
        const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(cubeRenderSize);
        const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
        cubeCamera.update(renderer, envScene);
        const envMap = pmremGenerator.fromCubemap(cubeRenderTarget.texture).texture;
        scene.environment = envMap;

        // Lighting setup — reduced on mobile (3 lights vs 6)
        const ambientLight = new THREE.AmbientLight(0xffffff, isMobile ? 0.7 : 0.5);
        scene.add(ambientLight);

        // Key light - warm, strong, from upper right (main highlight on metal)
        const keyLight = new THREE.DirectionalLight(0xfff5e6, 3.5);
        keyLight.position.set(3, 5, 5);
        scene.add(keyLight);

        // Fill light - softer warm tone from left
        const fillLight = new THREE.DirectionalLight(0xf0e8e0, 1.8);
        fillLight.position.set(-5, 2, 3);
        scene.add(fillLight);

        if (!isMobile) {
            // Rim light - cool blue to bring out the blue anodized titanium
            const rimLight = new THREE.DirectionalLight(0x6BB5E8, 1.5);
            rimLight.position.set(0, 2, -5);
            scene.add(rimLight);

            // Bottom fill - subtle, prevents harsh shadows underneath
            const bottomLight = new THREE.DirectionalLight(0xffffff, 0.8);
            bottomLight.position.set(0, -5, 3);
            scene.add(bottomLight);

            // Top accent - catches the top edges of the device
            const topAccent = new THREE.DirectionalLight(0xffffff, 1.0);
            topAccent.position.set(0, 8, 0);
            scene.add(topAccent);
        }

        // Model
        let model = null;
        const modelGroup = new THREE.Group();
        const pivotGroup = new THREE.Group(); // Handles Y rotation (trophy spin)
        const flipGroup = new THREE.Group(); // Handles upside-down flip
        flipGroup.rotation.z = Math.PI; // Flip 180 degrees upside down
        pivotGroup.add(modelGroup);
        flipGroup.add(pivotGroup);
        scene.add(flipGroup);

        // Target rotations (controlled by scroll)
        // Model is pre-rotated to stand upright, so only Y rotation needed for spinning
        let targetRotationY = Math.PI; // Start rotated to show front face (flipped model)
        let currentRotationY = Math.PI; // Match initial pose

        // Position and zoom targets (adjusted for device)
        // Mobile: model pushed to upper viewport so content panels don't cover it
        const initialZoom = isMobile ? 10.0 : 10.0;
        const initialY = isMobile ? 2.2 : isTablet ? 0.2 : 0;
        let targetPositionX = 0;
        let targetPositionY = initialY;
        let targetZoom = initialZoom;
        let currentPositionX = 0;
        let currentPositionY = initialY;
        let currentZoom = initialZoom;

        // ========================================
        // RENDER-ON-DEMAND SYSTEM
        // Replaces continuous rAF loop with demand-driven rendering
        // ========================================
        let needsRender = false;
        let renderLoopActive = false;
        let lastTimestamp = 0;
        let introComplete = false;

        function requestRender() {
            needsRender = true;
            if (!renderLoopActive && !document.hidden) {
                renderLoopActive = true;
                lastTimestamp = performance.now();
                requestAnimationFrame(renderLoop);
            }
        }

        function stopRenderLoop() {
            renderLoopActive = false;
            needsRender = false;
        }

        function renderLoop(timestamp) {
            if (!renderLoopActive) return;

            // Delta-time exponential lerp — consistent across 60/120Hz
            const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
            lastTimestamp = timestamp;
            const lerpFactor = 1 - Math.exp(-8 * dt);

            currentRotationY += (targetRotationY - currentRotationY) * lerpFactor;
            currentPositionX += (targetPositionX - currentPositionX) * lerpFactor;
            currentPositionY += (targetPositionY - currentPositionY) * lerpFactor;
            currentZoom += (targetZoom - currentZoom) * lerpFactor;

            pivotGroup.rotation.y = currentRotationY;
            flipGroup.position.x = currentPositionX;
            camera.position.z = currentZoom;

            // Subtle floating — only on desktop and only during active rendering
            if (!isMobile && !prefersReducedMotion) {
                const time = (timestamp || 0) * 0.001;
                flipGroup.position.y = currentPositionY + Math.sin(time * 0.8) * 0.012;
            } else {
                flipGroup.position.y = currentPositionY;
            }

            // Skip GPU render when model is fully faded out — massive perf savings
            if (!modelHidden) {
                renderer.render(scene, camera);
            }

            // Check if lerp has converged (values close enough to targets)
            const rotDiff = Math.abs(targetRotationY - currentRotationY);
            const xDiff = Math.abs(targetPositionX - currentPositionX);
            const yDiff = Math.abs(targetPositionY - currentPositionY);
            const zDiff = Math.abs(targetZoom - currentZoom);
            const converged = rotDiff < 0.0005 && xDiff < 0.0005 && yDiff < 0.0005 && zDiff < 0.0005;

            if (converged && !needsRender) {
                // Snap to final values
                currentRotationY = targetRotationY;
                currentPositionX = targetPositionX;
                currentPositionY = targetPositionY;
                currentZoom = targetZoom;
                // One final render at exact position
                pivotGroup.rotation.y = currentRotationY;
                flipGroup.position.x = currentPositionX;
                flipGroup.position.y = currentPositionY;
                camera.position.z = currentZoom;
                if (!modelHidden) renderer.render(scene, camera);
                renderLoopActive = false;
                return;
            }

            needsRender = false;

            // On desktop, keep the floating bob going (continuous subtle motion)
            if (!isMobile && !prefersReducedMotion && !introComplete) {
                needsRender = true;
            }

            requestAnimationFrame(renderLoop);
        }

        // visibilitychange — stop rendering when tab is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopRenderLoop();
            } else {
                requestRender();
            }
        });

        // Easing function for smooth acceleration/deceleration
        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        // Keyframes for the animation journey
        // Content layout: Hero(left), TAD(right), Benefits(left), Compare(center), Doctors(center), CTA(center)
        // Model moves OPPOSITE to content for visual balance
        // Model is pre-rotated to stand upright, rotY spins it around vertical axis
        // Front face offset. Slow down at content sections by having less rotation change.
        const frontFace = Math.PI; // Rotate 180 to show front face (since model is flipped)

        // Desktop keyframes - model stays at comfortable distance, gentle side-to-side
        // Front face lands on even π multiples (2, 4, 6, 8) to align with content sections
        // Content: Hero(left), TAD(right), Benefits(left), Compare(center), Doctors(center), CTA(center)
        // Model sits OPPOSITE side of text for visual balance
        // Model begins its exit late in Benefits and is effectively gone by the time Doctors is on-screen
        // Desktop keyframes — adjusted for section heights (100+250+350+100+100+100vh)
        const desktopKeyframes = [
            // Hero (0 → 0.11): model right, front face
            { scroll: 0.00, x: 0.5,  y: 0,    zoom: 10.0, rotX: 0, rotY: frontFace,                  rotZ: 0 },
            { scroll: 0.072, x: 0.6,  y: 0,    zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 0.15, rotZ: 0 },
            // Transition to TAD
            { scroll: 0.126, x: 0,    y: 0.08, zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 1.0,  rotZ: 0 },
            // TAD (0.11 → 0.39): model left, slow spin through section
            { scroll: 0.18, x: -0.6, y: 0,    zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 2.0,  rotZ: 0 },
            { scroll: 0.288, x: -0.55,y: 0,    zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 2.5,  rotZ: 0 },
            // Transition to Benefits
            { scroll: 0.36, x: 0,    y: 0.08, zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 3.0,  rotZ: 0 },
            // Benefits (0.39 → 0.78): model right, very slow spin as bullets reveal
            { scroll: 0.432, x: 0.6,  y: 0,    zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 4.0,  rotZ: 0 },
            { scroll: 0.558, x: 0.55, y: 0,    zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 4.5,  rotZ: 0 },
            // Exit: model fades before Doctors
            { scroll: 0.648, x: -0.3, y: 0,    zoom: 12.0, rotX: 0, rotY: frontFace + Math.PI * 5.0,  rotZ: 0 },
            // Invisible from here
            { scroll: 0.82, x: -0.4, y: 0,    zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 6.0,  rotZ: 0 },
            { scroll: 0.892, x: 0,    y: 0,    zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 6.5,  rotZ: 0 },
            { scroll: 1.00, x: 0,    y: 0,    zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 7.0,  rotZ: 0 },
        ];

        // Mobile keyframes - model pushed to upper viewport, content scrolls below
        // y=2.0-2.2 positions model in top ~30% of screen
        // ROTATION STRATEGY: slow, continuous spin with variable speed
        //   - SLOW when model is visible between text sections (lingers on front face)
        //   - Gentle turn through back when text content is covering the model
        //   - easeInOutCubic naturally pauses at keyframe positions
        // Mobile keyframes — adjusted for pinned section heights
        // Slow, continuous spin — front face lingers between sections
        const mobileKeyframes = [
            // Hero (0 → 0.11): front face, gentle angle
            { scroll: 0.00, x: 0, y: 2.2,  zoom: 10.0, rotX: 0, rotY: frontFace,                   rotZ: 0 },
            { scroll: 0.054, x: 0, y: 2.15, zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 0.15,  rotZ: 0 },
            { scroll: 0.099, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 0.5,   rotZ: 0 },

            // TAD (0.11 → 0.39): slow spin through pinned section
            { scroll: 0.144, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 1.0,   rotZ: 0 },
            { scroll: 0.198, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 1.5,   rotZ: 0 },
            { scroll: 0.252, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 2.0,   rotZ: 0 },
            { scroll: 0.315, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 2.5,   rotZ: 0 },

            // Benefits (0.39 → 0.78): slow spin as bullets appear
            { scroll: 0.378, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 3.0,   rotZ: 0 },
            { scroll: 0.45, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 3.5,   rotZ: 0 },
            { scroll: 0.522, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 4.0,   rotZ: 0 },
            { scroll: 0.594, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 4.5,   rotZ: 0 },

            // Exit — fade out before Doctors
            { scroll: 0.648, x: 0, y: 2.0,  zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 5.0,   rotZ: 0 },
            { scroll: 0.802, x: 0, y: 2.0,  zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 5.5,   rotZ: 0 },
            // Faded out
            { scroll: 0.865, x: 0, y: 2.0,  zoom: 14.0, rotX: 0, rotY: frontFace + Math.PI * 6.0,   rotZ: 0 },
            { scroll: 1.00, x: 0, y: 2.0,  zoom: 14.0, rotX: 0, rotY: frontFace + Math.PI * 7.0,   rotZ: 0 },
        ];

        // Tablet keyframes — adjusted for pinned section heights
        const tabletKeyframes = [
            { scroll: 0.00, x: 0.3,   y: 0.2,  zoom: 10.0, rotX: 0, rotY: frontFace,                  rotZ: 0 },
            { scroll: 0.072, x: 0.4,   y: 0.2,  zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 0.15, rotZ: 0 },
            { scroll: 0.126, x: 0,     y: 0.25, zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 1.0,  rotZ: 0 },
            { scroll: 0.198, x: -0.4,  y: 0.2,  zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 2.0,  rotZ: 0 },
            { scroll: 0.288, x: -0.35, y: 0.2,  zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 2.5,  rotZ: 0 },
            { scroll: 0.36, x: 0,     y: 0.25, zoom: 10.0, rotX: 0, rotY: frontFace + Math.PI * 3.0,  rotZ: 0 },
            { scroll: 0.432, x: 0.4,   y: 0.2,  zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 4.0,  rotZ: 0 },
            { scroll: 0.558, x: 0.35,  y: 0.2,  zoom: 9.5,  rotX: 0, rotY: frontFace + Math.PI * 4.5,  rotZ: 0 },
            { scroll: 0.648, x: -0.2,  y: 0.2,  zoom: 12.0, rotX: 0, rotY: frontFace + Math.PI * 5.0,  rotZ: 0 },
            { scroll: 0.82, x: -0.3,  y: 0.2,  zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 6.0,  rotZ: 0 },
            { scroll: 0.892, x: 0,     y: 0.2,  zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 6.5,  rotZ: 0 },
            { scroll: 1.00, x: 0,     y: 0.2,  zoom: 13.0, rotX: 0, rotY: frontFace + Math.PI * 7.0,  rotZ: 0 },
        ];

        // Select keyframes based on device
        const keyframes = isMobile ? mobileKeyframes : isTablet ? tabletKeyframes : desktopKeyframes;

        // Interpolate between keyframes
        function getInterpolatedValues(progress) {
            // Find the two keyframes we're between
            let startFrame = keyframes[0];
            let endFrame = keyframes[keyframes.length - 1];

            for (let i = 0; i < keyframes.length - 1; i++) {
                if (progress >= keyframes[i].scroll && progress <= keyframes[i + 1].scroll) {
                    startFrame = keyframes[i];
                    endFrame = keyframes[i + 1];
                    break;
                }
            }

            // Calculate local progress between these two keyframes
            const range = endFrame.scroll - startFrame.scroll;
            const localProgress = range > 0 ? (progress - startFrame.scroll) / range : 0;
            const easedProgress = easeInOutCubic(localProgress);

            // Interpolate all values
            return {
                x: startFrame.x + (endFrame.x - startFrame.x) * easedProgress,
                y: startFrame.y + (endFrame.y - startFrame.y) * easedProgress,
                zoom: startFrame.zoom + (endFrame.zoom - startFrame.zoom) * easedProgress,
                rotX: startFrame.rotX + (endFrame.rotX - startFrame.rotX) * easedProgress,
                rotY: startFrame.rotY + (endFrame.rotY - startFrame.rotY) * easedProgress,
                rotZ: startFrame.rotZ + (endFrame.rotZ - startFrame.rotZ) * easedProgress,
            };
        }

        function centerAndScaleModel(object) {
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 2.2 / maxDim;
            object.position.sub(center);
            object.scale.multiplyScalar(scale);
            return object;
        }

        const loader = new GLTFLoader();
        loader.load(
            'object_0.glb',
            (gltf) => {
                model = gltf.scene;

                model.traverse((child) => {
                    if (child.isMesh && child.material) {
                        const mat = child.material;
                        const c = mat.color;

                        mat.envMap = envMap;

                        // Classify material by color to apply correct finish
                        const r = c.r, g = c.g, b = c.b;
                        const brightness = (r + g + b) / 3;
                        const isBlue = b > r * 1.3 && b > g * 1.1;
                        const isLight = brightness > 0.5;
                        const isDark = brightness < 0.25;

                        if (isBlue) {
                            // Blue anodized titanium screws/posts/caps
                            mat.color.setHex(0x1A3A5C);
                            mat.metalness = 0.85;
                            mat.roughness = 0.18;
                            mat.envMapIntensity = 1.8;
                        } else if (isLight) {
                            // Champagne silver frame/edges - brushed satin
                            mat.color.setHex(0xC0B8A8);
                            mat.metalness = 0.92;
                            mat.roughness = 0.28;
                            mat.envMapIntensity = 1.4;
                        } else if (isDark) {
                            // Dark gunmetal gray main body - matte satin
                            mat.color.setHex(0x4A4D52);
                            mat.metalness = 0.7;
                            mat.roughness = 0.42;
                            mat.envMapIntensity = 1.0;
                        } else {
                            // Mid-tone parts (zinc screws, etc.) - polished silver
                            mat.color.setHex(0x8A8D90);
                            mat.metalness = 0.88;
                            mat.roughness = 0.2;
                            mat.envMapIntensity = 1.5;
                        }

                        mat.needsUpdate = true;
                    }
                });
                centerAndScaleModel(model);
                modelGroup.add(model);
                modelGroup.rotation.x = -Math.PI * 0.5; // Stand upright
                document.getElementById('loading').classList.add('hidden');

                // prefers-reduced-motion: render single static frame, no animation
                if (prefersReducedMotion) {
                    // Set to front face, static position
                    const values = getInterpolatedValues(0);
                    currentRotationY = targetRotationY = values.rotY;
                    currentPositionX = targetPositionX = values.x;
                    currentPositionY = targetPositionY = values.y;
                    currentZoom = targetZoom = values.zoom;
                    pivotGroup.rotation.y = currentRotationY;
                    flipGroup.position.x = currentPositionX;
                    flipGroup.position.y = currentPositionY;
                    camera.position.z = currentZoom;
                    renderer.render(scene, camera);

                    // Show UI elements immediately
                    container.classList.add('loaded');
                    const navEl = document.getElementById('mainNav');
                    const heroEl = document.getElementById('heroPanel');
                    navEl.classList.remove('intro-hidden', 'intro-from-top');
                    navEl.classList.add('intro-visible');
                    heroEl.classList.remove('intro-hidden');
                    heroEl.classList.add('intro-visible', 'visible');
                    introComplete = true;

                    // Still respond to scroll for position updates (single frames)
                    updateScrollAnimation();
                    updatePanelsAndParallax();
                    updateScrollReveals();
                    return;
                }

                // Cinematic intro — slow, layered reveal
                const navEl = document.getElementById('mainNav');
                const heroEl = document.getElementById('heroPanel');

                // Initial render frame
                requestRender();

                // 1. Model begins slow fade-in + scale-up (300ms pause after loader)
                setTimeout(() => { container.classList.add('loaded'); requestRender(); }, 300);

                // 2. Nav glides down from top (1s — model is ~25% faded in)
                setTimeout(() => {
                    navEl.classList.remove('intro-hidden', 'intro-from-top');
                    navEl.classList.add('intro-visible');
                }, 1000);

                // 3. Hero content rises into place (1.6s — model is ~45% faded in)
                setTimeout(() => {
                    heroEl.classList.remove('intro-hidden');
                    heroEl.classList.add('intro-visible', 'visible');
                }, 1600);

                // 4. Scroll indicator (3.5s — everything else is settled)
                setTimeout(() => { scrollIndicator.classList.add('intro-ready'); }, 3500);

                // Intro animation: keep rendering during the 3.5s intro
                // After intro, on mobile stop the loop entirely
                const introRenderInterval = setInterval(() => requestRender(), 16);
                setTimeout(() => {
                    clearInterval(introRenderInterval);
                    introComplete = true;
                    // On mobile, stop loop after intro (only re-render on scroll)
                    if (isMobile) {
                        // Do one final render then stop
                        requestRender();
                    }
                }, 3500);

                // Initial scroll position + panel visibility + reveals
                updateScrollAnimation();
                updatePanelsAndParallax();
                updateScrollReveals();
            },
            (progress) => {
                if (progress.total > 0) {
                    const percent = (progress.loaded / progress.total * 100).toFixed(0);
                    document.querySelector('.loader-text').textContent = `Loading 3D Model ${percent}%`;
                }
            },
            (error) => {
                console.error('Error loading model:', error);
                document.getElementById('loading').classList.add('hidden');
            }
        );

        // Scroll-driven animation - position, zoom, and rotation
        function updateScrollAnimation() {
            const scrollY = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const scrollProgress = Math.min(Math.max(scrollY / docHeight, 0), 1);

            // Get interpolated values from keyframes
            const values = getInterpolatedValues(scrollProgress);

            // Set targets
            targetPositionX = values.x;
            targetPositionY = values.y;
            targetZoom = values.zoom;
            targetRotationY = values.rotY;

            // Hide scroll indicator after scrolling
            if (scrollY > 100) {
                scrollIndicator.classList.add('hidden');
            } else {
                scrollIndicator.classList.remove('hidden');
            }
        }

        // Scroll-driven panel visibility + parallax (non-pinned sections only)
        const doctorsSection = document.getElementById('doctors');
        let modelHidden = false;

        function updatePanelsAndParallax() {
            const viewH = window.innerHeight;

            // Panel visibility — only for non-pinned [data-animate] panels
            panels.forEach(panel => {
                const rect = panel.getBoundingClientRect();
                const inView = rect.top < viewH * 0.92 && rect.bottom > viewH * 0.08;
                const hasVisible = panel.classList.contains('visible');

                if (inView && !hasVisible) {
                    panel.classList.add('visible');
                } else if (!inView && hasVisible && (rect.top > viewH || rect.bottom < 0)) {
                    panel.classList.remove('visible');
                }
            });

            // Parallax — skip pinned sections (transform breaks position:sticky)
            sections.forEach(section => {
                if (section.classList.contains('section-pinned')) return;
                const rect = section.getBoundingClientRect();
                const offset = (rect.top + rect.height * 0.5 - viewH * 0.5) / viewH;
                section.style.transform = `translateY(${offset * -20}px) translateZ(0)`;
            });

            // Canvas fade — model exits before doctors section
            if (container.classList.contains('loaded') && doctorsSection) {
                const dTop = doctorsSection.getBoundingClientRect().top;
                const shouldExit = dTop < viewH * 0.4;
                const hasExit = container.classList.contains('exit');
                if (shouldExit && !hasExit) {
                    container.classList.add('exit');
                    setTimeout(() => {
                        modelHidden = true;
                        // Stop render loop when model is offscreen
                        if (renderLoopActive) stopRenderLoop();
                    }, 900);
                } else if (!shouldExit && hasExit) {
                    container.classList.remove('exit');
                    modelHidden = false;
                    requestRender();
                }
            }
        }

        // Scroll-driven reveals for pinned sections
        const pinnedSections = document.querySelectorAll('.section-pinned');
        function updateScrollReveals() {
            const viewH = window.innerHeight;

            pinnedSections.forEach(section => {
                const rect = section.getBoundingClientRect();
                const scrolledInto = -rect.top;
                const scrollRange = section.offsetHeight - viewH;
                if (scrollRange <= 0) return;
                const progress = Math.max(0, Math.min(1, scrolledInto / scrollRange));

                const items = section.querySelectorAll('[data-reveal]');
                const count = items.length;

                items.forEach((item, i) => {
                    const start = 0.05 + (i / count) * 0.75;
                    const end = start + 0.12;
                    const p = Math.max(0, Math.min(1, (progress - start) / (end - start)));

                    // easeOutCubic for smooth deceleration
                    const eased = 1 - Math.pow(1 - p, 3);

                    item.style.opacity = eased;
                    item.style.transform = `translateY(${(1 - eased) * 30}px)`;
                });
            });
        }

        // rAF-throttled scroll handler — triggers render on demand
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                requestAnimationFrame(() => {
                    updateScrollAnimation();
                    updatePanelsAndParallax();
                    updateScrollReveals();
                    requestRender(); // Trigger render on scroll
                    scrollTicking = false;
                });
                scrollTicking = true;
            }
        }, { passive: true });

        // Handle resize — debounced, triggers render
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.setPixelRatio(maxDPR);
                requestRender();
            }, 100);
        });

        // Orientation change — trigger render
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
                requestRender();
            }, 200);
        });
