import './style.css'
import Lenis from 'lenis'
import gsap from 'gsap'
import { createOpeningScreen } from './opening'
import copy from './copy.json'

const KNOBS = {
  camera: {
    minZoom: 1.12,
    pathEase: 0.4,
    portraitZoomScale: 0.55,
    smoothing: 5,
    mouseSmoothing: 0.05,
    // Tune these alongside PEEL below: both control how quickly each layer passes.
    zoomRate: { haze: 1.1, mid: 1.35, front: 1.8 },
    peelPush: 0.3,
    mouseParallax: 0.004,
  },
  ambient: {
    hazeDrift: 0.005,
    seaSwell: { scale: [10, 240], speed: [0.04, 0.1], strength: 0.22, highlight: [0.62, 0.9], highlightStrength: 0.07 },
    seaGlints: { scale: [260, 146], cycle: [0.08, 0.1], pulsePower: 6, radius: 0.3, threshold: 0.72, strength: 0.45 },
    grassSway: 0.00105,
    grassSpeed: { primary: 1.1, cross: 0.6, detail: 2.3, vertical: 1.7 },
  },
  grade: {
    contrast: 0.3,
    scrimStrength: 0.4,
    fadeToInk: 0.6,
    // Keep this in sync with --ink in style.css.
    inkColour: [0.039, 0.082, 0.09],
    vignette: 1.4,
  },
  step: { duration: 1.5, quietMs: 140, swipe: 40, chainedSpeedup: 0.6 },
  reveal: { lineDuration: 1.3, lineStagger: 0.12, itemDuration: 1, itemDelay: 0.35, itemStagger: 0.12 },
}
const glslNumber = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value)

function copyText(key: string) {
  if (!Object.prototype.hasOwnProperty.call(copy, key)) throw new Error(`Missing copy key: ${key}`)
  const value = copy[key as keyof typeof copy]
  if (typeof value !== 'string') throw new Error(`Copy value must be a string: ${key}`)
  return value
}

document.title = copy.Title
document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content = copy.Description
document.querySelectorAll<HTMLElement>('[data-copy]').forEach((el) => { el.textContent = copyText(el.dataset.copy!) })
document.querySelectorAll<HTMLElement>('[data-copy-aria-label]').forEach((el) => {
  el.setAttribute('aria-label', copyText(el.dataset.copyAriaLabel!))
})
document.querySelectorAll<HTMLElement>('[data-section-copy]').forEach((el) => {
  el.dataset.name = copyText(el.dataset.sectionCopy!)
})
const contactEmail = document.querySelector<HTMLAnchorElement>('.mail')!
contactEmail.href = `mailto:${copy.ContactEmail}`

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!

const VERT = `attribute vec2 p; varying vec2 v;
void main(){ v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`

