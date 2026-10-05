/* =====================================================================
   EDOLUS — GLSL shader library
   Earth (day/night terminator + city lights), atmosphere fresnel glow,
   procedural cloud shell, particle constellation, bloom post pass.
   ===================================================================== */

/* ---------------------------------------------------------------------
   EARTH SURFACE
   Day/night blend across the terminator with warm city lights on the
   dark hemisphere and a subtle atmospheric rim.
--------------------------------------------------------------------- */
export const earthVert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const earthFrag = /* glsl */`
  precision highp float;

  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3  uSunDirection;
  uniform vec3  uAtmosphere;
  uniform float uTime;
  uniform float uNightBoost;
  uniform vec3  uCameraPos;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 sunDir = normalize(uSunDirection);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);

    vec3 dayColor   = texture2D(uDay, vUv).rgb;
    vec3 nightColor = texture2D(uNight, vUv).rgb;

    float sunAmount = dot(normal, sunDir);
    // Wide, soft terminator band
    float dayMix = smoothstep(-0.18, 0.28, sunAmount);

    // Night side: boost city lights (night map is mostly dark land)
    vec3 lights = nightColor * uNightBoost;
    lights += pow(max(nightColor.r - 0.02, 0.0), 1.6) * 0.6 * vec3(1.0, 0.82, 0.55);

    vec3 base = mix(lights, dayColor * (0.35 + 0.85 * max(sunAmount, 0.0)), dayMix);

    // Diffuse shading on the lit hemisphere
    float diff = max(sunAmount, 0.0);
    base *= mix(1.0, 0.55 + 0.75 * diff, dayMix);

    // Specular highlight on water (cheap: use blue channel dominance)
    vec3 halfDir = normalize(sunDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 42.0);
    float waterMask = smoothstep(0.16, 0.4, dayColor.b - dayColor.r);
    base += spec * waterMask * 0.35 * dayMix;

    // Atmospheric rim (fresnel)
    float fres = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.2);
    base += uAtmosphere * fres * (0.35 + 0.65 * max(sunAmount + 0.25, 0.0));

    // Gentle animated cloud sheen (procedural, cheap)
    float clouds = sin(vUv.x * 42.0 + uTime * 0.05) * sin(vUv.y * 30.0 - uTime * 0.04);
    base += smoothstep(0.75, 1.0, clouds) * 0.05 * dayMix;

    gl_FragColor = vec4(base, 1.0);
  }
`;

/* ---------------------------------------------------------------------
   ATMOSPHERE GLOW
   Rendered on a slightly larger BackSide sphere, additive.
   Fresnel-driven halo that also scatters toward the sun.
--------------------------------------------------------------------- */
export const atmosphereVert = /* glsl */`
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const atmosphereFrag = /* glsl */`
  precision highp float;
  uniform vec3  uColor;
  uniform vec3  uSunDirection;
  uniform vec3  uCameraPos;
  uniform float uIntensity;
  uniform float uPower;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);

    // Edge-on view = maximum scattering
    float fres = pow(1.0 - abs(dot(normal, viewDir)), uPower);

    // Sun-facing scattering (brighter toward the lit limb)
    vec3 sunDir = normalize(uSunDirection);
    float sun = max(dot(normal, sunDir), 0.0);
    float scatter = pow(sun, 1.4) * 0.9 + 0.1;

    float alpha = fres * uIntensity * scatter;
    gl_FragColor = vec4(uColor * (0.6 + 0.9 * sun), alpha);
  }
