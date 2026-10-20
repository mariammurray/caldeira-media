import gsap from 'gsap'
import copy from './copy.json'

const KNOBS = {
  turn: 0.85,
  flash: { opacity: 0.9, duration: 0.35 },
  leaderFade: 0.5,
  barsClose: 1.2,
  barsScale: 0.14,
  heroLine: { duration: 1.6, stagger: 0.14, delay: 0.5 },
  subFade: { duration: 1.4, delay: 0.8 },
  barsOpen: 1,
}

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const loaderEl = document.querySelector<HTMLElement>('#loader')

let counting: Promise<void> | null = null
let markLoaded: () => void = () => {}
const loaded = new Promise<void>((resolve) => { markLoaded = resolve })

const COUNT = { turn: KNOBS.turn, from: copy.CountdownNumbers }
const wait = (s: number) => new Promise<void>((resolve) => { gsap.delayedCall(s, resolve) })

async function countdown() {
  if (reduce || !loaderEl) return loaded
  const num = loaderEl.querySelector<HTMLElement>('.num')!
  const sweep = loaderEl.querySelector<HTMLElement>('.sweep')!
  // One continuous, linear rotation: no restarts, so no snapping between turns.
  const spin = gsap.to(sweep, { rotation: '+=360', duration: COUNT.turn, ease: 'none', repeat: -1 })
  for (const n of COUNT.from) {
    num.textContent = String(n)
    await wait(COUNT.turn)
  }
  await loaded
  spin.kill()
  await new Promise<void>((resolve) => {
    gsap.timeline({ onComplete: resolve })
        .set('#loader .flash', { opacity: KNOBS.flash.opacity })
        .to('#loader .flash', { opacity: 0, duration: KNOBS.flash.duration, ease: 'power2.out' })
  })
}

function intro(onComplete: () => void) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      loaderEl?.remove()
      document.documentElement.classList.remove('intro')
      onComplete()
      resolve()
    }
    document.body.classList.add('ready')
    if (reduce || !loaderEl) return finish()
    gsap.timeline({ onComplete: finish })
      .to('#loader .leader, #loader .cap', { opacity: 0, duration: KNOBS.leaderFade })
      .to('#loader .lb', { scaleY: KNOBS.barsScale, duration: KNOBS.barsClose, ease: 'power3.inOut' }, '>-0.1')
      .from('.hero .line > span', { yPercent: 110, duration: KNOBS.heroLine.duration, ease: 'power4.out', stagger: KNOBS.heroLine.stagger }, `<${KNOBS.heroLine.delay}`)
      .from('.sub', { opacity: 0, duration: KNOBS.subFade.duration }, `<${KNOBS.subFade.delay}`)
      .to('#loader .lb', { scaleY: 0, duration: KNOBS.barsOpen, ease: 'power3.inOut' }, '>-0.2')
  })
}

export function createOpeningScreen(onComplete: () => void) {
  const begin = () => (counting ??= countdown())
  return {
    begin,
    assetsReady: markLoaded,
    async finish() {
      await begin()
      await intro(onComplete)
    },
  }
}