// Layers (back to front): base, haze, mid hill, front hill + grass.
// Each layer zooms about the camera focus at its own rate, so near layers sweep past
// and reveal the painted-in detail behind them.
const FRAG = `precision highp float;
varying vec2 v;
uniform sampler2D tBack, tHaze, tMid, tFront, tGrass, tSea;
uniform vec2 res, imgRes, mouse, focus;
uniform float scroll, time, motion, zoom, fadeF, fadeM;
float hash(vec2 q){   // sin-free hash: the sin version bands into diagonal lines on large inputs
  vec3 p3 = fract(vec3(q.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
void main(){
  // cover-fit
  vec2 c = v - .5; c.y = -c.y;
  float ca = res.x / res.y, ia = imgRes.x / imgRes.y;
  vec2 h = vec2(.5);
  if (ca > ia) { c.y *= ia / ca; h.y = .5 * ia / ca; } else { c.x *= ca / ia; h.x = .5 * ca / ia; }

  float zb = zoom - ${glslNumber(KNOBS.camera.minZoom)};
  vec2 f = clamp(focus, h / zoom + .01, 1. - h / zoom - .01);
  float zB = ${glslNumber(KNOBS.camera.minZoom)} + zb, zH = ${glslNumber(KNOBS.camera.minZoom)} + zb * ${glslNumber(KNOBS.camera.zoomRate.haze)}, zM = (${glslNumber(KNOBS.camera.minZoom)} + zb * ${glslNumber(KNOBS.camera.zoomRate.mid)}) * (1. + ${glslNumber(KNOBS.camera.peelPush)} * fadeM), zF = (${glslNumber(KNOBS.camera.minZoom)} + zb * ${glslNumber(KNOBS.camera.zoomRate.front)}) * (1. + ${glslNumber(KNOBS.camera.peelPush)} * fadeF);
  vec2 m = mouse * ${glslNumber(KNOBS.camera.mouseParallax)} * motion;
  vec2 uB = f + c / zB - m * .3;
  vec2 uH = f + c / zH - m * .6 + vec2(time * ${glslNumber(KNOBS.ambient.hazeDrift)}, 0.);   // content drifts left
  uH.x = fract(uH.x);                                       // haze texture is tileable, so it wraps
  vec2 uM = f + c / zM - m;
  vec2 uF = f + c / zF - m * 2.;

  vec3 col = texture2D(tBack, uB).rgb;

  // sea: slow swell bands, only where the sea mask says water
  float sea = texture2D(tSea, uB).r;
  float swell = vnoise(uB * vec2(${glslNumber(KNOBS.ambient.seaSwell.scale[0])}, ${glslNumber(KNOBS.ambient.seaSwell.scale[1])}) + vec2(time * ${glslNumber(KNOBS.ambient.seaSwell.speed[0])}, time * ${glslNumber(KNOBS.ambient.seaSwell.speed[1])}));   // long, thin horizontal bands
  col *= 1. + (swell - .5) * ${glslNumber(KNOBS.ambient.seaSwell.strength)} * sea * motion;
  col += vec3(.3, .45, .6) * smoothstep(${glslNumber(KNOBS.ambient.seaSwell.highlight[0])}, ${glslNumber(KNOBS.ambient.seaSwell.highlight[1])}, swell) * sea * ${glslNumber(KNOBS.ambient.seaSwell.highlightStrength)} * motion;

  // sea glints: each grid cell holds one soft point that swells and fades on its own slow cycle
  vec2 gp = uB * vec2(${glslNumber(KNOBS.ambient.seaGlints.scale[0])}, ${glslNumber(KNOBS.ambient.seaGlints.scale[1])}), gc = floor(gp);
  float gr = hash(gc), gs = hash(gc + 19.);
  float cyc = fract(time * (${glslNumber(KNOBS.ambient.seaGlints.cycle[0])} + ${glslNumber(KNOBS.ambient.seaGlints.cycle[1])} * gs) + gr);
  float pulse = pow(sin(cyc * 3.14159), ${glslNumber(KNOBS.ambient.seaGlints.pulsePower)});                                  // soft in, soft out
  float gd = length(fract(gp) - (.25 + .5 * vec2(gr, gs)));
  float glint = smoothstep(${glslNumber(KNOBS.ambient.seaGlints.radius)}, 0., gd) * pulse * step(${glslNumber(KNOBS.ambient.seaGlints.threshold)}, gs);              // only a fraction of cells ever glint
  col += vec3(.75, .88, 1.) * glint * sea * ${glslNumber(KNOBS.ambient.seaGlints.strength)} * motion;

  // haze layer drifts left and loops
  vec4 hz = texture2D(tHaze, uH);
  const float hazeSeam = .08;
  vec4 hazeStart = texture2D(tHaze, vec2(1. - uH.x, uH.y));
  hz = mix(hz, hazeStart, smoothstep(1. - hazeSeam, 1., uH.x));
  col = col * (1. - hz.a) + hz.rgb;

  vec4 ml = texture2D(tMid, uM);
  ml *= 1. - fadeM;
  col = col * (1. - ml.a) + ml.rgb;

  // foreground: grass sways inside the mask, a pixel or two at most
  float gm = texture2D(tGrass, uF).r;
  vec2 sway = vec2(sin(c.x * 16. + time * ${glslNumber(KNOBS.ambient.grassSpeed.primary)}) * cos(c.y * 7. + time * ${glslNumber(KNOBS.ambient.grassSpeed.cross)}) + .35 * sin(c.x * 110. + c.y * 50. + time * ${glslNumber(KNOBS.ambient.grassSpeed.detail)}),
                   .4 * sin(c.x * 60. + time * ${glslNumber(KNOBS.ambient.grassSpeed.vertical)}));
  vec4 fl = texture2D(tFront, uF + sway * gm * ${glslNumber(KNOBS.ambient.grassSway)} * motion / zF);
  fl *= 1. - fadeF;
  col = col * (1. - fl.a) + fl.rgb;

  // grade, scrim, fade to ink as text arrives, vignette
  col = mix(col, col * col * (3. - 2. * col), ${glslNumber(KNOBS.grade.contrast)});
  float dim = smoothstep(.15, .5, scroll) * ${glslNumber(KNOBS.grade.fadeToInk)};
  col *= 1. - ${glslNumber(KNOBS.grade.scrimStrength)} * (1. - smoothstep(0., .5, v.y)) * (1. - dim);
  col = mix(col, vec3(${KNOBS.grade.inkColour.map(glslNumber).join(', ')}), dim);
  col *= mix(.7, 1., 1. - smoothstep(.25, 1.1, length(v - .5) * ${glslNumber(KNOBS.grade.vignette)}));
  gl_FragColor = vec4(col, 1.);
}`

