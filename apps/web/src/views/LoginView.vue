<script setup lang="ts">
/** Staff sign-in. Split screen on desktop (brand story on the left, form on the right); a single column with a compact
 *  brand header on phones. Theme and design-token aware: light and dark come from data-theme, surfaces from tokens.
 *  Depends on: session store (login), roles (landing screen), brand mark. */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useBrandMark } from '@/lib/use-brand-mark'
import { useSession } from '@/stores/session'
import { DEFAULT_SCREEN } from '@/lib/roles'

const REMEMBERED_EMAIL_KEY = 'beverly.call.remembered_email'
const FEATURES = [
  { icon: 'phone', title: 'Live call pipeline', text: 'Every caller, queue and agent in real time.' },
  { icon: 'user', title: 'Customer context', text: 'Account, meters, tariff and wallet on one screen.' },
  { icon: 'lock', title: 'Audited by design', text: 'Every sensitive action is logged and tamper-evident.' },
] as const

const session = useSession()
const router = useRouter()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberEmail = ref(true)
const capsOn = ref(false)
const error = ref('')
const busy = ref(false)
const mark = useBrandMark()
const markOnDark = useBrandMark(true)

function remember(address: string): void {
  try { if (rememberEmail.value) localStorage.setItem(REMEMBERED_EMAIL_KEY, address); else localStorage.removeItem(REMEMBERED_EMAIL_KEY) } catch { /* storage blocked */ }
}
const trackCaps = (e: KeyboardEvent): void => { capsOn.value = e.getModifierState?.('CapsLock') ?? false }

