import type { Appearance } from './domain'

export const presets = {
  forest: { name: '松林绿', light: '#28563d', dark: '#b4d9bf', background: '#f5f6f4' },
  ocean: { name: '静海蓝', light: '#315d94', dark: '#a9c9ef', background: '#f2f5f9' },
  plum: { name: '暮色紫', light: '#705084', dark: '#d8b6ed', background: '#f7f3f9' },
  sand: { name: '暖沙棕', light: '#805738', dark: '#e7c29e', background: '#f8f4ee' },
}
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
function mix(a: string, b: string, t: number) {
  const x = rgb(a), y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
function luminance(hex: string) {
  return rgb(hex).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
}
function contrast(a: string, b: string) { return (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05) }
const readable = (color: string) => luminance(color) > .179 ? '#000000' : '#ffffff'
export function applyTheme(appearance: Appearance, systemDark: boolean) {
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && systemDark)
  const custom = appearance.preset === 'custom'
  const preset = presets[appearance.preset as keyof typeof presets] ?? presets.forest
  const accent = custom ? appearance.accent : dark ? preset.dark : preset.light
  const background = custom ? dark ? mix(appearance.background, '#111413', .88) : appearance.background : dark ? '#191c1a' : preset.background
  const ink = custom ? readable(background) : dark ? '#e5eee7' : '#202d26'
  const paper = custom ? mix(background, ink === '#000000' ? '#ffffff' : '#000000', .22) : dark ? '#242925' : '#ffffff'
  const soft = mix(accent, paper, .88)
  const onSoft = contrast(accent, soft) >= 4.5 ? accent : readable(soft)
  const root = document.documentElement
  root.style.colorScheme = dark ? 'dark' : 'light'
  for (const [name, value] of Object.entries({ background, ink, paper, soft, accent, onAccent: readable(accent), onSoft, muted: mix(ink, background, .22), line: mix(ink, paper, .86), danger: dark ? '#ffb4a1' : '#a63c2a' })) root.style.setProperty(`--${name}`, value)
  root.style.setProperty('--van-primary-color', accent)
  root.style.setProperty('--van-button-primary-color', readable(accent))
  root.style.setProperty('--van-popup-background', paper)
  root.style.setProperty('--van-dialog-background', paper)
  root.style.setProperty('--van-text-color', ink)
  root.style.setProperty('--van-background-2', paper)
  return { background, darkIcons: readable(background) === '#000000' }
}