const load = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => fail(new Error(`Could not load ${src}`))
    i.src = src
  })

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader failed')
  return s
}

function upload(gl: WebGLRenderingContext, unit: number, img: HTMLImageElement) {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
}

type Key = { x: number; y: number; z: number; arc?: number }
const FALLBACK: Key[] = [{ x: .5, y: .5, z: KNOBS.camera.minZoom }, { x: .5, y: .51, z: 1.5 }, { x: .49, y: .52, z: 2 }]
const readPath = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<Key[]>).then((p) => (Array.isArray(p) && p.length >= 2 ? p : null)).catch(() => null)
// Portrait screens see a narrow strip of the 16:9 art, so by default the same path is used with a gentler zoom.
async function loadPaths() {
  const land = (await readPath(`${import.meta.env.BASE_URL}path.json`)) ?? FALLBACK
  const paths = { land, port: land.map((k) => ({ ...k, z: KNOBS.camera.minZoom + (k.z - KNOBS.camera.minZoom) * KNOBS.camera.portraitZoomScale })) }
  return paths
}

const fetchImage = (src: string) => load(src)

// Catmull-Rom through the waypoints, evenly spaced over the scroll
// Straight, eased moves between waypoints (evenly spaced over the scroll).
// `arc` on a waypoint bows the move into it vertically: negative rises, then settles back to the waypoint.
function camAt(path: Key[], t: number): Key {
  const n = path.length - 1
  const s = Math.min(Math.max(t, 0), 1) * n
  const i = Math.min(Math.floor(s), n - 1), u = s - i
  const w = u + (u * u * (3 - 2 * u) - u) * KNOBS.camera.pathEase
  const a = path[i], b = path[i + 1]
  const L = (k: 'x' | 'y' | 'z') => a[k] + (b[k] - a[k]) * w
  return { x: L('x'), y: L('y') + (b.arc ?? 0) * Math.sin(Math.PI * u), z: L('z') }
}

// Layers that peel away, by waypoint number (1-based): [still there at, gone by].
// The layer fades while pushing toward the camera, so it reads as passing it.
const PEEL: Record<'front' | 'mid', [number, number]> = { front: [2, 3], mid: [3, 4] }
function peel(path: Key[], t: number, [a, b]: [number, number]) {
  const n = path.length - 1
  const x = Math.min(Math.max((t * n - (a - 1)) / (Math.min(b, n + 1) - a), 0), 1)
  return x * x * (3 - 2 * x)
}

// Stepped scroll: the page rests only on fixed stops (each section top, then the footer).
// A wheel flick, swipe or key press glides to the next/previous stop; nothing rests in between.
const lenis = reduce ? null : new Lenis({ autoRaf: false })
gsap.ticker.lagSmoothing(0)
gsap.ticker.add((t) => lenis?.raf(t * 1000))

// Each section is one camera waypoint: progress 0..1 runs from the first section's top to the last one's.
const sections = Array.from(document.querySelectorAll<HTMLElement>('main > section'))
const tops = () => sections.map((s) => s.offsetTop)
const progress = () => {
  const t = tops()
  return Math.min(Math.max(scrollY / Math.max(t[t.length - 1], 1), 0), 1)
}
let target = progress()