async function submit(): Promise<void> {
  const address = email.value.trim().toLowerCase()
  if (!address || !password.value) { error.value = 'Email and password are required.'; return }
  error.value = ''
  busy.value = true
  try {
    await session.login(address, password.value)
    remember(address)
    if (session.user) await router.replace(`/${DEFAULT_SCREEN[session.user.role]}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Sign-in failed.'
  } finally {
    password.value = ''
    busy.value = false
  }
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(REMEMBERED_EMAIL_KEY)
    if (saved) email.value = saved
    rememberEmail.value = Boolean(saved)
  } catch { /* storage blocked */ }
})
</script>

<template>
  <main class="auth">
    <!-- Brand side: desktop only -->
    <aside class="auth-brand" aria-hidden="false">
      <div class="auth-glow g1" aria-hidden="true"></div>
      <div class="auth-glow g2" aria-hidden="true"></div>
      <div class="auth-grid" aria-hidden="true"></div>
      <div class="auth-brand-top">
        <img :src="markOnDark" alt="" width="46" height="52" class="auth-logo" />
        <span class="auth-name">Beverly Call</span>
      </div>
      <div class="auth-story">
        <h2>Every call, answered with the full picture.</h2>
        <p>The call centre workspace for Beverly staff: take calls, resolve escalations and watch the whole desk in one place.</p>
        <ul class="auth-features">
          <li v-for="f in FEATURES" :key="f.title"><span class="auth-fi"><Icon :name="f.icon" /></span><span><b>{{ f.title }}</b><small>{{ f.text }}</small></span></li>
        </ul>
      </div>
      <p class="auth-brand-foot">Your Smart Power Partner.</p>
    </aside>

    <!-- Form side -->
    <div class="auth-side">
      <div class="auth-aura" aria-hidden="true"></div>
      <section class="auth-form" aria-labelledby="login-title">
        <div class="auth-mobile-brand">
          <img :src="mark" alt="" width="42" height="48" class="auth-logo" />
          <span class="auth-name">Beverly Call</span>
        </div>
        <header class="auth-head">
          <h1 id="login-title">Welcome back</h1>
          <p>Sign in with your Beverly staff account.</p>
        </header>

        <form class="auth-fields" :aria-busy="busy" @submit.prevent="submit">
          <div class="fl">
            <label for="auth-email">Email</label>
            <span class="auth-input"><Icon name="mail" /><input id="auth-email" v-model.trim="email" type="email" autocomplete="username" inputmode="email" placeholder="staff@acoblighting.com" required @input="error = ''" /></span>
          </div>
          <div class="fl">
            <label for="auth-password">Password</label>
            <span class="auth-input">
              <Icon name="lock" />
              <input id="auth-password" v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Your password" required @input="error = ''" @keyup="trackCaps" @keydown="trackCaps" @blur="capsOn = false" />
              <button type="button" class="auth-toggle" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? 'Hide' : 'Show' }}</button>
            </span>
            <small v-if="capsOn" class="auth-caps" role="status">Caps Lock is on</small>
          </div>
          <label class="auth-check"><input v-model="rememberEmail" type="checkbox" />Remember my email on this device</label>
          <div v-if="error" class="ban auth-error" role="alert">{{ error }}</div>
          <button class="y auth-submit" type="submit" :disabled="busy || !email || !password"><span v-if="busy" class="auth-spin" aria-hidden="true"></span>{{ busy ? 'Signing in…' : 'Sign in' }}</button>
        </form>

        <p class="auth-foot"><Icon name="lock" />Access is restricted to Beverly staff. Contact your administrator.</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.auth { min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr); background: var(--page); color: var(--text); }

/* ---- form side ---- */
.auth-side { position: relative; display: grid; place-items: center; padding: var(--sp-5) var(--sp-4); overflow: hidden; background: linear-gradient(135deg, var(--g1), var(--g2) 60%, var(--g3)); }
.auth-aura { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(55% 40% at 50% 0%, color-mix(in srgb, var(--accent) 36%, transparent), transparent 70%), radial-gradient(40% 40% at 90% 100%, var(--orb2), transparent 65%); }
.auth-form { position: relative; width: 100%; max-width: 440px; padding: var(--sp-5); border-radius: var(--r-xl); background: color-mix(in srgb, var(--surface) 78%, transparent); border: 1px solid var(--border); box-shadow: var(--sh-overlay); -webkit-backdrop-filter: blur(18px) saturate(160%); backdrop-filter: blur(18px) saturate(160%); }
:root[data-surf=glass] .auth-form { background: linear-gradient(135deg, var(--lg-ovl-a), var(--lg-ovl-b)); border-color: var(--lg-rim); box-shadow: var(--lg-spec), var(--lg-oshadow); -webkit-backdrop-filter: var(--lg-oblur); backdrop-filter: var(--lg-oblur); }
.auth-mobile-brand { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-5); }
.auth-mobile-brand .auth-name { font-size: var(--fs-lg); }
.auth-logo { display: block; object-fit: contain; }
.auth-head h1 { margin: 0 0 6px; font-size: var(--fs-2xl); font-weight: var(--fw-light); letter-spacing: -0.01em; }
.auth-head p { margin: 0 0 var(--sp-5); color: var(--text-muted); }
.auth-fields { display: grid; gap: var(--sp-4); }
.fl { display: grid; gap: 6px; margin: 0; font-size: var(--fs-sm); color: var(--text-muted); }
.fl label { font-weight: var(--fw-regular); }
.auth-input { position: relative; display: flex; align-items: center; }
.auth-input > .i { position: absolute; left: 14px; width: 18px; height: 18px; color: var(--text-muted); pointer-events: none; }
.auth-input input { padding: 13px 14px 13px 42px; font-size: var(--fs-lg); border-radius: var(--r-md); transition: border-color var(--dur-fast), box-shadow var(--dur-fast); }
.auth-input input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 28%, transparent); }
.auth-input input::placeholder { color: var(--text-muted); opacity: 0.75; }
.auth-input:has(.auth-toggle) input { padding-right: 76px; }
.auth-toggle { position: absolute; right: 6px; height: 34px; min-width: 0; padding: 0 12px; background: transparent; color: var(--text); font-weight: var(--fw-medium); }
.auth-toggle:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
.auth-caps { color: var(--warn-fg); }
.auth-check { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--text-muted); font-size: var(--fs-md); cursor: pointer; }
.auth-check input { width: 18px; height: 18px; }
.auth-error { background: var(--danger-bg); color: var(--danger-fg); }
.auth-submit { width: 100%; height: 50px; font-size: var(--fs-lg); gap: var(--sp-2); display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 8px 22px color-mix(in srgb, var(--accent) 38%, transparent); transition: transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base); }
.auth-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 28px color-mix(in srgb, var(--accent) 46%, transparent); }
.auth-submit:active:not(:disabled) { transform: scale(0.98); }
.auth-submit:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
.auth-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--on-accent-text) 30%, transparent); border-top-color: var(--on-accent-text); animation: auth-rot 0.7s linear infinite; }
.auth-foot { display: flex; align-items: center; justify-content: center; gap: 6px; margin: var(--sp-5) 0 0; color: var(--text-muted); font-size: var(--fs-xs); text-align: center; }
.auth-foot .i { width: 13px; height: 13px; flex: none; }
@keyframes auth-rot { to { transform: rotate(360deg); } }

/* ---- brand side (hidden on phones) ---- */
.auth-brand { display: none; }

@media (min-width: 960px) {
  .auth { grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); }
  .auth-side { padding: var(--sp-6); }
  /* on desktop the form sits straight on the page, no card */
  .auth-form { max-width: 420px; padding: 0; background: none; border: 0; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  :root[data-surf=glass] .auth-form { background: none; border: 0; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .auth-mobile-brand { display: none; }

  .auth-brand { position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: var(--sp-6); padding: clamp(32px, 5vw, 64px); overflow: hidden; color: #fff; background: linear-gradient(160deg, color-mix(in srgb, var(--dark) 90%, var(--accent)), var(--dark) 70%); }
  .auth-glow { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; opacity: 0.55; }
  .auth-glow.g1 { width: 420px; height: 420px; top: -120px; right: -100px; background: var(--accent); animation: auth-float 14s ease-in-out infinite; }
  .auth-glow.g2 { width: 360px; height: 360px; bottom: -140px; left: -80px; background: color-mix(in srgb, var(--accent) 55%, var(--t1)); opacity: 0.32; animation: auth-float 18s ease-in-out infinite reverse; }
  .auth-grid { position: absolute; inset: 0; pointer-events: none; opacity: 0.5; background-image: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px); background-size: 44px 44px; -webkit-mask-image: radial-gradient(70% 70% at 30% 30%, #000, transparent); mask-image: radial-gradient(70% 70% at 30% 30%, #000, transparent); }
  .auth-brand-top, .auth-story, .auth-brand-foot { position: relative; z-index: 1; }
  .auth-brand-top { display: flex; align-items: center; gap: var(--sp-3); }
  .auth-name { font-size: 22px; font-weight: var(--fw-regular); letter-spacing: -0.01em; }
  .auth-story h2 { margin: 0 0 var(--sp-3); max-width: 15em; font-size: clamp(30px, 3.4vw, 46px); line-height: 1.08; font-weight: var(--fw-light); letter-spacing: -0.02em; }
  .auth-story > p { margin: 0 0 var(--sp-5); max-width: 32em; color: rgba(255, 255, 255, 0.72); font-size: var(--fs-lg); line-height: 1.5; }
  .auth-features { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); max-width: 30em; }
  .auth-features li { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); border-radius: var(--r-lg); background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.12); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
  .auth-features b { display: block; font-weight: var(--fw-regular); }
  .auth-features small { display: block; color: rgba(255, 255, 255, 0.66); font-size: var(--fs-sm); }
  .auth-fi { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: var(--on-accent-text); }
  .auth-brand-foot { margin: 0; color: rgba(255, 255, 255, 0.55); font-size: var(--fs-sm); }
}
/* ---- dark theme: its own surfaces, so the two halves read as two panels and the form keeps real contrast ---- */
:root[data-theme=dark] .auth-side { background: radial-gradient(70% 45% at 50% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%), linear-gradient(180deg, var(--g1), var(--page)); }
:root[data-theme=dark] .auth-aura { background: radial-gradient(40% 40% at 92% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 65%); }
:root[data-theme=dark] .auth-input input { background: color-mix(in srgb, var(--text) 7%, var(--surface)); border-color: color-mix(in srgb, var(--text) 20%, transparent); color: var(--text); }
:root[data-theme=dark] .auth-input input::placeholder { color: var(--text-muted); opacity: 0.6; }
:root[data-theme=dark] .auth-input input:-webkit-autofill { -webkit-text-fill-color: var(--text); box-shadow: 0 0 0 100px color-mix(in srgb, var(--text) 9%, var(--surface)) inset; }
:root[data-theme=dark] .auth-toggle { color: var(--accent); }
:root[data-theme=dark] .auth-submit { color: #1a1608; }
:root[data-theme=dark] .auth-submit:disabled { opacity: 1; background: color-mix(in srgb, var(--text) 14%, transparent); color: color-mix(in srgb, var(--text) 55%, transparent); }
:root[data-theme=dark] .auth-check input { accent-color: var(--accent); }
@media (min-width: 960px) {
  :root[data-theme=dark] .auth-brand { background: linear-gradient(155deg, color-mix(in srgb, var(--accent) 26%, #060607), #060607 62%); border-right: 1px solid rgba(255, 255, 255, 0.08); }
  :root[data-theme=dark] .auth-glow.g1 { opacity: 0.7; }
  :root[data-theme=dark] .auth-glow.g2 { opacity: 0.45; }
}
@keyframes auth-float { 50% { transform: translate(24px, -18px) scale(1.06); } }
@media (prefers-reduced-motion: reduce) { .auth-glow, .auth-spin { animation: none; } }
:root[data-rm] .auth-glow { animation: none; }
</style>
