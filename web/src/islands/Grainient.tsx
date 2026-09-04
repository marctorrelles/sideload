// web/src/islands/Grainient.tsx: the animated grain gradient behind the landing hero.
// Shader from react-bits "Grainient" (Copyright (c) 2026 David Haz, MIT + Commons Clause; used as part of a website),
// ported to raw WebGL2 so it needs no dependency. Draws one triangle, pauses offscreen and in hidden tabs,
// renders a single still frame under prefers-reduced-motion, fades in once the first frame exists.
import { useEffect, useRef } from 'preact/hooks';
import { reduced } from '../lib/motion';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
const FRAG = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uLightMode;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);} 
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);} 
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);

  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;

  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);

  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));

  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);} 
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;

  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);
  if(uLightMode>0.5){
    float energy=max(max(col.r,col.g),col.b);
    vec3 hue=col/max(energy,0.001);
    float chroma=length(col-vec3(dot(col,vec3(0.333333))));
    float coverage=clamp(0.12+chroma*1.15+energy*0.18,0.0,0.88);
    col=mix(vec3(1.0),clamp(hue*0.58+col*0.18,0.0,1.0),coverage);
  }

  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`;

const U = {
  // uniform defaults from react-bits; colours are Sideload's
  uTimeSpeed: 0.25,
  uColorBalance: 0,
  uWarpStrength: 1,
  uWarpFrequency: 5,
  uWarpSpeed: 2,
  uWarpAmplitude: 50,
  uBlendAngle: 0,
  uBlendSoftness: 0.05,
  uRotationAmount: 500,
  uNoiseScale: 2,
  uGrainAmount: 0.1,
  uGrainScale: 2,
  uGrainAnimated: 0,
  uContrast: 1.5,
  uGamma: 1,
  uSaturation: 1,
  uZoom: 0.9,
  uLightMode: 0,
};
const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** centerY shifts the pattern vertically as a fraction of the height; positive moves the bright origin down. saturation 1 = the shader's default, lower is duller. */
export default function Grainient({
  color1 = '#0d0c0b',
  color2 = '#2a1409',
  color3 = '#8c4627',
  centerY = 0,
  saturation = 1,
}: {
  color1?: string;
  color2?: string;
  color3?: string;
  centerY?: number;
  saturation?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) {
      console.warn('grainient: no WebGL2, keeping the flat background');
      return;
    }
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('grainient: shader failed', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const loc = (n: string) => gl.getUniformLocation(prog, n);
    for (const [k, v] of Object.entries(U)) gl.uniform1f(loc(k), v);
    gl.uniform2f(loc('uCenterOffset'), 0, centerY);
    gl.uniform1f(loc('uSaturation'), saturation);
    // every visit starts somewhere else: a random point in the animation and a slightly different blend angle
    const tStart = Math.random() * 1000,
      angle = (Math.random() - 0.5) * 30;
    gl.uniform1f(loc('uBlendAngle'), angle);
    gl.uniform3f(loc('uColor1'), ...rgb(color1));
    gl.uniform3f(loc('uColor2'), ...rgb(color2));
    gl.uniform3f(loc('uColor3'), ...rgb(color3));
    const iTime = loc('iTime'),
      iRes = loc('iResolution');
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const draw = (t: number) => {
      gl.uniform1f(iTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const size = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)),
        h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(iRes, w, h);
      }
    };
    size();
    draw(tStart);
    canvas.classList.add('is-on');
    if (reduced()) {
      const ro = new ResizeObserver(() => {
        size();
        draw(tStart);
      });
      ro.observe(canvas);
      return () => ro.disconnect();
    }
    let raf = 0,
      seen = true,
      shown = !document.hidden;
    const t0 = performance.now();
    const loop = (now: number) => {
      size();
      draw(tStart + (now - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (seen && shown && !raf) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting;
      seen ? start() : stop();
    });
    io.observe(canvas);
    const vis = () => {
      shown = !document.hidden;
      shown ? start() : stop();
    };
    document.addEventListener('visibilitychange', vis);
    document.addEventListener('astro:before-swap', stop, { once: true }); // view transition leaves the page: no orphan loop
    start();
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [color1, color2, color3, centerY, saturation]);
  return <canvas ref={ref} class="grainient" aria-hidden="true" />;
}