const STEP = KNOBS.step
const ease = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const stops = () => {
  const t = tops(), max = document.documentElement.scrollHeight - innerHeight
  return max > t[t.length - 1] + 1 ? [...t, max] : t
}
let stepped = false
let introDone = false
let index = 0
let busy = false
let stepId = 0
let lastWheel = 0
let lastDelta = 0
let lastStep = 0
const opening = createOpeningScreen(() => {
  introDone = true
  applyMode()
})

function go(i: number) {
  if (!lenis || !stepped || !introDone) return
  const st = stops()
  i = Math.min(Math.max(i, 0), st.length - 1)
  if (i === index) return
  // Steps can be chained while a glide is running: retarget from the current position.
  const chained = busy
  // Hide sections that are neither the one being left nor the destination, so a revisit always starts clean.
  if (revealing()) groups.forEach((g, j) => { if (j !== i && j !== index) hide(g) })
  index = i
  sections[0].classList.toggle('banner-hidden', index !== 0)
  busy = true
  const mine = ++stepId
  lenis.scrollTo(st[i], {
    force: true, duration: chained ? STEP.duration * STEP.chainedSpeedup : STEP.duration, easing: chained ? (x: number) => 1 - (1 - x) ** 3 : ease,
    onComplete: () => { if (mine !== stepId) return; busy = false; arrive(index) },
  })
}
// Choreographed arrivals: each section's text is hidden until the camera lands on its stop.
// Lines are masked and rise; list rows and the mail link fade up. Only active in stepped mode.
type Group = { lines: Element[]; items: Element[] }
let groups: Group[] = []
function splitLines(el: HTMLElement) {
  const text = (el.dataset.text ??= el.textContent!.trim())
  el.textContent = ''
  const accessibleText = document.createElement('span')
  accessibleText.className = 'sr-only'
  accessibleText.textContent = text
  el.append(accessibleText)
  const words = text.split(/\s+/).map((w) => {
    const sp = document.createElement('span')
    sp.style.display = 'inline-block'
    sp.textContent = w
    el.append(sp, ' ')
    return sp
  })
  const rows: string[][] = []
  let top = NaN
  for (const w of words) {
    if (w.offsetTop !== top) { rows.push([]); top = w.offsetTop }
    rows[rows.length - 1].push(w.textContent!)
  }
  words.forEach((word) => word.remove())
  return rows.map((r) => {
    const line = document.createElement('span'), inner = document.createElement('span')
    line.className = 'line'
    line.setAttribute('aria-hidden', 'true')
    inner.textContent = r.join(' ')
    line.append(inner)
    el.append(line)
    return inner
  })
}
function buildReveals() {
  groups = [...sections, document.querySelector<HTMLElement>('footer')!].map((root, i) => i === 0
    ? { lines: [], items: [] }
    : {
      lines: Array.from(root.querySelectorAll<HTMLElement>('.big, h2, .wordmark')).flatMap(splitLines),
      items: Array.from(root.querySelectorAll('li, .mail')),
    })
}
const revealing = () => stepped && !reduce
const hide = (g: Group) => {
  gsap.killTweensOf([...g.lines, ...g.items]) // a still-running reveal would otherwise keep animating the text back in
  if (g.lines.length) gsap.set(g.lines, { yPercent: 110 }); if (g.items.length) gsap.set(g.items, { opacity: 0, y: 24 })
}
function show(g: Group) {
  if (!g.lines.length && !g.items.length) return
  if (g.lines.length) gsap.to(g.lines, { yPercent: 0, duration: KNOBS.reveal.lineDuration, ease: 'power4.out', stagger: KNOBS.reveal.lineStagger, overwrite: true })
  if (g.items.length) gsap.to(g.items, { opacity: 1, y: 0, duration: KNOBS.reveal.itemDuration, ease: 'power3.out', stagger: KNOBS.reveal.itemStagger, delay: KNOBS.reveal.itemDelay, overwrite: true })
}
function arrive(i: number) {
  if (!revealing() || !groups.length) return
  groups.forEach((g, j) => { if (j !== i) hide(g) })
  show(groups[i])
}
function syncReveals() {
  groups.forEach((g, i) => {
    if (!revealing()) { if (g.lines.length || g.items.length) gsap.set([...g.lines, ...g.items], { clearProps: 'transform,opacity' }) }
    else if (!introDone || i !== index) hide(g)
  })
  if (revealing() && introDone && groups[index]) show(groups[index])
}