`;

/* ---------------------------------------------------------------------
   CLOUD SHELL
   Procedural fbm alpha on a larger sphere, slowly rotating UVs.
--------------------------------------------------------------------- */
export const cloudVert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const cloudFrag = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3  uSunDirection;
  uniform vec3  uCameraPos;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv * vec2(3.2, 1.6);
    uv.x += uTime * 0.008;
    float n = fbm(uv * 2.2 + vec2(uTime * 0.01, 0.0));
    float n2 = fbm(uv * 4.4 - vec2(0.0, uTime * 0.006));
    float density = smoothstep(0.52, 0.86, n * 0.7 + n2 * 0.3);

    vec3 normal = normalize(vWorldNormal);
    vec3 sunDir = normalize(uSunDirection);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float light = max(dot(normal, sunDir), 0.0);
    float fres = pow(1.0 - abs(dot(normal, viewDir)), 2.0);

    float alpha = density * uOpacity * (0.25 + 0.9 * light) * (0.35 + fres);
    vec3 col = mix(vec3(0.35, 0.45, 0.65), vec3(1.0), light);
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ---------------------------------------------------------------------
   PARTICLE CONSTELLATION
   Twinkling points with per-point size and colour.
--------------------------------------------------------------------- */
export const particleVert = /* glsl */`
  attribute float aSize;
  attribute float aPhase;
  attribute vec3  aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  varying vec3  vColor;
  varying float vTwinkle;

  void main() {
    vColor = aColor;
    float tw = 0.55 + 0.45 * sin(uTime * (1.2 + aPhase * 2.0) + aPhase * 12.0);
    vTwinkle = tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uSizeScale * uPixelRatio * (300.0 / -mv.z) * (0.7 + 0.6 * tw);
    gl_Position = projectionMatrix * mv;
  }
`;

export const particleFrag = /* glsl */`
  precision highp float;
  varying vec3  vColor;
  varying float vTwinkle;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(vColor * (0.6 + vTwinkle), a * vTwinkle);
  }
`;

/* ---------------------------------------------------------------------
   ORBITAL DATA ARC (node-to-node transmission line)
--------------------------------------------------------------------- */
export const arcVert = /* glsl */`
  attribute float aProgress;
  uniform float uTime;
  varying float vProgress;
  void main() {
    vProgress = aProgress;
    vec3 p = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const arcFrag = /* glsl */`
  precision highp float;
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying float vProgress;
  void main() {
    float pulse = fract(vProgress - uTime * 0.12);
    float head = smoothstep(0.0, 0.06, pulse) * smoothstep(0.24, 0.1, pulse);
    float base = 0.12;
    float a = (base + head * 1.4) * uOpacity;
    gl_FragColor = vec4(uColor * (0.6 + head * 2.2), a);
  }
`;

/* ---------------------------------------------------------------------
   POST-PROCESSING: bright pass + separable blur + composite
   (custom bloom so we do not depend on three/examples addons)
--------------------------------------------------------------------- */
export const fullscreenVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const brightPassFrag = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float f = smoothstep(uThreshold, uThreshold + 0.35, lum);
    gl_FragColor = vec4(c.rgb * f, 1.0);
  }
`;

export const blurFrag = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2  uDirection;   // texel-scaled direction
  varying vec2 vUv;
  void main() {
    // 9-tap Gaussian
    float w[5];
    w[0] = 0.2270270270; w[1] = 0.1945945946; w[2] = 0.1216216216;
    w[3] = 0.0540540541; w[4] = 0.0162162162;
    vec4 sum = texture2D(tDiffuse, vUv) * w[0];
    for (int i = 1; i < 5; i++) {
      vec2 off = uDirection * float(i);
      sum += texture2D(tDiffuse, vUv + off) * w[i];
      sum += texture2D(tDiffuse, vUv - off) * w[i];
    }
    gl_FragColor = sum;
  }
`;

export const compositeFrag = /* glsl */`
  precision highp float;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uBloomStrength;
  uniform float uTime;
  uniform float uVignette;
  uniform float uGrain;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 scene = texture2D(tScene, vUv).rgb;
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    vec3 col = scene + bloom * uBloomStrength;

    // Filmic-ish tone curve
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.4545));

    // Vignette
    vec2 q = vUv - 0.5;
    float vig = smoothstep(0.85, 0.25, length(q));
    col *= mix(1.0, vig, uVignette);

    // Animated grain
    float g = hash(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
    col += g * uGrain;

    gl_FragColor = vec4(col, 1.0);
  }
`;