// Section index: "01 / 04" plus named, clickable stops.
const indexNav = document.querySelector<HTMLElement>('.index')!
const indexBtns = sections.map((sec, i) => {
  const li = document.createElement('li'), b = document.createElement('button')
  b.type = 'button'
  b.innerHTML = `<i>${String(i + 1).padStart(2, '0')}</i><span></span>`
  b.lastElementChild!.textContent = sec.dataset.name ?? ''
  b.addEventListener('click', () => jump(i))
  li.append(b)
  indexNav.querySelector('ol')!.append(li)
  return b
})
function setActive() {
  const i = Math.min(nearest(), sections.length - 1)
  indexBtns.forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')))
  indexNav.querySelector('.of')!.textContent = `${String(i + 1).padStart(2, '0')} / ${String(sections.length).padStart(2, '0')}`
}
function jump(i: number) {
  if (stepped) go(i)
  else if (lenis) lenis.scrollTo(tops()[i])
  else scrollTo({ top: tops()[i], behavior: 'smooth' })
}

const nearest = () => {
  const st = stops()
  return st.reduce((a, b, i) => (Math.abs(b - scrollY) < Math.abs(st[a] - scrollY) ? i : a), 0)
}
// Stepping is off for reduced motion and when a section is taller than the screen.
function applyMode() {
  if (!lenis) return
  stepped = sections.every((s) => s.offsetHeight <= innerHeight * 1.15)
  if (stepped) { index = nearest(); lenis.stop(); lenis.scrollTo(stops()[index], { immediate: true, force: true }) }
  else if (introDone) lenis.start()
  else lenis.stop()
  sections[0].classList.toggle('banner-hidden', index !== 0)
  syncReveals()
  setActive()
}
// ignore the tail of a trackpad flick: a new step needs a brief pause in wheel events
addEventListener('wheel', (e) => {
  if (!stepped) return
  e.preventDefault()
  const now = performance.now()
  const d = Math.abs(e.deltaY)
  // a new gesture: after a pause, or a wheel tick growing after momentum has decayed
  const fresh = d > 2 && now - lastStep > 250 && (now - lastWheel > STEP.quietMs || d > lastDelta * 1.5 + 4)
  lastWheel = now
  lastDelta = d
  if (fresh) { lastStep = now; go(index + Math.sign(e.deltaY)) }
}, { passive: false })
// Tabbing to an off-screen control: glide to its section instead of letting the browser jump.
addEventListener('focusin', (e) => {
  if (!stepped || !introDone) return
  const sec = (e.target as Element).closest('main > section, footer')
  const i = sec ? (sec === document.querySelector('footer') ? stops().length - 1 : sections.indexOf(sec as HTMLElement)) : -1
  if (i >= 0 && i !== index) go(i)
  else if (!busy && scrollY !== stops()[index]) lenis?.scrollTo(stops()[index], { immediate: true, force: true })
})
addEventListener('keydown', (e) => {
  if (!stepped || e.metaKey || e.ctrlKey || e.altKey) return
  const k = e.key
  const d = k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey) ? 1
    : k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey) ? -1 : 0
  if (d) { e.preventDefault(); go(index + d) }
  else if (k === 'Home') { e.preventDefault(); go(0) }
  else if (k === 'End') { e.preventDefault(); go(stops().length - 1) }
})
let touchY = 0
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY }, { passive: true })
addEventListener('touchmove', (e) => { if (stepped) e.preventDefault() }, { passive: false })
addEventListener('touchend', (e) => {
  const dy = touchY - e.changedTouches[0].clientY
  if (Math.abs(dy) > STEP.swipe) go(index + Math.sign(dy))
}, { passive: true })
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
  const dest = a && a.hash.length > 1 ? document.querySelector<HTMLElement>(a.hash) : null
  if (!dest || !stepped) return
  e.preventDefault()
  const i = tops().findIndex((y) => y >= dest.offsetTop - 1)
  if (i >= 0) go(i)
})
addEventListener('scroll', () => { target = progress(); setActive() }, { passive: true })
let lastW = innerWidth
addEventListener('resize', () => {
  target = progress()
  if (innerWidth !== lastW) { lastW = innerWidth; buildReveals() } // mobile toolbars resize height only
  applyMode()
})
document.fonts.ready.then(() => { buildReveals(); syncReveals() })
buildReveals()
applyMode()

function fallback() {
  document.body.classList.add('no-gl')
  opening.begin()
  opening.assetsReady()
  void opening.finish()
}

async function start() {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
  if (!gl) return fallback()
  try {
    opening.begin()
    const img = (src: string) => fetchImage(src)
    const [back, haze, mid, front, grass, sea, paths] = await Promise.all([
      img(`${import.meta.env.BASE_URL}layers/base.webp`), img(`${import.meta.env.BASE_URL}layers/haze.webp`), img(`${import.meta.env.BASE_URL}layers/mid.webp`),
      img(`${import.meta.env.BASE_URL}layers/front.webp`), img(`${import.meta.env.BASE_URL}layers/grass-mask.webp`), img(`${import.meta.env.BASE_URL}layers/sea-mask.webp`),
      loadPaths(),
    ])

    let prog: WebGLProgram
    const u = (n: string) => gl.getUniformLocation(prog, n)
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2)
      canvas.width = Math.round(innerWidth * dpr)
      canvas.height = Math.round(innerHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(u('res'), canvas.width, canvas.height)
    }
    // Everything GPU-side lives here so it can be rebuilt after a lost context (phone tab switch, GPU reset).
    const init = () => {
      prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      gl.useProgram(prog)

      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, 'p')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true) // avoids pale fringes on soft edges
      const samplers: [string, HTMLImageElement][] = [
        ['tBack', back], ['tHaze', haze], ['tMid', mid], ['tFront', front], ['tGrass', grass], ['tSea', sea],
      ]
      samplers.forEach(([name, im], i) => {
        upload(gl, i, im)
        gl.uniform1i(u(name), i)
      })
      gl.uniform2f(u('imgRes'), back.naturalWidth, back.naturalHeight)
      gl.uniform1f(u('motion'), reduce ? 0 : 1)
      resize()
    }
    init()
    addEventListener('resize', resize)
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault()) // allows the restore event
    canvas.addEventListener('webglcontextrestored', init)

    const m = { x: 0, y: 0, tx: 0, ty: 0 }
    addEventListener('pointermove', (e) => {
      m.tx = (e.clientX / innerWidth) * 2 - 1
      m.ty = (e.clientY / innerHeight) * 2 - 1
    })

    let cur = target
    const draw = (t: number, dt: number) => {
      if (gl.isContextLost()) return
      // until the intro ends, track the scroll exactly so a reload mid-page doesn't swoop in from the start
      cur = introDone ? cur + (target - cur) * (reduce ? 1 : 1 - Math.exp(-Math.min(dt, 100) / 1000 * KNOBS.camera.smoothing)) : target
      m.x += (m.tx - m.x) * KNOBS.camera.mouseSmoothing
      m.y += (m.ty - m.y) * KNOBS.camera.mouseSmoothing
      const path = innerWidth < innerHeight ? paths.port : paths.land
      gl.uniform1f(u('scroll'), cur)
      const cam = camAt(path, cur)
      gl.uniform2f(u('focus'), cam.x, cam.y)
      gl.uniform1f(u('zoom'), Math.max(cam.z, KNOBS.camera.minZoom))
      gl.uniform1f(u('fadeF'), peel(path, cur, PEEL.front))
      gl.uniform1f(u('fadeM'), peel(path, cur, PEEL.mid))
      gl.uniform1f(u('time'), reduce ? 0 : t)
      gl.uniform2f(u('mouse'), m.x, m.y)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    draw(0, 16) // first frame (and texture upload) happens behind the loader
    gsap.ticker.add((t, dt) => draw(t, dt))
    opening.assetsReady()
    await opening.finish()
  } catch (err) {
    console.error(err)
    fallback()
  }
}

start()
